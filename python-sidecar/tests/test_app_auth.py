from fastapi.testclient import TestClient

from app import create_app


class AuthFailRunner:
    def run_complete(self, prompt, model, cwd):
        raise RuntimeError("401 Unauthorized: invalid api key")

    def run_stream(self, prompt, model, cwd):
        raise RuntimeError("401 Unauthorized: invalid api key")
        yield ""  # pragma: no cover


def test_complete_auth_error_returns_502():
    client = TestClient(create_app(AuthFailRunner()))
    r = client.post(
        "/v1/complete",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": False},
    )
    assert r.status_code == 502
    body = r.json()
    assert body["code"] == "cursor_unauthorized"
    assert "401" in body["message"]
