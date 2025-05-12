// redditScraper.js - Content script for scraping Reddit threads

// Guard to prevent multiple executions/declarations in the same context
if (typeof window.redditScraperInitialized === 'undefined') {
    window.redditScraperInitialized = true;

    console.log("Reddit Scraper script initializing for the first time.");

    // Helper function to send progress updates to the service worker
    function sendProgressUpdate(message, percentage = undefined) {
        try {
            console.log("RedditScraper: Sending progress update:", message, percentage); // For debugging in content script
            chrome.runtime.sendMessage({ action: "progressUpdate", message: message, percentage: percentage });
        } catch (e) {
            console.warn("RedditScraper: Could not send progress update (popup/service worker might be closed):", e.message);
        }
    }

    // Global-like variables for a single scraping session.
    // These are reset by scrapeRedditData for each new operation.
    let allCommentsMap;
    let observer;
    let loadMoreAttempts;
    let MAX_LOAD_MORE_ATTEMPTS;
    let stableChecks;
    let MAX_STABLE_CHECKS;
    let scrapingTimeoutId;
    let SCRAPING_TIMEOUT;
    let CHECK_INTERVAL;
    let includeHiddenCommentsState;
    let resolvePromiseScraping; // Stores the resolve function for the main comment scraping promise
    let rejectPromiseScraping; // Stores the reject function for the main comment scraping promise
    let currentSendResponse; // <<<< ADD THIS LINE
    let checkIntervalId; // ID for the checkIfDoneScraping interval
    let OBSERVER_QUIET_PERIOD; // e.g., 2000-3000ms

    async function loadConfiguration() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['maxLoadMoreAttempts'], (result) => {
                MAX_LOAD_MORE_ATTEMPTS = result.maxLoadMoreAttempts || 75; // Default to 75 if not set
                console.log("Configuration loaded: MAX_LOAD_MORE_ATTEMPTS set to", MAX_LOAD_MORE_ATTEMPTS);
                resolve();
            });
        });
    }

    // Helper function for scrolling and delaying
    async function scrollPageAndDelay(pixels = window.innerHeight, delay = 500) {
        return new Promise(resolve => {
            window.scrollBy({ top: pixels, behavior: 'smooth' });
            setTimeout(() => {
                resolve();
            }, delay);
        });
    }

    console.log("Reddit Scraper script loaded.");

    function extractPostDetails() {
        sendProgressUpdate("Inspecting post details...");
        console.log("extractPostDetails called");
        const post = {};
        let postElement = document.querySelector('shreddit-post');
        let postElementSelector = 'shreddit-post';
        console.log("Initial attempt to find 'shreddit-post':", postElement);

        if (!postElement) {
            console.warn("shreddit-post not found. Trying alternative post containers...");
            const alternativeSelectors = [
                'article[data-testid="post-container"]', // Common for newer UIs
                'div[data-testid="post-container"]', 
                'div[id^="t3_"] > div:first-child', // Older structure, t3_ is post ID prefix
                '.Post', // Common class name
                '#main-content .Post', // More specific
                'div[data-post-id]' // Posts often have a data-post-id attribute
            ];
            for (const selector of alternativeSelectors) {
                postElement = document.querySelector(selector);
                if (postElement) {
                    postElementSelector = selector;
                    console.log("Found post container with alternative selector:", selector, postElement);
                    break;
                } else {
                    console.log("Alternative post container selector did not find element:", selector);
                }
            }
        }

        if (!postElement) {
            console.error("CRITICAL: Could not find a suitable post container element. Falling back to document.body. This will likely result in failure to extract content and comments.");
            postElement = document.body; // Last resort, might lead to poor extraction
            postElementSelector = 'document.body (fallback)';
        }
        console.log("Using post element found with selector:", postElementSelector, postElement);

        const titleSelectors = ['h1[slot="title"]', '[data-testid="post-title"]', 'h1', 'meta[property="og:title"]'];
        let titleElement = null;
        for (const selector of titleSelectors) {
            titleElement = postElement.querySelector(selector) || document.querySelector(selector); // Also check document level for meta
            if (titleElement) {
                post.title = selector.startsWith('meta') ? titleElement.getAttribute('content') : titleElement.textContent.trim();
                if (post.title) {
                    console.log("Found title with selector:", selector);
                    break;
                }
            }
        }
        if (!post.title) {
            post.title = '[Title not found]';
            console.warn("Post title not found with selectors:", titleSelectors.join(', '));
        }


        const authorSelectors = ['a[slot="authorName"]', '[data-testid="post-author-name"]', 'a[href*="/user/"]', '[data-testid="post_author_link"]'];
        let authorLink = null;
        post.author = postElement.getAttribute('author');
        if (!post.author) {
            for (const selector of authorSelectors) {
                authorLink = postElement.querySelector(selector);
                if (authorLink) {
                    post.author = authorLink.textContent.trim();
                    if (post.author) {
                        console.log("Found author with selector:", selector);
                        break;
                    }
                }
            }
        }
        if (!post.author) {
            post.author = '[Author not found]';
            console.warn("Post author not found with selectors:", authorSelectors.join(', '));
        }
        

        const subredditSelectors = ['a[slot="subredditName"]', 'a[href*="/r/"]', '[data-testid="post_subreddit_link"]'];
        let subredditLink = null;
        post.subreddit = postElement.getAttribute('subreddit-name');
         if (!post.subreddit) {
            for (const selector of subredditSelectors) {
                subredditLink = postElement.querySelector(selector);
                if (subredditLink) {
                    post.subreddit = subredditLink.textContent.trim().replace(/^r\//, '');
                    if (post.subreddit) {
                        console.log("Found subreddit with selector:", selector);
                        break;
                    }
                }
            }
        }
        if (!post.subreddit) {
            post.subreddit = '[Subreddit not found]';
            console.warn("Post subreddit not found with selectors:", subredditSelectors.join(', '));
        }

        let contentHTML = '';
        let postTextContent = ''; // Variable to store plain text
        const textContentSelectors = [
            'div[slot="text-body"]', // shreddit-post specific
            'div[data-click-id="text"]', // Older Reddit
            'div[data-testid="post-richtext-content"]', // Newer Reddit rich text
            '.RichTextJSON-root', // Another common class for rich text
            'div[data-adclicklocation="media"]', // Sometimes text content is within media containers
            '.Post__body', // Generic post body class
            'article div[data-testid="post-content"] > div:not([class])', // Attempt to get direct text content
        ];

        console.log("Attempting to extract post text content using selectors:", textContentSelectors.join(", "));
        for (const selector of textContentSelectors) {
            const container = postElement.querySelector(selector);
            if (container) {
                console.log("Found potential text content container with selector:", selector, container);
                
                // Extract plain text
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = container.innerHTML;
                let extractedText = (tempDiv.textContent || tempDiv.innerText || "").trim();
                
                console.log("Container HTML snippet:", container.innerHTML ? container.innerHTML.substring(0, 150) : "N/A");
                console.log("Extracted plain text snippet:", extractedText ? extractedText.substring(0, 150) : "N/A");

                if (extractedText && extractedText.length > 10) { 
                     postTextContent = extractedText; // Store plain text
                     contentHTML = container.innerHTML; // Keep original HTML for context if needed elsewhere, or for image/link parsing
                     console.log("Extracted text content using selector:", selector, "Plain text snippet:", postTextContent.substring(0,100));
                     break; 
                } else {
                    console.log("Selector", selector, "yielded little or no plain text. Length:", extractedText ? extractedText.length : 0);
                }
            } else {
                 console.log("Text content selector", selector, "not found in postElement.");
            }
        }
        console.log("Final raw contentHTML (for reference/media extraction):", contentHTML.substring(0, 300) + "...");
        console.log("Final plain postTextContent:", postTextContent.substring(0, 300) + "...");
        
        // Image and video extraction can still use contentHTML or query postElement directly
        post.imageUrls = [];
        post.linkUrls = []; // Initialize linkUrls
        post.youtubeVideoUrls = []; // Initialize youtubeVideoUrls

        console.log("Attempting to extract images (gallery-first approach)...");

        let galleryFound = false;

        // Attempt 1: shreddit-gallery
        const shredditGallery = postElement.querySelector('shreddit-gallery');
        if (shredditGallery) {
            console.log("Found shreddit-gallery element.");
            // Prefer images with class 'media-lightbox-img', then other common patterns
            shredditGallery.querySelectorAll('ul li figure img.media-lightbox-img, ul li img.media-lightbox-img, figure img.media-lightbox-img, img.media-lightbox-img, ul li figure img, figure img, img').forEach(img => {
                let imgSrc = img.src;
                // Ensure src is valid, not a data URI, and the element is likely visible/part of content
                if (imgSrc && !imgSrc.startsWith('data:') && img.offsetParent !== null) {
                    if (!post.imageUrls.includes(imgSrc)) {
                        post.imageUrls.push(imgSrc);
                        console.log("Extracted image from shreddit-gallery:", imgSrc);
                        galleryFound = true;
                    }
                }
            });
        }

        // Attempt 2: Generic gallery structure (multiple figures with images with 'media-lightbox-img' or similar)
        // This runs if shreddit-gallery not found or yielded no images.
        if (!galleryFound) {
            console.log("shreddit-gallery not found or no images extracted. Trying generic figure-based gallery detection.");
            const potentialGalleryImages = [];
            // Look for figures directly under the post element or common content wrappers, prioritizing 'media-lightbox-img'
            postElement.querySelectorAll('figure > img.media-lightbox-img, div[class*="gallery"] img, ul[class*="gallery"] li img, figure > img').forEach(img => {
                 let imgSrc = img.src;
                 if (imgSrc && !imgSrc.startsWith('data:') && img.offsetParent !== null) {
                    // Check if the image source seems like a unique image and not a tiny icon/avatar by checking dimensions if easily available, or rely on context
                    // For now, we'll accept it if it's visible and has a source.
                    if (!potentialGalleryImages.includes(imgSrc)) {
                        potentialGalleryImages.push(imgSrc);
                    }
                }
            });

            if (potentialGalleryImages.length > 0) { // If any images found this way, consider it a success for this step
                potentialGalleryImages.forEach(imgSrc => {
                    if (!post.imageUrls.includes(imgSrc)) { // Final check before adding to main list
                        post.imageUrls.push(imgSrc);
                        console.log("Extracted image from generic figure/gallery structure:", imgSrc);
                        // galleryFound = true; // Set if we are sure this is a gallery, or just collecting all images
                    }
                });
                if (potentialGalleryImages.length > 1) galleryFound = true; // Mark as gallery if multiple distinct images
            }
        }

        // Fallback / Augmentation: General image selectors (catches single images, linked images, etc.)
        // This will also catch images if gallery detection failed or if there are other images outside detected galleries.
        console.log("Running fallback/additional image extraction logic.");
        const imageSelectors = [
            'shreddit-image', // Modern image element (might have src attribute)
            'img[alt*="Post image" i], img[alt*="gallery image" i], img[data-testid="post-image"]', // Common alt texts and test ids
            'div[data-testid="post-content"] img', // Images within general post content
            'a[href$=".jpg" i], a[href$=".png" i], a[href$=".gif" i], a[href$=".jpeg" i], a[href$=".webp" i]' // Links to images (case-insensitive)
        ];

        postElement.querySelectorAll(imageSelectors.join(', ')).forEach(imgOrLink => {
            let imgSrc = '';
            if (imgOrLink.tagName === 'SHREDDIT-IMAGE' && imgOrLink.getAttribute('src')) {
                imgSrc = imgOrLink.getAttribute('src');
            } else if (imgOrLink.tagName === 'IMG' && imgOrLink.src && !imgOrLink.src.startsWith('data:')) {
                imgSrc = imgOrLink.src;
            } else if (imgOrLink.tagName === 'A' && imgOrLink.href) {
                if (/\.(jpeg|jpg|gif|png|webp)$/i.test(imgOrLink.href)) {
                    imgSrc = imgOrLink.href;
                }
            }

            // For img elements, check visibility; for SHREDDIT-IMAGE and A, primarily check if src was resolved.
            let isLikelyContentImage = (imgOrLink.tagName === 'IMG' && imgOrLink.offsetParent !== null) || 
                                     (imgOrLink.tagName === 'SHREDDIT-IMAGE' && imgSrc) ||
                                     (imgOrLink.tagName === 'A' && imgSrc);

            if (imgSrc && isLikelyContentImage) {
                if (!post.imageUrls.includes(imgSrc)) {
                    post.imageUrls.push(imgSrc);
                    console.log("Extracted image via fallback/additional selector:", imgSrc, "using element:", imgOrLink.tagName);
                }
            }
        });
        
        if (post.imageUrls.length > 0) {
            // Deduplicate URLs just in case (e.g. http vs https, or with query params)
            // A more robust deduplication might normalize URLs first.
            const uniqueImageUrls = [];
            const seenUrls = new Set();
            for (const url of post.imageUrls) {
                const normalizedUrl = new URL(url, window.location.origin).href; // Basic normalization
                if (!seenUrls.has(normalizedUrl)) {
                    uniqueImageUrls.push(url); // Push original URL
                    seenUrls.add(normalizedUrl);
                }
            }
            post.imageUrls = uniqueImageUrls;
            console.log(`Total unique images extracted: ${post.imageUrls.length}`, post.imageUrls);
        } else {
            console.log("No images found for this post.");
        }

        // Video extraction
        const videoSelectors = [
            'shreddit-player', // Modern video player
            'video source[src]',
            'div[data-testid="post-media"] video'
        ];
        postElement.querySelectorAll(videoSelectors.join(', ')).forEach(videoEl => {
            let videoSrc = '';
            if (videoEl.tagName === 'SHREDDIT-PLAYER') {
                videoSrc = videoEl.getAttribute('embed-url') || videoEl.getAttribute('content-href');
            } else if (videoEl.tagName === 'SOURCE') {
                videoSrc = videoEl.src;
            } else if (videoEl.tagName === 'VIDEO' && videoEl.currentSrc) {
                videoSrc = videoEl.currentSrc;
            }
            if (videoSrc) {
                // contentHTML += `<p>[Embedded Video: ${videoSrc}]</p>`;
                // For now, let's treat video URLs like other links if we don't have a specific way to embed.
                // Or, we can add a specific field for video URLs if needed.
                if (!post.linkUrls.includes(videoSrc)) post.linkUrls.push(videoSrc);
                console.log("Extracted video URL:", videoSrc);
            }
        });
        
        // Extract other links from the post body if postTextContent was derived from HTML that might have links
        // This is a simplified approach; more robust link extraction might be needed.
        if (contentHTML) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = contentHTML; // Use the HTML from which postTextContent was derived
            tempDiv.querySelectorAll('a[href]').forEach(link => {
                const href = link.href;
                const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
                const isYouTubeLink = youtubeRegex.test(href);

                if (isYouTubeLink) {
                    if (!post.youtubeVideoUrls.includes(href)) {
                        post.youtubeVideoUrls.push(href);
                        console.log("Extracted YouTube video URL from post body:", href);
                    }
                } else if (href && !href.startsWith('javascript:') && !href.startsWith('#') && !post.imageUrls.includes(href) && !post.linkUrls.includes(href)) {
                    // Basic check to avoid adding links that are just duplicates of image URLs already found
                    let isAlreadyImage = false;
                    for(const imgUrl of post.imageUrls) {
                        if (href.includes(imgUrl) || imgUrl.includes(href)) {
                            isAlreadyImage = true;
                            break;
                        }
                    }
                    if (!isAlreadyImage) {
                         post.linkUrls.push(href);
                         console.log("Extracted link URL from post body:", href);
                    }
                }
            });
        }


        post.content = postTextContent.trim() || '[Content not found or not a text post]'; // Assign the cleaned plain text
        post.url = window.location.href;
        post.scrapedAt = new Date().toISOString();

        console.log("Final extracted post details:", {title: post.title, author: post.author, subreddit: post.subreddit, contentSnippet: post.content.substring(0, 200) + "...", youtubeLinks: post.youtubeVideoUrls});
        sendProgressUpdate("Post details extracted.");
        return post;
    }

    function extractCommentData(element, includeHiddenComments, depth = 0) {
        const thingId = element.getAttribute('thingid'); 
        if (!thingId) {
            console.warn('extractCommentData: Element without thingid', element.tagName, element.id);
            return null;
        }
        if (!element.matches || !element.matches('shreddit-comment')) { 
            console.warn(`extractCommentData: Element not shreddit-comment: ${element.tagName}, thingid: ${thingId}`); 
            return null;
        }

        // Future: Expand collapsed comments if includeHiddenCommentsState is true
        // if (includeHiddenCommentsState && element.hasAttribute('collapsed') && element.getAttribute('collapsed') === 'true') {
        //     console.log(`Comment ${thingId} is collapsed. Future: attempt to expand.`);
        //     const expandButton = element.querySelector('button[aria-expanded="false"], [id^="comment-fold-button-"]');
        //     if (expandButton) {
        //         console.log(`Found expand button for collapsed comment ${thingId}`);
        //         // expandButton.click(); // Future: enable this and handle async nature, then re-process or wait
        //     }
        // }

        const commentId = thingId;
        let parentId = element.getAttribute('parentid') || element.parentElement?.closest('shreddit-comment')?.getAttribute('thingid') || null;

        let author = element.getAttribute('author') || '[unknown]';
        if (author === '[unknown]') {
            const authorEl = element.querySelector('a[data-testid="comment_author_link"], .Comment__author, [slot="authorName"], [data-testid="comment_author"]');
            if (authorEl) author = authorEl.textContent.trim();
        }
        
        const createdTimestamp = element.getAttribute('created-timestamp');
        const scoreString = element.getAttribute('score');
        let parsedScore = scoreString && !isNaN(parseInt(scoreString, 10)) ? parseInt(scoreString, 10) : null;

        const depthAttr = element.getAttribute('depth');
        let actualDepth = depthAttr !== null && !isNaN(parseInt(depthAttr, 10)) ? parseInt(depthAttr, 10) : depth;

        let commentTextContent = "";
        let textFoundPath = "not found";

        // --- Stage 1: Attempt extraction from a specific comment body container ---
        console.log(`Comment ${commentId}: Starting text extraction. Author: ${author}`);
        const commentBodySelectors = [
            'div[slot="comment"]',
            'div[data-testid="comment-body"]',
            '#comment-rtjson-content', // Seen in some newer UIs
            '.md', // Classic markdown container
            '.richtext', // Classic richtext container
        ];
        let commentBodyContainer = null;
        for (const selector of commentBodySelectors) {
            commentBodyContainer = element.querySelector(selector);
            if (commentBodyContainer) {
                console.log(`Comment ${commentId}: Found primary comment body container with selector: ${selector}`);
                console.log(`Comment ${commentId}: InnerHTML of commentBodyContainer (first 500 chars):`, commentBodyContainer.innerHTML.substring(0, 500));
                break;
            }
        }

        if (commentBodyContainer) {
            const clonedBody = commentBodyContainer.cloneNode(true);
            const selectorsToRemove = [
                '.action-buttons-container', 'div[data-testid="comment-actionBar"]', 'div[data-testid="comment-meta-line"]', 
                'faceplate-dropdown-menu', 'button[aria-label="More options"]', 'button[data-testid="comment-report-button"]',
                'button[data-testid="comment-share-button"]','button[data-testid="comment-save-button"]','button[id^="comment-overflow-menu"]',
                'button[data-testid^="comment-reply-"]', 'a[data-testid="comment-permalink"]', 'span[data-testid="meta-text"]',
                'div[class*="CommentBottomBar__container"]', // Another common action bar class
                'div[class*="CommentHeader__meta"]' // Common metadata header class
            ];
            selectorsToRemove.forEach(selector => {
                clonedBody.querySelectorAll(selector).forEach(el => el.remove());
            });
            console.log(`Comment ${commentId}: Cleaned clonedBody innerHTML (first 500 chars after UI removal):`, clonedBody.innerHTML.substring(0, 500));
            
            const paragraphSelectors = [
                ':scope > p', 
                ':scope > div.richtext-paragraph', 
                ':scope > div[data-testid="comment"] > div > p', 
                ':scope > blockquote p', // Paragraphs inside blockquotes, any level
                ':scope > ul > li', 
                ':scope > ol > li'
            ];
            let extractedParagraphTexts = [];
            paragraphSelectors.forEach(selector => {
                clonedBody.querySelectorAll(selector).forEach(el => {
                    const pText = el.textContent.trim();
                    const actionWordsForParaCheck = ["Reply", "Share", "Edit", "More replies", "Collapse"]; // Shorter list for para check
                    let isLikelyActionText = false;
                    if (pText.length < 30) {
                        isLikelyActionText = actionWordsForParaCheck.some(action => {
                            const regex = new RegExp(`^${action.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}$`, 'i'); // Exact match, case insensitive
                            return regex.test(pText);
                        });
                    }
                    if (!isLikelyActionText && pText) { // Ensure pText is not empty
                        extractedParagraphTexts.push(pText);
                        console.log(`Comment ${commentId}: Extracted paragraph using selector "${selector}": "${pText.substring(0,100)}"`);
                    } else if (isLikelyActionText) {
                        console.log(`Comment ${commentId}: Skipped potential action text in paragraph using selector "${selector}": "${pText.substring(0,100)}"`);
                    }
                });
            });

            if (extractedParagraphTexts.length > 0) {
                commentTextContent = extractedParagraphTexts.join('\\n').trim();
                textFoundPath = `Stage 1: Extracted from ${extractedParagraphTexts.length} specific paragraph(s) after cleaning container`;
                console.log(`Comment ${commentId}: Text after joining paragraphs ("${textFoundPath}"): "${commentTextContent.substring(0, 200)}"`);
            } else {
                commentTextContent = clonedBody.textContent.trim();
                textFoundPath = `Stage 1: Fallback to cleaned container's textContent`;
                console.log(`Comment ${commentId}: Text from cleaned container's textContent ("${textFoundPath}"): "${commentTextContent.substring(0, 200)}"`);
            }
        }

        // --- Stage 2: Try specific modern renderer if Stage 1 failed or yielded little ---
        if (!commentTextContent || commentTextContent.length < 10) { 
            const markdownRendererEl = element.querySelector('shreddit-comment-markdown-renderer');
            if (markdownRendererEl) {
                const rendererText = markdownRendererEl.textContent.trim();
                if (rendererText && rendererText.length > (commentTextContent?.length || 0) ) { // Use if it's better
                    commentTextContent = rendererText;
                    textFoundPath = "Stage 2: shreddit-comment-markdown-renderer";
                    console.log(`Comment ${commentId}: Text from markdownRendererEl ("${textFoundPath}"): "${commentTextContent.substring(0, 200)}"`);
                }
            }
        }

        // --- Stage 3: Broader Fallback with Enhanced Cleaning ---
        const textBeforeFallbackCleaning = commentTextContent;
        console.log(`Comment ${commentId}: Text BEFORE Stage 3 Fallback Cleaning (current path: "${textFoundPath}"): "${textBeforeFallbackCleaning.substring(0, 200)}"`);

        let cleanedText = commentTextContent || ""; // Ensure cleanedText is a string

        const actionLinkTexts = [
            "Reply", "Share", "Save", "Edit", "Vote", "More replies", "Collapse", "Permalink", 
            "Embed", "Parent", "Context", "Full Comments", "Give Award", "Report",
            "level\\s*\\d+\\s*comment", "OP", "\\d+\\s*points?", "\\d+\\s*children", // Added ? for point/points
            "Continue this thread", "View entire discussion", "Collapse replies", "Show parent comments"
        ];

        actionLinkTexts.forEach(action => {
            const regex = new RegExp(`(^|\\s|\\n|•\\s*)${action.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}(\\s|\\n|•|$|\\.)`, 'gi');
            cleanedText = cleanedText.replace(regex, (match, p1, p2) => { // p1 is char before, p2 is char after
                // Preserve surrounding newlines or bullet points, otherwise replace with a single space if surrounded by spaces
                if ((p1 === '\\n' && p2 === '\\n') || (p1 === '\\n' && p2 === '$') || (p1 === '^' && p2 === '\\n')) return '\\n';
                if (p1.trim() === '•' && p2.trim() === '') return p1; // Keep bullet if action was after it
                if (p1.trim() === '' && p2.trim() === '•') return p2; // Keep bullet if action was before it
                return (p1 === ' ' && p2 === ' ') ? ' ' : p1.endsWith('\\n') || p2.startsWith('\\n') ? '\\n' : ' ';
            }).trim();
        });
        if (cleanedText !== textBeforeFallbackCleaning) { // Check if any change happened
             console.log(`Comment ${commentId}: Text after removing action link texts: "${cleanedText.substring(0, 200)}"`);
        }


        const authorAttrForCleaning = element.getAttribute('author'); // Use the one from element, not the potentially modified 'author' variable
        if (authorAttrForCleaning && authorAttrForCleaning !== '[unknown]') {
            const escapedAuthor = authorAttrForCleaning.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
            const authorPatterns = [
                new RegExp(`^\\s*${escapedAuthor}\\s*(?:•|\\n|\\s*-|\\s*\\d+\\s*points?)?`, 'i'), // Author at start, possibly followed by •, newline, dash, or points
                new RegExp(`\\n\\s*${escapedAuthor}\\s*(?:•|\\n|\\s*-|\\s*\\d+\\s*points?)?`, 'i')  // Author on a new line
            ];
            authorPatterns.forEach(pattern => {
                if (pattern.test(cleanedText.substring(0, authorAttrForCleaning.length + 25))) {
                    const oldCleanedText = cleanedText;
                    cleanedText = cleanedText.replace(pattern, '\\n').trim(); // Replace with newline to separate from next content
                     if (cleanedText !== oldCleanedText) {
                        console.log(`Comment ${commentId}: Text after attempting author removal ("${authorAttrForCleaning}"): "${cleanedText.substring(0, 200)}"`);
                    }
                }
            });
        }

        const timestampPatterns = [
            /(^|\n)\s*(?:Edited\s+)?\d+[smhdwy](?:[a-z])*\s*(?:ago)?\s*[•·]?\s*($|\n)/gi, 
            /(^|\n)\s*•\s*\d+[smhdwy](?:[a-z])*\s*(?:ago)?\s*[•·]?\s*($|\n)/gi,
            /(^|\n)\s*\d+\s*points?\s*(?:•\s*\d+[smhdwy](?:[a-z])*\s*(?:ago)?)?\s*($|\n)/gi, // "X points • Y time ago" or just "X points"
        ];
        let textChangedByTimestampRemoval = false;
        const originalTextForTimestampCheck = cleanedText;
        timestampPatterns.forEach(pattern => {
            cleanedText = cleanedText.replace(pattern, (match, p1, p2) => (p1 === '\\n' && p2 === '\\n') ? '\\n' : (p1 === '\\n' || p2 === '\\n') ? '\\n' : ' ').trim();
        });
         if (cleanedText !== originalTextForTimestampCheck) {
            textChangedByTimestampRemoval = true;
            console.log(`Comment ${commentId}: Text after timestamp/points removal: "${cleanedText.substring(0, 200)}"`);
        }
        
        cleanedText = cleanedText.replace(/(\n\s*){2,}/g, '\\n\\n'); // Reduce 2+ newlines (with optional space in between) to 2
        cleanedText = cleanedText.replace(/^[\s•·]+/gm, '').replace(/[\s•·]+$/gm, ''); // Remove leading/trailing spaces/bullets from lines
        cleanedText = cleanedText.trim();

        const finalCleanupPhrases = ["more_horiz", "level \\d+"];
        finalCleanupPhrases.forEach(phrase => {
            const regex = new RegExp(`(^|\\s|\\n)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}(\\s|\\n|$)`, 'gi');
            cleanedText = cleanedText.replace(regex, (match, p1, p2) => (p1 === '\\n' || p2 === '\\n') ? '\\n' : ' ').trim();
        });

        if (cleanedText !== textBeforeFallbackCleaning) {
            commentTextContent = cleanedText;
            textFoundPath += " -> Stage 3 Enhanced Fallback Cleaning applied";
            console.log(`Comment ${commentId}: Text AFTER Stage 3 Fallback Cleaning: "${commentTextContent.substring(0, 200)}"`);
        } else if (!textChangedByTimestampRemoval && cleanedText === textBeforeFallbackCleaning) { // Avoid logging if only timestamp changed it and was already logged
            console.log(`Comment ${commentId}: Stage 3 Fallback Cleaning did not significantly alter text from: "${textBeforeFallbackCleaning.substring(0,100)}"`);
        }
        
        // --- Final Check and Assignment ---
        if (!commentTextContent && textFoundPath !== "not found") { // If cleaning resulted in empty string but we had a path
             console.warn(`Comment ${commentId}: Text content became empty after cleaning. Original path: ${textFoundPath}. Text before cleaning: "${textBeforeFallbackCleaning.substring(0,100)}"`);
             commentTextContent = "[Comment text removed by cleaning]";
        } else if (!commentTextContent) {
            console.warn(`Comment ${commentId}: Text content is empty after all extraction attempts. Path: ${textFoundPath}`);
            commentTextContent = "[Comment text not found or empty]";
        } else {
            const veryShortNonCommentPhrases = ["Reply", "Edit", "Share", "Save", "Vote"];
            if (commentTextContent.length < 10 && veryShortNonCommentPhrases.some(phrase => commentTextContent.toLowerCase() === phrase.toLowerCase())) {
                console.warn(`Comment ${commentId}: Final text ("${commentTextContent}") was a short UI term. Marking as effectively empty.`);
                commentTextContent = `[Comment text likely UI element: ${commentTextContent}]`;
            }
        }
        
        const isTextuallyRemoved = commentTextContent === "[removed]" || commentTextContent === "[Comment text removed by cleaning]";
        const isTextuallyDeleted = commentTextContent === "[deleted]";
        const isAuthorDeleted = author === "[deleted]";
        const isModRemovedMsg = commentTextContent.toLowerCase() === "comment removed by moderator";
        const isMarkedAsSpamByClass = element.classList.contains('spam');

        let isEffectivelyHidden = false;
        if (isTextuallyRemoved || isTextuallyDeleted || isAuthorDeleted || isModRemovedMsg || isMarkedAsSpamByClass) {
            isEffectivelyHidden = true;
        }

        if (isEffectivelyHidden && !includeHiddenComments) {
            return null;
        }

        return {
            id: commentId,
            parentId: parentId,
            author: author,
            text: commentTextContent,
            depth: actualDepth, 
            timestamp: createdTimestamp || null,
            score: parsedScore,
            replies: []
        };
    }

    function buildCommentTree(commentsMap) {
        const commentTree = [];
        const comments = Array.from(commentsMap.values());
        const mapById = new Map();

        comments.forEach(comment => {
            comment.replies = []; 
            mapById.set(comment.id, comment);
        });

        comments.forEach(comment => {
            if (comment.parentId && mapById.has(comment.parentId)) {
                const parentComment = mapById.get(comment.parentId);
                parentComment.replies.push(comment);
            } else {
                commentTree.push(comment); 
            }
        });
        
        return commentTree;
    }

    async function clickLoadMoreButtons() {
        if (loadMoreAttempts >= MAX_LOAD_MORE_ATTEMPTS) {
            return false; 
        }
        
        // Calculate progress percentage
        // Map from 0-MAX_LOAD_MORE_ATTEMPTS to a 25-60% range, with logarithmic scaling for better feedback
        const progressRatio = Math.pow(loadMoreAttempts / MAX_LOAD_MORE_ATTEMPTS, 0.7); // Using exponent 0.7 for logarithmic-like effect
        const progressForAttemptCheck = 25 + Math.round(progressRatio * 35);
        sendProgressUpdate(`Checking for more comments (Attempt: ${loadMoreAttempts + 1}/${MAX_LOAD_MORE_ATTEMPTS})...`, Math.max(25, Math.min(progressForAttemptCheck, 75)));

        let clickedSomething = false;
        const loadMoreSelectors = [
            'button.overflow-menu-item:not([aria-expanded="true"])', 
            'button.button-primary[id^="more-comments-button-"]', 
            'button.button.button-secondary.button--secondary.icon-treatment', 
            'faceplate-partial[src*="more-comments"] button', 
            'shreddit-comment-tree > button.text-secondary-weak', 
            'shreddit-comment-tree > button:not([aria-expanded])' 
        ];

        for (const selector of loadMoreSelectors) {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
                const buttonText = button.textContent.toLowerCase();
                const isRelevantButton = buttonText.includes("load more comments") ||
                                         buttonText.includes("view more comments") ||
                                         buttonText.includes("more repl") || 
                                         buttonText.includes("continue this thread");

                if (isRelevantButton && button.offsetParent !== null && !button.disabled) {
                    console.log("Clicking 'load more' button:", button.textContent.trim());
                    button.click();
                    clickedSomething = true;
                    loadMoreAttempts++;
                    await new Promise(r => setTimeout(r, 1200)); 
                    if (loadMoreAttempts >= MAX_LOAD_MORE_ATTEMPTS) break;
                }
            }
            if (loadMoreAttempts >= MAX_LOAD_MORE_ATTEMPTS && clickedSomething) break;
        }
        
        const continueThreadLinks = document.querySelectorAll('a.button, a[data-testid="continue-thread"]');
        for (const link of continueThreadLinks) {
            if (link.textContent.toLowerCase().includes("continue this thread") && link.offsetParent !== null) {
                console.log("Clicking 'continue thread' link:", link.textContent.trim());
                link.click(); 
                clickedSomething = true;
                loadMoreAttempts++;
                await new Promise(r => setTimeout(r, 1200));
                if (loadMoreAttempts >= MAX_LOAD_MORE_ATTEMPTS) break;
            }
        }

        if (clickedSomething) {
            console.log(`Load more attempts: ${loadMoreAttempts}/${MAX_LOAD_MORE_ATTEMPTS}`);
            // Calculate progress based on the new number of completed attempts
            // Use logarithmic scaling for better visual feedback, especially with higher MAX_LOAD_MORE_ATTEMPTS values
            const newProgressRatio = Math.pow(loadMoreAttempts / MAX_LOAD_MORE_ATTEMPTS, 0.7);
            const progressAfterClick = 25 + Math.round(newProgressRatio * 35);
            
            sendProgressUpdate(`${allCommentsMap.size} comments collected. Clicked 'load more'. Attempt ${loadMoreAttempts}/${MAX_LOAD_MORE_ATTEMPTS}.`, 
                              Math.max(25, Math.min(progressAfterClick, 60)));
            stableChecks = 0; 
        }
        return clickedSomething;
    }

    function processAddedNode(node, currentDepth = 0) { // Added currentDepth default
        if (node.nodeType === Node.ELEMENT_NODE) {
            const processSingleComment = (commentNode) => {
                const commentId = commentNode.getAttribute('thingid');
                if (commentId && !allCommentsMap.has(commentId)) {
                    // Pass includeHiddenCommentsState, which is the global option for the scrape
                    const commentData = extractCommentData(commentNode, includeHiddenCommentsState, 0); // Depth 0 for top-level comments processed by observer
                    if (commentData) {
                        allCommentsMap.set(commentData.id, commentData);
                        lastActivityTime = Date.now(); 
                        console.log(`Comment ${commentData.id} (depth ${commentData.depth}) ADDED to map. Map size: ${allCommentsMap.size}.`);
                        stableChecks = 0;
                    }
                } else {
                    // console.log(`Comment ${commentId} (depth from attr: ${node.getAttribute('depth')}) already in map. Skipping direct processing.`);
                }
            };

            if (node.matches && node.matches('shreddit-comment')) {
                processSingleComment(node);
            } else { // Node itself is not a shreddit-comment, but might contain them (e.g., a container div)
                const childComments = node.querySelectorAll('shreddit-comment'); // Broader search for any descendant
                if (childComments.length > 0) {
                    /* console.log(
                        `Node ${node.tagName} (ID: ${node.id || 'N/A'}, thingid: ${node.getAttribute ? node.getAttribute('thingid') : 'N/A'}) is NOT a shreddit-comment,`,
                        `but found ${childComments.length} shreddit-comment children. Processing them.`
                    ); */
                    childComments.forEach(childNode => {
                        let childDepth = currentDepth + 1; 
                        const childDepthAttr = childNode.getAttribute('depth');
                        if (childDepthAttr !== null && !isNaN(parseInt(childDepthAttr, 10))) {
                            childDepth = parseInt(childDepthAttr, 10);
                        } else {
                            // If no depth attribute on child, and parent is not a comment,
                            // this child might be a top-level comment in this container.
                            // However, extractCommentData will try to use its own depth attribute first.
                            // console.log(`Child ${childNode.getAttribute('thingid')} in non-comment parent, calculated depth: ${childDepth}`);
                        }
                        processAddedNode(childNode, childDepth);
                    });
                }
            }
        }
    }

    function initializeCommentScraping(resolveFn, rejectFn, includeHidden) {
        sendProgressUpdate("Starting comment collection...");
        console.log("Initializing comment scraping. Include hidden:", includeHidden);
        console.log("Document readyState:", document.readyState);

        includeHiddenCommentsState = includeHidden;
        resolvePromiseScraping = resolveFn;
        rejectPromiseScraping = rejectFn; 

        const initialCommentSelectors = [
            'shreddit-comment', // Primary modern selector
            '.Comment', // Common class for comments (older/alternative UIs)
            'div[data-testid="comment"]' // Test ID based selector
        ];
        let commentsProcessedInInitialScan = 0;

        console.log("Starting initial scan for comments using selectors:", initialCommentSelectors.join(", "));

        initialCommentSelectors.forEach(selector => {
            console.log(`Initial scan: Querying for elements matching "${selector}".`);
            const elements = document.querySelectorAll(selector);
            console.log(`Initial scan: Found ${elements.length} elements matching "${selector}".`);

            elements.forEach(commentElement => {
                let initialElementDepth = 0; // Default for top-level query
                const depthAttr = commentElement.getAttribute('depth');
                if (depthAttr !== null && !isNaN(parseInt(depthAttr, 10))) {
                    initialElementDepth = parseInt(depthAttr, 10);
                }
                // console.log(`Initial scan processing element (selector "${selector}"):`, commentElement.tagName, `thingid: ${commentElement.getAttribute('thingid')}`, `Initial depth to pass: ${initialElementDepth}`);
                processAddedNode(commentElement, initialElementDepth); // Pass the determined depth
                commentsProcessedInInitialScan++; // Count attempts, not successes
            });
        });
        
        console.log(`Initial scan completed. Total unique comments added to map during initial scan: ${commentsProcessedInInitialScan}. Current map size: ${allCommentsMap.size}`);
        sendProgressUpdate(`${allCommentsMap.size} initial comments found. Observing for more...`);
        if (allCommentsMap.size === 0) { // Check map size after all selectors tried
            console.warn("No comments found in initial scan with ANY of the selectors. The page might have no comments or uses a new/unhandled structure.");
            console.log("Snapshot of document.body.innerHTML (first 3000 chars):", document.body.innerHTML.substring(0, 3000));
        }

        observer = new MutationObserver((mutationsList) => {
            try {
                let newPotentialComments = false;
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            processAddedNode(node);
                            newPotentialComments = true;
                        });
                    }
                }
                if (newPotentialComments) {
                    stableChecks = 0;
                }
            } catch (e) {
                console.error("Error in MutationObserver callback:", e);
                if (rejectPromiseScraping) {
                    rejectPromiseScraping(e);
                    resolvePromiseScraping = null;
                    rejectPromiseScraping = null;
                    if (observer) observer.disconnect();
                    if (scrapingTimeoutId) clearTimeout(scrapingTimeoutId);
                    if (checkIntervalId) clearTimeout(checkIntervalId);
                }
            }
        });

        const observerTargetSelectors = [
            'shreddit-comment-tree', // Ideal target within shreddit-post
            'div.commentarea', // Classic Reddit comment area
            '#commentarea',
            'div[data-testid="comments-page-content"]', // Newer UI comment area
            'main[role="main"]', // General main content area
            'shreddit-post', // If comment tree not found, observe whole post
            'article[data-testid="post-container"]' // Fallback post container
        ];
        let targetNode = null;
        for (const selector of observerTargetSelectors) {
            targetNode = document.querySelector(selector);
            if (targetNode) {
                console.log("MutationObserver target node found with selector:", selector);
                break;
            }
        }

        if (!targetNode) {
            console.warn("Specific observer target node not found! Falling back to document.body. This may impact performance.");
            targetNode = document.body;
        }
        console.log("Observer final target node:", targetNode);
        observer.observe(targetNode, { childList: true, subtree: true });
        sendProgressUpdate("Actively listening for dynamic comments...");

        // Start the scraping timeout
        scrapingTimeoutId = setTimeout(() => {
            console.warn(`Scraping timed out after ${SCRAPING_TIMEOUT / 1000} seconds.`);
            sendProgressUpdate(`Scraping timed out. Only ${allCommentsMap.size} comments collected so far.`);
            if (observer) observer.disconnect();
            if (checkIntervalId) clearInterval(checkIntervalId);
            
            if (allCommentsMap.size > 0) {
                if (resolvePromiseScraping) {
                    const commentTreeOnTimeout = buildCommentTree(allCommentsMap);
                    console.log(`Timeout: Resolving with ${commentTreeOnTimeout.length} top-level comments from ${allCommentsMap.size} total collected.`);
                    resolvePromiseScraping(commentTreeOnTimeout);
                }
            } else {
                if (rejectPromiseScraping) {
                    rejectPromiseScraping(new Error(`Scraping timed out with no comments collected. MAX_LOAD_MORE_ATTEMPTS was ${MAX_LOAD_MORE_ATTEMPTS}.`));
                }
            }
            resolvePromiseScraping = null; // Nullify after use
            rejectPromiseScraping = null;  // Nullify after use
        }, SCRAPING_TIMEOUT);


        // Initial setup for comment scraping
        checkIfDoneScraping();
    }

    function checkIfDoneScraping() {
        if (checkIntervalId) clearTimeout(checkIntervalId); 

        // Send periodic count update
        if (stableChecks > 0) { // Avoid sending on the very first check after a click
            // Calculate stability check progress: 60-65% range
            const stabilityProgress = 60 + Math.round((stableChecks / MAX_STABLE_CHECKS) * 5);
            
            // Add comment count to the message
            sendProgressUpdate(
                `${allCommentsMap.size} comments collected. Stability check ${stableChecks}/${MAX_STABLE_CHECKS}. Load attempts: ${loadMoreAttempts}/${MAX_LOAD_MORE_ATTEMPTS}`,
                stabilityProgress);
        }

        clickLoadMoreButtons().then(wasClicked => {
            if (!resolvePromiseScraping && !rejectPromiseScraping) return; 

            if (wasClicked) {
                stableChecks = 0;
                checkIntervalId = setTimeout(checkIfDoneScraping, CHECK_INTERVAL / 2);
                return;
            }

            stableChecks++;
            console.log(`Stability check: ${stableChecks}/${MAX_STABLE_CHECKS}. Comments: ${allCommentsMap.size}. Load attempts: ${loadMoreAttempts}/${MAX_LOAD_MORE_ATTEMPTS}`);
            
            const noMoreButtonsToClick = loadMoreAttempts >= MAX_LOAD_MORE_ATTEMPTS;

            if (stableChecks >= MAX_STABLE_CHECKS || (noMoreButtonsToClick && !wasClicked) ) {
                console.log("Scraping considered complete.");
                finishScraping();
            } else {
                checkIntervalId = setTimeout(checkIfDoneScraping, CHECK_INTERVAL);
            }
        }).catch(error => {
            console.error("Error in clickLoadMoreButtons during check:", error);
            if (rejectPromiseScraping) {
                rejectPromiseScraping(error); 
                resolvePromiseScraping = null;
                rejectPromiseScraping = null;
                if (observer) observer.disconnect();
                if (scrapingTimeoutId) clearTimeout(scrapingTimeoutId);
                if (checkIntervalId) clearTimeout(checkIntervalId);
            }
        });
    }

    function finishScraping() {
        sendProgressUpdate("Finalizing comment data...", 65);
        console.log("Finishing scraping... Total comments:", allCommentsMap.size);
        if (observer) {
            observer.disconnect();
            console.log("MutationObserver disconnected.");
            observer = null;
        }
        if (scrapingTimeoutId) clearTimeout(scrapingTimeoutId);
        if (checkIntervalId) clearTimeout(checkIntervalId);
        scrapingTimeoutId = null;
        checkIntervalId = null;

        const commentTree = buildCommentTree(allCommentsMap);
        const totalInTree = countCommentsInTree(commentTree);
        console.log(`Scraping finished. Total comments in map: ${allCommentsMap.size}, structured in tree: ${totalInTree}`);
        sendProgressUpdate(`Structuring ${allCommentsMap.size} comments...`, 70);

        if (resolvePromiseScraping) {
            resolvePromiseScraping(commentTree);
        } else if (!rejectPromiseScraping) { 
            console.warn("resolvePromiseScraping not set, possibly already rejected or not initialized properly.");
        }
        resolvePromiseScraping = null;
        rejectPromiseScraping = null;
    }

    function countCommentsInTree(comments) {
        let count = 0;
        for (const comment of comments) {
            count++;
            if (comment.replies && comment.replies.length > 0) {
                count += countCommentsInTree(comment.replies);
            }
        }
        return count;
    }

    // Main function to orchestrate scraping
    async function scrapeRedditData(includeHiddenComments) {
        console.log("scrapeRedditData called. includeHiddenComments:", includeHiddenComments);
        sendProgressUpdate("Scraping process initiated...");

        await loadConfiguration(); // Load configuration first

        // Reset global-like variables for this scraping session
        allCommentsMap = new Map();
        if (observer) observer.disconnect(); 
        observer = null;
        loadMoreAttempts = 0;
        stableChecks = 0;
        if (scrapingTimeoutId) clearTimeout(scrapingTimeoutId);
        if (checkIntervalId) clearTimeout(checkIntervalId);
        scrapingTimeoutId = null;
        checkIntervalId = null;
        resolvePromiseScraping = null;
        rejectPromiseScraping = null; 

        MAX_STABLE_CHECKS = 10;      // Increased from 6
        SCRAPING_TIMEOUT = 600000;   // 10 minutes 
        CHECK_INTERVAL = 3000;      

        try {
            let postDetails = extractPostDetails();

            const commentsPromise = new Promise((resolve, reject) => { 
                initializeCommentScraping(resolve, reject, includeHiddenComments); 
            });

            const commentTree = await commentsPromise; 
            sendProgressUpdate("Comment collection complete. Preparing final data...");
            console.log("Comments promise resolved, tree received in scrapeRedditData.");
            return {
                post: postDetails,
                comments: commentTree,
                url: window.location.href,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error("Error during scraping process in scrapeRedditData:", error);
            throw error; 
        }
    }

    // Main message listener for commands from the service worker
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("RedditScraper: Message received:", request.action);
        currentSendResponse = sendResponse; // <<<< STORE sendResponse

        if (request.action === "scrapeReddit") {
            sendProgressUpdate("Scrape command received by content script.");
            console.log("RedditScraper: scrapeReddit action invoked. Include hidden:", request.includeHidden);
            
            // Reset state for a new scraping operation
            allCommentsMap = new Map();
            loadMoreAttempts = 0;
            stableChecks = 0;
            MAX_STABLE_CHECKS = 10; // e.g., 5 checks * 2s interval = 10s of stability
            SCRAPING_TIMEOUT = 120000; // 2 minutes global timeout for the whole scraping process
            CHECK_INTERVAL = 1000; // Check every 1 second for stability or new comments
            OBSERVER_QUIET_PERIOD = 2500; // Wait 2.5s after last mutation before considering stable
            includeHiddenCommentsState = request.includeHidden || false;

            // Clear any previous scraping timeout
            if (scrapingTimeoutId) clearTimeout(scrapingTimeoutId);
            if (checkIntervalId) clearInterval(checkIntervalId);


            // Global timeout for the entire scraping process
            scrapingTimeoutId = setTimeout(() => {
                console.error("RedditScraper: Global scraping timeout reached!");
                sendProgressUpdate("Scraping timed out globally.");
                if (observer) observer.disconnect();
                if (checkIntervalId) clearInterval(checkIntervalId);
                // Ensure to respond if a promise was pending
                if (rejectPromiseScraping) {
                    rejectPromiseScraping({ error: "Global scraping timeout." });
                } else if (currentSendResponse) { // <<<< USE STORED sendResponse
                    currentSendResponse({ error: "Global scraping timeout occurred before promise setup." });
                    currentSendResponse = null; // <<<< PREVENT REUSE
                }
            }, SCRAPING_TIMEOUT);

            scrapeRedditData(request.includeHidden)
                .then(data => {
                    clearTimeout(scrapingTimeoutId);
                    if (observer) observer.disconnect();
                    if (checkIntervalId) clearInterval(checkIntervalId);
                    console.log("RedditScraper: Scraping successful. Sending data back.");
                    sendProgressUpdate("Scraping complete. Sending data.");
                    if (currentSendResponse) { // <<<< USE STORED sendResponse
                        currentSendResponse({ data: data });
                        currentSendResponse = null; // <<<< PREVENT REUSE
                    }
                })
                .catch(error => {
                    clearTimeout(scrapingTimeoutId);
                    if (observer) observer.disconnect();
                    if (checkIntervalId) clearInterval(checkIntervalId);
                    console.error("RedditScraper: Error during scraping:", error);
                    sendProgressUpdate(`Scraping failed: ${error.message || error}`);
                    if (currentSendResponse) { // <<<< USE STORED sendResponse
                        currentSendResponse({ error: error.message || "Unknown error during scraping." });
                        currentSendResponse = null; // <<<< PREVENT REUSE
                    }
                });
            
            return true; // Indicate asynchronous response

        } else if (request.action === "stopScrapingRequested") {
            console.log("RedditScraper: Received stopScrapingRequested.");
            sendProgressUpdate("Stop request received by scraper. Halting operations.");
            if (observer) observer.disconnect();
            if (scrapingTimeoutId) clearTimeout(scrapingTimeoutId);
            if (checkIntervalId) clearInterval(checkIntervalId);
            
            // If the main scraping promise is active, reject it.
            if (rejectPromiseScraping) {
                rejectPromiseScraping({ status: "stopped", message: "Scraping stopped by user." });
            } else {
                // If scraping wasn't fully initialized but stop was requested.
                console.warn("RedditScraper: Stop requested, but main scraping promise not active. Sending stop status anyway.");
                 if (currentSendResponse) { // <<<< USE STORED sendResponse
                    currentSendResponse({ status: "stopped", message: "Scraping stopped by user before full initialization." });
                    currentSendResponse = null; // <<<< PREVENT REUSE
                }
            }
            // No need to return true here if we've already responded or will respond via promise rejection.
            // However, if the original 'scrapeReddit' call is still pending a response, this path might not correctly use its sendResponse.
            // The logic above tries to handle this by rejecting the promise, which should trigger the .catch in scrapeReddit handler.
        }
        // Default: if no async operation, return false or nothing.
        // For "stopScrapingRequested", if it's not tied to an initial scrapeReddit's sendResponse, it might not need to return true.
        // But since scrapeReddit returns true, any other message handling should be careful.
        // For now, only scrapeReddit is async.
    });
    window.scrapeRedditData = scrapeRedditData;
    console.log("Reddit Scraper script v2.3 initialized. scrapeRedditData is on window.");

} else {
    console.log("Reddit Scraper script already initialized. New execution skipped.");
}
