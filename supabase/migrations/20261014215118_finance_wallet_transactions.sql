-- Physical wallets and actual transactions. Money remains a single exact minor-unit amount
-- on each authoritative transaction row; transfers are projected into two signed movements.

alter table public.profiles
    add constraint profiles_household_user_unique unique (household_id, id);

create table public.finance_wallets (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    wallet_type text not null,
    currency text not null default 'PLN',
    visibility text not null,
    owner_user_id uuid not null references auth.users (id) on delete restrict,
    opened_on date not null,
    is_archived boolean not null default false,
    color text,
    icon text,
    constraint finance_wallets_id_household_unique unique (household_id, id),
    constraint finance_wallets_owner_household_fk foreign key (household_id, owner_user_id)
        references public.profiles (household_id, id) on delete restrict,
    constraint finance_wallets_name_valid check (
        char_length(btrim(name)) between 1 and 120
    ),
    constraint finance_wallets_type_valid check (
        wallet_type in ('bank', 'cash', 'savings_bank')
    ),
    constraint finance_wallets_currency_pln check (currency = 'PLN'),
    constraint finance_wallets_visibility_valid check (visibility in ('household', 'private')),
    constraint finance_wallets_opened_on_valid check (
        pg_catalog.isfinite(opened_on)
        and opened_on between date '0001-01-01' and date '9999-12-31'
    ),
    constraint finance_wallets_color_valid check (
        color is null or color ~ '^#[0-9A-Fa-f]{6}$'
    ),
    constraint finance_wallets_icon_valid check (
        icon is null or icon ~ '^[a-z][a-z0-9_-]{0,39}$'
    )
);

create table public.finance_transactions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    kind text not null,
    transaction_date date not null,
    amount_minor public.finance_minor_units not null,
    source_wallet_id uuid,
    destination_wallet_id uuid,
    category_id uuid,
    description text,
    savings_effect text not null default 'none',
    constraint finance_transactions_id_household_unique unique (household_id, id),
    constraint finance_transactions_kind_valid check (
        kind in (
            'income', 'expense', 'savings_expense', 'refund', 'savings_refund',
            'transfer', 'opening', 'adjustment'
        )
    ),
    constraint finance_transactions_date_valid check (
        pg_catalog.isfinite(transaction_date)
        and transaction_date between date '0001-01-01' and date '9999-12-31'
    ),
    constraint finance_transactions_description_valid check (
        description is null or char_length(description) <= 2000
    ),
    constraint finance_transactions_savings_effect_valid check (
        savings_effect in ('none', 'contribution')
        and (kind = 'transfer' or savings_effect = 'none')
    ),
    constraint finance_transactions_kind_endpoints_valid check (
        (kind = 'income' and amount_minor > 0 and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none')
        or (kind in ('expense', 'savings_expense') and amount_minor > 0
            and source_wallet_id is not null and destination_wallet_id is null
            and savings_effect = 'none')
        or (kind in ('refund', 'savings_refund') and amount_minor > 0
            and source_wallet_id is null and destination_wallet_id is not null
            and savings_effect = 'none')
        or (kind = 'transfer' and amount_minor > 0
            and source_wallet_id is not null and destination_wallet_id is not null
            and source_wallet_id <> destination_wallet_id)
        or (kind = 'opening' and amount_minor >= 0 and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none')
        or (kind = 'adjustment' and amount_minor <> 0 and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none'
            and nullif(btrim(description), '') is not null)
    ),
    constraint finance_transactions_source_wallet_fk foreign key (household_id, source_wallet_id)
        references public.finance_wallets (household_id, id) on delete restrict,
    constraint finance_transactions_destination_wallet_fk foreign key (household_id, destination_wallet_id)
        references public.finance_wallets (household_id, id) on delete restrict,
    constraint finance_transactions_category_fk foreign key (household_id, category_id)
        references public.finance_categories (household_id, id) on delete restrict
);

create unique index finance_transactions_one_opening_per_wallet
    on public.finance_transactions (household_id, destination_wallet_id)
    where kind = 'opening';

create index finance_wallets_household_visibility_owner_idx
    on public.finance_wallets (household_id, visibility, owner_user_id);
create index finance_transactions_household_date_id_idx
    on public.finance_transactions (household_id, transaction_date desc, id desc);
create index finance_transactions_source_date_idx
    on public.finance_transactions (household_id, source_wallet_id, transaction_date, id);
create index finance_transactions_destination_date_idx
    on public.finance_transactions (household_id, destination_wallet_id, transaction_date, id);
create index finance_transactions_category_date_idx
    on public.finance_transactions (household_id, category_id, transaction_date);

create function private.finance_can_access_wallet(
    p_household_id uuid,
    p_wallet_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_household_id is not null
       and p_wallet_id is not null
       and private.is_household_member(p_household_id)
       and exists (
            select 1
            from public.finance_wallets as wallet
            where wallet.household_id = p_household_id
              and wallet.id = p_wallet_id
              and (wallet.visibility = 'household'
                   or wallet.owner_user_id = (select auth.uid()))
       );
$$;

create function private.finance_can_read_transaction(
    p_household_id uuid,
    p_source_wallet_id uuid,
    p_destination_wallet_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (p_source_wallet_id is not null or p_destination_wallet_id is not null)
       and private.is_household_member(p_household_id)
       and (p_source_wallet_id is null
            or private.finance_can_access_wallet(p_household_id, p_source_wallet_id))
       and (p_destination_wallet_id is null
            or private.finance_can_access_wallet(p_household_id, p_destination_wallet_id));
$$;

create function private.finance_wallet_matches_scope(
    p_household_id uuid,
    p_wallet_id uuid,
    p_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case p_scope
        when 'household' then exists (
            select 1 from public.finance_wallets as wallet
            where wallet.household_id = p_household_id and wallet.id = p_wallet_id
              and wallet.visibility = 'household'
              and private.is_household_member(p_household_id)
        )
        when 'personal' then exists (
            select 1 from public.finance_wallets as wallet
            where wallet.household_id = p_household_id and wallet.id = p_wallet_id
              and wallet.visibility = 'private'
              and wallet.owner_user_id = (select auth.uid())
              and private.is_household_member(p_household_id)
        )
        when 'all_accessible' then private.finance_can_access_wallet(p_household_id, p_wallet_id)
        else false
    end;
$$;

revoke all on function private.finance_can_access_wallet(uuid, uuid) from public, anon, authenticated;
revoke all on function private.finance_can_read_transaction(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.finance_wallet_matches_scope(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.finance_can_access_wallet(uuid, uuid) to authenticated;
grant execute on function private.finance_can_read_transaction(uuid, uuid, uuid) to authenticated;
grant execute on function private.finance_wallet_matches_scope(uuid, uuid, text) to authenticated;

alter table public.finance_wallets enable row level security;
alter table public.finance_transactions enable row level security;

create policy finance_wallets_select_for_audience
on public.finance_wallets for select to authenticated
using ((select private.finance_can_access_wallet(household_id, id)));

create policy finance_transactions_select_for_endpoints
on public.finance_transactions for select to authenticated
using ((select private.finance_can_read_transaction(
    household_id, source_wallet_id, destination_wallet_id
)));

revoke all on table public.finance_wallets, public.finance_transactions from public, anon, authenticated;
grant select on table public.finance_wallets, public.finance_transactions to authenticated;

-- Every physical balance is a sum of signed transaction effects. Transfer rows
-- appear twice here for balance reads, but remain one row in history and reports.
create view public.finance_wallet_movements
with (security_invoker = true)
as
    select transaction.household_id,
        transaction.source_wallet_id as wallet_id,
        transaction.id as transaction_id,
        transaction.transaction_date,
        transaction.kind,
        (-transaction.amount_minor::numeric)::text as movement_minor
    from public.finance_transactions as transaction
    where transaction.source_wallet_id is not null
      and transaction.kind in ('expense', 'savings_expense', 'transfer')
    union all
    select transaction.household_id,
        transaction.destination_wallet_id as wallet_id,
        transaction.id as transaction_id,
        transaction.transaction_date,
        transaction.kind,
        transaction.amount_minor::numeric::text as movement_minor
    from public.finance_transactions as transaction
    where transaction.destination_wallet_id is not null
      and transaction.kind in (
          'income', 'refund', 'savings_refund', 'transfer', 'opening', 'adjustment'
      );

revoke all on table public.finance_wallet_movements from public, anon, authenticated;
grant select on table public.finance_wallet_movements to authenticated;

-- Keep optimistic wallet versions current when a transaction changes a balance.
create function private.finance_touch_transaction_wallets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op <> 'INSERT' then
        update public.finance_wallets as wallet
        set updated_at = pg_catalog.now()
        where wallet.household_id = old.household_id
          and wallet.id in (old.source_wallet_id, old.destination_wallet_id);
    end if;
    if tg_op <> 'DELETE' then
        update public.finance_wallets as wallet
        set updated_at = pg_catalog.now()
        where wallet.household_id = new.household_id
          and wallet.id in (new.source_wallet_id, new.destination_wallet_id);
    end if;
    return null;
end;
$$;

revoke all on function private.finance_touch_transaction_wallets() from public, anon, authenticated;

create trigger finance_wallets_household_write_lock
before insert or update or delete on public.finance_wallets
for each row execute function private.finance_lock_household_write();
create trigger finance_transactions_household_write_lock
before insert or update or delete on public.finance_transactions
for each row execute function private.finance_lock_household_write();
create trigger finance_wallets_touch_row
before insert or update on public.finance_wallets
for each row execute function private.finance_touch_row();
create trigger finance_transactions_touch_row
before insert or update on public.finance_transactions
for each row execute function private.finance_touch_row();
create trigger finance_transactions_touch_wallets
after insert or update or delete on public.finance_transactions
for each row execute function private.finance_touch_transaction_wallets();

create function private.finance_validate_category_transactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if exists (
        select 1
        from public.finance_transactions as transaction
        where transaction.household_id = new.household_id
          and transaction.category_id = new.id
          and (
              (transaction.kind = 'income' and new.budget_type <> 'income')
              or (transaction.kind in ('expense', 'savings_expense', 'refund', 'savings_refund')
                  and new.budget_type not in ('fixed_expense', 'variable_expense'))
              or (transaction.savings_effect = 'contribution'
                  and (new.budget_type <> 'saving' or new.allocation_role <> 'standard'))
          )
    ) then
        raise exception 'Category section is incompatible with its transaction history'
            using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke all on function private.finance_validate_category_transactions() from public, anon, authenticated;
create trigger finance_categories_validate_transactions
before update of budget_type, allocation_role on public.finance_categories
for each row execute function private.finance_validate_category_transactions();

-- Date-bounded wallet balances; minor-unit strings avoid JavaScript precision loss.
create function public.finance_list_wallets(
    p_household_id uuid,
    p_scope text,
    p_as_of_date date
)
returns table (
    id uuid,
    household_id uuid,
    created_by uuid,
    created_at timestamptz,
    updated_at timestamptz,
    version bigint,
    name text,
    wallet_type text,
    currency text,
    visibility text,
    owner_user_id uuid,
    opened_on date,
    is_archived boolean,
    color text,
    icon text,
    as_of_date date,
    balance_minor text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_household_id is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_scope is null or p_scope not in ('household', 'personal', 'all_accessible')
        or p_as_of_date is null or not pg_catalog.isfinite(p_as_of_date)
        or p_as_of_date > current_date then
        raise exception 'Invalid wallet list filters' using errcode = '22023';
    end if;

    return query
    select wallet.id, wallet.household_id, wallet.created_by, wallet.created_at,
        wallet.updated_at, wallet.version, wallet.name, wallet.wallet_type,
        wallet.currency, wallet.visibility, wallet.owner_user_id, wallet.opened_on,
        wallet.is_archived, wallet.color, wallet.icon, p_as_of_date,
        coalesce(sum(movement.movement_minor::numeric), 0)::text
    from public.finance_wallets as wallet
    left join public.finance_wallet_movements as movement
        on movement.household_id = wallet.household_id
       and movement.wallet_id = wallet.id
       and movement.transaction_date <= p_as_of_date
    where wallet.household_id = p_household_id
      and private.finance_wallet_matches_scope(wallet.household_id, wallet.id, p_scope)
    group by wallet.id
    order by wallet.is_archived, wallet.name, wallet.id;
end;
$$;

create function public.finance_list_transactions(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_id uuid,
    p_category_id uuid,
    p_kinds text[],
    p_search text,
    p_cursor_date date,
    p_cursor_id uuid,
    p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_search text := nullif(pg_catalog.btrim(p_search), '');
    v_result jsonb;
begin
    if p_household_id is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_month_start is null or not pg_catalog.isfinite(p_month_start)
        or extract(day from p_month_start) <> 1
        or p_scope is null or p_scope not in ('household', 'personal', 'all_accessible')
        or p_page_size is null or p_page_size < 1 or p_page_size > 50
        or ((p_cursor_date is null) <> (p_cursor_id is null))
        or pg_catalog.char_length(coalesce(v_search, '')) > 200 then
        raise exception 'Invalid transaction history filters' using errcode = '22023';
    end if;
    if p_wallet_id is not null
        and not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
        raise exception 'Wallet is unavailable' using errcode = '42501';
    end if;
    if p_kinds is not null and exists (
        select 1 from pg_catalog.unnest(p_kinds) as selected_kind
        where selected_kind not in (
            'income', 'expense', 'savings_expense', 'refund', 'savings_refund',
            'transfer', 'opening', 'adjustment'
        )
    ) then
        raise exception 'Invalid transaction kind filter' using errcode = '22023';
    end if;

    with filtered as (
        select transaction.*
        from public.finance_transactions as transaction
        where transaction.household_id = p_household_id
          and transaction.transaction_date >= p_month_start
          and transaction.transaction_date < (p_month_start + interval '1 month')
          and private.finance_wallet_matches_scope(
                transaction.household_id,
                coalesce(transaction.source_wallet_id, transaction.destination_wallet_id),
                p_scope
          )
          and (p_wallet_id is null
               or transaction.source_wallet_id = p_wallet_id
               or transaction.destination_wallet_id = p_wallet_id)
          and (p_category_id is null or transaction.category_id = p_category_id)
          and (p_kinds is null or transaction.kind = any (p_kinds))
          and (v_search is null or pg_catalog.strpos(
                pg_catalog.lower(coalesce(transaction.description, '')),
                pg_catalog.lower(v_search)
          ) > 0)
          and (p_cursor_date is null
               or (transaction.transaction_date, transaction.id) < (p_cursor_date, p_cursor_id))
    ),
    ranked as (
        select filtered.*,
            pg_catalog.row_number() over (
                order by filtered.transaction_date desc, filtered.id desc
            ) as page_row
        from filtered
        order by filtered.transaction_date desc, filtered.id desc
        limit p_page_size + 1
    )
    select pg_catalog.jsonb_build_object(
        'items', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', page.id,
                'household_id', page.household_id,
                'created_by', page.created_by,
                'created_at', page.created_at,
                'updated_at', page.updated_at,
                'version', page.version,
                'kind', page.kind,
                'transaction_date', page.transaction_date,
                'amount_minor', page.amount_minor::text,
                'source_wallet_id', page.source_wallet_id,
                'destination_wallet_id', page.destination_wallet_id,
                'category_id', page.category_id,
                'description', page.description,
                'savings_effect', page.savings_effect
            ) order by page.page_row)
            from ranked as page where page.page_row <= p_page_size
        ), '[]'::jsonb),
        'next_cursor', case when (select pg_catalog.count(*) from ranked) > p_page_size then (
            select pg_catalog.jsonb_build_object(
                'transaction_date', page.transaction_date,
                'transaction_id', page.id
            )
            from ranked as page where page.page_row = p_page_size
        ) else null end
    ) into v_result;

    return v_result;
end;
$$;

create function public.finance_transaction_month_summary(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_id uuid default null,
    p_category_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if p_household_id is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_month_start is null or not pg_catalog.isfinite(p_month_start)
        or extract(day from p_month_start) <> 1
        or p_scope is null or p_scope not in ('household', 'personal', 'all_accessible') then
        raise exception 'Invalid transaction summary filters' using errcode = '22023';
    end if;
    if p_wallet_id is not null
        and not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
        raise exception 'Wallet is unavailable' using errcode = '42501';
    end if;

    with month_rows as (
        select transaction.*
        from public.finance_transactions as transaction
        where transaction.household_id = p_household_id
          and transaction.transaction_date >= p_month_start
          and transaction.transaction_date < (p_month_start + interval '1 month')
          and private.finance_wallet_matches_scope(
                transaction.household_id,
                coalesce(transaction.source_wallet_id, transaction.destination_wallet_id),
                p_scope
          )
          and (p_wallet_id is null
               or transaction.source_wallet_id = p_wallet_id
               or transaction.destination_wallet_id = p_wallet_id)
    ),
    totals as (
        select
            coalesce(sum(amount_minor::numeric) filter (where kind = 'income'), 0) as income_minor,
            coalesce(sum(amount_minor::numeric) filter (where kind = 'expense'), 0)
                - coalesce(sum(amount_minor::numeric) filter (where kind = 'refund'), 0) as regular_expenses_minor,
            coalesce(sum(amount_minor::numeric) filter (where kind = 'refund'), 0) as regular_refunds_minor,
            coalesce(sum(amount_minor::numeric) filter (
                where kind = 'transfer' and savings_effect = 'contribution'
                  and exists (
                    select 1 from public.finance_categories as category
                    where category.household_id = month_rows.household_id
                      and category.id = month_rows.category_id
                      and category.budget_type = 'saving'
                      and category.allocation_role = 'standard'
                  )
                  and (p_wallet_id is null or destination_wallet_id = p_wallet_id)
            ), 0) as savings_contributions_minor,
            coalesce(sum(amount_minor::numeric) filter (where kind = 'savings_expense'), 0)
                - coalesce(sum(amount_minor::numeric) filter (where kind = 'savings_refund'), 0) as savings_spending_minor,
            coalesce(sum(amount_minor::numeric) filter (where kind = 'savings_refund'), 0) as savings_refunds_minor,
            count(*) filter (where kind not in ('opening', 'adjustment')) as transaction_count
        from month_rows
    ),
    category_rows as (
        select month_rows.category_id, category.name as category_name,
            category.budget_type, category.allocation_role, category.parent_id,
            sum(case
                when month_rows.kind in ('expense', 'savings_expense', 'income')
                    then month_rows.amount_minor::numeric
                when month_rows.kind in ('refund', 'savings_refund')
                    then -month_rows.amount_minor::numeric
                else 0
            end) as amount_minor,
            count(*) as transaction_count,
            case
                when month_rows.kind in ('expense', 'refund') then 'regular'
                when month_rows.kind in ('savings_expense', 'savings_refund') then 'savings'
                when month_rows.kind = 'income' then 'income'
            end as activity_type
        from month_rows
        join public.finance_categories as category
          on category.household_id = month_rows.household_id
         and category.id = month_rows.category_id
        where month_rows.kind in ('expense', 'refund', 'savings_expense', 'savings_refund', 'income')
          and (p_category_id is null or month_rows.category_id = p_category_id)
        group by month_rows.category_id, category.name, category.budget_type,
            category.allocation_role, category.parent_id,
            case
                when month_rows.kind in ('expense', 'refund') then 'regular'
                when month_rows.kind in ('savings_expense', 'savings_refund') then 'savings'
                when month_rows.kind = 'income' then 'income'
            end
    ),
    category_totals as (
        select activity_type,
            pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'category_id', category_id,
                'category_name', category_name,
                'budget_type', budget_type,
                'allocation_role', allocation_role,
                'parent_id', parent_id,
                'amount_minor', amount_minor::text,
                'transaction_count', transaction_count
            ) order by category_name, category_id) as items
        from category_rows
        group by activity_type
    )
    select pg_catalog.jsonb_build_object(
        'income_minor', totals.income_minor::text,
        'regular_expenses_minor', totals.regular_expenses_minor::text,
        'regular_refunds_minor', totals.regular_refunds_minor::text,
        'monthly_balance_minor', (totals.income_minor - totals.regular_expenses_minor)::text,
        'savings_contributions_minor', totals.savings_contributions_minor::text,
        'savings_spending_minor', totals.savings_spending_minor::text,
        'savings_refunds_minor', totals.savings_refunds_minor::text,
        'savings_change_minor', (totals.savings_contributions_minor - totals.savings_spending_minor)::text,
        'total_spending_minor', (totals.regular_expenses_minor + totals.savings_spending_minor)::text,
        'transaction_count', totals.transaction_count,
        'regular_category_totals', coalesce((select items from category_totals where activity_type = 'regular'), '[]'::jsonb),
        'savings_category_totals', coalesce((select items from category_totals where activity_type = 'savings'), '[]'::jsonb),
        'income_category_totals', coalesce((select items from category_totals where activity_type = 'income'), '[]'::jsonb)
    ) into v_result
    from totals;

    return v_result;
end;
$$;

revoke all on function public.finance_list_wallets(uuid, text, date) from public, anon;
revoke all on function public.finance_list_transactions(uuid, date, text, uuid, uuid, text[], text, date, uuid, integer) from public, anon;
revoke all on function public.finance_transaction_month_summary(uuid, date, text, uuid, uuid) from public, anon;
grant execute on function public.finance_list_wallets(uuid, text, date) to authenticated;
grant execute on function public.finance_list_transactions(uuid, date, text, uuid, uuid, text[], text, date, uuid, integer) to authenticated;
grant execute on function public.finance_transaction_month_summary(uuid, date, text, uuid, uuid) to authenticated;

create function public.finance_save_wallet(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_name text,
    p_wallet_type text,
    p_visibility text,
    p_opened_on date,
    p_opening_balance_minor bigint,
    p_color text,
    p_icon text
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
    v_wallet_id uuid;
    v_version bigint;
begin
    if v_actor_id is null then
        raise exception 'Authentication is required' using errcode = '42501';
    end if;
    if p_household_id is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null
        or p_name is null or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 120
        or p_wallet_type is null or p_wallet_type not in ('bank', 'cash', 'savings_bank')
        or (p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$')
        or (p_icon is not null and p_icon !~ '^[a-z][a-z0-9_-]{0,39}$') then
        raise exception 'Invalid wallet details' using errcode = '22023';
    end if;
    if p_wallet_id is null then
        if p_expected_version is not null or p_visibility is null
            or p_visibility not in ('household', 'private')
            or p_opened_on is null or not pg_catalog.isfinite(p_opened_on)
            or p_opened_on > current_date or p_opening_balance_minor is null
            or p_opening_balance_minor not between -999999999999999999 and 999999999999999999 then
            raise exception 'A new wallet requires a valid opening date, visibility and opening balance'
                using errcode = '22023';
        end if;
    elsif p_expected_version is null or p_expected_version < 1
        or p_visibility is not null or p_opened_on is not null
        or p_opening_balance_minor is not null then
        raise exception 'Wallet updates cannot change the opening record or visibility'
            using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id, 'expected_version', p_expected_version,
        'name', pg_catalog.btrim(p_name), 'wallet_type', p_wallet_type,
        'visibility', p_visibility, 'opened_on', p_opened_on,
        'opening_balance_minor', p_opening_balance_minor, 'color', p_color, 'icon', p_icon
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex'
    );
    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_save_wallet' and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        if not private.finance_can_access_wallet(p_household_id, (v_saved_result->>'wallet_id')::uuid) then
            raise exception 'Wallet is unavailable' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    if p_wallet_id is null then
        insert into public.finance_wallets (
            household_id, created_by, name, wallet_type, currency, visibility,
            owner_user_id, opened_on, color, icon
        ) values (
            p_household_id, v_actor_id, pg_catalog.btrim(p_name), p_wallet_type, 'PLN',
            p_visibility, v_actor_id, p_opened_on, p_color, p_icon
        ) returning id into v_wallet_id;
        insert into public.finance_transactions (
            household_id, created_by, kind, transaction_date, amount_minor,
            destination_wallet_id, description, savings_effect
        ) values (
            p_household_id, v_actor_id, 'opening', p_opened_on,
            p_opening_balance_minor::public.finance_minor_units,
            v_wallet_id, 'Saldo początkowe', 'none'
        );
        select wallet.version into v_version
        from public.finance_wallets as wallet
        where wallet.household_id = p_household_id and wallet.id = v_wallet_id;
    else
        select wallet.* into v_wallet
        from public.finance_wallets as wallet
        where wallet.household_id = p_household_id and wallet.id = p_wallet_id
        for update;
        if not found or not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
            raise exception 'Wallet is unavailable' using errcode = '42501';
        end if;
        if v_wallet.version <> p_expected_version then
            return pg_catalog.jsonb_build_object(
                'conflict', true, 'wallet_id', v_wallet.id, 'current_version', v_wallet.version
            );
        end if;
        update public.finance_wallets as wallet
        set name = pg_catalog.btrim(p_name), wallet_type = p_wallet_type, color = p_color, icon = p_icon
        where wallet.household_id = p_household_id and wallet.id = p_wallet_id
        returning wallet.id, wallet.version into v_wallet_id, v_version;
    end if;

    v_saved_result := pg_catalog.jsonb_build_object('wallet_id', v_wallet_id, 'version', v_version);
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_save_wallet', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_save_wallet(uuid, uuid, uuid, bigint, text, text, text, date, bigint, text, text)
    from public, anon;
grant execute on function public.finance_save_wallet(uuid, uuid, uuid, bigint, text, text, text, date, bigint, text, text)
    to authenticated;

create function public.finance_set_wallet_archived(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_is_archived boolean
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
    v_balance numeric;
begin
    if v_actor_id is null or p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_wallet_id is null
        or p_expected_version is null or p_expected_version < 1 or p_is_archived is null then
        raise exception 'Invalid wallet archive request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id, 'expected_version', p_expected_version, 'is_archived', p_is_archived
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex'
    );
    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_set_wallet_archived' and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
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
            'conflict', true, 'wallet_id', v_wallet.id, 'current_version', v_wallet.version
        );
    end if;
    if p_is_archived and not v_wallet.is_archived then
        select coalesce(sum(movement.movement_minor::numeric), 0)
        into v_balance
        from public.finance_wallet_movements as movement
        where movement.household_id = p_household_id
          and movement.wallet_id = p_wallet_id
          and movement.transaction_date <= current_date;
        if v_balance <> 0 then
            raise exception 'A wallet can be archived only with a zero current balance' using errcode = '22023';
        end if;
    end if;
    if v_wallet.is_archived is distinct from p_is_archived then
        update public.finance_wallets as wallet
        set is_archived = p_is_archived
        where wallet.household_id = p_household_id and wallet.id = p_wallet_id
        returning wallet.version into v_wallet.version;
    end if;
    v_saved_result := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id, 'version', v_wallet.version, 'is_archived', p_is_archived
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_set_wallet_archived', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_set_wallet_archived(uuid, uuid, uuid, bigint, boolean)
    from public, anon;
grant execute on function public.finance_set_wallet_archived(uuid, uuid, uuid, bigint, boolean)
    to authenticated;

create function public.finance_preview_wallet_balance(
    p_household_id uuid,
    p_wallet_id uuid,
    p_effective_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_wallet public.finance_wallets%rowtype;
    v_balance numeric;
    v_snapshot_token text;
begin
    if p_household_id is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_effective_date is null or not pg_catalog.isfinite(p_effective_date)
        or p_effective_date > current_date then
        raise exception 'Balance correction date must be on or before today' using errcode = '22023';
    end if;
    select wallet.* into v_wallet
    from public.finance_wallets as wallet
    where wallet.household_id = p_household_id and wallet.id = p_wallet_id;
    if not found or not private.finance_can_access_wallet(p_household_id, p_wallet_id) then
        raise exception 'Wallet is unavailable' using errcode = '42501';
    end if;
    if v_wallet.is_archived then
        raise exception 'Restore the wallet before correcting its balance' using errcode = '22023';
    end if;
    if p_effective_date < v_wallet.opened_on then
        raise exception 'Balance correction date cannot be before the wallet opening date'
            using errcode = '22023';
    end if;
    select coalesce(sum(movement.movement_minor::numeric), 0)
    into v_balance
    from public.finance_wallet_movements as movement
    where movement.household_id = p_household_id
      and movement.wallet_id = p_wallet_id and movement.transaction_date <= p_effective_date;
    v_snapshot_token := pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(pg_catalog.jsonb_build_object(
            'wallet_id', p_wallet_id, 'version', v_wallet.version,
            'effective_date', p_effective_date, 'balance_minor', v_balance::text
        )::text, 'UTF8'), 'sha256'
    ), 'hex');
    return pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id, 'wallet_version', v_wallet.version,
        'effective_date', p_effective_date, 'current_balance_minor', v_balance::text,
        'snapshot_token', v_snapshot_token
    );
end;
$$;

revoke all on function public.finance_preview_wallet_balance(uuid, uuid, date) from public, anon;
grant execute on function public.finance_preview_wallet_balance(uuid, uuid, date) to authenticated;

create function public.finance_correct_wallet_balance(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_snapshot_token text,
    p_effective_date date,
    p_observed_balance_minor bigint,
    p_reason text
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
    v_balance numeric;
    v_delta numeric;
    v_snapshot_token text;
    v_transaction_id uuid;
begin
    if v_actor_id is null or p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_wallet_id is null
        or p_expected_version is null or p_expected_version < 1
        or p_snapshot_token is null or p_snapshot_token !~ '^[0-9a-f]{64}$'
        or p_effective_date is null or not pg_catalog.isfinite(p_effective_date)
        or p_effective_date > current_date or p_observed_balance_minor is null
        or p_observed_balance_minor not between -999999999999999999 and 999999999999999999
        or p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
        raise exception 'Invalid wallet balance correction' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id, 'expected_version', p_expected_version,
        'snapshot_token', p_snapshot_token, 'effective_date', p_effective_date,
        'observed_balance_minor', p_observed_balance_minor, 'reason', pg_catalog.btrim(p_reason)
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex'
    );
    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_correct_wallet_balance' and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
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
        raise exception 'Restore the wallet before correcting its balance' using errcode = '22023';
    end if;
    if p_effective_date < v_wallet.opened_on then
        raise exception 'Balance correction date cannot be before the wallet opening date'
            using errcode = '22023';
    end if;
    select coalesce(sum(movement.movement_minor::numeric), 0)
    into v_balance
    from public.finance_wallet_movements as movement
    where movement.household_id = p_household_id
      and movement.wallet_id = p_wallet_id and movement.transaction_date <= p_effective_date;
    v_snapshot_token := pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(pg_catalog.jsonb_build_object(
            'wallet_id', p_wallet_id, 'version', v_wallet.version,
            'effective_date', p_effective_date, 'balance_minor', v_balance::text
        )::text, 'UTF8'), 'sha256'
    ), 'hex');
    if v_snapshot_token <> p_snapshot_token then
        raise exception 'Wallet balance changed since the correction preview' using errcode = '40001';
    end if;
    v_delta := p_observed_balance_minor::numeric - v_balance;
    if v_delta not between -999999999999999999 and 999999999999999999 then
        raise exception 'Balance correction exceeds the supported amount range' using errcode = '22003';
    end if;
    if v_delta <> 0 then
        insert into public.finance_transactions (
            household_id, created_by, kind, transaction_date, amount_minor,
            destination_wallet_id, description, savings_effect
        ) values (
            p_household_id, v_actor_id, 'adjustment', p_effective_date,
            v_delta::bigint::public.finance_minor_units, p_wallet_id,
            pg_catalog.btrim(p_reason), 'none'
        ) returning id into v_transaction_id;
        select wallet.version into v_wallet.version
        from public.finance_wallets as wallet
        where wallet.household_id = p_household_id and wallet.id = p_wallet_id;
    end if;
    v_saved_result := pg_catalog.jsonb_build_object(
        'wallet_id', p_wallet_id, 'transaction_id', v_transaction_id,
        'adjustment_minor', v_delta::text,
        'observed_balance_minor', p_observed_balance_minor::text, 'version', v_wallet.version
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_correct_wallet_balance', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_correct_wallet_balance(uuid, uuid, uuid, bigint, text, date, bigint, text)
    from public, anon;
grant execute on function public.finance_correct_wallet_balance(uuid, uuid, uuid, bigint, text, date, bigint, text)
    to authenticated;

create function public.finance_save_wallet_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
    p_expected_version bigint,
    p_kind text,
    p_transaction_date date,
    p_amount_minor bigint,
    p_source_wallet_id uuid,
    p_destination_wallet_id uuid,
    p_category_id uuid,
    p_description text,
    p_savings_effect text
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
    v_existing public.finance_transactions%rowtype;
    v_source public.finance_wallets%rowtype;
    v_destination public.finance_wallets%rowtype;
    v_category_type text;
    v_category_role text;
    v_transaction_id uuid;
    v_version bigint;
begin
    if v_actor_id is null or p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null
        or p_kind is null or p_kind not in (
            'income', 'expense', 'savings_expense', 'refund', 'savings_refund', 'transfer'
        )
        or p_transaction_date is null or not pg_catalog.isfinite(p_transaction_date)
        or p_transaction_date > current_date
        or p_amount_minor is null or p_amount_minor <= 0
        or p_amount_minor > 999999999999999999
        or p_savings_effect is null or p_savings_effect not in ('none', 'contribution')
        or (p_description is not null and pg_catalog.char_length(p_description) > 2000)
        or (p_transaction_id is null and p_expected_version is not null)
        or (p_transaction_id is not null and (p_expected_version is null or p_expected_version < 1)) then
        raise exception 'Invalid transaction details' using errcode = '22023';
    end if;
    if (p_kind in ('income', 'refund', 'savings_refund')
            and (p_source_wallet_id is not null or p_destination_wallet_id is null))
        or (p_kind in ('expense', 'savings_expense')
            and (p_source_wallet_id is null or p_destination_wallet_id is not null))
        or (p_kind = 'transfer' and (p_source_wallet_id is null or p_destination_wallet_id is null
            or p_source_wallet_id = p_destination_wallet_id))
        or (p_kind <> 'transfer' and p_savings_effect <> 'none') then
        raise exception 'Transaction kind does not match its wallet endpoints or savings effect'
            using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object(
        'transaction_id', p_transaction_id, 'expected_version', p_expected_version,
        'kind', p_kind, 'transaction_date', p_transaction_date, 'amount_minor', p_amount_minor,
        'source_wallet_id', p_source_wallet_id, 'destination_wallet_id', p_destination_wallet_id,
        'category_id', p_category_id,
        'description', nullif(pg_catalog.btrim(p_description), ''),
        'savings_effect', p_savings_effect
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex'
    );
    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_save_wallet_transaction' and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        if not private.finance_can_read_transaction(
            p_household_id,
            (v_saved_result->>'source_wallet_id')::uuid,
            (v_saved_result->>'destination_wallet_id')::uuid
        ) then
            raise exception 'Transaction is unavailable' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;

    if p_transaction_id is not null then
        select tx.* into v_existing
        from public.finance_transactions as tx
        where tx.household_id = p_household_id and tx.id = p_transaction_id
        for update;
        if not found or not private.finance_can_read_transaction(
            p_household_id, v_existing.source_wallet_id, v_existing.destination_wallet_id
        ) then
            raise exception 'Transaction is unavailable' using errcode = '42501';
        end if;
        if v_existing.kind in ('opening', 'adjustment') then
            raise exception 'Opening and adjustment records use dedicated wallet actions' using errcode = '22023';
        end if;
        if v_existing.version <> p_expected_version then
            return pg_catalog.jsonb_build_object(
                'conflict', true, 'transaction_id', v_existing.id,
                'current_version', v_existing.version
            );
        end if;
    end if;

    perform 1
    from public.finance_wallets as wallet
    where wallet.household_id = p_household_id
      and wallet.id = any (array_remove(array[
          p_source_wallet_id, p_destination_wallet_id,
          v_existing.source_wallet_id, v_existing.destination_wallet_id
      ], null))
    order by wallet.id
    for update;

    if p_transaction_id is not null and exists (
        select 1 from public.finance_wallets as wallet
        where wallet.household_id = p_household_id
          and wallet.id in (v_existing.source_wallet_id, v_existing.destination_wallet_id)
          and wallet.is_archived
    ) then
        raise exception 'Restore the wallet before changing its transaction history' using errcode = '22023';
    end if;
    if p_source_wallet_id is not null then
        select wallet.* into v_source
        from public.finance_wallets as wallet
        where wallet.household_id = p_household_id and wallet.id = p_source_wallet_id;
        if not found or not private.finance_can_access_wallet(p_household_id, p_source_wallet_id) then
            raise exception 'Wallet is unavailable' using errcode = '42501';
        end if;
        if v_source.is_archived then
            raise exception 'Restore the wallet before changing its transaction history' using errcode = '22023';
        end if;
        if p_transaction_date < v_source.opened_on then
            raise exception 'Transaction date cannot be before the source wallet opening date' using errcode = '22023';
        end if;
    end if;
    if p_destination_wallet_id is not null then
        select wallet.* into v_destination
        from public.finance_wallets as wallet
        where wallet.household_id = p_household_id and wallet.id = p_destination_wallet_id;
        if not found or not private.finance_can_access_wallet(p_household_id, p_destination_wallet_id) then
            raise exception 'Wallet is unavailable' using errcode = '42501';
        end if;
        if v_destination.is_archived then
            raise exception 'Restore the wallet before changing its transaction history' using errcode = '22023';
        end if;
        if p_transaction_date < v_destination.opened_on then
            raise exception 'Transaction date cannot be before the destination wallet opening date' using errcode = '22023';
        end if;
    end if;
    if p_kind = 'transfer' and (
        v_source.visibility <> v_destination.visibility
        or (v_source.visibility = 'private' and v_source.owner_user_id <> v_destination.owner_user_id)
    ) then
        raise exception 'Transfers between different visibility scopes are not supported' using errcode = '22023';
    end if;

    if p_category_id is not null then
        select category.budget_type, category.allocation_role
        into v_category_type, v_category_role
        from public.finance_categories as category
        where category.household_id = p_household_id and category.id = p_category_id;
        if not found then
            raise exception 'Category is unavailable' using errcode = '22023';
        end if;
    end if;
    if p_kind = 'income' and (p_category_id is null or v_category_type <> 'income') then
        raise exception 'Income requires an income category' using errcode = '22023';
    elsif p_kind in ('expense', 'savings_expense', 'refund', 'savings_refund')
        and (p_category_id is null or v_category_type not in ('fixed_expense', 'variable_expense')) then
        raise exception 'Expenses and refunds require an expense category' using errcode = '22023';
    elsif p_kind = 'transfer' and p_savings_effect = 'contribution'
        and (p_category_id is null or v_category_type <> 'saving' or v_category_role <> 'standard') then
        raise exception 'A savings contribution requires a standard savings category' using errcode = '22023';
    end if;

    if p_transaction_id is null then
        insert into public.finance_transactions (
            household_id, created_by, kind, transaction_date, amount_minor,
            source_wallet_id, destination_wallet_id, category_id, description, savings_effect
        ) values (
            p_household_id, v_actor_id, p_kind, p_transaction_date,
            p_amount_minor::public.finance_minor_units, p_source_wallet_id,
            p_destination_wallet_id, p_category_id, nullif(pg_catalog.btrim(p_description), ''),
            p_savings_effect
        ) returning id, version into v_transaction_id, v_version;
    else
        update public.finance_transactions as tx
        set kind = p_kind,
            transaction_date = p_transaction_date,
            amount_minor = p_amount_minor::public.finance_minor_units,
            source_wallet_id = p_source_wallet_id,
            destination_wallet_id = p_destination_wallet_id,
            category_id = p_category_id,
            description = nullif(pg_catalog.btrim(p_description), ''),
            savings_effect = p_savings_effect
        where tx.household_id = p_household_id and tx.id = p_transaction_id
        returning tx.id, tx.version into v_transaction_id, v_version;
    end if;
    v_saved_result := pg_catalog.jsonb_build_object(
        'transaction_id', v_transaction_id, 'version', v_version,
        'source_wallet_id', p_source_wallet_id, 'destination_wallet_id', p_destination_wallet_id
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_save_wallet_transaction', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_save_wallet_transaction(uuid, uuid, uuid, bigint, text, date, bigint, uuid, uuid, uuid, text, text)
    from public, anon;
grant execute on function public.finance_save_wallet_transaction(uuid, uuid, uuid, bigint, text, date, bigint, uuid, uuid, uuid, text, text)
    to authenticated;

create function public.finance_delete_wallet_transaction(
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
    v_transaction public.finance_transactions%rowtype;
begin
    if v_actor_id is null or p_household_id is null
        or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_transaction_id is null
        or p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid transaction deletion request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_request := pg_catalog.jsonb_build_object(
        'transaction_id', p_transaction_id, 'expected_version', p_expected_version
    );
    v_request_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request::text, 'UTF8'), 'sha256'), 'hex'
    );
    select receipt.request_sha256, receipt.result
    into v_saved_sha256, v_saved_result
    from private.finance_operation_receipts as receipt
    where receipt.household_id = p_household_id and receipt.actor_id = v_actor_id
      and receipt.operation_name = 'finance_delete_wallet_transaction' and receipt.request_id = p_request_id
    for update;
    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        if not private.finance_can_read_transaction(
            p_household_id,
            (v_saved_result->>'source_wallet_id')::uuid,
            (v_saved_result->>'destination_wallet_id')::uuid
        ) then
            raise exception 'Transaction is unavailable' using errcode = '42501';
        end if;
        return v_saved_result;
    end if;
    select tx.* into v_transaction
    from public.finance_transactions as tx
    where tx.household_id = p_household_id and tx.id = p_transaction_id
    for update;
    if not found or not private.finance_can_read_transaction(
        p_household_id, v_transaction.source_wallet_id, v_transaction.destination_wallet_id
    ) then
        raise exception 'Transaction is unavailable' using errcode = '42501';
    end if;
    if v_transaction.kind in ('opening', 'adjustment') then
        raise exception 'Opening and adjustment records use dedicated wallet actions' using errcode = '22023';
    end if;
    if v_transaction.version <> p_expected_version then
        return pg_catalog.jsonb_build_object(
            'conflict', true, 'transaction_id', v_transaction.id,
            'current_version', v_transaction.version
        );
    end if;
    perform 1
    from public.finance_wallets as wallet
    where wallet.household_id = p_household_id
      and wallet.id = any (array_remove(array[
          v_transaction.source_wallet_id, v_transaction.destination_wallet_id
      ], null))
    order by wallet.id
    for update;
    if exists (
        select 1 from public.finance_wallets as wallet
        where wallet.household_id = p_household_id
          and wallet.id in (v_transaction.source_wallet_id, v_transaction.destination_wallet_id)
          and wallet.is_archived
    ) then
        raise exception 'Restore the wallet before changing its transaction history' using errcode = '22023';
    end if;
    delete from public.finance_transactions as tx
    where tx.household_id = p_household_id and tx.id = p_transaction_id;
    v_saved_result := pg_catalog.jsonb_build_object(
        'deleted', true, 'transaction_id', p_transaction_id,
        'source_wallet_id', v_transaction.source_wallet_id,
        'destination_wallet_id', v_transaction.destination_wallet_id
    );
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_delete_wallet_transaction', p_request_id,
        v_request_sha256, v_saved_result
    );
    return v_saved_result;
end;
$$;

revoke all on function public.finance_delete_wallet_transaction(uuid, uuid, uuid, bigint)
    from public, anon;
grant execute on function public.finance_delete_wallet_transaction(uuid, uuid, uuid, bigint)
    to authenticated;

notify pgrst, 'reload schema';
