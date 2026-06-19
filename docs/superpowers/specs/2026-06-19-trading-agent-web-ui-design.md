# Trading Agent Web UI — Design Spec

**Date:** 2026-06-19  
**Status:** Approved — ready for implementation  
**Scope:** POC. Prove the core live-analysis flow before adding persistence, auth, or advanced features.

---

## 1. Goal

Build a single-page web UI that lets a user enter a stock ticker, watch the multi-agent analysis unfold in real time, and read each agent's reasoning — with special emphasis on the Bull/Bear/Judge debates and the Risk Management deliberation, which are TradingAgents' most distinctive outputs.

The final BUY/SELL/HOLD signal is a supporting fact, not the hero. The reasoning process is.

---

## 2. Architecture

### 2.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend | FastAPI + uvicorn | Already Python; SSE is native; one process |
| Frontend | Vanilla HTML/CSS/JS | No build step; POC scope |
| Streaming | Server-Sent Events (SSE) | Maps directly onto LangGraph's synchronous `.stream()` |
| Storage | In-memory dict (server process lifetime) | No database for POC |

### 2.2 New files

```
web/
├── server.py        # FastAPI app — API + static file serving
├── analysis.py      # AnalysisState + stream translation logic (standalone)
├── static/
│   ├── index.html
│   ├── style.css
│   └── app.js
```

No existing files are modified.

### 2.3 API surface

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serves `index.html` |
| `/static/*` | GET | CSS, JS |
| `/api/providers` | GET | Available providers + model lists |
| `/api/analyze` | POST | Start analysis; returns `{session_id}` |
| `/api/stream/{session_id}` | GET | SSE stream of events |
| `/api/sessions` | GET | Last 10–20 completed sessions (in-memory) |

### 2.4 Session lifecycle

```
POST /api/analyze
  → validate input (ticker, date, provider, model)
  → allocate session_id + AnalysisState
  → start threading.Thread(_run_stream, session_id, config)
  → return {session_id}

GET /api/stream/{session_id}
  → open SSE response (text/event-stream)
  → yield events from session queue until "done" or "error"

Thread: _run_stream(session_id, config)
  → instantiate TradingAgentsGraph(config)
  → call graph.graph.stream(init_state, **args)         ← direct LangGraph call
  → for each chunk: AnalysisState.ingest(chunk) → events → queue
  → put "done" event on queue
```

The background thread is a plain `threading.Thread` because `graph.stream()` is synchronous. The FastAPI SSE handler bridges to it via `asyncio.to_thread` or a `queue.Queue` polled with short `asyncio.sleep`.

### 2.5 Loose coupling from CLI

`web/analysis.py` is fully self-contained. It does **not** import anything from `cli/`. It reads LangGraph chunk keys directly. The logic mirrors the CLI's state-tracking conceptually but is written independently so CLI refactors don't break the server.

---

## 3. SSE Event Schema

All events are JSON sent as `data: <json>\n\n`. Every event carries a `ts` field (HH:MM:SS string).

```jsonc
// Agent changed status
{ "type": "agent_status", "agent": "Market Analyst", "team": "Analyst Team",
  "status": "pending|in_progress|completed|error", "ts": "12:01:05" }

// Live feed entry — tool calls are grouped under the active agent, not emitted individually
{ "type": "feed", "kind": "agent|tool_group|data|system",
  "agent": "Market Analyst",          // present when kind = tool_group
  "tools": ["get_stock_data", "get_indicators"],  // present when kind = tool_group
  "content": "...", "ts": "12:01:05" }

// Report section ready (analyst reports, trader plan)
{ "type": "report", "section": "market_report", "agent": "Market Analyst",
  "team": "Analyst Team", "content": "...", "ts": "12:02:10" }

// Debate round (Bull/Bear/Research Manager or Risk debate)
{ "type": "debate_round", "debate": "investment|risk",
  "speaker": "Bull Researcher|Bear Researcher|Research Manager|Aggressive Analyst|...",
  "content": "...", "round": 1, "ts": "12:03:00" }

// Final portfolio decision
{ "type": "decision", "signal": "BUY|SELL|HOLD|OVERWEIGHT|UNDERWEIGHT",
  "full_text": "...", "ts": "12:10:00" }

// Error
{ "type": "error", "message": "...", "ts": "12:01:00" }

// Analysis finished
{ "type": "done", "elapsed_seconds": 142, "ts": "12:10:01" }
```

---

## 4. State Tracking (web/analysis.py)

`AnalysisState` is the single source of truth for a running analysis. It:

- Tracks per-agent status (`pending` / `in_progress` / `completed`)
- Accumulates report content per section
- Buffers debate rounds with speaker + round index
- Collects tool calls per active agent (flushed as a `tool_group` feed event when the agent transitions away)
- Exposes an `asyncio.Queue` the SSE handler reads from

### Agent status transitions (derived from chunk keys)

| Chunk key present | Status effect |
|---|---|
| `market_report` | Market Analyst → completed; Sentiment Analyst → in_progress |
| `sentiment_report` | Sentiment Analyst → completed; News Analyst → in_progress |
| `news_report` | News Analyst → completed; Fundamentals Analyst → in_progress |
| `fundamentals_report` | Fundamentals Analyst → completed; Bull Researcher → in_progress |
| `investment_debate_state.bull_history` | Bull Researcher → in_progress |
| `investment_debate_state.bear_history` | Bear Researcher → in_progress |
| `investment_debate_state.judge_decision` | Research Manager → completed; Trader → in_progress |
| `trader_investment_plan` | Trader → completed; Aggressive Analyst → in_progress |
| `risk_debate_state.*_history` | Risk analysts → in_progress |
| `risk_debate_state.judge_decision` | Portfolio Manager → completed |

These transitions are approximations derived from report appearance in the stream. They are correct for the current graph topology but see Section 7 for stability caveats. When only a subset of analysts is selected, the transition chain skips the missing analysts — `AnalysisState` must be initialised with the selected analyst list to know which agents to expect.

---

## 5. UI Design

### 5.1 Three-act page structure

**Act 1 — Input (idle state)**  
Full-page centered card. Four visible controls only: ticker (large text input), date (defaults to today), provider selector, model selector. "Analyze" button below. A chevron reveals the Advanced panel: analyst selection, research depth (debate rounds), output language. No other controls.

Below the input card, a static "How It Works" section explains the multi-agent workflow at a glance. It shows the five-stage pipeline as a horizontal flow diagram (text-based, no images):

```
Analyst Team → Research Debate → Trader → Risk Debate → Portfolio Manager
   (data)        (bull vs bear)   (plan)   (risk views)   (final decision)
```

Each stage has a two-sentence description of what it does and why. This stays visible on the idle page so first-time users understand the system before they run it. It is hidden during the running and complete states to make room for the live workflow.

**Act 2 — Running state**  
Input collapses to a compact top bar (ticker · date · provider). Page body becomes the workflow stage:

```
┌────────────────────────────────────────────────────────────┐
│  PIPELINE STRIP — five team blocks, agent dots, left→right │
├──────────────────────────┬─────────────────────────────────┤
│  LIVE FEED  (40%)        │  STORY PANELS  (60%)            │
│  auto-scrolling events   │  Analyst reports (collapse)     │
│  tool calls grouped      │  Debate visualization           │
│  under their agent       │  Trader plan                    │
│                          │  Risk deliberation              │
│                          │  Final decision (placeholder)   │
└──────────────────────────┴─────────────────────────────────┘
```

**Act 3 — Complete state**  
The final decision panel expands to full-width at the top. Signal badge (BUY / SELL / HOLD) is large but secondary to the Portfolio Manager's reasoning text. Pipeline strip and story panels remain scrollable below.

### 5.2 Pipeline strip

Five team blocks arranged horizontally (vertically on mobile), each showing team name and a row of agent-status dots:
- Hollow grey circle = pending
- Pulsing spinner = in_progress  
- Filled green circle = completed
- Filled red circle = error

Teams: Analyst Team · Research Team · Trading Team · Risk Management · Portfolio Management

### 5.3 Live feed

Each row: `[HH:MM:SS]  [KIND badge]  content`

Kind colours: `system` grey · `agent` blue · `tool_group` amber · `data` slate

Tool calls are **not** shown as individual rows. When the active agent makes one or more tool calls, they are collected and shown as a single collapsed `tool_group` row: `get_stock_data, get_indicators (+1 more)`. Clicking expands the args. This keeps the feed readable.

Feed auto-scrolls to the newest entry. Fixed height, internally scrollable.

### 5.4 Story panels (right column)

Panels stack in pipeline order. Each starts collapsed with a "Waiting…" placeholder and expands in-place when content arrives. Markdown is rendered.

**Analyst reports** — one panel each: Market · Sentiment · News · Fundamentals

**Investment Debate panel** — the storytelling flow is: Research → Debate → Judgment, rendered as three visual zones stacked vertically:

1. **Research zone** — a single card showing the Research Manager's initial synthesis of analyst reports (populated from `investment_plan` field, which the Research Manager writes before the debate begins). Label: "Research Manager synthesises analyst findings."
2. **Debate zone** — two columns side by side: Bull (green left border) | Bear (red left border). Each debate round appends a message bubble to the appropriate column. A round counter ("Round 1 of 3") sits between them. Bubbles are collapsed to two lines by default; clicking expands.
3. **Judgment zone** — the Research Manager's final decision after all debate rounds, rendered as a distinct synthesis card below both columns. Label: "Research Manager judgment."

**Trader plan** — single panel, standard report card. Label: "Trader converts the research plan into a transaction proposal."

**Risk Deliberation panel** — same three-zone structure as the Investment Debate:

1. **Trader proposal zone** — recap of the trader's plan (one-line summary, links to the full Trader panel above).
2. **Debate zone** — three columns: Aggressive | Neutral | Conservative. Same bubble pattern, same round counter.
3. **Judgment zone** — Portfolio Manager's final synthesis card. Label: "Portfolio Manager weighs risk perspectives and delivers the decision."

**Final Decision panel** — starts as a placeholder. On `decision` event: expands full-width, signal badge rendered large, full Portfolio Manager text below.

### 5.5 Recent Analyses section

Below the main stage, a lightweight section: "Recent Analyses — last 10 sessions this session."

Each row: `NVDA · 2026-06-18 · BUY · anthropic/claude-sonnet-4-6 · 3m 12s`

Clicking a row re-renders all story panels with the stored snapshot (no re-running). Data lives in server memory only; clears on server restart. No database, no auth.

### 5.6 Responsiveness

| Breakpoint | Changes |
|---|---|
| ≥ 768px | Two-column layout (feed + story panels) |
| < 768px | Single column; pipeline strip becomes horizontal progress bar; feed above story panels |

---

## 6. Error Handling

| Failure | Behaviour |
|---|---|
| Invalid ticker / bad date | Form validation before submit; inline error message |
| Missing API key | `error` SSE event → red card in feed; form re-enabled |
| SSE connection drops mid-run | Banner: "Connection lost — results may be incomplete" + Retry button (re-opens SSE; background thread continues) |
| LangGraph exception | `error` event → red card in feed; analysis marked failed; form re-enabled |
| Provider rate limit | Surfaced via `error` event with provider message |

---

## 7. LangGraph Chunk Key Stability

This section documents which fields from `graph.graph.stream()` are considered stable contracts vs. TradingAgents implementation details.

### Stable — safe to depend on

These keys are part of the `AgentState` schema (`tradingagents/agents/utils/agent_states.py`) and are the primary outputs of each team. They are unlikely to be renamed without a major version change:

| Key | Type | Produced by |
|---|---|---|
| `messages` | `list[BaseMessage]` | Every node (LangGraph built-in) |
| `market_report` | `str` | Market Analyst |
| `sentiment_report` | `str` | Sentiment Analyst |
| `news_report` | `str` | News Analyst |
| `fundamentals_report` | `str` | Fundamentals Analyst |
| `trader_investment_plan` | `str` | Trader |
| `final_trade_decision` | `str` | Portfolio Manager |

### Semi-stable — implementation details, but central enough to track

These are nested dicts. Their top-level keys are unlikely to change, but sub-keys may evolve:

| Key | Sub-keys used | Risk |
|---|---|---|
| `investment_debate_state` | `bull_history`, `bear_history`, `judge_decision` | Sub-keys renamed if debate format changes |
| `risk_debate_state` | `aggressive_history`, `conservative_history`, `neutral_history`, `judge_decision` | Same risk |
| `investment_plan` | (full string) | Renamed or merged into `investment_debate_state` |

### Fragile — avoid depending on

| Item | Why fragile |
|---|---|
| Agent node name strings (e.g. `"Bull Researcher"`) | Used in graph edges; could be renamed |
| `messages[-1]` type ordering | CLI uses this; web layer should not assume message ordering within a chunk |
| Chunk-to-agent mapping (which node produced which chunk) | LangGraph streams per-node deltas; node names are not exposed in the chunk dict itself |

### UI components mapped to field stability

| UI Component | Fields it depends on | Stability | Breaks if… |
|---|---|---|---|
| Pipeline strip (agent dots) | `market_report`, `sentiment_report`, `news_report`, `fundamentals_report`, `trader_investment_plan`, `final_trade_decision` | **Stable** | A report field is renamed |
| Analyst report cards | Same six report fields above | **Stable** | A report field is renamed |
| Final Decision panel | `final_trade_decision` | **Stable** | Field renamed |
| Investment Debate — Research zone | `investment_plan` | **Semi-stable** | Field renamed or removed |
| Investment Debate — Bull/Bear bubbles | `investment_debate_state.bull_history`, `.bear_history` | **Semi-stable** | Sub-key renamed |
| Investment Debate — Judgment card | `investment_debate_state.judge_decision` | **Semi-stable** | Sub-key renamed |
| Risk Debate — debate bubbles | `risk_debate_state.aggressive_history`, `.conservative_history`, `.neutral_history` | **Semi-stable** | Sub-key renamed |
| Risk Debate — Portfolio judgment | `risk_debate_state.judge_decision` | **Semi-stable** | Sub-key renamed |
| Live feed (agent messages) | `messages` list, message types | **Stable** (LangGraph contract) | LangGraph message API changes |
| Live feed (tool groups) | `messages` tool_calls attribute | **Stable** (LangChain contract) | LangChain AIMessage API changes |

**Failure modes by dependency tier:**

- If only **stable** fields break → the entire UI is affected (all reports, pipeline strip, final decision). This indicates a major TradingAgents API version change.
- If only **semi-stable** fields break → the debate panels degrade gracefully to empty placeholders. Analyst reports, the live feed, and the final decision continue working normally.
- `web/analysis.py` should handle missing semi-stable keys without raising exceptions — treat absent sub-keys as empty strings and emit no `debate_round` events rather than crashing.

**Mitigation:** `web/analysis.py` derives agent status from *report content appearing* (stable keys), not from node names in the stream. If a semi-stable sub-key is renamed, only the debate visualization breaks — analyst reports and the final decision continue working.

---

## 8. Out of Scope (POC)

- User authentication
- Persistent database for sessions
- Analysis history across server restarts
- Multiple concurrent users beyond basic queue isolation
- Exporting / downloading reports
- Live price charts or external market data widgets
- Deployment configuration (Docker, cloud)

These are natural next steps after the POC is validated.

---

## 9. Start Command

```bash
cd "Trading Agent"
pip install fastapi uvicorn
uvicorn web.server:app --reload --port 8000
# Open http://localhost:8000
```
