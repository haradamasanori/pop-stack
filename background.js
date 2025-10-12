
// Keep a per-tab store of detected technologies
// entry shape: {
//   url: string|null,
//   detectionsByUrl: Map<string, {headerComponents: [], htmlComponents: [], ipComponents: []}>,
//   recentDetections: Array<{url: string, detectionsByUrl: Map<string, object>}> // last 5 pages cache
// }
const tabDetections = new Map(); // tabId -> entry
// Track which tabs currently have a listening side panel instance
const readyPanels = new Set();
// Cache for configuration
let techConfig = null;
let ipRangeConfigs = null;

// Helper functions for recent detections cache
function cacheCurrentDetections(tabId, url) {
  if (!url) return;

  const entry = tabDetections.get(tabId);
  if (!entry || !entry.detectionsByUrl || entry.detectionsByUrl.size === 0) return;

  // Initialize recentDetections array if it doesn't exist
  if (!entry.recentDetections) {
    entry.recentDetections = [];
  }

  // Clone the current detectionsByUrl Map for caching
  const clonedDetections = new Map();
  for (const [detectionUrl, detection] of entry.detectionsByUrl) {
    clonedDetections.set(detectionUrl, { ...detection });
  }

  // Remove existing entry for this URL if it exists
  entry.recentDetections = entry.recentDetections.filter(item => item.url !== url);

  // Add new entry at the beginning
  entry.recentDetections.unshift({
    url: url,
    detectionsByUrl: clonedDetections,
    timestamp: Date.now()
  });

  // Keep only the last 5 entries
  entry.recentDetections = entry.recentDetections.slice(0, 5);

  console.log(`📂 Cached detections for ${url}, total cached: ${entry.recentDetections.length}`);
}

function getCachedDetections(tabId, url) {
  if (!url) return null;

  const entry = tabDetections.get(tabId);
  if (!entry || !entry.recentDetections) return null;

  const cached = entry.recentDetections.find(item => item.url === url);
  if (cached) {
    console.log(`🔍 Found cached detections for ${url}, age: ${Date.now() - cached.timestamp}ms`);

    // Clone the cached detectionsByUrl Map
    const clonedDetections = new Map();
    for (const [detectionUrl, detection] of cached.detectionsByUrl) {
      clonedDetections.set(detectionUrl, { ...detection });
    }

    return clonedDetections;
  }

  return null;
}

// This function enables or disables the action button and side panel
// based on the tab's URL.
const updateActionAndSidePanel = async (tabId) => {
  if (!tabId || tabId < 0) return; // Guard against invalid tab IDs
  try {
    const tab = await chrome.tabs.get(tabId);
    // The action should only be enabled for http and https pages.
    if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
      await chrome.action.enable(tabId);
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true,
      });
    } else {
      // Disable for other schemes like chrome://, file://, etc.
      await chrome.action.disable(tabId);
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false,
      });
    }
  } catch (error) {
    // This can happen if the tab is closed before we can get its details.
    // We can safely ignore this error.
    console.debug(`Could not update action for tab ${tabId}:`, error.message);
  }
};

// On initial installation, set the state for all existing tabs.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      updateActionAndSidePanel(tab.id);
    }
  }
});

// Load configuration and compile regex patterns
async function loadConfig() {
  if (techConfig && ipRangeConfigs) return { techConfig, ipRangeConfigs };
  
  try {
    // Load main technology config
    if (!techConfig) {
      const configUrl = chrome.runtime.getURL('config.json');
      const response = await fetch(configUrl);
      const rawConfig = await response.json();
      
      // Pre-compile regex patterns for performance
      techConfig = {};
      Object.entries(rawConfig).forEach(([key, config]) => {
        techConfig[key] = {
          ...config,
          compiledHeaderPatterns: (config.headers || []).map(pattern => {
            try {
              return { pattern, regex: new RegExp(pattern, 'i') };
            } catch (error) {
              console.warn(`Background: Invalid header regex pattern for ${config.name}:`, pattern, error);
              return null;
            }
          }).filter(Boolean) // Remove null entries from invalid patterns
        };
      });
      
      console.log('Background: Configuration loaded:', Object.keys(techConfig).length, 'technologies');
    }
    
    // Load IP range configs
    if (!ipRangeConfigs) {
      const providers = ['aws', 'azure', 'cloudflare', 'fastly', 'gcp', 'akamai'];
      ipRangeConfigs = {};
      
      for (const provider of providers) {
        try {
          const ipConfigUrl = chrome.runtime.getURL(`config/${provider}.json`);
          const response = await fetch(ipConfigUrl);
          const config = await response.json();
          
          // Process and normalize different formats
          const ranges = processIpRangesForProvider(provider, config);
          
          ipRangeConfigs[provider] = {
            ...config,
            normalizedRanges: ranges
          };
          
          console.log(`Background: IP ranges loaded for ${provider}:`, ranges.length, 'ranges');
        } catch (error) {
          console.warn(`Background: Failed to load IP ranges for ${provider}:`, error);
          ipRangeConfigs[provider] = { normalizedRanges: [] };
        }
      }
      
      console.log('Background: IP range configs loaded for', Object.keys(ipRangeConfigs).length, 'providers');
    }
    
    return { techConfig, ipRangeConfigs };
  } catch (error) {
    console.error('Background: Failed to load configurations:', error);
    techConfig = techConfig || {};
    ipRangeConfigs = ipRangeConfigs || {};
    return { techConfig, ipRangeConfigs };
  }
}

// Helper function to process different IP range formats
function processIpRangesForProvider(provider, config) {
  const ranges = [];
  
  switch (provider) {
    case 'aws':
      if (config.prefixes) {
        config.prefixes.forEach(prefix => {
          ranges.push(prefix.ip_prefix);
        });
      }
      if (config.ipv6_prefixes) {
        config.ipv6_prefixes.forEach(prefix => {
          ranges.push(prefix.ipv6_prefix);
        });
      }
      break;
      
    case 'azure':
      if (config.values) {
        config.values.forEach(value => {
          if (value.properties && value.properties.addressPrefixes) {
            ranges.push(...value.properties.addressPrefixes);
          }
        });
      }
      break;
      
    case 'cloudflare':
      if (config.result && config.result.ipv4_cidrs) {
        ranges.push(...config.result.ipv4_cidrs);
      }
      if (config.result && config.result.ipv6_cidrs) {
        ranges.push(...config.result.ipv6_cidrs);
      }
      break;
      
    case 'fastly':
      if (config.addresses) {
        ranges.push(...config.addresses);
      }
      break;
      
    case 'gcp':
      if (config.prefixes) {
        config.prefixes.forEach(prefix => {
          if (prefix.ipv4Prefix) {
            ranges.push(prefix.ipv4Prefix);
          }
        });
      }
      break;
      
    case 'akamai':
      if (config.ranges) {
        ranges.push(...config.ranges);
      }
      break;
  }
  
  return ranges;
}

// Helper function to check if an IP address is in a CIDR range
function isIpInCidr(ip, cidr) {
  try {
    const [network, prefixLength] = cidr.split('/');
    const prefix = parseInt(prefixLength, 10);
    
    // Check if it's IPv4 or IPv6
    const isIpv4 = ip.includes('.') && !ip.includes(':');
    const isNetworkIpv4 = network.includes('.') && !network.includes(':');
    
    // Both must be the same type
    if (isIpv4 !== isNetworkIpv4) {
      return false;
    }
    
    if (isIpv4) {
      // IPv4 CIDR matching
      const ipToInt = (ipStr) => {
        return ipStr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      };
      
      const ipInt = ipToInt(ip);
      const networkInt = ipToInt(network);
      const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
      
      return (ipInt & mask) === (networkInt & mask);
    } else {
      // IPv6 CIDR matching
      const ipv6ToBytes = (ipStr) => {
        // Expand compressed IPv6 notation
        let expanded = ipStr;
        if (expanded.includes('::')) {
          const parts = expanded.split('::');
          const leftParts = parts[0] ? parts[0].split(':') : [];
          const rightParts = parts[1] ? parts[1].split(':') : [];
          const missingParts = 8 - leftParts.length - rightParts.length;
          const middleParts = new Array(missingParts).fill('0');
          expanded = [...leftParts, ...middleParts, ...rightParts].join(':');
        }
        
        // Convert to bytes
        const bytes = new Uint8Array(16);
        const groups = expanded.split(':');
        for (let i = 0; i < 8; i++) {
          const group = parseInt(groups[i] || '0', 16);
          bytes[i * 2] = (group >> 8) & 0xFF;
          bytes[i * 2 + 1] = group & 0xFF;
        }
        return bytes;
      };
      
      const ipBytes = ipv6ToBytes(ip);
      const networkBytes = ipv6ToBytes(network);
      
      // Create mask for the prefix length
      const prefixBytes = Math.floor(prefix / 8);
      const prefixBits = prefix % 8;
      
      // Check full bytes
      for (let i = 0; i < prefixBytes; i++) {
        if (ipBytes[i] !== networkBytes[i]) {
          return false;
        }
      }
      
      // Check partial byte if needed
      if (prefixBits > 0 && prefixBytes < 16) {
        const mask = (0xFF << (8 - prefixBits)) & 0xFF;
        if ((ipBytes[prefixBytes] & mask) !== (networkBytes[prefixBytes] & mask)) {
          return false;
        }
      }
      
      return true;
    }
  } catch (error) {
    console.warn('Error checking IP range:', ip, 'in', cidr, error);
    return false;
  }
}

// Function to detect technologies based on IP address
async function detectTechnologiesFromIP(tabId, url, hostname, ipAddress) {
  if (!ipRangeConfigs) {
    await loadConfig();
  }
  
  console.log('🌍 Starting IP-based detection for hostname:', hostname, 'IP:', ipAddress);
  
  if (!ipAddress) {
    console.log('⏭️ No IP address provided for hostname:', hostname);
    return;
  }
  
  console.log('🔍 Analyzing', hostname, 'at IP:', ipAddress);
  
  let entry = tabDetections.get(tabId);
  if (!entry) {
    entry = { detectionsByUrl: new Map(), recentDetections: [] };
    tabDetections.set(tabId, entry);
  }
  
  // Get or create detection entry for this URL
  let urlDetection = entry.detectionsByUrl.get(url);
  if (!urlDetection) {
    urlDetection = {};
    entry.detectionsByUrl.set(url, urlDetection);
  }
  
  // Ensure ipComponents array exists for IP detection
  if (!urlDetection.ipComponents) {
    urlDetection.ipComponents = [];
  }
  
  // Track detected technologies by key to avoid duplicates
  const detectedTechKeys = new Set(urlDetection.ipComponents.map(tech => tech.key));
  
  // Check IP against all provider ranges
  for (const [provider, config] of Object.entries(ipRangeConfigs)) {
    if (detectedTechKeys.has(provider)) continue; // Already detected
    
    const ranges = config.normalizedRanges || [];
    let isDetected = false;
    
    for (const range of ranges) {
      if (isIpInCidr(ipAddress, range)) {
        isDetected = true;
        console.log(`✓ IP ${ipAddress} matches ${provider} range: ${range}`);
        break;
      }
    }
    
    if (!isDetected) {
      console.log(`❌ IP ${ipAddress} (${ipAddress.includes(':') ? 'IPv6' : 'IPv4'}) does not match any ${provider} ranges`);
    }
    
    if (isDetected) {
      const detectedTech = {
        key: provider,
        name: config.name || provider,
        description: config.description || `${config.name || provider} cloud infrastructure`,
        link: config.link || '',
        tags: config.tags || ['cloud', 'infrastructure'],
        developer: config.developer || '',
        detectionMethod: 'IP Address',
        matchedTexts: [`${hostname} ${ipAddress}`]
      };
      
      console.log(`🔑 IP detection key for ${config.name}: "${provider}"`);
      console.log(`📄 IP detection matched texts: [${detectedTech.matchedTexts.join(', ')}]`);
      
      urlDetection.ipComponents.push(detectedTech);
      detectedTechKeys.add(provider);
      
      console.log(`🎯 Detected ${config.name} via IP address ${ipAddress} for ${hostname}`);
    }
  }
  
  // Notify side panel if it's open for this tab
  const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
  
  console.log('🔧 IP detection completed', { tabId, hostname, ipAddress, techCount: allTechs.length, panelReady: readyPanels.has(tabId) });
  
  // Only send to the panel if it is ready for this tab
  if (readyPanels.has(tabId)) {
    console.log('📨 Sending IP detection results to ready panel');
    const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
    chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, (res) => { });
  } else {
    console.log('📦 IP detection results stored, panel not ready yet');
  }
}


// Helper function to convert detectionsByUrl Map to plain object for messaging
function serializeDetectionsByUrl(detectionsByUrlMap) {
  return Object.fromEntries(
    Array.from(detectionsByUrlMap.entries()).map(([url, detection]) => {
      const result = {};
      if (detection.headerComponents) result.headerComponents = detection.headerComponents;
      if (detection.htmlComponents) result.htmlComponents = detection.htmlComponents;
      if (detection.ipComponents) result.ipComponents = detection.ipComponents;
      return [url, result];
    })
  );
}

// Helper function to get all technologies and analyzed URLs for a tab
function getAllTechnologiesForTab(tabId) {
  const entry = tabDetections.get(tabId);
  if (!entry || !entry.detectionsByUrl) {
    return { allTechs: [], analyzedUrls: [] };
  }
  
  const allTechs = [];
  const analyzedUrls = Array.from(entry.detectionsByUrl.keys());
  const techMap = new Map(); // Use Map to track and merge duplicate technologies
  
  // Combine all technologies from all URLs, merging matchedText for duplicates
  for (const [url, detection] of entry.detectionsByUrl) {
    const headerComponents = detection.headerComponents || [];
    const htmlComponents = detection.htmlComponents || [];
    const ipComponents = detection.ipComponents || [];
    
    console.log(`🔍 Processing detections for URL: ${url}`, {
      headerComponents: headerComponents.length,
      htmlComponents: htmlComponents.length, 
      ipComponents: ipComponents.length
    });
    
    [...headerComponents, ...htmlComponents, ...ipComponents].forEach(tech => {
      console.log(`🔧 Processing tech: ${tech.name} (key: ${tech.key}, method: ${tech.detectionMethod})`);
      
      if (!techMap.has(tech.key)) {
        // First occurrence - add as is
        console.log(`✨ First occurrence of ${tech.name}, adding with ${tech.matchedTexts?.length || 0} matched texts`);
        techMap.set(tech.key, { ...tech });
      } else {
        // Duplicate found - merge matchedText
        console.log(`🔄 Duplicate ${tech.name} found, merging matched texts`);
        const existing = techMap.get(tech.key);
        const existingTexts = existing.matchedTexts || [];
        const newTexts = tech.matchedTexts || [];
        
        console.log(`📝 Merging texts - existing: ${existingTexts.length}, new: ${newTexts.length}`);
        
        // Combine and deduplicate matchedTexts
        const combinedTexts = [...existingTexts, ...newTexts];
        existing.matchedTexts = [...new Set(combinedTexts)].slice(0, 10); // Dedupe and limit to 10
        
        console.log(`📋 After merge: ${existing.matchedTexts.length} total texts`);
        
        // Also update detection method to show it was detected by multiple methods
        const methods = new Set();
        if (existing.detectionMethod) methods.add(existing.detectionMethod);
        if (tech.detectionMethod) methods.add(tech.detectionMethod);
        
        if (methods.size > 1) {
          const newMethod = Array.from(methods).join(' + ');
          console.log(`🔀 Updated detection method: ${existing.detectionMethod} → ${newMethod}`);
          existing.detectionMethod = newMethod;
        }
      }
    });
  }
  
  // Convert Map values to array
  allTechs.push(...Array.from(techMap.values()));
  
  console.log(`🎯 Final technologies for tab ${tabId}:`, allTechs.map(tech => 
    `${tech.name} (${tech.detectionMethod}) - ${tech.matchedTexts?.length || 0} texts: [${tech.matchedTexts?.slice(0, 3).join(', ')}${tech.matchedTexts?.length > 3 ? '...' : ''}]`
  ));
  
  return { allTechs, analyzedUrls };
}

async function detectTechnologiesFromHeaders(tabId, responseHeaders, url) {
  if (!tabId || !responseHeaders || !url) return;
  
  // Ensure config is loaded
  if (!techConfig) {
    await loadConfig();
  }
  
  let entry = tabDetections.get(tabId);
  if (!entry) {
    entry = { detectionsByUrl: new Map(), recentDetections: [] };
    tabDetections.set(tabId, entry);
  }
  
  // Get or create detection entry for this URL
  let urlDetection = entry.detectionsByUrl.get(url);
  if (!urlDetection) {
    urlDetection = {};
    entry.detectionsByUrl.set(url, urlDetection);
  }
  
  // Ensure headerComponents array exists for HTTP detection
  if (!urlDetection.headerComponents) {
    urlDetection.headerComponents = [];
  }
  
  // Convert headers to individual header strings for pattern matching
  const headerStrings = responseHeaders.map(h => `${h.name.toLowerCase()}: ${h.value || ''}`);
  
  // Track detected technologies by key to avoid duplicates
  const detectedTechKeys = new Set(urlDetection.headerComponents.map(tech => tech.key));
  
  // Iterate through all configured technologies that have compiled header patterns
  Object.entries(techConfig).forEach(([key, config]) => {
    const { name, compiledHeaderPatterns = [] } = config;
    const matchedTexts = [];
    
    // Skip if already detected for this URL
    if (detectedTechKeys.has(key)) return;
    
    // Check compiled header patterns against each header line
    for (const { pattern, regex } of compiledHeaderPatterns) {
      // Test pattern against all header lines and collect matches
      const matchedHeaders = headerStrings.filter(headerLine => regex.test(headerLine));
      if (matchedHeaders.length > 0) {
        matchedTexts.push(...matchedHeaders);
      }
    }
    
    // If we found any matches, add the technology with all matched headers
    if (matchedTexts.length > 0) {
      const detectedTech = {
        key,
        name,
        description: config.description || '',
        link: config.link || '',
        tags: config.tags || [],
        developer: config.developer || '',
        detectionMethod: 'HTTP Headers',
        matchedTexts: [...new Set(matchedTexts)] // Remove duplicates
      };
      
      console.log(`🔑 HTTP detection key for ${name}: "${key}"`);
      console.log(`📄 HTTP detection matched texts: [${detectedTech.matchedTexts.join(', ')}]`);
      
      urlDetection.headerComponents.push(detectedTech);
      detectedTechKeys.add(key);
      console.log(`Background: Detected ${name} via header patterns for ${url} (matched: ${matchedTexts.join(', ')})`);
    }
  });
  
  // Notify side panel if it's open for this tab so UI updates immediately
  const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
  
  console.log('🔧 Header detection completed', { tabId, techCount: allTechs.length, panelReady: readyPanels.has(tabId) });
  
  // Only send to the panel if it is ready for this tab
  if (readyPanels.has(tabId)) {
    console.log('📨 Sending header detection results to ready panel');
    const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
    chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, (res) => { });
  } else {
    console.log('📦 Header detection results stored, panel not ready yet');
  }
}

// webRequest listener to inspect response headers
try {
  console.log('Attempting to register webRequest.onHeadersReceived listener', { webRequestAvailable: !!(chrome.webRequest && chrome.webRequest.onHeadersReceived) });
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      // details.tabId may be -1 for non-tab resources; ignore those
      const tabId = details.tabId;
      // Only inspect responses for tabs where the side panel is enabled (panel ready)
      if (typeof tabId !== 'number' || tabId < 0) return;

      // Only accept main frame requests - use frameId as primary check since type can be unreliable
      // frameId 0 is always the main frame, regardless of type field
      if (details.frameId !== 0) return;

      // Only analyze when panel is ready for this tab
      if (!readyPanels.has(tabId)) {
        console.log('⏭️ Skipping header analysis - panel not ready for tab', tabId);
        return;
      }

      console.log('🌐 webRequest.onHeadersReceived', {
        tabId,
        url: details.url,
        frameId: details.frameId,
        panelReady: readyPanels.has(tabId),
        readyPanels: Array.from(readyPanels)
      });

      // Only analyze server headers from same hostname as the tab - skip external resources
      try {
        const requestUrl = new URL(details.url);
        
        // Get tab URL to compare hostnames
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab || !tab.url) return;
          
          try {
            const tabUrl = new URL(tab.url);
            // Only process requests from same hostname as the tab
            if (requestUrl.hostname === tabUrl.hostname) {
              processResponseHeaders(details, tabId);
            }
          } catch (e) {
            console.debug('URL parse failed for tab hostname comparison', e);
          }
        });
      } catch (e) {
        console.debug('URL parse failed for request', e);
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders', 'extraHeaders']  // include extraHeaders to capture more headers
  );

async function processResponseHeaders(details, tabId) {
  // We accept main-frame responses for enabled tabs; per-tab URL tracking
  // is used elsewhere to decide when to clear header detections on origin
  // changes.
  if (details.responseHeaders) {
    console.log('webRequest.onHeadersReceived', { tabId, url: details.url, responseHeaders: details.responseHeaders });
    
    // Process all main-frame responses for HTTP header technology detection
    // Technologies can be detected from headers regardless of content type
    await detectTechnologiesFromHeaders(tabId, details.responseHeaders, details.url);
    
    // IP detection will be handled by webRequest.onCompleted listener
  }
}
  console.log('webRequest.onHeadersReceived listener registered');
} catch (e) {
  console.warn('webRequest.onHeadersReceived not available or blocked', e);
}

// webRequest.onCompleted listener for IP-based detection
try {
  console.log('Attempting to register webRequest.onCompleted listener for IP detection');
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      const tabId = details.tabId;
      
      // Only process main frame requests for valid tabs
      if (typeof tabId !== 'number' || tabId < 0 || details.frameId !== 0) return;

      // Only analyze when panel is ready for this tab
      if (!readyPanels.has(tabId)) {
        console.log('⏭️ Skipping IP analysis - panel not ready for tab', tabId);
        return;
      }

      console.log('🌐 webRequest.onCompleted', {
        tabId,
        url: details.url,
        ip: details.ip,
        method: details.method,
        statusCode: details.statusCode
      });

      // Only process successful requests with IP addresses
      if (details.ip && details.statusCode >= 200 && details.statusCode < 400) {
        try {
          const requestUrl = new URL(details.url);
          
          // Skip non-HTML resources based on URL path
          const pathname = requestUrl.pathname.toLowerCase();
          const nonHtmlExtensionRegex = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp[34]|wav|woff2?|[te]ot)$/i;
          
          if (nonHtmlExtensionRegex.test(pathname)) {
            console.log('⏭️ Skipping IP detection for non-HTML resource:', details.url);
            return;
          }
          
          // Only analyze requests from same hostname as the tab - skip external resources
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab || !tab.url) return;
            
            try {
              const tabUrl = new URL(tab.url);
              // Only process requests from same hostname as the tab
              if (requestUrl.hostname === tabUrl.hostname) {
                if (requestUrl.hostname && requestUrl.hostname !== details.ip) { // Avoid processing raw IP URLs
                  console.log('🔍 Triggering IP detection for', requestUrl.hostname, 'at', details.ip);
                  
                  // Run IP detection asynchronously
                  detectTechnologiesFromIP(tabId, details.url, requestUrl.hostname, details.ip).catch(error => {
                    console.warn('IP detection failed:', error);
                  });
                }
              } else {
                console.log('⏭️ Skipping IP detection for external hostname:', requestUrl.hostname, 'vs tab hostname:', tabUrl.hostname);
              }
            } catch (e) {
              console.debug('URL parse failed for tab hostname comparison in IP detection', e);
            }
          });
        } catch (error) {
          console.warn('Failed to parse URL for IP detection:', error);
        }
      }
    },
    { urls: ['<all_urls>'] }
  );
  
  console.log('webRequest.onCompleted listener registered for IP detection');
} catch (e) {
  console.warn('webRequest.onCompleted not available or blocked', e);
}

// Allow clicking the action to open the side panel for the current tab
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  // Non-fatal: older Chrome may not support this
  console.warn('setPanelBehavior failed', err);
});

// When the user switches tabs, update the action button state.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;
  updateActionAndSidePanel(tabId);
  console.log('Tab activated', tabId, 'panel ready for tab?', readyPanels.has(tabId));
});

// When a tab is closed, ensure any tab-specific panel options are cleaned up.
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // When a tab is closed, ensure internal state is cleaned up.
  // The browser will clear any per-tab side panel options automatically,
  // so there's no need to call chrome.sidePanel.setOptions here.
  // Remove the tab from readyPanels so we don't keep stale listeners.
  if (readyPanels.has(tabId)) {
    readyPanels.delete(tabId);
    console.log('Removed tab from readyPanels due to tab close', tabId);
  }
  // Clean up any stored header detections for the removed tab and notify UI
  if (tabDetections.has(tabId)) {
    tabDetections.delete(tabId);
    chrome.runtime.sendMessage({ action: 'removeTab', tabId }, () => { });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  console.log('tab updated', { tabId, info, tab });
  
  // Update the action button state whenever the tab is updated.
  updateActionAndSidePanel(tabId);

  const panelReady = readyPanels.has(tabId);
  // Clear all detections when navigation starts and handle caching
  if (info.status === 'loading') {
    let entry = tabDetections.get(tabId);
    if (entry) {
      const newUrl = (tab && tab.url) ? tab.url : (info.url || null);

      // If URL is changing, cache current detections before clearing
      if (entry.url && newUrl && entry.url !== newUrl) {
        console.log('🔄 URL changing during loading, caching current detections', {
          from: entry.url,
          to: newUrl
        });
        cacheCurrentDetections(tabId, entry.url);
      }

      // Check if we have cached detections for the new URL
      const cachedDetections = newUrl ? getCachedDetections(tabId, newUrl) : null;

      if (cachedDetections) {
        console.log('📦 Restored cached detections during loading for URL:', newUrl);
        entry.detectionsByUrl = cachedDetections;
      } else {
        console.log('🧹 No cached detections, clearing all detection components during loading');
        entry.detectionsByUrl.clear();
      }

      // Send updated tech list if panel is ready
      if (panelReady) {
        const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
        console.log('🔧 Background sending updateDetectionsByUrl during loading', { tabId, techCount: allTechs.length, urlCount: analyzedUrls.length });
        const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
        chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, (res) => { });

        // Update target URL
        if (newUrl) {
          console.log('🔗 Background sending updateTargetUrl during loading', { tabId, newUrl });
          chrome.runtime.sendMessage({ action: 'updateTargetUrl', tabId, url: newUrl }, (res) => { });
        }
      } else {
        // Send clearTechs if panel is not ready
        try {
          console.log('🧹 Background sending clearTechs message for navigation loading (panel not ready)', { tabId, url: newUrl });
          chrome.runtime.sendMessage({ action: 'clearTechs', tabId }, (res) => {
            if (chrome.runtime.lastError) {
              console.debug('clearTechs message had no receiver', chrome.runtime.lastError);
            }
          });
        } catch (e) {
          // ignore
        }
      }
    }
  }

  // If the tab with the side panel navigates, update the cached visible URL
  if (tab && tab.url) {
    let entry = tabDetections.get(tabId);
    if (!entry) {
      entry = { url: tab.url, detectionsByUrl: new Map(), recentDetections: [] };
      tabDetections.set(tabId, entry);
    } else {
      entry.url = tab.url;
    }
  }

  if (info.status === 'complete' && tab.url) {
    // If navigation completed, and this tab is enabled, handle URL changes
    if (panelReady) {
      // Always update the target URL on navigation complete
      console.log('🔗 Sending updateTargetUrl on navigation complete', { tabId, url: tab.url });
      chrome.runtime.sendMessage({ action: 'updateTargetUrl', tabId, url: tab.url }, () => { });

      const entry = tabDetections.get(tabId);
      if (entry && entry.url && entry.url !== tab.url) {
        console.log('🔄 URL changed on navigation complete, caching and checking for cached data', {
          from: entry.url,
          to: tab.url
        });

        // Cache current detections before clearing
        cacheCurrentDetections(tabId, entry.url);

        // Check if we have cached detections for the new URL
        const cachedDetections = getCachedDetections(tabId, tab.url);
        if (cachedDetections) {
          console.log('📦 Restored cached detections for URL:', tab.url);
          entry.detectionsByUrl = cachedDetections;
          const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
          chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, () => { });
        } else {
          console.log('🧹 No cached detections, clearing for new URL:', tab.url);
          entry.detectionsByUrl.clear();
          const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
          chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, () => { });
        }
      }
    }
    // Only request content analysis for tabs where the side panel is ready
    if (panelReady) {
      chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
        if (chrome.runtime.lastError) {
          // ...existing code...
        }
      });
    }
    // Note: Cannot programmatically open side panel after navigation due to user gesture requirement
    // The panel will remain open if it was already open, or user needs to click the action button
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('onMessage received', { message, sender });
  // Handle panel handshake messages first
  if (message.action === 'requestAnalyze') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    console.log('🚀 Background received requestAnalyze', { tabId });
    if (tabId) {
      console.log('📨 Background sending analyze message to content script', { tabId });
      chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('⚠️ Failed to send analyze message to content script:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ Analyze message sent successfully to content script');
        }
      });
    } else {
      console.warn('⚠️ No tabId found for requestAnalyze message');
    }
    return;
  }
  // Store detections sent from content scripts so background can serve them
  // directly to the side panel without needing an immediate tabs.sendMessage.
  if (message.action === 'detectedTechs') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    const url = sender && sender.tab && sender.tab.url;
    if (tabId && url) {
      let entry = tabDetections.get(tabId);
      if (!entry) {
        entry = { detectionsByUrl: new Map(), recentDetections: [] };
        tabDetections.set(tabId, entry);
      }
      
      // Get or create detection entry for this URL
      let urlDetection = entry.detectionsByUrl.get(url);
      if (!urlDetection) {
        urlDetection = {};
        entry.detectionsByUrl.set(url, urlDetection);
      }
      
      // Update HTML components for this URL only if there are detections
      const technologies = Array.isArray(message.technologies) ? message.technologies : [];
      if (technologies.length > 0) {
        urlDetection.htmlComponents = technologies;
      }
      
      // Get combined results and notify sidepanel if panel is ready
      if (readyPanels.has(tabId)) {
        const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
        console.log('🔧 Background sending updateDetectionsByUrl from detectedTechs message', { tabId, url, techCount: allTechs.length, htmlCount: technologies.length });
        const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
        chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, () => { });
      }
    }
    return; // handled
  }
  if (message.action === 'getDetectionsByUrl') {
    // Send updateDetectionsByUrl message instead of returning response
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        const entry = tabDetections.get(tabId);
        if (entry) {
          const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
          chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, () => { });
        }
      }
    });
    return; // handled
  }
  if (message.action === 'getDetectedTechs') {
    // Return merged detections for the active tab using new structure
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
        sendResponse({ 
          technologies: allTechs,
          analyzedUrls: analyzedUrls
        });
      } else {
        sendResponse({ error: 'No active tab found.' });
      }
    });
    return true; // Indicates that the response is sent asynchronously
  }
});

// Listen for connections from other parts of the extension (like the side panel)
chrome.runtime.onConnect.addListener((port) => {
  // Check if the connection is coming from your side panel
  if (port.name?.startsWith('sidepanel-')) {
    const tabId = port.name.split('-')[1] ? parseInt(port.name.split('-')[1], 10) : null;
    console.log('📡 Side panel connected', { tabId });

    if (tabId) {
      readyPanels.add(tabId);
      console.log('🎛️ Panel ready for tab', tabId);
      // send current state for this tab, if present
      const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
      console.log('📨 Sending stored detections to newly ready panel', { tabId, techCount: allTechs.length, urlCount: analyzedUrls.length });
      const entry = tabDetections.get(tabId);
      if (entry) {
        const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
        chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl }, () => { });
      }
    }

    // Add a listener for when the port is disconnected
    port.onDisconnect.addListener(() => {
      // This block executes when the side panel is closed by the user,
      // the tab is closed, or the context is destroyed.
      console.log(`📡 Side panel disconnected ${tabId}. Executing cleanup...`);

      // Remove the tab from readyPanels when panel is closed
      if (tabId && readyPanels.has(tabId)) {
        readyPanels.delete(tabId);
        console.log('🧹 Removed tab from readyPanels due to panel closure', tabId);
      }
    });
  }
});
