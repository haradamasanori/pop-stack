# WebStackSpy

A tool to detect the technology stack of any website.

## 📝 Overview

WebStackSpy is a web technology analysis tool designed to identify the frameworks, libraries, servers, and other technologies used to build a website. By analyzing a website's HTML content, HTTP headers, and domain information, it provides insights into its underlying technology stack.

The project features a clean, modern user interface built with Tailwind CSS and daisyUI.

## ✨ Features

-   **Comprehensive Technology Detection**: Identifies a wide range of technologies including frontend frameworks, CSS libraries, analytics tools, web servers, CDNs, and cloud platforms.
-   **Multiple Detection Methods**: Utilizes various heuristics for detection:
    -   HTML content scanning for specific tags, scripts, or comments.
    -   HTTP header analysis for server signatures and framework-specific headers.
    -   Domain name and DNS record inspection.
-   **Detailed Information**: Provides descriptions, developer information, and official links for each detected technology.
-   **Configurable**: The detection logic is driven by a simple `config.json` file, making it easy to extend and add new technologies.

## 🛠️ Technologies Detected

WebStackSpy can detect a variety of technologies across different categories. Here's a summary based on the current configuration:

| Category                | Examples                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| **Web Frameworks (JS)** | Angular, React, Vue.js, Next.js, Nuxt, Ember.js, Backbone.js, HTMX, jQuery                            |
| **Web Frameworks (PHP)**| Laravel, Symfony, CakePHP, CodeIgniter, Drupal, WordPress, Joomla!                                   |
| **Web Frameworks (PY)** | Django, Reflex, Masonite, TurboGears, web2py                                                         |
| **CSS Frameworks**      | Tailwind CSS, daisyUI, Chakra UI, Sass                                                               |
| **HTTP Servers**        | Nginx, Apache, Express, Varnish, Envoy                                                               |
| **Analytics**           | Google Analytics, Google Tag Manager                                                                 |
| **CDN & Cloud**         | Cloudflare, AWS (CloudFront), Google Cloud Platform, Vercel, Netlify, Heroku, Azure, Akamai, Fastly |
| **CMS**                 | WordPress, Drupal, Joomla!, TYPO3, Squarespace, Webflow, Wix, Framer                                 |

## ⚙️ How It Works

The core of WebStackSpy is the `config.json` file. This file contains a collection of technology definitions, each with a set of rules for detection.

Each technology entry in `config.json` can have the following detection patterns:

-   `html`: An array of regular expressions to match against the website's HTML source.
-   `headers`: An array of regular expressions to match against the HTTP response headers.
-   `domains`: An array of regular expressions to match against the website's domain or related domains (e.g., from CNAME records).

When analyzing a URL, WebStackSpy fetches the website's content and headers, then iterates through the `config.json` to find matches.

### Example Configuration (`react`)

```json
"react": {
    "name": "React",
    "description": "React is a free and open-source front-end JavaScript library...",
    "tags": [
        "web_framework",
        "javascript"
    ],
    "link": "https://reactjs.org/",
    "developer": "Meta",
    "html": [
        "<script[^>]*\\breact[^>]*\\.js",
        "<div[^>]*data-reactroot",
        "<div[^>]*id=\"react-root\""
    ]
}
```

## 🎨 Frontend

The user interface is built with:

-   **Tailwind CSS**: A utility-first CSS framework for rapid UI development.
-   **daisyUI**: A component library for Tailwind CSS, providing a set of pre-styled components. The project uses `daisyui.js` and the compiled `output.css`.
