// Reddit to AI - first-run welcome page.
//
// Writes exactly two settings, both shared with the options page:
//   chrome.storage.sync  selectedLlmProvider  (the default chat provider)
//   chrome.storage.local telemetryEnabled     (through R2AITelemetry.setEnabled)

(function () {
    const STEP_COUNT = 3;
    const PROVIDER_KEY = 'selectedLlmProvider';
    const DEFAULT_PROVIDER = 'gemini';
    const PROVIDER_NAMES = {
        gemini: 'Gemini',
        chatgpt: 'ChatGPT',
        claude: 'Claude',
        aistudio: 'AI Studio',
        deepseek: 'DeepSeek',
        groq: 'Groq',
        custom: 'Custom site'
    };

    const hasChrome = typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);

    const stepsEl = document.getElementById('steps');
    const steps = [...document.querySelectorAll('.step')];
    const dots = [...document.querySelectorAll('.dot')];
    const progressFill = document.getElementById('progressFill');
    const stepCount = document.getElementById('stepCount');
    const backBtn = document.getElementById('backBtn');
    const nextBtn = document.getElementById('nextBtn');
    const doneBtn = document.getElementById('doneBtn');
    const openRedditBtn = document.getElementById('openRedditBtn');
    const providerRadios = [...document.querySelectorAll('input[name="welcomeProvider"]')];
    const providerStatus = document.getElementById('providerStatus');
    const telemetryCheckbox = document.getElementById('welcomeTelemetry');
    const telemetryStatus = document.getElementById('telemetryStatus');

    let current = 0;
    let selectedProvider = DEFAULT_PROVIDER;

    function msg(key, fallback, substitutions) {
        try {
            return (typeof t === 'function' && t(key, substitutions)) || fallback;
        } catch {
            return fallback;
        }
    }

    function setStatus(element, text, type = '') {
        if (!element) return;
        element.textContent = text || '';
        element.classList.toggle('success', type === 'success');
        element.classList.toggle('error', type === 'error');
        element.setAttribute('role', type === 'error' ? 'alert' : 'status');
    }

    // ── Steps ────────────────────────────────────────────────

    function goTo(index, { focus = true } = {}) {
        const target = Math.max(0, Math.min(STEP_COUNT - 1, index));
        if (target === current && steps[target] && !steps[target].hidden) return;
        stepsEl.dataset.dir = target < current ? 'back' : 'forward';
        current = target;
        render();
        if (focus) {
            steps[current]?.querySelector('.step-title')?.focus({ preventScroll: true });
        }
    }

    function render() {
        steps.forEach((step, index) => { step.hidden = index !== current; });
        dots.forEach((dot, index) => {
            if (index === current) dot.setAttribute('aria-current', 'step');
            else dot.removeAttribute('aria-current');
            dot.classList.toggle('done', index < current);
        });
        progressFill?.style.setProperty('--p', String(current / (STEP_COUNT - 1)));
        if (stepCount) {
            stepCount.textContent = msg('welcome_step_count', `Step ${current + 1} of ${STEP_COUNT}`,
                [String(current + 1), String(STEP_COUNT)]);
        }
        const last = current === STEP_COUNT - 1;
        backBtn.classList.toggle('is-invisible', current === 0);
        backBtn.setAttribute('aria-hidden', String(current === 0));
        backBtn.tabIndex = current === 0 ? -1 : 0;
        nextBtn.hidden = last;
        openRedditBtn.hidden = !last;
        doneBtn.hidden = !last;
    }

    backBtn.addEventListener('click', () => goTo(current - 1));
    nextBtn.addEventListener('click', () => goTo(current + 1));
    dots.forEach(dot => dot.addEventListener('click', () => goTo(Number(dot.dataset.goto))));

    // Enter / arrow keys move between steps, unless the focused control
    // already uses those keys itself (radio groups, buttons, links, inputs).
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const target = e.target;
        const tag = target?.tagName;
        const isRadio = tag === 'INPUT' && target.type === 'radio';
        const ownsKeys = tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA' ||
            (tag === 'INPUT' && !isRadio && target.type !== 'checkbox');

        if (e.key === 'Enter' && !ownsKeys) {
            if (tag === 'INPUT' && target.type === 'checkbox') return;
            e.preventDefault();
            if (current < STEP_COUNT - 1) goTo(current + 1);
            else openReddit();
            return;
        }
        if (ownsKeys || isRadio) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            e.preventDefault();
            goTo(current + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            goTo(current - 1);
        }
    });

    // ── Step 1: provider ─────────────────────────────────────

    function applyProvider(provider) {
        selectedProvider = PROVIDER_NAMES[provider] ? provider : DEFAULT_PROVIDER;
        providerRadios.forEach(radio => { radio.checked = radio.value === selectedProvider; });
        updateAiFact();
    }

    function updateAiFact() {
        const fact = document.getElementById('factAiDesc');
        if (!fact) return;
        const name = PROVIDER_NAMES[selectedProvider] || 'your AI';
        fact.textContent = msg('welcome_fact_ai_desc_named',
            `The thread is read in your browser and handed straight to ${name} (or to its API, if you add a key later). It never passes through our servers.`,
            [name]);
    }

    providerRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            applyProvider(radio.value);
            if (!hasChrome) return;
            chrome.storage.sync.set({ [PROVIDER_KEY]: radio.value }, () => {
                if (chrome.runtime.lastError) {
                    setStatus(providerStatus, msg('welcome_save_failed', 'Could not save. Try again.'), 'error');
                    return;
                }
                setStatus(providerStatus,
                    msg('welcome_provider_saved', `Saved — threads will open in ${PROVIDER_NAMES[radio.value]}.`, [PROVIDER_NAMES[radio.value]]),
                    'success');
            });
        });
    });

    // ── Step 2: real shortcut + live labels ──────────────────

    function renderShortcut(shortcut) {
        const mock = document.getElementById('shortcutMock');
        const text = document.getElementById('shortcutText');
        if (!mock) return;
        if (!shortcut) {
            mock.innerHTML = '';
            const kbd = document.createElement('kbd');
            kbd.textContent = '—';
            mock.appendChild(kbd);
            if (text) text.textContent = msg('welcome_way_shortcut_unset', 'No shortcut is set yet. You can choose one in Chrome.');
            return;
        }
        // "Alt+Shift+S" on Windows/Linux; "⌥⇧S" on macOS.
        const parts = shortcut.includes('+') ? shortcut.split('+') : [...shortcut];
        mock.innerHTML = '';
        parts.forEach((part, index) => {
            if (index > 0) {
                const plus = document.createElement('span');
                plus.className = 'plus';
                plus.textContent = '+';
                mock.appendChild(plus);
            }
            const kbd = document.createElement('kbd');
            kbd.textContent = part;
            mock.appendChild(kbd);
        });
        mock.setAttribute('aria-label', shortcut);
    }

    function loadShortcut() {
        try {
            if (!chrome.commands?.getAll) return;
            chrome.commands.getAll((commands) => {
                void chrome.runtime.lastError;
                const command = (commands || []).find(item => item.name === 'scrape-current-thread');
                if (command) renderShortcut(command.shortcut || '');
            });
        } catch {
            // Keep the default Alt+Shift+S markup.
        }
    }

    document.getElementById('shortcutSettingsBtn')?.addEventListener('click', () => {
        try {
            chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        } catch {
            // Not available (e.g. Firefox): nothing to open.
        }
    });

    function applyLiveLabels() {
        const inlineLabel = document.getElementById('mockInlineLabel');
        if (inlineLabel) inlineLabel.textContent = msg('reddit_btn_tooltip', 'Summarize with AI');
        const menuLabel = document.getElementById('mockMenuLabel');
        if (menuLabel) menuLabel.textContent = msg('context_menu_scrape_thread', 'Scrape this thread with Reddit to AI');
    }

    // ── Step 3: telemetry + exits ────────────────────────────

    function setupTelemetry() {
        const api = globalThis.R2AITelemetry;
        if (!telemetryCheckbox) return;
        let supported = false;
        try { supported = Boolean(api?.isSupported()); } catch { supported = false; }
        if (!supported) {
            telemetryCheckbox.checked = false;
            telemetryCheckbox.disabled = true;
            setStatus(telemetryStatus, msg('options_telemetry_unsupported', 'Usage counts are never sent in this browser build.'));
            return;
        }
        api.isEnabled().then((enabled) => { telemetryCheckbox.checked = enabled; }).catch(() => { });
        telemetryCheckbox.addEventListener('change', () => {
            const enabled = telemetryCheckbox.checked;
            api.setEnabled(enabled).then(() => {
                setStatus(telemetryStatus, enabled
                    ? msg('welcome_telemetry_on', 'Thanks — anonymous counts are on.')
                    : msg('welcome_telemetry_off', 'Off. Your install ID and any unsent counts were deleted.'), 'success');
            }).catch(() => {
                setStatus(telemetryStatus, msg('welcome_save_failed', 'Could not save. Try again.'), 'error');
            });
        });
    }

    function openReddit() {
        const url = 'https://www.reddit.com/';
        try {
            chrome.tabs.update({ url });
        } catch {
            location.href = url;
        }
    }

    function closeWelcome() {
        try {
            chrome.tabs.getCurrent((tab) => {
                if (chrome.runtime.lastError || !tab?.id) {
                    window.close();
                    return;
                }
                chrome.tabs.remove(tab.id);
            });
        } catch {
            window.close();
        }
    }

    openRedditBtn.addEventListener('click', openReddit);
    doneBtn.addEventListener('click', closeWelcome);

    // ── Boot ─────────────────────────────────────────────────

    function localizeAria() {
        document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            const message = msg(el.getAttribute('data-i18n-aria-label'), '');
            if (message) el.setAttribute('aria-label', message);
        });
    }

    async function init() {
        render();
        try {
            if (typeof initI18n === 'function') await initI18n();
            if (typeof localizeHtmlPage === 'function') localizeHtmlPage();
            localizeAria();
        } catch {
            // Fall back to the English markup.
        }
        applyLiveLabels();
        render();
        loadShortcut();
        setupTelemetry();

        if (hasChrome) {
            chrome.storage.sync.get({ [PROVIDER_KEY]: '' }, (items) => {
                const stored = items?.[PROVIDER_KEY];
                applyProvider(stored || DEFAULT_PROVIDER);
                // Persist the visible default so what the user sees is what is used.
                if (!stored) chrome.storage.sync.set({ [PROVIDER_KEY]: DEFAULT_PROVIDER });
            });
        } else {
            applyProvider(DEFAULT_PROVIDER);
        }
    }

    init();
})();
