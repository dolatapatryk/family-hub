-- Keep savings account and ordinary movement writes behind narrow, versioned
-- functions. A receipt makes client retries safe after a lost response.
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
    p_color text,
    p_visibility text,
    p_sort_order integer
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
        or p_target_amount_minor is not null and p_target_amount_minor <= 0
        or p_color is not null and pg_catalog.char_length(p_color) > 32 then
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
        'color', p_color,
        'visibility', p_visibility,
        'sort_order', p_sort_order
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
            opening_balance, target_amount, color, visibility, sort_order
        ) values (
            p_household_id, v_actor_id, pg_catalog.btrim(p_name), p_account_type,
            p_parent_id, p_opening_balance_minor, p_target_amount_minor,
            p_color, p_visibility, p_sort_order
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
            target_amount = p_target_amount_minor,
            color = p_color,
            sort_order = p_sort_order
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

revoke all on function public.finance_save_account(
    uuid, uuid, uuid, bigint, text, text, uuid, bigint, bigint, text, text, integer
) from public, anon;
grant execute on function public.finance_save_account(
    uuid, uuid, uuid, bigint, text, text, uuid, bigint, bigint, text, text, integer
) to authenticated;

create function public.finance_save_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
    p_expected_version bigint,
    p_account_id uuid,
    p_transaction_date date,
    p_amount_minor bigint,
    p_description text,
    p_budget_month_id uuid,
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
        'budget_month_id', p_budget_month_id,
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
    if p_budget_month_id is not null and not exists (
        select 1 from public.finance_months as month
        where month.household_id = p_household_id
          and month.id = p_budget_month_id
    ) then
        raise exception 'Savings transaction month is unavailable' using errcode = '42501';
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
            description, budget_month_id, excluded_from_monthly_savings
        ) values (
            p_household_id, v_actor_id, p_account_id, p_transaction_date,
            p_amount_minor, nullif(pg_catalog.btrim(p_description), ''),
            p_budget_month_id, p_excluded_from_monthly_savings
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
            budget_month_id = p_budget_month_id,
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

revoke all on function public.finance_save_transaction(
    uuid, uuid, uuid, bigint, uuid, date, bigint, text, uuid, boolean
) from public, anon;
grant execute on function public.finance_save_transaction(
    uuid, uuid, uuid, bigint, uuid, date, bigint, text, uuid, boolean
) to authenticated;

create function public.finance_delete_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
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
    v_transaction public.finance_savings_transactions%rowtype;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_transaction_id is null
        or p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid savings transaction deletion request' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;

    v_request := pg_catalog.jsonb_build_object(
        'transaction_id', p_transaction_id,
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
      and receipt.operation_name = 'finance_delete_transaction'
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

    select movement.* into v_transaction
    from public.finance_savings_transactions as movement
    where movement.household_id = p_household_id
      and movement.id = p_transaction_id
    for update;
    if not found
        or not private.finance_can_access_savings_account(p_household_id, v_transaction.account_id) then
        raise exception 'Savings transaction access denied' using errcode = '42501';
    end if;
    if v_transaction.transfer_id is not null then
        raise exception 'Transfer legs must be deleted through transfer operations' using errcode = '22023';
    end if;
    if v_transaction.version <> p_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true,
            'transaction_id', v_transaction.id,
            'current_version', v_transaction.version
        );
    end if;

    delete from public.finance_savings_transactions as movement
    where movement.household_id = p_household_id
      and movement.id = p_transaction_id;

    v_saved_result := pg_catalog.jsonb_build_object(
        'deleted', true,
        'transaction_id', p_transaction_id,
        'account_id', v_transaction.account_id
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_delete_transaction', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_delete_transaction(uuid, uuid, uuid, bigint)
    from public, anon;
grant execute on function public.finance_delete_transaction(uuid, uuid, uuid, bigint)
    to authenticated;
