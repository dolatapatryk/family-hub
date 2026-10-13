-- Consolidate bill-cycle history and remove unused persistence from monthly savings plans.
begin;

alter table public.bill_payments add column status text not null default 'paid';
alter table public.bill_payments
    alter column paid_on drop not null,
    alter column amount_minor drop not null,
    alter column currency drop not null;
alter table public.bill_payments
    drop constraint bill_payments_paid_on_finite,
    drop constraint bill_payments_amount_positive,
    drop constraint bill_payments_currency_code;

insert into public.bill_payments (
    id, bill_id, household_id, due_on, status, paid_on, amount_minor, currency, created_by, created_at
)
select skip.id, skip.bill_id, skip.household_id, skip.due_on, 'skipped', null, null, null, skip.skipped_by, skip.skipped_at
from public.bill_skips as skip;

alter table public.bill_payments
    add constraint bill_payments_status check (status in ('paid', 'skipped')),
    add constraint bill_payments_state_valid check (
        (status = 'paid' and paid_on is not null and isfinite(paid_on)
            and amount_minor is not null and amount_minor > 0
            and currency is not null and currency ~ '^[A-Z]{3}$')
        or (status = 'skipped' and paid_on is null and amount_minor is null and currency is null)
    );
drop index public.bill_payments_household_paid_on_idx;
create index bill_payments_household_paid_on_idx
    on public.bill_payments (household_id, paid_on desc) where status = 'paid';
grant select (status) on table public.bill_payments to authenticated;

create or replace function public.update_bill(
    p_bill_id uuid,
    p_title text,
    p_next_due_on date,
    p_interval_months smallint,
    p_expected_amount_minor bigint,
    p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    bill_row public.bills%rowtype;
    normalized_title text := pg_catalog.btrim(p_title);
    normalized_currency text := pg_catalog.upper(pg_catalog.btrim(p_currency));
begin
    if (select auth.uid()) is null then
        raise exception 'Authentication is required to update a bill'
            using errcode = '42501';
    end if;

    select * into bill_row
    from public.bills
    where public.bills.id = p_bill_id
    for update;

    if not found or not private.is_household_member(bill_row.household_id) then
        raise exception 'Bill was not found in your household'
            using errcode = '42501';
    end if;

    if normalized_title is null or pg_catalog.char_length(normalized_title) = 0 then
        raise exception 'Bill name must not be blank'
            using errcode = '22023';
    end if;

    if p_next_due_on is null or not isfinite(p_next_due_on) then
        raise exception 'A valid next due date is required'
            using errcode = '22023';
    end if;

    if p_expected_amount_minor is not null and p_expected_amount_minor <= 0 then
        raise exception 'Expected amount must be greater than zero'
            using errcode = '22023';
    end if;

    if p_interval_months is null or p_interval_months not in (1, 2) then
        raise exception 'Bill interval must be one or two months'
            using errcode = '22023';
    end if;

    if normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter code such as PLN or EUR'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.bill_payments
        where public.bill_payments.bill_id = p_bill_id
          and public.bill_payments.due_on = p_next_due_on
    ) then
        raise exception 'That cycle already has an entry in the history'
            using errcode = '23505';
    end if;

    update public.bills
    set title = normalized_title,
        due_day = extract(day from p_next_due_on)::smallint,
        interval_months = p_interval_months,
        next_due_on = p_next_due_on,
        expected_amount_minor = p_expected_amount_minor,
        currency = normalized_currency
    where public.bills.id = p_bill_id;

    return p_bill_id;
end;
$$;

create or replace function public.skip_bill_cycle(p_bill_id uuid, p_due_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    bill_row public.bills%rowtype;
    new_history_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to skip a bill cycle'
            using errcode = '42501';
    end if;

    select * into bill_row
    from public.bills
    where public.bills.id = p_bill_id
    for update;

    if not found or not private.is_household_member(bill_row.household_id) then
        raise exception 'Bill was not found in your household'
            using errcode = '42501';
    end if;

    if not bill_row.active then
        raise exception 'Paused bills cannot skip cycles'
            using errcode = '55000';
    end if;

    if p_due_on is null or not isfinite(p_due_on) or p_due_on <> bill_row.next_due_on then
        raise exception 'This bill cycle has changed. Refresh the page and try again.'
            using errcode = '40001';
    end if;

    if exists (
        select 1
        from public.bill_payments
        where public.bill_payments.bill_id = p_bill_id
          and public.bill_payments.due_on = p_due_on
    ) then
        raise exception 'This cycle already has a history entry'
            using errcode = '23505';
    end if;

    insert into public.bill_payments (bill_id, household_id, due_on, status, paid_on, amount_minor, currency, created_by)
    values (bill_row.id, bill_row.household_id, bill_row.next_due_on, 'skipped', null, null, null, current_user_id)
    returning id into new_history_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.interval_months, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_history_id;
end;
$$;

create or replace function public.record_bill_payment(
    p_bill_id uuid,
    p_due_on date,
    p_paid_on date,
    p_amount_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    bill_row public.bills%rowtype;
    new_payment_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to record a bill payment'
            using errcode = '42501';
    end if;

    select * into bill_row
    from public.bills
    where public.bills.id = p_bill_id
    for update;

    if not found or not private.is_household_member(bill_row.household_id) then
        raise exception 'Bill was not found in your household'
            using errcode = '42501';
    end if;

    if not bill_row.active then
        raise exception 'Paused bills cannot receive payments'
            using errcode = '55000';
    end if;

    if p_due_on is null or not isfinite(p_due_on) or p_due_on <> bill_row.next_due_on then
        raise exception 'This bill cycle has changed. Refresh the page and try again.'
            using errcode = '40001';
    end if;

    if p_paid_on is null or not isfinite(p_paid_on) then
        raise exception 'A valid payment date is required'
            using errcode = '22023';
    end if;

    if p_amount_minor is null or p_amount_minor <= 0 then
        raise exception 'Amount paid must be greater than zero'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.bill_payments
        where public.bill_payments.bill_id = p_bill_id
          and public.bill_payments.due_on = p_due_on
          and public.bill_payments.status = 'skipped'
    ) then
        raise exception 'A skipped cycle cannot be marked as paid'
            using errcode = '23505';
    end if;

    insert into public.bill_payments (
        bill_id, household_id, due_on, status, paid_on, amount_minor, currency, created_by
    )
    values (
        bill_row.id, bill_row.household_id, bill_row.next_due_on, 'paid', p_paid_on,
        p_amount_minor, bill_row.currency, current_user_id
    )
    returning id into new_payment_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.interval_months, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_payment_id;
end;
$$;

drop table public.bill_skips;

drop trigger finance_months_touch_row on public.finance_months;
alter table public.finance_months drop column version;
create function private.finance_touch_month()
returns trigger language plpgsql set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        new.updated_at := pg_catalog.now();
        return new;
    end if;
    if new.id is distinct from old.id
        or new.household_id is distinct from old.household_id
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at then
        raise exception 'Finance row identity and ownership cannot be changed' using errcode = '42501';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;
revoke all on function private.finance_touch_month() from public, anon, authenticated;
create trigger finance_months_touch_updated_at before insert or update on public.finance_months
for each row execute function private.finance_touch_month();

drop index public.finance_categories_parent_idx;
create index finance_categories_parent_idx on public.finance_categories (household_id, parent_id, name, id);
drop index public.finance_budget_items_month_idx;
create index finance_budget_items_month_idx on public.finance_budget_items (household_id, month_id, id);
drop index public.finance_scenarios_sort_idx;
create index finance_scenarios_household_name_idx on public.finance_scenarios (household_id, name, id);
drop index public.finance_scenario_items_scenario_idx;
create index finance_scenario_items_scenario_idx on public.finance_scenario_items (household_id, scenario_id, id);
drop index public.finance_irregular_expense_plans_sort_idx;
create index finance_irregular_expense_plans_household_name_idx on public.finance_irregular_expense_plans (household_id, name, id);
drop index public.finance_projects_sort_idx;
create index finance_projects_household_name_idx on public.finance_projects (household_id, name, id);

alter table public.finance_categories drop column sort_order;
alter table public.finance_budget_items drop column sort_order;
alter table public.finance_scenarios drop column sort_order;
alter table public.finance_scenario_items drop column sort_order;
alter table public.finance_savings_accounts drop column color, drop column sort_order;
alter table public.finance_savings_plans drop column sort_order;
alter table public.finance_irregular_expense_plans drop column sort_order;
alter table public.finance_projects drop column sort_order;
alter table public.finance_project_expenses drop column sort_order;

drop function public.finance_save_draft(uuid, uuid, uuid, bigint, uuid, uuid, bigint, text, uuid);
drop function public.finance_delete_draft(uuid, uuid, uuid, bigint);
drop function public.finance_accept_savings_plan(uuid, uuid, uuid);
drop function public.finance_load_savings_plan(uuid, uuid, uuid);
drop table private.finance_savings_plan_month_loads;
drop table public.finance_planned_savings_transactions;

drop function public.finance_save_account(uuid, uuid, uuid, bigint, text, text, uuid, bigint, bigint, text, text, integer);
drop function public.finance_save_transaction(uuid, uuid, uuid, bigint, uuid, date, bigint, text, uuid, boolean);
create function public.finance_save_account(
    p_household_id uuid,
    p_request_id uuid,
    p_account_id uuid,
    p_expected_version bigint,
    p_name text,
    p_account_type text,
    p_parent_id uuid,
    p_opening_balance_minor bigint,
    p_target_amount_minor bigint,
    p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := (select auth.uid());
    v_request jsonb;
    v_request_sha256 text;
    v_saved_sha256 text;
    v_saved_result jsonb;
    v_account public.finance_savings_accounts%rowtype;
    v_parent public.finance_savings_accounts%rowtype;
    v_account_id uuid;
    v_version bigint;
    v_has_archived_ancestor boolean;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null then
        raise exception 'A finance request ID is required' using errcode = '22023';
    end if;
    if p_name is null or pg_catalog.char_length(pg_catalog.btrim(p_name)) = 0
        or pg_catalog.char_length(p_name) > 160
        or p_account_type is null
        or p_account_type not in ('cash', 'goal', 'investment', 'retirement')
        or p_visibility is null or p_visibility not in ('household', 'private')
        or p_target_amount_minor is not null and p_target_amount_minor <= 0 then
        raise exception 'Invalid savings account details' using errcode = '22023';
    end if;
    if p_account_id is null then
        if p_expected_version is not null or p_opening_balance_minor is null then
            raise exception 'A new account requires an opening balance and no expected version'
                using errcode = '22023';
        end if;
    elsif p_expected_version is null or p_expected_version < 1 then
        raise exception 'An account update requires its expected version' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'account_id', p_account_id,
        'expected_version', p_expected_version,
        'name', pg_catalog.btrim(p_name),
        'account_type', p_account_type,
        'parent_id', p_parent_id,
        'opening_balance_minor', p_opening_balance_minor,
        'target_amount_minor', p_target_amount_minor,
        'visibility', p_visibility
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'),
        'hex'
    );

    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id
      and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_save_account'
      and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        v_account_id := (v_saved_result->>'account_id')::uuid;
        if not private.finance_can_access_savings_account(p_household_id, v_account_id) then
            raise exception 'Savings account access denied' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    if p_account_id is null then
        if p_parent_id is null then
            if p_visibility not in ('household', 'private') then
                raise exception 'Savings account access denied' using errcode = '42501';
            end if;
        else
            select account.* into v_parent
            from public.finance_savings_accounts as account
            where account.household_id = p_household_id
              and account.id = p_parent_id;
            if not found or not private.finance_can_access_savings_account(p_household_id, p_parent_id) then
                raise exception 'Savings account access denied' using errcode = '42501';
            end if;
            if p_visibility is distinct from v_parent.visibility then
                raise exception 'Child accounts inherit their parent privacy scope' using errcode = '22023';
            end if;
            with recursive account_ancestors(id, parent_id, is_archived) as (
                select account.id, account.parent_id, account.is_archived
                from public.finance_savings_accounts as account
                where account.household_id = p_household_id
                  and account.id = p_parent_id
                union all
                select parent.id, parent.parent_id, parent.is_archived
                from account_ancestors as ancestry
                join public.finance_savings_accounts as parent
                  on parent.household_id = p_household_id
                 and parent.id = ancestry.parent_id
            )
            select coalesce(pg_catalog.bool_or(ancestry.is_archived), false)
            into v_has_archived_ancestor
            from account_ancestors as ancestry;
            if v_has_archived_ancestor then
                raise exception 'Archived savings accounts cannot receive child accounts'
                    using errcode = '22023';
            end if;
        end if;

        insert into public.finance_savings_accounts (
            household_id, created_by, name, account_type, parent_id,
            opening_balance, target_amount, visibility
        ) values (
            p_household_id, v_actor_id, pg_catalog.btrim(p_name), p_account_type,
            p_parent_id, p_opening_balance_minor, p_target_amount_minor,
            p_visibility
        ) returning id, version into v_account_id, v_version;
    else
        select account.* into v_account
        from public.finance_savings_accounts as account
        where account.household_id = p_household_id
          and account.id = p_account_id
        for update;
        if not found or not private.finance_can_access_savings_account(p_household_id, p_account_id) then
            raise exception 'Savings account access denied' using errcode = '42501';
        end if;
        if v_account.version <> p_expected_version then
            return pg_catalog.jsonb_build_object(
                'conflict', true,
                'account_id', v_account.id,
                'current_version', v_account.version
            );
        end if;
        if p_parent_id is distinct from v_account.parent_id
            or p_visibility is distinct from v_account.visibility then
            raise exception 'Account hierarchy and privacy changes require their dedicated operation'
                using errcode = '22023';
        end if;
        if p_opening_balance_minor is not null
            and p_opening_balance_minor is distinct from v_account.opening_balance then
            raise exception 'Opening balance changes require the balance correction operation'
                using errcode = '22023';
        end if;

        update public.finance_savings_accounts as account
        set name = pg_catalog.btrim(p_name),
            account_type = p_account_type,
            target_amount = p_target_amount_minor
        where account.household_id = p_household_id
          and account.id = p_account_id
        returning account.id, account.version into v_account_id, v_version;
    end if;

    v_saved_result := pg_catalog.jsonb_build_object(
        'account_id', v_account_id,
        'version', v_version
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_save_account', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;
revoke all on function public.finance_save_account(uuid, uuid, uuid, bigint, text, text, uuid, bigint, bigint, text) from public, anon;
grant execute on function public.finance_save_account(uuid, uuid, uuid, bigint, text, text, uuid, bigint, bigint, text) to authenticated;

create function public.finance_save_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
    p_expected_version bigint,
    p_account_id uuid,
    p_transaction_date date,
    p_amount_minor bigint,
    p_description text,
    p_excluded_from_monthly_savings boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := (select auth.uid());
    v_request jsonb;
    v_request_sha256 text;
    v_saved_sha256 text;
    v_saved_result jsonb;
    v_existing public.finance_savings_transactions%rowtype;
    v_account public.finance_savings_accounts%rowtype;
    v_transaction_id uuid;
    v_version bigint;
    v_has_archived_ancestor boolean;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null then
        raise exception 'A finance request ID is required' using errcode = '22023';
    end if;
    if p_account_id is null or p_transaction_date is null
        or not pg_catalog.isfinite(p_transaction_date)
        or p_transaction_date < date '0001-01-01'
        or p_transaction_date > date '9999-12-31'
        or p_amount_minor is null
        or p_amount_minor < -999999999999999999
        or p_amount_minor > 999999999999999999
        or p_excluded_from_monthly_savings is null
        or p_description is not null and pg_catalog.char_length(p_description) > 2000 then
        raise exception 'Invalid savings transaction details' using errcode = '22023';
    end if;
    if p_transaction_id is null then
        if p_expected_version is not null then
            raise exception 'A new transaction cannot have an expected version' using errcode = '22023';
        end if;
    elsif p_expected_version is null or p_expected_version < 1 then
        raise exception 'A transaction update requires its expected version' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'transaction_id', p_transaction_id,
        'expected_version', p_expected_version,
        'account_id', p_account_id,
        'transaction_date', p_transaction_date,
        'amount_minor', p_amount_minor,
        'description', nullif(pg_catalog.btrim(p_description), ''),
        'excluded_from_monthly_savings', p_excluded_from_monthly_savings
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'),
        'hex'
    );

    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id
      and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_save_transaction'
      and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        if not private.finance_can_access_savings_account(
            p_household_id, (v_saved_result->>'account_id')::uuid
        ) then
            raise exception 'Savings transaction access denied' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    select account.* into v_account
    from public.finance_savings_accounts as account
    where account.household_id = p_household_id
      and account.id = p_account_id;
    if not found or not private.finance_can_access_savings_account(p_household_id, p_account_id) then
        raise exception 'Savings transaction access denied' using errcode = '42501';
    end if;
    with recursive account_ancestors(id, parent_id, is_archived) as (
        select account.id, account.parent_id, account.is_archived
        from public.finance_savings_accounts as account
        where account.household_id = p_household_id
          and account.id = p_account_id
        union all
        select parent.id, parent.parent_id, parent.is_archived
        from account_ancestors as ancestry
        join public.finance_savings_accounts as parent
          on parent.household_id = p_household_id
         and parent.id = ancestry.parent_id
    )
    select coalesce(pg_catalog.bool_or(ancestry.is_archived), false)
    into v_has_archived_ancestor
    from account_ancestors as ancestry;
    if v_has_archived_ancestor then
        raise exception 'Archived savings accounts cannot receive transactions' using errcode = '22023';
    end if;

    if p_transaction_id is null then
        insert into public.finance_savings_transactions (
            household_id, created_by, account_id, transaction_date, amount,
            description, excluded_from_monthly_savings
        ) values (
            p_household_id, v_actor_id, p_account_id, p_transaction_date,
            p_amount_minor, nullif(pg_catalog.btrim(p_description), ''),
            p_excluded_from_monthly_savings
        ) returning id, version into v_transaction_id, v_version;
    else
        select movement.* into v_existing
        from public.finance_savings_transactions as movement
        where movement.household_id = p_household_id
          and movement.id = p_transaction_id
        for update;
        if not found
            or not private.finance_can_access_savings_account(p_household_id, v_existing.account_id) then
            raise exception 'Savings transaction access denied' using errcode = '42501';
        end if;
        if v_existing.transfer_id is not null then
            raise exception 'Transfer legs must be changed through transfer operations' using errcode = '22023';
        end if;
        if v_existing.version <> p_expected_version then
            return pg_catalog.jsonb_build_object(
                'conflict', true,
                'transaction_id', v_existing.id,
                'current_version', v_existing.version
            );
        end if;

        update public.finance_savings_transactions as movement
        set account_id = p_account_id,
            transaction_date = p_transaction_date,
            amount = p_amount_minor,
            description = nullif(pg_catalog.btrim(p_description), ''),
            excluded_from_monthly_savings = p_excluded_from_monthly_savings
        where movement.household_id = p_household_id
          and movement.id = p_transaction_id
        returning movement.id, movement.version into v_transaction_id, v_version;
    end if;

    v_saved_result := pg_catalog.jsonb_build_object(
        'transaction_id', v_transaction_id,
        'account_id', p_account_id,
        'version', v_version
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_save_transaction', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;
revoke all on function public.finance_save_transaction(uuid, uuid, uuid, bigint, uuid, date, bigint, text, boolean) from public, anon;
grant execute on function public.finance_save_transaction(uuid, uuid, uuid, bigint, uuid, date, bigint, text, boolean) to authenticated;

drop index public.finance_savings_transactions_month_idx;
drop index public.finance_savings_transactions_source_draft_unique;
alter table public.finance_savings_transactions
    drop constraint finance_savings_transactions_month_fk,
    drop column budget_month_id,
    drop column source_planned_transaction_id;

create or replace function public.finance_create_month(
    p_household_id uuid,
    p_request_id uuid,
    p_month_start date,
    p_source_kind text,
    p_source_month_id uuid,
    p_scenario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_id uuid := (select auth.uid());
    v_request jsonb;
    v_request_sha256 text;
    v_saved_sha256 text;
    v_saved_result jsonb;
    v_month public.finance_months%rowtype;
    v_inserted boolean := false;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null then
        raise exception 'A finance request ID is required' using errcode = '22023';
    end if;
    if p_month_start is null
        or not pg_catalog.isfinite(p_month_start)
        or extract(day from p_month_start) <> 1 then
        raise exception 'Month start must be the first day of a valid month' using errcode = '22007';
    end if;
    if p_source_kind is null
        or (p_source_kind = 'empty' and (p_source_month_id is not null or p_scenario_id is not null))
        or (p_source_kind = 'recurring' and (p_source_month_id is null or p_scenario_id is not null))
        or (p_source_kind = 'scenario' and (p_source_month_id is not null or p_scenario_id is null))
        or p_source_kind not in ('empty', 'recurring', 'scenario') then
        raise exception 'Invalid finance month source' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);

    v_request := pg_catalog.jsonb_build_object(
        'month_start', p_month_start,
        'source_kind', p_source_kind,
        'source_month_id', p_source_month_id,
        'scenario_id', p_scenario_id
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'),
        'hex'
    );

    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id
      and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_create_month'
      and receipt.request_id = p_request_id
    for update;

    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        return v_saved_result;
    end if;

    select target_month.*
    into v_month
    from public.finance_months as target_month
    where target_month.household_id = p_household_id
      and target_month.month_start = p_month_start;

    if found then
        v_saved_result := pg_catalog.to_jsonb(v_month);
        insert into private.finance_operation_receipts (
            household_id, actor_id, operation_name, request_id, request_sha256, result
        ) values (
            p_household_id, v_actor_id, 'finance_create_month', p_request_id,
            v_request_sha256, v_saved_result
        );
        return v_saved_result;
    end if;

    if p_source_kind = 'recurring' and not exists (
        select 1 from public.finance_months as source_month
        where source_month.household_id = p_household_id
          and source_month.id = p_source_month_id
    ) then
        raise exception 'Source month is unavailable' using errcode = 'P0002';
    end if;
    if p_source_kind = 'scenario' and not exists (
        select 1 from public.finance_scenarios as source_scenario
        where source_scenario.household_id = p_household_id
          and source_scenario.id = p_scenario_id
    ) then
        raise exception 'Source scenario is unavailable' using errcode = 'P0002';
    end if;

    insert into public.finance_months (household_id, created_by, month_start)
    values (p_household_id, v_actor_id, p_month_start)
    on conflict (household_id, month_start) do nothing
    returning * into v_month;

    v_inserted := found;
    if not v_inserted then
        select target_month.*
        into v_month
        from public.finance_months as target_month
        where target_month.household_id = p_household_id
          and target_month.month_start = p_month_start;
    end if;

    if v_inserted and p_source_kind = 'recurring' then
        insert into public.finance_budget_items (
            household_id, created_by, month_id, category_id, name, amount,
            is_planned, is_recurring, notes
        )
        select p_household_id, v_actor_id, v_month.id, item.category_id, item.name, item.amount,
               false, item.is_recurring, item.notes
        from public.finance_budget_items as item
        where item.household_id = p_household_id
          and item.month_id = p_source_month_id
          and item.is_recurring;
    elsif v_inserted and p_source_kind = 'scenario' then
        insert into public.finance_budget_items (
            household_id, created_by, month_id, category_id, name, amount,
            is_planned, is_recurring, notes
        )
        select p_household_id, v_actor_id, v_month.id, item.category_id, item.name, item.amount,
               false, item.is_recurring, item.notes
        from public.finance_scenario_items as item
        where item.household_id = p_household_id
          and item.scenario_id = p_scenario_id;
    end if;

    v_saved_result := pg_catalog.to_jsonb(v_month);
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_create_month', p_request_id,
        v_request_sha256, v_saved_result
    );

    return v_saved_result;
end;
$$;

create or replace function public.finance_mutate_savings_plan(
    p_household_id uuid, p_request_id uuid, p_plan_id uuid,
    p_expected_version bigint, p_delete boolean, p_details jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_old public.finance_savings_plans%rowtype;
    v_account public.finance_savings_accounts%rowtype;
    v_account_id uuid := (p_details->>'account_id')::uuid;
    v_visibility text := p_details->>'visibility';
    v_name text := pg_catalog.btrim(p_details->>'name');
    v_type text := p_details->>'plan_type';
    v_monthly public.finance_minor_units := (p_details->>'monthly_amount_minor')::bigint;
    v_annual public.finance_minor_units := (p_details->>'annual_amount_override_minor')::bigint;
    v_hash text;
    v_saved_hash text;
    v_result jsonb;
    v_id uuid;
    v_version bigint;
begin
    if v_actor is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_delete is null
        or (p_plan_id is null and (p_delete or p_expected_version is not null))
        or (p_plan_id is not null and (p_expected_version is null or p_expected_version < 1)) then
        raise exception 'Invalid savings plan mutation request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'plan_id', p_plan_id, 'version', p_expected_version, 'delete', p_delete, 'details', p_details)::text, 'UTF8'), 'sha256'), 'hex');
    select r.request_sha256, r.result into v_saved_hash, v_result from private.finance_operation_receipts r
    where r.household_id = p_household_id and r.actor_id = v_actor
      and r.operation_name = 'finance_mutate_savings_plan' and r.request_id = p_request_id;
    if found then
        if v_hash <> v_saved_hash then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        if (v_result->>'deleted')::boolean then
            if not private.finance_can_read_savings_plan(p_household_id, (v_result->>'account_id')::uuid,
                v_result->>'visibility', (v_result->>'owner_user_id')::uuid) then
                raise exception 'Savings plan access denied' using errcode = '42501';
            end if;
        elsif not exists (select 1 from public.finance_savings_plans p
            where p.household_id = p_household_id and p.id = (v_result->>'plan_id')::uuid
            and private.finance_can_read_savings_plan(p.household_id, p.account_id, p.visibility, p.owner_user_id)) then
            raise exception 'Savings plan access denied' using errcode = '42501';
        end if;
        return v_result;
    end if;
    if p_plan_id is not null then
        select p.* into v_old from public.finance_savings_plans p
        where p.household_id = p_household_id and p.id = p_plan_id for update;
        if not found or not private.finance_can_read_savings_plan(p_household_id, v_old.account_id, v_old.visibility, v_old.owner_user_id) then
            raise exception 'Savings plan access denied' using errcode = '42501';
        end if;
        if v_old.version <> p_expected_version then
            return pg_catalog.jsonb_build_object('conflict', true, 'current_version', v_old.version);
        end if;
    end if;
    if p_delete then
        delete from public.finance_savings_plans where household_id = p_household_id and id = p_plan_id;
        v_result := pg_catalog.jsonb_build_object('deleted', true, 'plan_id', p_plan_id,
            'account_id', v_old.account_id, 'visibility', v_old.visibility, 'owner_user_id', v_old.owner_user_id);
    else
        if v_name is null or pg_catalog.char_length(v_name) = 0 or pg_catalog.char_length(v_name) > 160
            or v_type is null or v_type not in ('cash', 'goal', 'investment', 'retirement', 'irregular')
            or v_visibility is null or v_visibility not in ('private', 'household')
            or v_monthly is null or v_monthly < 0 or v_annual < 0
            or (v_annual is null and v_monthly::numeric * 12 > 999999999999999999) then
            raise exception 'Invalid savings plan details' using errcode = '22023';
        end if;
        if v_account_id is not null then
            select a.* into v_account from public.finance_savings_accounts a
            where a.household_id = p_household_id and a.id = v_account_id;
            if not found or not private.finance_can_access_savings_account(p_household_id, v_account_id) then
                raise exception 'Savings account access denied' using errcode = '42501';
            end if;
            if v_account.account_type <> v_type or v_account.visibility <> v_visibility then
                raise exception 'Linked plans inherit account type and visibility' using errcode = '22023';
            end if;
        end if;
        if p_plan_id is not null and (v_old.account_id is distinct from v_account_id or v_old.visibility <> v_visibility) then
            if v_old.owner_user_id <> v_actor then
                raise exception 'Only the owner can change a plan account link or visibility' using errcode = '42501';
            end if;
            if (v_account_id is not null and v_account.owner_user_id <> v_old.owner_user_id)
                or (v_account_id is null and v_old.created_by <> v_old.owner_user_id) then
                raise exception 'Savings plan ownership cannot be reassigned' using errcode = '42501';
            end if;
        end if;
        if p_plan_id is null then
            insert into public.finance_savings_plans (household_id, created_by, name, plan_type, account_id,
                monthly_amount, annual_amount_override, visibility)
            values (p_household_id, v_actor, v_name, v_type, v_account_id, v_monthly, v_annual,
                v_visibility) returning id, version into v_id, v_version;
        else
            update public.finance_savings_plans set name = v_name, plan_type = v_type, account_id = v_account_id,
                monthly_amount = v_monthly, annual_amount_override = v_annual, visibility = v_visibility
            where household_id = p_household_id and id = p_plan_id returning id, version into v_id, v_version;
        end if;
        v_result := pg_catalog.jsonb_build_object('plan_id', v_id, 'version', v_version, 'deleted', false);
    end if;
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_mutate_savings_plan', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;

create or replace function public.finance_mutate_shared_record(
    p_household_id uuid, p_request_id uuid, p_entity text, p_id uuid,
    p_expected_version bigint, p_delete boolean, p_details jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_hash text;
    v_saved_hash text;
    v_result jsonb;
    v_current bigint;
    v_id uuid;
    v_version bigint;
    v_name text := pg_catalog.btrim(p_details->>'name');
    v_amount public.finance_minor_units := (p_details->>'amount_minor')::bigint;
    v_target public.finance_minor_units := (p_details->>'target_budget_minor')::bigint;
    v_project_id uuid := (p_details->>'project_id')::uuid;
    v_date date := (p_details->>'expense_date')::date;
begin
    if v_actor is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_entity is null or p_entity not in ('reserve', 'project', 'expense')
        or p_delete is null or (p_id is null and (p_delete or p_expected_version is not null))
        or (p_id is not null and (p_expected_version is null or p_expected_version < 1)) then
        raise exception 'Invalid shared finance mutation request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'entity', p_entity, 'id', p_id, 'version', p_expected_version, 'delete', p_delete, 'details', p_details)::text, 'UTF8'), 'sha256'), 'hex');
    select r.request_sha256, r.result into v_saved_hash, v_result from private.finance_operation_receipts r
    where r.household_id = p_household_id and r.actor_id = v_actor
      and r.operation_name = 'finance_mutate_shared_record' and r.request_id = p_request_id;
    if found then
        if v_hash <> v_saved_hash then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        return v_result;
    end if;
    if p_id is not null then
        if p_entity = 'reserve' then
            select version into v_current from public.finance_irregular_expense_plans where household_id = p_household_id and id = p_id for update;
        elsif p_entity = 'project' then
            select version into v_current from public.finance_projects where household_id = p_household_id and id = p_id for update;
        else
            select version into v_current from public.finance_project_expenses where household_id = p_household_id and id = p_id for update;
        end if;
        if v_current is null then
            raise exception 'Shared finance record access denied' using errcode = '42501';
        end if;
        if v_current <> p_expected_version then
            return pg_catalog.jsonb_build_object('conflict', true, 'current_version', v_current);
        end if;
    end if;
    if p_delete then
        if p_entity = 'reserve' then
            delete from public.finance_irregular_expense_plans where household_id = p_household_id and id = p_id;
        elsif p_entity = 'project' then
            if exists (select 1 from public.finance_project_expenses where household_id = p_household_id and project_id = p_id) then
                raise exception 'Archive projects with expenses instead of deleting their history' using errcode = '22023';
            end if;
            delete from public.finance_projects where household_id = p_household_id and id = p_id;
        else
            if exists (select 1 from public.finance_project_expenses e
                join public.finance_projects p on p.household_id = e.household_id and p.id = e.project_id
                where e.household_id = p_household_id and e.id = p_id and p.is_archived) then
                raise exception 'Restore the project before deleting its expenses' using errcode = '22023';
            end if;
            delete from public.finance_project_expenses where household_id = p_household_id and id = p_id;
        end if;
        v_result := pg_catalog.jsonb_build_object('id', p_id, 'deleted', true);
    else
        if v_name is null or pg_catalog.char_length(v_name) = 0 or pg_catalog.char_length(v_name) > 160
            or pg_catalog.char_length(p_details->>'description') > 2000
            or pg_catalog.char_length(p_details->>'notes') > 2000 then
            raise exception 'Invalid shared finance details' using errcode = '22023';
        end if;
        if p_entity = 'reserve' then
            if v_amount is null or v_amount < 0 then
                raise exception 'Annual reserve must be nonnegative' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_irregular_expense_plans (household_id, created_by, name, annual_amount)
                values (p_household_id, v_actor, v_name, v_amount) returning id, version into v_id, v_version;
            else
                update public.finance_irregular_expense_plans set name = v_name, annual_amount = v_amount
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        elsif p_entity = 'project' then
            if v_target is not null and v_target <= 0 then
                raise exception 'Project target must be positive' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_projects (household_id, created_by, name, description, target_budget, is_archived)
                values (p_household_id, v_actor, v_name, nullif(pg_catalog.btrim(p_details->>'description'), ''), v_target,
                    coalesce((p_details->>'is_archived')::boolean, false)) returning id, version into v_id, v_version;
            else
                update public.finance_projects set name = v_name, description = nullif(pg_catalog.btrim(p_details->>'description'), ''),
                    target_budget = v_target, is_archived = coalesce((p_details->>'is_archived')::boolean, false)
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        else
            if v_amount is null or v_project_id is null then
                raise exception 'An expense requires an amount and a project' using errcode = '22023';
            end if;
            if not exists (select 1 from public.finance_projects where household_id = p_household_id and id = v_project_id and not is_archived) then
                raise exception 'Restore the project before adding or editing its expenses' using errcode = '22023';
            end if;
            if p_id is not null and exists (select 1 from public.finance_project_expenses e
                join public.finance_projects p on p.household_id = e.household_id and p.id = e.project_id
                where e.household_id = p_household_id and e.id = p_id and (p.is_archived or e.project_id <> v_project_id)) then
                raise exception 'Expenses cannot move projects or be edited in archived projects' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_project_expenses (household_id, created_by, project_id, expense_date, name, amount, notes)
                values (p_household_id, v_actor, v_project_id, v_date, v_name, v_amount, nullif(pg_catalog.btrim(p_details->>'notes'), '')) returning id, version into v_id, v_version;
            else
                update public.finance_project_expenses set expense_date = v_date, name = v_name, amount = v_amount,
                    notes = nullif(pg_catalog.btrim(p_details->>'notes'), '')
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        end if;
        v_result := pg_catalog.jsonb_build_object('id', v_id, 'version', v_version, 'deleted', false);
    end if;
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_mutate_shared_record', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;

create or replace function public.finance_preview_account_lifecycle(p_household_id uuid, p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    v_account public.finance_savings_accounts%rowtype;
    v_ids uuid[];
    v_active_ids uuid[];
    v_ancestor_ids uuid[];
    v_snapshot jsonb;
    v_own numeric;
    v_children numeric;
    v_ancestor_archived boolean;
    v_external_transfers integer;
begin
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    select a.* into v_account from public.finance_savings_accounts a
    where a.household_id = p_household_id and a.id = p_account_id;
    if not found or not private.finance_can_access_savings_account(p_household_id, p_account_id) then
        raise exception 'Savings account access denied' using errcode = '42501';
    end if;

    with recursive tree(id, inactive) as (
        select v_account.id, v_account.is_archived
        union all
        select child.id, tree.inactive or child.is_archived
        from tree join public.finance_savings_accounts child
          on child.household_id = p_household_id and child.parent_id = tree.id
    ) select pg_catalog.array_agg(id order by id),
             pg_catalog.array_agg(id order by id) filter (where not inactive)
      into v_ids, v_active_ids from tree;
    with recursive ancestors(id, parent_id, is_archived) as (
        select a.id, a.parent_id, a.is_archived from public.finance_savings_accounts a
        where a.household_id = p_household_id and a.id = v_account.parent_id
        union all
        select a.id, a.parent_id, a.is_archived from ancestors
        join public.finance_savings_accounts a
          on a.household_id = p_household_id and a.id = ancestors.parent_id
    ) select coalesce(pg_catalog.array_agg(id), '{}'::uuid[]),
             coalesce(pg_catalog.bool_or(is_archived), false)
      into v_ancestor_ids, v_ancestor_archived from ancestors;

    select v_account.opening_balance::numeric + coalesce(sum(t.amount::numeric), 0)
    into v_own from public.finance_savings_transactions t
    where t.household_id = p_household_id and t.account_id = p_account_id;
    select coalesce(sum(a.opening_balance::numeric), 0) + (
        select coalesce(sum(t.amount::numeric), 0) from public.finance_savings_transactions t
        where t.household_id = p_household_id and t.account_id = any(v_active_ids)
          and t.account_id <> p_account_id
    ) into v_children from public.finance_savings_accounts a
    where a.household_id = p_household_id and a.id = any(v_active_ids) and a.id <> p_account_id;

    select count(distinct inside.transfer_id)::integer into v_external_transfers
    from public.finance_savings_transactions inside
    join public.finance_savings_transactions outside
      on outside.household_id = inside.household_id and outside.transfer_id = inside.transfer_id
    where inside.household_id = p_household_id and inside.account_id = any(v_ids)
      and not (outside.account_id = any(v_ids));

    v_snapshot := pg_catalog.jsonb_build_object(
        'accounts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.id), '[]'::jsonb)
            from public.finance_savings_accounts a where a.household_id = p_household_id
            and (a.id = any(v_ids) or a.id = any(v_ancestor_ids))),
        'transactions', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.id), '[]'::jsonb)
            from public.finance_savings_transactions t where t.household_id = p_household_id and t.account_id = any(v_ids)),
        'plans', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id), '[]'::jsonb)
            from public.finance_savings_plans p where p.household_id = p_household_id and p.account_id = any(v_ids))
    );
    return pg_catalog.jsonb_build_object(
        'account_id', p_account_id, 'version', v_account.version,
        'snapshot_token', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
        'account_count', pg_catalog.cardinality(v_ids),
        'linked_plan_count', (select count(*) from public.finance_savings_plans p where p.household_id = p_household_id and p.account_id = any(v_ids)),
        'own_balance_minor', v_own::text, 'active_children_balance_minor', v_children::text,
        'display_balance_minor', (v_own + v_children)::text,
        'is_archived', v_account.is_archived, 'ancestor_archived', v_ancestor_archived,
        'visibility', v_account.visibility,
        'can_change_visibility', v_account.owner_user_id = (select auth.uid()) and v_account.parent_id is null,
        'external_transfer_count', v_external_transfers
    );
end;
$$;

-- The local importer repair script still resolves source IDs through this map.
-- Detach it from the import-run ledger and retain the source fingerprint directly.
delete from private.finance_legacy_id_map
where entity_type = 'planned_savings_transaction';
alter table private.finance_legacy_id_map
    drop constraint finance_legacy_id_map_entity_type;
alter table private.finance_legacy_id_map
    add column source_sha256 text,
    add column imported_by uuid;
update private.finance_legacy_id_map as mapping
set source_sha256 = run.source_sha256,
    imported_by = run.imported_by
from private.finance_import_runs as run
where run.id = mapping.import_run_id;
drop index private.finance_legacy_id_map_import_run_idx;
alter table private.finance_legacy_id_map
    alter column source_sha256 set not null,
    alter column imported_by set not null,
    add constraint finance_legacy_id_map_source_hash check (source_sha256 ~ '^[0-9a-f]{64}$'),
    add constraint finance_legacy_id_map_imported_by_fk foreign key (imported_by)
        references auth.users (id) on delete restrict,
    add constraint finance_legacy_id_map_entity_type check (
        entity_type in (
            'month', 'category', 'budget_item', 'scenario', 'scenario_item',
            'savings_account', 'savings_transfer', 'savings_transaction',
            'savings_plan', 'irregular_expense_plan', 'project', 'project_expense'
        )
    );
alter table private.finance_legacy_id_map drop column import_run_id;
drop table private.finance_import_runs;

commit;
