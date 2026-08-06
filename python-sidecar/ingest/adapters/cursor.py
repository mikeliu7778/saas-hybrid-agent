from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from ingest.scrub import scrub_event

_PATH_RE = re.compile(
    r"(?:^|[\s`\"'(])("
    r"(?:[\w.-]+/)+[\w.-]+\.[A-Za-z0-9]+"  # path/to/file.ext
    r"|"
    r"[\w.-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|java|go|rs)"
    r")"
)

_MAX_SUMMARY = 2000
_MAX_PATHS = 50


def _extract_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text") or ""))
            elif isinstance(part, dict) and "text" in part:
                parts.append(str(part.get("text") or ""))
        return " ".join(parts)
    if isinstance(content, dict):
        if "content" in content:
            return _extract_text_from_content(content["content"])
        if "text" in content:
            return str(content["text"])
    return ""


def _message_role_and_text(row: dict[str, Any]) -> tuple[str, str]:
    role = str(row.get("role") or row.get("type") or "user")
    if "message" in row and isinstance(row["message"], dict):
        msg = row["message"]
        role = str(msg.get("role") or role)
        return role, _extract_text_from_content(msg.get("content"))
    return role, _extract_text_from_content(row.get("content"))


def _extract_paths(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for m in _PATH_RE.finditer(text):
        p = m.group(1)
        if p not in seen:
            seen.add(p)
            found.append(p)
    return found


def _rule_summary(user_bits: list[str], assistant_bits: list[str]) -> str:
    u = " ".join(user_bits).strip()
    a = " ".join(assistant_bits).strip()
    if not u and not a:
        return "(empty session)"
    head = u[:120] if u else "(no user text)"
    tail = a[:120] if a else "(no assistant text)"
    return f"{head} → {tail}"[:_MAX_SUMMARY]


def parse_cursor_transcript_lines(lines: list[str], *, native_session_id: str) -> list[dict[str, Any]]:
    user_bits: list[str] = []
    assistant_bits: list[str] = []
    paths: list[str] = []
    seen_paths: set[str] = set()

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        role, text = _message_role_and_text(row)
        if not text:
            continue
        role_l = role.lower()
        if role_l in ("user", "human"):
            user_bits.append(text)
        elif role_l in ("assistant", "model", "ai"):
            assistant_bits.append(text)
        for p in _extract_paths(text):
            if p not in seen_paths:
                seen_paths.add(p)
                paths.append(p)

    paths = paths[:_MAX_PATHS]
    digest = hashlib.sha256(
        (native_session_id + "\n" + "\n".join(lines)).encode("utf-8")
    ).hexdigest()[:16]
    event_id = f"cursor:{native_session_id}:{digest}"

    summary_event = scrub_event(
        {
            "event_id": event_id,
            "schema_version": "1",
            "source": "cursor",
            "kind": "session_summary",
            "summary": _rule_summary(user_bits, assistant_bits),
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
                    "source": "cursor",
                    "kind": "file_touch",
                    "summary": f"touched {p}",
                    "paths": [p],
                    "scrubbed": False,
                    "native_session_id": native_session_id,
                }
            )
        )
    return events


def adapt_cursor_transcript_file(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    lines = text.splitlines()
    native_id = p.stem
    return parse_cursor_transcript_lines(lines, native_session_id=native_id)
