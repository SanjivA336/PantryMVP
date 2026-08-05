from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import (
    get_current_user_id,
    is_developer,
    require_developer,
    require_household_membership,
)
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.recipe_ai import (
    DraftRecipe,
    GenerateRecipeParams,
    ImportRecipeRequest,
    SubstitutionRequest,
    SubstitutionSuggestion,
)
from app.services import recipe_ai as recipe_ai_service
from app.services.ai import AiOutputParsingError, AiProviderTimeoutError, AiProviderUnavailableError
from app.services.recipe_url_import import RecipeUrlFetchError

router = APIRouter(prefix="/households/{household_id}/recipes/ai", tags=["recipe-ai"])


@router.post("/import", response_model=Envelope[DraftRecipe])
def import_recipe(
    household_id: UUID,
    body: ImportRecipeRequest,
    _member: Member = Depends(require_household_membership),
    user_id: UUID = Depends(get_current_user_id),
) -> Envelope[DraftRecipe]:
    # Only the AI-backed sources (an LLM call) are developer-gated -- "json"
    # is the plain parse-and-reresolve sharing path (see recipe_ai.py's
    # _draft_from_json) and stays open to everyone.
    if body.source in ("text", "url") and not is_developer(user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Developer access required")
    try:
        draft = recipe_ai_service.import_recipe(household_id, body)
    except recipe_ai_service.RecipeShareParsingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RecipeUrlFetchError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except AiProviderUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AiProviderTimeoutError as exc:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc)) from exc
    except AiOutputParsingError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return ok(draft)


@router.post("/generate", response_model=Envelope[DraftRecipe])
def generate_recipe(
    household_id: UUID,
    body: GenerateRecipeParams,
    _member: Member = Depends(require_household_membership),
    _dev: UUID = Depends(require_developer),
) -> Envelope[DraftRecipe]:
    try:
        draft = recipe_ai_service.generate_recipe(household_id, body)
    except AiProviderUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AiProviderTimeoutError as exc:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc)) from exc
    except AiOutputParsingError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return ok(draft)


@router.post("/substitutions", response_model=Envelope[list[SubstitutionSuggestion]])
def suggest_substitutions(
    household_id: UUID,
    body: SubstitutionRequest,
    _member: Member = Depends(require_household_membership),
    _dev: UUID = Depends(require_developer),
) -> Envelope[list[SubstitutionSuggestion]]:
    try:
        suggestions = recipe_ai_service.suggest_substitutions(
            body.ingredient_name,
            body.ingredient_quantity,
            body.ingredient_unit,
            body.recipe_name,
            body.other_ingredient_names,
        )
    except AiProviderUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AiProviderTimeoutError as exc:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc)) from exc
    except AiOutputParsingError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return ok(suggestions)
