
// Track which tab has the side panel open
let panelOpenTabId = null;

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
  try {
    const httpHeaders = {
      servers: Array.from(entry.servers),
      poweredBy: Array.from(entry.poweredBy)
    };
    chrome.runtime.sendMessage({ action: 'updateHttpHeaders', tabId, httpHeaders });
  } catch (e) {
    console.warn('Failed to send header update to side panel', e);
  }
}

// webRequest listener to inspect response headers
try {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      // details.tabId may be -1 for non-tab resources; ignore those
      const tabId = details.tabId;
      if (typeof tabId !== 'number' || tabId < 0) return;
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
} catch (e) {
  console.warn('webRequest.onHeadersReceived not available or blocked', e);
}

// Allow clicking the action to open the side panel for the current tab
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  // Non-fatal: older Chrome may not support this
  console.warn('setPanelBehavior failed', err);
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Disable previous tab-specific panel (if any) so the panel only appears on the clicked tab
    if (panelOpenTabId !== null && panelOpenTabId !== tab.id) {
      try {
        await chrome.sidePanel.setOptions({ tabId: panelOpenTabId, enabled: false });
        console.log('Disabled side panel for previous tab', panelOpenTabId);
      } catch (e) {
        console.warn('Failed to disable previous tab side panel', panelOpenTabId, e);
      }
    }

    // Enable the side panel only for the clicked tab and open it
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    panelOpenTabId = tab.id;
    console.log('Side panel enabled and opened for tab', tab.id);
  } catch (err) {
    console.error('Failed to open side panel for tab', tab.id, err);
  }
});

// When the user switches tabs, disable the panel for the previously-open tab so
// the side panel remains enabled only on the tab it was opened on.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;
  if (panelOpenTabId !== null && panelOpenTabId !== tabId) {
    try {
      await chrome.sidePanel.setOptions({ tabId: panelOpenTabId, enabled: false });
      console.log('Disabled side panel for previous tab due to activation change', panelOpenTabId);
    } catch (e) {
      console.warn('Failed to disable previous tab side panel on activation', panelOpenTabId, e);
    }
    panelOpenTabId = null;
  }
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
    if (tabDetections.has(tabId)) tabDetections.delete(tabId);
    try {
      chrome.runtime.sendMessage({ action: 'clearTechs', tabId });
    } catch (e) {
      // ignore
    }
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
            const headerInfo = tabDetections.get(tabId) || { servers: new Set(), poweredBy: new Set() };
            const merged = {
              ...(response || {}),
              httpHeaders: {
                servers: Array.from(headerInfo.servers),
                poweredBy: Array.from(headerInfo.poweredBy)
              }
            };
            if (chrome.runtime.lastError) {
              if (chrome.runtime.lastError.message) {
                console.error(chrome.runtime.lastError.message);
              } else {
                console.error(chrome.runtime.lastError);
              }
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
