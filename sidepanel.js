const techList = document.getElementById('tech-list');
const headerList = document.getElementById('header-list');
const dumpBtn = document.getElementById('dump-btn');
const dumpArea = document.getElementById('dump-area');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentHttpHeaders = { servers: [], poweredBy: [] };

function createTechCard(tech) {
  const isRichObject = typeof tech === 'object' && tech.name;
  const name = isRichObject ? tech.name : tech;
  const description = isRichObject ? tech.description : '';
  const link = isRichObject ? tech.link : '';
  const tags = isRichObject ? tech.tags : [];
  const developer = isRichObject ? tech.developer : '';

  const card = document.createElement('div');
  card.className = 'card bg-base-200 shadow-sm';
  
  const cardBody = document.createElement('div');
  cardBody.className = 'card-body p-3';
  
  // Title with optional link
  const title = document.createElement('h3');
  title.className = 'card-title text-sm';
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
    desc.className = 'text-xs text-base-content/80 line-clamp-2';
    desc.textContent = description;
    cardBody.appendChild(desc);
  }
  
  // Tags
  if (tags.length > 0) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'flex flex-wrap gap-1 mt-1';
    tags.slice(0, 3).forEach(tag => {
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
  // Build a merged list: header-derived items first, then HTML-detected techs
  techList.innerHTML = '';
  const added = new Set();

  // Add header-derived entries as cards
  if (currentHttpHeaders.servers?.length) {
    const serverHeader = document.createElement('h4');
    serverHeader.className = 'text-sm font-semibold mb-2 text-base-content/80';
    serverHeader.textContent = 'Server:';
    techList.appendChild(serverHeader);
    
    currentHttpHeaders.servers.forEach(s => {
      if (!added.has(s)) {
        const card = createTechCard({ name: s, description: 'HTTP Server', tags: ['http_server'] });
        techList.appendChild(card);
        added.add(s);
      }
    });
  }
  
  if (currentHttpHeaders.poweredBy?.length) {
    const poweredByHeader = document.createElement('h4');
    poweredByHeader.className = 'text-sm font-semibold mb-2 mt-4 text-base-content/80';
    poweredByHeader.textContent = 'X-Powered-By:';
    techList.appendChild(poweredByHeader);
    
    currentHttpHeaders.poweredBy.forEach(p => {
      if (!added.has(p)) {
        const card = createTechCard({ name: p, description: 'Web Framework/Runtime', tags: ['web_framework'] });
        techList.appendChild(card);
        added.add(p);
      }
    });
  }

  // Add HTML-detected techs as rich cards, avoiding duplicates
  if (currentTechs.length > 0) {
    if (currentHttpHeaders.servers?.length || currentHttpHeaders.poweredBy?.length) {
      const htmlHeader = document.createElement('h4');
      htmlHeader.className = 'text-sm font-semibold mb-2 mt-4 text-base-content/80';
      htmlHeader.textContent = 'Detected from HTML:';
      techList.appendChild(htmlHeader);
    }
    
    currentTechs.forEach(tech => {
      const techName = typeof tech === 'object' ? tech.name : tech;
      if (added.has(techName)) return;
      
      const card = createTechCard(tech);
      techList.appendChild(card);
      added.add(techName);
    });
  }

  if (techList.children.length === 0) {
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

function updateHttpHeaders(httpHeaders) {
  console.log('updateHttpHeaders called', { httpHeaders });
  // Deduplicate arrays to ensure no duplicate servers/poweredBy values
  currentHttpHeaders = {
    servers: httpHeaders?.servers ? [...new Set(httpHeaders.servers)] : [],
    poweredBy: httpHeaders?.poweredBy ? [...new Set(httpHeaders.poweredBy)] : []
  };
  // Hide the separate header list since we show everything in the combined list
  headerList.innerHTML = '';

  // Re-render combined tech list so header changes are reflected there too
  renderCombinedList();

  // Auto-refresh dump area when headers update
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
  } else if (message.action === 'updateHttpHeaders') {
  updateHttpHeaders(message.httpHeaders || { servers: [], poweredBy: [] });
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
      currentHttpHeaders = response.httpHeaders || { servers: [], poweredBy: [] };
      renderCombinedList();
      updateHttpHeaders(currentHttpHeaders);
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
