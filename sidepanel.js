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

  // Clone the template
  const template = document.getElementById('tech-card-template');
  const card = template.content.cloneNode(true);

  // Get elements
  const titleElement = card.querySelector('[data-title]');
  const descElement = card.querySelector('[data-description]');
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
    chrome.runtime.sendMessage({ action: 'requestAnalyze', tabId }, () => { });
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
