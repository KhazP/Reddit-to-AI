# 🚀 Reddit to AI - Chrome Extension

[![Manifest V3](https://img.shields.io/badge/manifest-v3-blue.svg?style=for-the-badge)](src/manifest.json)
[![License](https://img.shields.io/badge/license-MPL--2.0-green.svg?style=for-the-badge)](LICENSE)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-orange.svg?style=for-the-badge)](#contributing)

> **Transform your Reddit browsing into an AI-powered insights engine!**
> Scrape Reddit threads, filter the noise, and instantly preview, edit, and send context to your favorite AI assistant for summarization, debate analysis, sentiment checks, or multi-thread comparisons.

---

## 📖 Table of Contents

* [Overview](#overview)
* [✨ Key Features](#-key-features)
* [Supported Platforms](#supported-platforms)
* [🚀 Installation](#-installation)
* [🧰 Software Requirements](#-software-requirements)
* [🛠️ Usage](#️-usage)
* [🔧 Configuration](#-configuration)
* [🧪 Reproducibility & Scope](#-reproducibility--scope)
* [🌍 Internationalization](#-internationalization)
* [⚠️ Known Issues & Limitations](#️-known-issues--limitations)
* [🤝 Contributing](#-contributing)
* [📄 License](#-license)

---

## Overview

**Reddit to AI** is a powerful browser extension (Chrome and Firefox) that bridges the gap between Reddit discussions and Large Language Models (LLMs). It allows you to scrape comprehensive data from any Reddit thread—including the main post, nested comments, and images—and seamlessly transfer it to an AI chat interface (like ChatGPT or Gemini) with a pre-configured prompt.

Whether you're a researcher analyzing sentiment, a user looking for a "TL;DR", or just someone who wants to understand a complex debate, this tool automates the tedious copy-pasting and formatting process.

---

## ✨ Key Features

*   **Prompt Preview Before Sending**:
    *   Review the final prompt in a dedicated preview screen before opening ChatGPT, Gemini, Claude, or AI Studio.
    *   Edit, copy, export, send, or save a preview preset.
    *   Built-in fallback overlay appears if auto-paste fails, with a one-click **Copy Prompt** button.
*   **Context Budgeter**:
    *   Visible **AI prompt size** meter with estimated characters, tokens, comment count, image count, and warning level.
    *   Presets: **Small**, **Balanced**, **Full**, and **Max Quality**.
*   **Smart Scraping**:
    *   Extracts title, author, subreddit, post content, flair, NSFW/spoiler flags, awards, crossposts, polls, source links, images, videos, YouTube links, and gallery media.
    *   **Recursive Comment Scraping**: Configurable depth to capture nested replies.
    *   **Stronger morechildren Queue**: Sequential batches capped at 100, retries, failed batch tracking, and a preview-screen resume button.
*   **Content Filters & Sorting**:
    *   Hide bots, set a minimum score, include/exclude removed comments, and filter OP or flaired-user comments.
    *   Smart trim logic: **Top scored**, **Controversial**, **OP replies**, **Flaired users**, **Diverse viewpoints**, **Newest**, or **Longest helpful comments**.
    *   Reddit sort modes: **Best/confidence**, **Top**, **New**, **Controversial**, **Old**, **Q&A**, and **Live**.
*   **Prompt Engineering**:
    *   **Built-in Presets**: One-click templates for Summarization, Debate Analysis, Sentiment Analysis, ELI5, and Key Takeaways.
    *   **Custom Templates**: Design your own prompts using the `{content}` placeholder.
*   **History & Management**:
    *   Search/filter history by subreddit, title, date range, AI platform, preset, and comment count.
    *   Favorite, pin, export, re-send, or compare saved threads.
*   **Batch / Multi-thread Mode**:
    *   Paste several Reddit thread URLs and scrape them one by one for combined analysis.
*   **Privacy First**:
    *   **No Remote Server**: All processing happens locally in your browser.
    *   **Don't Save** mode uses one-time handoff cleanup after paste.
    *   **Session Only** mode uses session storage when available, so temporary data is cleared with the browser/extension session.

---

## Supported Platforms

The extension currently supports automatic pasting and prompt injection for:

*   **Google Gemini** (gemini.google.com)
*   **OpenAI ChatGPT** (chatgpt.com)
*   **Anthropic Claude** (claude.ai)
*   **Google AI Studio** (aistudio.google.com)
*   **DeepSeek** (chat.deepseek.com)
*   **Groq** (groq.com)

You can also point the extension at your own chat UI by adding a **custom origin** in Options; without a configured origin the custom provider reports an error instead of opening a default page.

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
    *   Select the `src/` folder inside the cloned repository (that is where `manifest.json` lives).
4.  **Pin it**: Pin the "Reddit to AI" icon to your toolbar for easy access!

### 🦊 Firefox

Firefox needs a slightly different `manifest.json` (an MV3 event page instead of a
service worker, plus a Gecko add-on ID). It is generated for you by the packaging
step rather than checked in, so the two manifests cannot drift apart.

1.  **Build the Firefox payload**:
    ```bash
    npm install
    npm run package:extension
    ```
    This writes `dist-extension-firefox/` (an unpacked build) and
    `Reddit-to-AI-v<version>-firefox.zip` (the AMO upload archive) alongside the
    Chrome artifacts.
2.  **Load it temporarily**:
    *   Navigate to `about:debugging#/runtime/this-firefox`.
    *   Click **Load Temporary Add-on…** and pick
        `dist-extension-firefox/manifest.json`.
    *   Temporary add-ons are removed when Firefox restarts. For a persistent
        install, the zip has to be signed through
        [addons.mozilla.org](https://addons.mozilla.org).
3.  **Grant site access**: Firefox treats MV3 host permissions as optional. Open
    **Add-ons → Reddit to AI → Permissions** and allow access to Reddit and your AI
    sites if scraping or auto-paste does nothing.

Firefox 121 or newer is required (`strict_min_version` in the generated manifest).

---

## 🧰 Software Requirements

*   **Browser**: Google Chrome (or Chromium-compatible browser) with Manifest V3 support, or Firefox 121+.
*   **Runtime**: No backend server required; all extension logic runs locally.
*   **Development checks**: See [SOFTWARE_REQUIREMENTS.md](SOFTWARE_REQUIREMENTS.md) for a full environment and tooling checklist.

---

## 🛠️ Usage

1.  **Navigate to Reddit**: Open any Reddit thread you want to analyze.
2.  **Open Extension**: Click the **Reddit to AI** icon.
    *   Shortcuts: press **Alt+Shift+S** to scrape the active thread, or right-click a thread page (or a thread link anywhere) and choose **Scrape this thread with Reddit to AI**. Rebind the shortcut at `chrome://extensions/shortcuts`.
3.  **Configure (Optional)**:
    *   Use **Quick Filters** in the popup to hide bots or set a minimum score.
    *   Choose your destination platform (e.g., Gemini, ChatGPT).
4.  **Scrape & Preview**:
    *   Click **Scrape & Preview**.
    *   Review the context meter and final prompt.
    *   Send it to your chosen AI, copy it, edit it, export it, or save the preview settings as a preset.

---

## 🔧 Configuration

Right-click the extension icon and select **Options** to access advanced settings:

*   **Scraping Settings**:
    *   **Comment Depth**: Control how deep the scraper goes.
    *   **Context Budget**: Pick the default prompt-size preset.
    *   **Content Filters**: Set score, author, bot, trim logic, sort mode, and media-handling defaults.
*   **Prompt Presets**:
    *   Customize the default templates for each analysis type.
*   **Privacy & Storage**:
    *   Choose **Don't Save**, **Session Only**, or **Persistent** storage behavior.
*   **History**:
    *   Search, filter, favorite, pin, export, re-send, and compare previously scraped threads.
*   **Appearance**:
    *   **Language**: Switch the interface language.
    *   **Notifications**: Toggle browser notifications for status updates.

---

## 🧪 Reproducibility & Scope

*   **No training pipeline**: This repository does not train or evaluate machine-learning models.
*   **No dataset artifacts**: This project scrapes public Reddit thread data at runtime and does not ship training/testing datasets.
*   **Model links**: External AI platforms (Gemini, ChatGPT, Claude, AI Studio, DeepSeek, Groq) are destinations for pasted prompts, not bundled models.

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

*   **Context Window Limits**: Extremely large threads can still exceed some AI model input limits. Use the preview meter, context presets, trim logic, or score filters to reduce prompt size.
*   **DOM Changes**: Reddit and AI chat sites frequently update their UI. If scraping or auto-paste stops working, selectors may need updating.
*   **Browser Security**: Some browsers may block automatic paste. The fallback overlay lets you copy the prompt manually.
*   **Firefox host permissions**: Firefox MV3 makes `host_permissions` opt-in. Until you grant them under **Add-ons → Reddit to AI → Permissions**, scraping and auto-paste stay silent.
*   **Firefox keyboard shortcut**: `Alt+Shift+S` is declared for both browsers, but Firefox may drop the binding if another add-on already claims it. Rebind it under **Add-ons → gear icon → Manage Extension Shortcuts**.
*   **Firefox options page**: Firefox opens the settings page via `options_ui` in a full tab; the layout is identical to Chrome's.

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

This project is licensed under the **Mozilla Public License 2.0 (MPL-2.0)**. See the [LICENSE](LICENSE) file for details.

## 🧹 Maintenance Notes

*   Extension sources live in `src/`; repo tooling (`scripts/`, `tests/`) stays outside the packaged payload.
*   `src/manifest.json` and `package.json` versions are asserted to match by `npm run check`; the release ZIPs are named from that version.
*   `src/manifest.json` is the Chrome manifest and the single source of truth. The Firefox manifest is derived from it at package time by the pure transform in `scripts/firefox-manifest.mjs` (event-page `background.scripts`, `browser_specific_settings.gecko`, `options_ui` instead of `options_page`, no `use_dynamic_url`) and checked by `tests/firefoxManifest.test.mjs` plus `scripts/validate-release.mjs`.
*   The `importScripts(...)` call at the top of `src/service_worker.js` is guarded by a `typeof importScripts === 'function'` check: Chrome uses it, Firefox loads the same four libraries through `background.scripts` instead. Keep the two lists in the same order - a test asserts it.
*   `npm run check` runs JSON validation, ESLint, the test suite, packaging, and release validation. Tests are discovered automatically via `node --test`, so a new `tests/*.test.mjs` file needs no script change.
*   Permissions are allowlisted in both `tests/releaseManifest.test.mjs` and `scripts/validate-release.mjs`; the broad `tabs` permission is deliberately not requested.
*   Historical per-release notes for v1.2.1 are archived in `UPDATE_NOTES.md`.
