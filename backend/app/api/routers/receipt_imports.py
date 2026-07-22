from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.receipt_import import (
    CreateReceiptImportSessionRequest,
    CreateReceiptImportSessionResponse,
    ReceiptImportItem,
    ReceiptImportSession,
    ReceiptImportSessionWithItems,
    UpdateReceiptImportItemRequest,
)
from app.services import receipt_imports as receipt_import_service

router = APIRouter(
    prefix="/households/{household_id}/receipt-import-sessions", tags=["receipt-imports"]
)


@router.post(
    "",
    response_model=Envelope[CreateReceiptImportSessionResponse],
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    household_id: UUID,
    body: CreateReceiptImportSessionRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[CreateReceiptImportSessionResponse]:
    return ok(receipt_import_service.create_session(household_id, caller.id, body.filename))


@router.get("", response_model=Envelope[list[ReceiptImportSession]])
def list_sessions(
    household_id: UUID,
    status_filter: str | None = Query(default=None, alias="status"),
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[ReceiptImportSession]]:
    return ok(receipt_import_service.list_for_household(household_id, status_filter))


@router.get("/{session_id}", response_model=Envelope[ReceiptImportSessionWithItems])
def get_session(
    household_id: UUID,
    session_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ReceiptImportSessionWithItems]:
    session = receipt_import_service.get_by_id(household_id, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt import session not found")
    return ok(session)


@router.post("/{session_id}/process", response_model=Envelope[ReceiptImportSessionWithItems])
def process_session(
    household_id: UUID,
    session_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ReceiptImportSessionWithItems]:
    try:
        session = receipt_import_service.process_session(household_id, session_id)
    except receipt_import_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt import session not found") from exc
    except receipt_import_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session is not in a processable state: {exc}"
        ) from exc
    return ok(session)


@router.patch("/{session_id}/items/{item_id}", response_model=Envelope[ReceiptImportItem])
def update_item(
    household_id: UUID,
    session_id: UUID,
    item_id: UUID,
    body: UpdateReceiptImportItemRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ReceiptImportItem]:
    try:
        item = receipt_import_service.update_item(household_id, session_id, item_id, body)
    except receipt_import_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt import session not found") from exc
    except receipt_import_service.ItemNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt import item not found") from exc
    except receipt_import_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session items can't be edited in this state: {exc}"
        ) from exc
    return ok(item)


@router.post("/{session_id}/finalize", response_model=Envelope[ReceiptImportSessionWithItems])
def finalize_session(
    household_id: UUID,
    session_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[ReceiptImportSessionWithItems]:
    try:
        session = receipt_import_service.finalize(household_id, session_id, caller.id)
    except receipt_import_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt import session not found") from exc
    except receipt_import_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session is not ready to finalize: {exc}"
        ) from exc
    except receipt_import_service.FinalizeValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return ok(session)
