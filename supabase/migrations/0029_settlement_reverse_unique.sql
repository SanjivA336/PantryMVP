-- Close a concurrent double-reverse race on settlement_records.
--
-- reverse_settlement (services/settlements.py) checks "does a reversal
-- already point at this settlement?" and then inserts one -- a check-then-
-- act with a TOCTOU gap. Two DELETE .../settlement-records/{id} requests
-- landing together both see no existing reversal and both insert one, so
-- the settlement gets cancelled twice and compute_balances nets it out
-- twice (balance wrong by the settlement amount, permanently).
--
-- Make the existing partial index UNIQUE: at most one reversal row may
-- point at any given settlement. The second concurrent insert now fails
-- with a unique violation, which the service catches and turns into the
-- same "already reversed" 409 the check-then-act path returns.

drop index if exists public.settlement_records_reverses_idx;

create unique index settlement_records_reverses_uniq
  on public.settlement_records (reverses_settlement_id)
  where reverses_settlement_id is not null;
