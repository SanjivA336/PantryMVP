from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.core.auth import get_current_user_id
from app.core.responses import Envelope, ok
from app.schemas.food_definition import CreateFoodDefinitionRequest, FoodDefinition
from app.services import food_definitions as food_definitions_service

router = APIRouter(prefix="/food-definitions", tags=["food-definitions"])


@router.get("/search", response_model=Envelope[list[FoodDefinition]])
def search_food_definitions(
    query: str = Query(min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    _user_id: UUID = Depends(get_current_user_id),
) -> Envelope[list[FoodDefinition]]:
    return ok(food_definitions_service.search(query, limit))


@router.post("", response_model=Envelope[FoodDefinition], status_code=status.HTTP_201_CREATED)
def create_food_definition(
    body: CreateFoodDefinitionRequest, user_id: UUID = Depends(get_current_user_id)
) -> Envelope[FoodDefinition]:
    return ok(food_definitions_service.create(user_id, body))
