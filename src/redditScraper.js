// redditScraper.js - content script for scraping Reddit threads
// Handles large threads, Reddit sort modes, morechildren retries, and smarter comment trimming.

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
    failedMoreIds: [],
    filterMinScore: 0,
    filterTopN: 0,
    filterAuthorType: 'all',
    filterAuthorTypes: [],
    filterHideBots: false,
    trimStrategy: 'top',
    redditSortMode: 'confidence'
  };

  // Shared with the service worker so a tab scrape and a background scrape agree
  // on comment shape, bot detection, merging and filtering.
  const Parser = globalThis.R2AIRedditParser;

  const RATE_LIMIT = {
    minDelay: 1000,
    batchSize: 100,
    maxRetries: 3,
    maxNestedMoreRounds: 50
  };

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'scrapeReddit') {
      // A full scrape can take minutes. Holding this response channel open for that
      // long is fragile in MV3 (the service worker is torn down while it waits), so
      // the request is only acknowledged here and the result is delivered later as
      // its own `scrapeComplete` message, correlated by scrapeId.
      const scrapeId = request.scrapeId || null;
      loadScrapeSettings(request).then(settings => {
        applySettings(settings, request);
        return startScrape(settings.includeHidden)
          .then(data => reportScrapeComplete(scrapeId, { data }))
          .catch(error => {
            console.error('Reddit to AI scrape error:', error);
            return reportScrapeComplete(scrapeId, { error: error.message || String(error) });
          });
      }).catch(error => {
        console.error('Reddit to AI scrape setup error:', error);
        reportScrapeComplete(scrapeId, { error: error.message || String(error) });
      });
      sendResponse({ started: true, scrapeId });
      return false;
    }

    if (request.action === 'resumeMoreChildren') {
      applyResumeSettings(request);
      fetchAllMoreComments(request.moreIds || [], Boolean(request.includeHidden), true)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message || String(error) }));
      return true;
    }

    if (request.action === 'stopScrapingRequested') {
      SCRAPER_STATE.stopRequested = true;
      sendResponse({ stopped: true });
      return false;
    }

    return false;
  });

  function loadScrapeSettings(request) {
    return new Promise(resolve => {
      chrome.storage.sync.get([
        'scrapeDepth',
        'filterMinScore',
        'filterTopN',
        'filterAuthorType',
        'filterAuthorTypes',
        'filterHideBots',
        'includeHidden',
        'trimStrategy',
        'redditSortMode'
      ], result => {
        resolve({ ...result, includeHidden: request.includeHidden ?? result.includeHidden ?? false });
      });
    });
  }

  function applySettings(result, request = {}) {
    const requestFilters = request.filters || {};
    SCRAPER_STATE.maxDepth = requestFilters.scrapeDepth || result.scrapeDepth || 5;
    SCRAPER_STATE.filterMinScore = requestFilters.minScore ?? result.filterMinScore ?? 0;
    SCRAPER_STATE.filterTopN = requestFilters.topN ?? result.filterTopN ?? 0;
    SCRAPER_STATE.filterAuthorType = requestFilters.authorType || result.filterAuthorType || 'all';
    SCRAPER_STATE.filterHideBots = requestFilters.hideBots ?? result.filterHideBots ?? false;
    SCRAPER_STATE.trimStrategy = requestFilters.trimStrategy || result.trimStrategy || 'top';
    SCRAPER_STATE.redditSortMode = normalizeSortMode(requestFilters.redditSortMode || result.redditSortMode || 'confidence');

    if (Array.isArray(requestFilters.authorTypes)) {
      SCRAPER_STATE.filterAuthorTypes = requestFilters.authorTypes;
    } else if (Array.isArray(result.filterAuthorTypes)) {
      SCRAPER_STATE.filterAuthorTypes = result.filterAuthorTypes;
    } else {
      const legacy = result.filterAuthorType;
      SCRAPER_STATE.filterAuthorTypes = (legacy === 'op' || legacy === 'flaired') ? [legacy] : [];
    }

    console.log('Reddit to AI: Scrape settings:', {
      depth: SCRAPER_STATE.maxDepth,
      minScore: SCRAPER_STATE.filterMinScore,
      topN: SCRAPER_STATE.filterTopN,
      authorTypes: SCRAPER_STATE.filterAuthorTypes,
      hideBots: SCRAPER_STATE.filterHideBots,
      includeHidden: result.includeHidden,
      trimStrategy: SCRAPER_STATE.trimStrategy,
      redditSortMode: SCRAPER_STATE.redditSortMode
    });
  }

  function applyResumeSettings(request) {
    SCRAPER_STATE.stopRequested = false;
    SCRAPER_STATE.threadId = request.threadId || SCRAPER_STATE.threadId;
    SCRAPER_STATE.subreddit = request.subreddit || SCRAPER_STATE.subreddit;
    SCRAPER_STATE.redditSortMode = normalizeSortMode(request.redditSortMode || SCRAPER_STATE.redditSortMode);
    SCRAPER_STATE.maxDepth = request.maxDepth || SCRAPER_STATE.maxDepth;
    SCRAPER_STATE.failedMoreIds = [];
  }

  async function startScrape(includeHidden) {
    SCRAPER_STATE.stopRequested = false;
    SCRAPER_STATE.collectedMoreIds = new Set();
    SCRAPER_STATE.failedMoreIds = [];

    sendProgress(chrome.i18n.getMessage('scraper_fetching') || 'Fetching thread...', 5, 'fetch');

    const jsonUrl = Parser.buildRedditJsonUrl(
      window.location.href,
      SCRAPER_STATE.redditSortMode,
      SCRAPER_STATE.maxDepth
    );

    let post;
    let roots;
    let count;
    let fallbackToDom = false;

    try {
      const response = await fetchWithRetry(jsonUrl);
      if (!Array.isArray(response) || response.length < 2) {
        throw new Error('Invalid Reddit JSON format.');
      }

      const postData = response[0]?.data?.children?.[0]?.data;
      const commentsData = response[1]?.data?.children || [];
      if (!postData) {
        throw new Error('Reddit JSON did not include post data.');
      }

      SCRAPER_STATE.threadId = postData.name;
      SCRAPER_STATE.subreddit = postData.subreddit;

      post = extractPostDetails(postData);

      sendProgress(chrome.i18n.getMessage('scraper_parsing') || 'Parsing initial comments...', 15, 'parse');

      const moreIds = [];
      const parsedRes = parseComments(commentsData, includeHidden, SCRAPER_STATE.maxDepth, moreIds);
      roots = parsedRes.roots;
      count = parsedRes.count;
      console.log(`Reddit to AI: Initial parse - ${count} comments, ${moreIds.length} more IDs`);

      if (moreIds.length > 0 && !SCRAPER_STATE.stopRequested) {
        sendProgress(chrome.i18n.getMessage('scraper_found_more', [count.toString(), moreIds.length.toString()]) || `Found ${count} comments, loading ${moreIds.length} more...`, 20, 'expand', { count });
        const moreResult = await fetchAllMoreComments(moreIds, includeHidden, false);
        const integration = integrateAdditionalComments(roots, moreResult.comments);
        roots = integration.roots;
        count += integration.addedCount;
        SCRAPER_STATE.failedMoreIds = moreResult.failedIds || [];
        console.log(`Reddit to AI: Added ${integration.addedCount} more comments. Total: ${count}. Failed IDs: ${SCRAPER_STATE.failedMoreIds.length}`);
      }
    } catch (error) {
      console.warn('Reddit JSON API fetch failed, falling back to DOM scraping:', error);
      fallbackToDom = true;
    }

    if (fallbackToDom) {
      sendProgress(chrome.i18n.getMessage('scraper_dom_fallback') || 'API failed. Parsing visible DOM...', 15, 'parse');
      const domResult = scrapeFromDOM(includeHidden);
      post = domResult.post;
      roots = domResult.comments;
      count = countNestedReplies(roots);

      SCRAPER_STATE.threadId = post.permalink || window.location.href;
      SCRAPER_STATE.subreddit = post.subreddit;
    }

    sendProgress(chrome.i18n.getMessage('scraper_applying_filters') || 'Applying filters...', 95, 'filter');
    const filteredRoots = applyFilters(roots);
    const filteredCount = countNestedReplies(filteredRoots);

    sendProgress(chrome.i18n.getMessage('scraper_complete', [filteredCount.toString()]) || `Complete! ${filteredCount} comments after filtering.`, 100, 'filter');

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
        authorTypes: SCRAPER_STATE.filterAuthorTypes,
        hideBots: SCRAPER_STATE.filterHideBots,
        trimStrategy: SCRAPER_STATE.trimStrategy,
        redditSortMode: SCRAPER_STATE.redditSortMode
      },
      morechildren: {
        failedIds: SCRAPER_STATE.failedMoreIds,
        batchSize: RATE_LIMIT.batchSize,
        oneRequestAtATime: true,
        retryLimit: RATE_LIMIT.maxRetries
      },
      threadId: SCRAPER_STATE.threadId,
      threadUrl: window.location.href
    };
  }

  function scrapeFromDOM(includeHidden) {
    const postEl = document.querySelector('shreddit-post');
    if (!postEl) {
      throw new Error('Could not find <shreddit-post> element on the page.');
    }

    const title = postEl.getAttribute('post-title') || '';
    const author = postEl.getAttribute('author') || '';
    const subreddit = (postEl.getAttribute('subreddit-prefixed-name') || postEl.getAttribute('subreddit') || '').replace(/^r\//, '');

    let content = '';
    const contentEl = postEl.querySelector('#-post-rtjson-content') ||
                      postEl.querySelector('[slot="text-body"]') ||
                      postEl.querySelector('.text-neutral-content');
    if (contentEl) {
      content = contentEl.textContent.trim();
    } else {
      const paragraphs = Array.from(postEl.querySelectorAll('p')).filter(p => !p.closest('shreddit-comment'));
      content = paragraphs.map(p => p.textContent.trim()).join('\n\n');
    }

    const score = parseInt(postEl.getAttribute('score') || '0', 10);
    const numComments = parseInt(postEl.getAttribute('comment-count') || '0', 10);
    const isNsfw = postEl.hasAttribute('over-18') || postEl.getAttribute('over-18') === 'true';
    const isSpoiler = postEl.hasAttribute('spoiler') || postEl.getAttribute('spoiler') === 'true';
    const permalink = postEl.getAttribute('permalink') ? `https://www.reddit.com${postEl.getAttribute('permalink')}` : window.location.href;

    const post = {
      title,
      author,
      subreddit,
      url: window.location.href,
      content,
      flair: postEl.getAttribute('flair') || null,
      isNsfw,
      isSpoiler,
      awardCount: 0,
      score,
      upvoteRatio: null,
      numComments,
      createdUtc: null,
      permalink,
      images: [],
      links: [],
      videos: [],
      youtubeVideoUrls: [],
      sourceUrls: [],
      gallery: [],
      poll: null,
      postHint: null,
      domain: null,
      crosspostParentUrl: null,
      crosspostParentTitle: null
    };

    const commentEls = Array.from(document.querySelectorAll('shreddit-comment'));
    const allComments = [];

    for (const el of commentEls) {
      const id = el.getAttribute('thingid') || el.getAttribute('id') || '';
      const parentId = el.getAttribute('parentid') || el.getAttribute('parent-id') || '';
      const cAuthor = el.getAttribute('author') || '';
      const scoreAttr = el.getAttribute('score');
      const cScore = scoreAttr != null ? parseInt(scoreAttr, 10) : 0;
      const depthAttr = el.getAttribute('depth');
      const depth = depthAttr != null ? parseInt(depthAttr, 10) : 0;

      let text = el.getAttribute('text') || '';
      if (!text) {
        const bodyEl = el.querySelector('[slot="comment"]') || el.querySelector('.md') || el.querySelector('.text-neutral-content');
        if (bodyEl) {
          text = bodyEl.textContent.trim();
        } else {
          const paragraphs = Array.from(el.querySelectorAll('p')).filter(p => p.closest('shreddit-comment') === el);
          text = paragraphs.map(p => p.textContent.trim()).join('\n\n');
        }
      }

      // Filter out deleted/removed comments if includeHidden is false
      const isRemoved = text === '[removed]' || text === '[deleted]';
      if (!includeHidden && isRemoved) {
        continue;
      }

      allComments.push({
        id,
        parentId,
        author: cAuthor,
        text,
        depth,
        score: cScore,
        ups: cScore,
        downs: 0,
        controversiality: 0,
        timestamp: null,
        createdUtc: null,
        isSubmitter: cAuthor && author && cAuthor === author,
        authorFlair: el.getAttribute('author-flair-text') || null,
        authorFlairCss: null,
        distinguished: null,
        awardCount: 0,
        permalink: el.getAttribute('permalink') ? `https://www.reddit.com${el.getAttribute('permalink')}` : null,
        replies: []
      });
    }

    const commentMap = {};
    for (const comment of allComments) {
      if (comment.id) {
        commentMap[comment.id] = comment;
        const norm = comment.id.replace(/^(t1|t3)_/, '');
        commentMap[norm] = comment;
      }
    }

    const roots = [];
    for (const comment of allComments) {
      const parentId = comment.parentId;
      const parent = parentId ? (commentMap[parentId] || commentMap[parentId.replace(/^(t1|t3)_/, '')]) : null;
      if (parent && parent.id !== comment.id) {
        parent.replies.push(comment);
      } else {
        roots.push(comment);
      }
    }

    return {
      post,
      comments: roots
    };
  }

  async function fetchWithRetry(url, retries = RATE_LIMIT.maxRetries) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.status === 429) {
          const waitTime = Math.pow(2, i + 1) * 1000;
          console.log(`Reddit to AI: Rate limited, waiting ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }
        if (!res.ok) throw new Error(describeRedditHttpError(res.status));
        return await res.json();
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await delay(Math.pow(2, i) * 1000);
        }
      }
    }
    throw lastError || new Error('Max retries exceeded');
  }

  async function fetchAllMoreComments(moreIds, includeHidden, isResume) {
    const allComments = [];
    const failedIds = [];
    const seenIds = new Set();
    const queue = [];
    const nestedRounds = { count: 0 };

    enqueueMoreIds(moreIds, queue, seenIds);
    const initialBatchCount = queue.length || 1;
    console.log(`Reddit to AI: Fetching morechildren in ${queue.length} sequential batch(es).`);

    let processedBatches = 0;
    while (queue.length > 0 && !SCRAPER_STATE.stopRequested) {
      const batch = queue.shift();
      processedBatches += 1;

      if (!isResume) {
        const progress = 20 + Math.min(70, Math.floor((processedBatches / Math.max(initialBatchCount, processedBatches)) * 70));
        sendProgress(chrome.i18n.getMessage('scraper_loading_batch', [processedBatches.toString(), Math.max(initialBatchCount, processedBatches).toString()]) || `Loading comments batch ${processedBatches}...`, progress, 'load', { current: processedBatches, total: Math.max(initialBatchCount, processedBatches) });
      }

      try {
        const result = await fetchMoreBatchWithRetry(batch, includeHidden);
        allComments.push(...result.comments);
        if (result.nestedMoreIds.length > 0 && nestedRounds.count < RATE_LIMIT.maxNestedMoreRounds) {
          nestedRounds.count += 1;
          enqueueMoreIds(result.nestedMoreIds, queue, seenIds);
        }
      } catch (error) {
        console.warn('Reddit to AI: morechildren batch failed after retries:', error.message, batch);
        failedIds.push(...batch);
      }

      if (queue.length > 0) {
        await delay(RATE_LIMIT.minDelay);
      }
    }

    SCRAPER_STATE.failedMoreIds = failedIds;
    return { comments: allComments, failedIds };
  }

  function enqueueMoreIds(ids, queue, seenIds) {
    const clean = [];
    for (const id of ids || []) {
      const id36 = String(id || '').replace(/^t1_/, '').trim();
      if (!id36 || seenIds.has(id36)) continue;
      seenIds.add(id36);
      clean.push(id36);
    }
    for (let i = 0; i < clean.length; i += RATE_LIMIT.batchSize) {
      queue.push(clean.slice(i, i + RATE_LIMIT.batchSize));
    }
  }

  async function fetchMoreBatchWithRetry(ids, includeHidden) {
    let lastError = null;
    for (let attempt = 0; attempt < RATE_LIMIT.maxRetries; attempt++) {
      try {
        return await fetchMoreBatch(ids, includeHidden);
      } catch (error) {
        lastError = error;
        if (attempt < RATE_LIMIT.maxRetries - 1) {
          await delay(Math.pow(2, attempt + 1) * 1000);
        }
      }
    }
    throw lastError || new Error('morechildren request failed');
  }

  async function fetchMoreBatch(ids, includeHidden) {
    const cappedIds = ids.slice(0, RATE_LIMIT.batchSize);
    const params = new URLSearchParams({
      api_type: 'json',
      link_id: SCRAPER_STATE.threadId,
      children: cappedIds.join(','),
      raw_json: '1',
      limit_children: 'false',
      sort: SCRAPER_STATE.redditSortMode,
      depth: String(Math.min(Math.max(SCRAPER_STATE.maxDepth, 1), 10))
    });

    const url = `https://www.reddit.com/api/morechildren.json?${params.toString()}`;
    const data = await fetchWithRetry(url);
    const things = data?.json?.data?.things || [];

    const comments = [];
    const nestedMoreIds = [];

    for (const thing of things) {
      if (thing.kind === 't1') {
        const parsed = parseCommentData(thing.data, includeHidden);
        if (parsed) comments.push(parsed);
      } else if (thing.kind === 'more' && Array.isArray(thing.data?.children)) {
        nestedMoreIds.push(...thing.data.children);
      }
    }

    return { comments, nestedMoreIds };
  }

  function integrateAdditionalComments(roots, additionalComments) {
    return Parser.mergeAdditionalComments(roots, additionalComments, SCRAPER_STATE.threadId, {
      shouldStop: () => SCRAPER_STATE.stopRequested
    });
  }

  function parseCommentData(data, includeHidden) {
    return Parser.parseCommentData(data, includeHidden);
  }

  function applyFilters(roots) {
    let result = Parser.filterComments(roots || [], {
      minScore: SCRAPER_STATE.filterMinScore,
      hideBots: SCRAPER_STATE.filterHideBots,
      authorTypes: SCRAPER_STATE.filterAuthorTypes || []
    });

    const topN = Number(SCRAPER_STATE.filterTopN || 0);
    if (topN > 0) {
      result = limitCommentsByStrategy(result, topN, SCRAPER_STATE.trimStrategy);
    }

    return result;
  }

  function limitCommentsByStrategy(comments, limit, strategy) {
    if (!window.R2AIPrompt?.trimComments) {
      return legacyTopN(comments, limit);
    }
    return R2AIPrompt.trimComments(comments, limit, strategy);
  }

  function legacyTopN(comments, limit) {
    const flat = [];
    const collect = nodes => {
      for (const node of nodes) {
        flat.push(node);
        collect(node.replies || []);
      }
    };
    collect(comments);
    flat.sort((a, b) => (b.score || 0) - (a.score || 0));
    const topIds = new Set(flat.slice(0, limit).map(c => c.id));
    const prune = nodes => nodes.flatMap(node => {
      const replies = prune(node.replies || []);
      return topIds.has(node.id) || replies.length > 0 ? [{ ...node, replies }] : [];
    });
    return prune(comments);
  }

  function extractPostDetails(data) {
    const media = collectMedia(data);
    const crosspost = Array.isArray(data.crosspost_parent_list) ? data.crosspost_parent_list[0] : null;

    return {
      title: data.title,
      author: data.author,
      subreddit: data.subreddit,
      url: window.location.href,
      content: data.selftext || '',
      flair: data.link_flair_text || null,
      isNsfw: Boolean(data.over_18),
      isSpoiler: Boolean(data.spoiler),
      awardCount: data.total_awards_received || 0,
      score: data.score,
      upvoteRatio: data.upvote_ratio,
      numComments: data.num_comments,
      createdUtc: data.created_utc || null,
      permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : window.location.href,
      images: media.images,
      links: media.links,
      videos: media.videos,
      youtubeVideoUrls: media.youtubeVideoUrls,
      sourceUrls: media.sourceUrls,
      gallery: media.gallery,
      poll: extractPoll(data),
      postHint: data.post_hint || null,
      domain: data.domain || null,
      crosspostParentUrl: crosspost?.permalink ? `https://www.reddit.com${crosspost.permalink}` : null,
      crosspostParentTitle: crosspost?.title || null
    };
  }

  function collectMedia(data) {
    const images = new Set();
    const links = new Set();
    const videos = new Set();
    const youtubeVideoUrls = new Set();
    const sourceUrls = new Set();
    const gallery = [];

    const addImage = url => addUrl(images, decodeRedditUrl(url));
    const addLink = url => addUrl(links, decodeRedditUrl(url));
    const addVideo = url => addUrl(videos, decodeRedditUrl(url));
    const addSource = url => addUrl(sourceUrls, decodeRedditUrl(url));

    const outboundUrl = data.url_overridden_by_dest || data.url;
    if (outboundUrl) {
      if (isImageUrl(outboundUrl)) addImage(outboundUrl);
      else if (isVideoUrl(outboundUrl)) addVideo(outboundUrl);
      else if (!data.is_self) addLink(outboundUrl);
      if (isYouTubeUrl(outboundUrl)) youtubeVideoUrls.add(outboundUrl);
      if (!isRedditHostedUrl(outboundUrl)) addSource(outboundUrl);
    }

    if (data.preview?.images) {
      data.preview.images.forEach(image => {
        addImage(image.source?.url);
        (image.resolutions || []).slice(-1).forEach(resolution => addImage(resolution.url));
      });
    }

    if (data.media_metadata) {
      Object.entries(data.media_metadata).forEach(([id, item]) => {
        const url = item?.s?.u || item?.s?.gif || item?.p?.slice(-1)?.[0]?.u;
        if (url) {
          const decoded = decodeRedditUrl(url);
          addImage(decoded);
          gallery.push({ id, url: decoded, caption: item.caption || null, outboundUrl: item.outbound_url || null });
        }
        if (item?.outbound_url) addSource(item.outbound_url);
      });
    }

    if (data.gallery_data?.items) {
      data.gallery_data.items.forEach(item => {
        const galleryItem = gallery.find(existing => existing.id === item.media_id);
        if (galleryItem) galleryItem.caption = item.caption || galleryItem.caption;
      });
    }

    const redditVideo = data.secure_media?.reddit_video || data.media?.reddit_video;
    if (redditVideo?.fallback_url) addVideo(redditVideo.fallback_url);
    if (redditVideo?.dash_url) addVideo(redditVideo.dash_url);
    if (redditVideo?.hls_url) addVideo(redditVideo.hls_url);

    const oembed = data.secure_media?.oembed || data.media?.oembed;
    if (oembed?.thumbnail_url) addImage(oembed.thumbnail_url);
    if (oembed?.url) addSource(oembed.url);
    if (oembed?.provider_name?.toLowerCase().includes('youtube') && outboundUrl) youtubeVideoUrls.add(outboundUrl);

    if (Array.isArray(data.crosspost_parent_list)) {
      data.crosspost_parent_list.forEach(crosspost => {
        if (crosspost.url) addSource(crosspost.url);
        if (crosspost.preview?.images) {
          crosspost.preview.images.forEach(image => addImage(image.source?.url));
        }
      });
    }

    return {
      images: Array.from(images).slice(0, 20),
      links: Array.from(links).slice(0, 30),
      videos: Array.from(videos).slice(0, 10),
      youtubeVideoUrls: Array.from(youtubeVideoUrls).slice(0, 10),
      sourceUrls: Array.from(sourceUrls).slice(0, 20),
      gallery
    };
  }

  function extractPoll(data) {
    if (!data.poll_data) return null;
    return {
      predictionStatus: data.poll_data.prediction_status || null,
      totalVoteCount: data.poll_data.total_vote_count || null,
      votingEndTimestamp: data.poll_data.voting_end_timestamp || null,
      options: (data.poll_data.options || []).map(option => ({
        id: option.id,
        text: option.text,
        voteCount: option.vote_count ?? null
      }))
    };
  }

  function parseComments(children, includeHidden, maxDepth, moreIds) {
    return Parser.parseComments(children, {
      includeHidden,
      maxDepth,
      moreIds,
      placeholderStyle: 'content'
    });
  }

  function countNestedReplies(replies) {
    return Parser.countComments(replies);
  }

  function normalizeSortMode(value) {
    return Parser.normalizeSortMode(value);
  }

  function decodeRedditUrl(url) {
    return url ? String(url).replace(/&amp;/g, '&') : '';
  }

  function addUrl(set, url) {
    if (!url) return;
    set.add(url);
  }

  function isImageUrl(url) {
    return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url || '') || /preview\.redd\.it|i\.redd\.it|external-preview\.redd\.it/i.test(url || '');
  }

  function isVideoUrl(url) {
    return /\.(mp4|webm|mov|m3u8)(\?.*)?$/i.test(url || '') || /v\.redd\.it/i.test(url || '');
  }

  function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(url || '');
  }

  function isRedditHostedUrl(url) {
    return /(?:reddit\.com|redd\.it|i\.redd\.it|preview\.redd\.it|v\.redd\.it)/i.test(url || '');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Delivers the finished scrape (or its failure) on a fresh message. Sending this
  // also wakes the service worker if it was torn down while the scrape ran.
  function reportScrapeComplete(scrapeId, payload) {
    try {
      chrome.runtime.sendMessage({ action: 'scrapeComplete', scrapeId, ...payload }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Reddit to AI: scrapeComplete delivery failed:', chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.error('Reddit to AI: could not deliver scrapeComplete:', error);
    }
  }

  // `phase` (and `batch`, where a counter exists) travel alongside the human-readable
  // message so the panel and popup never have to parse localized text to know where
  // the scrape is. See DEFAULT_STATE in service_worker.js for the phase vocabulary.
  function sendProgress(message, percentage, phase, batch) {
    try {
      chrome.runtime.sendMessage({ action: 'progressUpdate', message, percentage, phase, batch });
    } catch (error) {
      console.debug('Progress update failed:', error);
    }
  }

  function describeRedditHttpError(status) {
    if (status === 401 || status === 403) return 'Reddit returned an access error. The thread may be private, quarantined, age-gated, or require login.';
    if (status === 404) return 'Reddit could not find this thread. It may be deleted or the URL may be wrong.';
    if (status === 451) return 'Reddit blocked this thread in your region.';
    return `Reddit request failed with HTTP ${status}`;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.scrapeFromDOM = scrapeFromDOM;
    globalThis.startScrape = startScrape;
    globalThis.SCRAPER_STATE = SCRAPER_STATE;
    globalThis.applySettings = applySettings;
  }
}
