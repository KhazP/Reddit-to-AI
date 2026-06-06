import assert from 'node:assert/strict';
import '../src/cl100k_base.js';

assert.ok(globalThis.R2ATiktokenPromise, 'R2ATiktokenPromise is present');
await globalThis.R2ATiktokenPromise;

assert.ok(globalThis.R2ATiktoken, 'R2ATiktoken is instantiated after promise resolves');
assert.ok(globalThis.Tiktoken, 'Tiktoken class is defined');

// Verify basic encoding and decoding
const testStr = 'hello world';
const encoded = globalThis.R2ATiktoken.encode(testStr);
assert.deepEqual(Array.from(encoded), [15339, 1917], 'hello world encodes to correct tokens');

const decoded = globalThis.R2ATiktoken.decode(encoded);
assert.equal(decoded, testStr, 'tokens decode back to original text');

// Import promptBuilder to verify integration
import '../src/promptBuilder.js';
const { R2AIPrompt } = globalThis;
assert.ok(R2AIPrompt, 'R2AIPrompt is present');

// Verify that estimatePromptStats returns exact BPE tokens
const stats = R2AIPrompt.estimatePromptStats(testStr, null);
assert.equal(stats.tokens, 2, 'estimatePromptStats returns correct exact token count');

// Test fallback behavior if R2ATiktoken is temporarily removed
const originalTiktoken = globalThis.R2ATiktoken;
delete globalThis.R2ATiktoken;
const statsFallback = R2AIPrompt.estimatePromptStats('hello world 123', null);
// "hello world 123" length = 15. Math.ceil(15/4) = 4.
assert.equal(statsFallback.tokens, 4, 'estimatePromptStats falls back to character count / 4 when R2ATiktoken is absent');

// Restore
globalThis.R2ATiktoken = originalTiktoken;

console.log('BPE Tokenizer unit tests passed successfully!');
