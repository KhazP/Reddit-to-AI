// Reddit to AI - Internationalization Utility

// Current locale messages for overriding browser default
let localizedMessages = null;
const DEFAULT_LANGUAGE = 'auto';

/**
 * Helper to get message from loaded locale or fall back to browser default
 */
function t(key, substitutions = []) {
    let message = '';

    // Try custom loaded locale first
    if (localizedMessages && localizedMessages[key]) {
        message = localizedMessages[key].message;

        // Handle placeholders if substitutions provided
        // Simple support for $1, $2, etc. (basic replacement)
        if (substitutions && substitutions.length > 0) {
            if (localizedMessages[key].placeholders) {
                const placeholders = localizedMessages[key].placeholders;
                Object.keys(placeholders).forEach(phKey => {
                    const phDef = placeholders[phKey];
                    if (phDef.content) {
                        const match = phDef.content.match(/\$(\d+)/);
                        if (match && match[1]) {
                            const index = parseInt(match[1]) - 1;
                            if (index >= 0 && index < substitutions.length) {
                                message = message.replace(new RegExp(`\\$${phKey}\\$`, 'gi'), substitutions[index]);
                            }
                        }
                    }
                });
            } else {
                // Fallback for direct $1 replacements if no placeholders defined (less robust)
                substitutions.forEach((sub, index) => {
                    message = message.replace(new RegExp(`\\$${index + 1}`, 'g'), sub);
                });
            }
        }
    } else {
        // Fallback to chrome.i18n
        // chrome.i18n.getMessage handles errors gracefully usually, but let's be safe
        try {
            message = chrome.i18n.getMessage(key, substitutions);
        } catch (e) {
            console.warn(`i18n: Failed to get message for key '${key}'`, e);
        }
    }

    return message || '';
}

/**
 * Loads the locale file for the specified language
 */
async function loadLanguage(lang) {
    if (!lang || lang === 'auto') {
        localizedMessages = null;
        // console.log("i18n: Using browser default language");
        return;
    }

    try {
        const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
        // console.log("i18n: Loading locale from", url);
        const response = await fetch(url);
        localizedMessages = await response.json();
        // console.log("i18n: Localized messages loaded for", lang);
    } catch (e) {
        console.error("i18n: Failed to load locale", lang, e);
        localizedMessages = null;
    }
}

/**
 * Initialize i18n by reading storage
 * @returns {Promise<void>}
 */
async function initI18n() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['selectedLanguage'], async (result) => {
            const lang = result.selectedLanguage || DEFAULT_LANGUAGE;
            await loadLanguage(lang);
            resolve();
        });
    });
}

/**
 * Localizes the HTML page by looking for elements with data-i18n* attributes
 */
function localizeHtmlPage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const message = t(el.getAttribute('data-i18n'));
        if (message) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = message;
            } else {
                el.textContent = message;
            }
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const message = t(el.getAttribute('data-i18n-placeholder'));
        if (message) el.placeholder = message;
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const message = t(el.getAttribute('data-i18n-title'));
        if (message) el.title = message;
    });
}

// Export for ES modules or global scope
if (typeof window !== 'undefined') {
    window.t = t;
    window.loadLanguage = loadLanguage;
    window.initI18n = initI18n;
    window.localizeHtmlPage = localizeHtmlPage;
}
