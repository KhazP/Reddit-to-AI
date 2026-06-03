# Privacy Policy

**Reddit to AI**  
Last updated: April 28, 2026

---

## Overview

Reddit to AI is a Chrome extension that prepares Reddit threads for AI tools you choose. It can open a prompt preview first, or it can hand the generated prompt directly to the selected AI site when you choose direct send.

The extension developer does not operate a backend for this extension and does not collect analytics, usage data, crash reports, scraped Reddit content, prompts, API keys, or personal information.

---

## Data the Extension Accesses

To perform a scrape or prompt handoff, the extension may access:

| Data | Purpose |
|------|---------|
| Content of the active Reddit tab | Build the thread summary, comments, metadata, and prompt context |
| Prompt templates, quick prompts, filters, and settings | Prepare the prompt according to your choices |
| Selected AI provider and output format | Open the chosen AI destination and format the prompt |
| Optional scrape history and saved presets | Let you reuse prior prompts or settings when you enable storage |

This data is processed locally in your browser unless you explicitly send the prompt to an AI provider.

---

## Prompt Preview and Direct Handoff

When preview is enabled, scraped Reddit data is stored temporarily so `preview.html` can render the prompt for review, editing, copying, exporting, or sending.

When direct send is enabled, the extension builds the prompt in the service worker, stores a pending paste handoff, opens the chosen AI site, and the content script pastes the prompt into that site. The handoff payload is used only for that browser-side transfer.

The "Don't save this scrape" toggle forces a one-time handoff. After the pending paste is consumed, the extension removes the preview, paste, and legacy thread payloads from extension storage.

---

## Storage Choices

Reddit to AI offers three storage modes:

| Mode | Behavior |
|------|----------|
| Don't save | Uses session storage for the active preview or paste handoff and clears the payload after sending |
| Session only | Keeps the active preview or paste handoff in Chrome session storage until the browser session ends |
| Persistent | Saves active preview/paste payloads and scrape history in Chrome local storage so they can be reused later |

General preferences, prompt templates, saved prompt presets, selected provider, filters, and similar settings are saved with `chrome.storage.sync` so Chrome can sync them across your signed-in browser profiles.

No stored extension data is sent to any server controlled by the extension developer.

---

## Data Sent to Third Parties

When you send a prompt to an AI provider, the Reddit content and generated prompt leave your browser and go to the AI site or API you selected, such as ChatGPT, Google Gemini, Claude, or AI Studio. That transfer is initiated by you through preview send or direct send and is governed by the selected provider's own terms and privacy policy.

The extension developer has no visibility into those provider requests or responses.

Provider privacy policies include:

- OpenAI: https://openai.com/policies/privacy-policy
- Google Gemini / AI Studio: https://policies.google.com/privacy
- Anthropic Claude: https://www.anthropic.com/legal/privacy

---

## Remote Assets

The extension pages do not load remote fonts, stylesheets, scripts, or images for their own interface. UI assets are packaged with the extension.

---

## Permissions

The extension requests the following Chrome permissions:

| Permission | Reason |
|------------|--------|
| `activeTab` | Read the Reddit page you are currently viewing when you start a scrape |
| `scripting` | Inject the scraper or paste helper into supported pages |
| `storage` | Save settings, prompt handoff payloads, and optional history according to your storage choice |
| `notifications` | Show completion or status notifications when enabled |
| `tabs` | Open the preview page, options page, feedback page, or selected AI destination |

Host permissions for Reddit and supported AI provider domains are used to scrape Reddit content and complete the browser-side prompt handoff.

---

## API Keys

If you enter API keys or provider credentials in extension settings, they are stored with Chrome extension storage on your device and, for sync-backed settings, may sync through your Chrome profile according to Chrome's sync behavior. They are never sent to or stored by the extension developer.

---

## Children's Privacy

This extension is not directed at children under 13. We do not knowingly collect data from children.

---

## Changes to This Policy

If this policy changes, the updated version will be posted with a revised date.

---

## Contact

For questions or concerns, open an issue at:
https://github.com/KhazP/Reddit-to-AI/issues
