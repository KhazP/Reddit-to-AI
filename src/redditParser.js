// Reddit to AI - shared Reddit JSON parsing helpers.
//
// The content script (redditScraper.js) and the service worker used to carry two
// separate, slowly diverging copies of this logic. Both now call into here so a
// thread parsed on a Reddit tab and the same thread parsed in the background
// produce identical comment objects.
//
// Loaded as a classic script: `importScripts('redditParser.js')` in the service
// worker, `chrome.scripting.executeScript` on Reddit tabs, and a plain <script>
// tag on extension pages. Mirrors promptBuilder.js's global-attach pattern.
(function attachRedditParser(global) {
  // Bots whose comments carry no discussion value. Matched exactly (case
  // insensitive); the generic suffix rule below covers the long tail.
  const KNOWN_BOTS = [
    'AutoModerator', 'RemindMeBot', 'RepostSleuthBot', 'sneakpeekbot',
    'TotesMessenger', 'WikiTextBot', 'B0tRank', 'CommonMisspellingBot',
    'HelperBot_', 'WikiSummarizerBot', 'stabbot', 'SaveVideo', 'SaveThisVideo',
    'Vredditdownloader', 'gifendore', 'haikusbot', 'nice-scores', 'userleansbot'
  ];

  const KNOWN_BOTS_LOWER = new Set(KNOWN_BOTS.map(name => name.toLowerCase()));

  // A bare `endsWith('bot')` test flags real usernames such as Talbot, Abbot and
  // Marbot, so only a `bot` suffix that is its own word (foo_bot, foo-bot) counts.
  const BOT_SUFFIX_PATTERN = /(^|[_-])bot$/i;

  function isBotAuthor(author) {
    const name = String(author || '').trim();
    if (!name) return false;
    if (KNOWN_BOTS_LOWER.has(name.toLowerCase())) return true;
    return BOT_SUFFIX_PATTERN.test(name);
  }

  const SORT_MODES = new Set(['confidence', 'top', 'new', 'controversial', 'old', 'random', 'qa', 'live']);

  function normalizeSortMode(value) {
    const sort = String(value || 'confidence').toLowerCase();
    if (sort === 'best') return 'confidence';
    return SORT_MODES.has(sort) ? sort : 'confidence';
  }

  function clampDepth(depth) {
    return Math.min(Math.max(Number(depth) || 1, 1), 10);
  }

  // Builds the `.json` listing URL for a thread permalink.
  function buildRedditJsonUrl(inputUrl, sortMode, depth) {
    const url = new URL(inputUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '.json';
    url.searchParams.set('limit', '500');
    url.searchParams.set('depth', String(clampDepth(depth)));
    url.searchParams.set('raw_json', '1');
    url.searchParams.set('showmore', 'true');
    url.searchParams.set('sort', normalizeSortMode(sortMode));
    return url.toString();
  }

  // Superset of the fields both call sites used to produce independently.
  function parseCommentData(data, includeHidden, replies = []) {
    if (!data) return null;
    const isRemoved = data.body === '[removed]' || data.body === '[deleted]';
    if (!includeHidden && isRemoved) return null;

    return {
      id: data.name,
      parentId: data.parent_id,
      author: data.author,
      text: data.body || '',
      depth: data.depth || 0,
      score: data.score,
      ups: data.ups,
      downs: data.downs,
      controversiality: data.controversiality || 0,
      timestamp: data.created_utc ? data.created_utc * 1000 : null,
      createdUtc: data.created_utc || null,
      isSubmitter: data.is_submitter || false,
      authorFlair: data.author_flair_text || null,
      authorFlairCss: data.author_flair_css_class || null,
      distinguished: data.distinguished || null,
      awardCount: data.total_awards_received || 0,
      permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
      replies
    };
  }

  // A removed/deleted comment that still has surviving replies is kept as a stub
  // so the reply chain does not lose its parent. The two call sites label the stub
  // differently and downstream code (history, exports) keys off those labels, so
  // the style stays a caller choice.
  function createOmittedParentPlaceholder(data, replies, style = 'background') {
    const base = {
      id: data.name || `omitted-${Math.random().toString(36).slice(2, 8)}`,
      parentId: data.parent_id,
      depth: data.depth || 0,
      score: data.score || 0,
      ups: data.ups || 0,
      downs: data.downs || 0,
      controversiality: data.controversiality || 0,
      timestamp: data.created_utc ? data.created_utc * 1000 : null,
      createdUtc: data.created_utc || null,
      isSubmitter: false,
      authorFlair: null,
      authorFlairCss: null,
      distinguished: null,
      awardCount: data.total_awards_received || 0,
      permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
      replies
    };
    if (style === 'content') {
      return {
        ...base,
        author: '[removed]',
        text: '[removed parent omitted; replies preserved]',
        omittedParent: true
      };
    }
    return {
      ...base,
      author: '[omitted]',
      text: '[removed/deleted parent omitted]',
      isOmittedParent: true
    };
  }

  function isOmittedPlaceholder(comment) {
    return Boolean(comment && (comment.isOmittedParent || comment.omittedParent));
  }

  function parseCommentNode(child, options, depth = 0) {
    const { includeHidden = false, maxDepth = 10, moreIds = [], placeholderStyle = 'background' } = options || {};
    if (!child) return null;
    if (child.kind === 'more' && Array.isArray(child.data?.children)) {
      moreIds.push(...child.data.children);
      return null;
    }
    if (child.kind !== 't1') return null;

    const replies = [];
    const replyChildren = child.data?.replies?.data?.children;
    if (replyChildren) {
      if (depth < maxDepth - 1) {
        for (const reply of replyChildren) {
          const parsed = parseCommentNode(reply, options, depth + 1);
          if (parsed) replies.push(parsed);
        }
      } else {
        // At the depth cap the replies are dropped, but their continuation tokens
        // are still worth collecting so morechildren can fetch them later.
        for (const reply of replyChildren) {
          if (reply?.kind === 'more' && Array.isArray(reply.data?.children)) {
            moreIds.push(...reply.data.children);
          }
        }
      }
    }

    const comment = parseCommentData(child.data, includeHidden, replies);
    if (!comment) {
      return replies.length > 0 ? createOmittedParentPlaceholder(child.data, replies, placeholderStyle) : null;
    }
    return comment;
  }

  // Returns { roots, count } so callers that track a pre-filter total can use it.
  function parseComments(children, options) {
    const roots = [];
    let count = 0;
    for (const child of children || []) {
      const node = parseCommentNode(child, options, 0);
      if (node) {
        roots.push(node);
        count += 1 + countComments(node.replies);
      }
    }
    return { roots, count };
  }

  function countComments(comments) {
    if (!Array.isArray(comments)) return 0;
    let total = 0;
    const stack = [...comments];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) continue;
      total += 1;
      if (Array.isArray(next.replies)) stack.push(...next.replies);
    }
    return total;
  }

  function buildCommentMap(roots) {
    const map = {};
    const traverse = comments => {
      for (const comment of comments || []) {
        if (comment?.id) map[comment.id] = comment;
        traverse(comment?.replies || []);
      }
    };
    traverse(roots);
    return map;
  }

  function indexCommentTree(comment, map) {
    if (!comment?.id) return;
    map[comment.id] = comment;
    for (const reply of comment.replies || []) {
      indexCommentTree(reply, map);
    }
  }

  // morechildren responses arrive unordered, so a child can show up before its
  // parent. Anything parked at the root is pulled back under a parent that
  // arrives later.
  function reparentRootChildren(parent, roots, rootIds, commentMap) {
    if (!parent?.id) return;
    for (let i = roots.length - 1; i >= 0; i--) {
      const candidate = roots[i];
      if (!candidate || candidate.id === parent.id || candidate.parentId !== parent.id) continue;
      roots.splice(i, 1);
      rootIds.delete(candidate.id);
      if (!parent.replies.some(reply => reply.id === candidate.id)) {
        parent.replies.unshift(candidate);
      }
    }
    rootIds.delete(parent.id);
    indexCommentTree(parent, commentMap);
  }

  function mergeAdditionalComments(roots, additionalComments, threadId, options = {}) {
    const { shouldStop } = options;
    const commentMap = buildCommentMap(roots);
    const rootIds = new Set((roots || []).map(comment => comment?.id).filter(Boolean));
    let addedCount = 0;

    for (const comment of additionalComments || []) {
      if (typeof shouldStop === 'function' && shouldStop()) break;
      if (!comment || commentMap[comment.id]) continue;
      comment.replies = Array.isArray(comment.replies) ? comment.replies : [];

      if (commentMap[comment.parentId]) {
        commentMap[comment.parentId].replies.push(comment);
      } else {
        // Either a genuine top-level comment (parentId === threadId) or an orphan
        // whose parent has not arrived yet; both park at the root for now.
        roots.push(comment);
        rootIds.add(comment.id);
      }

      commentMap[comment.id] = comment;
      indexCommentTree(comment, commentMap);
      reparentRootChildren(comment, roots, rootIds, commentMap);
      addedCount += 1;
    }

    return { roots, addedCount, threadId };
  }

  function shouldIncludeComment(comment, criteria = {}) {
    if (isOmittedPlaceholder(comment)) return true;

    const minScore = Number(criteria.minScore || 0);
    if (minScore > 0 && (comment.score || 0) < minScore) return false;

    if (criteria.hideBots && isBotAuthor(comment.author)) return false;

    const authorTypes = Array.isArray(criteria.authorTypes) ? criteria.authorTypes : [];
    if (authorTypes.length > 0) {
      const matchesOp = authorTypes.includes('op') && comment.isSubmitter;
      const matchesFlaired = authorTypes.includes('flaired') && comment.authorFlair;
      if (!matchesOp && !matchesFlaired) return false;
    }

    return true;
  }

  // Excluded comments are replaced by their surviving replies rather than taking
  // the whole subtree with them.
  function filterComments(comments, criteria = {}) {
    return (comments || []).flatMap(node => {
      if (!node) return [];
      const replies = filterComments(node.replies || [], criteria);
      if (isOmittedPlaceholder(node) && replies.length === 0) return [];
      if (!shouldIncludeComment(node, criteria)) return replies;
      return [{ ...node, replies }];
    });
  }

  global.R2AIRedditParser = {
    KNOWN_BOTS,
    isBotAuthor,
    normalizeSortMode,
    buildRedditJsonUrl,
    parseCommentData,
    parseCommentNode,
    parseComments,
    createOmittedParentPlaceholder,
    countComments,
    buildCommentMap,
    indexCommentTree,
    reparentRootChildren,
    mergeAdditionalComments,
    shouldIncludeComment,
    filterComments
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
