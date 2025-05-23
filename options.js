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
    // New elements for dynamic model selection
    const modelNameSelect = document.getElementById('modelNameSelect');
    const fetchModelsBtn = document.getElementById('fetchModelsBtn');
    const fetchModelsStatus = document.getElementById('fetchModelsStatus');


    if (!originalAttemptsSlider || !attemptsValueDisplay || !showNotificationsCheckbox ||
        !defaultPromptTemplateTextarea || !dataStorageDontSaveRadio || !dataStorageSessionOnlyRadio || !dataStoragePersistentRadio ||
        !llmProviderSelect || !apiKeyInput || !modelNameInput || 
        !modelNameSelect || !fetchModelsBtn || !fetchModelsStatus ) { // Added checks for new elements
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
            modelNameSelect: !!modelNameSelect,
            fetchModelsBtn: !!fetchModelsBtn,
            fetchModelsStatus: !!fetchModelsStatus,
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
        const loadedProvider = result.selectedLlmProvider || DEFAULT_LLM_PROVIDER;
        const loadedApiKey = result.apiKey || '';
        const loadedModelName = result.modelName || '';

        if (llmProviderSelect) {
            llmProviderSelect.value = loadedProvider;
        }
        if (apiKeyInput) {
            apiKeyInput.value = loadedApiKey;
        }
        if (modelNameInput) {
            modelNameInput.value = loadedModelName;
        }

        console.log("Loaded LLM Provider:", loadedProvider);
        console.log("Loaded API Key (length):", loadedApiKey.length);
        console.log("Loaded Model Name:", loadedModelName);

        // Pre-fill placeholder for Gemini API key if no key is set
        if (llmProviderSelect && apiKeyInput && llmProviderSelect.value === 'gemini' && !apiKeyInput.value) {
            apiKeyInput.value = "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)";
            // This placeholder is for UI display only and should not be saved to storage.
            // The 'input' event listener on apiKeyInput handles saving user's actual key.
            console.log("Applied placeholder for Gemini API key.");
        }
        
        // Save defaults if settings were not found in storage.
        // This ensures that if a provider is selected for the first time, 
        // its default (empty key) is "saved" before placeholder logic runs,
        // or that placeholder logic doesn't trigger an unwanted save.
        if (result.selectedLlmProvider === undefined || result.apiKey === undefined || result.modelName === undefined) {
            // Only save if one of the actual storage values was undefined, implying first time or cleared storage.
            // Do not save the placeholder key here.
            const settingsToSaveOnFirstLoad = {
                selectedLlmProvider: loadedProvider,
                apiKey: loadedApiKey, // This will be an empty string if it was not previously set
                modelName: loadedModelName
            };
            chrome.storage.sync.set(settingsToSaveOnFirstLoad, () => {
                 console.log("Saved default background summarization settings because some were undefined in storage:", settingsToSaveOnFirstLoad);
            });
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
        if (!llmProviderSelect || !apiKeyInput || !modelNameInput || !modelNameSelect) {
            console.warn("One or more background summarization UI elements are missing. Cannot save.");
            return;
        }
        let currentModelName;
        if (modelNameSelect.style.display !== 'none' && modelNameSelect.value) {
            currentModelName = modelNameSelect.value;
        } else {
            currentModelName = modelNameInput.value;
        }

        const settingsToSave = {
            selectedLlmProvider: llmProviderSelect.value,
            apiKey: apiKeyInput.value === "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)" ? "" : apiKeyInput.value, // Don't save placeholder
            modelName: currentModelName
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
        llmProviderSelect.addEventListener('change', () => {
            saveBackgroundSummarizationSettings();
            // Clear model dropdown and status, show text input by default
            modelNameSelect.innerHTML = '';
            modelNameSelect.style.display = 'none';
            modelNameInput.style.display = 'inline-block'; // Or 'block' if it's on its own line
            fetchModelsStatus.textContent = '';

            if (apiKeyInput && llmProviderSelect.value === 'gemini' && !apiKeyInput.value) {
                apiKeyInput.value = "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)";
            } else if (apiKeyInput && llmProviderSelect.value !== 'gemini' && apiKeyInput.value === "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)") {
                 apiKeyInput.value = ""; // Clear placeholder if switching away from Gemini and it was present
            }
            // Optionally auto-fetch models if API key exists
            // if (apiKeyInput.value && apiKeyInput.value !== "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)") {
            //     fetchModels();
            // }
        });
        llmProviderSelect.dataset.listenerAttached = 'true';
        console.log("Attached change listener to LLM Provider select.");
    }

    if (apiKeyInput && !apiKeyInput.dataset.listenerAttached) {
        apiKeyInput.addEventListener('input', () => {
            // If user types into API key field and it had the placeholder, clear it
            if (apiKeyInput.value !== "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)") {
                // This condition is a bit tricky. If they are typing *over* the placeholder,
                // this 'input' event fires for each character.
                // A better approach might be to clear it on 'focus' if it's the placeholder.
            }
            saveBackgroundSummarizationSettings();
        });
         apiKeyInput.addEventListener('focus', () => {
            if (apiKeyInput.value === "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)") {
                apiKeyInput.value = ""; // Clear placeholder on focus
            }
        });
        apiKeyInput.dataset.listenerAttached = 'true';
        console.log("Attached input listener to API Key input.");
    }

    if (modelNameInput && !modelNameInput.dataset.listenerAttached) {
        modelNameInput.addEventListener('input', saveBackgroundSummarizationSettings);
        modelNameInput.dataset.listenerAttached = 'true';
        console.log("Attached input listener to Model Name input.");
    }
    
    if (modelNameSelect && !modelNameSelect.dataset.listenerAttached) {
        modelNameSelect.addEventListener('change', () => {
            // When a model is selected from the dropdown, update the text input (optional, but good for consistency)
            // and then save.
            if (modelNameInput) {
                modelNameInput.value = modelNameSelect.value; 
            }
            saveBackgroundSummarizationSettings();
        });
        modelNameSelect.dataset.listenerAttached = 'true';
        console.log("Attached change listener to Model Name select.");
    }

    async function fetchModels() {
        const selectedProvider = llmProviderSelect.value;
        const apiKey = apiKeyInput.value;

        fetchModelsStatus.textContent = 'Fetching...';
        fetchModelsBtn.disabled = true;
        modelNameSelect.style.display = 'none';
        modelNameInput.style.display = 'inline-block'; // Fallback to text input

        if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE (replace with your actual key)") {
            fetchModelsStatus.textContent = 'API key required to fetch models.';
            fetchModelsBtn.disabled = false;
            return;
        }

        let url = '';
        let headers = {};
        let models = [];

        try {
            if (selectedProvider === 'openai') {
                url = 'https://api.openai.com/v1/models';
                headers = { 'Authorization': `Bearer ${apiKey}` };
                const response = await fetch(url, { headers });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`OpenAI API Error: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
                }
                const data = await response.json();
                models = data.data.map(model => model.id).filter(id => id.includes('gpt')); // Basic filter
            } else if (selectedProvider === 'gemini') {
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                const response = await fetch(url);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                     throw new Error(`Gemini API Error: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
                }
                const data = await response.json();
                models = data.models.map(model => model.name)
                                .filter(name => name.includes('gemini') && (modelNameInput.value.includes('flash') ? name.includes('flash') : true) ); // Filter for gemini and optionally flash
                                // A more robust filter would check model.supportedGenerationMethods for 'generateContent'
            } else {
                fetchModelsStatus.textContent = 'Provider not supported for model fetching.';
                fetchModelsBtn.disabled = false;
                return;
            }
            populateModelDropdown(models, selectedProvider);
        } catch (error) {
            console.error('Failed to fetch models:', error);
            fetchModelsStatus.textContent = `Error: ${error.message}. Check API key or network.`;
            modelNameSelect.style.display = 'none';
            modelNameInput.style.display = 'inline-block';
        } finally {
            fetchModelsBtn.disabled = false;
        }
    }

    function populateModelDropdown(modelList, provider) {
        modelNameSelect.innerHTML = ''; // Clear existing options

        if (!modelList || modelList.length === 0) {
            fetchModelsStatus.textContent = 'No compatible models found or error fetching.';
            modelNameSelect.style.display = 'none';
            modelNameInput.style.display = 'inline-block';
            return;
        }

        modelList.forEach(modelId => {
            const option = document.createElement('option');
            let displayName = modelId;
            if (provider === 'gemini' && modelId.startsWith('models/')) {
                displayName = modelId.substring('models/'.length);
            }
            option.value = modelId; // Store full ID for Gemini
            option.textContent = displayName;
            modelNameSelect.appendChild(option);
        });

        // Try to set the dropdown to the currently saved/input model name
        const currentModel = modelNameInput.value;
        if (currentModel && modelList.includes(currentModel)) {
            modelNameSelect.value = currentModel;
        } else if (modelList.length > 0) {
            // If current model not in list, select the first one from the fetched list
            modelNameSelect.selectedIndex = 0;
            // And update the modelNameInput to reflect this auto-selection if dropdown is now primary
            modelNameInput.value = modelNameSelect.value; 
        }
        
        modelNameSelect.style.display = 'inline-block';
        modelNameInput.style.display = 'none'; // Hide text input if dropdown is populated
        fetchModelsStatus.textContent = 'Models loaded. Select one or manually enter if needed.';
        
        // Important: Save settings after dropdown is populated and a value is potentially auto-selected
        saveBackgroundSummarizationSettings(); 
    }

    if (fetchModelsBtn && !fetchModelsBtn.dataset.listenerAttached) {
        fetchModelsBtn.addEventListener('click', fetchModels);
        fetchModelsBtn.dataset.listenerAttached = 'true';
    }
};
