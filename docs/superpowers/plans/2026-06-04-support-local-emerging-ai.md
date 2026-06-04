# Support for Local & Emerging AI Platforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native support for DeepSeek and Groq, plus a flexible "Custom" platform configuration to support local WebUIs (e.g. Ollama, LocalAI) and emerging AI platforms using dynamic host permissions and dynamic content scripts.

**Architecture:** We will update the manifest with static permissions/matches for DeepSeek and Groq. For Custom platforms, the user configures URLs in the Options page, which dynamically requests host permissions using `chrome.permissions.request` and registers the content script (`aiPaster.js`) via `chrome.scripting.registerContentScripts`. The background service worker listens for changes and manages registration dynamically, including on startup.

**Tech Stack:** Chrome Extension APIs (MV3, Permissions API, Scripting API, Storage API), HTML, Vanilla CSS, Vanilla JavaScript, Node.js (test suite).

---

### Task 1: Manifest Updates

**Files:**
- Modify: `manifest.json`
- Test: `tests/releaseManifest.test.mjs`

- [ ] **Step 1: Add DeepSeek and Groq to Manifest permissions**
  In `manifest.json`, add `"https://chat.deepseek.com/*"` and `"https://*.groq.com/*"` to the `"host_permissions"` array.

- [ ] **Step 2: Add DeepSeek and Groq to Content Script matches**
  In `manifest.json`, add `"https://chat.deepseek.com/*"` and `"https://*.groq.com/*"` to the matches array under content script injecting `aiPaster.js`.

- [ ] **Step 3: Add DeepSeek and Groq to web_accessible_resources**
  In `manifest.json`, add `"https://chat.deepseek.com/*"` and `"https://*.groq.com/*"` to the matches array under `web_accessible_resources[0]`.

- [ ] **Step 4: Verify with existing release manifest tests**
  Run: `node tests/releaseManifest.test.mjs`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add manifest.json
  git commit -m "feat: add DeepSeek and Groq hosts and script matches to manifest"
  ```

---

### Task 2: Options Page UI (HTML & CSS)

**Files:**
- Modify: `options.html`
- Modify: `options.css`

- [ ] **Step 1: Add radio options for DeepSeek, Groq, and Custom AI platform**
  In `options.html`, find the AI Assistant platform radio group. Add DeepSeek, Groq, and Custom platform option buttons:
  ```html
  <label class="radio-option">
      <input type="radio" name="llmProvider" value="deepseek">
      <div class="radio-content">
          <span class="radio-label">DeepSeek</span>
          <span class="radio-hint">Inject prompt into chat.deepseek.com</span>
      </div>
  </label>
  <label class="radio-option">
      <input type="radio" name="llmProvider" value="groq">
      <div class="radio-content">
          <span class="radio-label">Groq</span>
          <span class="radio-hint">Inject prompt into groq.com interface</span>
      </div>
  </label>
  <label class="radio-option">
      <input type="radio" name="llmProvider" value="custom">
      <div class="radio-content">
          <span class="radio-label">Custom AI Platform / Local WebUI</span>
          <span class="radio-hint">Specify your own AI origin/Local WebUI (e.g. Ollama, LocalAI)</span>
      </div>
  </label>
  ```

- [ ] **Step 2: Add Input Selectors for DeepSeek, Groq, and Custom to Selector Overrides Card**
  In `options.html`, find the custom selectors configuration fields. Add deepseek, groq, and custom text inputs:
  ```html
  <div class="form-group inline-input-row">
      <label class="inline-label" for="selectorDeepseek">DeepSeek input selector:</label>
      <input type="text" id="selectorDeepseek" class="search-input" placeholder="Default: textarea" style="width: 250px;">
  </div>
  <div class="form-group inline-input-row">
      <label class="inline-label" for="selectorGroq">Groq input selector:</label>
      <input type="text" id="selectorGroq" class="search-input" placeholder="Default: textarea" style="width: 250px;">
  </div>
  <div class="form-group inline-input-row">
      <label class="inline-label" for="selectorCustom">Custom platform input selector:</label>
      <input type="text" id="selectorCustom" class="search-input" placeholder="Default: textarea, div[contenteditable]" style="width: 250px;">
  </div>
  ```

- [ ] **Step 3: Add the "Custom AI Platforms / Local WebUIs" Management Card**
  In `options.html`, add a new card right below "Selector Overrides" (or as a sub-section) for Custom platform URL/origin configuration:
  ```html
  <!-- Custom AI Platforms Card -->
  <div class="card">
      <div class="card-header">
          <svg class="card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
          <h2 class="card-title">Custom AI Platforms / Local WebUIs</h2>
      </div>
      <div class="card-content">
          <p class="form-hint" style="margin-bottom: 12px;">Add custom WebUI origins (e.g. <code>http://localhost:3000</code> or <code>http://127.0.0.1:8080</code>) to dynamically request host permission and register content scripts.</p>
          <div class="form-group" style="display: flex; gap: 8px; margin-bottom: 12px;">
              <input type="text" id="customOriginInput" class="search-input" placeholder="e.g. http://localhost:3000" style="flex: 1; box-sizing: border-box;">
              <button type="button" id="addCustomOriginBtn" class="btn-action" style="white-space: nowrap; border-color: var(--accent); color: var(--accent);">Add Platform & Request Permission</button>
          </div>
          <ul id="customOriginsList" class="custom-origins-list" style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;"></ul>
      </div>
  </div>
  ```

- [ ] **Step 4: Add CSS styles for custom-origin-item to options.css**
  Append to the end of `options.css`:
  ```css
  /* Custom Origins list styling */
  .custom-origins-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .custom-origin-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }

  .custom-origin-text {
    font-size: 13px;
    color: var(--text-primary);
    font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ```

- [ ] **Step 5: Commit UI changes**
  ```bash
  git add options.html options.css
  git commit -m "feat: add Custom Platforms card and DeepSeek/Groq options to Options UI"
  ```

---

### Task 3: Options Page Logic (options.js)

**Files:**
- Modify: `options.js`

- [ ] **Step 1: Add new selector mapping definitions**
  In `options.js`, find where `customSelectorsCache` is populated and selector inputs are set/listened.
  Add `selectorDeepseek`, `selectorGroq`, and `selectorCustom` to the elements being read and set.
  ```javascript
  const selectorDeepseekInput = document.getElementById('selectorDeepseek');
  const selectorGroqInput = document.getElementById('selectorGroq');
  const selectorCustomInput = document.getElementById('selectorCustom');

  if (selectorDeepseekInput) selectorDeepseekInput.value = customSelectors.deepseek?.inputSelector || '';
  if (selectorGroqInput) selectorGroqInput.value = customSelectors.groq?.inputSelector || '';
  if (selectorCustomInput) selectorCustomInput.value = customSelectors.custom?.inputSelector || '';
  ```
  Add deepseek, groq, and custom to the `selectorInputs` array:
  ```javascript
  const selectorInputs = [
      { id: 'selectorGemini', platform: 'gemini' },
      { id: 'selectorChatgpt', platform: 'chatgpt' },
      { id: 'selectorClaude', platform: 'claude' },
      { id: 'selectorAistudio', platform: 'aistudio' },
      { id: 'selectorDeepseek', platform: 'deepseek' },
      { id: 'selectorGroq', platform: 'groq' },
      { id: 'selectorCustom', platform: 'custom' }
  ];
  ```
  And map their `editableDefaults`:
  ```javascript
  const editableDefaults = {
      gemini: true,
      chatgpt: true,
      claude: true,
      aistudio: false,
      deepseek: true,
      groq: true,
      custom: true
  };
  ```

- [ ] **Step 2: Add custom origins management logic**
  Implement origin addition, permission request, storage, and rendering.
  Inside `initializeOptions()`, fetch `customOrigins` from storage, render them, and bind event handlers:
  ```javascript
  const customOriginInput = document.getElementById('customOriginInput');
  const addCustomOriginBtn = document.getElementById('addCustomOriginBtn');
  const customOriginsList = document.getElementById('customOriginsList');

  function renderCustomOrigins(origins) {
      if (!customOriginsList) return;
      customOriginsList.innerHTML = '';
      origins.forEach(origin => {
          const li = document.createElement('li');
          li.className = 'custom-origin-item';
          li.innerHTML = `
              <span class="custom-origin-text">${escapeHtml(origin)}</span>
              <button type="button" class="btn-action btn-danger-outline btn-icon-only remove-custom-origin" data-origin="${escapeHtml(origin)}" title="Remove platform and revoke permission">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
              </button>
          `;
          customOriginsList.appendChild(li);
      });
  }

  // Load saved custom origins
  chrome.storage.sync.get(['customOrigins'], (res) => {
      const origins = res.customOrigins || [];
      renderCustomOrigins(origins);
  });

  // Add platform & request permission
  if (addCustomOriginBtn && customOriginInput) {
      addCustomOriginBtn.addEventListener('click', () => {
          const val = customOriginInput.value.trim();
          if (!val) return;
          
          let originUrl;
          try {
              originUrl = new URL(val);
          } catch (e) {
              // Try prepending protocol if raw domain/IP is passed
              try {
                  originUrl = new URL('http://' + val);
              } catch (err) {
                  alert('Invalid URL or Origin');
                  return;
              }
          }
          
          const originMatch = `${originUrl.protocol}//${originUrl.host}/*`;
          
          chrome.permissions.request({ origins: [originMatch] }, (granted) => {
              if (chrome.runtime.lastError) {
                  alert('Error requesting permission: ' + chrome.runtime.lastError.message);
                  return;
              }
              if (granted) {
                  chrome.storage.sync.get(['customOrigins'], (res) => {
                      const origins = res.customOrigins || [];
                      if (!origins.includes(originMatch)) {
                          origins.push(originMatch);
                          chrome.storage.sync.set({ customOrigins: origins }, () => {
                              renderCustomOrigins(origins);
                              customOriginInput.value = '';
                              showSaveToast();
                              chrome.runtime.sendMessage({ action: 'registerCustomOrigin', origin: originMatch });
                          });
                      }
                  });
              } else {
                  alert('Permission not granted. Custom platform cannot be added without permission.');
              }
          });
      });
  }

  // Remove custom origin
  if (customOriginsList) {
      customOriginsList.addEventListener('click', (e) => {
          const btn = e.target.closest('.remove-custom-origin');
          if (!btn) return;
          const origin = btn.dataset.origin;
          
          chrome.permissions.remove({ origins: [origin] }, (removed) => {
              chrome.storage.sync.get(['customOrigins'], (res) => {
                  const origins = res.customOrigins || [];
                  const updated = origins.filter(o => o !== origin);
                  chrome.storage.sync.set({ customOrigins: updated }, () => {
                      renderCustomOrigins(updated);
                      showSaveToast();
                      chrome.runtime.sendMessage({ action: 'unregisterCustomOrigin', origin });
                  });
              });
          });
      });
  }
  ```

- [ ] **Step 3: Commit options logic**
  ```bash
  git add options.js
  git commit -m "feat: implement custom origin additions, permissions, and background sync in Options JS"
  ```

---

### Task 4: Content Script Selectors & Auto-Pasting (aiPaster.js)

**Files:**
- Modify: `aiPaster.js`
- Test: `tests/aiPasterSelectorMerge.test.mjs`

- [ ] **Step 1: Add default input selectors and target configuration for DeepSeek and Groq**
  In `aiPaster.js`, update `getPlatformInputTarget` to support `chat.deepseek.com`, `groq.com`, and custom host matches:
  ```javascript
    // In getPlatformInputTarget():
    if (hostname.includes('deepseek.com')) {
      const custom = customSelectors.deepseek || {};
      return {
        inputSelector: custom.inputSelector || 'textarea, div[contenteditable="true"]',
        isContentEditable: custom.isContentEditable !== undefined ? custom.isContentEditable : true
      };
    }
    if (hostname.includes('groq.com')) {
      const custom = customSelectors.groq || {};
      return {
        inputSelector: custom.inputSelector || 'textarea, #chat-input, div[contenteditable="true"]',
        isContentEditable: custom.isContentEditable !== undefined ? custom.isContentEditable : true
      };
    }
    
    // Check if the current origin matches any registered custom origins or fallback custom selector
    // Fallback custom platform selector resolution
    const custom = customSelectors.custom || {};
    return {
      inputSelector: custom.inputSelector || 'textarea, div[contenteditable="true"]',
      isContentEditable: custom.isContentEditable !== undefined ? custom.isContentEditable : true
    };
  ```

- [ ] **Step 2: Add DeepSeek and Groq selector unit tests**
  In `tests/aiPasterSelectorMerge.test.mjs`, add tests for `deepseek`, `groq`, and `custom` selectors:
  ```javascript
  // Test DeepSeek default
  {
    const context = createContext({ hostname: 'chat.deepseek.com' });
    const api = await loadAiPaster(context);
    const target = await api.getPlatformInputTarget();
    assert.equal(target.inputSelector, 'textarea, div[contenteditable="true"]');
    assert.equal(target.isContentEditable, true);
  }

  // Test Groq default
  {
    const context = createContext({ hostname: 'groq.com' });
    const api = await loadAiPaster(context);
    const target = await api.getPlatformInputTarget();
    assert.equal(target.inputSelector, 'textarea, #chat-input, div[contenteditable="true"]');
    assert.equal(target.isContentEditable, true);
  }
  ```

- [ ] **Step 3: Run the updated test suite**
  Run: `node tests/aiPasterSelectorMerge.test.mjs`
  Expected: PASS

- [ ] **Step 4: Commit changes**
  ```bash
  git add aiPaster.js tests/aiPasterSelectorMerge.test.mjs
  git commit -m "feat: support deepseek, groq, and custom platform target input resolution in content script"
  ```

---

### Task 5: Background scripting & dynamic registration (service_worker.js)

**Files:**
- Modify: `service_worker.js`

- [ ] **Step 1: Implement getAiUrl to resolve DeepSeek, Groq, and Custom platforms**
  Modify `getAiUrl` in `service_worker.js`:
  ```javascript
  async function getAiUrl(providerKey) {
    const map = {
      gemini: 'https://gemini.google.com/app',
      chatgpt: 'https://chatgpt.com/',
      claude: 'https://claude.ai/new',
      aistudio: 'https://aistudio.google.com/prompts/new_chat',
      deepseek: 'https://chat.deepseek.com/',
      groq: 'https://groq.com/'
    };
    if (providerKey === 'custom') {
      const res = await new Promise(resolve => {
        chrome.storage.sync.get(['customOrigins'], (r) => resolve(r.customOrigins || []));
      });
      if (res && res.length > 0) {
        const match = res[0];
        if (match.endsWith('/*')) {
          return match.slice(0, -2);
        }
        return match;
      }
    }
    return map[providerKey] || map.gemini;
  }
  ```
  Ensure calls to `getAiUrl` await the result:
  ```javascript
  const aiUrl = await getAiUrl(pastePayload.aiProvider);
  ```

- [ ] **Step 2: Add message listeners for registering/unregistering custom origins**
  Add message handlers inside the main message listener in `service_worker.js`:
  ```javascript
  if (request.action === 'registerCustomOrigin') {
    registerDynamicContentScript(request.origin)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === 'unregisterCustomOrigin') {
    unregisterDynamicContentScript(request.origin)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  ```

- [ ] **Step 3: Write script registration helper functions**
  Implement dynamic registration helpers:
  ```javascript
  async function registerDynamicContentScript(origin) {
    if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
    
    // Check if script is already registered
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const scriptId = `ai-paster-${origin}`;
    if (scripts.some(s => s.id === scriptId)) {
      return;
    }
    
    await chrome.scripting.registerContentScripts([
      {
        id: scriptId,
        matches: [origin],
        js: ['i18n.js', 'promptBuilder.js', 'aiPaster.js'],
        runAt: 'document_idle',
        allFrames: true
      }
    ]);
    console.log(`Registered content script dynamically for: ${origin}`);
  }

  async function unregisterDynamicContentScript(origin) {
    if (!chrome.scripting || !chrome.scripting.unregisterContentScripts) return;
    const scriptId = `ai-paster-${origin}`;
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    console.log(`Unregistered content script dynamically for: ${origin}`);
  }
  ```

- [ ] **Step 4: Initialize custom content scripts on startup**
  At the top-level initialization of the service worker, load stored `customOrigins` and register them:
  ```javascript
  chrome.runtime.onInstalled.addListener(() => {
    syncRegisteredCustomScripts();
  });
  chrome.runtime.onStartup.addListener(() => {
    syncRegisteredCustomScripts();
  });

  async function syncRegisteredCustomScripts() {
    chrome.storage.sync.get(['customOrigins'], async (res) => {
      const origins = res.customOrigins || [];
      for (const origin of origins) {
        try {
          await registerDynamicContentScript(origin);
        } catch (err) {
          console.error(`Failed to register custom origin content script for ${origin}:`, err);
        }
      }
    });
  }
  ```

- [ ] **Step 5: Write a unit test `tests/serviceWorkerCustomOrigins.test.mjs`**
  Write a test to mock scripting & storage to ensure dynamic registration handlers are correctly executed. Let's create `tests/serviceWorkerCustomOrigins.test.mjs`.

- [ ] **Step 6: Commit background logic**
  ```bash
  git add service_worker.js
  git commit -m "feat: implement dynamic content script registration and custom provider URL routing in Service Worker"
  ```

---

### Task 6: Popup and Preview Pages Integration

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `preview.html`
- Modify: `preview.js`

- [ ] **Step 1: Add new platforms to popup.html**
  In `popup.html`, add `<option value="deepseek">DeepSeek</option>`, `<option value="groq">Groq</option>`, and `<option value="custom">Custom</option>` to the select element `#popupProviderSelect`.

- [ ] **Step 2: Update popup.js provider labels**
  In `popup.js`, update `getProviderLabel` to support the new providers:
  ```javascript
  function getProviderLabel(provider) {
    return ({ gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio', deepseek: 'DeepSeek', groq: 'Groq', custom: 'Custom' }[provider]) || 'Gemini';
  }
  ```

- [ ] **Step 3: Add new platforms to preview.html**
  In `preview.html`, add `<option value="deepseek">DeepSeek</option>`, `<option value="groq">Groq</option>`, and `<option value="custom">Custom</option>` to the select element `#providerSelect`.

- [ ] **Step 4: Update preview.js names and warnings**
  In `preview.js`, update `names` mapping under `getProviderGuidance`:
  ```javascript
  const names = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio', deepseek: 'DeepSeek', groq: 'Groq', custom: 'Custom' };
  ```

- [ ] **Step 5: Run full test suite**
  Run: `npm test`
  Expected: PASS

- [ ] **Step 6: Commit popup and preview changes**
  ```bash
  git add popup.html popup.js preview.html preview.js
  git commit -m "feat: expose DeepSeek, Groq, and Custom platforms in Popup and Preview pages UI"
  ```
