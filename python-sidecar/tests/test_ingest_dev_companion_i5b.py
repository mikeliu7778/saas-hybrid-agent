from pathlib import Path

from ingest.adapters.dev_companion import adapt_companion_session_file
from ingest.schema import validate_events

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "dev_companion_session.jsonl"


def test_dev_companion_adapter():
    events = adapt_companion_session_file(FIXTURE)
    validate_events(events)
    assert events[0]["source"] == "dev_companion"
    assert events[0]["kind"] == "session_summary"
    assert events[0]["cwd"] == "/srv/app"
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in events[0]["summary"]
    assert any(e["kind"] == "file_touch" for e in events)
    assert any(e["kind"] == "procedure_draft" for e in events)
    assert any("AuthService.ts" in p for e in events for p in e["paths"])
    assert events[0]["event_id"].startswith("dev_companion:")
