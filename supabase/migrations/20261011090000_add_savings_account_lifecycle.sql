-- Preview tokens cover the whole affected tree, its ancestors, plans, drafts,
-- and movements. Account versions alone cannot detect a new movement.
create function public.finance_preview_account_lifecycle(p_household_id uuid, p_account_id uuid)
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
        'drafts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) order by d.id), '[]'::jsonb)
            from public.finance_planned_savings_transactions d where d.household_id = p_household_id and d.account_id = any(v_ids)),
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
revoke all on function public.finance_preview_account_lifecycle(uuid, uuid) from public, anon;
grant execute on function public.finance_preview_account_lifecycle(uuid, uuid) to authenticated;

create function public.finance_apply_account_lifecycle(
    p_household_id uuid, p_request_id uuid, p_account_id uuid,
    p_expected_version bigint, p_snapshot_token text, p_action text,
    p_display_balance_minor bigint default null, p_visibility text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_request jsonb;
    v_hash text;
    v_saved_hash text;
    v_result jsonb;
    v_preview jsonb;
    v_account public.finance_savings_accounts%rowtype;
    v_ids uuid[];
    v_opening numeric;
    v_version bigint;
begin
    if v_actor is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_account_id is null or p_expected_version is null
        or p_expected_version < 1 or p_snapshot_token is null
        or p_action is null or p_action not in ('archive', 'restore', 'balance', 'visibility')
        or (p_action = 'balance' and p_display_balance_minor is null)
        or (p_action <> 'balance' and p_display_balance_minor is not null)
        or (p_action = 'visibility' and (p_visibility is null or p_visibility not in ('household', 'private')))
        or (p_action <> 'visibility' and p_visibility is not null) then
        raise exception 'Invalid savings account lifecycle request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    select a.* into v_account from public.finance_savings_accounts a
    where a.household_id = p_household_id and a.id = p_account_id for update;
    if not found or not private.finance_can_access_savings_account(p_household_id, p_account_id) then
        raise exception 'Savings account access denied' using errcode = '42501';
    end if;
    if p_action = 'visibility' and (v_account.owner_user_id <> v_actor or v_account.parent_id is not null) then
        raise exception 'Only the owner can change visibility from the root account' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object('account_id', p_account_id,
        'expected_version', p_expected_version, 'snapshot_token', p_snapshot_token,
        'action', p_action, 'display_balance_minor', p_display_balance_minor, 'visibility', p_visibility);
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex');
    select r.request_sha256, r.result into v_saved_hash, v_result
    from private.finance_operation_receipts r
    where r.household_id = p_household_id and r.actor_id = v_actor
      and r.operation_name = 'finance_account_lifecycle' and r.request_id = p_request_id;
    if found then
        if v_hash <> v_saved_hash then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        return v_result;
    end if;
    v_preview := public.finance_preview_account_lifecycle(p_household_id, p_account_id);
    if v_account.version <> p_expected_version or v_preview->>'snapshot_token' <> p_snapshot_token then
        return pg_catalog.jsonb_build_object('conflict', true, 'current_version', v_account.version);
    end if;
    with recursive tree(id) as (
        select p_account_id union all select a.id from tree
        join public.finance_savings_accounts a on a.household_id = p_household_id and a.parent_id = tree.id
    ) select pg_catalog.array_agg(id) into v_ids from tree;

    if p_action = 'restore' and (v_preview->>'ancestor_archived')::boolean then
        raise exception 'Restore the archived ancestor first' using errcode = '22023';
    elsif p_action in ('archive', 'restore') then
        -- Preserve independent descendant archive flags; inactivity is inherited.
        update public.finance_savings_accounts set is_archived = p_action = 'archive'
        where household_id = p_household_id and id = p_account_id returning version into v_version;
    elsif p_action = 'balance' then
        if v_account.is_archived or (v_preview->>'ancestor_archived')::boolean then
            raise exception 'Restore this account tree before correcting its balance' using errcode = '22023';
        end if;
        v_opening := p_display_balance_minor::numeric
            - (v_preview->>'own_balance_minor')::numeric + v_account.opening_balance::numeric
            - (v_preview->>'active_children_balance_minor')::numeric;
        if v_opening < -999999999999999999 or v_opening > 999999999999999999 then
            raise exception 'Corrected opening balance exceeds the supported money range' using errcode = '22023';
        end if;
        update public.finance_savings_accounts set opening_balance = v_opening::bigint
        where household_id = p_household_id and id = p_account_id returning version into v_version;
    else
        if p_visibility <> v_account.visibility and (v_preview->>'external_transfer_count')::integer > 0 then
            raise exception 'Transfers outside this account tree block visibility changes' using errcode = '22023';
        end if;
        update public.finance_savings_accounts set visibility = p_visibility
        where household_id = p_household_id and id = any(v_ids);
        update public.finance_savings_plans set visibility = p_visibility
        where household_id = p_household_id and account_id = any(v_ids);
        select version into v_version from public.finance_savings_accounts
        where household_id = p_household_id and id = p_account_id;
    end if;
    v_result := pg_catalog.jsonb_build_object('account_id', p_account_id, 'version', v_version, 'action', p_action);
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_account_lifecycle', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;
revoke all on function public.finance_apply_account_lifecycle(uuid, uuid, uuid, bigint, text, text, bigint, text) from public, anon;
grant execute on function public.finance_apply_account_lifecycle(uuid, uuid, uuid, bigint, text, text, bigint, text) to authenticated;
