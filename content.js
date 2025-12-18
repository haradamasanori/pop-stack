if (window !== window.top || window.popstack_ContentScriptInjected) {
  // Avoid running the content script multiple times.
  console.log('pop-stack: content script already exists.', {
    url: window.location.href,
    isMainFrame: window === window.top,
    documentReadyState: document.readyState
  });
} else {
  window.popstack_ContentScriptInjected = true;

  // Content script cannot use ES Modules directly, so we redefine needed utils here.
  const IS_DEV = !('update_url' in chrome.runtime.getManifest());
  function devLog(...messages) {
    if (IS_DEV) {
      console.log(...messages);
    }
  }
  function logWarn(...messages) {
    console.warn('pop-stack:', ...messages);
  }
  function logError(...messages) {
    console.error('pop-stack:', ...messages);
  }

  let techConfig = null;
  let configLoadPromise = null;

  // Load configuration
  async function loadConfig() {
    try {
      const configUrl = chrome.runtime.getURL('config.json');
      const response = await fetch(configUrl);
      techConfig = await response.json();
    } catch (error) {
      logError('Failed to load config.json:', error);
      techConfig = null;
    }
  }

  async function detectHtmlComponents() {
    const detected = [];

    await configLoadPromise;
    if (!techConfig) {
      logWarn('detectHtmlComponents: Config not loaded. Skipping detection.');
      return detected;
    }

    devLog('Detecting ', Object.keys(techConfig).length, ' components from config.');

    let htmlText = null;
    // Iterate through all configured components.
    Object.entries(techConfig).forEach(([key, config]) => {
      const { name, selectors = [], html: htmlPatterns = [], description, link, tags, developer } = config;
      let matchedTexts = [];
      let isDetected = false;

      // Try querySelector patterns first (faster).
      if (selectors.length > 0) {
        for (const selector of selectors) {
          try {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              isDetected = true;

              // Extract meaningful text from matched elements
              elements.forEach((element, index) => {
                if (index >= 5) return; // Limit to 5 elements

                let text = '';
                if (element.tagName === 'SCRIPT' && element.src) {
                  text = element.src;
                } else if (element.tagName === 'LINK' && element.href) {
                  text = element.href;
                } else if (element.tagName === 'META' && element.content) {
                  text = `${element.name || element.property}: ${element.content}`;
                } else if (element.id) {
                  text = `#${element.id}`;
                } else if (element.className) {
                  text = `.${element.className.split(' ')[0]}`;
                } else if (element.getAttribute) {
                  // Try to get a meaningful attribute
                  const attrs = ['data-reactroot', 'data-wf-page', 'hx-get', 'hx-post'];
                  for (const attr of attrs) {
                    const value = element.getAttribute(attr);
                    if (value !== null) {
                      text = `${attr}="${value}"`;
                      break;
                    }
                  }
                  if (!text && element.tagName) {
                    text = `<${element.tagName.toLowerCase()}>`;
                  }
                }

                if (text && text.length > 0) {
                  // Truncate long URLs/text
                  if (text.length > 100) {
                    text = text.substring(0, 97) + '...';
                  }
                  matchedTexts.push(text);
                }
              });

              devLog(`Detected ${name} via querySelector: ${selector} (${elements.length} elements)`);
              break; // Stop after first successful selector
            }
          } catch (error) {
            logWarn(`Invalid selector for ${name}:`, selector, error);
          }
        }
      }

      // Fallback to HTML regex patterns if no selector matches
      if (!isDetected && htmlPatterns.length > 0) {
        // Only construct HTML string if needed for fallback
        if (htmlText === null) {
          htmlText = document.documentElement.outerHTML;
        }

        for (const pattern of htmlPatterns) {
          try {
            const regex = new RegExp(pattern, 'gi');
            let match;
            while ((match = regex.exec(htmlText)) !== null && match.length > 0 && match[0].length > 0) {
              if (!isDetected) isDetected = true;

              // Extract a reasonable snippet around the match
              const matchStart = Math.max(0, match.index - 50);
              const matchEnd = Math.min(htmlText.length, match.index + match[0].length + 50);
              let snippet = htmlText.substring(matchStart, matchEnd).trim();

              // Clean up the snippet - remove excessive whitespace and newlines
              snippet = snippet.replace(/\s+/g, ' ');

              // Truncate if still too long
              if (snippet.length > 150) {
                snippet = snippet.substring(0, 147) + '...';
              }

              if (snippet) {
                matchedTexts.push(snippet);
              }

              // Limit matches to avoid too many results
              if (matchedTexts.length >= 5) break;
            }

            if (isDetected) {
              break; // Stop after first successful pattern
            }
          } catch (error) {
            logError(`Invalid regex pattern for ${name}:`, pattern, error);
          }
        }
      }

      // Add component if detected by either method.
      if (isDetected) {
        detected.push({
          key,
          name,
          description: description || '',
          link: link || '',
          tags: tags || [],
          developer: developer || '',
          matchedTexts: [...new Set(matchedTexts)].slice(0, 5) // Remove duplicates, limit to 5
        });
      }
    });

    devLog('Detected:', { detected });
    return detected;
  }  // detectHtmlComponents

  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    devLog('Content script received message:', message);
    if (message.action === 'fetchAndAnalyzeHtml') {
      const { tabId, tabUrl } = message;
      await configLoadPromise;
      if (!techConfig) {
        logError('Config is not ready. Skipping analysis.');
        return;
      }
      // Fetch the page within content script. This enables getting IP info with webRequest.onComplete in background.js.
      // fetch() can be called in the service worker too but the IP field is missing in the response.
      fetch(tabUrl).then((response) => {
        devLog('pop-stack: Fetched the current page in content.js', response);
        const headers = [];
        for (const [key, value] of response.headers) {
          headers.push({ name: key, value });
        }
        chrome.runtime.sendMessage({ action: 'fetchedHeaders', tabId, tabUrl, headers });
      }).catch((error) => {
        logWarn('Failed to fetch the current page in content.js', error);
      });
      const htmlComponents = await detectHtmlComponents();
      // fetchAndAnalyzeHtml is requested by the sidepanel so it's guaranteed to be ready to receive the message.
      // We can use sendResponse() but using sendMessage() because analysis is done asynchronously and can be slow.
      chrome.runtime.sendMessage({ action: 'htmlResults', tabId, targetUrl: tabUrl, htmlComponents }).then(() => {
        devLog('htmlResults message sent to sidepanel.', tabId, tabUrl, htmlComponents);
      });
    } else {
      logError('Unknown message action:', message.action);
    }
  });

  configLoadPromise = loadConfig();
  configLoadPromise.then(() => {
    devLog('Configuration loaded in content script.', techConfig);
  }).catch((error) => {
    logError('Error loading config in content script:', error);
  });
  devLog('pop-stack: content script loaded successfully', {
    url: window.location.href,
    isMainFrame: window === window.top,
    documentReadyState: document.readyState
  });

}  // window !== window.top || window.popstack_ContentScriptInjected
