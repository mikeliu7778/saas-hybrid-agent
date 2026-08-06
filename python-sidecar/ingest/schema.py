from __future__ import annotations

from typing import Any


REQUIRED_FIELDS = ("event_id", "schema_version", "source", "kind", "summary", "paths", "scrubbed")
ALLOWED_SOURCES = frozenset({"cursor", "claude_code", "codex", "hybrid", "other"})
ALLOWED_KINDS = frozenset(
    {
        "session_summary",
        "file_touch",
        "decision",
        "procedure_draft",
        "raw_marker",
    }
)

MAX_SUMMARY_CHARS = 2000
MAX_PATHS = 50


class IngestSchemaError(ValueError):
    pass


def validate_event(event: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise IngestSchemaError("event must be an object")
    for field in REQUIRED_FIELDS:
        if field not in event:
            raise IngestSchemaError(f"missing field: {field}")
    if not isinstance(event["event_id"], str) or not event["event_id"]:
        raise IngestSchemaError("event_id must be a non-empty string")
    if event["source"] not in ALLOWED_SOURCES:
        raise IngestSchemaError(f"invalid source: {event['source']}")
    if event["kind"] not in ALLOWED_KINDS:
        raise IngestSchemaError(f"invalid kind: {event['kind']}")
    if not isinstance(event["summary"], str):
        raise IngestSchemaError("summary must be a string")
    if not isinstance(event["paths"], list):
        raise IngestSchemaError("paths must be a list")
    if len(event["paths"]) > MAX_PATHS:
        raise IngestSchemaError(f"paths exceeds {MAX_PATHS}")
    if len(event["summary"]) > MAX_SUMMARY_CHARS:
        raise IngestSchemaError(f"summary exceeds {MAX_SUMMARY_CHARS} chars")
    if not isinstance(event["scrubbed"], bool):
        raise IngestSchemaError("scrubbed must be a boolean")
    return event


def validate_events(events: list[Any]) -> list[dict[str, Any]]:
    if not isinstance(events, list):
        raise IngestSchemaError("events must be a list")
    if len(events) > 100:
        raise IngestSchemaError("batch exceeds 100 events")
    return [validate_event(e) for e in events]
