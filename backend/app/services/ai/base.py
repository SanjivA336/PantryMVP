from abc import ABC, abstractmethod

from app.schemas.recipe_ai import DraftRecipe, GenerateRecipeParams, SubstitutionSuggestion


class AiProviderError(Exception):
    """Base for every AI-provider failure. Callers (the router) catch the
    specific subclasses below to map each onto a distinct HTTP status --
    "the AI service is down", "it took too long", and "it responded but
    the output was garbage" are three different situations a user should
    be able to tell apart, not one generic "AI failed" message."""


class AiProviderUnavailableError(AiProviderError):
    pass


class AiProviderTimeoutError(AiProviderError):
    pass


class AiOutputParsingError(AiProviderError):
    pass


class AiProvider(ABC):
    """Swap the concrete provider (currently only OllamaProvider) by
    changing `settings.ai_provider` -- nothing outside `services/ai/` and
    `get_ai_provider()` needs to know which one is running."""

    @abstractmethod
    def parse_recipe(self, text: str, *, source_url: str | None = None) -> DraftRecipe: ...

    @abstractmethod
    def generate_recipe(self, params: GenerateRecipeParams) -> DraftRecipe: ...

    @abstractmethod
    def suggest_substitutions(
        self,
        ingredient_name: str,
        ingredient_quantity: str | None,
        ingredient_unit: str | None,
        recipe_name: str | None,
        other_ingredient_names: list[str],
    ) -> list[SubstitutionSuggestion]: ...
