"""Structural smoke tests against a real local Ollama instance.

Only assert structural properties (non-empty name, at least one ingredient,
at least one instruction) -- never specific content. llama2 is a small
model and its exact output varies run to run; the mandatory human-review-
before-persist UX (not these tests) is what actually guards output quality.

Requires `ollama serve` running locally with the configured model
(settings.ollama_model, default "llama2") already pulled. Run explicitly:
`uv run pytest -m ollama`.
"""

import pytest

from app.schemas.recipe_ai import GenerateRecipeParams
from app.services.ai._ollama import OllamaProvider

pytestmark = pytest.mark.ollama


@pytest.fixture
def provider() -> OllamaProvider:
    return OllamaProvider()


def test_parse_recipe_from_text(provider: OllamaProvider) -> None:
    text = """
    Grilled Cheese Sandwich

    Ingredients:
    - 2 slices of bread
    - 1 slice of cheddar cheese
    - 1 tablespoon of butter

    Instructions:
    1. Butter one side of each slice of bread.
    2. Place cheese between the slices, buttered sides out.
    3. Grill in a pan over medium heat until golden brown on both sides.
    """

    draft = provider.parse_recipe(text)

    assert draft.name
    assert len(draft.ingredients) >= 1
    assert len(draft.instructions) >= 1


def test_generate_recipe_from_params(provider: OllamaProvider) -> None:
    params = GenerateRecipeParams(cuisines=["Italian"], max_total_time_minutes=45)

    draft = provider.generate_recipe(params)

    assert draft.name
    assert len(draft.ingredients) >= 1
    assert len(draft.instructions) >= 1


def test_suggest_substitutions(provider: OllamaProvider) -> None:
    suggestions = provider.suggest_substitutions(
        "buttermilk", "1", "cup", "Pancakes", ["flour", "sugar", "eggs"]
    )

    assert len(suggestions) >= 1
    assert all(s.name for s in suggestions)
