-- Let household members correct task details and remove individual active tasks.
grant update (title, due_date)
on table public.tasks
to authenticated;

drop policy if exists tasks_delete_for_members on public.tasks;

create policy tasks_delete_for_members
on public.tasks
for delete
to authenticated
using (
    (select private.is_household_member(household_id))
    and archived_at is null
);

grant delete on table public.tasks to authenticated;
