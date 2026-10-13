begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'savings-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'savings-member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'savings-outsider@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('92000000-0000-4000-8000-000000000001', 'Savings plans household'),
    ('92000000-0000-4000-8000-000000000002', 'Savings plans other household');

insert into public.profiles (id, household_id, name) values
    ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Savings owner'),
    ('91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Savings member'),
    ('91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'Savings outsider');

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, visibility, owner_user_id
) values
    ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Shared account', 'cash', 'household', '91000000-0000-4000-8000-000000000001'),
    ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Owner private account', 'goal', 'private', '91000000-0000-4000-8000-000000000001'),
    ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Member private account', 'cash', 'private', '91000000-0000-4000-8000-000000000002');

create temporary table plan_values (key text primary key, result jsonb not null);
grant all on pg_temp.plan_values to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok(not has_function_privilege('anon', 'public.finance_mutate_savings_plan(uuid,uuid,uuid,bigint,boolean,jsonb)', 'EXECUTE'), 'savings templates require authentication');
select ok(to_regclass('public.finance_savings_plans') is not null, 'saved savings templates remain persistent');
select ok(to_regclass('public.finance_planned_savings_transactions') is null, 'monthly drafts are not stored in a table');
select ok(to_regclass('private.finance_savings_plan_month_loads') is null, 'monthly template loads have no durable marker');
select ok(not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('finance_load_savings_plan', 'finance_accept_savings_plan')
), 'templates have no monthly load or acceptance RPC');

insert into pg_temp.plan_values values ('shared', public.finance_mutate_savings_plan(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    null, null, false,
    '{"name":"Shared monthly template","account_id":"93000000-0000-4000-8000-000000000001","visibility":"household","plan_type":"cash","monthly_amount_minor":"12500","annual_amount_override_minor":null}'::jsonb
));
insert into pg_temp.plan_values values ('private', public.finance_mutate_savings_plan(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002',
    null, null, false,
    '{"name":"Owner template","account_id":"93000000-0000-4000-8000-000000000002","visibility":"private","plan_type":"goal","monthly_amount_minor":"25000","annual_amount_override_minor":"300000"}'::jsonb
));

select is((select (result->>'version')::bigint from pg_temp.plan_values where key = 'shared'), 1::bigint, 'new templates start at version one');
select is((select count(*)::integer from public.finance_savings_plans), 2, 'saving a template creates only saved templates');
select is((select count(*)::integer from public.finance_savings_transactions), 0, 'saving templates does not post savings transactions');
select is((select monthly_amount::bigint from public.finance_savings_plans where name = 'Shared monthly template'), 12500::bigint, 'the template amount remains in the database');

select is(public.finance_mutate_savings_plan(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003',
    (select (result->>'plan_id')::uuid from pg_temp.plan_values where key = 'shared'),
    1, false,
    '{"name":"Updated template","account_id":"93000000-0000-4000-8000-000000000001","visibility":"household","plan_type":"cash","monthly_amount_minor":"15000","annual_amount_override_minor":null}'::jsonb
)->>'version', '2', 'editing a template advances its concurrency version');
select is(public.finance_mutate_savings_plan(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004',
    (select (result->>'plan_id')::uuid from pg_temp.plan_values where key = 'shared'),
    1, false,
    '{"name":"Stale edit","account_id":"93000000-0000-4000-8000-000000000001","visibility":"household","plan_type":"cash","monthly_amount_minor":"1","annual_amount_override_minor":null}'::jsonb
)->>'conflict', 'true', 'stale template edits return a conflict');
select is((select name from public.finance_savings_plans where name = 'Updated template'), 'Updated template', 'a stale template edit does not overwrite current data');

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.finance_savings_plans), 1, 'household members see shared templates but not another member private template');
select is((select name from public.finance_savings_plans), 'Updated template', 'the visible template keeps its saved state');

reset role;
set constraints all immediate;
select * from finish();
rollback;
