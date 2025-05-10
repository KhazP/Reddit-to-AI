document.addEventListener('DOMContentLoaded', () => {
    console.log("options.js DOM loaded");
});

// Defined in global scope to ensure it's accessible from popup.js
window.initializeOptions = function() {
    console.log("initializeOptions called");
    const attemptsSlider = document.getElementById('loadMoreAttempts');
    const attemptsValueDisplay = document.getElementById('attemptsValue');
    const saveStatusDisplay = document.getElementById('saveStatus');
    const aiModelSelect = document.getElementById('aiModelSelect'); // New AI model select element

    if (!attemptsSlider || !attemptsValueDisplay || !aiModelSelect) { // Added aiModelSelect check
        console.warn("Options UI elements not found:", {
            attemptsSlider: !!attemptsSlider,
            attemptsValueDisplay: !!attemptsValueDisplay,
            saveStatusDisplay: !!saveStatusDisplay,
            aiModelSelect: !!aiModelSelect // Added aiModelSelect to log
        });
        return;
    }

    console.log("UI elements found, continuing initialization");
    const DEFAULT_ATTEMPTS = 75;
    const MAX_STEPS_LIMIT = 500;

    // AI Model Configurations
    const aiModels = {
        gemini: { name: "Gemini", url: "https://gemini.google.com/app", inputSelector: "rich-textarea div[contenteditable=\\'true\\']" }, // Assuming a generic selector for Gemini for now
        chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", inputSelector: "div.ProseMirror[contenteditable=\\'true\\']#prompt-textarea" },
        claude: { name: "Claude", url: "https://claude.ai/new", inputSelector: "div.ProseMirror[contenteditable=\\'true\\']" },
        grok: { name: "Grok", url: "https://grok.com/", inputSelector: "textarea[aria-label=\\'Ask Grok anything\\']" }
    };
    const DEFAULT_AI_MODEL = 'gemini';

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

    // Ensure the max attribute is set correctly
    attemptsSlider.setAttribute('max', String(MAX_STEPS_LIMIT));
    console.log("Set slider max to:", attemptsSlider.getAttribute('max'));

    // Update the descriptive text for the slider
    const sliderDescription = document.getElementById('sliderDescription');
    if (sliderDescription) {
        sliderDescription.textContent = `Adjust the number of 'load more' attempts (1-${MAX_STEPS_LIMIT}). Default: ${DEFAULT_ATTEMPTS}. Each step can load a variable number of comments. 75 steps is roughly 7500 words or 17k tokens.`;
    }

    // Load saved settings
    chrome.storage.sync.get(['maxLoadMoreAttempts', 'selectedAiModelKey', 'selectedAiModelConfig'], (result) => { // Added selectedAiModelKey and selectedAiModelConfig
        console.log("Loaded settings from storage:", result);
        let savedAttempts = result.maxLoadMoreAttempts;
        if (savedAttempts !== undefined) {
            // Ensure the saved value doesn\\'t exceed the new max limit
            if (savedAttempts > MAX_STEPS_LIMIT) {
                savedAttempts = MAX_STEPS_LIMIT;
                chrome.storage.sync.set({ maxLoadMoreAttempts: savedAttempts }); // Correct the stored value
            }
            attemptsSlider.value = savedAttempts;
            attemptsValueDisplay.textContent = savedAttempts;
            console.log("Set slider to saved value:", savedAttempts);
        } else {
            attemptsSlider.value = DEFAULT_ATTEMPTS;
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
            chrome.storage.sync.set({ selectedAiModelKey: DEFAULT_AI_MODEL, selectedAiModelConfig: aiModels[DEFAULT_AI_MODEL] });
            console.log("Set AI model select to default value:", DEFAULT_AI_MODEL);
        }
    });

    // Make sure the slider has no previous listeners
    const newSlider = attemptsSlider.cloneNode(true);
    attemptsSlider.parentNode.replaceChild(newSlider, attemptsSlider);
    console.log("Replaced slider element to remove stale listeners");

    // Add input event listener to show live updates as user drags
    newSlider.addEventListener('input', (event) => {
        console.log("Slider input event, value:", newSlider.value);
        attemptsValueDisplay.textContent = newSlider.value;
    });

    // Add change event listener for when user releases slider
    newSlider.addEventListener('change', (event) => {
        console.log("Slider change event, value:", newSlider.value);
        const value = parseInt(newSlider.value, 10);
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
    }
};
