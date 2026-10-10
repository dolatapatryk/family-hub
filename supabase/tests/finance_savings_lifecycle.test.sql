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


insert into public.finance_savings_accounts (id, household_id, created_by, name, account_type, parent_id, opening_balance) values
('93000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Shared child', 'cash', '93000000-0000-4000-8000-000000000001', 5000),
('93000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Private child', 'goal', '93000000-0000-4000-8000-000000000002', 2000);
insert into public.finance_savings_plans (id, household_id, created_by, name, plan_type, account_id, monthly_amount) values
('95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Linked plan', 'goal', '93000000-0000-4000-8000-000000000007', 500);
insert into public.finance_savings_transactions (household_id, created_by, account_id, transaction_date, amount) values
('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '2026-10-11', 1000);
create temporary table lifecycle_values (key text primary key, value jsonb);
grant all on pg_temp.lifecycle_values to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(not has_function_privilege('anon', 'public.finance_preview_account_lifecycle(uuid,uuid)', 'EXECUTE'), 'preview is not anonymous');
select ok(not has_function_privilege('anon', 'public.finance_apply_account_lifecycle(uuid,uuid,uuid,bigint,text,text,bigint,text)', 'EXECUTE'), 'lifecycle is not anonymous');
insert into pg_temp.lifecycle_values values ('initial', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001'));
select is((select value->>'display_balance_minor' from pg_temp.lifecycle_values where key='initial'), '6000', 'preview sums own history and active child balance');
insert into pg_temp.lifecycle_values values ('archived', public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='initial'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='initial'), 'archive', null, null));
select is(public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='initial'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='initial'), 'archive', null, null), (select value from pg_temp.lifecycle_values where key='archived'), 'archive retries return the receipt');
insert into pg_temp.lifecycle_values values ('child_under_archive', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000006'));
select is((select value->>'ancestor_archived' from pg_temp.lifecycle_values where key='child_under_archive'), 'true', 'archive is inherited without rewriting descendants');
select throws_ok($$select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000006', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='child_under_archive'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='child_under_archive'), 'restore', null, null)$$, '22023', null, 'restore requires active ancestors');
select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000006', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='child_under_archive'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='child_under_archive'), 'archive', null, null);
insert into pg_temp.lifecycle_values values ('root_restore', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001'));
select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='root_restore'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='root_restore'), 'restore', null, null);
select is((select is_archived from public.finance_savings_accounts where id='93000000-0000-4000-8000-000000000006'), true, 'restoring a parent preserves independent child archives');
insert into pg_temp.lifecycle_values values ('correction', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001'));
select is((select value->>'active_children_balance_minor' from pg_temp.lifecycle_values where key='correction'), '0', 'archived children are excluded from correction');
insert into pg_temp.lifecycle_values values ('corrected', public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000001', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='correction'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='correction'), 'balance', 12345, null));
select is(public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000001', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='correction'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='correction'), 'balance', 12345, null), (select value from pg_temp.lifecycle_values where key='corrected'), 'correction retry cannot apply twice');
select is((select opening_balance::text from public.finance_savings_accounts where id='93000000-0000-4000-8000-000000000001'), '11345', 'correction subtracts existing movements');
select is((select count(*)::integer from public.finance_savings_transactions), 1, 'correction does not post savings income');
insert into pg_temp.lifecycle_values values ('stale_movement', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001'));
select public.finance_save_transaction('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', null, null, '93000000-0000-4000-8000-000000000001', '2026-10-11', 25, null, null, false);
select is(public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000006', '93000000-0000-4000-8000-000000000001', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='stale_movement'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='stale_movement'), 'balance', 20000, null)->>'conflict', 'true', 'movement changes invalidate a preview even with unchanged account version');
insert into pg_temp.lifecycle_values values ('private_share', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002'));
insert into pg_temp.lifecycle_values values ('shared', public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000007', '93000000-0000-4000-8000-000000000002', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='private_share'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='private_share'), 'visibility', null, 'household'));
select is(public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000007', '93000000-0000-4000-8000-000000000002', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='private_share'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='private_share'), 'visibility', null, 'household'), (select value from pg_temp.lifecycle_values where key='shared'), 'sharing retry returns original receipt');
select is((select visibility from public.finance_savings_accounts where id='93000000-0000-4000-8000-000000000007'), 'household', 'sharing updates all descendants');
select is((select visibility from public.finance_savings_plans where id='95000000-0000-4000-8000-000000000001'), 'household', 'sharing updates linked plans');
set constraints all immediate;
set constraints all deferred;
insert into pg_temp.lifecycle_values values ('child_scope', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000007'));
select throws_ok($$select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000008', '93000000-0000-4000-8000-000000000007', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='child_scope'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='child_scope'), 'visibility', null, 'private')$$, '42501', null, 'visibility may change only from the root');
select public.finance_transfer_savings('92000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', (select version from public.finance_savings_accounts where id='93000000-0000-4000-8000-000000000002'), '93000000-0000-4000-8000-000000000001', (select version from public.finance_savings_accounts where id='93000000-0000-4000-8000-000000000001'), 100, '2026-10-11', null);
insert into pg_temp.lifecycle_values values ('external', public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002'));
select is((select value->>'external_transfer_count' from pg_temp.lifecycle_values where key='external'), '1', 'external transfers appear as blockers without peer details');
select throws_ok($$select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000009', '93000000-0000-4000-8000-000000000002', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='external'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='external'), 'visibility', null, 'private')$$, '22023', null, 'external transfer blocks sharing changes');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000010', '93000000-0000-4000-8000-000000000002', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='external'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='external'), 'visibility', null, 'private')$$, '42501', null, 'other household members cannot change the owner tree visibility');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001')$$, '42501', null, 'outsiders cannot preview a tree');
select throws_ok($$select public.finance_apply_account_lifecycle('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000002', (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='external'), (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='external'), 'archive', null, null)$$, '42501', null, 'outsiders cannot mutate a tree');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.finance_preview_account_lifecycle('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000003')$$, '42501', null, 'a member cannot preview another members private account');
select throws_ok($$select public.finance_apply_account_lifecycle(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    (select (value->>'version')::bigint from pg_temp.lifecycle_values where key='initial'),
    (select value->>'snapshot_token' from pg_temp.lifecycle_values where key='initial'),
    'balance', 1, null
)$$, 'P0001', null, 'request IDs cannot be reused with different lifecycle input');
reset role;
select * from finish();
rollback;
