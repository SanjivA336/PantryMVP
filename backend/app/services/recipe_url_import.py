import json
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

_USER_AGENT = "Mozilla/5.0 (compatible; BurrowRecipeImport/1.0)"
_MIN_EXTRACTED_TEXT_LENGTH = 200
_MAX_EXTRACTED_TEXT_LENGTH = 6000
_FETCH_TIMEOUT_SECONDS = 15.0
_DURATION_RE = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?$")


class RecipeUrlFetchError(Exception):
    pass


def fetch_recipe_text(url: str) -> str:
    """Fetches a URL and returns clean-ish text describing the recipe,
    ready to hand to an AiProvider.parse_recipe() call.

    Prefers schema.org Recipe JSON-LD when present (reliable, structured,
    and what nearly every modern recipe site embeds for Google's rich
    snippets) -- this doesn't skip the LLM step, it just gives it much
    better input text than raw page HTML would. Falls back to stripped
    visible page text otherwise.
    """
    try:
        response = httpx.get(
            url,
            timeout=_FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        )
    except httpx.TimeoutException as exc:
        raise RecipeUrlFetchError("Timed out fetching that page.") from exc
    except httpx.RequestError as exc:
        raise RecipeUrlFetchError(f"Couldn't reach that URL: {exc}") from exc

    if response.status_code != 200:
        raise RecipeUrlFetchError(
            f"That page returned an error ({response.status_code}) -- it may block "
            "automated requests, or the link may be dead."
        )

    soup = BeautifulSoup(response.text, "html.parser")
    text = _extract_jsonld_recipe_text(soup) or _extract_fallback_text(soup)

    # Cheap short-circuit for paywalled/JS-rendered pages: we can't fetch
    # what isn't server-rendered, but "we got basically nothing" is easy to
    # detect without burning 10+ seconds on an LLM call over near-empty text.
    if len(text.strip()) < _MIN_EXTRACTED_TEXT_LENGTH:
        raise RecipeUrlFetchError(
            "This page's content couldn't be extracted -- it may require JavaScript or "
            "a login. Try pasting the recipe text instead."
        )
    return text[:_MAX_EXTRACTED_TEXT_LENGTH]


def _extract_jsonld_recipe_text(soup: BeautifulSoup) -> str | None:
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        recipe = _find_recipe_object(data)
        if recipe:
            return _recipe_jsonld_to_text(recipe)
    return None


def _find_recipe_object(data: Any) -> dict | None:
    candidates = data if isinstance(data, list) else [data]
    for item in candidates:
        if not isinstance(item, dict):
            continue
        if "@graph" in item:
            found = _find_recipe_object(item["@graph"])
            if found:
                return found
        type_ = item.get("@type")
        types = type_ if isinstance(type_, list) else [type_]
        if any(isinstance(t, str) and t.lower() == "recipe" for t in types):
            return item
    return None


def _recipe_jsonld_to_text(recipe: dict) -> str:
    lines: list[str] = []

    name = recipe.get("name")
    if name:
        lines.append(f"Recipe name: {name}")
    description = recipe.get("description")
    if description:
        lines.append(f"Description: {description}")

    yield_ = recipe.get("recipeYield")
    if isinstance(yield_, list) and yield_:
        yield_ = yield_[0]
    if yield_:
        lines.append(f"Servings: {yield_}")

    prep_minutes = _parse_iso8601_duration_minutes(recipe.get("prepTime"))
    if prep_minutes is not None:
        lines.append(f"Prep time: {prep_minutes} minutes")
    cook_minutes = _parse_iso8601_duration_minutes(recipe.get("cookTime"))
    if cook_minutes is not None:
        lines.append(f"Cook time: {cook_minutes} minutes")

    ingredients = recipe.get("recipeIngredient") or recipe.get("ingredients") or []
    string_ingredients = [i for i in ingredients if isinstance(i, str)]
    if string_ingredients:
        lines.append("Ingredients:")
        lines.extend(f"- {ingredient}" for ingredient in string_ingredients)

    steps = _normalize_instructions(recipe.get("recipeInstructions") or [])
    if steps:
        lines.append("Instructions:")
        lines.extend(f"{i}. {step}" for i, step in enumerate(steps, start=1))

    return "\n".join(lines)


def _normalize_instructions(instructions: Any) -> list[str]:
    """schema.org allows recipeInstructions as a single string, a list of
    strings, or a list of HowToStep/HowToSection objects (which can nest
    further steps inside itemListElement) -- normalize all of them to a
    flat list of step strings."""
    if isinstance(instructions, str):
        return [line.strip() for line in instructions.split("\n") if line.strip()]

    steps: list[str] = []
    for item in instructions:
        if isinstance(item, str):
            steps.append(item)
        elif isinstance(item, dict):
            text = item.get("text") or item.get("name")
            if text:
                steps.append(text)
            nested = item.get("itemListElement")
            if nested:
                steps.extend(_normalize_instructions(nested))
    return steps


def _parse_iso8601_duration_minutes(duration: Any) -> int | None:
    if not isinstance(duration, str):
        return None
    match = _DURATION_RE.match(duration.strip())
    if not match:
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    total = hours * 60 + minutes
    return total or None


def _extract_fallback_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)
