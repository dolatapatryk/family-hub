-- Update each affected wallet once per transaction mutation. Wallet versions
-- also serve as snapshot tokens for balance and opening corrections.
create or replace function private.finance_touch_transaction_wallets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        update public.finance_wallets as wallet
        set updated_at = pg_catalog.now()
        where wallet.household_id = new.household_id
          and wallet.id in (new.source_wallet_id, new.destination_wallet_id);
    elsif tg_op = 'DELETE' then
        update public.finance_wallets as wallet
        set updated_at = pg_catalog.now()
        where wallet.household_id = old.household_id
          and wallet.id in (old.source_wallet_id, old.destination_wallet_id);
    else
        update public.finance_wallets as wallet
        set updated_at = pg_catalog.now()
        where wallet.household_id = new.household_id
          and wallet.id in (
              old.source_wallet_id, old.destination_wallet_id,
              new.source_wallet_id, new.destination_wallet_id
          );
    end if;
    return null;
end;
$$;

create function private.finance_validate_wallet_adjustment_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.kind = 'adjustment' and exists (
        select 1
        from public.finance_wallets as wallet
        where wallet.household_id = new.household_id
          and wallet.id = new.destination_wallet_id
          and wallet.opened_on = new.transaction_date
    ) then
        raise exception 'Correct the opening balance with the opening correction action'
            using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke all on function private.finance_validate_wallet_adjustment_date() from public, anon, authenticated;
create trigger finance_transactions_validate_wallet_adjustment_date
before insert or update of kind, transaction_date, destination_wallet_id
on public.finance_transactions
for each row execute function private.finance_validate_wallet_adjustment_date();

create function public.finance_preview_wallet_opening_correction(
    p_household_id uuid,
    p_wallet_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_wallet public.finance_wallets%rowtype;
    v_opening public.finance_transactions%rowtype;
    v_snapshot_token text;
begin
    if p_household_id is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    select wallet.* into v_wallet
    from public.finance_wallets as wallet
    where wallet.household_id = p_household_id and wallet.id = p_wallet_id;
    if not found or not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
        raise exception 'Wallet is unavailable' using errcode = '42501';
    end if;
    if v_wallet.is_archived then
        raise exception 'Restore the wallet before correcting its opening record' using errcode = '22023';
    end if;
    select opening.* into v_opening
    from public.finance_transactions as opening
    where opening.household_id = p_household_id
      and opening.destination_wallet_id = p_wallet_id
      and opening.kind = 'opening';
    if not found then
        raise exception 'Wallet opening record is unavailable' using errcode = '22023';
    end if;
    v_snapshot_token := pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(pg_catalog.jsonb_build_object(
            'wallet_id', p_wallet_id,
            'wallet_version', v_wallet.version,
            'opened_on', v_wallet.opened_on,
            'opening_transaction_id', v_opening.id,
            'opening_version', v_opening.version,
            'opening_date', v_opening.transaction_date,
            'opening_balance_minor', v_opening.amount_minor::text
        )::text, 'UTF8'), 'sha256'
    ), 'hex');
    return pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id,
        'wallet_version', v_wallet.version,
        'opening_transaction_id', v_opening.id,
        'opening_transaction_version', v_opening.version,
        'opened_on', v_wallet.opened_on,
        'opening_balance_minor', v_opening.amount_minor::text,
        'snapshot_token', v_snapshot_token
    );
end;
$$;

revoke all on function public.finance_preview_wallet_opening_correction(uuid, uuid) from public, anon;
grant execute on function public.finance_preview_wallet_opening_correction(uuid, uuid) to authenticated;

create function public.finance_correct_wallet_opening(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_snapshot_token text,
    p_opened_on date,
    p_opening_balance_minor bigint
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
    v_wallet public.finance_wallets%rowtype;
    v_opening public.finance_transactions%rowtype;
    v_snapshot_token text;
    v_version bigint;
begin
    if v_actor_id is null or p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_wallet_id is null
        or p_expected_version is null or p_expected_version < 1
        or p_snapshot_token is null or p_snapshot_token !~ '^[0-9a-f]{64}$'
        or p_opened_on is null or not pg_catalog.isfinite(p_opened_on)
        or p_opened_on > current_date or p_opening_balance_minor is null
        or p_opening_balance_minor not between -999999999999999999 and 999999999999999999 then
        raise exception 'Invalid wallet opening correction' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id,
        'expected_version', p_expected_version,
        'snapshot_token', p_snapshot_token,
        'opened_on', p_opened_on,
        'opening_balance_minor', p_opening_balance_minor
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex'
    );
    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_correct_wallet_opening'
      and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        if not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
            raise exception 'Wallet is unavailable' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    select wallet.* into v_wallet
    from public.finance_wallets as wallet
    where wallet.household_id = p_household_id and wallet.id = p_wallet_id
    for update;
    if not found or not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
        raise exception 'Wallet is unavailable' using errcode = '42501';
    end if;
    if v_wallet.version <> p_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true, 'wallet_id', p_wallet_id, 'current_version', v_wallet.version
        );
    end if;
    if v_wallet.is_archived then
        raise exception 'Restore the wallet before correcting its opening record' using errcode = '22023';
    end if;
    select opening.* into v_opening
    from public.finance_transactions as opening
    where opening.household_id = p_household_id
      and opening.destination_wallet_id = p_wallet_id
      and opening.kind = 'opening'
    for update;
    if not found then
        raise exception 'Wallet opening record is unavailable' using errcode = '22023';
    end if;
    v_snapshot_token := pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(pg_catalog.jsonb_build_object(
            'wallet_id', p_wallet_id,
            'wallet_version', v_wallet.version,
            'opened_on', v_wallet.opened_on,
            'opening_transaction_id', v_opening.id,
            'opening_version', v_opening.version,
            'opening_date', v_opening.transaction_date,
            'opening_balance_minor', v_opening.amount_minor::text
        )::text, 'UTF8'), 'sha256'
    ), 'hex');
    if v_snapshot_token <> p_snapshot_token then
        raise exception 'Wallet opening changed since the correction preview' using errcode = '40001';
    end if;
    if exists (
        select 1
        from public.finance_transactions as transaction
        where transaction.household_id = p_household_id
          and transaction.kind <> 'opening'
          and (transaction.source_wallet_id = p_wallet_id
               or transaction.destination_wallet_id = p_wallet_id)
          and transaction.transaction_date < p_opened_on
    ) then
        raise exception 'Opening date cannot move after an existing wallet transaction'
            using errcode = '22023';
    end if;

    if v_wallet.opened_on is distinct from p_opened_on
        or v_opening.transaction_date is distinct from p_opened_on
        or v_opening.amount_minor is distinct from p_opening_balance_minor::public.finance_minor_units then
        update public.finance_transactions as opening
        set transaction_date = p_opened_on,
            amount_minor = p_opening_balance_minor::public.finance_minor_units
        where opening.household_id = p_household_id and opening.id = v_opening.id;
        update public.finance_wallets as wallet
        set opened_on = p_opened_on
        where wallet.household_id = p_household_id and wallet.id = p_wallet_id;
    end if;
    select wallet.version into v_version
    from public.finance_wallets as wallet
    where wallet.household_id = p_household_id and wallet.id = p_wallet_id;
    v_saved_result := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id,
        'opening_transaction_id', v_opening.id,
        'opened_on', p_opened_on,
        'opening_balance_minor', p_opening_balance_minor::text,
        'version', v_version
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_correct_wallet_opening', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_correct_wallet_opening(uuid, uuid, uuid, bigint, text, date, bigint)
    from public, anon;
grant execute on function public.finance_correct_wallet_opening(uuid, uuid, uuid, bigint, text, date, bigint)
    to authenticated;

notify pgrst, 'reload schema';
