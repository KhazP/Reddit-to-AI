// Reddit to AI - Options Page Script

// Localized helpers are now provided by i18n.js

if (typeof chrome === 'undefined' || !globalThis.chrome?.storage?.sync) {
    const previewStore = {};
    const readKeys = (keys) => {
        if (Array.isArray(keys)) {
            return keys.reduce((acc, key) => ({ ...acc, [key]: previewStore[key] }), {});
        }
        if (typeof keys === 'string') return { [keys]: previewStore[keys] };
        return { ...keys, ...previewStore };
    };
    const storageArea = {
        get(keys, callback) {
            callback(readKeys(keys));
        },
        set(items, callback) {
            Object.assign(previewStore, items || {});
            callback?.();
        },
        remove(keys, callback) {
            (Array.isArray(keys) ? keys : [keys]).forEach(key => delete previewStore[key]);
            callback?.();
        }
    };
    globalThis.chrome = {
        storage: { sync: storageArea, local: storageArea, session: storageArea },
        runtime: {
            getURL: path => path,
            sendMessage(message, callback) {
                if (message?.action === 'getHistory') callback?.({ history: [] });
                else callback?.({ success: true });
            },
            openOptionsPage() {}
        },
        i18n: { getMessage: () => '' }
    };
}

// Prompt Presets Library (Dynamic getter)
function getPromptPresets() {
    return {
        summarize: {
            name: t('preset_summarize_name') || 'Summarize',
            icon: '📝',
            description: t('preset_summarize_desc') || 'TL;DR of the thread',
            template: t('template_summarize') || `Provide a concise TL;DR summary of this Reddit thread.
Focus on: the main topic, key points made, and overall conclusion.
Keep it brief but comprehensive.

{content}`
        },
        debate: {
            name: t('preset_debate_name') || 'Debate Analysis',
            icon: '⚖️',
            description: t('preset_debate_desc') || 'Map out different sides',
            template: t('template_debate') || `Analyze this Reddit thread as a debate.
Map out:
1. The different sides/perspectives presented
2. Key arguments for each position
3. Points of agreement and disagreement
4. Which arguments are strongest and why

{content}`
        },
        sentiment: {
            name: t('preset_sentiment_name') || 'Sentiment',
            icon: '😊',
            description: t('preset_sentiment_desc') || 'Positive/negative breakdown',
            template: t('template_sentiment') || `Perform a sentiment analysis on this Reddit thread.
Analyze:
1. Overall sentiment (positive/negative/neutral)
2. Breakdown by comment - what % are positive, negative, neutral
3. Most emotionally charged comments
4. Tone shifts throughout the discussion

{content}`
        },
        takeaways: {
            name: t('preset_takeaways_name') || 'Key Takeaways',
            icon: '💡',
            description: t('preset_takeaways_desc') || 'Bullet points of insights',
            template: t('template_takeaways') || `Extract the key takeaways from this Reddit thread.
Provide:
- Main insights as bullet points
- Actionable advice mentioned
- Important facts or statistics shared
- Common recommendations from multiple users

{content}`
        },
        eli5: {
            name: t('preset_eli5_name') || 'ELI5',
            icon: '👶',
            description: t('preset_eli5_desc') || 'Explain like I\'m 5',
            template: t('template_eli5') || `Explain this Reddit thread like I'm 5 years old.
Use simple language, analogies, and examples.
Avoid jargon and technical terms.
Make it easy to understand for someone new to this topic.

{content}`
        },
        custom: {
            name: t('preset_custom_name') || 'Custom',
            icon: '✏️',
            description: t('preset_custom_desc') || 'Your own template',
            template: null
        }
    };
}


const DEFAULT_CUSTOM_TEMPLATE = `Please analyze the following Reddit thread.

1. Summarize the post content.
2. Point out what people are saying about it (main opinions, arguments, consensus).
3. Provide a detailed comment analysis, highlighting key contributors or unique perspectives.

Data:

{content}`;

document.addEventListener('DOMContentLoaded', () => {
    // initializeOptions is now async and handles localization
    initializeOptions();
    setupSettingsNav();
});

// Sidebar navigation: a vertical tablist with roving tabindex, arrow-key
// support, an animated active indicator and a #hash per section.
function setupSettingsNav() {
    const nav = document.getElementById('settingsNav');
    if (!nav) return;
    const tabs = [...nav.querySelectorAll('.nav-item')];
    const indicator = nav.querySelector('.nav-indicator');

    function moveIndicator(tab) {
        if (!indicator || !tab) return;
        indicator.style.setProperty('--nav-y', `${tab.offsetTop}px`);
    }

    function activate(tab, { focus = false, updateHash = true } = {}) {
        if (!tab) return;
        tabs.forEach((item) => {
            const selected = item === tab;
            item.classList.toggle('active', selected);
            item.setAttribute('aria-selected', String(selected));
            item.tabIndex = selected ? 0 : -1;
            const pane = document.getElementById(item.dataset.target);
            if (pane) {
                pane.hidden = !selected;
                pane.classList.toggle('active', selected);
            }
        });
        moveIndicator(tab);
        // Narrow screens turn the nav into a horizontal strip: keep the active tab visible.
        if (nav.scrollWidth > nav.clientWidth) {
            nav.scrollTo({ left: Math.max(0, tab.offsetLeft - 16), behavior: 'auto' });
        }
        if (focus) tab.focus();
        if (updateHash && tab.dataset.hash) {
            try { history.replaceState(null, '', `#${tab.dataset.hash}`); } catch { /* ignore */ }
        }
        if (window.scrollY > 0 && updateHash) {
            window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }
    }

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', (e) => {
            const index = tabs.indexOf(tab);
            let next = null;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') next = tabs[0];
            else if (e.key === 'End') next = tabs[tabs.length - 1];
            if (!next) return;
            e.preventDefault();
            activate(next, { focus: true });
        });
    });

    // In-page links such as "see Advanced".
    document.querySelectorAll('[data-goto]').forEach((link) => {
        link.addEventListener('click', () => {
            const tab = tabs.find(item => item.dataset.target === link.dataset.goto);
            activate(tab, { focus: true });
        });
    });

    const fromHash = tabs.find(item => `#${item.dataset.hash}` === location.hash);
    activate(fromHash || tabs.find(item => item.classList.contains('active')) || tabs[0], { updateHash: false });
    requestAnimationFrame(() => nav.classList.add('is-ready'));
    window.addEventListener('resize', () => moveIndicator(tabs.find(item => item.classList.contains('active'))));
    window.addEventListener('hashchange', () => {
        const tab = tabs.find(item => `#${item.dataset.hash}` === location.hash);
        if (tab) activate(tab, { updateHash: false });
    });
}

async function initializeOptions() {
    console.log("Options: Initializing...");
    let customSelectorsCache = {};
    let subredditRules = [];

    // Element references
    const saveStatusDisplay = document.getElementById('saveStatus');
    const showNotificationsCheckbox = document.getElementById('showNotifications');
    const telemetryEnabledCheckbox = document.getElementById('telemetryEnabled');
    const showPromptPreviewCheckbox = document.getElementById('showPromptPreview');
    const showRedditInlineButtonCheckbox = document.getElementById('showRedditInlineButton');
    const showRedditButtonInFeedCheckbox = document.getElementById('showRedditButtonInFeed');
    const showRedditButtonInPostCheckbox = document.getElementById('showRedditButtonInPost');
    const redditButtonSubgroup = document.getElementById('redditButtonSubgroup');
    const outputFormatSelect = document.getElementById('outputFormatSelect');
    const defaultPromptTemplateTextarea = document.getElementById('defaultPromptTemplate');
    const dataStorageDontSaveRadio = document.getElementById('dataStorageDontSave');
    const dataStorageSessionOnlyRadio = document.getElementById('dataStorageSessionOnly');
    const dataStoragePersistentRadio = document.getElementById('dataStoragePersistent');
    const platformRadios = document.querySelectorAll('input[name="llmProvider"]');
    const depthRadios = document.querySelectorAll('input[name="scrapeDepth"]');
    const presetSelector = document.getElementById('presetSelector');
    const templateLabel = document.getElementById('templateLabel');
    const resetCustomBtn = document.getElementById('resetCustomBtn');

    // Filter element references
    const filterMinScoreSlider = document.getElementById('filterMinScoreSlider');
    const filterMinScoreInput = document.getElementById('filterMinScoreInput');
    const filterTopN = document.getElementById('filterTopN');
    const filterHideBots = document.getElementById('filterHideBots');
    const includeHidden = document.getElementById('includeHidden');
    const contextPresetSelect = document.getElementById('contextPresetSelect');
    const trimStrategySelect = document.getElementById('trimStrategySelect');
    const redditSortModeSelect = document.getElementById('redditSortModeSelect');
    const mediaModeSelect = document.getElementById('mediaModeSelect');
    const filterAuthorOp = document.getElementById('filterAuthorOp');
    const filterAuthorFlaired = document.getElementById('filterAuthorFlaired');
    const authorFilterSummary = document.getElementById('authorFilterSummary');
    const themeRadios = document.querySelectorAll('input[name="uiTheme"]');
    const redditButtonDisabledHint = document.getElementById('redditButtonDisabledHint');
    const telemetryUnsupportedHint = document.getElementById('telemetryUnsupportedHint');
    const savedPresetStatus = document.getElementById('savedPresetStatus');
    const settingsTransferStatus = document.getElementById('settingsTransferStatus');
    const customOriginStatus = document.getElementById('customOriginStatus');
    const subredditRuleStatus = document.getElementById('subredditRuleStatus');
    const clearHistoryConfirm = document.getElementById('clearHistoryConfirm');
    const clearSavedPresetsConfirm = document.getElementById('clearSavedPresetsConfirm');

    // History element references
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');
    const historyLimitInput = document.getElementById('historyLimit');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const historySearch = document.getElementById('historySearch');
    const historyProviderFilter = document.getElementById('historyProviderFilter');
    const historyPresetFilter = document.getElementById('historyPresetFilter');
    const historyDateFilter = document.getElementById('historyDateFilter');
    const historyMinComments = document.getElementById('historyMinComments');
    const compareHistoryBtn = document.getElementById('compareHistoryBtn');
    const compareSelectedCount = document.getElementById('compareSelectedCount');
    const historyStatus = document.getElementById('historyStatus');
    const savedPresetList = document.getElementById('savedPresetList');
    const savedPresetCount = document.getElementById('savedPresetCount');
    const exportSavedPresetsBtn = document.getElementById('exportSavedPresetsBtn');
    const importSavedPresetsBtn = document.getElementById('importSavedPresetsBtn');
    const importSavedPresetsInput = document.getElementById('importSavedPresetsInput');
    const clearSavedPresetsBtn = document.getElementById('clearSavedPresetsBtn');
    const exportSettingsBtn = document.getElementById('exportSettingsBtn');
    const importSettingsBtn = document.getElementById('importSettingsBtn');
    const importSettingsInput = document.getElementById('importSettingsInput');

    // Language element reference
    const languageSelect = document.getElementById('languageSelect');


    const DEFAULT_DEPTH = 5;
    const DEFAULT_DATA_STORAGE_OPTION = 'persistent';
    const DEFAULT_LLM_PROVIDER = 'gemini';
    const DEFAULT_PRESET = 'summarize';
    const DEFAULT_LANGUAGE = 'auto';
    const DEFAULT_CONTEXT_PRESET = 'balanced';
    const DEFAULT_TRIM_STRATEGY = 'top';
    const DEFAULT_REDDIT_SORT_MODE = 'confidence';
    const DEFAULT_MEDIA_MODE = 'attach';
    const DEFAULT_OUTPUT_FORMAT = 'auto';


    // Current state
    let currentPreset = DEFAULT_PRESET;
    let fullHistory = [];
    let savedPromptPresets = [];
    const compareSelections = new Set();

    // Show save toast (role=status, aria-live=polite). Re-triggering while it is
    // visible just extends it instead of flickering.
    let saveToastTimer = null;
    function showSaveToast() {
        if (!saveStatusDisplay) return;
        saveStatusDisplay.textContent = t('options_toast_saved') || '✓ Saved';
        saveStatusDisplay.classList.add('visible');
        clearTimeout(saveToastTimer);
        saveToastTimer = setTimeout(() => {
            saveStatusDisplay.classList.remove('visible');
        }, 1800);
    }

    // Inline status line under a control (replaces alert()). Errors are
    // announced assertively; everything else politely.
    const inlineStatusTimers = new WeakMap();
    function setInlineStatus(element, message, type = '') {
        if (!element) return;
        clearTimeout(inlineStatusTimers.get(element));
        element.textContent = message || '';
        element.classList.toggle('error', type === 'error');
        element.classList.toggle('success', type === 'success');
        element.setAttribute('role', type === 'error' ? 'alert' : 'status');
        if (message && type === 'success') {
            inlineStatusTimers.set(element, setTimeout(() => {
                element.textContent = '';
            }, 4000));
        }
    }

    // Inline confirm row ("Delete all? [Cancel] [Delete all]") instead of confirm().
    function bindInlineConfirm(trigger, row, onConfirm) {
        if (!trigger || !row) return;
        const cancelBtn = row.querySelector('[data-confirm-cancel]');
        const okBtn = row.querySelector('[data-confirm-ok]');
        const close = (restoreFocus) => {
            row.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (restoreFocus) trigger.focus();
        };
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', row.id);
        trigger.addEventListener('click', () => {
            if (!row.hidden) {
                close(false);
                return;
            }
            row.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            cancelBtn?.focus();
        });
        cancelBtn?.addEventListener('click', () => close(true));
        okBtn?.addEventListener('click', () => {
            close(false);
            onConfirm();
        });
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
            }
        });
    }

    function localizeAriaLabels() {
        document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            const message = t(el.getAttribute('data-i18n-aria-label'));
            if (message) el.setAttribute('aria-label', message);
        });
    }

    function renderAppVersion() {
        const versionEl = document.getElementById('appVersion');
        if (!versionEl) return;
        let version = '';
        try {
            version = chrome.runtime.getManifest?.().version || '';
        } catch {
            version = '';
        }
        if (!version) {
            versionEl.textContent = 'Reddit to AI';
            return;
        }
        versionEl.textContent = t('options_footer_version', [version]) || `Reddit to AI v${version}`;
    }

    function setTemplateMode(isCustom) {
        if (defaultPromptTemplateTextarea) {
            defaultPromptTemplateTextarea.readOnly = !isCustom;
            defaultPromptTemplateTextarea.classList.toggle('readonly', !isCustom);
        }
        if (templateLabel) {
            templateLabel.textContent = isCustom ?
                (t('options_label_custom_template') || 'Custom Template') :
                (t('options_label_template_preview') || 'Template Preview');
        }
        if (resetCustomBtn) resetCustomBtn.hidden = !isCustom;
    }

    function setHistoryStatus(message, type = '') {
        if (!historyStatus) return;
        historyStatus.textContent = message;
        historyStatus.setAttribute('role', type === 'error' ? 'alert' : 'status');
        historyStatus.classList.toggle('error', type === 'error');
        historyStatus.classList.toggle('success', type === 'success');
    }

    function getRuntimeErrorMessage(response, fallback) {
        return response?.error || chrome.runtime.lastError?.message || fallback;
    }

    // Render preset selector pills
    function renderPresetSelector() {
        if (!presetSelector) return;

        const presets = getPromptPresets();
        presetSelector.innerHTML = '';
        Object.entries(presets).forEach(([key, preset]) => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = `preset-pill${key === currentPreset ? ' selected' : ''}`;
            pill.dataset.preset = key;
            pill.setAttribute('role', 'radio');
            pill.setAttribute('aria-checked', String(key === currentPreset));
            pill.innerHTML = `
                <span class="preset-pill-icon" aria-hidden="true">${preset.icon}</span>
                <span class="preset-pill-name">${escapeHtml(preset.name)}</span>
                <span class="preset-pill-desc">${escapeHtml(preset.description)}</span>
            `;
            pill.addEventListener('click', () => selectPreset(key));
            presetSelector.appendChild(pill);
        });
    }

    // Select a preset
    function selectPreset(presetKey) {
        currentPreset = presetKey;

        // Update pill selection
        document.querySelectorAll('.preset-pill').forEach(pill => {
            const selected = pill.dataset.preset === presetKey;
            pill.classList.toggle('selected', selected);
            pill.setAttribute('aria-checked', String(selected));
        });

        const presets = getPromptPresets();
        const preset = presets[presetKey];
        const isCustom = presetKey === 'custom';

        // Update textarea
        if (defaultPromptTemplateTextarea) {
            if (isCustom) {
                // For custom, load saved custom template
                chrome.storage.sync.get(['customPromptTemplate'], (result) => {
                    defaultPromptTemplateTextarea.value = result.customPromptTemplate || DEFAULT_CUSTOM_TEMPLATE;
                });
            } else {
                defaultPromptTemplateTextarea.value = preset.template;
            }
        }

        // Update label and reset button
        setTemplateMode(isCustom);

        // Save selected preset
        chrome.storage.sync.set({ selectedPreset: presetKey }, showSaveToast);

        // Also update the effective prompt template for use during scraping
        const effectiveTemplate = isCustom ?
            (defaultPromptTemplateTextarea?.value || DEFAULT_CUSTOM_TEMPLATE) :
            preset.template;
        chrome.storage.sync.set({ defaultPromptTemplate: effectiveTemplate });
        if (typeof updateRouteTester === 'function') {
            updateRouteTester();
        }
    }

    // Load saved settings
    chrome.storage.sync.get([
        'scrapeDepth',
        'showNotifications',
        'customPromptTemplate',
        'selectedPreset',
        'dataStorageOption',
        'selectedLlmProvider',
        'filterMinScore',
        'filterTopN',
        'filterAuthorType',
        'filterAuthorTypes',
        'filterHideBots',
        'includeHidden',
        'contextPreset',
        'trimStrategy',
        'redditSortMode',
        'mediaMode',
        'outputFormat',
        'showPromptPreview',
        'showRedditInlineButton',
        'showRedditButtonInFeed',
        'showRedditButtonInPost',
        'selectedLanguage',
        'customSelectors',
        'subredditPromptMappings',
        'uiTheme'
    ], async (result) => {
        console.log("Options: Loaded settings:", result);

        // Load language first
        const savedLanguage = result.selectedLanguage || DEFAULT_LANGUAGE;
        await loadLanguage(savedLanguage);

        // Now localize page with loaded language
        localizeHtmlPage();
        localizeAriaLabels();
        renderAppVersion();

        // Theme
        const savedTheme = ['auto', 'dark', 'light'].includes(result.uiTheme) ? result.uiTheme : 'auto';
        themeRadios.forEach(radio => { radio.checked = radio.value === savedTheme; });

        // Scrape depth
        const savedDepth = result.scrapeDepth || DEFAULT_DEPTH;
        depthRadios.forEach(radio => {
            if (parseInt(radio.value) === savedDepth ||
                (savedDepth >= 999 && radio.value === '999')) {
                radio.checked = true;
            }
        });
        if (result.scrapeDepth === undefined) {
            chrome.storage.sync.set({ scrapeDepth: DEFAULT_DEPTH });
        }

        // Notifications
        if (showNotificationsCheckbox) {
            showNotificationsCheckbox.checked = result.showNotifications !== false;
            if (result.showNotifications === undefined) {
                chrome.storage.sync.set({ showNotifications: true });
            }
        }

        // Preset selection
        currentPreset = result.selectedPreset || DEFAULT_PRESET;
        renderPresetSelector();

        // Load preset template
        const presets = getPromptPresets();
        const preset = presets[currentPreset];
        const isCustom = currentPreset === 'custom';

        if (defaultPromptTemplateTextarea) {
            defaultPromptTemplateTextarea.value = isCustom
                ? (result.customPromptTemplate || DEFAULT_CUSTOM_TEMPLATE)
                : (preset?.template || '');
        }
        setTemplateMode(isCustom);

        // Data storage option
        const storageOption = result.dataStorageOption || DEFAULT_DATA_STORAGE_OPTION;
        const storageRadios = {
            dontSave: dataStorageDontSaveRadio,
            sessionOnly: dataStorageSessionOnlyRadio,
            persistent: dataStoragePersistentRadio
        };
        if (storageRadios[storageOption]) {
            storageRadios[storageOption].checked = true;
        }
        if (!result.dataStorageOption) {
            chrome.storage.sync.set({ dataStorageOption: DEFAULT_DATA_STORAGE_OPTION });
        }

        // AI Platform selection
        const selectedProvider = result.selectedLlmProvider || DEFAULT_LLM_PROVIDER;
        platformRadios.forEach(radio => {
            if (radio.value === selectedProvider) {
                radio.checked = true;
            }
        });
        if (!result.selectedLlmProvider) {
            chrome.storage.sync.set({ selectedLlmProvider: DEFAULT_LLM_PROVIDER });
        }

        // Filter settings
        const minScore = result.filterMinScore || 0;
        if (filterMinScoreSlider) filterMinScoreSlider.value = minScore;
        if (filterMinScoreInput) filterMinScoreInput.value = minScore;
        if (filterTopN) filterTopN.value = result.filterTopN || 0;
        if (filterHideBots) filterHideBots.checked = result.filterHideBots || false;
        if (includeHidden) includeHidden.checked = result.includeHidden || false;
        if (contextPresetSelect) contextPresetSelect.value = result.contextPreset || DEFAULT_CONTEXT_PRESET;
        if (trimStrategySelect) trimStrategySelect.value = result.trimStrategy || DEFAULT_TRIM_STRATEGY;
        if (redditSortModeSelect) redditSortModeSelect.value = result.redditSortMode || DEFAULT_REDDIT_SORT_MODE;
        if (mediaModeSelect) mediaModeSelect.value = result.mediaMode || DEFAULT_MEDIA_MODE;
        if (outputFormatSelect) outputFormatSelect.value = result.outputFormat || DEFAULT_OUTPUT_FORMAT;
        if (showPromptPreviewCheckbox) showPromptPreviewCheckbox.checked = result.showPromptPreview !== false;

        // Reddit In-Page AI Button
        const showRedditInline = result.showRedditInlineButton !== false;
        const showRedditFeed = result.showRedditButtonInFeed === true;
        const showRedditPost = result.showRedditButtonInPost !== false;

        if (showRedditInlineButtonCheckbox) showRedditInlineButtonCheckbox.checked = showRedditInline;
        if (showRedditButtonInFeedCheckbox) showRedditButtonInFeedCheckbox.checked = showRedditFeed;
        if (showRedditButtonInPostCheckbox) showRedditButtonInPostCheckbox.checked = showRedditPost;

        setRedditSubgroupEnabled(showRedditInline);

        if (result.showRedditInlineButton === undefined) {
            chrome.storage.sync.set({ showRedditInlineButton: true });
        }
        if (result.showRedditButtonInFeed === undefined) {
            chrome.storage.sync.set({ showRedditButtonInFeed: false });
        }
        if (result.showRedditButtonInPost === undefined) {
            chrome.storage.sync.set({ showRedditButtonInPost: true });
        }

        // Author type filters
        setAuthorFilterControls(getAuthorTypesFromStorage(result));

        // Populate custom selectors
        customSelectorsCache = result.customSelectors || {};
        const customSelectors = customSelectorsCache;
        const selectorGeminiInput = document.getElementById('selectorGemini');
        const selectorChatgptInput = document.getElementById('selectorChatgpt');
        const selectorClaudeInput = document.getElementById('selectorClaude');
        const selectorAistudioInput = document.getElementById('selectorAistudio');
        const selectorDeepseekInput = document.getElementById('selectorDeepseek');
        const selectorGroqInput = document.getElementById('selectorGroq');
        const selectorCustomInput = document.getElementById('selectorCustom');

        if (selectorGeminiInput) selectorGeminiInput.value = customSelectors.gemini?.inputSelector || '';
        if (selectorChatgptInput) selectorChatgptInput.value = customSelectors.chatgpt?.inputSelector || '';
        if (selectorClaudeInput) selectorClaudeInput.value = customSelectors.claude?.inputSelector || '';
        if (selectorAistudioInput) selectorAistudioInput.value = customSelectors.aistudio?.inputSelector || '';
        if (selectorDeepseekInput) selectorDeepseekInput.value = customSelectors.deepseek?.inputSelector || '';
        if (selectorGroqInput) selectorGroqInput.value = customSelectors.groq?.inputSelector || '';
        if (selectorCustomInput) selectorCustomInput.value = customSelectors.custom?.inputSelector || '';

        // Language setting
        if (languageSelect) {
            languageSelect.value = savedLanguage;
        }

        // Subreddit rules
        subredditRules = result.subredditPromptMappings || [];
        renderSubredditRules(subredditRules);
        if (typeof updateRouteTester === 'function') {
            updateRouteTester();
        }
    });

    // Event listeners

    // Custom selector inputs listeners
    const selectorInputs = [
        { id: 'selectorGemini', platform: 'gemini' },
        { id: 'selectorChatgpt', platform: 'chatgpt' },
        { id: 'selectorClaude', platform: 'claude' },
        { id: 'selectorAistudio', platform: 'aistudio' },
        { id: 'selectorDeepseek', platform: 'deepseek' },
        { id: 'selectorGroq', platform: 'groq' },
        { id: 'selectorCustom', platform: 'custom' }
    ];

    selectorInputs.forEach(({ id, platform }) => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', (e) => {
                const val = e.target.value.trim();
                if (!customSelectorsCache[platform]) {
                    customSelectorsCache[platform] = {};
                }
                customSelectorsCache[platform].inputSelector = val;
                const editableDefaults = {
                    gemini: true,
                    chatgpt: true,
                    claude: true,
                    aistudio: false,
                    deepseek: false,
                    groq: false,
                    custom: false
                };
                customSelectorsCache[platform].isContentEditable = editableDefaults[platform];

                chrome.storage.sync.set({ customSelectors: customSelectorsCache }, showSaveToast);
                console.log(`Options: Custom selector for ${platform} updated to:`, val);
            });
        }
    });

    // Custom origins management logic
    const customOriginInput = document.getElementById('customOriginInput');
    const addCustomOriginBtn = document.getElementById('addCustomOriginBtn');
    const customOriginsList = document.getElementById('customOriginsList');

    function renderCustomOrigins(origins) {
        if (!customOriginsList) return;
        customOriginsList.innerHTML = '';
        if (origins.length === 0) {
            customOriginsList.innerHTML = `<li class="list-item is-empty"><span class="list-item-text">${escapeHtml(t('options_custom_origin_empty') || 'No custom sites added yet.')}</span></li>`;
            return;
        }
        const removeLabel = t('options_btn_remove') || 'Remove';
        const removeTitle = t('options_custom_origin_remove_title') || 'Remove site and revoke access';
        origins.forEach(origin => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.innerHTML = `
                <span class="list-item-text mono">${escapeHtml(origin)}</span>
                <button type="button" class="btn-action btn-danger-outline remove-custom-origin" data-origin="${escapeHtml(origin)}" title="${escapeHtml(removeTitle)}">${escapeHtml(removeLabel)}</button>
            `;
            customOriginsList.appendChild(li);
        });
    }

    // Load saved custom origins
    chrome.storage.sync.get(['customOrigins'], (res) => {
        const origins = res.customOrigins || [];
        renderCustomOrigins(origins);
    });

    // Add platform & request permission
    if (addCustomOriginBtn && customOriginInput) {
        addCustomOriginBtn.addEventListener('click', () => {
            const val = customOriginInput.value.trim();
            if (!val) {
                setInlineStatus(customOriginStatus, t('options_custom_origin_empty_input') || 'Enter a site address first, for example http://localhost:3000.', 'error');
                customOriginInput.focus();
                return;
            }

            let originUrl;
            try {
                originUrl = new URL(val);
            } catch {
                // Try prepending protocol if raw domain/IP is passed
                try {
                    originUrl = new URL('http://' + val);
                } catch {
                    originUrl = null;
                }
            }
            if (!originUrl || !/^https?:$/.test(originUrl.protocol)) {
                setInlineStatus(customOriginStatus, t('options_custom_origin_invalid') || 'That doesn\'t look like a web address. Try something like http://localhost:3000.', 'error');
                customOriginInput.focus();
                return;
            }

            const originMatch = `${originUrl.protocol}//${originUrl.host}/*`;
            addCustomOriginBtn.disabled = true;
            setInlineStatus(customOriginStatus, t('options_custom_origin_requesting') || 'Waiting for you to allow access…');

            chrome.permissions.request({ origins: [originMatch] }, (granted) => {
                addCustomOriginBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    setInlineStatus(customOriginStatus, `${t('options_custom_origin_error') || 'Could not request access:'} ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                if (!granted) {
                    setInlineStatus(customOriginStatus, t('options_custom_origin_denied') || 'Access was not allowed, so the site was not added.', 'error');
                    return;
                }
                chrome.storage.sync.get(['customOrigins'], (res) => {
                    const origins = res.customOrigins || [];
                    if (origins.includes(originMatch)) {
                        setInlineStatus(customOriginStatus, t('options_custom_origin_exists') || 'That site is already in the list.');
                        customOriginInput.value = '';
                        return;
                    }
                    origins.push(originMatch);
                    chrome.storage.sync.set({ customOrigins: origins }, () => {
                        renderCustomOrigins(origins);
                        customOriginInput.value = '';
                        showSaveToast();
                        setInlineStatus(customOriginStatus, t('options_custom_origin_added') || 'Site added.', 'success');
                        chrome.runtime.sendMessage({ action: 'registerCustomOrigin', origin: originMatch });
                    });
                });
            });
        });
        customOriginInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addCustomOriginBtn.click();
        });
    }

    // Remove custom origin
    if (customOriginsList) {
        customOriginsList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-custom-origin');
            if (!btn) return;
            const origin = btn.dataset.origin;
            
            chrome.permissions.remove({ origins: [origin] }, (_removed) => {
                chrome.storage.sync.get(['customOrigins'], (res) => {
                    const origins = res.customOrigins || [];
                    const updated = origins.filter(o => o !== origin);
                    chrome.storage.sync.set({ customOrigins: updated }, () => {
                        renderCustomOrigins(updated);
                        showSaveToast();
                        setInlineStatus(customOriginStatus, t('options_custom_origin_removed') || 'Site removed.', 'success');
                        chrome.runtime.sendMessage({ action: 'unregisterCustomOrigin', origin });
                    });
                });
            });
        });
    }

    // ==========================================
    // Subreddit-Specific Prompt Templates & Tester
    // ==========================================
    const subredditPatternInput = document.getElementById('subredditPatternInput');
    const subredditPresetSelect = document.getElementById('subredditPresetSelect');
    const addSubredditRuleBtn = document.getElementById('addSubredditRuleBtn');
    const subredditRulesList = document.getElementById('subredditRulesList');
    const routeTesterInput = document.getElementById('routeTesterInput');
    const routeTesterResult = document.getElementById('routeTesterResult');

    function renderSubredditRules(rules) {
        if (!subredditRulesList) return;
        subredditRulesList.innerHTML = '';
        if (rules.length === 0) {
            subredditRulesList.innerHTML = `<li class="list-item is-empty"><span class="list-item-text">${escapeHtml(t('options_mappings_no_rules') || 'No subreddit-specific rules defined yet.')}</span></li>`;
            return;
        }
        const removeLabel = t('options_btn_remove') || 'Remove';
        rules.forEach((rule, index) => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.innerHTML = `
                <span class="list-item-text"><strong>r/${escapeHtml(rule.pattern)}</strong> &rarr; ${escapeHtml(presetName(rule.preset))}</span>
                <button type="button" class="btn-action btn-danger-outline remove-subreddit-rule" data-index="${index}" aria-label="${escapeHtml(`${removeLabel}: ${rule.pattern}`)}">${escapeHtml(removeLabel)}</button>
            `;
            subredditRulesList.appendChild(li);
        });
    }

    function matchSubredditPattern(subreddit, pattern) {
        if (!subreddit || !pattern) return false;
        const sub = subreddit.trim().toLowerCase();
        const pat = pattern.trim().toLowerCase();
        if (pat === sub) return true;
        if (pat.includes('*')) {
            const escaped = pat.replace(/[-\/\\^$+.()|[\]{}?]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
            try {
                const regex = new RegExp(regexStr);
                return regex.test(sub);
            } catch (e) {
                console.error('Invalid wildcard pattern:', pat, e);
                return false;
            }
        }
        return false;
    }

    function updateRouteTester() {
        if (!routeTesterInput || !routeTesterResult) return;
        const sub = routeTesterInput.value.trim().replace(/^\/?r\//i, '');
        if (!sub) {
            routeTesterResult.hidden = true;
            return;
        }

        let matchedRule = null;
        for (const rule of subredditRules) {
            if (matchSubredditPattern(sub, rule.pattern)) {
                matchedRule = rule;
                break;
            }
        }

        if (matchedRule) {
            const detail = t('options_tester_match_detail', [sub, matchedRule.pattern, presetName(matchedRule.preset)]) ||
                `r/${sub} matches “${matchedRule.pattern}”, so it uses the ${presetName(matchedRule.preset)} prompt.`;
            routeTesterResult.innerHTML = `<span class="tester-match">${escapeHtml(t('options_tester_match') || 'Match')}</span> · ${escapeHtml(detail)}`;
        } else {
            const detail = t('options_tester_nomatch_detail', [sub, presetName(currentPreset || 'summarize')]) ||
                `r/${sub} matches no rule, so it uses your default prompt (${presetName(currentPreset || 'summarize')}).`;
            routeTesterResult.innerHTML = `<span class="tester-nomatch">${escapeHtml(t('options_tester_nomatch') || 'No match')}</span> · ${escapeHtml(detail)}`;
        }
        routeTesterResult.hidden = false;
    }

    // Add subreddit-specific template rule
    if (addSubredditRuleBtn && subredditPatternInput && subredditPresetSelect) {
        addSubredditRuleBtn.addEventListener('click', () => {
            const pattern = subredditPatternInput.value.trim().toLowerCase().replace(/^\/?r\//, '');
            if (!pattern) {
                setInlineStatus(subredditRuleStatus, t('options_mappings_empty_input') || 'Enter a subreddit name or pattern first.', 'error');
                subredditPatternInput.focus();
                return;
            }

            // Check for duplicate patterns before saving
            const duplicate = subredditRules.some(r => r.pattern === pattern);
            if (duplicate) {
                setInlineStatus(subredditRuleStatus, t('options_mappings_duplicate') || 'A rule for this pattern already exists.', 'error');
                subredditPatternInput.focus();
                return;
            }

            const preset = subredditPresetSelect.value;
            subredditRules.push({ pattern, preset });

            chrome.storage.sync.set({ subredditPromptMappings: subredditRules }, () => {
                renderSubredditRules(subredditRules);
                subredditPatternInput.value = '';
                showSaveToast();
                setInlineStatus(subredditRuleStatus, t('options_mappings_added') || 'Rule added.', 'success');
                updateRouteTester();
            });
        });
        subredditPatternInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addSubredditRuleBtn.click();
        });
    }

    // Remove subreddit-specific template rule
    if (subredditRulesList) {
        subredditRulesList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-subreddit-rule');
            if (!btn) return;
            const index = parseInt(btn.dataset.index, 10);
            if (isNaN(index)) return;
            
            subredditRules.splice(index, 1);
            chrome.storage.sync.set({ subredditPromptMappings: subredditRules }, () => {
                renderSubredditRules(subredditRules);
                showSaveToast();
                updateRouteTester();
            });
        });
    }

    // Route tester input event listener
    if (routeTesterInput) {
        routeTesterInput.addEventListener('input', updateRouteTester);
    }

    // Depth radio buttons
    depthRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                const depth = parseInt(e.target.value);
                chrome.storage.sync.set({ scrapeDepth: depth }, showSaveToast);
                console.log("Options: Scrape depth set to", depth);
            }
        });
    });

    // Notifications checkbox
    if (showNotificationsCheckbox) {
        showNotificationsCheckbox.addEventListener('change', (e) => {
            chrome.storage.sync.set({ showNotifications: e.target.checked }, showSaveToast);
        });
    }

    // Anonymous usage stats. Deliberately kept out of storage.sync and out of the
    // settings export: the install ID must not follow the user to another profile.
    if (telemetryEnabledCheckbox && globalThis.R2AITelemetry) {
        globalThis.R2AITelemetry.isEnabled()
            .then(enabled => { telemetryEnabledCheckbox.checked = enabled && !telemetryEnabledCheckbox.disabled; })
            .catch(() => { });
        // Builds that never send (e.g. Firefox) say so instead of showing a live toggle.
        let telemetrySupported = true;
        try { telemetrySupported = globalThis.R2AITelemetry.isSupported(); } catch { telemetrySupported = false; }
        if (!telemetrySupported) {
            telemetryEnabledCheckbox.disabled = true;
            telemetryEnabledCheckbox.checked = false;
            if (telemetryUnsupportedHint) telemetryUnsupportedHint.hidden = false;
        }
        telemetryEnabledCheckbox.addEventListener('change', (e) => {
            globalThis.R2AITelemetry.setEnabled(e.target.checked).then(showSaveToast).catch(() => { });
        });
    }

    if (showPromptPreviewCheckbox) {
        showPromptPreviewCheckbox.addEventListener('change', (e) => {
            chrome.storage.sync.set({ showPromptPreview: e.target.checked }, showSaveToast);
        });
    }

    // Reddit in-page AI button toggles
    function setRedditSubgroupEnabled(enabled) {
        if (redditButtonSubgroup) {
            redditButtonSubgroup.classList.toggle('disabled', !enabled);
            redditButtonSubgroup.setAttribute('aria-disabled', String(!enabled));
        }
        [showRedditButtonInFeedCheckbox, showRedditButtonInPostCheckbox].forEach((checkbox) => {
            if (checkbox) checkbox.disabled = !enabled;
        });
        if (redditButtonDisabledHint) redditButtonDisabledHint.hidden = enabled;
    }

    if (showRedditInlineButtonCheckbox) {
        showRedditInlineButtonCheckbox.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            chrome.storage.sync.set({ showRedditInlineButton: enabled }, showSaveToast);
            setRedditSubgroupEnabled(enabled);
        });
    }

    // Theme (auto / dark / light). theme.js applies it live on every open page.
    themeRadios.forEach((radio) => {
        radio.addEventListener('change', (e) => {
            if (!e.target.checked) return;
            chrome.storage.sync.set({ uiTheme: e.target.value }, showSaveToast);
        });
    });

    if (showRedditButtonInFeedCheckbox) {
        showRedditButtonInFeedCheckbox.addEventListener('change', (e) => {
            chrome.storage.sync.set({ showRedditButtonInFeed: e.target.checked }, showSaveToast);
        });
    }

    if (showRedditButtonInPostCheckbox) {
        showRedditButtonInPostCheckbox.addEventListener('change', (e) => {
            chrome.storage.sync.set({ showRedditButtonInPost: e.target.checked }, showSaveToast);
        });
    }

    // Language select
    if (languageSelect) {
        languageSelect.addEventListener('change', async (e) => {
            const newLang = e.target.value;

            // 1. Save setting
            chrome.storage.sync.set({ selectedLanguage: newLang });

            // 2. Load the new language
            await loadLanguage(newLang);

            // 3. Update all UI components
            localizeHtmlPage();
            localizeAriaLabels();
            renderAppVersion();
            renderPresetSelector(); // Update preset names/descriptions
            selectPreset(currentPreset); // Update template labels
            updateAuthorSummary();
            renderSubredditRules(subredditRules);
            renderSavedPromptPresets();
            updateCompareUi();
            loadHistory(); // Update history relative times and labels

            showSaveToast();

            // 4. Confirm on the hint itself, then restore it.
            const hint = document.getElementById('languageHint');
            if (hint) {
                hint.classList.add('is-success');
                hint.textContent = t('options_language_applied') || 'Language applied.';
                setTimeout(() => {
                    hint.classList.remove('is-success');
                    hint.textContent = t('options_hint_language') || 'Select your preferred language.';
                }, 3000);
            }
        });
    }


    // Custom prompt template (debounced save) - only when custom is selected
    let promptSaveTimeout;
    if (defaultPromptTemplateTextarea) {
        defaultPromptTemplateTextarea.addEventListener('input', (e) => {
            if (currentPreset !== 'custom') return;

            clearTimeout(promptSaveTimeout);
            promptSaveTimeout = setTimeout(() => {
                chrome.storage.sync.set({
                    customPromptTemplate: e.target.value,
                    defaultPromptTemplate: e.target.value
                }, showSaveToast);
            }, 500);
        });
    }

    // Reset custom button
    if (resetCustomBtn) {
        resetCustomBtn.addEventListener('click', () => {
            if (defaultPromptTemplateTextarea) {
                defaultPromptTemplateTextarea.value = DEFAULT_CUSTOM_TEMPLATE;
                chrome.storage.sync.set({
                    customPromptTemplate: DEFAULT_CUSTOM_TEMPLATE,
                    defaultPromptTemplate: DEFAULT_CUSTOM_TEMPLATE
                }, showSaveToast);
            }
        });
    }

    // Data storage radio buttons
    [dataStorageDontSaveRadio, dataStorageSessionOnlyRadio, dataStoragePersistentRadio].forEach(radio => {
        if (radio) {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    chrome.storage.sync.set({ dataStorageOption: e.target.value }, showSaveToast);
                }
            });
        }
    });

    // Platform radio buttons
    platformRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                chrome.storage.sync.set({ selectedLlmProvider: e.target.value }, showSaveToast);
            }
        });
    });

    // Filter event listeners

    // Min score slider + input sync
    if (filterMinScoreSlider && filterMinScoreInput) {
        filterMinScoreSlider.addEventListener('input', (e) => {
            filterMinScoreInput.value = e.target.value;
        });
        filterMinScoreSlider.addEventListener('change', (e) => {
            chrome.storage.sync.set({ filterMinScore: parseInt(e.target.value, 10) }, showSaveToast);
        });
        filterMinScoreInput.addEventListener('change', (e) => {
            const val = Math.min(500, Math.max(0, parseInt(e.target.value, 10) || 0));
            filterMinScoreInput.value = val;
            filterMinScoreSlider.value = val;
            chrome.storage.sync.set({ filterMinScore: val }, showSaveToast);
        });
    }

    // Top N comments
    if (filterTopN) {
        filterTopN.addEventListener('change', (e) => {
            const val = Math.max(0, parseInt(e.target.value, 10) || 0);
            chrome.storage.sync.set({ filterTopN: val }, showSaveToast);
        });
    }

    const simpleSettingSelects = [
        [contextPresetSelect, 'contextPreset'],
        [trimStrategySelect, 'trimStrategy'],
        [redditSortModeSelect, 'redditSortMode'],
        [mediaModeSelect, 'mediaMode'],
        [outputFormatSelect, 'outputFormat']
    ];
    simpleSettingSelects.forEach(([element, key]) => {
        if (!element) return;
        element.addEventListener('change', (e) => {
            chrome.storage.sync.set({ [key]: e.target.value }, showSaveToast);
        });
    });

    function getAuthorTypesFromStorage(result) {
        if (Array.isArray(result.filterAuthorTypes)) return result.filterAuthorTypes;
        if (result.filterAuthorType === 'op') return ['op'];
        if (result.filterAuthorType === 'flaired') return ['flaired'];
        return [];
    }

    function setAuthorFilterControls(authorTypes) {
        const types = Array.isArray(authorTypes) ? authorTypes : [];
        if (filterAuthorOp) filterAuthorOp.checked = types.includes('op');
        if (filterAuthorFlaired) filterAuthorFlaired.checked = types.includes('flaired');
        updateAuthorSummary();
    }

    // Plain-language summary of the author filter: no checkboxes = everyone.
    function updateAuthorSummary() {
        if (!authorFilterSummary) return;
        const op = Boolean(filterAuthorOp?.checked);
        const flaired = Boolean(filterAuthorFlaired?.checked);
        let key = 'options_author_summary_all';
        let fallback = 'Including comments from everyone. Turn on one or both to keep only those authors.';
        if (op && flaired) {
            key = 'options_author_summary_both';
            fallback = 'Only comments by the original poster or by users with flair.';
        } else if (op) {
            key = 'options_author_summary_op';
            fallback = 'Only comments by the original poster.';
        } else if (flaired) {
            key = 'options_author_summary_flaired';
            fallback = 'Only comments by users with flair.';
        }
        authorFilterSummary.textContent = t(key) || fallback;
    }

    function saveAuthorFilters(authorTypes) {
        const types = [...new Set(authorTypes)].filter(type => type === 'op' || type === 'flaired');
        const legacyType = types.length === 1 ? types[0] : (types.length === 0 ? 'all' : 'multiple');
        setAuthorFilterControls(types);
        chrome.storage.sync.set({
            filterAuthorTypes: types,
            filterAuthorType: legacyType
        }, showSaveToast);
    }

    [filterAuthorOp, filterAuthorFlaired].forEach((checkbox) => {
        if (!checkbox) return;
        checkbox.addEventListener('change', () => {
            const types = [];
            if (filterAuthorOp?.checked) types.push('op');
            if (filterAuthorFlaired?.checked) types.push('flaired');
            saveAuthorFilters(types);
        });
    });

    // Hide bots toggle
    if (filterHideBots) {
        filterHideBots.addEventListener('change', (e) => {
            chrome.storage.sync.set({ filterHideBots: e.target.checked }, showSaveToast);
        });
    }

    // Include removed/deleted toggle
    if (includeHidden) {
        includeHidden.addEventListener('change', (e) => {
            chrome.storage.sync.set({ includeHidden: e.target.checked }, showSaveToast);
        });
    }

    // =====================
    // History Management
    // =====================

    // Load history limit setting
    chrome.storage.sync.get(['historyLimit'], (result) => {
        if (historyLimitInput) {
            historyLimitInput.value = result.historyLimit || 10;
        }
    });

    // History limit change handler
    if (historyLimitInput) {
        historyLimitInput.addEventListener('change', (e) => {
            const val = Math.min(50, Math.max(5, parseInt(e.target.value, 10) || 10));
            historyLimitInput.value = val;
            chrome.storage.sync.set({ historyLimit: val }, showSaveToast);
        });
    }

    function formatRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return t('options_time_now') || 'Just now';
        if (minutes < 60) return t('options_time_min', [minutes.toString()]) || `${minutes}m ago`;
        if (hours < 24) return t('options_time_hour', [hours.toString()]) || `${hours}h ago`;
        if (days < 7) return t('options_time_day', [days.toString()]) || `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    function truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text || '';
        return text.slice(0, maxLength - 3) + '...';
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    // Every chat provider the extension can hand a thread to (see the platform grid).
    const CHAT_PROVIDERS = ['gemini', 'chatgpt', 'claude', 'aistudio', 'deepseek', 'groq', 'custom'];

    function platformName(provider) {
        if (provider === 'custom') return t('options_platform_custom') || 'Custom site';
        return ({
            gemini: 'Gemini',
            chatgpt: 'ChatGPT',
            claude: 'Claude',
            aistudio: 'AI Studio',
            deepseek: 'DeepSeek',
            groq: 'Groq'
        }[provider]) || provider || 'AI';
    }

    function presetName(preset) {
        const presets = getPromptPresets();
        return presets[preset]?.name || preset || 'Preset';
    }

    function updateCompareUi() {
        const count = compareSelections.size;
        if (compareSelectedCount) {
            compareSelectedCount.textContent = t('options_compare_selected', [String(count)]) || `${count} selected for compare`;
        }
        if (compareHistoryBtn) {
            compareHistoryBtn.disabled = count < 2;
            compareHistoryBtn.title = count < 2
                ? (t('options_compare_hint') || 'Select at least two threads to compare')
                : '';
        }
    }

    function formatPresetDate(timestamp) {
        if (!timestamp) return t('options_unknown_date') || 'Unknown date';
        return new Date(timestamp).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function renderSavedPromptPresets() {
        if (savedPresetCount) {
            const label = savedPromptPresets.length === 1 ?
                (t('options_label_item') || 'item') :
                (t('options_label_items') || 'items');
            savedPresetCount.textContent = `${savedPromptPresets.length} ${label}`;
        }
        const noPresetsHint = t('options_saved_presets_none_hint') || 'No saved presets yet';
        if (exportSavedPresetsBtn) {
            exportSavedPresetsBtn.disabled = savedPromptPresets.length === 0;
            exportSavedPresetsBtn.title = savedPromptPresets.length === 0 ? noPresetsHint : '';
        }
        if (clearSavedPresetsBtn) {
            clearSavedPresetsBtn.disabled = savedPromptPresets.length === 0;
            clearSavedPresetsBtn.title = savedPromptPresets.length === 0 ? noPresetsHint : '';
            if (savedPromptPresets.length === 0 && clearSavedPresetsConfirm) clearSavedPresetsConfirm.hidden = true;
        }
        if (!savedPresetList) return;

        if (savedPromptPresets.length === 0) {
            savedPresetList.innerHTML = `
                <div class="empty-state">
                    <span>${escapeHtml(t('options_saved_presets_empty') || 'No saved prompt presets yet')}</span>
                </div>
            `;
            return;
        }

        const useLabel = t('options_btn_use') || 'Use';
        const exportLabel = t('options_btn_export') || 'Export';
        const deleteLabel = t('options_title_delete') || 'Delete';
        savedPresetList.innerHTML = '';
        savedPromptPresets.forEach((preset) => {
            const item = document.createElement('div');
            item.className = 'saved-preset-item';
            item.dataset.presetId = preset.id;
            item.innerHTML = `
                <div class="saved-preset-main">
                    <strong>${escapeHtml(preset.name || t('options_untitled_preset') || 'Untitled preset')}</strong>
                    <span>${escapeHtml(formatPresetDate(preset.createdAt))} · ${escapeHtml(preset.contextPreset || 'balanced')} · ${escapeHtml(preset.trimStrategy || 'top')}</span>
                </div>
                <div class="saved-preset-controls">
                    <button type="button" class="btn-action" data-action="apply">${escapeHtml(useLabel)}</button>
                    <button type="button" class="btn-action" data-action="export">${escapeHtml(exportLabel)}</button>
                    <button type="button" class="btn-action btn-danger-outline" data-action="delete">${escapeHtml(deleteLabel)}</button>
                </div>
            `;
            savedPresetList.appendChild(item);
        });
    }

    function loadSavedPromptPresets() {
        chrome.storage.sync.get(['savedPromptPresets'], (result) => {
            savedPromptPresets = Array.isArray(result.savedPromptPresets) ? result.savedPromptPresets : [];
            renderSavedPromptPresets();
        });
    }

    function persistSavedPromptPresets(nextPresets) {
        savedPromptPresets = nextPresets;
        chrome.storage.sync.set({ savedPromptPresets }, () => {
            renderSavedPromptPresets();
            showSaveToast();
        });
    }

    function downloadJson(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function readJsonFile(file, callback, statusElement) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try {
                parsed = JSON.parse(String(reader.result || 'null'));
            } catch (error) {
                setInlineStatus(statusElement, `${t('options_import_bad_json') || 'Could not read that file as JSON:'} ${error.message}`, 'error');
                return;
            }
            callback(parsed);
        };
        reader.onerror = () => {
            setInlineStatus(statusElement, t('options_import_read_failed') || 'Could not read that file.', 'error');
        };
        reader.readAsText(file);
    }

    // Single source of truth for which settings travel through export/import, and
    // what shape each one is allowed to have. Import rejects anything that is not
    // listed here, so a hand-edited or hostile settings file cannot inject keys the
    // rest of the extension never validates.
    const PORTABLE_SETTING_TYPES = {
        scrapeDepth: 'number',
        showNotifications: 'boolean',
        showPromptPreview: 'boolean',
        showRedditInlineButton: 'boolean',
        showRedditButtonInFeed: 'boolean',
        showRedditButtonInPost: 'boolean',
        customPromptTemplate: 'string',
        selectedPreset: 'string',
        dataStorageOption: 'string',
        selectedLlmProvider: 'string',
        filterMinScore: 'number',
        filterTopN: 'number',
        filterAuthorType: 'string',
        filterAuthorTypes: 'array',
        filterHideBots: 'boolean',
        includeHidden: 'boolean',
        contextPreset: 'string',
        trimStrategy: 'string',
        redditSortMode: 'string',
        mediaMode: 'string',
        outputFormat: 'string',
        selectedLanguage: 'string',
        uiTheme: 'string',
        savedPromptPresets: 'array',
        customSelectors: 'object'
    };

    const IMPORT_STATUS_KEY = 'pendingImportStatus';

    function matchesExpectedType(value, expectedType) {
        if (expectedType === 'array') return Array.isArray(value);
        if (expectedType === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
        if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
        return typeof value === expectedType;
    }

    function exportSettings() {
        const keys = Object.keys(PORTABLE_SETTING_TYPES);
        chrome.storage.sync.get(keys, (settings) => {
            downloadJson(`reddit-to-ai-settings-${Date.now()}.json`, {
                exportedAt: new Date().toISOString(),
                settings
            });
            setInlineStatus(settingsTransferStatus, t('options_settings_exported') || 'Settings exported.', 'success');
        });
    }

    function importSettings(payload) {
        const settings = payload?.settings && typeof payload.settings === 'object' ? payload.settings : payload;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            setInlineStatus(settingsTransferStatus, t('options_import_no_settings') || 'That file does not contain settings.', 'error');
            return;
        }
        const accepted = {};
        let importedCount = 0;
        let skippedCount = 0;
        for (const [key, value] of Object.entries(settings)) {
            const expectedType = PORTABLE_SETTING_TYPES[key];
            // Unknown keys and wrong-typed values are dropped silently: an import
            // file is untrusted input, not a way to write arbitrary storage keys.
            if (!expectedType || !matchesExpectedType(value, expectedType)) {
                skippedCount++;
                continue;
            }
            accepted[key] = value;
            importedCount++;
        }

        if (importedCount === 0) {
            setInlineStatus(settingsTransferStatus, t('options_import_none_recognized') || 'That file does not contain any recognized settings.', 'error');
            return;
        }

        chrome.storage.sync.set(accepted, () => {
            if (chrome.runtime.lastError) {
                setInlineStatus(settingsTransferStatus, `${t('options_import_failed') || 'Could not import settings:'} ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            // Re-running the initializer here would re-attach every listener on top
            // of the existing ones (double-save / double-delete). Reloading the page is
            // the only way to rebuild the whole options UI from the new values with
            // exactly one set of listeners bound.
            const status = `Imported ${importedCount} setting${importedCount === 1 ? '' : 's'}` +
                (skippedCount > 0 ? `, skipped ${skippedCount} unrecognized.` : '.');
            chrome.storage.local.set({ [IMPORT_STATUS_KEY]: status }, () => {
                void chrome.runtime.lastError;
                location.reload();
            });
        });
    }

    // Surfaces the message stored just before the post-import reload, then clears it
    // so a later manual reload does not repeat a stale status.
    function showPendingImportStatus() {
        chrome.storage.local.get([IMPORT_STATUS_KEY], (result) => {
            const status = result?.[IMPORT_STATUS_KEY];
            if (!status) return;
            chrome.storage.local.remove([IMPORT_STATUS_KEY], () => void chrome.runtime.lastError);
            setInlineStatus(settingsTransferStatus, status, 'success');
            showSaveToast();
        });
    }

    function applySavedPromptPreset(preset) {
        if (!preset?.template) return;
        currentPreset = 'custom';
        if (defaultPromptTemplateTextarea) {
            defaultPromptTemplateTextarea.value = preset.template;
        }
        setTemplateMode(true);
        renderPresetSelector();
        chrome.storage.sync.set({
            selectedPreset: 'custom',
            customPromptTemplate: preset.template,
            defaultPromptTemplate: preset.template,
            contextPreset: preset.contextPreset || DEFAULT_CONTEXT_PRESET,
            trimStrategy: preset.trimStrategy || DEFAULT_TRIM_STRATEGY,
            mediaMode: preset.mediaMode || DEFAULT_MEDIA_MODE
        }, () => {
            if (contextPresetSelect) contextPresetSelect.value = preset.contextPreset || DEFAULT_CONTEXT_PRESET;
            if (trimStrategySelect) trimStrategySelect.value = preset.trimStrategy || DEFAULT_TRIM_STRATEGY;
            if (mediaModeSelect) mediaModeSelect.value = preset.mediaMode || DEFAULT_MEDIA_MODE;
            showSaveToast();
            setInlineStatus(savedPresetStatus, t('options_preset_applied', [preset.name || '']) || `Now using “${preset.name || 'preset'}” as your custom prompt.`, 'success');
        });
    }

    function getHistoryFilterState() {
        return {
            query: (historySearch?.value || '').trim().toLowerCase(),
            provider: historyProviderFilter?.value || 'all',
            preset: historyPresetFilter?.value || 'all',
            date: historyDateFilter?.value || 'all',
            minComments: Math.max(0, parseInt(historyMinComments?.value || '0', 10) || 0)
        };
    }

    function matchesHistoryDate(item, dateFilter) {
        if (dateFilter === 'all') return true;
        const timestamp = Number(item.timestamp || 0);
        if (!timestamp) return false;
        const age = Date.now() - timestamp;
        if (dateFilter === 'today') return age <= 24 * 60 * 60 * 1000;
        if (dateFilter === 'week') return age <= 7 * 24 * 60 * 60 * 1000;
        if (dateFilter === 'month') return age <= 30 * 24 * 60 * 60 * 1000;
        return true;
    }

    function filterHistoryItems(items) {
        const state = getHistoryFilterState();
        return items.filter((item) => {
            const metadata = item.metadata || {};
            const post = item.post || {};
            const commentCount = Number(metadata.commentCount || 0);
            if (state.provider !== 'all' && metadata.aiProvider !== state.provider) return false;
            if (state.preset !== 'all' && metadata.preset !== state.preset) return false;
            if (commentCount < state.minComments) return false;
            if (!matchesHistoryDate(item, state.date)) return false;
            if (!state.query) return true;
            const haystack = [
                post.title,
                post.subreddit,
                post.url,
                post.flair,
                metadata.aiProvider,
                metadata.preset,
                metadata.contextPreset,
                metadata.trimStrategy,
                metadata.redditSortMode
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(state.query);
        });
    }

    function renderHistoryItem(item) {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.dataset.historyId = item.id;

        const title = item.post?.title || 'Untitled Thread';
        const subreddit = item.post?.subreddit || 'unknown';
        const commentCount = item.metadata?.commentCount || 0;
        const timeAgo = formatRelativeTime(item.timestamp);
        const selected = compareSelections.has(item.id) ? 'checked' : '';
        const pinnedClass = item.pinned ? 'active' : '';
        const favoriteClass = item.favorite ? 'active' : '';

        const commentsLabel = t('options_history_comments', [String(Number(commentCount))]) || `${Number(commentCount)} comments`;
        const resendOptions = CHAT_PROVIDERS
            .map(provider => `<option value="${provider}">${escapeHtml(platformName(provider))}</option>`)
            .join('');
        const pinTitle = item.pinned ? (t('options_history_unpin') || 'Unpin') : (t('options_history_pin') || 'Pin');
        const favoriteTitle = item.favorite ? (t('options_history_unfavorite') || 'Remove from favorites') : (t('options_history_favorite') || 'Add to favorites');
        const exportTitle = t('options_title_export') || 'Export JSON';
        const deleteTitle = t('options_title_delete') || 'Delete';

        div.innerHTML = `
            <div class="history-item-header">
                <div class="history-item-title-row">
                    <span class="history-item-title" title="${escapeHtml(title)}">${escapeHtml(truncateText(title, 90))}</span>
                </div>
                <div class="history-badges">
                    <span class="history-badge">${escapeHtml(platformName(item.metadata?.aiProvider))}</span>
                    <span class="history-badge">${escapeHtml(presetName(item.metadata?.preset))}</span>
                </div>
            </div>
            <div class="history-item-meta">
                <span class="history-item-subreddit">r/${escapeHtml(subreddit)}</span>
                <span class="history-item-dot" aria-hidden="true">·</span>
                <span>${escapeHtml(timeAgo)}</span>
                <span class="history-item-dot" aria-hidden="true">·</span>
                <span>${escapeHtml(commentsLabel)}</span>
            </div>
            <div class="history-item-actions">
                <label class="history-compare-label">
                    <input type="checkbox" data-action="compare" ${selected}>
                    ${escapeHtml(t('options_history_compare') || 'Compare')}
                </label>
                <select class="ai-dropdown" data-action="resend" aria-label="${escapeHtml(t('options_label_resend') || 'Re-send to...')}">
                    <option value="" disabled selected>${escapeHtml(t('options_label_resend') || 'Re-send to...')}</option>
                    ${resendOptions}
                </select>
                <button type="button" class="btn-action history-icon-btn ${pinnedClass}" data-action="pin" title="${escapeHtml(pinTitle)}" aria-label="${escapeHtml(pinTitle)}" aria-pressed="${item.pinned ? 'true' : 'false'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 17v5"></path>
                        <path d="M9 10.76V4h6v6.76l3 3.24v2H6v-2z"></path>
                    </svg>
                </button>
                <button type="button" class="btn-action history-icon-btn ${favoriteClass}" data-action="favorite" title="${escapeHtml(favoriteTitle)}" aria-label="${escapeHtml(favoriteTitle)}" aria-pressed="${item.favorite ? 'true' : 'false'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </button>
                <button type="button" class="btn-action btn-icon-only" data-action="export" title="${escapeHtml(exportTitle)}" aria-label="${escapeHtml(exportTitle)}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
                <button type="button" class="btn-action btn-danger-outline btn-icon-only" data-action="delete" title="${escapeHtml(deleteTitle)}" aria-label="${escapeHtml(deleteTitle)}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;

        return div;
    }

    // The list only animates the first time it is shown; filtering and typing
    // re-render instantly. Stagger is capped at 8 items.
    let historyHasAnimated = false;
    const HISTORY_STAGGER_CAP = 8;

    function renderHistoryList() {
        const filtered = filterHistoryItems(fullHistory);

        if (historyCount) {
            const label = filtered.length === 1 ?
                (t('options_label_item') || 'item') :
                (t('options_label_items') || 'items');
            const suffix = filtered.length === fullHistory.length ? '' : ` / ${fullHistory.length}`;
            historyCount.textContent = `${filtered.length}${suffix} ${label}`;
        }

        if (clearHistoryBtn) {
            clearHistoryBtn.disabled = fullHistory.length === 0;
            clearHistoryBtn.title = fullHistory.length === 0 ? (t('options_history_empty') || 'No scraped threads yet') : '';
            if (fullHistory.length === 0 && clearHistoryConfirm) clearHistoryConfirm.hidden = true;
        }

        if (!historyList) return;
        if (filtered.length === 0) {
            const emptyText = fullHistory.length === 0
                ? (t('options_history_empty') || 'No scraped threads yet')
                : (t('options_history_no_match') || 'No history items match your filters');
            historyList.innerHTML = `
                <div class="empty-state">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>${escapeHtml(emptyText)}</span>
                </div>
            `;
            return;
        }

        const animate = !historyHasAnimated;
        historyHasAnimated = true;
        historyList.innerHTML = '';
        filtered.forEach((item, index) => {
            const el = renderHistoryItem(item);
            if (animate && index <= HISTORY_STAGGER_CAP) {
                el.classList.add('entering');
                el.style.setProperty('--i', String(index));
            }
            historyList.appendChild(el);
        });
    }

    function loadHistory() {
        chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
            if (chrome.runtime.lastError || response?.error) {
                console.error('Failed to load history:', response?.error || chrome.runtime.lastError);
                return;
            }
            fullHistory = response?.history || [];
            for (const id of [...compareSelections]) {
                if (!fullHistory.some(item => item.id === id)) compareSelections.delete(id);
            }
            renderHistoryList();
            updateCompareUi();
        });
    }

    [historySearch, historyProviderFilter, historyPresetFilter, historyDateFilter, historyMinComments].forEach((element) => {
        if (!element) return;
        element.addEventListener('input', renderHistoryList);
        element.addEventListener('change', renderHistoryList);
    });

    if (historyList) {
        historyList.addEventListener('change', (e) => {
            const compareBox = e.target.closest('input[data-action="compare"]');
            if (compareBox) {
                const historyItem = compareBox.closest('.history-item');
                const historyId = historyItem?.dataset.historyId;
                if (historyId) {
                    if (compareBox.checked) compareSelections.add(historyId);
                    else compareSelections.delete(historyId);
                    updateCompareUi();
                }
                return;
            }

            const dropdown = e.target.closest('.ai-dropdown');
            if (dropdown && dropdown.value) {
                const historyItem = dropdown.closest('.history-item');
                const historyId = historyItem?.dataset.historyId;
                const aiProvider = dropdown.value;

                if (historyId && aiProvider) {
                    dropdown.disabled = true;
                    setHistoryStatus(t('options_hist_opening_preview') || 'Opening preview for history item...');
                    chrome.runtime.sendMessage({
                        action: 'resendHistoryItem',
                        historyId,
                        aiProvider
                    }, (response) => {
                        dropdown.disabled = false;
                        if (chrome.runtime.lastError || response?.error) {
                            setHistoryStatus(`${t('options_hist_resend_failed') || 'Could not resend history item:'} ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                        } else {
                            setHistoryStatus(t('options_hist_preview_opened') || 'Preview opened for history item.', 'success');
                        }
                        dropdown.selectedIndex = 0;
                    });
                }
            }
        });

        historyList.addEventListener('click', (e) => {
            const button = e.target.closest('.btn-action');
            if (!button) return;

            const historyItem = button.closest('.history-item');
            const historyId = historyItem?.dataset.historyId;
            const action = button.dataset.action;
            if (!historyId) return;

            if (action === 'delete') {
                button.disabled = true;
                chrome.runtime.sendMessage({ action: 'deleteHistoryItem', historyId }, () => {
                    button.disabled = false;
                    if (chrome.runtime.lastError) {
                        setHistoryStatus(`${t('options_hist_delete_failed') || 'Could not delete history item:'} ${chrome.runtime.lastError.message}`, 'error');
                        return;
                    }
                    compareSelections.delete(historyId);
                    loadHistory();
                    setHistoryStatus(t('options_hist_deleted') || 'History item deleted.', 'success');
                    showSaveToast();
                });
            } else if (action === 'export') {
                button.disabled = true;
                chrome.runtime.sendMessage({ action: 'getHistoryItem', historyId }, (response) => {
                    button.disabled = false;
                    if (chrome.runtime.lastError || response?.error) {
                        setHistoryStatus(`${t('options_hist_export_failed') || 'Could not export history item:'} ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                        return;
                    }
                    if (response?.item) {
                        const data = response.item.rawData || response.item;
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        const filename = `reddit-thread-${response.item.post?.subreddit || 'unknown'}-${Date.now()}.json`;
                        a.href = url;
                        a.download = filename;
                        a.click();
                        URL.revokeObjectURL(url);
                        setHistoryStatus(t('options_hist_exported') || 'History item exported.', 'success');
                    }
                });
            } else if (action === 'pin' || action === 'favorite') {
                const item = fullHistory.find(historyItemData => historyItemData.id === historyId);
                if (!item) return;
                const property = action === 'pin' ? 'pinned' : 'favorite';
                const nextValue = !item[property];
                button.disabled = true;
                chrome.runtime.sendMessage({
                    action: 'updateHistoryItem',
                    historyId,
                    patch: { [property]: nextValue }
                }, (response) => {
                    button.disabled = false;
                    if (chrome.runtime.lastError || response?.error) {
                        setHistoryStatus(`${t('options_hist_update_failed') || 'Could not update history item:'} ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                        return;
                    }
                    if (response?.history) fullHistory = response.history;
                    renderHistoryList();
                    if (action === 'pin') {
                        setHistoryStatus(nextValue ? (t('options_hist_pinned') || 'History item pinned.') : (t('options_hist_unpinned') || 'History item unpinned.'), 'success');
                    } else {
                        setHistoryStatus(nextValue ? (t('options_hist_favorited') || 'History item favorited.') : (t('options_hist_unfavorited') || 'History item unfavorited.'), 'success');
                    }
                    showSaveToast();
                });
            }
        });
    }

    if (compareHistoryBtn) {
        compareHistoryBtn.addEventListener('click', () => {
            const historyIds = [...compareSelections];
            if (historyIds.length < 2) return;
            compareHistoryBtn.disabled = true;
            setHistoryStatus(t('options_hist_opening_compare') || 'Opening comparison preview...');
            chrome.runtime.sendMessage({ action: 'compareHistoryItems', historyIds }, (response) => {
                compareHistoryBtn.disabled = false;
                updateCompareUi();
                if (chrome.runtime.lastError || response?.error) {
                    setHistoryStatus(`${t('options_hist_compare_failed') || 'Could not compare history items:'} ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                    return;
                }
                setHistoryStatus(t('options_hist_compare_opened') || 'Comparison preview opened.', 'success');
                showSaveToast();
            });
        });
    }

    if (savedPresetList) {
        savedPresetList.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;
            const item = button.closest('.saved-preset-item');
            const presetId = item?.dataset.presetId;
            const preset = savedPromptPresets.find(saved => saved.id === presetId);
            if (!preset) return;

            if (button.dataset.action === 'apply') {
                applySavedPromptPreset(preset);
            } else if (button.dataset.action === 'export') {
                downloadJson(`reddit-to-ai-preset-${preset.name || 'preset'}-${Date.now()}.json`, preset);
                setInlineStatus(savedPresetStatus, t('options_preset_exported') || 'Preset exported.', 'success');
            } else if (button.dataset.action === 'delete') {
                persistSavedPromptPresets(savedPromptPresets.filter(saved => saved.id !== presetId));
                setInlineStatus(savedPresetStatus, t('options_preset_deleted') || 'Preset deleted.', 'success');
            }
        });
    }

    if (exportSavedPresetsBtn) {
        exportSavedPresetsBtn.addEventListener('click', () => {
            downloadJson(`reddit-to-ai-prompt-presets-${Date.now()}.json`, savedPromptPresets);
            setInlineStatus(savedPresetStatus, t('options_presets_exported') || 'Presets exported.', 'success');
        });
    }

    if (importSavedPresetsBtn && importSavedPresetsInput) {
        importSavedPresetsBtn.addEventListener('click', () => importSavedPresetsInput.click());
        importSavedPresetsInput.addEventListener('change', (e) => {
            readJsonFile(e.target.files?.[0], (payload) => {
                const incoming = Array.isArray(payload) ? payload : payload?.presets;
                if (!Array.isArray(incoming)) {
                    setInlineStatus(savedPresetStatus, t('options_import_no_presets') || 'That file does not contain prompt presets.', 'error');
                    return;
                }
                const normalized = incoming
                    .filter(item => item && typeof item.template === 'string')
                    .map(item => ({ ...item, id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }));
                if (normalized.length === 0) {
                    setInlineStatus(savedPresetStatus, t('options_import_no_presets') || 'That file does not contain prompt presets.', 'error');
                    return;
                }
                persistSavedPromptPresets([...normalized, ...savedPromptPresets].slice(0, 50));
                setInlineStatus(savedPresetStatus, t('options_presets_imported', [String(normalized.length)]) || `Imported ${normalized.length} preset(s).`, 'success');
            }, savedPresetStatus);
            e.target.value = '';
        });
    }

    if (exportSettingsBtn) {
        exportSettingsBtn.addEventListener('click', exportSettings);
    }

    if (importSettingsBtn && importSettingsInput) {
        importSettingsBtn.addEventListener('click', () => importSettingsInput.click());
        importSettingsInput.addEventListener('change', (e) => {
            readJsonFile(e.target.files?.[0], importSettings, settingsTransferStatus);
            e.target.value = '';
        });
    }

    showPendingImportStatus();

    bindInlineConfirm(clearSavedPresetsBtn, clearSavedPresetsConfirm, () => {
        persistSavedPromptPresets([]);
        setInlineStatus(savedPresetStatus, t('options_presets_cleared') || 'All saved presets deleted.', 'success');
        clearSavedPresetsBtn?.focus();
    });

    bindInlineConfirm(clearHistoryBtn, clearHistoryConfirm, () => {
        clearHistoryBtn.disabled = true;
        chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
            clearHistoryBtn.disabled = false;
            if (chrome.runtime.lastError) {
                setHistoryStatus(`${t('options_hist_clear_failed') || 'Could not clear scrape history:'} ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            compareSelections.clear();
            loadHistory();
            updateCompareUi();
            setHistoryStatus(t('options_hist_cleared') || 'Scrape history cleared.', 'success');
            showSaveToast();
        });
    });

    // =====================
    // Direct API keys
    // =====================
    //
    // Keys are read from and written to chrome.storage.local exclusively. They are
    // deliberately absent from PORTABLE_SETTING_TYPES, so exportSettings (which only
    // walks that allowlist against chrome.storage.sync) can never emit them, and
    // importSettings drops the key if a crafted import file contains one.

    const apiProviderList = document.getElementById('apiProviderList');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    const DIRECT_API_CONFIG_KEY = 'directApiConfig';

    function setApiKeyStatus(message, type = '') {
        if (!apiKeyStatus) return;
        apiKeyStatus.textContent = message;
        apiKeyStatus.classList.toggle('error', type === 'error');
        apiKeyStatus.classList.toggle('success', type === 'success');
    }

    function saveDirectApiConfig(provider, patch) {
        chrome.storage.local.get([DIRECT_API_CONFIG_KEY], (result) => {
            const config = (result && typeof result[DIRECT_API_CONFIG_KEY] === 'object' && result[DIRECT_API_CONFIG_KEY])
                ? result[DIRECT_API_CONFIG_KEY]
                : {};
            const next = { ...config, [provider]: { ...(config[provider] || {}), ...patch } };
            chrome.storage.local.set({ [DIRECT_API_CONFIG_KEY]: next }, () => {
                if (chrome.runtime.lastError) {
                    setApiKeyStatus(`Could not save: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                showSaveToast();
            });
        });
    }

    function buildApiProviderRow(definition, stored) {
        const row = document.createElement('div');
        row.className = 'api-provider-row';

        const heading = document.createElement('h3');
        heading.className = 'api-provider-name';
        heading.textContent = definition.label;
        row.appendChild(heading);

        // --- API key field (password type, with a show/hide toggle) ---
        const keyGroup = document.createElement('div');
        keyGroup.className = 'form-group';
        const keyLabel = document.createElement('label');
        keyLabel.className = 'form-label';
        keyLabel.setAttribute('for', `apiKey_${definition.id}`);
        keyLabel.textContent = t('options_direct_api_key_label') || 'API key';
        keyGroup.appendChild(keyLabel);

        const keyRow = document.createElement('div');
        keyRow.className = 'api-key-row';
        const keyInput = document.createElement('input');
        keyInput.type = 'password';
        keyInput.id = `apiKey_${definition.id}`;
        keyInput.className = 'search-input';
        keyInput.autocomplete = 'off';
        keyInput.spellcheck = false;
        keyInput.placeholder = t('options_direct_api_key_placeholder') || 'Paste your API key';
        keyInput.value = stored.apiKey || '';
        keyRow.appendChild(keyInput);

        const revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = 'btn-action';
        revealBtn.textContent = t('options_direct_api_show') || 'Show';
        revealBtn.addEventListener('click', () => {
            const hidden = keyInput.type === 'password';
            keyInput.type = hidden ? 'text' : 'password';
            revealBtn.textContent = hidden
                ? (t('options_direct_api_hide') || 'Hide')
                : (t('options_direct_api_show') || 'Show');
        });
        keyRow.appendChild(revealBtn);
        keyGroup.appendChild(keyRow);
        row.appendChild(keyGroup);

        // --- Model field: free text, prefilled with the current default ---
        const modelGroup = document.createElement('div');
        modelGroup.className = 'form-group';
        const modelLabel = document.createElement('label');
        modelLabel.className = 'form-label';
        modelLabel.setAttribute('for', `apiModel_${definition.id}`);
        modelLabel.textContent = t('options_direct_api_model_label') || 'Model';
        modelGroup.appendChild(modelLabel);

        const modelInput = document.createElement('input');
        modelInput.type = 'text';
        modelInput.id = `apiModel_${definition.id}`;
        modelInput.className = 'search-input';
        modelInput.spellcheck = false;
        modelInput.placeholder = definition.defaultModel;
        modelInput.value = stored.model || definition.defaultModel;
        modelGroup.appendChild(modelInput);

        const modelHint = document.createElement('span');
        modelHint.className = 'form-hint';
        // Free text rather than a <select> so a newly released model id works without
        // waiting for an extension update.
        modelHint.textContent = `${t('options_direct_api_model_hint') || 'Any model id this provider accepts.'} ${definition.suggestedModels.join(', ')}`;
        modelGroup.appendChild(modelHint);
        row.appendChild(modelGroup);

        // --- Test button ---
        const actions = document.createElement('div');
        actions.className = 'api-provider-actions';
        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'btn-action';
        testBtn.textContent = t('options_direct_api_test') || 'Test key';
        testBtn.addEventListener('click', () => {
            const apiKey = keyInput.value.trim();
            if (!apiKey) {
                setApiKeyStatus(t('options_direct_api_test_no_key') || 'Enter an API key first.', 'error');
                return;
            }
            testBtn.disabled = true;
            setApiKeyStatus(`${t('options_direct_api_testing') || 'Testing'} ${definition.label}…`);
            chrome.runtime.sendMessage({
                action: 'testDirectApiKey',
                apiProvider: definition.id,
                apiKey,
                model: modelInput.value.trim()
            }, (response) => {
                testBtn.disabled = false;
                if (chrome.runtime.lastError || response?.error || !response?.success) {
                    const message = response?.error || chrome.runtime.lastError?.message || 'Unknown error';
                    setApiKeyStatus(`${definition.label}: ${message}`, 'error');
                    return;
                }
                setApiKeyStatus(
                    `${definition.label}: ${t('options_direct_api_test_ok') || 'Key works.'} (${response.model})`,
                    'success'
                );
            });
        });
        actions.appendChild(testBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn-action btn-danger-outline';
        clearBtn.textContent = t('options_direct_api_clear') || 'Remove key';
        clearBtn.addEventListener('click', () => {
            keyInput.value = '';
            saveDirectApiConfig(definition.id, { apiKey: '' });
            setApiKeyStatus(`${definition.label}: ${t('options_direct_api_cleared') || 'Key removed.'}`, 'success');
        });
        actions.appendChild(clearBtn);
        row.appendChild(actions);

        // Persist on blur rather than on every keystroke, so a partially pasted key
        // is not written repeatedly.
        keyInput.addEventListener('change', () => saveDirectApiConfig(definition.id, { apiKey: keyInput.value.trim() }));
        modelInput.addEventListener('change', () => saveDirectApiConfig(definition.id, { model: modelInput.value.trim() }));

        return row;
    }

    function renderDirectApiSection() {
        if (!apiProviderList || typeof R2AIApiProviders === 'undefined') return;
        chrome.storage.local.get([DIRECT_API_CONFIG_KEY], (result) => {
            const config = (result && typeof result[DIRECT_API_CONFIG_KEY] === 'object' && result[DIRECT_API_CONFIG_KEY])
                ? result[DIRECT_API_CONFIG_KEY]
                : {};
            apiProviderList.innerHTML = '';
            R2AIApiProviders.PROVIDER_IDS.forEach(id => {
                const definition = R2AIApiProviders.PROVIDERS[id];
                apiProviderList.appendChild(buildApiProviderRow(definition, config[id] || {}));
            });
        });
    }

    renderDirectApiSection();

    // Initial history load
    loadHistory();
    loadSavedPromptPresets();

    console.log("Options: Initialization complete.");
}

window.initializeOptions = initializeOptions;
