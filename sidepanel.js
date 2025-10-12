const techList = document.getElementById('tech-list');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentAnalyzedUrls = [];
let currentUrlsWithCounts = []; // Store URLs with component counts
let currentTabId = null;
let currentTabUrl = null;
let currentDetectionsByUrl = {}; // Store detectionsByUrl for current URL

function createUrlItem(url, counts) {
  // Clone the template
  const template = document.getElementById('url-item-template');
  const item = template.content.cloneNode(true);

  // Get elements
  const urlElement = item.querySelector('[data-url]');
  const countsElement = item.querySelector('[data-counts]');

  // Truncate long URLs with ellipsis in the middle to preserve domain and path
  const truncatedUrl = truncateUrl(url, 60);

  // Format component counts - only show counts that exist
  const countParts = [];
  if (counts.ip !== undefined) countParts.push(`IP ${counts.ip}`);
  if (counts.http !== undefined) countParts.push(`HTTP ${counts.http}`);
  if (counts.html !== undefined) countParts.push(`HTML ${counts.html}`);
  const countsText = countParts.join(', ');

  // Set content
  urlElement.textContent = truncatedUrl;
  urlElement.title = url;
  countsElement.textContent = countsText;

  return item;
}

function createTechCard(tech) {
  const isRichObject = typeof tech === 'object' && tech.name;
  const name = isRichObject ? tech.name : tech;
  const description = isRichObject ? tech.description : '';
  const link = isRichObject ? tech.link : '';
  const tags = isRichObject ? tech.tags : [];
  const developer = isRichObject ? tech.developer : '';
  const matchedTexts = isRichObject ? tech.matchedTexts : [];

  // Clone the template
  const template = document.getElementById('tech-card-template');
  const card = template.content.cloneNode(true);

  // Get elements
  const titleElement = card.querySelector('[data-title]');
  const descElement = card.querySelector('[data-description]');
  const descPreviewElement = card.querySelector('[data-description-preview]');
  const matchedTextsCollapsedElement = card.querySelector('[data-matched-texts-collapsed]');
  const matchedTextsListCollapsedElement = card.querySelector('[data-matched-texts-list-collapsed]');
  const matchedTextsExpandedElement = card.querySelector('[data-matched-texts-expanded]');
  const matchedTextsListExpandedElement = card.querySelector('[data-matched-texts-list-expanded]');
  const tagsElement = card.querySelector('[data-tags]');
  const cardElement = card.querySelector('.card');
  const expandIconElement = card.querySelector('[data-expand-icon]');

  // Track expansion state
  let isExpanded = false;

  // Set title with optional link, developer info, and tags in a single inline span
  const maxTags = window.innerWidth > 400 ? 4 : 3;
  const tagsBadges = tags.length > 0
    ? ` ${tags.slice(0, maxTags)
        .map(tag => `<span class="badge badge-xs badge-outline ml-1">${tag}</span>`)
        .join('')}`
    : '';

  const titleContent = link ?
    `<a href="${link}" target="_blank" class="link link-primary">${name}</a>${developer
      ? ` <span class="text-[10px] text-base-content/80 font-normal">by ${developer}</span>` : ''}${tagsBadges}` :
    `${name}${developer ? ` <span class="text-sm text-base-content/80 font-normal">by ${developer}</span>` : ''}${tagsBadges}`;

  titleElement.innerHTML = `<span class="inline">${titleContent}</span>`;

  // Set matched texts content
  if (matchedTexts && matchedTexts.length > 0) {
    // Collapsed view - show only first match
    matchedTextsCollapsedElement.style.display = 'block';
    const firstMatch = matchedTexts[0];
    const escapedText = firstMatch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    matchedTextsListCollapsedElement.innerHTML = `<div class="matched-text-item text-xs text-base-content font-mono overflow-hidden text-ellipsis whitespace-nowrap">${escapedText}</div>`;

    if (matchedTexts.length > 1) {
      matchedTextsListCollapsedElement.innerHTML += `<div class="text-xs text-base-content/50 italic">+${matchedTexts.length - 1} more...</div>`;
    }

    // Expanded view - show all matches
    matchedTextsListExpandedElement.innerHTML = matchedTexts
      .map(text => {
        const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="matched-text-item text-xs text-base-content font-mono">${escapedText}</div>`;
      })
      .join('');
  }

  // Set description content
  if (description) {
    // Show preview in collapsed view (first line with ellipsis)
    descPreviewElement.style.display = 'block';
    const firstLine = description.split('\n')[0];
    descPreviewElement.textContent = firstLine;

    // Show full description in expanded view
    descElement.textContent = description;
    descElement.style.whiteSpace = 'pre-wrap';
  }

  // Toggle function
  const updateCardState = () => {
    if (isExpanded) {
      // Show expanded content
      matchedTextsCollapsedElement.style.display = 'none';
      descPreviewElement.style.display = 'none';
      matchedTextsExpandedElement.style.display = matchedTexts && matchedTexts.length > 0 ? 'block' : 'none';
      descElement.style.display = description ? 'block' : 'none';
      // Add expanded styling
      cardElement.classList.add('expanded');
      // Rotate icon to point up
      expandIconElement.style.transform = 'rotate(180deg)';
    } else {
      // Show collapsed content
      matchedTextsCollapsedElement.style.display = matchedTexts && matchedTexts.length > 0 ? 'block' : 'none';
      descPreviewElement.style.display = description ? 'block' : 'none';
      matchedTextsExpandedElement.style.display = 'none';
      descElement.style.display = 'none';
      // Remove expanded styling
      cardElement.classList.remove('expanded');
      // Rotate icon to point down
      expandIconElement.style.transform = 'rotate(0deg)';
    }
  };

  // Initialize collapsed state
  updateCardState();

  // Handle link clicks to prevent toggle
  const links = card.querySelectorAll('a');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });

  // Make entire card clickable
  cardElement.addEventListener('click', (e) => {
    // Don't toggle if clicking on a link
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      return;
    }
    isExpanded = !isExpanded;
    updateCardState();
  });

  // Tags are now displayed inline with the title, so hide the separate tags element
  tagsElement.style.display = 'none';

  return card;
}

function renderUnifiedUrls() {
  const urlsList = document.getElementById('analyzed-urls-list');
  if (!urlsList) return;

  // Create a map to combine URLs with their counts
  const urlMap = new Map();
  
  // Add current tab URL first if it exists
  if (currentTabUrl) {
    // Check if we have counts for the target URL, otherwise use "?" for missing detection
    const targetUrlCounts = currentUrlsWithCounts.find(item => item.url === currentTabUrl);
    const counts = targetUrlCounts ? targetUrlCounts.counts : { ip: '?', http: '?', html: '?' };
    urlMap.set(currentTabUrl, counts);
  }
  
  // Add analyzed URLs with their counts
  currentUrlsWithCounts.forEach(item => {
    urlMap.set(item.url, item.counts);
  });
  
  // If we have analyzed URLs but no counts data (fallback for old messages)
  if (currentUrlsWithCounts.length === 0 && currentAnalyzedUrls.length > 0) {
    currentAnalyzedUrls.forEach(url => {
      if (!urlMap.has(url)) {
        urlMap.set(url, { ip: '?', http: '?', html: '?' });
      }
    });
  }
  
  if (urlMap.size > 0) {
    // Clear existing content
    urlsList.innerHTML = '';

    // Create and append URL items using template
    Array.from(urlMap.entries()).forEach(([url, counts]) => {
      const urlItem = createUrlItem(url, counts);
      urlsList.appendChild(urlItem);
    });
    document.getElementById('analyzed-urls-section').style.display = 'block';
  } else {
    document.getElementById('analyzed-urls-section').style.display = 'none';
  }
}

function truncateUrl(url, maxLength) {
  if (url.length <= maxLength) return url;
  
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol; // e.g., "https:"
    const hostname = urlObj.hostname; // e.g., "example.com"
    const protocolAndHost = protocol + '//' + hostname; // e.g., "https://example.com"
    const pathAndQuery = urlObj.pathname + urlObj.search + urlObj.hash;
    
    // If just the protocol + hostname is too long, truncate the hostname part
    if (protocolAndHost.length >= maxLength - 3) {
      const protocolPart = protocol + '//'; // e.g., "https://"
      const availableForHost = maxLength - protocolPart.length - 3; // 3 chars for "..."
      if (availableForHost > 0) {
        return protocolPart + hostname.substring(0, availableForHost) + '...';
      } else {
        // If even protocol is too long, just truncate the whole URL
        return url.substring(0, maxLength - 3) + '...';
      }
    }
    
    // Calculate how much space we have for the path
    const availableForPath = maxLength - protocolAndHost.length - 3; // 3 chars for "..."
    
    if (pathAndQuery.length <= availableForPath) {
      return protocolAndHost + pathAndQuery;
    }
    
    // Truncate path from the middle, keeping start and end
    const pathStart = pathAndQuery.substring(0, Math.floor(availableForPath / 2));
    const pathEnd = pathAndQuery.substring(pathAndQuery.length - Math.floor(availableForPath / 2));
    
    return protocolAndHost + pathStart + '...' + pathEnd;
  } catch (e) {
    // Fallback for invalid URLs
    return url.substring(0, maxLength - 3) + '...';
  }
}


function showReloadSuggestion() {
  const reloadSuggestion = document.getElementById('reload-suggestion');
  if (reloadSuggestion) {
    reloadSuggestion.style.display = 'block';
  }
  // Hide analyzed URLs section when showing reload suggestion
  document.getElementById('analyzed-urls-section').style.display = 'none';
}

function hideReloadSuggestion() {
  const reloadSuggestion = document.getElementById('reload-suggestion');
  if (reloadSuggestion) {
    reloadSuggestion.style.display = 'none';
  }
  // Show analyzed URLs section again if there are URLs to show
  renderUnifiedUrls();
}

function checkAndUpdateReloadSuggestion() {
  if (!currentTabUrl) return;

  const currentUrlDetection = currentDetectionsByUrl[currentTabUrl];
  const hasIpDetection = currentUrlDetection && currentUrlDetection.ipComponents !== undefined;
  const hasHttpDetection = currentUrlDetection && currentUrlDetection.headerComponents !== undefined;


  // Show reload suggestion if we have no technologies AND either IP or HTTP detection is missing
  if (currentTechs.length === 0 && (!hasIpDetection || !hasHttpDetection)) {
    showReloadSuggestion();
  } else {
    hideReloadSuggestion();
  }
}

function renderCombinedList() {
  // Render unified URLs list
  renderUnifiedUrls();

  // Build a unified list of all detected technologies
  techList.innerHTML = '';

  if (currentTechs.length > 0) {
    currentTechs.forEach(tech => {
      const card = createTechCard(tech);
      techList.appendChild(card);
    });
  } else {
    const emptyState = document.createElement('div');
    emptyState.className = 'text-center text-base-content/70 py-8';
    emptyState.innerHTML = '<p>No technologies detected.</p>';
    techList.appendChild(emptyState);
  }

  // Check and update reload suggestion after rendering
  checkAndUpdateReloadSuggestion();
}






chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('onMessage received', { message, sender });
  
  // Only process messages for this tab
  if (message.tabId && currentTabId && message.tabId !== currentTabId) {
    return;
  }
  
  if (message.action === 'updateDetectionsByUrl') {
    console.log('🔧 updateDetectionsByUrl received', { detectionsByUrl: message.detectionsByUrl, targetUrl: message.targetUrl });

    // Update target URL if provided
    if (message.targetUrl) {
      console.log('🔗 Updating target URL from combined message', { newUrl: message.targetUrl });
      currentTabUrl = message.targetUrl;
    }

    if (message.detectionsByUrl) {
      // Store the detectionsByUrl for the current URL
      currentDetectionsByUrl = message.detectionsByUrl;
      
      // Build URLs with counts from the detectionsByUrl data
      currentUrlsWithCounts = Object.entries(currentDetectionsByUrl).map(([url, detection]) => ({
        url: url,
        counts: {
          ip: detection.ipComponents !== undefined ? detection.ipComponents.length : '?',
          http: detection.headerComponents !== undefined ? detection.headerComponents.length : '?',
          html: detection.htmlComponents !== undefined ? detection.htmlComponents.length : '?'
        }
      }));
      
      // Extract all components for the tech list with deduplication
      currentTechs = [];
      const techMap = new Map(); // Use Map to track and merge duplicate technologies
      
      // Combine all technologies from all URLs, merging duplicates by key
      Object.values(currentDetectionsByUrl).forEach(detection => {
        const headerComponents = detection.headerComponents || [];
        const htmlComponents = detection.htmlComponents || [];
        const ipComponents = detection.ipComponents || [];
        
        [...headerComponents, ...htmlComponents, ...ipComponents].forEach(tech => {
          if (!techMap.has(tech.key)) {
            // First occurrence - add as is
            techMap.set(tech.key, { ...tech });
          } else {
            // Duplicate found - merge matchedTexts and detection methods
            const existing = techMap.get(tech.key);
            const existingTexts = existing.matchedTexts || [];
            const newTexts = tech.matchedTexts || [];
            
            // Combine and deduplicate matchedTexts
            const combinedTexts = [...existingTexts, ...newTexts];
            existing.matchedTexts = [...new Set(combinedTexts)].slice(0, 10); // Dedupe and limit to 10
            
          }
        });
      });
      
      // Convert Map values to array
      currentTechs = Array.from(techMap.values());
      
      // Extract URLs for backward compatibility
      currentAnalyzedUrls = Object.keys(currentDetectionsByUrl);

      renderCombinedList();
    }
  } else if (message.action === 'clearTechs') {
    console.log('🧹 clearTechs called - clearing all technologies');
    currentTechs = [];
    currentAnalyzedUrls = [];
    currentUrlsWithCounts = [];
    currentDetectionsByUrl = {};

    // Update target URL if provided in the message
    if (message.url && currentTabUrl !== message.url) {
      console.log('🔄 URL changed', { oldUrl: currentTabUrl, newUrl: message.url });
      currentTabUrl = message.url;
    }

    renderCombinedList();
  }
});



// Theme management functions
function initializeTheme() {
  const savedTheme = localStorage.getItem('web-stack-spy-theme') || 'light';
  setTheme(savedTheme);
}

function setTheme(theme) {
  const htmlElement = document.documentElement;
  const lightIcon = document.getElementById('theme-icon-light');
  const darkIcon = document.getElementById('theme-icon-dark');

  htmlElement.setAttribute('data-theme', theme);
  localStorage.setItem('web-stack-spy-theme', theme);

  if (theme === 'dark') {
    lightIcon.style.display = 'none';
    darkIcon.style.display = 'block';
  } else {
    lightIcon.style.display = 'block';
    darkIcon.style.display = 'none';
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

// Add reload button and theme toggle functionality
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  initializeTheme();

  // Theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Reload button
  const reloadButton = document.getElementById('reload-button');
  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      if (currentTabId) {
        chrome.tabs.reload(currentTabId);
      }
    });
  }
});

// Establish connection to background script for panel closure detection
var port = null;

// Request the detected technologies when the side panel is opened
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log('chrome.tabs.query called', { tabs });
  const tabId = tabs[0].id;
  const tabUrl = tabs[0].url;
  currentTabId = tabId; // Store current tab ID for message filtering
  currentTabUrl = tabUrl; // Store current tab URL
  port = chrome.runtime.connect({ name: 'sidepanel-' + currentTabId });
  
  // Show target URL immediately
  renderTargetUrl();
    
  // Show reload suggestion initially (will be hidden if content script responds)
  showReloadSuggestion();

  // Request content analysis for this tab now that the panel is ready
  console.log('🚀 Sidepanel requesting content analysis', { tabId });
  try {
    chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('⚠️ Failed to send analyze message to content script:', chrome.runtime.lastError.message);
      } else {
        console.log('✅ Analyze message sent successfully to content script');
      }
    });
  } catch (e) {
    console.error('❌ Exception sending analyze message:', e);
  }

  // Check reload suggestion after a delay
  setTimeout(() => {
    checkAndUpdateReloadSuggestion();
  }, 2000); // Wait 2 seconds for content script response

});
