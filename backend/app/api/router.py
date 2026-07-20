from fastapi import APIRouter

from app.api.routers import (
    food_definitions,
    households,
    inventory_items,
    ledger,
    members,
    recipes,
    shopping_list,
    storage_locations,
    warnings,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(households.router)
api_router.include_router(members.router)
api_router.include_router(storage_locations.router)
api_router.include_router(food_definitions.router)
api_router.include_router(inventory_items.router)
api_router.include_router(ledger.router)
api_router.include_router(warnings.router)
api_router.include_router(shopping_list.router)
api_router.include_router(recipes.router)
