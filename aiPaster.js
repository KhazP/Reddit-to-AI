// filepath: c:\\Users\\alpya\\Documents\\GitHub\\RedditAITools\\aiPaster.js (originally geminiPaster.js)
console.log('AI Paster: Loaded.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'executePaste') {
    console.log('AI Paster: Received executePaste command.');
    // Log the entire request object to see what's coming through
    try {
      console.log('AI Paster: Full request object:', JSON.stringify(request, null, 2));
    } catch (e) {
      console.error('AI Paster: Could not stringify the full request object:', e);
      console.log('AI Paster: Request object (raw):', request);
    }

    const aiConfig = request.aiConfig;
    if (!aiConfig || !aiConfig.inputSelector) {
        console.error('AI Paster: AI configuration or inputSelector not provided.');
        // Log what was actually received as aiConfig
        try {
            console.log('AI Paster: Received aiConfig was:', JSON.stringify(aiConfig, null, 2));
        } catch (e) {
            console.error('AI Paster: Could not stringify the received aiConfig:', e);
            console.log('AI Paster: Received aiConfig (raw):', aiConfig);
        }
        sendResponse({ status: 'Error: AI config missing or incomplete in aiPaster.js' });
        return false; // Synchronous response for this error path
    }
    console.log('AI Paster: Using AI config:', aiConfig.name);

    chrome.storage.local.get('redditThreadData', (result) => {
      if (chrome.runtime.lastError) {
        console.error('AI Paster: Error retrieving data from storage:', chrome.runtime.lastError.message);
        sendResponse({ status: 'Error: Could not get data from storage' });
        return;
      }
      const data = result.redditThreadData;
      if (data) {
        console.log('AI Paster: Data retrieved from storage.');
        const formattedText = formatDataForPasting(data);
        // Get imageDataUrls (plural) - it should be an array
        const imageDataUrls = (data.post && Array.isArray(data.post.imageDataUrls)) ? data.post.imageDataUrls : [];
        const youtubeVideoUrls = (data.post && Array.isArray(data.post.youtubeVideoUrls)) ? data.post.youtubeVideoUrls : [];

        // Call the modified paste function, passing the array
        pasteTextAndMedia(formattedText, imageDataUrls, youtubeVideoUrls, aiConfig, sendResponse);
      } else {
        console.error('AI Paster: No data found in storage.');
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
        console.log(`AI Paster: Comment text cleaned. Original length: ${textBeforeCleaning.length}, New length: ${cleanedText.length}.`);
        // For debugging, you could log the before/after:
        // console.log(`AI Paster: Original text snippet: "${textBeforeCleaning.substring(0, 100)}..."`);
        // console.log(`AI Paster: Cleaned text snippet: "${cleanedText.substring(0, 100)}..."`);
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
  console.log('AI Paster: Formatting data...');
  let formattedString = `REDDIT THREAD ANALYSIS REQUEST\\n`;
  formattedString += `=================================\\n`;
  formattedString += `Thread URL: ${data.url}\\n`; // Changed data.scrapedUrl to data.url
  formattedString += `Subreddit: ${data.post.subreddit}\\n`;
  formattedString += `Title: ${data.post.title}\\n\\n`;

  formattedString += `POST CONTENT:\\n`;
  formattedString += `---------------------------------\\n`;
  formattedString += `${data.post.content || data.post.textContent || 'No text content for the post.'}\\n\\n`; // Added data.post.content as primary

  if (data.post.imageUrls && data.post.imageUrls.length > 0) {
    formattedString += `POST IMAGE URLS (${data.post.imageUrls.length} found):\\n`;
    data.post.imageUrls.forEach(url => formattedString += `- ${url}\\n`);
    if (data.post.imageDataUrls && data.post.imageDataUrls.length > 1) {
        formattedString += `(Note: Multiple images were scraped. The first image will be attempted for pasting.)\\n`;
    }
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
  console.log('AI Paster: Data formatted.');
  // console.log(formattedString); // For debugging the formatted string
  return formattedString;
}

// Helper function to convert dataURL to File object
function dataURLtoFile(dataurl, filename) {
    if (!dataurl) return null;
    try {
        let arr = dataurl.split(','),
            mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch || mimeMatch.length < 2) {
            console.error('AI Paster: Could not parse MIME type from dataURL.');
            return null;
        }
        let mime = mimeMatch[1],
            bstr = atob(arr[1]),
            n = bstr.length,
            u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: mime });
    } catch (e) {
        console.error('AI Paster: Error converting dataURL to File:', e);
        return null;
    }
}

async function typeText(element, text, clearFirst = false) {
    element.focus();
    if (clearFirst) {
        // Clear existing content
        if (element.isContentEditable) {
            element.innerHTML = ''; // For contentEditable
        } else {
            element.value = ''; // For textarea/input
        }
        // Dispatch events to ensure the site recognizes the clear
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 100)); // Short delay after clearing
    }

    // Fallback for non-textarea elements or if execCommand fails
    if (element.isContentEditable || element.tagName !== 'TEXTAREA') {
        // For contentEditable divs, try to set innerText or use clipboard API
        // A common approach for rich text editors is to simulate input or use clipboard
        try {
            // Try to use the clipboard API first for reliability with complex inputs
            await navigator.clipboard.writeText(text);
            element.focus(); // Re-focus after clipboard write
            // Simulate paste for contentEditable. This is more robust.
            const success = document.execCommand('insertText', false, text);
            if (!success) {
                 // Fallback if execCommand('insertText') is not supported or fails
                console.warn('AI Paster: execCommand("insertText") failed, trying to set value/textContent directly.');
                if (element.value !== undefined) element.value = text; // For input/textarea
                else if (element.textContent !== undefined) element.textContent = text; // For other elements
                else element.innerText = text; // Fallback
            }
        } catch (err) {
            console.error('AI Paster: Clipboard or execCommand paste failed:', err);
            // Fallback to direct value/textContent assignment if clipboard/execCommand fails
            if (element.value !== undefined) element.value = text;
            else if (element.textContent !== undefined) element.textContent = text;
            else element.innerText = text;
        }
    } else { // For standard textareas
        element.value = text;
    }
    // Dispatch input and change events to ensure the site recognizes the new value
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    console.log('AI Paster: Text input simulated.');
}


async function pasteTextAndMedia(text, imageDataUrls, youtubeVideoUrls, aiConfig, sendResponse) {
  const selector = aiConfig.inputSelector;
  const aiName = aiConfig.name;
  console.log(`AI Paster: Attempting to paste text and potentially media into ${aiName} using selector: ${selector}`);
  if (imageDataUrls && imageDataUrls.length > 0) {
    console.log(`AI Paster: Received ${imageDataUrls.length} image data URLs.`);
  }
  if (youtubeVideoUrls && youtubeVideoUrls.length > 0) {
    console.log(`AI Paster: Received ${youtubeVideoUrls.length} YouTube video URLs.`);
  }
  
  let attempts = 0;
  const maxAttempts = 10; // Try for 5 seconds (10 attempts * 500ms interval)
  const intervalTime = 500; // 0.5 seconds

  const tryPastingContent = async () => {
    const targetElement = document.querySelector(selector);
    if (targetElement) {
      console.log('AI Paster: Target element found:', targetElement);
      let pasteStatusMessage = "";

      try {
        // 1. Paste Main Text Content
        await typeText(targetElement, text, false); // Don't clear first for the main text
        console.log(`AI Paster: Successfully pasted main text content into ${aiName}.`);
        pasteStatusMessage = `Pasted text into ${aiName}.`;

        // 2. Paste Images (if any)
        if (imageDataUrls && imageDataUrls.length > 0) {
          console.log(`AI Paster: ${imageDataUrls.length} imageDataUrl(s) found, attempting to paste all.`);
          let imagesPastedSuccessfully = 0;
          let imagesAttempted = 0;

          for (const imageDataUrl of imageDataUrls) {
            imagesAttempted++;
            const imageFile = dataURLtoFile(imageDataUrl, `reddit_post_image_${imagesAttempted}.png`);
            if (imageFile) {
              try {
                targetElement.focus(); 

                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(imageFile);

                targetElement.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }));
                targetElement.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }));
                
                await new Promise(resolve => setTimeout(resolve, 200)); 

                targetElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }));
                
                console.log(`AI Paster: Image ${imagesAttempted}/${imageDataUrls.length} drop event dispatched for ${aiName}.`);
                imagesPastedSuccessfully++;
                if (imageDataUrls.length > 1 && imagesAttempted < imageDataUrls.length) {
                    await new Promise(resolve => setTimeout(resolve, 500)); 
                }

              } catch (imgError) {
                console.error(`AI Paster: Error during image pasting for image ${imagesAttempted}/${imageDataUrls.length} for ${aiName}:`, imgError);
              }
            } else {
              console.warn(`AI Paster: Could not convert imageDataUrl to File object for image ${imagesAttempted}/${imageDataUrls.length}.`);
            }
          }

          if (imagesPastedSuccessfully > 0) {
            pasteStatusMessage += ` ${imagesPastedSuccessfully}/${imageDataUrls.length} image(s) pasting attempted.`;
          } else {
            pasteStatusMessage += ` Image pasting attempted for ${imageDataUrls.length} image(s), but none were successfully processed or dispatched.`;
          }
        } else {
            console.log('AI Paster: No image data URLs provided or array is empty.');
        }

        // 3. Paste YouTube Video URLs (specifically for AI Studio)
        if (aiName === "AI Studio" && youtubeVideoUrls && youtubeVideoUrls.length > 0) {
            console.log(`AI Paster: AI Studio detected. Pasting ${youtubeVideoUrls.length} YouTube URLs individually.`);
            pasteStatusMessage += ` Pasting ${youtubeVideoUrls.length} YouTube URL(s) for AI Studio.`;
            for (let i = 0; i < youtubeVideoUrls.length; i++) {
                const videoUrl = youtubeVideoUrls[i];
                console.log(`AI Paster: Clearing input and pasting YouTube URL ${i + 1}/${youtubeVideoUrls.length}: ${videoUrl}`);
                await typeText(targetElement, videoUrl, true); // Clear before pasting each URL
                
                // Optional: Simulate an 'Enter' key press if AI Studio requires it to process the URL
                // targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
                // targetElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
                // console.log('AI Paster: Simulated Enter press after pasting YouTube URL.');

                if (i < youtubeVideoUrls.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds before pasting the next URL
                }
            }
            console.log('AI Paster: Finished pasting YouTube URLs for AI Studio.');
        } else if (youtubeVideoUrls && youtubeVideoUrls.length > 0) {
            // For other AI platforms, append YouTube URLs to the main text or handle as configured
            // For now, they are already included in the main formatted text via formatDataForPasting
            console.log(`AI Paster: ${aiName} is not AI Studio. YouTube URLs are part of the main text.`);
        }


        sendResponse({ status: pasteStatusMessage });
      } catch (error) {
        console.error(`AI Paster: Error during paste operation for ${aiName}:`, error);
        sendResponse({ status: `Error pasting content into ${aiName}: ${error.message}` });
      }
    } else {
      attempts++;
      if (attempts < maxAttempts) {
        console.log(`AI Paster: Target element not found for ${aiName}. Attempt ${attempts}/${maxAttempts}. Retrying in ${intervalTime}ms...`);
        setTimeout(tryPastingContent, intervalTime);
      } else {
        console.error(`AI Paster: Target element not found for ${aiName} with selector: ${selector} after ${maxAttempts} attempts.`);
        sendResponse({ status: `Error: ${aiName} chat input not found after ${maxAttempts} attempts.` });
      }
    }
  };

  tryPastingContent();
}

// Renamed pasteTextAndImage to pasteTextAndMedia in its call earlier
// function pasteTextAndImage(text, imageDataUrls, selector, aiName, sendResponse) { ... }

