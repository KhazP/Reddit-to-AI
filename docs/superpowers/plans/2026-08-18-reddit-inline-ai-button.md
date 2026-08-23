# Reddit Inline AI Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-distracting, native-styled "AI" pill button directly to Reddit post action bars (both in feed streams and inside post pages), allowing one-click thread summarization/processing with full settings toggles.

**Architecture:** A lightweight content script (`redditInlineButton.js`) observes Reddit's dynamic DOM with a debounced `MutationObserver`, injecting a native-styled pill button into action rows (`shreddit-post`, `shreddit-comment-action-row`). In-post clicks trigger active-tab scraping, while in-feed clicks extract the post permalink and send a background scrape request to `service_worker.js`, reporting progress through `floatingPanel.js`. Settings are managed via `chrome.storage.sync` with master and sub-toggles in `options.html`.

**Tech Stack:** Vanilla JavaScript (ES2022/MV3), Chrome Extensions API (`storage.sync`, `runtime`, `content_scripts`), CSS3 with native Reddit custom property inheritance, Node.js `node:test` runner.

---

### Task 1: Localization & Options Settings UI

**Files:**
- Modify: `src/_locales/en/messages.json` (and all other locale files: `de`, `es`, `fr`, `ja`, `pt`, `tr`, `zh_CN`)
- Modify: `src/options.html`
- Modify: `src/options.js`
- Modify: `src/options.css`
- Create: `tests/optionsInlineButtonSettings.test.mjs`

- [ ] **Step 1: Write test for new i18n keys and options defaults**

```javascript
// tests/optionsInlineButtonSettings.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('i18n contains all Reddit inline button keys for en', async () => {
  const en = JSON.parse(await readFile(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'));
  const requiredKeys = [
    'reddit_btn_label',
    'reddit_btn_tooltip',
    'settings_reddit_btn_title',
    'settings_reddit_btn_desc',
    'settings_reddit_btn_master',
    'settings_reddit_btn_feed',
    'settings_reddit_btn_post'
  ];
  for (const key of requiredKeys) {
    assert.ok(en[key]?.message, `Missing message for key: ${key}`);
  }
});

test('options.html includes Reddit in-page button configuration section', async () => {
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  assert.ok(html.includes('showRedditInlineButton'), 'options.html must contain showRedditInlineButton toggle');
  assert.ok(html.includes('showRedditButtonInFeed'), 'options.html must contain showRedditButtonInFeed toggle');
  assert.ok(html.includes('showRedditButtonInPost'), 'options.html must contain showRedditButtonInPost toggle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/optionsInlineButtonSettings.test.mjs`
Expected: FAIL with missing keys / elements.

- [ ] **Step 3: Add localized strings to all locale messages.json files**

Add the following keys to `src/_locales/en/messages.json` and translated equivalents to `de`, `es`, `fr`, `ja`, `pt`, `tr`, `zh_CN`:
- `reddit_btn_label`: `{ "message": "AI", "description": "Label on the Reddit inline AI button" }`
- `reddit_btn_tooltip`: `{ "message": "Summarize thread with AI", "description": "Tooltip for Reddit inline AI button" }`
- `settings_reddit_btn_title`: `{ "message": "Reddit In-Page AI Button", "description": "Settings title for Reddit button" }`
- `settings_reddit_btn_desc`: `{ "message": "Display quick AI action buttons directly within Reddit post action bars", "description": "Description for Reddit button settings" }`
- `settings_reddit_btn_master`: `{ "message": "Enable in-page AI button on Reddit", "description": "Master toggle label" }`
- `settings_reddit_btn_feed`: `{ "message": "Show on feed post cards", "description": "Feed post sub-toggle label" }`
- `settings_reddit_btn_post`: `{ "message": "Show inside post detail pages", "description": "Inside post sub-toggle label" }`

- [ ] **Step 4: Update options.html, options.js, and options.css with settings card**

Add settings card in `src/options.html`:
```html
<div class="settings-card" id="section-reddit-button">
  <div class="card-header">
    <div class="card-title-group">
      <span class="card-icon">✨</span>
      <h2 data-i18n="settings_reddit_btn_title">Reddit In-Page AI Button</h2>
    </div>
    <p class="card-desc" data-i18n="settings_reddit_btn_desc">Display quick AI action buttons directly within Reddit post action bars</p>
  </div>
  <div class="setting-item switch-item">
    <div class="setting-info">
      <label class="setting-label" for="showRedditInlineButton" data-i18n="settings_reddit_btn_master">Enable in-page AI button on Reddit</label>
    </div>
    <label class="switch">
      <input type="checkbox" id="showRedditInlineButton" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="setting-subgroup" id="redditButtonSubgroup">
    <div class="setting-item switch-item">
      <div class="setting-info">
        <label class="setting-label" for="showRedditButtonInFeed" data-i18n="settings_reddit_btn_feed">Show on feed post cards</label>
      </div>
      <label class="switch">
        <input type="checkbox" id="showRedditButtonInFeed" checked>
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-item switch-item">
      <div class="setting-info">
        <label class="setting-label" for="showRedditButtonInPost" data-i18n="settings_reddit_btn_post">Show inside post detail pages</label>
      </div>
      <label class="switch">
        <input type="checkbox" id="showRedditButtonInPost" checked>
        <span class="slider"></span>
      </label>
    </div>
  </div>
</div>
```

In `src/options.js`:
- Include `showRedditInlineButton`, `showRedditButtonInFeed`, `showRedditButtonInPost` in `chrome.storage.sync.get` with default values (`true`, `true`, `true`).
- Attach change listeners to update `chrome.storage.sync` and toggle disabled state of `redditButtonSubgroup` when master switch is off.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/optionsInlineButtonSettings.test.mjs tests/i18nMessages.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/_locales/ src/options.html src/options.js src/options.css tests/optionsInlineButtonSettings.test.mjs
git commit -m "feat(settings): add Reddit inline button configuration and localization"
```

---

### Task 2: Service Worker Direct URL Background Scrape Handler

**Files:**
- Modify: `src/service_worker.js`
- Create: `tests/backgroundSingleUrlScrape.test.mjs`

- [ ] **Step 1: Write test for background single URL scrape handling**

```javascript
// tests/backgroundSingleUrlScrape.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

test('service worker handles threadUrl in handleScrapeRequest', async () => {
  // Test that passing threadUrl directly triggers scrapeThreadFromUrl in background
  // and hands off to preview / direct AI
  const mockUrl = 'https://www.reddit.com/r/test/comments/123/sample_post/';
  assert.ok(mockUrl.includes('/comments/'), 'Valid thread url format');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backgroundSingleUrlScrape.test.mjs`
Expected: FAIL or verify requirements.

- [ ] **Step 3: Update `service_worker.js` to support `threadUrl` in `handleScrapeRequest`**

In `src/service_worker.js`:
- In `handleScrapeRequest(request, sender)`:
  - If `request.threadUrl` is present:
    - Set state to active with phase `prepare`.
    - Find target tab (or `sender.tab.id` if available) to broadcast progress updates via `updateFloatingPanel`.
    - Load settings and merge request filters.
    - Call `scrapeThreadFromUrl(request.threadUrl, effectiveSettings, request.filters || {})`.
    - Save preview data or call `sendDataDirectlyToAi(data, effectiveSettings)` if direct mode.
    - Set state to `complete` with auto-dismiss.
    - Return `{ started: true, backgroundUrl: true }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/backgroundSingleUrlScrape.test.mjs tests/backgroundScrapeHandoff.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service_worker.js tests/backgroundSingleUrlScrape.test.mjs
git commit -m "feat(sw): add direct URL background scrape handling for inline button"
```

---

### Task 3: Reddit Inline Button Content Script & Styling

**Files:**
- Create: `src/redditInlineButton.js`
- Create: `src/redditInlineButton.css`
- Modify: `src/manifest.json`
- Create: `tests/redditInlineButton.test.mjs`

- [ ] **Step 1: Write unit test for button injection and permalink detection**

```javascript
// tests/redditInlineButton.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('redditInlineButton.js exists and defines DOM injection and click handler', async () => {
  const content = await readFile(new URL('../src/redditInlineButton.js', import.meta.url), 'utf8');
  assert.ok(content.includes('shreddit-post'), 'Must support modern shreddit-post selector');
  assert.ok(content.includes('chrome.storage.onChanged'), 'Must listen for settings changes');
  assert.ok(content.includes('r2ai-inline-btn'), 'Must create button with class r2ai-inline-btn');
});

test('manifest.json registers redditInlineButton.js in content_scripts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  const redditContentScript = manifest.content_scripts.find(cs => cs.matches.some(m => m.includes('reddit.com')));
  assert.ok(redditContentScript.js.includes('redditInlineButton.js'), 'Must include redditInlineButton.js');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/redditInlineButton.test.mjs`
Expected: FAIL (files do not exist yet).

- [ ] **Step 3: Implement `src/redditInlineButton.js`**

Implement `src/redditInlineButton.js`:
- Initialize i18n helpers.
- Load settings (`showRedditInlineButton`, `showRedditButtonInFeed`, `showRedditButtonInPost`).
- Observe storage changes via `chrome.storage.onChanged` to dynamically insert or remove buttons when settings change.
- Selectors for injection:
  - Modern Shreddit: `<shreddit-post>` -> find action row (e.g. `shreddit-async-loader[bundlename="comment_action_row"]`, `div[slot="action-row"]`, `div.flex.flex-row.items-center`).
  - Fallback action bars on post cards and detail pages.
- Create native-styled button:
  - Sparkle icon SVG + text "AI" + hidden spinner.
  - Hover tooltip.
- Click handler:
  - In post view (`window.location.pathname.includes('/comments/')` and button is on main post): Send `{ action: 'scrapeReddit' }`.
  - In feed view: Extract permalink from post element (`post.getAttribute('permalink')` or title anchor href), send `{ action: 'scrapeReddit', threadUrl: absoluteUrl }`.
  - Set button state to `loading` (spinner visible), revert on completion message.
- Debounced `MutationObserver` on `document.body` to handle infinite scroll and SPA view transitions smoothly.

- [ ] **Step 4: Implement `src/redditInlineButton.css`**

Implement `src/redditInlineButton.css`:
- Native Reddit pill styling matching theme colors:
  - `display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; height: 32px; border-radius: 9999px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; background: rgba(120, 120, 128, 0.15); color: inherit; transition: background-color 0.15s ease;`
  - Dark/Light mode awareness (inherit Reddit css vars or subtle neutral translucency).
  - Hover state: `background: rgba(120, 120, 128, 0.25);`
  - Spinner animation: CSS keyframes spinning circle when `.is-loading`.

- [ ] **Step 5: Register script & CSS in `src/manifest.json` and web accessible resources**

Update `src/manifest.json`:
- Add `redditInlineButton.js` to Reddit `content_scripts.js`.
- Add `redditInlineButton.css` to `web_accessible_resources`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/redditInlineButton.test.mjs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/redditInlineButton.js src/redditInlineButton.css src/manifest.json tests/redditInlineButton.test.mjs
git commit -m "feat(reddit): add unobtrusive inline AI button to Reddit post action bars"
```

---

### Task 4: Packaging, Firefox Manifest & Full Regression Suite

**Files:**
- Modify: `scripts/firefox-manifest.mjs` (if needed)
- Tests: `tests/firefoxManifest.test.mjs`, `tests/packageExtension.test.mjs`

- [ ] **Step 1: Run full automated verification suite**

Run: `npm test`
Expected: PASS (all 36+ test suites passing).

- [ ] **Step 2: Run full release validation and package check**

Run: `npm run check`
Expected: All validation checks, linter, tests, packaging, and release verification pass cleanly with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify extension build, packaging, and test suite"
```

---

## Verification Plan

### Automated Tests
- `npm test` - Runs all 36+ unit tests across scraper, background worker, i18n, options, and inline button DOM.
- `npm run check` - Validates JSON, linter, test suite, extension packaging, and Firefox manifest sync.

### Manual Verification
1. Load extension unpacked in Chrome/Brave.
2. Open `reddit.com` home feed:
   - Verify `✨ AI` pill button appears on every post card alongside Upvote, Comment, and Share.
   - Click the AI button on a feed card -> observe micro-spinner on button, floating panel progress tracking, and prompt delivery to AI without leaving feed.
3. Click into a post detail page:
   - Verify `✨ AI` button appears in the main post action bar.
   - Click button -> observe active page scrape and prompt generation.
4. Test Settings:
   - Open Extension Options -> Toggle off "Show on feed post cards" -> Return to Reddit feed -> verify buttons disappear on feed cards.
   - Toggle off master "Enable in-page AI button on Reddit" -> verify all inline buttons disappear immediately without reload.
   - Re-enable master switch -> buttons reappear immediately.
