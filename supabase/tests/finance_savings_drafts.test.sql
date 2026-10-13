begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(to_regclass('public.finance_savings_plans') is not null, 'saved savings templates remain available');
select ok(to_regclass('public.finance_planned_savings_transactions') is null, 'monthly savings drafts are removed');
select ok(to_regclass('private.finance_savings_plan_month_loads') is null, 'monthly template-load markers are removed');
select ok(to_regclass('private.finance_import_runs') is null, 'the finance import-run ledger is removed');
select ok(to_regclass('public.bill_skips') is null, 'bill skips are represented by unified payment history');

select is((
    select count(*)::integer from information_schema.columns
    where table_schema = 'public'
      and table_name = any(array[
          'finance_categories', 'finance_budget_items', 'finance_scenarios',
          'finance_scenario_items', 'finance_savings_accounts', 'finance_savings_plans',
          'finance_irregular_expense_plans', 'finance_projects', 'finance_project_expenses'
      ])
      and column_name = 'sort_order'
), 0, 'finance sort_order columns are removed');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_savings_accounts' and column_name = 'color'), 'savings account color is removed');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_months' and column_name = 'version'), 'finance months have no unused version');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_savings_transactions' and column_name in ('budget_month_id', 'source_planned_transaction_id')), 'savings transaction month and draft provenance columns are removed');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_savings_plans' and column_name = 'source_savings_plan_id'), 'saved templates are independent of monthly drafts');

select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_savings_accounts' and column_name = 'version'), 'savings accounts retain optimistic concurrency versions');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_savings_plans' and column_name = 'version'), 'saved templates retain optimistic concurrency versions');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_scenario_items' and column_name = 'version'), 'scenario items retain optimistic concurrency versions');

select ok(exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'finance_legacy_id_map' and column_name = 'source_sha256'), 'the repair importer retains its source fingerprint map');
select ok(exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'finance_legacy_id_map' and column_name = 'imported_by'), 'the repair importer retains its original actor');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'finance_legacy_id_map' and column_name = 'import_run_id'), 'the legacy map no longer depends on import runs');

select ok(not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('finance_save_draft', 'finance_delete_draft', 'finance_accept_savings_plan', 'finance_load_savings_plan')
), 'monthly draft RPCs are removed');

select * from finish();
rollback;
