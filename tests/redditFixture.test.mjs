import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./fixtures/reddit-thread.json', import.meta.url), 'utf8'));

function parseFixtureThread(response) {
  const postData = response?.[0]?.data?.children?.[0]?.data;
  const commentsData = response?.[1]?.data?.children || [];
  const moreIds = [];
  const comments = commentsData.flatMap((child) => {
    if (child.kind === 'more') {
      moreIds.push(...(child.data?.children || []));
      return [];
    }
    if (child.kind !== 't1') return [];
    return [{
      id: child.data.name,
      parentId: child.data.parent_id,
      author: child.data.author,
      text: child.data.body,
      score: child.data.score,
      replies: []
    }];
  });
  return {
    post: {
      title: postData.title,
      author: postData.author,
      subreddit: postData.subreddit,
      content: postData.selftext
    },
    comments,
    moreIds
  };
}

const parsed = parseFixtureThread(fixture);

assert.equal(parsed.post.title, 'Fixture post');
assert.equal(parsed.post.subreddit, 'testing');
assert.equal(parsed.comments.length, 1);
assert.equal(parsed.comments[0].id, 't1_keep');
assert.deepEqual(parsed.moreIds, ['more1', 'more2']);
