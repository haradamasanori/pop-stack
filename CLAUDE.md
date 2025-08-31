# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web Stack Spy is a Chrome Manifest V3 extension that analyzes web pages to detect technologies like frameworks, libraries, and servers. It provides a tab-specific side panel that shows both HTML-based detections (from page content) and HTTP-based detections (from response headers).

## Development Commands

Since this is a Chrome extension without a build process, there are no npm scripts or build commands. Development is done by:

1. Loading the extension in Chrome developer mode:
   - Navigate to `chrome://extensions`
   - Enable "Developer mode" 
   - Click "Load unpacked" and select this repository folder

2. Testing changes:
   - Make code changes to `.js`, `.html`, or `.css` files
   - Go to `chrome://extensions` and click the reload button for the extension
   - Test functionality on web pages

## Architecture

### Core Components

- **manifest.json**: Extension configuration with permissions for `scripting`, `sidePanel`, `webNavigation`, `webRequest`, and `tabs`
- **background.js**: Service worker that manages side panel lifecycle, HTTP header detection via webRequest API, and message routing between components
- **content.js**: Content script injected into all pages that analyzes HTML for technology patterns
- **sidepanel.js**: Side panel UI script that renders combined detection results and manages user interactions
- **sidepanel.html/css**: Side panel interface

### State Management Architecture

The extension uses a sophisticated per-tab state management system optimized for performance:

- **Analysis Trigger**: Analysis only runs when the user opens the side panel for a tab (not automatically on page load)
- **Per-Tab Storage**: `background.js` maintains a `Map` of detection results keyed by tab ID
- **Ready Panels Tracking**: `readyPanels` Set tracks which tabs currently have active side panel instances
- **Dual Detection Sources**: 
  - HTML-based: Content script analyzes DOM using regex patterns in `content.js:1-23`
  - HTTP-based: Background script inspects response headers via webRequest API in `background.js:33-69`

### Message Passing Flow

1. User clicks extension action → `background.js:77-104` opens side panel
2. Side panel loads → `sidepanel.js:135-171` sends `panelReady` message
3. Background registers tab as ready → `background.js:224-235`
4. Background requests content analysis → `background.js:242-247`
5. Content script analyzes and sends results → `content.js:39-55`
6. Background forwards to side panel → UI updates in `sidepanel.js:105-115`

### Navigation Handling

- **Origin Changes**: When tab navigates to different origin, cached HTTP headers are cleared in `background.js:147-162`
- **Same-Origin Navigation**: HTML detections are cleared but HTTP headers persist until new headers arrive
- **Tab Cleanup**: When tabs close, all stored state is cleaned up in `background.js:117-131`

### Technology Detection Patterns

Content script uses regex patterns to detect technologies from HTML source in `content.js:1-23`. Patterns match meta tags, script tags, and link tags for frameworks, CMSs, and CSS libraries.

### Performance Considerations

- No automatic analysis on page load - only when side panel is active
- HTTP header inspection only occurs for tabs with active side panels  
- State is maintained per-tab to support multiple concurrent analyses
- Cleanup occurs on tab close and origin changes to prevent memory leaks