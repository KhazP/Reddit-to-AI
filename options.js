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
});

async function initializeOptions() {
    console.log("Options: Initializing...");
    let customSelectorsCache = {};

    // Element references
    const saveStatusDisplay = document.getElementById('saveStatus');
    const showNotificationsCheckbox = document.getElementById('showNotifications');
    const showPromptPreviewCheckbox = document.getElementById('showPromptPreview');
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
    const filterAuthorAll = document.getElementById('filterAuthorAll');
    const filterAuthorOp = document.getElementById('filterAuthorOp');
    const filterAuthorFlaired = document.getElementById('filterAuthorFlaired');

    // Legacy element references
    const llmProviderSelect = document.getElementById('llmProviderSelect');

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

    // Show save toast
    function showSaveToast() {
        if (saveStatusDisplay) {
            saveStatusDisplay.textContent = '✓ Saved';
            saveStatusDisplay.classList.add('visible');
            setTimeout(() => {
                saveStatusDisplay.classList.remove('visible');
            }, 2000);
        }
    }

    function setHistoryStatus(message, type = '') {
        if (!historyStatus) return;
        historyStatus.textContent = message;
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
            pill.innerHTML = `
                <span class="preset-pill-icon">${preset.icon}</span>
                <span class="preset-pill-name">${preset.name}</span>
                <span class="preset-pill-desc">· ${preset.description}</span>
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
            pill.classList.toggle('selected', pill.dataset.preset === presetKey);
        });

        document.querySelectorAll('.preset-pill').forEach(pill => {
            pill.classList.toggle('selected', pill.dataset.preset === presetKey);
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
                defaultPromptTemplateTextarea.readOnly = false;
                defaultPromptTemplateTextarea.classList.remove('readonly');
            } else {
                defaultPromptTemplateTextarea.value = preset.template;
                defaultPromptTemplateTextarea.readOnly = true;
                defaultPromptTemplateTextarea.classList.add('readonly');
            }
        }

        // Update label and reset button
        if (templateLabel) {
            templateLabel.textContent = isCustom ?
                (t('options_label_custom_template') || 'Custom Template') :
                (t('options_label_template_preview') || 'Template Preview');
        }
        if (resetCustomBtn) {
            resetCustomBtn.style.display = isCustom ? 'inline' : 'none';
        }

        // Save selected preset
        chrome.storage.sync.set({ selectedPreset: presetKey }, showSaveToast);

        // Also update the effective prompt template for use during scraping
        const effectiveTemplate = isCustom ?
            (defaultPromptTemplateTextarea?.value || DEFAULT_CUSTOM_TEMPLATE) :
            preset.template;
        chrome.storage.sync.set({ defaultPromptTemplate: effectiveTemplate });
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
        'selectedLanguage',
        'customSelectors'
    ], async (result) => {
        console.log("Options: Loaded settings:", result);

        // Load language first
        const savedLanguage = result.selectedLanguage || DEFAULT_LANGUAGE;
        await loadLanguage(savedLanguage);

        // Now localize page with loaded language
        localizeHtmlPage();

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
            if (isCustom) {
                defaultPromptTemplateTextarea.value = result.customPromptTemplate || DEFAULT_CUSTOM_TEMPLATE;
                defaultPromptTemplateTextarea.readOnly = false;
                defaultPromptTemplateTextarea.classList.remove('readonly');
            } else {
                defaultPromptTemplateTextarea.value = preset.template;
                defaultPromptTemplateTextarea.readOnly = true;
                defaultPromptTemplateTextarea.classList.add('readonly');
            }
        }

        if (templateLabel) {
            templateLabel.textContent = isCustom ?
                (t('options_label_custom_template') || 'Custom Template') :
                (t('options_label_template_preview') || 'Template Preview');
        }
        if (resetCustomBtn) {
            resetCustomBtn.style.display = isCustom ? 'inline' : 'none';
        }

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
        if (llmProviderSelect) {
            llmProviderSelect.value = selectedProvider;
        }
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
        origins.forEach(origin => {
            const li = document.createElement('li');
            li.className = 'custom-origin-item';
            li.innerHTML = `
                <span class="custom-origin-text">${escapeHtml(origin)}</span>
                <button type="button" class="btn-action btn-danger-outline remove-custom-origin" data-origin="${escapeHtml(origin)}" title="Remove platform and revoke permission" style="padding: 4px 8px; font-size: 11px;">
                    Remove
                </button>
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
            if (!val) return;
            
            let originUrl;
            try {
                originUrl = new URL(val);
            } catch (e) {
                // Try prepending protocol if raw domain/IP is passed
                try {
                    originUrl = new URL('http://' + val);
                } catch (err) {
                    alert('Invalid URL or Origin');
                    return;
                }
            }
            
            const originMatch = `${originUrl.protocol}//${originUrl.host}/*`;
            
            chrome.permissions.request({ origins: [originMatch] }, (granted) => {
                if (chrome.runtime.lastError) {
                    alert('Error requesting permission: ' + chrome.runtime.lastError.message);
                    return;
                }
                if (granted) {
                    chrome.storage.sync.get(['customOrigins'], (res) => {
                        const origins = res.customOrigins || [];
                        if (!origins.includes(originMatch)) {
                            origins.push(originMatch);
                            chrome.storage.sync.set({ customOrigins: origins }, () => {
                                renderCustomOrigins(origins);
                                customOriginInput.value = '';
                                showSaveToast();
                                chrome.runtime.sendMessage({ action: 'registerCustomOrigin', origin: originMatch });
                            });
                        }
                    });
                } else {
                    alert('Permission not granted. Custom platform cannot be added without permission.');
                }
            });
        });
    }

    // Remove custom origin
    if (customOriginsList) {
        customOriginsList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-custom-origin');
            if (!btn) return;
            const origin = btn.dataset.origin;
            
            chrome.permissions.remove({ origins: [origin] }, (removed) => {
                chrome.storage.sync.get(['customOrigins'], (res) => {
                    const origins = res.customOrigins || [];
                    const updated = origins.filter(o => o !== origin);
                    chrome.storage.sync.set({ customOrigins: updated }, () => {
                        renderCustomOrigins(updated);
                        showSaveToast();
                        chrome.runtime.sendMessage({ action: 'unregisterCustomOrigin', origin });
                    });
                });
            });
        });
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

    if (showPromptPreviewCheckbox) {
        showPromptPreviewCheckbox.addEventListener('change', (e) => {
            chrome.storage.sync.set({ showPromptPreview: e.target.checked }, showSaveToast);
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
            renderPresetSelector(); // Update preset names/descriptions
            selectPreset(currentPreset); // Update template labels
            loadHistory(); // Update history relative times and labels

            showSaveToast();

            // 4. Show reload hint only if we can't fully hot-swap something (e.g. if we missed something)
            // But we try to do it all. Still good to remind if deep integration issues exist.
            const hint = languageSelect.parentElement?.querySelector('.form-hint');
            if (hint) {
                // We updated instant reload, so we can change the message or keep the localized one
                // hinting that "Some changes might require reload".
                // For now, let's keep the user feedback simple.
                hint.style.color = '#10b981'; // Green for success
                hint.textContent = t('options_toast_saved') || 'Saved and applied!';
                setTimeout(() => {
                    hint.style.color = '';
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
                if (llmProviderSelect) {
                    llmProviderSelect.value = e.target.value;
                }
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
            filterMinScoreSlider.value = Math.min(100, val);
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
        if (filterAuthorAll) filterAuthorAll.checked = types.length === 0;
        if (filterAuthorOp) filterAuthorOp.checked = types.includes('op');
        if (filterAuthorFlaired) filterAuthorFlaired.checked = types.includes('flaired');
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

    if (filterAuthorAll) {
        filterAuthorAll.addEventListener('change', () => {
            if (filterAuthorAll.checked) {
                saveAuthorFilters([]);
            } else if (!filterAuthorOp?.checked && !filterAuthorFlaired?.checked) {
                filterAuthorAll.checked = true;
            }
        });
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

    function platformName(provider) {
        return ({ gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio' }[provider]) || provider || 'AI';
    }

    function presetName(preset) {
        const presets = getPromptPresets();
        return presets[preset]?.name || preset || 'Preset';
    }

    function updateCompareUi() {
        const count = compareSelections.size;
        if (compareSelectedCount) {
            compareSelectedCount.textContent = `${count} selected for compare`;
        }
        if (compareHistoryBtn) {
            compareHistoryBtn.disabled = count < 2;
        }
    }

    function formatPresetDate(timestamp) {
        if (!timestamp) return 'Unknown date';
        return new Date(timestamp).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function renderSavedPromptPresets() {
        if (savedPresetCount) {
            const label = savedPromptPresets.length === 1 ? 'item' : 'items';
            savedPresetCount.textContent = `${savedPromptPresets.length} ${label}`;
        }
        if (exportSavedPresetsBtn) exportSavedPresetsBtn.disabled = savedPromptPresets.length === 0;
        if (clearSavedPresetsBtn) clearSavedPresetsBtn.disabled = savedPromptPresets.length === 0;
        if (!savedPresetList) return;

        if (savedPromptPresets.length === 0) {
            savedPresetList.innerHTML = `
                <div class="history-empty">
                    <span>No saved prompt presets yet</span>
                </div>
            `;
            return;
        }

        savedPresetList.innerHTML = '';
        savedPromptPresets.forEach((preset) => {
            const item = document.createElement('div');
            item.className = 'saved-preset-item';
            item.dataset.presetId = preset.id;
            item.innerHTML = `
                <div class="saved-preset-main">
                    <strong>${escapeHtml(preset.name || 'Untitled preset')}</strong>
                    <span>${escapeHtml(formatPresetDate(preset.createdAt))} · ${escapeHtml(preset.contextPreset || 'balanced')} · ${escapeHtml(preset.trimStrategy || 'top')}</span>
                </div>
                <div class="saved-preset-controls">
                    <button type="button" class="btn-action" data-action="apply">Use</button>
                    <button type="button" class="btn-action btn-export" data-action="export">Export</button>
                    <button type="button" class="btn-action btn-danger-outline" data-action="delete">Delete</button>
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

    function readJsonFile(file, callback) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                callback(JSON.parse(String(reader.result || 'null')));
            } catch (error) {
                alert(`Could not import JSON: ${error.message}`);
            }
        };
        reader.readAsText(file);
    }

    function exportSettings() {
        const keys = [
            'scrapeDepth',
            'showNotifications',
            'showPromptPreview',
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
            'selectedLanguage',
            'savedPromptPresets',
            'customSelectors'
        ];
        chrome.storage.sync.get(keys, (settings) => {
            downloadJson(`reddit-to-ai-settings-${Date.now()}.json`, {
                exportedAt: new Date().toISOString(),
                settings
            });
        });
    }

    function importSettings(payload) {
        const settings = payload?.settings && typeof payload.settings === 'object' ? payload.settings : payload;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            alert('Imported file does not contain settings.');
            return;
        }
        chrome.storage.sync.set(settings, () => {
            showSaveToast();
            initializeOptions();
        });
    }

    function applySavedPromptPreset(preset) {
        if (!preset?.template) return;
        currentPreset = 'custom';
        if (defaultPromptTemplateTextarea) {
            defaultPromptTemplateTextarea.value = preset.template;
            defaultPromptTemplateTextarea.readOnly = false;
            defaultPromptTemplateTextarea.classList.remove('readonly');
        }
        if (templateLabel) templateLabel.textContent = t('options_label_custom_template') || 'Custom Template';
        if (resetCustomBtn) resetCustomBtn.style.display = 'inline';
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

        div.innerHTML = `
            <div class="history-item-header">
                <div class="history-item-title-row">
                    <span class="history-item-title">${escapeHtml(truncateText(title, 90))}</span>
                </div>
                <div class="history-badges">
                    <span class="history-badge">${escapeHtml(platformName(item.metadata?.aiProvider))}</span>
                    <span class="history-badge">${escapeHtml(presetName(item.metadata?.preset))}</span>
                </div>
            </div>
            <div class="history-item-meta">
                <span class="history-item-subreddit">r/${escapeHtml(subreddit)}</span>
                <span class="history-item-dot">•</span>
                <span>${escapeHtml(timeAgo)}</span>
                <span class="history-item-dot">•</span>
                <span>${Number(commentCount)} comments</span>
                <span class="history-item-dot">•</span>
                <span>${escapeHtml(item.metadata?.contextPreset || 'balanced')}</span>
            </div>
            <div class="history-item-actions">
                <label class="history-compare-label">
                    <input type="checkbox" data-action="compare" ${selected}>
                    Compare
                </label>
                <select class="ai-dropdown" data-action="resend">
                    <option value="" disabled selected>${t('options_label_resend') || 'Re-send to...'}</option>
                    <option value="gemini">Gemini</option>
                    <option value="chatgpt">ChatGPT</option>
                    <option value="claude">Claude</option>
                    <option value="aistudio">AI Studio</option>
                </select>
                <button type="button" class="btn-action history-icon-btn ${pinnedClass}" data-action="pin" title="Pin/unpin">📌</button>
                <button type="button" class="btn-action history-icon-btn ${favoriteClass}" data-action="favorite" title="Favorite/unfavorite">★</button>
                <button type="button" class="btn-action btn-export btn-icon-only" data-action="export" title="Export JSON">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
                <button type="button" class="btn-action btn-danger-outline btn-icon-only" data-action="delete" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;

        return div;
    }

    function renderHistoryList() {
        const filtered = filterHistoryItems(fullHistory);

        if (historyCount) {
            const label = filtered.length === 1 ?
                (t('options_label_item') || 'item') :
                (t('options_label_items') || 'items');
            const suffix = filtered.length === fullHistory.length ? '' : ` / ${fullHistory.length}`;
            historyCount.innerHTML = `${filtered.length}${suffix} <span data-i18n="options_label_items">${label}</span>`;
        }

        if (clearHistoryBtn) {
            clearHistoryBtn.disabled = fullHistory.length === 0;
        }

        if (!historyList) return;
        if (filtered.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>${fullHistory.length === 0 ? (t('options_history_empty') || 'No scraped threads yet') : 'No history items match your filters'}</span>
                </div>
            `;
            return;
        }

        historyList.innerHTML = '';
        filtered.forEach((item, index) => {
            const el = renderHistoryItem(item);
            el.classList.add('entering');
            el.style.animationDelay = `${index * 0.03}s`;
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
                    setHistoryStatus('Opening preview for history item...');
                    chrome.runtime.sendMessage({
                        action: 'resendHistoryItem',
                        historyId,
                        aiProvider
                    }, (response) => {
                        dropdown.disabled = false;
                        if (chrome.runtime.lastError || response?.error) {
                            setHistoryStatus(`Could not resend history item: ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                        } else {
                            setHistoryStatus('Preview opened for history item.', 'success');
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
                        setHistoryStatus(`Could not delete history item: ${chrome.runtime.lastError.message}`, 'error');
                        return;
                    }
                    compareSelections.delete(historyId);
                    loadHistory();
                    setHistoryStatus('History item deleted.', 'success');
                    showSaveToast();
                });
            } else if (action === 'export') {
                button.disabled = true;
                chrome.runtime.sendMessage({ action: 'getHistoryItem', historyId }, (response) => {
                    button.disabled = false;
                    if (chrome.runtime.lastError || response?.error) {
                        setHistoryStatus(`Could not export history item: ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
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
                        setHistoryStatus('History item exported.', 'success');
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
                        setHistoryStatus(`Could not update history item: ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                        return;
                    }
                    if (response?.history) fullHistory = response.history;
                    renderHistoryList();
                    if (action === 'pin') {
                        setHistoryStatus(nextValue ? 'History item pinned.' : 'History item unpinned.', 'success');
                    } else {
                        setHistoryStatus(nextValue ? 'History item favorited.' : 'History item unfavorited.', 'success');
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
            setHistoryStatus('Opening comparison preview...');
            chrome.runtime.sendMessage({ action: 'compareHistoryItems', historyIds }, (response) => {
                compareHistoryBtn.disabled = false;
                updateCompareUi();
                if (chrome.runtime.lastError || response?.error) {
                    setHistoryStatus(`Could not compare history items: ${getRuntimeErrorMessage(response, 'Unknown error')}`, 'error');
                    return;
                }
                setHistoryStatus('Comparison preview opened.', 'success');
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
            } else if (button.dataset.action === 'delete') {
                persistSavedPromptPresets(savedPromptPresets.filter(saved => saved.id !== presetId));
            }
        });
    }

    if (exportSavedPresetsBtn) {
        exportSavedPresetsBtn.addEventListener('click', () => {
            downloadJson(`reddit-to-ai-prompt-presets-${Date.now()}.json`, savedPromptPresets);
        });
    }

    if (importSavedPresetsBtn && importSavedPresetsInput) {
        importSavedPresetsBtn.addEventListener('click', () => importSavedPresetsInput.click());
        importSavedPresetsInput.addEventListener('change', (e) => {
            readJsonFile(e.target.files?.[0], (payload) => {
                const incoming = Array.isArray(payload) ? payload : payload?.presets;
                if (!Array.isArray(incoming)) {
                    alert('Imported file does not contain prompt presets.');
                    return;
                }
                const normalized = incoming
                    .filter(item => item && typeof item.template === 'string')
                    .map(item => ({ ...item, id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }));
                persistSavedPromptPresets([...normalized, ...savedPromptPresets].slice(0, 50));
            });
            e.target.value = '';
        });
    }

    if (exportSettingsBtn) {
        exportSettingsBtn.addEventListener('click', exportSettings);
    }

    if (importSettingsBtn && importSettingsInput) {
        importSettingsBtn.addEventListener('click', () => importSettingsInput.click());
        importSettingsInput.addEventListener('change', (e) => {
            readJsonFile(e.target.files?.[0], importSettings);
            e.target.value = '';
        });
    }

    if (clearSavedPresetsBtn) {
        clearSavedPresetsBtn.addEventListener('click', () => {
            if (confirm('Clear all saved prompt presets? This cannot be undone.')) {
                persistSavedPromptPresets([]);
            }
        });
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm(t('options_confirm_clear') || 'Clear all scrape history? This cannot be undone.')) {
                clearHistoryBtn.disabled = true;
                chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
                    clearHistoryBtn.disabled = false;
                    if (chrome.runtime.lastError) {
                        setHistoryStatus(`Could not clear scrape history: ${chrome.runtime.lastError.message}`, 'error');
                        return;
                    }
                    compareSelections.clear();
                    loadHistory();
                    updateCompareUi();
                    setHistoryStatus('Scrape history cleared.', 'success');
                    showSaveToast();
                });
            }
        });
    }

    // Initial history load
    loadHistory();
    loadSavedPromptPresets();

    console.log("Options: Initialization complete.");
}

window.initializeOptions = initializeOptions;
