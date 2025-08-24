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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('chrome.runtime.onMessage.addListener called', { message, sender });
  if (message.action === 'updateTechList') {
    updateTechList(message.technologies);
  }
});

// Request the detected technologies when the side panel is opened
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log('chrome.tabs.query called', { tabs });
  const tabId = tabs[0].id;
  chrome.runtime.sendMessage({ action: 'getDetectedTechs', tabId: tabId }, (response) => {
  console.log('chrome.runtime.sendMessage callback called', { tabId, response });
    if (response && response.technologies) {
      updateTechList(response.technologies);
    }
  });
});
