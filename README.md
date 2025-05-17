# 🚀 Reddit to AI - Chrome Extension 🚀

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg?style=for-the-badge)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE) 
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-orange.svg?style=for-the-badge)](#contributing)

> **Transform your Reddit browsing into an AI-powered analysis experience!**
> Scrape Reddit threads and seamlessly send content to your favorite AI for insights, summaries, and more.

---

## 📖 Table of Contents

* [Overview](#overview)
* [✨ Core Functionality](#-core-functionality)
* [🚀 Installation](#-installation)
* [🛠️ Usage](#️-usage)
* [🔧 Configuration](#-configuration)
* [⚠️ Known Issues & Limitations](#️-known-issues--limitations)
* [🤝 Contributing](#-contributing)
* [📄 License](#-license)

---
## Overview

**Reddit to AI** is a Chrome browser extension designed to streamline the process of analyzing Reddit threads using Artificial Intelligence. It empowers users to quickly scrape the rich content of an active Reddit thread—including the original post, comments, images, and links—and then seamlessly send this data to a selected AI chat interface (such as Google's Gemini, ChatGPT, Claude, or AI Studio).

This tool tackles the inefficiency of manual copy-pasting, aiding researchers, avid Reddit users, and anyone looking to leverage AI for deeper insights from online discussions.

---
## ✨ Core Functionality

* **Comprehensive Data Scraping**: Extracts post details (title, author, subreddit, content, images, links, YouTube URLs) and a hierarchical tree of comments.
* **User Configuration**:
    * Set comment scraping depth ("load more attempts").
    * Option to include hidden/collapsed comments.
    * Select target AI model (Gemini, ChatGPT, Claude, AI Studio).
    * Toggle desktop notifications.
* **Process Management**: Initiate, manage, and stop the scraping process.
* **User Feedback**: Real-time status messages and progress bar in the extension popup.
* **AI Platform Integration**: Opens the selected AI platform and attempts to paste scraped text and images. Supports YouTube URL pasting for AI Studio.

---
## ⚙️ How It Works Briefly

1.  **User Initiates**: Click the extension icon on a Reddit page and configure options in the popup.
2.  **Service Worker Orchestrates**: The background script (`service_worker.js`) manages the flow.
3.  **Reddit Scraper (`redditScraper.js`)**: Injected into Reddit to extract data.
4.  **AI Paster (`aiPaster.js`)**: Injected into the chosen AI platform to paste the content.
5.  **Data Handling**: Uses `chrome.storage.local` for temporary data transfer and `chrome.storage.sync` for persistent settings. No data is sent to external servers by the extension itself.

---
## 🚀 Installation

<details>
<summary>Click to expand installation instructions</summary>

To load this extension for development or testing:

1.  **Download or Clone**: Get the project files onto your local machine.
    ```bash
    git clone [https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git](https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git) # Replace with your repo URL
    ```
2.  **Open Chrome Extensions**: Navigate to `chrome://extensions`.
3.  **Enable Developer Mode**: Ensure the "Developer mode" toggle is on.
4.  **Load Unpacked**: Click "Load unpacked" and select the extension's root folder (the one containing `manifest.json`).
5.  **Verify**: "Reddit to AI" should appear in your extensions list and its icon in the Chrome toolbar.

</details>

---
## 🛠️ Usage

1.  **Navigate**: Go to a Reddit thread page.
2.  **Activate**: Click the "Reddit to AI" toolbar icon.
3.  **Configure (Optional)**:
    * Toggle "Include Collapsed Comments."
    * Click "Options" for scraping depth, AI model selection (AI Studio recommended for image support), and notification preferences.
4.  **Scrape**: Click "Scrape and Send."
5.  **Observe**: The popup shows progress. A new tab opens for the AI, and content is pasted.

---
## 🔧 Configuration

Customize via the **"Options"** button in the popup:

* **Scraping Depth**: Slider (Default: 75, Range: 1-500 "load more" attempts).
* **Select AI Model**: Dropdown (Gemini, ChatGPT, Claude, AI Studio - Default: AI Studio).
* **Show Notifications**: Checkbox (Default: Enabled).

Settings are saved using `chrome.storage.sync`.

---
## 💻 Tech Stack Highlights

* **Platform**: Chrome Extension (Manifest V3)
* **Core**: Vanilla JavaScript (ES6+), HTML5, CSS3
* **Key APIs**: `chrome.tabs`, `chrome.storage`, `chrome.scripting`, `chrome.notifications`, `MutationObserver`.

---
## 📁 Key Files Overview

<details>
<summary>Click to expand key files list</summary>

* `manifest.json`: Extension definition.
* `service_worker.js`: Background logic.
* `popup.html` / `popup.js` / `popup.css`: Main user interface.
* `options.html` / `options.js` / `options.css`: Configuration interface.
* `redditScraper.js`: Reddit page content script.
* `aiPaster.js`: AI platform content script.
</details>

---
## ⚠️ Known Issues & Limitations

* **AI Platform UI Changes**: Pasting relies on DOM selectors of AI sites, which can change and break functionality, requiring updates.
* **Image Pasting**: Reliability varies by AI platform (AI Studio is generally best).
* **Content Cleaning**: Minor Reddit UI elements might occasionally be included.
* **Performance**: Very large threads can be resource-intensive.

---
## 🔮 Future Enhancements

* Smarter AI interaction (e.g., prompt templates).
* Selective content scraping.
* Direct data export (JSON, TXT).

---
## 🤝 Contributing

Contributions are welcome!

1.  **Fork** the repository.
2.  Create a **feature branch** (`git checkout -b feature/your-idea`).
3.  **Develop** and **test** your changes.
4.  **Commit** your work (`git commit -m "feat: Add some feature"`).
5.  **Push** to your branch (`git push origin feature/your-idea`).
6.  Open a **Pull Request**.

---
## 📜 Disclaimer

> This tool interacts with the DOM of Reddit and third-party AI platforms. UI changes on these sites may break functionality. Use responsibly and in accordance with the terms of service of all involved platforms. Provided "as-is" without warranty.

---
## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
*(Ensure a LICENSE file exists in your project, or update this section accordingly.)*

