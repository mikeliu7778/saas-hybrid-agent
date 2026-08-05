from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from cursor_runner import CursorRunError, CursorSdkRunner, is_auth_error

_MAX_IMAGES = 5


def messages_to_prompt_and_images(
    messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, str]]]:
    parts: list[str] = []
    images: list[dict[str, str]] = []

    for message in messages:
        role = message.get("role") or "user"
        content = message.get("content")
        if isinstance(content, list):
            texts: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                part_type = part.get("type")
                if part_type == "text":
                    texts.append(str(part.get("text") or ""))
                elif part_type == "image_url":
                    parsed = _image_from_part(part)
                    if parsed is not None:
                        images.append(parsed)
            parts.append(f"{role}: {' '.join(texts)}")
        else:
            parts.append(f"{role}: {content or ''}")

    omitted = 0
    if len(images) > _MAX_IMAGES:
        omitted = len(images) - _MAX_IMAGES
        images = images[-_MAX_IMAGES:]

    prompt = "\n\n".join(parts)
    if omitted:
        prompt += "\n[image omitted]"
    return prompt, images


def _image_from_part(part: dict[str, Any]) -> dict[str, str] | None:
    image_url = part.get("image_url")
    if not isinstance(image_url, dict):
        return None
    url = image_url.get("url")
    if not isinstance(url, str) or not url.startswith("data:"):
        return None
    try:
        header, data = url.split(",", 1)
    except ValueError:
        return None
    meta = header[len("data:") :]
    mime_type = meta.split(";", 1)[0] or "application/octet-stream"
    return {"data": data, "mime_type": mime_type}


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
        prompt, images = messages_to_prompt_and_images(messages)

        if stream:
            return StreamingResponse(
                _sse_events(runner, prompt, model, cwd, images),
                media_type="text/event-stream",
            )

        try:
            content = runner.run_complete(prompt, model, cwd, images=images)
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
    runner: Any,
    prompt: str,
    model: str | None,
    cwd: str | None,
    images: list[dict[str, str]] | None = None,
) -> Iterator[str]:
    try:
        for chunk in runner.run_stream(prompt, model, cwd, images=images):
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
