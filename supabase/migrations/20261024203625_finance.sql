-- Budgets, categories, savings, plans, projects, physical wallets and transactions.
-- Fresh-install schema; definitions include all prior fixes.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Money representation

CREATE DOMAIN public.finance_minor_units AS bigint
 CONSTRAINT finance_minor_units_check CHECK (((VALUE >= '-999999999999999999'::bigint) AND (VALUE <= '999999999999999999'::bigint)));

-- Tables

CREATE TABLE private.finance_operation_receipts (
    household_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    operation_name text NOT NULL,
    request_id uuid NOT NULL,
    request_sha256 text NOT NULL,
    result jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint finance_operation_receipts_hash check (request_sha256 ~ '^[0-9a-f]{64}$'),
    constraint finance_operation_receipts_operation_not_blank check (char_length(btrim(operation_name)) > 0),
    constraint finance_operation_receipts_result_object check (jsonb_typeof(result) = 'object'),
    CONSTRAINT finance_operation_receipts_request_unique UNIQUE (household_id, actor_id, operation_name, request_id),
    CONSTRAINT finance_operation_receipts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON
        DELETE RESTRICT,
    CONSTRAINT finance_operation_receipts_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.finance_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    budget_type text NOT NULL,
    parent_id uuid,
    color text,
    allocation_role text DEFAULT 'standard'::text NOT NULL,
    constraint finance_categories_allocation_role check (
        allocation_role in ('standard', 'personal_allowance')
        and (allocation_role <> 'personal_allowance' or budget_type = 'saving')
    ),
    constraint finance_categories_budget_type check (
        budget_type in ('income', 'fixed_expense', 'variable_expense', 'saving', 'investment')
    ),
    constraint finance_categories_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_categories_not_own_parent check (parent_id is null or parent_id <> id),
    CONSTRAINT finance_categories_version_check CHECK ((version > 0)),
    CONSTRAINT finance_categories_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_categories_pkey PRIMARY KEY (id),
    CONSTRAINT finance_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_categories_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_categories_parent_fk FOREIGN KEY (household_id, parent_id) REFERENCES public.finance_categories(household_id,
        id) ON DELETE RESTRICT
);

CREATE TABLE public.finance_irregular_expense_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    annual_amount public.finance_minor_units NOT NULL,
    constraint finance_irregular_expense_plans_name_not_blank check (char_length(btrim(name)) > 0),
    CONSTRAINT finance_irregular_expense_plans_version_check CHECK ((version > 0)),
    CONSTRAINT finance_irregular_expense_plans_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_irregular_expense_plans_pkey PRIMARY KEY (id),
    CONSTRAINT finance_irregular_expense_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT finance_irregular_expense_plans_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.finance_months (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    month_start date NOT NULL,
    display_name text,
    constraint finance_months_display_name_not_blank check (
        display_name is null or char_length(btrim(display_name)) > 0
    ),
    constraint finance_months_month_start_valid check (
        pg_catalog.isfinite(month_start)
        and month_start between date '0001-01-01' and date '9999-12-31'
        and extract(day from month_start) = 1
    ),
    CONSTRAINT finance_months_household_month_unique UNIQUE (household_id, month_start),
    CONSTRAINT finance_months_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_months_pkey PRIMARY KEY (id),
    CONSTRAINT finance_months_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_months_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.finance_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    description text,
    target_budget public.finance_minor_units,
    is_archived boolean DEFAULT false NOT NULL,
    constraint finance_projects_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_projects_target_positive check (target_budget is null or target_budget > 0),
    CONSTRAINT finance_projects_version_check CHECK ((version > 0)),
    CONSTRAINT finance_projects_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_projects_pkey PRIMARY KEY (id),
    CONSTRAINT finance_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_projects_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.finance_savings_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    account_type text NOT NULL,
    parent_id uuid,
    opening_balance public.finance_minor_units DEFAULT 0 NOT NULL,
    target_amount public.finance_minor_units,
    is_archived boolean DEFAULT false NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    owner_user_id uuid NOT NULL,
    constraint finance_savings_accounts_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_savings_accounts_not_own_parent check (
        parent_id is null or parent_id <> id
    ),
    constraint finance_savings_accounts_target_positive check (
        target_amount is null or target_amount > 0
    ),
    constraint finance_savings_accounts_type check (
        account_type in ('cash', 'goal', 'investment', 'retirement')
    ),
    CONSTRAINT finance_savings_accounts_version_check CHECK ((version > 0)),
    constraint finance_savings_accounts_visibility check (visibility in ('household', 'private')),
    CONSTRAINT finance_savings_accounts_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_savings_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT finance_savings_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT finance_savings_accounts_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_savings_accounts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT finance_savings_accounts_parent_fk FOREIGN KEY (household_id, parent_id) REFERENCES public.finance_savings_accounts(household_id,
        id) ON DELETE RESTRICT
);

CREATE TABLE public.finance_savings_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT finance_savings_transfers_version_check CHECK ((version > 0)),
    CONSTRAINT finance_savings_transfers_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_savings_transfers_pkey PRIMARY KEY (id),
    CONSTRAINT finance_savings_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT finance_savings_transfers_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.finance_scenarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    description text,
    constraint finance_scenarios_name_not_blank check (char_length(btrim(name)) > 0),
    CONSTRAINT finance_scenarios_version_check CHECK ((version > 0)),
    CONSTRAINT finance_scenarios_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_scenarios_pkey PRIMARY KEY (id),
    CONSTRAINT finance_scenarios_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_scenarios_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.finance_wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    wallet_type text NOT NULL,
    currency text DEFAULT 'PLN'::text NOT NULL,
    visibility text NOT NULL,
    owner_user_id uuid NOT NULL,
    opened_on date NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    color text,
    icon text,
    constraint finance_wallets_color_valid check (
        color is null or color ~ '^#[0-9A-Fa-f]{6}$'
    ),
    constraint finance_wallets_currency_pln check (currency = 'PLN'),
    constraint finance_wallets_icon_valid check (
        icon is null or icon ~ '^[a-z][a-z0-9_-]{0,39}$'
    ),
    constraint finance_wallets_name_valid check (
        char_length(btrim(name)) between 1 and 120
    ),
    constraint finance_wallets_opened_on_valid check (
        pg_catalog.isfinite(opened_on)
        and opened_on between date '0001-01-01' and date '9999-12-31'
    ),
    constraint finance_wallets_type_valid check (
        wallet_type in ('bank', 'cash', 'savings_bank')
    ),
    CONSTRAINT finance_wallets_version_check CHECK ((version > 0)),
    constraint finance_wallets_visibility_valid check (visibility in ('household', 'private')),
    CONSTRAINT finance_wallets_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_wallets_pkey PRIMARY KEY (id),
    CONSTRAINT finance_wallets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_wallets_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_wallets_owner_household_fk FOREIGN KEY (household_id, owner_user_id) REFERENCES public.profiles(household_id,
        id) ON DELETE RESTRICT,
    CONSTRAINT finance_wallets_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON
        DELETE RESTRICT
);

CREATE TABLE public.finance_budget_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    month_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    amount public.finance_minor_units NOT NULL,
    is_planned boolean DEFAULT false NOT NULL,
    is_recurring boolean DEFAULT false NOT NULL,
    notes text,
    CONSTRAINT finance_budget_items_version_check CHECK ((version > 0)),
    CONSTRAINT finance_budget_items_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_budget_items_pkey PRIMARY KEY (id),
    CONSTRAINT finance_budget_items_category_fk FOREIGN KEY (household_id, category_id) REFERENCES public.finance_categories(household_id,
        id) ON DELETE RESTRICT,
    CONSTRAINT finance_budget_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_budget_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_budget_items_month_fk FOREIGN KEY (household_id, month_id) REFERENCES public.finance_months(household_id,
        id) ON DELETE RESTRICT
);

CREATE TABLE public.finance_project_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    project_id uuid NOT NULL,
    expense_date date,
    name text NOT NULL,
    amount public.finance_minor_units NOT NULL,
    notes text,
    constraint finance_project_expenses_date_valid check (
        expense_date is null or (
            pg_catalog.isfinite(expense_date)
            and expense_date between date '0001-01-01' and date '9999-12-31'
        )
    ),
    constraint finance_project_expenses_name_not_blank check (char_length(btrim(name)) > 0),
    CONSTRAINT finance_project_expenses_version_check CHECK ((version > 0)),
    CONSTRAINT finance_project_expenses_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_project_expenses_pkey PRIMARY KEY (id),
    CONSTRAINT finance_project_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT finance_project_expenses_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_project_expenses_project_fk FOREIGN KEY (household_id, project_id) REFERENCES public.finance_projects(household_id,
        id) ON DELETE CASCADE
);

CREATE TABLE public.finance_savings_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    plan_type text NOT NULL,
    account_id uuid,
    monthly_amount public.finance_minor_units NOT NULL,
    annual_amount_override public.finance_minor_units,
    visibility text DEFAULT 'private'::text NOT NULL,
    owner_user_id uuid NOT NULL,
    constraint finance_savings_plans_name_not_blank check (char_length(btrim(name)) > 0),
    constraint finance_savings_plans_type check (
        plan_type in ('cash', 'goal', 'investment', 'retirement', 'irregular')
    ),
    CONSTRAINT finance_savings_plans_version_check CHECK ((version > 0)),
    constraint finance_savings_plans_visibility check (visibility in ('household', 'private')),
    CONSTRAINT finance_savings_plans_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_savings_plans_pkey PRIMARY KEY (id),
    CONSTRAINT finance_savings_plans_account_fk FOREIGN KEY (household_id, account_id) REFERENCES public.finance_savings_accounts(household_id,
        id) ON DELETE RESTRICT,
    CONSTRAINT finance_savings_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON
        DELETE RESTRICT,
    CONSTRAINT finance_savings_plans_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_savings_plans_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
        ON DELETE RESTRICT
);

CREATE TABLE public.finance_savings_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    account_id uuid NOT NULL,
    transaction_date date NOT NULL,
    amount public.finance_minor_units NOT NULL,
    description text,
    excluded_from_monthly_savings boolean DEFAULT false NOT NULL,
    transfer_id uuid,
    constraint finance_savings_transactions_date_valid check (
        pg_catalog.isfinite(transaction_date)
        and transaction_date between date '0001-01-01' and date '9999-12-31'
    ),
    constraint finance_savings_transactions_transfer_leg_valid check (
        transfer_id is null or (amount <> 0 and excluded_from_monthly_savings)
    ),
    CONSTRAINT finance_savings_transactions_version_check CHECK ((version > 0)),
    CONSTRAINT finance_savings_transactions_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_savings_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT finance_savings_transactions_account_fk FOREIGN KEY (household_id, account_id) REFERENCES public.finance_savings_accounts(household_id,
        id) ON DELETE RESTRICT,
    CONSTRAINT finance_savings_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT finance_savings_transactions_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_savings_transactions_transfer_fk FOREIGN KEY (household_id, transfer_id) REFERENCES
        public.finance_savings_transfers(household_id, id) ON DELETE CASCADE
);

CREATE TABLE public.finance_scenario_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    scenario_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    amount public.finance_minor_units NOT NULL,
    is_planned boolean DEFAULT false NOT NULL,
    is_recurring boolean DEFAULT false NOT NULL,
    notes text,
    CONSTRAINT finance_scenario_items_version_check CHECK ((version > 0)),
    CONSTRAINT finance_scenario_items_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_scenario_items_pkey PRIMARY KEY (id),
    CONSTRAINT finance_scenario_items_category_fk FOREIGN KEY (household_id, category_id) REFERENCES public.finance_categories(household_id,
        id) ON DELETE RESTRICT,
    CONSTRAINT finance_scenario_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON
        DELETE RESTRICT,
    CONSTRAINT finance_scenario_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_scenario_items_scenario_fk FOREIGN KEY (household_id, scenario_id) REFERENCES public.finance_scenarios(household_id,
        id) ON DELETE CASCADE
);

CREATE TABLE public.finance_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    kind text NOT NULL,
    transaction_date date NOT NULL,
    amount_minor public.finance_minor_units NOT NULL,
    source_wallet_id uuid,
    destination_wallet_id uuid,
    category_id uuid,
    description text,
    savings_effect text DEFAULT 'none'::text NOT NULL,
    constraint finance_transactions_date_valid check (
        pg_catalog.isfinite(transaction_date)
        and transaction_date between date '0001-01-01' and date '9999-12-31'
    ),
    constraint finance_transactions_description_valid check (
        description is null or char_length(description) <= 2000
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
        or (kind = 'opening' and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none')
        or (kind = 'adjustment' and amount_minor <> 0 and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none'
            and nullif(btrim(description), '') is not null)
    ),
    constraint finance_transactions_kind_valid check (
        kind in (
            'income', 'expense', 'savings_expense', 'refund', 'savings_refund',
            'transfer', 'opening', 'adjustment'
        )
    ),
    constraint finance_transactions_savings_effect_valid check (
        savings_effect in ('none', 'contribution')
        and (kind = 'transfer' or savings_effect = 'none')
    ),
    CONSTRAINT finance_transactions_version_check CHECK ((version > 0)),
    CONSTRAINT finance_transactions_id_household_unique UNIQUE (household_id, id),
    CONSTRAINT finance_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT finance_transactions_category_fk FOREIGN KEY (household_id, category_id) REFERENCES public.finance_categories(household_id,
        id) ON DELETE RESTRICT,
    CONSTRAINT finance_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT finance_transactions_destination_wallet_fk FOREIGN KEY (household_id, destination_wallet_id)
        REFERENCES public.finance_wallets(household_id, id) ON DELETE RESTRICT,
    CONSTRAINT finance_transactions_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT finance_transactions_source_wallet_fk FOREIGN KEY (household_id, source_wallet_id) REFERENCES
        public.finance_wallets(household_id, id) ON DELETE RESTRICT
);

-- Indexes

create index finance_operation_receipts_actor_idx
    on private.finance_operation_receipts (actor_id);

create index finance_budget_items_category_idx
    on public.finance_budget_items (household_id, category_id);

create index finance_budget_items_created_by_idx
    on public.finance_budget_items (created_by);

create index finance_budget_items_month_idx on public.finance_budget_items (household_id, month_id, id);

create index finance_categories_created_by_idx
    on public.finance_categories (created_by);

create index finance_categories_parent_idx on public.finance_categories (household_id, parent_id, name, id);

create index finance_irregular_expense_plans_created_by_idx
    on public.finance_irregular_expense_plans (created_by);

create index finance_irregular_expense_plans_household_name_idx on public.finance_irregular_expense_plans (household_id, name, id);

create index finance_months_created_by_idx
    on public.finance_months (created_by);

create index finance_project_expenses_created_by_idx
    on public.finance_project_expenses (created_by);

create index finance_project_expenses_project_date_idx
    on public.finance_project_expenses (household_id, project_id, expense_date, id);

create index finance_project_expenses_project_newest_idx
    on public.finance_project_expenses (
        household_id,
        project_id,
        expense_date desc nulls last,
        created_at desc,
        id desc
    );

create index finance_projects_created_by_idx
    on public.finance_projects (created_by);

create index finance_projects_household_name_idx on public.finance_projects (household_id, name, id);

create index finance_savings_accounts_audience_idx
    on public.finance_savings_accounts (household_id, visibility, owner_user_id);

create index finance_savings_accounts_created_by_idx
    on public.finance_savings_accounts (created_by);

create index finance_savings_accounts_owner_idx
    on public.finance_savings_accounts (owner_user_id);

create index finance_savings_accounts_parent_idx
    on public.finance_savings_accounts (household_id, parent_id);

create index finance_savings_plans_account_idx
    on public.finance_savings_plans (household_id, account_id)
    where account_id is not null;

create index finance_savings_plans_audience_idx
    on public.finance_savings_plans (household_id, visibility, owner_user_id);

create index finance_savings_plans_created_by_idx
    on public.finance_savings_plans (created_by);

create index finance_savings_plans_owner_idx
    on public.finance_savings_plans (owner_user_id);

create index finance_savings_transactions_account_date_idx
    on public.finance_savings_transactions (household_id, account_id, transaction_date, id);

create index finance_savings_transactions_created_by_idx
    on public.finance_savings_transactions (created_by);

create index finance_savings_transactions_date_idx
    on public.finance_savings_transactions (household_id, transaction_date, id);

create index finance_savings_transactions_transfer_idx
    on public.finance_savings_transactions (household_id, transfer_id)
    where transfer_id is not null;

create index finance_savings_transfers_created_by_idx
    on public.finance_savings_transfers (created_by);

create index finance_scenario_items_category_idx
    on public.finance_scenario_items (household_id, category_id);

create index finance_scenario_items_created_by_idx
    on public.finance_scenario_items (created_by);

create index finance_scenario_items_scenario_idx on public.finance_scenario_items (household_id, scenario_id, id);

create index finance_scenarios_created_by_idx
    on public.finance_scenarios (created_by);

create index finance_scenarios_household_name_idx on public.finance_scenarios (household_id, name, id);

create index finance_transactions_category_date_idx
    on public.finance_transactions (household_id, category_id, transaction_date);

create index finance_transactions_created_by_idx
    on public.finance_transactions (created_by);

create index finance_transactions_destination_date_idx
    on public.finance_transactions (household_id, destination_wallet_id, transaction_date, id);

create index finance_transactions_household_date_id_idx
    on public.finance_transactions (household_id, transaction_date desc, id desc);

create unique index finance_transactions_one_opening_per_wallet
    on public.finance_transactions (household_id, destination_wallet_id)
    where kind = 'opening';

create index finance_transactions_source_date_idx
    on public.finance_transactions (household_id, source_wallet_id, transaction_date, id);

create index finance_wallets_created_by_idx
    on public.finance_wallets (created_by);

create index finance_wallets_household_owner_idx
    on public.finance_wallets (household_id, owner_user_id);

create index finance_wallets_household_visibility_owner_idx
    on public.finance_wallets (household_id, visibility, owner_user_id);

create index finance_wallets_owner_user_id_idx
    on public.finance_wallets (owner_user_id);

-- Views

CREATE VIEW public.finance_wallet_movements WITH (security_invoker='true') AS
 SELECT transaction.household_id,
    transaction.source_wallet_id AS wallet_id,
    transaction.id AS transaction_id,
    transaction.transaction_date,
    transaction.kind,
    ((- (transaction.amount_minor)::numeric))::text AS movement_minor
   FROM public.finance_transactions transaction
  WHERE ((transaction.source_wallet_id IS NOT NULL) AND (transaction.kind = ANY (ARRAY['expense'::text, 'savings_expense'::text,
      'transfer'::text])))
UNION ALL
 SELECT transaction.household_id,
    transaction.destination_wallet_id AS wallet_id,
    transaction.id AS transaction_id,
    transaction.transaction_date,
    transaction.kind,
    ((transaction.amount_minor)::numeric)::text AS movement_minor
   FROM public.finance_transactions transaction
  WHERE ((transaction.destination_wallet_id IS NOT NULL) AND (transaction.kind = ANY (ARRAY['income'::text,
      'refund'::text, 'savings_refund'::text, 'transfer'::text, 'opening'::text, 'adjustment'::text])));

-- Functions

CREATE FUNCTION private.finance_assert_transfer(p_household_id uuid, p_transfer_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_can_access_savings_account(p_household_id uuid, p_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    select private.is_household_member(p_household_id)
       and exists (
            select 1
            from public.finance_savings_accounts account
            where account.household_id = p_household_id
              and account.id = p_account_id
              and (account.visibility = 'household'
                   or account.owner_user_id = (select auth.uid()))
       );
$$;

CREATE FUNCTION private.finance_can_access_wallet(p_household_id uuid, p_wallet_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_can_read_savings_plan(
    p_household_id uuid,
    p_account_id uuid,
    p_visibility text,
    p_owner_user_id uuid
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    select private.is_household_member(p_household_id)
       and case
            when p_account_id is null then
                (p_visibility = 'household' or p_owner_user_id = (select auth.uid()))
            else exists (
                select 1
                from public.finance_savings_accounts account
                where account.household_id = p_household_id
                  and account.id = p_account_id
                  and account.visibility = p_visibility
                  and account.owner_user_id = p_owner_user_id
                  and (account.visibility = 'household'
                       or account.owner_user_id = (select auth.uid()))
            )
       end;
$$;

CREATE FUNCTION private.finance_check_account_tree() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_check_savings_plan_links() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_lock_household(p_household_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('family-hub.finance:' || p_household_id::text, 0)
    );
end;
$$;

CREATE FUNCTION private.finance_prepare_savings_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_prepare_savings_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_touch_month() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
    if tg_op = 'INSERT' then
        new.updated_at := pg_catalog.now();
        return new;
    end if;
    if new.id is distinct from old.id
        or new.household_id is distinct from old.household_id
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at then
        raise exception 'Finance row identity and ownership cannot be changed' using errcode = '42501';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

CREATE FUNCTION private.finance_touch_row() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_touch_transaction_wallets() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_validate_category() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_validate_category_transactions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_validate_wallet_adjustment_date() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_project_expense_summaries(
    p_household_id uuid
) RETURNS TABLE(project_id uuid, spent_minor text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
    select expenses.project_id, pg_catalog.sum(expenses.amount)::text
    from public.finance_project_expenses as expenses
    where expenses.household_id = p_household_id
    group by expenses.project_id;
$$;

CREATE FUNCTION private.finance_can_read_savings_transfer(p_household_id uuid, p_transfer_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    select private.is_household_member(p_household_id)
       and (
            select count(*) = 2
               and coalesce(bool_and(private.finance_can_access_savings_account(
                    movement.household_id, movement.account_id
               )), false)
            from public.finance_savings_transactions movement
            where movement.household_id = p_household_id
              and movement.transfer_id = p_transfer_id
       );
$$;

CREATE FUNCTION private.finance_can_read_transaction(
    p_household_id uuid,
    p_source_wallet_id uuid,
    p_destination_wallet_id uuid
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    select (p_source_wallet_id is not null or p_destination_wallet_id is not null)
       and private.is_household_member(p_household_id)
       and (p_source_wallet_id is null
            or private.finance_can_access_wallet(p_household_id, p_source_wallet_id))
       and (p_destination_wallet_id is null
            or private.finance_can_access_wallet(p_household_id, p_destination_wallet_id));
$$;

CREATE FUNCTION private.finance_check_transfer_pair() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.finance_lock_household_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
    if tg_op = 'DELETE' then
        perform private.finance_lock_household(old.household_id);
        return old;
    end if;

    perform private.finance_lock_household(new.household_id);
    return new;
end;
$$;

CREATE FUNCTION private.finance_wallet_matches_scope(
    p_household_id uuid,
    p_wallet_id uuid,
    p_scope text
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_correct_wallet_balance(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_snapshot_token text,
    p_effective_date date,
    p_observed_balance_minor bigint,
    p_reason text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $_$
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
$_$;

CREATE FUNCTION public.finance_correct_wallet_opening(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_snapshot_token text,
    p_opened_on date,
    p_opening_balance_minor bigint
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $_$
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
$_$;

CREATE FUNCTION public.finance_create_month(
    p_household_id uuid,
    p_request_id uuid,
    p_month_start date,
    p_source_kind text,
    p_source_month_id uuid,
    p_scenario_id uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    v_actor_id uuid := (select auth.uid());
    v_request jsonb;
    v_request_sha256 text;
    v_saved_sha256 text;
    v_saved_result jsonb;
    v_month public.finance_months%rowtype;
    v_inserted boolean := false;
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
    if p_month_start is null
        or not pg_catalog.isfinite(p_month_start)
        or extract(day from p_month_start) <> 1 then
        raise exception 'Month start must be the first day of a valid month' using errcode = '22007';
    end if;
    if p_source_kind is null
        or (p_source_kind = 'empty' and (p_source_month_id is not null or p_scenario_id is not null))
        or (p_source_kind = 'recurring' and (p_source_month_id is null or p_scenario_id is not null))
        or (p_source_kind = 'scenario' and (p_source_month_id is not null or p_scenario_id is null))
        or p_source_kind not in ('empty', 'recurring', 'scenario') then
        raise exception 'Invalid finance month source' using errcode = '22023';
    end if;

    perform private.finance_lock_household(p_household_id);

    v_request := pg_catalog.jsonb_build_object(
        'month_start', p_month_start,
        'source_kind', p_source_kind,
        'source_month_id', p_source_month_id,
        'scenario_id', p_scenario_id
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
      and receipt.operation_name = 'finance_create_month'
      and receipt.request_id = p_request_id
    for update;

    if found then
        if v_saved_sha256 <> v_request_sha256 then
            raise exception 'Finance request ID was already used with different input'
                using errcode = 'P0001';
        end if;
        return v_saved_result;
    end if;

    select target_month.*
    into v_month
    from public.finance_months as target_month
    where target_month.household_id = p_household_id
      and target_month.month_start = p_month_start;

    if found then
        v_saved_result := pg_catalog.to_jsonb(v_month);
        insert into private.finance_operation_receipts (
            household_id, actor_id, operation_name, request_id, request_sha256, result
        ) values (
            p_household_id, v_actor_id, 'finance_create_month', p_request_id,
            v_request_sha256, v_saved_result
        );
        return v_saved_result;
    end if;

    if p_source_kind = 'recurring' and not exists (
        select 1 from public.finance_months as source_month
        where source_month.household_id = p_household_id
          and source_month.id = p_source_month_id
    ) then
        raise exception 'Source month is unavailable' using errcode = 'P0002';
    end if;
    if p_source_kind = 'scenario' and not exists (
        select 1 from public.finance_scenarios as source_scenario
        where source_scenario.household_id = p_household_id
          and source_scenario.id = p_scenario_id
    ) then
        raise exception 'Source scenario is unavailable' using errcode = 'P0002';
    end if;

    insert into public.finance_months (household_id, created_by, month_start)
    values (p_household_id, v_actor_id, p_month_start)
    on conflict (household_id, month_start) do nothing
    returning * into v_month;

    v_inserted := found;
    if not v_inserted then
        select target_month.*
        into v_month
        from public.finance_months as target_month
        where target_month.household_id = p_household_id
          and target_month.month_start = p_month_start;
    end if;

    if v_inserted and p_source_kind = 'recurring' then
        insert into public.finance_budget_items (
            household_id, created_by, month_id, category_id, name, amount,
            is_planned, is_recurring, notes
        )
        select p_household_id, v_actor_id, v_month.id, item.category_id, item.name, item.amount,
               false, item.is_recurring, item.notes
        from public.finance_budget_items as item
        where item.household_id = p_household_id
          and item.month_id = p_source_month_id
          and item.is_recurring;
    elsif v_inserted and p_source_kind = 'scenario' then
        insert into public.finance_budget_items (
            household_id, created_by, month_id, category_id, name, amount,
            is_planned, is_recurring, notes
        )
        select p_household_id, v_actor_id, v_month.id, item.category_id, item.name, item.amount,
               false, item.is_recurring, item.notes
        from public.finance_scenario_items as item
        where item.household_id = p_household_id
          and item.scenario_id = p_scenario_id;
    end if;

    v_saved_result := pg_catalog.to_jsonb(v_month);
    insert into private.finance_operation_receipts (
        household_id, actor_id, operation_name, request_id, request_sha256, result
    ) values (
        p_household_id, v_actor_id, 'finance_create_month', p_request_id,
        v_request_sha256, v_saved_result
    );

    return v_saved_result;
end;
$$;

CREATE FUNCTION public.finance_delete_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
    p_expected_version bigint
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_mutate_savings_plan(
    p_household_id uuid,
    p_request_id uuid,
    p_plan_id uuid,
    p_expected_version bigint,
    p_delete boolean,
    p_details jsonb
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
        end if;
        if p_plan_id is null then
            insert into public.finance_savings_plans (household_id, created_by, name, plan_type, account_id,
                monthly_amount, annual_amount_override, visibility)
            values (p_household_id, v_actor, v_name, v_type, v_account_id, v_monthly, v_annual,
                v_visibility) returning id, version into v_id, v_version;
        else
            update public.finance_savings_plans set name = v_name, plan_type = v_type, account_id = v_account_id,
                monthly_amount = v_monthly, annual_amount_override = v_annual, visibility = v_visibility
            where household_id = p_household_id and id = p_plan_id returning id, version into v_id, v_version;
        end if;
        v_result := pg_catalog.jsonb_build_object('plan_id', v_id, 'version', v_version, 'deleted', false);
    end if;
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_mutate_savings_plan', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;

CREATE FUNCTION public.finance_mutate_shared_record(
    p_household_id uuid,
    p_request_id uuid,
    p_entity text,
    p_id uuid,
    p_expected_version bigint,
    p_delete boolean,
    p_details jsonb
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    v_actor uuid := (select auth.uid());
    v_hash text;
    v_saved_hash text;
    v_result jsonb;
    v_current bigint;
    v_id uuid;
    v_version bigint;
    v_name text := pg_catalog.btrim(p_details->>'name');
    v_amount public.finance_minor_units := (p_details->>'amount_minor')::bigint;
    v_target public.finance_minor_units := (p_details->>'target_budget_minor')::bigint;
    v_project_id uuid := (p_details->>'project_id')::uuid;
    v_date date := (p_details->>'expense_date')::date;
begin
    if v_actor is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_entity is null or p_entity not in ('reserve', 'project', 'expense')
        or p_delete is null or (p_id is null and (p_delete or p_expected_version is not null))
        or (p_id is not null and (p_expected_version is null or p_expected_version < 1)) then
        raise exception 'Invalid shared finance mutation request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'entity', p_entity, 'id', p_id, 'version', p_expected_version, 'delete', p_delete, 'details', p_details)::text, 'UTF8'), 'sha256'), 'hex');
    select r.request_sha256, r.result into v_saved_hash, v_result from private.finance_operation_receipts r
    where r.household_id = p_household_id and r.actor_id = v_actor
      and r.operation_name = 'finance_mutate_shared_record' and r.request_id = p_request_id;
    if found then
        if v_hash <> v_saved_hash then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        return v_result;
    end if;
    if p_id is not null then
        if p_entity = 'reserve' then
            select version into v_current from public.finance_irregular_expense_plans where household_id = p_household_id and id = p_id for update;
        elsif p_entity = 'project' then
            select version into v_current from public.finance_projects where household_id = p_household_id and id = p_id for update;
        else
            select version into v_current from public.finance_project_expenses where household_id = p_household_id and id = p_id for update;
        end if;
        if v_current is null then
            raise exception 'Shared finance record access denied' using errcode = '42501';
        end if;
        if v_current <> p_expected_version then
            return pg_catalog.jsonb_build_object('conflict', true, 'current_version', v_current);
        end if;
    end if;
    if p_delete then
        if p_entity = 'reserve' then
            delete from public.finance_irregular_expense_plans where household_id = p_household_id and id = p_id;
        elsif p_entity = 'project' then
            if exists (select 1 from public.finance_project_expenses where household_id = p_household_id and project_id = p_id) then
                raise exception 'Archive projects with expenses instead of deleting their history' using errcode = '22023';
            end if;
            delete from public.finance_projects where household_id = p_household_id and id = p_id;
        else
            if exists (select 1 from public.finance_project_expenses e
                join public.finance_projects p on p.household_id = e.household_id and p.id = e.project_id
                where e.household_id = p_household_id and e.id = p_id and p.is_archived) then
                raise exception 'Restore the project before deleting its expenses' using errcode = '22023';
            end if;
            delete from public.finance_project_expenses where household_id = p_household_id and id = p_id;
        end if;
        v_result := pg_catalog.jsonb_build_object('id', p_id, 'deleted', true);
    else
        if v_name is null or pg_catalog.char_length(v_name) = 0 or pg_catalog.char_length(v_name) > 160
            or pg_catalog.char_length(p_details->>'description') > 2000
            or pg_catalog.char_length(p_details->>'notes') > 2000 then
            raise exception 'Invalid shared finance details' using errcode = '22023';
        end if;
        if p_entity = 'reserve' then
            if v_amount is null or v_amount < 0 then
                raise exception 'Annual reserve must be nonnegative' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_irregular_expense_plans (household_id, created_by, name, annual_amount)
                values (p_household_id, v_actor, v_name, v_amount) returning id, version into v_id, v_version;
            else
                update public.finance_irregular_expense_plans set name = v_name, annual_amount = v_amount
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        elsif p_entity = 'project' then
            if v_target is not null and v_target <= 0 then
                raise exception 'Project target must be positive' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_projects (household_id, created_by, name, description, target_budget, is_archived)
                values (p_household_id, v_actor, v_name, nullif(pg_catalog.btrim(p_details->>'description'), ''), v_target,
                    coalesce((p_details->>'is_archived')::boolean, false)) returning id, version into v_id, v_version;
            else
                update public.finance_projects set name = v_name, description = nullif(pg_catalog.btrim(p_details->>'description'), ''),
                    target_budget = v_target, is_archived = coalesce((p_details->>'is_archived')::boolean, false)
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        else
            if v_amount is null or v_project_id is null then
                raise exception 'An expense requires an amount and a project' using errcode = '22023';
            end if;
            if not exists (select 1 from public.finance_projects where household_id = p_household_id and id = v_project_id and not is_archived) then
                raise exception 'Restore the project before adding or editing its expenses' using errcode = '22023';
            end if;
            if p_id is not null and exists (select 1 from public.finance_project_expenses e
                join public.finance_projects p on p.household_id = e.household_id and p.id = e.project_id
                where e.household_id = p_household_id and e.id = p_id and (p.is_archived or e.project_id <> v_project_id)) then
                raise exception 'Expenses cannot move projects or be edited in archived projects' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_project_expenses (household_id, created_by, project_id, expense_date, name, amount, notes)
                values (p_household_id, v_actor, v_project_id, v_date, v_name, v_amount, nullif(pg_catalog.btrim(p_details->>'notes'), '')) returning id, version into v_id, v_version;
            else
                update public.finance_project_expenses set expense_date = v_date, name = v_name, amount = v_amount,
                    notes = nullif(pg_catalog.btrim(p_details->>'notes'), '')
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        end if;
        v_result := pg_catalog.jsonb_build_object('id', v_id, 'version', v_version, 'deleted', false);
    end if;
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_mutate_shared_record', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;

CREATE FUNCTION public.finance_preview_account_lifecycle(p_household_id uuid, p_account_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_preview_wallet_balance(
    p_household_id uuid,
    p_wallet_id uuid,
    p_effective_date date
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $$
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

CREATE FUNCTION public.finance_preview_wallet_opening_correction(
    p_household_id uuid,
    p_wallet_id uuid
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_save_account(
    p_household_id uuid,
    p_request_id uuid,
    p_account_id uuid,
    p_expected_version bigint,
    p_name text,
    p_account_type text,
    p_parent_id uuid,
    p_opening_balance_minor bigint,
    p_target_amount_minor bigint,
    p_visibility text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
        or p_target_amount_minor is not null and p_target_amount_minor <= 0 then
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
        'visibility', p_visibility
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
            opening_balance, target_amount, visibility
        ) values (
            p_household_id, v_actor_id, pg_catalog.btrim(p_name), p_account_type,
            p_parent_id, p_opening_balance_minor, p_target_amount_minor,
            p_visibility
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
            target_amount = p_target_amount_minor
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

CREATE FUNCTION public.finance_save_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
    p_expected_version bigint,
    p_account_id uuid,
    p_transaction_date date,
    p_amount_minor bigint,
    p_description text,
    p_excluded_from_monthly_savings boolean
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
            description, excluded_from_monthly_savings
        ) values (
            p_household_id, v_actor_id, p_account_id, p_transaction_date,
            p_amount_minor, nullif(pg_catalog.btrim(p_description), ''),
            p_excluded_from_monthly_savings
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

CREATE FUNCTION public.finance_save_wallet(
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
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $_$
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
$_$;

CREATE FUNCTION public.finance_set_wallet_archived(
    p_household_id uuid,
    p_request_id uuid,
    p_wallet_id uuid,
    p_expected_version bigint,
    p_is_archived boolean
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $$
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

CREATE FUNCTION public.finance_transfer_savings(
    p_household_id uuid,
    p_request_id uuid,
    p_from_account_id uuid,
    p_from_expected_version bigint,
    p_to_account_id uuid,
    p_to_expected_version bigint,
    p_amount_minor bigint,
    p_transaction_date date,
    p_description text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_apply_account_lifecycle(
    p_household_id uuid,
    p_request_id uuid,
    p_account_id uuid,
    p_expected_version bigint,
    p_snapshot_token text,
    p_action text,
    p_display_balance_minor bigint DEFAULT NULL::bigint,
    p_visibility text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_delete_transfer(
    p_household_id uuid,
    p_request_id uuid,
    p_transfer_id uuid,
    p_expected_version bigint
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_delete_wallet_transaction(
    p_household_id uuid,
    p_request_id uuid,
    p_transaction_id uuid,
    p_expected_version bigint
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_list_transactions_multi(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_ids uuid[],
    p_category_ids uuid[],
    p_kinds text[],
    p_search text,
    p_cursor_date date,
    p_cursor_id uuid,
    p_page_size integer DEFAULT 50
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_list_wallets(
    p_household_id uuid,
    p_scope text,
    p_as_of_date date
) RETURNS TABLE(id uuid, household_id uuid, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone, version bigint, name text, wallet_type text, currency text, visibility text, owner_user_id uuid, opened_on date, is_archived boolean, color text, icon text, as_of_date date, balance_minor text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $$
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

CREATE FUNCTION public.finance_save_wallet_transaction(
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
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET "TimeZone" TO 'Europe/Warsaw'
    AS $$
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

CREATE FUNCTION public.finance_transaction_month_summary_multi(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_ids uuid[] DEFAULT NULL::uuid[],
    p_category_ids uuid[] DEFAULT NULL::uuid[],
    p_kinds text[] DEFAULT NULL::text[]
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.finance_list_transactions(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_id uuid,
    p_category_id uuid,
    p_kinds text[],
    p_search text,
    p_cursor_date date,
    p_cursor_id uuid,
    p_page_size integer DEFAULT 50
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
    return public.finance_list_transactions_multi(
        p_household_id, p_month_start, p_scope,
        case when p_wallet_id is null then null else array[p_wallet_id] end,
        case when p_category_id is null then null else array[p_category_id] end,
        p_kinds, p_search, p_cursor_date, p_cursor_id, p_page_size
    );
end;
$$;

CREATE FUNCTION public.finance_transaction_month_summary(
    p_household_id uuid,
    p_month_start date,
    p_scope text,
    p_wallet_id uuid DEFAULT NULL::uuid,
    p_category_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
    return public.finance_transaction_month_summary_multi(
        p_household_id, p_month_start, p_scope,
        case when p_wallet_id is null then null else array[p_wallet_id] end,
        case when p_category_id is null then null else array[p_category_id] end,
        null
    );
end;
$$;

-- Triggers

create trigger finance_budget_items_touch_row before insert or update on public.finance_budget_items
for each row execute function private.finance_touch_row();

create trigger finance_categories_touch_row before insert or update on public.finance_categories
for each row execute function private.finance_touch_row();

create trigger finance_categories_validate before insert or update on public.finance_categories
for each row execute function private.finance_validate_category();

create trigger finance_categories_validate_transactions
before update of budget_type, allocation_role on public.finance_categories
for each row execute function private.finance_validate_category_transactions();

create trigger finance_household_write_lock before insert or update or delete on public.finance_budget_items
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_categories
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_irregular_expense_plans
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_months
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_project_expenses
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_projects
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_accounts
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_plans
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_transactions
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_savings_transfers
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_scenario_items
for each row execute function private.finance_lock_household_write();

create trigger finance_household_write_lock before insert or update or delete on public.finance_scenarios
for each row execute function private.finance_lock_household_write();

create trigger finance_irregular_expense_plans_touch_row before insert or update on public.finance_irregular_expense_plans
for each row execute function private.finance_touch_row();

create trigger finance_months_touch_updated_at before insert or update on public.finance_months
for each row execute function private.finance_touch_month();

create trigger finance_project_expenses_touch_row before insert or update on public.finance_project_expenses
for each row execute function private.finance_touch_row();

create trigger finance_projects_touch_row before insert or update on public.finance_projects
for each row execute function private.finance_touch_row();

create constraint trigger finance_savings_accounts_plan_link_check
after update on public.finance_savings_accounts
deferrable initially deferred for each row execute function private.finance_check_savings_plan_links();

create trigger finance_savings_accounts_prepare before insert or update on public.finance_savings_accounts
for each row execute function private.finance_prepare_savings_account();

create trigger finance_savings_accounts_touch_row before insert or update on public.finance_savings_accounts
for each row execute function private.finance_touch_row();

create constraint trigger finance_savings_accounts_tree_check
after insert or update or delete on public.finance_savings_accounts
deferrable initially deferred for each row execute function private.finance_check_account_tree();

create constraint trigger finance_savings_plans_link_check
after insert or update or delete on public.finance_savings_plans
deferrable initially deferred for each row execute function private.finance_check_savings_plan_links();

create trigger finance_savings_plans_prepare before insert or update on public.finance_savings_plans
for each row execute function private.finance_prepare_savings_plan();

create trigger finance_savings_plans_touch_row before insert or update on public.finance_savings_plans
for each row execute function private.finance_touch_row();

create constraint trigger finance_savings_transactions_pair_check
after insert or update or delete on public.finance_savings_transactions
deferrable initially deferred for each row execute function private.finance_check_transfer_pair();

create trigger finance_savings_transactions_touch_row before insert or update on public.finance_savings_transactions
for each row execute function private.finance_touch_row();

create constraint trigger finance_savings_transfers_pair_check
after insert or update or delete on public.finance_savings_transfers
deferrable initially deferred for each row execute function private.finance_check_transfer_pair();

create trigger finance_savings_transfers_touch_row before insert or update on public.finance_savings_transfers
for each row execute function private.finance_touch_row();

create trigger finance_scenario_items_touch_row before insert or update on public.finance_scenario_items
for each row execute function private.finance_touch_row();

create trigger finance_scenarios_touch_row before insert or update on public.finance_scenarios
for each row execute function private.finance_touch_row();

create trigger finance_transactions_household_write_lock
before insert or update or delete on public.finance_transactions
for each row execute function private.finance_lock_household_write();

create trigger finance_transactions_touch_row
before insert or update on public.finance_transactions
for each row execute function private.finance_touch_row();

create trigger finance_transactions_touch_wallets
after insert or update or delete on public.finance_transactions
for each row execute function private.finance_touch_transaction_wallets();

create trigger finance_transactions_validate_wallet_adjustment_date
before insert or update of kind, transaction_date, destination_wallet_id
on public.finance_transactions
for each row execute function private.finance_validate_wallet_adjustment_date();

create trigger finance_wallets_household_write_lock
before insert or update or delete on public.finance_wallets
for each row execute function private.finance_lock_household_write();

create trigger finance_wallets_touch_row
before insert or update on public.finance_wallets
for each row execute function private.finance_touch_row();

-- Row-level security

ALTER TABLE private.finance_operation_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_budget_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_irregular_expense_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_months ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_project_expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_savings_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_savings_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_savings_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_savings_transfers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_scenario_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_scenarios ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_wallets ENABLE ROW LEVEL SECURITY;

-- Policies

create policy finance_budget_items_delete_for_members
on public.finance_budget_items for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_budget_items_insert_for_members
on public.finance_budget_items for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_budget_items_select_for_members
on public.finance_budget_items for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_budget_items_update_for_members
on public.finance_budget_items for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_categories_delete_for_members
on public.finance_categories for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_categories_insert_for_members
on public.finance_categories for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_categories_select_for_members
on public.finance_categories for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_categories_update_for_members
on public.finance_categories for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_irregular_expense_plans_delete_for_members
on public.finance_irregular_expense_plans for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_irregular_expense_plans_insert_for_members
on public.finance_irregular_expense_plans for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_irregular_expense_plans_select_for_members
on public.finance_irregular_expense_plans for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_irregular_expense_plans_update_for_members
on public.finance_irregular_expense_plans for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_months_delete_for_members
on public.finance_months for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_months_insert_for_members
on public.finance_months for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_months_select_for_members
on public.finance_months for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_months_update_for_members
on public.finance_months for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_project_expenses_delete_for_members
on public.finance_project_expenses for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_project_expenses_insert_for_members
on public.finance_project_expenses for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_project_expenses_select_for_members
on public.finance_project_expenses for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_project_expenses_update_for_members
on public.finance_project_expenses for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_projects_delete_for_members
on public.finance_projects for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_projects_insert_for_members
on public.finance_projects for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_projects_select_for_members
on public.finance_projects for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_projects_update_for_members
on public.finance_projects for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_savings_accounts_select_for_audience
on public.finance_savings_accounts for select to authenticated
using (
    (select private.finance_can_access_savings_account(household_id, id))
);

create policy finance_savings_plans_select_for_audience
on public.finance_savings_plans for select to authenticated
using (
    (select private.finance_can_read_savings_plan(
        household_id, account_id, visibility, owner_user_id
    ))
);

create policy finance_savings_transactions_select_for_audience
on public.finance_savings_transactions for select to authenticated
using (
    (select private.finance_can_access_savings_account(household_id, account_id))
);

create policy finance_savings_transfers_select_for_audience
on public.finance_savings_transfers for select to authenticated
using (
    (select private.finance_can_read_savings_transfer(household_id, id))
);

create policy finance_scenario_items_delete_for_members
on public.finance_scenario_items for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_scenario_items_insert_for_members
on public.finance_scenario_items for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_scenario_items_select_for_members
on public.finance_scenario_items for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_scenario_items_update_for_members
on public.finance_scenario_items for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_scenarios_delete_for_members
on public.finance_scenarios for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_scenarios_insert_for_members
on public.finance_scenarios for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy finance_scenarios_select_for_members
on public.finance_scenarios for select to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_scenarios_update_for_members
on public.finance_scenarios for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

create policy finance_transactions_select_for_endpoints
on public.finance_transactions for select to authenticated
using ((select private.finance_can_read_transaction(
    household_id, source_wallet_id, destination_wallet_id
)));

create policy finance_wallets_select_for_audience
on public.finance_wallets for select to authenticated
using ((select private.finance_can_access_wallet(household_id, id)));

-- Documentation

COMMENT ON DOMAIN public.finance_minor_units IS 'Signed integer minor units; PLN 100.23 is stored as 10023. Bounded to +/-999999999999999999.';

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON FUNCTION private.finance_assert_transfer(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_can_access_savings_account(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_can_access_wallet(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_can_read_savings_plan(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_can_read_savings_transfer(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_can_read_transaction(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_check_account_tree() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_check_savings_plan_links() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_check_transfer_pair() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_lock_household(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_lock_household_write() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_prepare_savings_account() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_prepare_savings_plan() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_touch_month() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_touch_row() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_touch_transaction_wallets() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_validate_category() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_validate_category_transactions() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_validate_wallet_adjustment_date() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.finance_wallet_matches_scope(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_apply_account_lifecycle(uuid, uuid, uuid, bigint, text, text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_correct_wallet_balance(uuid, uuid, uuid, bigint, text, date, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_correct_wallet_opening(uuid, uuid, uuid, bigint, text, date, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_create_month(uuid, uuid, date, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_delete_transaction(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_delete_transfer(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_delete_wallet_transaction(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_list_transactions(uuid, date, text, uuid, uuid, text[], text, date, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_list_transactions_multi(uuid, date, text, uuid[], uuid[], text[], text, date, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_list_wallets(uuid, text, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_mutate_savings_plan(uuid, uuid, uuid, bigint, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_mutate_shared_record(uuid, uuid, text, uuid, bigint, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_preview_account_lifecycle(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_preview_wallet_balance(uuid, uuid, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_preview_wallet_opening_correction(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_project_expense_summaries(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_save_account(uuid, uuid, uuid, bigint, text, text, uuid, bigint, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_save_transaction(uuid, uuid, uuid, bigint, uuid, date, bigint, text, boolean) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_save_wallet(uuid, uuid, uuid, bigint, text, text, text, date, bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_save_wallet_transaction(uuid, uuid, uuid, bigint, text, date, bigint, uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_set_wallet_archived(uuid, uuid, uuid, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_transaction_month_summary(uuid, date, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_transaction_month_summary_multi(uuid, date, text, uuid[], uuid[], text[]) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finance_transfer_savings(uuid, uuid, uuid, bigint, uuid, bigint, bigint, date, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE private.finance_operation_receipts FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_budget_items FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_categories FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_irregular_expense_plans FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_months FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_project_expenses FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_projects FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_savings_accounts FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_savings_plans FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_savings_transactions FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_savings_transfers FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_scenario_items FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_scenarios FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_transactions FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_wallet_movements FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.finance_wallets FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TYPE public.finance_minor_units FROM PUBLIC;
GRANT ALL ON TYPE public.finance_minor_units TO authenticated;
GRANT ALL ON TYPE public.finance_minor_units TO service_role;
GRANT ALL ON FUNCTION private.finance_can_access_savings_account(p_household_id uuid, p_account_id uuid) TO
    authenticated;
GRANT ALL ON FUNCTION private.finance_can_access_wallet(p_household_id uuid, p_wallet_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.finance_can_read_savings_plan(p_household_id uuid, p_account_id uuid, p_visibility
    text, p_owner_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.finance_can_read_savings_transfer(p_household_id uuid, p_transfer_id uuid) TO
    authenticated;
GRANT ALL ON FUNCTION private.finance_can_read_transaction(p_household_id uuid, p_source_wallet_id uuid, p_destination_wallet_id
    uuid) TO authenticated;
GRANT ALL ON FUNCTION private.finance_wallet_matches_scope(p_household_id uuid, p_wallet_id uuid, p_scope text)
    TO authenticated;
GRANT ALL ON FUNCTION public.finance_apply_account_lifecycle(p_household_id uuid, p_request_id uuid, p_account_id
    uuid, p_expected_version bigint, p_snapshot_token text, p_action text, p_display_balance_minor bigint,
    p_visibility text) TO authenticated;
GRANT ALL ON FUNCTION public.finance_apply_account_lifecycle(p_household_id uuid, p_request_id uuid, p_account_id
    uuid, p_expected_version bigint, p_snapshot_token text, p_action text, p_display_balance_minor bigint,
    p_visibility text) TO service_role;
GRANT ALL ON FUNCTION public.finance_correct_wallet_balance(p_household_id uuid, p_request_id uuid, p_wallet_id
    uuid, p_expected_version bigint, p_snapshot_token text, p_effective_date date, p_observed_balance_minor
    bigint, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.finance_correct_wallet_balance(p_household_id uuid, p_request_id uuid, p_wallet_id
    uuid, p_expected_version bigint, p_snapshot_token text, p_effective_date date, p_observed_balance_minor
    bigint, p_reason text) TO service_role;
GRANT ALL ON FUNCTION public.finance_correct_wallet_opening(p_household_id uuid, p_request_id uuid, p_wallet_id
    uuid, p_expected_version bigint, p_snapshot_token text, p_opened_on date, p_opening_balance_minor bigint)
    TO authenticated;
GRANT ALL ON FUNCTION public.finance_correct_wallet_opening(p_household_id uuid, p_request_id uuid, p_wallet_id
    uuid, p_expected_version bigint, p_snapshot_token text, p_opened_on date, p_opening_balance_minor bigint)
    TO service_role;
GRANT ALL ON FUNCTION public.finance_create_month(p_household_id uuid, p_request_id uuid, p_month_start date,
    p_source_kind text, p_source_month_id uuid, p_scenario_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.finance_create_month(p_household_id uuid, p_request_id uuid, p_month_start date,
    p_source_kind text, p_source_month_id uuid, p_scenario_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.finance_delete_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint) TO authenticated;
GRANT ALL ON FUNCTION public.finance_delete_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint) TO service_role;
GRANT ALL ON FUNCTION public.finance_delete_transfer(p_household_id uuid, p_request_id uuid, p_transfer_id
    uuid, p_expected_version bigint) TO authenticated;
GRANT ALL ON FUNCTION public.finance_delete_transfer(p_household_id uuid, p_request_id uuid, p_transfer_id
    uuid, p_expected_version bigint) TO service_role;
GRANT ALL ON FUNCTION public.finance_delete_wallet_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint) TO authenticated;
GRANT ALL ON FUNCTION public.finance_delete_wallet_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint) TO service_role;
GRANT ALL ON FUNCTION public.finance_list_transactions(p_household_id uuid, p_month_start date, p_scope text,
    p_wallet_id uuid, p_category_id uuid, p_kinds text[], p_search text, p_cursor_date date, p_cursor_id uuid,
    p_page_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.finance_list_transactions(p_household_id uuid, p_month_start date, p_scope text,
    p_wallet_id uuid, p_category_id uuid, p_kinds text[], p_search text, p_cursor_date date, p_cursor_id uuid,
    p_page_size integer) TO service_role;
GRANT ALL ON FUNCTION public.finance_list_transactions_multi(p_household_id uuid, p_month_start date, p_scope
    text, p_wallet_ids uuid[], p_category_ids uuid[], p_kinds text[], p_search text, p_cursor_date date, p_cursor_id
    uuid, p_page_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.finance_list_transactions_multi(p_household_id uuid, p_month_start date, p_scope
    text, p_wallet_ids uuid[], p_category_ids uuid[], p_kinds text[], p_search text, p_cursor_date date, p_cursor_id
    uuid, p_page_size integer) TO service_role;
GRANT ALL ON FUNCTION public.finance_list_wallets(p_household_id uuid, p_scope text, p_as_of_date date) TO
    authenticated;
GRANT ALL ON FUNCTION public.finance_list_wallets(p_household_id uuid, p_scope text, p_as_of_date date) TO
    service_role;
GRANT ALL ON FUNCTION public.finance_mutate_savings_plan(p_household_id uuid, p_request_id uuid, p_plan_id
    uuid, p_expected_version bigint, p_delete boolean, p_details jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.finance_mutate_savings_plan(p_household_id uuid, p_request_id uuid, p_plan_id
    uuid, p_expected_version bigint, p_delete boolean, p_details jsonb) TO service_role;
GRANT ALL ON FUNCTION public.finance_mutate_shared_record(p_household_id uuid, p_request_id uuid, p_entity
    text, p_id uuid, p_expected_version bigint, p_delete boolean, p_details jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.finance_mutate_shared_record(p_household_id uuid, p_request_id uuid, p_entity
    text, p_id uuid, p_expected_version bigint, p_delete boolean, p_details jsonb) TO service_role;
GRANT ALL ON FUNCTION public.finance_preview_account_lifecycle(p_household_id uuid, p_account_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.finance_preview_account_lifecycle(p_household_id uuid, p_account_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.finance_preview_wallet_balance(p_household_id uuid, p_wallet_id uuid, p_effective_date
    date) TO authenticated;
GRANT ALL ON FUNCTION public.finance_preview_wallet_balance(p_household_id uuid, p_wallet_id uuid, p_effective_date
    date) TO service_role;
GRANT ALL ON FUNCTION public.finance_preview_wallet_opening_correction(p_household_id uuid, p_wallet_id uuid)
    TO authenticated;
GRANT ALL ON FUNCTION public.finance_preview_wallet_opening_correction(p_household_id uuid, p_wallet_id uuid)
    TO service_role;
GRANT ALL ON FUNCTION public.finance_project_expense_summaries(p_household_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.finance_project_expense_summaries(p_household_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.finance_save_account(p_household_id uuid, p_request_id uuid, p_account_id uuid,
    p_expected_version bigint, p_name text, p_account_type text, p_parent_id uuid, p_opening_balance_minor
    bigint, p_target_amount_minor bigint, p_visibility text) TO authenticated;
GRANT ALL ON FUNCTION public.finance_save_account(p_household_id uuid, p_request_id uuid, p_account_id uuid,
    p_expected_version bigint, p_name text, p_account_type text, p_parent_id uuid, p_opening_balance_minor
    bigint, p_target_amount_minor bigint, p_visibility text) TO service_role;
GRANT ALL ON FUNCTION public.finance_save_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint, p_account_id uuid, p_transaction_date date, p_amount_minor bigint, p_description
    text, p_excluded_from_monthly_savings boolean) TO authenticated;
GRANT ALL ON FUNCTION public.finance_save_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint, p_account_id uuid, p_transaction_date date, p_amount_minor bigint, p_description
    text, p_excluded_from_monthly_savings boolean) TO service_role;
GRANT ALL ON FUNCTION public.finance_save_wallet(p_household_id uuid, p_request_id uuid, p_wallet_id uuid,
    p_expected_version bigint, p_name text, p_wallet_type text, p_visibility text, p_opened_on date, p_opening_balance_minor
    bigint, p_color text, p_icon text) TO authenticated;
GRANT ALL ON FUNCTION public.finance_save_wallet(p_household_id uuid, p_request_id uuid, p_wallet_id uuid,
    p_expected_version bigint, p_name text, p_wallet_type text, p_visibility text, p_opened_on date, p_opening_balance_minor
    bigint, p_color text, p_icon text) TO service_role;
GRANT ALL ON FUNCTION public.finance_save_wallet_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint, p_kind text, p_transaction_date date, p_amount_minor bigint, p_source_wallet_id
    uuid, p_destination_wallet_id uuid, p_category_id uuid, p_description text, p_savings_effect text) TO authenticated;
GRANT ALL ON FUNCTION public.finance_save_wallet_transaction(p_household_id uuid, p_request_id uuid, p_transaction_id
    uuid, p_expected_version bigint, p_kind text, p_transaction_date date, p_amount_minor bigint, p_source_wallet_id
    uuid, p_destination_wallet_id uuid, p_category_id uuid, p_description text, p_savings_effect text) TO service_role;
GRANT ALL ON FUNCTION public.finance_set_wallet_archived(p_household_id uuid, p_request_id uuid, p_wallet_id
    uuid, p_expected_version bigint, p_is_archived boolean) TO authenticated;
GRANT ALL ON FUNCTION public.finance_set_wallet_archived(p_household_id uuid, p_request_id uuid, p_wallet_id
    uuid, p_expected_version bigint, p_is_archived boolean) TO service_role;
GRANT ALL ON FUNCTION public.finance_transaction_month_summary(p_household_id uuid, p_month_start date, p_scope
    text, p_wallet_id uuid, p_category_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.finance_transaction_month_summary(p_household_id uuid, p_month_start date, p_scope
    text, p_wallet_id uuid, p_category_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.finance_transaction_month_summary_multi(p_household_id uuid, p_month_start date,
    p_scope text, p_wallet_ids uuid[], p_category_ids uuid[], p_kinds text[]) TO authenticated;
GRANT ALL ON FUNCTION public.finance_transaction_month_summary_multi(p_household_id uuid, p_month_start date,
    p_scope text, p_wallet_ids uuid[], p_category_ids uuid[], p_kinds text[]) TO service_role;
GRANT ALL ON FUNCTION public.finance_transfer_savings(p_household_id uuid, p_request_id uuid, p_from_account_id
    uuid, p_from_expected_version bigint, p_to_account_id uuid, p_to_expected_version bigint, p_amount_minor
    bigint, p_transaction_date date, p_description text) TO authenticated;
GRANT ALL ON FUNCTION public.finance_transfer_savings(p_household_id uuid, p_request_id uuid, p_from_account_id
    uuid, p_from_expected_version bigint, p_to_account_id uuid, p_to_expected_version bigint, p_amount_minor
    bigint, p_transaction_date date, p_description text) TO service_role;
GRANT ALL ON TABLE public.finance_budget_items TO service_role;
GRANT SELECT,DELETE ON TABLE public.finance_budget_items TO authenticated;
GRANT ALL ON TABLE public.finance_categories TO service_role;
GRANT SELECT,DELETE ON TABLE public.finance_categories TO authenticated;
GRANT ALL ON TABLE public.finance_irregular_expense_plans TO service_role;
GRANT SELECT ON TABLE public.finance_irregular_expense_plans TO authenticated;
GRANT ALL ON TABLE public.finance_months TO service_role;
GRANT SELECT,DELETE ON TABLE public.finance_months TO authenticated;
GRANT ALL ON TABLE public.finance_project_expenses TO service_role;
GRANT SELECT ON TABLE public.finance_project_expenses TO authenticated;
GRANT ALL ON TABLE public.finance_projects TO service_role;
GRANT SELECT ON TABLE public.finance_projects TO authenticated;
GRANT ALL ON TABLE public.finance_savings_accounts TO service_role;
GRANT SELECT ON TABLE public.finance_savings_accounts TO authenticated;
GRANT ALL ON TABLE public.finance_savings_plans TO service_role;
GRANT SELECT ON TABLE public.finance_savings_plans TO authenticated;
GRANT ALL ON TABLE public.finance_savings_transactions TO service_role;
GRANT SELECT ON TABLE public.finance_savings_transactions TO authenticated;
GRANT ALL ON TABLE public.finance_savings_transfers TO service_role;
GRANT SELECT ON TABLE public.finance_savings_transfers TO authenticated;
GRANT ALL ON TABLE public.finance_scenario_items TO service_role;
GRANT SELECT,DELETE ON TABLE public.finance_scenario_items TO authenticated;
GRANT ALL ON TABLE public.finance_scenarios TO service_role;
GRANT SELECT,DELETE ON TABLE public.finance_scenarios TO authenticated;
GRANT ALL ON TABLE public.finance_transactions TO service_role;
GRANT SELECT ON TABLE public.finance_transactions TO authenticated;
GRANT ALL ON TABLE public.finance_wallet_movements TO service_role;
GRANT SELECT ON TABLE public.finance_wallet_movements TO authenticated;
GRANT ALL ON TABLE public.finance_wallets TO service_role;
GRANT SELECT ON TABLE public.finance_wallets TO authenticated;
GRANT INSERT (household_id, created_by, budget_type, allocation_role) ON TABLE public.finance_categories TO
    authenticated;

GRANT INSERT (
    month_id,
    category_id,
    name,
    amount,
    is_planned,
    is_recurring,
    notes,
    household_id,
    created_by
) ON TABLE public.finance_budget_items TO authenticated;
GRANT UPDATE (
    month_id,
    category_id,
    name,
    amount,
    is_planned,
    is_recurring,
    notes
) ON TABLE public.finance_budget_items TO authenticated;
GRANT INSERT (name, parent_id, color) ON TABLE public.finance_categories TO authenticated;
GRANT UPDATE (name, parent_id, color) ON TABLE public.finance_categories TO authenticated;
GRANT INSERT (
    month_start,
    display_name,
    household_id,
    created_by
) ON TABLE public.finance_months TO authenticated;
GRANT UPDATE (month_start, display_name) ON TABLE public.finance_months TO authenticated;
GRANT INSERT (
    scenario_id,
    category_id,
    name,
    amount,
    is_planned,
    is_recurring,
    notes,
    household_id,
    created_by
) ON TABLE public.finance_scenario_items TO authenticated;
GRANT UPDATE (
    scenario_id,
    category_id,
    name,
    amount,
    is_planned,
    is_recurring,
    notes
) ON TABLE public.finance_scenario_items TO authenticated;
GRANT INSERT (name, description, household_id, created_by) ON TABLE public.finance_scenarios TO authenticated;
GRANT UPDATE (name, description) ON TABLE public.finance_scenarios TO authenticated;

NOTIFY pgrst, 'reload schema';
