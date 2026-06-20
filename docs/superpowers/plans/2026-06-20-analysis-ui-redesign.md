# Analysis Page UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 UI improvements to the running analysis view: team-colored agent panels, reversed feed, click-to-navigate sidebar, header progress indicator, summary hero card, and PDF/PPT export.

**Architecture:** Pure frontend changes (CSS + JS + HTML) for changes 1–6. Change 5 (PPT) adds one new Python module (`web/export_pptx.py`) and one FastAPI endpoint. All SSE event data already flows through `AppState`; no backend analysis changes needed.

**Tech Stack:** Vanilla JS (ES6), CSS custom properties, FastAPI, `python-pptx`, `matplotlib`

## Global Constraints

- Cache-bust: bump `?v=8` → `?v=9` on `style.css` and `app.js` in `index.html` when changes land
- Team color palette (Hex / RGB): Analyst Team `#3B82F6` / `59,130,246` · Research Team `#8B5CF6` / `139,92,246` · Trading Team `#10B981` / `16,185,129` · Risk Management `#EF4444` / `239,68,68` · Portfolio Management `#F59E0B` / `245,158,11`
- PPT background: `#0F172A` · Signal BUY/OVERWEIGHT `#10B981` · SELL/UNDERWEIGHT `#EF4444` · HOLD/NEUTRAL `#F59E0B`
- Do not change any SSE event structure, `AnalysisState`, or `TradingAgentsGraph`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `web/static/style.css` | Modify | Team color CSS, progress bar, hero card, export buttons, print media query |
| `web/static/app.js` | Modify | TEAM_COLORS/AGENT_TO_TEAM constants, AppState additions, all new functions |
| `web/static/index.html` | Modify | Progress indicator HTML in running header; bump cache version |
| `web/export_pptx.py` | Create | `generate_pptx(data: dict) -> bytes` — python-pptx + matplotlib slide builder |
| `web/server.py` | Modify | `POST /api/export/pptx` endpoint + `ExportRequest` model |
| `tests/web/test_export_pptx.py` | Create | Smoke test for `generate_pptx()` |

---

## Task 1: CSS Foundations

**Files:**
- Modify: `web/static/style.css` (add after the `/* ── agent dots ──` block through end of file)

**Interfaces:**
- Produces: CSS classes `.team-block` (cursor + hover), `.progress-indicator`, `.progress-bar-wrap`, `.progress-fill`, `.progress-fraction`, `.progress-agent-name`, `.hero-card`, `.hero-card.hero-BUY/.hero-SELL/.hero-HOLD`, `.hero-signal-badge`, `.hero-meta`, `.hero-ticker`, `.hero-summary`, `.hero-key-levels`, `.hero-actions`, `.export-btn`, `.export-btn-pdf`, `.export-btn-pptx`, `@media print` rules

- [ ] **Step 1: Add team block clickability and progress indicator CSS to `style.css`**

Append after the closing `}` of `@media (max-width: 768px)` (line 961):

```css
/* ── team block interactivity ──────────────────────────────── */
.sidebar .team-block {
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 0;
}
.sidebar .team-block:hover { background: rgba(255,255,255,0.05); }

/* ── header progress indicator ─────────────────────────────── */
.progress-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.progress-fraction {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.progress-bar-wrap {
  width: 72px;
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  width: 0%;
  border-radius: 3px;
  transition: width 0.4s ease, background-color 0.3s;
  background: var(--accent);
}
.progress-agent-name {
  font-size: 0.72rem;
  color: var(--muted);
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Add hero card CSS**

Append immediately after the block above:

```css
/* ── summary hero card ─────────────────────────────────────── */
.hero-card {
  border-radius: var(--radius);
  background: var(--surface);
  padding: 22px;
  border: 2px solid var(--border);
  box-shadow: var(--shadow-md);
  animation: heroIn 0.35s ease-out;
}
@keyframes heroIn {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.hero-card.hero-BUY, .hero-card.hero-OVERWEIGHT {
  border-color: #10B981;
  box-shadow: 0 0 20px rgba(16,185,129,0.18), var(--shadow-md);
}
.hero-card.hero-SELL, .hero-card.hero-UNDERWEIGHT {
  border-color: #EF4444;
  box-shadow: 0 0 20px rgba(239,68,68,0.18), var(--shadow-md);
}
.hero-card.hero-HOLD, .hero-card.hero-NEUTRAL {
  border-color: #F59E0B;
  box-shadow: 0 0 20px rgba(245,158,11,0.18), var(--shadow-md);
}
.hero-signal-badge {
  display: inline-block;
  font-size: 1.4rem;
  font-weight: 900;
  padding: 8px 24px;
  border-radius: var(--radius);
  margin-bottom: 14px;
  letter-spacing: 0.06em;
}
.hero-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}
.hero-ticker {
  font-weight: 800;
  color: var(--text);
  font-size: 1rem;
}
.hero-date { font-size: 0.82rem; color: var(--muted); }
.hero-summary {
  font-size: 0.85rem;
  line-height: 1.75;
  color: var(--text-2);
  margin-bottom: 14px;
}
.hero-key-levels {
  font-size: 0.77rem;
  color: var(--muted);
  margin-bottom: 16px;
  font-family: ui-monospace, monospace;
}
.hero-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.export-btn {
  padding: 9px 18px;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: background 0.15s, box-shadow 0.15s;
  letter-spacing: 0.01em;
}
.export-btn-pdf {
  background: var(--sidebar-bg);
  color: #fff;
  box-shadow: 0 2px 6px rgba(30,27,75,0.2);
}
.export-btn-pdf:hover { background: #2d2a6e; }
.export-btn-pptx {
  background: #2563eb;
  color: #fff;
  box-shadow: 0 2px 6px rgba(37,99,235,0.25);
}
.export-btn-pptx:hover { background: #1d4ed8; }
.export-btn:disabled { opacity: 0.55; cursor: not-allowed; }
```

- [ ] **Step 3: Add print media query**

Append immediately after the block above:

```css
/* ── print / PDF export ────────────────────────────────────── */
@media print {
  .sidebar,
  .running-header,
  .live-feed,
  .hero-actions,
  .card-chevron,
  #idle-view { display: none !important; }

  .app-shell   { display: block !important; }
  .main-content { display: block !important; }
  .stage-layout {
    display: block !important;
    height: auto !important;
    overflow: visible !important;
  }
  .story-panels {
    overflow: visible !important;
    height: auto !important;
    padding: 8px !important;
  }
  .story-card { page-break-before: always; break-before: page; box-shadow: none !important; }
  .hero-card  { page-break-before: avoid; break-before: avoid;
                page-break-after: always; break-after: page; }
  .story-card .card-body { display: block !important; }
  .story-card.pending    { display: none !important; }
  .card-markdown { font-size: 10pt !important; }
}
```

- [ ] **Step 4: Verify CSS file parses cleanly**

Open DevTools → Console in a browser on the app; no CSS errors should appear. (Temporary visual check — full testing happens in Task 3+.)

- [ ] **Step 5: Commit**

```bash
git add web/static/style.css
git commit -m "style: add team color, progress bar, hero card, and print CSS"
```

---

## Task 2: JS Constants and AppState Extensions

**Files:**
- Modify: `web/static/app.js` (top of file, after `const AppState = {...}`)

**Interfaces:**
- Produces:
  - `TEAM_COLORS` — `{ [teamName]: { hex: string, rgb: string } }`
  - `AGENT_TO_TEAM` — `{ [agentName]: teamName }` (derived from `TEAM_AGENTS`)
  - `TEAM_TO_SCROLL_TARGET` — `{ [teamName]: cardId | null }`
  - `CARD_TEAM` — `{ [cardId]: teamName }`
  - `AppState.completedTeams` (Set), `AppState.totalTeams` (number), `AppState.lastSignal` (string|null), `AppState.lastDecisionText` (string|null)

- [ ] **Step 1: Add TEAM_COLORS constant after `const AppState = {...}` block (after line 19)**

```javascript
// ── team colour palette ────────────────────────────────────────────────────
const TEAM_COLORS = {
  'Analyst Team':         { hex: '#3B82F6', rgb: '59,130,246' },
  'Research Team':        { hex: '#8B5CF6', rgb: '139,92,246' },
  'Trading Team':         { hex: '#10B981', rgb: '16,185,129' },
  'Risk Management':      { hex: '#EF4444', rgb: '239,68,68'  },
  'Portfolio Management': { hex: '#F59E0B', rgb: '245,158,11' },
};

// agent → team lookup (derived at module load from TEAM_AGENTS defined below)
// Populated in wireTeamLookups() called from DOMContentLoaded
const AGENT_TO_TEAM = {};

const TEAM_TO_SCROLL_TARGET = {
  'Analyst Team':         null,              // scrolls to first visible analyst card
  'Research Team':        'panel-invest-debate',
  'Trading Team':         'panel-trader',
  'Risk Management':      'panel-risk-debate',
  'Portfolio Management': 'panel-final',
};

const CARD_TEAM = {
  'panel-market':        'Analyst Team',
  'panel-sentiment':     'Analyst Team',
  'panel-news':          'Analyst Team',
  'panel-fundamentals':  'Analyst Team',
  'panel-invest-debate': 'Research Team',
  'panel-trader':        'Trading Team',
  'panel-risk-debate':   'Risk Management',
  'panel-final':         'Portfolio Management',
};
```

- [ ] **Step 2: Add `completedTeams`, `totalTeams`, `lastSignal`, `lastDecisionText` to `AppState`**

Edit `const AppState = {` block to add four fields:

```javascript
const AppState = {
  phase: 'idle',
  sessionId: null,
  eventSource: null,
  providers: {},
  agentStatus: {},
  reports: {},
  debateData: { investment: {}, risk: {} },
  feedEvents: [],
  recentAnalyses: [],
  currentMeta: {},
  elapsedInterval: null,
  startTime: null,
  _pendingSubmit: false,
  completedTeams: new Set(),   // NEW
  totalTeams: 0,               // NEW
  lastSignal: null,            // NEW
  lastDecisionText: null,      // NEW
};
```

- [ ] **Step 3: Add `wireTeamLookups()` and call it from `DOMContentLoaded`**

Add the function just before the `// ── bootstrap` comment:

```javascript
function wireTeamLookups() {
  Object.entries(TEAM_AGENTS).forEach(([team, agents]) => {
    agents.forEach(agent => { AGENT_TO_TEAM[agent] = team; });
  });
}
```

Then in `document.addEventListener('DOMContentLoaded', () => {`, add `wireTeamLookups();` as the first line:

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
});
```

- [ ] **Step 4: Verify in console**

Open browser console and type:
```
TEAM_COLORS['Risk Management'].hex  // should log "#EF4444"
AGENT_TO_TEAM['Portfolio Manager']  // should log "Portfolio Management"
```

- [ ] **Step 5: Commit**

```bash
git add web/static/app.js
git commit -m "feat: add team color constants and AppState extensions"
```

---

## Task 3: Agent Panel Colors + Agent Dot Colors

**Files:**
- Modify: `web/static/app.js` (`buildPipelineStrip()` function, lines ~417–456)

**Interfaces:**
- Consumes: `TEAM_COLORS`, `TEAM_AGENTS`
- Produces: team blocks with colored left border + background tint; agent dots inherit team color via CSS custom property `--team-color`

- [ ] **Step 1: Replace `buildPipelineStrip()` with team-colored version**

Replace the entire function (from `function buildPipelineStrip(selectedAnalysts) {` through the closing `}`) with:

```javascript
function buildPipelineStrip(selectedAnalysts) {
  const strip = document.getElementById('pipeline-strip');
  strip.innerHTML = '';

  const analystMap = {
    market: 'Market Analyst', social: 'Sentiment Analyst',
    news: 'News Analyst', fundamentals: 'Fundamentals Analyst',
  };
  const selectedAgents = new Set(selectedAnalysts.map(k => analystMap[k]).filter(Boolean));

  let visibleTeamCount = 0;
  Object.entries(TEAM_AGENTS).forEach(([team, agents]) => {
    const relevant = team === 'Analyst Team'
      ? agents.filter(a => selectedAgents.has(a))
      : agents;
    if (relevant.length === 0) return;

    visibleTeamCount++;
    const color = TEAM_COLORS[team] || { hex: '#6366f1', rgb: '99,102,241' };

    const block = document.createElement('div');
    block.className = 'team-block';
    block.dataset.team = team;
    // Color accent
    block.style.borderLeft = `4px solid ${color.hex}`;
    block.style.background  = `rgba(${color.rgb}, 0.10)`;
    block.style.paddingLeft  = '14px';

    const nameEl = document.createElement('div');
    nameEl.className = 'team-name';
    nameEl.style.color = color.hex;
    nameEl.textContent = team;
    block.appendChild(nameEl);

    const dotsEl = document.createElement('div');
    dotsEl.className = 'agent-dots';
    relevant.forEach(agent => {
      AppState.agentStatus[agent] = 'pending';
      const dot = document.createElement('div');
      dot.className = 'agent-dot';
      dot.dataset.agent  = agent;
      dot.dataset.status = 'pending';
      dot.title = agent;
      dot.style.setProperty('--team-color', color.hex);
      dotsEl.appendChild(dot);
    });
    block.appendChild(dotsEl);
    strip.appendChild(block);
  });

  AppState.totalTeams = visibleTeamCount;
}
```

- [ ] **Step 2: Update agent dot CSS to use `--team-color`**

In `style.css`, replace the two existing `.agent-dot[data-status]` rules:

**Old:**
```css
.agent-dot[data-status="in_progress"] {
  border-color: #a5b4fc;
  animation: pulse 1.2s ease-in-out infinite;
}
.agent-dot[data-status="completed"] {
  background: #4ade80;
  border-color: #4ade80;
}
```

**New:**
```css
.agent-dot[data-status="in_progress"] {
  border-color: var(--team-color, #a5b4fc);
  animation: pulse 1.2s ease-in-out infinite;
}
.agent-dot[data-status="completed"] {
  background:   var(--team-color, #4ade80);
  border-color: var(--team-color, #4ade80);
}
```

- [ ] **Step 3: Manual test**

Start a new analysis. The left sidebar should show:
- Analyst Team block: blue left border + blue tinted background + blue team name
- Research Team: purple
- Trading Team: green
- Risk Management: red
- Portfolio Management: amber
- Agent dots pulse in team color when in_progress, fill in team color when completed

- [ ] **Step 4: Commit**

```bash
git add web/static/app.js web/static/style.css
git commit -m "feat: colored agent panel blocks and team-colored status dots"
```

---

## Task 4: Reversed Feed (Latest on Top)

**Files:**
- Modify: `web/static/app.js` (`appendFeedRow()`, lines ~488–528)

**Interfaces:**
- Consumes: existing `appendFeedRow()` signature — no change
- Produces: new rows appear at top of `#live-feed` instead of bottom

- [ ] **Step 1: Change `feed.appendChild(row)` to prepend**

In `appendFeedRow()`, replace the last three lines:

**Old:**
```javascript
  row.appendChild(ts);
  row.appendChild(badge);
  row.appendChild(content);
  feed.appendChild(row);
  feed.scrollTop = feed.scrollHeight;
```

**New:**
```javascript
  row.appendChild(ts);
  row.appendChild(badge);
  row.appendChild(content);
  feed.insertBefore(row, feed.firstChild);
  // No scroll needed — newest item is always at the top
```

- [ ] **Step 2: Manual test**

Start an analysis. As events come in, the most recent entry should appear at the TOP of the middle panel. Older entries push down.

- [ ] **Step 3: Commit**

```bash
git add web/static/app.js
git commit -m "feat: reverse live feed — newest events on top"
```

---

## Task 5: Click-to-Navigate + Report Card Header Colors

**Files:**
- Modify: `web/static/app.js` (add `applyTeamColors()`, update `buildPipelineStrip()`, update `transitionToRunning()`)

**Interfaces:**
- Consumes: `TEAM_COLORS`, `CARD_TEAM`, `TEAM_TO_SCROLL_TARGET`
- Produces: clicking a team block smoothly scrolls `#story-panels` to that team's report card; each report card header has a left border in team color

- [ ] **Step 1: Add `applyTeamColors()` function**

Add this function just before `// ── Task 5: pipeline strip` comment:

```javascript
function applyTeamColors() {
  Object.entries(CARD_TEAM).forEach(([cardId, team]) => {
    const card = document.getElementById(cardId);
    if (!card || card.classList.contains('hidden')) return;
    const color = TEAM_COLORS[team];
    if (!color) return;
    const header = card.querySelector('.card-header');
    if (header) {
      header.style.borderLeft = `4px solid ${color.hex}`;
      header.style.background  = `rgba(${color.rgb}, 0.06)`;
    }
  });
}
```

- [ ] **Step 2: Add click handler in `buildPipelineStrip()`**

Inside the `buildPipelineStrip()` forEach, add the click handler right before `strip.appendChild(block)`:

```javascript
    // Click → scroll to matching report card
    block.addEventListener('click', () => {
      const targetId = TEAM_TO_SCROLL_TARGET[team];
      if (targetId) {
        const card = document.getElementById(targetId);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (team === 'Analyst Team') {
        // Scroll to first visible analyst card
        const analystIds = ['panel-market', 'panel-sentiment', 'panel-news', 'panel-fundamentals'];
        const first = analystIds.map(id => document.getElementById(id))
                                .find(el => el && !el.classList.contains('hidden'));
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
```

- [ ] **Step 3: Call `applyTeamColors()` in `transitionToRunning()`**

In `transitionToRunning()`, add `applyTeamColors();` after `resetStoryPanels(selectedAnalysts);`:

```javascript
  buildPipelineStrip(selectedAnalysts);
  resetStoryPanels(selectedAnalysts);
  applyTeamColors();    // NEW — colors card headers after DOM is built
  clearFeed();
  startElapsed();
```

- [ ] **Step 4: Manual test**

Start an analysis. Click "Research Team" in the sidebar → right panel scrolls to the Research Debate card. Click "Risk Management" → scrolls to Risk Deliberation. Each report card header should have a colored left border matching its sidebar team.

- [ ] **Step 5: Commit**

```bash
git add web/static/app.js
git commit -m "feat: click-to-navigate sidebar + team-colored report card headers"
```

---

## Task 6: Header Progress Indicator

**Files:**
- Modify: `web/static/index.html` (running-header markup)
- Modify: `web/static/app.js` (`transitionToRunning()`, `onAgentStatus()`, new `updateProgressIndicator()`)

**Interfaces:**
- Consumes: `AppState.completedTeams`, `AppState.totalTeams`, `TEAM_COLORS`, `AGENT_TO_TEAM`, `TEAM_AGENTS`
- Produces: `#progress-indicator` updates on every `agent_status` event; fraction + bar + active team name displayed left of the timer

- [ ] **Step 1: Add progress indicator HTML in `index.html`**

In the `running-header`, insert the progress indicator div inside `.running-header-right`, **before** the `timer-block` div:

**Old:**
```html
        <div class="running-header-right">
          <div class="timer-block">
```

**New:**
```html
        <div class="running-header-right">
          <div id="progress-indicator" class="progress-indicator">
            <span id="progress-fraction" class="progress-fraction">0 / 5</span>
            <div class="progress-bar-wrap">
              <div id="progress-fill" class="progress-fill"></div>
            </div>
            <span id="progress-agent-name" class="progress-agent-name"></span>
          </div>
          <div class="timer-block">
```

- [ ] **Step 2: Add `updateProgressIndicator()` function in `app.js`**

Add just before `// ── elapsed timer` comment:

```javascript
// ── progress indicator ─────────────────────────────────────────────────────
function resetProgressIndicator() {
  const fraction  = document.getElementById('progress-fraction');
  const fill      = document.getElementById('progress-fill');
  const agentName = document.getElementById('progress-agent-name');
  if (fraction)  fraction.textContent  = `0 / ${AppState.totalTeams}`;
  if (fill)      { fill.style.width = '0%'; fill.style.backgroundColor = 'var(--accent)'; }
  if (agentName) agentName.textContent = '';
}

function updateProgressIndicator(agent, status) {
  const team  = AGENT_TO_TEAM[agent];
  if (!team) return;
  const color = TEAM_COLORS[team] || { hex: 'var(--accent)', rgb: '99,102,241' };

  const fraction  = document.getElementById('progress-fraction');
  const fill      = document.getElementById('progress-fill');
  const agentName = document.getElementById('progress-agent-name');

  if (status === 'in_progress') {
    if (agentName) agentName.textContent = `● ${team}`;
    if (fill) fill.style.backgroundColor = color.hex;
  }

  if (status === 'completed') {
    // Mark team complete if ALL its registered agents are done
    const teamAgents = (TEAM_AGENTS[team] || []).filter(a => a in AppState.agentStatus);
    if (teamAgents.length > 0 && teamAgents.every(a => AppState.agentStatus[a] === 'completed')) {
      AppState.completedTeams.add(team);
    }
  }

  const count = AppState.completedTeams.size;
  const total = AppState.totalTeams || 5;
  if (fraction) fraction.textContent = `${count} / ${total}`;
  if (fill) fill.style.width = `${(count / total) * 100}%`;

  if (count === total && total > 0) {
    if (fill) fill.style.backgroundColor = '#10B981';
    if (agentName) agentName.textContent = 'Complete ✓';
  }
}
```

- [ ] **Step 3: Reset state in `transitionToRunning()` and call `resetProgressIndicator()`**

In `transitionToRunning()`, update the AppState reset block and add the indicator reset:

```javascript
function transitionToRunning(selectedAnalysts) {
  AppState.phase = 'running';
  AppState.agentStatus = {};
  AppState.reports = {};
  AppState.debateData = { investment: {}, risk: {} };
  AppState.feedEvents = [];
  AppState.completedTeams = new Set();   // reset
  AppState.totalTeams = 0;              // reset (set by buildPipelineStrip below)
  AppState.lastSignal = null;
  AppState.lastDecisionText = null;

  // Remove hero card from any previous run
  const existingHero = document.getElementById('hero-card');
  if (existingHero) existingHero.remove();

  document.getElementById('idle-view').classList.add('hidden');
  document.getElementById('running-view').classList.remove('hidden');

  const { ticker, date, provider } = AppState.currentMeta;
  document.getElementById('compact-bar').textContent =
    `${ticker}  ·  ${date}  ·  ${provider}`;

  buildPipelineStrip(selectedAnalysts);
  resetProgressIndicator();             // reset after buildPipelineStrip sets totalTeams
  resetStoryPanels(selectedAnalysts);
  applyTeamColors();
  clearFeed();
  startElapsed();
}
```

- [ ] **Step 4: Call `updateProgressIndicator()` from `onAgentStatus()`**

```javascript
function onAgentStatus(event) {
  updatePipelineStrip(event.agent, event.status);
  appendSystemFeed(`${event.agent} → ${event.status}`);
  updateProgressIndicator(event.agent, event.status);   // NEW
}
```

- [ ] **Step 5: Manual test**

Start an analysis. Header should show `0 / 5  ░░░░░░░░` initially. As agents start, the active team name appears next to the bar (e.g., `● Analyst Team`). As teams complete, fraction increments and bar fills in team color. When all 5 complete: `5 / 5  ████████ Complete ✓` (bar turns green).

- [ ] **Step 6: Commit**

```bash
git add web/static/index.html web/static/app.js
git commit -m "feat: overall progress indicator in running header"
```

---

## Task 7: Summary Hero Card

**Files:**
- Modify: `web/static/app.js` (`onDecision()`, add `renderHeroCard()`, `extractSynthesis()`, `extractKeyLevels()`, `extractCompanyName()`)

**Interfaces:**
- Consumes: `event.signal`, `event.full_text`, `AppState.currentMeta`
- Produces: `#hero-card` prepended to `#story-panels` on decision event; stores `AppState.lastSignal` and `AppState.lastDecisionText`

- [ ] **Step 1: Add helper functions before `onDecision()`**

Add just before the `// ── final decision ──` comment:

```javascript
// ── hero card helpers ─────────────────────────────────────────────────────
function extractCompanyName(ticker, marketReport) {
  if (!marketReport) return ticker;
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = marketReport.match(new RegExp(escaped + '\\s*\\(([^)]+)\\)'));
  return m ? m[1].trim() : ticker;
}

function extractSynthesis(fullText) {
  // Return the first substantive paragraph (skip headings and short lines)
  const lines = fullText.split('\n');
  let para = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('**') && line.endsWith('**')) continue;
    // Strip inline bold/italic markdown
    const clean = line.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').trim();
    if (clean.length < 30) continue;
    para = clean;
    break;
  }
  return para.length > 320 ? para.slice(0, 317) + '…' : para;
}

function extractKeyLevels(fullText) {
  const supportM  = fullText.match(/support[^.]{0,60}?((?:HKD|USD|\$|€)\s*[\d,.]+)/i);
  const resistM   = fullText.match(/(?:resist|reclaim)[^.]{0,60}?((?:HKD|USD|\$|€)\s*[\d,.]+)/i);
  const levels = [];
  if (supportM) levels.push(`Support ${supportM[1]}`);
  if (resistM)  levels.push(`Resistance ${resistM[1]}`);
  return levels.join(' · ');
}

function renderHeroCard(signal, fullText) {
  const panels = document.getElementById('story-panels');
  const old = document.getElementById('hero-card');
  if (old) old.remove();

  const { ticker, date } = AppState.currentMeta;
  const company  = extractCompanyName(ticker, AppState.reports.market_report);
  const synopsis = extractSynthesis(fullText);
  const levels   = extractKeyLevels(fullText);

  const heroClass = signal.replace(/\s+/g, '-');   // e.g. "OVERWEIGHT" → "OVERWEIGHT"

  const card = document.createElement('div');
  card.id = 'hero-card';
  card.className = `hero-card story-card hero-${heroClass}`;

  card.innerHTML = `
    <div class="hero-signal-badge signal-${signal}">${signal}</div>
    <div class="hero-meta">
      <span class="hero-ticker">${ticker}</span>
      <span class="hero-date">${company !== ticker ? company + ' · ' : ''}${date}</span>
    </div>
    ${synopsis ? `<div class="hero-summary">${synopsis}</div>` : ''}
    ${levels    ? `<div class="hero-key-levels">${levels}</div>` : ''}
    <div class="hero-actions">
      <button id="pdf-btn"  class="export-btn export-btn-pdf">Download PDF</button>
      <button id="pptx-btn" class="export-btn export-btn-pptx">Generate PPT</button>
    </div>`;

  panels.insertBefore(card, panels.firstChild);
  panels.scrollTop = 0;

  document.getElementById('pdf-btn').addEventListener('click', downloadPDF);
  document.getElementById('pptx-btn').addEventListener('click', exportPPTX);
}
```

- [ ] **Step 2: Update `onDecision()` to store state and call `renderHeroCard()`**

Replace the existing `onDecision()`:

```javascript
function onDecision(event) {
  const { signal, full_text } = event;

  // Store for PPT/PDF export
  AppState.lastSignal = signal;
  AppState.lastDecisionText = full_text;

  // Update final panel
  const card = document.getElementById('panel-final');
  if (!card) return;

  card.innerHTML = `
    <div class="final-body">
      <div class="signal-badge signal-${signal}">${signal}</div>
      <div class="final-text">${
        typeof marked !== 'undefined'
          ? marked.parse(full_text)
          : full_text.replace(/\n/g, '<br>')
      }</div>
    </div>`;

  card.classList.remove('pending', 'active');
  card.classList.add('done');

  // Render hero card at top of story panels
  renderHeroCard(signal, full_text);

  appendSystemFeed(`Decision: ${signal}`);
}
```

- [ ] **Step 3: Add placeholder functions for PDF and PPT (implemented in Tasks 8 & 9)**

Add immediately after `renderHeroCard`:

```javascript
function downloadPDF() { /* implemented in Task 8 */ }
function exportPPTX()  { /* implemented in Task 9 */ }
```

- [ ] **Step 4: Manual test**

Run a full analysis. When the final decision fires, a hero card should appear at the TOP of the right panel showing the signal badge, ticker, company name, a synopsis paragraph, key price levels (if found), and two export buttons. The card border should glow in signal color (green=BUY, red=SELL, amber=HOLD).

- [ ] **Step 5: Commit**

```bash
git add web/static/app.js
git commit -m "feat: summary hero card with signal, synopsis, and export buttons"
```

---

## Task 8: PDF Export

**Files:**
- Modify: `web/static/app.js` (`downloadPDF()`)

**Interfaces:**
- Consumes: all `.story-card` elements in `#story-panels`
- Produces: `window.print()` after opening all non-pending story cards

- [ ] **Step 1: Implement `downloadPDF()`**

Replace the placeholder:

```javascript
function downloadPDF() {
  // Open all completed/active story cards so their content prints
  document.querySelectorAll('#story-panels .story-card').forEach(card => {
    if (!card.classList.contains('pending') && !card.classList.contains('hidden')) {
      card.classList.add('open');
    }
  });
  window.print();
}
```

- [ ] **Step 2: Manual test**

After a completed analysis, click "Download PDF". The browser print dialog should open. The preview should show only the report content (sidebar and feed hidden), with the hero card first and each agent report on its own page. Save as PDF and verify it opens cleanly.

- [ ] **Step 3: Commit**

```bash
git add web/static/app.js
git commit -m "feat: PDF export via browser print with print-safe CSS"
```

---

## Task 9: PPT Generation Backend

**Files:**
- Create: `web/export_pptx.py`
- Modify: `web/server.py` (add endpoint + model)
- Create: `tests/web/test_export_pptx.py`

**Interfaces:**
- Produces: `generate_pptx(data: dict) -> bytes` — returns binary PPTX content
- `data` keys: `ticker` (str), `date` (str), `signal` (str), `reports` (dict), `debate` (dict), `decision_text` (str)

- [ ] **Step 1: Install dependencies**

```bash
pip install python-pptx matplotlib
```

Verify:
```bash
python -c "from pptx import Presentation; import matplotlib; print('OK')"
```
Expected output: `OK`

- [ ] **Step 2: Write the failing test first**

Create `tests/web/test_export_pptx.py`:

```python
import pytest
from pptx import Presentation
import io

SAMPLE_DATA = {
    "ticker": "AAPL",
    "date": "2026-06-20",
    "signal": "BUY",
    "reports": {
        "market_report": (
            "AAPL (Apple Inc.) — Technical Analysis\n"
            "## Executive Summary\n"
            "Apple is in a strong uptrend. Price above all major MAs.\n"
            "- Close (Jun 20): $200.00\n- 10 EMA: $195.00\n- 50 SMA: $185.00\n- 200 SMA: $160.00\n"
            "## Trend Analysis\n- Bullish above all MAs\n- RSI at 62 (not overbought)\n"
        ),
        "sentiment_report": (
            "**Overall Sentiment:** Bullish (Score: 7.5/10)\n"
            "**Confidence:** High\n- Strong retail interest\n- Institutional accumulation\n"
        ),
        "news_report": (
            "Top news:\n- Apple AI features driving upgrade cycle\n"
            "- Services revenue record high\n- China sales recovering\n"
        ),
        "fundamentals_report": (
            "P/E: 28x  Revenue: $400B  Net Margin: 26%\n"
            "EPS growth: 12% YoY  Debt/Equity: 1.8\n"
        ),
        "investment_plan": "Bull case: AI supercycle\nBear case: valuation stretched\n",
        "trader_investment_plan": "BUY 100 shares at $200, stop $185, target $225\n",
    },
    "debate": {
        "investment": {
            "Bull Researcher": "Strong AI momentum",
            "Bear Researcher": "Valuation risk",
            "Research Manager": "Lean bullish",
        },
        "risk": {
            "Aggressive Analyst": "Full position",
            "Conservative Analyst": "Half position",
            "Portfolio Manager": "75% position, BUY",
        },
    },
    "decision_text": (
        "BUY Apple at $200 with support at $185 and resistance at $225. "
        "AI-driven growth justifies premium valuation. Risk: macro headwinds."
    ),
}


def test_generate_pptx_returns_bytes():
    from web.export_pptx import generate_pptx
    result = generate_pptx(SAMPLE_DATA)
    assert isinstance(result, bytes)
    assert len(result) > 1000


def test_generate_pptx_valid_pptx():
    from web.export_pptx import generate_pptx
    result = generate_pptx(SAMPLE_DATA)
    prs = Presentation(io.BytesIO(result))
    assert len(prs.slides) == 9


def test_generate_pptx_sell_signal():
    from web.export_pptx import generate_pptx
    data = {**SAMPLE_DATA, "signal": "SELL"}
    result = generate_pptx(data)
    prs = Presentation(io.BytesIO(result))
    assert len(prs.slides) == 9
```

Run test — expect FAIL (module doesn't exist yet):
```bash
pytest tests/web/test_export_pptx.py -v
```
Expected: `ImportError: No module named 'web.export_pptx'`

- [ ] **Step 3: Create `web/export_pptx.py`**

```python
"""PPT generation for trading analysis reports.

Generates a 9-slide PPTX deck from a dict of markdown report sections.
Slide order: Cover, Executive Summary, Fundamentals, News,
             Sentiment, Technical, Research Debate, Risk, Final Decision.
"""
import io
import re

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt, Emu

# ── palette ───────────────────────────────────────────────────────────────
_BG    = RGBColor(0x0F, 0x17, 0x2A)
_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
_MUTED = RGBColor(0x94, 0xA3, 0xB8)
_BUY   = RGBColor(0x10, 0xB9, 0x81)
_SELL  = RGBColor(0xEF, 0x44, 0x44)
_HOLD  = RGBColor(0xF5, 0x9E, 0x0B)

_SLIDE_W = Inches(13.333)
_SLIDE_H = Inches(7.5)


def _signal_color(signal: str) -> RGBColor:
    s = signal.upper()
    if s in ("BUY", "OVERWEIGHT"):  return _BUY
    if s in ("SELL", "UNDERWEIGHT"): return _SELL
    return _HOLD


def _hex_signal(signal: str) -> str:
    s = signal.upper()
    if s in ("BUY", "OVERWEIGHT"):   return "#10B981"
    if s in ("SELL", "UNDERWEIGHT"): return "#EF4444"
    return "#F59E0B"


def _set_bg(slide):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = _BG


def _add_text(slide, text, left, top, width, height,
              size=18, bold=False, color=None, align=PP_ALIGN.LEFT, wrap=True):
    txb = slide.shapes.add_textbox(left, top, width, height)
    txb.word_wrap = wrap
    tf = txb.text_frame
    tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color or _WHITE


def _extract_bullets(text: str, max_bullets: int = 5) -> list[str]:
    """Return up to max_bullets plain bullet strings from markdown text."""
    bullets = []
    for raw in text.split('\n'):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#'):
            continue
        # strip markdown bold/italic
        line = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', line)
        line = re.sub(r'`([^`]+)`', r'\1', line)
        if line.startswith(('- ', '* ', '• ')):
            bullets.append(line[2:].strip())
        elif len(bullets) == 0 and len(line) > 25:
            # Use first substantive sentence if no bullets
            sentences = re.split(r'(?<=[.!?])\s+', line)
            bullets.extend(s for s in sentences[:2] if len(s) > 10)
        if len(bullets) >= max_bullets:
            break
    return bullets[:max_bullets]


def _add_bullets(slide, items: list[str], left, top, width, height,
                 size=14, color=None):
    txb = slide.shapes.add_textbox(left, top, width, height)
    txb.word_wrap = True
    tf = txb.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        run = p.add_run()
        run.text = f"• {item}"
        run.font.size = Pt(size)
        run.font.color.rgb = color or _WHITE


def _extract_score(text: str, pattern: str = r'(\d+(?:\.\d+)?)\s*/\s*10') -> float | None:
    m = re.search(pattern, text)
    return float(m.group(1)) if m else None


def _extract_kv_table(text: str) -> list[tuple[str, str]]:
    """Extract 'Key: Value' pairs from text for fundamentals table."""
    rows = []
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        # match "P/E: 28x" or "P/E Ratio  28x"
        m = re.match(r'^([A-Za-z/\s]+?)\s*[:\t]\s*(.+)$', line)
        if m:
            key = m.group(1).strip()[:30]
            val = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', m.group(2).strip())[:40]
            rows.append((key, val))
        if len(rows) >= 8:
            break
    return rows


def _make_sentiment_gauge(score: float) -> bytes:
    """Return PNG bytes of a half-circle gauge for score 0–10."""
    fig, ax = plt.subplots(figsize=(4, 2.2), facecolor='#0F172A')
    ax.set_facecolor('#0F172A')
    ax.set_xlim(-1.3, 1.3)
    ax.set_ylim(-0.3, 1.3)
    ax.set_aspect('equal')
    ax.axis('off')

    # background arc
    theta = np.linspace(np.pi, 0, 200)
    ax.plot(np.cos(theta), np.sin(theta), color='#1E293B', linewidth=12)

    # colored arc up to score
    frac = max(0, min(score / 10, 1))
    theta_fill = np.linspace(np.pi, np.pi - frac * np.pi, 200)
    color = '#EF4444' if score < 4 else ('#F59E0B' if score < 7 else '#10B981')
    ax.plot(np.cos(theta_fill), np.sin(theta_fill), color=color, linewidth=12)

    # needle
    angle = np.pi - frac * np.pi
    ax.annotate('', xy=(0.75 * np.cos(angle), 0.75 * np.sin(angle)),
                xytext=(0, 0),
                arrowprops=dict(arrowstyle='->', color='white', lw=2))

    ax.text(0, -0.2, f'{score:.1f} / 10', ha='center', va='center',
            fontsize=14, color='white', fontweight='bold')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=120,
                facecolor='#0F172A')
    plt.close(fig)
    return buf.getvalue()


def _make_risk_bar(text: str) -> bytes:
    """Return PNG bytes of a risk level bar extracted from report text."""
    t = text.lower()
    if 'high risk' in t or 'elevated risk' in t:
        level, val, color = 'HIGH', 3, '#EF4444'
    elif 'medium risk' in t or 'moderate risk' in t:
        level, val, color = 'MEDIUM', 2, '#F59E0B'
    else:
        level, val, color = 'LOW', 1, '#10B981'

    fig, ax = plt.subplots(figsize=(5, 1.4), facecolor='#0F172A')
    ax.set_facecolor('#0F172A')
    ax.axis('off')

    labels = ['LOW', 'MEDIUM', 'HIGH']
    colors = ['#10B981', '#F59E0B', '#EF4444']
    for i, (lbl, c) in enumerate(zip(labels, colors)):
        alpha = 1.0 if lbl == level else 0.25
        ax.barh(0, 1, left=i * 1.2, height=0.6,
                color=c, alpha=alpha)
        ax.text(i * 1.2 + 0.5, 0, lbl, ha='center', va='center',
                color='white', fontsize=11, fontweight='bold')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=120,
                facecolor='#0F172A')
    plt.close(fig)
    return buf.getvalue()


def _make_price_bar(text: str) -> bytes:
    """Extract current price vs MAs from text and produce a bar chart."""
    patterns = {
        'Close': r'close[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
        '10 EMA': r'10\s*ema[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
        '50 SMA': r'50\s*sma[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
        '200 SMA': r'200\s*sma[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
    }
    vals = {}
    for label, pat in patterns.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                vals[label] = float(m.group(1).replace(',', ''))
            except ValueError:
                pass

    if not vals:
        return None

    fig, ax = plt.subplots(figsize=(5, 2.8), facecolor='#0F172A')
    ax.set_facecolor('#1E293B')
    labels = list(vals.keys())
    values = list(vals.values())
    close = vals.get('Close', values[0])
    bar_colors = ['#3B82F6' if v <= close else '#94A3B8' for v in values]
    if 'Close' in vals:
        bar_colors[labels.index('Close')] = '#10B981'

    ax.barh(labels, values, color=bar_colors)
    for i, v in enumerate(values):
        ax.text(v, i, f' {v:,.2f}', va='center', color='white', fontsize=9)
    ax.set_xlabel('Price', color='#94A3B8', fontsize=9)
    ax.tick_params(colors='#94A3B8')
    ax.spines[:].set_color('#1E293B')
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.xaxis.set_tick_params(labelcolor='#94A3B8')
    ax.yaxis.set_tick_params(labelcolor='white')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=120,
                facecolor='#0F172A')
    plt.close(fig)
    return buf.getvalue()


def _add_chart_image(slide, png_bytes: bytes, left, top, width, height):
    if not png_bytes:
        return
    img_stream = io.BytesIO(png_bytes)
    slide.shapes.add_picture(img_stream, left, top, width, height)


# ── slide builders ────────────────────────────────────────────────────────

def _slide_cover(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    _set_bg(slide)
    sig    = data['signal']
    col    = _signal_color(sig)
    ticker = data['ticker']
    date   = data.get('date', '')

    # Large signal badge (rectangle)
    left, top = Inches(1), Inches(1.8)
    shp = slide.shapes.add_shape(1, left, top, Inches(3), Inches(1.1))
    shp.fill.solid()
    shp.fill.fore_color.rgb = col
    shp.line.color.rgb = col
    tf = shp.text_frame
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    run = tf.paragraphs[0].add_run()
    run.text = sig
    run.font.size = Pt(36)
    run.font.bold = True
    run.font.color.rgb = _WHITE

    _add_text(slide, ticker, Inches(1), Inches(3.3), Inches(6), Inches(1),
              size=40, bold=True)
    company = _extract_company_name(ticker, data.get('reports', {}).get('market_report', ''))
    if company != ticker:
        _add_text(slide, company, Inches(1), Inches(4.1), Inches(8), Inches(0.7),
                  size=20, color=_MUTED)
    _add_text(slide, f"Analysis Date: {date}", Inches(1), Inches(4.8),
              Inches(6), Inches(0.5), size=14, color=_MUTED)
    _add_text(slide, "AI-Powered Multi-Agent Stock Analysis",
              Inches(1), Inches(6.4), Inches(8), Inches(0.6), size=12, color=_MUTED)


def _slide_exec_summary(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Executive Summary", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)

    market = data.get('reports', {}).get('market_report', '')
    bullets = _extract_bullets(market, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7), Inches(5))

    png = _make_price_bar(market)
    if png:
        _add_chart_image(slide, png, Inches(8), Inches(1.2), Inches(4.8), Inches(3))


def _slide_fundamentals(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Fundamentals", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)

    text = data.get('reports', {}).get('fundamentals_report', '')
    rows = _extract_kv_table(text)

    if rows:
        tbl = slide.shapes.add_table(len(rows) + 1, 2,
                                      Inches(0.5), Inches(1.2),
                                      Inches(5), Inches(min(len(rows) * 0.45 + 0.5, 5.5))).table
        for ci, header in enumerate(('Metric', 'Value')):
            cell = tbl.cell(0, ci)
            cell.text = header
            cell.text_frame.paragraphs[0].runs[0].font.bold = True
            cell.text_frame.paragraphs[0].runs[0].font.size = Pt(11)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(0x1E, 0x29, 0x3B)
        for ri, (k, v) in enumerate(rows):
            for ci, val in enumerate((k, v)):
                cell = tbl.cell(ri + 1, ci)
                cell.text = val
                cell.text_frame.paragraphs[0].runs[0].font.size = Pt(10)
                cell.text_frame.paragraphs[0].runs[0].font.color.rgb = _WHITE
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor(0x0F, 0x17, 0x2A) if ri % 2 == 0 \
                                           else RGBColor(0x1A, 0x23, 0x3A)
    else:
        bullets = _extract_bullets(text, max_bullets=7)
        _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(12), Inches(5.5))


def _slide_news(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "News Analysis", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)
    text = data.get('reports', {}).get('news_report', '')
    bullets = _extract_bullets(text, max_bullets=6)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(12), Inches(5.5))


def _slide_sentiment(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Sentiment Analysis", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)
    text = data.get('reports', {}).get('sentiment_report', '')
    bullets = _extract_bullets(text, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7.5), Inches(4))

    score = _extract_score(text)
    if score is not None:
        png = _make_sentiment_gauge(score)
        _add_chart_image(slide, png, Inches(8.5), Inches(1.5), Inches(4.3), Inches(2.5))


def _slide_technical(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Technical Analysis", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)
    text = data.get('reports', {}).get('market_report', '')
    bullets = _extract_bullets(text, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7.5), Inches(4))

    png = _make_price_bar(text)
    if png:
        _add_chart_image(slide, png, Inches(8), Inches(1.2), Inches(4.8), Inches(3))


def _slide_research_debate(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Research Debate", Inches(0.5), Inches(0.3),
              Inches(12), Inches(0.7), size=24, bold=True)

    invest = data.get('debate', {}).get('investment', {})
    # Bull column
    _add_text(slide, "🐂 Bull Case", Inches(0.5), Inches(1.1),
              Inches(5.5), Inches(0.5), size=14, bold=True, color=_BUY)
    bull_text = invest.get('Bull Researcher', '')
    _add_bullets(slide, _extract_bullets(bull_text, 4),
                 Inches(0.5), Inches(1.7), Inches(5.5), Inches(4.5), size=12)

    # Bear column
    _add_text(slide, "🐻 Bear Case", Inches(7), Inches(1.1),
              Inches(5.5), Inches(0.5), size=14, bold=True, color=_SELL)
    bear_text = invest.get('Bear Researcher', '')
    _add_bullets(slide, _extract_bullets(bear_text, 4),
                 Inches(7), Inches(1.7), Inches(5.5), Inches(4.5), size=12)

    # Divider line
    slide.shapes.add_connector(1, Inches(6.4), Inches(1.1), Inches(6.4), Inches(6.5))

    # Judgment
    judge = invest.get('Research Manager', '')
    if judge:
        _add_text(slide, "Research Manager: " + _extract_bullets(judge, 1)[0] if _extract_bullets(judge, 1) else '',
                  Inches(0.5), Inches(6.2), Inches(12), Inches(0.8), size=12, color=_MUTED)


def _slide_risk(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Risk Assessment", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)

    risk = data.get('debate', {}).get('risk', {})
    pm_text = risk.get('Portfolio Manager', '')
    bullets = _extract_bullets(pm_text or data.get('decision_text', ''), max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7.5), Inches(4))

    decision_text = data.get('decision_text', '')
    png = _make_risk_bar(decision_text + ' ' + pm_text)
    if png:
        _add_chart_image(slide, png, Inches(8), Inches(1.5), Inches(4.8), Inches(1.8))


def _slide_final(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    sig = data['signal']
    col = _signal_color(sig)

    # Large signal
    shp = slide.shapes.add_shape(1, Inches(4.5), Inches(0.5), Inches(4.3), Inches(1.4))
    shp.fill.solid()
    shp.fill.fore_color.rgb = col
    shp.line.color.rgb = col
    tf = shp.text_frame
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    run = tf.paragraphs[0].add_run()
    run.text = sig
    run.font.size = Pt(44)
    run.font.bold = True
    run.font.color.rgb = _WHITE

    _add_text(slide, f"Final Decision: {data['ticker']}", Inches(0.5), Inches(2.1),
              Inches(12), Inches(0.7), size=20, bold=True)

    dec_text = data.get('decision_text', '')
    bullets = _extract_bullets(dec_text, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(3.0), Inches(12), Inches(3.2), size=14)

    _add_text(slide, "This report is for informational purposes only and does not constitute investment advice.",
              Inches(0.5), Inches(6.9), Inches(12), Inches(0.5),
              size=9, color=_MUTED)


def _extract_company_name(ticker: str, market_report: str) -> str:
    if not market_report:
        return ticker
    escaped = re.escape(ticker)
    m = re.search(rf'{escaped}\s*\(([^)]+)\)', market_report)
    return m.group(1).strip() if m else ticker


# ── public API ────────────────────────────────────────────────────────────

def generate_pptx(data: dict) -> bytes:
    """Build a 9-slide PPTX and return the raw bytes.

    Slide order: Cover, Executive Summary, Fundamentals, News,
                 Sentiment, Technical, Research Debate, Risk, Final Decision.
    """
    prs = Presentation()
    prs.slide_width  = _SLIDE_W
    prs.slide_height = _SLIDE_H

    _slide_cover(prs, data)
    _slide_exec_summary(prs, data)
    _slide_fundamentals(prs, data)
    _slide_news(prs, data)
    _slide_sentiment(prs, data)
    _slide_technical(prs, data)
    _slide_research_debate(prs, data)
    _slide_risk(prs, data)
    _slide_final(prs, data)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pytest tests/web/test_export_pptx.py -v
```
Expected:
```
tests/web/test_export_pptx.py::test_generate_pptx_returns_bytes PASSED
tests/web/test_export_pptx.py::test_generate_pptx_valid_pptx PASSED
tests/web/test_export_pptx.py::test_generate_pptx_sell_signal PASSED
```

- [ ] **Step 5: Add `POST /api/export/pptx` to `web/server.py`**

Add the `ExportRequest` model and the endpoint. Insert after the `@app.get("/api/providers")` block (after line ~122):

```python
# ── PPT export ────────────────────────────────────────────────────────────
class ExportRequest(BaseModel):
    ticker: str
    date: str
    signal: str
    reports: dict = {}
    debate: dict = {}
    decision_text: str = ""


@app.post("/api/export/pptx")
def export_pptx(req: ExportRequest):
    from fastapi.responses import Response as _Response
    from web.export_pptx import generate_pptx

    data = {
        "ticker":        req.ticker,
        "date":          req.date,
        "signal":        req.signal,
        "reports":       req.reports,
        "debate":        req.debate,
        "decision_text": req.decision_text,
    }
    pptx_bytes = generate_pptx(data)
    filename = f"{req.ticker}-{req.date}-analysis.pptx"
    return _Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

Also add `/api/export/pptx` to the `_PROTECTED` tuple so it requires auth:

```python
_PROTECTED = ("/api/analyze", "/api/stream/", "/api/sessions",
              "/api/logout", "/api/export/pptx")
```

- [ ] **Step 6: Smoke-test the endpoint manually**

Start the server, then run:
```bash
curl -X POST http://localhost:8000/api/export/pptx \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","date":"2026-06-20","signal":"BUY","reports":{},"debate":{},"decision_text":""}' \
  --output test_out.pptx
```
Expected: `test_out.pptx` created, `file test_out.pptx` reports a ZIP/PPTX file.

- [ ] **Step 7: Commit**

```bash
git add web/export_pptx.py web/server.py tests/web/test_export_pptx.py
git commit -m "feat: PPT generation backend — 9-slide deck from analysis report"
```

---

## Task 10: PPT Export Frontend

**Files:**
- Modify: `web/static/app.js` (`exportPPTX()` function)

**Interfaces:**
- Consumes: `AppState.reports`, `AppState.debateData`, `AppState.lastSignal`, `AppState.lastDecisionText`, `AppState.currentMeta`
- Produces: triggers browser download of `<ticker>-<date>-analysis.pptx`

- [ ] **Step 1: Replace `exportPPTX()` placeholder with real implementation**

```javascript
async function exportPPTX() {
  const btn = document.getElementById('pptx-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Generating PPT…';

  const payload = {
    ticker:        AppState.currentMeta.ticker || '',
    date:          AppState.currentMeta.date   || '',
    signal:        AppState.lastSignal         || 'HOLD',
    reports:       AppState.reports,
    debate:        AppState.debateData,
    decision_text: AppState.lastDecisionText   || '',
  };

  try {
    const r = await fetch('/api/export/pptx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.detail || 'Export failed');
    }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${payload.ticker}-${payload.date}-analysis.pptx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`PPT generation failed: ${e.message}`);
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Generate PPT';
  }
}
```

- [ ] **Step 2: Bump cache version in `index.html`**

In `web/static/index.html`, update the CSS and JS references:

```html
<link rel="stylesheet" href="/static/style.css?v=9" />
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js" defer></script>
<script src="/static/app.js?v=9" defer></script>
```

- [ ] **Step 3: End-to-end manual test**

1. Start the server and run a full analysis to completion.
2. Verify the hero card appears with signal badge, synopsis, and two export buttons.
3. Click "Generate PPT" — browser should prompt to download `<ticker>-<date>-analysis.pptx`.
4. Open the PPTX in PowerPoint or LibreOffice. Verify:
   - 9 slides present
   - Slide 1: cover with ticker and signal badge
   - Slide 2: executive summary with price bar chart
   - Slide 5: sentiment slide with gauge
   - Slide 8: risk slide with risk bar
   - Slide 9: final decision with large signal text
   - Dark navy background throughout

- [ ] **Step 4: Commit**

```bash
git add web/static/app.js web/static/index.html
git commit -m "feat: PPT export frontend — collect report state and trigger download"
```

---

## Completion Checklist

- [ ] All 5 team blocks show distinct colored borders + tinted backgrounds in sidebar
- [ ] Agent dots pulse/fill in team color (not generic green/indigo)
- [ ] Live feed newest items appear at top
- [ ] Clicking each sidebar team block scrolls to its report card
- [ ] Each report card header has a 4px left border in matching team color
- [ ] Header shows `N / 5  ████░░░░  ● Team Name` updating live
- [ ] Hero card appears at top of right panel after final decision
- [ ] Hero card border glows in signal color (green/red/amber)
- [ ] "Download PDF" opens print dialog with clean report-only layout
- [ ] "Generate PPT" downloads a 9-slide PPTX in dark navy theme
- [ ] All 3 PPT tests pass: `pytest tests/web/test_export_pptx.py -v`
