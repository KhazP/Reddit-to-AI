// aiPaster.js - Pastes scraped Reddit content to AI chat interfaces
console.log('Reddit to AI: aiPaster.js loaded.');

const MAX_IMAGES = 10;
const IMAGE_PASTE_DELAY = 500;

// Wait for page to be ready
setTimeout(initPaster, 1500);

async function initPaster() {
    console.log('Reddit to AI: Checking for pending paste operation...');

    const { redditThreadData } = await chrome.storage.local.get('redditThreadData');

    if (!redditThreadData) {
        console.log('Reddit to AI: No data found in storage.');
        return;
    }

    // Check timestamp (ignore data older than 2 minutes)
    const now = Date.now();
    const dataTimestamp = redditThreadData.timestamp || 0;
    if (now - dataTimestamp > 2 * 60 * 1000) {
        console.log('Reddit to AI: Data too old, ignoring.');
        return;
    }

    // Prevent duplicate paste in same session for same data
    if (sessionStorage.getItem('redditToAiPasted') === 'true') {
        const pastedTimestamp = sessionStorage.getItem('redditToAiPastedTimestamp');
        if (pastedTimestamp && parseInt(pastedTimestamp) === dataTimestamp) {
            console.log('Reddit to AI: Already pasted this data.');
            return;
        }
    }

    attemptPaste(redditThreadData);
}

async function attemptPaste(data) {
    const hostname = window.location.hostname;
    let inputSelector = '';
    let isContentEditable = false;

    // Detect platform
    if (hostname.includes('gemini.google.com')) {
        inputSelector = 'div.ql-editor[contenteditable="true"], div[contenteditable="true"].ql-editor, div.rich-textarea > div[contenteditable="true"], div[contenteditable="true"]';
        isContentEditable = true;
    } else if (hostname.includes('chatgpt.com')) {
        inputSelector = '#prompt-textarea';
        isContentEditable = true;
    } else if (hostname.includes('claude.ai')) {
        inputSelector = 'div[contenteditable="true"]';
        isContentEditable = true;
    } else if (hostname.includes('aistudio.google.com')) {
        inputSelector = 'textarea';
        isContentEditable = false;
    }

    if (!inputSelector) {
        console.warn('Reddit to AI: Unknown AI platform.');
        return;
    }

    const inputEl = document.querySelector(inputSelector);
    if (!inputEl) {
        console.log(`Reddit to AI: Input element not found. Retrying...`);
        if (!window.__pasteRetries) window.__pasteRetries = 0;
        if (window.__pasteRetries < 5) {
            window.__pasteRetries++;
            setTimeout(() => attemptPaste(data), 1000);
        } else {
            console.error('Reddit to AI: Failed to find input element.');
        }
        return;
    }

    console.log('Reddit to AI: Input found. Building prompt...');

    // Get prompt template from settings
    const settings = await new Promise(resolve => {
        chrome.storage.sync.get(['defaultPromptTemplate'], resolve);
    });

    const template = settings.defaultPromptTemplate || "Please analyze the following Reddit thread.\n\n{content}";
    const promptText = buildPromptText(data, template);

    console.log(`Reddit to AI: Prompt built. Total length: ${promptText.length} characters`);

    // Paste text
    insertText(inputEl, promptText, isContentEditable);
    console.log('Reddit to AI: Text pasted.');

    // Paste images if available
    const imageUrls = data.post?.images || [];
    if (imageUrls.length > 0) {
        console.log(`Reddit to AI: Pasting ${imageUrls.length} images...`);
        await pasteImages(inputEl, imageUrls.slice(0, MAX_IMAGES), hostname);
    }

    // Mark as pasted
    sessionStorage.setItem('redditToAiPasted', 'true');
    sessionStorage.setItem('redditToAiPastedTimestamp', String(data.timestamp));

    setTimeout(() => inputEl.focus(), 100);
    console.log('Reddit to AI: Paste complete!');
}

// ================== PROMPT BUILDING ==================

function buildPromptText(data, template) {
    const sections = [];

    // Header info
    sections.push(`Thread Title: ${data.post.title}`);
    sections.push(`Subreddit: r/${data.post.subreddit}`);
    sections.push(`Author: u/${data.post.author}`);
    if (data.post.url) {
        sections.push(`URL: ${data.post.url}`);
    }
    sections.push('');

    // Post content
    sections.push('--- POST CONTENT ---');
    sections.push(data.post.content || '[No body content]');
    sections.push('');

    // Images note
    if (Array.isArray(data.post.images) && data.post.images.length > 0) {
        sections.push(`[${data.post.images.length} image(s) attached]`);
        sections.push('');
    }

    // Comments - ALL OF THEM
    sections.push('--- COMMENTS ---');
    const commentText = formatAllComments(data.comments);
    sections.push(commentText);
    sections.push('');

    // Metadata
    sections.push('---');
    sections.push(`Scraped at: ${data.metadata?.scrapedAt || new Date().toISOString()}`);
    sections.push(`Total comments: ${data.metadata?.commentCount || data.commentCount || 'unknown'}`);
    sections.push(`Depth level: ${data.maxDepth || 'unknown'}`);

    const content = sections.join('\n');
    return template.replace('{content}', content);
}

/**
 * Format ALL comments without arbitrary limits
 * Uses indentation to show reply structure
 */
function formatAllComments(comments) {
    if (!Array.isArray(comments) || comments.length === 0) {
        return '[No comments]';
    }

    const lines = [];

    function processComment(comment, depth) {
        if (!comment) return;

        const indent = '  '.repeat(Math.min(depth, 6));
        const author = comment.author || '[deleted]';
        const text = (comment.text || '').replace(/\s+/g, ' ').trim();

        if (text && text !== '[deleted]' && text !== '[removed]') {
            // Format: indentation + author + text
            lines.push(`${indent}[${author}]: ${text}`);
        }

        // Process replies recursively
        if (Array.isArray(comment.replies)) {
            for (const reply of comment.replies) {
                processComment(reply, depth + 1);
            }
        }
    }

    for (const comment of comments) {
        processComment(comment, 0);
    }

    return lines.join('\n\n');
}

// ================== TEXT INSERTION ==================

function insertText(element, text, isContentEditable) {
    element.focus();

    if (isContentEditable) {
        const success = document.execCommand('insertText', false, text);
        if (!success) {
            console.log('Reddit to AI: execCommand failed, using direct insertion.');
            element.textContent = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } else {
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        valueSetter.call(element, text);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// ================== IMAGE PASTING ==================

async function pasteImages(inputEl, imageUrls, hostname) {
    const images = [];

    for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        console.log(`Reddit to AI: Fetching image ${i + 1}/${imageUrls.length}`);

        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'fetchImage', url }, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result);
                    }
                });
            });

            // Convert base64 to File
            const byteChars = atob(response.base64);
            const byteArray = new Uint8Array(byteChars.length);
            for (let j = 0; j < byteChars.length; j++) {
                byteArray[j] = byteChars.charCodeAt(j);
            }
            const blob = new Blob([byteArray], { type: response.mimeType });
            const ext = response.mimeType.split('/')[1] || 'jpg';
            const file = new File([blob], `reddit_image_${i + 1}.${ext}`, { type: response.mimeType });

            images.push(file);
        } catch (error) {
            console.error(`Reddit to AI: Failed to fetch image ${i + 1}:`, error);
        }
    }

    if (images.length === 0) return;

    console.log(`Reddit to AI: Pasting ${images.length} images...`);

    // Platform-specific image paste
    for (const file of images) {
        try {
            const dt = new DataTransfer();
            dt.items.add(file);

            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });

            inputEl.focus();
            inputEl.dispatchEvent(pasteEvent);
            await delay(IMAGE_PASTE_DELAY);
        } catch (error) {
            console.error('Reddit to AI: Image paste failed:', error);
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
