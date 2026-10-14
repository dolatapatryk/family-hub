begin;

-- Relative dates follow the same business calendar as wallet RPCs.
set local timezone = 'Europe/Warsaw';

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'wallet-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'wallet-member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'wallet-outsider@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('e2000000-0000-4000-8000-000000000001', 'Wallet transactions household'),
    ('e2000000-0000-4000-8000-000000000002', 'Wallet transactions other household');

insert into public.profiles (id, household_id, name) values
    ('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Wallet owner'),
    ('e1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Wallet member'),
    ('e1000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000002', 'Wallet outsider');

insert into public.finance_categories (
    id, household_id, created_by, name, budget_type, allocation_role
) values
    ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Wynagrodzenie', 'income', 'standard'),
    ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Żywność', 'variable_expense', 'standard'),
    ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Oszczędności', 'saving', 'standard'),
    ('e3000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Kieszonkowe', 'saving', 'personal_allowance'),
    ('e3000000-0000-4000-8000-000000000005', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Inwestycje', 'investment', 'standard');

create temporary table finance_wallet_transaction_test_values (
    key text primary key,
    result jsonb not null
);
grant select, insert, update on table pg_temp.finance_wallet_transaction_test_values to authenticated;

create temporary table finance_wallet_transaction_test_ids (
    key text primary key,
    transaction_id uuid not null
);
grant select, insert on table pg_temp.finance_wallet_transaction_test_ids to authenticated;

select ok(not has_function_privilege('anon', 'public.finance_save_wallet(uuid,uuid,uuid,bigint,text,text,text,date,bigint,text,text)', 'EXECUTE'), 'anonymous callers cannot create wallets');
select ok(not has_function_privilege('anon', 'public.finance_save_wallet_transaction(uuid,uuid,uuid,bigint,text,date,bigint,uuid,uuid,uuid,text,text)', 'EXECUTE'), 'anonymous callers cannot save transactions');
select ok(not has_table_privilege('authenticated', 'public.finance_wallets', 'INSERT'), 'clients cannot bypass wallet creation and opening');
select ok(not has_table_privilege('authenticated', 'public.finance_transactions', 'UPDATE'), 'clients cannot bypass atomic transaction mutations');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'wallet_a', public.finance_save_wallet(
    'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
    null, null, 'Konto główne', 'bank', 'household', current_date - 10, 100000, '#315E56', 'bank'
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'wallet_b', public.finance_save_wallet(
    'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002',
    null, null, 'Oszczędności', 'savings_bank', 'household', current_date - 10, 0, null, 'piggy-bank'
);

select is(
    (select result->>'version' from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    '2', 'wallet creation atomically adds one opening row and advances its balance version'
);
select is(
    (select count(*)::integer from public.finance_transactions where kind = 'opening'),
    2, 'wallet creation inserts exactly one opening row even when the balance is zero'
);
select is(
    (select count(*)::integer from public.finance_transactions where kind = 'opening' and destination_wallet_id =
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a')),
    1, 'each wallet has exactly one opening row'
);
select is(
    public.finance_save_wallet(
        'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
        null, null, 'Konto główne', 'bank', 'household', current_date - 10, 100000, '#315E56', 'bank'
    ),
    (select result from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    'retrying wallet creation returns its original receipt'
);
select throws_ok(
    $$select public.finance_save_wallet(
        'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
        null, null, 'Different wallet', 'bank', 'household', current_date - 10, 100000, '#315E56', 'bank'
    )$$,
    'P0001', null, 'a wallet request ID cannot be reused with another payload'
);

insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'salary', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001',
    null, null, 'income', current_date - 1, 900000, null,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    'e3000000-0000-4000-8000-000000000001', 'Pensja', 'none'
);
insert into pg_temp.finance_wallet_transaction_test_ids (key, transaction_id)
select 'salary', (result->>'transaction_id')::uuid
from pg_temp.finance_wallet_transaction_test_values where key = 'salary';
select is(
    public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001',
        null, null, 'income', current_date - 1, 900000, null,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        'e3000000-0000-4000-8000-000000000001', 'Pensja', 'none'
    ),
    (select result from pg_temp.finance_wallet_transaction_test_values where key = 'salary'),
    'retrying transaction creation returns the original receipt'
);
select is((select count(*)::integer from public.finance_transactions where description = 'Pensja'), 1, 'transaction retry does not create a duplicate row');
select throws_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001',
        null, null, 'income', current_date - 1, 900001, null,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        'e3000000-0000-4000-8000-000000000001', 'Different salary', 'none'
    )$$,
    'P0001', null, 'a transaction request ID cannot be reused with another payload'
);

insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'groceries', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002',
    null, null, 'expense', current_date - 1, 18000,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    null, 'e3000000-0000-4000-8000-000000000002', 'Zakupy spożywcze', 'none'
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'contribution', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000003',
    null, null, 'transfer', current_date - 1, 100000,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_b'),
    'e3000000-0000-4000-8000-000000000003', 'Odkładanie', 'contribution'
);
insert into pg_temp.finance_wallet_transaction_test_ids (key, transaction_id)
select 'contribution', (result->>'transaction_id')::uuid
from pg_temp.finance_wallet_transaction_test_values where key = 'contribution';

insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'existing_savings_transfer', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000004',
    null, null, 'transfer', current_date - 1, 20000,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_b'),
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    'e3000000-0000-4000-8000-000000000003', 'Przeniesienie', 'none'
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'savings_expense', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000005',
    null, null, 'savings_expense', current_date - 1, 20000,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    null, 'e3000000-0000-4000-8000-000000000002', 'Nowa pralka', 'none'
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'regular_refund', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000006',
    null, null, 'refund', current_date - 1, 2000, null,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    'e3000000-0000-4000-8000-000000000002', 'Zwrot za zakupy', 'none'
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'savings_refund', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000007',
    null, null, 'savings_refund', current_date - 1, 5000, null,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    'e3000000-0000-4000-8000-000000000002', 'Zwrot z oszczędności', 'none'
);

select is(
    (select balance_minor from public.finance_list_wallets(
        'e2000000-0000-4000-8000-000000000001', 'household', current_date
    ) where id = (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a')),
    '889000', 'wallet A balance includes income, expenses, refunds and both transfer legs exactly once'
);
select is(
    (select balance_minor from public.finance_list_wallets(
        'e2000000-0000-4000-8000-000000000001', 'household', current_date
    ) where id = (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_b')),
    '80000', 'wallet B balance includes both incoming and outgoing transfer legs'
);
select is(
    (select count(*)::integer from public.finance_wallet_movements),
    11, 'the signed movement view derives two legs per transfer without duplicating transaction headers'
);

insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'summary', public.finance_transaction_month_summary(
    'e2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,
    'household', null, null
);
select is((select result->>'income_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '900000', 'summary returns income in exact minor-unit text');
select is((select result->>'regular_expenses_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '16000', 'regular refunds reduce current expenses');
select is((select result->>'monthly_balance_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '884000', 'monthly balance excludes transfers and savings-funded spending');
select is((select result->>'savings_contributions_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '100000', 'a contribution is counted once from its destination-side transaction header');
select is((select result->>'savings_spending_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '15000', 'savings refunds reduce savings-funded spending');
select is((select result->>'savings_change_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '85000', 'savings change subtracts net savings-funded spending from contributions');
select is((select result->>'total_spending_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '31000', 'total spending combines net regular and savings-funded spending');
select is((select result->>'transaction_count' from pg_temp.finance_wallet_transaction_test_values where key = 'summary'), '7', 'opening rows do not count as ordinary transactions');
select is(
    (select item->>'amount_minor' from pg_temp.finance_wallet_transaction_test_values values_row,
        lateral jsonb_array_elements(values_row.result->'regular_category_totals') item
     where values_row.key = 'summary' and item->>'category_id' = 'e3000000-0000-4000-8000-000000000002'),
    '16000', 'regular category totals use current category labels and net refunds'
);
select is(
    (select item->>'amount_minor' from pg_temp.finance_wallet_transaction_test_values values_row,
        lateral jsonb_array_elements(values_row.result->'savings_category_totals') item
     where values_row.key = 'summary' and item->>'category_id' = 'e3000000-0000-4000-8000-000000000002'),
    '15000', 'savings-funded spending has its own category totals'
);
reset role;
select throws_ok(
    $$update public.finance_categories set budget_type = 'income'
      where id = 'e3000000-0000-4000-8000-000000000002'$$,
    '22023', null, 'category section changes cannot invalidate referenced transaction kinds'
);
set local role authenticated;

insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'history_page_1', public.finance_list_transactions(
    'e2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,
    'household', null, null, null, null, null, null, 3
);
select is(jsonb_array_length((select result->'items' from pg_temp.finance_wallet_transaction_test_values where key = 'history_page_1')), 3, 'history uses the requested keyset page size');
select ok((select result->'next_cursor' is not null from pg_temp.finance_wallet_transaction_test_values where key = 'history_page_1'), 'history returns a stable date and ID cursor when another page exists');
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'history_page_2', public.finance_list_transactions(
    'e2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,
    'household', null, null, null, null,
    ((result->'next_cursor'->>'transaction_date')::date),
    ((result->'next_cursor'->>'transaction_id')::uuid), 3
)
from pg_temp.finance_wallet_transaction_test_values where key = 'history_page_1';
select is(jsonb_array_length((select result->'items' from pg_temp.finance_wallet_transaction_test_values where key = 'history_page_2')), 3, 'the next history page resumes after the exact prior cursor');

select throws_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000008',
        null, null, 'transfer', current_date - 1, 1,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        null, 'Same wallet', 'none'
    )$$,
    '22023', null, 'a transfer cannot use the same wallet at both endpoints'
);
select throws_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000009',
        null, null, 'income', current_date - 1, 1, null,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        'e3000000-0000-4000-8000-000000000002', 'Invalid category', 'none'
    )$$,
    '22023', null, 'income rejects an expense category'
);
select throws_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000010',
        null, null, 'expense', current_date + 1, 100,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        null, 'e3000000-0000-4000-8000-000000000002', 'Future transaction', 'none'
    )$$,
    '22023', null, 'future actual transactions are rejected'
);
select throws_ok(
    $$insert into public.finance_transactions (household_id, created_by, kind, transaction_date, amount_minor, source_wallet_id)
      values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'expense', current_date, 1,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'))$$,
    '42501', null, 'direct transaction writes cannot bypass the mutation API'
);

-- Private wallet records and transactions are visible only to their owner.
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'private_wallet', public.finance_save_wallet(
    'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000003',
    null, null, 'Portfel prywatny', 'cash', 'private', current_date - 10, 5000, null, null
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'private_expense', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011',
    null, null, 'expense', current_date - 1, 1000,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'private_wallet'),
    null, 'e3000000-0000-4000-8000-000000000002', 'Prywatny zakup', 'none'
);
select throws_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000012',
        null, null, 'transfer', current_date - 1, 100,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'private_wallet'),
        null, 'Mixed audience', 'none'
    )$$,
    '22023', null, 'mixed shared and private transfers are rejected'
);
select is(
    (select count(*)::integer from public.finance_list_wallets(
        'e2000000-0000-4000-8000-000000000001', 'personal', current_date
    )),
    1, 'the owner personal scope lists only their private wallet'
);
select is(
    jsonb_array_length((public.finance_list_transactions(
        'e2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,
        'personal', null, null, null, null, null, null, 50
    ))->'items'),
    2, 'the owner personal scope includes its opening row and private transaction history'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.finance_wallets), 2, 'household members see shared wallets only');
select is((select count(*)::integer from public.finance_transactions), 9, 'transaction RLS hides private history and keeps both shared transfer endpoints visible');
select is(
    (select count(*)::integer from public.finance_list_wallets(
        'e2000000-0000-4000-8000-000000000001', 'personal', current_date
    )),
    0, 'another member cannot list the owner private wallet'
);
select is(
    jsonb_array_length((public.finance_list_transactions(
        'e2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,
        'personal', null, null, null, null, null, null, 50
    ))->'items'),
    0, 'private transaction reads remain empty for another member'
);
select throws_ok(
    $$select public.finance_list_wallets('e2000000-0000-4000-8000-000000000002', 'all_accessible', current_date)$$,
    '42501', null, 'an outsider cannot read another household wallet list'
);
select throws_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000002',
        null, null, 'expense', current_date - 1, 100,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'private_wallet'),
        null, 'e3000000-0000-4000-8000-000000000002', 'Private write', 'none'
    )$$,
    '42501', null, 'a household member cannot write another owners private wallet history'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Optimistic conflicts, atomic deletion, and receipt replay.
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'salary_update', public.finance_save_wallet_transaction(
    'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000013',
    (select transaction_id from pg_temp.finance_wallet_transaction_test_ids where key = 'salary'),
    1, 'income', current_date - 1, 900000, null,
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
    'e3000000-0000-4000-8000-000000000001', 'Pensja zmieniona', 'none'
);
select is((select result->>'version' from pg_temp.finance_wallet_transaction_test_values where key = 'salary_update'), '2', 'transaction edits increment the version');
select is(
    public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000014',
        (select transaction_id from pg_temp.finance_wallet_transaction_test_ids where key = 'salary'),
        1, 'income', current_date - 1, 900000, null,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        'e3000000-0000-4000-8000-000000000001', 'Stale salary', 'none'
    )->>'conflict',
    'true', 'stale transaction edits return a version conflict'
);
select is(
    (public.finance_delete_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001',
        (select transaction_id from pg_temp.finance_wallet_transaction_test_ids where key = 'contribution'), 1
    ))->>'deleted',
    'true', 'deleting a transfer deletes the single authoritative transaction row'
);
select is(
    (select count(*)::integer from public.finance_wallet_movements
     where transaction_id = (select transaction_id from pg_temp.finance_wallet_transaction_test_ids where key = 'contribution')),
    0, 'deleting a transfer removes both derived movement legs atomically'
);
select is(
    public.finance_delete_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001',
        (select transaction_id from pg_temp.finance_wallet_transaction_test_ids where key = 'contribution'), 1
    )->>'deleted',
    'true', 'deleting a transfer can be safely retried with the same request ID'
);

-- Opening corrections update the original opening row in place after preview.
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'opening_wallet', public.finance_save_wallet(
    'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000006',
    null, null, 'Portfel z korektą otwarcia', 'cash', 'household', current_date - 10, -500, null, null
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'opening_preview', public.finance_preview_wallet_opening_correction(
    'e2000000-0000-4000-8000-000000000001',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet')
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'opening_correction', public.finance_correct_wallet_opening(
    'e2000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet'),
    (select (result->>'wallet_version')::bigint from pg_temp.finance_wallet_transaction_test_values where key = 'opening_preview'),
    (select result->>'snapshot_token' from pg_temp.finance_wallet_transaction_test_values where key = 'opening_preview'),
    current_date - 9, -7500
);
select is((select result->>'opened_on' from pg_temp.finance_wallet_transaction_test_values where key = 'opening_correction'), (current_date - 9)::text, 'opening correction updates the wallet opening date');
select is((select amount_minor::text from public.finance_transactions where id = (select (result->>'opening_transaction_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_correction')), '-7500', 'opening correction updates the signed initial balance');
select is((select count(*)::integer from public.finance_transactions where kind = 'opening' and destination_wallet_id = (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet')), 1, 'opening correction edits the original row instead of creating another opening');
select is(
    public.finance_correct_wallet_opening(
        'e2000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001',
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet'),
        (select (result->>'wallet_version')::bigint from pg_temp.finance_wallet_transaction_test_values where key = 'opening_preview'),
        (select result->>'snapshot_token' from pg_temp.finance_wallet_transaction_test_values where key = 'opening_preview'),
        current_date - 9, -7500
    ),
    (select result from pg_temp.finance_wallet_transaction_test_values where key = 'opening_correction'),
    'opening correction retries return the receipt without applying another update'
);
select lives_ok(
    $$select public.finance_save_wallet_transaction(
        'e2000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001',
        null, null, 'income', current_date - 2, 100, null,
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet'),
        'e3000000-0000-4000-8000-000000000001', 'Income after opening', 'none'
    )$$,
    'wallet history accepts activity after the corrected opening date'
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'opening_preview_after_activity', public.finance_preview_wallet_opening_correction(
    'e2000000-0000-4000-8000-000000000001',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet')
);
select throws_ok(
    $$select public.finance_correct_wallet_opening(
        'e2000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000002',
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'opening_wallet'),
        (select (result->>'wallet_version')::bigint from pg_temp.finance_wallet_transaction_test_values where key = 'opening_preview_after_activity'),
        (select result->>'snapshot_token' from pg_temp.finance_wallet_transaction_test_values where key = 'opening_preview_after_activity'),
        current_date - 1, -7500
    )$$,
    '22023', null, 'opening date cannot move later than existing transaction history'
);

-- Balance correction uses a versioned snapshot and a dated adjustment, never an overwritten balance.
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'correction_wallet', public.finance_save_wallet(
    'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004',
    null, null, 'Korekta salda', 'cash', 'household', current_date - 10, 0, null, null
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'correction_preview', public.finance_preview_wallet_balance(
    'e2000000-0000-4000-8000-000000000001',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'correction_wallet'),
    current_date - 1
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'correction_result', public.finance_correct_wallet_balance(
    'e2000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'correction_wallet'),
    (select (result->>'wallet_version')::bigint from pg_temp.finance_wallet_transaction_test_values where key = 'correction_preview'),
    (select result->>'snapshot_token' from pg_temp.finance_wallet_transaction_test_values where key = 'correction_preview'),
    current_date - 1, -500, 'Saldo wyciągu bankowego'
);
select is((select result->>'adjustment_minor' from pg_temp.finance_wallet_transaction_test_values where key = 'correction_result'), '-500', 'balance reconciliation records an exact signed adjustment');
select is((select kind from public.finance_transactions where id = (select (result->>'transaction_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'correction_result')), 'adjustment', 'balance reconciliation creates a visible adjustment record');
select is(
    (select balance_minor from public.finance_list_wallets(
        'e2000000-0000-4000-8000-000000000001', 'household', current_date
    ) where id = (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'correction_wallet')),
    '-500', 'negative corrected balances are permitted and retained'
);
select is(
    public.finance_transaction_month_summary(
        'e2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,
        'household', null, null
    )->>'transaction_count',
    '7', 'adjustments are excluded and the deleted transfer is no longer counted'
);

-- Archiving is versioned, requires a zero current balance, and restore re-enables transaction edits.
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'archive_wallet', public.finance_save_wallet(
    'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000005',
    null, null, 'Pusty portfel', 'cash', 'household', current_date - 10, 0, null, null
);
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'archived', public.finance_set_wallet_archived(
    'e2000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'archive_wallet'),
    (select (result->>'version')::bigint from pg_temp.finance_wallet_transaction_test_values where key = 'archive_wallet'), true
);
select is((select result->>'is_archived' from pg_temp.finance_wallet_transaction_test_values where key = 'archived'), 'true', 'zero-balance wallets can be archived');
insert into pg_temp.finance_wallet_transaction_test_values (key, result)
select 'restored', public.finance_set_wallet_archived(
    'e2000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002',
    (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'archive_wallet'),
    (select (result->>'version')::bigint from pg_temp.finance_wallet_transaction_test_values where key = 'archived'), false
);
select is((select result->>'is_archived' from pg_temp.finance_wallet_transaction_test_values where key = 'restored'), 'false', 'wallets can be restored with an expected version');
select throws_ok(
    $$select public.finance_set_wallet_archived(
        'e2000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000003',
        (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a'),
        (select version from public.finance_wallets where id = (select (result->>'wallet_id')::uuid from pg_temp.finance_wallet_transaction_test_values where key = 'wallet_a')), true
    )$$,
    '22023', null, 'nonzero-balance wallets cannot be archived'
);

select * from finish();
rollback;
