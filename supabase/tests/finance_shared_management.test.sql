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

create temporary table shared_values (key text primary key, result jsonb);
grant all on pg_temp.shared_values to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(not has_function_privilege('anon', 'public.finance_mutate_shared_record(uuid,uuid,text,uuid,bigint,boolean,jsonb)', 'EXECUTE'), 'shared mutations require authentication');
select ok(not has_column_privilege('authenticated', 'public.finance_projects', 'is_archived', 'UPDATE'), 'clients cannot bypass project mutation versions');
select ok(not has_table_privilege('authenticated', 'public.finance_projects', 'DELETE'), 'clients cannot cascade-delete project history');
select ok(not has_column_privilege('authenticated', 'public.finance_irregular_expense_plans', 'annual_amount', 'UPDATE'), 'clients cannot bypass reserve versions');
insert into pg_temp.shared_values values ('reserve', public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', 'reserve', null, null, false, '{"name": "Insurance", "amount_minor": "10001"}'::jsonb)), ('project', public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002', 'project', null, null, false, '{"name": "Kitchen", "target_budget_minor": "10000", "is_archived": false}'::jsonb));
select is(public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', 'reserve', null, null, false, '{"name": "Insurance", "amount_minor": "10001"}'::jsonb), (select result from pg_temp.shared_values where key='reserve'), 'reserve create is retry-safe');
select is(public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002', 'project', null, null, false, '{"name": "Kitchen", "target_budget_minor": "10000", "is_archived": false}'::jsonb), (select result from pg_temp.shared_values where key='project'), 'project create is retry-safe');
insert into pg_temp.shared_values values ('expense', public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000003', 'expense', null, null, false, jsonb_build_object('name', 'Cabinets', 'amount_minor', '12345', 'expense_date', null, 'project_id', (select result->>'id' from pg_temp.shared_values where key='project')))), ('refund', public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000004', 'expense', null, null, false, jsonb_build_object('name', 'Refund', 'amount_minor', '-2345', 'expense_date', '2026-10-11', 'project_id', (select result->>'id' from pg_temp.shared_values where key='project'))));
select is(public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000003', 'expense', null, null, false, jsonb_build_object('name', 'Cabinets', 'amount_minor', '12345', 'expense_date', null, 'project_id', (select result->>'id' from pg_temp.shared_values where key='project'))), (select result from pg_temp.shared_values where key='expense'), 'expense create returns its original ID on retry');
select is((select sum(amount)::text from public.finance_project_expenses), '10000', 'signed refunds reduce project expenses exactly');
select ok((select expense_date is null from public.finance_project_expenses where name='Cabinets'), 'missing dates remain null');
select is((select count(*)::integer from public.finance_budget_items), 0, 'project expenses do not create budget rows');
select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000005', 'reserve', (select (result->>'id')::uuid from pg_temp.shared_values where key='reserve'), 1, false, '{"name": "Insurance", "amount_minor": "12000"}'::jsonb);
select is(public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000006', 'reserve', (select (result->>'id')::uuid from pg_temp.shared_values where key='reserve'), 1, false, '{"name": "Stale", "amount_minor": "1"}'::jsonb)->>'conflict', 'true', 'stale reserve edits do not overwrite changes');
select throws_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000007', 'project', (select (result->>'id')::uuid from pg_temp.shared_values where key='project'), 1, true, null)$$, '22023', null, 'projects with history cannot be deleted');
select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000008', 'project', (select (result->>'id')::uuid from pg_temp.shared_values where key='project'), 1, false, '{"name": "Kitchen", "target_budget_minor": "10000", "is_archived": true}'::jsonb);
select is((select count(*)::integer from public.finance_project_expenses), 2, 'archiving preserves expenses');
select throws_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000009', 'expense', null, null, false, jsonb_build_object('name', 'Cabinets', 'amount_minor', '12345', 'expense_date', null, 'project_id', (select result->>'id' from pg_temp.shared_values where key='project')))$$, '22023', null, 'archived project cannot receive expenses');
select throws_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000010', 'expense', (select (result->>'id')::uuid from pg_temp.shared_values where key='expense'), 1, false, jsonb_build_object('name', 'Cabinets', 'amount_minor', '12345', 'expense_date', null, 'project_id', (select result->>'id' from pg_temp.shared_values where key='project')))$$, '22023', null, 'archived project expenses cannot be edited');
select throws_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000011', 'expense', (select (result->>'id')::uuid from pg_temp.shared_values where key='expense'), 1, true, null)$$, '22023', null, 'archived project expenses cannot be deleted');
select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000012', 'project', (select (result->>'id')::uuid from pg_temp.shared_values where key='project'), 2, false, '{"name": "Kitchen", "target_budget_minor": "10000", "is_archived": false}'::jsonb);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000013', 'expense', (select (result->>'id')::uuid from pg_temp.shared_values where key='expense'), 1, false, jsonb_build_object('name', 'Cabinets', 'amount_minor', '12345', 'expense_date', null, 'project_id', (select result->>'id' from pg_temp.shared_values where key='project')))$$, 'household members can edit shared expenses');
select is(public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000014', 'expense', (select (result->>'id')::uuid from pg_temp.shared_values where key='expense'), 1, false, jsonb_build_object('name', 'Cabinets', 'amount_minor', '12345', 'expense_date', null, 'project_id', (select result->>'id' from pg_temp.shared_values where key='project')))->>'conflict', 'true', 'stale shared expense edits return conflicts');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000015', 'reserve', (select (result->>'id')::uuid from pg_temp.shared_values where key='reserve'), 2, false, '{"name": "Outsider", "amount_minor": "1"}'::jsonb)$$, '42501', null, 'outsiders cannot change reserves');
select throws_ok($$select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000016', 'project', (select (result->>'id')::uuid from pg_temp.shared_values where key='project'), 3, true, null)$$, '42501', null, 'outsiders cannot delete shared projects');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000017', 'expense', (select (result->>'id')::uuid from pg_temp.shared_values where key='expense'), 2, true, null);
select public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000018', 'expense', (select (result->>'id')::uuid from pg_temp.shared_values where key='refund'), 1, true, null);
insert into pg_temp.shared_values values ('deleted_project', public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000019', 'project', (select (result->>'id')::uuid from pg_temp.shared_values where key='project'), 3, true, null));
select is(public.finance_mutate_shared_record('92000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000019', 'project', (select (result->>'id')::uuid from pg_temp.shared_values where key='project'), 3, true, null), (select result from pg_temp.shared_values where key='deleted_project'), 'deleting an empty project is retry-safe');
reset role;
select * from finish();
rollback;
