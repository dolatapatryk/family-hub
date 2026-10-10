begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'finance-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'finance-member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'finance-outsider@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('21000000-0000-4000-8000-000000000001', 'Finance household'),
    ('21000000-0000-4000-8000-000000000002', 'Finance other household');

insert into public.profiles (id, household_id, name) values
    ('11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Finance owner'),
    ('11000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', 'Finance member'),
    ('11000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000002', 'Finance outsider');

insert into public.finance_months (id, household_id, created_by, month_start, display_name) values
    ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '2026-10-01', null),
    ('31000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '2026-10-01', null);

insert into public.finance_categories (id, household_id, created_by, name, budget_type, parent_id) values
    ('32000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Income', 'income', null),
    ('32000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Savings', 'saving', null),
    ('32000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Salary', 'income', '32000000-0000-4000-8000-000000000001'),
    ('32000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Personal transfers', 'saving', null),
    ('32000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Fixed costs', 'fixed_expense', null),
    ('32000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'Other income', 'income', null);

insert into public.finance_budget_items (
    id, household_id, created_by, month_id, category_id, name, amount, allocation_role
) values
    ('33000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000003', 'Salary', 700000, 'standard'),
    ('33000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000004', 'Personal allowance', 50000, 'personal_allowance'),
    ('33000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000006', 'Other salary', 10000, 'standard');

insert into public.finance_scenarios (id, household_id, created_by, name) values
    ('34000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Base scenario'),
    ('34000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'Other scenario');

insert into public.finance_scenario_items (
    id, household_id, created_by, scenario_id, category_id, name, amount
) values
    ('35000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000003', 'Scenario salary', 710000, 'standard'),
    ('35000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '34000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000006', 'Other scenario salary', 20000, 'standard');

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, parent_id, visibility, owner_user_id
) values
    ('36000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Household cash', 'cash', null, 'household', '11000000-0000-4000-8000-000000000001'),
    ('36000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'Second shared cash', 'cash', null, 'household', '11000000-0000-4000-8000-000000000002'),
    ('36000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'Shared child', 'goal', '36000000-0000-4000-8000-000000000001', 'private', '11000000-0000-4000-8000-000000000002'),
    ('36000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Owner private goal', 'goal', null, 'private', '11000000-0000-4000-8000-000000000001'),
    ('36000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Owner private child', 'cash', '36000000-0000-4000-8000-000000000004', 'household', '11000000-0000-4000-8000-000000000001'),
    ('36000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'Member private account', 'cash', null, 'private', '11000000-0000-4000-8000-000000000002'),
    ('36000000-0000-4000-8000-000000000007', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'Other household cash', 'cash', null, 'household', '11000000-0000-4000-8000-000000000003');

insert into public.finance_savings_plans (
    id, household_id, created_by, name, plan_type, account_id,
    monthly_amount, visibility, owner_user_id
) values
    ('37000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Shared cash plan', 'cash', '36000000-0000-4000-8000-000000000001', 10000, 'private', '11000000-0000-4000-8000-000000000001'),
    ('37000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Owner private plan', 'goal', '36000000-0000-4000-8000-000000000004', 5000, 'private', '11000000-0000-4000-8000-000000000001'),
    ('37000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'Member private plan', 'cash', '36000000-0000-4000-8000-000000000006', 2500, 'private', '11000000-0000-4000-8000-000000000002'),
    ('37000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Household reserve', 'irregular', null, 8000, 'household', '11000000-0000-4000-8000-000000000001'),
    ('37000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Owner unbound plan', 'irregular', null, 3500, 'private', '11000000-0000-4000-8000-000000000001'),
    ('37000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'Other household plan', 'cash', '36000000-0000-4000-8000-000000000007', 1000, 'household', '11000000-0000-4000-8000-000000000003');

insert into public.finance_savings_transfers (id, household_id, created_by) values
    ('38000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001'),
    ('38000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001');

insert into public.finance_savings_transactions (
    id, household_id, created_by, account_id, transaction_date, amount,
    description, excluded_from_monthly_savings, transfer_id
) values
    ('39000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', '2026-10-02', 10000, 'Shared movement', false, null),
    ('39000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', '2026-10-03', -2500, 'Shared transfer', true, '38000000-0000-4000-8000-000000000001'),
    ('39000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000002', '2026-10-03', 2500, 'Shared transfer', true, '38000000-0000-4000-8000-000000000001'),
    ('39000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000004', '2026-10-04', 2000, 'Owner private movement', false, null),
    ('39000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000004', '2026-10-05', -1000, 'Owner private transfer', true, '38000000-0000-4000-8000-000000000002'),
    ('39000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000005', '2026-10-05', 1000, 'Owner private transfer', true, '38000000-0000-4000-8000-000000000002'),
    ('39000000-0000-4000-8000-000000000007', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000006', '2026-10-06', 1500, 'Member private movement', false, null),
    ('39000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000007', '2026-10-07', 500, 'Other household movement', false, null);

insert into public.finance_planned_savings_transactions (
    id, household_id, created_by, month_id, account_id, amount, description, source_savings_plan_id
) values
    ('40000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', 10000, 'Shared draft', '37000000-0000-4000-8000-000000000001'),
    ('40000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000004', 5000, 'Owner private draft', '37000000-0000-4000-8000-000000000002'),
    ('40000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000006', 2500, 'Member private draft', '37000000-0000-4000-8000-000000000003'),
    ('40000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000007', 1000, 'Other household draft', '37000000-0000-4000-8000-000000000006');

insert into public.finance_irregular_expense_plans (id, household_id, created_by, name, annual_amount) values
    ('41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Household insurance', 120000),
    ('41000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'Other insurance', 90000);

insert into public.finance_projects (id, household_id, created_by, name, target_budget) values
    ('42000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Kitchen', 500000),
    ('42000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'Other project', 100000);

insert into public.finance_project_expenses (
    id, household_id, created_by, project_id, expense_date, name, amount
) values
    ('43000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '2026-10-08', 'Cabinet', 80000),
    ('43000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000002', '2026-10-08', 'Other expense', 20000);

-- Force the deferred account-tree, plan-link, and transfer-pair checks while
-- these valid fixtures are still inside the test transaction.
set constraints all immediate;

select ok(not has_table_privilege('anon', 'public.finance_months', 'SELECT'), 'anonymous users cannot read finance tables');
select ok(has_table_privilege('authenticated', 'public.finance_months', 'SELECT'), 'authenticated household members can query shared finance tables');
select ok(not has_table_privilege('authenticated', 'public.finance_savings_accounts', 'INSERT'), 'clients cannot directly insert savings accounts');
select ok(not has_table_privilege('authenticated', 'public.finance_savings_transactions', 'UPDATE'), 'clients cannot directly edit savings movements');
select ok(not has_table_privilege('authenticated', 'public.finance_savings_transfers', 'DELETE'), 'clients cannot directly delete transfer headers');
select ok(not has_table_privilege('authenticated', 'private.finance_import_runs', 'SELECT'), 'import receipts are not directly readable');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::integer from public.finance_months), 1, 'owner reads only the household month');
select is((select count(*)::integer from public.finance_budget_items), 2, 'owner reads the shared budget');
select is((select count(*)::integer from public.finance_scenarios), 1, 'owner reads the household scenario');
select is((select count(*)::integer from public.finance_scenario_items), 1, 'owner reads the household scenario items');
select is((select count(*)::integer from public.finance_savings_accounts), 5, 'owner reads shared accounts and their own private tree');
select ok(exists(select 1 from public.finance_savings_accounts where name = 'Owner private child'), 'private descendants are visible to their owner');
select is((select visibility from public.finance_savings_accounts where name = 'Shared child'), 'household', 'a child inherits its parent visibility');
select is((select owner_user_id from public.finance_savings_accounts where name = 'Shared child'), '11000000-0000-4000-8000-000000000001'::uuid, 'a child inherits its parent owner');
select ok(not exists(select 1 from public.finance_savings_accounts where name = 'Member private account'), 'owner cannot read another member private account');
select is((select count(*)::integer from public.finance_savings_transactions), 6, 'owner reads shared and own-private movements');
select is((select count(*)::integer from public.finance_planned_savings_transactions), 2, 'owner reads shared and own-private drafts');
select is((select count(*)::integer from public.finance_savings_plans), 4, 'owner reads shared and own-private plans');
select is((select count(*)::integer from public.finance_savings_transfers), 2, 'owner reads transfers only when both legs are accessible');
select is((select count(*)::integer from public.finance_irregular_expense_plans), 1, 'owner reads the shared irregular reserves');
select is((select count(*)::integer from public.finance_projects), 1, 'owner reads shared projects');
select is((select count(*)::integer from public.finance_project_expenses), 1, 'owner reads shared project expenses');

select lives_ok(
    $$insert into public.finance_budget_items (
        household_id, created_by, month_id, category_id, name, amount
    ) values (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000003', 'Member-added line', 10023
    )$$,
    'a member can add a shared budget line through direct table access'
);
select is((select amount::bigint from public.finance_budget_items where name = 'Member-added line'), 10023::bigint, 'PLN 100.23 is stored as the integer minor-unit amount 10023');
select is((select version from public.finance_budget_items where name = 'Member-added line'), 1::bigint, 'new finance rows start at version one');
select lives_ok(
    $$update public.finance_budget_items set amount = 12400 where name = 'Member-added line'$$,
    'a member can edit shared budget rows'
);
select is((select version from public.finance_budget_items where name = 'Member-added line'), 2::bigint, 'the database increments versions on shared edits');
select throws_ok(
    $$insert into public.finance_months (household_id, created_by, month_start) values (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000002', '2026-11-01'
    )$$,
    '42501', null,
    'a member cannot forge another creator on insert'
);
select throws_ok(
    $$insert into public.finance_months (household_id, created_by, month_start) values (
        '21000000-0000-4000-8000-000000000002',
        '11000000-0000-4000-8000-000000000001', '2026-11-01'
    )$$,
    '42501', null,
    'a household member cannot insert into another household'
);
select throws_ok(
    $$insert into public.finance_budget_items (
        household_id, created_by, month_id, category_id, name, amount
    ) values (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000006', 'Cross-household category', 100
    )$$,
    '23503', null,
    'composite category references cannot cross household boundaries'
);
select throws_ok(
    $$insert into public.finance_budget_items (
        household_id, created_by, month_id, category_id, name, amount, allocation_role
    ) values (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000005', 'Bad allowance', 100,
        'personal_allowance'
    )$$,
    '23514', null,
    'personal allowance role requires a saving category'
);
select throws_ok(
    $$insert into public.finance_budget_items (
        household_id, created_by, month_id, category_id, name, amount
    ) values (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000003', 'Out-of-range amount', 1000000000000000000
    )$$,
    '23514', null,
    'minor-unit bigint columns reject values beyond the supported signed range'
);
select throws_ok(
    $$update public.finance_categories set parent_id = id where id = '32000000-0000-4000-8000-000000000001'$$,
    '23514', null,
    'category hierarchy cycles are rejected'
);
select throws_ok(
    $$insert into public.finance_savings_accounts (
        household_id, created_by, name, account_type, visibility, owner_user_id
    ) values (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001', 'Direct savings write', 'cash', 'private',
        '11000000-0000-4000-8000-000000000001'
    )$$,
    '42501', null,
    'savings writes are reserved for finance operations'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.finance_savings_accounts), 4, 'another member reads shared accounts and only their private account');
select ok(not exists(select 1 from public.finance_savings_accounts where name = 'Owner private goal'), 'another member cannot read the owner private tree');
select is((select count(*)::integer from public.finance_savings_transactions), 4, 'another member reads shared and own-private movements only');
select is((select count(*)::integer from public.finance_planned_savings_transactions), 2, 'another member reads shared and own-private drafts only');
select is((select count(*)::integer from public.finance_savings_plans), 3, 'another member reads shared and own-private plans only');
select is((select count(*)::integer from public.finance_savings_transfers), 1, 'another member cannot read a transfer with inaccessible legs');
select is((select count(*)::integer from public.finance_months), 1, 'another member reads the household month');
select is((select count(*)::integer from public.finance_budget_items), 3, 'another member sees shared budget edits');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.finance_months), 1, 'outsider reads only their household month');
select is((select count(*)::integer from public.finance_budget_items), 1, 'outsider reads only their household budget');
select is((select count(*)::integer from public.finance_savings_accounts), 1, 'outsider reads only their household account');
select is((select count(*)::integer from public.finance_savings_transactions), 1, 'outsider reads only their household movements');
select is((select count(*)::integer from public.finance_planned_savings_transactions), 1, 'outsider reads only their household drafts');
select is((select count(*)::integer from public.finance_savings_plans), 1, 'outsider reads only their household savings plan');
select is((select count(*)::integer from public.finance_savings_transfers), 0, 'outsider cannot read transfers from another household');
select is((select count(*)::integer from public.finance_projects), 1, 'outsider reads only their household projects');
select ok(not exists(select 1 from public.finance_projects where name = 'Kitchen'), 'outsider cannot read another household project details');

reset role;
select * from finish();
rollback;
