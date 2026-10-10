-- Keep planned savings drafts behind versioned RPCs. Request receipts make
-- create, edit, and delete safe to retry after a lost response.
create function public.finance_save_draft(
    p_household_id uuid,
    p_request_id uuid,
    p_draft_id uuid,
    p_expected_version bigint,
    p_month_id uuid,
    p_account_id uuid,
    p_amount_minor bigint,
    p_description text,
    p_source_savings_plan_id uuid
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
    v_existing public.finance_planned_savings_transactions%rowtype;
    v_account public.finance_savings_accounts%rowtype;
    v_month public.finance_months%rowtype;
    v_plan public.finance_savings_plans%rowtype;
    v_draft_id uuid;
    v_version bigint;
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
    if p_month_id is null or p_account_id is null or p_amount_minor is null
        or p_amount_minor < -999999999999999999
        or p_amount_minor > 999999999999999999
        or p_description is not null and pg_catalog.char_length(p_description) > 2000 then
        raise exception 'Invalid savings draft details' using errcode = '22023';
    end if;
    if p_draft_id is null then
        if p_expected_version is not null then
            raise exception 'A new savings draft cannot have an expected version'
                using errcode = '22023';
        end if;
    elsif p_expected_version is null or p_expected_version < 1 then
        raise exception 'A savings draft update requires its expected version'
            using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'draft_id', p_draft_id,
        'expected_version', p_expected_version,
        'month_id', p_month_id,
        'account_id', p_account_id,
        'amount_minor', p_amount_minor,
        'description', nullif(pg_catalog.btrim(p_description), ''),
        'source_savings_plan_id', p_source_savings_plan_id
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
      and receipt.operation_name = 'finance_save_draft'
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
            raise exception 'Savings draft access denied' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    select account.* into v_account
    from public.finance_savings_accounts as account
    where account.household_id = p_household_id
      and account.id = p_account_id
    for key share;
    if not found
        or not private.finance_can_access_savings_account(p_household_id, p_account_id) then
        raise exception 'Savings draft access denied' using errcode = '42501';
    end if;

    select month.* into v_month
    from public.finance_months as month
    where month.household_id = p_household_id
      and month.id = p_month_id
    for key share;
    if not found then
        raise exception 'Savings draft month is unavailable' using errcode = '42501';
    end if;

    if p_source_savings_plan_id is not null then
        select plan.* into v_plan
        from public.finance_savings_plans as plan
        where plan.household_id = p_household_id
          and plan.id = p_source_savings_plan_id
        for key share;
        if not found
            or not private.finance_can_read_savings_plan(
                p_household_id, v_plan.account_id, v_plan.visibility, v_plan.owner_user_id
            ) then
            raise exception 'Savings draft access denied' using errcode = '42501';
        end if;
        if v_plan.account_id is distinct from p_account_id then
            raise exception 'Savings draft plan must match its account' using errcode = '22023';
        end if;
    end if;

    if p_draft_id is null then
        insert into public.finance_planned_savings_transactions (
            household_id, created_by, month_id, account_id, amount, description,
            source_savings_plan_id
        ) values (
            p_household_id, v_actor_id, p_month_id, p_account_id, p_amount_minor,
            nullif(pg_catalog.btrim(p_description), ''), p_source_savings_plan_id
        ) returning id, version into v_draft_id, v_version;
    else
        select draft.* into v_existing
        from public.finance_planned_savings_transactions as draft
        where draft.household_id = p_household_id
          and draft.id = p_draft_id
        for update;
        if not found
            or not private.finance_can_access_savings_account(p_household_id, v_existing.account_id) then
            raise exception 'Savings draft access denied' using errcode = '42501';
        end if;
        if v_existing.version <> p_expected_version then
            return pg_catalog.jsonb_build_object(
                'conflict', true,
                'draft_id', v_existing.id,
                'current_version', v_existing.version
            );
        end if;
        if v_existing.source_savings_plan_id is not null
            and p_source_savings_plan_id is distinct from v_existing.source_savings_plan_id then
            raise exception 'A savings draft plan link cannot be changed by this operation'
                using errcode = '22023';
        end if;

        update public.finance_planned_savings_transactions as draft
        set month_id = p_month_id,
            account_id = p_account_id,
            amount = p_amount_minor,
            description = nullif(pg_catalog.btrim(p_description), ''),
            source_savings_plan_id = p_source_savings_plan_id
        where draft.household_id = p_household_id
          and draft.id = p_draft_id
        returning draft.id, draft.version into v_draft_id, v_version;
    end if;

    v_saved_result := pg_catalog.jsonb_build_object(
        'draft_id', v_draft_id,
        'month_id', p_month_id,
        'account_id', p_account_id,
        'version', v_version
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_save_draft', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_save_draft(
    uuid, uuid, uuid, bigint, uuid, uuid, bigint, text, uuid
) from public, anon;
grant execute on function public.finance_save_draft(
    uuid, uuid, uuid, bigint, uuid, uuid, bigint, text, uuid
) to authenticated;

create function public.finance_delete_draft(
    p_household_id uuid,
    p_request_id uuid,
    p_draft_id uuid,
    p_expected_version bigint
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
    v_draft public.finance_planned_savings_transactions%rowtype;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_draft_id is null
        or p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid savings draft deletion request' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'draft_id', p_draft_id,
        'expected_version', p_expected_version
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
      and receipt.operation_name = 'finance_delete_draft'
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
            raise exception 'Savings draft access denied' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    select draft.* into v_draft
    from public.finance_planned_savings_transactions as draft
    where draft.household_id = p_household_id
      and draft.id = p_draft_id
    for update;
    if not found
        or not private.finance_can_access_savings_account(p_household_id, v_draft.account_id) then
        raise exception 'Savings draft access denied' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.finance_months as month
        where month.household_id = p_household_id
          and month.id = v_draft.month_id
    ) then
        raise exception 'Savings draft month is unavailable' using errcode = '42501';
    end if;
    if v_draft.version <> p_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true,
            'draft_id', v_draft.id,
            'current_version', v_draft.version
        );
    end if;

    delete from public.finance_planned_savings_transactions as draft
    where draft.household_id = p_household_id
      and draft.id = p_draft_id;

    v_saved_result := pg_catalog.jsonb_build_object(
        'deleted', true,
        'draft_id', p_draft_id,
        'account_id', v_draft.account_id
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_delete_draft', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_delete_draft(uuid, uuid, uuid, bigint)
    from public, anon;
grant execute on function public.finance_delete_draft(uuid, uuid, uuid, bigint)
    to authenticated;
