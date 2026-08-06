from pathlib import Path

from fastapi.testclient import TestClient

from app import create_app

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "cursor_transcript.jsonl"


class FakeRunner:
    def run_complete(self, prompt, model, cwd, images=None):
        return "x"

    def run_stream(self, prompt, model, cwd, images=None):
        yield "x"


def test_ingest_run_from_transcript():
    client = TestClient(create_app(FakeRunner()))
    r = client.post("/v1/ingest/run", json={"transcript_path": str(FIXTURE)})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    assert "eventId" in body["events"][0]
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in str(body)


def test_ingest_run_from_events():
    client = TestClient(create_app(FakeRunner()))
    r = client.post(
        "/v1/ingest/run",
        json={
            "events": [
                {
                    "event_id": "e1",
                    "schema_version": "1",
                    "source": "cursor",
                    "kind": "session_summary",
                    "summary": "hello sk-abcdefghijklmnopqrstuvwxyz012345",
                    "paths": [],
                    "scrubbed": False,
                }
            ]
        },
    )
    assert r.status_code == 200
    summary = r.json()["events"][0]["summary"]
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in summary
