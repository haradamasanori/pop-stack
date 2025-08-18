chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
      // This is to prevent the "Uncaught (in promise) Error: Could not establish connection" error.
      // It's expected to fail on pages where the content script is not injected.
      if (chrome.runtime.lastError) {
        // You can log this for debugging if you want, but it's not a critical error.
        // console.warn("Web Stack Spy: Could not connect to content script.");
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getDetectedTechs') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(tabId, { action: 'getDetectedTechs' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
          } else {
            sendResponse(response);
          }
        });
      }
    });
    return true; // Indicates that the response is sent asynchronously
  }
});
