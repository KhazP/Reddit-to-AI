import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preview = await readFile(new URL('../src/preview.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../src/preview.html', import.meta.url), 'utf8');

assert.match(preview, /pendingGeneratedPrompt/, 'preview tracks a pending rebuilt prompt');
assert.match(preview, /pendingRenderedData/, 'preview tracks pending rendered data');
assert.match(preview, /Settings changed\. Your edited prompt was kept\./, 'dirty prompt changes keep edited text');
assert.match(preview, /function applyRebuiltPrompt\(\)/, 'preview exposes apply rebuilt prompt action');
assert.match(preview, /function keepEditedPrompt\(\)/, 'preview exposes keep edits action');
assert.match(html, /id="applyRebuiltPromptBtn"/, 'preview has Apply rebuilt prompt control');
assert.match(html, /id="keepEditsBtn"/, 'preview has Keep edits control');

assert.match(preview, /sendInFlight/, 'preview guards duplicate sends in memory');
assert.match(preview, /Already opening AI tab\./, 'duplicate send click is ignored with visible status');
assert.match(preview, /els\.sendBtnBottom/, 'bottom send button participates in send state');
assert.match(preview, /els\.skipNextBtn/, 'skip preview button participates in send state');

assert.match(worker, /activePasteHandoffs/, 'service worker guards duplicate paste handoffs');
assert.match(worker, /request\.directSendOnce === true\s*\?\s*false/s, 'directSendOnce overrides preview for one request');
