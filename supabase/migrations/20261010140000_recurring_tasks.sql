-- Recurring household responsibilities are definitions that create ordinary
-- task occurrences. The next occurrence is created atomically when the
-- current one is completed, archived, or skipped.
create table public.recurring_task_rules (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    title text not null,
    cadence text not null,
    start_on date not null,
    assigned_to uuid references public.profiles (id) on delete set null,
    active boolean not null default true,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint recurring_task_rules_title_not_blank check (char_length(btrim(title)) > 0),
    constraint recurring_task_rules_cadence check (cadence in ('weekly', 'monthly')),
    constraint recurring_task_rules_start_on check (isfinite(start_on))
);

create index recurring_task_rules_household_active_idx
    on public.recurring_task_rules (household_id, active, start_on);

alter table public.tasks
    add column recurring_rule_id uuid
        references public.recurring_task_rules (id) on delete set null;

-- A rule can have at most one occurrence on a given date, even if concurrent
-- completion or skip requests try to advance the same series at once.
create unique index tasks_recurring_rule_occurrence_idx
    on public.tasks (recurring_rule_id, due_date)
    where recurring_rule_id is not null and due_date is not null;

create function private.validate_recurring_task_rule_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.title := pg_catalog.btrim(new.title);

    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
            or new.household_id is distinct from old.household_id
            or new.title is distinct from old.title
            or new.cadence is distinct from old.cadence
            or new.start_on is distinct from old.start_on
            or (new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null)
            or new.created_by is distinct from old.created_by
            or new.created_at is distinct from old.created_at then
            raise exception 'Recurring task details cannot be changed after creation'
                using errcode = '42501';
        end if;

        if old.active is false and new.active is true then
            raise exception 'Stopped recurring tasks cannot be restarted'
                using errcode = '55000';
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

revoke all on function private.validate_recurring_task_rule_write() from public, anon, authenticated;

create trigger recurring_task_rules_validate_write
before insert or update on public.recurring_task_rules
for each row execute function private.validate_recurring_task_rule_write();

create function private.validate_task_recurring_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    rule_is_active boolean;
begin
    if tg_op = 'UPDATE'
        and new.recurring_rule_id is distinct from old.recurring_rule_id
        and new.recurring_rule_id is not null then
        raise exception 'Task recurrence cannot be reassigned'
            using errcode = '42501';
    end if;

    if new.recurring_rule_id is not null then
        select public.recurring_task_rules.active into rule_is_active
        from public.recurring_task_rules
        where public.recurring_task_rules.id = new.recurring_rule_id
          and public.recurring_task_rules.household_id = new.household_id;

        if not found then
            raise exception 'Recurring task occurrence must reference a rule in the same household'
                using errcode = '23514';
        end if;

        if rule_is_active and new.due_date is null then
            raise exception 'Active recurring task occurrences must have a due date'
                using errcode = '23514';
        end if;
    end if;

    return new;
end;
$$;

revoke all on function private.validate_task_recurring_rule() from public, anon, authenticated;

create trigger tasks_validate_recurring_rule
before insert or update on public.tasks
for each row execute function private.validate_task_recurring_rule();

create function private.next_recurring_task_due(
    p_cadence text,
    p_start_on date,
    p_current_due date
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
    next_month_start date;
    days_in_next_month integer;
begin
    if p_cadence = 'weekly' then
        return p_current_due + 7;
    end if;

    next_month_start := (
        pg_catalog.make_date(
            extract(year from p_current_due)::integer,
            extract(month from p_current_due)::integer,
            1
        ) + interval '1 month'
    )::date;
    days_in_next_month := extract(day from (next_month_start + interval '1 month' - interval '1 day'))::integer;
    return next_month_start + (least(extract(day from p_start_on)::integer, days_in_next_month) - 1);
end;
$$;

revoke all on function private.next_recurring_task_due(text, date, date) from public, anon, authenticated;

create function private.create_next_recurring_task_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    rule_row public.recurring_task_rules%rowtype;
    next_due date;
begin
    if new.recurring_rule_id is null or new.due_date is null then
        return new;
    end if;

    -- The trigger only fires for a completion, archive, or skip transition.
    -- The rule check stops future occurrences after the household stops a series.
    select * into rule_row
    from public.recurring_task_rules
    where public.recurring_task_rules.id = new.recurring_rule_id
      and public.recurring_task_rules.active;

    if not found then
        return new;
    end if;

    next_due := private.next_recurring_task_due(rule_row.cadence, rule_row.start_on, new.due_date);

    insert into public.tasks (
        household_id,
        title,
        due_date,
        assigned_to,
        created_by,
        recurring_rule_id
    )
    values (
        rule_row.household_id,
        rule_row.title,
        next_due,
        rule_row.assigned_to,
        rule_row.created_by,
        rule_row.id
    )
    on conflict (recurring_rule_id, due_date)
        where recurring_rule_id is not null and due_date is not null
        do nothing;

    return new;
end;
$$;

revoke all on function private.create_next_recurring_task_occurrence() from public, anon, authenticated;

create trigger tasks_advance_recurring_occurrence
after update of completed, archived_at on public.tasks
for each row
when (
    (old.completed is false and new.completed is true)
    or (old.archived_at is null and new.archived_at is not null)
)
execute function private.create_next_recurring_task_occurrence();

-- Create a recurring rule and its first task in one authenticated operation.
create or replace function public.create_recurring_task(
    p_household_id uuid,
    p_title text,
    p_start_on date,
    p_cadence text,
    p_assigned_to uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    normalized_title text := pg_catalog.btrim(p_title);
    new_rule_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to create a recurring task'
            using errcode = '42501';
    end if;

    if not private.is_household_member(p_household_id) then
        raise exception 'You must belong to the selected household'
            using errcode = '42501';
    end if;

    if normalized_title is null or pg_catalog.char_length(normalized_title) = 0 then
        raise exception 'Task title must not be blank'
            using errcode = '22023';
    end if;

    if p_start_on is null or not isfinite(p_start_on) then
        raise exception 'A valid first due date is required'
            using errcode = '22023';
    end if;

    if p_cadence is null or p_cadence not in ('weekly', 'monthly') then
        raise exception 'Use a weekly or monthly cadence'
            using errcode = '22023';
    end if;

    if p_assigned_to is not null and not exists (
        select 1
        from public.profiles
        where public.profiles.id = p_assigned_to
          and public.profiles.household_id = p_household_id
    ) then
        raise exception 'Task assignee must belong to the same household'
            using errcode = '23514';
    end if;

    insert into public.recurring_task_rules (
        household_id, title, cadence, start_on, assigned_to, created_by
    )
    values (
        p_household_id, normalized_title, p_cadence, p_start_on, p_assigned_to, current_user_id
    )
    returning id into new_rule_id;

    insert into public.tasks (
        household_id, title, due_date, assigned_to, created_by, recurring_rule_id
    )
    values (
        p_household_id, normalized_title, p_start_on, p_assigned_to, current_user_id, new_rule_id
    );

    return new_rule_id;
end;
$$;

revoke all on function public.create_recurring_task(uuid, text, date, text, uuid) from public, anon, authenticated;
grant execute on function public.create_recurring_task(uuid, text, date, text, uuid) to authenticated;

alter table public.recurring_task_rules enable row level security;

create policy recurring_task_rules_select_for_members
on public.recurring_task_rules
for select to authenticated
using ((select private.is_household_member(household_id)));

create policy recurring_task_rules_stop_for_members
on public.recurring_task_rules
for update to authenticated
using ((select private.is_household_member(household_id)) and active)
with check ((select private.is_household_member(household_id)) and not active);

revoke all on table public.recurring_task_rules from public, anon, authenticated;
grant select (
    id, household_id, title, cadence, start_on, assigned_to, active, created_by, created_at
) on table public.recurring_task_rules to authenticated;
grant update (active) on table public.recurring_task_rules to authenticated;
grant select (recurring_rule_id) on table public.tasks to authenticated;

-- Deleting an active recurring occurrence would strand its rule. Members skip
-- it through the archive transition instead, which advances the series.
drop policy if exists tasks_delete_for_members on public.tasks;
create policy tasks_delete_for_members
on public.tasks
for delete to authenticated
using (
    (select private.is_household_member(household_id))
    and archived_at is null
    and (
        recurring_rule_id is null
        or exists (
            select 1
            from public.recurring_task_rules
            where public.recurring_task_rules.id = tasks.recurring_rule_id
              and not public.recurring_task_rules.active
        )
    )
);
