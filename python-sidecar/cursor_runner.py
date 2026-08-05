from __future__ import annotations

import os
from collections.abc import Iterator


class CursorRunError(Exception):
    def __init__(self, message: str, code: str = "cursor_error"):
        super().__init__(message)
        self.code = code


class CursorUnauthorizedError(CursorRunError):
    def __init__(self, message: str):
        super().__init__(message, code="cursor_unauthorized")


_AUTH_MARKERS = (
    "unauthorized",
    "auth",
    "401",
    "api key",
    "api_key",
    "invalid key",
    "authentication",
)


def is_auth_error(exc: BaseException) -> bool:
    if isinstance(exc, CursorUnauthorizedError):
        return True
    if isinstance(exc, CursorRunError) and exc.code == "cursor_unauthorized":
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return any(marker in text for marker in _AUTH_MARKERS)


def _raise_if_auth_error(exc: BaseException) -> None:
    if is_auth_error(exc):
        raise CursorUnauthorizedError(str(exc)) from exc


class CursorSdkRunner:
    def __init__(self) -> None:
        self.api_key = os.environ.get("CURSOR_API_KEY")
        self.default_model = os.environ.get("CURSOR_MODEL", "composer-2.5")

    def _require_api_key(self) -> str:
        if not self.api_key:
            raise CursorUnauthorizedError(
                "CURSOR_API_KEY is not set. Create one at "
                "https://cursor.com/dashboard/integrations",
            )
        return self.api_key

    def _resolve_model(self, model: str | None) -> str:
        return model or self.default_model

    def _resolve_cwd(self, cwd: str | None) -> str:
        if cwd:
            return cwd
        env_cwd = os.environ.get("CURSOR_AGENT_CWD")
        if env_cwd:
            return env_cwd
        return os.getcwd()

    def run_complete(
        self,
        prompt: str,
        model: str | None,
        cwd: str | None,
        images: list[dict[str, str]] | None = None,
    ) -> str:
        chunks = list(self.run_stream(prompt, model, cwd, images=images))
        return "".join(chunks)

    def run_stream(
        self,
        prompt: str,
        model: str | None,
        cwd: str | None,
        images: list[dict[str, str]] | None = None,
    ) -> Iterator[str]:
        api_key = self._require_api_key()
        resolved_model = self._resolve_model(model)
        resolved_cwd = self._resolve_cwd(cwd)

        try:
            from cursor_sdk import Agent, LocalAgentOptions

            with Agent.create(
                api_key=api_key,
                model=resolved_model,
                local=LocalAgentOptions(cwd=resolved_cwd),
            ) as agent:
                if images:
                    run = agent.send({"text": prompt, "images": images})
                else:
                    run = agent.send(prompt)
                for event in run.stream():
                    if event.type != "assistant":
                        continue
                    for block in event.message.content:
                        if block.type == "text" and block.text:
                            yield block.text

                result = run.wait()
                if result.status == "error":
                    raise CursorRunError(
                        f"Cursor agent run failed: {result.id}",
                        code="cursor_error",
                    )
        except CursorRunError:
            raise
        except Exception as exc:
            _raise_if_auth_error(exc)
            raise
