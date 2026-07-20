from fastapi import APIRouter

from app.api.routers import households, members, storage_locations

api_router = APIRouter(prefix="/api")
api_router.include_router(households.router)
api_router.include_router(members.router)
api_router.include_router(storage_locations.router)
