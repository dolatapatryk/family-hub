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

create temporary table finance_savings_mutation_values (
    key text primary key,
    result jsonb not null
);
grant select, insert on table pg_temp.finance_savings_mutation_values to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok(not has_function_privilege('anon', 'public.finance_save_account(uuid,uuid,uuid,bigint,text,text,uuid,bigint,bigint,text)', 'EXECUTE'), 'anonymous callers cannot save savings accounts');
select ok(not has_function_privilege('anon', 'public.finance_save_transaction(uuid,uuid,uuid,bigint,uuid,date,bigint,text,boolean)', 'EXECUTE'), 'anonymous callers cannot save savings transactions');
select ok(not has_function_privilege('anon', 'public.finance_delete_transaction(uuid,uuid,uuid,bigint)', 'EXECUTE'), 'anonymous callers cannot delete savings transactions');
select ok(not has_table_privilege('authenticated', 'public.finance_savings_accounts', 'INSERT'), 'clients cannot bypass account privacy checks with direct inserts');
select ok(not has_table_privilege('authenticated', 'public.finance_savings_transactions', 'UPDATE'), 'clients cannot bypass transaction version and transfer checks');

insert into pg_temp.finance_savings_mutation_values (key, result)
select 'created_account', public.finance_save_account(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    null, null, 'New private account', 'cash', null, 12345, 50000, 'private'
);
select ok(
    (select result ? 'account_id' from pg_temp.finance_savings_mutation_values where key = 'created_account'),
    'account creation returns its ID'
);
select is(
    (select count(*)::integer from public.finance_savings_accounts where name = 'New private account'),
    1,
    'account creation inserts exactly one row'
);
select is(
    (select public.finance_save_account(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
        null, null, 'New private account', 'cash', null, 12345, 50000, 'private'
    )),
    (select result from pg_temp.finance_savings_mutation_values where key = 'created_account'),
    'an account create retry returns the original receipt'
);
select throws_ok(
    $$select public.finance_save_account(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
        null, null, 'Changed private account', 'cash', null, 12345, 50000, 'private'
    )$$,
    'P0001', null,
    'reusing an account request ID with different input is rejected'
);

insert into pg_temp.finance_savings_mutation_values (key, result)
select 'updated_account', public.finance_save_account(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002',
    (select (result->>'account_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_account'),
    1, 'Renamed private account', 'goal', null, null, 60000, 'private'
);
select is(
    (select (result->>'version')::bigint from pg_temp.finance_savings_mutation_values where key = 'updated_account'),
    2::bigint,
    'an account update advances its optimistic version'
);
select is(
    public.finance_save_account(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003',
        (select (result->>'account_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_account'),
        1, 'Stale name', 'goal', null, null, 60000, 'private'
    )->>'conflict',
    'true',
    'stale account versions return a conflict'
);
select is(
    (select name from public.finance_savings_accounts where id = (select (result->>'account_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_account')),
    'Renamed private account',
    'a stale account update does not overwrite current data'
);

insert into pg_temp.finance_savings_mutation_values (key, result)
select 'created_transaction', public.finance_save_transaction(
    '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
    null, null, '93000000-0000-4000-8000-000000000001', '2026-10-09',
    2500, 'Ordinary deposit', false
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Ordinary deposit'),
    1,
    'ordinary transaction creation inserts one movement'
);
select is(
    (select public.finance_save_transaction(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
        null, null, '93000000-0000-4000-8000-000000000001', '2026-10-09',
        2500, 'Ordinary deposit', false
    )),
    (select result from pg_temp.finance_savings_mutation_values where key = 'created_transaction'),
    'the same transaction create request reuses the original movement'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Ordinary deposit'),
    1,
    'a transaction retry does not create a duplicate movement'
);

select is(
    public.finance_save_transaction(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000002',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction'),
        1, '93000000-0000-4000-8000-000000000001', '2026-10-10',
        -1250, 'Edited withdrawal', true
    )->>'version',
    '2',
    'transaction updates advance their optimistic version'
);
select is(
    public.finance_save_transaction(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000003',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction'),
        1, '93000000-0000-4000-8000-000000000001', '2026-10-11',
        1, 'Stale edit', false
    )->>'conflict',
    'true',
    'stale transaction versions return a conflict'
);
select is(
    (select amount::bigint from public.finance_savings_transactions where description = 'Edited withdrawal'),
    -1250::bigint,
    'a stale transaction update does not overwrite the latest movement'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
    $$select public.finance_save_transaction(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000004',
        null, null, '93000000-0000-4000-8000-000000000002', '2026-10-09',
        1, 'Privacy violation', false
    )$$,
    '42501', null,
    'a household member cannot create a movement in another member private account'
);
select throws_ok(
    $$select public.finance_save_transaction(
        '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000005',
        null, null, '93000000-0000-4000-8000-000000000004', '2026-10-09',
        1, 'Archived account movement', false
    )$$,
    '22023', null,
    'archived accounts cannot receive ordinary transactions'
);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into pg_temp.finance_savings_mutation_values (key, result)
select 'private_transaction', public.finance_save_transaction(
    '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000007',
    null, null, '93000000-0000-4000-8000-000000000002', '2026-10-09',
    700, 'Owner private movement', false
);

insert into pg_temp.finance_savings_mutation_values (key, result)
select 'transfer', public.finance_transfer_savings(
    '92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', 1,
    '93000000-0000-4000-8000-000000000005', 1,
    500, '2026-10-10', 'Protected transfer'
);
select throws_ok(
    format(
        $$select public.finance_save_transaction(
            '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000006',
            '%s'::uuid, 1, '93000000-0000-4000-8000-000000000001', '2026-10-10',
            -500, 'Edited transfer leg', true
        )$$,
        (select result->'transaction_ids'->>0 from pg_temp.finance_savings_mutation_values where key = 'transfer')
    ),
    '22023', null,
    'transfer legs cannot be edited as ordinary transactions'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
    $$select public.finance_save_account(
        '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004',
        '93000000-0000-4000-8000-000000000002', 1, 'Stolen private name', 'goal', null, null, 70000, 'private'
    )$$,
    '42501', null,
    'another household member cannot update an owner private account'
);
select is(
    (select count(*)::integer from public.finance_savings_accounts where name = 'Owner private account'),
    0,
    'private account names stay hidden from other household members'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Owner private movement'),
    0,
    'private transaction history stays hidden from other household members'
);
select throws_ok(
    $$select public.finance_delete_transaction(
        '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'private_transaction'), 1
    )$$,
    '42501', null,
    'another household member cannot delete a private transaction'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
    public.finance_delete_transaction(
        '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000002',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction'), 1
    )->>'conflict',
    'true',
    'a stale transaction deletion returns a conflict'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Edited withdrawal'),
    1,
    'a stale deletion leaves the movement intact'
);
select is(
    public.finance_delete_transaction(
        '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000003',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction'), 2
    )->>'deleted',
    'true',
    'an ordinary transaction can be deleted with its current version'
);
select is(
    public.finance_delete_transaction(
        '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000003',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction'), 2
    )->>'deleted',
    'true',
    'a delete retry returns its successful receipt'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where id = (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction')),
    0,
    'a successful ordinary transaction delete removes the movement'
);
select throws_ok(
    $$select public.finance_delete_transaction(
        '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000003',
        (select (result->>'transaction_id')::uuid from pg_temp.finance_savings_mutation_values where key = 'created_transaction'), 1
    )$$,
    'P0001', null,
    'a delete request ID cannot be reused with different input'
);

reset role;
select * from finish();
rollback;
