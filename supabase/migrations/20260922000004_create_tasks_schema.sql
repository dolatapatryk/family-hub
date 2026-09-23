create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    title text not null,
    due_date date,
    completed boolean not null default false,
    assigned_to uuid references public.profiles (id) on delete set null,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    archived_at timestamptz,
    constraint tasks_title_not_blank check (char_length(btrim(title)) > 0)
);

-- Keep the task indexes aligned with the legacy SQLite baseline: household
-- lookup, due-date lookup, and the active/archived household lookup.
create index tasks_household_id_idx
    on public.tasks (household_id);

create index tasks_due_date_idx
    on public.tasks (due_date);

create index tasks_household_archived_at_idx
    on public.tasks (household_id, archived_at);

-- Keep the title normalized when writes come directly from the browser.
create function private.normalize_task_title()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.title := pg_catalog.btrim(new.title);
    return new;
end;
$$;

create trigger tasks_normalize_title
before insert or update of title
on public.tasks
for each row
execute function private.normalize_task_title();

-- Foreign keys prove that an assignee exists. This trigger additionally proves
-- that the assignee belongs to the task's household. The security-definer
-- context lets the check see profiles even while the caller is subject to
-- profile RLS.
create function private.validate_task_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if old.archived_at is not null then
            raise exception 'Archived tasks cannot be changed'
                using errcode = '55000';
        end if;

        if new.id is distinct from old.id
            or new.household_id is distinct from old.household_id
            or new.created_by is distinct from old.created_by
            or new.created_at is distinct from old.created_at then
            raise exception 'Task identity and ownership fields cannot be changed'
                using errcode = '42501';
        end if;
    end if;

    if new.assigned_to is not null and not exists (
        select 1
        from public.profiles
        where public.profiles.id = new.assigned_to
          and public.profiles.household_id = new.household_id
    ) then
        raise exception 'Task assignee must belong to the same household'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create trigger tasks_validate_write
before insert or update
on public.tasks
for each row
execute function private.validate_task_write();

alter table public.tasks enable row level security;

create policy tasks_select_for_members
on public.tasks
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy tasks_insert_for_members
on public.tasks
for insert
to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

-- The USING clause deliberately excludes already archived rows. Together with
-- the trigger above, this makes archiving a one-way transition and prevents
-- all browser updates to archived tasks.
create policy tasks_update_for_members
on public.tasks
for update
to authenticated
using (
    (select private.is_household_member(household_id))
    and archived_at is null
)
with check ((select private.is_household_member(household_id)));

-- Keep the browser API limited to the fields used by the Tasks adapter. The
-- identity, scope, audit, and timestamp fields cannot be changed after insert.
revoke all on table public.tasks from public, anon, authenticated;

grant select (
    id,
    household_id,
    title,
    due_date,
    completed,
    assigned_to,
    created_by,
    created_at,
    archived_at
)
on table public.tasks
to authenticated;

grant insert (household_id, title, due_date, assigned_to, created_by)
on table public.tasks
to authenticated;

grant update (completed, assigned_to, archived_at)
on table public.tasks
to authenticated;
