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
    const scrapingTimeoutInput = document.getElementById('scrapingTimeout'); 
    const pasteTemplateTextarea = document.getElementById('pasteTemplate'); // New textarea
    const saveTemplateBtn = document.getElementById('saveTemplateBtn'); // New button
    const resetTemplateBtn = document.getElementById('resetTemplateBtn'); // New button
    const templateSaveStatus = document.getElementById('templateSaveStatus'); // New status display

    if (!originalAttemptsSlider || !attemptsValueDisplay || !aiModelSelect || !showNotificationsCheckbox || !scrapingTimeoutInput ||
        !pasteTemplateTextarea || !saveTemplateBtn || !resetTemplateBtn || !templateSaveStatus) {
        console.warn("Options UI elements not found:", {
            attemptsSlider: !!originalAttemptsSlider,
            attemptsValueDisplay: !!attemptsValueDisplay,
            saveStatusDisplay: !!saveStatusDisplay,
            aiModelSelect: !!aiModelSelect,
            showNotificationsCheckbox: !!showNotificationsCheckbox,
            scrapingTimeoutInput: !!scrapingTimeoutInput,
            pasteTemplateTextarea: !!pasteTemplateTextarea,
            saveTemplateBtn: !!saveTemplateBtn,
            resetTemplateBtn: !!resetTemplateBtn,
            templateSaveStatus: !!templateSaveStatus
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
    const DEFAULT_SCRAPING_TIMEOUT = 120; // seconds
    const MIN_SCRAPING_TIMEOUT = 30;
    const MAX_SCRAPING_TIMEOUT = 1800;

    const DEFAULT_PASTE_TEMPLATE = `REDDIT THREAD ANALYSIS REQUEST
=================================
Thread URL: {url}
Subreddit: r/{subreddit}
Title: {title}
Post Author: u/{postAuthor}

POST CONTENT:
---------------------------------
{postContent}

POST IMAGE URLS:
{imageUrls}

POST LINK URLS:
{linkUrls}

YOUTUBE VIDEO URLS:
{youtubeVideoUrls}

COMMENTS:
---------------------------------
{comments}
`;

    // AI Model Configurations
    const aiModels = {
        gemini: { name: "Gemini", url: "https://gemini.google.com/app", inputSelector: "div[contenteditable=\"true\"][aria-label=\"Enter a prompt here\"]" }, // Updated Gemini selector
        chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", inputSelector: "#prompt-textarea" },
        claude: { name: "Claude", url: "https://claude.ai/new", inputSelector: "div.ProseMirror[contenteditable='true']" },
        aistudio: { name: "AI Studio", url: "https://aistudio.google.com/prompts/new_chat", inputSelector: "textarea[aria-label='Type something or pick one from prompt gallery']" }
    };
    const DEFAULT_AI_MODEL = 'aistudio'; // Changed default to AI Studio

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

    // Ensure the max attribute is set correctly on the new slider
    attemptsSlider.setAttribute('max', String(MAX_STEPS_LIMIT));
    console.log("Set slider max to:", attemptsSlider.getAttribute('max'));

    // Update the descriptive text for the slider
    const sliderDescription = document.getElementById('sliderDescription');
    if (sliderDescription) {
        sliderDescription.textContent = `Adjust the number of 'load more' attempts (1-${MAX_STEPS_LIMIT}). Default: ${DEFAULT_ATTEMPTS}. Each step can load a variable number of comments. 75 steps is roughly 7500 words or 17k tokens.`;
    }

    // Load saved settings
    chrome.storage.sync.get(['maxLoadMoreAttempts', 'selectedAiModelKey', 'selectedAiModelConfig', 'showNotifications', 'scrapingTimeout', 'pasteTemplate'], (result) => {
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
        if (savedAiModelKey && aiModels[savedAiModelKey]) {
            aiModelSelect.value = savedAiModelKey;
            console.log("Set AI model select to saved value:", savedAiModelKey);
        } else {
            aiModelSelect.value = DEFAULT_AI_MODEL;
            chrome.storage.sync.set({ selectedAiModelKey: DEFAULT_AI_MODEL, selectedAiModelConfig: aiModels[DEFAULT_AI_MODEL] }, () => {
                console.log("Default AI model (AI Studio) set and saved as no valid saved model was found.");
            });
            console.log("Set AI model select to default value (AI Studio):", DEFAULT_AI_MODEL);
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

        // Load and set Scraping Timeout
        let savedTimeout = result.scrapingTimeout;
        if (savedTimeout !== undefined && !isNaN(parseInt(savedTimeout))) {
            savedTimeout = parseInt(savedTimeout);
            if (savedTimeout < MIN_SCRAPING_TIMEOUT) savedTimeout = MIN_SCRAPING_TIMEOUT;
            if (savedTimeout > MAX_SCRAPING_TIMEOUT) savedTimeout = MAX_SCRAPING_TIMEOUT;
            scrapingTimeoutInput.value = savedTimeout;
            console.log("Set Scraping Timeout input to saved value:", savedTimeout);
        } else {
            scrapingTimeoutInput.value = DEFAULT_SCRAPING_TIMEOUT;
            chrome.storage.sync.set({ scrapingTimeout: DEFAULT_SCRAPING_TIMEOUT });
            console.log("Set Scraping Timeout input to default value:", DEFAULT_SCRAPING_TIMEOUT);
        }

        // Load and set Paste Template
        if (result.pasteTemplate !== undefined) {
            pasteTemplateTextarea.value = result.pasteTemplate;
            console.log("Set Paste Template to saved value.");
        } else {
            pasteTemplateTextarea.value = DEFAULT_PASTE_TEMPLATE;
            // No need to save default on load, only on explicit save/reset
            console.log("Set Paste Template to default value.");
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
            const selectedConfig = aiModels[selectedKey];
            if (selectedConfig) {
                // Ensure the selector being saved matches the one in service_worker.js for consistency
                // This step is crucial if options.js and service_worker.js could have divergent selectors.
                // However, with the current fix, they should be aligned.
                // For absolute safety, one could fetch the definitive list from service_worker via a message,
                // but for now, we ensure aiModels here is the source of truth for what options.js saves.
                chrome.storage.sync.set({ selectedAiModelKey: selectedKey, selectedAiModelConfig: selectedConfig }, () => {
                    console.log('Selected AI Model saved:', selectedKey, selectedConfig);
                    if (saveStatusDisplay) {
                        saveStatusDisplay.textContent = 'Settings saved!';
                        setTimeout(() => {
                            saveStatusDisplay.textContent = '';
                        }, 2000);
                    }
                });
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

    // Add change event listener for Scraping Timeout input
    if (!scrapingTimeoutInput.dataset.listenerAttached) {
        scrapingTimeoutInput.addEventListener('change', (event) => {
            let value = parseInt(event.target.value, 10);
            if (isNaN(value) || value < MIN_SCRAPING_TIMEOUT) {
                value = MIN_SCRAPING_TIMEOUT;
            } else if (value > MAX_SCRAPING_TIMEOUT) {
                value = MAX_SCRAPING_TIMEOUT;
            }
            event.target.value = value; // Correct the input field if value was out of bounds
            chrome.storage.sync.set({ scrapingTimeout: value }, () => {
                console.log('Scraping Timeout saved:', value);
                if (saveStatusDisplay) {
                    saveStatusDisplay.textContent = 'Settings saved!';
                    setTimeout(() => {
                        saveStatusDisplay.textContent = '';
                    }, 2000);
                }
            });
        });
        scrapingTimeoutInput.dataset.listenerAttached = 'true';
        console.log("Attached change listener to Scraping Timeout input.");
    }

    // Save Paste Template
    if (!saveTemplateBtn.dataset.listenerAttached) {
        saveTemplateBtn.addEventListener('click', () => {
            const templateValue = pasteTemplateTextarea.value;
            chrome.storage.sync.set({ pasteTemplate: templateValue }, () => {
                console.log('Paste Template saved.');
                templateSaveStatus.textContent = 'Template saved!';
                setTimeout(() => {
                    templateSaveStatus.textContent = '';
                }, 2000);
            });
        });
        saveTemplateBtn.dataset.listenerAttached = 'true';
    }

    // Reset Paste Template
    if (!resetTemplateBtn.dataset.listenerAttached) {
        resetTemplateBtn.addEventListener('click', () => {
            pasteTemplateTextarea.value = DEFAULT_PASTE_TEMPLATE;
            chrome.storage.sync.set({ pasteTemplate: DEFAULT_PASTE_TEMPLATE }, () => {
                console.log('Paste Template reset to default and saved.');
                templateSaveStatus.textContent = 'Template reset to default and saved!';
                setTimeout(() => {
                    templateSaveStatus.textContent = '';
                }, 2000);
            });
        });
        resetTemplateBtn.dataset.listenerAttached = 'true';
    }
};
