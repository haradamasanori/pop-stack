
// Track which tab has the side panel open
let panelOpenTabId = null;
let panelOpenTabUrl = null;

// Keep a per-tab store of detected headers / server info
const tabDetections = new Map(); // tabId -> { servers: Set, poweredBy: Set }

function recordHeaderDetection(tabId, headerName, headerValue) {
  if (!tabId) return;
  let entry = tabDetections.get(tabId);
  if (!entry) {
    entry = { servers: new Set(), poweredBy: new Set() };
    tabDetections.set(tabId, entry);
  }
  const name = headerName.toLowerCase();
  if (name === 'server' && headerValue) {
    entry.servers.add(headerValue);
  }
  if ((name === 'x-powered-by' || name === 'x-generator') && headerValue) {
    entry.poweredBy.add(headerValue);
  }
  // Notify side panel if it's open for this tab so UI updates immediately
  const httpHeaders = {
    servers: Array.from(entry.servers),
    poweredBy: Array.from(entry.poweredBy)
  };
  chrome.runtime.sendMessage({ action: 'updateHttpHeaders', tabId, httpHeaders }, (res) => {
    if (chrome.runtime.lastError) {
      // Expected if no listener exists in the side panel; log at debug level.
      console.debug('runtime.sendMessage to side panel failed (no listener?)', chrome.runtime.lastError);
    }
  });
}

// webRequest listener to inspect response headers
try {
  console.log('Attempting to register webRequest.onHeadersReceived listener', { webRequestAvailable: !!(chrome.webRequest && chrome.webRequest.onHeadersReceived) });
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      // details.tabId may be -1 for non-tab resources; ignore those
      const tabId = details.tabId;
      // Only inspect responses for the tab that has the side panel open
      if (typeof tabId !== 'number' || tabId < 0) return;
      if (panelOpenTabId === null || tabId !== panelOpenTabId) return;

      // Accept responses that are the main document. Some Chrome builds may not
      // set details.type reliably; treat frameId===0 as main frame too.
      if (details.type && details.type !== 'main_frame' && details.frameId !== 0) return;

      // Match the visible address bar URL. Use origin match (preferred) or exact
      // href as a fallback to tolerate redirects that remain on the same origin.
      if (panelOpenTabUrl) {
        try {
          const resUrl = new URL(details.url);
          const visibleUrl = new URL(panelOpenTabUrl);
          if (resUrl.href !== visibleUrl.href && resUrl.origin !== visibleUrl.origin) return;
        } catch (e) {
          // If URL parsing fails, fall back to strict equality
          if (details.url !== panelOpenTabUrl) return;
        }
      }
      if (details.responseHeaders) {
        console.log('webRequest.onHeadersReceived', { tabId, url: details.url, responseHeaders: details.responseHeaders });
        for (const h of details.responseHeaders) {
          if (!h || !h.name) continue;
          const name = h.name.toLowerCase();
          const value = h.value || '';
          if (name === 'server' || name === 'x-powered-by' || name === 'x-generator') {
            recordHeaderDetection(tabId, name, value);
          }
        }
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders', 'extraHeaders']  // include extraHeaders to capture more headers
  );
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
      panelOpenTabId = tab.id;
      panelOpenTabUrl = tab.url || null;
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
  console.log('Tab activated', tabId, 'current panelOpenTabId', panelOpenTabId);
});

// When a tab is closed, ensure any tab-specific panel options are cleaned up.
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (panelOpenTabId === tabId) {
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      console.log('Disabled side panel for removed tab', tabId);
    } catch (e) {
      console.warn('Failed to disable side panel for removed tab', tabId, e);
    }
    panelOpenTabId = null;
  
  if (panelOpenTabUrl && panelOpenTabUrl.tabId === tabId) {
    panelOpenTabUrl = null;
  } else if (panelOpenTabId === null) {
    panelOpenTabUrl = null;
  }
  }
  // clean up any stored header detections for the removed tab
  if (tabDetections.has(tabId)) {
    tabDetections.delete(tabId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  console.log('chrome.tabs.onUpdated.addListener called', { tabId, info, tab });
  // Clear stored detections when navigation starts so we don't show stale headers
  if (info.status === 'loading') {
    // Don't delete header detections on navigation start; clear cached
    // content-script technologies only so the UI can be refreshed while
    // preserving server/poweredBy values until new ones arrive.
    const entry = tabDetections.get(tabId);
    if (entry) {
      entry.technologies = [];
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
  if (panelOpenTabId === tabId && tab && tab.url) {
    panelOpenTabUrl = tab.url;
  }

  if (info.status === 'complete' && tab.url) {
    chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
      if (chrome.runtime.lastError) {
        // ...existing code...
      }
    });
    // If the panel was open for this tab before navigation, keep it open
    if (panelOpenTabId === tabId) {
      chrome.sidePanel.open({ tabId });
      console.log('Side panel re-opened for tab after navigation', tabId);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('chrome.runtime.onMessage.addListener called', { message, sender });
  // Store detections sent from content scripts so background can serve them
  // directly to the side panel without needing an immediate tabs.sendMessage.
  if (message.action === 'detectedTechs') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    if (tabId) {
      let entry = tabDetections.get(tabId);
      if (!entry) {
        entry = { servers: new Set(), poweredBy: new Set(), technologies: [] };
        tabDetections.set(tabId, entry);
      }
      entry.technologies = Array.isArray(message.technologies) ? message.technologies : [];
      // Forward to side panel UI (if present)
      chrome.runtime.sendMessage({ action: 'updateTechList', technologies: entry.technologies }, (res) => {
        if (chrome.runtime.lastError) {
          console.debug('updateTechList message had no receiver', chrome.runtime.lastError);
        }
      });
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
          sendResponse({ entry: { servers: Array.from(entry.servers), poweredBy: Array.from(entry.poweredBy), technologies: entry.technologies || [] } });
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
            const entry = tabDetections.get(tabId) || { servers: new Set(), poweredBy: new Set(), technologies: [] };
            const merged = {
              ...(response || {}),
              technologies: (response && response.technologies) ? response.technologies : entry.technologies || [],
              httpHeaders: {
                servers: Array.from(entry.servers),
                poweredBy: Array.from(entry.poweredBy)
              }
            };
            if (chrome.runtime.lastError) {
              // Content script may not be available on all pages; this is expected
              // in some cases (e.g. chrome:// pages, or before injection). Log at
              // debug level to avoid noisy errors in the Extensions page.
              console.debug('tabs.sendMessage failed (content script may be missing)', chrome.runtime.lastError);
              // still send header info even if content script failed
              sendResponse({ httpHeaders: merged.httpHeaders, error: chrome.runtime.lastError.message || chrome.runtime.lastError });
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
