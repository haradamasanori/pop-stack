
// Keep a per-tab store of detected technologies
// entry shape: { url: string|null, technologies: [], headerTechs: Map }
const tabDetections = new Map(); // tabId -> entry
// Track which tabs currently have a listening side panel instance
const readyPanels = new Set();
// Cache for configuration
let techConfig = null;

// Load configuration
async function loadConfig() {
  if (techConfig) return techConfig;
  try {
    const configUrl = chrome.runtime.getURL('config.json');
    const response = await fetch(configUrl);
    techConfig = await response.json();
    console.log('Background: Configuration loaded:', Object.keys(techConfig).length, 'technologies');
    return techConfig;
  } catch (error) {
    console.error('Background: Failed to load config.json:', error);
    techConfig = {};
    return techConfig;
  }
}

async function detectTechnologiesFromHeaders(tabId, responseHeaders) {
  if (!tabId || !responseHeaders) return;
  
  // Ensure config is loaded
  if (!techConfig) {
    await loadConfig();
  }
  
  let entry = tabDetections.get(tabId);
  if (!entry) {
    entry = { headerTechs: new Map() };
    tabDetections.set(tabId, entry);
  }
  
  // Convert headers to individual header strings for pattern matching
  const headerStrings = responseHeaders.map(h => `${h.name.toLowerCase()}: ${h.value || ''}`);
  
  // Iterate through all configured technologies that have header patterns
  Object.entries(techConfig).forEach(([key, config]) => {
    const { name, headers: headerPatterns = [] } = config;
    
    // Check header patterns using regex against each header line
    for (const pattern of headerPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        // Test pattern against each header line
        const matchedHeader = headerStrings.find(headerLine => regex.test(headerLine));
        if (matchedHeader) {
          entry.headerTechs.set(key, {
            key,
            name,
            description: config.description || '',
            link: config.link || '',
            tags: config.tags || [],
            developer: config.developer || '',
            detectionMethod: 'HTTP Headers',
            pattern,
            matchedHeader // Include which header matched for debugging
          });
          console.log(`Background: Detected ${name} via header pattern: ${pattern} (matched: ${matchedHeader})`);
          break; // Only add once per technology
        }
      } catch (error) {
        console.warn(`Background: Invalid header regex pattern for ${name}:`, pattern, error);
      }
    }
  });
  
  // Notify side panel if it's open for this tab so UI updates immediately
  const headerTechs = Array.from(entry.headerTechs.values());
  
  // Only send to the panel if it is ready for this tab
  if (readyPanels.has(tabId)) {
    chrome.runtime.sendMessage({ action: 'updateHeaderTechs', tabId, headerTechs }, (res) => { });
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
      if (!readyPanels.has(tabId)) return;

      // Only accept main frame requests - use frameId as primary check since type can be unreliable
      // frameId 0 is always the main frame, regardless of type field
      if (details.frameId !== 0) return;

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
    await detectTechnologiesFromHeaders(tabId, details.responseHeaders);
  }
}
  console.log('webRequest.onHeadersReceived listener registered');
} catch (e) {
  console.warn('webRequest.onHeadersReceived not available or blocked', e);
}

// Allow clicking the action to open the side panel for the current tab
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  // Non-fatal: older Chrome may not support this
  console.warn('setPanelBehavior failed', err);
});

chrome.action.onClicked.addListener((tab) => {
  // Don't disable previous tab-specific panels here; allow per-tab panels to
  // remain enabled so they reappear when the user switches back.

  // Start enabling the side panel for this tab (async). We intentionally do
  // not await this so that the following open() call executes inside the
  // user gesture.
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true })
    .catch((e) => console.warn('Failed to set side panel options for tab', tab.id, e));

  // Open the side panel immediately in the user gesture context. Do not
  // await this call, but handle the promise to log errors.
  chrome.sidePanel.open({ tabId: tab.id })
    .then(() => {
      // ensure an entry exists for this tab and store the visible URL
      let entry = tabDetections.get(tab.id);
      if (!entry) {
        entry = { url: tab.url || null, technologies: [], headerTechs: new Map() };
        tabDetections.set(tab.id, entry);
      } else {
        entry.url = tab.url || entry.url || null;
      }
      console.log('Side panel enabled and opened for tab', tab.id);
    })
    .catch((err) => {
      console.debug('Failed to open side panel for tab', tab.id, err);
    });
});

// When the user switches tabs, disable the panel for the previously-open tab so
// the side panel remains enabled only on the tab it was opened on.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Intentionally do not disable the previous tab's side panel here.
  // Leaving `panelOpenTabId` set lets Chrome automatically show the
  // tab-specific side panel again when the user switches back to that tab.
  const { tabId } = activeInfo;
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
  console.log('chrome.tabs.onUpdated.addListener called', { tabId, info, tab });
  const panelReady = readyPanels.has(tabId);
  // Clear stored detections when navigation starts so we don't show stale headers
  if (info.status === 'loading') {
    // On navigation start, clear cached content-script technologies so the
    // UI can be refreshed. Additionally, if this tab is enabled and the
    // navigation changes origin, clear previous header detections so new
    // server headers can populate.
    let entry = tabDetections.get(tabId);
    if (entry) {
      entry.technologies = [];
    }
    const newVisibleUrl = (tab && tab.url) ? tab.url : (info.url || null);
    if (panelReady && entry && entry.url && newVisibleUrl) {
      try {
        const prev = new URL(entry.url);
        const next = new URL(newVisibleUrl);
        if (prev.origin !== next.origin) {
          entry.headerTechs = new Map();
          const headerTechs = [];
          // Outer guard `panelReady` ensures readiness; send update directly
          chrome.runtime.sendMessage({ action: 'updateHeaderTechs', tabId, headerTechs }, (res) => { });
        }
      } catch (e) {
        console.debug('URL parse failed while comparing origins', e);
      }
    }

    try {
      chrome.runtime.sendMessage({ action: 'clearTechs', tabId }, (res) => {
        if (chrome.runtime.lastError) {
          // Expected if no listener (side panel not open). Log at debug level.
          console.debug('clearTechs message had no receiver', chrome.runtime.lastError);
        }
      });
    } catch (e) {
      // ignore
    }
  }

  // If the tab with the side panel navigates, update the cached visible URL
  if (tab && tab.url) {
    let entry = tabDetections.get(tabId);
    if (!entry) entry = { url: tab.url, technologies: [], headerTechs: new Map() };
    entry.url = tab.url;
    tabDetections.set(tabId, entry);
  }

  if (info.status === 'complete' && tab.url) {
    // If navigation completed, and this tab is enabled, clear header
    // detections if the origin changed compared to the stored entry.url.
    if (panelReady) {
      const entry = tabDetections.get(tabId);
      if (entry && entry.url) {
        try {
          const prev = new URL(entry.url);
          const next = new URL(tab.url);
          if (prev.origin !== next.origin) {
            entry.headerTechs = new Map();
            const headerTechs = [];
            if (panelReady) {
              chrome.runtime.sendMessage({ action: 'updateHeaderTechs', tabId, headerTechs }, () => { });
            }
          }
        } catch (e) {
          console.debug('URL parse failed while comparing origins on complete', e);
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
    // If this tab currently has the side panel open, keep it open after navigation
    if (panelReady) {
      chrome.sidePanel.open({ tabId });
      console.log('Side panel re-opened for tab after navigation', tabId);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('chrome.runtime.onMessage.addListener called', { message, sender });
  // Handle panel handshake messages first
  if (message.action === 'panelReady') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    if (tabId) {
      readyPanels.add(tabId);
      // send current state for this tab, if present
      const entry = tabDetections.get(tabId);
      const payload = entry ? { 
        technologies: entry.technologies || [], 
        headerTechs: Array.from(entry.headerTechs.values())
      } : { 
        technologies: [], 
        headerTechs: [] 
      };
      chrome.runtime.sendMessage({ action: 'updateTechList', technologies: payload.technologies }, () => { });
      chrome.runtime.sendMessage({ action: 'updateHeaderTechs', headerTechs: payload.headerTechs }, () => { });
    }
    return; // handled
  }
  if (message.action === 'panelClosed') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    if (tabId) readyPanels.delete(tabId);
    return;
  }
  if (message.action === 'requestAnalyze') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'analyze' }, () => { });
    }
    return;
  }
  // Store detections sent from content scripts so background can serve them
  // directly to the side panel without needing an immediate tabs.sendMessage.
  if (message.action === 'detectedTechs') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    if (tabId) {
      let entry = tabDetections.get(tabId);
      if (!entry) {
        entry = { technologies: [], headerTechs: new Map() };
        tabDetections.set(tabId, entry);
      }
      entry.technologies = Array.isArray(message.technologies) ? message.technologies : [];
      // Forward to side panel UI only if a panel instance is ready for this tab
      if (readyPanels.has(tabId)) {
        chrome.runtime.sendMessage({ action: 'updateTechList', technologies: entry.technologies }, () => { });
      }
    }
    return; // handled
  }
  if (message.action === 'getTabDetections') {
    // Return the stored tabDetections entry for the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        const entry = tabDetections.get(tabId);
        if (entry) {
          sendResponse({ entry: { technologies: entry.technologies || [], headerTechs: Array.from(entry.headerTechs.values()) } });
        } else {
          sendResponse({ entry: null });
        }
      } else {
        sendResponse({ error: 'No active tab found.' });
      }
    });
    return true;
  }
  if (message.action === 'getDetectedTechs') {
    // Merge content-script detections with header detections for the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(
          tabId,
          { action: 'getDetectedTechs' },
          (response) => {
            console.log('chrome.tabs.sendMessage callback called', { tabId, response });
            const entry = tabDetections.get(tabId) || { technologies: [], headerTechs: new Map() };
            const merged = {
              ...(response || {}),
              technologies: (response && response.technologies) ? response.technologies : entry.technologies || [],
              headerTechs: Array.from(entry.headerTechs.values())
            };
            if (chrome.runtime.lastError) {
              // Content script may not be available on all pages; this is expected
              // in some cases (e.g. chrome:// pages, or before injection). Log at
              // debug level to avoid noisy errors in the Extensions page.
              console.debug('tabs.sendMessage failed (content script may be missing)', chrome.runtime.lastError);
              // still send header info even if content script failed
              sendResponse({ headerTechs: merged.headerTechs, error: chrome.runtime.lastError.message || chrome.runtime.lastError });
            } else {
              sendResponse(merged);
            }
          }
        );
      } else {
        sendResponse({ error: 'No active tab found.' });
      }
    });
    return true; // Indicates that the response is sent asynchronously
  }
});
