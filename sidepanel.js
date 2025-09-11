const techList = document.getElementById('tech-list');
const dumpBtn = document.getElementById('dump-btn');
const dumpArea = document.getElementById('dump-area');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentAnalyzedUrls = [];
let currentUrlsWithCounts = []; // Store URLs with component counts
let currentTabId = null;
let currentTabUrl = null;
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

  // Set title with optional link and developer info in a single inline span
  const titleContent = link
    ? `<a href="${link}" target="_blank" class="link link-primary">${name}</a>${developer 
      ? ` <span class="text-[10px] text-base-content/50 font-normal">by ${developer}</span>` : ''}`
    : `${name}${developer ? ` <span class="text-sm text-base-content/50 font-normal">by ${developer}</span>` : ''}`;

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
      } else {
        // Add collapse animation before switching to clamped state
        descElement.style.animation = 'collapseText 0.3s ease-in';
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

    descElement.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isExpanded = !isExpanded;
      updateDescription();
    });
  }

  // Set matched texts if available
  if (matchedTexts && matchedTexts.length > 0) {
    matchedTextsElement.style.display = 'block';
    matchedTextsListElement.innerHTML = matchedTexts
      .map(text => {
        // Escape HTML to prevent XSS
        const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="text-[10px] text-base-content/60 bg-base-300 px-2 py-1 rounded font-mono break-all">${escapedText}</div>`;
      })
      .join('');
  }

  // Set tags if available
  if (tags.length > 0) {
    tagsElement.style.display = 'flex';
    const maxTags = window.innerWidth > 400 ? 4 : 3;
    tagsElement.innerHTML = tags.slice(0, maxTags)
      .map(tag => `<span class="badge badge-xs badge-outline">${tag}</span>`)
      .join('');
  }

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
}

function hideReloadSuggestion() {
  const reloadSuggestion = document.getElementById('reload-suggestion');
  if (reloadSuggestion) {
    reloadSuggestion.style.display = 'none';
  }
}

function renderAnalyzedUrls() {
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

function updateTechList(technologies) {
  console.log('🔧 updateTechList called', { technologies, count: Array.isArray(technologies) ? technologies.length : 0 });
  
  // Debug each technology's matchedTexts
  if (Array.isArray(technologies)) {
    technologies.forEach((tech, index) => {
      if (typeof tech === 'object') {
        console.log(`🎯 Tech ${index}: ${tech.name} (${tech.detectionMethod}) - matchedTexts: [${tech.matchedTexts?.join(', ') || 'none'}]`);
      }
    });
  }
  // Handle both old string format and new rich object format
  currentTechs = Array.isArray(technologies) ? technologies : [];
  // Deduplicate based on name property for rich objects, or string value
  const seen = new Set();
  currentTechs = currentTechs.filter(tech => {
    const key = typeof tech === 'object' ? tech.name : tech;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log('🔧 updateTechList processed', { finalCount: currentTechs.length, techNames: currentTechs.map(t => t.name || t) });
  
  // Mark that content script has responded
  hasContentScriptResponded = true;
  
  // Only hide reload suggestion if technologies were actually detected
  if (currentTechs.length > 0) {
    hideReloadSuggestion();
  }
  
  // Refresh URL counts from tabDetections  
  refreshUrlCounts();
  
  renderCombinedList();
}


function updateAnalyzedUrls(analyzedUrls) {
  console.log('updateAnalyzedUrls called', { analyzedUrls });
  // Update analyzed URLs
  currentAnalyzedUrls = Array.isArray(analyzedUrls) ? analyzedUrls : [];

  // Re-render to update URL display
  renderAnalyzedUrls();

  // Auto-refresh dump area when analyzed URLs update
  if (dumpArea.textContent !== '') requestDump();
}

function updateAnalyzedUrlsWithCounts(urlsWithCounts) {
  console.log('updateAnalyzedUrlsWithCounts called', { urlsWithCounts });
  
  currentUrlsWithCounts = Array.isArray(urlsWithCounts) ? urlsWithCounts : [];
  
  // Extract URLs for backward compatibility
  currentAnalyzedUrls = currentUrlsWithCounts.map(item => item.url);

  // Re-render to update URL display with counts
  renderUnifiedUrls();

  // Auto-refresh dump area when analyzed URLs update
  if (dumpArea.textContent !== '') requestDump();
}

// Function to refresh URL counts from tabDetections
function refreshUrlCounts() {
  if (!currentTabId) return;
  
  chrome.runtime.sendMessage({ action: 'getTabDetections', tabId: currentTabId }, (response) => {
    if (response && response.entry) {
      const detectionsByUrl = response.entry.detectionsByUrl || {};
      
      // Build URLs with counts from the detectionsByUrl data
      currentUrlsWithCounts = Object.entries(detectionsByUrl).map(([url, detection]) => {
        const counts = {};
        if (detection.ipComponents) counts.ip = detection.ipComponents.length;
        if (detection.headerComponents) counts.http = detection.headerComponents.length;
        if (detection.htmlComponents) counts.html = detection.htmlComponents.length;
        
        return {
          url: url,
          counts: counts
        };
      });
      
      // Extract URLs for backward compatibility
      currentAnalyzedUrls = Object.keys(detectionsByUrl);
      
      // Re-render URLs with updated counts
      renderUnifiedUrls();
    }
  });
}

function renderDump(entry) {
  if (!entry) {
    dumpArea.textContent = 'No data.';
    return;
  }
  dumpArea.textContent = JSON.stringify(entry, null, 2);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('chrome.runtime.onMessage.addListener called', { message, sender });
  
  // Only process messages for this tab
  if (message.tabId && currentTabId && message.tabId !== currentTabId) {
    return;
  }
  
  if (message.action === 'updateTechList') {
    updateTechList(message.technologies);
  } else if (message.action === 'updateAnalyzedUrls') {
    updateAnalyzedUrls(message.analyzedUrls || []);
  } else if (message.action === 'updateAnalyzedUrlsWithCounts') {
    updateAnalyzedUrlsWithCounts(message.urlsWithCounts || []);
  } else if (message.action === 'updateAllComponents') {
    // Handle all components message by storing them and refreshing counts
    currentTechs = Array.isArray(message.components) ? message.components : [];
    refreshUrlCounts();
    renderCombinedList();
  } else if (message.action === 'updateTargetUrl') {
    console.log('🔗 Updating target URL', { newUrl: message.url });
    currentTabUrl = message.url;
    renderTargetUrl();
  } else if (message.action === 'clearTechs') {
    console.log('🧹 clearTechs called - clearing all technologies');
    techList.innerHTML = '';
    currentTechs = [];
    currentAnalyzedUrls = [];
    currentUrlsWithCounts = [];
    hasContentScriptResponded = false;
    
    // Update target URL when navigation occurs
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id === currentTabId) {
        currentTabUrl = tabs[0].url;
      }
    });
    
    renderUnifiedUrls();
    showReloadSuggestion();
    requestDump();
  }
});

function requestDump() {
  chrome.runtime.sendMessage({ action: 'getTabDetections' }, (response) => {
    if (response && response.entry) {
      renderDump(response.entry);
    } else if (response && response.error) {
      dumpArea.textContent = 'Error: ' + response.error;
    } else {
      dumpArea.textContent = 'No data.';
    }
  });
}

dumpBtn.addEventListener('click', requestDump);

// Request dump on open so the panel shows current state
requestDump();

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

  // Request the current tabDetections for the tab
  chrome.runtime.sendMessage({ action: 'getTabDetections', tabId: tabId }, (response) => {
    console.log('chrome.runtime.sendMessage callback called', { tabId, response });
    if (response && response.entry) {
      // Extract data from tabDetections structure
      const detectionsByUrl = response.entry.detectionsByUrl || {};
      
      // Build URLs with counts from the detectionsByUrl data
      currentUrlsWithCounts = Object.entries(detectionsByUrl).map(([url, detection]) => ({
        url: url,
        counts: {
          ip: (detection.ipComponents || []).length,
          http: (detection.headerComponents || []).length,
          html: (detection.htmlComponents || []).length
        }
      }));
      
      // Extract all components for the tech list
      currentTechs = [];
      Object.values(detectionsByUrl).forEach(detection => {
        currentTechs.push(...(detection.headerComponents || []));
        currentTechs.push(...(detection.htmlComponents || []));
        currentTechs.push(...(detection.ipComponents || []));
      });
      
      // Extract URLs for backward compatibility
      currentAnalyzedUrls = Object.keys(detectionsByUrl);
      
      // If we have technologies, hide the reload suggestion
      if (currentTechs.length > 0) {
        hasContentScriptResponded = true;
        hideReloadSuggestion();
      } else if (currentAnalyzedUrls.length > 0) {
        // If we have analyzed URLs but no technologies, content script likely responded
        // but found nothing - keep suggestion visible to suggest reloading for full analysis
        hasContentScriptResponded = true;
      }
      
      renderCombinedList();
    }
  });

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
