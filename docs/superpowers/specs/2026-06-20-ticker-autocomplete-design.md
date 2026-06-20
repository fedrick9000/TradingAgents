# Ticker Autocomplete — Design Spec
**Date:** 2026-06-20  
**Status:** Approved  
**Scope:** Add live ticker search/autocomplete to the `#ticker-input` field on the idle view

---

## Overview

Users often know a company name but not its exact ticker symbol (e.g. "Tencent" → `0700.HK`). A live autocomplete dropdown resolves this by querying Yahoo Finance as the user types.

---

## Architecture

Two components:

1. **Backend search endpoint** — `GET /api/search?q=<query>` in `web/server.py`
2. **Frontend autocomplete** — debounced input listener + dropdown in `web/static/app.js` + `web/static/style.css`

No new dependencies. `yfinance` (`yf.Search`) is already used in the codebase. `requests` is already installed.

---

## Backend

### Endpoint

`GET /api/search?q={query}`

- **Auth:** Open — not added to `_PROTECTED`. No cookie required.
- **Query param:** `q` — the search string (company name or partial ticker)
- **Returns:** JSON array of up to 6 results, or `[]` for empty/short queries

### Implementation

Uses `yf.Search(query=q, max_results=6)`. The `.quotes` property of the result contains matching instruments.

Each result in the response:
```json
{ "symbol": "0700.HK", "name": "Tencent Holdings Limited", "exchange": "HKG", "type": "EQUITY" }
```

Fields sourced from `yf.Search` quote objects: `symbol`, `longname` (or `shortname` as fallback), `exchange`, `quoteType`.

### Error handling

- `q` missing or fewer than 2 characters → return `[]` immediately, no Yahoo Finance call
- `yf.Search` raises → return `[]` (log the error server-side, don't surface to client)
- Response always HTTP 200 with a JSON array — never 4xx/5xx for search failures

### No test file for this endpoint

The endpoint is a thin proxy with no logic beyond field extraction. Integration-style tests would require a live Yahoo Finance call. No unit test added.

---

## Frontend

### Trigger

- Event: `input` on `#ticker-input`
- Debounce: 300ms
- Minimum length: 2 characters before fetching. Below 2 → close dropdown immediately.

### Dropdown

- A `<ul id="ticker-suggestions">` injected once into the DOM (after `#ticker-input`'s parent `.form-row`) on first use
- Positioned absolutely below the input, full width of the input
- Each item: `<li>` showing `{symbol} — {name} · {exchange}`
- Up to 6 items shown
- If the fetch returns `[]` → hide dropdown silently

### Interaction

| Action | Result |
|---|---|
| Click a result | Fill `#ticker-input` with `symbol`, close dropdown |
| Arrow Up / Arrow Down | Move highlight between items |
| Enter (item highlighted) | Select highlighted item, close dropdown |
| Escape | Close dropdown |
| Click outside dropdown | Close dropdown |
| User keeps typing | New debounced fetch, dropdown updates |

### After selection

- `#ticker-input` value is set to the selected `symbol` (e.g. `0700.HK`)
- Input is NOT auto-upcased here — the existing `submitForm()` already does `.toUpperCase()` before sending

### Cache bust

- `index.html` asset version bumped: `?v=9` → `?v=10` on both `style.css` and `app.js`

---

## CSS

Dropdown styled to match existing form/card aesthetic:

- Background: dark (`#1e2a3b` or similar — matches sidebar card tone)
- Border: `1px solid var(--border)`
- Each `<li>`: padding, hover highlight using existing `--accent` color
- Active/highlighted item: distinct background
- `z-index` high enough to sit above other form elements
- `position: absolute` with `width: 100%` relative to the `.form-row` container (which gets `position: relative`)

---

## Files Changed

| File | Change |
|---|---|
| `web/server.py` | Add `GET /api/search` endpoint |
| `web/static/app.js` | Add `wireTickerAutocomplete()`, called from `DOMContentLoaded` |
| `web/static/style.css` | Add `#ticker-suggestions` dropdown styles |
| `web/static/index.html` | Bump cache bust `?v=9` → `?v=10` |

---

## Out of Scope

- No keyboard shortcut to open the dropdown without typing
- No "no results found" message — dropdown simply hides
- No caching of search results on the frontend
- No rate limiting on the backend search endpoint (Yahoo Finance's own rate limits apply)
