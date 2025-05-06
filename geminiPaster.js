// Placeholder for geminiPaster.js
// This script will be injected into the Gemini tab to paste content.

console.log('Gemini Paster: Loaded.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'executePaste') {
    console.log('Gemini Paster: Received executePaste command.');
    chrome.storage.local.get('redditThreadData', (result) => {
      if (chrome.runtime.lastError) {
        console.error('Gemini Paster: Error retrieving data from storage:', chrome.runtime.lastError.message);
        sendResponse({ status: 'Error: Could not get data from storage' });
        return;
      }
      const data = result.redditThreadData;
      if (data) {
        console.log('Gemini Paster: Data retrieved from storage:', data);
        const formattedText = formatDataForPasting(data);
        pasteIntoGemini(formattedText, sendResponse);
      } else {
        console.error('Gemini Paster: No data found in storage.');
        sendResponse({ status: 'Error: No data in storage' });
      }
    });
    return true; // Indicates that the response will be sent asynchronously
  }
});

function formatCommentLevel(comments, currentDepth) {
  let formattedComments = "";
  const indent = '    '.repeat(currentDepth); // Four spaces per depth level
  const replyMarker = currentDepth > 0 ? '\\u21B3 ' : ''; // Unicode U+21B3 for '↳'

  comments.forEach(comment => {
    let originalText = comment.text || 'N/A';
    let cleanedText = originalText;

    if (originalText !== 'N/A') {
      let textBeforeCleaning = cleanedText;

      // Regex to remove patterns like:
      // Author Name (on one line)
      // • X time ago (on the next line)
      // ...from the beginning of the comment text.
      const unwantedPrefixPattern = /^\\s*[^\\n]+\\n\\s*•\\s*\\d+\\s*(?:d|h|m|s|days?|hours?|minutes?|seconds?)\\s+ago\\s*\\n?/i;
      cleanedText = cleanedText.replace(unwantedPrefixPattern, '');

      // Regex to remove patterns like "• X time ago" from the end of the comment text.
      const unwantedSuffixPattern = /\\s*•\\s*\\d+\\s*(?:d|h|m|s|days?|hours?|minutes?|seconds?)\\s+ago\\s*$/i;
      cleanedText = cleanedText.replace(unwantedSuffixPattern, '');

      cleanedText = cleanedText.trim();

      if (cleanedText !== textBeforeCleaning) {
        console.log(`Gemini Paster: Comment text cleaned. Original length: ${textBeforeCleaning.length}, New length: ${cleanedText.length}.`);
        // For debugging, you could log the before/after:
        // console.log(`Gemini Paster: Original text snippet: "${textBeforeCleaning.substring(0, 100)}..."`);
        // console.log(`Gemini Paster: Cleaned text snippet: "${cleanedText.substring(0, 100)}..."`);
      }
    }

    // Format current comment
    formattedComments += `\\n${indent}${replyMarker}Author: ${comment.author || 'N/A'}`;
    formattedComments += ` (Score: ${comment.score !== null && comment.score !== undefined ? comment.score : 'N/A'}, Time: ${comment.timestamp || 'N/A'})\\n`;
    formattedComments += `${indent}${replyMarker}Comment: ${cleanedText}\\n`;
    formattedComments += `${indent}${replyMarker}---\\n`;

    // Recursively format replies
    if (comment.replies && comment.replies.length > 0) {
      formattedComments += formatCommentLevel(comment.replies, currentDepth + 1);
    }
  });

  return formattedComments;
}

function formatDataForPasting(data) {
  console.log('Gemini Paster: Formatting data...');
  let formattedString = `REDDIT THREAD ANALYSIS REQUEST\\n`;
  formattedString += `=================================\\n`;
  formattedString += `Thread URL: ${data.url}\\n`; // Changed data.scrapedUrl to data.url
  formattedString += `Subreddit: ${data.post.subreddit}\\n`;
  formattedString += `Title: ${data.post.title}\\n\\n`;

  formattedString += `POST CONTENT:\\n`;
  formattedString += `---------------------------------\\n`;
  formattedString += `${data.post.content || data.post.textContent || 'No text content for the post.'}\\n\\n`; // Added data.post.content as primary

  if (data.post.imageUrls && data.post.imageUrls.length > 0) {
    formattedString += `POST IMAGE URLS:\\n`;
    data.post.imageUrls.forEach(url => formattedString += `- ${url}\\n`);
    formattedString += `\\n`;
  }

  if (data.post.linkUrls && data.post.linkUrls.length > 0) {
    formattedString += `POST LINK URLS:\\n`;
    data.post.linkUrls.forEach(url => formattedString += `- ${url}\\n`);
    formattedString += `\\n`;
  }

  formattedString += `COMMENTS:\\n`;
  formattedString += `---------------------------------\\n`;
  if (data.comments && data.comments.length > 0) {
    formattedString += formatCommentLevel(data.comments, 0); // Initial call to the recursive helper
  } else {
    formattedString += `No comments were scraped or found.\\n`;
  }
  console.log('Gemini Paster: Data formatted.');
  // console.log(formattedString); // For debugging the formatted string
  return formattedString;
}

async function pasteIntoGemini(textToPaste, sendResponse) {
  console.log('Gemini Paster: Attempting to paste content into Gemini...');
  
  const selectorsToTry = [
    'div[contenteditable="true"][aria-label="Enter a prompt here"]', // Prioritized based on new HTML
    'div.ql-editor.textarea.new-input-ui[contenteditable="true"]', // Second strong candidate
    // Older selectors, kept as fallbacks for now, but might be removed later if new ones are stable
    'rich-text-editor div.ql-editor[contenteditable="true"]', 
    'textarea[aria-label*="Prompt"]', 
    'div[contenteditable="true"][aria-label*="Message"]', 
    '[data-testid="chat-input-textarea"]' 
  ];

  let inputField = null;
  for (const selector of selectorsToTry) {
    inputField = document.querySelector(selector);
    if (inputField) {
      console.log(`Gemini Paster: Found input field with selector: ${selector}`);
      break;
    }
  }

  if (inputField) {
    try {
      inputField.focus();
      console.log('Gemini Paster: Input field focused.');

      // Clear existing content if any (Gemini might retain previous prompts)
      if (inputField.isContentEditable) {
        inputField.innerHTML = ''; // Clear contenteditable div
      } else {
        inputField.value = ''; // Clear textarea/input
      }
      console.log('Gemini Paster: Input field cleared.');

      // Method 1: Simulate typing by setting value and dispatching events
      // This is often more reliable for SPAs.
      if (inputField.isContentEditable) {
        // For contenteditable, directly setting innerHTML is appropriate.
        // Ensure text is properly escaped and formatted with <p> tags for newlines.
        inputField.innerHTML = ''; // Clear existing content first
        const paragraphs = textToPaste.split('\n');
        let htmlToInsert = '';
        paragraphs.forEach(pText => {
            // Escape HTML special characters in the paragraph text
            const escapedText = pText.replace(/&/g, '&amp;')
                                     .replace(/</g, '&lt;')
                                     .replace(/>/g, '&gt;')
                                     .replace(/"/g, '&quot;')
                                     .replace(/'/g, '&#039;');
            if (escapedText.trim() === '') {
                htmlToInsert += '<p><br></p>'; // Handle empty lines as new paragraphs
            } else {
                htmlToInsert += `<p>${escapedText}</p>`;
            }
        });
        inputField.innerHTML = htmlToInsert;
        console.log('Gemini Paster: Content set via innerHTML for contenteditable div.');

      } else { // For textarea or standard input (less likely for Gemini's current UI)
        inputField.value = textToPaste;
        console.log('Gemini Paster: Content set via value for input/textarea.');
      }

      // Dispatch input event to ensure the UI recognizes the change
      inputField.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      // Sometimes, a 'change' event or even focus/blur might be needed.
      // inputField.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      console.log('Gemini Paster: "input" event dispatched.');
      
      // Small delay to allow UI to process the input event
      await new Promise(resolve => setTimeout(resolve, 100));

      // Optional: Attempt to enable the send button if it's disabled and text is present
      // This depends heavily on Gemini's specific send button selector and disabled state logic
      const sendButton = document.querySelector('button[aria-label*="Send"], button[data-testid*="send_button"]');
      if (sendButton && sendButton.disabled && inputField.textContent.trim().length > 0) {
          console.log('Gemini Paster: Attempting to enable send button (experimental).');
          // This is highly speculative and might not work or be necessary.
          // sendButton.disabled = false; 
          // sendButton.click(); // Or just enable it and let user click
      }

      sendResponse({ status: 'Paste successful (attempted)' });

    } catch (error) {
      console.error('Gemini Paster: Error during pasting operation:', error);
      sendResponse({ status: `Error: Pasting failed - ${error.message}` });
    }
  } else {
    console.error('Gemini Paster: Could not find Gemini input field. The UI might have changed, or the selectors are outdated.');
    sendResponse({ status: 'Error: Gemini input field not found' });
    // Fallback: Copy to clipboard and notify user
    try {
        await navigator.clipboard.writeText(textToPaste);
        console.log('Gemini Paster: Content copied to clipboard as a fallback.');
        chrome.runtime.sendMessage({
            action: 'notifyUser',
            title: 'Reddit AI Tool - Action Required',
            message: 'Could not paste directly into Gemini. Content copied to clipboard. Please paste it manually.'
        });
    } catch (err) {
        console.error('Gemini Paster: Failed to copy to clipboard:', err);
    }
  }
}

// Initial log to confirm script injection
console.log('Gemini Paster: Script injected and ready to receive messages.');
