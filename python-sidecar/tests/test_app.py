from fastapi.testclient import TestClient

from app import create_app


class FakeRunner:
    def run_complete(self, prompt, model, cwd, images=None):
        assert "user:" in prompt
        return "hello from fake"

    def run_stream(self, prompt, model, cwd, images=None):
        yield "hel"
        yield "lo"


def test_health():
    client = TestClient(create_app(FakeRunner()))
    assert client.get("/health").json()["status"] == "ok"


def test_complete_non_stream():
    client = TestClient(create_app(FakeRunner()))
    r = client.post(
        "/v1/complete",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "hello from fake"
    assert body["tool_calls"] == []


def test_complete_stream():
    client = TestClient(create_app(FakeRunner()))
    with client.stream(
        "POST",
        "/v1/complete",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
        },
    ) as r:
        assert r.status_code == 200
        text = "".join(r.iter_text())
    assert '"type":"delta"' in text or '"type": "delta"' in text
    assert "done" in text
