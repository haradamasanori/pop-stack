import { devLog, logWarn, logError } from './utils.js';

const readyPanels = new Set();

// Cache for configuration
let techConfig = null;
let ipRangeConfigs = null;

// Load configuration and compile regex patterns
async function loadConfig() {
  // Load main technology config
  if (!techConfig) {
    const configUrl = chrome.runtime.getURL('config.json');
    const response = await fetch(configUrl);
    const rawConfig = await response.json();

    // Pre-compile regex patterns for performance
    const tmpTechConfig = {};
    Object.entries(rawConfig).forEach(([key, config]) => {
      tmpTechConfig[key] = {
        ...config,
        compiledHeaderPatterns: (config.headers || []).map(pattern => {
          try {
            return { pattern, regex: new RegExp(pattern, 'i') };
          } catch (error) {
            logWarn(`Background: Invalid header regex pattern for ${config.name}:`, pattern, error);
            return null;
          }
        }).filter(Boolean) // Remove null entries from invalid patterns
      };
    });
    techConfig = tmpTechConfig;
    devLog('Background: Configuration loaded:', Object.keys(tmpTechConfig).length, 'components');
  }

  // Load IP range configs
  if (!ipRangeConfigs) {
    const providers = ['aws', 'azure', 'cloudflare', 'fastly', 'gcp', 'akamai'];
    let tmpIpRangeConfigs = {};

    for (const provider of providers) {
      try {
        const ipConfigUrl = chrome.runtime.getURL(`config/${provider}.json`);
        const response = await fetch(ipConfigUrl);
        const config = await response.json();

        // Process and normalize different formats
        const ranges = processIpRangesForProvider(provider, config);

        tmpIpRangeConfigs[provider] = {
          ...config,
          normalizedRanges: ranges
        };

        devLog(`Background: IP ranges loaded for ${provider}:`, ranges.length, 'ranges');
      } catch (error) {
        logWarn(`Background: Failed to load IP ranges for ${provider}:`, error);
        tmpIpRangeConfigs[provider] = { normalizedRanges: [] };
      }
    }
    ipRangeConfigs = tmpIpRangeConfigs;
    devLog('Background: IP range configs loaded for', Object.keys(tmpIpRangeConfigs).length, 'providers');
  }

  return { techConfig, ipRangeConfigs };
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
    logWarn('Error checking IP range:', ip, 'in', cidr, error);
    return false;
  }
}

// Function to detect technologies based on IP address
async function detectTechnologiesFromIP(url, ipAddress) {
  if (!ipRangeConfigs) {
    await loadConfig();
  }
  const urlobj = new URL(url);
  const hostname = urlobj.hostname;
  if (!ipAddress) {
    devLog('No IP address provided for url:', url);
    return;
  }
  devLog(`Starting IP-based detection for url: ${url}, host: ${hostname}, IP: ${ipAddress}`);
  const ipComponents = [];

  // Check IP against all provider ranges
  for (const [provider, config] of Object.entries(ipRangeConfigs)) {
    let isDetected = false;
    const ranges = config.normalizedRanges || [];

    for (const range of ranges) {
      if (isIpInCidr(ipAddress, range)) {
        isDetected = true;
        break;
      }
    }

    if (isDetected) {
      const detectedTech = {
        key: provider,
        name: config.name || provider,
        description: config.description || `${config.name || provider} cloud infrastructure`,
        link: config.link || '',
        tags: config.tags || ['cloud', 'infrastructure'],
        developer: config.developer || '',
        matchedTexts: [`${hostname} ${ipAddress}`]
      };
      ipComponents.push(detectedTech);

      devLog(`Detected ${config.name} via IP address ${ipAddress} for ${hostname}`);
    }
  }
  return ipComponents;
}

// Helper function to get all technologies and analyzed URLs for a tab
// TODO: not checking if this matches with the current url.
async function detectTechnologiesFromHeaders(tabId, responseHeaders, url) {
  // Ensure config is loaded
  if (!techConfig) {
    await loadConfig();
  }

  // Convert headers to individual header strings for pattern matching
  const headerStrings = responseHeaders.filter(h => h.name.toLowerCase() !== 'content-security-policy')
    .map(h => `${h.name.toLowerCase()}: ${h.value || ''}`);

  // Track detected technologies by key to avoid duplicates
  const detectedTechKeys = new Set();

  const headerComponents = [];
  // Iterate through all configured technologies that have compiled header patterns
  Object.entries(techConfig).forEach(([key, config]) => {
    const { name, compiledHeaderPatterns = [] } = config;
    const matchedTexts = new Set();

    // Skip if already detected for this URL
    if (detectedTechKeys.has(key)) return;

    // Check compiled header patterns against each header line
    for (const { pattern, regex } of compiledHeaderPatterns) {
      // Test pattern against all header lines and collect matches
      headerStrings.filter(headerLine => regex.test(headerLine)).forEach(line => {
        matchedTexts.add(line);
      });
    }

    // If we found any matches, add the technology with all matched headers
    if (matchedTexts.size > 0) {
      const detectedTech = {
        key,
        name,
        description: config.description || '',
        link: config.link || '',
        tags: config.tags || [],
        developer: config.developer || '',
        matchedTexts: [...matchedTexts]
      };
      devLog(`HTTP detection ${name}: "${key}" matched texts: [${detectedTech.matchedTexts.join(', ')}]`);

      headerComponents.push(detectedTech);
      detectedTechKeys.add(key);
      devLog(`Background: Detected ${name} via header patterns for ${url} (matched: ${detectedTech.matchedTexts.join(', ')})`);
    }
  });
  return headerComponents;
}

// Detect httpComponents from headers from fetch() in the content script. Pass them along to the side panel.
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  devLog('Background: chrome.runtime.onMessage received', { message, sender });
  if (message.action === 'fetchedHeaders') {
    const { tabId, tabUrl } = message;
    const headerComponents = await detectTechnologiesFromHeaders(tabId, message.headers, tabUrl);
    // Send results if the sidepanel is still open.
    if (readyPanels.has(tabId)) {
      chrome.runtime.sendMessage({ tabId, targetUrl: tabUrl, action: 'headerResults', headerComponents });
    }
  }
});

// It seems the temporary host permission granted by 'activeTab' can be used only in two ways:
// 1. chrome.action.onClicked handler.
// 2. scripts in the popup opened automatically with action click. 
// Sidepanel can be opened automatically with action click too if we use openPanelOnActionClick: true.
// However, it doesn't seem to get the activeTab permission. So we open the sidepanel programmatically 
// in the onClicked handler. We set openPanelOnActionClick to false and don't use "side_panel" in the 
// manifest to disable automatic sidepanel opening.
try {
  chrome.action.onClicked.addListener((tab) => {
    devLog('onClicked: listener begin', tab);

    if (readyPanels.has(tab.id)) {
      readyPanels.delete(tab.id);
      // There is no method like sidePanel.close(), so we disable the sidepanel for the tab.
      chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
      return;
    }

    // Registering webRequest.onCompleted listener works within the onClick listener.
    // Adding a listener within a listener is discouraged with Manifest v3 but this is the only way.
    try {
      // onHeadersReceived triggers earlier but it doesn't seem to have details.ip.
      chrome.webRequest.onCompleted.addListener((details) => {
        devLog('onClicked: webRequest.onCompleted', details);

        // IP address detection runs regardless of HTTP response code.
        if (details.ip) {
          detectTechnologiesFromIP(details.url, details.ip).then((ipComponents) => {
            devLog('onClicked: IP detection results:', ipComponents);
            // Send results if the sidepanel is still open.
            if (readyPanels.has(details.tabId)) {
              chrome.runtime.sendMessage({ action: 'ipResults', tabId: details.tabId, targetUrl: details.url, ipComponents });
            }
          }).catch((error) => {
            logWarn('onClicked: IP detection failed:', error);
          });
        }
        if (details.responseHeaders) {
          detectTechnologiesFromHeaders(details.tabId, details.responseHeaders, details.url).then((headerComponents) => {
            devLog('onClicked: Header detection results:', headerComponents);
            // Send results if the sidepanel is still open.
            if (readyPanels.has(details.tabId)) {
              chrome.runtime.sendMessage({ tabId: details.tabId, targetUrl: details.url, action: 'headerResults', headerComponents });
            }
          });
        }
      },
        {
          urls: ['https://*/*', 'http://*/*'],
          // Documentation suggests only main_frame works with activeTab but
          // other types like 'xmlhttprequest' actually work on the same origin.
          // 'xmlhttprequest' is essential to capture fetch() calls from the content script.
          types: ['main_frame', 'sub_frame', 'xmlhttprequest'], tabId: tab.id
        },
        // This option is needed for responseHeaders analysis above.
        ['responseHeaders']);
      if (chrome.runtime.lastError) {
        logError('onClicked: webRequest.onCompleted failed to add listener', chrome.runtime.lastError);
      } else {
        devLog('onClicked: webRequest.onCompleted listener registered for IP detection');
      }
    } catch (e) {
      logError('onClicked: webRequest.onCompleted not available or blocked', e);
    }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).then(() => {
      devLog('onClicked: injected content.js into tab on action click', tab);
    }).catch((err) => {
      logWarn('onClicked: failed to inject content.js into tab on action click', err);
    });
    // Open sidepanel creating tab-specific sidepanel instance.
    // Known issue: action click sometimes doesn't open sidebar if the current page is still loading.
    chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true }).catch((err) => {
      logWarn('onClicked: sidePanel.setOptions failed before opening sidepanel', err);
    });
    chrome.sidePanel.open({ tabId: tab.id }).then(() => {
      readyPanels.add(tab.id);
      devLog('onClicked: sidePanel opened for tab', tab.id);
    }).catch((err) => {
      logWarn('onClicked: sidePanel failed to open', err);
    });
  }
  );  // onClicked
} catch (e) {
  logError('Background: chrome.action.onClicked.addListener() failed', e);
}

// Specify sidepanel behavior programmatically instead of in manifest.json.
try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: false });
} catch (e) {
  logError('Background: sidePanel API not available', e);
}
