// Only run in main frame - skip iframes
if (window !== window.top) {
  // This is an iframe, don't run analysis
} else {

let detectedTechsByTab = {};

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

  // Check for Next.js
  if (document.getElementById('__NEXT_DATA__') || 
      document.querySelector('meta[name="generator"][content*="Next.js" i]') ||
      document.querySelector('script[src*="/_next/static/" i]')) {
    detected.push('Next.js');
  }

  // Check for Gatsby
  if (document.querySelector('meta[name="generator"][content*="Gatsby" i]')) {
    detected.push('Gatsby');
  }

  // Check for WordPress
  if (document.querySelector('meta[name="generator"][content*="WordPress" i]')) {
    detected.push('WordPress');
  }

  // Check for Wix
  if (document.querySelector('meta[name="generator"][content*="Wix.com" i]')) {
    detected.push('Wix');
  }

  // Check for Squarespace
  if (document.querySelector('meta[name="generator"][content*="Squarespace" i]')) {
    detected.push('Squarespace');
  }

  // Check for Drupal (note: original had uppercase "Generator")
  if (document.querySelector('meta[name="Generator"][content*="Drupal" i], meta[name="generator"][content*="Drupal" i]')) {
    detected.push('Drupal');
  }

  // Check for Joomla
  if (document.querySelector('meta[name="generator"][content*="Joomla" i]')) {
    detected.push('Joomla');
  }

  // Check for Google Analytics using querySelector only
  if (document.querySelector('script[src*="googletagmanager.com/gtag/js"]') ||
      document.querySelector('script[src*="google-analytics.com/analytics.js"]') ||
      document.querySelector('script[src*="googletagmanager.com/gtm.js"]') ||
      document.getElementById('google-analytics') ||
      window.gtag || window.ga || window.dataLayer) {
    detected.push('Google Analytics');
  }

  // Batch check script sources for efficiency
  const scripts = document.querySelectorAll('script[src]');
  if (scripts.length > 0) {
    const scriptSrcs = Array.from(scripts, s => s.src.toLowerCase()).join(' ');
    
    if (scriptSrcs.includes('jquery')) detected.push('jQuery');
    if (scriptSrcs.includes('react')) detected.push('React');
    if (scriptSrcs.includes('vue')) detected.push('Vue.js');
    if (scriptSrcs.includes('angular')) detected.push('Angular');
    if (scriptSrcs.includes('svelte')) detected.push('Svelte');
    if (scriptSrcs.includes('ember')) detected.push('Ember.js');
    if (scriptSrcs.includes('backbone')) detected.push('Backbone.js');
    if (scriptSrcs.includes('nuxt')) detected.push('Nuxt.js');
    if (scriptSrcs.includes('shopify')) detected.push('Shopify');
  }

  // Batch check link hrefs for CSS frameworks
  const links = document.querySelectorAll('link[rel="stylesheet"][href]');
  if (links.length > 0) {
    const linkHrefs = Array.from(links, l => l.href.toLowerCase()).join(' ');
    
    if (linkHrefs.includes('bootstrap')) detected.push('Bootstrap');
    if (linkHrefs.includes('tailwind')) detected.push('Tailwind CSS');
    if (linkHrefs.includes('materialize')) detected.push('Materialize CSS');
    if (linkHrefs.includes('bulma')) detected.push('Bulma');
    if (linkHrefs.includes('foundation')) detected.push('Foundation');
  }

  console.log('Detected:', { detected });
  return detected;
}

function analyzeContent() {
  console.log('analyzeContent called');
  
  // Skip analysis for non-HTML pages
  if (!shouldAnalyzePage()) {
    chrome.runtime.sendMessage({ action: 'detectedTechs', technologies: [] });
    return;
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
      const technologies = detectTechnologies();
      detectedTechsByTab[tabId] = technologies;
      sendResponse({ technologies });
    }
    return true; // Indicates that the response is sent asynchronously
  }
});

} // End of main frame check
// Note: content script no longer auto-runs analysis on load. Analysis is
// performed when the side panel requests it (via background forwarding).
