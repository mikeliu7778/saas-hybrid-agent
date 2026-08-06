from ingest.schema import IngestSchemaError, validate_event, validate_events
from ingest.scrub import scrub_event, scrub_text


def test_validate_event_ok():
    e = {
        "event_id": "e1",
        "schema_version": "1",
        "source": "cursor",
        "kind": "session_summary",
        "summary": "ok",
        "paths": [],
        "scrubbed": True,
    }
    assert validate_event(e)["event_id"] == "e1"


def test_validate_event_missing_event_id():
    try:
        validate_event(
            {
                "schema_version": "1",
                "source": "cursor",
                "kind": "session_summary",
                "summary": "ok",
                "paths": [],
                "scrubbed": True,
            }
        )
        assert False, "expected error"
    except IngestSchemaError as ex:
        assert "event_id" in str(ex)


def test_scrub_redacts_keys():
    text = "use sk-abcdefghijklmnopqrstuvwxyz012345 and crsr_abcdefghijklmnopqrstuvwxyz"
    out = scrub_text(text)
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in out
    assert "crsr_abcdefghijklmnopqrstuvwxyz" not in out
    assert "[REDACTED]" in out


def test_scrub_event_sets_flag():
    e = scrub_event(
        {
            "event_id": "e1",
            "schema_version": "1",
            "source": "cursor",
            "kind": "session_summary",
            "summary": "plain",
            "paths": [],
            "scrubbed": False,
        }
    )
    assert e["scrubbed"] is True


def test_validate_events_batch():
    events = validate_events(
        [
            {
                "event_id": "e1",
                "schema_version": "1",
                "source": "cursor",
                "kind": "file_touch",
                "summary": "t",
                "paths": ["a.ts"],
                "scrubbed": True,
            }
        ]
    )
    assert len(events) == 1
