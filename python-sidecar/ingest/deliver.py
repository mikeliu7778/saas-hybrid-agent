from __future__ import annotations

from typing import Any

# Map ingest_event snake_case → client-agent camelCase
_FIELD_MAP = {
    "event_id": "eventId",
    "schema_version": "schemaVersion",
    "native_session_id": "nativeSessionId",
    "ts_start": "tsStart",
    "ts_end": "tsEnd",
    "workspace_root": "workspaceRoot",
    "skill_hint": "skillHint",
    "account_hint": "accountHint",
    "device_id": "deviceId",
}


def to_client_event(event: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in event.items():
        out[_FIELD_MAP.get(k, k)] = v
    return out


def to_client_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [to_client_event(e) for e in events]


async def deliver_events(url: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    """POST camelCase events to client-agent local ingest endpoint."""
    import httpx

    payload = {"events": to_client_events(events)}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()
