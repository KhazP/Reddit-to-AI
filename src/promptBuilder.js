// Reddit to AI - shared prompt building and context budgeting helpers
(function attachPromptHelpers(global) {
  const CONTEXT_PRESETS = {
    small: {
      label: 'Small',
      commentLimit: 60,
      maxChars: 24000,
      description: 'Fast, compact prompt for smaller context windows.'
    },
    balanced: {
      label: 'Balanced',
      commentLimit: 180,
      maxChars: 70000,
      description: 'Good default for most threads and AI chats.'
    },
    full: {
      label: 'Full',
      commentLimit: 500,
      maxChars: 160000,
      description: 'Large prompt with most useful comments kept.'
    },
    maxQuality: {
      label: 'Max Quality',
      commentLimit: 0,
      maxChars: 0,
      description: 'No extra budget trimming. Uses everything scraped.'
    }
  };

  const TRIM_STRATEGIES = {
    top: 'Top scored',
    controversial: 'Controversial',
    op: 'OP replies',
    flaired: 'Flaired users',
    diverse: 'Diverse viewpoints',
    newest: 'Newest',
    longest: 'Longest helpful comments'
  };

  const MEDIA_MODES = {
    attach: 'Attach images + list media links',
    urls: 'List media URLs only',
    ignore: 'Ignore media'
  };

  const OUTPUT_FORMATS = {
    auto: '',
    bullets: 'Format the answer as concise bullet points with clear headings.',
    table: 'Format the answer as a Markdown table where practical, with short supporting notes after the table.',
    json: 'Return valid JSON only. Use descriptive keys and preserve important evidence in short strings.',
    prosCons: 'Organize the answer into Pros, Cons, Tradeoffs, and Recommendation sections.',
    executive: 'Write an executive summary first, followed by key evidence and recommended next steps.'
  };

  const WARNING_LEVELS = [
    { key: 'low', label: 'Low', minTokens: 0, message: 'Comfortable prompt size.' },
    { key: 'medium', label: 'Medium', minTokens: 12000, message: 'May be large for smaller models.' },
    { key: 'high', label: 'High', minTokens: 48000, message: 'Large prompt. Consider Balanced or Small.' },
    { key: 'critical', label: 'Critical', minTokens: 120000, message: 'Very large. Many AI sites may reject or truncate it.' }
  ];

  function safeTranslate(key, fallback, params = []) {
    try {
      if (typeof global.t === 'function') {
        return global.t(key, params) || fallback;
      }
    } catch (error) {
      console.debug('Translation fallback used:', key, error);
    }
    return fallback;
  }

  function deepClone(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      console.warn('Prompt helper clone fallback:', error);
      return value;
    }
  }

  function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
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

  function countImages(data) {
    if (Array.isArray(data?.threads)) {
      return data.threads.reduce((sum, thread) => sum + countImages(thread), 0);
    }
    const images = data?.post?.images;
    return Array.isArray(images) ? images.length : 0;
  }

  function flattenComments(comments, depth = 0, parent = null, arr = []) {
    if (!Array.isArray(comments)) return arr;
    for (const comment of comments) {
      if (!comment) continue;
      arr.push({ comment, depth, parent });
      if (Array.isArray(comment.replies) && comment.replies.length > 0) {
        flattenComments(comment.replies, depth + 1, comment, arr);
      }
    }
    return arr;
  }

  function rebuildTreeFromSelected(roots, selectedIds) {
    function prune(comments) {
      const kept = [];
      for (const comment of comments || []) {
        const replies = prune(comment.replies || []);
        if (selectedIds.has(comment.id) || replies.length > 0) {
          kept.push({ ...comment, replies });
        }
      }
      return kept;
    }
    return prune(roots || []);
  }

  function scoreTextHelpfulness(comment) {
    const textLength = normalizeWhitespace(comment.text).length;
    const score = Number(comment.score || 0);
    const replyCount = Array.isArray(comment.replies) ? comment.replies.length : 0;
    return Math.min(textLength, 1400) + score * 12 + replyCount * 20;
  }

  function controversyScore(comment) {
    const controversiality = Number(comment.controversiality || 0);
    const replies = Array.isArray(comment.replies) ? comment.replies.length : 0;
    const score = Math.abs(Number(comment.score || 0));
    const textLength = normalizeWhitespace(comment.text).length;
    return controversiality * 1000 + replies * 35 + Math.max(0, 120 - score) + Math.min(textLength, 700) / 10;
  }

  function diverseSelection(flat, limit) {
    const buckets = new Map();
    const sorted = [...flat].sort((a, b) => scoreTextHelpfulness(b.comment) - scoreTextHelpfulness(a.comment));
    for (const item of sorted) {
      const author = item.comment.author || 'unknown';
      const flair = item.comment.authorFlair || 'no-flair';
      const scoreBucket = Number(item.comment.score || 0) >= 10 ? 'positive' : 'mixed';
      const key = `${author}:${flair}:${scoreBucket}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }

    const selected = [];
    const queues = [...buckets.values()];
    while (selected.length < limit && queues.length > 0) {
      for (let i = queues.length - 1; i >= 0; i--) {
        const next = queues[i].shift();
        if (next) selected.push(next);
        if (queues[i].length === 0) queues.splice(i, 1);
        if (selected.length >= limit) break;
      }
    }
    return selected;
  }

  function sortFlatComments(flat, strategy) {
    const sorted = [...flat];
    switch (strategy) {
      case 'controversial':
        sorted.sort((a, b) => controversyScore(b.comment) - controversyScore(a.comment));
        break;
      case 'op':
        sorted.sort((a, b) => Number(Boolean(b.comment.isSubmitter)) - Number(Boolean(a.comment.isSubmitter)) || (b.comment.score || 0) - (a.comment.score || 0));
        break;
      case 'flaired':
        sorted.sort((a, b) => Number(Boolean(b.comment.authorFlair)) - Number(Boolean(a.comment.authorFlair)) || (b.comment.score || 0) - (a.comment.score || 0));
        break;
      case 'newest':
        sorted.sort((a, b) => Number(b.comment.timestamp || 0) - Number(a.comment.timestamp || 0));
        break;
      case 'longest':
        sorted.sort((a, b) => scoreTextHelpfulness(b.comment) - scoreTextHelpfulness(a.comment));
        break;
      case 'top':
      default:
        sorted.sort((a, b) => Number(b.comment.score || 0) - Number(a.comment.score || 0));
        break;
    }
    return sorted;
  }

  function trimComments(comments, limit, strategy = 'top') {
    if (!limit || limit <= 0) return deepClone(comments || []);
    const flat = flattenComments(comments || []);
    if (flat.length <= limit) return deepClone(comments || []);

    const selected = strategy === 'diverse'
      ? diverseSelection(flat, limit)
      : sortFlatComments(flat, strategy).slice(0, limit);

    const selectedIds = new Set(selected.map(item => item.comment.id));
    return rebuildTreeFromSelected(comments || [], selectedIds);
  }

  // Rough per-comment rendering cost (author label, indentation, score, separators).
  const COMMENT_RENDER_OVERHEAD = 40;
  const MIN_BUDGET_COMMENTS = 10;

  function estimateCommentsChars(comments) {
    let total = 0;
    for (const item of flattenComments(comments || [])) {
      const comment = item.comment;
      total += String(comment.text || '').length
        + String(comment.author || '').length
        + COMMENT_RENDER_OVERHEAD;
    }
    return total;
  }

  function estimateDataCommentsChars(data) {
    if (Array.isArray(data?.threads)) {
      return data.threads.reduce((sum, thread) => sum + estimateCommentsChars(thread.comments), 0);
    }
    return estimateCommentsChars(data?.comments);
  }

  function applyCommentLimit(data, limit, strategy) {
    if (Array.isArray(data.threads)) {
      const perThread = Math.max(1, Math.ceil(limit / data.threads.length));
      return {
        ...data,
        threads: data.threads.map(thread => ({
          ...thread,
          comments: trimComments(thread.comments, perThread, strategy)
        }))
      };
    }
    return { ...data, comments: trimComments(data.comments, limit, strategy) };
  }

  // Trims comments until the rendered prompt fits `maxChars`.
  // The tree is cloned once and sizes are estimated from summed comment text lengths
  // (calibrated against a single full render), so a binary search costs no extra renders.
  function trimCommentsToCharBudget(data, template, options, maxChars) {
    if (!maxChars || maxChars <= 0) return data;
    const strategy = options?.trimStrategy || 'top';
    const renderOptions = { ...options, skipBudgetTrim: true, skipContextPreset: true };
    const render = candidate => buildPromptText(candidate, template, renderOptions);

    const workingData = deepClone(data);
    const fullPrompt = render(workingData);
    if (fullPrompt.length <= maxChars) return workingData;

    const totalComments = countDataComments(workingData);
    if (totalComments <= MIN_BUDGET_COMMENTS) {
      workingData.contextTrimmed = true;
      return workingData;
    }

    // Calibrate: everything in the prompt that is not comment text.
    const baseChars = Math.max(0, fullPrompt.length - estimateDataCommentsChars(workingData));

    let low = MIN_BUDGET_COMMENTS;
    let high = totalComments;
    let best = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = applyCommentLimit(workingData, mid, strategy);
      const estimate = baseChars + estimateDataCommentsChars(candidate);
      if (estimate <= maxChars) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let result = best || applyCommentLimit(workingData, MIN_BUDGET_COMMENTS, strategy);

    // The estimate can overshoot slightly; shrink with real renders as a safety net.
    let limit = countDataComments(result);
    for (let attempt = 0; attempt < 4 && limit > MIN_BUDGET_COMMENTS; attempt++) {
      if (render(result).length <= maxChars) break;
      limit = Math.max(MIN_BUDGET_COMMENTS, Math.floor(limit * 0.85));
      result = applyCommentLimit(workingData, limit, strategy);
    }

    result.contextTrimmed = true;
    return result;
  }

  function applyContextPreset(data, presetKey = 'balanced', options = {}) {
    const preset = CONTEXT_PRESETS[presetKey] || CONTEXT_PRESETS.balanced;
    const workingData = deepClone(data);
    const strategy = options.trimStrategy || 'top';

    if (Array.isArray(workingData?.threads)) {
      const perThreadLimit = preset.commentLimit > 0
        ? Math.max(10, Math.ceil(preset.commentLimit / workingData.threads.length))
        : 0;
      workingData.threads = workingData.threads.map(thread => ({
        ...thread,
        comments: trimComments(thread.comments, perThreadLimit, strategy)
      }));
      return workingData;
    }

    if (preset.commentLimit > 0) {
      workingData.comments = trimComments(workingData.comments, preset.commentLimit, strategy);
      workingData.contextTrimmed = countComments(workingData.comments) < countComments(data?.comments || []);
    }

    return workingData;
  }

  function collectMediaEntries(post, mediaMode) {
    if (mediaMode === 'ignore') return [];
    const entries = [];
    const add = (type, value, label = '') => {
      if (!value) return;
      const key = `${type}:${value}`;
      if (entries.some(entry => entry.key === key)) return;
      entries.push({ key, type, value, label });
    };

    (post?.images || []).forEach((url, index) => add('image', url, `Image ${index + 1}`));
    (post?.links || []).forEach(url => add('link', url, 'External link'));
    (post?.videos || []).forEach(url => add('video', url, 'Video'));
    (post?.youtubeVideoUrls || []).forEach(url => add('youtube', url, 'YouTube'));
    (post?.sourceUrls || []).forEach(url => add('source', url, 'Original source'));

    return entries;
  }

  function formatPostMeta(post, mediaMode) {
    const lines = [];
    if (post?.flair) lines.push(`Post flair: ${post.flair}`);
    if (post?.isNsfw) lines.push('NSFW: yes');
    if (post?.isSpoiler) lines.push('Spoiler: yes');
    if (post?.awardCount) lines.push(`Awards: ${post.awardCount}`);
    if (post?.crosspostParentUrl) lines.push(`Crosspost source: ${post.crosspostParentUrl}`);
    if (post?.poll) {
      const options = (post.poll.options || []).map(option => `${option.text}${option.voteCount != null ? ` (${option.voteCount})` : ''}`).join('; ');
      lines.push(`Poll: ${options || 'poll data present'}`);
    }

    const mediaEntries = collectMediaEntries(post, mediaMode);
    if (mediaEntries.length > 0) {
      lines.push('Media / links:');
      mediaEntries.forEach(entry => {
        lines.push(`- ${entry.label || entry.type}: ${entry.value}`);
      });
    }
    return lines;
  }

  function formatAllComments(comments) {
    if (!Array.isArray(comments) || comments.length === 0) {
      return `[${safeTranslate('options_history_empty', 'No comments')}]`;
    }

    const lines = [];
    function processComment(comment, depth) {
      if (!comment) return;
      const indent = '  '.repeat(Math.min(depth, 6));
      const author = comment.author || '[deleted]';
      const text = normalizeWhitespace(comment.text);
      const meta = [];
      if (typeof comment.score === 'number') meta.push(`${comment.score} pts`);
      if (comment.isSubmitter) meta.push('OP');
      if (comment.authorFlair) meta.push(`flair: ${comment.authorFlair}`);
      if (comment.distinguished) meta.push(`distinguished: ${comment.distinguished}`);
      const metaText = meta.length ? ` (${meta.join(', ')})` : '';

      if (text && text !== '[deleted]' && text !== '[removed]') {
        lines.push(`${indent}[${author}${metaText}]: ${text}`);
      }
      if (Array.isArray(comment.replies)) {
        comment.replies.forEach(reply => processComment(reply, depth + 1));
      }
    }

    comments.forEach(comment => processComment(comment, 0));
    return lines.join('\n\n');
  }

  function buildSingleThreadContent(data, options = {}) {
    const mediaMode = options.mediaMode || 'attach';
    const sections = [];
    const post = data.post || {};

    sections.push(`${safeTranslate('prompt_title', 'Thread Title')}: ${post.title || '[Unknown title]'}`);
    sections.push(`${safeTranslate('prompt_subreddit', 'Subreddit')}: r/${post.subreddit || 'unknown'}`);
    sections.push(`${safeTranslate('prompt_author', 'Author')}: u/${post.author || 'unknown'}`);
    if (post.url) sections.push(`${safeTranslate('prompt_url', 'URL')}: ${post.url}`);

    const metaLines = formatPostMeta(post, mediaMode);
    if (metaLines.length > 0) {
      sections.push('');
      sections.push('--- POST METADATA ---');
      sections.push(...metaLines);
    }

    sections.push('');
    sections.push(`--- ${safeTranslate('prompt_section_post', 'POST CONTENT')} ---`);
    sections.push(post.content || `[${safeTranslate('prompt_no_content', 'No body content')}]`);
    sections.push('');

    if (mediaMode === 'attach' && Array.isArray(post.images) && post.images.length > 0) {
      sections.push(`[${post.images.length} ${safeTranslate('prompt_images_attached', 'image(s) attached')}]`);
      sections.push('');
    }

    sections.push(`--- ${safeTranslate('prompt_section_comments', 'COMMENTS')} ---`);
    sections.push(formatAllComments(data.comments));
    sections.push('');
    sections.push('---');
    sections.push(`${safeTranslate('prompt_scraped_at', 'Scraped at')}: ${data.metadata?.scrapedAt || new Date().toISOString()}`);
    sections.push(`${safeTranslate('prompt_total_comments', 'Total comments')}: ${data.metadata?.commentCount || data.commentCount || countComments(data.comments)}`);
    sections.push(`${safeTranslate('prompt_depth', 'Depth level')}: ${data.maxDepth || 'unknown'}`);
    if (data.filtersApplied?.trimStrategy) sections.push(`Trim strategy: ${TRIM_STRATEGIES[data.filtersApplied.trimStrategy] || data.filtersApplied.trimStrategy}`);
    if (data.metadata?.failedMoreIds?.length) sections.push(`Missing morechildren IDs: ${data.metadata.failedMoreIds.length}`);

    return sections.join('\n');
  }

  function buildContent(data, options = {}) {
    if (Array.isArray(data?.threads)) {
      const sections = [
        'You are analyzing multiple Reddit threads together.',
        `Thread count: ${data.threads.length}`,
        ''
      ];
      data.threads.forEach((thread, index) => {
        sections.push(`================ THREAD ${index + 1} ================`);
        sections.push(buildSingleThreadContent(thread, options));
        sections.push('');
      });
      return sections.join('\n');
    }
    return buildSingleThreadContent(data, options);
  }

  function buildPromptText(data, template, options = {}) {
    let sourceData = options.contextPreset && !options.skipContextPreset
      ? applyContextPreset(data, options.contextPreset, options)
      : deepClone(data);
    if (!options.skipBudgetTrim) {
      const maxChars = CONTEXT_PRESETS[options.contextPreset]?.maxChars || 0;
      if (maxChars > 0) {
        sourceData = trimCommentsToCharBudget(sourceData, template, options, maxChars);
      }
    }
    const content = buildContent(sourceData, options);
    const effectiveTemplate = template || 'Please analyze the following Reddit thread.\n\n{content}';
    const prompt = effectiveTemplate.includes('{content}')
      ? effectiveTemplate.replace('{content}', content)
      : `${effectiveTemplate}\n\n${content}`;
    const formatInstruction = OUTPUT_FORMATS[options.outputFormat] || '';
    return formatInstruction ? `${formatInstruction}\n\n${prompt}` : prompt;
  }

  function countDataComments(data) {
    if (Array.isArray(data?.threads)) {
      return data.threads.reduce((sum, thread) => sum + countComments(thread.comments), 0);
    }
    return countComments(data?.comments);
  }

  function estimateTokens(text) {
    if (globalThis.R2ATiktoken) {
      try {
        return globalThis.R2ATiktoken.encode(text).length;
      } catch (err) {
        console.warn('Tiktoken encode error, falling back:', err);
      }
    }
    return Math.ceil(String(text || '').length / 4);
  }

  function getWarning(tokens) {
    let current = WARNING_LEVELS[0];
    for (const level of WARNING_LEVELS) {
      if (tokens >= level.minTokens) current = level;
    }
    return current;
  }

  function estimatePromptStats(promptText, data) {
    const chars = String(promptText || '').length;
    const tokens = estimateTokens(promptText);
    const warning = getWarning(tokens);
    return {
      chars,
      tokens,
      comments: countDataComments(data),
      images: countImages(data),
      warning,
      percentOfLargeContext: Math.min(100, Math.round((tokens / 128000) * 100))
    };
  }

  function exportToJSON(data) {
    return JSON.stringify(data, null, 2);
  }

  function escapeCSVCell(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    return '"' + str.replace(/"/g, '""') + '"';
  }

  function flattenCommentsForCSV(comments, depth = 0, parentId = '') {
    let rows = [];
    for (const comment of comments || []) {
      if (!comment) continue;
      rows.push({
        type: 'comment',
        id: comment.id || '',
        parentId: comment.parentId || parentId || '',
        depth: depth,
        author: comment.author || '',
        score: comment.score !== undefined ? comment.score : '',
        isOP: Boolean(comment.isSubmitter),
        text: comment.text || ''
      });
      if (Array.isArray(comment.replies) && comment.replies.length > 0) {
        rows = rows.concat(flattenCommentsForCSV(comment.replies, depth + 1, comment.id));
      }
    }
    return rows;
  }

  function exportToCSV(data) {
    const headers = ['Type', 'ID', 'Parent ID', 'Depth', 'Author', 'Score', 'Is OP', 'Text/Content'];
    const headerLine = headers.map(escapeCSVCell).join(',');
    const rows = [];

    const threads = Array.isArray(data?.threads) ? data.threads : [data];
    for (const thread of threads) {
      if (!thread) continue;
      // Post Row
      let postText = thread.post?.title || '';
      if (thread.post?.content) {
        postText = postText ? `${postText}\n\n${thread.post.content}` : thread.post.content;
      }
      rows.push([
        'post',
        thread.post?.id || '',
        '',
        0,
        thread.post?.author || '',
        thread.post?.score !== undefined ? thread.post.score : '',
        true,
        postText
      ]);

      // Comment Rows
      const flat = flattenCommentsForCSV(thread.comments, 0, thread.post?.id || '');
      for (const item of flat) {
        rows.push([
          item.type,
          item.id,
          item.parentId,
          item.depth,
          item.author,
          item.score,
          item.isOP,
          item.text
        ]);
      }
    }

    const lines = [headerLine].concat(
      rows.map(row => row.map(escapeCSVCell).join(','))
    );
    return lines.join('\n');
  }

  function renderMarkdownComment(comment, depth) {
    const indent = '  '.repeat(depth);
    const author = comment.author || '[deleted]';
    const scoreStr = typeof comment.score === 'number' ? ` (${comment.score} pts)` : '';
    const opSuffix = comment.isSubmitter ? ' (OP)' : '';
    const text = comment.text || '';
    const textIndent = '  '.repeat(depth + 1);
    const formattedText = text.split('\n').map(line => textIndent + line).join('\n');

    let result = `${indent}- **u/${author}**${scoreStr}${opSuffix}:\n${formattedText}`;

    if (Array.isArray(comment.replies) && comment.replies.length > 0) {
      for (const reply of comment.replies) {
        result += '\n' + renderMarkdownComment(reply, depth + 1);
      }
    }
    return result;
  }

  function exportToMarkdown(data) {
    const threads = Array.isArray(data?.threads) ? data.threads : [data];
    const mdSections = [];

    for (const thread of threads) {
      if (!thread) continue;
      const sections = [];
      const post = thread.post || {};
      const scrapedAt = thread.metadata?.scrapedAt || data.metadata?.scrapedAt || new Date().toISOString();
      const commentCount = thread.metadata?.commentCount || thread.commentCount || countComments(thread.comments);
      const maxDepth = thread.maxDepth || data.maxDepth || 'unknown';

      sections.push(`# ${post.title || '[Unknown title]'}`);
      sections.push('');
      sections.push(`- **Subreddit**: r/${post.subreddit || 'unknown'}`);
      sections.push(`- **Author**: u/${post.author || 'unknown'}`);
      if (post.url) sections.push(`- **URL**: ${post.url}`);
      sections.push(`- **Scraped at**: ${scrapedAt}`);
      sections.push(`- **Total Comments**: ${commentCount}`);
      sections.push(`- **Max Depth**: ${maxDepth}`);
      sections.push('');
      sections.push('## Post Content');
      sections.push('');
      sections.push(post.content || '[No body content]');
      sections.push('');
      sections.push('## Comments');
      sections.push('');

      if (Array.isArray(thread.comments) && thread.comments.length > 0) {
        sections.push(thread.comments.map(c => renderMarkdownComment(c, 0)).join('\n'));
      } else {
        sections.push('[No comments]');
      }

      mdSections.push(sections.join('\n'));
    }

    return mdSections.join('\n\n---\n\n');
  }

  global.R2AIPrompt = {
    CONTEXT_PRESETS,
    TRIM_STRATEGIES,
    MEDIA_MODES,
    OUTPUT_FORMATS,
    applyContextPreset,
    buildPromptText,
    estimatePromptStats,
    formatAllComments,
    countComments,
    countDataComments,
    countImages,
    trimComments,
    trimCommentsToCharBudget,
    rebuildTreeFromSelected,
    exportToJSON,
    exportToCSV,
    exportToMarkdown
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
