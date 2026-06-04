# Design Specification: UI Quality of Life & Visual Improvements

This document outlines the design, architecture, and visual specifications for implementing the Quality of Life (QoL) and premium styling updates across the Reddit-to-AI extension.

---

## 1. Goal Description
The objective is to refine the extension's user experience (UX) to feel premium, readable, and highly interactive. Specifically, this redesign will:
* **Prevent Popup Clutter**: Split the popup settings into active "Scrape" and "Configure Filters" tabs, completely eliminating vertical scrollbars.
* **Provide Real-Time Feedback**: Render a visual token budget progress bar in the popup footer indicating prompt size projection.
* **Modernize Actions**: Replace select dropdowns with horizontal icon/text export chips.
* **Enhance Options Layout**: Transition the settings page from a vertical grid into a clean Left-Nav Sidebar configuration workspace.
* **Add In-context Explanations**: Provide Radix-like hover tooltips for all key configurations.
* **Rule Verification**: Add an inline routing simulator to test subreddit patterns instantly.

---

## 2. Technical Design & Architecture

### Theme System & Component Rules
We will implement custom Radix/shadcn-like vanilla components utilizing the extension's existing CSS variables:
* **Backgrounds**: `--bg-primary` (#0d0d0d) and `--bg-card` (rgba(39, 39, 42, 0.4)).
* **Accents**: `--accent` (#FF4500) and `--accent-glow` (rgba(255, 69, 0, 0.3)).
* **Transitions**: Smooth HSL and transform spring transitions: `transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1);`.
* **Focus States**: High-contrast outline focus rings for accessibility on tab selections: `box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent);`.

---

### Component Specifications

#### A. Popup Segmented Tab Control
* **File Changes**: [popup.html](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.html), [popup.css](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.css), [popup.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.js)
* **Design**:
  * A sliding glass segment wrapper `.tabs-list` containing two triggers: `#tabScrape` ("Scrape & Run") and `#tabFilters` ("Configure Filters").
  * Active state utilizes a subtle transition: clicking a tab toggles the class `.active` and toggles `.hidden` on the corresponding pane card sections.
  * Ensures all content height fits within a `320px` width and `380px` max-height window without vertical scrollbar.

#### B. Dynamic Token Budget Progress Bar
* **File Changes**: [popup.html](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.html), [popup.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.js)
* **Design**:
  * An estimator bar widget placed in the popup status footer.
  * When a thread is scraped, it uses the global BPE tokenizer to get the token count and updates a horizontal `.progress-bar-fill`.
  * **Color Mapping**:
    * Green (`--success`): `< 8,000` tokens.
    * Yellow (`--warning`): `8,000 - 32,000` tokens.
    * Red/Orange (`--error`): `> 32,000` tokens.

#### C. Horizontal Export Chips
* **File Changes**: [popup.html](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.html), [popup.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/popup.js), [preview.html](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/preview.html), [preview.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/preview.js)
* **Design**:
  * Row of three micro-chips representing: Markdown, JSON, and CSV.
  * Visual states: disabled (opacity `0.4`, default) vs. enabled (brand border hover glow and scale-up on active scrape data).
  * Direct click triggers immediate file downloads.

#### D. Vanilla shadcn-like Tooltips System
* **New Files**: [tooltip.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/tooltip.js), [tooltip.css](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/tooltip.css)
* **Design**:
  * Pure JavaScript helper targeting elements with `data-tooltip` containing localized dictionary references.
  * Automatically creates, anchors, and positions a `.tooltip-bubble` relative to the bounding box on hover or focus.
  * Supports smooth spring fade/slide animations (`translateY(4px) scale(0.95)` to `translateY(0) scale(1)`).

#### E. Left-Nav Settings Sidebar (Options Page Redesign)
* **File Changes**: [options.html](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/options.html), [options.css](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/options.css), [options.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/options.js)
* **Design**:
  * Replaces vertical scrolling column lists with a static left sidebar list (`width: 240px`) and right content card sections.
  * Sidebar elements map to five settings categories:
    1. 🌐 **AI Assistant** (API platforms selection).
    2. 📝 **Prompt Presets** (Prompt template overrides).
    3. ⚙️ **Scraping & Filters** (Scrape depth, budget).
    4. 🔀 **Subreddit Specific Mappings** (Wildcard rules & mapping rule tester).
    5. 🔌 **Custom AI Platforms** (Host settings and registrations).
  * Main container filters visible sections based on sidebar active state.

#### F. Subreddit Wildcard Route Tester
* **File Changes**: [options.html](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/options.html), [options.js](file:///Users/alpyalay/Documents/GitHub/Reddit-to-AI/options.js)
* **Design**:
  * Interactive box under the subreddit mapping mappings rules list.
  * Features a text input matching real-time entry patterns to mapping definitions.
  * Dynamically evaluates strings against active wildcard templates (e.g. `cscareer*`) and renders the matched rule, preset template name, and raw instructions.

---

## 3. Localization & Multi-language Sync
To maintain multilingual integrity, all new UI text strings, labels, and hover tooltip messages will be added to the chrome localization structure under:
* `_locales/en/messages.json` (English)
* `_locales/de/messages.json` (German)
* `_locales/es/messages.json` (Spanish)
* `_locales/fr/messages.json` (French)
* `_locales/tr/messages.json` (Turkish)
* And all other languages configured in the project.

---

## 4. Verification Plan

### Automated Verification
* Unit tests verifying that the dynamic pattern router returns the correct matches for the wildcard matching engine under various input edge cases.
* Unit tests checking that budget calculations evaluate to correct token range categories (safe, moderate, large).

### Manual Verification
* Visual inspection of the popup tab rendering, checking responsiveness and alignment.
* Visual verification of tooltips anchoring, positioning, and animations.
* Test sidebar layout transitions in the options settings panel.
* Verify wildcard pattern tester matching matches and displays proper active mappings.
