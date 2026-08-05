from cursor_runner import CursorSdkRunner, is_auth_error


def test_resolve_cwd_prefers_request_then_env(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    runner = CursorSdkRunner()

    assert runner._resolve_cwd("/explicit/cwd") == "/explicit/cwd"

    monkeypatch.delenv("CURSOR_AGENT_CWD", raising=False)
    assert runner._resolve_cwd(None) == str(tmp_path)

    monkeypatch.setenv("CURSOR_AGENT_CWD", "/from-env")
    assert runner._resolve_cwd(None) == "/from-env"


def test_is_auth_error_detects_common_markers():
    assert is_auth_error(Exception("401 Unauthorized: invalid api key"))
    assert is_auth_error(Exception("Authentication failed"))
    assert not is_auth_error(Exception("connection reset"))


def test_missing_api_key_is_auth_error():
    runner = CursorSdkRunner()
    runner.api_key = None
    try:
        runner._require_api_key()
    except Exception as exc:
        assert is_auth_error(exc)
    else:
        raise AssertionError("expected CursorUnauthorizedError")
