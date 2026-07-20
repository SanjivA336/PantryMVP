from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.recipe import CreateRecipeRequest, Recipe, RecipeDetail, UpdateRecipeRequest
from app.services import recipes as recipe_service

router = APIRouter(prefix="/households/{household_id}/recipes", tags=["recipes"])


@router.get("", response_model=Envelope[list[Recipe]])
def list_recipes(
    household_id: UUID, _member: Member = Depends(require_household_membership)
) -> Envelope[list[Recipe]]:
    return ok(recipe_service.list_recipes(household_id))


@router.post("", response_model=Envelope[RecipeDetail], status_code=status.HTTP_201_CREATED)
def create_recipe(
    household_id: UUID,
    body: CreateRecipeRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[RecipeDetail]:
    return ok(recipe_service.create_recipe(household_id, caller.id, body))


@router.get("/{recipe_id}", response_model=Envelope[RecipeDetail])
def get_recipe(
    household_id: UUID,
    recipe_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[RecipeDetail]:
    recipe = recipe_service.get_recipe(household_id, recipe_id)
    if recipe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return ok(recipe)


@router.patch("/{recipe_id}", response_model=Envelope[RecipeDetail])
def update_recipe(
    household_id: UUID,
    recipe_id: UUID,
    body: UpdateRecipeRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[RecipeDetail]:
    try:
        recipe = recipe_service.update_recipe(household_id, recipe_id, body)
    except recipe_service.RecipeNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found") from exc
    return ok(recipe)


@router.delete("/{recipe_id}", response_model=Envelope[None])
def delete_recipe(
    household_id: UUID,
    recipe_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    recipe_service.delete_recipe(household_id, recipe_id)
    return ok(None)
