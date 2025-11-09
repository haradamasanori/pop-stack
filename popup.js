const techList = document.getElementById('tech-list');

// Maintain current state so we can render a merged view
let currentTechs = [];
let currentTabId = null;
let currentTabUrl = null;
let currentDetectionsByUrl = {}; // Store detectionsByUrl for current URL

function createUrlItem(url, counts) {
  // Clone the template
  const template = document.getElementById('url-item-template');
  const item = template.content.cloneNode(true);

  // Get elements
  const urlElement = item.querySelector('[data-url]');
  const countsElement = item.querySelector('[data-counts]');

  // Truncate long URLs with ellipsis in the middle to preserve domain and path
  const truncatedUrl = truncateUrl(url, 60);

  // Format component counts - only show counts that exist
  const countParts = [];
  if (counts.ip !== undefined) countParts.push(`IP ${counts.ip}`);
  if (counts.http !== undefined) countParts.push(`HTTP ${counts.http}`);
  if (counts.html !== undefined) countParts.push(`HTML ${counts.html}`);
  const countsText = countParts.join(', ');

  // Set content
  urlElement.textContent = truncatedUrl;
  urlElement.title = url;
  countsElement.textContent = countsText;

  return item;
}

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
  const descPreviewElement = card.querySelector('[data-description-preview]');
  const matchedTextsCollapsedElement = card.querySelector('[data-matched-texts-collapsed]');
  const matchedTextsListCollapsedElement = card.querySelector('[data-matched-texts-list-collapsed]');
  const matchedTextsExpandedElement = card.querySelector('[data-matched-texts-expanded]');
  const matchedTextsListExpandedElement = card.querySelector('[data-matched-texts-list-expanded]');
  const tagsElement = card.querySelector('[data-tags]');
  const cardElement = card.querySelector('.card');
  const expandIconElement = card.querySelector('[data-expand-icon]');

  // Track expansion state
  let isExpanded = false;

  // Populate title using templates
  const maxTags = window.innerWidth > 400 ? 4 : 3;
  const titleTemplateId = link ? 'tech-card-title-link-template' : 'tech-card-title-no-link-template';
  const titleTemplate = document.getElementById(titleTemplateId);
  const titleContentFragment = titleTemplate.content.cloneNode(true);

  // Set name and link
  const nameElement = titleContentFragment.querySelector('[data-name]');
  nameElement.textContent = name;
  if (link) {
    nameElement.href = link;
  }

  // Set developer info
  const developerContainer = titleContentFragment.querySelector('[data-developer-container]');
  if (developer) {
    titleContentFragment.querySelector('[data-developer]').textContent = developer;
  } else {
    developerContainer.remove();
  }

  // Set tags
  const tagsContainer = titleContentFragment.querySelector('[data-tags-container]');
  if (tags.length > 0) {
    const tagBadgeTemplate = document.getElementById('tag-badge-template');
    tags.slice(0, maxTags).forEach(tagText => {
      const badge = tagBadgeTemplate.content.cloneNode(true);
      badge.querySelector('.badge').textContent = tagText;
      tagsContainer.appendChild(badge);
    });
  }

  titleElement.innerHTML = '<span class="inline"></span>';
  titleElement.firstElementChild.appendChild(titleContentFragment);

  // Set matched texts content
  if (matchedTexts && matchedTexts.length > 0) {
    matchedTextsCollapsedElement.style.display = 'block';

    // Get templates
    const collapsedItemTemplate = document.getElementById('matched-text-item-collapsed-template');
    const expandedItemTemplate = document.getElementById('matched-text-item-expanded-template');
    const moreIndicatorTemplate = document.getElementById('more-matches-indicator-template');

    // Collapsed view - show only first match
    const collapsedItem = collapsedItemTemplate.content.cloneNode(true);
    collapsedItem.querySelector('[data-text]').textContent = matchedTexts[0];
    matchedTextsListCollapsedElement.appendChild(collapsedItem);

    if (matchedTexts.length > 1) {
      const moreIndicator = moreIndicatorTemplate.content.cloneNode(true);
      moreIndicator.querySelector('[data-text]').textContent = `+${matchedTexts.length - 1} more...`;
      matchedTextsListCollapsedElement.appendChild(moreIndicator);
    }

    // Expanded view - show all matches
    matchedTexts.forEach(text => {
      const expandedItem = expandedItemTemplate.content.cloneNode(true);
      expandedItem.querySelector('[data-text]').textContent = text;
      matchedTextsListExpandedElement.appendChild(expandedItem);
    });
  }

  // Set description content
  if (description) {
    // Show preview in collapsed view (first line with ellipsis)
    descPreviewElement.style.display = 'block';
    const firstLine = description.split('\n')[0];
    descPreviewElement.textContent = firstLine;

    // Show full description in expanded view
    descElement.textContent = description;
    descElement.style.whiteSpace = 'pre-wrap';
  }

  // Toggle function
  const updateCardState = () => {
    if (isExpanded) {
      // Show expanded content
      matchedTextsCollapsedElement.style.display = 'none';
      descPreviewElement.style.display = 'none';
      matchedTextsExpandedElement.style.display = matchedTexts && matchedTexts.length > 0 ? 'block' : 'none';
      descElement.style.display = description ? 'block' : 'none';
      // Add expanded styling
      cardElement.classList.add('expanded');
      // Rotate icon to point up
      expandIconElement.style.transform = 'rotate(180deg)';
    } else {
      // Show collapsed content
      matchedTextsCollapsedElement.style.display = matchedTexts && matchedTexts.length > 0 ? 'block' : 'none';
      descPreviewElement.style.display = description ? 'block' : 'none';
      matchedTextsExpandedElement.style.display = 'none';
      descElement.style.display = 'none';
      // Remove expanded styling
      cardElement.classList.remove('expanded');
      // Rotate icon to point down
      expandIconElement.style.transform = 'rotate(0deg)';
    }
  };

  // Initialize collapsed state
  updateCardState();

  // Handle link clicks to prevent toggle
  const links = card.querySelectorAll('a');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });

  // Make entire card clickable
  cardElement.addEventListener('click', (e) => {
    // Don't toggle if clicking on a link
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      return;
    }
    isExpanded = !isExpanded;
    updateCardState();
  });

  // Tags are now displayed inline with the title, so hide the separate tags element
  tagsElement.style.display = 'none';

  return card;
}

function renderUnifiedUrls() {
  const urlsList = document.getElementById('analyzed-urls-list');
  if (!urlsList) return;
  // Clear existing content.
  urlsList.innerHTML = '';

  if (!currentDetectionsByUrl || currentDetectionsByUrl.length === 0) {
    document.getElementById('analyzed-urls-section').style.display = 'none';
    return;
  }

  // Create and append URL items using template
  Object.entries(currentDetectionsByUrl).forEach(([url, detection]) => {
    const counts = {
      ip: detection.ipComponents !== undefined ? detection.ipComponents.length : '?',
      http: detection.headerComponents !== undefined ? detection.headerComponents.length : '?',
      html: detection.htmlComponents !== undefined ? detection.htmlComponents.length : '?'
    };
    const urlItem = createUrlItem(url, counts);
    urlsList.appendChild(urlItem);
  });
  document.getElementById('analyzed-urls-section').style.display = 'block';
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
  // Show analyzed URLs section again if there are URLs to show
  renderUnifiedUrls();
}

function checkAndUpdateReloadSuggestion() {
  if (!currentTabUrl) return;

  const currentUrlDetection = currentDetectionsByUrl[currentTabUrl];
  const hasIpDetection = currentUrlDetection && currentUrlDetection.ipComponents !== undefined;
  const hasHttpDetection = currentUrlDetection && currentUrlDetection.headerComponents !== undefined;


  // Show reload suggestion if either IP or HTTP detection is missing
  if (!hasIpDetection || !hasHttpDetection) {
    showReloadSuggestion();
  } else {
    hideReloadSuggestion();
  }
}

function renderCombinedList() {
  // Render unified URLs list
  renderUnifiedUrls();

  // Build a unified list of all detected technologies
  techList.innerHTML = '';
  let statusMessage = document.getElementById('status-message');

  if (currentTechs.length > 0) {
    currentTechs.forEach(tech => {
      const card = createTechCard(tech);
      techList.appendChild(card);
    });
    statusMessage.textContent = `${currentTechs.length} component${currentTechs.length !== 1 ? 's' : ''} detected`;
  } else {
    techList.innerHTML = '';

    statusMessage.textContent = 'Detecting';
  }
  // Check reload suggestion after a delay
  setTimeout(() => {
    checkAndUpdateReloadSuggestion();
    if (currentTechs.length == 0) {
      statusMessage.textContent = 'No components detected';
    }
  }, 2000); // Wait 2 seconds for content script response
}

function updateCombinedList() {
  // Extract all components for the tech list with deduplication
  const techMap = new Map(); // Use Map to track and merge duplicate technologies

  // Combine all technologies from all URLs, merging duplicates by key
  Object.values(currentDetectionsByUrl).forEach(detection => {
    const headerComponents = detection.headerComponents || [];
    const htmlComponents = detection.htmlComponents || [];
    const ipComponents = detection.ipComponents || [];

    [...headerComponents, ...htmlComponents, ...ipComponents].forEach(tech => {
      if (!techMap.has(tech.key)) {
        // First occurrence - add as is
        techMap.set(tech.key, { ...tech });
      } else {
        // Duplicate found - merge matchedTexts and detection methods
        const existing = techMap.get(tech.key);
        const existingTexts = existing.matchedTexts || [];
        const newTexts = tech.matchedTexts || [];

        // Combine and deduplicate matchedTexts
        const combinedTexts = [...existingTexts, ...newTexts];
        existing.matchedTexts = [...new Set(combinedTexts)].slice(0, 10); // Dedupe and limit to 10
      }
    });
  });

  // Convert Map values to array
  currentTechs = Array.from(techMap.values());

  return currentTechs
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('onMessage received', { message, sender });

  // Only process messages for this tab
  if (!(message.tabId && currentTabId && message.tabId == currentTabId)) {
    console.warn('Popup onMessage: Message tabId does not match currentTabId', message);
    // return;
  }

  if (message.ipComponents) {
    currentDetectionsByUrl[message.targetUrl] = currentDetectionsByUrl[message.targetUrl] || {};
    currentDetectionsByUrl[message.targetUrl].ipComponents = message.ipComponents;
  }

  if (message.headerComponents) {
    currentDetectionsByUrl[message.targetUrl] = currentDetectionsByUrl[message.targetUrl] || {};
    currentDetectionsByUrl[message.targetUrl].headerComponents = message.headerComponents;
  }

  if (message.htmlComponents) {
    currentDetectionsByUrl[message.targetUrl] = currentDetectionsByUrl[message.targetUrl] || {};
    currentDetectionsByUrl[message.targetUrl].htmlComponents = message.htmlComponents;
  }

  updateCombinedList();
  renderCombinedList();
});  // chrome.runtime.onMessage


// Theme management functions
function initializeTheme() {
  const savedTheme = localStorage.getItem('web-stack-spy-theme') || 'light';
  setTheme(savedTheme);
}

function setTheme(theme) {
  const htmlElement = document.documentElement;
  const lightIcon = document.getElementById('theme-icon-light');
  const darkIcon = document.getElementById('theme-icon-dark');

  htmlElement.setAttribute('data-theme', theme);
  localStorage.setItem('web-stack-spy-theme', theme);

  if (theme === 'dark') {
    lightIcon.style.display = 'none';
    darkIcon.style.display = 'block';
  } else {
    lightIcon.style.display = 'block';
    darkIcon.style.display = 'none';
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

// Add reload button and theme toggle functionality
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  initializeTheme();

  // Theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Reload button
  const reloadButton = document.getElementById('reload-button');
  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      if (currentTabId) {
        chrome.tabs.reload(currentTabId, { bypassCache: true });
        hideReloadSuggestion();
      }
    });
  }
});

// Establish connection to background script for panel closure detection
var port = null;

// Request the detected technologies when the side panel is opened.
// Getting the current tab is possible with activeTab permission.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log('chrome.tabs.query called', { tabs });
  const tabId = tabs[0].id;
  const tabUrl = tabs[0].url;
  currentTabId = tabId; // Store current tab ID for message filtering
  currentTabUrl = tabUrl; // Store current tab URL

  // Show target URL immediately
  renderUnifiedUrls();

  // Popup can inject script and send message but it doesn't seem to work in sidepanel.
  // console.log('popup: Injecting content.js into tab', { tabId, tabUrl });
  // chrome.scripting.executeScript({
  //   target: { tabId },
  //   files: ["content.js"],
  // }).then(() => {
  //   console.log('popup: content.js injected while popup opening');
  //   chrome.tabs.sendMessage(tabId, { action: 'analyzeHtml', tabId, tabUrl });
  // }).catch((err) => {
  //   console.warn('popup: failed to inject content.js into tab', err);
  //   chrome.action.setBadgeText({ text: 'ERRO: ', tabId });
  //   chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });
  // });

  port = chrome.runtime.connect({ name: 'popup-' + currentTabId });

  // Request content analysis for this tab now that the panel is ready
  console.log('🚀 popup requesting content analysis', { tabId });
  try {
    port.postMessage({ action: 'analyzeHttp', url: tabUrl, tabId: tabId });
    // postMessages doesn't return a resposne. Popup receives results via onMessage listener.
    // 'analyze' should be sent from the service worker.
    // chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (response) => {
    //   if (chrome.runtime.lastError) {
    //     console.warn('⚠️ Failed to send analyze message to content script:', chrome.runtime.lastError.message);
    //   } else {
    //     console.log('✅ Analyze message sent successfully to content script');
    //   }
    // });
  } catch (e) {
    console.error('❌ Exception sending analyze message:', e);
  }

  // Check reload suggestion after a delay
  //setTimeout(() => {
  //  checkAndUpdateReloadSuggestion();
  //}, 2000); // Wait 2 seconds for content script response
});

// Experimenttal: Inject content script on tab updates from popup.
try {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!(info && (info.status === 'loading' || info.status === 'complete')))
      return;
    currentTabId = tabId;
    currentTabUrl = tab.url;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).then(() => {
      console.log('popup: content.js injected successfully on tab update');
    }).catch((err) => {
      console.warn('Failed to inject content script:', chrome.runtime.lastError.message);
      chrome.action.setBadgeText({ text: 'ERR0: ', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId: tab.id });
    });
  });
} catch (e) {
  console.error('popup: Error adding tabs.onUpdated listener in popup:', e);
}

// Experimenttal: webRequest.onCompleted listener from popup.
// try {
//   console.log('popup: Attempting to register webRequest.onCompleted listener for IP detection');
//   chrome.webRequest.onCompleted.addListener((details) => {
//       console.log('popup: webRequest.onCompleted', { details });

//       // IP address detection runs regardless of HTTP response code.
//       if (details.ip) {
//         try {
//           const requestUrl = new URL(details.url);
//           console.info('popup: webRequest.onCompleted working:', requestUrl);
//         } catch (error) {
//           console.warn('popup: webRequest.onCompleted error:', error);
//         }
//       }
//     },
//     { urls: ['<all_urls>'], types: ['main_frame'] }
//   );
//   console.log('popup: webRequest.onCompleted listener registered for IP detection');
// } catch (e) {
//   console.warn('popup: webRequest.onCompleted not available or blocked', e);
// }
