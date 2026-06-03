import assert from 'node:assert/strict';
import '../promptBuilder.js';

const { R2AIPrompt } = globalThis;

const sampleThread = {
  post: {
    title: 'Test thread',
    subreddit: 'testing',
    author: 'op',
    url: 'https://www.reddit.com/r/testing/comments/abc/test_thread/',
    content: 'Post body',
    images: ['https://i.redd.it/example.png']
  },
  comments: [
    { id: 't1_a', author: 'alice', text: 'Helpful high score', score: 25, replies: [] },
    { id: 't1_b', author: 'bob', text: 'Lower score', score: 2, replies: [] },
    { id: 't1_c', author: 'carol', text: 'Another view', score: 12, replies: [] }
  ],
  metadata: { scrapedAt: '2026-04-27T00:00:00.000Z', commentCount: 3 }
};

assert.ok(R2AIPrompt, 'prompt helpers attach to globalThis');

const small = R2AIPrompt.applyContextPreset(sampleThread, 'small', { trimStrategy: 'top' });
assert.equal(R2AIPrompt.countDataComments(small), 3, 'small preset keeps small threads intact');

const trimmed = R2AIPrompt.trimComments(sampleThread.comments, 2, 'top');
assert.equal(R2AIPrompt.countComments(trimmed), 2, 'trimComments applies limit');
assert.equal(trimmed[0].id, 't1_a', 'top trim keeps highest-scored comment first');

const prompt = R2AIPrompt.buildPromptText(sampleThread, 'Analyze this.\n\n{content}', {
  mediaMode: 'urls',
  outputFormat: 'bullets'
});
assert.match(prompt, /^Format the answer as concise bullet points/, 'output format instruction is prepended');
assert.match(prompt, /Thread Title: Test thread/, 'prompt includes post metadata');
assert.match(prompt, /\[alice/, 'prompt includes comments');

const stats = R2AIPrompt.estimatePromptStats(prompt, sampleThread);
assert.equal(stats.comments, 3);
assert.equal(stats.images, 1);
