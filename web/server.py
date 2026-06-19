import asyncio
import datetime
import os
import queue
import re
import secrets
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from web.analysis import AnalysisState

app = FastAPI(title="TradingAgents Web UI")

# ── auth ──────────────────────────────────────────────────────────────────
_ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "")
_auth_tokens: set[str] = set()


_PROTECTED = ("/api/analyze", "/api/stream/", "/api/sessions", "/api/logout")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if _ACCESS_PASSWORD and any(path.startswith(p) for p in _PROTECTED):
        token = request.cookies.get("ta_auth")
        if not token or token not in _auth_tokens:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


class AuthRequest(BaseModel):
    password: str


@app.post("/api/auth")
def login(req: AuthRequest, response: JSONResponse.__class__ = None):
    from fastapi.responses import JSONResponse as _JSONResponse
    if _ACCESS_PASSWORD and req.password != _ACCESS_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = secrets.token_hex(32)
    _auth_tokens.add(token)
    resp = _JSONResponse({"ok": True})
    resp.set_cookie(
        key="ta_auth",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,   # 30 days
    )
    return resp


@app.post("/api/logout")
def logout(request: Request):
    token = request.cookies.get("ta_auth")
    if token:
        _auth_tokens.discard(token)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("ta_auth")
    return resp

# ── static files ──────────────────────────────────────────────────────────
_STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC)), name="static")


@app.get("/")
def index():
    return FileResponse(str(_STATIC / "index.html"))


# ── provider catalogue ────────────────────────────────────────────────────
PROVIDERS: dict[str, dict] = {
    "deepseek": {
        "label": "DeepSeek",
        "deep_models":  ["deepseek-reasoner"],
        "quick_models": ["deepseek-chat"],
        "key_env": "DEEPSEEK_API_KEY",
        "available": True,
    },
    "anthropic": {
        "label": "Anthropic (coming soon)",
        "deep_models":  ["claude-opus-4-8", "claude-sonnet-4-6"],
        "quick_models": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
        "key_env": "ANTHROPIC_API_KEY",
        "available": False,
    },
    "openai": {
        "label": "OpenAI (coming soon)",
        "deep_models":  ["o3", "o4-mini", "gpt-4o"],
        "quick_models": ["gpt-4o-mini", "gpt-4o"],
        "key_env": "OPENAI_API_KEY",
        "available": False,
    },
    "google": {
        "label": "Google Gemini (coming soon)",
        "deep_models":  ["gemini-2.5-pro", "gemini-2.0-flash"],
        "quick_models": ["gemini-2.0-flash", "gemini-1.5-flash"],
        "key_env": "GOOGLE_API_KEY",
        "available": False,
    },
    "ollama": {
        "label": "Ollama (coming soon)",
        "deep_models":  ["llama3.3:70b", "qwen2.5:72b"],
        "quick_models": ["llama3.2:3b", "qwen2.5:7b"],
        "key_env": None,
        "available": False,
    },
}


@app.get("/api/providers")
def get_providers():
    return {"providers": PROVIDERS}


# ── session store ─────────────────────────────────────────────────────────
sessions: dict[str, AnalysisState] = {}
completed_sessions: list[dict] = []
_MAX_SESSIONS = 20


# ── request / response models ─────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    ticker: str
    date: str
    provider: str
    deep_model: str
    quick_model: str
    selected_analysts: list[str] = ["market", "social", "news", "fundamentals"]
    research_depth: int = 1
    output_language: str = "English"

    @field_validator("ticker")
    @classmethod
    def ticker_valid(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("Ticker must not be empty.")
        # Allow letters, digits, dot, hyphen, caret, slash — no spaces or colons
        # Examples: AAPL, 0700.HK, BTC-USD, ^GSPC, BRK.B
        if not re.match(r"^[A-Z0-9.\-^/]+$", v):
            raise ValueError(
                f"'{v}' is not a valid ticker format. "
                "Use standard formats — e.g. AAPL, 0700.HK (HK stocks), BTC-USD, ^GSPC"
            )
        return v

    @field_validator("date")
    @classmethod
    def date_not_future(cls, v: str) -> str:
        try:
            d = datetime.date.fromisoformat(v)
        except ValueError:
            raise ValueError("date must be YYYY-MM-DD")
        if d > datetime.date.today():
            raise ValueError("date cannot be in the future")
        return v


@app.post("/api/analyze")
def start_analysis(req: AnalyzeRequest):
    session_id = str(uuid.uuid4())[:8]
    state = AnalysisState(session_id, req.selected_analysts)
    sessions[session_id] = state

    t = threading.Thread(
        target=_run_stream,
        args=(session_id, req),
        daemon=True,
    )
    t.start()
    return {"session_id": session_id}


@app.get("/api/sessions")
def list_sessions():
    return completed_sessions


@app.get("/api/sessions/{session_id}/events")
def get_session_events(session_id: str):
    for s in completed_sessions:
        if s["session_id"] == session_id:
            return {"events": s["snapshot"]["events"]}
    raise HTTPException(status_code=404, detail="Session not found")


# ── SSE endpoint ──────────────────────────────────────────────────────────
@app.get("/api/stream/{session_id}")
async def stream_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    state = sessions[session_id]
    q = state.get_queue()

    async def event_gen():
        import json as _json
        loop = asyncio.get_running_loop()
        while True:
            try:
                raw = await loop.run_in_executor(None, _dequeue, q)
                yield f"data: {raw}\n\n"
                event = _json.loads(raw)
                if event.get("type") in ("done", "error"):
                    break
            except _QueueTimeout:
                yield ": keepalive\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class _QueueTimeout(Exception):
    pass


def _dequeue(q: queue.Queue, timeout: float = 0.5) -> str:
    try:
        return q.get(timeout=timeout)
    except queue.Empty:
        raise _QueueTimeout


# ── LangGraph background thread ───────────────────────────────────────────
def _run_stream(session_id: str, req: AnalyzeRequest) -> None:
    state = sessions[session_id]
    start = time.time()
    try:
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        config = DEFAULT_CONFIG.copy()
        config["llm_provider"]    = req.provider
        config["deep_think_llm"]  = req.deep_model
        config["quick_think_llm"] = req.quick_model
        config["max_debate_rounds"]      = req.research_depth
        config["max_risk_discuss_rounds"] = req.research_depth
        config["output_language"] = req.output_language

        graph = TradingAgentsGraph(req.selected_analysts, config=config)

        instrument_context = graph.resolve_instrument_context(req.ticker)
        init_agent_state = graph.propagator.create_initial_state(
            req.ticker,
            req.date,
            instrument_context=instrument_context,
        )
        args = graph.propagator.get_graph_args()

        # Mark the first selected analyst as in_progress
        _analyst_name = {
            "market": "Market Analyst", "social": "Sentiment Analyst",
            "news": "News Analyst", "fundamentals": "Fundamentals Analyst",
        }
        if req.selected_analysts:
            first = _analyst_name.get(req.selected_analysts[0])
            if first and first in state.agent_status:
                state._set_status(first, "in_progress")

        for chunk in graph.graph.stream(init_agent_state, **args):
            state.ingest(chunk)

        elapsed = time.time() - start
        state.put_done(elapsed)

        # Store completed session
        entry = {
            "session_id": session_id,
            "ticker":     req.ticker,
            "date":       req.date,
            "provider":   req.provider,
            "model":      req.deep_model,
            "elapsed":    round(elapsed),
            "signal":     state.last_signal,
            "snapshot":   state.snapshot(),
        }
        completed_sessions.append(entry)
        if len(completed_sessions) > _MAX_SESSIONS:
            completed_sessions.pop(0)
        sessions.pop(session_id, None)

    except Exception as exc:  # noqa: BLE001
        state.put_error(str(exc))
        sessions.pop(session_id, None)
