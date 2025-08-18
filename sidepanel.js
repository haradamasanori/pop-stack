const techList = document.getElementById('tech-list');

function updateTechList(technologies) {
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
  if (message.action === 'updateTechList') {
    updateTechList(message.technologies);
  }
});

// Request the detected technologies when the side panel is opened
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0].id;
  chrome.runtime.sendMessage({ action: 'getDetectedTechs', tabId: tabId }, (response) => {
    if (response && response.technologies) {
      updateTechList(response.technologies);
    }
  });
});
