const techList = document.getElementById('tech-list');
const dumpBtn = document.getElementById('dump-btn');
const dumpArea = document.getElementById('dump-area');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentAnalyzedUrls = [];
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

function renderTargetUrl() {
  const targetUrlElement = document.getElementById('target-url');
  if (currentTabUrl && targetUrlElement) {
    targetUrlElement.textContent = currentTabUrl;
    targetUrlElement.title = currentTabUrl;
  }
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
  const urlsList = document.getElementById('analyzed-urls-list');
  if (!urlsList) return;

  if (currentAnalyzedUrls.length > 0) {
    urlsList.innerHTML = currentAnalyzedUrls
      .map(url => `<div class="text-xs text-base-content/70 truncate" title="${url}">${url}</div>`)
      .join('');
    document.getElementById('analyzed-urls-section').style.display = 'block';
  } else {
    document.getElementById('analyzed-urls-section').style.display = 'none';
  }
}

function renderCombinedList() {
  // Render target URL and analyzed URLs first
  renderTargetUrl();
  renderAnalyzedUrls();
  
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
  } else if (message.action === 'updateTargetUrl') {
    console.log('🔗 Updating target URL', { newUrl: message.url });
    currentTabUrl = message.url;
    renderTargetUrl();
  } else if (message.action === 'clearTechs') {
    console.log('🧹 clearTechs called - clearing all technologies');
    techList.innerHTML = '';
    currentTechs = [];
    currentAnalyzedUrls = [];
    hasContentScriptResponded = false;
    
    // Update target URL when navigation occurs
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id === currentTabId) {
        currentTabUrl = tabs[0].url;
        renderTargetUrl();
      }
    });
    
    renderAnalyzedUrls();
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

  // Request the current merged detections for the tab
  chrome.runtime.sendMessage({ action: 'getDetectedTechs', tabId: tabId }, (response) => {
    console.log('chrome.runtime.sendMessage callback called', { tabId, response });
    if (response) {
      // Populate current state from response and render merged UI
      currentTechs = response.technologies || [];
      currentAnalyzedUrls = response.analyzedUrls || [];
      
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
