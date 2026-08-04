from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
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


def resolve_food_ids(household_id: UUID, names: Sequence[str]) -> dict[str, UUID]:
    """Case-insensitive exact-match lookup against the household's current
    inventory first, then the wider global catalog. Returns a dict from
    each input name to its resolved catalog id; a name with no confident
    match is simply absent from the result -- callers treat that the same
    as "leave it to the user to pick manually" (the existing default for
    any name that doesn't auto-resolve). Deliberately only a
    case-insensitive exact match counts as confident enough to auto-link --
    fuzzy/semantic matching is out of scope for this pass.

    Shared by recipe_ai.py (AI-drafted recipe ingredients) and
    receipt_imports.py (AI- or regex-parsed receipt line items) -- both
    just need "these names, resolved against the catalog," nothing about
    either caller's own object shape.
    """
    unique_names = {n for n in names if n and n.strip()}
    if not unique_names:
        return {}

    client = get_service_client()
    inventory_result = (
        client.table("household_food_variants")
        .select("global_food_definitions(id, name)")
        .eq("household_id", str(household_id))
        .execute()
    )
    inventory_by_name: dict[str, UUID] = {}
    for row in inventory_result.data:
        food = row.get("global_food_definitions")
        if food and food.get("name"):
            inventory_by_name[food["name"].strip().lower()] = UUID(food["id"])

    resolved: dict[str, UUID] = {}
    unmatched: list[str] = []
    for name in unique_names:
        key = name.strip().lower()
        if key in inventory_by_name:
            resolved[name] = inventory_by_name[key]
        else:
            unmatched.append(name)
    if not unmatched:
        return resolved

    # Each remaining name needs its own distinct text search, so this can't
    # collapse into one query -- but the searches are independent of each
    # other, so running them concurrently turns N sequential round trips
    # into roughly one round trip's worth of wall-clock time.
    with ThreadPoolExecutor(max_workers=min(len(unmatched), 8)) as pool:
        results = pool.map(lambda n: search(n, limit=5), unmatched)

    for name, candidates in zip(unmatched, results, strict=True):
        key = name.strip().lower()
        exact = next((c for c in candidates if c.name.strip().lower() == key), None)
        if exact:
            resolved[name] = exact.id

    return resolved


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
