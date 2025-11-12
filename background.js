const readyPanels = new Set();

// Cache for configuration
let techConfig = null;
let ipRangeConfigs = null;

// Helper function to skip non-HTML resources.
function shouldAnalyzeUrl(url) {
  const nonHtmlExtensionRegex = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp[34]|wav|woff2?|[te]ot)$/i;

  if (nonHtmlExtensionRegex.test(url)) {
    console.log('Skipping analysis for non-HTML resource:', url);
    return false;
  }

  return true;
}

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
            console.warn(`Background: Invalid header regex pattern for ${config.name}:`, pattern, error);
            return null;
          }
        }).filter(Boolean) // Remove null entries from invalid patterns
      };
    });
    techConfig = tmpTechConfig;
    console.log('Background: Configuration loaded:', Object.keys(tmpTechConfig).length, 'technologies');
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

        console.log(`Background: IP ranges loaded for ${provider}:`, ranges.length, 'ranges');
      } catch (error) {
        console.warn(`Background: Failed to load IP ranges for ${provider}:`, error);
        tmpIpRangeConfigs[provider] = { normalizedRanges: [] };
      }
    }
    ipRangeConfigs = tmpIpRangeConfigs;
    console.log('Background: IP range configs loaded for', Object.keys(tmpIpRangeConfigs).length, 'providers');
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
    console.warn('Error checking IP range:', ip, 'in', cidr, error);
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
  console.log(`🌍 Starting IP-based detection for url: ${url}, host: ${hostname}, IP: ${ipAddress}`);
  if (!ipAddress) {
    console.log('⏭️ No IP address provided for url:', url);
    return;
  }
  const ipComponents = [];

  // Check IP against all provider ranges
  for (const [provider, config] of Object.entries(ipRangeConfigs)) {
    let isDetected = false;
    const ranges = config.normalizedRanges || [];

    for (const range of ranges) {
      if (isIpInCidr(ipAddress, range)) {
        isDetected = true;
        console.log(`✓ IP ${ipAddress} matches ${provider} range: ${range}`);
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

      console.log(`🎯 Detected ${config.name} via IP address ${ipAddress} for ${hostname}`);
    }
  }
  return ipComponents;
  // const detectionsByUrl = serializeDetectionsByUrl(entry.detectionsByUrl);
  // console.log('📨 Sending IP detection results to ready panel', detectionsByUrl);
  // chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl, targetUrl: url }, (res) => { });
}


// // Helper function to convert detectionsByUrl Map to plain object for messaging
// function serializeDetectionsByUrl(detectionsByUrlMap) {
//   return Object.fromEntries(
//     Array.from(detectionsByUrlMap.entries()).map(([url, detection]) => {
//       const result = {};
//       if (detection.headerComponents) result.headerComponents = detection.headerComponents;
//       if (detection.htmlComponents) result.htmlComponents = detection.htmlComponents;
//       if (detection.ipComponents) result.ipComponents = detection.ipComponents;
//       return [url, result];
//     })
//   );
// }

// Helper function to get all technologies and analyzed URLs for a tab
// TODO: not checking if this matches with the current url.
async function detectTechnologiesFromHeaders(tabId, responseHeaders, url) {
  // Ensure config is loaded
  if (!techConfig) {
    await loadConfig();
  }

  // Convert headers to individual header strings for pattern matching
  const headerStrings = responseHeaders.map(h => `${h.name.toLowerCase()}: ${h.value || ''}`);

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

      console.log(`🔑 HTTP detection key for ${name}: "${key}"`);
      console.log(`📄 HTTP detection matched texts: [${detectedTech.matchedTexts.join(', ')}]`);

      headerComponents.push(detectedTech);
      detectedTechKeys.add(key);
      console.log(`Background: Detected ${name} via header patterns for ${url} (matched: ${detectedTech.matchedTexts.join(', ')})`);
    }
  });

  // console.log('📨 Sending header detection results to ready panel', detectionsByUrl);
  // chrome.runtime.sendMessage({ action: 'updateDetectionsByUrl', tabId, detectionsByUrl, targetUrl: url }, (res) => { });
  return headerComponents;
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('Tab activated', activeInfo);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log('Tab removed', removeInfo);
});

/*
// Use onBeforeNavigate to capture the new URL as early as possible.
// To my surprise, this appears to work with activeTab permission. However, it mostly captures
// sub_frame navigations rather than main_frame navigations and ip address is missing.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  console.log('webNavigation.onBeforeNavigate', details);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  console.log('chrome.tabs.onUpdated ', { tabId, info, tab });

  // TODO: Start 'analyzeHtml' when status is 'loading'.

  // When the page has finished loading, send the final detections and
  // trigger the content script to analyze the DOM.
  if (info.status === 'complete') {
    // Request content analysis from the content script.
    chrome.tabs.sendMessage(tabId, { action: 'analyzeHtml'.tabId, tabUrl: tab.url }, (response) => {
      if (chrome.runtime.lastError) {
        console.debug('Could not send "analyze" message to content script:', chrome.runtime.lastError.message);
      } else {
        console.log('Sent "analyzeHtml" message to content script', { tabId, response });
      }
    });
  }
});
*/

// Detect httpComponents from headers from fetch() in the content script. Pass them along to the side panel.
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log('Background: chrome.runtime.onMessage received', { message, sender });
  if (message.action === 'fetchedHeaders') {
    const { tabId, tabUrl } = message;
    const headerComponents = await detectTechnologiesFromHeaders(tabId, message.headers, tabUrl);
    chrome.runtime.sendMessage({ tabId, targetUrl: tabUrl, action: 'headerResults', headerComponents });
  }
});


/*
// Establish port connection from popup.html. Inject content script and start HTML analysis.
chrome.runtime.onConnect.addListener((port) => {
  // Check if the connection is coming from your side panel
  if (!port.name?.startsWith('popup-')) {
    return;
  }
  const tabId = port.name.split('-')[1] ? parseInt(port.name.split('-')[1], 10) : null;
  console.log('Popup port connected', { tabId, port });

  // Add a listener for when the port is disconnected
  port.onDisconnect.addListener(() => {
    console.log(`Popup port disconnected ${tabId}.`);
  });

  port.onMessage.addListener(async (message) => {
    console.log('Message received from popup port', { message });
    // Handle messages from the side panel if needed
    if (message.action === 'analyzeHttp') {
      const { tabId, url } = message;

      // webRequest.onCompleted listener for IP-based detection.
      // TODO: Try registering onCompleted listener when port is connected.
      try {
        console.log('Background: Attempting to register webRequest.onCompleted listener for IP detection');
        chrome.webRequest.onCompleted.addListener(async (details) => {
          console.log('Background: webRequest.onCompleted', { details });
          if (details.ip) {
            const ipComponents = await detectTechnologiesFromIP(url, details.ip);
            chrome.runtime.sendMessage({ action: 'ipResults', tabId, targetUrl: details.url, ipComponents: ipComponents });
            console.log('Background: IP detection results:', ipComponents);
          }
          // TODO: Add IP detection here if it works.
        },
          { urls: ['<all_urls>'], tabId: tabId, types: ['main_frame'] }
        );
        console.log('Background: webRequest.onCompleted listener registered for IP detection');
      } catch (e) {
        console.warn('Background: webRequest.onCompleted not available or blocked', e);
      }

      const response = await fetch(url, { method: 'GET' });
      console.log('Fetched! ', { tabId, url, response });
      const headers = [];
      for (const [key, value] of response.headers) {
        headers.push({ name: key, value });
      }
      const headerComponents = await detectTechnologiesFromHeaders(tabId, headers, url);
      chrome.runtime.sendMessage({ action: 'httpResults', tabId, targetUrl: url, headerComponents: headerComponents });
    }
    // port.onMessage handler doesn't need to return a response.
  });
});
*/

// It seems the temporary host permission granted by 'activeTab' can be used only in two ways:
// 1. chrome.action.onClicked handler.
// 2. scripts on the popup opened automatically with action click. 
// Sidepanel can be opened automatically with action click. However, it doesn't seem to get
// the activeTab permission. So we open the sidepanel programmatically in the onClicked handler,
// We set openPanelOnActionClick to false and don't use "side_panel" in the manifest to disable
// automatic sidepanel opening.
console.log('Background: Adding chrome.action.onClicked handler');
try {
  chrome.action.onClicked.addListener((tab) => {
    console.log('onClicked: Executing content script on action click', { tab });

    if (readyPanels.has(tab.id)) {
      chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
      readyPanels.delete(tab.id);
      return;
    }

    // Registering webRequest.onCompleted listener works within the onClick listener.
    // Adding a listener within a listener is discouraged with Manifest v3 but this is the only way.
    try {
      console.log('onClicked: Attempting to register webRequest.onCompleted listener for IP detection');
      chrome.webRequest.onCompleted.addListener((details) => {
        console.log('onClicked: webRequest.onCompleted', details);

        // IP address detection runs regardless of HTTP response code.
        if (details.ip) {
          detectTechnologiesFromIP(details.url, details.ip).then((ipComponents) => {
            console.log('onClicked: IP detection results:', ipComponents);
            chrome.runtime.sendMessage({ action: 'ipResults', tabId: details.tabId, targetUrl: details.url, ipComponents });
          }).catch((error) => {
            console.warn('onClicked: IP detection failed:', error);
          });
        }
        if (details.responseHeaders) {
          detectTechnologiesFromHeaders(details.tabId, details.responseHeaders, details.url).then((headerComponents) => {
            console.log('onClicked: Header detection results:', headerComponents);
            chrome.runtime.sendMessage({ tabId: details.tabId, targetUrl: details.url, action: 'headerResults', headerComponents });
          });
        }
      },
        // Documentation suggests only main_frame works.
        // Other types like 'xmlhttprequest' seem to work actually on the same origin.
        { urls: ['https://*/*', 'http://*/*'], types: ['main_frame', 'sub_frame', 'xmlhttprequest'], tabId: tab.id },
        ['responseHeaders']);
      console.log('onClicked: webRequest.onCompleted listener registered for IP detection');
    } catch (e) {
      console.warn('onClicked: webRequest.onCompleted not available or blocked', e);
    }

    // Open sidepanel creating tab-specific sidepanel instance.
    chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html', enabled: true });
    chrome.sidePanel.open({ tabId: tab.id }).then(() => {
      readyPanels.add(tab.id);
      console.log('onClicked: sidePanel opened for tab', tab.id);
    });
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).then(() => {
      console.log('onClicked: injected content.js into tab on action click', tab);
      chrome.action.setBadgeText({ text: 'SCR', tabId: tab.id });
      //chrome.sidePanel.setOptions({tabId: tab.id, path: 'popup.html'});erComponents: headerComponents });
      // Injecting script twice doesn't seem to fail for executeScript().
      // chrome.tabs.sendMessage(tab.id, { action: 'fetchAndAnalyzeHtml', tabId: tab.id, tabUrl: tab.url });
    }).catch((err) => {
      console.warn('onClicked: failed to inject content.js into tab on action click', err);
      chrome.action.setBadgeText({ text: 'ERR0: ', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId: tab.id });
    });

    // TODO: Move it to content script.
    // console.log('onClicked: fetching ', tab.url);
    // try {
    //   fetch(tab.url, { method: 'GET' }).then((response) => {
    //     console.log('onClicked: fetched! ', response);
    //     const headers = [];
    //     for (const [key, value] of response.headers) {
    //       headers.push({ name: key, value });
    //     }
    //     detectTechnologiesFromHeaders(tab.id, headers, tab.url).then((headerComponents) => {
    //       chrome.runtime.sendMessage({ action: 'httpResults', tabId: tab.isDetected, targetUrl: tab.url, headerComponents: headerComponents });
    //     });
    // }).catch((err) => {
    //     console.warn('onClicked: failed to fetch', err);
    //   });
    // } catch (e) {
    //   console.warn('onClicked: failed to start fetching', e);
    // };
    //const headerComponents = await detectTechnologiesFromHeaders(tabId, headers, url);
    //chrome.runtime.sendMessage({ action: 'httpResults', tabId, targetUrl: url, head
  }
  );  // onClicked
} catch (e) {
  console.warn('Background: chrome.action.onClicked.addListener() failed', e);
}

// Opening sidePanel with openPanelOnActionClick doesn't seem to grant activeTab permission.
// try {
//   chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
// } catch (e) {
//   console.warn('Background: sidePanel API not available', e);
// }

// Specify sidepanel behavior programmatically instead of in manifest.json.
try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  chrome.sidePanel.setOptions({ path: 'popup.html', enabled: false });
} catch (e) {
  console.warn('Background: sidePanel API not available', e);
}


// try {
//   console.log('worker: Attempting to register webRequest.onCompleted listener for IP detection');
//   chrome.webRequest.onCompleted.addListener((details) => {
//     console.log('worker: webRequest.onCompleted', { details });

//     // IP address detection runs regardless of HTTP response code.
//     if (details.ip) {
//       try {
//         const requestUrl = new URL(details.url);
//         if (requestUrl.hostname) {
//           console.log('worker: Triggering IP detection for', requestUrl.hostname, 'at', details.ip);
//         }
//       } catch (error) {
//         console.warn('worker: IP detection failed:', error);
//       }
//     }
//   }, { urls: ['<all_urls>'] });
//   console.log('worker: webRequest.onCompleted listener registered for IP detection');
// } catch (e) {
//   console.warn('worker: webRequest.onCompleted not available or blocked', e);
// }
