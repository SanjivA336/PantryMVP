-- Fixes generate_join_code(): `(random() * length(chars))::int` rounds to
-- nearest in Postgres (not truncate), so it can land on `length(chars)`
-- itself (~1.55% chance per character), one past the last valid index.
-- substr() with an out-of-range start silently returns '', shortening the
-- generated code — which the char(8) column then silently space-padded
-- back up to 8, producing join codes like "9X88BT8 " that no one could
-- ever actually type in. Caught by manual end-to-end verification, not by
-- any automated test, since nothing asserted on join_code's exact shape.

create or replace function public.generate_join_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I, avoids visual ambiguity
  code text;
begin
  loop
    code := (
      select string_agg(substr(chars, floor(random() * length(chars))::int + 1, 1), '')
      from generate_series(1, 8)
    );
    exit when not exists (select 1 from public.households where join_code = code);
  end loop;
  return code;
end;
$$;

-- char(8) silently space-pads short values instead of erroring, which is
-- exactly what masked the bug above — switch to text with an explicit
-- format constraint so any future regression fails loudly instead.
alter table public.households alter column join_code type text;
alter table public.households add constraint join_code_format check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$');
