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
    showRedditButtonInFeed: false,
    showRedditButtonInPost: true
  };

  function loadSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
      processPosts();
      return;
    }
    chrome.storage.sync.get(['showRedditInlineButton', 'showRedditButtonInFeed', 'showRedditButtonInPost'], (loaded) => {
      if (chrome.runtime?.lastError) {
        console.warn('Reddit to AI: Error loading inline button settings:', chrome.runtime.lastError.message);
      } else if (loaded) {
        if (typeof loaded.showRedditInlineButton === 'boolean') {
          settings.showRedditInlineButton = loaded.showRedditInlineButton;
        }
        if (typeof loaded.showRedditButtonInFeed === 'boolean') {
          settings.showRedditButtonInFeed = loaded.showRedditButtonInFeed;
        }
        if (typeof loaded.showRedditButtonInPost === 'boolean') {
          settings.showRedditButtonInPost = loaded.showRedditButtonInPost;
        }
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
        settings.showRedditButtonInFeed = changes.showRedditButtonInFeed.newValue === true;
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

  function findShareButton(post) {
    return (
      post.querySelector('shreddit-post-share-button') ||
      post.querySelector('shreddit-async-loader[bundlename*="share"]') ||
      post.querySelector('[slot="share-button"]') ||
      post.querySelector('button[aria-label*="Share" i]') ||
      post.querySelector('button[title*="Share" i]') ||
      post.querySelector('button[data-click-id="share"]') ||
      post.querySelector('share-button') ||
      post.querySelector('div[slot="credit-bar"] shreddit-post-share-button') ||
      post.querySelector('div[slot="action-row"] shreddit-post-share-button') ||
      post.querySelector('shreddit-post-action-row shreddit-post-share-button') ||
      post.querySelector('div[slot="credit-bar"] button:last-of-type') ||
      post.shadowRoot?.querySelector('shreddit-post-share-button, button[aria-label*="Share" i]') ||
      null
    );
  }

  function findBottomActionRow(post) {
    return (
      post.querySelector('shreddit-post-action-row') ||
      post.querySelector('div[slot="credit-bar"]') ||
      post.querySelector('div[slot="action-row"]') ||
      post.querySelector('[slot="flatlist"]') ||
      post.querySelector('.flat-list') ||
      post.querySelector('[data-testid="post-action-bar"]') ||
      post.querySelector('div.feed-card-actions') ||
      post.shadowRoot?.querySelector('shreddit-post-action-row, div[slot="credit-bar"], div[slot="action-row"]') ||
      null
    );
  }

  function removeButtonFromPost(post) {
    const btn = post.querySelector('.r2ai-inline-btn');
    if (btn) {
      if (btn.parentElement) {
        btn.parentElement.removeAttribute('data-r2ai-injected');
      }
      btn.remove();
    }
    post.querySelectorAll('[data-r2ai-injected="true"]').forEach((el) => {
      if (!el.querySelector('.r2ai-inline-btn')) {
        el.removeAttribute('data-r2ai-injected');
      }
    });
  }

  // Localized string with an English fallback (getMessage returns '' for unknown keys).
  function tr(key, fallback) {
    let message = '';
    try {
      if (typeof window !== 'undefined' && typeof window.t === 'function') message = window.t(key);
      if (!message && typeof chrome !== 'undefined' && chrome.i18n?.getMessage) message = chrome.i18n.getMessage(key);
    } catch {
      message = '';
    }
    // A missing key echoes back from some shims; treat that as missing too.
    return message && message !== key ? message : fallback;
  }

  function createIcon(className, d, mode) {
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag) => (typeof document.createElementNS === 'function'
      ? document.createElementNS(ns, tag)
      : document.createElement(tag));
    const svg = make('svg');
    svg.setAttribute('class', `r2ai-icon ${className}`);
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.flexShrink = '0';
    svg.style.verticalAlign = 'middle';
    svg.style.pointerEvents = 'none';
    const path = make('path');
    path.setAttribute('d', d);
    if (mode === 'fill') {
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(path);
    return svg;
  }

  // ── Button state machine: idle → loading → success | error → idle ──
  const SUCCESS_MS = 1500;
  const ERROR_MS = 8000;
  const WATCHDOG_MS = 30000;
  const buttonTimers = new WeakMap();

  function getTimers(button) {
    let timers = buttonTimers.get(button);
    if (!timers) {
      timers = { revert: null, watchdog: null };
      buttonTimers.set(button, timers);
    }
    return timers;
  }

  function clearButtonTimers(button) {
    const timers = getTimers(button);
    clearTimeout(timers.revert);
    clearTimeout(timers.watchdog);
    timers.revert = null;
    timers.watchdog = null;
  }

  function setButtonState(button, state, detail) {
    const label = button.querySelector('.r2ai-btn-text');
    const spinner = button.querySelector('.r2ai-btn-spinner');
    const icon = button.querySelector('.r2ai-sparkle-icon');
    const idleLabel = tr('inline_btn_label', 'Summarize with AI');
    const idleTitle = tr('reddit_btn_tooltip', 'Summarize thread with AI');

    button.classList.remove('is-loading', 'is-success', 'is-error');
    button.setAttribute('data-state', state);
    if (spinner) spinner.style.display = state === 'loading' ? 'inline-block' : '';
    if (icon) icon.style.display = state === 'loading' ? 'none' : '';

    let text = idleLabel;
    let title = idleTitle;
    if (state === 'loading') {
      button.classList.add('is-loading');
      button.setAttribute('aria-busy', 'true');
      title = tr('inline_btn_working', 'Summarizing…');
    } else {
      button.removeAttribute('aria-busy');
    }
    if (state === 'success') {
      button.classList.add('is-success');
      text = tr('inline_btn_done', 'Done');
      title = text;
    } else if (state === 'error') {
      button.classList.add('is-error');
      text = tr('inline_btn_failed', 'Failed — retry');
      title = detail ? `${text}: ${detail}` : tr('inline_btn_failed_title', 'Couldn’t start. Click to try again.');
    }
    if (label && state !== 'loading') label.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', state === 'idle' ? idleTitle : title);
  }

  function setButtonIdle(button) {
    clearButtonTimers(button);
    setButtonState(button, 'idle');
  }

  function setButtonSuccess(button) {
    clearButtonTimers(button);
    setButtonState(button, 'success');
    getTimers(button).revert = setTimeout(() => setButtonState(button, 'idle'), SUCCESS_MS);
  }

  function setButtonError(button, detail, { errorType, retry } = {}) {
    clearButtonTimers(button);
    setButtonState(button, 'error', detail);
    getTimers(button).revert = setTimeout(() => setButtonState(button, 'idle'), ERROR_MS);
    // Also surface it in the floating panel (same content-script world) so a
    // failure is never only a console warning.
    try {
      window.__redditToAiPanel?.showError(detail || tr('inline_btn_failed_title', 'Couldn’t start. Click to try again.'), {
        errorType: errorType || 'generic',
        onRetry: retry
      });
    } catch (err) {
      console.warn('Reddit to AI: Could not show the error in the panel:', err);
    }
  }

  function createButtonElement(isMainPost = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `r2ai-inline-btn ${isMainPost ? 'r2ai-in-post' : 'r2ai-in-feed'}`;
    // Fallback baseline inline styles to prevent unstyled flash or host CSS reset overrides
    btn.style.position = 'relative';
    btn.style.zIndex = '10';
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';
    btn.style.borderRadius = '9999px';
    btn.style.border = 'none';
    btn.style.height = 'auto';
    btn.style.minHeight = '32px';
    btn.style.maxHeight = '32px';
    btn.style.padding = '8px 12px';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.verticalAlign = 'baseline';
    btn.style.background = 'rgba(120, 120, 128, 0.15)';
    btn.style.color = 'inherit';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '600';
    btn.style.fontFamily = 'inherit';
    btn.style.lineHeight = '16px';
    btn.style.boxSizing = 'border-box';
    btn.style.margin = isMainPost ? '0 0 0 8px' : '0 0 0 4px';
    btn.style.gap = '4px';
    btn.style.userSelect = 'none';

    const tooltip = tr('reddit_btn_tooltip', 'Summarize thread with AI');
    const label = tr('inline_btn_label', 'Summarize with AI');
    btn.title = tooltip;
    // The visible label is hidden below 640px, so the accessible name always comes
    // from aria-label (kept in sync with the button state).
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('data-state', 'idle');

    btn.appendChild(createIcon('r2ai-sparkle-icon', 'M8 1L9.5 5.5L14 7L9.5 8.5L8 13L6.5 8.5L2 7L6.5 5.5Z', 'fill'));
    btn.appendChild(createIcon('r2ai-check-icon', 'M3.5 8.5L6.5 11.5L12.5 4.5', 'stroke'));
    btn.appendChild(createIcon('r2ai-alert-icon', 'M8 4V9M8 11.5V12', 'stroke'));

    const labelEl = document.createElement('span');
    labelEl.className = 'r2ai-btn-text';
    labelEl.textContent = label;
    labelEl.style.fontSize = '12px';
    labelEl.style.fontWeight = '600';
    labelEl.style.lineHeight = '16px';
    labelEl.style.pointerEvents = 'none';
    btn.appendChild(labelEl);

    const spinnerEl = document.createElement('span');
    spinnerEl.className = 'r2ai-btn-spinner';
    spinnerEl.setAttribute('aria-hidden', 'true');
    spinnerEl.style.pointerEvents = 'none';
    btn.appendChild(spinnerEl);

    return btn;
  }

  function handleButtonClick(e, button, post, isMainPost) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    if (button.classList.contains('is-loading')) return;
    clearButtonTimers(button);
    setButtonState(button, 'loading');

    const retry = () => handleButtonClick(
      { preventDefault() {}, stopPropagation() {} },
      button,
      post,
      isMainPost
    );
    const fail = (detail, errorType) => setButtonError(button, detail, { errorType, retry });

    // Watchdog: if no terminal state arrives in time, ask the service worker where
    // the scrape is instead of silently resetting. Long scrapes simply re-arm it.
    const armWatchdog = () => {
      getTimers(button).watchdog = setTimeout(() => {
        if (!button.classList.contains('is-loading')) return;
        try {
          chrome.runtime.sendMessage({ action: 'getScrapingState' }, (state) => {
            if (!button.classList.contains('is-loading')) return;
            if (chrome.runtime?.lastError || !state) {
              fail(tr('inline_error_no_response', 'The extension did not respond. Reload the page and try again.'), 'generic');
            } else if (state.isActive) {
              armWatchdog();
            } else if (state.status === 'complete') {
              setButtonSuccess(button);
            } else if (state.error) {
              fail(state.error, state.errorType);
            } else {
              fail(tr('inline_error_no_response', 'The extension did not respond. Reload the page and try again.'), 'generic');
            }
          });
        } catch (err) {
          fail(err?.message || String(err), 'generic');
        }
      }, WATCHDOG_MS);
    };
    armWatchdog();

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
          fail(tr('inline_error_no_response', 'The extension did not respond. Reload the page and try again.'), 'generic');
          return;
        }
        if (response && response.status === 'error') {
          fail(response.error, response.errorType);
        }
      });
    } catch (err) {
      console.warn('Reddit to AI: Error sending scrape message:', err);
      fail(tr('inline_error_no_response', 'The extension did not respond. Reload the page and try again.'), 'generic');
    }
  }

  function attachButtonListeners(button, post, isMainPost) {
    button.addEventListener('click', (e) => handleButtonClick(e, button, post, isMainPost));
    button.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    });
    button.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    });
  }

  function injectButtonIntoPost(post, isMainPost) {
    if (post.querySelector('.r2ai-inline-btn')) return;

    const actionRow = findBottomActionRow(post);

    // 1. Preferred anchor: immediately after the Share button's top-level container in the bottom action bar
    const shareBtn = findShareButton(post);
    if (shareBtn) {
      const parentContainer = actionRow || shareBtn.closest('shreddit-post-action-row, [slot="credit-bar"], [slot="action-row"], div.flex') || shareBtn.parentElement;

      let topLevelAnchor = shareBtn;
      if (parentContainer && (typeof parentContainer.contains === 'function' ? parentContainer.contains(shareBtn) : true)) {
        while (topLevelAnchor.parentElement && topLevelAnchor.parentElement !== parentContainer) {
          topLevelAnchor = topLevelAnchor.parentElement;
        }
      }

      if (parentContainer?.getAttribute('data-r2ai-injected') === 'true' || parentContainer?.querySelector('.r2ai-inline-btn')) {
        return;
      }

      parentContainer?.setAttribute('data-r2ai-injected', 'true');
      const button = createButtonElement(isMainPost);
      attachButtonListeners(button, post, isMainPost);
      topLevelAnchor.insertAdjacentElement('afterend', button);
      return;
    }

    // 2. Fallback anchor: bottom action bar (never author/header row)
    if (!actionRow) return;
    if (actionRow.getAttribute('data-r2ai-injected') === 'true' || actionRow.querySelector('.r2ai-inline-btn')) {
      return;
    }

    actionRow.setAttribute('data-r2ai-injected', 'true');
    const button = createButtonElement(isMainPost);
    attachButtonListeners(button, post, isMainPost);
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
      if (request?.action === 'updateFloatingPanel' || request?.action === 'scrapingStateUpdate') {
        const data = request.data;
        // A transient error belongs to another entry point (shortcut / context menu),
        // not to the scrape this button started.
        const finished = data && !data.transient &&
          (!data.isActive || !!data.error || data.status === 'complete' || data.phase === 'complete');
        if (finished) {
          document.querySelectorAll('.r2ai-inline-btn.is-loading').forEach((btn) => {
            if (data.error) {
              // The panel already shows this error from the same state update.
              clearButtonTimers(btn);
              setButtonState(btn, 'error', data.error);
              getTimers(btn).revert = setTimeout(() => setButtonState(btn, 'idle'), ERROR_MS);
            } else if (data.status === 'complete' || data.phase === 'complete') {
              setButtonSuccess(btn);
            } else {
              setButtonIdle(btn);
            }
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
