# Ticker Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live ticker autocomplete to the ticker input field so users can type a company name and select the correct symbol from a dropdown.

**Architecture:** A new `GET /api/search` endpoint in `web/server.py` proxies to `yf.Search()` and returns up to 6 matching tickers as JSON. The frontend debounces the ticker input, fetches suggestions, and renders a keyboard-navigable dropdown below the field. No new dependencies — `yfinance` is already installed.

**Tech Stack:** FastAPI (backend), vanilla JS (frontend), `yfinance` `yf.Search`

## Global Constraints

- No new Python or JS dependencies — use only what is already installed
- `GET /api/search` must NOT be added to `_PROTECTED` — it is open to all users without auth
- Endpoint always returns HTTP 200 with a JSON array — never 4xx/5xx for search failures or empty results
- Minimum query length: 2 characters — shorter queries return `[]` without calling Yahoo Finance
- Max results: 6
- Debounce delay: 300ms
- Dropdown CSS must match the existing dark UI palette (`#1e293b` background, `var(--border)` border, `#a5b4fc` accent)
- Cache bust: bump `?v=9` → `?v=10` on both assets in `web/static/index.html`

---

### Task 1: Backend search endpoint

**Files:**
- Modify: `web/server.py`
- Create: `tests/web/test_search.py`

**Interfaces:**
- Produces: `GET /api/search?q={str}` → `list[dict]` where each dict has keys `symbol`, `name`, `exchange`, `type`

- [ ] **Step 1: Create the test file**

Create `tests/web/test_search.py`:

```python
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from web.server import app
    return TestClient(app)


def _mock_search(quotes):
    m = MagicMock()
    m.quotes = quotes
    return m


def test_search_returns_results(client):
    quote = {
        "symbol": "0700.HK",
        "longname": "Tencent Holdings Limited",
        "shortname": "TENCENT",
        "exchange": "HKG",
        "quoteType": "EQUITY",
    }
    with patch("web.server.yf.Search", return_value=_mock_search([quote])):
        r = client.get("/api/search?q=tencent")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["symbol"] == "0700.HK"
    assert data[0]["name"] == "Tencent Holdings Limited"
    assert data[0]["exchange"] == "HKG"
    assert data[0]["type"] == "EQUITY"


def test_search_short_query_returns_empty(client):
    r = client.get("/api/search?q=a")
    assert r.status_code == 200
    assert r.json() == []


def test_search_missing_query_returns_empty(client):
    r = client.get("/api/search")
    assert r.status_code == 200
    assert r.json() == []


def test_search_yfinance_error_returns_empty(client):
    with patch("web.server.yf.Search", side_effect=Exception("network error")):
        r = client.get("/api/search?q=apple")
    assert r.status_code == 200
    assert r.json() == []


def test_search_uses_shortname_fallback(client):
    quote = {
        "symbol": "TCEHY",
        "longname": "",
        "shortname": "Tencent OTC",
        "exchange": "PNK",
        "quoteType": "EQUITY",
    }
    with patch("web.server.yf.Search", return_value=_mock_search([quote])):
        r = client.get("/api/search?q=tencent")
    data = r.json()
    assert data[0]["name"] == "Tencent OTC"


def test_search_skips_results_without_symbol(client):
    quotes = [
        {"symbol": "", "longname": "Ghost", "exchange": "X", "quoteType": "EQUITY"},
        {"symbol": "AAPL", "longname": "Apple Inc.", "exchange": "NMS", "quoteType": "EQUITY"},
    ]
    with patch("web.server.yf.Search", return_value=_mock_search(quotes)):
        r = client.get("/api/search?q=apple")
    data = r.json()
    assert len(data) == 1
    assert data[0]["symbol"] == "AAPL"
```

- [ ] **Step 2: Run tests — verify they fail**

```
pytest tests/web/test_search.py -v
```

Expected: all 6 tests FAIL with `AttributeError` or `404` (endpoint doesn't exist yet).

- [ ] **Step 3: Add `import yfinance as yf` to `web/server.py`**

Open `web/server.py`. After line 10 (`from pathlib import Path`), add one line:

```python
import yfinance as yf
```

The imports block should now look like:

```python
from pathlib import Path

import yfinance as yf

from fastapi import FastAPI, HTTPException, Request
```

- [ ] **Step 4: Add the `GET /api/search` endpoint to `web/server.py`**

After the `get_providers` endpoint (currently ending around line 123), insert:

```python
@app.get("/api/search")
def search_tickers(q: str = ""):
    if len(q.strip()) < 2:
        return []
    try:
        result = yf.Search(query=q, max_results=6, enable_fuzzy_query=True)
        quotes = result.quotes if hasattr(result, "quotes") else []
        return [
            {
                "symbol":   r.get("symbol", ""),
                "name":     r.get("longname") or r.get("shortname") or "",
                "exchange": r.get("exchange", ""),
                "type":     r.get("quoteType", ""),
            }
            for r in quotes
            if r.get("symbol")
        ]
    except Exception:
        return []
```

- [ ] **Step 5: Run tests — verify they pass**

```
pytest tests/web/test_search.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/server.py tests/web/test_search.py
git commit -m "feat(search): add GET /api/search ticker autocomplete endpoint"
```

---

### Task 2: Frontend autocomplete dropdown

**Files:**
- Modify: `web/static/app.js`
- Modify: `web/static/style.css`
- Modify: `web/static/index.html`

**Interfaces:**
- Consumes: `GET /api/search?q={str}` from Task 1 → `[{symbol, name, exchange, type}]`
- Produces: `wireTickerAutocomplete()` — call from `DOMContentLoaded`

- [ ] **Step 1: Add dropdown CSS to `web/static/style.css`**

Append to the very end of `web/static/style.css` (after the closing `}` of the `@media print` block):

```css
/* ── ticker autocomplete dropdown ────────────────────────────────────── */
.ticker-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: #1e293b;
  border: 1px solid var(--border);
  border-radius: 8px;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.ticker-suggestions.hidden {
  display: none;
}

.ticker-suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.1s;
}

.ticker-suggestion-item:hover,
.ticker-suggestion-item.active {
  background: rgba(99, 102, 241, 0.15);
}

.ts-symbol {
  font-weight: 700;
  color: #a5b4fc;
  min-width: 80px;
  flex-shrink: 0;
}

.ts-name {
  color: #e2e8f0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ts-exchange {
  color: #64748b;
  font-size: 0.75rem;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Add `wireTickerAutocomplete()` to `web/static/app.js`**

Insert the following function just before the `wireAdvancedToggle` function (currently at line 177):

```javascript
// ── ticker autocomplete ───────────────────────────────────────────────
function wireTickerAutocomplete() {
  const input   = document.getElementById('ticker-input');
  const formRow = input.closest('.form-row');
  formRow.style.position = 'relative';

  const ul = document.createElement('ul');
  ul.id        = 'ticker-suggestions';
  ul.className = 'ticker-suggestions hidden';
  formRow.appendChild(ul);

  let debounceTimer = null;
  let activeIndex   = -1;

  function closeSuggestions() {
    ul.classList.add('hidden');
    ul.innerHTML = '';
    activeIndex  = -1;
  }

  function selectSuggestion(symbol) {
    input.value = symbol;
    closeSuggestions();
  }

  function setActive(items, index) {
    items.forEach((item, i) => item.classList.toggle('active', i === index));
  }

  function renderSuggestions(results) {
    ul.innerHTML = '';
    activeIndex  = -1;
    if (!results.length) { ul.classList.add('hidden'); return; }
    results.forEach(r => {
      const li = document.createElement('li');
      li.className = 'ticker-suggestion-item';
      const sym  = document.createElement('span');
      sym.className   = 'ts-symbol';
      sym.textContent = r.symbol;
      const name = document.createElement('span');
      name.className   = 'ts-name';
      name.textContent = r.name;
      const exch = document.createElement('span');
      exch.className   = 'ts-exchange';
      exch.textContent = r.exchange;
      li.append(sym, name, exch);
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        selectSuggestion(r.symbol);
      });
      ul.appendChild(li);
    });
    ul.classList.remove('hidden');
  }

  async function fetchSuggestions(q) {
    try {
      const r = await fetch('/api/search?q=' + encodeURIComponent(q));
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { closeSuggestions(); return; }
    debounceTimer = setTimeout(async () => {
      const results = await fetchSuggestions(q);
      renderSuggestions(results);
    }, 300);
  });

  input.addEventListener('keydown', e => {
    const items = Array.from(ul.querySelectorAll('.ticker-suggestion-item'));
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      setActive(items, activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      setActive(items, activeIndex);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(items[activeIndex].querySelector('.ts-symbol').textContent);
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(closeSuggestions, 150);
  });

  document.addEventListener('click', e => {
    if (!formRow.contains(e.target)) closeSuggestions();
  });
}
```

- [ ] **Step 3: Call `wireTickerAutocomplete()` from `DOMContentLoaded`**

Find the `DOMContentLoaded` listener (around line 64). It currently ends with `loadRecentAnalyses()`. Add one line after it:

```javascript
document.addEventListener('DOMContentLoaded', () => {
  wireTeamLookups();
  setDefaultDate();
  loadProviders();
  wireForm();
  wireAdvancedToggle();
  wireHomeBtn();
  wireAuthForm();
  loadRecentAnalyses();
  wireTickerAutocomplete();   // ← add this line
});
```

- [ ] **Step 4: Bump cache bust in `web/static/index.html`**

Find lines 7 and 9 in `index.html`. Change both from `?v=9` to `?v=10`:

```html
<link rel="stylesheet" href="/static/style.css?v=10" />
<script src="/static/app.js?v=10" defer></script>
```

- [ ] **Step 5: Manual smoke test**

Start the server:
```
python -m uvicorn web.server:app --reload
```

Open `http://localhost:8000`. Type "tencent" in the ticker field — after 300ms a dropdown should appear showing `0700.HK — Tencent Holdings Limited · HKG` (and possibly `TCEHY`). Click an item — the field should fill with the symbol and the dropdown should close. Press Escape — dropdown closes. Arrow keys navigate. Type a single character — dropdown stays hidden.

- [ ] **Step 6: Commit**

```bash
git add web/static/app.js web/static/style.css web/static/index.html
git commit -m "feat(search): ticker autocomplete dropdown with keyboard navigation"
```
