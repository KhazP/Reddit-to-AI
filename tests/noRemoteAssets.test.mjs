import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const extensionPages = [
  'popup.html',
  'options.html',
  'preview.html',
  'popup.css',
  'options.css',
  'preview.css'
];

const remotePageAssetPattern = /\b(?:href|src)\s*=\s*["']https?:\/\/|@import\s+url\(["']?https?:\/\//i;

for (const file of extensionPages) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(text, remotePageAssetPattern, `${file} must not load remote page assets`);
  assert.doesNotMatch(text, /fonts\.(?:googleapis|gstatic)\.com/i, `${file} must not load Google Fonts`);
}
