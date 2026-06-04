import assert from 'node:assert/strict';
import '../promptBuilder.js';

const { R2AIPrompt } = globalThis;

const mockData = {
  post: {
    id: 't3_123',
    title: 'Testing Exporter "Special" Title',
    subreddit: 'test',
    author: 'op_user',
    url: 'https://reddit.com/r/test/comments/123',
    content: 'Post "body" content with, comma'
  },
  comments: [
    {
      id: 't1_abc',
      parentId: 't3_123',
      author: 'alice',
      score: 15,
      text: 'Hello, world!',
      isSubmitter: false,
      replies: [
        {
          id: 't1_def',
          parentId: 't1_abc',
          author: 'op_user',
          score: 5,
          text: 'Replying to alice',
          isSubmitter: true,
          replies: []
        }
      ]
    }
  ],
  metadata: {
    scrapedAt: '2026-06-04T12:00:00.000Z',
    commentCount: 2
  },
  maxDepth: 5
};

assert.ok(R2AIPrompt, 'R2AIPrompt should be attached to globalThis');
assert.equal(typeof R2AIPrompt.exportToJSON, 'function', 'exportToJSON should be a function');
assert.equal(typeof R2AIPrompt.exportToCSV, 'function', 'exportToCSV should be a function');
assert.equal(typeof R2AIPrompt.exportToMarkdown, 'function', 'exportToMarkdown should be a function');

// Test exportToJSON
const jsonExport = R2AIPrompt.exportToJSON(mockData);
const parsed = JSON.parse(jsonExport);
assert.equal(parsed.post.title, mockData.post.title);

// Test exportToCSV
const csvExport = R2AIPrompt.exportToCSV(mockData);
assert.match(csvExport, /^"Type","ID","Parent ID","Depth","Author","Score","Is OP","Text\/Content"/);
assert.match(csvExport, /"post","t3_123","","0","op_user","","true","Testing Exporter ""Special"" Title\n\nPost ""body"" content with, comma"/);
assert.match(csvExport, /"comment","t1_abc","t3_123","0","alice","15","false","Hello, world!"/);
assert.match(csvExport, /"comment","t1_def","t1_abc","1","op_user","5","true","Replying to alice"/);

// Test exportToMarkdown
const mdExport = R2AIPrompt.exportToMarkdown(mockData);
assert.match(mdExport, /# Testing Exporter "Special" Title/);
assert.match(mdExport, /- \*\*Subreddit\*\*: r\/test/);
assert.match(mdExport, /- \*\*u\/alice\*\* \(15 pts\):/);
assert.match(mdExport, /  - \*\*u\/op_user\*\* \(5 pts\) \(OP\):/);

console.log('Export options unit tests passed!');
