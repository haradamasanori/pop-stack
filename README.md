Web Stack Spy
===============

A small Chrome Manifest V3 extension that analyzes web pages and exposes a tab-specific side panel.

What changed
------------
- The background service worker enables and opens the side panel only for the tab where the user clicks the extension action.
- The background script automatically disables the tab-specific side panel when the tab is switched or closed.

How to load locally (Developer mode)
------------------------------------
1. Open Chrome and navigate to chrome://extensions
2. Enable "Developer mode" (toggle in the top-right)
3. Click "Load unpacked" and select this repository folder (`webstackspy`)

How to test
-----------
1. Open two tabs (A and B) with arbitrary pages.
2. Click the extension action in tab A. The side panel should open and show the extension's `sidepanel.html` content in tab A only.
3. Switch to tab B — the extension should have disabled the side panel for tab A (so it won't remain active on other tabs).
4. Click the extension action in tab B — the panel should enable and open for tab B, and be disabled for any previous tab where it was open.

Notes
-----
- The extension relies on Chrome 116+ side panel APIs (check availability in your Chrome version).
- There is defensive error handling to tolerate older Chrome versions that may not fully support all `sidePanel` APIs.

HTTP response header inspection
------------------------------
This extension now inspects HTTP response headers using the `webRequest` API to detect server and framework hints (for example `Server: nginx` or `X-Powered-By`). The detected header information is merged with content-script detections and shown in the side panel.

Permissions: the extension requests the `webRequest` permission to read response headers for loaded pages.

Next steps (optional)
---------------------
- Add an options page to let users choose global vs tab-specific behavior.
- Add unit tests or an automated test harness.

State management
----------------
In order to minimize the negative impact to browsing performance, analysis is done only when the user has activated the extension by clicking the action button and opening the side panel.

- The side panel is opened and closed by the user with the action button.
- Analysis is performed only on tabs where the side panel is opened.
  - Multiple tabs can have the side panel opened at the same time.
- sidepanel.js keeps detection states of all tabs of the window in a map variable.
  - Key is tab id. 
  - Value is a map containing the url, HTML-based results, and HTTP-based results. 
- The sidepanel updates HTML content as the result map of the current tab changes.
- When a tab is closed, its entry is removed from the result map.
- When a tab is newly opened, no analysis is performed because the side panel is closed by default.
- When user switches tabs, the sidepanel renders the results for the current tab in the result map.
- When the side panel is opened on an existing tab, sidepanel.js sends a message to the tab's content script to analyze HTML. HTTP-based results are expected to be missing until the page is reloaded.
- When the tab navigates to a new url (including reloading the current url), the current result of the tab is cleared first and then both HTML-based and HTTP-based analysis will happen.
- Closing the side panel doesn't clear the results. Re-opening the side panel and it immediately shows the results stored in the map.

Hints for implementing the above requirements:
- Setting PanelBehavior with openPanelOnActionClick: true is sufficient to toggle the side panel with the action button.  The extension doesn't register a global side panel in the manifest.
- Chrome Extension side panel's open/close state is per tab if we set PanelOptions without tabId field.
- Messages are passed between content.js and sidepanel.js. background.js can contain minimal initialization code that should run before the side panel is opened.
- When there are multiple Chrome windows, different windows have different side panel instances. Each side panel instance can handle tabs on the same window only.
- Tab ids are unique across multiple windows. No need to use window id to separate them.
