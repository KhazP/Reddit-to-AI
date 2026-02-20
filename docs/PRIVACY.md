# Privacy Policy

**Reddit to AI**
Last updated: February 20, 2026

---

## Overview

Reddit to AI is a Chrome extension that scrapes Reddit threads and sends the content to AI platforms chosen by the user. This policy describes what data the extension accesses, how it is used, and what leaves your device.

---

## Data We Collect

**We do not collect any data.**

No usage data, analytics, crash reports, or personal information is sent to any server operated by this extension's developer.

---

## Data the Extension Accesses Locally

To function, the extension accesses the following data on your device only:

| Data | Purpose |
|------|---------|
| Content of the active Reddit tab | Scraping posts and comments for AI analysis |
| API keys you enter in Settings | Authenticating requests to your chosen AI provider |
| Your preferences and prompt templates | Saving your settings between sessions |

All of this data stays in your browser. It is never transmitted to any server controlled by this extension.

---

## Data Sent to Third Parties

When you click "Scrape & Send", the extension sends the scraped Reddit content directly from your browser to the AI provider you have configured (e.g. OpenAI, Google Gemini). This transmission:

- Is initiated by you explicitly
- Goes directly from your browser to the AI provider
- Is governed by that provider's own privacy policy

**OpenAI:** https://openai.com/policies/privacy-policy
**Google Gemini:** https://policies.google.com/privacy

The extension developer has no visibility into this data transfer and receives none of it.

---

## Permissions

The extension requests the following Chrome permissions:

| Permission | Reason |
|------------|--------|
| `activeTab` | Read the Reddit page you are currently viewing |
| `scripting` | Inject the scraper into Reddit pages |
| `storage` | Save your settings and API keys locally |
| `notifications` | Show a notification when summarization completes |
| `tabs` | Open the feedback form or options page in a new tab |

Host permissions for `reddit.com` and AI provider domains are required to scrape Reddit and send content to your chosen AI API.

---

## API Keys

Your API key is stored locally using `chrome.storage.sync`, which means it syncs across your Chrome profiles via your Google account — the same way Chrome syncs bookmarks and passwords. It is never sent to or stored by this extension's developer.

---

## Children's Privacy

This extension is not directed at children under 13. We do not knowingly collect data from children.

---

## Changes to This Policy

If this policy changes, the updated version will be posted at this URL with a revised date.

---

## Contact

For questions or concerns, open an issue at:
https://github.com/KhazP/Reddit-to-AI/issues
