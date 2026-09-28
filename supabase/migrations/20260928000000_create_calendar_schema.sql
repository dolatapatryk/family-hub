-- Native one-off events. All ranges are half-open: the end is exclusive.
-- All-day dates deliberately use DATE rather than timestamps.
create table public.calendar_events (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    title text not null,
    description text,
    created_by uuid not null references auth.users (id) on delete restrict,
    visibility text not null default 'private',
    all_day boolean not null default false,
    starts_at timestamptz,
    ends_at timestamptz,
    time_zone text,
    start_date date,
    end_date date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint calendar_events_title_not_blank check (char_length(btrim(title)) > 0),
    constraint calendar_events_visibility check (visibility in ('household', 'private')),
    constraint calendar_events_range check (
        (all_day and start_date is not null and end_date is not null
            and start_date >= date '0001-01-01' and end_date <= date '9999-12-31'
            and end_date > start_date
            and starts_at is null and ends_at is null and time_zone is null)
        or
        (not all_day and starts_at is not null and ends_at is not null
            and isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at
            and time_zone is not null and char_length(btrim(time_zone)) > 0
            and start_date is null and end_date is null)
    )
);

-- A single definition generates occurrences in memory for each visible year.
create table public.annual_dates (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    title text not null,
    description text,
    created_by uuid not null references auth.users (id) on delete restrict,
    visibility text not null default 'private',
    kind text not null,
    initial_date date,
    month integer,
    day integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint annual_dates_title_not_blank check (char_length(btrim(title)) > 0),
    constraint annual_dates_visibility check (visibility in ('household', 'private')),
    constraint annual_dates_kind check (kind in ('birthday', 'anniversary', 'other')),
    constraint annual_dates_definition check (
        (kind in ('birthday', 'anniversary') and initial_date is not null
            and initial_date >= date '0001-01-01' and initial_date <= date '9999-12-31'
            and month is null and day is null)
        or
        (kind = 'other' and initial_date is null and month is not null and day is not null
            and month between 1 and 12
            and day between 1 and (array[31,29,31,30,31,30,31,31,30,31,30,31])[month])
    )
);

create index calendar_events_household_timed_range_idx
    on public.calendar_events (household_id, starts_at, ends_at) where not all_day;
create index calendar_events_household_date_range_idx
    on public.calendar_events (household_id, start_date, end_date) where all_day;
create index annual_dates_household_idx on public.annual_dates (household_id);

-- Shared content can be managed by any member. Only its creator can change
-- visibility; another member cannot turn a shared item into an inaccessible
-- private item owned by somebody else.
create function private.validate_calendar_item_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.title := pg_catalog.btrim(new.title);
    new.description := nullif(pg_catalog.btrim(new.description), '');

    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
            or new.household_id is distinct from old.household_id
            or new.created_by is distinct from old.created_by
            or new.created_at is distinct from old.created_at then
            raise exception 'Calendar item identity and ownership cannot be changed'
                using errcode = '42501';
        end if;
        if new.visibility is distinct from old.visibility
            and old.created_by is distinct from (select auth.uid()) then
            raise exception 'Only the creator can change calendar item visibility'
                using errcode = '42501';
        end if;
    end if;

    new.updated_at := pg_catalog.now();
    if tg_table_name = 'calendar_events' then
        if not new.all_day then
            new.time_zone := pg_catalog.btrim(new.time_zone);
            if not exists (
                select 1 from pg_catalog.pg_timezone_names where name = new.time_zone
            ) then
                raise exception 'Use a valid IANA time zone for timed events'
                    using errcode = '23514';
            end if;
        end if;
    end if;
    return new;
end;
$$;

revoke all on function private.validate_calendar_item_write() from public, anon, authenticated;

create trigger calendar_events_validate_write
before insert or update on public.calendar_events
for each row execute function private.validate_calendar_item_write();
create trigger annual_dates_validate_write
before insert or update on public.annual_dates
for each row execute function private.validate_calendar_item_write();

alter table public.calendar_events enable row level security;
alter table public.annual_dates enable row level security;

create policy calendar_events_select on public.calendar_events
for select to authenticated using (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
);
create policy calendar_events_insert on public.calendar_events
for insert to authenticated with check (
    (select private.is_household_member(household_id)) and created_by = (select auth.uid())
);
create policy calendar_events_update on public.calendar_events
for update to authenticated using (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
) with check (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
);
create policy calendar_events_delete on public.calendar_events
for delete to authenticated using (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
);

create policy annual_dates_select on public.annual_dates
for select to authenticated using (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
);
create policy annual_dates_insert on public.annual_dates
for insert to authenticated with check (
    (select private.is_household_member(household_id)) and created_by = (select auth.uid())
);
create policy annual_dates_update on public.annual_dates
for update to authenticated using (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
) with check (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
);
create policy annual_dates_delete on public.annual_dates
for delete to authenticated using (
    (select private.is_household_member(household_id))
    and (visibility = 'household' or created_by = (select auth.uid()))
);

revoke all on table public.calendar_events, public.annual_dates from public, anon, authenticated;
grant select (id, household_id, title, description, created_by, visibility, all_day,
    starts_at, ends_at, time_zone, start_date, end_date, created_at, updated_at)
    on public.calendar_events to authenticated;
grant insert (household_id, title, description, created_by, visibility, all_day,
    starts_at, ends_at, time_zone, start_date, end_date)
    on public.calendar_events to authenticated;
grant update (title, description, visibility, all_day, starts_at, ends_at, time_zone, start_date, end_date)
    on public.calendar_events to authenticated;
grant delete on public.calendar_events to authenticated;

grant select (id, household_id, title, description, created_by, visibility, kind,
    initial_date, month, day, created_at, updated_at)
    on public.annual_dates to authenticated;
grant insert (household_id, title, description, created_by, visibility, kind, initial_date, month, day)
    on public.annual_dates to authenticated;
grant update (title, description, visibility, kind, initial_date, month, day)
    on public.annual_dates to authenticated;
grant delete on public.annual_dates to authenticated;
