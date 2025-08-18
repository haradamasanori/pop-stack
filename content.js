const technologyPatterns = [
  { name: 'Next.js', pattern: /<meta name="generator" content="Next.js"|<script id="__NEXT_DATA__"/i },
  { name: 'jQuery', pattern: /<script[^>]+jquery[^>]+>/i },
  { name: 'React', pattern: /<script[^>]+react[^>]+>/i },
  { name: 'Vue.js', pattern: /<script[^>]+vue[^>]+>/i },
  { name: 'Angular', pattern: /<script[^>]+angular[^>]+>/i },
  { name: 'Svelte', pattern: /<script[^>]+svelte[^>]+>/i },
  { name: 'Ember.js', pattern: /<script[^>]+ember[^>]+>/i },
  { name: 'Backbone.js', pattern: /<script[^>]+backbone[^>]+>/i },
  { name: 'Gatsby', pattern: /<meta name="generator" content="Gatsby"/i },
  { name: 'Nuxt.js', pattern: /<script[^>]+nuxt[^>]+>/i },
  { name: 'WordPress', pattern: /<meta name="generator" content="WordPress/i },
  { name: 'Shopify', pattern: /<script[^>]+shopify[^>]+>/i },
  { name: 'Wix', pattern: /<meta name="generator" content="Wix.com"/i },
  { name: 'Squarespace', pattern: /<meta name="generator" content="Squarespace"/i },
  { name: 'Drupal', pattern: /<meta name="Generator" content="Drupal/i },
  { name: 'Joomla', pattern: /<meta name="generator" content="Joomla/i },
  { name: 'Bootstrap', pattern: /<link[^>]+bootstrap[^>]+>/i },
  { name: 'Tailwind CSS', pattern: /<link[^>]+tailwind[^>]+>/i },
  { name: 'Materialize CSS', pattern: /<link[^>]+materialize[^>]+>/i },
  { name: 'Bulma', pattern: /<link[^>]+bulma[^>]+>/i },
  { name: 'Foundation', pattern: /<link[^>]+foundation[^>]+>/i },
];

let detectedTechsByTab = {};

function detectTechnologies(html) {
  const detected = [];
  for (const tech of technologyPatterns) {
    if (tech.pattern.test(html)) {
      detected.push(tech.name);
    }
  }
  return detected;
}

function analyzeContent() {
  const html = document.documentElement.outerHTML;
  const technologies = detectTechnologies(html);
  chrome.runtime.sendMessage({ action: 'detectedTechs', technologies: technologies });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyze') {
    analyzeContent();
  } else if (message.action === 'getDetectedTechs') {
    const tabId = message.tabId;
    if (detectedTechsByTab[tabId]) {
      sendResponse({ technologies: detectedTechsByTab[tabId] });
    } else {
      // If not detected yet, run the analysis
      analyzeContent();
      // The response will be sent by the 'detectedTechs' message listener
    }
    return true; // Indicates that the response is sent asynchronously
  }
});


// Store detected technologies and send to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'detectedTechs') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        detectedTechsByTab[tabId] = message.technologies;
        chrome.runtime.sendMessage({ action: 'updateTechList', technologies: message.technologies });
      }
    });
  }
});

analyzeContent();
