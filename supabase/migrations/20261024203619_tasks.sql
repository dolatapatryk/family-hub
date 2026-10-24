-- Household tasks and recurring rules, including atomic occurrence advancement.
-- Fresh-install schema; definitions include all prior fixes.

-- Tables

CREATE TABLE public.recurring_task_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    title text NOT NULL,
    cadence text NOT NULL,
    start_on date NOT NULL,
    assigned_to uuid,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint recurring_task_rules_cadence check (cadence in ('weekly', 'monthly')),
    constraint recurring_task_rules_start_on check (isfinite(start_on)),
    constraint recurring_task_rules_title_not_blank check (char_length(btrim(title)) > 0),
    CONSTRAINT recurring_task_rules_pkey PRIMARY KEY (id),
    CONSTRAINT recurring_task_rules_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id)
        ON DELETE SET NULL,
    CONSTRAINT recurring_task_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        RESTRICT,
    CONSTRAINT recurring_task_rules_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    title text NOT NULL,
    due_date date,
    completed boolean DEFAULT false NOT NULL,
    assigned_to uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    recurring_rule_id uuid,
    constraint tasks_title_not_blank check (char_length(btrim(title)) > 0),
    CONSTRAINT tasks_pkey PRIMARY KEY (id),
    CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
    CONSTRAINT tasks_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE
        CASCADE,
    CONSTRAINT tasks_recurring_rule_id_fkey FOREIGN KEY (recurring_rule_id) REFERENCES public.recurring_task_rules(id)
        ON DELETE SET NULL
);

-- Indexes

create index recurring_task_rules_household_active_idx
    on public.recurring_task_rules (household_id, active, start_on);

create index tasks_due_date_idx
    on public.tasks (due_date);

create index tasks_household_archived_at_idx
    on public.tasks (household_id, archived_at);

create index tasks_household_id_idx
    on public.tasks (household_id);

create unique index tasks_recurring_rule_occurrence_idx
    on public.tasks (recurring_rule_id, due_date)
    where recurring_rule_id is not null and due_date is not null;

-- Functions

CREATE FUNCTION private.next_recurring_task_due(p_cadence text, p_start_on date, p_current_due date) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.normalize_task_title() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
    new.title := pg_catalog.btrim(new.title);
    return new;
end;
$$;

CREATE FUNCTION private.validate_recurring_task_rule_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.validate_task_recurring_rule() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.validate_task_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.create_recurring_task(
    p_household_id uuid,
    p_title text,
    p_start_on date,
    p_cadence text,
    p_assigned_to uuid DEFAULT NULL::uuid
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.create_next_recurring_task_occurrence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

-- Triggers

create trigger recurring_task_rules_validate_write
before insert or update on public.recurring_task_rules
for each row execute function private.validate_recurring_task_rule_write();

create trigger tasks_advance_recurring_occurrence
after update of completed, archived_at on public.tasks
for each row
when (
    (old.completed is false and new.completed is true)
    or (old.archived_at is null and new.archived_at is not null)
)
execute function private.create_next_recurring_task_occurrence();

create trigger tasks_normalize_title
before insert or update of title
on public.tasks
for each row
execute function private.normalize_task_title();

create trigger tasks_validate_recurring_rule
before insert or update on public.tasks
for each row execute function private.validate_task_recurring_rule();

create trigger tasks_validate_write
before insert or update
on public.tasks
for each row
execute function private.validate_task_write();

-- Row-level security

ALTER TABLE public.recurring_task_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Policies

create policy recurring_task_rules_select_for_members
on public.recurring_task_rules
for select to authenticated
using ((select private.is_household_member(household_id)));

create policy recurring_task_rules_stop_for_members
on public.recurring_task_rules
for update to authenticated
using ((select private.is_household_member(household_id)) and active)
with check ((select private.is_household_member(household_id)) and not active);

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

create policy tasks_insert_for_members
on public.tasks
for insert
to authenticated
with check (
    (select private.is_household_member(household_id))
    and created_by = (select auth.uid())
);

create policy tasks_select_for_members
on public.tasks
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy tasks_update_for_members
on public.tasks
for update
to authenticated
using (
    (select private.is_household_member(household_id))
    and archived_at is null
)
with check ((select private.is_household_member(household_id)));

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON FUNCTION private.create_next_recurring_task_occurrence() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.next_recurring_task_due(text, date, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_recurring_task_rule_write() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_task_recurring_rule() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_recurring_task(uuid, text, date, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.recurring_task_rules FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.tasks FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.create_recurring_task(p_household_id uuid, p_title text, p_start_on date, p_cadence
    text, p_assigned_to uuid) TO service_role;
GRANT ALL ON FUNCTION public.create_recurring_task(p_household_id uuid, p_title text, p_start_on date, p_cadence
    text, p_assigned_to uuid) TO authenticated;
GRANT ALL ON TABLE public.recurring_task_rules TO service_role;
GRANT ALL ON TABLE public.tasks TO service_role;
GRANT DELETE ON TABLE public.tasks TO authenticated;
GRANT SELECT (id, household_id, title, cadence, start_on, assigned_to, created_by, created_at) ON TABLE public.recurring_task_rules
    TO authenticated;

GRANT SELECT (active) ON TABLE public.recurring_task_rules TO authenticated;
GRANT UPDATE (active) ON TABLE public.recurring_task_rules TO authenticated;
GRANT SELECT (
    household_id,
    title,
    due_date,
    completed,
    assigned_to,
    created_by,
    archived_at,
    id,
    created_at,
    recurring_rule_id
) ON TABLE public.tasks TO authenticated;
GRANT INSERT (household_id, title, due_date, assigned_to, created_by) ON TABLE public.tasks TO authenticated;
GRANT UPDATE (title, due_date, completed, assigned_to, archived_at) ON TABLE public.tasks TO authenticated;
