import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const optionsHtml = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
const optionsCss = await readFile(new URL('../src/options.css', import.meta.url), 'utf8');
const optionsJs = await readFile(new URL('../src/options.js', import.meta.url), 'utf8');

// 1. Verify options.html markup
assert.match(optionsHtml, /id="routeTesterInput"/, 'options.html contains routeTesterInput element');
assert.match(optionsHtml, /id="routeTesterResult"/, 'options.html contains routeTesterResult element');
assert.match(optionsHtml, /data-i18n="options_card_route_tester_title"/, 'options.html localizes tester card title');
assert.match(optionsHtml, /data-i18n="options_route_tester_hint"/, 'options.html localizes tester hint');

// 2. Verify options.css styles
assert.match(optionsCss, /\.tester-result/, 'options.css contains styles for .tester-result');
assert.match(optionsCss, /@keyframes fadeIn/, 'options.css defines fadeIn animation');

// 3. Verify options.js wiring and matching logic
assert.match(optionsJs, /function matchSubredditPattern/, 'options.js defines matchSubredditPattern');
assert.match(optionsJs, /function updateRouteTester\(\)/, 'options.js defines updateRouteTester function');
assert.match(optionsJs, /routeTesterInput\.addEventListener\('input', updateRouteTester\)/, 'options.js listens to routeTesterInput change events');
assert.match(optionsJs, /updateRouteTester\(\)/, 'options.js triggers routeTester updates on mapping modifications');

console.log('Subreddit route tester unit tests passed successfully!');
