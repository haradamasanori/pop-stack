if (window !== window.top || window.webStackSpyContentScriptInjected) {
  // Avoid running the content script multiple times.
  console.log('WebStackSpy content script already exists.', {
    url: window.location.href,
    isMainFrame: window === window.top,
    documentReadyState: document.readyState
  });
} else {
  window.webStackSpyContentScriptInjected = true;

  let techConfig = null;
  let configLoadPromise = null;

  // Load configuration
  async function loadConfig() {
    console.log('loadConfig() called');
    try {
      const configUrl = chrome.runtime.getURL('config.json');
      console.log('Fetching config from:', configUrl);
      const response = await fetch(configUrl);
      console.log('Config fetch response status:', response.status);
      techConfig = await response.json();
      console.log('Configuration loaded successfully:', Object.keys(techConfig).length, 'technologies');
    } catch (error) {
      console.error('Failed to load config.json:', error);
      techConfig = {};
    }
  }

  async function detectTechnologies() {
    console.log('🔍 detectTechnologies called');
    const detected = [];

    await configLoadPromise;
    if (!techConfig) {
      console.warn('⚠️ Configuration not loaded, cannot detect technologies');
      return detected;
    }

    console.log('🔧 Processing', Object.keys(techConfig).length, 'technologies');

    // Iterate through all configured technologies
    Object.entries(techConfig).forEach(([key, config]) => {
      const { name, selectors = [], html: htmlPatterns = [], description, link, tags, developer } = config;
      let matchedTexts = [];
      let isDetected = false;

      // Try querySelector patterns first (faster)
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

              console.log(`Detected ${name} via querySelector: ${selector} (${elements.length} elements)`);
              break; // Stop after first successful selector
            }
          } catch (error) {
            console.warn(`Invalid selector for ${name}:`, selector, error);
          }
        }
      }

      // Fallback to HTML regex patterns if no selector matches
      if (!isDetected && htmlPatterns.length > 0) {
        // Only construct HTML string if needed for fallback
        const html = document.documentElement.outerHTML;

        for (const pattern of htmlPatterns) {
          try {
            const regex = new RegExp(pattern, 'gi');
            let match;
            while ((match = regex.exec(html)) !== null) {
              if (!isDetected) isDetected = true;

              // Extract a reasonable snippet around the match
              const matchStart = Math.max(0, match.index - 50);
              const matchEnd = Math.min(html.length, match.index + match[0].length + 50);
              let snippet = html.substring(matchStart, matchEnd).trim();

              // Clean up the snippet - remove excessive whitespace and newlines
              snippet = snippet.replace(/\s+/g, ' ').replace(/[<>]/g, '');

              // Truncate if still too long
              if (snippet.length > 150) {
                snippet = snippet.substring(0, 147) + '...';
              }

              if (snippet) {
                matchedTexts.push(snippet);
              }

              // Avoid infinite loop with zero-width matches
              if (match[0].length === 0) break;
              // Limit matches to avoid too many results
              if (matchedTexts.length >= 5) break;
            }

            if (isDetected) {
              break; // Stop after first successful pattern
            }
          } catch (error) {
            console.warn(`Invalid regex pattern for ${name}:`, pattern, error);
          }
        }
      }

      // Add technology if detected by either method
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

    console.log('Detected:', { detected });
    return detected;
  }  // detectTechnologies


  function mergeDetectionResults(initial, results) {
    const merged = [...initial];
    const existingKeys = new Set(initial.map(tech => tech.key));

    // Add new technologies from idle detection
    results.forEach(tech => {
      if (!existingKeys.has(tech.key)) {
        merged.push(tech);
        existingKeys.add(tech.key);
      } else {
        // Merge matched texts for existing technologies
        const existingTech = merged.find(t => t.key === tech.key);
        if (existingTech && tech.matchedTexts) {
          const combinedTexts = [...(existingTech.matchedTexts || []), ...(tech.matchedTexts || [])];
          existingTech.matchedTexts = [...new Set(combinedTexts)].slice(0, 5); // Deduplicate and limit
        }
      }
    });

    return merged;
  }

  // async function analyzeContent(tabId, tabUrl) {
  //   console.log('🔍 analyzeContent called');

  //   // Load config on-demand only for HTML pages that need analysis
  //   await configLoadPromise;
  //   if (!techConfig) {
  //     console.error('config is not ready. Skipping analysis.');
  //     return;
  //   }
  //   // if (!techConfig) {
  //   //   console.log('📁 Loading configuration...');
  //   //   await loadConfig();
  //   // }

  //   console.log('🔧 About to call detectTechnologies(), config keys:', techConfig ? Object.keys(techConfig).length : 'NO CONFIG');
  //   const technologies = await detectTechnologies();
  //   console.log('🔍 detectTechnologies() returned:', technologies, 'count:', technologies.length);
  //   console.log('chrome.runtime.sendMessage called', { technologies });

  //   return technologies;
  // }

  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    console.log('📨 Content script received message:', message);
    if (message.action === 'fetchAndAnalyzeHtml') {
      const { tabId, tabUrl } = message;
      await configLoadPromise;
      if (!techConfig) {
        console.error('config is not ready. Skipping analysis.');
        return;
      }
      // Fetch the page within content script. This enables getting IP info with webRequest.onComplete handler in background.js.
      fetch(tabUrl).then((response) => {
        console.log('Fetched in content script! ', response);
        const headers = [];
        for (const [key, value] of response.headers) {
          headers.push({ name: key, value });
        }
        chrome.runtime.sendMessage({ action: 'fetchedHeaders', tabId, tabUrl, headers });
      }).catch((error) => {
        console.warn('Failed to fetch page in content script:', error);
      });
      const htmlComponents = await detectTechnologies();
      // Hack: sidepanel onMessage listener may not be ready yet, so delay a bit.
      // TODO: analyze and send the results twice? Or send results to background.js and have it forward to sidepanel.
      //setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'htmlResults', tabId, targetUrl: tabUrl, htmlComponents }).then(() => {
        console.log('htmlResults message sent to sidepanel.', tabId, tabUrl, htmlComponents);
      });
      //}, 2000);
    } else {
      console.log('❓ Unknown message action:', message.action);
    }
  });

  configLoadPromise = loadConfig();
  // Debug: Log that content script has loaded
  console.log('WebStackSpy content script loaded successfully', {
    url: window.location.href,
    isMainFrame: window === window.top,
    documentReadyState: document.readyState
  });
}

// Note: content script no longer auto-runs analysis on load. Analysis is
// performed when the side panel requests it (via background forwarding).
