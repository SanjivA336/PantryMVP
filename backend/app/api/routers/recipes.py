from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_current_user_id, require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.recipe import CreateRecipeRequest, Recipe, RecipeDetail, UpdateRecipeRequest
from app.services import recipes as recipe_service

# Still nested under a household in the URL -- not because recipes belong to
# one (they're a personal recipe box now, see the 0023 migration), but
# because ingredient availability is always checked against whichever
# kitchen's pantry you're currently viewing from, and require_household_membership
# is what gates that access. The recipes returned are always the caller's
# own, regardless of household_id.
router = APIRouter(prefix="/households/{household_id}/recipes", tags=["recipes"])


@router.get("", response_model=Envelope[list[Recipe]])
def list_recipes(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
    user_id: UUID = Depends(get_current_user_id),
) -> Envelope[list[Recipe]]:
    return ok(recipe_service.list_recipes(user_id))


@router.post("", response_model=Envelope[RecipeDetail], status_code=status.HTTP_201_CREATED)
def create_recipe(
    household_id: UUID,
    body: CreateRecipeRequest,
    _member: Member = Depends(require_household_membership),
    user_id: UUID = Depends(get_current_user_id),
) -> Envelope[RecipeDetail]:
    return ok(recipe_service.create_recipe(household_id, user_id, body))


@router.get("/{recipe_id}", response_model=Envelope[RecipeDetail])
def get_recipe(
    household_id: UUID,
    recipe_id: UUID,
    _member: Member = Depends(require_household_membership),
    user_id: UUID = Depends(get_current_user_id),
) -> Envelope[RecipeDetail]:
    recipe = recipe_service.get_recipe(household_id, user_id, recipe_id)
    if recipe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return ok(recipe)


@router.patch("/{recipe_id}", response_model=Envelope[RecipeDetail])
def update_recipe(
    household_id: UUID,
    recipe_id: UUID,
    body: UpdateRecipeRequest,
    _member: Member = Depends(require_household_membership),
    user_id: UUID = Depends(get_current_user_id),
) -> Envelope[RecipeDetail]:
    try:
        recipe = recipe_service.update_recipe(household_id, user_id, recipe_id, body)
    except recipe_service.RecipeNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found") from exc
    return ok(recipe)


@router.delete("/{recipe_id}", response_model=Envelope[None])
def delete_recipe(
    household_id: UUID,
    recipe_id: UUID,
    _member: Member = Depends(require_household_membership),
    user_id: UUID = Depends(get_current_user_id),
) -> Envelope[None]:
    deleted = recipe_service.delete_recipe(user_id, recipe_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return ok(None)
