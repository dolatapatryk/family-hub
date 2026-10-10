create function private.finance_can_access_savings_account(
    p_household_id uuid,
    p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

create function private.finance_can_read_savings_plan(
    p_household_id uuid,
    p_account_id uuid,
    p_visibility text,
    p_owner_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

create function private.finance_can_read_savings_transfer(
    p_household_id uuid,
    p_transfer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

revoke all on function private.finance_can_access_savings_account(uuid, uuid)
    from public, anon, authenticated;
revoke all on function private.finance_can_read_savings_plan(uuid, uuid, text, uuid)
    from public, anon, authenticated;
revoke all on function private.finance_can_read_savings_transfer(uuid, uuid)
    from public, anon, authenticated;
grant execute on function private.finance_can_access_savings_account(uuid, uuid) to authenticated;
grant execute on function private.finance_can_read_savings_plan(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.finance_can_read_savings_transfer(uuid, uuid) to authenticated;

-- Shared finance entities are household-readable and writable by members.
-- Inserts are attributed to the current user; the row trigger protects that
-- attribution and owns updated_at/version on later edits.
create policy finance_months_select_for_members
on public.finance_months for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_months_insert_for_members
on public.finance_months for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_months_update_for_members
on public.finance_months for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_months_delete_for_members
on public.finance_months for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_categories_select_for_members
on public.finance_categories for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_categories_insert_for_members
on public.finance_categories for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_categories_update_for_members
on public.finance_categories for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_categories_delete_for_members
on public.finance_categories for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_budget_items_select_for_members
on public.finance_budget_items for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_budget_items_insert_for_members
on public.finance_budget_items for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_budget_items_update_for_members
on public.finance_budget_items for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_budget_items_delete_for_members
on public.finance_budget_items for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_scenarios_select_for_members
on public.finance_scenarios for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_scenarios_insert_for_members
on public.finance_scenarios for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_scenarios_update_for_members
on public.finance_scenarios for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_scenarios_delete_for_members
on public.finance_scenarios for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_scenario_items_select_for_members
on public.finance_scenario_items for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_scenario_items_insert_for_members
on public.finance_scenario_items for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_scenario_items_update_for_members
on public.finance_scenario_items for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_scenario_items_delete_for_members
on public.finance_scenario_items for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_irregular_expense_plans_select_for_members
on public.finance_irregular_expense_plans for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_irregular_expense_plans_insert_for_members
on public.finance_irregular_expense_plans for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_irregular_expense_plans_update_for_members
on public.finance_irregular_expense_plans for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_irregular_expense_plans_delete_for_members
on public.finance_irregular_expense_plans for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_projects_select_for_members
on public.finance_projects for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_projects_insert_for_members
on public.finance_projects for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_projects_update_for_members
on public.finance_projects for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_projects_delete_for_members
on public.finance_projects for delete to authenticated
using ((select private.is_household_member(household_id)));

create policy finance_project_expenses_select_for_members
on public.finance_project_expenses for select to authenticated
using ((select private.is_household_member(household_id)));
create policy finance_project_expenses_insert_for_members
on public.finance_project_expenses for insert to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);
create policy finance_project_expenses_update_for_members
on public.finance_project_expenses for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
create policy finance_project_expenses_delete_for_members
on public.finance_project_expenses for delete to authenticated
using ((select private.is_household_member(household_id)));

-- Savings rows are readable only through their account's audience. Their
-- client DML grants are intentionally withheld until the atomic operations in
-- Phase 3 are installed.
create policy finance_savings_accounts_select_for_audience
on public.finance_savings_accounts for select to authenticated
using (
    (select private.finance_can_access_savings_account(household_id, id))
);

create policy finance_savings_transactions_select_for_audience
on public.finance_savings_transactions for select to authenticated
using (
    (select private.finance_can_access_savings_account(household_id, account_id))
);

create policy finance_planned_savings_transactions_select_for_audience
on public.finance_planned_savings_transactions for select to authenticated
using (
    (select private.finance_can_access_savings_account(household_id, account_id))
);

create policy finance_savings_plans_select_for_audience
on public.finance_savings_plans for select to authenticated
using (
    (select private.finance_can_read_savings_plan(
        household_id, account_id, visibility, owner_user_id
    ))
);

create policy finance_savings_transfers_select_for_audience
on public.finance_savings_transfers for select to authenticated
using (
    (select private.finance_can_read_savings_transfer(household_id, id))
);

-- Explicit grants keep identity, scope, version, and audit columns immutable
-- to browser clients. Savings mutations will be exposed only as RPCs.
revoke all on type public.finance_minor_units from public, anon;
grant usage on type public.finance_minor_units to authenticated, service_role;

revoke all on table
    public.finance_months,
    public.finance_categories,
    public.finance_budget_items,
    public.finance_scenarios,
    public.finance_scenario_items,
    public.finance_savings_accounts,
    public.finance_savings_transfers,
    public.finance_savings_transactions,
    public.finance_planned_savings_transactions,
    public.finance_savings_plans,
    public.finance_irregular_expense_plans,
    public.finance_projects,
    public.finance_project_expenses
from public, anon, authenticated;

grant select on table
    public.finance_months,
    public.finance_categories,
    public.finance_budget_items,
    public.finance_scenarios,
    public.finance_scenario_items,
    public.finance_savings_accounts,
    public.finance_savings_transfers,
    public.finance_savings_transactions,
    public.finance_planned_savings_transactions,
    public.finance_savings_plans,
    public.finance_irregular_expense_plans,
    public.finance_projects,
    public.finance_project_expenses
to authenticated;

grant insert (household_id, created_by, month_start, display_name)
    on public.finance_months to authenticated;
grant update (month_start, display_name)
    on public.finance_months to authenticated;
grant delete on public.finance_months to authenticated;

grant insert (household_id, created_by, name, budget_type, parent_id, color, sort_order)
    on public.finance_categories to authenticated;
grant update (name, parent_id, color, sort_order)
    on public.finance_categories to authenticated;
grant delete on public.finance_categories to authenticated;

grant insert (household_id, created_by, month_id, category_id, name, amount,
    allocation_role, is_planned, is_recurring, notes, sort_order)
    on public.finance_budget_items to authenticated;
grant update (month_id, category_id, name, amount, allocation_role,
    is_planned, is_recurring, notes, sort_order)
    on public.finance_budget_items to authenticated;
grant delete on public.finance_budget_items to authenticated;

grant insert (household_id, created_by, name, description, sort_order)
    on public.finance_scenarios to authenticated;
grant update (name, description, sort_order)
    on public.finance_scenarios to authenticated;
grant delete on public.finance_scenarios to authenticated;

grant insert (household_id, created_by, scenario_id, category_id, name, amount,
    allocation_role, is_planned, is_recurring, notes, sort_order)
    on public.finance_scenario_items to authenticated;
grant update (scenario_id, category_id, name, amount, allocation_role,
    is_planned, is_recurring, notes, sort_order)
    on public.finance_scenario_items to authenticated;
grant delete on public.finance_scenario_items to authenticated;

grant insert (household_id, created_by, name, annual_amount, sort_order)
    on public.finance_irregular_expense_plans to authenticated;
grant update (name, annual_amount, sort_order)
    on public.finance_irregular_expense_plans to authenticated;
grant delete on public.finance_irregular_expense_plans to authenticated;

grant insert (household_id, created_by, name, description, target_budget, is_archived, sort_order)
    on public.finance_projects to authenticated;
grant update (name, description, target_budget, is_archived, sort_order)
    on public.finance_projects to authenticated;
grant delete on public.finance_projects to authenticated;

grant insert (household_id, created_by, project_id, expense_date, name, amount, notes, sort_order)
    on public.finance_project_expenses to authenticated;
grant update (project_id, expense_date, name, amount, notes, sort_order)
    on public.finance_project_expenses to authenticated;
grant delete on public.finance_project_expenses to authenticated;

alter table public.finance_months enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_budget_items enable row level security;
alter table public.finance_scenarios enable row level security;
alter table public.finance_scenario_items enable row level security;
alter table public.finance_savings_accounts enable row level security;
alter table public.finance_savings_transfers enable row level security;
alter table public.finance_savings_transactions enable row level security;
alter table public.finance_planned_savings_transactions enable row level security;
alter table public.finance_savings_plans enable row level security;
alter table public.finance_irregular_expense_plans enable row level security;
alter table public.finance_projects enable row level security;
alter table public.finance_project_expenses enable row level security;

alter table private.finance_import_runs enable row level security;
alter table private.finance_legacy_id_map enable row level security;
alter table private.finance_operation_receipts enable row level security;
revoke all on table
    private.finance_import_runs,
    private.finance_legacy_id_map,
    private.finance_operation_receipts
from public, anon, authenticated;
