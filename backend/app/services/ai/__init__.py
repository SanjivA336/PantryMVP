from functools import lru_cache

from app.core.config import get_settings
from app.services.ai._ollama import OllamaProvider
from app.services.ai.base import (
    AiOutputParsingError,
    AiProvider,
    AiProviderError,
    AiProviderTimeoutError,
    AiProviderUnavailableError,
)

__all__ = [
    "AiOutputParsingError",
    "AiProvider",
    "AiProviderError",
    "AiProviderTimeoutError",
    "AiProviderUnavailableError",
    "get_ai_provider",
]


@lru_cache
def get_ai_provider() -> AiProvider:
    settings = get_settings()
    if settings.ai_provider == "ollama":
        return OllamaProvider()
    raise ValueError(f"Unknown AI provider: {settings.ai_provider!r}")
