import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('i18n contains all Reddit inline button keys for en', async () => {
  const en = JSON.parse(await readFile(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'));
  const requiredKeys = [
    'reddit_btn_label',
    'reddit_btn_tooltip',
    'settings_reddit_btn_title',
    'settings_reddit_btn_desc',
    'settings_reddit_btn_master',
    'settings_reddit_btn_feed',
    'settings_reddit_btn_post'
  ];
  for (const key of requiredKeys) {
    assert.ok(en[key]?.message, `Missing message for key: ${key}`);
  }
});

test('options.html includes Reddit in-page button configuration section', async () => {
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  assert.ok(html.includes('showRedditInlineButton'), 'options.html must contain showRedditInlineButton toggle');
  assert.ok(html.includes('showRedditButtonInFeed'), 'options.html must contain showRedditButtonInFeed toggle');
  assert.ok(html.includes('showRedditButtonInPost'), 'options.html must contain showRedditButtonInPost toggle');
});
