import assert from 'node:assert/strict';
import '../src/promptBuilder.js';

const { R2AIPrompt } = globalThis;

const BALANCED_MAX_CHARS = R2AIPrompt.CONTEXT_PRESETS.balanced.maxChars;
assert.equal(BALANCED_MAX_CHARS, 70000, 'balanced preset budget assumption');

function makeThread(commentCount, textLength) {
  const body = 'x'.repeat(textLength);
  return {
    post: {
      title: 'Oversized thread',
      subreddit: 'testing',
      author: 'op',
      url: 'https://www.reddit.com/r/testing/comments/big/oversized/',
      content: 'Post body'
    },
    comments: Array.from({ length: commentCount }, (_, i) => ({
      id: `t1_${i}`,
      author: `user${i}`,
      text: `${body} ${i}`,
      score: commentCount - i,
      replies: []
    })),
    metadata: { scrapedAt: '2026-04-27T00:00:00.000Z', commentCount }
  };
}

const template = 'Please analyze the following Reddit thread.\n\n{content}';
const options = { contextPreset: 'balanced', trimStrategy: 'top', mediaMode: 'ignore' };

// Oversized thread: many small comments, well past both the count and char budgets.
{
  // Comments are long enough that the char budget binds before the 180-comment preset limit.
  const big = makeThread(600, 900);
  const untrimmed = R2AIPrompt.buildPromptText(big, template, {
    ...options,
    skipContextPreset: true,
    skipBudgetTrim: true
  });
  assert.ok(untrimmed.length > BALANCED_MAX_CHARS, 'fixture must exceed the budget before trimming');

  const prompt = R2AIPrompt.buildPromptText(big, template, options);
  assert.ok(
    prompt.length <= BALANCED_MAX_CHARS,
    `trimmed prompt should fit the budget (got ${prompt.length})`
  );
  assert.ok(
    prompt.length >= BALANCED_MAX_CHARS * 0.85,
    `trimmed prompt should land within ~10-15% of the budget (got ${prompt.length})`
  );
}

// Small threads are untouched by the budget trim.
{
  const small = makeThread(5, 100);
  const withBudget = R2AIPrompt.buildPromptText(small, template, options);
  const withoutBudget = R2AIPrompt.buildPromptText(small, template, { ...options, skipBudgetTrim: true });
  assert.equal(withBudget, withoutBudget, 'small threads must not be trimmed');
  assert.equal(
    R2AIPrompt.countDataComments(
      R2AIPrompt.trimCommentsToCharBudget(small, template, options, BALANCED_MAX_CHARS)
    ),
    5,
    'trimCommentsToCharBudget is a no-op under budget'
  );
}

// maxQuality (maxChars: 0) skips budget trimming entirely.
{
  const big = makeThread(400, 300);
  const maxQuality = R2AIPrompt.buildPromptText(big, template, { ...options, contextPreset: 'maxQuality' });
  assert.ok(maxQuality.length > BALANCED_MAX_CHARS, 'maxQuality preset does not enforce a char budget');
}

console.log('Prompt budget trim tests passed!');
