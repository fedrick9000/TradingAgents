import datetime
import json
import math
import queue
from typing import Optional

TEAM_AGENTS: dict[str, list[str]] = {
    "Analyst Team": ["Market Analyst", "Sentiment Analyst", "News Analyst", "Fundamentals Analyst"],
    "Research Team": ["Bull Researcher", "Bear Researcher", "Research Manager"],
    "Trading Team": ["Trader"],
    "Risk Management": ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst"],
    "Portfolio Management": ["Portfolio Manager"],
}

ANALYST_KEYS: dict[str, tuple[str, str]] = {
    "market_report":       ("Market Analyst",      "market"),
    "sentiment_report":    ("Sentiment Analyst",   "social"),
    "news_report":         ("News Analyst",        "news"),
    "fundamentals_report": ("Fundamentals Analyst","fundamentals"),
}

ANALYST_SEQUENCE = ["market", "social", "news", "fundamentals"]

ANALYST_NAME: dict[str, str] = {
    "market":       "Market Analyst",
    "social":       "Sentiment Analyst",
    "news":         "News Analyst",
    "fundamentals": "Fundamentals Analyst",
}

SIGNALS = ["BUY", "SELL", "OVERWEIGHT", "UNDERWEIGHT", "HOLD"]


def _agent_team(agent: str) -> str:
    return next((t for t, aa in TEAM_AGENTS.items() if agent in aa), "Unknown")


class AnalysisState:
    """Converts LangGraph stream chunks into SSE events.

    Designed to be read-only from outside except via the public methods.
    All chunk keys are accessed with .get() so missing semi-stable keys
    never raise.
    """

    def __init__(self, session_id: str, selected_analysts: list[str]) -> None:
        self.session_id = session_id
        self.selected_analysts = list(selected_analysts)
        self.last_signal: str = ""

        self._q: queue.Queue = queue.Queue()
        self._all_events: list[dict] = []

        # Build agent_status: only include analysts that were selected;
        # all non-analyst-team agents are always included.
        self.agent_status: dict[str, str] = {}
        analyst_team_agents = set(TEAM_AGENTS["Analyst Team"])
        for key in ANALYST_SEQUENCE:
            if key in self.selected_analysts:
                self.agent_status[ANALYST_NAME[key]] = "pending"
        for team_agents in TEAM_AGENTS.values():
            for agent in team_agents:
                if agent in analyst_team_agents:
                    continue  # only add analyst-team agents when selected (handled above)
                if agent not in self.agent_status:
                    self.agent_status[agent] = "pending"

        # Deduplication
        self._seen_reports: set[str] = set()
        self._seen_msg_ids: set[str] = set()

        # Debate diff tracking (stream_mode=values → full state every chunk)
        self._prev_bull: str = ""
        self._prev_bear: str = ""
        self._prev_invest_judge: str = ""
        self._invest_round: int = 0

        self._prev_agg: str = ""
        self._prev_con: str = ""
        self._prev_neu: str = ""
        self._prev_risk_judge: str = ""
        self._risk_round: int = 0

        # Tool call grouping
        self._active_agent: Optional[str] = None
        self._pending_tools: list[str] = []

    # ── public API ───────────────────────────────────────────────────────

    def ingest(self, chunk: dict) -> None:
        """Process one LangGraph stream chunk and emit SSE events."""
        self._ingest_messages(chunk.get("messages") or [])
        self._ingest_analyst_reports(chunk)
        self._ingest_investment_debate(chunk.get("investment_debate_state") or {})
        self._ingest_investment_plan(chunk)
        self._ingest_trader_plan(chunk)
        self._ingest_risk_debate(chunk.get("risk_debate_state") or {})
        self._ingest_final_decision(chunk)

    def put_done(self, elapsed: float) -> None:
        self._flush_tools()
        self._emit({"type": "done", "elapsed_seconds": math.ceil(elapsed)})

    def put_error(self, message: str) -> None:
        self._flush_tools()
        self._emit({"type": "error", "message": message})

    def get_queue(self) -> queue.Queue:
        return self._q

    def snapshot(self) -> dict:
        """Return all emitted events — used for session replay."""
        return {"events": list(self._all_events)}

    # ── internal helpers ─────────────────────────────────────────────────

    @staticmethod
    def _ts() -> str:
        return datetime.datetime.now().strftime("%H:%M:%S")

    def _emit(self, event: dict) -> None:
        event.setdefault("ts", self._ts())
        self._all_events.append(event)
        self._q.put(json.dumps(event))

    def _set_status(self, agent: str, status: str) -> None:
        if agent not in self.agent_status:
            return
        if self.agent_status[agent] == status:
            return
        self.agent_status[agent] = status
        self._emit({"type": "agent_status", "agent": agent,
                    "team": _agent_team(agent), "status": status})
        if status == "in_progress" and self._active_agent != agent:
            self._flush_tools()
            self._active_agent = agent

    def _flush_tools(self) -> None:
        if self._pending_tools:
            self._emit({
                "type": "feed", "kind": "tool_group",
                "agent": self._active_agent or "",
                "tools": list(self._pending_tools),
                "content": ", ".join(self._pending_tools),
            })
        self._pending_tools.clear()

    @staticmethod
    def _extract_text(content) -> str:
        if not content:
            return ""
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text", ""))
                elif isinstance(item, str):
                    parts.append(item)
            return " ".join(p for p in parts if p).strip()
        return str(content).strip()

    @staticmethod
    def _extract_signal(text: str) -> str:
        import re
        # Try to parse the **Rating**: header first (canonical PM decision format)
        m = re.search(r'\*\*Rating\*\*\s*:\s*(\w+)', text, re.IGNORECASE)
        if m:
            word = m.group(1).upper()
            if word in ("BUY", "SELL", "OVERWEIGHT", "UNDERWEIGHT", "HOLD"):
                return word
        # Fallback: scan full text (order: longest/rarest first to minimise false positives)
        upper = text.upper()
        for s in ("OVERWEIGHT", "UNDERWEIGHT", "BUY", "SELL", "HOLD"):
            if s in upper:
                return s
        return "HOLD"

    # ── ingestion methods ────────────────────────────────────────────────

    def _ingest_messages(self, messages: list) -> None:
        try:
            from langchain_core.messages import AIMessage, ToolMessage
        except ImportError:
            AIMessage = None  # type: ignore[assignment,misc]
            ToolMessage = None  # type: ignore[assignment,misc]

        def _is_ai(msg) -> bool:
            if AIMessage is not None:
                return isinstance(msg, AIMessage)
            return getattr(msg, "_type", None) == "ai"

        def _is_tool(msg) -> bool:
            if ToolMessage is not None:
                return isinstance(msg, ToolMessage)
            return getattr(msg, "_type", None) == "tool"

        for msg in messages:
            mid = getattr(msg, "id", None)
            if mid is not None:
                if mid in self._seen_msg_ids:
                    continue
                self._seen_msg_ids.add(mid)

            if _is_ai(msg):
                tool_calls = getattr(msg, "tool_calls", None) or []
                if tool_calls:
                    for tc in tool_calls:
                        name = tc["name"] if isinstance(tc, dict) else tc.name
                        if name not in self._pending_tools:
                            self._pending_tools.append(name)
                else:
                    text = self._extract_text(msg.content)
                    if text:
                        self._flush_tools()
                        self._emit({"type": "feed", "kind": "agent",
                                    "content": text[:1000]})
            elif _is_tool(msg):
                text = self._extract_text(msg.content)
                if text and len(text) > 20:
                    self._emit({"type": "feed", "kind": "data",
                                "content": text[:500]})

    def _ingest_analyst_reports(self, chunk: dict) -> None:
        selected_set = set(self.selected_analysts)
        for report_key, (agent_name, analyst_key) in ANALYST_KEYS.items():
            if analyst_key not in selected_set:
                continue
            content = (chunk.get(report_key) or "").strip()
            if not content or report_key in self._seen_reports:
                continue
            self._seen_reports.add(report_key)
            self._set_status(agent_name, "completed")
            self._emit({"type": "report", "section": report_key,
                        "agent": agent_name, "team": "Analyst Team",
                        "content": content})
            # Advance to next selected analyst, or Research Team
            idx = ANALYST_SEQUENCE.index(analyst_key)
            next_agent = None
            for key in ANALYST_SEQUENCE[idx + 1:]:
                if key in selected_set:
                    next_agent = ANALYST_NAME[key]
                    break
            self._set_status(next_agent or "Bull Researcher", "in_progress")

    def _ingest_investment_debate(self, debate: dict) -> None:
        bull  = (debate.get("bull_history")   or "").strip()
        bear  = (debate.get("bear_history")   or "").strip()
        judge = (debate.get("judge_decision") or "").strip()

        if bull and bull != self._prev_bull:
            self._prev_bull = bull
            self._invest_round += 1
            self._set_status("Bull Researcher", "in_progress")
            self._emit({"type": "debate_update", "debate": "investment",
                        "speaker": "Bull Researcher",
                        "content": bull, "round": self._invest_round})

        if bear and bear != self._prev_bear:
            self._prev_bear = bear
            self._set_status("Bear Researcher", "in_progress")
            self._emit({"type": "debate_update", "debate": "investment",
                        "speaker": "Bear Researcher",
                        "content": bear, "round": self._invest_round})

        if judge and judge != self._prev_invest_judge:
            self._prev_invest_judge = judge
            self._set_status("Bull Researcher", "completed")
            self._set_status("Bear Researcher", "completed")
            self._set_status("Research Manager", "completed")
            self._set_status("Trader", "in_progress")
            self._emit({"type": "debate_update", "debate": "investment",
                        "speaker": "Research Manager",
                        "content": judge, "round": self._invest_round})

    def _ingest_investment_plan(self, chunk: dict) -> None:
        plan = (chunk.get("investment_plan") or "").strip()
        if plan and "investment_plan" not in self._seen_reports:
            self._seen_reports.add("investment_plan")
            self._emit({"type": "report", "section": "investment_plan",
                        "agent": "Research Manager", "team": "Research Team",
                        "content": plan})

    def _ingest_trader_plan(self, chunk: dict) -> None:
        plan = (chunk.get("trader_investment_plan") or "").strip()
        if plan and "trader_investment_plan" not in self._seen_reports:
            self._seen_reports.add("trader_investment_plan")
            self._set_status("Trader", "completed")
            self._set_status("Aggressive Analyst", "in_progress")
            self._emit({"type": "report", "section": "trader_investment_plan",
                        "agent": "Trader", "team": "Trading Team",
                        "content": plan})

    def _ingest_risk_debate(self, risk: dict) -> None:
        agg   = (risk.get("aggressive_history")   or "").strip()
        con   = (risk.get("conservative_history") or "").strip()
        neu   = (risk.get("neutral_history")      or "").strip()
        judge = (risk.get("judge_decision")       or "").strip()

        if agg and agg != self._prev_agg:
            self._prev_agg = agg
            self._risk_round += 1
            self._set_status("Aggressive Analyst", "in_progress")
            self._emit({"type": "debate_update", "debate": "risk",
                        "speaker": "Aggressive Analyst",
                        "content": agg, "round": self._risk_round})

        if con and con != self._prev_con:
            self._prev_con = con
            self._set_status("Conservative Analyst", "in_progress")
            self._emit({"type": "debate_update", "debate": "risk",
                        "speaker": "Conservative Analyst",
                        "content": con, "round": self._risk_round})

        if neu and neu != self._prev_neu:
            self._prev_neu = neu
            self._set_status("Neutral Analyst", "in_progress")
            self._emit({"type": "debate_update", "debate": "risk",
                        "speaker": "Neutral Analyst",
                        "content": neu, "round": self._risk_round})

        if judge and judge != self._prev_risk_judge:
            self._prev_risk_judge = judge
            self._set_status("Aggressive Analyst", "completed")
            self._set_status("Conservative Analyst", "completed")
            self._set_status("Neutral Analyst", "completed")
            self._set_status("Portfolio Manager", "in_progress")
            self._emit({"type": "debate_update", "debate": "risk",
                        "speaker": "Portfolio Manager",
                        "content": judge, "round": self._risk_round})

    def _ingest_final_decision(self, chunk: dict) -> None:
        decision = (chunk.get("final_trade_decision") or "").strip()
        if not decision or "final_trade_decision" in self._seen_reports:
            return
        self._seen_reports.add("final_trade_decision")
        self._set_status("Portfolio Manager", "completed")
        signal = self._extract_signal(decision)
        self.last_signal = signal
        self._emit({"type": "decision", "signal": signal, "full_text": decision})
