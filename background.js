
// Keep track of which tabs have the side panel enabled (user opened it)
const enabledTabs = new Set();

// Keep a per-tab store of detected headers / server info
// entry shape: { url: string|null, servers: Set, poweredBy: Set, technologies: [] }
const tabDetections = new Map(); // tabId -> entry
// Track which tabs currently have a listening panel script
const readyPanels = new Set();

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
  // Only send to the panel if it's listening for this tab
  if (readyPanels.has(tabId)) {
    chrome.runtime.sendMessage({ action: 'updateHttpHeaders', tabId, httpHeaders }, (res) => {});
  }
}

// webRequest listener to inspect response headers
try {
  console.log('Attempting to register webRequest.onHeadersReceived listener', { webRequestAvailable: !!(chrome.webRequest && chrome.webRequest.onHeadersReceived) });
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      // details.tabId may be -1 for non-tab resources; ignore those
      const tabId = details.tabId;
  // Only inspect responses for tabs where the side panel is enabled
  if (typeof tabId !== 'number' || tabId < 0) return;
  if (!enabledTabs.has(tabId)) return;

      // Accept responses that are the main document. Some Chrome builds may not
      // set details.type reliably; treat frameId===0 as main frame too.
      if (details.type && details.type !== 'main_frame' && details.frameId !== 0) return;

  // We accept main-frame responses for enabled tabs; per-tab URL tracking
  // is used elsewhere to decide when to clear header detections on origin
  // changes.
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
      // mark this tab as enabled so we analyze its network responses
      enabledTabs.add(tab.id);
      // ensure an entry exists for this tab and store the visible URL
      let entry = tabDetections.get(tab.id);
      if (!entry) {
        entry = { url: tab.url || null, servers: new Set(), poweredBy: new Set(), technologies: [] };
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
  console.log('Tab activated', tabId, 'panel enabled for tab?', enabledTabs.has(tabId));
});

// When a tab is closed, ensure any tab-specific panel options are cleaned up.
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // If the side panel was enabled for this tab, disable it and notify UI
  if (enabledTabs.has(tabId)) {
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      console.log('Disabled side panel for removed tab', tabId);
    } catch (e) {
      console.warn('Failed to disable side panel for removed tab', tabId, e);
    }
    enabledTabs.delete(tabId);
  }
  // clean up any stored header detections for the removed tab and notify
  if (tabDetections.has(tabId)) {
    tabDetections.delete(tabId);
    chrome.runtime.sendMessage({ action: 'removeTab', tabId }, () => {});
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  console.log('chrome.tabs.onUpdated.addListener called', { tabId, info, tab });
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
    if (enabledTabs.has(tabId) && entry && entry.url && newVisibleUrl) {
      try {
        const prev = new URL(entry.url);
        const next = new URL(newVisibleUrl);
        if (prev.origin !== next.origin) {
          entry.servers = new Set();
          entry.poweredBy = new Set();
          const httpHeaders = { servers: [], poweredBy: [] };
          chrome.runtime.sendMessage({ action: 'updateHttpHeaders', tabId, httpHeaders }, (res) => {
            if (chrome.runtime.lastError) {
              console.debug('updateHttpHeaders message had no receiver', chrome.runtime.lastError);
            }
          });
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
    if (!entry) entry = { url: tab.url, servers: new Set(), poweredBy: new Set(), technologies: [] };
    entry.url = tab.url;
    tabDetections.set(tabId, entry);
  }

  if (info.status === 'complete' && tab.url) {
    // If navigation completed, and this tab is enabled, clear header
    // detections if the origin changed compared to the stored entry.url.
    if (enabledTabs.has(tabId)) {
      const entry = tabDetections.get(tabId);
      if (entry && entry.url) {
        try {
          const prev = new URL(entry.url);
          const next = new URL(tab.url);
          if (prev.origin !== next.origin) {
            entry.servers = new Set();
            entry.poweredBy = new Set();
            const httpHeaders = { servers: [], poweredBy: [] };
            if (readyPanels.has(tabId)) {
              chrome.runtime.sendMessage({ action: 'updateHttpHeaders', tabId, httpHeaders }, () => {});
            }
          }
        } catch (e) {
          console.debug('URL parse failed while comparing origins on complete', e);
        }
      }
    }
    // Only request content analysis for tabs where the side panel is enabled
    if (enabledTabs.has(tabId)) {
      chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
        if (chrome.runtime.lastError) {
          // ...existing code...
        }
      });
    }
    // If this tab has the panel enabled, keep it open after navigation
    if (enabledTabs.has(tabId)) {
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
      const payload = entry ? { technologies: entry.technologies || [], httpHeaders: { servers: Array.from(entry.servers), poweredBy: Array.from(entry.poweredBy) } } : { technologies: [], httpHeaders: { servers: [], poweredBy: [] } };
      chrome.runtime.sendMessage({ action: 'updateTechList', technologies: payload.technologies }, () => {});
      chrome.runtime.sendMessage({ action: 'updateHttpHeaders', httpHeaders: payload.httpHeaders }, () => {});
    }
    return; // handled
  }
  if (message.action === 'panelClosed') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    if (tabId) readyPanels.delete(tabId);
    return;
  }
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
      // Forward to side panel UI only if it has signaled readiness for this tab
      if (readyPanels.has(tabId)) {
        chrome.runtime.sendMessage({ action: 'updateTechList', technologies: entry.technologies }, () => {});
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
