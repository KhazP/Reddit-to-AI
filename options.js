// Reddit to AI - Options Page Script

// Localized helpers are now provided by i18n.js

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

    // Element references
    const saveStatusDisplay = document.getElementById('saveStatus');
    const showNotificationsCheckbox = document.getElementById('showNotifications');
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
    const authorTypeRadios = document.querySelectorAll('input[name="filterAuthorType"]');

    // Legacy element references
    const llmProviderSelect = document.getElementById('llmProviderSelect');

    // History element references
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');
    const historyLimitInput = document.getElementById('historyLimit');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    // Language element reference
    const languageSelect = document.getElementById('languageSelect');


    const DEFAULT_DEPTH = 5;
    const DEFAULT_DATA_STORAGE_OPTION = 'persistent';
    const DEFAULT_LLM_PROVIDER = 'gemini';
    const DEFAULT_PRESET = 'summarize';
    const DEFAULT_LANGUAGE = 'auto';


    // Current state
    let currentPreset = DEFAULT_PRESET;

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
        'filterHideBots',
        'selectedLanguage'
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

        // Author type radio
        const authorType = result.filterAuthorType || 'all';
        authorTypeRadios.forEach(radio => {
            radio.checked = radio.value === authorType;
        });

        // Language setting
        if (languageSelect) {
            languageSelect.value = savedLanguage;
        }
    });

    // Event listeners

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

    // Author type radios
    authorTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                chrome.storage.sync.set({ filterAuthorType: e.target.value }, showSaveToast);
            }
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

    // Format relative time (e.g., "2h ago")
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

    // Truncate text
    function truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.slice(0, maxLength - 3) + '...';
    }

    // Render a single history item
    function renderHistoryItem(item) {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.dataset.historyId = item.id;

        const title = item.post?.title || 'Untitled Thread';
        const subreddit = item.post?.subreddit || 'unknown';
        const commentCount = item.metadata?.commentCount || 0;
        const timeAgo = formatRelativeTime(item.timestamp);

        div.innerHTML = `
            <div class="history-item-header">
                <span class="history-item-title">${truncateText(title, 80)}</span>
            </div>
            <div class="history-item-meta">
                <span class="history-item-subreddit">r/${subreddit}</span>
                <span class="history-item-dot">•</span>
                <span>${timeAgo}</span>
                <span class="history-item-dot">•</span>
                <span>${commentCount} comments</span>
            </div>
            <div class="history-item-actions">
                <select class="ai-dropdown" data-action="resend">
                    <option value="" disabled selected>${t('options_label_resend') || 'Re-send to...'}</option>
                    <option value="gemini">Gemini</option>
                    <option value="chatgpt">ChatGPT</option>
                    <option value="claude">Claude</option>
                    <option value="aistudio">AI Studio</option>
                </select>
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

    // Load and display history
    function loadHistory() {
        chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
            if (chrome.runtime.lastError || response?.error) {
                console.error('Failed to load history:', response?.error || chrome.runtime.lastError);
                return;
            }

            const history = response?.history || [];

            // Update count
            if (historyCount) {
                const label = history.length === 1 ?
                    (t('options_label_item') || 'item') :
                    (t('options_label_items') || 'items');
                historyCount.innerHTML = `${history.length} <span data-i18n="options_label_items">${label}</span>`;
            }

            // Update clear button
            if (clearHistoryBtn) {
                clearHistoryBtn.disabled = history.length === 0;
            }

            // Render list
            if (historyList) {
                if (history.length === 0) {
                    historyList.innerHTML = `
                        <div class="history-empty">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            <span data-i18n="options_history_empty">${t('options_history_empty') || 'No scraped threads yet'}</span>
                        </div>
                    `;
                } else {
                    historyList.innerHTML = '';
                    history.forEach((item, index) => {
                        const el = renderHistoryItem(item);
                        el.classList.add('entering');
                        el.style.animationDelay = `${index * 0.05}s`;
                        historyList.appendChild(el);
                    });
                }
            }
        });
    }

    // Handle history item actions (delegated)
    if (historyList) {
        historyList.addEventListener('change', (e) => {
            const dropdown = e.target.closest('.ai-dropdown');
            if (dropdown && dropdown.value) {
                const historyItem = dropdown.closest('.history-item');
                const historyId = historyItem?.dataset.historyId;
                const aiProvider = dropdown.value;

                if (historyId && aiProvider) {
                    chrome.runtime.sendMessage({
                        action: 'resendHistoryItem',
                        historyId,
                        aiProvider
                    }, (response) => {
                        if (response?.error) {
                            console.error('Resend failed:', response.error);
                        }
                        // Reset dropdown
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
                chrome.runtime.sendMessage({
                    action: 'deleteHistoryItem',
                    historyId
                }, () => {
                    loadHistory();
                    showSaveToast();
                });
            } else if (action === 'export') {
                chrome.runtime.sendMessage({
                    action: 'getHistoryItem',
                    historyId
                }, (response) => {
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
                    }
                });
            }
        });
    }

    // Clear all history
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm(t('options_confirm_clear') || 'Clear all scrape history? This cannot be undone.')) {

                chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
                    loadHistory();
                    showSaveToast();
                });
            }
        });
    }

    // Initial history load
    loadHistory();

    console.log("Options: Initialization complete.");
}

window.initializeOptions = initializeOptions;
