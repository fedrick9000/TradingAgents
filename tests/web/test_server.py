import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from web.server import app
    return TestClient(app)


def test_providers_returns_dict(client):
    r = client.get("/api/providers")
    assert r.status_code == 200
    data = r.json()
    assert "providers" in data
    assert isinstance(data["providers"], dict)
    assert len(data["providers"]) > 0


def test_providers_schema(client):
    r = client.get("/api/providers")
    providers = r.json()["providers"]
    for pid, p in providers.items():
        assert "label" in p
        assert "deep_models" in p
        assert "quick_models" in p
        assert "key_env" in p
        assert isinstance(p["deep_models"], list)
        assert len(p["deep_models"]) > 0


def test_analyze_returns_session_id(client):
    r = client.post("/api/analyze", json={
        "ticker": "NVDA",
        "date": "2026-01-15",
        "provider": "anthropic",
        "deep_model": "claude-sonnet-4-6",
        "quick_model": "claude-sonnet-4-6",
    })
    assert r.status_code == 200
    data = r.json()
    assert "session_id" in data
    assert isinstance(data["session_id"], str)


def test_analyze_missing_ticker_returns_422(client):
    r = client.post("/api/analyze", json={
        "date": "2026-01-15",
        "provider": "anthropic",
        "deep_model": "claude-sonnet-4-6",
        "quick_model": "claude-sonnet-4-6",
    })
    assert r.status_code == 422


def test_analyze_future_date_returns_422(client):
    r = client.post("/api/analyze", json={
        "ticker": "NVDA",
        "date": "2099-01-01",
        "provider": "anthropic",
        "deep_model": "claude-sonnet-4-6",
        "quick_model": "claude-sonnet-4-6",
    })
    assert r.status_code == 422


def test_sessions_empty_initially(client):
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_sessions_unknown_id_returns_404(client):
    r = client.get("/api/sessions/nonexistent/events")
    assert r.status_code == 404
