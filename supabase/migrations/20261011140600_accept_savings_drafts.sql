-- Accept accessible savings drafts as one atomic, idempotent operation.
-- Household locking serializes acceptance with savings edits and archive changes.
create function public.finance_accept_savings_plan(
    p_household_id uuid,
    p_request_id uuid,
    p_month_id uuid
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
    v_month_start date;
    v_draft public.finance_planned_savings_transactions%rowtype;
    v_is_archived boolean;
    v_skip_reasons jsonb;
    v_transaction_id uuid;
    v_posted jsonb := '[]'::jsonb;
    v_skipped jsonb := '[]'::jsonb;
    v_result jsonb;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_month_id is null then
        raise exception 'A request ID and selected month are required' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object('month_id', p_month_id);
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'),
        'hex'
    );

    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id
      and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_accept_savings_plan'
      and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        -- A retry must not disclose identifiers from accounts the caller can
        -- no longer access after the original acceptance.
        if exists (
            select 1
            from pg_catalog.jsonb_array_elements(
                coalesce(v_saved_result->'posted', '[]'::jsonb)
                || coalesce(v_saved_result->'skipped', '[]'::jsonb)
            ) as entry(value)
            where not private.finance_can_access_savings_account(
                p_household_id, (entry.value->>'account_id')::uuid
            )
        ) then
            raise exception 'Savings draft access denied' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    select month.month_start
    into v_month_start
    from public.finance_months as month
    where month.household_id = p_household_id
      and month.id = p_month_id
    for key share;
    if not found then
        raise exception 'Savings draft month is unavailable' using errcode = '42501';
    end if;

    -- The security-definer function can see all household drafts. Filter them
    -- before locking so another member's private draft is neither changed nor
    -- identified in the caller's result.
    for v_draft in
        select draft.*
        from public.finance_planned_savings_transactions as draft
        where draft.household_id = p_household_id
          and draft.month_id = p_month_id
          and private.finance_can_access_savings_account(
              p_household_id, draft.account_id
          )
        order by draft.id
        for update of draft
    loop
        v_skip_reasons := '[]'::jsonb;
        if v_draft.amount = 0 then
            v_skip_reasons := v_skip_reasons || pg_catalog.jsonb_build_array('zero_amount');
        end if;

        with recursive account_ancestors(id, parent_id, is_archived) as (
            select account.id, account.parent_id, account.is_archived
            from public.finance_savings_accounts as account
            where account.household_id = p_household_id
              and account.id = v_draft.account_id
            union all
            select parent.id, parent.parent_id, parent.is_archived
            from public.finance_savings_accounts as parent
            join account_ancestors as child on child.parent_id = parent.id
            where parent.household_id = p_household_id
        )
        select coalesce(pg_catalog.bool_or(ancestor.is_archived), false)
        into v_is_archived
        from account_ancestors as ancestor;

        if v_is_archived then
            v_skip_reasons := v_skip_reasons || pg_catalog.jsonb_build_array('archived_account');
        end if;

        if pg_catalog.jsonb_array_length(v_skip_reasons) > 0 then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'draft_id', v_draft.id,
                    'account_id', v_draft.account_id,
                    'amount_minor', v_draft.amount::text,
                    'description', v_draft.description,
                    'source_savings_plan_id', v_draft.source_savings_plan_id,
                    'reasons', v_skip_reasons
                )
            );
            continue;
        end if;

        -- The unique source-draft index is the final duplicate-posting guard.
        -- A stale duplicate remains pending with an explicit result reason.
        insert into public.finance_savings_transactions (
            household_id, created_by, account_id, transaction_date, amount,
            description, budget_month_id, excluded_from_monthly_savings,
            source_planned_transaction_id
        ) values (
            p_household_id, v_actor_id, v_draft.account_id, v_month_start,
            v_draft.amount, v_draft.description, p_month_id, false, v_draft.id
        )
        on conflict (source_planned_transaction_id)
            where source_planned_transaction_id is not null do nothing
        returning id into v_transaction_id;

        if v_transaction_id is null then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'draft_id', v_draft.id,
                    'account_id', v_draft.account_id,
                    'amount_minor', v_draft.amount::text,
                    'description', v_draft.description,
                    'source_savings_plan_id', v_draft.source_savings_plan_id,
                    'reasons', pg_catalog.jsonb_build_array('already_posted')
                )
            );
            continue;
        end if;

        delete from public.finance_planned_savings_transactions as draft
        where draft.household_id = p_household_id
          and draft.id = v_draft.id
          and draft.version = v_draft.version;
        if not found then
            raise exception 'Savings draft changed during acceptance'
                using errcode = '40001';
        end if;

        v_posted := v_posted || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'draft_id', v_draft.id,
                'transaction_id', v_transaction_id,
                'account_id', v_draft.account_id,
                'amount_minor', v_draft.amount::text,
                'description', v_draft.description,
                'source_savings_plan_id', v_draft.source_savings_plan_id
            )
        );
    end loop;

    v_result := pg_catalog.jsonb_build_object(
        'month_id', p_month_id,
        'month_start', v_month_start,
        'posted', v_posted,
        'skipped', v_skipped,
        'posted_count', pg_catalog.jsonb_array_length(v_posted),
        'skipped_count', pg_catalog.jsonb_array_length(v_skipped),
        'inaccessible_draft_policy', 'remain_pending'
    );

    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_accept_savings_plan', p_request_id,
        v_request_sha256, v_result
    );
    return v_result;
end;
$$;

revoke all on function public.finance_accept_savings_plan(uuid, uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.finance_accept_savings_plan(uuid, uuid, uuid)
    to authenticated;
