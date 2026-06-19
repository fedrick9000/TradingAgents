import json
import queue

import pytest


def get_events(state) -> list[dict]:
    events = []
    q = state.get_queue()
    while not q.empty():
        events.append(json.loads(q.get_nowait()))
    return events


# ── helpers for fake LangChain messages ──────────────────────────────────

class FakeMsg:
    def __init__(self, type_, content="", tool_calls=None, id_=None):
        self._type = type_
        self.content = content
        self.tool_calls = tool_calls or []
        self.id = id_


def ai_msg(content="", tool_calls=None, id_="m1"):
    try:
        from langchain_core.messages import AIMessage
        tc = tool_calls or []
        return AIMessage(content=content, tool_calls=tc, id=id_)
    except Exception:
        return FakeMsg("ai", content, tool_calls, id_)


def tool_msg(content="result", id_="t1"):
    try:
        from langchain_core.messages import ToolMessage
        return ToolMessage(content=content, tool_call_id="x", id=id_)
    except Exception:
        return FakeMsg("tool", content, id_=id_)


# ── tests ─────────────────────────────────────────────────────────────────

def test_analyst_report_emits_status_and_report_event():
    from web.analysis import AnalysisState
    state = AnalysisState("s1", ["market", "social", "news", "fundamentals"])
    state.ingest({"messages": [], "market_report": "market content"})
    events = get_events(state)
    types = [e["type"] for e in events]
    assert "agent_status" in types
    assert "report" in types
    status_ev = next(e for e in events if e["type"] == "agent_status")
    assert status_ev["agent"] == "Market Analyst"
    assert status_ev["status"] == "completed"
    report_ev = next(e for e in events if e["type"] == "report")
    assert report_ev["section"] == "market_report"
    assert report_ev["content"] == "market content"


def test_report_only_emitted_once_across_chunks():
    from web.analysis import AnalysisState
    state = AnalysisState("s2", ["market"])
    chunk = {"messages": [], "market_report": "content"}
    state.ingest(chunk)
    state.ingest(chunk)  # same full-state chunk repeated
    events = get_events(state)
    report_events = [e for e in events if e["type"] == "report"]
    assert len(report_events) == 1


def test_semi_stable_missing_keys_dont_raise():
    from web.analysis import AnalysisState
    state = AnalysisState("s3", ["market"])
    # No investment_debate_state or risk_debate_state in chunk — must not crash
    state.ingest({"messages": []})
    state.ingest({"messages": [], "investment_debate_state": {}})
    state.ingest({"messages": [], "risk_debate_state": {}})


def test_debate_update_emitted_on_content_change():
    from web.analysis import AnalysisState
    state = AnalysisState("s4", ["market"])
    state.ingest({"messages": [], "investment_debate_state": {
        "bull_history": "bull round 1", "bear_history": "", "judge_decision": ""
    }})
    events = get_events(state)
    debate_events = [e for e in events if e["type"] == "debate_update"]
    assert len(debate_events) == 1
    assert debate_events[0]["speaker"] == "Bull Researcher"
    assert debate_events[0]["debate"] == "investment"


def test_debate_update_not_emitted_if_content_unchanged():
    from web.analysis import AnalysisState
    state = AnalysisState("s5", ["market"])
    chunk = {"messages": [], "investment_debate_state": {
        "bull_history": "same content", "bear_history": "", "judge_decision": ""
    }}
    state.ingest(chunk)
    state.ingest(chunk)  # same content — must not re-emit
    events = get_events(state)
    debate_events = [e for e in events if e["type"] == "debate_update"]
    assert len(debate_events) == 1


def test_tool_calls_grouped_into_tool_group_event():
    from web.analysis import AnalysisState
    state = AnalysisState("s6", ["market"])
    # Simulate: AI message with tool calls, then AI message with content
    tc = [{"name": "get_stock_data", "args": {}, "id": "c1", "type": "tool_call"}]
    state.ingest({"messages": [ai_msg(tool_calls=tc, id_="m1")]})
    state.ingest({"messages": [ai_msg(tool_calls=tc, id_="m1"),  # already seen
                               ai_msg(content="final answer", id_="m2")]})
    events = get_events(state)
    tool_events = [e for e in events if e["type"] == "feed" and e["kind"] == "tool_group"]
    assert len(tool_events) == 1
    assert "get_stock_data" in tool_events[0]["tools"]


def test_signal_extraction():
    from web.analysis import AnalysisState
    state = AnalysisState("s7", ["market"])
    state.ingest({"messages": [], "final_trade_decision": "After analysis, BUY the stock."})
    events = get_events(state)
    decision = next(e for e in events if e["type"] == "decision")
    assert decision["signal"] == "BUY"


def test_signal_defaults_to_hold():
    from web.analysis import AnalysisState
    state = AnalysisState("s8", ["market"])
    state.ingest({"messages": [], "final_trade_decision": "Uncertain about the outcome."})
    events = get_events(state)
    decision = next(e for e in events if e["type"] == "decision")
    assert decision["signal"] == "HOLD"


def test_done_event_flushed():
    from web.analysis import AnalysisState
    state = AnalysisState("s9", ["market"])
    state.put_done(90.5)
    events = get_events(state)
    assert events[-1]["type"] == "done"
    assert events[-1]["elapsed_seconds"] == 91


def test_snapshot_contains_events():
    from web.analysis import AnalysisState
    state = AnalysisState("s10", ["market"])
    state.ingest({"messages": [], "market_report": "data"})
    snap = state.snapshot()
    assert "events" in snap
    assert len(snap["events"]) > 0


def test_unselected_analyst_agent_not_in_status():
    from web.analysis import AnalysisState
    state = AnalysisState("s11", ["market"])  # only market selected
    assert "Sentiment Analyst" not in state.agent_status
    assert "Market Analyst" in state.agent_status
