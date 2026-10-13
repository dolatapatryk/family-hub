begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('17000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'category-sections@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.households (id, name) values ('27000000-0000-4000-8000-000000000001', 'Category sections test');
insert into public.profiles (id, household_id, name) values
    ('17000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', 'Category test member');
insert into public.finance_months (id, household_id, created_by, month_start) values
    ('37000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', '2026-10-01');
insert into public.finance_scenarios (id, household_id, created_by, name) values
    ('47000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'Category forecast');

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"17000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$insert into public.finance_categories (household_id, created_by, name, budget_type, allocation_role)
    values ('27000000-0000-4000-8000-000000000001',
        '17000000-0000-4000-8000-000000000001', 'Patryk — środki osobiste', 'saving', 'personal_allowance')$$,
    'household members can define the individual-account section');
-- Browser clients cannot set IDs. Use the generated identity for later tests.
select throws_ok($$insert into public.finance_categories (household_id, created_by, name, budget_type, allocation_role)
    values ('27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001',
        'Invalid income allowance', 'income', 'personal_allowance')$$, '23514', null,
    'individual accounts cannot be misclassified as income');

select lives_ok($$insert into public.finance_budget_items (household_id, created_by, month_id, category_id, amount, is_recurring)
    select '27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001',
        '37000000-0000-4000-8000-000000000001', id, 10000, true
    from public.finance_categories where name = 'Patryk — środki osobiste'$$, 'budget descriptions are optional');
select is((select name from public.finance_budget_items where household_id = '27000000-0000-4000-8000-000000000001'), '',
    'a new budget line does not duplicate its category name');

select lives_ok($$insert into public.finance_scenario_items (household_id, created_by, scenario_id, category_id, amount)
    select '27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001',
        '47000000-0000-4000-8000-000000000001', id, 20000
    from public.finance_categories where name = 'Patryk — środki osobiste'$$, 'forecast descriptions are optional');

select throws_ok($$update public.finance_categories set allocation_role = 'standard'
    where household_id = '27000000-0000-4000-8000-000000000001'$$, '42501', null,
    'clients cannot move historical categories to another section');

select lives_ok($$update public.finance_categories set name = 'Środki osobiste'
    where name = 'Patryk — środki osobiste'$$, 'categories can be renamed without changing their section');
select is((select name from public.finance_budget_items where household_id = '27000000-0000-4000-8000-000000000001'), '',
    'renaming preserves category-driven labels without copying stale names');

select lives_ok($$select public.finance_create_month('27000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000001', '2026-11-01', 'recurring', '37000000-0000-4000-8000-000000000001', null)$$,
    'recurring month creation preserves optional descriptions and individual-account sections');
select lives_ok($$select public.finance_create_month('27000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000002', '2026-12-01', 'scenario', null, '47000000-0000-4000-8000-000000000001')$$,
    'forecast month creation preserves optional descriptions and individual-account sections');
select is((select count(*)::integer from public.finance_budget_items
    where household_id = '27000000-0000-4000-8000-000000000001' and name = ''
      and category_id in (select id from public.finance_categories where allocation_role = 'personal_allowance')), 3,
    'copied and original lines retain their category-driven section without duplicate names');

select * from finish();
rollback;
