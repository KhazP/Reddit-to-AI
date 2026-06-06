import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const popupHtml = await readFile(new URL('../src/popup.html', import.meta.url), 'utf8');
const popupCss = await readFile(new URL('../src/popup.css', import.meta.url), 'utf8');
const popupJs = await readFile(new URL('../src/popup.js', import.meta.url), 'utf8');

// 1. Verify popup.html markup
assert.match(popupHtml, /class="budget-bar-container"/, 'popup.html contains budget-bar-container');
assert.match(popupHtml, /class="budget-bar-track"/, 'popup.html contains budget-bar-track');
assert.match(popupHtml, /id="budgetValueBar"/, 'popup.html contains budgetValueBar element');
assert.match(popupHtml, /id="budgetLabel"/, 'popup.html contains budgetLabel element');

// 2. Verify popup.css styles
assert.match(popupCss, /\.budget-bar-container/, 'popup.css contains styles for .budget-bar-container');
assert.match(popupCss, /\.budget-bar-track/, 'popup.css contains styles for .budget-bar-track');
assert.match(popupCss, /\.budget-bar-fill/, 'popup.css contains styles for .budget-bar-fill');
assert.match(popupCss, /\.budget-bar-fill\.safe/, 'popup.css contains styles for .budget-bar-fill.safe');
assert.match(popupCss, /\.budget-bar-fill\.moderate/, 'popup.css contains styles for .budget-bar-fill.moderate');
assert.match(popupCss, /\.budget-bar-fill\.large/, 'popup.css contains styles for .budget-bar-fill.large');
assert.match(popupCss, /\.budget-text/, 'popup.css contains styles for .budget-text');

// 3. Verify popup.js wiring
assert.match(popupJs, /function updateBudgetTracker\(tokenCount\)/, 'popup.js defines updateBudgetTracker');
assert.match(popupJs, /updateBudgetTracker\(tokenCount\)/, 'popup.js calls updateBudgetTracker');
assert.match(popupJs, /cachedPreviewData = response\.data/, 'popup.js caches preview data');
assert.match(popupJs, /R2AIPrompt\.buildPromptText\(cachedPreviewData, template, options\)/, 'popup.js builds prompt text from preview data');
assert.match(popupJs, /R2AIPrompt\.estimatePromptStats\(promptText, cachedPreviewData\)\.tokens/, 'popup.js estimates tokens from buildPromptText output');

console.log('Popup budget bar unit tests passed successfully!');
