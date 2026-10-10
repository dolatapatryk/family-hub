begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'transfer-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('12000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'transfer-member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('12000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'transfer-outsider@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('22000000-0000-4000-8000-000000000001', 'Savings transfer household'),
    ('22000000-0000-4000-8000-000000000002', 'Savings transfer other household');

insert into public.profiles (id, household_id, name) values
    ('12000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'Transfer owner'),
    ('12000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001', 'Transfer member'),
    ('12000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000002', 'Transfer outsider');

insert into public.finance_savings_accounts (
    id, household_id, created_by, name, account_type, visibility, owner_user_id, is_archived
) values
    ('36000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Shared source', 'cash', 'household', '12000000-0000-4000-8000-000000000001', false),
    ('36000000-0000-4000-8000-000000000012', '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'Shared destination', 'cash', 'household', '12000000-0000-4000-8000-000000000002', false),
    ('36000000-0000-4000-8000-000000000013', '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Owner private source', 'cash', 'private', '12000000-0000-4000-8000-000000000001', false),
    ('36000000-0000-4000-8000-000000000014', '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Owner private destination', 'goal', 'private', '12000000-0000-4000-8000-000000000001', false),
    ('36000000-0000-4000-8000-000000000015', '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'Member private account', 'cash', 'private', '12000000-0000-4000-8000-000000000002', false),
    ('36000000-0000-4000-8000-000000000016', '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Archived account', 'cash', 'household', '12000000-0000-4000-8000-000000000001', true),
    ('36000000-0000-4000-8000-000000000017', '22000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000003', 'Other household account', 'cash', 'household', '12000000-0000-4000-8000-000000000003', false);

create temporary table finance_transfer_test_values (
    key text primary key,
    result jsonb not null
);
grant select, insert on table pg_temp.finance_transfer_test_values to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok(not has_function_privilege('anon', 'public.finance_transfer_savings(uuid,uuid,uuid,bigint,uuid,bigint,bigint,date,text)', 'EXECUTE'), 'anonymous callers cannot create savings transfers');
select ok(not has_function_privilege('anon', 'public.finance_delete_transfer(uuid,uuid,uuid,bigint)', 'EXECUTE'), 'anonymous callers cannot delete savings transfers');
select ok(not has_table_privilege('authenticated', 'public.finance_savings_transactions', 'INSERT'), 'clients cannot bypass transfer pairing with direct movement inserts');

insert into pg_temp.finance_transfer_test_values (key, result)
select 'shared_transfer', public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        12345, '2026-10-09', 'Shared test transfer'
    );
select ok(
    (select result ? 'transfer_id' from pg_temp.finance_transfer_test_values where key = 'shared_transfer'),
    'creation returns a transfer identity'
);

select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Shared test transfer'),
    2,
    'creation inserts exactly two transfer legs'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions
     where description = 'Shared test transfer' and excluded_from_monthly_savings),
    2,
    'both transfer legs are excluded from monthly savings'
);
select is(
    (select sum(amount)::bigint from public.finance_savings_transactions where description = 'Shared test transfer'),
    0::bigint,
    'transfer legs have an exact zero net balance effect'
);
select is(
    (select count(*)::integer from public.finance_savings_transfers as transfer
     join public.finance_savings_transactions as movement
       on movement.household_id = transfer.household_id and movement.transfer_id = transfer.id
     where movement.description = 'Shared test transfer'),
    2,
    'the paired rows share one transfer lifecycle header'
);

select is(
    public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        12345, '2026-10-09', 'Shared test transfer'
    ),
    public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        12345, '2026-10-09', 'Shared test transfer'
    ),
    'the same create request returns its original IDs on retry'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Shared test transfer'),
    2,
    'a create retry does not append duplicate legs'
);
select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        12346, '2026-10-09', 'Changed retry'
    )$$,
    'P0001', null,
    'reusing a create request ID with different input conflicts'
);

select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000013', 1,
        500, '2026-10-09', 'Mixed visibility'
    )$$,
    '42501', null,
    'mixed household and private account transfers are rejected generically'
);
select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000003',
        '36000000-0000-4000-8000-000000000013', 1,
        '36000000-0000-4000-8000-000000000015', 1,
        500, '2026-10-09', 'Other owner private account'
    )$$,
    '42501', null,
    'a private transfer cannot cross account owners'
);
select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000004',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000016', 1,
        500, '2026-10-09', 'Archived endpoint'
    )$$,
    '22023', null,
    'archived account trees cannot accept a transfer'
);
select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000005',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        0, '2026-10-09', null
    )$$,
    '22023', null,
    'zero transfer amounts are rejected'
);
select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000006',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        100, '2026-10-09', null
    )$$,
    '22023', null,
    'an account cannot be transferred to itself'
);

reset role;
update public.finance_savings_accounts
set name = 'Owner private destination updated'
where household_id = '22000000-0000-4000-8000-000000000001'
  and id = '36000000-0000-4000-8000-000000000014';
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
    public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000007',
        '36000000-0000-4000-8000-000000000013', 1,
        '36000000-0000-4000-8000-000000000014', 1,
        5000, '2026-10-10', 'Stale account version'
    )->>'conflict',
    'true',
    'a stale endpoint version returns a conflict without writing either leg'
);
select is(
    (public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000007',
        '36000000-0000-4000-8000-000000000013', 1,
        '36000000-0000-4000-8000-000000000014', 1,
        5000, '2026-10-10', 'Stale account version'
    )->>'current_version')::bigint,
    2::bigint,
    'account version conflicts identify the latest version only for accessible endpoints'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Stale account version'),
    0,
    'a stale account version creates no partial transfer'
);

select ok(
    (public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000008',
        '36000000-0000-4000-8000-000000000013', 1,
        '36000000-0000-4000-8000-000000000014', 2,
        5000, '2026-10-10', 'Owner private test transfer'
    ) ? 'transfer_id') is not null,
    'same-owner private accounts can transfer'
);
insert into pg_temp.finance_transfer_test_values (key, result)
select 'private_transfer', public.finance_transfer_savings(
    '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000008',
    '36000000-0000-4000-8000-000000000013', 1,
    '36000000-0000-4000-8000-000000000014', 2,
    5000, '2026-10-10', 'Owner private test transfer'
);

set constraints finance_savings_transfers_pair_check, finance_savings_transactions_pair_check immediate;

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select ok(
    not exists (
        select 1 from public.finance_savings_transfers as transfer
        where exists (
            select 1 from public.finance_savings_transactions as movement
            where movement.household_id = transfer.household_id
              and movement.transfer_id = transfer.id
              and movement.description = 'Owner private test transfer'
        )
    ),
    'another household member cannot read a private transfer header or its legs'
);
select throws_ok(
    $$select public.finance_delete_transfer(
        '22000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001',
        (select (result->>'transfer_id')::uuid from pg_temp.finance_transfer_test_values where key = 'private_transfer'),
        1
    )$$,
    '42501', null,
    'another household member cannot delete a private transfer'
);

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
    $$select public.finance_transfer_savings(
        '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000009',
        '36000000-0000-4000-8000-000000000011', 1,
        '36000000-0000-4000-8000-000000000012', 1,
        500, '2026-10-11', 'Outsider attempt'
    )$$,
    '42501', null,
    'a member of another household cannot transfer its accounts'
);

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
    public.finance_delete_transfer(
        '22000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000002',
        (select (result->>'transfer_id')::uuid from pg_temp.finance_transfer_test_values where key = 'shared_transfer'),
        2
    )->>'conflict',
    'true',
    'deletion with a stale transfer version returns a conflict'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Shared test transfer'),
    2,
    'a stale delete leaves both transfer legs intact'
);

select is(
    (select result from (
        select public.finance_delete_transfer(
            '22000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003',
            (select (result->>'transfer_id')::uuid from pg_temp.finance_transfer_test_values where key = 'shared_transfer'),
            1
        ) as result
    ) as first_delete),
    (select result from (
        select public.finance_delete_transfer(
            '22000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003',
            (select (result->>'transfer_id')::uuid from pg_temp.finance_transfer_test_values where key = 'shared_transfer'),
            1
        ) as result
    ) as delete_retry),
    'a repeated delete request returns the original success receipt'
);
select is(
    (select count(*)::integer from public.finance_savings_transactions where description = 'Shared test transfer'),
    0,
    'deleting the header removes both legs atomically'
);
select is(
    (select count(*)::integer from public.finance_savings_transfers as transfer
     where transfer.id = (select (result->>'transfer_id')::uuid from pg_temp.finance_transfer_test_values where key = 'shared_transfer')),
    0,
    'deleting a transfer removes its lifecycle header'
);
select throws_ok(
    $$select public.finance_delete_transfer(
        '22000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003',
        (select (result->>'transfer_id')::uuid from pg_temp.finance_transfer_test_values where key = 'shared_transfer'), 2
    )$$,
    'P0001', null,
    'reusing a delete request ID for different input conflicts'
);

reset role;
select * from finish();
rollback;
