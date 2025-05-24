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
    const aiModelSelect = document.getElementById('aiModelSelect');
    const showNotificationsCheckbox = document.getElementById('showNotifications');
    const defaultPromptTemplateTextarea = document.getElementById('defaultPromptTemplate');
    const dataStorageDontSaveRadio = document.getElementById('dataStorageDontSave');
    const dataStorageSessionOnlyRadio = document.getElementById('dataStorageSessionOnly');
    const dataStoragePersistentRadio = document.getElementById('dataStoragePersistent');

    if (!originalAttemptsSlider || !attemptsValueDisplay || !aiModelSelect || !showNotificationsCheckbox ||
        !defaultPromptTemplateTextarea || !dataStorageDontSaveRadio || !dataStorageSessionOnlyRadio || !dataStoragePersistentRadio) {
        console.warn("Options UI elements not found:", {
            attemptsSlider: !!originalAttemptsSlider,
            attemptsValueDisplay: !!attemptsValueDisplay,
            saveStatusDisplay: !!saveStatusDisplay,
            aiModelSelect: !!aiModelSelect,
            showNotificationsCheckbox: !!showNotificationsCheckbox,
            defaultPromptTemplateTextarea: !!defaultPromptTemplateTextarea,
            dataStorageDontSaveRadio: !!dataStorageDontSaveRadio,
            dataStorageSessionOnlyRadio: !!dataStorageSessionOnlyRadio,
            dataStoragePersistentRadio: !!dataStoragePersistentRadio
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

    // AI Model Configurations
    const aiModels = {
        gemini: { name: "Gemini", url: "https://gemini.google.com/app", selectors: ["rich-textarea div[contenteditable='true']"] },
        chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", selectors: ["#prompt-textarea"] }, // Corrected selector
        claude: { name: "Claude", url: "https://claude.ai/new", selectors: ["div.ProseMirror[contenteditable='true']"] },
        aistudio: { name: "AI Studio", url: "https://aistudio.google.com/prompts/new_chat", selectors: ["textarea[aria-label='Type something or pick one from prompt gallery']"] }
    };
    const DEFAULT_AI_MODEL = 'aistudio'; // Changed default to AI Studio
    const DEFAULT_PROMPT_TEMPLATE = "Scraped Content:\n\n{content}";
    const DEFAULT_DATA_STORAGE_OPTION = 'persistent';

    // Populate AI Model Select Dropdown
    // Clear existing options before populating
    while (aiModelSelect.firstChild) {
        aiModelSelect.removeChild(aiModelSelect.firstChild);
    }
    Object.keys(aiModels).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = aiModels[key].name;
        aiModelSelect.appendChild(option);
    });
    console.log("Populated AI model select dropdown.");

    // Function to display AI model specific settings
    function displayAiModelSettings(modelKey) {
        const model = aiModels[modelKey];
        const settingsContainer = document.getElementById('aiModelSpecificSettings');
        settingsContainer.innerHTML = ''; // Clear previous settings

        if (model) {
            const selectorsLabel = document.createElement('label');
            selectorsLabel.setAttribute('for', 'aiModelSelectors');
            selectorsLabel.textContent = 'CSS Selectors (one per line):';
            settingsContainer.appendChild(selectorsLabel);

            const selectorsTextarea = document.createElement('textarea');
            selectorsTextarea.setAttribute('id', 'aiModelSelectors');
            selectorsTextarea.setAttribute('name', 'aiModelSelectors');
            selectorsTextarea.setAttribute('rows', '3');
            selectorsTextarea.value = model.selectors ? model.selectors.join('\n') : '';
            settingsContainer.appendChild(selectorsTextarea);

            const description = document.createElement('p');
            description.classList.add('description');
            description.textContent = 'Enter CSS selectors, one per line. The extension will try them in order to find the input field on the AI platform page.';
            settingsContainer.appendChild(description);

            selectorsTextarea.addEventListener('input', (event) => {
                const newSelectors = event.target.value.split('\n').map(s => s.trim()).filter(s => s);
                // Update the local aiModels configuration temporarily
                // The actual saving happens when the model selection changes or on general save
                aiModels[modelKey].selectors = newSelectors; 
                
                // Save the updated config for the currently selected model
                const currentSelectedModelKey = aiModelSelect.value;
                if (currentSelectedModelKey === modelKey) {
                    chrome.storage.sync.set({ selectedAiModelKey: modelKey, selectedAiModelConfig: aiModels[modelKey] }, () => {
                        console.log('AI Model selectors updated and saved for:', modelKey);
                        if (saveStatusDisplay) {
                            saveStatusDisplay.textContent = 'Settings saved!';
                            setTimeout(() => {
                                saveStatusDisplay.textContent = '';
                            }, 2000);
                        }
                    });
                }
            });
        }
    }

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
        'selectedAiModelKey', 
        'selectedAiModelConfig', 
        'showNotifications',
        'defaultPromptTemplate',
        'dataStorageOption'
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

        // Load and set AI model
        let savedAiModelKey = result.selectedAiModelKey;
        let currentModelConfig = result.selectedAiModelConfig;

        // Backward compatibility for selector vs selectors
        if (currentModelConfig && currentModelConfig.selector && !currentModelConfig.selectors) {
            console.log("Found old 'selector' format, converting to 'selectors' array.");
            currentModelConfig.selectors = [currentModelConfig.selector];
            delete currentModelConfig.selector;
            // Also update the aiModels object in memory for the current session
            if (savedAiModelKey && aiModels[savedAiModelKey]) {
                 aiModels[savedAiModelKey].selectors = currentModelConfig.selectors;
                 if (aiModels[savedAiModelKey].selector) {
                    delete aiModels[savedAiModelKey].selector;
                 }
            }
            // No need to re-save here, will be saved when model selection changes or if other settings trigger save.
            // Or, explicitly save if this is the only place we handle this conversion:
            chrome.storage.sync.set({ selectedAiModelConfig: currentModelConfig }, () => {
                console.log("Converted and saved model config with new 'selectors' format.");
            });
        }


        if (savedAiModelKey && aiModels[savedAiModelKey]) {
            aiModelSelect.value = savedAiModelKey;
            console.log("Set AI model select to saved value:", savedAiModelKey);
            // If loaded config is valid, update the in-memory aiModels entry too, especially for selectors
            if (currentModelConfig && currentModelConfig.selectors) {
                aiModels[savedAiModelKey].selectors = currentModelConfig.selectors;
            }
            displayAiModelSettings(savedAiModelKey); // Display settings for the loaded model
        } else {
            aiModelSelect.value = DEFAULT_AI_MODEL;
            // Save the default model's config (which now uses 'selectors' array)
            chrome.storage.sync.set({ selectedAiModelKey: DEFAULT_AI_MODEL, selectedAiModelConfig: aiModels[DEFAULT_AI_MODEL] }, () => {
                console.log("Default AI model (" + aiModels[DEFAULT_AI_MODEL].name + ") set and saved as no valid saved model was found.");
            });
            console.log("Set AI model select to default value (" + aiModels[DEFAULT_AI_MODEL].name + "):", DEFAULT_AI_MODEL);
            displayAiModelSettings(DEFAULT_AI_MODEL); // Display settings for the default model
        }

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

    // Add change event listener for AI model select
    // const newAiModelSelect = aiModelSelect.cloneNode(true); // Clone to remove old listeners if any
    // aiModelSelect.parentNode.replaceChild(newAiModelSelect, aiModelSelect);
    // console.log("Replaced AI model select element to remove stale listeners (if any).");
    // No need to clone and replace if we add the listener directly to the original aiModelSelect,
    // assuming initializeOptions is structured to be called safely multiple times or only once per actual element existence.
    // If event listeners are stacking up, a more robust solution for listener management would be needed,
    // but clearing and re-populating options should not affect listeners on the select element itself if added once.

    // Remove previous listener if it exists to prevent multiple listeners
    // A simple way is to replace the element, but we've already populated it.
    // Better: store the listener function and remove it, or use a flag.
    // For now, let's assume initializeOptions is called in a way that this doesn't stack listeners badly,
    // or that the popup handles re-creating the options view cleanly.

    // If newAiModelSelect was used, ensure the event listener is on the most current element.
    // Since we are now modifying aiModelSelect directly and not replacing it after population,
    // we can add the event listener to aiModelSelect.
    // To prevent adding multiple listeners if initializeOptions is called multiple times on the same element:
    if (!aiModelSelect.dataset.listenerAttached) {
        aiModelSelect.addEventListener('change', (event) => {
            const selectedKey = event.target.value;
            // aiModels[selectedKey] should already have up-to-date selectors if textarea was edited
            const selectedConfig = aiModels[selectedKey]; 
            if (selectedConfig) {
                 // Make sure the selectors are current from the textarea if it exists
                const selectorsTextarea = document.getElementById('aiModelSelectors');
                if (selectorsTextarea) { // Check if textarea is on the page
                    const currentSelectors = selectorsTextarea.value.split('\n').map(s => s.trim()).filter(s => s);
                    selectedConfig.selectors = currentSelectors;
                }

                chrome.storage.sync.set({ selectedAiModelKey: selectedKey, selectedAiModelConfig: selectedConfig }, () => {
                    console.log('Selected AI Model saved:', selectedKey, selectedConfig);
                    if (saveStatusDisplay) {
                        saveStatusDisplay.textContent = 'Settings saved!';
                        setTimeout(() => {
                            saveStatusDisplay.textContent = '';
                        }, 2000);
                    }
                });
                displayAiModelSettings(selectedKey); // Update UI for newly selected model
            }
        });
        aiModelSelect.dataset.listenerAttached = 'true';
        console.log("Attached change listener to AI model select.");
    }

    // Add change event listener for Show Notifications checkbox
    if (!showNotificationsCheckbox.dataset.listenerAttached) {
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
    if (!defaultPromptTemplateTextarea.dataset.listenerAttached) {
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
        if (!radio.dataset.listenerAttached) {
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
};
