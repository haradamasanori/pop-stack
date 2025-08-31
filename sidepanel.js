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
    // Show "Server:" header once, then list each server as separate row
    const headerLi = document.createElement('li');
    headerLi.innerHTML = `<strong>Server:</strong>`;
    techList.appendChild(headerLi);
    
    currentHttpHeaders.servers.forEach(s => {
      if (!added.has(s)) {
        const li = document.createElement('li');
        li.innerHTML = `<a style="margin-left: 20px;">${s}</a>`;
        techList.appendChild(li);
        added.add(s);
      }
    });
  }
  if (currentHttpHeaders.poweredBy?.length) {
    // Show "X-Powered-By:" header once, then list each value as separate row
    const headerLi = document.createElement('li');
    headerLi.innerHTML = `<strong>X-Powered-By:</strong>`;
    techList.appendChild(headerLi);
    
    currentHttpHeaders.poweredBy.forEach(p => {
      if (!added.has(p)) {
        const li = document.createElement('li');
        li.innerHTML = `<a style="margin-left: 20px;">${p}</a>`;
        techList.appendChild(li);
        added.add(p);
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
  // Deduplicate technologies array
  currentTechs = Array.isArray(technologies) ? [...new Set(technologies)] : [];
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
  const li = document.createElement('li');
  li.innerHTML = `<a>HTTP headers shown in main list below</a>`;
  headerList.appendChild(li);

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
