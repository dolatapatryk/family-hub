begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local timezone = 'UTC';

-- Check the complete surface, not just listWallets: writing today's data and
-- archiving after today's movement must use the same day as the balance read.
select ok('TimeZone=Europe/Warsaw' = any(proconfig), proname || ' uses Warsaw business dates')
from pg_proc
where oid in (
 'public.finance_list_wallets(uuid,text,date)'::regprocedure,
 'public.finance_save_wallet(uuid,uuid,uuid,bigint,text,text,text,date,bigint,text,text)'::regprocedure,
 'public.finance_set_wallet_archived(uuid,uuid,uuid,bigint,boolean)'::regprocedure,
 'public.finance_preview_wallet_balance(uuid,uuid,date)'::regprocedure,
 'public.finance_correct_wallet_balance(uuid,uuid,uuid,bigint,text,date,bigint,text)'::regprocedure,
 'public.finance_save_wallet_transaction(uuid,uuid,uuid,bigint,text,date,bigint,uuid,uuid,uuid,text,text)'::regprocedure,
 'public.finance_correct_wallet_opening(uuid,uuid,uuid,bigint,text,date,bigint)'::regprocedure
);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('e5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'wallet-timezone@test.invalid', '', now(), '{}', '{}', now(), now());
insert into public.households(id, name) values ('e5000000-0000-4000-8000-000000000002', 'Wallet timezone test');
insert into public.profiles(id, household_id, name) values ('e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', 'Timezone test');
insert into public.finance_categories(id, household_id, created_by, name, budget_type, allocation_role)
values ('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 'Income', 'income', 'standard');
create temporary table wallet_timezone_values(key text primary key, value jsonb);
grant all on pg_temp.wallet_timezone_values to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into pg_temp.wallet_timezone_values values ('wallet', public.finance_save_wallet(
 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000004', null, null,
 'Today wallet', 'bank', 'household', (now() at time zone 'Europe/Warsaw')::date, 0, null, null
));
select is((select count(*)::integer from public.finance_list_wallets(
 'e5000000-0000-4000-8000-000000000002', 'household', (now() at time zone 'Europe/Warsaw')::date
)), 1, 'Warsaw today is accepted by the wallet list from a UTC session');
select is(current_setting('TimeZone'), 'UTC', 'RPC timezone does not leak into the caller session');

select lives_ok($$select public.finance_save_wallet_transaction(
 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000005', null, null,
 'income', (now() at time zone 'Europe/Warsaw')::date, 100, null,
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet'),
 'e5000000-0000-4000-8000-000000000003', null, 'none'
)$$, 'Today transaction is accepted even before UTC midnight');
select is((select balance_minor from public.finance_list_wallets(
 'e5000000-0000-4000-8000-000000000002', 'household', (now() at time zone 'Europe/Warsaw')::date
)), '100', 'Today balance includes today transaction');

insert into pg_temp.wallet_timezone_values values ('opening', public.finance_preview_wallet_opening_correction(
 'e5000000-0000-4000-8000-000000000002',
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet')
));
select lives_ok($$select public.finance_correct_wallet_opening(
 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000007',
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet'),
 (select (value->>'wallet_version')::bigint from pg_temp.wallet_timezone_values where key = 'opening'),
 (select value->>'snapshot_token' from pg_temp.wallet_timezone_values where key = 'opening'),
 (now() at time zone 'Europe/Warsaw')::date, 0
)$$, 'Today opening correction is accepted');
-- Dated adjustments must follow the opening day, so backdate the opening first.
select public.finance_correct_wallet_opening(
 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000008',
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet'),
 (select (value->>'wallet_version')::bigint from pg_temp.wallet_timezone_values where key = 'opening'),
 (select value->>'snapshot_token' from pg_temp.wallet_timezone_values where key = 'opening'),
 (now() at time zone 'Europe/Warsaw')::date - 1, 0
);

insert into pg_temp.wallet_timezone_values values ('balance', public.finance_preview_wallet_balance(
 'e5000000-0000-4000-8000-000000000002',
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet'),
 (now() at time zone 'Europe/Warsaw')::date
));
select is((select value->>'current_balance_minor' from pg_temp.wallet_timezone_values where key = 'balance'), '100', 'Today correction preview includes today transaction');
select lives_ok($$select public.finance_correct_wallet_balance(
 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000006',
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet'),
 (select (value->>'wallet_version')::bigint from pg_temp.wallet_timezone_values where key = 'balance'),
 (select value->>'snapshot_token' from pg_temp.wallet_timezone_values where key = 'balance'),
 (now() at time zone 'Europe/Warsaw')::date, 200, 'Today correction'
)$$, 'Today balance correction is accepted');

select throws_ok($$select public.finance_set_wallet_archived(
 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000009',
 (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet'),
 (select version from public.finance_wallets where id = (select (value->>'wallet_id')::uuid from pg_temp.wallet_timezone_values where key = 'wallet')),
 true
)$$, '22023', 'A wallet can be archived only with a zero current balance', 'Archive includes today movements before UTC midnight');

select throws_ok($$select public.finance_list_wallets(
 'e5000000-0000-4000-8000-000000000002', 'household', (now() at time zone 'Europe/Warsaw')::date + 1
)$$, '22023', 'Invalid wallet list filters', 'Tomorrow remains invalid');
select throws_ok($$select public.finance_list_wallets(
 'e5000000-0000-4000-8000-000000000002', 'invalid', (now() at time zone 'Europe/Warsaw')::date
)$$, '22023', 'Invalid wallet list filters', 'Invalid scopes remain rejected');

select * from finish();
rollback;
