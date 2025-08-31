// Only run in main frame - skip iframes
if (window !== window.top) {
  // This is an iframe, don't run analysis
} else {

let detectedTechsByTab = {};
let techConfig = null;

// Load configuration
async function loadConfig() {
  try {
    const configUrl = chrome.runtime.getURL('config.json');
    const response = await fetch(configUrl);
    techConfig = await response.json();
    console.log('Configuration loaded:', Object.keys(techConfig).length, 'technologies');
  } catch (error) {
    console.error('Failed to load config.json:', error);
    techConfig = {};
  }
}

function shouldAnalyzePage() {
  const url = window.location.href;
  const pathname = window.location.pathname.toLowerCase();
  
  // Skip non-HTML resources
  const nonHtmlExtensionRegex = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp[34]|wav|woff2?|[te]ot)$/i;
  
  if (nonHtmlExtensionRegex.test(pathname)) {
    console.log('Skipping analysis for non-HTML resource:', url);
    return false;
  }
  
  return true;
}

function detectTechnologies() {
  console.log('detectTechnologies called');
  const detected = [];

  if (!techConfig) {
    console.warn('Configuration not loaded, cannot detect technologies');
    return detected;
  }

  const html = document.documentElement.outerHTML;

  // Iterate through all configured technologies
  Object.entries(techConfig).forEach(([key, config]) => {
    const { name, html: htmlPatterns = [] } = config;
    
    // Check HTML patterns using regex
    for (const pattern of htmlPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(html)) {
          detected.push(name);
          console.log(`Detected ${name} via HTML pattern: ${pattern}`);
          break; // Only add once per technology
        }
      } catch (error) {
        console.warn(`Invalid regex pattern for ${name}:`, pattern, error);
      }
    }
  });

  console.log('Detected:', { detected });
  return detected;
}

async function analyzeContent() {
  console.log('analyzeContent called');
  
  // Skip analysis for non-HTML pages
  if (!shouldAnalyzePage()) {
    chrome.runtime.sendMessage({ action: 'detectedTechs', technologies: [] });
    return;
  }
  
  // Ensure config is loaded
  if (!techConfig) {
    await loadConfig();
  }
  
  const technologies = detectTechnologies();
  // Store detected technologies for the current tab
  chrome.runtime.sendMessage({ action: 'getTabId' }, (response) => {
    const tabId = response && response.tabId ? response.tabId : null;
    if (tabId) {
      detectedTechsByTab[tabId] = technologies;
      chrome.runtime.sendMessage({ action: 'detectedTechs', technologies: technologies, tabId: tabId });
      console.log('chrome.runtime.sendMessage called', { technologies, tabId });
    } else {
      chrome.runtime.sendMessage({ action: 'detectedTechs', technologies: technologies });
      console.log('chrome.runtime.sendMessage called', { technologies });
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyze') {
    analyzeContent();
  } else if (message.action === 'getDetectedTechs') {
    const tabId = message.tabId;
    if (detectedTechsByTab[tabId]) {
      sendResponse({ technologies: detectedTechsByTab[tabId] });
    } else {
      // If not detected yet, run the analysis and respond after detection
      if (!shouldAnalyzePage()) {
        sendResponse({ technologies: [] });
        return;
      }
      // Ensure config is loaded before detection
      (async () => {
        if (!techConfig) {
          await loadConfig();
        }
        const technologies = detectTechnologies();
        detectedTechsByTab[tabId] = technologies;
        sendResponse({ technologies });
      })();
    }
    return true; // Indicates that the response is sent asynchronously
  }
});

// Initialize configuration on script load
loadConfig();

} // End of main frame check
// Note: content script no longer auto-runs analysis on load. Analysis is
// performed when the side panel requests it (via background forwarding).
