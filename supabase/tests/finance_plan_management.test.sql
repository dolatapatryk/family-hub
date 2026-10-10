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
    ('92000000-0000-4000-8000-000000000001', 'Savings mutations household'),
    ('92000000-0000-4000-8000-000000000002', 'Savings mutations other household');

insert into public.profiles (id, household_id, name) values
    ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Savings owner'),
    ('91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Savings member'),
    ('91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'Savings outsider');

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, visibility, owner_user_id, is_archived
) values
    ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Shared account', 'cash', 'household', '91000000-0000-4000-8000-000000000001', false),
    ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Owner private account', 'goal', 'private', '91000000-0000-4000-8000-000000000001', false),
    ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Member private account', 'cash', 'private', '91000000-0000-4000-8000-000000000002', false),
    ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Archived account', 'cash', 'household', '91000000-0000-4000-8000-000000000001', true),
    ('93000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Second shared account', 'cash', 'household', '91000000-0000-4000-8000-000000000002', false);

insert into public.finance_months (id, household_id, created_by, month_start) values
('97000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-10-01');
create temporary table plan_values (key text primary key, result jsonb);
grant all on pg_temp.plan_values to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(not has_function_privilege('anon', 'public.finance_mutate_savings_plan(uuid,uuid,uuid,bigint,boolean,jsonb)', 'EXECUTE'), 'plans require authentication');
select ok(not has_function_privilege('anon', 'public.finance_load_savings_plan(uuid,uuid,uuid)', 'EXECUTE'), 'loading requires authentication');
select ok(not has_table_privilege('authenticated', 'private.finance_savings_plan_month_loads', 'SELECT'), 'durable load markers are private');
insert into pg_temp.plan_values values ('shared', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', null, null, false, '{"name": "Shared", "account_id": "93000000-0000-4000-8000-000000000001", "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 1}'::jsonb));
insert into pg_temp.plan_values values ('same_account', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', null, null, false, '{"name": "Duplicate account", "account_id": "93000000-0000-4000-8000-000000000001", "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "200", "annual_amount_override_minor": null, "sort_order": 2}'::jsonb));
insert into pg_temp.plan_values values ('private', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003', null, null, false, '{"name": "Private", "account_id": "93000000-0000-4000-8000-000000000002", "visibility": "private", "plan_type": "goal", "monthly_amount_minor": "300", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb));
insert into pg_temp.plan_values values ('archived', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', null, null, false, '{"name": "Archived", "account_id": "93000000-0000-4000-8000-000000000004", "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb));
insert into pg_temp.plan_values values ('zero', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000005', null, null, false, '{"name": "Zero", "account_id": "93000000-0000-4000-8000-000000000005", "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "0", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb));
insert into pg_temp.plan_values values ('irregular', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000006', null, null, false, '{"name": "Irregular", "account_id": null, "visibility": "household", "plan_type": "irregular", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb));
insert into pg_temp.plan_values values ('unlinked', public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000007', null, null, false, '{"name": "Unlinked", "account_id": null, "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb));
select is(public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003', null, null, false, '{"name": "Private", "account_id": "93000000-0000-4000-8000-000000000002", "visibility": "private", "plan_type": "goal", "monthly_amount_minor": "300", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb), (select result from pg_temp.plan_values where key='private'), 'plan create retry is idempotent');
select throws_ok($$select public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000008', null, null, false, '{"name": "Other private", "account_id": "93000000-0000-4000-8000-000000000003", "visibility": "private", "plan_type": "cash", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb)$$, '42501', null, 'cannot bind another members private account');
insert into pg_temp.plan_values values ('loaded', public.finance_load_savings_plan('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001'));
select is(jsonb_array_length((select result->'generated' from pg_temp.plan_values where key='loaded')), 2, 'one shared and one private linked plan produce drafts');
select is(public.finance_load_savings_plan('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001'), (select result from pg_temp.plan_values where key='loaded'), 'lost-response load retry returns the original draft IDs');
select is((select count(*)::integer from public.finance_planned_savings_transactions), 2, 'retries do not add drafts');
select ok(exists(select 1 from pg_temp.plan_values, jsonb_array_elements(result->'skipped') entry where key='loaded' and entry->>'reason'='archived_account'), 'loading reports archived_account');
select ok(exists(select 1 from pg_temp.plan_values, jsonb_array_elements(result->'skipped') entry where key='loaded' and entry->>'reason'='zero_amount'), 'loading reports zero_amount');
select ok(exists(select 1 from pg_temp.plan_values, jsonb_array_elements(result->'skipped') entry where key='loaded' and entry->>'reason'='irregular_plan'), 'loading reports irregular_plan');
select ok(exists(select 1 from pg_temp.plan_values, jsonb_array_elements(result->'skipped') entry where key='loaded' and entry->>'reason'='unlinked_plan'), 'loading reports unlinked_plan');
select ok(exists(select 1 from pg_temp.plan_values, jsonb_array_elements(result->'skipped') entry where key='loaded' and entry->>'reason'='account_already_planned'), 'loading reports account_already_planned');
select throws_ok($$select public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000009', (select (result->>'plan_id')::uuid from pg_temp.plan_values where key='private'), 1, true, null)$$, '22023', null, 'pending drafts block plan deletion');
select throws_ok($$select public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000010', (select (result->>'plan_id')::uuid from pg_temp.plan_values where key='private'), 1, false, '{"name": "Private", "account_id": null, "visibility": "private", "plan_type": "goal", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb)$$, '22023', null, 'pending drafts block account relinking');
select public.finance_accept_savings_plan('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001');
insert into pg_temp.plan_values values ('reloaded', public.finance_load_savings_plan('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001'));
select is(jsonb_array_length((select result->'generated' from pg_temp.plan_values where key='reloaded')), 0, 'new requests cannot regenerate accepted drafts, including another plan for the same account');
select is((select count(*)::integer from public.finance_savings_transactions), 2, 'loading plans does not post transactions');
select public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000011', (select (result->>'plan_id')::uuid from pg_temp.plan_values where key='shared'), 1, false, '{"name": "Updated shared", "account_id": "93000000-0000-4000-8000-000000000001", "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "555", "annual_amount_override_minor": null, "sort_order": 1}'::jsonb);
select is(public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000012', (select (result->>'plan_id')::uuid from pg_temp.plan_values where key='shared'), 1, false, '{"name": "Stale", "account_id": "93000000-0000-4000-8000-000000000001", "visibility": "household", "plan_type": "cash", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb)->>'conflict', 'true', 'stale plan edits return a conflict');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000013', (select (result->>'plan_id')::uuid from pg_temp.plan_values where key='private'), 1, true, null)$$, '42501', null, 'other members cannot delete private plans');
select throws_ok($$select public.finance_mutate_savings_plan('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000014', (select (result->>'plan_id')::uuid from pg_temp.plan_values where key='shared'), 2, false, '{"name": "Hide shared", "account_id": null, "visibility": "private", "plan_type": "cash", "monthly_amount_minor": "100", "annual_amount_override_minor": null, "sort_order": 0}'::jsonb)$$, '42501', null, 'other members cannot change shared plan scope');
select is(jsonb_array_length(public.finance_load_savings_plan('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000004', '97000000-0000-4000-8000-000000000001')->'generated'), 0, 'another member cannot regenerate shared drafts after acceptance');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.finance_load_savings_plan('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000005', '97000000-0000-4000-8000-000000000001')$$, '42501', null, 'outsiders cannot load plans');
reset role;
set constraints all immediate;
select * from finish();
rollback;
