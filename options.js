document.addEventListener('DOMContentLoaded', () => {
    console.log("options.js DOM loaded");
});

// Defined in global scope to ensure it's accessible from popup.js
window.initializeOptions = function() {
    console.log("initializeOptions called");
    const attemptsSlider = document.getElementById('loadMoreAttempts');
    const attemptsValueDisplay = document.getElementById('attemptsValue');
    const saveStatusDisplay = document.getElementById('saveStatus');

    if (!attemptsSlider || !attemptsValueDisplay) {
        console.warn("Options UI elements not found:", {
            attemptsSlider: !!attemptsSlider,
            attemptsValueDisplay: !!attemptsValueDisplay,
            saveStatusDisplay: !!saveStatusDisplay
        });
        return;
    }

    console.log("UI elements found, continuing initialization");
    const DEFAULT_ATTEMPTS = 75;
    const MAX_STEPS_LIMIT = 500;

    // Ensure the max attribute is set correctly
    attemptsSlider.setAttribute('max', String(MAX_STEPS_LIMIT));
    console.log("Set slider max to:", attemptsSlider.getAttribute('max'));

    // Update the descriptive text for the slider
    const sliderDescription = document.getElementById('sliderDescription');
    if (sliderDescription) {
        sliderDescription.textContent = `Adjust the number of 'load more' attempts (1-${MAX_STEPS_LIMIT}). Default: ${DEFAULT_ATTEMPTS}. Each step can load a variable number of comments. 75 steps is roughly 7500 words or 17k tokens.`;
    }

    // Load saved settings
    chrome.storage.sync.get(['maxLoadMoreAttempts'], (result) => {
        console.log("Loaded settings from storage:", result);
        let savedAttempts = result.maxLoadMoreAttempts;
        if (savedAttempts !== undefined) {
            // Ensure the saved value doesn't exceed the new max limit
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
};
