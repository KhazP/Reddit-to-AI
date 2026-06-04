import { readFile } from 'node:fs/promises';
import '../promptBuilder.js';

// Simple recursive JSON parser for comments
function parseSimpleJsonComments(children) {
  const list = [];
  if (!Array.isArray(children)) return list;
  for (const child of children) {
    if (child.kind === 't1') {
      const data = child.data;
      if (!data) continue;
      const item = {
        id: data.name,
        author: data.author,
        text: data.body || '',
        body: data.body || '',
        score: data.score || 0,
        replies: []
      };
      if (data.replies && data.replies.data && Array.isArray(data.replies.data.children)) {
        item.replies = parseSimpleJsonComments(data.replies.data.children);
      }
      list.push(item);
    }
  }
  return list;
}

async function main() {
  const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/reddit-thread.json', import.meta.url), 'utf8'));
  const postData = fixture[0]?.data?.children?.[0]?.data;
  const commentsData = fixture[1]?.data?.children || [];

  const estimatedData = {
    post: {
      title: postData.title,
      selftext: postData.selftext,
      content: postData.selftext || '', // mapped content!
      author: postData.author,
      score: postData.score,
      subreddit: postData.subreddit,
      permalink: postData.permalink,
      url: 'https://reddit.com' + postData.permalink
    },
    comments: parseSimpleJsonComments(commentsData),
    metadata: {
      threadId: postData.name,
      subreddit: postData.subreddit
    }
  };

  console.log('Estimated Data:', JSON.stringify(estimatedData, null, 2));

  const template = 'Summarize this thread:\n\n{content}';
  const options = {
    contextPreset: 'balanced',
    trimStrategy: 'diverse', // diverse selection uses id and text
    mediaMode: 'attach',
    outputFormat: 'auto'
  };

  const R2AIPrompt = globalThis.R2AIPrompt;
  const promptText = R2AIPrompt.buildPromptText(estimatedData, template, options);
  console.log('--- PROMPT TEXT ---');
  console.log(promptText);
  console.log('--- STATS ---');
  const stats = R2AIPrompt.estimatePromptStats(promptText, estimatedData);
  console.log('Tokens:', stats.tokens);
}

main();
