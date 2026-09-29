-- Google Calendar is an optional, read-only source. OAuth credentials and
-- calendar/sync metadata stay in the unexposed private schema. The public table
-- is only a normalized read mirror for Calendar and Today.

create table private.google_connections (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    owner_user_id uuid not null references public.profiles (id) on delete cascade,
    encrypted_refresh_token bytea,
    token_key_version text,
    granted_scopes text[] not null default '{}',
    connection_status text not null default 'pending',
    pending_oauth_state_hash bytea,
    pending_oauth_state_expires_at timestamptz,
    connected_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint google_connections_status check (
        connection_status in ('pending', 'connected', 'reconnect_required', 'disabled')
    ),
    constraint google_connections_owner_unique unique (owner_user_id),
    constraint google_connections_id_household_unique unique (id, household_id),
    constraint google_connections_token_pair check (
        (encrypted_refresh_token is null and token_key_version is null)
        or (encrypted_refresh_token is not null and token_key_version is not null
            and char_length(btrim(token_key_version)) > 0)
    ),
    constraint google_connections_connected_has_token check (
        connection_status <> 'connected' or encrypted_refresh_token is not null
    ),
    constraint google_connections_oauth_state_pair check (
        (pending_oauth_state_hash is null and pending_oauth_state_expires_at is null)
        or (pending_oauth_state_hash is not null
            and octet_length(pending_oauth_state_hash) = 32
            and pending_oauth_state_expires_at is not null)
    ),
    constraint google_connections_disabled_has_no_pending_state check (
        connection_status <> 'disabled'
        or (pending_oauth_state_hash is null and pending_oauth_state_expires_at is null)
    ),
    constraint google_connections_scopes_no_null check (
        array_position(granted_scopes, null::text) is null
    )
);

create index google_connections_household_idx
    on private.google_connections (household_id);

create table private.google_calendars (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null,
    household_id uuid not null,
    google_calendar_id text not null,
    display_name text,
    time_zone text,
    is_selected boolean not null default false,
    sharing_mode text not null default 'private',
    calendar_access_status text not null default 'available',
    sync_token text,
    request_config jsonb not null default '{"singleEvents":false,"showDeleted":true}'::jsonb,
    sync_generation bigint not null default 0,
    sync_status text not null default 'idle',
    sync_run_id uuid,
    sync_run_kind text,
    sync_page_token text,
    initial_sync_time_min timestamptz,
    sync_started_at timestamptz,
    sync_lease_expires_at timestamptz,
    last_successful_sync_at timestamptz,
    last_error_code text,
    last_error_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint google_calendars_connection_fk
        foreign key (connection_id, household_id)
        references private.google_connections (id, household_id) on delete cascade,
    constraint google_calendars_source_unique
        unique (connection_id, google_calendar_id),
    constraint google_calendars_source_household_unique
        unique (connection_id, google_calendar_id, household_id),
    constraint google_calendars_google_id_not_blank check (
        char_length(btrim(google_calendar_id)) > 0
    ),
    constraint google_calendars_display_name_not_blank check (
        display_name is null or char_length(btrim(display_name)) > 0
    ),
    constraint google_calendars_sharing_mode check (
        sharing_mode in ('private', 'household')
    ),
    constraint google_calendars_access_status check (
        calendar_access_status in ('available', 'lost')
    ),
    constraint google_calendars_unselected_private check (
        is_selected or sharing_mode = 'private'
    ),
    constraint google_calendars_request_config check (
        request_config = '{"singleEvents":false,"showDeleted":true}'::jsonb
    ),
    constraint google_calendars_generation_nonnegative check (sync_generation >= 0),
    constraint google_calendars_sync_status check (
        sync_status in ('idle', 'running', 'failed')
    ),
    constraint google_calendars_sync_run_kind check (
        sync_run_kind is null or sync_run_kind in ('initial', 'incremental', 'rebuild')
    ),
    constraint google_calendars_sync_run_shape check (
        (sync_status = 'idle'
            and sync_run_id is null and sync_run_kind is null
            and sync_page_token is null and initial_sync_time_min is null
            and sync_started_at is null and sync_lease_expires_at is null)
        or (sync_status = 'running'
            and sync_run_id is not null and sync_run_kind is not null
            and sync_started_at is not null and sync_lease_expires_at is not null)
        or (sync_status = 'failed'
            and sync_run_id is not null and sync_run_kind is not null
            and sync_started_at is not null and sync_lease_expires_at is null)
    ),
    constraint google_calendars_initial_cutoff_shape check (
        (sync_run_kind in ('initial', 'rebuild') and initial_sync_time_min is not null)
        or (sync_run_kind = 'incremental' and initial_sync_time_min is null)
        or sync_run_kind is null
    )
);

create index google_calendars_connection_selected_idx
    on private.google_calendars (connection_id, is_selected);
create index google_calendars_household_idx
    on private.google_calendars (household_id);

create table public.imported_calendar_events (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    connection_id uuid not null,
    google_calendar_id text not null,
    google_event_id text not null,
    title text not null,
    description text,
    location text,
    html_link text,
    all_day boolean not null,
    starts_at timestamptz,
    ends_at timestamptz,
    time_zone text,
    start_date date,
    end_date date,
    google_updated_at timestamptz,
    imported_at timestamptz not null default now(),
    synced_at timestamptz not null default now(),
    constraint imported_calendar_events_source_fk
        foreign key (connection_id, google_calendar_id, household_id)
        references private.google_calendars (connection_id, google_calendar_id, household_id)
        on delete cascade,
    constraint imported_calendar_events_source_unique
        unique (connection_id, google_calendar_id, google_event_id),
    constraint imported_calendar_events_google_ids_not_blank check (
        char_length(btrim(google_calendar_id)) > 0
        and char_length(btrim(google_event_id)) > 0
    ),
    constraint imported_calendar_events_title_not_blank check (
        char_length(btrim(title)) > 0
    ),
    constraint imported_calendar_events_schedule check (
        (all_day and start_date is not null and end_date is not null
            and start_date >= date '0001-01-01' and end_date <= date '9999-12-31'
            and end_date > start_date
            and starts_at is null and ends_at is null and time_zone is null)
        or
        (not all_day and starts_at is not null and ends_at is not null
            and isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at
            and time_zone is not null and char_length(btrim(time_zone)) > 0
            and start_date is null and end_date is null)
    ),
    constraint imported_calendar_events_google_link check (
        html_link is null or html_link ~ '^https://(calendar|www)[.]google[.]com/'
    )
);

create index imported_calendar_events_household_timed_range_idx
    on public.imported_calendar_events (household_id, starts_at, ends_at)
    where not all_day;
create index imported_calendar_events_household_date_range_idx
    on public.imported_calendar_events (household_id, start_date, end_date)
    where all_day;
create index imported_calendar_events_connection_source_idx
    on public.imported_calendar_events (connection_id, google_calendar_id);

-- Connection identity is derived from the signed-in member's current profile.
-- Private tables have no browser grants; this constraint also protects writes
-- made by future server-side management functions.
create function private.validate_google_connection_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
            or new.household_id is distinct from old.household_id
            or new.owner_user_id is distinct from old.owner_user_id
            or new.created_at is distinct from old.created_at then
            raise exception 'Google connection identity and ownership cannot be changed'
                using errcode = '42501';
        end if;
        if old.connection_status = 'disabled'
            and new.connection_status is distinct from 'disabled' then
            raise exception 'A disabled Google connection cannot be re-enabled'
                using errcode = '55000';
        end if;
    end if;

    if not exists (
        select 1 from public.profiles profile
        where profile.id = new.owner_user_id
          and profile.household_id = new.household_id
    ) then
        raise exception 'Google connection owner must belong to its household'
            using errcode = '23514';
    end if;

    if new.connection_status = 'disabled' then
        new.pending_oauth_state_hash := null;
        new.pending_oauth_state_expires_at := null;
    end if;
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

revoke all on function private.validate_google_connection_write() from public, anon, authenticated;

create trigger google_connections_validate_write
before insert or update on private.google_connections
for each row execute function private.validate_google_connection_write();

-- Selecting or deselecting a calendar starts a new source generation. A
-- deselection also resets its sync cursor and sharing choice so a later
-- reselection begins as a private initial import.
create function private.validate_google_calendar_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
            or new.connection_id is distinct from old.connection_id
            or new.household_id is distinct from old.household_id
            or new.google_calendar_id is distinct from old.google_calendar_id
            or new.created_at is distinct from old.created_at then
            raise exception 'Google calendar identity cannot be changed'
                using errcode = '42501';
        end if;

        if new.is_selected is distinct from old.is_selected
            or new.calendar_access_status is distinct from old.calendar_access_status then
            new.sync_generation := old.sync_generation + 1;
            new.sync_token := null;
            new.sync_status := 'idle';
            new.sync_run_id := null;
            new.sync_run_kind := null;
            new.sync_page_token := null;
            new.initial_sync_time_min := null;
            new.sync_started_at := null;
            new.sync_lease_expires_at := null;
            new.last_error_code := null;
            new.last_error_at := null;
            if not new.is_selected then
                new.sharing_mode := 'private';
            end if;
        end if;
        if new.is_selected is distinct from old.is_selected then
            new.last_successful_sync_at := null;
        end if;
    end if;

    if new.is_selected and (
        (tg_op = 'INSERT')
        or (tg_op = 'UPDATE' and not old.is_selected)
    ) and not exists (
        select 1
        from private.google_connections connection
        where connection.id = new.connection_id
          and connection.household_id = new.household_id
          and connection.connection_status = 'connected'
          and new.calendar_access_status = 'available'
    ) then
        raise exception 'A Google calendar can be selected only while its connection and access are available'
            using errcode = '23514';
    end if;

    if not exists (
        select 1
        from private.google_connections connection
        where connection.id = new.connection_id
          and connection.household_id = new.household_id
    ) then
        raise exception 'Google calendar must belong to a household connection'
            using errcode = '23514';
    end if;

    if new.time_zone is not null and not exists (
        select 1 from pg_catalog.pg_timezone_names zone
        where zone.name = new.time_zone
    ) then
        raise exception 'Google calendar time zone must be a valid IANA time zone'
            using errcode = '23514';
    end if;

    new.google_calendar_id := pg_catalog.btrim(new.google_calendar_id);
    new.display_name := nullif(pg_catalog.btrim(new.display_name), '');
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

revoke all on function private.validate_google_calendar_write() from public, anon, authenticated;

create trigger google_calendars_validate_write
before insert or update on private.google_calendars
for each row execute function private.validate_google_calendar_write();

create function private.purge_unavailable_google_calendar_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if (old.is_selected and not new.is_selected)
        or (old.calendar_access_status is distinct from 'lost'
            and new.calendar_access_status = 'lost') then
        delete from public.imported_calendar_events event
        where event.connection_id = new.connection_id
          and event.google_calendar_id = new.google_calendar_id;
    end if;
    return null;
end;
$$;

revoke all on function private.purge_unavailable_google_calendar_events() from public, anon, authenticated;

create trigger google_calendars_purge_unavailable_events
after update of is_selected, calendar_access_status on private.google_calendars
for each row execute function private.purge_unavailable_google_calendar_events();

create function private.invalidate_unavailable_google_connection_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.connection_status is distinct from new.connection_status
        and new.connection_status in ('reconnect_required', 'disabled') then
        update private.google_calendars calendar
        set is_selected = case when new.connection_status = 'disabled' then false
            else calendar.is_selected end,
            calendar_access_status = case when new.connection_status = 'disabled' then 'lost'
            else calendar.calendar_access_status end,
            sync_generation = case when new.connection_status = 'reconnect_required'
                then calendar.sync_generation + 1 else calendar.sync_generation end,
            sync_token = case when new.connection_status = 'disabled' then null
                else calendar.sync_token end,
            sync_status = 'idle',
            sync_run_id = null,
            sync_run_kind = null,
            sync_page_token = null,
            initial_sync_time_min = null,
            sync_started_at = null,
            sync_lease_expires_at = null,
            last_error_code = case when new.connection_status = 'reconnect_required'
                then 'reconnect_required' else null end,
            last_error_at = case when new.connection_status = 'reconnect_required'
                then pg_catalog.now() else null end
        where calendar.connection_id = new.id;
    end if;
    return null;
end;
$$;

revoke all on function private.invalidate_unavailable_google_connection_runs() from public, anon, authenticated;

create trigger google_connections_invalidate_unavailable
after update of connection_status on private.google_connections
for each row execute function private.invalidate_unavailable_google_connection_runs();

create function private.validate_imported_calendar_event_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
            or new.household_id is distinct from old.household_id
            or new.connection_id is distinct from old.connection_id
            or new.google_calendar_id is distinct from old.google_calendar_id
            or new.google_event_id is distinct from old.google_event_id
            or new.imported_at is distinct from old.imported_at then
            raise exception 'Imported event identity cannot be changed'
                using errcode = '42501';
        end if;
    end if;

    if not exists (
        select 1
        from private.google_calendars calendar
        join private.google_connections connection
          on connection.id = calendar.connection_id
         and connection.household_id = calendar.household_id
        where calendar.connection_id = new.connection_id
          and calendar.household_id = new.household_id
          and calendar.google_calendar_id = new.google_calendar_id
          and calendar.is_selected
          and calendar.calendar_access_status = 'available'
          and connection.connection_status = 'connected'
    ) then
        raise exception 'Imported event source is not selected and active'
            using errcode = '23514';
    end if;

    new.title := pg_catalog.btrim(new.title);
    new.description := nullif(pg_catalog.btrim(new.description), '');
    new.location := nullif(pg_catalog.btrim(new.location), '');
    if not new.all_day then
        new.time_zone := pg_catalog.btrim(new.time_zone);
        if not exists (
            select 1 from pg_catalog.pg_timezone_names zone
            where zone.name = new.time_zone
        ) then
            raise exception 'Use a valid IANA time zone for timed imported events'
                using errcode = '23514';
        end if;
    end if;
    new.synced_at := pg_catalog.now();
    return new;
end;
$$;

revoke all on function private.validate_imported_calendar_event_write()
    from public, anon, authenticated;

create trigger imported_calendar_events_validate_write
before insert or update on public.imported_calendar_events
for each row execute function private.validate_imported_calendar_event_write();

-- The policy resolves the source calendar's current sharing mode on every read.
-- There is no copied visibility flag that can become stale during a sync.
create function private.can_read_imported_calendar_event(
    target_household_id uuid,
    target_connection_id uuid,
    target_google_calendar_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles profile
        join private.google_connections connection
          on connection.household_id = profile.household_id
        join private.google_calendars calendar
          on calendar.connection_id = connection.id
         and calendar.household_id = connection.household_id
        where profile.id = (select auth.uid())
          and profile.household_id = target_household_id
          and connection.id = target_connection_id
          and connection.household_id = target_household_id
          and connection.connection_status = 'connected'
          and calendar.google_calendar_id = target_google_calendar_id
          and calendar.is_selected
          and calendar.calendar_access_status = 'available'
          and (connection.owner_user_id = profile.id
              or calendar.sharing_mode = 'household')
    );
$$;

revoke all on function private.can_read_imported_calendar_event(uuid, uuid, text)
    from public, anon;
grant execute on function private.can_read_imported_calendar_event(uuid, uuid, text)
    to authenticated;

alter table private.google_connections enable row level security;
alter table private.google_calendars enable row level security;
alter table public.imported_calendar_events enable row level security;

create policy imported_calendar_events_select_for_visible_source
on public.imported_calendar_events
for select
to authenticated
using ((select private.can_read_imported_calendar_event(
    household_id, connection_id, google_calendar_id
)));

-- No browser write policies or grants exist for the mirror. In particular,
-- authenticated clients cannot forge imported content or modify Google data.
revoke all on table private.google_connections, private.google_calendars
    from public, anon, authenticated;
revoke all on table public.imported_calendar_events
    from public, anon, authenticated;

grant select (
    id, household_id, title, description, location, html_link,
    all_day, starts_at, ends_at, time_zone, start_date, end_date,
    google_updated_at, imported_at, synced_at
) on table public.imported_calendar_events to authenticated;

-- Future Edge Functions can use a server-only database connection or
-- service-only fixed-path RPCs. The private schema is deliberately not added
-- to PostgREST's exposed schemas in supabase/config.toml.
grant usage on schema private to service_role;
grant all on table private.google_connections, private.google_calendars
    to service_role;
grant select, insert, update, delete on table public.imported_calendar_events
    to service_role;
