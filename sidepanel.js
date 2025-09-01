const techList = document.getElementById('tech-list');
const dumpBtn = document.getElementById('dump-btn');
const dumpArea = document.getElementById('dump-area');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentHeaderTechs = [];

function createTechCard(tech) {
  const isRichObject = typeof tech === 'object' && tech.name;
  const name = isRichObject ? tech.name : tech;
  const description = isRichObject ? tech.description : '';
  const link = isRichObject ? tech.link : '';
  const tags = isRichObject ? tech.tags : [];
  const developer = isRichObject ? tech.developer : '';

  const card = document.createElement('div');
  card.className = 'tech-card card bg-base-200 shadow-sm w-full';
  
  const cardBody = document.createElement('div');
  cardBody.className = 'card-body p-3 sm:p-4';
  
  // Title with optional link
  const title = document.createElement('h3');
  title.className = 'card-title text-sm sm:text-base';
  if (link) {
    title.innerHTML = `<a href="${link}" target="_blank" class="link link-primary">${name}</a>`;
  } else {
    title.textContent = name;
  }
  cardBody.appendChild(title);
  
  // Developer info
  if (developer) {
    const devInfo = document.createElement('p');
    devInfo.className = 'text-xs text-base-content/70 -mt-1';
    devInfo.textContent = `by ${developer}`;
    cardBody.appendChild(devInfo);
  }
  
  // Description
  if (description) {
    const desc = document.createElement('p');
    desc.className = 'text-xs sm:text-sm text-base-content/80 line-clamp-2 cursor-pointer hover:text-base-content transition-colors';
    desc.title = 'Click to expand/collapse';
    
    // Store original description
    const originalDescription = description;
    let isExpanded = false;
    
    // Function to update description display
    const updateDescription = () => {
      if (isExpanded) {
        desc.textContent = originalDescription + ' (click to collapse)';
        desc.classList.remove('line-clamp-2');
        desc.classList.add('expanded-description');
      } else {
        // Check if description is long enough to need truncation
        desc.textContent = originalDescription;
        desc.classList.add('line-clamp-2');
        desc.classList.remove('expanded-description');
      }
    };
    
    // Initial display
    updateDescription();
    
    // Add click handler to toggle full description
    desc.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      isExpanded = !isExpanded;
      updateDescription();
    });
    
    cardBody.appendChild(desc);
  }
  
  // Tags
  if (tags.length > 0) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'flex flex-wrap gap-1 mt-2';
    const maxTags = window.innerWidth > 400 ? 4 : 3; // Show more tags on wider panels
    tags.slice(0, maxTags).forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'badge badge-xs badge-outline';
      badge.textContent = tag;
      tagsDiv.appendChild(badge);
    });
    cardBody.appendChild(tagsDiv);
  }
  
  card.appendChild(cardBody);
  return card;
}

function renderCombinedList() {
  // Build a unified list of all detected technologies
  techList.innerHTML = '';
  const added = new Set();
  const allTechs = [];

  // Combine HTML and Header detected technologies
  [...currentTechs, ...currentHeaderTechs].forEach(tech => {
    const techName = typeof tech === 'object' ? tech.name : tech;
    if (!added.has(techName)) {
      allTechs.push(tech);
      added.add(techName);
    }
  });

  if (allTechs.length > 0) {
    allTechs.forEach(tech => {
      const card = createTechCard(tech);
      techList.appendChild(card);
    });
  } else {
    const emptyState = document.createElement('div');
    emptyState.className = 'text-center text-base-content/60 py-8';
    emptyState.innerHTML = '<p>No technologies detected.</p><p class="text-xs mt-1">Try visiting a different website.</p>';
    techList.appendChild(emptyState);
  }
}

function updateTechList(technologies) {
  console.log('updateTechList called', { technologies });
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
  renderCombinedList();
}

function updateHeaderTechs(headerTechs) {
  console.log('updateHeaderTechs called', { headerTechs });
  // Update header-detected technologies
  currentHeaderTechs = Array.isArray(headerTechs) ? headerTechs : [];

  // Re-render combined tech list so header changes are reflected there too
  renderCombinedList();

  // Auto-refresh dump area when header techs update
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
  if (message.action === 'updateTechList') {
    updateTechList(message.technologies);
  } else if (message.action === 'updateHeaderTechs') {
    updateHeaderTechs(message.headerTechs || []);
  } else if (message.action === 'clearTechs') {
    techList.innerHTML = '';
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
      currentHeaderTechs = response.headerTechs || [];
      renderCombinedList();
    }
  });

  // Request content analysis for this tab now that the panel is ready
  try {
    chrome.runtime.sendMessage({ action: 'requestAnalyze', tabId }, () => {});
  } catch (e) {
    // ignore
  }

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
