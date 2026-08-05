from app import messages_to_prompt_and_images


def test_extracts_data_uri_images():
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "describe"},
            {"type": "image_url", "image_url": {
                "url": "data:image/png;base64,aGVsbG8="
            }},
        ],
    }]
    prompt, images = messages_to_prompt_and_images(messages)
    assert "user: describe" in prompt or "describe" in prompt
    assert len(images) == 1
    assert images[0]["mime_type"] == "image/png"
    assert images[0]["data"] == "aGVsbG8="


def test_string_content_unchanged():
    prompt, images = messages_to_prompt_and_images(
        [{"role": "user", "content": "hi"}]
    )
    assert "user: hi" in prompt
    assert images == []


class CapturingRunner:
    def __init__(self):
        self.calls = []

    def run_complete(self, prompt, model, cwd, images=None):
        self.calls.append((prompt, images))
        return "ok"

    def run_stream(self, prompt, model, cwd, images=None):
        self.calls.append((prompt, images))
        yield "ok"


def test_truncates_to_five_images_keeps_newest():
    parts = [{"type": "text", "text": "many images"}]
    for i in range(6):
        parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,img{i}"},
        })
    prompt, images = messages_to_prompt_and_images(
        [{"role": "user", "content": parts}]
    )
    assert len(images) == 5
    assert images[0]["data"] == "img1"
    assert images[4]["data"] == "img5"
    assert "[image omitted]" in prompt


def test_complete_passes_images_to_runner():
    from fastapi.testclient import TestClient
    from app import create_app
    runner = CapturingRunner()
    client = TestClient(create_app(runner))
    r = client.post("/v1/complete", json={
        "stream": False,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "x"},
                {"type": "image_url", "image_url": {
                    "url": "data:image/jpeg;base64,zz"
                }},
            ],
        }],
    })
    assert r.status_code == 200
    assert runner.calls[0][1][0]["mime_type"] == "image/jpeg"
