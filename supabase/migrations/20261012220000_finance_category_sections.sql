-- Categories now determine all six budget sections. The item name is an
-- optional description; category labels are resolved when displaying a line.
alter table public.finance_categories
    add column allocation_role text not null default 'standard',
    add constraint finance_categories_allocation_role check (
        allocation_role in ('standard', 'personal_allowance')
        and (allocation_role <> 'personal_allowance' or budget_type = 'saving')
    );

alter table public.finance_budget_items
    drop constraint finance_budget_items_name_not_blank,
    alter column name set default '';
alter table public.finance_scenario_items
    drop constraint finance_scenario_items_name_not_blank,
    alter column name set default '';

-- Remove only descriptions that repeat the category label. Distinct historic
-- descriptions, amounts, flags, notes and item identities remain unchanged.
update public.finance_budget_items item
set name = ''
from public.finance_categories category
where category.household_id = item.household_id and category.id = item.category_id
  and lower(btrim(item.name)) = lower(btrim(category.name));
update public.finance_scenario_items item
set name = ''
from public.finance_categories category
where category.household_id = item.household_id and category.id = item.category_id
  and lower(btrim(item.name)) = lower(btrim(category.name));

-- Older saving categories could serve both personal allowances and savings.
-- Keep their existing sections and totals: reclassify exclusively personal
-- categories and split mixed categories without removing the original.
do $$
declare
    category record;
    personal_category_id uuid;
begin
    for category in
        select c.*, exists (
            select 1 from public.finance_budget_items i
            where i.household_id = c.household_id and i.category_id = c.id and i.allocation_role = 'standard'
            union all
            select 1 from public.finance_scenario_items i
            where i.household_id = c.household_id and i.category_id = c.id and i.allocation_role = 'standard'
        ) as has_standard_items
        from public.finance_categories c
        where c.budget_type = 'saving' and exists (
            select 1 from public.finance_budget_items i
            where i.household_id = c.household_id and i.category_id = c.id and i.allocation_role = 'personal_allowance'
            union all
            select 1 from public.finance_scenario_items i
            where i.household_id = c.household_id and i.category_id = c.id and i.allocation_role = 'personal_allowance'
        )
    loop
        if not category.has_standard_items then
            update public.finance_categories set allocation_role = 'personal_allowance' where id = category.id;
        else
            insert into public.finance_categories (household_id, created_by, name, budget_type, allocation_role, color, sort_order)
            values (category.household_id, category.created_by, category.name, 'saving', 'personal_allowance', category.color, category.sort_order)
            returning id into personal_category_id;

            update public.finance_budget_items set category_id = personal_category_id
            where household_id = category.household_id and category_id = category.id and allocation_role = 'personal_allowance';
            update public.finance_scenario_items set category_id = personal_category_id
            where household_id = category.household_id and category_id = category.id and allocation_role = 'personal_allowance';
        end if;
    end loop;
end;
$$;

create or replace function private.finance_validate_budget_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    category_role text;
begin
    select category.allocation_role into category_role
    from public.finance_categories category
    where category.household_id = new.household_id and category.id = new.category_id;

    if category_role is null then
        raise exception 'Budget item category must exist in the same household' using errcode = '23503';
    end if;
    if new.allocation_role is distinct from category_role then
        raise exception 'Budget item section must match its category' using errcode = '23514';
    end if;
    return new;
end;
$$;

-- Classification is fixed at creation. Existing narrow update grants allow
-- renaming a category without changing historical sections or calculations.
grant insert (allocation_role) on public.finance_categories to authenticated;

notify pgrst, 'reload schema';
