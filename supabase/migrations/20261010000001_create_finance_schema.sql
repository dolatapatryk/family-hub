-- Store money as signed integer minor units (for example, PLN 100.23 is 10023).
-- Keep the bound aligned with the frontend's exact BigInt arithmetic contract.
create domain public.finance_minor_units as bigint
    check (value between -999999999999999999 and 999999999999999999);

comment on domain public.finance_minor_units is
    'Signed integer minor units; PLN 100.23 is stored as 10023. Bounded to +/-999999999999999999.';

-- 1. Monthly budget
create table public.finance_months (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    month_start date not null,
    display_name text,
    constraint finance_months_id_household_unique unique (household_id, id),
    constraint finance_months_month_start_valid check (
        pg_catalog.isfinite(month_start)
        and month_start between date '0001-01-01' and date '9999-12-31'
        and extract(day from month_start) = 1
    ),
    constraint finance_months_display_name_not_blank check (
        display_name is null or char_length(btrim(display_name)) > 0
    ),
    constraint finance_months_household_month_unique unique (household_id, month_start)
);

create table public.finance_categories (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    budget_type text not null,
    parent_id uuid,
    color text,
    sort_order integer not null default 0,
    constraint finance_categories_id_household_unique unique (household_id, id),
    constraint finance_categories_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_categories_budget_type check (
        budget_type in ('income', 'fixed_expense', 'variable_expense', 'saving', 'investment')
    ),
    constraint finance_categories_not_own_parent check (parent_id is null or parent_id <> id),
    constraint finance_categories_parent_fk foreign key (household_id, parent_id)
        references public.finance_categories (household_id, id) on delete restrict
);

create table public.finance_budget_items (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    month_id uuid not null,
    category_id uuid not null,
    name text not null,
    amount public.finance_minor_units not null,
    allocation_role text not null default 'standard',
    is_planned boolean not null default false,
    is_recurring boolean not null default false,
    notes text,
    sort_order integer not null default 0,
    constraint finance_budget_items_id_household_unique unique (household_id, id),
    constraint finance_budget_items_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_budget_items_allocation_role check (
        allocation_role in ('standard', 'personal_allowance')
    ),
    constraint finance_budget_items_month_fk foreign key (household_id, month_id)
        references public.finance_months (household_id, id) on delete restrict,
    constraint finance_budget_items_category_fk foreign key (household_id, category_id)
        references public.finance_categories (household_id, id) on delete restrict
);

create table public.finance_scenarios (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    description text,
    sort_order integer not null default 0,
    constraint finance_scenarios_id_household_unique unique (household_id, id),
    constraint finance_scenarios_name_not_blank check (char_length(btrim(name)) > 0)
);

create table public.finance_scenario_items (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    scenario_id uuid not null,
    category_id uuid not null,
    name text not null,
    amount public.finance_minor_units not null,
    allocation_role text not null default 'standard',
    is_planned boolean not null default false,
    is_recurring boolean not null default false,
    notes text,
    sort_order integer not null default 0,
    constraint finance_scenario_items_id_household_unique unique (household_id, id),
    constraint finance_scenario_items_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_scenario_items_allocation_role check (
        allocation_role in ('standard', 'personal_allowance')
    ),
    constraint finance_scenario_items_scenario_fk foreign key (household_id, scenario_id)
        references public.finance_scenarios (household_id, id) on delete cascade,
    constraint finance_scenario_items_category_fk foreign key (household_id, category_id)
        references public.finance_categories (household_id, id) on delete restrict
);

-- 2. Savings accounts, movements, drafts, transfers, and plans
create table public.finance_savings_accounts (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    account_type text not null,
    parent_id uuid,
    opening_balance public.finance_minor_units not null default 0,
    target_amount public.finance_minor_units,
    color text,
    is_archived boolean not null default false,
    visibility text not null default 'private',
    owner_user_id uuid not null references auth.users (id) on delete restrict,
    sort_order integer not null default 0,
    constraint finance_savings_accounts_id_household_unique unique (household_id, id),
    constraint finance_savings_accounts_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_savings_accounts_type check (
        account_type in ('cash', 'goal', 'investment', 'retirement')
    ),
    constraint finance_savings_accounts_visibility check (visibility in ('household', 'private')),
    constraint finance_savings_accounts_target_positive check (
        target_amount is null or target_amount > 0
    ),
    constraint finance_savings_accounts_not_own_parent check (
        parent_id is null or parent_id <> id
    ),
    constraint finance_savings_accounts_parent_fk foreign key (household_id, parent_id)
        references public.finance_savings_accounts (household_id, id) on delete restrict
);

create table public.finance_savings_transfers (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    constraint finance_savings_transfers_id_household_unique unique (household_id, id)
);

create table public.finance_savings_transactions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    account_id uuid not null,
    transaction_date date not null,
    amount public.finance_minor_units not null,
    description text,
    budget_month_id uuid,
    excluded_from_monthly_savings boolean not null default false,
    transfer_id uuid,
    source_planned_transaction_id uuid,
    constraint finance_savings_transactions_id_household_unique unique (household_id, id),
    constraint finance_savings_transactions_date_valid check (
        pg_catalog.isfinite(transaction_date)
        and transaction_date between date '0001-01-01' and date '9999-12-31'
    ),
    constraint finance_savings_transactions_transfer_leg_valid check (
        transfer_id is null or (amount <> 0 and excluded_from_monthly_savings)
    ),
    constraint finance_savings_transactions_account_fk foreign key (household_id, account_id)
        references public.finance_savings_accounts (household_id, id) on delete restrict,
    constraint finance_savings_transactions_month_fk foreign key (household_id, budget_month_id)
        references public.finance_months (household_id, id) on delete restrict,
    constraint finance_savings_transactions_transfer_fk foreign key (household_id, transfer_id)
        references public.finance_savings_transfers (household_id, id) on delete cascade
);

create table public.finance_planned_savings_transactions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    month_id uuid not null,
    account_id uuid not null,
    amount public.finance_minor_units not null,
    description text,
    source_savings_plan_id uuid,
    constraint finance_planned_savings_transactions_id_household_unique unique (household_id, id),
    constraint finance_planned_savings_transactions_month_fk foreign key (household_id, month_id)
        references public.finance_months (household_id, id) on delete restrict,
    constraint finance_planned_savings_transactions_account_fk foreign key (household_id, account_id)
        references public.finance_savings_accounts (household_id, id) on delete restrict
);

create table public.finance_savings_plans (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    plan_type text not null,
    account_id uuid,
    monthly_amount public.finance_minor_units not null,
    annual_amount_override public.finance_minor_units,
    visibility text not null default 'private',
    owner_user_id uuid not null references auth.users (id) on delete restrict,
    sort_order integer not null default 0,
    constraint finance_savings_plans_id_household_unique unique (household_id, id),
    constraint finance_savings_plans_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_savings_plans_type check (
        plan_type in ('cash', 'goal', 'investment', 'retirement', 'irregular')
    ),
    constraint finance_savings_plans_visibility check (visibility in ('household', 'private')),
    constraint finance_savings_plans_account_fk foreign key (household_id, account_id)
        references public.finance_savings_accounts (household_id, id) on delete restrict
);

alter table public.finance_planned_savings_transactions
    add constraint finance_planned_savings_transactions_plan_fk
    foreign key (household_id, source_savings_plan_id)
    references public.finance_savings_plans (household_id, id) on delete restrict;

create table public.finance_irregular_expense_plans (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    annual_amount public.finance_minor_units not null,
    sort_order integer not null default 0,
    constraint finance_irregular_expense_plans_id_household_unique unique (household_id, id),
    constraint finance_irregular_expense_plans_name_not_blank check (char_length(btrim(name)) > 0)
);

-- 3. Shared spending projects
create table public.finance_projects (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    name text not null,
    description text,
    target_budget public.finance_minor_units,
    is_archived boolean not null default false,
    sort_order integer not null default 0,
    constraint finance_projects_id_household_unique unique (household_id, id),
    constraint finance_projects_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_projects_target_positive check (target_budget is null or target_budget > 0)
);

create table public.finance_project_expenses (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    project_id uuid not null,
    expense_date date,
    name text not null,
    amount public.finance_minor_units not null,
    notes text,
    sort_order integer not null default 0,
    constraint finance_project_expenses_id_household_unique unique (household_id, id),
    constraint finance_project_expenses_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_project_expenses_date_valid check (
        expense_date is null or (
            pg_catalog.isfinite(expense_date)
            and expense_date between date '0001-01-01' and date '9999-12-31'
        )
    ),
    constraint finance_project_expenses_project_fk foreign key (household_id, project_id)
        references public.finance_projects (household_id, id) on delete cascade
);

-- Internal support data is kept out of the exposed PostgREST schemas.
create table private.finance_import_runs (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    imported_by uuid not null references auth.users (id) on delete restrict,
    source_namespace text not null,
    source_format_version text not null,
    source_sha256 text not null,
    mapping_sha256 text not null,
    import_mode text not null,
    counts jsonb not null default '{}'::jsonb,
    completed_at timestamptz,
    constraint finance_import_runs_namespace_not_blank check (char_length(btrim(source_namespace)) > 0),
    constraint finance_import_runs_mode check (import_mode in ('initial', 'private_accounts')),
    constraint finance_import_runs_hashes check (
        source_sha256 ~ '^[0-9a-f]{64}$' and mapping_sha256 ~ '^[0-9a-f]{64}$'
    ),
    constraint finance_import_runs_counts_object check (jsonb_typeof(counts) = 'object'),
    constraint finance_import_runs_fingerprint_unique unique (
        household_id, imported_by, source_namespace, import_mode, source_sha256, mapping_sha256
    )
);

create table private.finance_legacy_id_map (
    household_id uuid not null references public.households (id) on delete cascade,
    source_namespace text not null,
    entity_type text not null,
    legacy_parent_id text not null default '',
    legacy_id text not null,
    target_id uuid not null,
    import_run_id uuid not null references private.finance_import_runs (id) on delete cascade,
    constraint finance_legacy_id_map_entity_type check (
        entity_type in (
            'month', 'category', 'budget_item', 'scenario', 'scenario_item',
            'savings_account', 'savings_transfer', 'savings_transaction',
            'planned_savings_transaction', 'savings_plan', 'irregular_expense_plan',
            'project', 'project_expense'
        )
    ),
    constraint finance_legacy_id_map_source_not_blank check (
        char_length(btrim(source_namespace)) > 0 and char_length(btrim(legacy_id)) > 0
    ),
    constraint finance_legacy_id_map_source_entity_unique unique (
        household_id, source_namespace, entity_type, legacy_parent_id, legacy_id
    )
);

create table private.finance_operation_receipts (
    household_id uuid not null references public.households (id) on delete cascade,
    actor_id uuid not null references auth.users (id) on delete restrict,
    operation_name text not null,
    request_id uuid not null,
    request_sha256 text not null,
    result jsonb not null,
    completed_at timestamptz not null default now(),
    constraint finance_operation_receipts_operation_not_blank check (char_length(btrim(operation_name)) > 0),
    constraint finance_operation_receipts_hash check (request_sha256 ~ '^[0-9a-f]{64}$'),
    constraint finance_operation_receipts_result_object check (jsonb_typeof(result) = 'object'),
    constraint finance_operation_receipts_request_unique unique (
        household_id, actor_id, operation_name, request_id
    )
);

-- Every finance row has immutable identity/audit ownership and a database-owned
-- update clock/version. Caller grants below omit these columns from writes.
create function private.finance_touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.version := 1;
        new.updated_at := pg_catalog.now();
        return new;
    end if;

    if new.id is distinct from old.id
        or new.household_id is distinct from old.household_id
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at then
        raise exception 'Finance row identity and ownership cannot be changed'
            using errcode = '42501';
    end if;

    new.version := old.version + 1;
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

revoke all on function private.finance_touch_row() from public, anon, authenticated;

create function private.finance_validate_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    parent_type text;
begin
    if new.parent_id is not null then
        select category.budget_type
        into parent_type
        from public.finance_categories as category
        where category.household_id = new.household_id
          and category.id = new.parent_id;

        if parent_type is null then
            raise exception 'Category parent must exist in the same household'
                using errcode = '23503';
        end if;
        if parent_type is distinct from new.budget_type then
            raise exception 'A category parent must have the same budget type'
                using errcode = '23514';
        end if;

        if exists (
            with recursive ancestors(id, parent_id, path) as (
                select category.id, category.parent_id, array[category.id]
                from public.finance_categories as category
                where category.household_id = new.household_id
                  and category.id = new.parent_id
                union all
                select parent.id, parent.parent_id, ancestors.path || parent.id
                from ancestors
                join public.finance_categories as parent
                  on parent.household_id = new.household_id
                 and parent.id = ancestors.parent_id
                where not parent.id = any(ancestors.path)
            )
            select 1 from ancestors where id = new.id
        ) then
            raise exception 'Category hierarchy cannot contain a cycle'
                using errcode = '23514';
        end if;
    end if;

    if tg_op = 'UPDATE' then
        if new.budget_type is distinct from old.budget_type and (
            exists (select 1 from public.finance_budget_items item
                    where item.household_id = old.household_id and item.category_id = old.id)
            or exists (select 1 from public.finance_scenario_items item
                       where item.household_id = old.household_id and item.category_id = old.id)
        ) then
            raise exception 'A referenced category cannot change budget type'
                using errcode = '23514';
        end if;

        if new.parent_id is distinct from old.parent_id and exists (
            with recursive subtree(id) as (
                select old.id
                union all
                select child.id
                from public.finance_categories as child
                join subtree on child.parent_id = subtree.id
                where child.household_id = old.household_id
            )
            select 1
            from subtree
            where exists (
                select 1 from public.finance_budget_items item
                where item.household_id = old.household_id and item.category_id = subtree.id
            ) or exists (
                select 1 from public.finance_scenario_items item
                where item.household_id = old.household_id and item.category_id = subtree.id
            )
        ) then
            raise exception 'A referenced category cannot move to another parent'
                using errcode = '23514';
        end if;
    end if;

    return new;
end;
$$;

revoke all on function private.finance_validate_category() from public, anon, authenticated;

create function private.finance_validate_budget_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    selected_budget_type text;
begin
    select category.budget_type
    into selected_budget_type
    from public.finance_categories as category
    where category.household_id = new.household_id
      and category.id = new.category_id;

    if selected_budget_type is null then
        raise exception 'Budget item category must exist in the same household'
            using errcode = '23503';
    end if;

    if new.allocation_role = 'personal_allowance' and selected_budget_type <> 'saving' then
        raise exception 'Personal allowances require a saving category'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

revoke all on function private.finance_validate_budget_allocation() from public, anon, authenticated;

create function private.finance_prepare_savings_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    parent_owner uuid;
    parent_visibility text;
begin
    if tg_op = 'INSERT' then
        if new.parent_id is null then
            new.owner_user_id := new.created_by;
            if not exists (
                select 1 from public.profiles profile
                where profile.id = new.created_by
                  and profile.household_id = new.household_id
            ) then
                raise exception 'Account owner must be a member of the household'
                    using errcode = '42501';
            end if;
        else
            select account.owner_user_id, account.visibility
            into parent_owner, parent_visibility
            from public.finance_savings_accounts as account
            where account.household_id = new.household_id
              and account.id = new.parent_id;
            if not found then
                raise exception 'Parent account must exist in the same household'
                    using errcode = '23503';
            end if;
            new.owner_user_id := parent_owner;
            new.visibility := parent_visibility;
        end if;
    elsif new.owner_user_id is distinct from old.owner_user_id then
        raise exception 'Savings account ownership cannot be changed'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

revoke all on function private.finance_prepare_savings_account() from public, anon, authenticated;

create function private.finance_check_account_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_household_id uuid;
begin
    if tg_op = 'DELETE' then
        target_household_id := old.household_id;
    else
        target_household_id := new.household_id;
    end if;

    if exists (
        select 1
        from public.finance_savings_accounts child
        join public.finance_savings_accounts parent
          on parent.household_id = child.household_id
         and parent.id = child.parent_id
        where child.household_id = target_household_id
          and (child.visibility is distinct from parent.visibility
               or child.owner_user_id is distinct from parent.owner_user_id)
    ) then
        raise exception 'All accounts in a tree must share visibility and owner'
            using errcode = '23514';
    end if;

    if exists (
        with recursive walk(start_id, node_id, parent_id, path, has_cycle) as (
            select account.id, account.id, account.parent_id, array[account.id], false
            from public.finance_savings_accounts account
            where account.household_id = target_household_id
            union all
            select walk.start_id, parent.id, parent.parent_id, walk.path || parent.id,
                   parent.id = any(walk.path)
            from walk
            join public.finance_savings_accounts parent
              on parent.household_id = target_household_id
             and parent.id = walk.parent_id
            where not walk.has_cycle
        )
        select 1 from walk where has_cycle
    ) then
        raise exception 'Savings account hierarchy cannot contain a cycle'
            using errcode = '23514';
    end if;

    return null;
end;
$$;

revoke all on function private.finance_check_account_tree() from public, anon, authenticated;

create function private.finance_prepare_savings_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_owner uuid;
    account_visibility text;
    account_type text;
begin
    if new.account_id is null then
        new.owner_user_id := new.created_by;
        if not exists (
            select 1 from public.profiles profile
            where profile.id = new.created_by
              and profile.household_id = new.household_id
        ) then
            raise exception 'Savings plan owner must be a member of the household'
                using errcode = '42501';
        end if;
    else
        select account.owner_user_id, account.visibility, account.account_type
        into account_owner, account_visibility, account_type
        from public.finance_savings_accounts account
        where account.household_id = new.household_id
          and account.id = new.account_id;
        if not found then
            raise exception 'Savings plan account must exist in the same household'
                using errcode = '23503';
        end if;
        if new.plan_type <> account_type then
            raise exception 'Linked savings plan type must match its account type'
                using errcode = '23514';
        end if;
        new.owner_user_id := account_owner;
        new.visibility := account_visibility;
    end if;
    return new;
end;
$$;

revoke all on function private.finance_prepare_savings_plan() from public, anon, authenticated;

create function private.finance_check_savings_plan_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_household_id uuid;
begin
    if tg_op = 'DELETE' then
        target_household_id := old.household_id;
    else
        target_household_id := new.household_id;
    end if;

    if exists (
        select 1
        from public.finance_savings_plans plan
        left join public.finance_savings_accounts account
          on account.household_id = plan.household_id
         and account.id = plan.account_id
        where plan.household_id = target_household_id
          and (
              (plan.account_id is null and plan.owner_user_id is distinct from plan.created_by)
              or (plan.account_id is not null and (
                  account.id is null
                  or plan.visibility is distinct from account.visibility
                  or plan.owner_user_id is distinct from account.owner_user_id
                  or plan.plan_type is distinct from account.account_type
              ))
          )
    ) then
        raise exception 'Savings plan audience must match its linked account'
            using errcode = '23514';
    end if;
    return null;
end;
$$;

revoke all on function private.finance_check_savings_plan_links() from public, anon, authenticated;

create function private.finance_assert_transfer(p_household_id uuid, p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    leg_count bigint;
    distinct_accounts bigint;
    first_date date;
    last_date date;
    amount_net bigint;
    all_excluded boolean;
    all_nonzero boolean;
    scope_conflict boolean;
    header_exists boolean;
begin
    select exists (
        select 1 from public.finance_savings_transfers transfer
        where transfer.household_id = p_household_id and transfer.id = p_transfer_id
    ) into header_exists;

    select count(*), count(distinct movement.account_id),
           min(movement.transaction_date), max(movement.transaction_date),
           coalesce(min(movement.amount) + max(movement.amount), 0), coalesce(bool_and(movement.excluded_from_monthly_savings), false),
           coalesce(bool_and(movement.amount <> 0), false)
    into leg_count, distinct_accounts, first_date, last_date, amount_net, all_excluded, all_nonzero
    from public.finance_savings_transactions movement
    where movement.household_id = p_household_id
      and movement.transfer_id = p_transfer_id;

    if not header_exists then
        if leg_count <> 0 then
            raise exception 'Savings transfer legs require a transfer header'
                using errcode = '23503';
        end if;
        return;
    end if;

    if leg_count <> 2 or distinct_accounts <> 2
        or first_date is distinct from last_date
        or amount_net <> 0
        or not all_excluded
        or not all_nonzero then
        raise exception 'A savings transfer requires two distinct, equal-and-opposite excluded legs on one date'
            using errcode = '23514';
    end if;

    select exists (
        select 1
        from public.finance_savings_transactions first_leg
        join public.finance_savings_accounts first_account
          on first_account.household_id = first_leg.household_id
         and first_account.id = first_leg.account_id
        join public.finance_savings_transactions second_leg
          on second_leg.household_id = first_leg.household_id
         and second_leg.transfer_id = first_leg.transfer_id
         and second_leg.id <> first_leg.id
        join public.finance_savings_accounts second_account
          on second_account.household_id = second_leg.household_id
         and second_account.id = second_leg.account_id
        where first_leg.household_id = p_household_id
          and first_leg.transfer_id = p_transfer_id
          and (
              first_account.visibility is distinct from second_account.visibility
              or (first_account.visibility = 'private'
                  and first_account.owner_user_id is distinct from second_account.owner_user_id)
          )
    ) into scope_conflict;

    if scope_conflict then
        raise exception 'Savings transfers must stay within one visibility scope and private owner'
            using errcode = '23514';
    end if;
end;
$$;

revoke all on function private.finance_assert_transfer(uuid, uuid) from public, anon, authenticated;

create function private.finance_check_transfer_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_table_name = 'finance_savings_transfers' then
        if tg_op <> 'INSERT' then
            perform private.finance_assert_transfer(old.household_id, old.id);
        end if;
        if tg_op <> 'DELETE' then
            perform private.finance_assert_transfer(new.household_id, new.id);
        end if;
    else
        if tg_op <> 'INSERT' and old.transfer_id is not null then
            perform private.finance_assert_transfer(old.household_id, old.transfer_id);
        end if;
        if tg_op <> 'DELETE' and new.transfer_id is not null then
            perform private.finance_assert_transfer(new.household_id, new.transfer_id);
        end if;
    end if;
    return null;
end;
$$;

revoke all on function private.finance_check_transfer_pair() from public, anon, authenticated;

-- Common audit/version trigger.
create trigger finance_months_touch_row before insert or update on public.finance_months
for each row execute function private.finance_touch_row();
create trigger finance_categories_touch_row before insert or update on public.finance_categories
for each row execute function private.finance_touch_row();
create trigger finance_budget_items_touch_row before insert or update on public.finance_budget_items
for each row execute function private.finance_touch_row();
create trigger finance_scenarios_touch_row before insert or update on public.finance_scenarios
for each row execute function private.finance_touch_row();
create trigger finance_scenario_items_touch_row before insert or update on public.finance_scenario_items
for each row execute function private.finance_touch_row();
create trigger finance_savings_accounts_touch_row before insert or update on public.finance_savings_accounts
for each row execute function private.finance_touch_row();
create trigger finance_savings_transfers_touch_row before insert or update on public.finance_savings_transfers
for each row execute function private.finance_touch_row();
create trigger finance_savings_transactions_touch_row before insert or update on public.finance_savings_transactions
for each row execute function private.finance_touch_row();
create trigger finance_planned_savings_transactions_touch_row before insert or update on public.finance_planned_savings_transactions
for each row execute function private.finance_touch_row();
create trigger finance_savings_plans_touch_row before insert or update on public.finance_savings_plans
for each row execute function private.finance_touch_row();
create trigger finance_irregular_expense_plans_touch_row before insert or update on public.finance_irregular_expense_plans
for each row execute function private.finance_touch_row();
create trigger finance_projects_touch_row before insert or update on public.finance_projects
for each row execute function private.finance_touch_row();
create trigger finance_project_expenses_touch_row before insert or update on public.finance_project_expenses
for each row execute function private.finance_touch_row();

create trigger finance_categories_validate before insert or update on public.finance_categories
for each row execute function private.finance_validate_category();
create trigger finance_budget_items_validate before insert or update on public.finance_budget_items
for each row execute function private.finance_validate_budget_allocation();
create trigger finance_scenario_items_validate before insert or update on public.finance_scenario_items
for each row execute function private.finance_validate_budget_allocation();
create trigger finance_savings_accounts_prepare before insert or update on public.finance_savings_accounts
for each row execute function private.finance_prepare_savings_account();
create constraint trigger finance_savings_accounts_tree_check
after insert or update or delete on public.finance_savings_accounts
deferrable initially deferred for each row execute function private.finance_check_account_tree();
create trigger finance_savings_plans_prepare before insert or update on public.finance_savings_plans
for each row execute function private.finance_prepare_savings_plan();
create constraint trigger finance_savings_plans_link_check
after insert or update or delete on public.finance_savings_plans
deferrable initially deferred for each row execute function private.finance_check_savings_plan_links();
create constraint trigger finance_savings_accounts_plan_link_check
after update on public.finance_savings_accounts
deferrable initially deferred for each row execute function private.finance_check_savings_plan_links();
create constraint trigger finance_savings_transfers_pair_check
after insert or update or delete on public.finance_savings_transfers
deferrable initially deferred for each row execute function private.finance_check_transfer_pair();
create constraint trigger finance_savings_transactions_pair_check
after insert or update or delete on public.finance_savings_transactions
deferrable initially deferred for each row execute function private.finance_check_transfer_pair();

-- FK read/delete paths and the common household timeline.
create index finance_categories_parent_idx
    on public.finance_categories (household_id, parent_id, sort_order, id);
create index finance_months_created_by_idx
    on public.finance_months (created_by);
create index finance_categories_created_by_idx
    on public.finance_categories (created_by);
create index finance_budget_items_created_by_idx
    on public.finance_budget_items (created_by);
create index finance_scenarios_created_by_idx
    on public.finance_scenarios (created_by);
create index finance_scenario_items_created_by_idx
    on public.finance_scenario_items (created_by);
create index finance_budget_items_month_idx
    on public.finance_budget_items (household_id, month_id, sort_order, id);
create index finance_budget_items_category_idx
    on public.finance_budget_items (household_id, category_id);
create index finance_scenarios_sort_idx
    on public.finance_scenarios (household_id, sort_order, id);
create index finance_scenario_items_scenario_idx
    on public.finance_scenario_items (household_id, scenario_id, sort_order, id);
create index finance_scenario_items_category_idx
    on public.finance_scenario_items (household_id, category_id);
create index finance_savings_accounts_audience_idx
    on public.finance_savings_accounts (household_id, visibility, owner_user_id);
create index finance_savings_accounts_created_by_idx
    on public.finance_savings_accounts (created_by);
create index finance_savings_accounts_owner_idx
    on public.finance_savings_accounts (owner_user_id);
create index finance_savings_accounts_parent_idx
    on public.finance_savings_accounts (household_id, parent_id);
create index finance_savings_transfers_created_by_idx
    on public.finance_savings_transfers (created_by);
create index finance_savings_transactions_created_by_idx
    on public.finance_savings_transactions (created_by);
create index finance_savings_transactions_account_date_idx
    on public.finance_savings_transactions (household_id, account_id, transaction_date, id);
create index finance_savings_transactions_date_idx
    on public.finance_savings_transactions (household_id, transaction_date, id);
create index finance_savings_transactions_month_idx
    on public.finance_savings_transactions (household_id, budget_month_id)
    where budget_month_id is not null;
create index finance_savings_transactions_transfer_idx
    on public.finance_savings_transactions (household_id, transfer_id)
    where transfer_id is not null;
create unique index finance_savings_transactions_source_draft_unique
    on public.finance_savings_transactions (source_planned_transaction_id)
    where source_planned_transaction_id is not null;
create index finance_planned_savings_transactions_month_account_idx
    on public.finance_planned_savings_transactions (household_id, month_id, account_id);
create index finance_planned_savings_transactions_created_by_idx
    on public.finance_planned_savings_transactions (created_by);
create index finance_planned_savings_transactions_account_idx
    on public.finance_planned_savings_transactions (household_id, account_id);
create index finance_planned_savings_transactions_plan_idx
    on public.finance_planned_savings_transactions (household_id, source_savings_plan_id)
    where source_savings_plan_id is not null;
create unique index finance_planned_savings_transactions_generated_unique
    on public.finance_planned_savings_transactions (
        household_id, month_id, account_id, source_savings_plan_id
    ) where source_savings_plan_id is not null;
create index finance_savings_plans_account_idx
    on public.finance_savings_plans (household_id, account_id)
    where account_id is not null;
create index finance_savings_plans_created_by_idx
    on public.finance_savings_plans (created_by);
create index finance_savings_plans_owner_idx
    on public.finance_savings_plans (owner_user_id);
create index finance_savings_plans_audience_idx
    on public.finance_savings_plans (household_id, visibility, owner_user_id);
create index finance_irregular_expense_plans_sort_idx
    on public.finance_irregular_expense_plans (household_id, sort_order, id);
create index finance_irregular_expense_plans_created_by_idx
    on public.finance_irregular_expense_plans (created_by);
create index finance_projects_sort_idx
    on public.finance_projects (household_id, sort_order, id);
create index finance_projects_created_by_idx
    on public.finance_projects (created_by);
create index finance_project_expenses_project_date_idx
    on public.finance_project_expenses (household_id, project_id, expense_date, id);
create index finance_project_expenses_created_by_idx
    on public.finance_project_expenses (created_by);

create index finance_import_runs_household_idx
    on private.finance_import_runs (household_id, imported_by, completed_at desc);
create index finance_import_runs_imported_by_idx
    on private.finance_import_runs (imported_by);
create index finance_legacy_id_map_import_run_idx
    on private.finance_legacy_id_map (import_run_id);
create index finance_operation_receipts_actor_idx
    on private.finance_operation_receipts (actor_id);
