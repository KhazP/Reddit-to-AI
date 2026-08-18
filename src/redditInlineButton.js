// Reddit to AI - Reddit Inline Button Content Script
(async function () {
  if (window.__redditToAiInlineButtonInjected) {
    return;
  }
  window.__redditToAiInlineButtonInjected = true;

  if (typeof initI18n === 'function') {
    try {
      await initI18n();
    } catch (e) {
      console.warn('Reddit to AI: Failed to init i18n for inline button:', e);
    }
  }

  // Inject stylesheet if not already present
  function injectStyles() {
    if (document.getElementById && document.getElementById('r2ai-inline-btn-styles')) return;
    try {
      const link = document.createElement('link');
      link.id = 'r2ai-inline-btn-styles';
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('redditInlineButton.css');
      (document.head || document.documentElement || document.body)?.appendChild(link);
    } catch (e) {
      console.warn('Reddit to AI: Failed to inject button styles:', e);
    }
  }
  injectStyles();

  const settings = {
    showRedditInlineButton: true,
    showRedditButtonInFeed: true,
    showRedditButtonInPost: true
  };

  function loadSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
      processPosts();
      return;
    }
    chrome.storage.sync.get(settings, (loaded) => {
      if (chrome.runtime?.lastError) {
        console.warn('Reddit to AI: Error loading inline button settings:', chrome.runtime.lastError.message);
      } else if (loaded) {
        Object.assign(settings, loaded);
      }
      processPosts();
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      let changed = false;
      if (changes.showRedditInlineButton !== undefined) {
        settings.showRedditInlineButton = changes.showRedditInlineButton.newValue ?? true;
        changed = true;
      }
      if (changes.showRedditButtonInFeed !== undefined) {
        settings.showRedditButtonInFeed = changes.showRedditButtonInFeed.newValue ?? true;
        changed = true;
      }
      if (changes.showRedditButtonInPost !== undefined) {
        settings.showRedditButtonInPost = changes.showRedditButtonInPost.newValue ?? true;
        changed = true;
      }
      if (changed) {
        processPosts();
      }
    });
  }

  function findActionRow(post) {
    return (
      post.querySelector('div[slot="action-row"]') ||
      post.querySelector('shreddit-async-loader[bundlename="comment_action_row"]') ||
      post.querySelector('shreddit-post-action-row') ||
      post.querySelector('div.flex.flex-row.items-center') ||
      post.querySelector('[slot="flatlist"]') ||
      post.querySelector('.flat-list') ||
      null
    );
  }

  function removeButtonFromPost(post) {
    const btn = post.querySelector('.r2ai-inline-btn');
    if (btn) btn.remove();
    const actionRow = findActionRow(post);
    if (actionRow) {
      actionRow.removeAttribute('data-r2ai-injected');
    }
  }

  function createButtonElement() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'r2ai-inline-btn';
    const tooltip = (typeof t === 'function' ? t('reddit_btn_tooltip') : '') || 'Summarize thread with AI';
    const label = (typeof t === 'function' ? t('reddit_btn_label') : '') || 'AI';
    btn.title = tooltip;
    btn.setAttribute('aria-label', tooltip);

    const svg = (typeof document.createElementNS === 'function')
      ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      : document.createElement('svg');
    svg.setAttribute('class', 'r2ai-sparkle-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');

    const path = (typeof document.createElementNS === 'function')
      ? document.createElementNS('http://www.w3.org/2000/svg', 'path')
      : document.createElement('path');
    path.setAttribute('d', 'M8 1L9.5 5.5L14 7L9.5 8.5L8 13L6.5 8.5L2 7L6.5 5.5Z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    btn.appendChild(svg);

    const labelEl = document.createElement('span');
    labelEl.className = 'r2ai-btn-text';
    labelEl.textContent = label;
    btn.appendChild(labelEl);

    const spinnerEl = document.createElement('span');
    spinnerEl.className = 'r2ai-btn-spinner';
    spinnerEl.setAttribute('aria-hidden', 'true');
    btn.appendChild(spinnerEl);

    return btn;
  }

  function handleButtonClick(e, button, post, isMainPost) {
    e.preventDefault();
    e.stopPropagation();

    if (button.classList.contains('is-loading')) return;
    button.classList.add('is-loading');

    const timeoutId = setTimeout(() => {
      button.classList.remove('is-loading');
    }, 30000);

    const resetLoading = () => {
      clearTimeout(timeoutId);
      button.classList.remove('is-loading');
    };

    const permalink =
      post.getAttribute('permalink') ||
      post.getAttribute('content-href') ||
      post.querySelector('a[data-testid="post-title"], a[slot="full-post-link"], a[data-click-id="body"]')?.getAttribute('href') ||
      '';

    let message;
    if (isMainPost || !permalink) {
      message = { action: 'scrapeReddit' };
    } else {
      const threadUrl = permalink.startsWith('http')
        ? permalink
        : `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
      message = { action: 'scrapeReddit', threadUrl };
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime?.lastError) {
          console.warn('Reddit to AI: Button send failed:', chrome.runtime.lastError.message);
          resetLoading();
          return;
        }
        if (response && response.status === 'error') {
          resetLoading();
        }
      });
    } catch (err) {
      console.warn('Reddit to AI: Error sending scrape message:', err);
      resetLoading();
    }
  }

  function injectButtonIntoPost(post, isMainPost) {
    const actionRow = findActionRow(post);
    if (!actionRow) return;

    if (actionRow.getAttribute('data-r2ai-injected') === 'true' || actionRow.querySelector('.r2ai-inline-btn')) {
      return;
    }

    actionRow.setAttribute('data-r2ai-injected', 'true');
    const button = createButtonElement();
    button.addEventListener('click', (e) => handleButtonClick(e, button, post, isMainPost));
    actionRow.appendChild(button);
  }

  function processPosts() {
    if (!settings.showRedditInlineButton) {
      document.querySelectorAll('.r2ai-inline-btn').forEach((btn) => btn.remove());
      document.querySelectorAll('[data-r2ai-injected="true"]').forEach((el) => el.removeAttribute('data-r2ai-injected'));
      return;
    }

    const isPostView = window.location.pathname.includes('/comments/');
    const posts = document.querySelectorAll('shreddit-post, div[data-testid="post-container"], .Post');

    posts.forEach((post) => {
      const rawPermalink =
        post.getAttribute('permalink') ||
        post.getAttribute('content-href') ||
        post.querySelector('a[data-testid="post-title"], a[slot="full-post-link"]')?.getAttribute('href') ||
        '';

      const cleanPermalink = rawPermalink.replace(/^https?:\/\/[^\/]+/, '').split('?')[0];

      const isMainPost =
        isPostView &&
        ((cleanPermalink && window.location.pathname.includes(cleanPermalink)) ||
          post === posts[0] ||
          post.getAttribute('view-type') === 'comments');

      if (isMainPost && !settings.showRedditButtonInPost) {
        removeButtonFromPost(post);
        return;
      }
      if (!isMainPost && !settings.showRedditButtonInFeed) {
        removeButtonFromPost(post);
        return;
      }

      injectButtonIntoPost(post, isMainPost);
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request?.action === 'updateFloatingPanel') {
        const data = request.data;
        const finished = data && (!data.isActive || !!data.error || data.status === 'complete' || data.phase === 'complete');
        if (finished) {
          document.querySelectorAll('.r2ai-inline-btn.is-loading').forEach((btn) => {
            btn.classList.remove('is-loading');
          });
        }
      }
    });
  }

  let debounceTimer = null;
  function scheduleProcess() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processPosts, 100);
  }

  if (typeof MutationObserver !== 'undefined' && document.body) {
    const observer = new MutationObserver(() => {
      scheduleProcess();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  loadSettings();
})();
