-- Serialize finance writes per household so compound operations see a stable
-- source snapshot and direct row writes cannot interleave with a copy.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create function private.finance_lock_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('family-hub.finance:' || p_household_id::text, 0)
    );
end;
$$;

revoke all on function private.finance_lock_household(uuid) from public, anon, authenticated;

create function private.finance_lock_household_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform private.finance_lock_household(old.household_id);
        return old;
    end if;

    perform private.finance_lock_household(new.household_id);
    return new;
end;
$$;

revoke all on function private.finance_lock_household_write() from public, anon, authenticated;

create trigger finance_household_write_lock before insert or update or delete on public.finance_months
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_categories
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_budget_items
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_scenarios
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_scenario_items
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_accounts
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_transfers
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_transactions
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_planned_savings_transactions
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_plans
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_irregular_expense_plans
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_projects
for each row execute function private.finance_lock_household_write();
create trigger finance_household_write_lock before insert or update or delete on public.finance_project_expenses
for each row execute function private.finance_lock_household_write();

create function public.finance_create_month(
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
            allocation_role, is_planned, is_recurring, notes, sort_order
        )
        select p_household_id, v_actor_id, v_month.id, item.category_id, item.name, item.amount,
               item.allocation_role, false, item.is_recurring, item.notes, item.sort_order
        from public.finance_budget_items as item
        where item.household_id = p_household_id
          and item.month_id = p_source_month_id
          and item.is_recurring;
    elsif v_inserted and p_source_kind = 'scenario' then
        insert into public.finance_budget_items (
            household_id, created_by, month_id, category_id, name, amount,
            allocation_role, is_planned, is_recurring, notes, sort_order
        )
        select p_household_id, v_actor_id, v_month.id, item.category_id, item.name, item.amount,
               item.allocation_role, false, item.is_recurring, item.notes, item.sort_order
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

revoke all on function public.finance_create_month(uuid, uuid, date, text, uuid, uuid)
    from public, anon;
grant execute on function public.finance_create_month(uuid, uuid, date, text, uuid, uuid)
    to authenticated;
