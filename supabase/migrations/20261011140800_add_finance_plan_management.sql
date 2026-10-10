create table private.finance_savings_plan_month_loads (
    household_id uuid not null,
    month_id uuid not null,
    plan_id uuid not null,
    account_id uuid not null,
    draft_id uuid not null,
    primary key (household_id, month_id, plan_id),
    foreign key (household_id, month_id) references public.finance_months (household_id, id) on delete cascade,
    foreign key (household_id, plan_id) references public.finance_savings_plans (household_id, id) on delete cascade,
    foreign key (household_id, account_id) references public.finance_savings_accounts (household_id, id) on delete restrict
);
revoke all on private.finance_savings_plan_month_loads from public, anon, authenticated;

create function public.finance_mutate_savings_plan(
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
        if exists (select 1 from public.finance_planned_savings_transactions d
            where d.household_id = p_household_id and d.source_savings_plan_id = p_plan_id) then
            raise exception 'Remove or accept the pending drafts before deleting their savings plan' using errcode = '22023';
        end if;
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
            if exists (select 1 from public.finance_planned_savings_transactions d
                where d.household_id = p_household_id and d.source_savings_plan_id = p_plan_id) then
                raise exception 'Pending drafts block changes to the savings plan account or visibility' using errcode = '22023';
            end if;
        end if;
        if p_plan_id is null then
            insert into public.finance_savings_plans (household_id, created_by, name, plan_type, account_id,
                monthly_amount, annual_amount_override, visibility, sort_order)
            values (p_household_id, v_actor, v_name, v_type, v_account_id, v_monthly, v_annual,
                v_visibility, coalesce((p_details->>'sort_order')::integer, 0)) returning id, version into v_id, v_version;
        else
            update public.finance_savings_plans set name = v_name, plan_type = v_type, account_id = v_account_id,
                monthly_amount = v_monthly, annual_amount_override = v_annual, visibility = v_visibility,
                sort_order = coalesce((p_details->>'sort_order')::integer, 0)
            where household_id = p_household_id and id = p_plan_id returning id, version into v_id, v_version;
        end if;
        v_result := pg_catalog.jsonb_build_object('plan_id', v_id, 'version', v_version, 'deleted', false);
    end if;
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_mutate_savings_plan', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;
revoke all on function public.finance_mutate_savings_plan(uuid, uuid, uuid, bigint, boolean, jsonb) from public, anon;
grant execute on function public.finance_mutate_savings_plan(uuid, uuid, uuid, bigint, boolean, jsonb) to authenticated;

create function public.finance_load_savings_plan(p_household_id uuid, p_request_id uuid, p_month_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_plan public.finance_savings_plans%rowtype;
    v_hash text;
    v_saved_hash text;
    v_result jsonb;
    v_generated jsonb := '[]';
    v_skipped jsonb := '[]';
    v_reason text;
    v_archived boolean;
    v_draft uuid;
begin
    if v_actor is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_month_id is null then
        raise exception 'Invalid savings plan loading request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if not exists (select 1 from public.finance_months m where m.household_id = p_household_id and m.id = p_month_id) then
        raise exception 'Finance month access denied' using errcode = '42501';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_month_id::text, 'UTF8'), 'sha256'), 'hex');
    select r.request_sha256, r.result into v_saved_hash, v_result from private.finance_operation_receipts r
    where r.household_id = p_household_id and r.actor_id = v_actor
      and r.operation_name = 'finance_load_savings_plan' and r.request_id = p_request_id;
    if found then
        if v_hash <> v_saved_hash then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        -- Recheck every referenced plan before replaying a previously shared result.
        if exists (select 1 from pg_catalog.jsonb_array_elements((v_result->'generated') || (v_result->'skipped')) e
            where not exists (select 1 from public.finance_savings_plans p where p.household_id = p_household_id
                and p.id = (e->>'plan_id')::uuid
                and private.finance_can_read_savings_plan(p.household_id, p.account_id, p.visibility, p.owner_user_id))) then
            raise exception 'Savings plan access changed; reload the available plans' using errcode = '42501';
        end if;
        if exists (select 1 from pg_catalog.jsonb_array_elements(v_result->'generated') e
            where not private.finance_can_access_savings_account(p_household_id, (e->>'account_id')::uuid)) then
            raise exception 'Savings account access changed; reload the available plans' using errcode = '42501';
        end if;
        return v_result;
    end if;
    for v_plan in select p.* from public.finance_savings_plans p where p.household_id = p_household_id
        and private.finance_can_read_savings_plan(p.household_id, p.account_id, p.visibility, p.owner_user_id)
        order by p.sort_order, p.id
    loop
        v_reason := null;
        if v_plan.plan_type = 'irregular' then v_reason := 'irregular_plan';
        elsif v_plan.account_id is null then v_reason := 'unlinked_plan';
        elsif v_plan.monthly_amount <= 0 then v_reason := 'zero_amount';
        else
            with recursive ancestors(id, parent_id, is_archived) as (
                select a.id, a.parent_id, a.is_archived from public.finance_savings_accounts a
                where a.household_id = p_household_id and a.id = v_plan.account_id
                union all select a.id, a.parent_id, a.is_archived from ancestors
                join public.finance_savings_accounts a on a.household_id = p_household_id and a.id = ancestors.parent_id
            ) select coalesce(pg_catalog.bool_or(is_archived), true) into v_archived from ancestors;
            if v_archived then v_reason := 'archived_account';
            elsif exists (select 1 from private.finance_savings_plan_month_loads l where l.household_id = p_household_id
                and l.month_id = p_month_id and l.plan_id = v_plan.id) then v_reason := 'already_loaded';
            elsif exists (select 1 from private.finance_savings_plan_month_loads l where l.household_id = p_household_id
                and l.month_id = p_month_id and l.account_id = v_plan.account_id) then v_reason := 'account_already_planned';
            elsif exists (select 1 from public.finance_planned_savings_transactions d where d.household_id = p_household_id
                and d.month_id = p_month_id and d.account_id = v_plan.account_id) then v_reason := 'account_already_planned';
            end if;
        end if;
        if v_reason is not null then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('plan_id', v_plan.id, 'reason', v_reason));
        else
            insert into public.finance_planned_savings_transactions (household_id, created_by, month_id, account_id, amount, description, source_savings_plan_id)
            values (p_household_id, v_actor, p_month_id, v_plan.account_id, v_plan.monthly_amount, v_plan.name, v_plan.id) returning id into v_draft;
            insert into private.finance_savings_plan_month_loads values (p_household_id, p_month_id, v_plan.id, v_plan.account_id, v_draft);
            v_generated := v_generated || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('plan_id', v_plan.id, 'draft_id', v_draft, 'account_id', v_plan.account_id));
        end if;
    end loop;
    v_result := pg_catalog.jsonb_build_object('month_id', p_month_id, 'generated', v_generated, 'skipped', v_skipped);
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_load_savings_plan', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;
revoke all on function public.finance_load_savings_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.finance_load_savings_plan(uuid, uuid, uuid) to authenticated;
