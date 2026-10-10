-- PostgREST needs table-level SELECT privileges for bill queries. Row-level
-- security policies continue to restrict rows to the caller's household.
grant select on table public.bills, public.bill_payments, public.bill_skips to authenticated;
