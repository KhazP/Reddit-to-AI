# Design Specification: Reddit Inline AI Button

This document details the architectural, UI/UX, and technical design for adding an unobtrusive, native-styled AI button to Reddit pages (both in feed listings and inside post detail views), fully toggleable in settings.

---

## 1. Goal & Requirements

### 1.1 Objectives
* **Seamless Integration**: Add an AI button directly into Reddit's post action row alongside Upvote, Comment count, and Share buttons.
* **Non-Distracting Visuals**: Match Reddit's native pill styling (dark/light theme colors, fonts, hover states, border radiuses) so it feels like a built-in feature rather than an overlay.
* **Feed & Post Support**:
  * Inside Post: Instantly summarize/process the active thread.
  * In Feed: Scrape the selected post and its comments in the background without leaving the feed.
* **Settings & Customization**:
  * Master toggle to enable/disable the Reddit inline button.
  * Sub-toggles for "Feed post cards" and "Inside post pages".
  * Instant reactive updates across open Reddit tabs when settings change.
* **Visual Feedback**: Subtle micro-spinner on the clicked button + floating progress tracker panel.
* **Full Multi-Language Support**: All new labels and tooltips localized across all supported languages.

---

## 2. Technical Architecture & Component Design

### 2.1 Content Script Button Injection (`redditButtonInjector.js` or `floatingPanel.js`)
* **Target Elements**:
  * Modern Reddit ("Shreddit"): `<shreddit-post>`, `shreddit-async-loader[bundlename="comment_action_row"]`, `div[slot="action-row"]`, or `div.flex.flex-row.items-center` containing share/comment buttons.
  * Classic / Legacy new Reddit fallback selectors.
* **SPA & Dynamic Loading Handling**:
  * Implement a debounced `MutationObserver` to watch for newly added `<shreddit-post>` elements during infinite scroll and client-side page transitions.
  * Maintain a `WeakSet` or `data-r2ai-injected="true"` attribute check on action bars to prevent duplicate button injections.
* **Feed vs. Post Context Detection**:
  * Inside Post page: Target post action row inside the main post container.
  * In Feed: Post cards in the feed stream. The injector extracts the post permalink URL (`shreddit-post[permalink]` or anchor `a[data-testid="post-title"]` / `a[slot="full-post-link"]`).

---

### 2.2 Button UI & Styling (`floatingPanel.css` or `redditButton.css`)
* **HTML Structure**:
  ```html
  <button type="button" class="r2ai-inline-btn" data-permalink="/r/.../comments/..." title="Summarize with AI">
    <svg class="r2ai-sparkle-icon" viewBox="0 0 16 16" width="14" height="14" fill="none">
      <path d="M8 1L9.5 5.5L14 7L9.5 8.5L8 13L6.5 8.5L8 13L6.5 8.5L2 7L6.5 5.5L8 1Z" fill="currentColor"/>
    </svg>
    <span class="r2ai-btn-text">AI</span>
    <span class="r2ai-btn-spinner" style="display:none;"></span>
  </button>
  ```
* **CSS & Theme Adaptation**:
  * Inherits Reddit theme custom properties (`var(--color-neutral-content-weak)`, `var(--color-tone-4)`, etc.) or uses neutral RGBA values matching light and dark themes seamlessly.
  * Height, border-radius (`9999px` pill), padding (`0 10px`), and font-size (`12px`/`0.75rem`) match adjacent Reddit action buttons (`Share`, `Comments`).
  * Hover transition with subtle background tint matching Reddit's native hover effect.

---

### 2.3 Execution Flow & Scraping

```
[User clicks "AI" button on Post/Feed Card]
                   │
                   ▼
       Is inside post detail page?
      ┌────────────┴────────────┐
     YES                        NO (In Feed)
      │                          │
      ▼                          ▼
Trigger active tab scrape   Extract permalink from card
(via existing scraper)      Send `scrapeThreadUrl` message to service worker
      │                          │
      └────────────┬─────────────┘
                   │
                   ▼
[Button shows micro-spinner & floating panel displays progress phases]
                   │
                   ▼
[Prompt constructed via promptBuilder.js]
                   │
                   ▼
[Handoff to preferred AI: ChatGPT / Claude / Gemini / DeepSeek / API]
                   │
                   ▼
[Reset button state & complete progress panel]
```

#### In-Feed Scraping Engine:
* `service_worker.js` handles `scrapeThreadUrl`:
  * Fetches the Reddit JSON endpoint (`${permalink}.json?raw_json=1&sort=confidence`).
  * Passes JSON payload into `R2AIRedditParser.parseRedditJson()`.
  * Generates prompt via `R2AIPromptBuilder.buildPrompt()`.
  * Sends progress updates to the active tab's `floatingPanel.js` so the user visually sees fetching, parsing, and filtering stages.
  * Dispatches output to selected AI provider / clipboard.

---

### 2.4 Settings & Configuration (`options.html`, `options.js`)

* **Storage Keys**:
  * `showRedditInlineButton` (boolean, default: `true`) - Master toggle.
  * `showRedditButtonInFeed` (boolean, default: `true`) - Sub-toggle for feed cards.
  * `showRedditButtonInPost` (boolean, default: `true`) - Sub-toggle for inside post pages.
* **Settings UI**:
  * Added to the Options page under a clear card/section: **"Reddit In-Page Button"** (`reddit_button_settings_title`).
  * Instant change listener (`chrome.storage.onChanged`) in content script to add or remove buttons on the fly without page reloads.

---

### 2.5 Localization & String Keys

Added to all `_locales/*/messages.json`:
* `reddit_btn_label`: "AI"
* `reddit_btn_tooltip`: "Summarize thread with AI"
* `settings_reddit_btn_title`: "Reddit In-Page AI Button"
* `settings_reddit_btn_desc`: "Show quick AI action buttons directly on Reddit posts"
* `settings_reddit_btn_master`: "Enable in-page AI button"
* `settings_reddit_btn_feed`: "Show on feed post cards"
* `settings_reddit_btn_post`: "Show inside post detail pages"

---

## 3. Verification Plan

### 3.1 Automated & Unit Tests
* Validate selector matching and permalink extraction logic for Reddit post cards.
* Verify settings storage read/write defaults and updates.
* Verify JSON scraping and prompt generation for direct thread URLs.

### 3.2 Manual Verification
* **Feed View Testing**: Open `reddit.com`, verify AI button renders next to Share on all feed posts. Click button and ensure background scrape finishes and opens target AI without navigating.
* **Post View Testing**: Open a post detail page (`/r/.../comments/...`), verify AI button is present in main post action row. Click button and verify direct scrape.
* **Dark/Light Mode**: Toggle Reddit dark mode and light mode; ensure button matches native color palette in both modes.
* **Settings Toggles**: Disable master toggle in Options -> confirm button disappears on Reddit immediately. Enable master toggle, disable feed sub-toggle -> confirm button only appears inside posts.
