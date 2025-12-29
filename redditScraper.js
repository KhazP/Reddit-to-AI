// redditScraper.js - content script for scraping Reddit threads
// Handles large threads with 1000+ comments

if (window.__redditToAiScraperInitialized) {
  console.log('Reddit to AI scraper already initialized.');
} else {
  window.__redditToAiScraperInitialized = true;

  const SCRAPER_STATE = {
    stopRequested: false,
    maxDepth: 5,
    threadId: null,
    subreddit: null,
    collectedMoreIds: new Set(),
    // Filter settings
    filterMinScore: 0,
    filterTopN: 0,
    filterAuthorType: 'all',
    filterHideBots: false
  };

  // Known bot accounts to filter
  const KNOWN_BOTS = [
    'AutoModerator', 'RemindMeBot', 'RepostSleuthBot', 'sneakpeekbot',
    'TotesMessenger', 'WikiTextBot', 'B0tRank', 'CommonMisspellingBot',
    'HelperBot_', 'WikiSummarizerBot', 'stabbot', 'SaveVideo', 'SaveThisVideo',
    'Vredditdownloader', 'gifendore', 'haikusbot', 'nice-scores', 'userleansbot'
  ];

  // Rate limiting config
  const RATE_LIMIT = {
    minDelay: 1000, // Min 1 second between API calls
    batchSize: 100,
    maxRetries: 3
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapeReddit') {
      // Load all settings including filters
      chrome.storage.sync.get([
        'scrapeDepth',
        'filterMinScore',
        'filterTopN',
        'filterAuthorType',
        'filterHideBots',
        'includeHidden'
      ], (result) => {
        SCRAPER_STATE.maxDepth = result.scrapeDepth || 5;
        SCRAPER_STATE.filterMinScore = result.filterMinScore || 0;
        SCRAPER_STATE.filterTopN = result.filterTopN || 0;
        SCRAPER_STATE.filterAuthorType = result.filterAuthorType || 'all';
        SCRAPER_STATE.filterHideBots = result.filterHideBots || false;

        // includeHidden can come from request (popup) or storage (options)
        const includeHidden = request.includeHidden ?? result.includeHidden ?? false;

        console.log('Reddit to AI: Scrape settings:', {
          depth: SCRAPER_STATE.maxDepth,
          minScore: SCRAPER_STATE.filterMinScore,
          topN: SCRAPER_STATE.filterTopN,
          authorType: SCRAPER_STATE.filterAuthorType,
          hideBots: SCRAPER_STATE.filterHideBots,
          includeHidden
        });

        startScrape(includeHidden)
          .then(data => sendResponse({ data }))
          .catch(error => {
            console.error('Reddit to AI scrape error:', error);
            sendResponse({ error: error.message || String(error) });
          });
      });
      return true;
    }

    if (request.action === 'stopScrapingRequested') {
      SCRAPER_STATE.stopRequested = true;
      sendResponse({ stopped: true });
      return false;
    }

    return false;
  });

  async function startScrape(includeHidden) {
    SCRAPER_STATE.stopRequested = false;
    SCRAPER_STATE.collectedMoreIds = new Set();

    sendProgress('Fetching thread...', 5);

    // Phase 1: Get initial comments with high limit and depth
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace(/\/$/, '') + '.json';
    url.searchParams.set('limit', '500');
    url.searchParams.set('depth', '10'); // Request deeper nesting
    url.searchParams.set('raw_json', '1');
    url.searchParams.set('showmore', 'true');

    let response;
    try {
      response = await fetchWithRetry(url.toString());
    } catch (err) {
      throw new Error(`Failed to fetch thread: ${err.message}`);
    }

    if (!Array.isArray(response) || response.length < 2) {
      throw new Error('Invalid Reddit JSON format.');
    }

    const postData = response[0].data.children[0].data;
    const commentsData = response[1].data.children;

    SCRAPER_STATE.threadId = postData.name;
    SCRAPER_STATE.subreddit = postData.subreddit;

    const post = extractPostDetails(postData);

    sendProgress('Parsing initial comments...', 15);

    // Parse initial batch and collect "more" IDs
    const moreIds = [];
    let { roots, count } = parseComments(commentsData, includeHidden, SCRAPER_STATE.maxDepth, moreIds);

    console.log(`Reddit to AI: Initial parse - ${count} comments, ${moreIds.length} more IDs`);

    // Phase 2: Fetch additional comments from "more" objects
    if (moreIds.length > 0 && !SCRAPER_STATE.stopRequested) {
      sendProgress(`Found ${count} comments, loading ${moreIds.length} more...`, 20);

      const additionalComments = await fetchAllMoreComments(moreIds, includeHidden);

      // Integrate additional comments into the tree
      const commentMap = buildCommentMap(roots);
      let addedCount = 0;

      for (const comment of additionalComments) {
        if (SCRAPER_STATE.stopRequested) break;

        const parentId = comment.parentId;
        if (commentMap[parentId]) {
          // Add as reply to existing comment
          commentMap[parentId].replies.push(comment);
        } else if (parentId === SCRAPER_STATE.threadId) {
          // Top-level comment
          roots.push(comment);
        } else {
          // Parent not found, add as top-level
          roots.push(comment);
        }

        // Add this comment to map for future parent lookups
        commentMap[comment.id] = comment;
        addedCount++;
      }

      count += addedCount;
      console.log(`Reddit to AI: Added ${addedCount} more comments. Total: ${count}`);
    }

    sendProgress(`Applying filters...`, 95);

    // Apply filters to the comment tree
    const filteredRoots = applyFilters(roots);
    const filteredCount = countNestedReplies([{ replies: filteredRoots }]) - 1;

    sendProgress(`Complete! ${filteredCount} comments after filtering.`, 100);

    return {
      post,
      comments: filteredRoots,
      includeHidden,
      maxDepth: SCRAPER_STATE.maxDepth,
      commentCount: filteredCount,
      originalCount: count,
      filtersApplied: {
        minScore: SCRAPER_STATE.filterMinScore,
        topN: SCRAPER_STATE.filterTopN,
        authorType: SCRAPER_STATE.filterAuthorType,
        hideBots: SCRAPER_STATE.filterHideBots
      },
      threadUrl: window.location.href
    };
  }

  async function fetchWithRetry(url, retries = RATE_LIMIT.maxRetries) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });

        if (res.status === 429) {
          // Rate limited - wait and retry
          const waitTime = Math.pow(2, i + 1) * 1000;
          console.log(`Reddit to AI: Rate limited, waiting ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return await res.json();
      } catch (err) {
        if (i === retries - 1) throw err;
        await delay(1000);
      }
    }
    throw new Error('Max retries exceeded');
  }

  async function fetchAllMoreComments(moreIds, includeHidden) {
    const allComments = [];
    const uniqueIds = [...new Set(moreIds)]; // Dedupe

    // Split into batches
    const batches = [];
    for (let i = 0; i < uniqueIds.length; i += RATE_LIMIT.batchSize) {
      batches.push(uniqueIds.slice(i, i + RATE_LIMIT.batchSize));
    }

    console.log(`Reddit to AI: Fetching ${uniqueIds.length} more IDs in ${batches.length} batches`);

    for (let i = 0; i < batches.length && !SCRAPER_STATE.stopRequested; i++) {
      const batch = batches[i];
      const progress = 20 + Math.floor(((i + 1) / batches.length) * 70);
      sendProgress(`Loading comments batch ${i + 1}/${batches.length}...`, progress);

      try {
        const comments = await fetchMoreBatch(batch, includeHidden);
        allComments.push(...comments);

        // Rate limit delay between batches
        if (i < batches.length - 1) {
          await delay(RATE_LIMIT.minDelay);
        }
      } catch (err) {
        console.warn(`Reddit to AI: Batch ${i + 1} failed:`, err.message);
        // Continue with other batches
      }
    }

    return allComments;
  }

  async function fetchMoreBatch(ids, includeHidden) {
    const params = new URLSearchParams({
      api_type: 'json',
      link_id: SCRAPER_STATE.threadId,
      children: ids.join(','),
      raw_json: '1',
      limit_children: 'false'
    });

    const url = `https://www.reddit.com/api/morechildren.json?${params}`;

    const data = await fetchWithRetry(url);
    const things = data?.json?.data?.things || [];

    const comments = [];
    const nestedMoreIds = [];

    for (const thing of things) {
      if (thing.kind === 't1') {
        const parsed = parseCommentData(thing.data, includeHidden);
        if (parsed) {
          comments.push(parsed);
        }
      } else if (thing.kind === 'more' && thing.data?.children) {
        // There might be more nested "more" objects
        nestedMoreIds.push(...thing.data.children);
      }
    }

    // Recursively fetch nested "more" if any (but limit depth to avoid infinite loops)
    if (nestedMoreIds.length > 0 && !SCRAPER_STATE.stopRequested) {
      const nestedComments = await fetchAllMoreComments(nestedMoreIds, includeHidden);
      comments.push(...nestedComments);
    }

    return comments;
  }

  function parseCommentData(data, includeHidden) {
    const isRemoved = data.body === '[removed]' || data.body === '[deleted]';
    if (!includeHidden && isRemoved) return null;

    return {
      id: data.name,
      parentId: data.parent_id,
      author: data.author,
      text: data.body,
      depth: data.depth || 0,
      score: data.score,
      timestamp: data.created_utc * 1000,
      isSubmitter: data.is_submitter || false,
      authorFlair: data.author_flair_text || null,
      distinguished: data.distinguished || null,
      replies: []
    };
  }

  // Apply all filters to comment tree
  function applyFilters(roots) {
    const { filterMinScore, filterTopN, filterAuthorType, filterHideBots } = SCRAPER_STATE;

    // Flatten tree to array for filtering
    function flattenComments(comments, arr = []) {
      for (const c of comments) {
        arr.push(c);
        if (c.replies?.length) {
          flattenComments(c.replies, arr);
        }
      }
      return arr;
    }

    // Filter a single comment
    function shouldInclude(comment) {
      // Min score filter
      if (filterMinScore > 0 && (comment.score || 0) < filterMinScore) {
        return false;
      }

      // Bot filter
      if (filterHideBots && KNOWN_BOTS.some(bot =>
        comment.author?.toLowerCase() === bot.toLowerCase() ||
        comment.author?.toLowerCase().endsWith('bot')
      )) {
        return false;
      }

      // Author type filter
      if (filterAuthorType === 'op' && !comment.isSubmitter) {
        return false;
      }
      if (filterAuthorType === 'flaired' && !comment.authorFlair) {
        return false;
      }

      return true;
    }

    // Filter the tree recursively
    function filterTree(comments) {
      const filtered = [];
      for (const comment of comments) {
        if (shouldInclude(comment)) {
          const filteredComment = { ...comment };
          if (comment.replies?.length) {
            filteredComment.replies = filterTree(comment.replies);
          }
          filtered.push(filteredComment);
        }
      }
      return filtered;
    }

    let result = filterTree(roots);

    // Top N filter - flatten, sort by score, take top N, rebuild tree
    if (filterTopN > 0) {
      const flat = flattenComments(result);
      flat.sort((a, b) => (b.score || 0) - (a.score || 0));
      const topIds = new Set(flat.slice(0, filterTopN).map(c => c.id));

      // Keep only comments that are in top N or have children in top N
      function pruneTree(comments) {
        const pruned = [];
        for (const comment of comments) {
          const prunedReplies = comment.replies?.length ? pruneTree(comment.replies) : [];
          if (topIds.has(comment.id) || prunedReplies.length > 0) {
            pruned.push({ ...comment, replies: prunedReplies });
          }
        }
        return pruned;
      }
      result = pruneTree(result);
    }

    return result;
  }

  function buildCommentMap(roots) {
    const map = {};

    function traverse(comments) {
      for (const comment of comments) {
        map[comment.id] = comment;
        if (comment.replies?.length) {
          traverse(comment.replies);
        }
      }
    }

    traverse(roots);
    return map;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function sendProgress(message, percentage) {
    try {
      chrome.runtime.sendMessage({ action: 'progressUpdate', message, percentage });
    } catch (error) {
      console.debug('Progress update failed:', error);
    }
  }

  function extractPostDetails(data) {
    const images = collectImages(data);
    const links = [];

    if (!data.is_self && data.url) {
      links.push(data.url);
    }

    const youtubeVideoUrls = [];
    if (data.media?.type?.includes('youtube') && data.url) {
      youtubeVideoUrls.push(data.url);
    }

    return {
      title: data.title,
      author: data.author,
      subreddit: data.subreddit,
      url: window.location.href,
      content: data.selftext || '',
      images,
      links,
      youtubeVideoUrls
    };
  }

  function collectImages(data) {
    const imageUrls = new Set();

    if (data.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      imageUrls.add(data.url);
    }

    if (data.media_metadata) {
      Object.values(data.media_metadata).forEach(item => {
        if (item.status === 'valid' && item.s?.u) {
          imageUrls.add(item.s.u.replace(/&amp;/g, '&'));
        }
      });
    }

    return Array.from(imageUrls).slice(0, 10);
  }

  function parseComments(children, includeHidden, maxDepth, moreIds) {
    const roots = [];
    let count = 0;

    for (const child of children) {
      if (child.kind === 'more' && child.data?.children) {
        moreIds.push(...child.data.children);
        continue;
      }

      const node = parseCommentNode(child, includeHidden, 0, maxDepth, moreIds);
      if (node) {
        roots.push(node);
        count++;
        count += countNestedReplies(node.replies);
      }
    }

    return { roots, count };
  }

  function parseCommentNode(child, includeHidden, currentDepth, maxDepth, moreIds) {
    if (child.kind === 'more' && child.data?.children) {
      moreIds.push(...child.data.children);
      return null;
    }

    if (child.kind !== 't1') return null;

    const data = child.data;
    const isRemoved = data.body === '[removed]' || data.body === '[deleted]';
    if (!includeHidden && isRemoved) return null;

    const comment = {
      id: data.name,
      parentId: data.parent_id,
      author: data.author,
      text: data.body,
      depth: data.depth,
      score: data.score,
      timestamp: data.created_utc * 1000,
      isSubmitter: data.is_submitter || false,
      authorFlair: data.author_flair_text || null,
      distinguished: data.distinguished || null,
      replies: []
    };

    if (currentDepth < maxDepth - 1 && data.replies?.data?.children) {
      for (const replyChild of data.replies.data.children) {
        const replyNode = parseCommentNode(replyChild, includeHidden, currentDepth + 1, maxDepth, moreIds);
        if (replyNode) {
          comment.replies.push(replyNode);
        }
      }
    }

    return comment;
  }

  function countNestedReplies(replies) {
    let count = 0;
    for (const reply of replies) {
      count++;
      if (reply.replies?.length) {
        count += countNestedReplies(reply.replies);
      }
    }
    return count;
  }
}
