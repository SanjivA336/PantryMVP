-- Add VOIDED as a fifth terminal inventory_items.status: "this item's
-- purchase itself was a mistake" (a typo, a duplicate add, never actually
-- bought), distinct from EMPTY/DISCARDED/EXPIRED/LOST which all describe
-- something happening to real stock. Still just a status flip through the
-- existing discard() RemovalReason path, never a row deletion -- see
-- app/schemas/inventory_item.py's RemovalReason docstring for why.

alter type public.inventory_item_status add value 'VOIDED';
