-- Any member of a household can update shared shopping items, including items
-- added by another member. The column grants still prevent changing the item
-- household or its audit owner from the browser.

drop policy if exists shopping_items_update_for_members on public.shopping_items;

create policy shopping_items_update_for_members
on public.shopping_items
for update
to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));
