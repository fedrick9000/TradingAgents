# TradingAgents Web UI

Single-page live analysis dashboard. Streams the multi-agent workflow in real time.

## Setup

```bash
pip install fastapi uvicorn
```

Set your LLM provider API key in the environment:
```bash
export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY, GOOGLE_API_KEY, etc.
```

## Start

```bash
uvicorn web.server:app --reload --port 8000
```

Open `http://localhost:8000`.

## Architecture

```
web/
├── server.py     FastAPI — routes, session store, SSE endpoint, LangGraph thread
├── analysis.py   AnalysisState — converts LangGraph chunks to SSE events
└── static/
    ├── index.html  Single-page app (idle / running / complete states)
    ├── style.css   Responsive dark theme
    └── app.js      SSE client, pipeline strip, feed, debate panels, session replay
```

## Stability

`web/analysis.py` reads LangGraph chunk keys directly. Semi-stable keys
(`investment_debate_state`, `risk_debate_state`, `investment_plan`) are
accessed with `.get()` — missing keys produce empty content, not crashes.
See `docs/superpowers/specs/2026-06-19-trading-agent-web-ui-design.md §7`
for the full stability boundary table.
