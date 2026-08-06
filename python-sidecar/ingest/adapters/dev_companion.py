"""Dev Companion / remote terminal session → ingest_event (I5b-C).

Companion is an optional on-machine strong terminal. This adapter only
converts recorded session NDJSON into ingest_event — it does not execute shell.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ingest.adapters.common import accumulate_paths, build_session_events
from ingest.scrub import scrub_event

_CMD_LIMIT = 40
_STDOUT_SNIP = 200


def parse_companion_session_lines(
    lines: list[str], *, native_session_id: str
) -> list[dict[str, Any]]:
    user_bits: list[str] = []
    assistant_bits: list[str] = []
    paths: list[str] = []
    seen: set[str] = set()
    cmd_steps: list[str] = []
    cwd: str | None = None

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
        kind = str(row.get("type") or row.get("kind") or "").lower()

        if kind in ("user", "note", "prompt"):
            text = str(row.get("text") or row.get("content") or "")
            if text:
                user_bits.append(text)
                accumulate_paths(text, paths, seen)

        elif kind in ("cmd", "command", "shell"):
            cmd = str(row.get("cmd") or row.get("command") or "").strip()
            if not cmd:
                continue
            if row.get("cwd"):
                cwd = str(row["cwd"])
            exit_code = row.get("exit", row.get("exit_code"))
            step = cmd if exit_code is None else f"{cmd} (exit={exit_code})"
            cmd_steps.append(step)
            assistant_bits.append(f"$ {step}")
            accumulate_paths(cmd, paths, seen)

        elif kind in ("stdout", "stderr", "output"):
            text = str(row.get("text") or row.get("content") or "")
            if text:
                assistant_bits.append(text[:_STDOUT_SNIP])
                accumulate_paths(text, paths, seen)

        elif kind in ("file_touch", "file", "path"):
            p = str(row.get("path") or "")
            if p and p not in seen:
                seen.add(p)
                paths.append(p)

        elif kind == "assistant":
            text = str(row.get("text") or row.get("content") or "")
            if text:
                assistant_bits.append(text)
                accumulate_paths(text, paths, seen)

    if not user_bits and cmd_steps:
        user_bits = ["(companion terminal)"]

    events = build_session_events(
        source="dev_companion",
        native_session_id=native_session_id,
        digest_material="\n".join(lines),
        user_bits=user_bits,
        assistant_bits=assistant_bits,
        paths=paths,
    )

    if cwd:
        for e in events:
            e["cwd"] = cwd
            e["workspace_root"] = cwd

    if len(cmd_steps) >= 2:
        steps = cmd_steps[:_CMD_LIMIT]
        body = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps))
        draft: dict[str, Any] = {
            "event_id": f"{events[0]['event_id']}:procedure",
            "schema_version": "1",
            "source": "dev_companion",
            "kind": "procedure_draft",
            "summary": f"Companion terminal procedure:\n{body}"[:2000],
            "paths": list(paths)[:50],
            "scrubbed": False,
            "native_session_id": native_session_id,
        }
        if cwd:
            draft["cwd"] = cwd
            draft["workspace_root"] = cwd
        events.append(scrub_event(draft))

    return events


def adapt_companion_session_file(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    return parse_companion_session_lines(
        p.read_text(encoding="utf-8").splitlines(),
        native_session_id=p.stem,
    )
