from __future__ import annotations

import re
from typing import Any

_SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bcrsr_[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b", re.I),
    re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
        r"[\s\S]*?"
        r"-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    ),
]


def scrub_text(text: str) -> str:
    out = text
    for pattern in _SECRET_PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out


def scrub_event(event: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(event)
    cleaned["summary"] = scrub_text(str(cleaned.get("summary") or ""))
    if "skill_hint" in cleaned and cleaned["skill_hint"] is not None:
        cleaned["skill_hint"] = scrub_text(str(cleaned["skill_hint"]))
    paths = cleaned.get("paths") or []
    cleaned["paths"] = [scrub_text(str(p)) for p in paths]
    cleaned["scrubbed"] = True
    return cleaned
