// aiPaster.js - Pastes reviewed Reddit prompts to AI chat interfaces
console.log('Reddit to AI: aiPaster.js loaded.');

const MAX_IMAGES = 10;
const IMAGE_PASTE_DELAY = 500;
const INPUT_RETRY_LIMIT = 7;

if (!globalThis.R2AIAiPasterTest) {
    setTimeout(initPaster, 1500);
}

async function initPaster() {
    console.log('Reddit to AI: Checking for pending paste operation...');

    if (typeof initI18n === 'function') {
        await initI18n();
    }

    const pending = await getPendingPastePayload();
    if (!pending?.data && !pending?.promptText) {
        console.log('Reddit to AI: No pending paste payload found.');
        return;
    }

    const timestamp = pending.timestamp || pending.data?.timestamp || 0;
    if (timestamp && Date.now() - timestamp > 10 * 60 * 1000) {
        console.log('Reddit to AI: Pending paste payload is too old, ignoring.');
        return;
    }

    const pasteId = pending.pasteId || String(timestamp);
    if (sessionStorage.getItem('redditToAiPastedId') === pasteId) {
        console.log('Reddit to AI: Already pasted this payload.');
        return;
    }

    await attemptPaste(pending);
}

async function getPendingPastePayload() {
    const response = await sendRuntimeMessage({ action: 'getPendingPasteData' });
    if (response?.payload) return response.payload;

    // Backward compatibility for older stored data.
    const { redditThreadData } = await chrome.storage.local.get('redditThreadData');
    if (!redditThreadData) return null;
    const settings = await chrome.storage.sync.get(['defaultPromptTemplate', 'mediaMode']);
    const template = settings.defaultPromptTemplate || (t('default_prompt_template') || 'Please analyze the following Reddit thread.\n\n{content}');
    const promptText = window.R2AIPrompt
        ? R2AIPrompt.buildPromptText(redditThreadData, template, { mediaMode: settings.mediaMode || 'attach' })
        : buildLegacyPromptText(redditThreadData, template);
    return {
        data: redditThreadData,
        promptText,
        mediaMode: settings.mediaMode || 'attach',
        timestamp: redditThreadData.timestamp || Date.now(),
        pasteId: String(redditThreadData.timestamp || Date.now())
    };
}

async function attemptPaste(payload) {
    const promptText = payload.promptText || '';
    if (!promptText) {
        showPasteFallback('', 'Auto-paste failed — no prompt text was available.');
        return;
    }

    const target = getPlatformInputTarget();
    if (!target.inputSelector) {
        await recordPasteFailure(payload, 'This AI platform is not recognized.');
        showPasteFallback(promptText, 'Auto-paste failed — this AI platform is not recognized.', payload);
        return;
    }

    const loginProblem = detectLoginRequired();
    if (loginProblem) {
        await recordPasteFailure(payload, loginProblem);
        showPasteFallback(promptText, loginProblem, payload);
        return;
    }

    const inputEl = await waitForInput(target.inputSelector);
    if (!inputEl) {
        await recordPasteFailure(payload, 'Input box was not found. You may need to sign in or start a new chat.');
        showPasteFallback(promptText, 'Auto-paste failed — click Copy Prompt.', payload);
        return;
    }

    try {
        insertText(inputEl, promptText, target.isContentEditable);
        console.log('Reddit to AI: Text pasted.');
    } catch (error) {
        console.error('Reddit to AI: Text paste failed:', error);
        await recordPasteFailure(payload, error.message || 'Text insertion failed.');
        showPasteFallback(promptText, 'Auto-paste failed — click Copy Prompt.', payload);
        return;
    }

    if (!verifyTextInserted(inputEl, promptText)) {
        await recordPasteFailure(payload, 'Text insertion could not be verified.');
        showPasteFallback(promptText, 'Auto-paste may have been blocked — click Copy Prompt.', payload);
        return;
    }

    if ((payload.mediaMode || 'attach') === 'attach') {
        const imageUrls = collectImageUrls(payload.data).slice(0, MAX_IMAGES);
        if (imageUrls.length > 0) {
            console.log(`Reddit to AI: Pasting ${imageUrls.length} images...`);
            const imageResult = await pasteImages(inputEl, imageUrls);
            if (imageResult.attempted > 0 && imageResult.pasted !== imageResult.attempted) {
                const reason = `Image attachment failed: pasted ${imageResult.pasted}/${imageResult.attempted}.`;
                await recordPasteFailure(payload, reason);
                showPasteFallback(promptText, 'Auto-paste attached only part of the images — click Copy Prompt.', payload);
                return;
            }
        }
    }

    sessionStorage.setItem('redditToAiPastedId', payload.pasteId || String(payload.timestamp || Date.now()));
    setTimeout(() => inputEl.focus(), 100);
    await sendRuntimeMessage({ action: 'markPendingPasteConsumed', pasteId: payload.pasteId });
    console.log('Reddit to AI: Paste complete!');
}

function detectLoginRequired() {
    const bodyText = document.body?.innerText?.slice(0, 4000).toLowerCase() || '';
    const url = window.location.href.toLowerCase();
    if (/login|signin|sign-in|auth/.test(url)) return 'Auto-paste is paused because this AI platform is showing a sign-in page.';
    if (bodyText.includes('log in') || bodyText.includes('sign in') || bodyText.includes('continue with google')) {
        return 'Auto-paste is paused because this AI platform appears to require sign-in.';
    }
    return '';
}

function verifyTextInserted(inputEl, promptText) {
    const expectedStart = promptText.slice(0, 80).trim();
    if (!expectedStart) return false;
    const actual = inputEl.value || inputEl.innerText || inputEl.textContent || '';
    return actual.includes(expectedStart);
}

async function recordPasteFailure(payload, reason) {
    await sendRuntimeMessage({
        action: 'recordPasteFailure',
        pasteId: payload?.pasteId,
        aiProvider: payload?.aiProvider,
        reason
    });
}

function getPlatformInputTarget() {
    const hostname = window.location.hostname;
    if (hostname.includes('gemini.google.com')) {
        return {
            inputSelector: 'div.ql-editor[contenteditable="true"], div[contenteditable="true"].ql-editor, div.rich-textarea > div[contenteditable="true"], div[contenteditable="true"]',
            isContentEditable: true
        };
    }
    if (hostname.includes('chatgpt.com')) {
        return {
            inputSelector: '#prompt-textarea, div[contenteditable="true"]#prompt-textarea, textarea',
            isContentEditable: true
        };
    }
    if (hostname.includes('claude.ai')) {
        return {
            inputSelector: 'div[contenteditable="true"], [contenteditable="true"]',
            isContentEditable: true
        };
    }
    if (hostname.includes('aistudio.google.com')) {
        return {
            inputSelector: 'textarea, div[contenteditable="true"]',
            isContentEditable: false
        };
    }
    return { inputSelector: '', isContentEditable: false };
}

async function waitForInput(selector) {
    for (let attempt = 0; attempt < INPUT_RETRY_LIMIT; attempt++) {
        const inputEl = document.querySelector(selector);
        if (inputEl) return inputEl;
        await delay(900 + attempt * 200);
    }
    return null;
}

function insertText(element, text, isContentEditable) {
    element.focus();

    if (isContentEditable || element.isContentEditable) {
        const success = document.execCommand('insertText', false, text);
        if (!success) {
            element.textContent = text;
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
        return;
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        if (descriptor?.set) {
            descriptor.set.call(element, text);
        } else {
            element.value = text;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

function showPasteFallback(promptText, message, payload = null) {
    console.warn('Reddit to AI:', message);
    if (document.getElementById('reddit-to-ai-fallback')) return;

    const overlay = document.createElement('div');
    overlay.id = 'reddit-to-ai-fallback';
    overlay.style.cssText = `
        position: fixed;
        inset: 20px 20px auto auto;
        width: min(420px, calc(100vw - 40px));
        z-index: 2147483647;
        background: #111;
        color: #fff;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 16px;
        box-shadow: 0 20px 70px rgba(0,0,0,0.45);
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 16px;
    `;

    const title = document.createElement('strong');
    title.textContent = message || 'Auto-paste failed — click Copy Prompt.';
    title.style.display = 'block';
    title.style.marginBottom = '8px';

    const hint = document.createElement('p');
    hint.textContent = 'The prompt is still ready. Copy it and paste it manually into this chat.';
    hint.style.cssText = 'margin: 0 0 12px; color: #b5b5b5; font-size: 13px; line-height: 1.4;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Prompt';
    copyButton.style.cssText = buttonStyle('#ff4500', '#fff');
    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(promptText);
            copyButton.textContent = 'Copied!';
            if (payload?.pasteId) await sendRuntimeMessage({ action: 'markPendingPasteConsumed', pasteId: payload.pasteId });
        } catch (error) {
            fallbackCopy(promptText);
            copyButton.textContent = `Copied${error?.message ? ' (fallback)' : '!'}`;
            if (payload?.pasteId) await sendRuntimeMessage({ action: 'markPendingPasteConsumed', pasteId: payload.pasteId });
        }
    });

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = buttonStyle('rgba(255,255,255,0.08)', '#fff');
    closeButton.addEventListener('click', () => overlay.remove());

    actions.append(copyButton, closeButton);
    overlay.append(title, hint, actions);
    document.body.appendChild(overlay);
}

function buttonStyle(background, color) {
    return `
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 10px;
        padding: 9px 12px;
        background: ${background};
        color: ${color};
        font: inherit;
        font-weight: 700;
        cursor: pointer;
    `;
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

function collectImageUrls(data) {
    if (Array.isArray(data?.threads)) {
        return data.threads.flatMap(thread => collectImageUrls(thread));
    }
    return Array.isArray(data?.post?.images) ? data.post.images : [];
}

async function pasteImages(inputEl, imageUrls) {
    const images = [];
    const failures = [];
    const attempted = Array.isArray(imageUrls) ? imageUrls.length : 0;
    let fetched = 0;
    let pasted = 0;

    for (let i = 0; i < attempted; i++) {
        const url = imageUrls[i];
        console.log(`Reddit to AI: Fetching image ${i + 1}/${attempted}`);

        try {
            const response = await sendRuntimeMessage({ action: 'fetchImage', url });
            if (response?.error) throw new Error(response.error);
            if (!response?.base64) throw new Error('Image fetch returned no data.');
            if (!response?.mimeType) throw new Error('Image fetch returned no MIME type.');

            const byteChars = atob(response.base64);
            const byteArray = new Uint8Array(byteChars.length);
            for (let j = 0; j < byteChars.length; j++) {
                byteArray[j] = byteChars.charCodeAt(j);
            }
            const mimeType = response.mimeType;
            const blob = new Blob([byteArray], { type: mimeType });
            const ext = mimeType.split('/')[1] || 'jpg';
            const file = new File([blob], `reddit_image_${i + 1}.${ext}`, { type: mimeType });
            images.push({ file, url, index: i });
            fetched += 1;
        } catch (error) {
            console.error(`Reddit to AI: Failed to fetch image ${i + 1}:`, error);
            failures.push({
                phase: 'fetch',
                index: i,
                url,
                reason: error?.message || 'Image fetch failed.'
            });
        }
    }

    for (const image of images) {
        try {
            const dt = new DataTransfer();
            dt.items.add(image.file);
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });
            inputEl.focus();
            const accepted = inputEl.dispatchEvent(pasteEvent);
            if (!accepted) throw new Error('Image paste event was cancelled.');
            pasted += 1;
            await delay(IMAGE_PASTE_DELAY);
        } catch (error) {
            console.error('Reddit to AI: Image paste failed:', error);
            failures.push({
                phase: 'paste',
                index: image.index,
                url: image.url,
                reason: error?.message || 'Image paste failed.'
            });
        }
    }

    return { attempted, fetched, pasted, failures };
}

function buildLegacyPromptText(data, template) {
    const sections = [];
    sections.push(`Thread Title: ${data.post?.title || ''}`);
    sections.push(`Subreddit: r/${data.post?.subreddit || 'unknown'}`);
    sections.push(`Author: u/${data.post?.author || 'unknown'}`);
    sections.push('');
    sections.push('--- POST CONTENT ---');
    sections.push(data.post?.content || '[No body content]');
    sections.push('');
    sections.push('--- COMMENTS ---');
    sections.push(formatLegacyComments(data.comments || []));
    return template.replace('{content}', sections.join('\n'));
}

function formatLegacyComments(comments) {
    const lines = [];
    function process(comment, depth) {
        const indent = '  '.repeat(Math.min(depth, 6));
        const text = String(comment.text || '').replace(/\s+/g, ' ').trim();
        if (text) lines.push(`${indent}[${comment.author || '[deleted]'}]: ${text}`);
        (comment.replies || []).forEach(reply => process(reply, depth + 1));
    }
    comments.forEach(comment => process(comment, 0));
    return lines.join('\n\n');
}

function sendRuntimeMessage(message) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage(message, response => {
            if (chrome.runtime.lastError) {
                resolve({ error: chrome.runtime.lastError.message });
                return;
            }
            resolve(response || {});
        });
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (globalThis.R2AIAiPasterTest) {
    Object.assign(globalThis.R2AIAiPasterTest, {
        attemptPaste,
        pasteImages,
        collectImageUrls
    });
}
