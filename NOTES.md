# NOTES.md

## Project Overview
* **Product Name**: Reddit AI Tool (Source: PRD-MVP.txt, Section 1)
* **Core Purpose**: To eliminate the tedious manual copy-pasting of Reddit thread content into AI chatbots, enabling users to efficiently use AI for summarizing, analyzing, or discussing Reddit content. (Source: PRD-MVP.txt, Section 1)
* **MVP Goal**:
    * Enable users to automatically scrape the full content (post title, subreddit, main content, images, links, and all comments including replies and hidden ones) of an open Reddit thread. (Source: PRD-MVP.txt, Section 1)
    * Enable users to paste this consolidated content into the Gemini AI chat interface (`https://gemini.google.com/app`) with a single action. (Source: PRD-MVP.txt, Section 1)
* **Target Audience**: Individuals seeking deeper understanding of Reddit threads, researchers, avid Reddit users, and power users. (Source: PRD-MVP.txt, Section 2)

## Technical Specifications (from Tech Design Doc - Tech-Design-MVP.txt)
* **Platform**: Google Chrome Extension (Manifest V3). (Source: Tech-Design-MVP.txt, Section 1)
* **Tech Stack (Frontend - Popup)**: HTML, CSS, Vanilla JavaScript. (Source: Tech-Design-MVP.txt, Section 2)
* **Tech Stack (Backend/Core - Service Worker, Content Scripts)**: Vanilla JavaScript (ECMAScript 6+), Manifest V3. (Source: Tech-Design-MVP.txt, Section 2)
* **Key Libraries/APIs**:
    * Chrome Extension APIs: `chrome.tabs`, `chrome.storage`, `chrome.scripting`, `chrome.notifications`, `chrome.action`, `chrome.runtime`. (Source: Tech-Design-MVP.txt, Section 2)
    * No direct AI Model API; interacts with Gemini web UI via DOM manipulation. (Source: Tech-Design-MVP.txt, Section 2)
    * No other external libraries for MVP. (Source: Tech-Design-MVP.txt, Section 2)
* **Architecture Overview**:
    * **Browser Action & Popup (`popup.js`, `popup.html`, `popup.css`):** UI for initiating scraping and setting comment options. Messages Service Worker. (Source: Tech-Design-MVP.txt, Section 3)
    * **Service Worker (`service_worker.js`):** Coordinates scraping and pasting, injects content scripts, manages data via `chrome.storage.local`, opens AI tab. (Source: Tech-Design-MVP.txt, Section 3)
    * **Reddit Content Script (`redditScraper.js`):** Injected into Reddit tab, scrapes post and comments, handles dynamic content (potentially with `MutationObserver`), sends data to Service Worker. (Source: Tech-Design-MVP.txt, Section 3)
    * **Gemini Interaction Script (dynamically injected):** Injected into Gemini tab, retrieves data from `chrome.storage.local`, formats it, and pastes into Gemini's input field using DOM manipulation and event dispatching. (Source: Tech-Design-MVP.txt, Section 3)
* **Data Handling Notes**: Scraped content stored temporarily in `chrome.storage.local` for the operation's duration. Data is cleared after use. No transmission to third-party servers by the extension itself. (Source: Tech-Design-MVP.txt, Section 6)
* **Error Handling Approach**: Basic `try...catch` blocks. Use `chrome.notifications.create` for user-friendly messages on critical failures. Log errors to console. (Source: Tech-Design-MVP.txt, Section 5)

## Core MVP Features & Implementation Plan (from PRD & Tech Design Doc)

### Feature: Reddit Post Scraping
* **Description**: Extract the main post details from the active Reddit tab, including title, subreddit name, main text content, post URL, image URLs, and link URLs within the post body. (Source: PRD-MVP.txt, Section 4)
* **Key Acceptance Criteria/User Story**: "As an avid Reddit user, I want to automatically send the entire content of a Reddit thread to an AI chat..." (implicitly covers getting post details). (Source: PRD-MVP.txt, Section 3)
* **Technical Implementation Notes**:
    * Implement in `redditScraper.js`.
    * Use `document.querySelectorAll` with robust selectors (e.g., `data-testid`, ARIA roles, stable structural patterns). (Source: Tech-Design-MVP.txt, Section 4)
* **Agent Implementation Steps (Suggested)**:
    1.  In `redditScraper.js`, create functions to identify and extract:
        * Post title.
        * Subreddit name.
        * Post URL (from `window.location.href`).
        * Main text content of the post.
        * Image URLs (`<img>` src attributes) within the post.
        * Link URLs (`<a>` href attributes) within the post.
    2.  Structure this data into a part of the JSON object to be sent to the service worker.

### Feature: Comprehensive Comment Scraping
* **Description**: Extract all comments from the thread, including nested replies. Implement functionality to handle dynamically loaded comments ("load more comments" buttons) and collapsed/hidden comments. (Source: PRD-MVP.txt, Section 4)
* **Key Acceptance Criteria/User Story**: Users should receive all comments, including replies, for comprehensive analysis by the AI.
* **Technical Implementation Notes**:
    * Implement in `redditScraper.js`.
    * Handle "load more comments" buttons by programmatic clicks. (Source: Tech-Design-MVP.txt, Section 4)
    * Use `MutationObserver` to process dynamically added comments. (Source: Tech-Design-MVP.txt, Section 4)
    * Recursively traverse comment trees to capture replies and their nesting depth.
* **Agent Implementation Steps (Suggested)**:
    1.  In `redditScraper.js`, develop a function to identify and click all "load more comments" or "view more replies" buttons until none are left or a reasonable limit is hit.
    2.  Implement a `MutationObserver` to listen for new comment elements being added to the DOM after clicks.
    3.  Create a recursive function to traverse comment elements, extracting author, text, and reply structure.
    4.  Store comments (with author, text, depth, replies) in the JSON object.

### Feature: Scraping Option for Hidden Comments
* **Description**: Provide a user interface option (e.g., a toggle/checkbox) to allow users to choose whether to include comments that might be hidden or considered spam. (Source: PRD-MVP.txt, Section 4)
* **Key Acceptance Criteria/User Story**: Users can control the inclusiveness of comment scraping.
* **Technical Implementation Notes**:
    * The toggle will be in `popup.html`. Its state is read by `popup.js` and passed to `service_worker.js`, then to `redditScraper.js`. (Source: Tech-Design-MVP.txt, Section 4)
    * `redditScraper.js` will conditionally include/exclude comments based on this option. (Source: Tech-Design-MVP.txt, Section 4)
* **Agent Implementation Steps (Suggested)**:
    1.  In `popup.html`, add a checkbox/toggle input for "Include hidden/spam comments."
    2.  In `popup.js`, retrieve the state of this toggle when the main action button is clicked.
    3.  Pass this state in the message to `service_worker.js`.
    4.  `service_worker.js` passes this option to `redditScraper.js` when executing the script (e.g., as an argument to the main scraping function).
    5.  In `redditScraper.js`, modify comment selection logic to respect this option.

### Feature: Open AI Platform (Gemini)
* **Description**: Automatically open a new browser tab navigating to Gemini (`https://gemini.google.com/app`). (Source: PRD-MVP.txt, Section 4)
* **Key Acceptance Criteria/User Story**: The extension seamlessly transitions the user to the AI platform.
* **Technical Implementation Notes**:
    * Implement in `service_worker.js`.
    * Use `chrome.tabs.create({ url: "https://gemini.google.com/app", active: true })`. (Source: Tech-Design-MVP.txt, Section 4)
    * Listen to `chrome.tabs.onUpdated` for the new tab's ID, wait for `changeInfo.status === 'complete'` before injecting the Gemini interaction script. (Source: Tech-Design-MVP.txt, Section 4)
* **Agent Implementation Steps (Suggested)**:
    1.  In `service_worker.js`, after receiving scraped data and storing it, call `chrome.tabs.create()` with the Gemini URL.
    2.  In the callback of `chrome.tabs.create()`, set up a `chrome.tabs.onUpdated` listener specifically for the created `tab.id`.
    3.  Inside the listener, check if `tabId` matches and `changeInfo.status === 'complete'`. If so, proceed to inject the Gemini interaction script and remove the listener.

### Feature: Content Pasting (into Gemini)
* **Description**: Programmatically paste the collected and formatted Reddit content (post details and comments) into the Gemini chat input field. (Source: PRD-MVP.txt, Section 4)
* **Key Acceptance Criteria/User Story**: Scraped content appears in Gemini's input field ready for the user to submit. This is a high-risk feature.
* **Technical Implementation Notes**:
    * Logic implemented in a script dynamically injected into the Gemini tab by `service_worker.js`. (Source: Tech-Design-MVP.txt, Section 3)
    * Retrieve data from `chrome.storage.local`. (Source: Tech-Design-MVP.txt, Section 3)
    * Format data as a single plain text string. (Source: Tech-Design-MVP.txt, Section 3)
    * Reliably identify Gemini's chat input field (selector needs careful inspection, verification, and is prone to change). (Source: Tech-Design-MVP.txt, Section 4)
    * Use `element.focus()`, set value/textContent, and dispatch `'input'` event (and potentially others). (Source: Tech-Design-MVP.txt, Section 4)
    * **Critical**: This part requires early prototyping and is prone to breakage due to UI changes on Gemini's side. (Source: Tech-Design-MVP.txt, Section 4)
* **Agent Implementation Steps (Suggested)**:
    1.  `service_worker.js`: Define a function to be injected into the Gemini tab using `chrome.scripting.executeScript`.
    2.  **Injected Function**:
        a.  Retrieve `redditThreadData` from `chrome.storage.local.get()`.
        b.  Create a helper function to format the JSON data into a single, readable plain text string.
        c.  Implement logic to find the Gemini chat input DOM element (use a selector that is as stable as possible; this will require manual inspection of Gemini's current UI).
        d.  If element is found:
            i.  Call `element.focus()`.
            ii. Set `element.value = formattedText` (if textarea/input) or `element.textContent = formattedText` (if contenteditable div).
            iii.Dispatch `new Event('input', { bubbles: true, cancelable: true })` on the element.
            iv. Consider other events like `change`, `blur` if `input` alone is not sufficient.
        e.  Handle cases where the input field is not found (e.g., log error, notify user via service worker).
    3.  After successful (or attempted) pasting, consider messaging the service worker to clear `chrome.storage.local`.

### Feature: User Interface (Popup)
* **Description**:
    * A browser action button (icon in Chrome toolbar).
    * Clicking the button opens a simple popup.
    * The popup contains a primary action button (e.g., "Scrape and Send to Gemini").
    * The popup includes the toggle for "Include hidden/spam comments."
    * The popup includes a placeholder "Options" button for future customizability (non-functional in MVP). (Source: PRD-MVP.txt, Section 4)
* **Key Acceptance Criteria/User Story**: Provides the primary user interaction point.
* **Technical Implementation Notes**:
    * Create `popup.html`, `popup.css`, and `popup.js`. (Source: Tech-Design-MVP.txt, Section 3)
    * Link `popup.js` in `popup.html`.
    * `popup.js` will listen for button clicks and message `service_worker.js`. (Source: Tech-Design-MVP.txt, Section 3)
    * The "Options" button will be present but have no attached functionality in MVP. (Source: Tech-Design-MVP.txt, Section 4)
* **Agent Implementation Steps (Suggested)**:
    1.  Create `manifest.json`:
        * Define `name`, `version`, `description`, `manifest_version: 3`.
        * Declare `permissions`: `["activeTab", "scripting", "storage", "notifications", "tabs"]`.
        * Specify `host_permissions` if needed (e.g., `"*://*.reddit.com/*"`, `"*://gemini.google.com/*"`). Start with minimal and add if `activeTab` is insufficient.
        * Define `action`: `{"default_popup": "popup.html", "default_icon": {"16": "images/icon16.png", ...}}`.
        * Define `background`: `{"service_worker": "service_worker.js"}`.
    2.  Create `popup.html`:
        * Basic HTML structure.
        * Include a button with an ID (e.g., `scrapeBtn`) for "Scrape and Send to Gemini."
        * Include a checkbox/toggle with an ID (e.g., `includeHiddenToggle`) for "Include hidden/spam comments."
        * Include a disabled or placeholder button for "Options."
        * Link to `popup.css` and `popup.js`.
    3.  Create `popup.css` for basic styling.
    4.  Create `popup.js`:
        * Add event listener to `scrapeBtn`.
        * On click, get the state of `includeHiddenToggle`.
        * Send a message to `service_worker.js` using `chrome.runtime.sendMessage` with the action type and toggle state.

## UI/UX Concept (from PRD)
* Minimalist and straightforward interface.
* Interaction starts with a click on the Chrome toolbar icon.
* The popup provides clear options for the primary action ("Scrape and Send to Gemini" button) and comment inclusion (toggle for "Include hidden/spam comments").
* A placeholder "Options" button will be present for future enhancements.
(Source: PRD-MVP.txt, Section 4)

## Out of Scope for MVP (from PRD)
* Full, simultaneous support for other AI platforms beyond Gemini (Claude, ChatGPT, Grok).
* Integration with Google AI Studio.
* Advanced formatting of scraped content (MVP uses plain text).
* User accounts or saving of scraping history.
* Scraping or processing of video content.
* Advanced error recovery mechanisms.
* Functionality for the placeholder "Options" button.
(Source: PRD-MVP.txt, Section 5)

## Key Agent Instructions
* Agent: Please generate the MVP codebase based on the details above.
* Prioritize implementing the features exactly as specified in the 'Core MVP Features' section.
* Strictly adhere to the 'Technical Specifications' regarding platform, stack, and architecture.
* Refer to the full PRD (`PRD-MVP.txt`) and Tech Design Doc (`Tech-Design-MVP.txt`) files in the project root for complete details if needed.
* Create files and directory structures as logically required by the Tech Design Doc and implementation plan (e.g., `popup.html`, `popup.js`, `popup.css`, `service_worker.js`, `redditScraper.js`, `images/icon*.png`).
* Add comments to explain complex logic, especially in `redditScraper.js` (DOM traversal, dynamic content handling) and the Gemini interaction script (DOM element finding, event dispatching).