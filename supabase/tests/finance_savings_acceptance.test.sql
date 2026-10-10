begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'accept-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'accept-member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('92000000-0000-4000-8000-000000000001', 'Savings acceptance household');

insert into public.profiles (id, household_id, name) values
    ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Acceptance owner'),
    ('91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Acceptance member');

insert into public.finance_months (id, household_id, created_by, month_start) values
    ('92500000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-10-01');

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, visibility, owner_user_id,
    is_archived
) values
    ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Active shared', 'cash', 'household', '91000000-0000-4000-8000-000000000001', false),
    ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Archived shared', 'goal', 'household', '91000000-0000-4000-8000-000000000001', true),
    ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Member private', 'cash', 'private', '91000000-0000-4000-8000-000000000002', false);

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, parent_id, visibility,
    owner_user_id, is_archived
) values (
    '93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'Child of archived account', 'cash',
    '93000000-0000-4000-8000-000000000002', 'household',
    '91000000-0000-4000-8000-000000000001', false
);

insert into public.finance_planned_savings_transactions (
    id, household_id, created_by, month_id, account_id, amount, description
) values
    ('95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 12505, 'Post this deposit'),
    ('95000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 0, 'Keep zero draft'),
    ('95000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 2500, 'Keep archived draft'),
    ('95000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000003', 3500, 'Keep archived child draft'),
    ('95000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', '92500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000004', 4500, 'Member private draft');

create temporary table finance_savings_acceptance_test_results (
    key text primary key,
    result jsonb not null
);
grant select, insert on table pg_temp.finance_savings_acceptance_test_results to authenticated;

select ok(
    not has_function_privilege('anon', 'public.finance_accept_savings_plan(uuid,uuid,uuid)', 'EXECUTE'),
    'anonymous callers cannot accept savings drafts'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into pg_temp.finance_savings_acceptance_test_results (key, result)
select 'first', public.finance_accept_savings_plan(
    '92000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001',
    '92500000-0000-4000-8000-000000000001'
);

select is(
    (select result->>'posted_count' from pg_temp.finance_savings_acceptance_test_results where key = 'first'),
    '1',
    'acceptance posts the accessible nonzero active draft'
);
select is(
    (select result->>'skipped_count' from pg_temp.finance_savings_acceptance_test_results where key = 'first'),
    '3',
    'acceptance reports zero and archived account drafts as skipped'
);
select is(
    (select skipped.value->'reasons' from pg_temp.finance_savings_acceptance_test_results result,
        lateral pg_catalog.jsonb_array_elements(result.result->'skipped') as skipped(value)
     where result.key = 'first' and skipped.value->>'draft_id' = '95000000-0000-4000-8000-000000000002'),
    '["zero_amount"]'::jsonb,
    'a zero draft has a clear skip reason'
);
select is(
    (select skipped.value->'reasons' from pg_temp.finance_savings_acceptance_test_results result,
        lateral pg_catalog.jsonb_array_elements(result.result->'skipped') as skipped(value)
     where result.key = 'first' and skipped.value->>'draft_id' = '95000000-0000-4000-8000-000000000003'),
    '["archived_account"]'::jsonb,
    'a draft on an archived account has a clear skip reason'
);
select is(
    (select skipped.value->'reasons' from pg_temp.finance_savings_acceptance_test_results result,
        lateral pg_catalog.jsonb_array_elements(result.result->'skipped') as skipped(value)
     where result.key = 'first' and skipped.value->>'draft_id' = '95000000-0000-4000-8000-000000000004'),
    '["archived_account"]'::jsonb,
    'a draft under an archived parent has a clear skip reason'
);
select is(
    (select result->>'inaccessible_draft_policy' from pg_temp.finance_savings_acceptance_test_results where key = 'first'),
    'remain_pending',
    'the acceptance result documents that inaccessible drafts remain pending'
);
select ok(
    (select result::text not like '%95000000-0000-4000-8000-000000000005%'
     from pg_temp.finance_savings_acceptance_test_results where key = 'first'),
    'the result does not disclose another member private draft ID'
);

reset role;
select is(
    (select count(*)::integer from public.finance_savings_transactions
     where source_planned_transaction_id = '95000000-0000-4000-8000-000000000001'),
    1,
    'the accepted transaction preserves its source draft ID'
);
select is(
    (select transaction_date::text from public.finance_savings_transactions
     where source_planned_transaction_id = '95000000-0000-4000-8000-000000000001'),
    '2026-10-01',
    'the posted transaction uses the selected month first date'
);
select is(
    (select budget_month_id from public.finance_savings_transactions
     where source_planned_transaction_id = '95000000-0000-4000-8000-000000000001'),
    '92500000-0000-4000-8000-000000000001'::uuid,
    'the posted transaction links back to the selected budget month'
);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions
     where id in (
         '95000000-0000-4000-8000-000000000001',
         '95000000-0000-4000-8000-000000000002',
         '95000000-0000-4000-8000-000000000003',
         '95000000-0000-4000-8000-000000000004',
         '95000000-0000-4000-8000-000000000005'
     )),
    4,
    'only the accepted draft is removed; zero, archived, and inaccessible drafts remain pending'
);

insert into public.finance_planned_savings_transactions (
    id, household_id, created_by, month_id, account_id, amount, description
) values (
    '95000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', 700, 'Added after first acceptance'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
    public.finance_accept_savings_plan(
        '92000000-0000-4000-8000-000000000001',
        '96000000-0000-4000-8000-000000000001',
        '92500000-0000-4000-8000-000000000001'
    ),
    (select result from pg_temp.finance_savings_acceptance_test_results where key = 'first'),
    'an acceptance retry returns its original receipt'
);
select throws_ok(
    $$select public.finance_accept_savings_plan(
        '92000000-0000-4000-8000-000000000001',
        '96000000-0000-4000-8000-000000000001',
        '92500000-0000-4000-8000-000000000002'
    )$$,
    'P0001', null,
    'an acceptance request ID cannot be reused for another month'
);
reset role;
select is(
    (select count(*)::integer from public.finance_savings_transactions
     where source_planned_transaction_id in (
         '95000000-0000-4000-8000-000000000001',
         '95000000-0000-4000-8000-000000000006'
     )),
    1,
    'a replay cannot post a draft added after the original request'
);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions
     where id = '95000000-0000-4000-8000-000000000006'),
    1,
    'a later draft stays pending when a prior request is replayed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into pg_temp.finance_savings_acceptance_test_results (key, result)
select 'later', public.finance_accept_savings_plan(
    '92000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000003',
    '92500000-0000-4000-8000-000000000001'
);
select is(
    (select result->>'posted_count' from pg_temp.finance_savings_acceptance_test_results where key = 'later'),
    '1',
    'a fresh request can accept drafts added after an earlier receipt'
);

reset role;
select is(
    (select count(*)::integer from public.finance_savings_transactions
     where source_planned_transaction_id in (
         '95000000-0000-4000-8000-000000000001',
         '95000000-0000-4000-8000-000000000006'
     )),
    2,
    'the new request posts the new draft once'
);

insert into public.finance_planned_savings_transactions (
    id, household_id, created_by, month_id, account_id, amount, description
) values (
    '95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', 12505, 'Recreated duplicate draft'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into pg_temp.finance_savings_acceptance_test_results (key, result)
select 'duplicate', public.finance_accept_savings_plan(
    '92000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000004',
    '92500000-0000-4000-8000-000000000001'
);
select is(
    (select result->>'posted_count' from pg_temp.finance_savings_acceptance_test_results where key = 'duplicate'),
    '0',
    'a recreated draft whose provenance was already posted is not posted twice'
);
select is(
    (select skipped.value->'reasons'
     from pg_temp.finance_savings_acceptance_test_results result,
          lateral pg_catalog.jsonb_array_elements(result.result->'skipped') as skipped(value)
     where result.key = 'duplicate'
       and skipped.value->>'draft_id' = '95000000-0000-4000-8000-000000000001'),
    '["already_posted"]'::jsonb,
    'a duplicate source draft is left pending with an explicit reason'
);
reset role;
select is(
    (select count(*)::integer from public.finance_savings_transactions
     where source_planned_transaction_id = '95000000-0000-4000-8000-000000000001'),
    1,
    'the source draft unique index keeps exactly one posted transaction'
);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions
     where id = '95000000-0000-4000-8000-000000000001'),
    1,
    'the duplicate draft remains available for inspection'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into pg_temp.finance_savings_acceptance_test_results (key, result)
select 'member', public.finance_accept_savings_plan(
    '92000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002',
    '92500000-0000-4000-8000-000000000001'
);
select is(
    (select result->>'posted_count' from pg_temp.finance_savings_acceptance_test_results where key = 'member'),
    '1',
    'the private account owner can accept their own draft'
);
select is(
    (select result->'posted'->0->>'draft_id' from pg_temp.finance_savings_acceptance_test_results where key = 'member'),
    '95000000-0000-4000-8000-000000000005',
    'only the owner acceptance result names the private draft'
);

reset role;
select * from finish();
rollback;
