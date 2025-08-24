chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  console.log('chrome.tabs.onUpdated.addListener called', { tabId, info, tab });
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
  console.log('chrome.runtime.onMessage.addListener called', { message, sender });
  if (message.action === 'getDetectedTechs') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(tabId, { action: 'getDetectedTechs' }, (response) => {
          console.log('chrome.tabs.sendMessage callback called', { tabId, response });
          if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message) {
              console.error(chrome.runtime.lastError.message);
            } else {
              console.error(chrome.runtime.lastError);
            }
            sendResponse({ error: chrome.runtime.lastError.message || chrome.runtime.lastError });
          } else {
            sendResponse(response);
          }
        });
      } else {
        sendResponse({ error: 'No active tab found.' });
      }
    });
    return true; // Indicates that the response is sent asynchronously
  }
});
