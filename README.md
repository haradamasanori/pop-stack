Web Stack Spy
===============

A small Chrome Manifest V3 extension that analyzes web pages and exposes a tab-specific side panel.

What changed
------------
- The extension no longer registers a global side panel in the manifest.
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
