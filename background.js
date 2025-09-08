
// Keep a per-tab store of detected technologies
// entry shape: { url: string|null, detectionsByUrl: Map<string, {headerComponents: [], htmlComponents: []}> }
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

// Helper function to get all technologies and analyzed URLs for a tab
function getAllTechnologiesForTab(tabId) {
  const entry = tabDetections.get(tabId);
  if (!entry || !entry.detectionsByUrl) {
    return { allTechs: [], analyzedUrls: [] };
  }
  
  const allTechs = [];
  const analyzedUrls = Array.from(entry.detectionsByUrl.keys());
  const seenTechKeys = new Set();
  
  // Combine all technologies from all URLs, avoiding duplicates
  for (const [url, detection] of entry.detectionsByUrl) {
    [...detection.headerComponents, ...detection.htmlComponents].forEach(tech => {
      if (!seenTechKeys.has(tech.key)) {
        allTechs.push(tech);
        seenTechKeys.add(tech.key);
      }
    });
  }
  
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
    entry = { detectionsByUrl: new Map() };
    tabDetections.set(tabId, entry);
  }
  
  // Get or create detection entry for this URL
  let urlDetection = entry.detectionsByUrl.get(url);
  if (!urlDetection) {
    urlDetection = { headerComponents: [], htmlComponents: [] };
    entry.detectionsByUrl.set(url, urlDetection);
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
    chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: allTechs }, (res) => { });
    chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls }, (res) => { });
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
      
      console.log('🌐 webRequest.onHeadersReceived', { 
        tabId, 
        url: details.url, 
        frameId: details.frameId,
        panelReady: readyPanels.has(tabId),
        readyPanels: Array.from(readyPanels)
      });

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
    
    // Only process HTML content for technology detection
    if (isHtmlContent) {
      await detectTechnologiesFromHeaders(tabId, details.responseHeaders, details.url);
    }
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
      // Clear HTML detections for all URLs on navigation start
      for (const [url, detection] of entry.detectionsByUrl) {
        detection.htmlComponents = [];
      }
      // Send updated tech list immediately after clearing HTML components
      // so header components remain visible during navigation
      if (panelReady) {
        const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
        console.log('🔧 Background sending updateTechList after clearing HTML components', { tabId, techCount: allTechs.length, urlCount: analyzedUrls.length });
        chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: allTechs }, (res) => { });
        chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls }, (res) => { });
        // Also update the target URL
        const newUrl = (tab && tab.url) ? tab.url : (info.url || null);
        if (newUrl) {
          console.log('🔗 Background sending updateTargetUrl', { tabId, newUrl });
          chrome.runtime.sendMessage({ action: 'updateTargetUrl', tabId, url: newUrl }, (res) => { });
        }
      }
    }
    const newVisibleUrl = (tab && tab.url) ? tab.url : (info.url || null);
    if (panelReady && entry && entry.url && newVisibleUrl) {
      try {
        const prev = new URL(entry.url);
        const next = new URL(newVisibleUrl);
        if (prev.origin !== next.origin) {
          // Clear all detections when origin changes
          entry.detectionsByUrl.clear();
          const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
          // Outer guard `panelReady` ensures readiness; send update directly
          chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: allTechs }, (res) => { });
          chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls }, (res) => { });
          chrome.runtime.sendMessage({ action: 'updateTargetUrl', tabId, url: newVisibleUrl }, (res) => { });
        }
      } catch (e) {
        console.debug('URL parse failed while comparing origins', e);
      }
    }

    // Only send clearTechs if panel is NOT ready - if panel is ready, we already sent updated tech list above
    if (!panelReady) {
      try {
        console.log('🧹 Background sending clearTechs message for navigation loading (panel not ready)', { tabId, url: (tab && tab.url) || info.url });
        chrome.runtime.sendMessage({ action: 'clearTechs', tabId }, (res) => {
          if (chrome.runtime.lastError) {
            // Expected if no listener (side panel not open). Log at debug level.
            console.debug('clearTechs message had no receiver', chrome.runtime.lastError);
          }
        });
      } catch (e) {
        // ignore
      }
    } else {
      console.log('🧹 Skipping clearTechs message - panel is ready and already received updated tech list');
    }
  }

  // If the tab with the side panel navigates, update the cached visible URL
  if (tab && tab.url) {
    let entry = tabDetections.get(tabId);
    if (!entry) {
      entry = { url: tab.url, detectionsByUrl: new Map() };
      tabDetections.set(tabId, entry);
    } else {
      entry.url = tab.url;
    }
  }

  if (info.status === 'complete' && tab.url) {
    // If navigation completed, and this tab is enabled, update the URL and handle origin changes
    if (panelReady) {
      // Always update the target URL on navigation complete
      console.log('🔗 Sending updateTargetUrl on navigation complete', { tabId, url: tab.url });
      chrome.runtime.sendMessage({ action: 'updateTargetUrl', tabId, url: tab.url }, () => { });
      
      const entry = tabDetections.get(tabId);
      if (entry && entry.url) {
        try {
          const prev = new URL(entry.url);
          const next = new URL(tab.url);
          if (prev.origin !== next.origin) {
            // Clear all detections for origin change on navigation completion
            entry.detectionsByUrl.clear();
            const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
            chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: allTechs }, () => { });
            chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls }, () => { });
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
      console.log('🎛️ Panel ready for tab', tabId);
      // send current state for this tab, if present
      const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
      console.log('📨 Sending stored detections to newly ready panel', { tabId, techCount: allTechs.length, urlCount: analyzedUrls.length });
      chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: allTechs }, () => { });
      chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls }, () => { });
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
        entry = { detectionsByUrl: new Map() };
        tabDetections.set(tabId, entry);
      }
      
      // Get or create detection entry for this URL
      let urlDetection = entry.detectionsByUrl.get(url);
      if (!urlDetection) {
        urlDetection = { headerComponents: [], htmlComponents: [] };
        entry.detectionsByUrl.set(url, urlDetection);
      }
      
      // Update HTML components for this URL
      const technologies = Array.isArray(message.technologies) ? message.technologies : [];
      urlDetection.htmlComponents = technologies;
      
      // Get combined results and notify sidepanel if panel is ready
      if (readyPanels.has(tabId)) {
        const { allTechs, analyzedUrls } = getAllTechnologiesForTab(tabId);
        console.log('🔧 Background sending updateTechList from detectedTechs message', { tabId, url, techCount: allTechs.length, htmlCount: technologies.length });
        chrome.runtime.sendMessage({ action: 'updateTechList', tabId, technologies: allTechs }, () => { });
        chrome.runtime.sendMessage({ action: 'updateAnalyzedUrls', tabId, analyzedUrls }, () => { });
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
            detectionsByUrl: Object.fromEntries(
              Array.from(entry.detectionsByUrl.entries()).map(([url, detection]) => [
                url, {
                  headerComponents: detection.headerComponents,
                  htmlComponents: detection.htmlComponents
                }
              ])
            )
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
