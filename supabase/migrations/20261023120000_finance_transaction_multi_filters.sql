-- Multi-select filters for transaction history and monthly reporting.

create function public.finance_list_transactions_multi(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_ids uuid[],
    p_category_ids uuid[],
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
    if p_wallet_ids is not null and exists (
        select 1 from pg_catalog.unnest(p_wallet_ids) as selected_wallet(wallet_id)
        where not private.finance_can_access_wallet(p_household_id, selected_wallet.wallet_id)
    ) then
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
          and (p_wallet_ids is null
               or transaction.source_wallet_id = any(p_wallet_ids)
               or transaction.destination_wallet_id = any(p_wallet_ids))
          and (p_category_ids is null or transaction.category_id = any(p_category_ids))
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

create function public.finance_transaction_month_summary_multi(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_ids uuid[] default null,
    p_category_ids uuid[] default null,
    p_kinds text[] default null
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
    if p_wallet_ids is not null and exists (
        select 1 from pg_catalog.unnest(p_wallet_ids) as selected_wallet(wallet_id)
        where not private.finance_can_access_wallet(p_household_id, selected_wallet.wallet_id)
    ) then
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
          and (p_wallet_ids is null
               or transaction.source_wallet_id = any(p_wallet_ids)
               or transaction.destination_wallet_id = any(p_wallet_ids))
          and (p_category_ids is null or transaction.category_id = any(p_category_ids))
          and (p_kinds is null or transaction.kind = any(p_kinds))
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
                  and (p_wallet_ids is null or destination_wallet_id = any(p_wallet_ids))
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

create or replace function public.finance_list_transactions(
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
begin
    return public.finance_list_transactions_multi(
        p_household_id, p_month_start, p_scope,
        case when p_wallet_id is null then null else array[p_wallet_id] end,
        case when p_category_id is null then null else array[p_category_id] end,
        p_kinds, p_search, p_cursor_date, p_cursor_id, p_page_size
    );
end;
$$;

create or replace function public.finance_transaction_month_summary(
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
begin
    return public.finance_transaction_month_summary_multi(
        p_household_id, p_month_start, p_scope,
        case when p_wallet_id is null then null else array[p_wallet_id] end,
        case when p_category_id is null then null else array[p_category_id] end,
        null
    );
end;
$$;

revoke all on function public.finance_list_transactions_multi(uuid, date, text, uuid[], uuid[], text[], text, date, uuid, integer) from public, anon;
revoke all on function public.finance_transaction_month_summary_multi(uuid, date, text, uuid[], uuid[], text[]) from public, anon;
grant execute on function public.finance_list_transactions_multi(uuid, date, text, uuid[], uuid[], text[], text, date, uuid, integer) to authenticated;
grant execute on function public.finance_transaction_month_summary_multi(uuid, date, text, uuid[], uuid[], text[]) to authenticated;
