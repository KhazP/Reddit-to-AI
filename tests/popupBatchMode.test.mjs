import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const popup = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');

assert.match(html, /<option value="directOnce">Send directly once<\/option>/, 'popup direct mode is one-shot');
assert.doesNotMatch(popup, /showPromptPreview:\s*\(sendModeSelect\?\.value \|\| 'preview'\) !== 'direct'/, 'popup must not persist direct send from mode select');
assert.match(popup, /directSendOnce/, 'popup sends one-shot direct flag to service worker');
assert.match(popup, /Scrape & Send Once/, 'single-thread direct CTA is explicit');

assert.match(html, /id="batchUrlStatus"/, 'popup renders live batch URL status');
assert.match(popup, /function isRedditBatchUrl/, 'popup validates batch URLs as Reddit URLs');
assert.match(popup, /currentBatchUrlCount/, 'popup tracks current batch URL count');
assert.match(popup, /10 batch URLs ready\. Extra URLs will be ignored\./, 'popup warns when batch URLs exceed cap');
assert.match(popup, /Scrape \$\{currentBatchUrlCount\} URLs & Preview/, 'batch preview CTA includes URL count');
assert.match(popup, /Send \$\{currentBatchUrlCount\} URLs Once/, 'batch direct-once CTA includes URL count');
