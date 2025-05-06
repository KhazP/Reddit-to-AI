# Reddit AITools Chrome Extension

**Version:** (Specify current version if known, e.g., 2.4 based on `redditScraper.js` log)
**Date:** May 7, 2025

## 1. Overview

The Reddit AITools Chrome extension is designed to scrape content from Reddit threads (posts and comments) and facilitate sending this data to Google's Gemini for analysis, summarization, or other AI-driven tasks. It provides user feedback through status messages and a progress bar, allows for some configuration, and includes a mechanism to stop the scraping process.

## 2. Core Functionality

*   **Data Scraping**: Extracts post details (title, author, subreddit, content, images, links) and a hierarchical tree of comments from the active Reddit page.
*   **User Configuration**: Allows users to set the depth of comment scraping (via "load more attempts") and choose whether to include hidden or spam comments.
*   **Process Management**: Initiates, manages, and allows stopping of the scraping process.
*   **User Feedback**: Displays real-time status messages and a progress bar in the extension popup.
*   **Integration with Gemini**: Opens Gemini in a new tab and (attempts to) paste the scraped data into the Gemini interface.

## 3. Components

### 3.1. `manifest.json`
*   **Purpose**: The manifest file is the entry point of the extension, defining its metadata, permissions, and components.
*   **Key Declarations**:
    *   `manifest_version`: 3
    *   `name`, `version`, `description`: Basic extension information.
    *   `permissions`: [`activeTab`, `scripting`, `storage`, `notifications`, `tabs`].
    *   `background`: Specifies `service_worker.js` for background tasks.
    *   `action`: Defines the `popup.html` as the extension's popup UI.
    *   `options_page`: Specifies `options.html` for user configurations.
    *   `icons`: Paths to extension icons.
    *   `host_permissions`: Likely includes `"*://*.reddit.com/*"` for script injection on Reddit pages and `"*://gemini.google.com/*"` for the Gemini paster script.

### 3.2. `popup.html` & `popup.css`
*   **Purpose**: Defines the structure and style of the extension's popup window, which is the primary user interface.
*   **Key Elements**:
    *   "Scrape and Send to Gemini" button: Initiates the scraping process.
    *   "Stop Scraping" button: Appears during scraping to allow the user to halt the process.
    *   "Include hidden/spam comments" checkbox: A toggle for the user to control the type of comments scraped.
    *   Status display area: Shows textual feedback about the current operation.
    *   Progress bar: Visually indicates the progress of the scraping and pasting operation.
    *   "Options" button: Navigates to the options view within the popup.

### 3.3. `popup.js`
*   **Purpose**: Handles the logic and user interactions within `popup.html`.
*   **Key Responsibilities**:
    *   Event listeners for buttons (Scrape, Stop, Options) and the checkbox.
    *   Sending messages to `service_worker.js` to start or stop scraping.
    *   Receiving and displaying status/progress updates from `service_worker.js`.
    *   Managing the visibility and state of UI elements (e.g., enabling/disabling buttons, updating progress bar width and color).
    *   Opening the extension's options page (`options.html`) when the 'Options' button is clicked.

### 3.4. `options.html` & `options.js`
*   **Purpose**: Provide a user interface for configuring extension settings, primarily the number of "load more comments" attempts.
*   **`options.html`**: Defines the structure of the options page, including a slider for `maxLoadMoreAttempts`.
*   **`options.js`**:
    *   Loads the saved `maxLoadMoreAttempts` value from `chrome.storage.sync` when the page loads.
    *   Saves the selected value to `chrome.storage.sync` when the user changes it.
    *   Updates the displayed value next to the slider.

### 3.5. `service_worker.js` (Background Script)
*   **Purpose**: Manages the extension's background tasks, acting as a central coordinator for the scraping process.
*   **Key Responsibilities**:
    *   Listening for messages from `popup.js` (e.g., `scrapeReddit`, `stopScraping`).
    *   Managing the scraping state (`isScraping`, `stopRequested`, `scrapingTabId`).
    *   Injecting the `redditScraper.js` content script into the active Reddit tab.
    *   Sending commands and options (like `includeHidden`) to `redditScraper.js`.
    *   Receiving scraped data or error messages from `redditScraper.js`.
    *   Receiving progress updates from `redditScraper.js` and relaying them to `popup.js`.
    *   Storing the scraped data temporarily in `chrome.storage.local`.
    *   Opening a new tab for Gemini.
    *   Injecting `geminiPaster.js` into the Gemini tab once it's loaded.
    *   Cleaning up stored data after the process or if an error occurs/stop is requested.
    *   Handling the `stopScraping` request by setting a flag and attempting to notify the content script.

### 3.6. `redditScraper.js` (Content Script for Reddit)
*   **Purpose**: Injected into Reddit pages to perform the actual data extraction.
*   **Key Responsibilities**:
    *   Loading configuration (e.g., `MAX_LOAD_MORE_ATTEMPTS`) from `chrome.storage.sync`.
    *   Extracting post details (title, author, content, media URLs, etc.).
    *   Extracting comments, including their structure (parent-child relationships), author, text, and other metadata.
    *   Implementing the logic to find and click "load more comments" buttons/links, respecting the configured number of attempts.
    *   Using `MutationObserver` to detect dynamically loaded comments.
    *   Building a hierarchical comment tree from the collected flat list of comments.
    *   Sending detailed progress updates (message and percentage) to `service_worker.js`.
    *   Handling requests from `service_worker.js` to stop scraping (`stopScrapingRequested` message), halting its operations and cleaning up (e.g., disconnecting observer, clearing timeouts).
    *   Sending the scraped data (or an error/stopped status) back to `service_worker.js`.

### 3.7. `geminiPaster.js` (Content Script for Gemini)
*   **Purpose**: Injected into the Gemini page to paste the scraped Reddit data.
*   **Key Responsibilities**:
    *   Retrieving the stored Reddit data from `chrome.storage.local`.
    *   Formatting the data into a string suitable for pasting.
    *   Locating the appropriate input area on the Gemini page.
    *   Pasting the formatted data into the input area.
    *   Sending a status message back to `service_worker.js` indicating success or failure of the paste operation.

## 4. Workflow / Data Flow

1.  **Initiation**:
    *   User navigates to a Reddit thread and clicks the extension icon to open `popup.html`.
    *   User configures options if desired (via the embedded options view).
    *   User clicks "Scrape and Send to Gemini" in `popup.html`.
2.  **Popup to Service Worker**:
    *   `popup.js` sends a `scrapeReddit` message (with `includeHidden` state) to `service_worker.js`.
    *   `popup.js` updates its UI to show "Initiating scraping..." and disables the scrape button, shows the stop button.
3.  **Service Worker to Content Script (Reddit)**:
    *   `service_worker.js` checks if it's a Reddit page and if scraping is not already in progress.
    *   It injects `redditScraper.js` into the active Reddit tab.
    *   It then sends a `scrapeReddit` message (with `includeHidden` state) to `redditScraper.js`.
4.  **Scraping on Reddit Page**:
    *   `redditScraper.js` receives the command.
    *   It loads `maxLoadMoreAttempts` from storage.
    *   It extracts post details and then starts collecting comments.
    *   It clicks "load more comments" buttons/links based on the configuration, observing for new comments.
    *   Throughout this process, `redditScraper.js` sends `progressUpdate` messages (with status text and percentage) to `service_worker.js`.
5.  **Content Script (Reddit) to Service Worker**:
    *   Once scraping is complete (or timed out/stopped), `redditScraper.js` sends the collected data (post and comment tree) or an error/stopped status message back to `service_worker.js`.
6.  **Service Worker Processing & Gemini Interaction**:
    *   `service_worker.js` receives the data/status.
    *   If data is received, it's stored in `chrome.storage.local` under `redditThreadData`.
    *   `service_worker.js` opens `https://gemini.google.com/app` in a new tab.
    *   It waits for the Gemini tab to finish loading.
    *   It then injects `geminiPaster.js` into the Gemini tab.
7.  **Pasting on Gemini Page**:
    *   `geminiPaster.js` retrieves `redditThreadData` from `chrome.storage.local`.
    *   It formats the data and attempts to paste it into Gemini's input field.
    *   It sends a status message (e.g., "Pasting complete" or "Error pasting") back to `service_worker.js`.
8.  **Finalization & Feedback**:
    *   `service_worker.js` receives the paste status.
    *   It relays the final status/progress (e.g., 100% or error) to `popup.js`.
    *   `service_worker.js` removes `redditThreadData` from `chrome.storage.local`.
    *   `popup.js` displays the final message and resets the UI after a short delay.

**Stop Workflow**:
1.  User clicks "Stop Scraping" in `popup.html`.
2.  `popup.js` sends `stopScraping` message to `service_worker.js`.
3.  `service_worker.js` sets its `stopRequested` flag, sends `stopScrapingRequested` to `redditScraper.js` (if `scrapingTabId` is known), updates popup status, and cleans up storage.
4.  `redditScraper.js` receives `stopScrapingRequested`, sets its own stop flag, halts operations (observer, timeouts, loops), and sends a `status: 'stopped'` message back.
5.  The main scraping flow in both `service_worker.js` and `redditScraper.js` checks the stop flags at various points to terminate early.

## 5. User Interface and Interaction

### 5.1. Popup (`popup.html`)
*   **Main View**:
    *   **Scrape Button**: Starts the process.
    *   **Stop Button**: Appears during scraping to halt it.
    *   **Include Hidden Comments Checkbox**: Toggles scraping of normally hidden comments.
    *   **Status Display**: Text area for messages like "Scraping initiated...", "X comments found...", "Error...", "Complete."
    *   **Progress Bar**: Visual bar showing percentage completion. Turns red on error or stop.
    *   **Options Button**: Switches the popup view to show the options content.
*   **Options Button Functionality**:
    *   Clicking the "Options" button in the popup now toggles a view within the popup itself. 
    *   The content of `options.html` is loaded dynamically into a div in `popup.html`.
    *   The `popup.js` script handles fetching and displaying `options.html` and its associated `options.js` logic.

### 5.2. Options Page (`options.html`)
*   Accessible via the "Options" button in the popup (embedded) or directly if the extension settings are opened via Chrome's extension management page.
*   **Controls**:
    *   **Slider for "Load More Comments" Attempts**: Allows users to set a value (e.g., 1-150, default 75). The current value is displayed.
    *   **Description**: Explains what the setting does and the implications of high/low values.

## 6. Configuration

*   **Max Load More Attempts**: Configured via the options page/slider. Determines how many times the scraper tries to load more comments. Stored in `chrome.storage.sync` under the key `maxLoadMoreAttempts`.
    *   Default: 75
    *   Range: 1-150 (as per `options.html`)
*   **Include Hidden/Spam Comments**: Configured via a checkbox in the popup. This setting is passed from `popup.js` to `service_worker.js` and then to `redditScraper.js` for each scraping session. It's not persistently stored between sessions by default (state is read from checkbox at time of scrape).

## 7. Key Features

*   **Comprehensive Scraping**: Aims to get post details and a full comment tree.
*   **User Control**: Offers options for scraping depth and inclusion of hidden content.
*   **Robust Feedback**: Provides clear status messages and a visual progress bar.
*   **Error Handling**: Attempts to catch errors at various stages and report them to the user.
*   **Stop Functionality**: Allows users to interrupt the scraping process.
*   **Asynchronous Operations**: Uses Promises and `async/await` for non-blocking operations.
*   **Modular Design**: Separates concerns into different scripts (popup UI, background logic, content scraping, pasting).
*   **Dynamic Content Handling**: Uses `MutationObserver` in `redditScraper.js` to handle comments loaded dynamically.
*   **In-Popup Options**: Allows configuration changes directly within the popup without opening a new tab or a separate extension page.
*   **Syntax Error Resolution**: Addressed "Identifier 'scrapeRedditData' has already been declared" by removing duplicate function definitions in `redditScraper.js`.

## 8. Technical Details

*   **Platform**: Chrome Extension (Manifest V3)
*   **Core Technologies**: JavaScript, HTML, CSS
*   **Chrome APIs**: `chrome.runtime`, `chrome.tabs`, `chrome.scripting`, `chrome.storage`, `chrome.notifications`.
*   **DOM Manipulation**: Extensive use for data extraction in `redditScraper.js` and `geminiPaster.js`.
*   **Data Storage**: `chrome.storage.sync` for persistent options, `chrome.storage.local` for temporary data transfer between service worker and Gemini paster script.

## 9. Potential Future Enhancements

*   More sophisticated Gemini interaction (e.g., pre-filling prompts, selecting specific Gemini models if API allows).
*   Allowing users to select which parts of the post/comments to scrape.
*   Saving scraped data to a file directly.
*   Support for other AI platforms beyond Gemini.
*   Improved UI/UX for the popup and options.
*   More robust error handling and recovery.
*   Internationalization (i18n) for UI text.
*   Automated expansion of collapsed comments in `redditScraper.js`.

