// Covers the popup papercuts and accessibility fixes: no window.prompt() in the
// action popup, keyboard-navigable tabs, non-tabbable collapsed regions, a native
// min-score select, and a history resend that does not rewrite the user's default
// AI provider.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const popupJs = await readFile(new URL('../src/popup.js', import.meta.url), 'utf8');
const popupHtml = await readFile(new URL('../src/popup.html', import.meta.url), 'utf8');
const popupCss = await readFile(new URL('../src/popup.css', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/service_worker.js', import.meta.url), 'utf8');

// 1. window.prompt() is blocked in action popups; the preset name is collected inline.
{
  assert.doesNotMatch(popupJs, /(^|[^.\w])prompt\(['"]Preset name/, 'window.prompt is gone');
  assert.match(popupHtml, /id="presetNameRow"/, 'an inline preset-name row exists');
  assert.match(popupHtml, /id="presetNameInput"/);
  assert.match(popupHtml, /id="presetNameConfirmBtn"/);
  assert.match(popupHtml, /id="presetNameCancelBtn"/);
  assert.match(popupJs, /function commitPresetName\(\)/, 'confirm path is wired');
  assert.match(popupJs, /function closePresetNameRow\(\)/, 'cancel path is wired');
  assert.match(popupJs, /e\.key === 'Escape'/, 'Escape closes the inline row');
  assert.match(popupCss, /\.preset-name-row/, 'the row is styled');
}

// 2. The preset-name strings exist in every locale.
{
  const localesDir = new URL('../src/_locales/', import.meta.url);
  const locales = await readdir(localesDir);
  const required = [
    'popup_preset_name_label',
    'popup_preset_name_placeholder',
    'popup_preset_name_confirm',
    'popup_preset_name_cancel',
    'popup_preset_name_default'
  ];
  assert.equal(locales.length, 8, 'all eight locales are present');
  for (const locale of locales) {
    const messages = JSON.parse(await readFile(new URL(`${locale}/messages.json`, localesDir), 'utf8'));
    for (const key of required) {
      assert.ok(messages[key]?.message?.trim(), `${locale} defines ${key}`);
    }
  }
}

// 3. The tablist is keyboard navigable with a roving tabindex.
{
  assert.match(popupJs, /function activateTab\(btn/, 'tab activation is centralised');
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.ok(popupJs.includes(`'${key}'`), `the tablist handles ${key}`);
  }
  assert.match(popupJs, /b\.tabIndex = selected \? 0 : -1/, 'roving tabindex is applied');
}

// 4. Collapsed regions are genuinely inaccessible, not just aria-hidden.
{
  assert.match(popupJs, /c\.hidden = true/, 'inactive tab panels get the hidden attribute');
  assert.match(popupJs, /targetPane\.hidden = false/, 'the active panel is unhidden');
  assert.match(popupHtml, /id="tabPaneFilters"[^>]*hidden>/, 'the initially inactive panel starts hidden');

  // The advanced panel animates via grid-template-rows, so it uses inert instead
  // of hidden, which would break the transition.
  assert.match(popupJs, /advancedFilters\.inert = !expanded/, 'the advanced panel toggles inert');
  assert.match(popupHtml, /id="advancedFilters"[^>]*inert>/, 'it starts inert while collapsed');
  assert.match(popupCss, /grid-template-rows/, 'the collapse animation is still in place');
}

// 5. The min-score control is a native select, not a hand-rolled listbox.
{
  assert.match(popupHtml, /<select id="filterMinScore"/, 'min score is a native select');
  assert.match(popupHtml, /aria-label="Minimum comment score"/, 'the select is labelled');
  assert.doesNotMatch(popupHtml, /custom-select/, 'the custom dropdown markup is gone');
  assert.doesNotMatch(popupJs, /custom-select/, 'the custom dropdown script is gone');
  assert.doesNotMatch(popupCss, /custom-select/, 'the custom dropdown styles are gone');
  assert.match(popupCss, /\.filter-select-native/, 'the native select keeps the pill styling');
  assert.match(popupJs, /setMinScore\(saved, \{ persist: false \}\)/, 'restoring does not write back to storage');
}

// 6. Resending a history item must not overwrite the saved default provider.
{
  const resend = worker.slice(worker.indexOf('async function resendHistoryItem'), worker.indexOf('async function compareHistoryItems'));
  assert.ok(resend.length > 0, 'resendHistoryItem was located');
  assert.doesNotMatch(resend, /storage\.sync\.set/, 'the provider is no longer persisted');
  assert.match(resend, /selectedLlmProvider: aiProvider \|\| settings\.selectedLlmProvider/, 'the override still travels in the payload');
  assert.match(resend, /savePreviewData\(scrapeData, \{ \.\.\.mergedSettings/, 'the payload carries the merged settings');
}

console.log('Popup accessibility and papercut tests passed!');
