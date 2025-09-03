
// Keep a per-tab store of detected technologies
// entry shape: { url: string|null, technologies: [], headerTechs: Map, analyzedUrls: Set }
const tabDetections = new Map(); // tabId -> entry
// Track which tabs currently have a listening side panel instance
const readyPanels = new Set();
// Cache for configuration
let techConfig = null;

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
  if (techConfig) return techConfig;
  try {
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
    entry = { headerTechs: new Map(), analyzedUrls: new Set() };
    tabDetections.set(tabId, entry);
  }
  
  // Convert headers to individual header strings for pattern matching
  const headerStrings = responseHeaders.map(h => `${h.name.toLowerCase()}: ${h.value || ''}`);
  
  // Iterate through all configured technologies that have compiled header patterns
  Object.entries(techConfig).forEach(([key, config]) => {
    const { name, compiledHeaderPatterns = [] } = config;
    const matchedTexts = [];
    
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
      entry.headerTechs.set(key, {
        key,
        name,
        description: config.description || '',
        link: config.link || '',
        tags: config.tags || [],
        developer: config.developer || '',
        detectionMethod: 'HTTP Headers',
        matchedTexts: [...new Set(matchedTexts)] // Remove duplicates
      });
      console.log(`Background: Detected ${name} via header patterns (matched: ${matchedTexts.join(', ')})`);
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
    
    // Check if this is an HTML response by looking at Content-Type header
    const contentTypeHeader = details.responseHeaders.find(h => 
      h.name.toLowerCase() === 'content-type'
    );
    const isHtmlContent = contentTypeHeader && 
      contentTypeHeader.value && 
      contentTypeHeader.value.toLowerCase().includes('text/html');
    
    // Only track URLs for HTML content that we actually analyze
    if (isHtmlContent) {
      let entry = tabDetections.get(tabId);
      if (!entry) {
        entry = { headerTechs: new Map(), analyzedUrls: new Set() };
        tabDetections.set(tabId, entry);
      }
      entry.analyzedUrls.add(details.url);
      
      // Notify sidepanel about new analyzed URL if panel is ready
      if (readyPanels.has(tabId)) {
        chrome.runtime.sendMessage({ 
          action: 'updateAnalyzedUrls', 
          tabId, 
          analyzedUrls: Array.from(entry.analyzedUrls) 
        }, (res) => { });
      }
    }
    
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
  console.log('chrome.tabs.onUpdated.addListener called', { tabId, info, tab });
  
  // Update the action button state whenever the tab is updated.
  updateActionAndSidePanel(tabId);

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
      // Always clear analyzed URLs on navigation start, not just origin changes
      entry.analyzedUrls = new Set();
    }
    const newVisibleUrl = (tab && tab.url) ? tab.url : (info.url || null);
    if (panelReady && entry && entry.url && newVisibleUrl) {
      try {
        const prev = new URL(entry.url);
        const next = new URL(newVisibleUrl);
        if (prev.origin !== next.origin) {
          entry.headerTechs = new Map();
          entry.analyzedUrls = new Set();
          const headerTechs = [];
          // Outer guard `panelReady` ensures readiness; send update directly
          chrome.runtime.sendMessage({ action: 'updateHeaderTechs', tabId, headerTechs }, (res) => { });
          chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls: [] }, (res) => { });
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
    if (!entry) entry = { url: tab.url, technologies: [], headerTechs: new Map(), analyzedUrls: new Set() };
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
            entry.analyzedUrls = new Set();
            const headerTechs = [];
            if (panelReady) {
              chrome.runtime.sendMessage({ action: 'updateHeaderTechs', tabId, headerTechs }, () => { });
              chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls: [] }, () => { });
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
        headerTechs: Array.from(entry.headerTechs.values()),
        analyzedUrls: Array.from(entry.analyzedUrls || new Set())
      } : { 
        technologies: [], 
        headerTechs: [],
        analyzedUrls: []
      };
      chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: payload.technologies }, () => { });
      chrome.runtime.sendMessage({ action: 'updateHeaderTechs', tabId, headerTechs: payload.headerTechs }, () => { });
      chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls: payload.analyzedUrls }, () => { });
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
        entry = { technologies: [], headerTechs: new Map(), analyzedUrls: new Set() };
        tabDetections.set(tabId, entry);
      }
      entry.technologies = Array.isArray(message.technologies) ? message.technologies : [];
      
      // Add current tab URL to analyzed URLs when content script detections are received
      if (sender && sender.tab && sender.tab.url && entry.technologies.length > 0) {
        entry.analyzedUrls.add(sender.tab.url);
        // Notify sidepanel about the analyzed URL if panel is ready
        if (readyPanels.has(tabId)) {
          chrome.runtime.sendMessage({ 
            action: 'updateAnalyzedUrls', 
            tabId, 
            analyzedUrls: Array.from(entry.analyzedUrls) 
          }, (res) => { });
        }
      }
      
      // Forward to side panel UI only if a panel instance is ready for this tab
      if (readyPanels.has(tabId)) {
        chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: entry.technologies }, () => { });
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
          sendResponse({ entry: { 
            technologies: entry.technologies || [], 
            headerTechs: Array.from(entry.headerTechs.values()),
            analyzedUrls: Array.from(entry.analyzedUrls || new Set())
          } });
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
            const entry = tabDetections.get(tabId) || { technologies: [], headerTechs: new Map(), analyzedUrls: new Set() };
            const merged = {
              ...(response || {}),
              technologies: (response && response.technologies) ? response.technologies : entry.technologies || [],
              headerTechs: Array.from(entry.headerTechs.values()),
              analyzedUrls: Array.from(entry.analyzedUrls || new Set())
            };
            if (chrome.runtime.lastError) {
              // Content script may not be available on all pages; this is expected
              // in some cases (e.g. chrome:// pages, or before injection). Log at
              // debug level to avoid noisy errors in the Extensions page.
              console.debug('tabs.sendMessage failed (content script may be missing)', chrome.runtime.lastError);
              // still send header info even if content script failed
              sendResponse({ 
                headerTechs: merged.headerTechs, 
                analyzedUrls: merged.analyzedUrls,
                error: chrome.runtime.lastError.message || chrome.runtime.lastError 
              });
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
