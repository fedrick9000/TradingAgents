# Homepage: Always-Visible Advanced Settings & Magnificent 7 Ticker Chips

**Date:** 2026-06-20  
**Status:** Approved

---

## Overview

Two focused UI changes to the Trading Agent homepage (`/web/static/`):

1. Make the Advanced Settings panel permanently visible (remove the toggle)
2. Add Magnificent 7 ticker chips below the ticker input for quick selection

---

## Change 1 — Advanced Settings Always Visible

### Problem

The advanced settings panel (`#advanced-panel`) is hidden by default behind a toggle button. All users must click "Advanced options ▾" to reveal provider, model, analyst, depth, and language settings. These settings are relevant to every analysis run.

### Solution

Remove the toggle entirely. The panel renders expanded on page load for all users with no way to collapse it.

### Files Changed

**`web/static/index.html`**
- Remove the `#advanced-toggle` button element
- Remove the `hidden` class from `#advanced-panel`

**`web/static/app.js`**
- Remove the `wireAdvancedToggle()` function definition (lines 281–289)
- Remove the `wireAdvancedToggle()` call site

### What Does Not Change

- The panel's visual styling (`.advanced-panel` CSS) stays as-is
- All fields inside the panel (provider, models, analysts, depth, language) are unchanged
- Form submission logic is unchanged

---

## Change 2 — Magnificent 7 Ticker Chips

### Problem

Users must type or search for a ticker manually. There is no quick-pick for the most commonly analyzed US stocks.

### Solution

Insert a chip row directly below `#ticker-input` in the analysis form. The label reads "Popular:" followed by 7 pill-shaped buttons. Clicking a chip fills the ticker input; the user still selects a date and submits manually.

### Tickers

| Chip | Company |
|------|---------|
| AAPL | Apple |
| MSFT | Microsoft |
| NVDA | NVIDIA |
| AMZN | Amazon |
| GOOGL | Alphabet |
| META | Meta |
| TSLA | Tesla |

### Files Changed

**`web/static/index.html`**
- Add a `<div class="ticker-chips">` block immediately after the `#ticker-input` element
- Each chip is a `<button type="button" class="ticker-chip" data-ticker="XXXX">XXXX</button>`

**`web/static/app.js`**
- Add a `wireTickerChips()` function: query all `.ticker-chip` elements, on click set `#ticker-input` value to `dataset.ticker` and dispatch an `input` event (so autocomplete stays consistent)
- Call `wireTickerChips()` in the existing `init()` / `DOMContentLoaded` setup block

**`web/static/style.css`**
- `.ticker-chips` — flex row, `gap: 0.4rem`, `flex-wrap: wrap`, `margin-top: 0.5rem`
- `.ticker-chip` — small pill: `padding: 0.2rem 0.6rem`, `border-radius: 999px`, `border: 1px solid var(--accent)`, `color: var(--accent)`, `background: transparent`, `font-size: 0.75rem`, `cursor: pointer`
- `.ticker-chip:hover` — `background: var(--accent)`, `color: #fff`

### Interaction

1. User clicks a chip → `#ticker-input` value is set → input event fires (clears any stale autocomplete state)
2. User picks a date → clicks "Start Analysis"
3. No form submission on chip click; no backend changes required

---

## Out of Scope

- No categorization (flat list only, no headers like "US Stocks" / "Crypto")
- No SpaceX ticker (not publicly listed)
- No persistence of chip selection state
- No backend or API changes

---

## Files Summary

| File | Changes |
|------|---------|
| `web/static/index.html` | Remove toggle button, remove `hidden` from panel, add chip row |
| `web/static/app.js` | Remove `wireAdvancedToggle()`, add `wireTickerChips()` |
| `web/static/style.css` | Add `.ticker-chips` and `.ticker-chip` styles |
