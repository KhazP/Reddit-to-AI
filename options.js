document.addEventListener('DOMContentLoaded', () => {
    console.log("options.js DOM loaded");
    if (typeof window.initializeOptions === 'function') {
        window.initializeOptions(); // Ensure options are initialized when page loads directly
    }
});

// Defined in global scope to ensure it's accessible from popup.js
window.initializeOptions = function() {
    console.log("initializeOptions called");
    const originalAttemptsSlider = document.getElementById('loadMoreAttempts');
    const attemptsValueDisplay = document.getElementById('attemptsValue');
    const saveStatusDisplay = document.getElementById('saveStatus');
    const aiModelSelect = document.getElementById('aiModelSelect'); // Old element
    const showNotificationsCheckbox = document.getElementById('showNotifications');
    const defaultPromptTemplateTextarea = document.getElementById('defaultPromptTemplate');
    const dataStorageDontSaveRadio = document.getElementById('dataStorageDontSave');
    const dataStorageSessionOnlyRadio = document.getElementById('dataStorageSessionOnly');
    const dataStoragePersistentRadio = document.getElementById('dataStoragePersistent');

    // New UI elements for background summarization
    const llmProviderSelect = document.getElementById('llmProviderSelect');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const modelNameInput = document.getElementById('modelNameInput');

    if (!originalAttemptsSlider || !attemptsValueDisplay || !showNotificationsCheckbox ||
        !defaultPromptTemplateTextarea || !dataStorageDontSaveRadio || !dataStorageSessionOnlyRadio || !dataStoragePersistentRadio ||
        !llmProviderSelect || !apiKeyInput || !modelNameInput) { // Added checks for new elements
        console.warn("Required UI elements not found. Check IDs and HTML structure.", {
            attemptsSlider: !!originalAttemptsSlider,
            attemptsValueDisplay: !!attemptsValueDisplay,
            saveStatusDisplay: !!saveStatusDisplay,
            // aiModelSelect: !!aiModelSelect, // This is now hidden, so less critical if it's not found for the new logic
            showNotificationsCheckbox: !!showNotificationsCheckbox,
            defaultPromptTemplateTextarea: !!defaultPromptTemplateTextarea,
            llmProviderSelect: !!llmProviderSelect,
            apiKeyInput: !!apiKeyInput,
            modelNameInput: !!modelNameInput,
            dataStorageDontSaveRadio: !!dataStorageDontSaveRadio,
            dataStorageSessionOnlyRadio: !!dataStorageSessionOnlyRadio,
            dataStoragePersistentRadio: !!dataStoragePersistentRadio,
        });
        return;
    }

    // Clone the slider and replace it in the DOM *before* loading settings or attaching main listeners.
    // This ensures that the element we set the value on is the same one with the listeners.
    const attemptsSlider = originalAttemptsSlider.cloneNode(true);
    originalAttemptsSlider.parentNode.replaceChild(attemptsSlider, originalAttemptsSlider);
    console.log("Replaced slider element FIRST to ensure value loading and listeners are on the correct element.");

    console.log("UI elements found/prepared, continuing initialization");
    const DEFAULT_ATTEMPTS = 75;
    const MAX_STEPS_LIMIT = 500;

    // AI Model Configurations (Old - for tab opening - keep for now if other parts rely on it, but disable UI interaction)
    // const aiModels = {
    //     gemini: { name: "Gemini", url: "https://gemini.google.com/app", inputSelector: "rich-textarea div[contenteditable='true']" },
    //     chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", inputSelector: "#prompt-textarea" },
    //     claude: { name: "Claude", url: "https://claude.ai/new", inputSelector: "div.ProseMirror[contenteditable='true']" },
    //     aistudio: { name: "AI Studio", url: "https://aistudio.google.com/prompts/new_chat", inputSelector: "textarea[aria-label='Type something or pick one from prompt gallery']" }
    // };
    // const DEFAULT_AI_MODEL = 'aistudio';
    const DEFAULT_PROMPT_TEMPLATE = "Scraped Content:\n\n{content}";
    const DEFAULT_DATA_STORAGE_OPTION = 'persistent';

    // New LLM Provider configurations
    const llmProviders = {
        openai: "OpenAI",
        gemini: "Google Gemini"
        // Add more in the future if needed
    };
    const DEFAULT_LLM_PROVIDER = 'openai';

    // Populate LLM Provider Dropdown
    if (llmProviderSelect) {
        while (llmProviderSelect.firstChild) {
            llmProviderSelect.removeChild(llmProviderSelect.firstChild);
        }
        Object.keys(llmProviders).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = llmProviders[key];
            llmProviderSelect.appendChild(option);
        });
        console.log("Populated LLM provider select dropdown.");
    } else {
        console.warn("LLM Provider select element not found. Skipping population.");
    }


    // Populate AI Model Select Dropdown (Old - for tab opening - disabled as section is hidden)
    // if (aiModelSelect) {
    //     while (aiModelSelect.firstChild) {
    //         aiModelSelect.removeChild(aiModelSelect.firstChild);
    //     }
    //     Object.keys(aiModels).forEach(key => {
    //         const option = document.createElement('option');
    //         option.value = key;
    //         option.textContent = aiModels[key].name;
    //         aiModelSelect.appendChild(option);
    //     });
    //     console.log("Populated AI model select dropdown (old).");
    // } else {
    //     console.warn("Old AI Model select element not found. Skipping population.");
    // }


    // Ensure the max attribute is set correctly on the new slider
    attemptsSlider.setAttribute('max', String(MAX_STEPS_LIMIT));
    console.log("Set slider max to:", attemptsSlider.getAttribute('max'));

    // Update the descriptive text for the slider
    const sliderDescription = document.getElementById('sliderDescription');
    if (sliderDescription) {
        sliderDescription.textContent = `Adjust the number of 'load more' attempts (1-${MAX_STEPS_LIMIT}). Default: ${DEFAULT_ATTEMPTS}. Each step can load a variable number of comments. 75 steps is roughly 7500 words or 17k tokens.`;
    }

    // Load saved settings
    chrome.storage.sync.get([
        'maxLoadMoreAttempts',
        // 'selectedAiModelKey', // Old setting
        // 'selectedAiModelConfig', // Old setting
        'showNotifications',
        'defaultPromptTemplate',
        'dataStorageOption',
        'selectedLlmProvider', // New setting
        'apiKey', // New setting
        'modelName' // New setting
    ], (result) => {
        console.log("Loaded settings from storage:", result);
        let savedAttempts = result.maxLoadMoreAttempts;
        if (savedAttempts !== undefined) {
            // Ensure the saved value doesn\\'t exceed the new max limit
            if (savedAttempts > MAX_STEPS_LIMIT) {
                savedAttempts = MAX_STEPS_LIMIT;
                chrome.storage.sync.set({ maxLoadMoreAttempts: savedAttempts }); // Correct the stored value
            }
            attemptsSlider.value = savedAttempts; // Use the new slider instance
            attemptsValueDisplay.textContent = savedAttempts;
            console.log("Set slider to saved value:", savedAttempts);
        } else {
            attemptsSlider.value = DEFAULT_ATTEMPTS; // Use the new slider instance
            attemptsValueDisplay.textContent = DEFAULT_ATTEMPTS;
            chrome.storage.sync.set({ maxLoadMoreAttempts: DEFAULT_ATTEMPTS });
            console.log("Set slider to default value:", DEFAULT_ATTEMPTS);
        }

        // Load and set AI model (Old - for tab opening - logic disabled)
        // let savedAiModelKey = result.selectedAiModelKey;
        // if (aiModelSelect && savedAiModelKey && aiModels[savedAiModelKey]) {
        //     aiModelSelect.value = savedAiModelKey;
        //     console.log("Set AI model select to saved value (old):", savedAiModelKey);
        // } else if (aiModelSelect) {
        //     aiModelSelect.value = DEFAULT_AI_MODEL;
        //     // chrome.storage.sync.set({ selectedAiModelKey: DEFAULT_AI_MODEL, selectedAiModelConfig: aiModels[DEFAULT_AI_MODEL] }, () => {
        //     //     console.log("Default AI model (AI Studio) set and saved as no valid saved model was found (old).");
        //     // });
        //     console.log("Set AI model select to default value (AI Studio) (old):", DEFAULT_AI_MODEL);
        // }


        // Load and set Show Notifications checkbox
        if (typeof result.showNotifications === 'boolean') {
            showNotificationsCheckbox.checked = result.showNotifications;
            console.log("Set Show Notifications checkbox to saved value:", result.showNotifications);
        } else {
            // Default to true if not set
            showNotificationsCheckbox.checked = true;
            chrome.storage.sync.set({ showNotifications: true });
            console.log("Set Show Notifications checkbox to default (true) and saved.");
        }

        // Load and set Default Prompt Template
        if (typeof result.defaultPromptTemplate === 'string') {
            defaultPromptTemplateTextarea.value = result.defaultPromptTemplate;
            console.log("Set Default Prompt Template to saved value:", result.defaultPromptTemplate);
        } else {
            defaultPromptTemplateTextarea.value = DEFAULT_PROMPT_TEMPLATE;
            chrome.storage.sync.set({ defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE });
            console.log("Set Default Prompt Template to default and saved.");
        }

        // Load and set Data Storage Option
        const dataStorageRadios = {
            dontSave: dataStorageDontSaveRadio,
            sessionOnly: dataStorageSessionOnlyRadio,
            persistent: dataStoragePersistentRadio
        };
        if (result.dataStorageOption && dataStorageRadios[result.dataStorageOption]) {
            dataStorageRadios[result.dataStorageOption].checked = true;
            console.log("Set Data Storage Option to saved value:", result.dataStorageOption);
        } else {
            dataStorageRadios[DEFAULT_DATA_STORAGE_OPTION].checked = true;
            chrome.storage.sync.set({ dataStorageOption: DEFAULT_DATA_STORAGE_OPTION });
            console.log("Set Data Storage Option to default (" + DEFAULT_DATA_STORAGE_OPTION + ") and saved.");
        }

        // Load and set new Background Summarization Settings
        if (llmProviderSelect) {
            llmProviderSelect.value = result.selectedLlmProvider || DEFAULT_LLM_PROVIDER;
            if (!result.selectedLlmProvider) {
                chrome.storage.sync.set({ selectedLlmProvider: DEFAULT_LLM_PROVIDER });
            }
            console.log("Set LLM Provider to:", llmProviderSelect.value);
        }
        if (apiKeyInput) {
            apiKeyInput.value = result.apiKey || '';
            if (!result.apiKey) {
                // Do not save empty API key by default, user should input this.
            }
            console.log("Set API Key (length):", (result.apiKey || '').length);
        }
        if (modelNameInput) {
            modelNameInput.value = result.modelName || '';
            if (!result.modelName) {
                // Do not save empty model name by default.
            }
            console.log("Set Model Name to:", modelNameInput.value);
        }
         // Initial save for defaults if they were not present
        if (!result.selectedLlmProvider || !result.apiKey || !result.modelName) {
            // This save is a bit broad, ideally only save if a specific default was applied and not already present
            // For now, this ensures defaults are stored if first time.
             const initialBackgroundSettings = {
                selectedLlmProvider: llmProviderSelect ? llmProviderSelect.value : DEFAULT_LLM_PROVIDER,
                apiKey: apiKeyInput ? apiKeyInput.value : '',
                modelName: modelNameInput ? modelNameInput.value : ''
            };
            // Avoid saving empty API key or model name if the fields were initially empty and no specific default value.
            // The current logic sets them to '' if not found, so this condition might need refinement
            // if we want to avoid saving empty strings unless they were explicitly set by the user.
            // For now, it means if a value was missing, it's set to its current state (empty or default).
            // chrome.storage.sync.set(initialBackgroundSettings);
            // console.log("Initial background settings potentially saved if any were missing:", initialBackgroundSettings);
        }


    });

    // No longer need to clone the slider here as it's done above.
    // const newSlider = attemptsSlider.cloneNode(true);
    // attemptsSlider.parentNode.replaceChild(newSlider, attemptsSlider);
    // console.log("Replaced slider element to remove stale listeners");

    // Add input event listener to show live updates as user drags
    attemptsSlider.addEventListener('input', (event) => { // Use the new slider instance
        console.log("Slider input event, value:", attemptsSlider.value);
        attemptsValueDisplay.textContent = attemptsSlider.value;
    });

    // Add change event listener for when user releases slider
    attemptsSlider.addEventListener('change', (event) => { // Use the new slider instance
        console.log("Slider change event, value:", attemptsSlider.value);
        const value = parseInt(attemptsSlider.value, 10);
        chrome.storage.sync.set({ maxLoadMoreAttempts: value }, () => {
            console.log('Max load more attempts saved:', value);
            if (saveStatusDisplay) {
                saveStatusDisplay.textContent = 'Settings saved!';
                setTimeout(() => {
                    saveStatusDisplay.textContent = '';
                }, 2000);
            }
        });
    });

    // Add change event listener for AI model select (Old - for tab opening - listener disabled)
    // if (aiModelSelect && !aiModelSelect.dataset.listenerAttached) {
    //     aiModelSelect.addEventListener('change', (event) => {
    //         const selectedKey = event.target.value;
    //         const selectedConfig = aiModels[selectedKey];
    //         if (selectedConfig) {
    //             chrome.storage.sync.set({ selectedAiModelKey: selectedKey, selectedAiModelConfig: selectedConfig }, () => {
    //                 console.log('Selected AI Model saved (old):', selectedKey, selectedConfig);
    //                 if (saveStatusDisplay) {
    //                     saveStatusDisplay.textContent = 'Settings saved!';
    //                     setTimeout(() => {
    //                         saveStatusDisplay.textContent = '';
    //                     }, 2000);
    //                 }
    //             });
    //         }
    //     });
    //     aiModelSelect.dataset.listenerAttached = 'true';
    //     console.log("Attached change listener to AI model select (old).");
    // }

    // Add change event listener for Show Notifications checkbox
    if (showNotificationsCheckbox && !showNotificationsCheckbox.dataset.listenerAttached) {
        showNotificationsCheckbox.addEventListener('change', (event) => {
            const isChecked = event.target.checked;
            chrome.storage.sync.set({ showNotifications: isChecked }, () => {
                console.log('Show Notifications setting saved:', isChecked);
                if (saveStatusDisplay) {
                    saveStatusDisplay.textContent = 'Settings saved!';
                    setTimeout(() => {
                        saveStatusDisplay.textContent = '';
                    }, 2000);
                }
            });
        });
        showNotificationsCheckbox.dataset.listenerAttached = 'true';
        console.log("Attached change listener to Show Notifications checkbox.");
    }

    // Add event listener for Default Prompt Template textarea
    if (defaultPromptTemplateTextarea && !defaultPromptTemplateTextarea.dataset.listenerAttached) {
        defaultPromptTemplateTextarea.addEventListener('input', (event) => {
            const value = event.target.value;
            chrome.storage.sync.set({ defaultPromptTemplate: value }, () => {
                console.log('Default Prompt Template saved:', value);
                if (saveStatusDisplay) {
                    saveStatusDisplay.textContent = 'Settings saved!';
                    setTimeout(() => {
                        saveStatusDisplay.textContent = '';
                    }, 2000);
                }
            });
        });
        defaultPromptTemplateTextarea.dataset.listenerAttached = 'true';
        console.log("Attached input listener to Default Prompt Template textarea.");
    }

    // Add event listeners for Data Storage radio buttons
    const dataStorageRadios = [dataStorageDontSaveRadio, dataStorageSessionOnlyRadio, dataStoragePersistentRadio];
    dataStorageRadios.forEach(radio => {
        if (radio && !radio.dataset.listenerAttached) {
            radio.addEventListener('change', (event) => {
                if (event.target.checked) {
                    const selectedValue = event.target.value;
                    chrome.storage.sync.set({ dataStorageOption: selectedValue }, () => {
                        console.log('Data Storage Option saved:', selectedValue);
                        if (saveStatusDisplay) {
                            saveStatusDisplay.textContent = 'Settings saved!';
                            setTimeout(() => {
                                saveStatusDisplay.textContent = '';
                            }, 2000);
                        }
                    });
                }
            });
            radio.dataset.listenerAttached = 'true';
            console.log(`Attached change listener to Data Storage radio: ${radio.id}`);
        }
    });

    // Function to save background summarization settings
    function saveBackgroundSummarizationSettings() {
        if (!llmProviderSelect || !apiKeyInput || !modelNameInput) {
            console.warn("One or more background summarization UI elements are missing. Cannot save.");
            return;
        }
        const settingsToSave = {
            selectedLlmProvider: llmProviderSelect.value,
            apiKey: apiKeyInput.value,
            modelName: modelNameInput.value
        };
        chrome.storage.sync.set(settingsToSave, () => {
            console.log('Background summarization settings saved:', settingsToSave);
            if (saveStatusDisplay) {
                saveStatusDisplay.textContent = 'Settings saved!';
                setTimeout(() => {
                    saveStatusDisplay.textContent = '';
                }, 2000);
            }
        });
    }

    // Add event listeners for new Background Summarization settings
    if (llmProviderSelect && !llmProviderSelect.dataset.listenerAttached) {
        llmProviderSelect.addEventListener('change', saveBackgroundSummarizationSettings);
        llmProviderSelect.dataset.listenerAttached = 'true';
        console.log("Attached change listener to LLM Provider select.");
    }
    if (apiKeyInput && !apiKeyInput.dataset.listenerAttached) {
        apiKeyInput.addEventListener('input', saveBackgroundSummarizationSettings);
        apiKeyInput.dataset.listenerAttached = 'true';
        console.log("Attached input listener to API Key input.");
    }
    if (modelNameInput && !modelNameInput.dataset.listenerAttached) {
        modelNameInput.addEventListener('input', saveBackgroundSummarizationSettings);
        modelNameInput.dataset.listenerAttached = 'true';
        console.log("Attached input listener to Model Name input.");
    }

};
