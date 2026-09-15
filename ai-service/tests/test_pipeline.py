from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_forecast_shape_and_values():
    resp = client.post("/forecast", json={"series": [1, 2, 3, 4, 5, 6, 7, 8], "steps": 4})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 4
    assert all(isinstance(p["value"], float) for p in body)


def test_forecast_trend_direction():
    resp = client.post("/forecast", json={"series": list(range(24)), "steps": 5})
    values = [p["value"] for p in resp.json()]
    assert values[-1] > values[0]


def test_anomaly_flags_spike():
    series = [10.0] * 50 + [120.0] + [10.0] * 10
    resp = client.post("/anomaly", json={"metrics": series, "window": 10, "threshold": 3})
    assert resp.status_code == 200
    assert any(p["index"] == 50 for p in resp.json())


def test_anomaly_no_false_positive_on_flat():
    resp = client.post("/anomaly", json={"metrics": [5.0] * 40, "window": 8, "threshold": 3})
    assert resp.json() == []


def test_scenario_suggest_high_energy_stress():
    resp = client.post("/scenario/suggest", json={
        "domain_stress": {"energy": 0.9},
        "recent_metrics": [1.0] * 20,
    })
    body = resp.json()
    assert body
    assert body[0]["domain"] == "energy"


def test_health():
    assert client.get("/health").json() == {"status": "ok", "service": "ai-service"}