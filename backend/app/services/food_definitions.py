from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.food_definition import CreateFoodDefinitionRequest, FoodDefinition

_TABLE = "global_food_definitions"


def search(query: str, limit: int = 10) -> list[FoodDefinition]:
    client = get_service_client()
    result = client.rpc(
        "search_global_food_definitions", {"p_query": query, "p_limit": limit}
    ).execute()
    return [FoodDefinition(**row) for row in result.data]


def create(user_id: UUID, body: CreateFoodDefinitionRequest) -> FoodDefinition:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .insert(
            {
                **body.model_dump(mode="json"),
                "created_by_user_id": str(user_id),
                "is_verified": False,
                "usage_count": 0,
            }
        )
        .execute()
    )
    return FoodDefinition(**result.data[0])


def get_by_id(food_definition_id: UUID) -> FoodDefinition | None:
    client = get_service_client()
    result = (
        client.table(_TABLE).select("*").eq("id", str(food_definition_id)).maybe_single().execute()
    )
    return FoodDefinition(**result.data) if result and result.data else None
