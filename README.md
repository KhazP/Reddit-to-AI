# 🚀 Reddit to AI - Chrome Extension

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge)](manifest.json)
[![License](https://img.shields.io/badge/license-apache-green.svg?style=for-the-badge)](LICENSE)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-orange.svg?style=for-the-badge)](#contributing)

> **Transform your Reddit browsing into an AI-powered insights engine!**
> Scrape Reddit threads, filter the noise, and instantly send context to your favorite AI assistant for summarization, debate analysis, or sentiment checks.

---

## 📖 Table of Contents

* [Overview](#overview)
* [✨ Key Features](#-key-features)
* [Supported Platforms](#supported-platforms)
* [🚀 Installation](#-installation)
* [🛠️ Usage](#️-usage)
* [🔧 Configuration](#-configuration)
* [🌍 Internationalization](#-internationalization)
* [⚠️ Known Issues & Limitations](#️-known-issues--limitations)
* [🤝 Contributing](#-contributing)
* [📄 License](#-license)

---

## Overview

**Reddit to AI** is a powerful Chrome extension that Bridges the gap between Reddit discussions and Large Language Models (LLMs). It allows you to scrape comprehensive data from any Reddit thread—including the main post, nested comments, and images—and seamlessly transfer it to an AI chat interface (like ChatGPT or Gemini) with a pre-configured prompt.

Whether you're a researcher analyzing sentiment, a user looking for a "TL;DR", or just someone who wants to understand a complex debate, this tool automates the tedious copy-pasting and formatting process.

---

## ✨ Key Features

*   **Smart Scraping**:
    *   Extracts title, author, subreddit, post content, and metadata.
    *   **Recursive Comment Scraping**: Configurable depth (Quick, Standard, Deep, Full) to capture nested replies.
    *   **Image Support**: Automatically scrapes and attaches up to 10 images from the post to the AI prompt.
*   **Content Filters**:
    *   **Hide Bots**: Automatically filter out AutoModerator and other bot comments.
    *   **Min Score**: Ignore low-quality or downvoted comments.
    *   **Limit Count**: Cap the number of comments to fit within context windows.
    *   **Author Filtering**: Focus on the OP (Original Poster) or flaired users.
*   **Prompt Engineering**:
    *   **Built-in Presets**: One-click templates for Summarization, Debate Analysis, Sentiment Analysis, ELI5 (Explain Like I'm 5), and Key Takeaways.
    *   **Custom Templates**: Design your own prompts using the `{content}` placeholder.
*   **History & Management**:
    *   **Local History**: Keep track of recently scraped threads and re-send them to different AI platforms instantly.
    *   **JSON Export**: Export scraped thread data for offline analysis.
*   **Privacy First**:
    *   **No Remote Server**: All processing happens locally in your browser.
    *   **Secure Storage**: API keys (optional legacy feature) and settings are stored in `chrome.storage.sync`.

---

## Supported Platforms

The extension currently supports automatic pasting and prompt injection for:

*   **Google Gemini** (gemini.google.com)
*   **OpenAI ChatGPT** (chatgpt.com)
*   **Anthropic Claude** (claude.ai)
*   **Google AI Studio** (aistudio.google.com)

---

## 🚀 Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/KhazP/Reddit-to-AI.git
    ```
2.  **Open Chrome Extensions**:
    *   Navigate to `chrome://extensions/` in your browser.
    *   Enable **Developer mode** (top right toggle).
3.  **Load Unpacked**:
    *   Click **Load unpacked**.
    *   Select the folder where you cloned the repository.
4.  **Pin it**: Pin the "Reddit to AI" icon to your toolbar for easy access!

---

## 🛠️ Usage

1.  **Navigate to Reddit**: Open any Reddit thread you want to analyze.
2.  **Open Extension**: Click the **Reddit to AI** icon.
3.  **Configure (Optional)**:
    *   Use **Quick Filters** in the popup to hide bots or set a minimum score.
    *   Choose your destination platform (e.g., Gemini, ChatGPT).
4.  **Scrape & Send**:
    *   Click **Scrape & Send**.
    *   The extension will scroll the page to load comments, extract the data, and open a new tab with your chosen AI.
    *   The prompt and data will be automatically pasted into the chat box.

---

## 🔧 Configuration

Right-click the extension icon and select **Options** to access advanced settings:

*   **Scraping Settings**:
    *   **Comment Depth**: Control how deep the scraper goes (Level 0 to Full recursion).
    *   **Content Filters**: Set strict rules for what comments to include (Score, Author, etc.).
*   **Prompt Presets**:
    *   Customize the default templates for each analysis type.
*   **Appearance**:
    *   **Language**: Switch the interface language.
    *   **Notifications**: Toggle browser notifications for status updates.

---

## 🌍 Internationalization

Reddit to AI is ready for the world! The interface is fully localized for:
*   🇺🇸 English
*   🇩🇪 German (Deutsch)
*   🇪🇸 Spanish (Español)
*   🇫🇷 French (Français)
*   🇵🇹 Portuguese (Português)
*   🇯🇵 Japanese (日本語)
*   🇨🇳 Chinese (Simplified) (简体中文)
*   🇹🇷 Turkish (Türkçe)

---

## ⚠️ Known Issues & Limitations

*   **Context Window Limits**: Extremely large threads (500+ comments) may exceed the input limit of some AI models. Use the "Limit Comments" or "Min Score" filters to reduce data size.
*   **DOM Changes**: Reddit frequently updates its UI. If scraping stops working, please open an issue – selectors may need updating.
*   **Browser Security**: Some browsers may block the automatic paste action. You may need to grant clipboard permissions or use `Ctrl+V` manually if the auto-paste fails.

---

## 🤝 Contributing

Contributions are welcome! If you'd like to add a new language, support a new AI platform, or fix a bug:

1.  **Fork** the repository.
2.  Create a **feature branch** (`git checkout -b feature/amazing-feature`).
3.  **Commit** your changes (`git commit -m 'Add amazing feature'`).
4.  **Push** to the branch (`git push origin feature/amazing-feature`).
5.  Open a **Pull Request**.

---

## 📄 License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
