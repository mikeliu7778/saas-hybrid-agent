from pathlib import Path

from ingest.adapters.aider import adapt_aider_history_file
from ingest.adapters.continue_adapter import adapt_continue_session_file
from ingest.adapters.opencode import adapt_opencode_transcript_file
from ingest.schema import validate_events

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_continue_adapter():
    events = adapt_continue_session_file(FIXTURES / "continue_session.json")
    validate_events(events)
    assert events[0]["source"] == "continue"
    assert events[0]["kind"] == "session_summary"
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in events[0]["summary"]
    assert any("AuthService.ts" in p for e in events for p in e["paths"])
    assert events[0]["event_id"].startswith("continue:")


def test_aider_adapter():
    events = adapt_aider_history_file(FIXTURES / "aider_chat_history.md")
    validate_events(events)
    assert events[0]["source"] == "aider"
    assert "[REDACTED]" in events[0]["summary"] or "AuthService" in events[0]["summary"]
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in events[0]["summary"]
    assert any(e["kind"] == "file_touch" for e in events)


def test_opencode_adapter():
    events = adapt_opencode_transcript_file(FIXTURES / "opencode_transcript.jsonl")
    validate_events(events)
    assert events[0]["source"] == "opencode"
    assert any("LocalSyncEngine.ts" in p for e in events for p in e["paths"])
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in events[0]["summary"]
