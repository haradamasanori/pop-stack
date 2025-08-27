const techList = document.getElementById('tech-list');

function updateTechList(technologies) {
  console.log('updateTechList called', { technologies });
  techList.innerHTML = '';
  if (technologies.length > 0) {
    technologies.forEach(tech => {
      const li = document.createElement('li');
      li.innerHTML = `<a>${tech}</a>`;
      techList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.innerHTML = `<a>No technologies detected.</a>`;
    techList.appendChild(li);
  }
}

function updateHttpHeaders(httpHeaders) {
  console.log('updateHttpHeaders called', { httpHeaders });
  // Render servers and poweredBy at the top of the list
  const fragment = document.createDocumentFragment();
  if (httpHeaders && (httpHeaders.servers?.length || httpHeaders.poweredBy?.length)) {
    if (httpHeaders.servers?.length) {
      const sHeader = document.createElement('li');
      sHeader.innerHTML = `<strong>Server:</strong> ${httpHeaders.servers.join(', ')}`;
      fragment.appendChild(sHeader);
    }
    if (httpHeaders.poweredBy?.length) {
      const pHeader = document.createElement('li');
      pHeader.innerHTML = `<strong>Powered-By:</strong> ${httpHeaders.poweredBy.join(', ')}`;
      fragment.appendChild(pHeader);
    }
    // append a divider
    const divider = document.createElement('li');
    divider.innerHTML = '<hr />';
    fragment.appendChild(divider);
  }
  // Append existing tech list items after headers
  while (techList.firstChild) fragment.appendChild(techList.firstChild);
  techList.appendChild(fragment);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('chrome.runtime.onMessage.addListener called', { message, sender });
  if (message.action === 'updateTechList') {
    updateTechList(message.technologies);
  } else if (message.action === 'updateHttpHeaders') {
    updateHttpHeaders(message.httpHeaders || { servers: [], poweredBy: [] });
  } else if (message.action === 'clearTechs') {
    techList.innerHTML = '';
  }
});

// Request the detected technologies when the side panel is opened
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log('chrome.tabs.query called', { tabs });
  const tabId = tabs[0].id;
  chrome.runtime.sendMessage({ action: 'getDetectedTechs', tabId: tabId }, (response) => {
  console.log('chrome.runtime.sendMessage callback called', { tabId, response });
    if (response) {
      updateTechList(response.technologies || []);
      if (response.httpHeaders) updateHttpHeaders(response.httpHeaders);
    }
  });
});
