// redditScraper.js - Content script for scraping Reddit threads

// Guard to prevent multiple executions/declarations in the same context
if (typeof window.redditScraperInitialized === 'undefined') {
    window.redditScraperInitialized = true;

    console.log("Reddit Scraper script initializing for the first time.");

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
    let checkIntervalId; // ID for the checkIfDoneScraping interval

    console.log("Reddit Scraper script loaded.");

    function extractPostDetails() {
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

        console.log("Attempting to extract images and videos from postElement...");
        // Image extraction (ensure these are specific to post content, not UI)
        const imageSelectors = [
            'shreddit-image', // Modern image element
            'img[alt="Post image"]', 
            'figure img', 
            'div[data-test-id="post-content"] img',
            'a[href*=".jpg"], a[href*=".png"], a[href*=".gif"]' // Links to images
        ];
        postElement.querySelectorAll(imageSelectors.join(', ')).forEach(imgOrLink => {
            let imgSrc = '';
            if (imgOrLink.tagName === 'SHREDDIT-IMAGE' && imgOrLink.getAttribute('src')) {
                imgSrc = imgOrLink.getAttribute('src');
            } else if (imgOrLink.tagName === 'IMG' && imgOrLink.src && !imgOrLink.src.startsWith('data:')) {
                imgSrc = imgOrLink.src;
            } else if (imgOrLink.tagName === 'A' && imgOrLink.href) {
                imgSrc = imgOrLink.href;
            }

            if (imgSrc && imgOrLink.offsetParent !== null) { // Check if visible
                 // contentHTML += `<p><img src="${imgSrc}" alt="${imgOrLink.alt || 'post image'}"></p>`;
                 if (!post.imageUrls.includes(imgSrc)) post.imageUrls.push(imgSrc);
                 console.log("Extracted image URL:", imgSrc);
            }
        });

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
                // Avoid adding image/video links again if they are already captured
                // Also avoid internal page links (e.g. "#") or javascript links
                if (href && !href.startsWith('javascript:') && !href.startsWith('#') && !post.imageUrls.includes(href) && !post.linkUrls.includes(href)) {
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

        console.log("Final extracted post details:", {title: post.title, author: post.author, subreddit: post.subreddit, contentSnippet: post.content.substring(0, 200) + "..."});
        return post;
    }

    function extractCommentData(element, includeHiddenComments, depth = 0) {
        // console.log('Attempting to extract data from comment element (first 300 chars):', element.outerHTML.substring(0, 300));
        console.log("Inspecting shreddit-comment structure:", element.id, element.innerHTML.substring(0, 500));

        if (!element) {
            console.warn('extractCommentData called with null element.'); return null;
        }
        const thingId = element.getAttribute('thingid'); 
        if (!thingId) { 
            console.warn('extractCommentData called for element without a thingid:', element.tagName, element.id, element.outerHTML ? element.outerHTML.substring(0,200) : 'N/A'); return null;
        }
        if (!element.matches || !element.matches('shreddit-comment')) { 
            console.warn('extractCommentData called for element not matching "shreddit-comment":', element.tagName, `thingid: ${thingId}`, element.outerHTML ? element.outerHTML.substring(0,200) : 'N/A'); return null;
        }

        const commentId = thingId;
        let parentId = element.getAttribute('parentid');
        if (!parentId) {
            let parentCommentElement = element.parentElement?.closest('shreddit-comment'); 
            if (parentCommentElement) {
                parentId = parentCommentElement.getAttribute('thingid');
            }
        }
        parentId = parentId || null;

        let author = element.getAttribute('author') || '[unknown]';
        if (author === '[unknown]') {
            const authorEl = element.querySelector('a[data-testid="comment_author_link"], .Comment__author, [slot="authorName"]');
            if (authorEl) author = authorEl.textContent.trim();
        }
        
        const createdTimestamp = element.getAttribute('created-timestamp');
        const scoreString = element.getAttribute('score');
        let parsedScore = null;
        if (scoreString && !isNaN(parseInt(scoreString, 10))) {
            parsedScore = parseInt(scoreString, 10);
        }

        let actualDepth;
        const depthAttr = element.getAttribute('depth');
        if (depthAttr !== null && !isNaN(parseInt(depthAttr, 10))) {
            actualDepth = parseInt(depthAttr, 10);
        } else {
            actualDepth = depth; 
        }

        let commentTextContent = "";
        let textFoundPath = "not found";

        // Priority 1: Target specific comment body container(s)
        const commentBodySelectors = [
            'div[slot="comment"]', // Often used in shreddit-comment
            'div[data-testid="comment-body"]', // A common test ID
            '.md', // Markdown content container
            '.richtext', // Rich text content container
            // Add other potential selectors based on inspection of element.innerHTML
        ];

        let commentBodyContainer = null;
        for (const selector of commentBodySelectors) {
            commentBodyContainer = element.querySelector(selector);
            if (commentBodyContainer) {
                console.log(`Comment ${commentId}: Found potential comment body container with selector: ${selector}`);
                // Attempt to get text from <p> tags first
                const paragraphs = commentBodyContainer.querySelectorAll('p');
                if (paragraphs.length > 0) {
                    let combinedText = [];
                    paragraphs.forEach(p => combinedText.push(p.textContent.trim()));
                    commentTextContent = combinedText.join('\n').trim();
                    textFoundPath = `Priority 1: <p> tags within specific body container (${selector})`;
                    console.log(`Comment ${commentId}: Text extracted using "${textFoundPath}". Snippet:`, commentTextContent.substring(0, 100));
                } else {
                    // Fallback to textContent of the container itself
                    commentTextContent = commentBodyContainer.textContent.trim();
                    textFoundPath = `Priority 1: textContent of specific body container (${selector})`;
                     console.log(`Comment ${commentId}: Text extracted using "${textFoundPath}" (from container.textContent). Snippet:`, commentTextContent.substring(0, 100));
                }
                
                if (commentTextContent) {
                     console.log(`Comment ${element.id}: Text extracted using specific body container selector: ${selector}`);
                    break; // Found content, exit loop
                }
            }
        }


        // Priority 1 (Continued): Try specific modern renderer if the above failed
        if (!commentTextContent) {
            const markdownRendererEl = element.querySelector('shreddit-comment-markdown-renderer');
            if (markdownRendererEl) {
                commentTextContent = markdownRendererEl.textContent.trim();
                if (commentTextContent) {
                    textFoundPath = "Priority 1: shreddit-comment-markdown-renderer";
                    console.log(`Comment ${commentId}: Text extracted using "${textFoundPath}". Snippet:`, commentTextContent.substring(0, 100));
                } else {
                    console.log(`Comment ${commentId}: Found shreddit-comment-markdown-renderer, but textContent was empty.`);
                }
            } else {
                console.log(`Comment ${commentId}: shreddit-comment-markdown-renderer NOT found.`);
            }
        }
        
        // Priority 1 (Continued): Try to find specific paragraph or rich text elements if markdown-renderer failed or was empty
        // This is a broader search within the shreddit-comment if a specific body container wasn't fruitful
        if (!commentTextContent) {
            const specificTextSelectors = [
                'div.richtext-paragraph', // Common for rich text
                'div[data-testid="comment"] > div > div > p', // Structure seen in some layouts
                // 'div.md > p', // Already covered if .md was a body container
            ];
            let foundSpecificElements = false;
            for (const selector of specificTextSelectors) {
                const textElements = element.querySelectorAll(selector);
                if (textElements.length > 0) {
                    let combinedText = [];
                    textElements.forEach(el => combinedText.push(el.textContent.trim()));
                    commentTextContent = combinedText.join('\n').trim();
                    if (commentTextContent) {
                        textFoundPath = `Priority 1: specific elements (${selector}, found ${textElements.length})`;
                        console.log(`Comment ${commentId}: Text extracted using "${textFoundPath}". Snippet:`, commentTextContent.substring(0, 100));
                        foundSpecificElements = true;
                        break; 
                    }
                }
            }
            if (!foundSpecificElements) {
                 console.log(`Comment ${commentId}: No specific text elements (p, richtext-paragraph) found or they were empty after body container search.`);
            }
        }
        

        // Refined Fallback Cleaning (If No Specific Body Container Found or it yielded little)
        if (!commentTextContent || commentTextContent.length < 15) {
            const textBeforeFallback = commentTextContent;
            console.log(`Comment ${commentId}: Text from prior methods is empty or very short ("${textBeforeFallback}"). Falling back to element.textContent with refined cleaning.`);
            
            let fullText = element.textContent || "";
            const textBeforeSpecificRemovals = fullText;
            console.log(`Comment ${commentId}: Fallback - Text BEFORE specific removals (first 200 chars):`, fullText.substring(0, 200));

            // Attempt to remove the author line if it matches element.getAttribute('author') and appears at the start.
            const authorAttr = element.getAttribute('author');
            if (authorAttr) {
                const authorPattern = new RegExp(`^\\s*${authorAttr.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*`, 'i');
                fullText = fullText.replace(authorPattern, '').trim();
            }

            // Remove timestamp patterns like • \d+d ago
            const timestampPattern = /•\s*\d+[a-z]+\s*ago/gi; // More general for "4d ago", "2h ago" etc.
            fullText = fullText.replace(timestampPattern, '').trim();
            
            // Explicitly remove "Reply", "Share", "Save", "Edit", "More replies" (case-insensitive, possibly with surrounding whitespace)
            const actionWords = ["Reply", "Share", "Save", "Edit", "More replies", "Report", "Give Award", "Follow"];
            actionWords.forEach(word => {
                // Regex to match whole word, case insensitive, with optional surrounding whitespace
                const regex = new RegExp(`\\s*\\b${word}\\b\\s*`, 'gi'); 
                fullText = fullText.replace(regex, ' ').trim(); // Replace with a space to avoid joining words, then trim
            });
            
            // Remove "more_horiz" which is often the text for the "..." menu
            fullText = fullText.replace(/\s*more_horiz\s*/gi, ' ').trim();

            // Attempt to remove the action bar text more directly if a common selector is found
            const actionBar = element.querySelector('shreddit-comment-action-row, .Comment__footer');
            if (actionBar && actionBar.textContent) {
                let actionBarText = actionBar.textContent.trim();
                // Clean the action bar text itself from known action words to avoid removing parts of actual comments
                actionWords.forEach(word => {
                    const regex = new RegExp(`\\s*\\b${word}\\b\\s*`, 'gi');
                    actionBarText = actionBarText.replace(regex, ' ').trim();
                });
                if (actionBarText.length > 0 && actionBarText.length < 100) { // Heuristic: action bar text is usually short
                    // Escape the action bar text for use in a new RegExp
                    const escapedActionBarText = actionBarText.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
                    if (escapedActionBarText.trim()) { // Ensure it's not empty after cleaning
                        try {
                            const actionBarPattern = new RegExp(escapedActionBarText, 'gi');
                            const textBeforeActionBarRemoval = fullText;
                            fullText = fullText.replace(actionBarPattern, '').trim();
                            if (fullText !== textBeforeActionBarRemoval) {
                                console.log(`Comment ${commentId}: Fallback - Removed potential action bar text ("${actionBarText}").`);
                            }
                        } catch (e) {
                            console.warn(`Comment ${commentId}: Could not create RegExp from action bar text: "${actionBarText}"`, e);
                        }
                    }
                }
            }
            
            commentTextContent = fullText.trim();
            textFoundPath = `Fallback: element.textContent (refined cleaning)`;
            console.log(`Comment ${commentId}: Fallback - Text AFTER specific removals (first 200 chars):`, commentTextContent.substring(0, 200));
            if (commentTextContent !== textBeforeSpecificRemovals) {
                 console.log(`Comment ${commentId}: Fallback cleaning changed the text. Original snippet: "${textBeforeSpecificRemovals.substring(0,100)}...", Cleaned snippet: "${commentTextContent.substring(0,100)}..."`);
            }
        }

        // Remove text from known action button areas (final pass, regardless of method)
        const actionRowSelectors = ['shreddit-comment-action-row', '.Comment__footer', '[data-testid="comment-actionBar"]'];
        actionRowSelectors.forEach(selector => {
            const actionRow = element.querySelector(selector);
            if (actionRow && actionRow.textContent) {
                let textToRemove = actionRow.textContent.trim();
                // Be careful not to remove too much. Only remove if it's a significant part of the commentTextContent
                // This is tricky; for now, we rely on the specific removals above.
                // A more aggressive approach here might be to subtract this text if found.
                // For now, the targeted word removal is safer.
            }
        });


        // Final check and assignment
        if (!commentTextContent) {
            console.warn(`Comment ${commentId}: Text content is empty after all extraction attempts. Path: ${textFoundPath}`);
            commentTextContent = "[Comment text not found or empty]";
        }

        const isTextuallyRemoved = commentTextContent === "[removed]";
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
            stableChecks = 0; 
        }
        return clickedSomething;
    }

    function processAddedNode(node, currentDepth = 0) {
        /* console.log(
            'processAddedNode received:',
            node.tagName,
            `thingid: ${node.getAttribute ? node.getAttribute('thingid') : 'N/A'}`,
            `ID: ${node.id || 'N/A'}`,
            'Matches "shreddit-comment":', (node.matches ? node.matches('shreddit-comment') : 'N/A (not an element or no matches method)'),
            'currentDepth:', currentDepth,
            'OuterHTML snippet:', node.outerHTML ? node.outerHTML.substring(0, 150) : 'N/A'
        ); */

        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches('shreddit-comment')) {
                const currentThingId = node.getAttribute('thingid');
                // console.log(`processAddedNode: Encountered shreddit-comment. ThingID: ${currentThingId}, Original ID: ${node.id}, currentDepth: ${currentDepth}`);

                if (currentThingId) {
                    if (!allCommentsMap.has(currentThingId)) {
                        const commentData = extractCommentData(node, includeHiddenCommentsState, currentDepth);
                        if (commentData) {
                            allCommentsMap.set(commentData.id, commentData); // commentData.id is thingid
                            console.log(`Comment ${commentData.id} (depth ${commentData.depth}) ADDED to map. Map size: ${allCommentsMap.size}.`);
                            stableChecks = 0;
                        }
                    } else {
                        // console.log(`Comment ${currentThingId} (depth from attr: ${node.getAttribute('depth')}) already in map. Skipping direct processing.`);
                    }
                } else {
                    console.log("Found shreddit-comment but it has NO thingid. Skipping direct extraction. OuterHTML:", node.outerHTML ? node.outerHTML.substring(0, 250) : 'N/A');
                }

                // Whether the node itself was processed or not (e.g. had thingid or already in map),
                // always try to find and process its direct shreddit-comment children to handle nesting.
                // The allCommentsMap.has() check in subsequent calls will prevent duplicates.
                const childComments = node.querySelectorAll(':scope > shreddit-comment-tree > shreddit-comment, :scope > shreddit-comment');
                if (childComments.length > 0) {
                    // console.log(`Node ${node.tagName} (thingid: ${currentThingId || 'N/A'}) has ${childComments.length} direct/tree shreddit-comment children. Processing them if new.`);
                    childComments.forEach(childNode => {
                        if (childNode === node) return; // Should not happen with :scope

                        let childDepth = currentDepth + 1; // Default increment from parent
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

        scrapingTimeoutId = setTimeout(() => {
            console.warn("Scraping timeout reached!");
            finishScraping();
        }, SCRAPING_TIMEOUT);

        checkIfDoneScraping();
    }

    function checkIfDoneScraping() {
        if (checkIntervalId) clearTimeout(checkIntervalId); 

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
        console.log("Finishing scraping...");
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

    async function scrapeRedditData(includeHidden) {
        console.log("scrapeRedditData called. Current URL:", window.location.href, "Include hidden:", includeHidden);
        
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

        MAX_LOAD_MORE_ATTEMPTS = 30; 
        MAX_STABLE_CHECKS = 6;      
        SCRAPING_TIMEOUT = 120000;   
        CHECK_INTERVAL = 3000;      

        try {
            let postDetails = extractPostDetails();

            const commentsPromise = new Promise((resolve, reject) => { 
                initializeCommentScraping(resolve, reject, includeHidden); 
            });

            const commentTree = await commentsPromise; 
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

    // Listen for messages from the service worker
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "scrapeReddit") {
            console.log("Message 'scrapeReddit' received in content script. Include hidden:", request.includeHidden);
            scrapeRedditData(request.includeHidden)
                .then(data => {
                    console.log("Scraping complete. Post content snippet:", (data.post && data.post.content) ? data.post.content.substring(0, 200) + "..." : "[No post content]", "Comments found:", data.comments ? data.comments.length : 0);
                    if (data.comments && data.comments.length > 0) {
                        console.log("First comment snippet:", JSON.stringify(data.comments[0], (key, value) => key === 'replies' && Array.isArray(value) && value.length > 10 ? value.length + ' replies' : value, 2).substring(0, 300));
                    }
                    try {
                        if (chrome.runtime.lastError) { 
                            console.error("redditScraper: Port closed before attempting to send success response. Error:", chrome.runtime.lastError.message);
                            return; 
                        }
                        sendResponse({status: "success", data: data});
                    } catch (e) {
                        console.warn("redditScraper: Error sending success response (port likely closed or other issue):", e.message);
                    }
                })
                .catch(error => {
                    console.error("Error during scrapeRedditData:", error.message, error.stack);
                    try {
                        if (chrome.runtime.lastError) {
                             console.error("redditScraper: Port closed before attempting to send error response. Error:", chrome.runtime.lastError.message);
                            return;
                        }
                        sendResponse({status: "error", message: error.message || String(error), details: error.stack});
                    } catch (e) {
                        console.warn("redditScraper: Error sending error response (port likely closed or other issue):", e.message);
                    }
                });
            return true; // Crucial: Indicates you will send a response asynchronously
        }
        // If the action is not "scrapeReddit", no response is sent, which is fine if not expected.
        // However, it's good practice to return true if any path might be async,
        // or explicitly return false if all paths are synchronous and don't sendResponse.
        // For this specific listener, only "scrapeReddit" is async.
    });

} else {
    console.log("Reddit Scraper script already initialized. Skipping re-initialization.");
    // If the listener is already attached, and a new message comes,
    // it should still be processed by the existing listener.
    // However, if scrapeRedditData relies on global state that isn't reset
    // outside of the initialization block, that could be an issue.
    // The current scrapeRedditData resets its own necessary state, so it should be fine.
}
