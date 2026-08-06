"""OpenCode-style JSONL transcript → ingest_event (I5b-B)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ingest.adapters.common import accumulate_paths, build_session_events


def _role_and_text(row: dict[str, Any]) -> tuple[str, str]:
    role = str(row.get("role") or row.get("type") or "")
    content = row.get("content")
    if isinstance(content, str):
        return role, content
    if isinstance(row.get("message"), dict):
        msg = row["message"]
        role = str(msg.get("role") or role)
        c = msg.get("content")
        return role, c if isinstance(c, str) else ""
    return role, ""


def parse_opencode_transcript_lines(
    lines: list[str], *, native_session_id: str
) -> list[dict[str, Any]]:
    user_bits: list[str] = []
    assistant_bits: list[str] = []
    paths: list[str] = []
    seen: set[str] = set()

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
        role, text = _role_and_text(row)
        if not text:
            continue
        role_l = role.lower()
        if role_l in ("user", "human"):
            user_bits.append(text)
        elif role_l in ("assistant", "model", "ai"):
            assistant_bits.append(text)
        accumulate_paths(text, paths, seen)

    return build_session_events(
        source="opencode",
        native_session_id=native_session_id,
        digest_material="\n".join(lines),
        user_bits=user_bits,
        assistant_bits=assistant_bits,
        paths=paths,
    )


def adapt_opencode_transcript_file(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    return parse_opencode_transcript_lines(
        p.read_text(encoding="utf-8").splitlines(),
        native_session_id=p.stem,
    )
