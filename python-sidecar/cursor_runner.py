from __future__ import annotations

import os
from collections.abc import Iterator


class CursorRunError(Exception):
    def __init__(self, message: str, code: str = "cursor_error"):
        super().__init__(message)
        self.code = code


class CursorSdkRunner:
    def __init__(self) -> None:
        self.api_key = os.environ.get("CURSOR_API_KEY")
        self.default_model = os.environ.get("CURSOR_MODEL", "composer-2.5")

    def _require_api_key(self) -> str:
        if not self.api_key:
            raise CursorRunError(
                "CURSOR_API_KEY is not set. Create one at "
                "https://cursor.com/dashboard/integrations",
                code="cursor_unauthorized",
            )
        return self.api_key

    def _resolve_model(self, model: str | None) -> str:
        return model or self.default_model

    def _resolve_cwd(self, cwd: str | None) -> str:
        return cwd or os.getcwd()

    def run_complete(self, prompt: str, model: str | None, cwd: str | None) -> str:
        chunks = list(self.run_stream(prompt, model, cwd))
        return "".join(chunks)

    def run_stream(
        self, prompt: str, model: str | None, cwd: str | None
    ) -> Iterator[str]:
        api_key = self._require_api_key()
        resolved_model = self._resolve_model(model)
        resolved_cwd = self._resolve_cwd(cwd)

        from cursor_sdk import Agent, LocalAgentOptions

        with Agent.create(
            api_key=api_key,
            model=resolved_model,
            local=LocalAgentOptions(cwd=resolved_cwd),
        ) as agent:
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
