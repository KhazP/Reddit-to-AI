# Reddit AI Tool - Chrome Extension

## 1. Overview

Reddit AI Tool is a Chrome browser extension designed to streamline the process of analyzing Reddit threads using AI. It allows users to quickly scrape the content of an active Reddit thread (including the original post and all comments) and send this data to an AI chat interface (initially targeting Google's Gemini) for summarization, analysis, or discussion.

This tool aims to solve the problem of manual, tedious copy-pasting of extensive Reddit content, enabling researchers, avid Reddit users, and anyone curious to gain insights from online discussions more efficiently.

## 2. Core MVP Features

* **Comprehensive Reddit Scraping:**
    * Extracts the main post details: title, subreddit, author, text content, image URLs, and link URLs from the post body.
    * Scrapes all comments from the thread, including nested replies and their hierarchy.
    * Handles dynamically loaded comments ("load more" buttons).
    * Provides an option to include/exclude potentially hidden or spam comments.
* **AI Platform Integration (MVP Target: Gemini):**
    * Automatically opens the Gemini web UI (`https://gemini.google.com/app`) in a new tab.
    * Attempts to programmatically paste the collected Reddit content (formatted for readability and hierarchy) into Gemini's chat input field.
* **User-Friendly Interface:**
    * A simple browser action button (icon in the Chrome toolbar).
    * A popup UI with a primary button to initiate scraping/pasting and a toggle for comment inclusion.
* **Fallback Mechanism:**
    * If direct pasting into Gemini fails (e.g., due to UI changes), the extension copies the formatted content to the clipboard and notifies the user to paste it manually.
* **Basic Error Handling:**
    * Provides user notifications for critical errors during the process.

## 3. How It Works (Technical Overview)

The extension operates using Chrome's Manifest V3 architecture:

1.  **Popup (`popup.html`, `popup.js`, `popup.css`):** The user clicks the extension icon, which opens a small popup. The user can select options (like including hidden comments) and click the "Scrape and Send to Gemini" button. This action sends a message to the service worker.
2.  **Service Worker (`service_worker.js`):** This background script orchestrates the entire process.
    * It receives the request from the popup.
    * It implements a lock (`isScraping`) to prevent multiple concurrent scraping operations.
    * It injects the `redditScraper.js` content script into the active Reddit tab.
    * It sends a message to `redditScraper.js` to begin scraping.
    * Upon receiving the scraped data from `redditScraper.js`, it stores this data temporarily in `chrome.storage.local`.
    * It opens a new tab for Gemini.
    * Once the Gemini tab is loaded, it injects `geminiPaster.js`.
    * It messages `geminiPaster.js` to retrieve the data from storage and paste it.
    * It handles responses and cleans up storage.
3.  **Reddit Content Script (`redditScraper.js`):**
    * Injected into the active Reddit page.
    * Scrapes post details (title, author, content, images, links).
    * Scrapes comments, handling "load more" buttons (using programmatic clicks and `MutationObserver` to detect new content).
    * Builds a hierarchical tree of comments and their replies.
    * Extracts comment metadata (author, score, timestamp where available).
    * Cleans the extracted text to remove UI noise.
    * Sends the structured data (JSON object) back to the service worker.
4.  **Gemini Paster Script (`geminiPaster.js`):**
    * Injected into the Gemini web page.
    * Retrieves the scraped Reddit data from `chrome.storage.local`.
    * Formats the data into a readable string, preserving comment hierarchy with indentation and markers.
    * Attempts to find Gemini's chat input field using CSS selectors.
    * Programmatically pastes the formatted content, dispatching necessary DOM events.
    * If direct pasting fails, it copies the content to the clipboard and messages the service worker to notify the user.
5.  **Data Handling:** Scraped data is stored only temporarily on the user's local machine (`chrome.storage.local`) for the duration of the operation and is not transmitted to any external servers by the extension itself.

## 4. Installation

As this extension is currently under development, it needs to be loaded as an unpacked extension:

1.  Download or clone the project repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions`.
3.  Enable "Developer mode" using the toggle switch (usually in the top-right corner).
4.  Click the "Load unpacked" button.
5.  Select the directory where you downloaded/cloned the project files (the directory containing `manifest.json`).
6.  The "Reddit AI Tool" should now appear in your list of extensions and its icon in the Chrome toolbar.

## 5. Usage

1.  Navigate to a Reddit thread page you want to analyze.
2.  Click the "Reddit AI Tool" icon in the Chrome toolbar.
3.  The popup will appear. You can choose to "Include hidden/spam comments" using the toggle.
4.  Click the "Scrape and Send to Gemini" button.
5.  The extension will scrape the content, open a new tab for Gemini, and attempt to paste the content.
6.  If direct pasting fails, you'll receive a notification that the content has been copied to your clipboard, and you can then manually paste it into Gemini.

## 6. Tech Stack

* **Platform:** Google Chrome Extension (Manifest V3)
* **Core Logic:** Vanilla JavaScript (ES6+)
* **User Interface (Popup):** HTML, CSS, Vanilla JavaScript
* **APIs:**
    * Chrome Extension APIs: `chrome.tabs`, `chrome.storage`, `chrome.scripting`, `chrome.notifications`, `chrome.action`, `chrome.runtime`.
    * DOM Manipulation for web page interaction.
* **Key Browser Features Used:** `MutationObserver` for dynamic content.

## 7. File Structure (Key Files)

├── manifest.json             # Defines the extension, permissions, and components├── service_worker.js         # Background script for orchestration├── popup.html                # HTML for the browser action popup├── popup.js                  # JavaScript for popup interactions├── popup.css                 # CSS for popup styling├── redditScraper.js          # Content script for scraping Reddit├── geminiPaster.js           # Content script for pasting into Gemini├── images/                   # Directory for extension icons│   ├── icon16.png│   ├── icon48.png│   └── icon128.png└── README.md                 # This file└── docs/                     # (Contains PRD, Tech Design Doc, Research)├── PRD-MVP.txt├── Tech-Design-MVP.txt└── DeepResearch.txt
## 8. Current Status & Known Issues

* **Core Scraping & Pasting:** The basic flow of scraping Reddit post details, comments (including hierarchy), and pasting into Gemini is functional.
* **Gemini Interaction:** Pasting into Gemini relies on specific DOM selectors which can change if Google updates the Gemini UI. A fallback to clipboard is implemented.
* **Content Cleaning:**
    * **Post Content:** Currently includes raw HTML from the post body. Needs refinement to extract clean, readable text.
    * **Comment Text:** Efforts are ongoing to reliably remove metadata (author, timestamps, action links) and ensure only the user-written comment text is extracted. The current cleaning is imperfect.
* **"Load More Comments":** The logic for handling "load more comments" and ensuring all comments are fetched is complex and may require further refinement for very long or unusually structured threads.
* **Error Handling:** Basic error notifications are in place. More granular error reporting could be added.

## 9. Future Enhancements (Post-MVP)

* **Support for Other AI Platforms:** Integrate with Claude, ChatGPT, Grok, etc.
* **Advanced Content Formatting:** Option to preserve or convert Reddit markdown.
* **Multiple Prompt Buttons:** Allow users to select predefined prompts/tasks for the AI to perform on the scraped content (e.g., "Summarize comments," "Analyze OP's question").
* **Custom User Prompts:** Allow users to input their own custom prompt to be sent with the scraped data.
* **User Configuration:** Options page for setting default AI, comment inclusion preferences, etc.
* **Video/Complex Media Scraping:** Extend scraping capabilities (e.g., for integration with tools like Google AI Studio for video analysis).
* **Improved UI/UX:** More polished popup, progress indicators.

## 10. Development Notes

* **Testing:** Thoroughly test on diverse Reddit threads (text, image, link posts; short and long threads; various comment structures).
* **DOM Selectors:** Reddit's and Gemini's DOM can change frequently. Selectors in `redditScraper.js` and `geminiPaster.js` are the most likely parts to require updates. Prioritize stable selectors (e.g., `data-testid`, ARIA roles) where possible.
* **Debugging:** Use the Chrome Developer Tools extensively:
    * Service Worker console: Accessible via `chrome://extensions` -> Reddit AI Tool -> "Service worker".
    * Content Script console: Accessible via Developer Tools on the Reddit tab (for `redditScraper.js`) or Gemini tab (for `geminiPaster.js`).
    * Popup console: Right-click the extension icon -> "Inspect popup".

## 11. Disclaimer

This tool interacts with the Document Object Model (DOM) of Reddit and Gemini. Changes to the structure of these websites may break the extension's functionality, requiring updates to the scraping and pasting logic. The extension is provided as-is, and its reliability depends on the stability of the websites it interacts with.