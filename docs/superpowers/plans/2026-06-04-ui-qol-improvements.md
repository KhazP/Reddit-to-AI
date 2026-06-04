# UI Quality of Life & Visual Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 8 Quality of Life and visual updates including a Radix-style sliding tab popup layout, inline tooltip help, a horizontal export chip bar, a real-time token budget estimator, a left-nav sidebar Settings page layout, a subreddit route wildcard tester, and comprehensive localization updates.

**Architecture:** Decomposed into 6 sequential tasks. The tooltip and tab systems are implemented as modular, reusable vanilla JS/CSS utilities. The Settings page uses sidebar state routing. Language strings are updated in all locale directories.

**Tech Stack:** Chrome Extension MV3, Vanilla JavaScript, HTML5, CSS3.

---

### Task 1: Reusable Vanilla Tooltips System

**Files:**
- Create: `tooltip.js`
- Create: `tooltip.css`
- Modify: `popup.html`
- Modify: `preview.html`
- Modify: `options.html`

- [ ] **Step 1: Create `tooltip.css`**
  Write the tooltip styling with spring animations and positioning classes:
  ```css
  .tooltip-bubble {
    position: absolute;
    z-index: 9999;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 6px 10px;
    color: #f8fafc;
    font-size: 11px;
    line-height: 1.4;
    max-width: 220px;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    opacity: 0;
    transform: translateY(4px) scale(0.95);
    transition: opacity 150ms ease, transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tooltip-bubble.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  .tooltip-arrow {
    position: absolute;
    width: 6px;
    height: 6px;
    background: #18181b;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    transform: rotate(45deg);
  }
  ```

- [ ] **Step 2: Create `tooltip.js`**
  Implement positioning calculations, dynamic element instantiation, and hover/focus listeners:
  ```javascript
  (function() {
    function initTooltips() {
      const targets = document.querySelectorAll('[data-tooltip]');
      targets.forEach(target => {
        if (target.dataset.tooltipInitialized) return;
        target.dataset.tooltipInitialized = "true";
        
        let tooltipEl = null;

        function show() {
          if (tooltipEl) return;
          tooltipEl = document.createElement('div');
          tooltipEl.className = 'tooltip-bubble';
          
          const textKey = target.getAttribute('data-tooltip');
          tooltipEl.innerText = chrome.i18n.getMessage(textKey) || textKey;
          
          document.body.appendChild(tooltipEl);
          
          // Position
          const rect = target.getBoundingClientRect();
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          
          const left = rect.left + scrollX + (rect.width / 2) - (tooltipEl.offsetWidth / 2);
          const top = rect.top + scrollY - tooltipEl.offsetHeight - 8;
          
          tooltipEl.style.left = `${Math.max(4, left)}px`;
          tooltipEl.style.top = `${Math.max(4, top)}px`;
          
          // Arrow
          const arrow = document.createElement('div');
          arrow.className = 'tooltip-arrow';
          arrow.style.left = `${tooltipEl.offsetWidth / 2 - 3}px`;
          arrow.style.bottom = '-4px';
          tooltipEl.appendChild(arrow);
          
          // Force reflow
          tooltipEl.offsetHeight;
          tooltipEl.classList.add('visible');
        }

        function hide() {
          if (!tooltipEl) return;
          const el = tooltipEl;
          tooltipEl = null;
          el.classList.remove('visible');
          setTimeout(() => el.remove(), 150);
        }

        target.addEventListener('mouseenter', show);
        target.addEventListener('mouseleave', hide);
        target.addEventListener('focus', show);
        target.addEventListener('blur', hide);
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTooltips);
    } else {
      initTooltips();
    }
    window.initR2ATooltips = initTooltips;
  })();
  ```

- [ ] **Step 3: Modify manifest.json to include new scripts and styles**
  Open [manifest.json](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/manifest.json) and add `tooltip.css` and `tooltip.js` to options and popup configurations.

- [ ] **Step 4: Verify tooltips load**
  Run: `npm run check` to ensure code is lint-free and builds cleanly.

- [ ] **Step 5: Commit**
  ```bash
  git add tooltip.js tooltip.css
  git commit -m "feat: implement reusable vanilla tooltips helper"
  ```

---

### Task 2: Tabbed Popup Layout & Auto-growing Input

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `popup.css`

- [ ] **Step 1: Add tab navigation controls to `popup.html`**
  Replace the header or section below header with segmented controls:
  ```html
  <div class="tabs-list" role="tablist">
    <button id="tabScrape" class="tab-trigger active" role="tab" aria-selected="true" data-tab="tabPaneScrape">Scrape</button>
    <button id="tabFilters" class="tab-trigger" role="tab" aria-selected="false" data-tab="tabPaneFilters">Filters</button>
  </div>
  ```
  Wrap Scrape elements inside `<div id="tabPaneScrape" class="tab-content">` and Filters inside `<div id="tabPaneFilters" class="tab-content hidden">`.

- [ ] **Step 2: Add tab styling to `popup.css`**
  ```css
  .tabs-list {
    display: flex;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    border-radius: 20px;
    padding: 2px;
    margin-bottom: 4px;
  }
  .tab-trigger {
    flex: 1;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 18px;
    cursor: pointer;
    transition: var(--transition);
  }
  .tab-trigger:hover {
    color: var(--text-primary);
  }
  .tab-trigger.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: 0 0 8px rgba(255, 69, 0, 0.2);
    border: 1px solid rgba(255, 69, 0, 0.3);
  }
  .tab-content.hidden {
    display: none !important;
  }
  ```

- [ ] **Step 3: Implement tab switching and auto-grow prompt input in `popup.js`**
  Add click listeners to `.tab-trigger` buttons:
  ```javascript
  document.querySelectorAll('.tab-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-trigger').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const targetPane = document.getElementById(btn.getAttribute('data-tab'));
      if (targetPane) targetPane.classList.remove('hidden');
    });
  });
  
  // Auto-grow textarea
  const qPrompt = document.getElementById('quickPrompt');
  qPrompt.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });
  ```

- [ ] **Step 4: Verify layout switches**
  Ensure the layout transition switches views seamlessly. Run `npm run check`.

- [ ] **Step 5: Commit**
  ```bash
  git commit -am "feat: implement tabbed popup interface and auto-growing quick prompt"
  ```

---

### Task 3: Real-Time BPE Token Budget Bar

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `popup.css`

- [ ] **Step 1: Add budget bar markup to `popup.html`**
  Place progress bar inside `.send-mode-section` or status footer:
  ```html
  <div class="budget-bar-container">
    <div class="budget-bar-track">
      <div id="budgetValueBar" class="budget-bar-fill" style="width: 0%;"></div>
    </div>
    <span id="budgetLabel" class="budget-text">Budget: 0 tokens</span>
  </div>
  ```

- [ ] **Step 2: Style budget bar in `popup.css`**
  ```css
  .budget-bar-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }
  .budget-bar-track {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
  }
  .budget-bar-fill {
    height: 100%;
    width: 0%;
    border-radius: 2px;
    transition: width 0.3s ease, background-color 0.3s ease;
  }
  .budget-bar-fill.safe { background: var(--success); }
  .budget-bar-fill.moderate { background: var(--warning); }
  .budget-bar-fill.large { background: var(--accent); }
  .budget-text {
    font-size: 11px;
    color: var(--text-muted);
  }
  ```

- [ ] **Step 3: Wire calculations in `popup.js`**
  Integrate `globalThis.R2ATiktokenPromise` listeners to compute current token usage. Update progress:
  ```javascript
  function updateBudgetTracker(tokenCount) {
    const bar = document.getElementById('budgetValueBar');
    const label = document.getElementById('budgetLabel');
    if (!bar || !label) return;
    
    const maxTokens = 32000;
    const percentage = Math.min(100, (tokenCount / maxTokens) * 100);
    bar.style.width = `${percentage}%`;
    
    bar.className = 'budget-bar-fill';
    if (tokenCount < 8000) {
      bar.classList.add('safe');
      label.innerText = `Budget: ${tokenCount.toLocaleString()} tokens (Safe)`;
    } else if (tokenCount < 32000) {
      bar.classList.add('moderate');
      label.innerText = `Budget: ${tokenCount.toLocaleString()} tokens (Moderate)`;
    } else {
      bar.classList.add('large');
      label.innerText = `Budget: ${tokenCount.toLocaleString()} tokens (Large)`;
    }
  }
  ```

- [ ] **Step 4: Verify tokens recalculate**
  Verify the tokenizer updates values correctly. Run tests `npm run check`.

- [ ] **Step 5: Commit**
  ```bash
  git commit -am "feat: integrate real-time visual token budget estimator"
  ```

---

### Task 4: Horizontal Export Chips

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `preview.html`
- Modify: `preview.js`
- Modify: `popup.css`
- Modify: `preview.css`

- [ ] **Step 1: Replace Select Dropdowns with Export Chips in `popup.html` & `preview.html`**
  ```html
  <div class="export-chips-row">
    <button type="button" class="export-chip disabled" data-format="markdown" data-tooltip="tooltip_export_md">
      <span class="chip-icon">MD</span> Markdown
    </button>
    <button type="button" class="export-chip disabled" data-format="json" data-tooltip="tooltip_export_json">
      <span class="chip-icon">JS</span> JSON
    </button>
    <button type="button" class="export-chip disabled" data-format="csv" data-tooltip="tooltip_export_csv">
      <span class="chip-icon">CS</span> CSV
    </button>
  </div>
  ```

- [ ] **Step 2: Style Export Chips in `popup.css` and `preview.css`**
  ```css
  .export-chips-row {
    display: flex;
    gap: 8px;
    width: 100%;
    margin-top: 10px;
  }
  .export-chip {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    background: var(--bg-glass);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
  }
  .export-chip:hover:not(.disabled) {
    border-color: var(--accent);
    color: var(--text-primary);
    box-shadow: 0 0 8px var(--accent-glow);
    transform: scale(1.02);
  }
  .export-chip.disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }
  .chip-icon {
    font-size: 9px;
    font-weight: 800;
    background: rgba(255,255,255,0.08);
    padding: 2px 4px;
    border-radius: 4px;
  }
  ```

- [ ] **Step 3: Wire trigger events in `popup.js` & `preview.js`**
  Add click listeners to individual chips:
  ```javascript
  document.querySelectorAll('.export-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.classList.contains('disabled')) return;
      const format = chip.getAttribute('data-format');
      triggerExport(format);
    });
  });
  ```

- [ ] **Step 4: Verify chip behavior**
  Verify the download activates when scrape completes. Run `npm run check`.

- [ ] **Step 5: Commit**
  ```bash
  git commit -am "feat: replace export selectors with horizontal visual export chips"
  ```

---

### Task 5: Options Page Sidebar Layout

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `options.css`

- [ ] **Step 1: Add Sidebar markup in `options.html`**
  Wrap settings panels in sections and add `<nav class="sidebar-nav">` on the left of `.main-content`.
  ```html
  <nav class="sidebar-nav">
    <button class="nav-item active" data-target="sectionAi">🌐 AI Assistant</button>
    <button class="nav-item" data-target="sectionPresets">📝 Prompt Presets</button>
    <button class="nav-item" data-target="sectionScraping">⚙️ Scraping & Filters</button>
    <button class="nav-item" data-target="sectionMappings">🔀 Subreddit Mappings</button>
    <button class="nav-item" data-target="sectionCustom">🔌 Custom WebUIs</button>
  </nav>
  ```

- [ ] **Step 2: Add sidebar navigation styles in `options.css`**
  ```css
  .options-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .main-content {
    display: flex;
    gap: 24px;
    flex: 1;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
  }
  .sidebar-nav {
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: var(--transition);
  }
  .nav-item:hover {
    color: var(--text-primary);
    background: var(--bg-glass);
  }
  .nav-item.active {
    background: var(--bg-card);
    border-color: var(--accent);
    color: var(--text-primary);
    box-shadow: 0 0 12px var(--accent-glow);
  }
  .settings-pane {
    flex: 1;
    display: none;
    animation: fadeIn 0.2s ease-in-out;
  }
  .settings-pane.active {
    display: block;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  ```

- [ ] **Step 3: Implement sidebar section routing in `options.js`**
  ```javascript
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
      
      item.classList.add('active');
      const targetId = item.getAttribute('data-target');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
  ```

- [ ] **Step 4: Verify page layouts**
  Verify navigation clicks change setting panel views. Run `npm run check`.

- [ ] **Step 5: Commit**
  ```bash
  git commit -am "feat: redesign options settings layout with left-nav sidebar dashboard"
  ```

---

### Task 6: Subreddit Route Tester & Internationalization Sync

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `_locales/*/messages.json` (English, German, Spanish, French, Turkish, etc.)

- [ ] **Step 1: Add Route Tester Markup to `options.html`**
  Add under the Subreddit Rules block:
  ```html
  <div class="route-tester-card">
    <h3>Test Wildcard Routing Rule</h3>
    <input type="text" id="routeTesterInput" placeholder="Enter subreddit to test, e.g. investing_europe">
    <div id="routeTesterResult" class="route-test-result">No pattern matched</div>
  </div>
  ```

- [ ] **Step 2: Add matching logic in `options.js`**
  ```javascript
  const testerInput = document.getElementById('routeTesterInput');
  const testerResult = document.getElementById('routeTesterResult');
  
  if (testerInput && testerResult) {
    testerInput.addEventListener('input', () => {
      const val = testerInput.value.trim().toLowerCase();
      if (!val) {
        testerResult.innerText = "No pattern matched";
        return;
      }
      chrome.storage.sync.get(['subredditPromptMappings'], (result) => {
        const mappings = result.subredditPromptMappings || [];
        let matched = null;
        for (const mapping of mappings) {
          const pattern = mapping.pattern.toLowerCase();
          if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            if (val.startsWith(prefix)) {
              matched = mapping;
              break;
            }
          } else if (val === pattern) {
            matched = mapping;
            break;
          }
        }
        if (matched) {
          testerResult.innerHTML = `Matched Rule: <strong>${matched.pattern}</strong> → Preset: <strong>${matched.preset}</strong>`;
        } else {
          testerResult.innerText = "No custom rules matched. Resolves to default template.";
        }
      });
    });
  }
  ```

- [ ] **Step 3: Update `_locales/en/messages.json` with all new i18n keys**
  Add keys for tooltip strings, tabs, and testing cards:
  ```json
  "tooltip_preset_summarize": { "message": "Generates a structured TL;DR summary highlighting main topics." },
  "tooltip_export_md": { "message": "Download raw content as formatted Markdown (.md) file." },
  "tooltip_export_json": { "message": "Download structured JSON payload." },
  "tooltip_export_csv": { "message": "Download comment tree as CSV rows." }
  ```
  Perform corresponding updates for other languages (German, Spanish, French, Turkish, etc.) to keep translation dictionaries in sync.

- [ ] **Step 4: Run full check**
  Run: `npm run check`
  Verify all tests pass and there are no warnings or packaging issues.

- [ ] **Step 5: Commit**
  ```bash
  git commit -am "feat: implement subreddit pattern routing tester and synchronize locales translations"
  ```
