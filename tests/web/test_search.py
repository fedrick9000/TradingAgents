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
