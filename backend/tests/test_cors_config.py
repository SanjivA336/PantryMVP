"""CORS origins come from the CORS_ORIGINS env var, parsed forgivingly.

A deployed backend sets this in a host dashboard, where stray spaces and
trailing commas are easy to introduce; a bad parse would only surface as a
confusing browser-side CORS error, so the parsing is pinned here.
"""

from app.core.config import Settings


def make_settings(monkeypatch, value: str | None) -> Settings:
    if value is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("CORS_ORIGINS", value)
    # _env_file=None: ignore the developer's real .env so the test only sees
    # the environment it set up itself.
    return Settings(_env_file=None)


def test_defaults_to_the_local_dev_servers(monkeypatch) -> None:
    settings = make_settings(monkeypatch, None)
    assert settings.cors_origin_list == ["http://localhost:5173", "http://localhost:5174"]


def test_single_deployed_origin(monkeypatch) -> None:
    settings = make_settings(monkeypatch, "https://burrowapp.site")
    assert settings.cors_origin_list == ["https://burrowapp.site"]


def test_multiple_origins_tolerate_spaces_and_trailing_commas(monkeypatch) -> None:
    settings = make_settings(monkeypatch, " https://burrowapp.site , https://www.burrowapp.site ,")
    assert settings.cors_origin_list == ["https://burrowapp.site", "https://www.burrowapp.site"]


def test_empty_value_allows_no_origins(monkeypatch) -> None:
    # Fails closed: a blank setting must not silently become "allow everything".
    settings = make_settings(monkeypatch, "")
    assert settings.cors_origin_list == []
