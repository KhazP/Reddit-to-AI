# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reddit to AI is a Chrome extension (Manifest V3) that scrapes Reddit threads and sends the content to LLM APIs for background summarization. The extension delivers AI-generated summaries via system notifications.

## Development Commands

Since this is a Chrome extension with no build system:
- **Load extension**: Use Chrome's "Load unpacked" in `chrome://extensions` 
- **Reload extension**: Click reload button in Chrome extensions page after code changes
- **Debug**: Use Chrome DevTools Console for each component:
  - Service worker: chrome://extensions > Inspect views: service worker
  - Popup: Right-click extension icon > Inspect popup
  - Content script: F12 on Reddit page where script is injected

## Architecture Overview

### Core Components
- **service_worker.js**: Background script that orchestrates the entire flow, handles API calls to LLMs
- **redditScraper.js**: Content script injected into Reddit pages for data extraction  
- **popup.js/popup.html**: Main UI for initiating scraping and displaying status
- **options.js/options.html**: Configuration interface for API keys, settings
- **floatingPanel.js**: Optional floating panel UI on Reddit pages

### Data Flow
1. User clicks "Scrape & Summarize" in popup
2. Service worker injects redditScraper.js into active Reddit tab
3. Content script scrapes post and comments, sends data back to service worker
4. Service worker calls configured LLM API (OpenAI/Gemini) with scraped content
5. AI response delivered as system notification

### Storage Architecture
- **chrome.storage.sync**: Persistent settings (API keys, preferences, prompt templates)
- **chrome.storage.local/session**: Temporary data transfer between components
- Settings configurable: Don't save, Session only, or Persistent

## Key Files and Responsibilities

### service_worker.js
- Global state management via `scrapingState` object
- LLM API integration (OpenAI, Google Gemini) 
- Progress broadcasting to popup and floating panel
- Notification management
- Chrome extension lifecycle management

### redditScraper.js  
- Reddit DOM parsing and content extraction
- Progressive comment loading with "load more" automation
- MutationObserver for dynamic content detection
- Handles collapsed/hidden comments based on user preference
- Configurable scraping depth (maxLoadMoreAttempts)

### popup.js
- Real-time status updates via message passing
- Progress bar and status indicator management
- Toggle for including hidden comments
- Summary and error display in popup UI

### options.js
- LLM provider selection (OpenAI, Gemini)
- API key management with secure storage
- Model name configuration (optional)
- Prompt template customization with `{content}` placeholder
- Notification and data storage preferences

## Configuration System

Key settings stored in chrome.storage.sync:
- `llmProvider`: "openai" or "gemini"
- `apiKey`: User's LLM API key (required for functionality)
- `modelName`: Optional specific model override
- `defaultPromptTemplate`: Customizable prompt with `{content}` placeholder
- `maxLoadMoreAttempts`: Comment scraping depth (1-500, default 75)
- `showNotifications`: Enable/disable system notifications
- `dataStorageOption`: How to handle temporary data

## Message Passing Architecture

### Service Worker ↔ Popup
- `scrapingStateUpdate`: Broadcast current scraping status and progress
- `initiateScrapingAndSummarization`: Start the full workflow
- `stopScraping`: Cancel ongoing operations

### Service Worker ↔ Content Scripts  
- `progressUpdate`: Content script reports scraping progress
- `scrapingResult`: Final scraped data sent to service worker
- `updateFloatingPanel`: Update floating panel with current state

## Security Considerations

- API keys stored in chrome.storage.sync (syncs across user's Chrome profiles)
- No API keys should appear in logs or debugging output
- Content scripts operate with limited permissions on Reddit domains only
- Host permissions restricted to necessary domains (reddit.com, API endpoints)

## LLM API Integration

### Supported Providers
- **OpenAI**: Uses https://api.openai.com/v1/chat/completions
- **Google Gemini**: Uses https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent

### API Call Structure
Content sent to LLM includes:
- Formatted prompt template with scraped content
- User-configurable model selection
- Error handling for rate limits and API failures
- Response parsing and notification delivery

## Development Patterns

### State Management
- Central state in service_worker.js `scrapingState` object
- State changes broadcast to all listening components
- UI components react to state updates rather than managing local state

### Error Handling
- Graceful degradation when API keys missing or invalid
- User-friendly error messages in notifications and popup
- Console logging for debugging with clear component prefixes

### Content Script Lifecycle
- Guard against multiple script injections
- Cleanup of observers and timeouts on completion
- Configurable timeouts for long-running operations

## Testing Approach

Manual testing workflow:
1. Load extension in Chrome developer mode
2. Navigate to Reddit thread
3. Configure API key in options page
4. Test scraping with different comment depths
5. Verify notifications appear with summaries
6. Test error scenarios (invalid API key, rate limits)

No automated test framework is currently implemented.