// Reddit to AI - Floating Panel Script
(async function () {
    console.log('Reddit to AI: Floating panel script loading...');

    if (typeof initI18n === 'function') {
        await initI18n();
    }

    if (window.__redditToAiPanelInjected) {
        console.log('Reddit to AI: Panel already injected, skipping.');
    } else {
        window.__redditToAiPanelInjected = true;

        const panelHTML = `
<div id="redditSummarizerPanel" style="display: none;">
  <div class="rs-header">
    <div class="rs-title-group">
      <div class="rs-live-dot" id="rsLiveDot"></div>
      <span class="rs-title">${t('panel_title') || 'Reddit to AI'}</span>
    </div>
    <button id="rsCloseBtn" class="rs-close-btn" title="${t('close') || 'Close'}">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="rs-content">

    <!-- Phase track: Fetch → Parse → Load → Filter -->
    <div class="rs-phase-track" id="rsPhaseTrack">
      <div class="rs-phase pending" data-phase="fetch">
        <div class="rs-phase-node"><div class="rs-phase-pulse"></div></div>
        <span class="rs-phase-label">Fetch</span>
      </div>
      <div class="rs-connector" id="rsConn1"></div>
      <div class="rs-phase pending" data-phase="parse">
        <div class="rs-phase-node"><div class="rs-phase-pulse"></div></div>
        <span class="rs-phase-label">Parse</span>
      </div>
      <div class="rs-connector" id="rsConn2"></div>
      <div class="rs-phase pending" data-phase="load">
        <div class="rs-phase-node"><div class="rs-phase-pulse"></div></div>
        <span class="rs-phase-label">Load</span>
      </div>
      <div class="rs-connector" id="rsConn3"></div>
      <div class="rs-phase pending" data-phase="filter">
        <div class="rs-phase-node"><div class="rs-phase-pulse"></div></div>
        <span class="rs-phase-label">Filter</span>
      </div>
    </div>

    <!-- Progress: large percentage + context badge -->
    <div class="rs-progress-area" id="rsProgressArea" style="display:none">
      <div class="rs-progress-top">
        <span class="rs-pct" id="rsPercentage">0%</span>
        <span class="rs-context-badge" id="rsContextBadge" style="display:none"></span>
      </div>
      <div class="rs-progress-track">
        <div class="rs-progress-fill" id="rsProgressBar"></div>
      </div>
    </div>

    <!-- Status message -->
    <p id="rsStatusMessage" class="rs-status-msg"></p>

    <!-- Guidance -->
    <p id="rsUserGuidance" class="rs-guidance" style="display:none"></p>

    <!-- Summary (shown after completion) -->
    <div class="rs-summary-area" id="rsSummaryArea">
      <h4>Summary</h4>
      <div id="rsSummaryText"></div>
    </div>

  </div>
</div>
`;

        document.body.insertAdjacentHTML('beforeend', panelHTML);

        // ── Element references ────────────────────────────
        const panel = document.getElementById('redditSummarizerPanel');
        const closeBtn = document.getElementById('rsCloseBtn');
        const statusMessage = document.getElementById('rsStatusMessage');
        const progressArea = document.getElementById('rsProgressArea');
        const progressBar = document.getElementById('rsProgressBar');
        const userGuidance = document.getElementById('rsUserGuidance');
        const header = panel?.querySelector('.rs-header');
        const liveDot = document.getElementById('rsLiveDot');
        const pctEl = document.getElementById('rsPercentage');
        const badgeEl = document.getElementById('rsContextBadge');

        // ── Phase helpers ──────────────────────────────────
        const PHASES = ['fetch', 'parse', 'load', 'filter'];
        let committedPhaseIndex = 0; // monotonic — never goes backward

        function detectPhase(message) {
            if (!message) return 'fetch';
            const msg = message.toLowerCase();
            // Order matters: more specific → less specific
            if (msg.includes('applying') || msg.startsWith('complete')) return 'filter';
            if (msg.includes('loading') || msg.includes('batch')) return 'load';
            if (msg.includes('found') && msg.includes('more')) return 'load';
            if (msg.includes('pars') || msg.includes('initial')) return 'parse';
            return 'fetch';
        }

        function extractBatchInfo(message) {
            const batchMatch = message?.match(/batch\s+(\d+)\s*[\/\\]\s*(\d+)/i);
            if (batchMatch) {
                return { type: 'batch', current: parseInt(batchMatch[1]), total: parseInt(batchMatch[2]) };
            }
            const foundMatch = message?.match(/found\s+([\d,]+)\s+comment/i);
            if (foundMatch) {
                return { type: 'count', count: foundMatch[1] };
            }
            return null;
        }

        function updatePhaseUI(phaseName) {
            const newIndex = PHASES.indexOf(phaseName);
            if (newIndex < 0) return;

            // Monotonic: only advance forward, never regress
            if (newIndex > committedPhaseIndex) {
                committedPhaseIndex = newIndex;
            }

            PHASES.forEach((phase, i) => {
                const el = panel?.querySelector(`[data-phase="${phase}"]`);
                if (!el) return;
                el.classList.remove('active', 'completed', 'pending');
                if (i < committedPhaseIndex) el.classList.add('completed');
                else if (i === committedPhaseIndex) el.classList.add('active');
                else el.classList.add('pending');
            });

            for (let i = 1; i <= 3; i++) {
                const conn = document.getElementById(`rsConn${i}`);
                if (conn) conn.classList.toggle('filled', i <= committedPhaseIndex);
            }
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
                document.getElementById(`rsConn${i}`)?.classList.remove('filled');
            }
        }

        // ── Close button ───────────────────────────────────
        if (closeBtn && panel) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                panel.style.display = 'none';
            });
        }

        // ── Draggable ──────────────────────────────────────
        if (header && panel) {
            let isDragging = false;
            let offsetX = 0, offsetY = 0;

            header.addEventListener('mousedown', (e) => {
                if (e.target === closeBtn || closeBtn?.contains(e.target)) return;
                isDragging = true;
                offsetX = e.clientX - panel.offsetLeft;
                offsetY = e.clientY - panel.offsetTop;
                panel.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                panel.style.left = (e.clientX - offsetX) + 'px';
                panel.style.top = (e.clientY - offsetY) + 'px';
                panel.style.right = 'auto';
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    panel.style.userSelect = '';
                }
            });
        }

        // ── Update UI ──────────────────────────────────────
        function updatePanel(data) {
            if (!panel || !data) return;

            if (data.isActive || data.error) {
                panel.style.display = 'flex';
            }

            const isActive = data.isActive && !data.error;
            const pct = data.percentage ?? 0;
            const message = data.message || '';

            // Live dot
            if (liveDot) {
                liveDot.classList.toggle('active', isActive);
                liveDot.classList.toggle('error', !!data.error);
            }

            // Phase track
            if (isActive) {
                // Reset on new scrape (percentage near start)
                if ((data.percentage || 0) <= 5 && committedPhaseIndex > 0) {
                    resetPhases();
                }
                updatePhaseUI(detectPhase(message));
            } else if (data.error) {
                resetPhases();
            }

            // Progress area
            if (progressArea) {
                progressArea.style.display = isActive ? 'flex' : 'none';
            }

            if (isActive) {
                // Percentage
                if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;

                // Progress bar fill
                if (progressBar) {
                    progressBar.style.width = pct + '%';
                    progressBar.style.background = '';
                }

                // Context badge
                const info = extractBatchInfo(message);
                if (badgeEl) {
                    if (info?.type === 'batch') {
                        badgeEl.textContent = `BATCH ${info.current} / ${info.total}`;
                        badgeEl.style.display = 'inline-block';
                    } else if (info?.type === 'count') {
                        badgeEl.textContent = `${info.count} COMMENTS`;
                        badgeEl.style.display = 'inline-block';
                    } else {
                        badgeEl.style.display = 'none';
                    }
                }
            } else {
                if (progressBar && data.error) {
                    progressBar.style.background = '#ef4444';
                    progressArea.style.display = 'flex';
                    if (pctEl) pctEl.textContent = '—';
                }
            }

            // Status message
            if (statusMessage) {
                statusMessage.textContent = message;
                statusMessage.style.color = data.error ? '#ef4444' : '';
            }

            // Guidance
            if (userGuidance) {
                if (isActive) {
                    userGuidance.textContent = t('panel_guidance') || 'Scraping in progress. Please keep this tab open.';
                    userGuidance.style.display = 'block';
                } else {
                    userGuidance.style.display = 'none';
                }
            }

            // Auto-hide on completion
            if (!data.isActive && !data.error && message?.includes('sent')) {
                setTimeout(() => {
                    if (panel.style.display !== 'none') {
                        panel.style.display = 'none';
                    }
                }, 3000);
            }
        }

        // ── Message listener ───────────────────────────────
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
            if (state) updatePanel(state);
        });

        console.log('Reddit to AI: Floating panel initialized.');
    }
})();
