import httpx
import pytest
from bs4 import BeautifulSoup

from app.services.recipe_url_import import (
    RecipeUrlFetchError,
    _extract_fallback_text,
    _extract_jsonld_recipe_text,
    _normalize_instructions,
    _parse_iso8601_duration_minutes,
    fetch_recipe_text,
)


def _fake_response(text: str, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code, text=text, request=httpx.Request("GET", "http://example.com")
    )


def _html_with_jsonld(jsonld_body: str) -> str:
    return f"""
    <html><head>
    <script type="application/ld+json">{jsonld_body}</script>
    </head><body><p>Some visible page text that isn't the recipe content itself.</p></body></html>
    """


PLAIN_RECIPE_JSONLD = """
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Grilled Cheese",
  "description": "A classic sandwich.",
  "recipeYield": ["2"],
  "prepTime": "PT5M",
  "cookTime": "PT10M",
  "recipeIngredient": ["2 slices bread", "1 slice cheese", "1 tbsp butter"],
  "recipeInstructions": ["Butter the bread.", "Grill until golden."]
}
"""

GRAPH_WRAPPED_JSONLD = """
{
  "@context": "https://schema.org",
  "@graph": [
    {"@type": "WebPage", "name": "Some page"},
    {
      "@type": ["Recipe"],
      "name": "Tomato Soup",
      "recipeIngredient": ["Tomatoes", "Salt"],
      "recipeInstructions": [
        {"@type": "HowToStep", "text": "Simmer tomatoes."},
        {"@type": "HowToStep", "text": "Blend and season."}
      ]
    }
  ]
}
"""

NESTED_SECTIONS_JSONLD = """
{
  "@type": "Recipe",
  "name": "Layered Dip",
  "recipeIngredient": ["Beans", "Cheese"],
  "recipeInstructions": [
    {
      "@type": "HowToSection",
      "name": "Base layer",
      "itemListElement": [
        {"@type": "HowToStep", "text": "Spread beans."},
        {"@type": "HowToStep", "text": "Add cheese."}
      ]
    }
  ]
}
"""


def test_extract_jsonld_plain_recipe() -> None:
    soup = BeautifulSoup(_html_with_jsonld(PLAIN_RECIPE_JSONLD), "html.parser")
    text = _extract_jsonld_recipe_text(soup)
    assert text is not None
    assert "Grilled Cheese" in text
    assert "Servings: 2" in text
    assert "Prep time: 5 minutes" in text
    assert "Cook time: 10 minutes" in text
    assert "- 2 slices bread" in text
    assert "1. Butter the bread." in text
    assert "2. Grill until golden." in text


def test_extract_jsonld_graph_wrapped() -> None:
    soup = BeautifulSoup(_html_with_jsonld(GRAPH_WRAPPED_JSONLD), "html.parser")
    text = _extract_jsonld_recipe_text(soup)
    assert text is not None
    assert "Tomato Soup" in text
    assert "- Tomatoes" in text
    assert "1. Simmer tomatoes." in text
    assert "2. Blend and season." in text


def test_extract_jsonld_nested_howto_sections() -> None:
    soup = BeautifulSoup(_html_with_jsonld(NESTED_SECTIONS_JSONLD), "html.parser")
    text = _extract_jsonld_recipe_text(soup)
    assert text is not None
    assert "1. Base layer" in text
    assert "2. Spread beans." in text
    assert "3. Add cheese." in text


def test_extract_jsonld_no_recipe_returns_none() -> None:
    soup = BeautifulSoup(
        _html_with_jsonld('{"@type": "WebPage", "name": "Not a recipe"}'), "html.parser"
    )
    assert _extract_jsonld_recipe_text(soup) is None


def test_extract_jsonld_malformed_json_returns_none() -> None:
    soup = BeautifulSoup(_html_with_jsonld("{not valid json"), "html.parser")
    assert _extract_jsonld_recipe_text(soup) is None


def test_normalize_instructions_plain_string() -> None:
    assert _normalize_instructions("Step one.\nStep two.\n") == ["Step one.", "Step two."]


def test_normalize_instructions_list_of_strings() -> None:
    assert _normalize_instructions(["Step one.", "Step two."]) == ["Step one.", "Step two."]


def test_normalize_instructions_howto_step_dicts() -> None:
    steps = [{"@type": "HowToStep", "text": "Mix."}, {"@type": "HowToStep", "text": "Bake."}]
    assert _normalize_instructions(steps) == ["Mix.", "Bake."]


def test_normalize_instructions_falls_back_to_name() -> None:
    steps = [{"@type": "HowToStep", "name": "Preheat oven"}]
    assert _normalize_instructions(steps) == ["Preheat oven"]


@pytest.mark.parametrize(
    ("duration", "expected"),
    [
        ("PT1H15M", 75),
        ("PT30M", 30),
        ("PT2H", 120),
        ("PT0M", None),
        (None, None),
        ("not a duration", None),
        (42, None),
    ],
)
def test_parse_iso8601_duration_minutes(duration, expected) -> None:
    assert _parse_iso8601_duration_minutes(duration) == expected


def test_extract_fallback_text_strips_noise_tags() -> None:
    html = """
    <html><body>
    <script>var x = 1;</script>
    <style>.a { color: red; }</style>
    <nav>Nav links</nav>
    <header>Site header</header>
    <p>Real recipe content here.</p>
    <footer>Footer stuff</footer>
    </body></html>
    """
    soup = BeautifulSoup(html, "html.parser")
    text = _extract_fallback_text(soup)
    assert "Real recipe content here." in text
    assert "Nav links" not in text
    assert "Site header" not in text
    assert "Footer stuff" not in text
    assert "var x = 1" not in text


def test_fetch_recipe_text_prefers_jsonld(monkeypatch) -> None:
    response = _fake_response(_html_with_jsonld(PLAIN_RECIPE_JSONLD) + "x" * 200)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: response)

    text = fetch_recipe_text("http://example.com/recipe")

    assert "Grilled Cheese" in text


def test_fetch_recipe_text_falls_back_without_jsonld(monkeypatch) -> None:
    long_paragraph = "This is real recipe content. " * 20
    html = f"<html><body><p>{long_paragraph}</p></body></html>"
    response = _fake_response(html)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: response)

    text = fetch_recipe_text("http://example.com/recipe")

    assert "real recipe content" in text


def test_fetch_recipe_text_too_short_raises(monkeypatch) -> None:
    response = _fake_response("<html><body><p>Too short.</p></body></html>")
    monkeypatch.setattr(httpx, "get", lambda *a, **k: response)

    with pytest.raises(RecipeUrlFetchError):
        fetch_recipe_text("http://example.com/recipe")


def test_fetch_recipe_text_non_200_raises(monkeypatch) -> None:
    response = _fake_response("Not found", status_code=404)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: response)

    with pytest.raises(RecipeUrlFetchError):
        fetch_recipe_text("http://example.com/recipe")


def test_fetch_recipe_text_connect_error_raises(monkeypatch) -> None:
    def _raise(*args, **kwargs):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx, "get", _raise)

    with pytest.raises(RecipeUrlFetchError):
        fetch_recipe_text("http://example.com/recipe")


def test_fetch_recipe_text_timeout_raises(monkeypatch) -> None:
    def _raise(*args, **kwargs):
        raise httpx.TimeoutException("boom")

    monkeypatch.setattr(httpx, "get", _raise)

    with pytest.raises(RecipeUrlFetchError):
        fetch_recipe_text("http://example.com/recipe")


def test_fetch_recipe_text_truncates_long_text(monkeypatch) -> None:
    long_paragraph = "Recipe content sentence. " * 500
    html = f"<html><body><p>{long_paragraph}</p></body></html>"
    response = _fake_response(html)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: response)

    text = fetch_recipe_text("http://example.com/recipe")

    assert len(text) <= 6000
