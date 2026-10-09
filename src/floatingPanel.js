// Reddit to AI - Floating Panel Script
(async function () {
    console.log('Reddit to AI: Floating panel script loading...');

    if (typeof window.initI18n === 'function') {
        try {
            await window.initI18n();
        } catch (e) {
            console.warn('Reddit to AI: Failed to init i18n for panel:', e);
        }
    }

    if (window.__redditToAiPanelInjected) {
        console.log('Reddit to AI: Panel already injected, skipping.');
        return;
    }
    window.__redditToAiPanelInjected = true;

    // Localized string with an English fallback. Content scripts may run before (or
    // without) i18n.js, so fall back to chrome.i18n and finally to the literal.
    function tr(key, fallback, subs = []) {
        let message = '';
        try {
            if (typeof window.t === 'function') message = window.t(key, subs);
            else message = chrome.i18n.getMessage(key, subs);
        } catch {
            message = '';
        }
        if (message) return message;
        return subs.reduce((text, sub, i) => text.split(`$${i + 1}`).join(String(sub)), fallback);
    }

    function esc(text) {
        return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    const PHASE_LABELS = {
        fetch: tr('panel_phase_fetch', 'Fetch'),
        parse: tr('panel_phase_parse', 'Read'),
        load: tr('panel_phase_load', 'Comments'),
        filter: tr('panel_phase_filter', 'Prepare')
    };

    const phaseHTML = (phase) => `
      <div class="rs-phase pending" data-phase="${phase}">
        <div class="rs-phase-node" aria-hidden="true"><div class="rs-phase-pulse"></div></div>
        <span class="rs-phase-label">${esc(PHASE_LABELS[phase])}</span>
      </div>`;

    const panelHTML = `
<div id="redditSummarizerPanel" role="region" aria-label="${esc(tr('panel_region_label', 'Reddit to AI progress'))}" data-view="running" hidden>
  <div class="rs-header" id="rsHeader">
    <div class="rs-title-group">
      <div class="rs-live-dot" id="rsLiveDot" aria-hidden="true"></div>
      <span class="rs-title">${esc(tr('panel_title', 'Reddit to AI'))}</span>
    </div>
    <button type="button" id="rsCloseBtn" class="rs-close-btn" aria-label="${esc(tr('panel_close_label', 'Close panel'))}" title="${esc(tr('panel_close_label', 'Close panel'))}">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="rs-content">

    <!-- Running view: phase track + progress -->
    <div class="rs-view rs-running-view">
      <div class="rs-phase-track" id="rsPhaseTrack" aria-hidden="true">
        ${phaseHTML('fetch')}
        <div class="rs-connector" id="rsConn1"></div>
        ${phaseHTML('parse')}
        <div class="rs-connector" id="rsConn2"></div>
        ${phaseHTML('load')}
        <div class="rs-connector" id="rsConn3"></div>
        ${phaseHTML('filter')}
      </div>

      <div class="rs-progress-area" id="rsProgressArea">
        <div class="rs-progress-top">
          <span class="rs-pct" id="rsPercentage" aria-hidden="true">0%</span>
          <span class="rs-context-badge" id="rsContextBadge" hidden></span>
        </div>
        <div class="rs-progress-track" id="rsProgressTrack" role="progressbar" aria-label="${esc(tr('panel_progress_label', 'Scrape progress'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-state="running">
          <div class="rs-progress-fill" id="rsProgressBar"></div>
        </div>
      </div>

      <p id="rsUserGuidance" class="rs-guidance" hidden></p>
    </div>

    <!-- Success view -->
    <div class="rs-view rs-success-view">
      <div class="rs-result-icon rs-success-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M4 9.5l3.2 3.2L14 5.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="rs-result-text">
        <p class="rs-result-title" id="rsSuccessTitle"></p>
        <p class="rs-result-detail" id="rsSuccessDetail"></p>
      </div>
    </div>

    <!-- Error view -->
    <div class="rs-view rs-error-view" id="rsErrorView" role="alert">
      <div class="rs-error-body">
        <div class="rs-result-icon rs-error-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="9" cy="13" r="1.1" fill="currentColor"/>
          </svg>
        </div>
        <div class="rs-result-text">
          <p class="rs-result-title" id="rsErrorTitle"></p>
          <p class="rs-result-detail" id="rsErrorDetail"></p>
        </div>
      </div>
      <div class="rs-actions">
        <button type="button" class="rs-btn rs-btn-primary" id="rsRetryBtn">${esc(tr('panel_btn_retry', 'Retry'))}</button>
        <button type="button" class="rs-btn rs-btn-ghost" id="rsDismissBtn">${esc(tr('panel_btn_dismiss', 'Dismiss'))}</button>
        <button type="button" class="rs-link-btn" id="rsSettingsBtn" hidden>${esc(tr('panel_btn_settings', 'Open settings'))}</button>
      </div>
    </div>

    <!-- Live status line (visible while running, screen-reader only otherwise) -->
    <p id="rsStatusMessage" class="rs-status-msg" role="status" aria-live="polite" aria-atomic="true"></p>
  </div>
</div>
`;

    const host = document.createElement('div');
    host.id = 'reddit-to-ai-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('floatingPanel.css');
    shadow.appendChild(link);

    const template = document.createElement('template');
    template.innerHTML = panelHTML;
    shadow.appendChild(template.content.cloneNode(true));

    // ── Element references ────────────────────────────
    const panel = shadow.getElementById('redditSummarizerPanel');
    const closeBtn = shadow.getElementById('rsCloseBtn');
    const statusMessage = shadow.getElementById('rsStatusMessage');
    const progressTrack = shadow.getElementById('rsProgressTrack');
    const progressBar = shadow.getElementById('rsProgressBar');
    const userGuidance = shadow.getElementById('rsUserGuidance');
    const header = shadow.getElementById('rsHeader');
    const liveDot = shadow.getElementById('rsLiveDot');
    const pctEl = shadow.getElementById('rsPercentage');
    const badgeEl = shadow.getElementById('rsContextBadge');
    const successTitle = shadow.getElementById('rsSuccessTitle');
    const successDetail = shadow.getElementById('rsSuccessDetail');
    const errorTitle = shadow.getElementById('rsErrorTitle');
    const errorDetail = shadow.getElementById('rsErrorDetail');
    const retryBtn = shadow.getElementById('rsRetryBtn');
    const dismissBtn = shadow.getElementById('rsDismissBtn');
    const settingsBtn = shadow.getElementById('rsSettingsBtn');

    // ── Phase helpers ──────────────────────────────────
    const PHASES = ['fetch', 'parse', 'load', 'filter'];
    let committedPhaseIndex = 0; // monotonic — never goes backward

    // The service worker's phase vocabulary is richer than this four-step track,
    // so several backend phases collapse onto the same visual node.
    const PHASE_TO_TRACK = {
        idle: 'fetch',
        prepare: 'fetch',
        fetch: 'fetch',
        parse: 'parse',
        load: 'load',
        expand: 'load',
        media: 'load',
        filter: 'filter',
        build: 'filter',
        complete: 'filter'
    };

    function resolvePhase(data) {
        const mapped = PHASE_TO_TRACK[data?.phase];
        if (mapped) return mapped;
        // Last-resort fallback for progress messages emitted by an older content
        // script that predates the structured `phase` field.
        return detectPhaseFromMessage(data?.message);
    }

    function detectPhaseFromMessage(message) {
        if (!message) return 'fetch';
        const msg = message.toLowerCase();
        // Order matters: more specific → less specific
        if (msg.includes('applying') || msg.startsWith('complete')) return 'filter';
        if (msg.includes('loading') || msg.includes('batch')) return 'load';
        if (msg.includes('found') && msg.includes('more')) return 'load';
        if (msg.includes('pars') || msg.includes('initial')) return 'parse';
        return 'fetch';
    }

    function resolveBatchInfo(data) {
        const batch = data?.batch;
        if (batch && Number.isFinite(batch.current) && Number.isFinite(batch.total)) {
            return { type: 'batch', current: batch.current, total: batch.total };
        }
        // The expand phase reports how many comments it has seen so far rather
        // than an x-of-y counter.
        if (batch && Number.isFinite(batch.count)) {
            return { type: 'count', count: batch.count.toLocaleString() };
        }
        // Structured state is authoritative: once a phase is present, an absent
        // `batch` means "no counter", not "go read the message".
        if (data?.phase) return null;
        return extractBatchInfoFromMessage(data?.message);
    }

    function extractBatchInfoFromMessage(message) {
        const batchMatch = message?.match(/batch\s+(\d+)\s*[/\\]\s*(\d+)/i);
        if (batchMatch) {
            return { type: 'batch', current: parseInt(batchMatch[1]), total: parseInt(batchMatch[2]) };
        }
        const foundMatch = message?.match(/found\s+([\d,]+)\s+comment/i);
        if (foundMatch) {
            return { type: 'count', count: foundMatch[1] };
        }
        return null;
    }

    function setPhaseClasses(activeIndex, allDone = false) {
        PHASES.forEach((phase, i) => {
            const el = panel?.querySelector(`[data-phase="${phase}"]`);
            if (!el) return;
            el.classList.remove('active', 'completed', 'pending');
            if (allDone || i < activeIndex) el.classList.add('completed');
            else if (i === activeIndex) el.classList.add('active');
            else el.classList.add('pending');
        });
        for (let i = 1; i <= 3; i++) {
            const conn = shadow.getElementById(`rsConn${i}`);
            if (conn) conn.classList.toggle('filled', allDone || i <= activeIndex);
        }
    }

    function updatePhaseUI(phaseName) {
        const newIndex = PHASES.indexOf(phaseName);
        if (newIndex < 0) return;
        // Monotonic: only advance forward, never regress
        if (newIndex > committedPhaseIndex) {
            committedPhaseIndex = newIndex;
        }
        setPhaseClasses(committedPhaseIndex);
    }

    function completeAllPhases() {
        committedPhaseIndex = PHASES.length - 1;
        setPhaseClasses(committedPhaseIndex, true);
    }

    function resetPhases() {
        committedPhaseIndex = 0;
        PHASES.forEach(phase => {
            const el = panel?.querySelector(`[data-phase="${phase}"]`);
            if (el) {
                el.classList.remove('active', 'completed');
                el.classList.add('pending');
            }
        });
        for (let i = 1; i <= 3; i++) {
            shadow.getElementById(`rsConn${i}`)?.classList.remove('filled');
        }
    }

    function setProgress(pct, state) {
        const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
        if (progressBar) progressBar.style.setProperty('--p', String(clamped / 100));
        if (progressTrack) {
            progressTrack.setAttribute('aria-valuenow', String(Math.round(clamped)));
            progressTrack.dataset.state = state;
        }
    }

    // ── Visibility (enter / exit animations) ──────────
    let view = 'running';
    let leaveTimer = null;
    let successTimer = null;
    let userDismissed = false;
    let localRetry = null;

    function isShown() {
        return panel && !panel.hidden && !panel.classList.contains('rs-leaving');
    }

    function setView(next) {
        view = next;
        panel.dataset.view = next;
        if (liveDot) {
            liveDot.classList.toggle('active', next === 'running');
            liveDot.classList.toggle('error', next === 'error');
            liveDot.classList.toggle('done', next === 'success');
        }
    }

    function showPanel() {
        if (!panel) return;
        clearTimeout(leaveTimer);
        leaveTimer = null;
        panel.classList.remove('rs-leaving');
        panel.hidden = false;
    }

    function hidePanel() {
        if (!panel || panel.hidden || panel.classList.contains('rs-leaving')) return;
        clearTimeout(successTimer);
        panel.classList.add('rs-leaving');
        const finish = () => {
            clearTimeout(leaveTimer);
            leaveTimer = null;
            if (!panel.classList.contains('rs-leaving')) return;
            panel.classList.remove('rs-leaving');
            panel.hidden = true;
        };
        panel.addEventListener('animationend', function onEnd(e) {
            if (e.target !== panel) return;
            panel.removeEventListener('animationend', onEnd);
            finish();
        });
        // Fallback in case animationend never fires (e.g. the tab is in the background).
        leaveTimer = setTimeout(finish, 500);
    }

    // ── Close / error actions ──────────────────────────
    closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (view === 'running') userDismissed = true;
        hidePanel();
    });

    dismissBtn?.addEventListener('click', () => hidePanel());

    settingsBtn?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Reddit to AI: Could not open settings:', chrome.runtime.lastError.message);
            }
        });
    });

    retryBtn?.addEventListener('click', () => {
        if (retryBtn.disabled) return;
        retryBtn.disabled = true;
        retryBtn.textContent = tr('panel_retrying', 'Retrying…');
        const retry = localRetry;
        localRetry = null;
        resetPhases();
        renderRunning({ isActive: true, percentage: 5, phase: 'prepare', message: tr('panel_retrying', 'Retrying…') });

        if (typeof retry === 'function') {
            try { retry(); } catch (err) { showError(err?.message || String(err)); }
            return;
        }
        try {
            chrome.runtime.sendMessage({ action: 'retryLastScrape' }, (response) => {
                if (chrome.runtime.lastError) {
                    showError(tr('panel_error_unreachable', 'The extension could not be reached. Reload the page and try again.'), { errorType: 'generic' });
                    return;
                }
                if (response?.status === 'error') {
                    showError(response.error, { errorType: response.errorType });
                }
            });
        } catch (err) {
            showError(err?.message || String(err), { errorType: 'generic' });
        }
    });

    // ── Draggable (pointer events: mouse, touch and pen) ──
    if (header && panel) {
        let dragPointer = null;
        let offsetX = 0, offsetY = 0;

        header.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.target.closest?.('button')) return;
            const rect = panel.getBoundingClientRect();
            dragPointer = e.pointerId;
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            header.setPointerCapture?.(e.pointerId);
            panel.classList.add('rs-dragging');
            e.preventDefault();
        });

        header.addEventListener('pointermove', (e) => {
            if (dragPointer !== e.pointerId) return;
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            const x = Math.max(0, Math.min(maxX, e.clientX - offsetX));
            const y = Math.max(0, Math.min(maxY, e.clientY - offsetY));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
            panel.style.right = 'auto';
        });

        const endDrag = (e) => {
            if (dragPointer !== e.pointerId) return;
            dragPointer = null;
            header.releasePointerCapture?.(e.pointerId);
            panel.classList.remove('rs-dragging');
        };
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);
    }

    // ── Renderers ──────────────────────────────────────
    function renderRunning(data) {
        clearTimeout(successTimer);
        if (view !== 'running') resetPhases();
        setView('running');
        retryBtn.disabled = false;
        retryBtn.textContent = tr('panel_btn_retry', 'Retry');

        const pct = data.percentage ?? 0;
        // Reset on new scrape (percentage near start)
        if (pct <= 5 && committedPhaseIndex > 0) resetPhases();
        updatePhaseUI(resolvePhase(data));

        if (pctEl) pctEl.textContent = `${Math.round(Math.max(0, pct))}%`;
        setProgress(pct, 'running');

        const info = resolveBatchInfo(data);
        if (badgeEl) {
            if (info?.type === 'batch') {
                badgeEl.textContent = tr('panel_badge_batch', 'Batch $1 of $2', [String(info.current), String(info.total)]);
                badgeEl.hidden = false;
            } else if (info?.type === 'count') {
                badgeEl.textContent = tr('panel_badge_comments', '$1 comments', [String(info.count)]);
                badgeEl.hidden = false;
            } else {
                badgeEl.hidden = true;
            }
        }

        if (statusMessage) statusMessage.textContent = data.message || '';
        if (userGuidance) {
            userGuidance.textContent = tr('panel_guidance', 'Scraping in progress. Please keep this tab open.');
            userGuidance.hidden = false;
        }
    }

    function renderSuccess(data) {
        setView('success');
        completeAllPhases();
        setProgress(100, 'done');
        if (pctEl) pctEl.textContent = '100%';
        if (badgeEl) badgeEl.hidden = true;
        if (userGuidance) userGuidance.hidden = true;

        const direct = data.delivery
            ? data.delivery === 'direct'
            : /sent/i.test(data.message || '');
        const title = direct
            ? tr('panel_done_sent', 'Sent to $1', [data.aiName || tr('panel_ai_generic', 'your AI')])
            : tr('panel_done_preview', 'Ready in preview');
        const detail = direct
            ? tr('panel_done_sent_hint', 'The AI tab has your thread. Check it for the answer.')
            : tr('panel_done_preview_hint', 'Review the prompt in the new tab, then send it.');
        if (successTitle) successTitle.textContent = title;
        if (successDetail) successDetail.textContent = detail;
        if (statusMessage) statusMessage.textContent = title;

        clearTimeout(successTimer);
        successTimer = setTimeout(hidePanel, 2600);
    }

    function errorTitleFor(type) {
        switch (type) {
            case 'config': return tr('panel_error_config_title', 'Setup needed');
            case 'not_reddit': return tr('panel_error_not_reddit_title', 'Open a Reddit thread first');
            case 'busy': return tr('panel_error_busy_title', 'Already working on a thread');
            case 'network': return tr('panel_error_network_title', 'Connection problem');
            case 'stopped': return tr('panel_error_stopped_title', 'Scrape stopped');
            default: return tr('panel_error_title', 'Something went wrong');
        }
    }

    function cleanErrorMessage(message) {
        return String(message || '').replace(/^Error:\s*/i, '').replace(/^Content script error:\s*/i, '').trim();
    }

    function showError(message, { errorType, onRetry } = {}) {
        if (!panel) return;
        clearTimeout(successTimer);
        localRetry = typeof onRetry === 'function' ? onRetry : null;
        const type = errorType || 'generic';
        setView('error');
        resetPhases();
        setProgress(0, 'error');
        if (badgeEl) badgeEl.hidden = true;
        if (userGuidance) userGuidance.hidden = true;
        if (statusMessage) statusMessage.textContent = '';

        if (errorTitle) errorTitle.textContent = errorTitleFor(type);
        if (errorDetail) {
            const detail = cleanErrorMessage(message);
            errorDetail.textContent = detail || tr('panel_error_unknown', 'An unexpected error occurred.');
        }
        retryBtn.disabled = false;
        retryBtn.textContent = tr('panel_btn_retry', 'Retry');
        retryBtn.hidden = type === 'busy';
        settingsBtn.hidden = type !== 'config';
        userDismissed = false;
        showPanel();
    }

    // ── Update UI ──────────────────────────────────────
    function updatePanel(data, { initial = false } = {}) {
        if (!panel || !data) return;

        if (data.error && !data.isActive) {
            // A one-off error pushed for another entry point must not replace the
            // progress of a scrape that is still running in this panel.
            if (data.transient && view === 'running' && isShown()) return;
            // A stale error from an earlier page should not pop up on navigation.
            if (initial) return;
            showError(data.error, { errorType: data.errorType });
            return;
        }

        if (data.isActive) {
            const isNewScrape = view !== 'running' || data.phase === 'prepare';
            if (isNewScrape && (data.percentage ?? 0) <= 5) userDismissed = false;
            renderRunning(data);
            if (!userDismissed) showPanel();
            return;
        }

        // Finished. `status`/`phase` are authoritative; the message check only covers
        // states produced before those fields existed.
        const finished = data.status
            ? data.status === 'complete'
            : (data.phase === 'complete' || data.message?.includes('sent'));
        if (finished && !initial && view === 'running' && isShown()) {
            renderSuccess(data);
        } else if (view === 'running' && isShown() && !initial) {
            // Went idle without completing (e.g. reset): just leave quietly.
            hidePanel();
        }
    }

    // Lets the inline Reddit button (same content-script world) surface failures
    // that never reached the service worker.
    window.__redditToAiPanel = {
        showError(message, options = {}) {
            if (options.errorType === 'busy' && view === 'running' && isShown()) return;
            showError(message, options);
        }
    };

    // ── Message listener ───────────────────────────────
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'updateFloatingPanel') {
            updatePanel(request.data);
        }
        return true;
    });

    // ── Initial state ──────────────────────────────────
    chrome.runtime.sendMessage({ action: 'getScrapingState' }, (state) => {
        if (chrome.runtime.lastError) {
            console.error('Reddit to AI: Error getting state:', chrome.runtime.lastError.message);
            return;
        }
        if (state) updatePanel(state, { initial: true });
    });

    console.log('Reddit to AI: Floating panel initialized.');
})();
