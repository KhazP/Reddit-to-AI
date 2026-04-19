# Software Requirements

This repository is a browser extension project (Manifest V3). It has no backend runtime dependency for normal user operation.

## Runtime Requirements

- Google Chrome or Chromium-based browser with Manifest V3 support
- Reddit access for scraping public thread data
- Access to one of the supported AI destinations:
  - gemini.google.com
  - chatgpt.com
  - claude.ai
  - aistudio.google.com

## Development Requirements

- Node.js 20+ (for repository checks)
- npm 10+ (for dependency installation and scripts)

## Development Commands

- Install tooling: `npm install`
- Run all checks: `npm run check`
- Lint JavaScript: `npm run lint`
- Validate JSON files: `npm run validate:json`

## Notes

- This repo does not compile or bundle extension assets.
- The extension can be loaded directly via Chrome's "Load unpacked" flow.
