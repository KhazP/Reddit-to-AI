import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const options = await readFile(new URL('../src/options.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/options.css', import.meta.url), 'utf8');

assert.match(html, /id="historyStatus"/, 'options page renders visible history status');
assert.match(html, /aria-live="polite"/, 'history status is announced politely');
assert.match(css, /\.history-status/, 'history status has visible styling');

for (const copy of [
  'Opening preview for history item...',
  'Preview opened for history item.',
  'Could not resend history item:',
  'History item deleted.',
  'History item pinned.',
  'History item unpinned.',
  'History item favorited.',
  'History item unfavorited.',
  'History item exported.',
  'Opening comparison preview...',
  'Comparison preview opened.',
  'Could not compare history items:',
  'Scrape history cleared.'
]) {
  assert.ok(options.includes(copy), `missing history status copy: ${copy}`);
}

assert.match(options, /dropdown\.disabled = true/, 'resend dropdown is disabled while request is in flight');
assert.match(options, /dropdown\.selectedIndex = 0/, 'resend dropdown resets after completion');
assert.match(options, /button\.disabled = true/, 'clicked history action buttons are disabled while in flight');
