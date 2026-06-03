# Reddit to AI QA Checklist

## Scrape Flow

- Load the unpacked extension in Chrome.
- Open a public Reddit thread and click the extension icon.
- Confirm the default button says `Scrape & Preview`.
- Scrape with preview enabled and confirm `preview.html` opens.
- Switch popup mode to `Send directly`, scrape again, and confirm the selected AI platform opens without the preview page.
- Enable `Don't save this scrape`, send to AI, and confirm the pending payload is cleared after paste.

## Preview Page

- Confirm the setup pills show preset, AI provider, context budget, trim strategy, Reddit sort, depth, comments, and output format.
- Change context budget, trim strategy, media handling, provider, and output format; confirm the prompt rebuilds.
- Edit the prompt and confirm `Restore generated prompt` becomes enabled.
- Click `Send and skip preview next time`; confirm the prompt sends and future popup mode is direct.
- Confirm `Copy`, `Export`, `Save preset`, `Back`, and `Send` still work.

## AI Platforms

- ChatGPT: verify text insertion, fallback overlay when signed out, and manual copy fallback.
- Gemini: verify text insertion and image paste when media mode is `Attach`.
- Claude: verify text insertion and fallback overlay when the editor is unavailable.
- AI Studio: verify text insertion into a new chat prompt.

## Scraper Reliability

- Test a thread with deleted parent comments and visible replies; replies should remain in the prompt.
- Test a large thread with `morechildren`; failed batches should appear on the preview page with a resume button.
- Test a private, deleted, or login-required thread; the error should explain the likely access problem.

## Release

- Run `npm run check`.
- Run `npm run package:extension`.
- Confirm `dist-extension/` excludes `node_modules`, tests, scripts, zip files, logs, and local artifacts.
