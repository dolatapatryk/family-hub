create index finance_project_expenses_project_newest_idx
    on public.finance_project_expenses (
        household_id,
        project_id,
        expense_date desc nulls last,
        created_at desc,
        id desc
    );

create function public.finance_project_expense_summaries(p_household_id uuid)
returns table (project_id uuid, spent_minor text)
language sql
stable
security invoker
set search_path = ''
as $$
    select expenses.project_id, pg_catalog.sum(expenses.amount)::text
    from public.finance_project_expenses as expenses
    where expenses.household_id = p_household_id
    group by expenses.project_id;
$$;

revoke all privileges on function public.finance_project_expense_summaries(uuid)
    from public, anon;
grant execute on function public.finance_project_expense_summaries(uuid)
    to authenticated;
