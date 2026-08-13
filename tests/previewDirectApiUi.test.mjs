// Contract tests for the preview page's Direct API panel. The important one is the
// rendering path: the model response is derived from untrusted Reddit text and must
// never be injected as markup.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const previewRaw = await readFile(new URL('../src/preview.js', import.meta.url), 'utf8');
// Comments are stripped so that prose explaining *why* innerHTML is avoided cannot
// itself trip the assertions below.
const preview = previewRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const html = await readFile(new URL('../src/preview.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/preview.css', import.meta.url), 'utf8');

// --- Markup is wired up ---
for (const id of [
  'apiProviderSelect',
  'sendApiBtn',
  'apiNotConfigured',
  'apiOpenOptionsBtn',
  'apiLoading',
  'apiElapsed',
  'apiError',
  'apiErrorMessage',
  'apiRetryBtn',
  'apiResult',
  'apiResponseText',
  'apiCopyBtn'
]) {
  assert.match(html, new RegExp(`id="${id}"`), `preview.html must define #${id}`);
  assert.match(preview, new RegExp(`els\\.${id}\\b`), `preview.js must bind #${id}`);
}

// --- The response is rendered as text, never as HTML ---
const renderBody = preview.match(/function renderApiResponse\(result\)\s*\{([\s\S]*?)\n\}/);
assert.ok(renderBody, 'renderApiResponse must exist');
assert.ok(
  !/innerHTML/.test(renderBody[1]),
  'renderApiResponse must never use innerHTML: the response is untrusted content'
);
assert.match(
  renderBody[1],
  /els\.apiResponseText\.textContent\s*=\s*result\.text/,
  'the response body must be assigned with textContent'
);

// The error message is likewise provider-controlled text.
const errorBody = preview.match(/function showApiError\(message, retryable\)\s*\{([\s\S]*?)\n\}/);
assert.ok(errorBody, 'showApiError must exist');
assert.ok(!/innerHTML/.test(errorBody[1]), 'showApiError must not use innerHTML');

// The provider dropdown is built from DOM nodes, not an HTML string.
const statusBody = preview.match(/function loadDirectApiStatus\(\)\s*\{([\s\S]*?)\n\}/);
assert.ok(statusBody, 'loadDirectApiStatus must exist');
assert.match(statusBody[1], /option\.textContent\s*=/, 'option labels must be set with textContent');
assert.ok(
  !/apiProviderSelect\.innerHTML\s*=\s*[`'"][^`'"]/.test(statusBody[1]),
  'the provider select must not be populated from an HTML string'
);

// --- Whitespace is preserved by CSS rather than by markup ---
assert.match(
  css,
  /\.api-response-text\s*\{[^}]*white-space:\s*pre-wrap/,
  'the response panel must preserve whitespace with white-space: pre-wrap'
);
assert.match(
  css,
  /\.api-response-text\s*\{[^}]*overflow-y:\s*auto/,
  'the response panel must scroll rather than grow without bound'
);

// --- Flow behaviour ---
assert.match(preview, /action:\s*'sendPromptViaApi'/, 'preview must call the sendPromptViaApi action');
assert.match(preview, /action:\s*'getDirectApiStatus'/, 'preview must query configured providers');
assert.match(preview, /function updateApiAvailability\(\)/, 'send must be gated on a configured key');
assert.match(preview, /chrome\.runtime\.openOptionsPage\(\)/, 'an unconfigured provider must link to options');
assert.match(preview, /setInterval\(/, 'the loading state shows an elapsed-time counter');
assert.match(preview, /clearInterval\(previewState\.apiTimer\)/, 'the elapsed timer must be cleared');
assert.match(preview, /historyId:\s*previewState\.historyId/, 'the response is linked to its history entry');
assert.match(preview, /els\.apiRetryBtn\?\.addEventListener\('click', sendPromptViaApi\)/, 'errors offer a retry');

// A key saved on the options page must re-enable the button without a reload.
assert.match(
  preview,
  /chrome\.storage\.onChanged\.addListener/,
  'the preview page must refresh provider status when the API config changes'
);
assert.match(
  preview,
  /if \(previewState\.apiInFlight\) return;/,
  'the refresh must not disturb an in-flight request'
);

// The preview page must never receive or handle a raw API key.
assert.ok(!/apiKey/.test(preview), 'preview.js must never touch an API key');

console.log('Preview Direct API UI tests passed!');
