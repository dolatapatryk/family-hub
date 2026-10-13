begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
    '91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'accept-owner@test.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.households (id, name) values
    ('92000000-0000-4000-8000-000000000001', 'Savings posting household');
insert into public.profiles (id, household_id, name) values
    ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Savings owner');
insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, visibility, owner_user_id
) values (
    '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'Savings account', 'cash', 'household',
    '91000000-0000-4000-8000-000000000001'
);

create temporary table posted_result (result jsonb not null);
grant all on pg_temp.posted_result to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into pg_temp.posted_result values (public.finance_save_transaction(
    '92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001',
    null, null, '93000000-0000-4000-8000-000000000001', '2026-10-01',
    12505, 'Monthly savings plan', false
));
select is((select transaction_date::text from public.finance_savings_transactions where description = 'Monthly savings plan'), '2026-10-01', 'accepted monthly plan is posted as a real transaction dated on the month start');
select is((select amount::bigint from public.finance_savings_transactions where description = 'Monthly savings plan'), 12505::bigint, 'the accepted amount is stored as exact minor units');
select is((select count(*)::integer from public.finance_savings_transactions), 1, 'acceptance creates one transaction');

select is(public.finance_save_transaction(
    '92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001',
    null, null, '93000000-0000-4000-8000-000000000001', '2026-10-01',
    12505, 'Monthly savings plan', false
), (select result from pg_temp.posted_result), 'a retry of the same accepted plan item returns its original transaction');
select is((select count(*)::integer from public.finance_savings_transactions), 1, 'retry does not duplicate the savings transaction');

reset role;
set constraints all immediate;
select * from finish();
rollback;
