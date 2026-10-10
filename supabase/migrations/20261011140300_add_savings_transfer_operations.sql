-- Transfers are created and removed as one request so a balance can never be
-- left with only one leg. Request receipts make transport retries safe.
create function public.finance_transfer_savings(
    p_household_id uuid,
    p_request_id uuid,
    p_from_account_id uuid,
    p_from_expected_version bigint,
    p_to_account_id uuid,
    p_to_expected_version bigint,
    p_amount_minor bigint,
    p_transaction_date date,
    p_description text
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
    v_from_account public.finance_savings_accounts%rowtype;
    v_to_account public.finance_savings_accounts%rowtype;
    v_accessible_account_count bigint;
    v_has_archived_ancestor boolean;
    v_transfer_id uuid;
    v_from_transaction_id uuid;
    v_to_transaction_id uuid;
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
    if p_from_account_id is null or p_to_account_id is null
        or p_from_account_id = p_to_account_id
        or p_from_expected_version is null or p_from_expected_version < 1
        or p_to_expected_version is null or p_to_expected_version < 1 then
        raise exception 'Invalid savings transfer endpoints or versions' using errcode = '22023';
    end if;
    if p_amount_minor is null or p_amount_minor <= 0
        or p_amount_minor > 999999999999999999 then
        raise exception 'Transfer amount must be positive and within the supported range' using errcode = '22023';
    end if;
    if p_transaction_date is null
        or not pg_catalog.isfinite(p_transaction_date)
        or p_transaction_date < date '0001-01-01'
        or p_transaction_date > date '9999-12-31' then
        raise exception 'Transfer date is invalid' using errcode = '22007';
    end if;
    if p_description is not null and pg_catalog.char_length(p_description) > 2000 then
        raise exception 'Transfer description is too long' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'from_account_id', p_from_account_id,
        'from_expected_version', p_from_expected_version,
        'to_account_id', p_to_account_id,
        'to_expected_version', p_to_expected_version,
        'amount_minor', p_amount_minor,
        'transaction_date', p_transaction_date,
        'description', nullif(pg_catalog.btrim(p_description), '')
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
      and receipt.operation_name = 'finance_transfer_savings'
      and receipt.request_id = p_request_id
    for update;

    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        -- A replay returns only after the caller still has access to both
        -- endpoints. A later privacy change must not turn an old receipt into
        -- a way to discover a private account's transfer identifiers.
        select count(*)
        into v_accessible_account_count
        from public.finance_savings_accounts as account
        where account.household_id = p_household_id
          and account.id in (p_from_account_id, p_to_account_id)
          and private.finance_can_access_savings_account(p_household_id, account.id);
        if v_accessible_account_count <> 2 then
            raise exception 'Finance transfer access denied' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    select count(*)
    into v_accessible_account_count
    from public.finance_savings_accounts as account
    where account.household_id = p_household_id
      and account.id in (p_from_account_id, p_to_account_id)
      and private.finance_can_access_savings_account(p_household_id, account.id);
    if v_accessible_account_count <> 2 then
        raise exception 'Finance transfer access denied' using errcode = '42501';
    end if;

    select account.* into v_from_account
    from public.finance_savings_accounts as account
    where account.household_id = p_household_id
      and account.id = p_from_account_id;
    select account.* into v_to_account
    from public.finance_savings_accounts as account
    where account.household_id = p_household_id
      and account.id = p_to_account_id;

    if v_from_account.visibility is distinct from v_to_account.visibility
        or (v_from_account.visibility = 'private'
            and v_from_account.owner_user_id is distinct from v_to_account.owner_user_id) then
        raise exception 'Finance transfer access denied' using errcode = '42501';
    end if;

    if v_from_account.version <> p_from_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true,
            'account_id', v_from_account.id,
            'current_version', v_from_account.version
        );
    end if;
    if v_to_account.version <> p_to_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true,
            'account_id', v_to_account.id,
            'current_version', v_to_account.version
        );
    end if;

    with recursive account_ancestors(endpoint_id, id, parent_id, is_archived) as (
        select account.id, account.id, account.parent_id, account.is_archived
        from public.finance_savings_accounts as account
        where account.household_id = p_household_id
          and account.id in (p_from_account_id, p_to_account_id)
        union all
        select ancestry.endpoint_id, parent.id, parent.parent_id, parent.is_archived
        from account_ancestors as ancestry
        join public.finance_savings_accounts as parent
          on parent.household_id = p_household_id
         and parent.id = ancestry.parent_id
    )
    select coalesce(pg_catalog.bool_or(ancestry.is_archived), false)
    into v_has_archived_ancestor
    from account_ancestors as ancestry;

    if v_has_archived_ancestor then
        raise exception 'Archived savings accounts cannot receive transfers' using errcode = '22023';
    end if;

    insert into public.finance_savings_transfers (household_id, created_by)
    values (p_household_id, v_actor_id)
    returning id into v_transfer_id;

    insert into public.finance_savings_transactions (
        household_id, created_by, account_id, transaction_date, amount,
        description, excluded_from_monthly_savings, transfer_id
    ) values (
        p_household_id, v_actor_id, p_from_account_id, p_transaction_date,
        -p_amount_minor, nullif(pg_catalog.btrim(p_description), ''), true, v_transfer_id
    ) returning id into v_from_transaction_id;

    insert into public.finance_savings_transactions (
        household_id, created_by, account_id, transaction_date, amount,
        description, excluded_from_monthly_savings, transfer_id
    ) values (
        p_household_id, v_actor_id, p_to_account_id, p_transaction_date,
        p_amount_minor, nullif(pg_catalog.btrim(p_description), ''), true, v_transfer_id
    ) returning id into v_to_transaction_id;

    v_saved_result := pg_catalog.jsonb_build_object(
        'transfer_id', v_transfer_id,
        'transaction_ids', pg_catalog.jsonb_build_array(v_from_transaction_id, v_to_transaction_id)
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_transfer_savings', p_request_id,
        v_request_sha256, v_saved_result
    );

    return v_saved_result;
end;
$$;

revoke all on function public.finance_transfer_savings(
    uuid, uuid, uuid, bigint, uuid, bigint, bigint, date, text
) from public, anon;
grant execute on function public.finance_transfer_savings(
    uuid, uuid, uuid, bigint, uuid, bigint, bigint, date, text
) to authenticated;

create function public.finance_delete_transfer(
    p_household_id uuid,
    p_request_id uuid,
    p_transfer_id uuid,
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
    v_transfer public.finance_savings_transfers%rowtype;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_transfer_id is null
        or p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid savings transfer deletion request' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'transfer_id', p_transfer_id,
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
      and receipt.operation_name = 'finance_delete_transfer'
      and receipt.request_id = p_request_id
    for update;

    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        return v_saved_result;
    end if;

    select transfer.* into v_transfer
    from public.finance_savings_transfers as transfer
    where transfer.household_id = p_household_id
      and transfer.id = p_transfer_id
    for update;
    if not found
        or not private.finance_can_read_savings_transfer(p_household_id, p_transfer_id) then
        raise exception 'Finance transfer access denied' using errcode = '42501';
    end if;

    if v_transfer.version <> p_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true,
            'current_version', v_transfer.version
        );
    end if;

    delete from public.finance_savings_transfers as transfer
    where transfer.household_id = p_household_id
      and transfer.id = p_transfer_id;

    v_saved_result := pg_catalog.jsonb_build_object(
        'deleted', true,
        'transfer_id', p_transfer_id
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_delete_transfer', p_request_id,
        v_request_sha256, v_saved_result
    );

    return v_saved_result;
end;
$$;

revoke all on function public.finance_delete_transfer(uuid, uuid, uuid, bigint)
    from public, anon;
grant execute on function public.finance_delete_transfer(uuid, uuid, uuid, bigint)
    to authenticated;
