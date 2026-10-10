begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'draft-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'draft-member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'draft-outsider@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('92000000-0000-4000-8000-000000000001', 'Savings draft household'),
    ('92000000-0000-4000-8000-000000000002', 'Other draft household');

insert into public.profiles (id, household_id, name) values
    ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Draft owner'),
    ('91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Draft member'),
    ('91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'Draft outsider');

insert into public.finance_months (id, household_id, created_by, month_start) values
    ('92500000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-10-01'),
    ('92500000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-11-01'),
    ('92500000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', '2026-10-01');

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, visibility, owner_user_id, is_archived
) values
    ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Shared account', 'cash', 'household', '91000000-0000-4000-8000-000000000001', false),
    ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Owner private account', 'goal', 'private', '91000000-0000-4000-8000-000000000001', false),
    ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Member private account', 'cash', 'private', '91000000-0000-4000-8000-000000000002', false);

create temporary table finance_savings_draft_test_results (
    key text primary key,
    result jsonb not null
);
grant select, insert on table pg_temp.finance_savings_draft_test_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok(not has_function_privilege('anon', 'public.finance_save_draft(uuid,uuid,uuid,bigint,uuid,uuid,bigint,text,uuid)', 'EXECUTE'), 'anonymous callers cannot save savings drafts');
select ok(not has_function_privilege('anon', 'public.finance_delete_draft(uuid,uuid,uuid,bigint)', 'EXECUTE'), 'anonymous callers cannot delete savings drafts');
select ok(not has_table_privilege('authenticated', 'public.finance_planned_savings_transactions', 'INSERT'), 'clients cannot bypass draft privacy and version checks with direct inserts');
select ok(not has_table_privilege('authenticated', 'public.finance_planned_savings_transactions', 'UPDATE'), 'clients cannot bypass draft version checks with direct updates');

insert into pg_temp.finance_savings_draft_test_results (key, result)
select 'created', public.finance_save_draft(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    null, null, '92500000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', 2500, 'October plan', null
);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions where description = 'October plan'),
    1,
    'draft creation inserts one planned movement'
);
select is(
    public.finance_save_draft(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
        null, null, '92500000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001', 2500, 'October plan', null
    ),
    (select result from pg_temp.finance_savings_draft_test_results where key = 'created'),
    'a draft create retry returns its original receipt'
);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions where description = 'October plan'),
    1,
    'a create retry does not duplicate the draft'
);
select throws_ok(
    $$select public.finance_save_draft(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
        null, null, '92500000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001', 3500, 'Changed input', null
    )$$,
    'P0001', null,
    'reusing a draft request ID with different input is rejected'
);

select is(
    public.finance_save_draft(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002',
        (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'created'),
        1, '92500000-0000-4000-8000-000000000002',
        '93000000-0000-4000-8000-000000000001', 4000, 'November plan', null
    )->>'version',
    '2',
    'a draft edit advances its optimistic version and can move to another household month'
);
select is(
    public.finance_save_draft(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002',
        (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'created'),
        1, '92500000-0000-4000-8000-000000000002',
        '93000000-0000-4000-8000-000000000001', 4000, 'November plan', null
    )->>'version',
    '2',
    'an edit retry returns its original receipt without advancing the row again'
);
select is(
    public.finance_save_draft(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003',
        (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'created'),
        1, '92500000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001', 9900, 'Stale edit', null
    )->>'conflict',
    'true',
    'a stale draft edit returns a conflict'
);
select is(
    (select amount::bigint from public.finance_planned_savings_transactions where description = 'November plan'),
    4000::bigint,
    'a stale draft edit does not overwrite the current row'
);
select throws_ok(
    $$select public.finance_save_draft(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004',
        null, null, '92500000-0000-4000-8000-000000000003',
        '93000000-0000-4000-8000-000000000001', 100, 'Wrong household month', null
    )$$,
    '42501', null,
    'draft creation rejects a month from another household'
);

insert into pg_temp.finance_savings_draft_test_results (key, result)
select 'private', public.finance_save_draft(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000005',
    null, null, '92500000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002', 500, 'Owner only', null
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions where id = (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'private')),
    0,
    'private drafts are hidden from other household members'
);
select throws_ok(
    format(
        $$select public.finance_save_draft(
            '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000006',
            '%s'::uuid, 1, '92500000-0000-4000-8000-000000000001',
            '93000000-0000-4000-8000-000000000002', 600, 'Private edit', null
        )$$,
        (select result->>'draft_id' from pg_temp.finance_savings_draft_test_results where key = 'private')
    ),
    '42501', null,
    'another member cannot edit an owner private draft'
);
select throws_ok(
    format(
        $$select public.finance_delete_draft(
            '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
            '%s'::uuid, 1
        )$$,
        (select result->>'draft_id' from pg_temp.finance_savings_draft_test_results where key = 'private')
    ),
    '42501', null,
    'another member cannot delete an owner private draft'
);

insert into pg_temp.finance_savings_draft_test_results (key, result)
select 'shared_member', public.finance_save_draft(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000007',
    null, null, '92500000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', 800, 'Shared member draft', null
);
select is(
    public.finance_delete_draft(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000002',
        (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'shared_member'), 2
    )->>'conflict',
    'true',
    'a stale draft deletion returns a conflict'
);
select is(
    public.finance_delete_draft(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000003',
        (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'shared_member'), 1
    )->>'deleted',
    'true',
    'a household member can delete a shared draft with its current version'
);
select is(
    public.finance_delete_draft(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000003',
        (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'shared_member'), 1
    )->>'deleted',
    'true',
    'a draft delete retry returns its original receipt'
);
select is(
    (select count(*)::integer from public.finance_planned_savings_transactions where id = (select (result->>'draft_id')::uuid from pg_temp.finance_savings_draft_test_results where key = 'shared_member')),
    0,
    'a successful draft delete removes its row'
);
select throws_ok(
    format(
        $$select public.finance_delete_draft(
            '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000003',
            '%s'::uuid, 2
        )$$,
        (select result->>'draft_id' from pg_temp.finance_savings_draft_test_results where key = 'shared_member')
    ),
    'P0001', null,
    'a delete request ID cannot be reused with a different expected version'
);

reset role;
select * from finish();
rollback;
