from pathlib import Path

from ingest.adapters.cursor import adapt_cursor_transcript_file, parse_cursor_transcript_lines

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "cursor_transcript.jsonl"


def test_adapt_cursor_transcript_file():
    events = adapt_cursor_transcript_file(FIXTURE)
    kinds = [e["kind"] for e in events]
    assert "session_summary" in kinds
    assert kinds.count("file_touch") >= 1
    summary = next(e for e in events if e["kind"] == "session_summary")
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in summary["summary"]
    assert "[REDACTED]" in summary["summary"] or "AuthService" in summary["summary"]
    assert summary["scrubbed"] is True
    assert summary["event_id"].startswith("cursor:")
    assert any("AuthService.ts" in p for e in events for p in e["paths"])


def test_stable_event_id():
    lines = FIXTURE.read_text(encoding="utf-8").splitlines()
    a = parse_cursor_transcript_lines(lines, native_session_id="sess")
    b = parse_cursor_transcript_lines(lines, native_session_id="sess")
    assert a[0]["event_id"] == b[0]["event_id"]
