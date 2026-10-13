begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
    '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'bills-owner@test.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.households (id, name) values
    ('72000000-0000-4000-8000-000000000001', 'Bill history household');
insert into public.profiles (id, household_id, name) values
    ('71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Bill owner');

create temporary table bill_ids (key text primary key, id uuid not null);
grant all on pg_temp.bill_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into pg_temp.bill_ids values (
    'skipped', public.create_bill('72000000-0000-4000-8000-000000000001', 'Internet', '2026-10-15', 1::smallint, 6500, 'PLN')
);
select public.skip_bill_cycle((select id from pg_temp.bill_ids where key = 'skipped'), '2026-10-15');
select is((select status from public.bill_payments where bill_id = (select id from pg_temp.bill_ids where key = 'skipped')), 'skipped', 'skipping a cycle writes a skipped history row');
select ok((select paid_on is null and amount_minor is null and currency is null from public.bill_payments where bill_id = (select id from pg_temp.bill_ids where key = 'skipped')), 'skipped history stores no payment date or amount');
select is((select next_due_on::text from public.bills where id = (select id from pg_temp.bill_ids where key = 'skipped')), '2026-11-15', 'skipping still advances the bill schedule');

insert into pg_temp.bill_ids values (
    'paid', public.create_bill('72000000-0000-4000-8000-000000000001', 'Electricity', '2026-10-20', 2::smallint, null, 'EUR')
);
select public.record_bill_payment((select id from pg_temp.bill_ids where key = 'paid'), '2026-10-20', '2026-10-21', 12345);
select is((select status from public.bill_payments where bill_id = (select id from pg_temp.bill_ids where key = 'paid')), 'paid', 'payment writes a paid history row');
select is((select amount_minor::bigint from public.bill_payments where bill_id = (select id from pg_temp.bill_ids where key = 'paid')), 12345::bigint, 'paid rows preserve exact minor-unit amount');
select is((select currency from public.bill_payments where bill_id = (select id from pg_temp.bill_ids where key = 'paid')), 'EUR', 'paid rows preserve their currency');
select is((select paid_on::text from public.bill_payments where bill_id = (select id from pg_temp.bill_ids where key = 'paid')), '2026-10-21', 'paid rows preserve the payment date');

select ok(to_regclass('public.bill_skips') is null, 'the separate skipped-cycle table is removed');
select ok(not has_table_privilege('anon', 'public.bill_payments', 'SELECT'), 'anonymous users cannot read unified bill history');

reset role;
select throws_ok(
    format(
        $$insert into public.bill_payments (bill_id, household_id, due_on, status, paid_on, amount_minor, currency, created_by)
          values ('%s'::uuid, '72000000-0000-4000-8000-000000000001', '2026-12-15', 'skipped', null, 0, null, '71000000-0000-4000-8000-000000000001')$$,
        (select id from pg_temp.bill_ids where key = 'skipped')
    ),
    '23514', null,
    'zero cannot stand in for a skipped bill amount'
);
set constraints all immediate;
select * from finish();
rollback;
