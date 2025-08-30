const technologyPatterns = [
  { name: 'Next.js', pattern: /(<meta name="generator" content="Next.js"|<script id="__NEXT_DATA__"|\/_next\/static\/)/i },
  { name: 'jQuery', pattern: /<script[^>]+jquery[^>]+>/i },
  { name: 'React', pattern: /<script[^>]+react[^>]+>/i },
  { name: 'Vue.js', pattern: /<script[^>]+vue[^>]+>/i },
  { name: 'Angular', pattern: /<script[^>]+angular[^>]+>/i },
  { name: 'Svelte', pattern: /<script[^>]+svelte[^>]+>/i },
  { name: 'Ember.js', pattern: /<script[^>]+ember[^>]+>/i },
  { name: 'Backbone.js', pattern: /<script[^>]+backbone[^>]+>/i },
  { name: 'Gatsby', pattern: /<meta name="generator" content="Gatsby"/i },
  { name: 'Nuxt.js', pattern: /<script[^>]+nuxt[^>]+>/i },
  { name: 'WordPress', pattern: /<meta name="generator" content="WordPress"/i },
  { name: 'Shopify', pattern: /<script[^>]+shopify[^>]+>/i },
  { name: 'Wix', pattern: /<meta name="generator" content="Wix.com"/i },
  { name: 'Squarespace', pattern: /<meta name="generator" content="Squarespace"/i },
  { name: 'Drupal', pattern: /<meta name="Generator" content="Drupal"/i },
  { name: 'Joomla', pattern: /<meta name="generator" content="Joomla"/i },
  { name: 'Bootstrap', pattern: /<link[^>]+bootstrap[^>]+>/i },
  { name: 'Tailwind CSS', pattern: /<link[^>]+tailwind[^>]+>/i },
  { name: 'Materialize CSS', pattern: /<link[^>]+materialize[^>]+>/i },
  { name: 'Bulma', pattern: /<link[^>]+bulma[^>]+>/i },
  { name: 'Foundation', pattern: /<link[^>]+foundation[^>]+>/i },
];

let detectedTechsByTab = {};

function detectTechnologies(html) {
  console.log('detectTechnologies called', { html });
  const detected = [];
  for (const tech of technologyPatterns) {
    if (tech.pattern.test(html)) {
      detected.push(tech.name);
    }
  }
  console.log('Detected:', { detected });
  return detected;
}

function analyzeContent() {
  console.log('analyzeContent called');
  const html = document.documentElement.outerHTML;
  const technologies = detectTechnologies(html);
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
      const html = document.documentElement.outerHTML;
      const technologies = detectTechnologies(html);
      detectedTechsByTab[tabId] = technologies;
      sendResponse({ technologies });
    }
    return true; // Indicates that the response is sent asynchronously
  }
});
// Note: content script no longer auto-runs analysis on load. Analysis is
// performed when the side panel requests it (via background forwarding).
