-- User-triggered, resumable Google Calendar event synchronization. All private
-- calendar state remains reachable only through service-role RPCs.

alter table private.google_calendars
    add column sync_lease_id uuid;

alter table private.google_calendars
    drop constraint google_calendars_sync_run_shape;

alter table private.google_calendars
    add constraint google_calendars_sync_run_shape check (
        (sync_status = 'idle'
            and sync_run_id is null and sync_run_kind is null
            and sync_page_token is null and initial_sync_time_min is null
            and sync_started_at is null and sync_lease_expires_at is null
            and sync_lease_id is null)
        or (sync_status = 'running'
            and sync_run_id is not null and sync_run_kind is not null
            and sync_started_at is not null
            and ((sync_lease_id is null and sync_lease_expires_at is null)
                or (sync_lease_id is not null and sync_lease_expires_at is not null)))
        or (sync_status = 'failed'
            and sync_run_id is not null and sync_run_kind is not null
            and sync_started_at is not null and sync_lease_expires_at is null
            and sync_lease_id is null)
    );

-- Existing calendar/connection triggers invalidate run fields. Clear the new
-- worker lease in the same row operation before the shape constraint is checked.
create function private.clear_invalid_google_calendar_sync_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT'
        or new.sync_status <> 'running'
        or (tg_op = 'UPDATE' and new.sync_run_id is distinct from old.sync_run_id) then
        new.sync_lease_id := null;
        new.sync_lease_expires_at := null;
    end if;
    return new;
end;
$$;

revoke all on function private.clear_invalid_google_calendar_sync_lease()
    from public, anon, authenticated;

create trigger google_calendars_z_clear_invalid_sync_lease
before insert or update on private.google_calendars
for each row execute function private.clear_invalid_google_calendar_sync_lease();

create or replace function public.google_calendar_connection_status(p_owner_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    connection private.google_connections%rowtype;
    current_household_id uuid;
    calendars jsonb;
begin
    select profile.household_id into current_household_id
    from public.profiles profile
    where profile.id = p_owner_user_id;
    if current_household_id is null then
        raise exception 'Google Calendar requires a current household profile'
            using errcode = '42501';
    end if;

    select saved.* into connection
    from private.google_connections saved
    where saved.owner_user_id = p_owner_user_id
      and saved.household_id = current_household_id
      and saved.connection_status <> 'disabled';

    if not found then
        return pg_catalog.jsonb_build_object('connection', null, 'calendars', '[]'::jsonb);
    end if;

    select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
            'calendarId', calendar.google_calendar_id,
            'name', calendar.display_name,
            'timeZone', calendar.time_zone,
            'selected', calendar.is_selected,
            'sharingMode', calendar.sharing_mode,
            'accessStatus', calendar.calendar_access_status,
            'syncStatus', calendar.sync_status,
            'syncRunKind', calendar.sync_run_kind,
            'syncStartedAt', calendar.sync_started_at,
            'syncLeaseExpiresAt', calendar.sync_lease_expires_at,
            'lastSuccessfulSyncAt', calendar.last_successful_sync_at,
            'syncErrorCode', calendar.last_error_code,
            'syncErrorAt', calendar.last_error_at
        ) order by calendar.display_name nulls last, calendar.google_calendar_id
    ), '[]'::jsonb)
    into calendars
    from private.google_calendars calendar
    where calendar.connection_id = connection.id;

    return pg_catalog.jsonb_build_object(
        'connection', pg_catalog.jsonb_build_object(
            'id', connection.id,
            'status', connection.connection_status,
            'connectedAt', connection.connected_at,
            'grantedScopes', connection.granted_scopes
        ),
        'calendars', calendars
    );
end;
$$;

create function public.google_calendar_sync_begin_selected(p_owner_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    connection private.google_connections%rowtype;
    calendar private.google_calendars%rowtype;
    started_count integer := 0;
begin
    select saved.* into connection
    from private.google_connections saved
    join public.profiles profile
      on profile.id = saved.owner_user_id
     and profile.household_id = saved.household_id
    where saved.owner_user_id = p_owner_user_id
      and saved.connection_status = 'connected';
    if not found then
        raise exception 'Google connection is not available'
            using errcode = '42501';
    end if;

    for calendar in
        select saved.* from private.google_calendars saved
        where saved.connection_id = connection.id
          and saved.is_selected
          and saved.calendar_access_status = 'available'
        order by saved.google_calendar_id
        for update
    loop
        if calendar.sync_status = 'running' then
            if calendar.sync_lease_expires_at is not null
                and calendar.sync_lease_expires_at > pg_catalog.now() then
                continue;
            end if;
            update private.google_calendars saved
            set sync_lease_id = null,
                sync_lease_expires_at = null,
                last_error_code = null,
                last_error_at = null
            where saved.id = calendar.id;
        elsif calendar.sync_status = 'failed' then
            update private.google_calendars saved
            set sync_status = 'running',
                sync_lease_id = null,
                sync_lease_expires_at = null,
                last_error_code = null,
                last_error_at = null
            where saved.id = calendar.id;
        else
            update private.google_calendars saved
            set sync_status = 'running',
                sync_run_id = pg_catalog.gen_random_uuid(),
                sync_run_kind = case when saved.sync_token is null then 'initial' else 'incremental' end,
                sync_page_token = null,
                initial_sync_time_min = case when saved.sync_token is null then pg_catalog.now() else null end,
                sync_started_at = pg_catalog.now(),
                sync_lease_id = null,
                sync_lease_expires_at = null,
                last_error_code = null,
                last_error_at = null
            where saved.id = calendar.id;
        end if;
        started_count := started_count + 1;
    end loop;
    return started_count;
end;
$$;

create function public.google_calendar_sync_claim_next(
    p_owner_user_id uuid,
    p_lease_id uuid,
    p_lease_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    claim jsonb;
begin
    if p_lease_id is null
        or p_lease_expires_at <= pg_catalog.now()
        or p_lease_expires_at > pg_catalog.now() + interval '2 minutes' then
        raise exception 'Invalid Google Calendar sync lease'
            using errcode = '22023';
    end if;

    with candidate as (
        select calendar.id
        from private.google_calendars calendar
        join private.google_connections connection
          on connection.id = calendar.connection_id
         and connection.household_id = calendar.household_id
        join public.profiles profile
          on profile.id = connection.owner_user_id
         and profile.household_id = connection.household_id
        where connection.owner_user_id = p_owner_user_id
          and connection.connection_status = 'connected'
          and calendar.is_selected
          and calendar.calendar_access_status = 'available'
          and calendar.sync_status = 'running'
          and (calendar.sync_lease_id is null
              or calendar.sync_lease_expires_at <= pg_catalog.now())
        order by calendar.sync_started_at, calendar.google_calendar_id
        limit 1
        for update of calendar skip locked
    ), claimed as (
        update private.google_calendars calendar
        set sync_lease_id = p_lease_id,
            sync_lease_expires_at = p_lease_expires_at
        from candidate
        where calendar.id = candidate.id
        returning calendar.*
    )
    select pg_catalog.jsonb_build_object(
        'calendarRowId', claimed.id,
        'connectionId', claimed.connection_id,
        'householdId', claimed.household_id,
        'googleCalendarId', claimed.google_calendar_id,
        'timeZone', claimed.time_zone,
        'runId', claimed.sync_run_id,
        'runKind', claimed.sync_run_kind,
        'generation', claimed.sync_generation,
        'pageToken', claimed.sync_page_token,
        'syncToken', claimed.sync_token,
        'initialSyncTimeMin', claimed.initial_sync_time_min
    ) into claim
    from claimed;

    return claim;
end;
$$;

create function public.google_calendar_sync_commit_page(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint,
    p_events jsonb,
    p_removed_event_ids jsonb,
    p_next_page_token text,
    p_next_sync_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    calendar private.google_calendars%rowtype;
    inserted_count integer := 0;
    removed_count integer := 0;
begin
    if pg_catalog.jsonb_typeof(p_events) is distinct from 'array'
        or pg_catalog.jsonb_array_length(p_events) > 250
        or pg_catalog.jsonb_typeof(p_removed_event_ids) is distinct from 'array'
        or pg_catalog.jsonb_array_length(p_removed_event_ids) > 250 then
        raise exception 'Invalid Google event page'
            using errcode = '22023';
    end if;
    if (p_next_page_token is null) = (p_next_sync_token is null)
        or (p_next_page_token is not null and char_length(p_next_page_token) > 8192)
        or (p_next_sync_token is not null and char_length(p_next_sync_token) > 8192) then
        raise exception 'Invalid Google event page cursor'
            using errcode = '22023';
    end if;

    select saved.* into calendar
    from private.google_calendars saved
    join private.google_connections connection
      on connection.id = saved.connection_id
     and connection.household_id = saved.household_id
    join public.profiles profile
      on profile.id = connection.owner_user_id
     and profile.household_id = connection.household_id
    where saved.id = p_calendar_row_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected'
      and saved.is_selected
      and saved.calendar_access_status = 'available'
      and saved.sync_status = 'running'
      and saved.sync_run_id = p_run_id
      and saved.sync_lease_id = p_lease_id
      and saved.sync_lease_expires_at > pg_catalog.now()
      and saved.sync_generation = p_generation
    for update of saved;
    if not found then
        raise exception 'Google Calendar sync run is no longer current'
            using errcode = '40001';
    end if;

    if exists (
        select 1 from pg_catalog.jsonb_array_elements_text(p_removed_event_ids) as removed(id)
        where removed.id is null or pg_catalog.btrim(removed.id) = ''
    ) or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(p_removed_event_ids))
       <> (select pg_catalog.count(distinct removed.id)
           from pg_catalog.jsonb_array_elements_text(p_removed_event_ids) as removed(id)) then
        raise exception 'Invalid Google event removal list'
            using errcode = '22023';
    end if;

    delete from public.imported_calendar_events event
    where event.connection_id = calendar.connection_id
      and event.google_calendar_id = calendar.google_calendar_id
      and event.google_event_id in (
          select removed.id from pg_catalog.jsonb_array_elements_text(p_removed_event_ids) as removed(id)
      );
    get diagnostics removed_count = row_count;

    if exists (
        select 1 from pg_catalog.jsonb_to_recordset(p_events) as incoming(
            google_event_id text, title text, description text, location text,
            html_link text, all_day boolean, starts_at timestamptz, ends_at timestamptz,
            time_zone text, start_date date, end_date date, google_updated_at timestamptz
        )
        where incoming.google_event_id is null
            or pg_catalog.btrim(incoming.google_event_id) = ''
            or incoming.title is null or pg_catalog.btrim(incoming.title) = ''
            or incoming.all_day is null
            or pg_catalog.char_length(incoming.google_event_id) > 1024
            or pg_catalog.char_length(incoming.title) > 500
            or pg_catalog.char_length(coalesce(incoming.description, '')) > 20000
            or pg_catalog.char_length(coalesce(incoming.location, '')) > 2000
            or (incoming.all_day and (
                incoming.start_date is null or incoming.end_date is null
                or incoming.end_date <= incoming.start_date
                or incoming.starts_at is not null or incoming.ends_at is not null
                or incoming.time_zone is not null
            ))
            or (not incoming.all_day and (
                incoming.starts_at is null or incoming.ends_at is null
                or incoming.ends_at <= incoming.starts_at
                or incoming.time_zone is null or pg_catalog.btrim(incoming.time_zone) = ''
                or incoming.start_date is not null or incoming.end_date is not null
            ))
    ) or (select pg_catalog.count(*) from pg_catalog.jsonb_to_recordset(p_events) as incoming(google_event_id text))
       <> (select pg_catalog.count(distinct incoming.google_event_id)
           from pg_catalog.jsonb_to_recordset(p_events) as incoming(google_event_id text)) then
        raise exception 'Invalid normalized Google events'
            using errcode = '22023';
    end if;

    insert into public.imported_calendar_events (
        household_id, connection_id, google_calendar_id, google_event_id,
        title, description, location, html_link, all_day, starts_at, ends_at,
        time_zone, start_date, end_date, google_updated_at
    )
    select calendar.household_id, calendar.connection_id, calendar.google_calendar_id,
        incoming.google_event_id, incoming.title, incoming.description, incoming.location,
        incoming.html_link, incoming.all_day, incoming.starts_at, incoming.ends_at,
        incoming.time_zone, incoming.start_date, incoming.end_date, incoming.google_updated_at
    from pg_catalog.jsonb_to_recordset(p_events) as incoming(
        google_event_id text, title text, description text, location text,
        html_link text, all_day boolean, starts_at timestamptz, ends_at timestamptz,
        time_zone text, start_date date, end_date date, google_updated_at timestamptz
    )
    on conflict (connection_id, google_calendar_id, google_event_id) do update
    set title = excluded.title,
        description = excluded.description,
        location = excluded.location,
        html_link = excluded.html_link,
        all_day = excluded.all_day,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        time_zone = excluded.time_zone,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        google_updated_at = excluded.google_updated_at;
    get diagnostics inserted_count = row_count;

    if p_next_page_token is not null then
        update private.google_calendars saved
        set sync_page_token = p_next_page_token,
            sync_lease_id = null,
            sync_lease_expires_at = null
        where saved.id = calendar.id;
    else
        if calendar.sync_run_kind = 'rebuild' then
            delete from public.imported_calendar_events event
            where event.connection_id = calendar.connection_id
              and event.google_calendar_id = calendar.google_calendar_id
              and event.synced_at < calendar.sync_started_at
              and ((not event.all_day and event.ends_at > calendar.initial_sync_time_min)
                  or (event.all_day and event.end_date > (
                      calendar.initial_sync_time_min at time zone coalesce(calendar.time_zone, 'UTC')
                  )::date));
        end if;
        update private.google_calendars saved
        set sync_token = p_next_sync_token,
            sync_status = 'idle',
            sync_run_id = null,
            sync_run_kind = null,
            sync_page_token = null,
            initial_sync_time_min = null,
            sync_started_at = null,
            sync_lease_id = null,
            sync_lease_expires_at = null,
            last_successful_sync_at = pg_catalog.now(),
            last_error_code = null,
            last_error_at = null
        where saved.id = calendar.id;
    end if;

    return pg_catalog.jsonb_build_object(
        'importedCount', inserted_count,
        'removedCount', removed_count,
        'complete', p_next_page_token is null
    );
end;
$$;

create function public.google_calendar_sync_reset_to_rebuild(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update private.google_calendars saved
    set sync_token = null,
        sync_run_id = pg_catalog.gen_random_uuid(),
        sync_run_kind = 'rebuild',
        sync_page_token = null,
        initial_sync_time_min = pg_catalog.now(),
        sync_started_at = pg_catalog.now(),
        sync_lease_id = null,
        sync_lease_expires_at = null,
        last_error_code = null,
        last_error_at = null
    from private.google_connections connection
    join public.profiles profile
      on profile.id = connection.owner_user_id
     and profile.household_id = connection.household_id
    where saved.id = p_calendar_row_id
      and connection.id = saved.connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected'
      and saved.is_selected
      and saved.calendar_access_status = 'available'
      and saved.sync_status = 'running'
      and saved.sync_run_kind in ('initial', 'incremental', 'rebuild')
      and saved.sync_run_id = p_run_id
      and saved.sync_lease_id = p_lease_id
      and saved.sync_lease_expires_at > pg_catalog.now()
      and saved.sync_generation = p_generation;
    return found;
end;
$$;

create function public.google_calendar_sync_fail(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint,
    p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_error_code not in ('network_error', 'rate_limited', 'google_error',
        'invalid_response', 'reconnect_required', 'sync_error') then
        p_error_code := 'sync_error';
    end if;
    update private.google_calendars saved
    set sync_status = 'failed',
        sync_lease_id = null,
        sync_lease_expires_at = null,
        last_error_code = p_error_code,
        last_error_at = pg_catalog.now()
    from private.google_connections connection
    join public.profiles profile
      on profile.id = connection.owner_user_id
     and profile.household_id = connection.household_id
    where saved.id = p_calendar_row_id
      and connection.id = saved.connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected'
      and saved.is_selected
      and saved.calendar_access_status = 'available'
      and saved.sync_status = 'running'
      and saved.sync_run_id = p_run_id
      and saved.sync_lease_id = p_lease_id
      and saved.sync_lease_expires_at > pg_catalog.now()
      and saved.sync_generation = p_generation;
    return found;
end;
$$;

create function public.google_calendar_sync_mark_lost(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update private.google_calendars saved
    set is_selected = false,
        sharing_mode = 'private',
        calendar_access_status = 'lost'
    from private.google_connections connection
    join public.profiles profile
      on profile.id = connection.owner_user_id
     and profile.household_id = connection.household_id
    where saved.id = p_calendar_row_id
      and connection.id = saved.connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected'
      and saved.is_selected
      and saved.calendar_access_status = 'available'
      and saved.sync_status = 'running'
      and saved.sync_run_id = p_run_id
      and saved.sync_lease_id = p_lease_id
      and saved.sync_lease_expires_at > pg_catalog.now()
      and saved.sync_generation = p_generation;
    return found;
end;
$$;

revoke all on function public.google_calendar_sync_begin_selected(uuid) from public, anon, authenticated;
revoke all on function public.google_calendar_sync_claim_next(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.google_calendar_sync_commit_page(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.google_calendar_sync_reset_to_rebuild(uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.google_calendar_sync_fail(uuid, uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.google_calendar_sync_mark_lost(uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public.google_calendar_sync_begin_selected(uuid) to service_role;
grant execute on function public.google_calendar_sync_claim_next(uuid, uuid, timestamptz) to service_role;
grant execute on function public.google_calendar_sync_commit_page(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb, text, text) to service_role;
grant execute on function public.google_calendar_sync_reset_to_rebuild(uuid, uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.google_calendar_sync_fail(uuid, uuid, uuid, uuid, bigint, text) to service_role;
grant execute on function public.google_calendar_sync_mark_lost(uuid, uuid, uuid, uuid, bigint) to service_role;
