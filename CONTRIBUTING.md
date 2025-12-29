# Contributing to Reddit to AI

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to Reddit to AI. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Code of Conduct

This project and everyone participating in it is governed by the [Reddit to AI Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report.
* **Use a clear and descriptive title** for the issue to identify the problem.
* **Describe the exact steps to reproduce the problem** in as many details as possible.
* **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
* **Explain which behavior you expected to see instead and why.**
* **Include screenshots** if practical.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion.
* **Use a clear and descriptive title** for the issue to identify the suggestion.
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
* **Explain why this enhancement would be useful** to most users.

### Pull Requests

1.  Fork the repo and create your branch from `main`.
2.  If you've added code that should be tested, add tests.
3.  Ensure the test suite passes.
4.  Make sure your code lints.
5.  Issue that pull request!

## Styleguides

### JavaScript
* Use modern ES6+ syntax.
* Prefer `const` and `let` over `var`.
* Use explicit function names where possible for better stack traces.
* Follow the existing formatting (indentation with spaces, etc.).

### Localization (i18n)
* **Never hardcode user-facing strings.**
* Always usage `chrome.i18n.getMessage()` or the helper `t()`.
* Add new strings to `_locales/en/messages.json` first.
* If possible, provide translations for other supported languages.

## Development Setup

1.  Clone the repository.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode**.
4.  Click **Load unpacked** and select the repository directory.
