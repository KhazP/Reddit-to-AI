# Privacy Policy for Reddit to AI

**Last Updated:** August 23, 2026

## Overview

Reddit to AI is a browser extension that helps you transfer Reddit thread content to AI chat platforms. **Your privacy is our priority** — all content processing happens locally in your browser. The only thing that ever leaves your browser for us is an anonymous count of five actions, which you can turn off.

---

## Data Collection

### What We Collect
**No personal data.** This extension does not collect, transmit, or store any personal data on external servers.

The one exception is anonymous usage statistics, on by default and switchable off in
**Options → Anonymous Usage Stats**. When on, at most once every 30 minutes the extension
sends: the fixed app name `reddit-to-ai`, a fixed public ingest key, a random install UUID,
the extension version, and counts of these five events — `ext_installed`, `ext_updated`,
`ext_active`, `ext_extract`, `ext_handoff`.

It never sends Reddit URLs, thread titles, post or comment text, subreddit names,
usernames, prompt text, API keys, or anything you typed. Turning the toggle off deletes the
install UUID and all buffered counts. The Firefox build never sends anything.

### What Stays Local
The following data is stored **only in your browser** using Chrome's local storage:
- Your extension settings and preferences
- Scraped thread history (for your convenience)
- Selected language preference

---

## Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| `activeTab` | To read the current Reddit page when you click "Scrape" |
| `scripting` | To inject the scraper script into Reddit pages |
| `storage` | To save your settings and scrape history locally |
| `tabs` | To open AI platform tabs and paste content |
| `notifications` | To show status updates (optional, can be disabled) |
| `alarms` | To run the 30-minute timer for anonymous usage counts (optional, can be disabled) |

### Host Permissions
- `reddit.com` — To scrape thread content
- `gemini.google.com`, `chatgpt.com`, `claude.ai`, `aistudio.google.com` — To paste content into AI chat interfaces

---

## Data Sharing

**We do not share any data** with third parties. The anonymous usage counts above go only to
the developer's own endpoint and are never sold or passed on. The scraped Reddit content is sent directly from your browser to the AI platform you choose — we have no servers in between.

---

## Third-Party Services

When you use this extension to send content to AI platforms (ChatGPT, Gemini, Claude, etc.), that content is subject to **their** privacy policies:
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)

---

## Your Rights

Since all data is stored locally:
- **Delete your data** anytime by clearing extension storage or uninstalling
- **Export your data** using the extension's JSON export feature
- **No account required** — use the extension anonymously

---

## Changes to This Policy

We may update this policy occasionally. Changes will be reflected in the "Last Updated" date above.

---

## Contact

For privacy concerns or questions, please open an issue on our [GitHub repository](https://github.com/KhazP/Reddit-to-AI/issues).

---

**TL;DR:** We don't collect your data. Your Reddit content and prompts never reach us. The only thing we receive is an anonymous count of five actions, and you can switch that off in Options. 🔒
