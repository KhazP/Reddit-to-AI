import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const localesDir = new URL('../_locales/', import.meta.url);
const localeNames = (await readdir(localesDir)).sort();
assert.ok(localeNames.includes('en'), 'English default locale is required');
const englishMessages = JSON.parse(await readFile(new URL('en/messages.json', localesDir), 'utf8'));
const englishKeys = Object.keys(englishMessages).sort();

for (const locale of localeNames) {
  const messages = JSON.parse(await readFile(new URL(`${locale}/messages.json`, localesDir), 'utf8'));
  const keys = Object.keys(messages).sort();
  assert.deepEqual(keys, englishKeys, `${locale} locale keys must match English exactly`);
  for (const key of englishKeys) {
    assert.equal(typeof messages[key]?.message, 'string', `${locale} is missing ${key}.message`);
    assert.ok(messages[key].message.trim(), `${locale} has an empty ${key}.message`);
  }
}
