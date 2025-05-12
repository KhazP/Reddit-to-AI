# Reddit AITools Chrome Extension

**Version:** (Specify current version if known, e.g., 2.4 based on `redditScraper.js` log)
**Date:** May 13, 2025

## 1. Overview

The Reddit AITools Chrome extension is designed to scrape content from Reddit threads (posts and comments) and facilitate sending this data to Google's Gemini for analysis, summarization, or other AI-driven tasks. It provides user feedback through status messages and a progress bar, allows for some configuration, and includes a mechanism to stop the scraping process.

## 2. Core Functionality

*   **Data Scraping**: Extracts post details (title, author, subreddit, content, all gallery images or a single prominent image, links) and a hierarchical tree of comments from the active Reddit page.
*   **User Configuration**: Allows users to set the depth of comment scraping (via "load more attempts") and choose whether to include hidden or spam comments.
*   **Process Management**: Initiates, manages, and allows stopping of the scraping process.
*   **User Feedback**: Displays real-time status messages and a progress bar in the extension popup.
*   **Integration with Gemini**: Opens Gemini in a new tab and (attempts to) paste the scraped data, including all scraped images, into the Gemini interface.

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
    *   `host_permissions`: Includes `"*://*.reddit.com/*"` for script injection on Reddit pages and permissions for various AI platforms: `"https://gemini.google.com/*"`, `"https://chat.openai.com/*"`, `"https://claude.ai/*"`, `"https://grok.x.ai/*"`.

### 3.2. `popup.html` & `popup.css`
*   **Purpose**: Defines the structure and style of the extension's popup window, which is the primary user interface.
*   **Key Elements**:
    *   "Scrape and Send" button: Initiates the scraping process.
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
*   **Purpose**: Provide a user interface for configuring extension settings, including the number of "load more comments" attempts and selecting the target AI model.
*   **`options.html`**: Defines the structure of the options page, including a slider for `maxLoadMoreAttempts` and a dropdown for AI model selection.
*   **`options.js`**:
    *   Loads saved settings (`maxLoadMoreAttempts`, `selectedAiModel`) from `chrome.storage.sync`.
    *   Saves selected values to `chrome.storage.sync` when the user changes them.
    *   Updates the displayed value next to the slider.
    *   Manages AI model configurations (name, URL, CSS selector for input).

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
    *   Retrieving the selected AI model configuration from `chrome.storage.sync`.
    *   Opening a new tab for the selected AI platform (Gemini, ChatGPT, Claude, AI Studio).
    *   Injecting `aiPaster.js` into the AI platform's tab once it's loaded.
    *   Passing the AI-specific configuration (e.g., CSS selector) to `aiPaster.js`.
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

### 3.7. `aiPaster.js` (Content Script for AI Platforms, formerly `geminiPaster.js`)
*   **Purpose**: Injected into the selected AI platform's page to paste the scraped Reddit data.
*   **Key Responsibilities**:
    *   Receiving the AI-specific configuration (name, URL, CSS selector) from `service_worker.js`.
    *   Retrieving the stored Reddit data (including an array of image dataURLs) from `chrome.storage.local`.
    *   Formatting the textual data into a string suitable for pasting.
    *   Locating the appropriate input area on the AI platform's page using the provided CSS selector. Implements a retry mechanism (e.g., for AI Studio) to handle cases where the target element might not be immediately available.
    *   Pasting the formatted textual data into the input area.
    *   Iterating through the array of image dataURLs, converting each to a File object, and attempting to paste each image using simulated drag-and-drop events, with small delays between each image.
    *   Sending a status message back to `service_worker.js` indicating success or failure of the paste operation.

## 4. Workflow / Data Flow

1.  **Initiation**:
    *   User navigates to a Reddit thread and clicks the extension icon to open `popup.html`.
    *   User configures options if desired (via the embedded options view).
    *   User clicks "Scrape and Send" in `popup.html`.
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
6.  **Service Worker Processing & AI Platform Interaction**:
    *   `service_worker.js` receives the data/status.
    *   If data is received, it's stored in `chrome.storage.local` under `redditThreadData`.
    *   `service_worker.js` retrieves the selected AI model configuration (URL, selector) from `chrome.storage.sync`.
    *   `service_worker.js` opens the selected AI platform's URL (e.g., `https://gemini.google.com/app`, `https://chat.openai.com/`, etc.) in a new tab.
    *   It waits for the AI platform's tab to finish loading.
    *   It then injects `aiPaster.js` into the tab, passing the AI-specific configuration.
7.  **Pasting on AI Platform Page**:
    *   `aiPaster.js` receives the AI configuration (including the CSS selector for the input field).
    *   It retrieves `redditThreadData` from `chrome.storage.local`.
    *   It formats the data and attempts to paste it into the AI platform's input field using the provided selector.
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
    *   **Slider for "Load More Comments" Attempts**: Allows users to set a value (e.g., 1-500, default 75). The current value is displayed.
    *   **Dropdown for AI Model Selection**: Allows users to choose between Gemini (default), ChatGPT, Claude, and AI Studio.
    *   **Description**: Explains what the setting does and the implications of high/low values.

## 6. Configuration

*   **Max Load More Attempts**: Configured via the options page/slider. Determines how many times the scraper tries to load more comments. Stored in `chrome.storage.sync` under the key `maxLoadMoreAttempts`.
    *   Default: 75
    *   Range: 1-500 (as per `options.html`)
*   **Selected AI Model**: Configured via a dropdown in the options view. Determines which AI platform the data is sent to. Stored in `chrome.storage.sync` under keys `selectedAiModel` (string key) and `selectedAiModelConfig` (object with URL, selector, name).
    *   Default: Gemini
    *   Options: Gemini, ChatGPT, Claude, AI Studio
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
*   **Multi-AI Platform Support**: Allows users to select and send data to different AI models (Gemini, ChatGPT, Claude, AI Studio).
*   **Dynamic Paster Script**: `aiPaster.js` now handles pasting for multiple AI platforms based on configuration passed from the service worker.
*   **Improved Progress Bar Accuracy**: Calculations in `service_worker.js` and `redditScraper.js` updated for more realistic progress representation, especially with high step values.
*   **In-Popup Options**: Allows configuration changes directly within the popup without opening a new tab or a separate extension page.
*   **Selector Mismatch Resolution**: Implemented logic in `service_worker.js` to ensure `aiPaster.js` receives the correct, most up-to-date CSS selector for the target AI platform, even if an outdated one was in storage. This fixed issues where `aiPaster.js` couldn't find the input element due to using an old selector.
*   **Configuration Property Name Correction**: Corrected `aiPaster.js` to use `aiConfig.inputSelector` instead of the old `aiConfig.selector`, aligning it with `service_worker.js`.
*   **Syntax Error Resolution**: Addressed "Identifier 'scrapeRedditData' has already been declared" by removing duplicate function definitions in `redditScraper.js`.
*   **UI Text Update**: "Scrape and Send to Gemini" button changed to "Scrape and Send".
*   **AI Studio Integration**: Added support for AI Studio. Updated `aiPaster.js` with retry logic to improve reliability when pasting to AI Studio, addressing issues where the target input element might not be immediately available.
*   **Image Handling (Enhanced for Galleries & Gemini Workaround)**:
    *   Enhanced image scraping to identify and fetch all images from a Reddit post gallery (e.g., targeting `shreddit-gallery` elements or common `figure > img` patterns within the post content). If no gallery is detected, it falls back to finding a single prominent post image.
    *   The `service_worker.js` now processes an array of image URLs collected by the scraper. It fetches each image, converts it to a dataURL, and stores these as an array of dataURLs.
    *   `aiPaster.js` receives the array of image dataURLs. It iterates through this array, attempting to paste each image into the target AI platform using a simulated drag-and-drop mechanism. Delays are incorporated between pasting multiple images to improve reliability.
    *   A note is added to the pasted text if multiple images were scraped and attempted for pasting.
    *   Added `https://*.redd.it/*` to `host_permissions` in `manifest.json` to resolve CORS issues when fetching images.
    *   Due to difficulties with robust image pasting into Gemini, a disclaimer was added to `options.html` informing users of this limitation and recommending AI Studio for posts with images.
    *   The default AI model was changed from Gemini to AI Studio in `service_worker.js`.
*   **YouTube Video URL Handling (for AI Studio Embedding)**:
    *   `redditScraper.js` in the `extractPostDetails` function has been updated to more robustly identify YouTube video URLs:
        1.  It prioritizes extracting the YouTube URL from the `shreddit-post` element's `content-href` attribute if the `post-type` attribute indicates a "link" and the `domain` attribute is a known video host (e.g., `youtube.com`, `youtu.be`). URLs are resolved to be absolute.
        2.  As a fallback, or if the post is not a direct link type but might contain a video URL in its metadata, it attempts to parse JSON data from the `shreddit-screenview-data` element's `data` attribute to find a `post.url`. This URL is also resolved to absolute and checked against known video hosts.
        3.  If a YouTube URL is found through these primary methods (especially for link posts), and the existing `postTextContent` is empty, a generic placeholder, or a basic "This post links to a video..." message lacking the post title, `post.content` is updated to be more descriptive, like: "This post features a video: [YouTube URL] - [Post Title]".
        4.  The existing regex-based search (using `new RegExp()` for correct pattern escaping) for YouTube URLs within the `contentHTML` (derived from the post's text body) remains as a final fallback, primarily for text posts that might embed links.
    *   Collected YouTube URLs are stored in `post.youtubeVideoUrls`.
    *   `service_worker.js` passes these collected YouTube URLs to `aiPaster.js`.

## 7.1. Recent Updates (as of May 13, 2025)

*   **Project Renaming**:
    *   The extension has been renamed from "Reddit AITools" to "Reddit to AI".
    *   This change is reflected in `manifest.json` (extension name), `options.html` (page title and header logo), and `popup.html` (page title and header logo).
*   **UI Enhancements**:
    *   **Popup**: The checkbox label "Include hidden/spam comments" in `popup.html` has been rephrased to "Include Collapsed Comments" with a tooltip "Scrape comments that are hidden by default" for clarity.
*   **New Feature: Show Notifications**:
    *   **Options**: A new checkbox "Show Notifications" has been added to `options.html`, allowing users to enable or disable desktop notifications for key events. Its description is "Display status updates as notifications." This setting is saved and loaded via `options.js` and defaults to `true` (enabled).
    *   **Service Worker**: `service_worker.js` now includes a helper function `showNotificationIfEnabled` that checks the user's preference stored in `chrome.storage.sync`.
    *   Notifications (`chrome.notifications.create()`) are now conditionally displayed for various events:
        *   Scraping process initiation, completion, stoppage, or cancellation.
        *   Errors encountered during scraping, storage, or AI platform interaction (e.g., no active tab, not a Reddit page, injection failures, storage errors, AI platform interaction issues).
        *   Successful operations like opening the AI platform tab.

## 7.2. Summary of Changes During Current Chat Session (May 13, 2025)

This section details the specific modifications made during the interactive session on May 13, 2025, to ensure the AI has the most current context of recent, fine-grained changes.

*   **Popup UI Refinement (`popup.html`)**:
    *   The checkbox related to comment visibility was updated.
        *   Previous label: "Include hidden/spam comments"
        *   New label: "Include Collapsed Comments"
        *   A `title` attribute was added to this label: "Scrape comments that are hidden by default".

*   **"Show Notifications" Feature Implementation**:
    *   This feature allows users to control whether they receive desktop notifications for various extension activities.
    *   **`options.html`**:
        *   A new checkbox with the `id="showNotifications"` was added.
        *   The label for this checkbox is "Show Notifications:".
        *   A descriptive text `<small>Display status updates as notifications.</small>` was added.
    *   **`options.js`**:
        *   Enhanced to manage the "Show Notifications" checkbox.
        *   Loads the `showNotifications` setting from `chrome.storage.sync`. If not found, it defaults to `true` (enabled) and saves this default.
        *   Saves changes to the `showNotifications` setting in `chrome.storage.sync` when the checkbox state is changed by the user.
    *   **`service_worker.js`**:
        *   A new helper function `showNotificationIfEnabled(title, message, notificationIdBase)` was introduced. This function first retrieves the `showNotifications` setting from `chrome.storage.sync`.
        *   If notifications are enabled (or the setting is not present, defaulting to enabled), it calls `chrome.notifications.create()` to display a desktop notification.
        *   This `showNotificationIfEnabled` function was integrated at numerous points in the service worker's lifecycle to provide conditional notifications for:
            *   Scraping process initiation, successful completion, user-initiated stops, and cancellations.
            *   Various error conditions (e.g., scraping already in progress, no active tab, not a Reddit page, script injection failures, data storage errors, AI platform interaction issues like tab creation failure or pasting script injection failure).
            *   Successful intermediate steps (e.g., AI platform tab opened).
        *   The existing handler for `notifyUser` messages (typically from content scripts) was also updated to use `showNotificationIfEnabled`, ensuring these custom notifications also respect the user's preference.

*   **Project Renaming to "Reddit to AI"**:
    *   The overall project name was changed.
    *   **`manifest.json`**: The `name` field was updated from "Reddit AI Tool" to "Reddit to AI".
    *   **`options.html`**:
        *   The `<title>` tag was changed to "Reddit to AI Options".
        *   The header logo text was updated from "RedditAITools" to "Reddit to AI".
    *   *(Note: `popup.html`'s title and logo were already "Reddit to AI" prior to this specific chat segment, as reflected in user-provided files and previous `project.md` updates).*

These updates ensure that `project.md` accurately reflects the latest state of the extension, particularly the changes made interactively during this session.

## 8. Technical Details

*   **Platform**: Chrome Extension (Manifest V3)
*   **Core Technologies**: JavaScript, HTML, CSS
*   **Chrome APIs**: `chrome.runtime`, `chrome.tabs`, `chrome.scripting`, `chrome.storage`, `chrome.notifications`.
*   **DOM Manipulation**: Extensive use for data extraction in `redditScraper.js` and `aiPaster.js`.
*   **Data Storage**: `chrome.storage.sync` for persistent options, `chrome.storage.local` for temporary data transfer between service worker and AI paster script.

## 9. Potential Future Enhancements

*   More sophisticated AI interaction (e.g., pre-filling prompts, selecting specific models if API allows for the chosen platform).
*   Allowing users to select which parts of the post/comments to scrape.
*   Saving scraped data to a file directly.
*   Support for other AI platforms beyond Gemini.

