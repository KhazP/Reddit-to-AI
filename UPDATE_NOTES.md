# Reddit to AI v1.2.1 Update Notes

> Historical release notes for v1.2.1. The current release is tracked in `src/manifest.json` and `package.json`; this file is not updated for later versions.

This update expanded Reddit to AI from a direct scrape-and-send extension into a preview-first workflow with stronger controls for context size, scraping reliability, privacy, and history management.

## Added

- Context budget meter with character, token, comment, image, and warning indicators.
- Context presets: Small, Balanced, Full, and Max Quality.
- Smart trimming strategies:
  - Top scored
  - Controversial
  - OP replies
  - Flaired users
  - Diverse viewpoints
  - Newest
  - Longest helpful comments
- Reddit comment sort modes:
  - Best / confidence
  - Top
  - New
  - Controversial
  - Old
  - Q&A
  - Live
- Stronger `morechildren` loading with sequential batching, retries, failed-batch tracking, and a preview-screen resume button.
- Prompt preview flow for reviewing, editing, copying, exporting, sending, and saving prompt presets before handoff.
- Auto-paste fallback overlay with a visible "Copy Prompt" action when browser paste automation is blocked.
- Expanded media scraping metadata for images, links, videos, YouTube links, galleries, polls, crossposts, flair, spoiler/NSFW state, awards, and source URLs.
- Privacy/session controls for Persistent, Session Only, and Don't Save handoff behavior.
- History search and filtering by query, AI platform, preset, date range, and minimum comment count.
- History pin/favorite, export, resend, and compare mode.
- Batch / multi-thread mode for combining several Reddit thread URLs into one preview.
- Settings UI for saved prompt presets and combined OP/flaired author filters.

## Improved

- Settings page styling now renders correctly when opened directly for local preview.
- Batch scraping author filters now match the popup/content-script behavior.
- Saved preview presets can be managed from settings.
- Version badge and footer now show v1.2.1.
- "Summary sent!" messaging was renamed to "Content sent!" / content-ready language.

## Cleanup

- `__MACOSX` artifacts are ignored.
- `marked.min.js` was removed.
- Packaging excludes local development artifacts such as `node_modules`, `.DS_Store`, and Playwright screenshots/logs.

## Validation

- JSON validation passed.
- Syntax checks passed for the changed JavaScript files.
- Full repo check passed with 0 errors.
- Remaining lint warning: `promptBuilder.js` has an existing unused helper, `trimCommentsToCharBudget`.
- ZIP integrity check passed.
- The extension was not live-tested inside Chrome against Reddit/AI sites in this sandbox.

## Install

1. Unzip the package.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Choose "Load unpacked".
5. Select the unzipped `Reddit-to-AI` folder.
