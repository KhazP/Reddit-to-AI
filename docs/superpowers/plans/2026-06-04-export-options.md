# Export Options (Markdown, JSON, CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement file exporters (Markdown, JSON, CSV) for Reddit scraped threads and add UI selectors to export files from both the Prompt Preview page and the popup.

**Architecture:** Exporter functions will be written in the shared logic (`promptBuilder.js`) and attached to `globalThis.R2AIPrompt`. These functions will be tested using Node unit tests. The popup and preview page will be updated with HTML select elements for selecting the export format, prompting file downloads in the browser.

**Tech Stack:** JavaScript (ES Modules / UMD pattern), HTML, CSS, Chrome Extensions API, Node.js assertions for testing.

---

### Task 1: Exporter Functions in promptBuilder.js

**Files:**
- Modify: `promptBuilder.js:442-458`
- Test: `tests/exportOptions.test.mjs` (create new file)

- [ ] **Step 1: Write a unit test suite for exporters in tests/exportOptions.test.mjs**
  Write tests confirming that:
  - `R2AIPrompt.exportToJSON` returns correct stringified JSON matching the input payload.
  - `R2AIPrompt.exportToCSV` returns a valid CSV with correct headers and post and flattened comment rows, including escaping quotes/commas.
  - `R2AIPrompt.exportToMarkdown` returns a clean hierarchical Markdown structure with thread metadata, post body, and recursively nested comments.

  Create `tests/exportOptions.test.mjs`:
  ```javascript
  import assert from 'node:assert/strict';
  import '../promptBuilder.js';

  const { R2AIPrompt } = globalThis;

  const mockData = {
    post: {
      id: 't3_123',
      title: 'Testing Exporter "Special" Title',
      subreddit: 'test',
      author: 'op_user',
      url: 'https://reddit.com/r/test/comments/123',
      content: 'Post "body" content with, comma'
    },
    comments: [
      {
        id: 't1_abc',
        parentId: 't3_123',
        author: 'alice',
        score: 15,
        text: 'Hello, world!',
        isSubmitter: false,
        replies: [
          {
            id: 't1_def',
            parentId: 't1_abc',
            author: 'op_user',
            score: 5,
            text: 'Replying to alice',
            isSubmitter: true,
            replies: []
          }
        ]
      }
    ],
    metadata: {
      scrapedAt: '2026-06-04T12:00:00.000Z',
      commentCount: 2
    },
    maxDepth: 5
  };

  // Test exportToJSON
  const jsonExport = R2AIPrompt.exportToJSON(mockData);
  const parsed = JSON.parse(jsonExport);
  assert.equal(parsed.post.title, mockData.post.title);

  // Test exportToCSV
  const csvExport = R2AIPrompt.exportToCSV(mockData);
  assert.match(csvExport, /^"Type","ID","Parent ID","Depth","Author","Score","Is OP","Text\/Content"/);
  assert.match(csvExport, /"post","t3_123","",0,"op_user","",true,"Testing Exporter \\"Special\\" Title\n\nPost \\"body\\" content with, comma"/);
  assert.match(csvExport, /"comment","t1_abc","t3_123",0,"alice",15,false,"Hello, world!"/);
  assert.match(csvExport, /"comment","t1_def","t1_abc",1,"op_user",5,true,"Replying to alice"/);

  // Test exportToMarkdown
  const mdExport = R2AIPrompt.exportToMarkdown(mockData);
  assert.match(mdExport, /# Testing Exporter "Special" Title/);
  assert.match(mdExport, /- \*\*Subreddit\*\*: r\/test/);
  assert.match(mdExport, /- \*\*u\/alice\*\* \(15 pts\):/);
  assert.match(mdExport, /  - \*\*u\/op_user\*\* \(5 pts\) \(OP\):/);

  console.log('Export options unit tests passed!');
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node tests/exportOptions.test.mjs`
  Expected: FAIL with "R2AIPrompt.exportToJSON is not a function"

- [ ] **Step 3: Implement exportToJSON, exportToCSV, exportToMarkdown**
  Inside `promptBuilder.js`, implement:
  - `exportToJSON(data)`: Just stringifies the payload.
  - `exportToCSV(data)`: Flattens the comments (can use a recursive helper) and formats it as a CSV.
  - `exportToMarkdown(data)`: Formats headers, metadata, post body, and calls a recursive helper to build nested Markdown.
  Make sure to export them in the `global.R2AIPrompt` return object.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node tests/exportOptions.test.mjs`
  Expected: PASS

- [ ] **Step 5: Add the new test suite to package.json check list**
  Add the test execution to the `test` script in `package.json`.

---

### Task 2: Preview Page Export Dropdown Selector

**Files:**
- Modify: `preview.html`
- Modify: `preview.js`

- [ ] **Step 1: Replace #exportBtn with #exportSelect in preview.html**
  Locate `#exportBtn` and replace it with:
  ```html
  <select id="exportSelect" class="btn secondary select-export" style="width: auto; height: 38px; display: inline-block;">
    <option value="" disabled selected hidden>Export</option>
    <option value="markdown">Markdown (.md)</option>
    <option value="json">JSON (.json)</option>
    <option value="csv">CSV (.csv)</option>
  </select>
  ```

- [ ] **Step 2: Bind els.exportSelect and attach change listener in preview.js**
  - Bind `els.exportSelect = document.getElementById('exportSelect')` in `bindElements()`.
  - Replace the `#exportBtn` click event listener with a change listener on `exportSelect`.
  - Call the appropriate exporter function based on selected value.
  - Create the Blob with correct content type (`text/markdown`, `application/json`, or `text/csv`) and trigger browser download.
  - Reset `exportSelect.value` to `""`.
  - Set the status text (e.g. `setStatus('Preview exported as CSV.')`).

---

### Task 3: Popup Page Export Dropdown Selector

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 1: Add #popupExportSelect in popup.html**
  Add the dropdown inside a wrapper with class `popup-export-container` below the action buttons.

- [ ] **Step 2: Bind elements and implement export logic in popup.js**
  - Bind `popupExportSelect` and attach a change listener.
  - Retrieve preview data from the background script using `chrome.runtime.sendMessage({ action: 'getPreviewData' })`.
  - Export and download the file.
  - Implement `checkExportAvailability()` to enable/disable the select based on presence of preview data.
  - Call `checkExportAvailability()` on load and within `renderPopupState()` when scraper transitions to idle.
