"""Continue.dev session → ingest_event (I5b-B)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ingest.adapters.common import accumulate_paths, build_session_events


def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text") or ""))
            elif isinstance(part, str):
                parts.append(part)
        return " ".join(parts)
    return ""


def parse_continue_session(
    data: dict[str, Any], *, native_session_id: str
) -> list[dict[str, Any]]:
    user_bits: list[str] = []
    assistant_bits: list[str] = []
    paths: list[str] = []
    seen: set[str] = set()

    history = data.get("history") or data.get("messages") or []
    if not isinstance(history, list):
        history = []

    for row in history:
        if not isinstance(row, dict):
            continue
        msg = row.get("message") if isinstance(row.get("message"), dict) else row
        role = str(msg.get("role") or row.get("role") or "").lower()
        text = _text_from_content(msg.get("content"))
        if not text:
            continue
        if role in ("user", "human"):
            user_bits.append(text)
        elif role in ("assistant", "ai", "model"):
            assistant_bits.append(text)
        accumulate_paths(text, paths, seen)

    material = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return build_session_events(
        source="continue",
        native_session_id=native_session_id,
        digest_material=material,
        user_bits=user_bits,
        assistant_bits=assistant_bits,
        paths=paths,
    )


def adapt_continue_session_file(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("continue session must be a JSON object")
    native_id = str(data.get("sessionId") or data.get("session_id") or p.stem)
    return parse_continue_session(data, native_session_id=native_id)
