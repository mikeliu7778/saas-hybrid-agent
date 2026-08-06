"""Shared helpers for thin host → ingest_event adapters (I5b-B)."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from ingest.scrub import scrub_event

_PATH_RE = re.compile(
    r"(?:^|[\s`\"'(])("
    r"(?:[\w.-]+/)+[\w.-]+\.[A-Za-z0-9]+"
    r"|"
    r"[\w.-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|java|go|rs)"
    r")"
)

MAX_SUMMARY = 2000
MAX_PATHS = 50


def extract_paths(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for m in _PATH_RE.finditer(text):
        p = m.group(1)
        if p not in seen:
            seen.add(p)
            found.append(p)
    return found


def rule_summary(user_bits: list[str], assistant_bits: list[str]) -> str:
    u = " ".join(user_bits).strip()
    a = " ".join(assistant_bits).strip()
    if not u and not a:
        return "(empty session)"
    head = u[:120] if u else "(no user text)"
    tail = a[:120] if a else "(no assistant text)"
    return f"{head} → {tail}"[:MAX_SUMMARY]


def build_session_events(
    *,
    source: str,
    native_session_id: str,
    digest_material: str,
    user_bits: list[str],
    assistant_bits: list[str],
    paths: list[str],
) -> list[dict[str, Any]]:
    paths = paths[:MAX_PATHS]
    digest = hashlib.sha256(
        (native_session_id + "\n" + digest_material).encode("utf-8")
    ).hexdigest()[:16]
    event_id = f"{source}:{native_session_id}:{digest}"

    summary_event = scrub_event(
        {
            "event_id": event_id,
            "schema_version": "1",
            "source": source,
            "kind": "session_summary",
            "summary": rule_summary(user_bits, assistant_bits),
            "paths": list(paths),
            "scrubbed": False,
            "native_session_id": native_session_id,
        }
    )
    events: list[dict[str, Any]] = [summary_event]
    for i, p in enumerate(paths):
        events.append(
            scrub_event(
                {
                    "event_id": f"{event_id}:path:{i}",
                    "schema_version": "1",
                    "source": source,
                    "kind": "file_touch",
                    "summary": f"touched {p}",
                    "paths": [p],
                    "scrubbed": False,
                    "native_session_id": native_session_id,
                }
            )
        )
    return events


def accumulate_paths(
    text: str, paths: list[str], seen: set[str]
) -> None:
    for p in extract_paths(text):
        if p not in seen:
            seen.add(p)
            paths.append(p)
