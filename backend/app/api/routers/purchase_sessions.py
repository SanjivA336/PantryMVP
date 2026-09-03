from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import require_developer, require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.purchase_session import (
    CreateReceiptSessionRequest,
    CreateReceiptSessionResponse,
    PurchaseSession,
    PurchaseSessionItem,
    PurchaseSessionWithItems,
    UpdatePurchaseSessionItemRequest,
)
from app.services import purchase_sessions as purchase_session_service

# A purchase session is the shared review-and-finalize flow behind both the
# shopping list's "bought marked items" wizard and receipt scanning. Only
# the two OCR/AI-backed routes (creating a session from an uploaded photo,
# and running OCR on it) are gated to developer accounts -- everything else
# is a plain household-member operation.
router = APIRouter(
    prefix="/households/{household_id}/purchase-sessions", tags=["purchase-sessions"]
)


@router.post(
    "/receipt",
    response_model=Envelope[CreateReceiptSessionResponse],
    status_code=status.HTTP_201_CREATED,
)
def create_receipt_session(
    household_id: UUID,
    body: CreateReceiptSessionRequest,
    caller: Member = Depends(require_household_membership),
    _dev: UUID = Depends(require_developer),
) -> Envelope[CreateReceiptSessionResponse]:
    return ok(
        purchase_session_service.create_receipt_session(household_id, caller.id, body.filename)
    )


@router.post(
    "/from-shopping-list",
    response_model=Envelope[PurchaseSessionWithItems],
    status_code=status.HTTP_201_CREATED,
)
def create_from_shopping_list(
    household_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[PurchaseSessionWithItems]:
    try:
        session = purchase_session_service.create_from_shopping_list(household_id, caller.id)
    except purchase_session_service.NothingToBuyError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "No shopping-list items are checked off"
        ) from exc
    return ok(session)


@router.get("", response_model=Envelope[list[PurchaseSession]])
def list_sessions(
    household_id: UUID,
    source: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[PurchaseSession]]:
    return ok(purchase_session_service.list_for_household(household_id, source, status_filter))


@router.get("/{session_id}", response_model=Envelope[PurchaseSessionWithItems])
def get_session(
    household_id: UUID,
    session_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[PurchaseSessionWithItems]:
    session = purchase_session_service.get_by_id(household_id, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found")
    return ok(session)


@router.delete("/{session_id}", response_model=Envelope[None])
def delete_session(
    household_id: UUID,
    session_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    try:
        purchase_session_service.delete_session(household_id, session_id)
    except purchase_session_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found") from exc
    except purchase_session_service.InvalidSessionStateError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "A finalized order can't be deleted") from exc
    return ok(None)


@router.post("/{session_id}/process", response_model=Envelope[PurchaseSessionWithItems])
def process_session(
    household_id: UUID,
    session_id: UUID,
    _member: Member = Depends(require_household_membership),
    _dev: UUID = Depends(require_developer),
) -> Envelope[PurchaseSessionWithItems]:
    try:
        session = purchase_session_service.process_session(household_id, session_id)
    except purchase_session_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found") from exc
    except purchase_session_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session is not in a processable state: {exc}"
        ) from exc
    return ok(session)


@router.post("/{session_id}/items", response_model=Envelope[PurchaseSessionItem])
def add_item(
    household_id: UUID,
    session_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[PurchaseSessionItem]:
    try:
        item = purchase_session_service.add_blank_item(household_id, session_id)
    except purchase_session_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found") from exc
    except purchase_session_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session items can't be edited in this state: {exc}"
        ) from exc
    return ok(item)


@router.patch("/{session_id}/items/{item_id}", response_model=Envelope[PurchaseSessionItem])
def update_item(
    household_id: UUID,
    session_id: UUID,
    item_id: UUID,
    body: UpdatePurchaseSessionItemRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[PurchaseSessionItem]:
    try:
        item = purchase_session_service.update_item(household_id, session_id, item_id, body)
    except purchase_session_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found") from exc
    except purchase_session_service.ItemNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Line not found") from exc
    except purchase_session_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session items can't be edited in this state: {exc}"
        ) from exc
    return ok(item)


@router.delete("/{session_id}/items/{item_id}", response_model=Envelope[None])
def remove_item(
    household_id: UUID,
    session_id: UUID,
    item_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    try:
        purchase_session_service.remove_item(household_id, session_id, item_id)
    except purchase_session_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found") from exc
    except purchase_session_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session items can't be edited in this state: {exc}"
        ) from exc
    return ok(None)


@router.post("/{session_id}/finalize", response_model=Envelope[PurchaseSessionWithItems])
def finalize_session(
    household_id: UUID,
    session_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[PurchaseSessionWithItems]:
    try:
        session = purchase_session_service.finalize(household_id, session_id, caller.id)
    except purchase_session_service.SessionNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase session not found") from exc
    except purchase_session_service.InvalidSessionStateError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Session is not ready to finalize: {exc}"
        ) from exc
    except purchase_session_service.FinalizeValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return ok(session)
