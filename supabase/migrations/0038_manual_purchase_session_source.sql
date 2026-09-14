-- A third way a purchase session gets started, alongside RECEIPT_SCAN and
-- SHOPPING_LIST: opened directly (the "Add item" entry point), with no
-- shopping-list items behind it and no receipt to OCR. Behaves like
-- SHOPPING_LIST for editability purposes (plain PENDING until finalized, no
-- OCR/PROCESSING/COMPLETED states) -- see _EDITABLE_STATUS in
-- app/services/purchase_sessions.py.

alter type public.purchase_session_source add value 'MANUAL';
