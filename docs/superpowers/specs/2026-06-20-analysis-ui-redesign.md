# Analysis Page UI Redesign — Design Spec
**Date:** 2026-06-20  
**Status:** Approved  
**Scope:** 6 UI/UX changes to the live analysis running-view (`web/static/index.html`, `web/static/app.js`, `web/static/style.css`, `web/analysis.py`)

---

## Overview

Six targeted changes to the analysis running-view to improve readability, usability, and post-analysis output (PDF and PPT export for retail investor clients).

---

## Change 1 — Agent Panel Colors & Readability

**Files:** `style.css`, `app.js` (`buildPipelineStrip()`)

Each team block in the left sidebar gets a distinct color tied to its role:

| Team | Color | Hex |
|---|---|---|
| Analyst Team | Blue | `#3B82F6` |
| Research Team | Purple | `#8B5CF6` |
| Trading Team | Green | `#10B981` |
| Risk Management | Red | `#EF4444` |
| Portfolio Management | Amber | `#F59E0B` |

**Visual treatment per team block:**
- `border-left: 4px solid <team-color>` — primary color signal
- `background: rgba(<team-color-rgb>, 0.12)` — subtle tint, does not overwhelm dark sidebar
- Small colored square prefix (`■`) before the team name label
- Team name text: white, bold — unchanged, already readable
- Individual agent status dots: use team color when `in_progress`, white when `pending`, filled solid when `completed`

**Implementation:** `buildPipelineStrip()` in `app.js` maps team name → color constant. CSS classes `team-analyst`, `team-research`, `team-trading`, `team-risk`, `team-portfolio` applied to each block.

---

## Change 2 — Progress Log Reversed (Latest on Top)

**File:** `app.js` (`appendFeedRow()`)

New feed entries are **prepended** to the top of `#live-feed` using `insertBefore(newRow, feed.firstChild)` instead of `appendChild`. This ensures the most recent event is always visible without scrolling.

CSS `column-reverse` is explicitly avoided — it causes scroll-jump artifacts when the container overflows.

---

## Change 3 — Click Agent → Navigate to Report

**Files:** `app.js`, `style.css`

- Each team block in the left sidebar becomes clickable (`cursor: pointer`, hover highlight)
- Click handler calls `scrollIntoView({ behavior: 'smooth' })` targeting the corresponding report card in the right panel
- Each agent's report card gets a `data-team="analyst"` (etc.) attribute for targeting
- Report card headers receive:
  - `border-left: 4px solid <team-color>` — matches left panel accent
  - `background: rgba(<team-color-rgb>, 0.08)` — very subtle tint on header row only
  - Header text color unchanged (dark, readable) — color accent is structural, not on text

**Scroll target mapping:**
- Analyst Team → Market Analyst report card
- Research Team → Research Debate card
- Trading Team → Trader investment plan card
- Risk Management → Risk Deliberation card
- Portfolio Management → Final Decision card

---

## Change 4 — Overall Progress in Header

**Files:** `index.html`, `app.js`, `style.css`

A progress indicator is inserted in the header bar, **left of the elapsed timer**:

```
3 / 5  ████████░░░░  ● Risk Management
```

**Components:**
- **Fraction** — `<span id="progress-fraction">0 / 5</span>`
- **Progress bar** — `<div class="progress-bar"><div class="progress-fill"></div></div>` — width set via inline style as percentage
- **Active agent label** — `<span id="progress-active-agent">● Analyst Team</span>` — shows the currently `in_progress` team name; updates on each `agent_status` event
- Bar color: matches the active team's color while running; turns solid `#10B981` (green) when all 5 complete
- Active agent label disappears when all agents are done

**Logic:** `agent_status` events increment a `completedTeams` counter. Fraction and bar width update on every status change.

---

## Change 5 — Export: PDF & PPT

Buttons appear inside the **Summary Hero Card** (Change 6) after the final decision arrives. They are hidden during analysis.

### PDF Export

- **Mechanism:** `window.print()` triggered by "Download PDF" button
- **Print CSS** added to `style.css` under `@media print`:
  - Hide: sidebar, header, live feed panel, export buttons, auth overlay
  - Show only: right panel (report area)
  - Page breaks: `page-break-before: always` before each agent report card
  - Summary Hero Card prints first — acts as cover page
- No new backend dependencies

### PPT Export

- **New endpoint:** `POST /api/export/pptx` in `web/server.py` (or equivalent Flask/FastAPI entry)
- **Request body:** JSON containing all report sections (already held in frontend state from SSE stream)
- **Response:** binary `.pptx` file, `Content-Disposition: attachment; filename="<ticker>-analysis.pptx"`
- **New Python dependencies:** `python-pptx`, `matplotlib`

**Slide structure (9 slides):**

| # | Slide | Content | Chart |
|---|---|---|---|
| 1 | Cover | Ticker, company name, analysis date, BUY/SELL/HOLD badge | — |
| 2 | Executive Summary | 4–5 key bullets from executive summary | Price vs 10/50/200 MA mini-chart |
| 3 | Fundamentals | Key metrics (P/E, revenue, margin, etc.) | Metrics table |
| 4 | News Analysis | Top 3–5 headlines with sentiment tag | — |
| 5 | Sentiment Analysis | Sentiment bullets, score, confidence | Needle gauge (score/10) |
| 6 | Technical Analysis | Trend bullets, key indicator readings | Price line chart with MA overlays |
| 7 | Research Debate | Bull vs Bear 2-column summary | — |
| 8 | Risk Assessment | Key risks, risk level | Horizontal risk bar (Low/Med/High) |
| 9 | Final Decision | BUY/SELL/HOLD (large), price targets, rationale, disclaimer | — |

**Design theme:**
- Background: `#0F172A` (dark navy — matches trading agent UI)
- Accent: signal color (BUY=`#10B981`, SELL=`#EF4444`, HOLD=`#F59E0B`)
- Body text: white / light grey
- Charts: white lines on dark background, matplotlib dark style
- Audience: retail investors — max 5 bullets per slide, charts large and labelled

---

## Change 6 — Summary Hero Card (Top of Right Panel)

**Files:** `app.js`, `style.css`

When the `decision` SSE event arrives (analysis complete), a **hero card is prepended** to the top of the right panel, above all agent report cards.

**Card layout:**
```
┌────────────────────────────────────────────────────────┐
│  [HOLD]  (large pill badge, signal color)              │
│                                                        │
│  0700.HK — Tencent Holdings Limited                   │
│  Analysis Date: June 19, 2026                         │
│                                                        │
│  [Synthesis paragraph — 2–3 sentences from final      │
│   decision rationale]                                  │
│                                                        │
│  Key levels:  Support HKD 420 · Resistance HKD 460    │
  (extracted from final decision payload's price targets) │
│                                                        │
│  [ Download PDF ]     [ Generate PPT ]                 │
└────────────────────────────────────────────────────────┘
```

**Signal color mapping:**
- `BUY` / `OVERWEIGHT` → green (`#10B981`) border + badge
- `SELL` / `UNDERWEIGHT` → red (`#EF4444`) border + badge
- `HOLD` / `NEUTRAL` → amber (`#F59E0B`) border + badge

**Card border:** `2px solid <signal-color>` with `box-shadow: 0 0 16px rgba(<signal-color>, 0.3)` glow effect.

Export buttons inside this card are the only entry points for PDF and PPT export. They are not shown anywhere else.

---

## Files Changed

| File | Changes |
|---|---|
| `web/static/style.css` | Team color classes, progress bar styles, hero card styles, print CSS |
| `web/static/index.html` | Progress indicator in header markup |
| `web/static/app.js` | Color mapping, prepend feed, click-navigate, progress counter, hero card render, export button handlers |
| `web/server.py` (or equivalent) | New `POST /api/export/pptx` endpoint |
| `web/export_pptx.py` (new) | PPT generation logic using python-pptx + matplotlib |

---

## Out of Scope

- No changes to the idle/home view
- No changes to agent logic or SSE event structure
- No changes to existing report content or markdown rendering
