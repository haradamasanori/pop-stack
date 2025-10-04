const techList = document.getElementById('tech-list');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentAnalyzedUrls = [];
let currentUrlsWithCounts = []; // Store URLs with component counts
let currentTabId = null;
let currentTabUrl = null;
let currentDetectionsByUrl = {}; // Store detectionsByUrl for current URL
let hasContentScriptResponded = false;

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
  const matchedTextsElement = card.querySelector('[data-matched-texts]');
  const matchedTextsListElement = card.querySelector('[data-matched-texts-list]');
  const tagsElement = card.querySelector('[data-tags]');

  // Set title with optional link, developer info, and tags in a single inline span
  const maxTags = window.innerWidth > 400 ? 4 : 3;
  const tagsBadges = tags.length > 0 
    ? ` ${tags.slice(0, maxTags)
        .map(tag => `<span class="badge badge-xs badge-outline ml-1">${tag}</span>`)
        .join('')}`
    : '';
    
  const titleContent = link
    ? `<a href="${link}" target="_blank" class="link link-primary">${name}</a>${developer 
      ? ` <span class="text-[10px] text-base-content/50 font-normal">by ${developer}</span>` : ''}${tagsBadges}`
    : `${name}${developer ? ` <span class="text-sm text-base-content/50 font-normal">by ${developer}</span>` : ''}${tagsBadges}`;

  titleElement.innerHTML = `<span class="inline">${titleContent}</span>`;

  // Set description if available
  if (description) {
    descElement.style.display = 'block';

    // Store original description and setup toggle
    let isExpanded = false;

    const updateDescription = () => {
      if (isExpanded) {
        descElement.classList.remove('line-clamp-2');
        descElement.classList.add('expanded-description');
        descElement.textContent = description + ' (click to collapse)';
        // Show matched texts when expanded
        if (matchedTexts && matchedTexts.length > 0) {
          matchedTextsElement.style.display = 'block';
        }
      } else {
        // Add collapse animation before switching to clamped state
        descElement.style.animation = 'collapseText 0.3s ease-in';
        // Hide matched texts immediately when collapsing
        matchedTextsElement.style.display = 'none';
        setTimeout(() => {
          descElement.classList.remove('expanded-description');
          descElement.classList.add('line-clamp-2');
          descElement.textContent = description;
          descElement.style.animation = '';
        }, 300);
      }
    };

    // Ensure we start with the right classes
    descElement.classList.remove('expanded-description');
    descElement.classList.add('line-clamp-2');
    descElement.textContent = description;

    // Make entire card clickable, but preserve link clicks
    const cardElement = card.querySelector('.card');
    cardElement.style.cursor = 'pointer';
    cardElement.addEventListener('click', (e) => {
      // Don't toggle if clicking on a link
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isExpanded = !isExpanded;
      updateDescription();
    });
  }

  // Set matched texts if available, but keep hidden by default
  if (matchedTexts && matchedTexts.length > 0) {
    // Populate the content but keep hidden initially
    matchedTextsListElement.innerHTML = matchedTexts
      .map(text => {
        // Escape HTML to prevent XSS
        const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="matched-text-item text-[10px] text-base-content/60 bg-base-300 px-2 py-1 rounded font-mono">${escapedText}</div>`;
      })
      .join('');
  }
  // Always start with matched texts hidden
  matchedTextsElement.style.display = 'none';

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
    // Check if we have counts for the target URL, otherwise use empty object
    const targetUrlCounts = currentUrlsWithCounts.find(item => item.url === currentTabUrl);
    urlMap.set(currentTabUrl, targetUrlCounts ? targetUrlCounts.counts : {});
  }
  
  // Add analyzed URLs with their counts
  currentUrlsWithCounts.forEach(item => {
    urlMap.set(item.url, item.counts);
  });
  
  // If we have analyzed URLs but no counts data (fallback for old messages)
  if (currentUrlsWithCounts.length === 0 && currentAnalyzedUrls.length > 0) {
    currentAnalyzedUrls.forEach(url => {
      if (!urlMap.has(url)) {
        urlMap.set(url, {});
      }
    });
  }
  
  if (urlMap.size > 0) {
    urlsList.innerHTML = Array.from(urlMap.entries())
      .map(([url, counts]) => {
        // Truncate long URLs with ellipsis in the middle to preserve domain and path
        const truncatedUrl = truncateUrl(url, 60);
        
        // Format component counts - only show counts that exist
        const countParts = [];
        if (counts.ip !== undefined) countParts.push(`ip(${counts.ip})`);
        if (counts.http !== undefined) countParts.push(`http(${counts.http})`);
        if (counts.html !== undefined) countParts.push(`html(${counts.html})`);
        const countsText = countParts.join(', ');
        
        return `
          <div class="mb-2">
            <div class="text-xs text-base-content/70 truncate max-w-full" title="${url}">${truncatedUrl}</div>
            <div class="text-[10px] text-base-content/50 mt-1 pl-2">${countsText}</div>
          </div>
        `;
      })
      .join('');
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

// Keep the old function for backward compatibility but make it call the new one
function renderTargetUrl() {
  renderUnifiedUrls();
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
    emptyState.className = 'text-center text-base-content/60 py-8';
    emptyState.innerHTML = '<p>No technologies detected.</p>';
    techList.appendChild(emptyState);
  }
}






chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('onMessage received', { message, sender });
  
  // Only process messages for this tab
  if (message.tabId && currentTabId && message.tabId !== currentTabId) {
    return;
  }
  
  if (message.action === 'updateTargetUrl') {
    console.log('🔗 Updating target URL', { newUrl: message.url });
    currentTabUrl = message.url;
    renderTargetUrl();
  } else if (message.action === 'updateDetectionsByUrl') {
    console.log('🔧 updateDetectionsByUrl received', { detectionsByUrl: message.detectionsByUrl });
    
    
    if (message.detectionsByUrl) {
      // Store the detectionsByUrl for the current URL
      currentDetectionsByUrl = message.detectionsByUrl;
      
      // Build URLs with counts from the detectionsByUrl data
      currentUrlsWithCounts = Object.entries(currentDetectionsByUrl).map(([url, detection]) => ({
        url: url,
        counts: {
          ip: (detection.ipComponents || []).length,
          http: (detection.headerComponents || []).length,
          html: (detection.htmlComponents || []).length
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
            
            // Update detection method to show it was detected by multiple methods
            const methods = new Set();
            if (existing.detectionMethod) methods.add(existing.detectionMethod);
            if (tech.detectionMethod) methods.add(tech.detectionMethod);
            
            if (methods.size > 1) {
              existing.detectionMethod = Array.from(methods).join(' + ');
            }
          }
        });
      });
      
      // Convert Map values to array
      currentTechs = Array.from(techMap.values());
      
      // Extract URLs for backward compatibility
      currentAnalyzedUrls = Object.keys(currentDetectionsByUrl);
      
      // If we have technologies, hide the reload suggestion
      if (currentTechs.length > 0) {
        hasContentScriptResponded = true;
        hideReloadSuggestion();
      }
      
      renderCombinedList();
    }
  } else if (message.action === 'clearTechs') {
    console.log('🧹 clearTechs called - clearing all technologies');
    techList.innerHTML = '';
    currentTechs = [];
    currentAnalyzedUrls = [];
    currentUrlsWithCounts = [];
    currentDetectionsByUrl = {};
    hasContentScriptResponded = false;
    
    // Update target URL when navigation occurs
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id === currentTabId) {
        const newUrl = tabs[0].url;
        if (currentTabUrl !== newUrl) {
          console.log('🔄 URL changed, calling getDetectionsByUrl', { oldUrl: currentTabUrl, newUrl });
          currentTabUrl = newUrl;
          // Call getDetectionsByUrl when URL changes (will trigger updateDetectionsByUrl message)
          chrome.runtime.sendMessage({ action: 'getDetectionsByUrl', tabId: currentTabId });
        }
      }
    });
    
    renderUnifiedUrls();
    showReloadSuggestion();
  }
});



// Add reload button functionality
document.addEventListener('DOMContentLoaded', () => {
  const reloadButton = document.getElementById('reload-button');
  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      if (currentTabId) {
        chrome.tabs.reload(currentTabId);
      }
    });
  }
});

// Request the detected technologies when the side panel is opened
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log('chrome.tabs.query called', { tabs });
  const tabId = tabs[0].id;
  const tabUrl = tabs[0].url;
  currentTabId = tabId; // Store current tab ID for message filtering
  currentTabUrl = tabUrl; // Store current tab URL
  
  // Show target URL immediately
  renderTargetUrl();
  
  
  // Show reload suggestion initially (will be hidden if content script responds)
  showReloadSuggestion();
  
  // Notify background that the panel is ready to receive updates for this tab
  chrome.runtime.sendMessage({ action: 'panelReady', tabId }, (res) => {
    // ignore response; background will send current state after registering readiness
  });

  // Request the current detectionsByUrl for the tab (will trigger updateDetectionsByUrl message)
  chrome.runtime.sendMessage({ action: 'getDetectionsByUrl', tabId: tabId });

  // Request content analysis for this tab now that the panel is ready
  console.log('🚀 Sidepanel requesting content analysis', { tabId });
  try {
    chrome.runtime.sendMessage({ action: 'requestAnalyze', tabId }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('⚠️ Failed to send requestAnalyze:', chrome.runtime.lastError.message);
      } else {
        console.log('✅ RequestAnalyze sent successfully');
      }
    });
  } catch (e) {
    console.error('❌ Exception sending requestAnalyze:', e);
  }

  // Show reload suggestion after a delay if no technologies were detected
  setTimeout(() => {
    if (currentTechs.length === 0) {
      showReloadSuggestion();
    }
  }, 2000); // Wait 2 seconds for content script response

  // Inform background when the panel is unloaded/closed so it can stop
  // assuming the panel is listening for this tab.
  window.addEventListener('unload', () => {
    try {
      chrome.runtime.sendMessage({ action: 'panelClosed', tabId });
    } catch (e) {
      // ignore
    }
  });
});
