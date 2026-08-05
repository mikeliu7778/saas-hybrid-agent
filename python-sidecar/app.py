from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from cursor_runner import CursorRunError, CursorSdkRunner, is_auth_error


def messages_to_prompt(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        role = message.get("role") or "user"
        content = message.get("content") or ""
        parts.append(f"{role}: {content}")
    return "\n\n".join(parts)


def create_app(runner: CursorSdkRunner | Any | None = None) -> FastAPI:
    if runner is None:
        runner = CursorSdkRunner()

    app = FastAPI()

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/complete")
    async def complete(request: Request) -> Any:
        body = await request.json()
        messages = body.get("messages") or []
        model = body.get("model")
        cwd = body.get("cwd")
        stream = body.get("stream", False)
        prompt = messages_to_prompt(messages)

        if stream:
            return StreamingResponse(
                _sse_events(runner, prompt, model, cwd),
                media_type="text/event-stream",
            )

        try:
            content = runner.run_complete(prompt, model, cwd)
        except CursorRunError as exc:
            return _error_response(exc)
        except Exception as exc:
            if is_auth_error(exc):
                return _error_response(exc, code="cursor_unauthorized")
            raise

        return {
            "content": content,
            "tool_calls": [],
            "finish_reason": "stop",
        }

    return app


def _error_response(exc: BaseException, code: str | None = None) -> JSONResponse:
    if isinstance(exc, CursorRunError):
        error_code = exc.code
    else:
        error_code = code or "cursor_error"
    return JSONResponse(
        status_code=502,
        content={
            "type": "error",
            "code": error_code,
            "message": str(exc),
        },
    )


def _sse_events(
    runner: Any, prompt: str, model: str | None, cwd: str | None
) -> Iterator[str]:
    try:
        for chunk in runner.run_stream(prompt, model, cwd):
            payload = json.dumps({"type": "delta", "text": chunk})
            yield f"data: {payload}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except CursorRunError as exc:
        payload = json.dumps(
            {"type": "error", "code": exc.code, "message": str(exc)}
        )
        yield f"data: {payload}\n\n"
    except Exception as exc:
        if is_auth_error(exc):
            payload = json.dumps(
                {
                    "type": "error",
                    "code": "cursor_unauthorized",
                    "message": str(exc),
                }
            )
            yield f"data: {payload}\n\n"
        else:
            raise


app = create_app()
