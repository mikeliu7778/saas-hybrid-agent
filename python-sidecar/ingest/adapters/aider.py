"""Aider chat history (.aider.chat.history.md) → ingest_event (I5b-B)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ingest.adapters.common import accumulate_paths, build_session_events

_HEADER = re.compile(r"^####\s+(User|Assistant)\s*:?\s*$", re.IGNORECASE)


def parse_aider_history(
    text: str, *, native_session_id: str
) -> list[dict[str, Any]]:
    user_bits: list[str] = []
    assistant_bits: list[str] = []
    paths: list[str] = []
    seen: set[str] = set()

    role: str | None = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal role, buf
        body = "\n".join(buf).strip()
        buf = []
        if not body or not role:
            role = None
            return
        if role == "user":
            user_bits.append(body)
        else:
            assistant_bits.append(body)
        accumulate_paths(body, paths, seen)
        role = None

    for line in text.splitlines():
        m = _HEADER.match(line.strip())
        if m:
            flush()
            role = m.group(1).lower()
            continue
        if role:
            buf.append(line)
    flush()

    return build_session_events(
        source="aider",
        native_session_id=native_session_id,
        digest_material=text,
        user_bits=user_bits,
        assistant_bits=assistant_bits,
        paths=paths,
    )


def adapt_aider_history_file(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    return parse_aider_history(
        p.read_text(encoding="utf-8"),
        native_session_id=p.stem,
    )
