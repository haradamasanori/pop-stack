const techList = document.getElementById('tech-list');
const headerList = document.getElementById('header-list');
const dumpBtn = document.getElementById('dump-btn');
const dumpArea = document.getElementById('dump-area');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentHttpHeaders = { servers: [], poweredBy: [] };

function renderCombinedList() {
  // Build a merged list: header-derived items first, then HTML-detected techs
  techList.innerHTML = '';
  const added = new Set();

  // Add header-derived entries as readable items
  if (currentHttpHeaders.servers?.length) {
    currentHttpHeaders.servers.forEach(s => {
      const label = `Server: ${s}`;
      const li = document.createElement('li');
      li.innerHTML = `<a>${label}</a>`;
      techList.appendChild(li);
      added.add(label);
    });
  }
  if (currentHttpHeaders.poweredBy?.length) {
    currentHttpHeaders.poweredBy.forEach(p => {
      const label = `X-Powered-By: ${p}`;
      if (!added.has(label)) {
        const li = document.createElement('li');
        li.innerHTML = `<a>${label}</a>`;
        techList.appendChild(li);
        added.add(label);
      }
    });
  }

  // Divider between header-derived and HTML-derived (only if both present)
  if ((currentHttpHeaders.servers?.length || currentHttpHeaders.poweredBy?.length) && currentTechs.length) {
    const divider = document.createElement('li');
    divider.innerHTML = '<hr />';
    techList.appendChild(divider);
  }

  // Add HTML-detected techs, avoiding duplicates
  if (currentTechs.length > 0) {
    currentTechs.forEach(tech => {
      if (added.has(tech)) return;
      const li = document.createElement('li');
      li.innerHTML = `<a>${tech}</a>`;
      techList.appendChild(li);
      added.add(tech);
    });
  }

  if (techList.children.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = `<a>No technologies detected.</a>`;
    techList.appendChild(li);
  }
}

function updateTechList(technologies) {
  console.log('updateTechList called', { technologies });
  currentTechs = Array.isArray(technologies) ? technologies.slice() : [];
  renderCombinedList();
}

function updateHttpHeaders(httpHeaders) {
  console.log('updateHttpHeaders called', { httpHeaders });
  currentHttpHeaders = httpHeaders || { servers: [], poweredBy: [] };
  // Render the separate header list
  headerList.innerHTML = '';
  if (!currentHttpHeaders.servers?.length && !currentHttpHeaders.poweredBy?.length) {
    const li = document.createElement('li');
    li.innerHTML = `<a>No HTTP header detections</a>`;
    headerList.appendChild(li);
  } else {
    if (currentHttpHeaders.servers?.length) {
      const sHeader = document.createElement('li');
      sHeader.innerHTML = `<strong>Server:</strong> ${currentHttpHeaders.servers.join(', ')}`;
      headerList.appendChild(sHeader);
    }
    if (currentHttpHeaders.poweredBy?.length) {
      const pHeader = document.createElement('li');
      pHeader.innerHTML = `<strong>Powered-By:</strong> ${currentHttpHeaders.poweredBy.join(', ')}`;
      headerList.appendChild(pHeader);
    }
  }

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
});
