# Homepage: Advanced Settings & Ticker Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Advanced Settings panel permanently visible and add Magnificent 7 ticker quick-select chips below the ticker input on the Trading Agent homepage.

**Architecture:** Pure frontend changes across three files — `index.html` (structure), `app.js` (behaviour), `style.css` (presentation). No backend or API changes. Tasks are independent and can be done in any order, but Task 1 should be committed first for a clean diff.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, FastAPI backend (not touched)

## Global Constraints

- Do not introduce any new dependencies or build steps
- Keep all changes inside `web/static/` — do not touch Python files
- Follow the existing indigo accent variable `var(--accent)` (`#6366f1`) for chip colours
- All JS must work without a module bundler (plain `<script>` tag, global scope)

---

### Task 1: Remove Advanced Settings Toggle

**Files:**
- Modify: `web/static/index.html` lines 102–150
- Modify: `web/static/app.js` lines 64–74 and 280–289
- Modify: `web/static/style.css` lines 386–399

**Interfaces:**
- Produces: `#advanced-panel` always visible, no toggle button in DOM, `wireAdvancedToggle` removed from codebase

---

- [ ] **Step 1: Edit `index.html` — remove toggle button and unhide panel**

  Replace the `advanced-wrapper` block (lines 102–150). Remove the `<button id="advanced-toggle">` element and remove the `hidden` class from `#advanced-panel`:

  **Before (lines 102–106):**
  ```html
          <div class="advanced-wrapper">
            <button id="advanced-toggle" class="advanced-toggle" type="button">
              ⚙ Advanced options ▾
            </button>
            <div id="advanced-panel" class="advanced-panel hidden">
  ```

  **After:**
  ```html
          <div class="advanced-wrapper">
            <div id="advanced-panel" class="advanced-panel">
  ```

- [ ] **Step 2: Edit `app.js` — remove `wireAdvancedToggle` call from DOMContentLoaded**

  **Before (lines 64–74):**
  ```javascript
  document.addEventListener('DOMContentLoaded', () => {
    wireTeamLookups();   // NEW — must run before any agent event
    setDefaultDate();
    loadProviders();
    wireForm();
    wireAdvancedToggle();
    wireHomeBtn();
    wireAuthForm();
    loadRecentAnalyses();
    wireTickerAutocomplete();
  });
  ```

  **After:**
  ```javascript
  document.addEventListener('DOMContentLoaded', () => {
    wireTeamLookups();   // NEW — must run before any agent event
    setDefaultDate();
    loadProviders();
    wireForm();
    wireHomeBtn();
    wireAuthForm();
    loadRecentAnalyses();
    wireTickerAutocomplete();
  });
  ```

- [ ] **Step 3: Edit `app.js` — delete `wireAdvancedToggle` function**

  Remove the entire function block (lines 280–289):

  ```javascript
  // ── advanced toggle ───────────────────────────────────────────────────────
  function wireAdvancedToggle() {
    const btn   = document.getElementById('advanced-toggle');
    const panel = document.getElementById('advanced-panel');
    btn.addEventListener('click', () => {
      const open = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden', open);
      btn.textContent = open ? 'Advanced options ▾' : 'Advanced options ▴';
    });
  }
  ```

  Delete all 9 lines above (including the comment line). Nothing replaces them.

- [ ] **Step 4: Edit `style.css` — remove toggle button styles**

  Remove the two `.advanced-toggle` rules (lines 388–399). Keep `.advanced-wrapper`:

  **Delete these lines:**
  ```css
  .advanced-toggle {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 4px 0;
    letter-spacing: 0.02em;
    transition: color 0.15s;
  }
  .advanced-toggle:hover { color: var(--accent-dark); }
  ```

  The `.advanced-wrapper` and `.advanced-panel` rules stay unchanged.

- [ ] **Step 5: Verify in browser**

  Start the server:
  ```bash
  cd "C:\Users\fedri\ClaudeCode\Trading Agent"
  python web/server.py
  ```

  Open `http://localhost:7860` (or whatever port the server binds to).

  Check:
  - No "Advanced options ▾" button is visible
  - LLM Provider, Deep-Think Model, Quick-Think Model, Analysts, Research Depth, and Output Language fields are all visible immediately without any interaction
  - Submitting the form still works (provider, depth, language values are collected correctly)

- [ ] **Step 6: Commit**

  ```bash
  git add web/static/index.html web/static/app.js web/static/style.css
  git commit -m "feat: make advanced settings permanently visible"
  ```

---

### Task 2: Add Magnificent 7 Ticker Chips

**Files:**
- Modify: `web/static/index.html` lines 91–95
- Modify: `web/static/app.js` lines 64–74 (DOMContentLoaded block)
- Modify: `web/static/style.css` (append after `.advanced-panel` block)

**Interfaces:**
- Consumes: `#ticker-input` DOM element (defined in index.html)
- Produces: `.ticker-chip` elements that populate `#ticker-input` on click; `wireTickerChips()` global function wired in DOMContentLoaded

---

- [ ] **Step 1: Edit `index.html` — add chip row after ticker input**

  The ticker `form-row` currently ends at line 95 with the hint span. Add the chip `<div>` directly after the hint span, before the closing `</div>` of that form-row:

  **Before (lines 90–95):**
  ```html
            <div class="form-row">
              <label for="ticker-input">Ticker Symbol</label>
              <input id="ticker-input" type="text" placeholder="e.g. NVDA, AAPL, TSLA"
                     autocomplete="off" autocapitalize="characters" />
              <span class="input-hint">US: AAPL · HK: 0700.HK · Crypto: BTC-USD · Index: ^GSPC</span>
            </div>
  ```

  **After:**
  ```html
            <div class="form-row">
              <label for="ticker-input">Ticker Symbol</label>
              <input id="ticker-input" type="text" placeholder="e.g. NVDA, AAPL, TSLA"
                     autocomplete="off" autocapitalize="characters" />
              <span class="input-hint">US: AAPL · HK: 0700.HK · Crypto: BTC-USD · Index: ^GSPC</span>
              <div class="ticker-chips">
                <span class="ticker-chips-label">Popular:</span>
                <button type="button" class="ticker-chip" data-ticker="AAPL">AAPL</button>
                <button type="button" class="ticker-chip" data-ticker="MSFT">MSFT</button>
                <button type="button" class="ticker-chip" data-ticker="NVDA">NVDA</button>
                <button type="button" class="ticker-chip" data-ticker="AMZN">AMZN</button>
                <button type="button" class="ticker-chip" data-ticker="GOOGL">GOOGL</button>
                <button type="button" class="ticker-chip" data-ticker="META">META</button>
                <button type="button" class="ticker-chip" data-ticker="TSLA">TSLA</button>
              </div>
            </div>
  ```

- [ ] **Step 2: Edit `app.js` — add `wireTickerChips` function**

  Add this new function immediately after the `wireAdvancedToggle` block location (now after the autocomplete section, before `wireForm`). Insert after line 278 (closing `}` of `wireTickerAutocomplete`):

  ```javascript
  // ── ticker chips ──────────────────────────────────────────────────────────
  function wireTickerChips() {
    document.querySelectorAll('.ticker-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('ticker-input');
        input.value = btn.dataset.ticker;
        input.dispatchEvent(new Event('input'));
      });
    });
  }
  ```

- [ ] **Step 3: Edit `app.js` — call `wireTickerChips` in DOMContentLoaded**

  Add `wireTickerChips();` at the end of the DOMContentLoaded block (after `wireTickerAutocomplete()`):

  **Before:**
  ```javascript
  document.addEventListener('DOMContentLoaded', () => {
    wireTeamLookups();
    setDefaultDate();
    loadProviders();
    wireForm();
    wireHomeBtn();
    wireAuthForm();
    loadRecentAnalyses();
    wireTickerAutocomplete();
  });
  ```

  **After:**
  ```javascript
  document.addEventListener('DOMContentLoaded', () => {
    wireTeamLookups();
    setDefaultDate();
    loadProviders();
    wireForm();
    wireHomeBtn();
    wireAuthForm();
    loadRecentAnalyses();
    wireTickerAutocomplete();
    wireTickerChips();
  });
  ```

- [ ] **Step 4: Edit `style.css` — add chip styles**

  Append the following rules after the `.advanced-panel` block (after line 407):

  ```css
  /* ticker chips */
  .ticker-chips {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }
  .ticker-chips-label {
    font-size: 0.72rem;
    color: var(--text-muted, #6b7280);
    font-weight: 600;
    letter-spacing: 0.03em;
    margin-right: 0.1rem;
  }
  .ticker-chip {
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--accent);
    color: var(--accent);
    background: transparent;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: 0.03em;
    transition: background 0.15s, color 0.15s;
  }
  .ticker-chip:hover {
    background: var(--accent);
    color: #fff;
  }
  ```

- [ ] **Step 5: Verify in browser**

  Reload `http://localhost:7860`.

  Check:
  - A row of 7 chips labelled `Popular: AAPL MSFT NVDA AMZN GOOGL META TSLA` appears below the ticker input
  - Chips are pill-shaped with an indigo border
  - Hovering a chip fills it with indigo background and white text
  - Clicking `NVDA` sets the ticker input to `NVDA`
  - The autocomplete dropdown does not open on chip click (the input event fires but the query "NVDA" is a complete match — this is acceptable; if the dropdown appears, it shows NVDA as the top result which is correct behaviour)
  - Clicking a chip then pressing "Start Analysis" submits with the correct ticker

- [ ] **Step 6: Commit**

  ```bash
  git add web/static/index.html web/static/app.js web/static/style.css
  git commit -m "feat: add Magnificent 7 ticker quick-select chips"
  ```
