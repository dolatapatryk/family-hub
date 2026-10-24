-- Google Calendar connections, OAuth, calendar selection and resumable event synchronization.
-- Fresh-install schema; definitions include all prior fixes.

-- Tables

CREATE TABLE private.google_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    encrypted_refresh_token bytea,
    token_key_version text,
    granted_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    connection_status text DEFAULT 'pending'::text NOT NULL,
    pending_oauth_state_hash bytea,
    pending_oauth_state_expires_at timestamp with time zone,
    connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    token_refresh_lease_id uuid,
    token_refresh_lease_expires_at timestamp with time zone,
    constraint google_connections_connected_has_token check (
        connection_status <> 'connected' or encrypted_refresh_token is not null
    ),
    constraint google_connections_disabled_has_no_pending_state check (
        connection_status <> 'disabled'
        or (pending_oauth_state_hash is null and pending_oauth_state_expires_at is null)
    ),
    constraint google_connections_oauth_state_pair check (
        (pending_oauth_state_hash is null and pending_oauth_state_expires_at is null)
        or (pending_oauth_state_hash is not null
            and octet_length(pending_oauth_state_hash) = 32
            and pending_oauth_state_expires_at is not null)
    ),
    constraint google_connections_refresh_lease_pair check (
        (token_refresh_lease_id is null and token_refresh_lease_expires_at is null)
        or (token_refresh_lease_id is not null and token_refresh_lease_expires_at is not null)
    ),
    constraint google_connections_scopes_no_null check (
        array_position(granted_scopes, null::text) is null
    ),
    constraint google_connections_status check (
        connection_status in ('pending', 'connected', 'reconnect_required', 'disabled')
    ),
    constraint google_connections_token_pair check (
        (encrypted_refresh_token is null and token_key_version is null)
        or (encrypted_refresh_token is not null and token_key_version is not null
            and char_length(btrim(token_key_version)) > 0)
    ),
    CONSTRAINT google_connections_id_household_unique UNIQUE (id, household_id),
    CONSTRAINT google_connections_owner_unique UNIQUE (owner_user_id),
    CONSTRAINT google_connections_pkey PRIMARY KEY (id),
    CONSTRAINT google_connections_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT google_connections_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id)
        ON DELETE CASCADE
);

CREATE TABLE private.google_calendars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    household_id uuid NOT NULL,
    google_calendar_id text NOT NULL,
    display_name text,
    time_zone text,
    is_selected boolean DEFAULT false NOT NULL,
    sharing_mode text DEFAULT 'private'::text NOT NULL,
    calendar_access_status text DEFAULT 'available'::text NOT NULL,
    sync_token text,
    request_config jsonb DEFAULT '{"showDeleted": true, "singleEvents": false}'::jsonb NOT NULL,
    sync_generation bigint DEFAULT 0 NOT NULL,
    sync_status text DEFAULT 'idle'::text NOT NULL,
    sync_run_id uuid,
    sync_run_kind text,
    sync_page_token text,
    initial_sync_time_min timestamp with time zone,
    sync_started_at timestamp with time zone,
    sync_lease_expires_at timestamp with time zone,
    last_successful_sync_at timestamp with time zone,
    last_error_code text,
    last_error_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_lease_id uuid,
    constraint google_calendars_access_status check (
        calendar_access_status in ('available', 'lost')
    ),
    constraint google_calendars_display_name_not_blank check (
        display_name is null or char_length(btrim(display_name)) > 0
    ),
    constraint google_calendars_generation_nonnegative check (sync_generation >= 0),
    constraint google_calendars_google_id_not_blank check (
        char_length(btrim(google_calendar_id)) > 0
    ),
    constraint google_calendars_initial_cutoff_shape check (
        (sync_run_kind in ('initial', 'rebuild') and initial_sync_time_min is not null)
        or (sync_run_kind = 'incremental' and initial_sync_time_min is null)
        or sync_run_kind is null
    ),
    constraint google_calendars_request_config check (
        request_config = '{"singleEvents":false,"showDeleted":true}'::jsonb
    ),
    constraint google_calendars_sharing_mode check (
        sharing_mode in ('private', 'household')
    ),
    constraint google_calendars_sync_run_kind check (
        sync_run_kind is null or sync_run_kind in ('initial', 'incremental', 'rebuild')
    ),
    constraint google_calendars_sync_run_shape check (
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
    ),
    constraint google_calendars_sync_status check (
        sync_status in ('idle', 'running', 'failed')
    ),
    constraint google_calendars_unselected_private check (
        is_selected or sharing_mode = 'private'
    ),
    CONSTRAINT google_calendars_pkey PRIMARY KEY (id),
    CONSTRAINT google_calendars_source_household_unique UNIQUE (connection_id, google_calendar_id, household_id),
    CONSTRAINT google_calendars_source_unique UNIQUE (connection_id, google_calendar_id),
    CONSTRAINT google_calendars_connection_fk FOREIGN KEY (connection_id, household_id) REFERENCES private.google_connections(id,
        household_id) ON DELETE CASCADE
);

CREATE TABLE public.imported_calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    google_calendar_id text NOT NULL,
    google_event_id text NOT NULL,
    title text NOT NULL,
    description text,
    location text,
    html_link text,
    all_day boolean NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    time_zone text,
    start_date date,
    end_date date,
    google_updated_at timestamp with time zone,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint imported_calendar_events_google_ids_not_blank check (
        char_length(btrim(google_calendar_id)) > 0
        and char_length(btrim(google_event_id)) > 0
    ),
    constraint imported_calendar_events_google_link check (
        html_link is null or html_link ~ '^https://(calendar|www)[.]google[.]com/'
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
    constraint imported_calendar_events_title_not_blank check (
        char_length(btrim(title)) > 0
    ),
    CONSTRAINT imported_calendar_events_pkey PRIMARY KEY (id),
    CONSTRAINT imported_calendar_events_source_unique UNIQUE (connection_id, google_calendar_id, google_event_id),
    CONSTRAINT imported_calendar_events_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT imported_calendar_events_source_fk FOREIGN KEY (connection_id, google_calendar_id, household_id)
        REFERENCES private.google_calendars(connection_id, google_calendar_id, household_id) ON DELETE CASCADE
);

-- Indexes

create index google_calendars_connection_selected_idx
    on private.google_calendars (connection_id, is_selected);

create index google_calendars_household_idx
    on private.google_calendars (household_id);

create index google_connections_household_idx
    on private.google_connections (household_id);

create index imported_calendar_events_connection_source_idx
    on public.imported_calendar_events (connection_id, google_calendar_id);

create index imported_calendar_events_household_date_range_idx
    on public.imported_calendar_events (household_id, start_date, end_date)
    where all_day;

create index imported_calendar_events_household_timed_range_idx
    on public.imported_calendar_events (household_id, starts_at, ends_at)
    where not all_day;

-- Functions

CREATE FUNCTION private.can_read_imported_calendar_event(
    target_household_id uuid,
    target_connection_id uuid,
    target_google_calendar_id text
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.clear_invalid_google_calendar_sync_lease() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.invalidate_unavailable_google_connection_runs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.purge_unavailable_google_calendar_events() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.validate_google_calendar_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.validate_google_connection_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.validate_imported_calendar_event_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_acquire_refresh_lease(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_lease_id uuid,
    p_lease_expires_at timestamp with time zone
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
    if p_lease_id is null
        or p_lease_expires_at <= pg_catalog.now()
        or p_lease_expires_at > pg_catalog.now() + interval '1 minute' then
        raise exception 'Invalid Google credential refresh lease'
            using errcode = '22023';
    end if;

    update private.google_connections connection
    set token_refresh_lease_id = p_lease_id,
        token_refresh_lease_expires_at = p_lease_expires_at
    from public.profiles profile
    where connection.id = p_connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected'
      and profile.id = connection.owner_user_id
      and profile.household_id = connection.household_id
      and (connection.token_refresh_lease_expires_at is null
          or connection.token_refresh_lease_expires_at <= pg_catalog.now());
    return found;
end;
$$;

CREATE FUNCTION public.google_calendar_connection_credentials(
    p_owner_user_id uuid,
    p_connection_id uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    result jsonb;
begin
    select pg_catalog.jsonb_build_object(
        'id', connection.id,
        'status', connection.connection_status,
        'connectedAt', connection.connected_at,
        'encryptedRefreshTokenHex', pg_catalog.encode(connection.encrypted_refresh_token, 'hex'),
        'tokenKeyVersion', connection.token_key_version,
        'grantedScopes', connection.granted_scopes
    ) into result
    from private.google_connections connection
    join public.profiles profile
      on profile.id = connection.owner_user_id
     and profile.household_id = connection.household_id
    where connection.id = p_connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected';

    return result;
end;
$$;

CREATE FUNCTION public.google_calendar_connection_status(p_owner_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_disconnect(p_owner_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_household_id uuid;
    saved_connection private.google_connections%rowtype;
begin
    select profile.household_id into current_household_id
    from public.profiles profile
    where profile.id = p_owner_user_id;
    if current_household_id is null then
        raise exception 'Google Calendar requires a current household profile'
            using errcode = '42501';
    end if;

    -- Lock the owner's row so concurrent sync/management operations serialize
    -- with the disconnect. The unique owner constraint allows at most one row.
    select connection.* into saved_connection
    from private.google_connections connection
    where connection.owner_user_id = p_owner_user_id
    for update;

    if not found then
        return pg_catalog.jsonb_build_object('disconnected', false);
    end if;

    delete from private.google_connections connection
    where connection.id = saved_connection.id;

    return pg_catalog.jsonb_build_object(
        'disconnected', true,
        'connectionId', saved_connection.id,
        'encryptedRefreshTokenHex', pg_catalog.encode(saved_connection.encrypted_refresh_token, 'hex'),
        'tokenKeyVersion', saved_connection.token_key_version
    );
end;
$$;

CREATE FUNCTION public.google_calendar_mark_reconnect_required(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_connection_connected_at timestamp with time zone
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
    update private.google_connections connection
    set connection_status = 'reconnect_required',
        pending_oauth_state_hash = null,
        pending_oauth_state_expires_at = null,
        token_refresh_lease_id = null,
        token_refresh_lease_expires_at = null
    from public.profiles profile
    where connection.id = p_connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status = 'connected'
      and connection.connected_at is not distinct from p_connection_connected_at
      and profile.id = connection.owner_user_id
      and profile.household_id = connection.household_id;
end;
$$;

CREATE FUNCTION public.google_calendar_oauth_begin(
    p_owner_user_id uuid,
    p_state_hash bytea,
    p_state_expires_at timestamp with time zone
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_household_id uuid;
    saved_connection private.google_connections%rowtype;
begin
    if p_state_hash is null or octet_length(p_state_hash) <> 32
        or p_state_expires_at <= pg_catalog.now()
        or p_state_expires_at > pg_catalog.now() + interval '15 minutes' then
        raise exception 'Invalid Google authorization state'
            using errcode = '22023';
    end if;

    select profile.household_id into current_household_id
    from public.profiles profile
    where profile.id = p_owner_user_id;
    if current_household_id is null then
        raise exception 'Google Calendar requires a current household profile'
            using errcode = '42501';
    end if;

    -- A disabled connection is terminal by design. A later opt-in starts with
    -- a fresh row and cannot revive its old credentials or calendar records.
    delete from private.google_connections connection
    where connection.owner_user_id = p_owner_user_id
      and (connection.connection_status = 'disabled'
          or connection.household_id <> current_household_id);

    insert into private.google_connections (
        household_id, owner_user_id, pending_oauth_state_hash,
        pending_oauth_state_expires_at
    ) values (
        current_household_id, p_owner_user_id, p_state_hash, p_state_expires_at
    )
    on conflict (owner_user_id) do update
        set pending_oauth_state_hash = excluded.pending_oauth_state_hash,
            pending_oauth_state_expires_at = excluded.pending_oauth_state_expires_at
    returning * into saved_connection;

    return pg_catalog.jsonb_build_object(
        'connectionId', saved_connection.id,
        'householdId', saved_connection.household_id,
        'status', saved_connection.connection_status
    );
end;
$$;

CREATE FUNCTION public.google_calendar_oauth_complete(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_encrypted_refresh_token bytea,
    p_token_key_version text,
    p_granted_scopes text[]
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
    if p_granted_scopes is null
        or not ('https://www.googleapis.com/auth/calendar.events.readonly' = any(p_granted_scopes))
        or not ('https://www.googleapis.com/auth/calendar.calendarlist.readonly' = any(p_granted_scopes)) then
        raise exception 'Google did not grant the required read-only scopes'
            using errcode = '42501';
    end if;
    if (p_encrypted_refresh_token is null) <> (p_token_key_version is null)
        or (p_token_key_version is not null and char_length(pg_catalog.btrim(p_token_key_version)) = 0) then
        raise exception 'Invalid encrypted Google credential'
            using errcode = '22023';
    end if;

    update private.google_connections connection
    set encrypted_refresh_token = coalesce(p_encrypted_refresh_token, connection.encrypted_refresh_token),
        token_key_version = coalesce(p_token_key_version, connection.token_key_version),
        granted_scopes = p_granted_scopes,
        connection_status = 'connected',
        connected_at = pg_catalog.now()
    from public.profiles profile
    where connection.id = p_connection_id
      and connection.owner_user_id = p_owner_user_id
      and connection.connection_status <> 'disabled'
      and profile.id = connection.owner_user_id
      and profile.household_id = connection.household_id
      and (p_encrypted_refresh_token is not null or connection.encrypted_refresh_token is not null);

    if not found then
        raise exception 'Google connection could not be completed'
            using errcode = '42501';
    end if;
end;
$$;

CREATE FUNCTION public.google_calendar_oauth_consume_state(p_state_hash bytea) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    consumed jsonb;
begin
    if p_state_hash is null or octet_length(p_state_hash) <> 32 then
        return null;
    end if;

    update private.google_connections connection
    set pending_oauth_state_hash = null,
        pending_oauth_state_expires_at = null
    from public.profiles profile
    where connection.pending_oauth_state_hash = p_state_hash
      and connection.pending_oauth_state_expires_at > pg_catalog.now()
      and connection.connection_status <> 'disabled'
      and profile.id = connection.owner_user_id
      and profile.household_id = connection.household_id
    returning pg_catalog.jsonb_build_object(
        'connectionId', connection.id,
        'ownerUserId', connection.owner_user_id,
        'householdId', connection.household_id,
        'status', connection.connection_status,
        'hasRefreshToken', connection.encrypted_refresh_token is not null
    ) into consumed;

    return consumed;
end;
$$;

CREATE FUNCTION public.google_calendar_refresh_list(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_calendar_list jsonb
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    connection private.google_connections%rowtype;
    item record;
begin
    if pg_catalog.jsonb_typeof(p_calendar_list) is distinct from 'array'
        or pg_catalog.jsonb_array_length(p_calendar_list) > 5000 then
        raise exception 'Invalid Google calendar list'
            using errcode = '22023';
    end if;

    select saved.* into connection
    from private.google_connections saved
    join public.profiles profile
      on profile.id = saved.owner_user_id
     and profile.household_id = saved.household_id
    where saved.id = p_connection_id
      and saved.owner_user_id = p_owner_user_id
      and saved.connection_status = 'connected';
    if not found then
        raise exception 'Google connection is not available'
            using errcode = '42501';
    end if;

    if exists (
        select 1
        from pg_catalog.jsonb_to_recordset(p_calendar_list) as incoming(google_calendar_id text)
        where incoming.google_calendar_id is null or pg_catalog.btrim(incoming.google_calendar_id) = ''
    ) or (select pg_catalog.count(*) from pg_catalog.jsonb_to_recordset(p_calendar_list)
            as incoming(google_calendar_id text))
       <> (select pg_catalog.count(distinct incoming.google_calendar_id)
           from pg_catalog.jsonb_to_recordset(p_calendar_list)
                as incoming(google_calendar_id text)) then
        raise exception 'Invalid Google calendar identity'
            using errcode = '22023';
    end if;

    for item in
        select incoming.google_calendar_id, incoming.display_name, incoming.time_zone
        from pg_catalog.jsonb_to_recordset(p_calendar_list)
            as incoming(google_calendar_id text, display_name text, time_zone text)
    loop
        insert into private.google_calendars (
            connection_id, household_id, google_calendar_id, display_name,
            time_zone, calendar_access_status
        ) values (
            connection.id, connection.household_id, item.google_calendar_id,
            item.display_name, item.time_zone, 'available'
        )
        on conflict (connection_id, google_calendar_id) do update
            set display_name = excluded.display_name,
                time_zone = excluded.time_zone,
                calendar_access_status = 'available';
    end loop;

    update private.google_calendars calendar
    set is_selected = false,
        sharing_mode = 'private',
        calendar_access_status = 'lost'
    where calendar.connection_id = connection.id
      and calendar.calendar_access_status <> 'lost'
      and not exists (
          select 1
          from pg_catalog.jsonb_to_recordset(p_calendar_list)
              as incoming(google_calendar_id text)
          where incoming.google_calendar_id = calendar.google_calendar_id
      );
end;
$$;

CREATE FUNCTION public.google_calendar_release_refresh_lease(p_connection_id uuid, p_lease_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
    update private.google_connections connection
    set token_refresh_lease_id = null,
        token_refresh_lease_expires_at = null
    where connection.id = p_connection_id
      and connection.token_refresh_lease_id = p_lease_id;
end;
$$;

CREATE FUNCTION public.google_calendar_save_choices(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_choices jsonb
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    connection private.google_connections%rowtype;
    choice record;
begin
    if pg_catalog.jsonb_typeof(p_choices) is distinct from 'array'
        or pg_catalog.jsonb_array_length(p_choices) > 5000 then
        raise exception 'Invalid Google calendar choices'
            using errcode = '22023';
    end if;

    select saved.* into connection
    from private.google_connections saved
    join public.profiles profile
      on profile.id = saved.owner_user_id
     and profile.household_id = saved.household_id
    where saved.id = p_connection_id
      and saved.owner_user_id = p_owner_user_id
      and saved.connection_status = 'connected';
    if not found then
        raise exception 'Google connection is not available'
            using errcode = '42501';
    end if;

    if (select pg_catalog.count(*) from pg_catalog.jsonb_to_recordset(p_choices)
            as incoming(calendar_id text, selected boolean, sharing_mode text))
       <> (select pg_catalog.count(distinct incoming.calendar_id)
           from pg_catalog.jsonb_to_recordset(p_choices)
                as incoming(calendar_id text, selected boolean, sharing_mode text)) then
        raise exception 'Duplicate Google calendar choice'
            using errcode = '22023';
    end if;

    for choice in
        select incoming.calendar_id, incoming.selected, incoming.sharing_mode
        from pg_catalog.jsonb_to_recordset(p_choices)
            as incoming(calendar_id text, selected boolean, sharing_mode text)
    loop
        if choice.calendar_id is null or choice.selected is null
            or choice.sharing_mode not in ('private', 'household')
            or (not choice.selected and choice.sharing_mode <> 'private') then
            raise exception 'Invalid Google calendar choice'
                using errcode = '22023';
        end if;

        update private.google_calendars calendar
        set is_selected = choice.selected,
            sharing_mode = choice.sharing_mode
        where calendar.connection_id = connection.id
          and calendar.google_calendar_id = choice.calendar_id
          and calendar.calendar_access_status = 'available';
        if not found then
            raise exception 'Google calendar is no longer available'
                using errcode = '42501';
        end if;
    end loop;
end;
$$;

CREATE FUNCTION public.google_calendar_shared_freshness(p_viewer_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_household_id uuid;
    sources jsonb;
begin
    select profile.household_id into current_household_id
    from public.profiles profile
    where profile.id = p_viewer_user_id;

    if current_household_id is null then
        raise exception 'Google Calendar requires a current household profile'
            using errcode = '42501';
    end if;

    select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
            'connectionStatus', connection.connection_status,
            'accessStatus', calendar.calendar_access_status,
            'syncStatus', calendar.sync_status,
            'lastSuccessfulSyncAt', calendar.last_successful_sync_at,
            'syncErrorCode', case when calendar.sync_status = 'failed'
                then calendar.last_error_code else null end
        ) order by calendar.google_calendar_id
    ), '[]'::jsonb)
    into sources
    from private.google_calendars calendar
    join private.google_connections connection
      on connection.id = calendar.connection_id
     and connection.household_id = calendar.household_id
    where calendar.household_id = current_household_id
      and calendar.is_selected
      and calendar.sharing_mode = 'household';

    return pg_catalog.jsonb_build_object('sources', sources);
end;
$$;

CREATE FUNCTION public.google_calendar_sync_begin_selected(p_owner_user_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_sync_claim_next(
    p_owner_user_id uuid,
    p_lease_id uuid,
    p_lease_expires_at timestamp with time zone
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_sync_commit_page(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint,
    p_events jsonb,
    p_removed_event_ids jsonb,
    p_next_page_token text,
    p_next_sync_token text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_sync_fail(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint,
    p_error_code text
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_sync_mark_lost(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.google_calendar_sync_reset_to_rebuild(
    p_owner_user_id uuid,
    p_calendar_row_id uuid,
    p_run_id uuid,
    p_lease_id uuid,
    p_generation bigint
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

-- Triggers

create trigger google_calendars_purge_unavailable_events
after update of is_selected, calendar_access_status on private.google_calendars
for each row execute function private.purge_unavailable_google_calendar_events();

create trigger google_calendars_validate_write
before insert or update on private.google_calendars
for each row execute function private.validate_google_calendar_write();

create trigger google_calendars_z_clear_invalid_sync_lease
before insert or update on private.google_calendars
for each row execute function private.clear_invalid_google_calendar_sync_lease();

create trigger google_connections_invalidate_unavailable
after update of connection_status on private.google_connections
for each row execute function private.invalidate_unavailable_google_connection_runs();

create trigger google_connections_validate_write
before insert or update on private.google_connections
for each row execute function private.validate_google_connection_write();

create trigger imported_calendar_events_validate_write
before insert or update on public.imported_calendar_events
for each row execute function private.validate_imported_calendar_event_write();

-- Row-level security

ALTER TABLE private.google_calendars ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.google_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.imported_calendar_events ENABLE ROW LEVEL SECURITY;

-- Policies

create policy imported_calendar_events_select_for_visible_source
on public.imported_calendar_events
for select
to authenticated
using ((select private.can_read_imported_calendar_event(
    household_id, connection_id, google_calendar_id
)));

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON FUNCTION private.can_read_imported_calendar_event(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.clear_invalid_google_calendar_sync_lease() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.invalidate_unavailable_google_connection_runs() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.purge_unavailable_google_calendar_events() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_google_calendar_write() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_google_connection_write() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_imported_calendar_event_write() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_acquire_refresh_lease(uuid, uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_connection_credentials(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_connection_status(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_disconnect(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_mark_reconnect_required(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_oauth_begin(uuid, bytea, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_oauth_complete(uuid, uuid, bytea, text, text[]) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_oauth_consume_state(bytea) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_refresh_list(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_release_refresh_lease(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_save_choices(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_shared_freshness(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_sync_begin_selected(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_sync_claim_next(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_sync_commit_page(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_sync_fail(uuid, uuid, uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_sync_mark_lost(uuid, uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.google_calendar_sync_reset_to_rebuild(uuid, uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE private.google_calendars FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE private.google_connections FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.imported_calendar_events FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON FUNCTION private.can_read_imported_calendar_event(target_household_id uuid, target_connection_id
    uuid, target_google_calendar_id text) TO authenticated;
GRANT ALL ON FUNCTION public.google_calendar_acquire_refresh_lease(p_owner_user_id uuid, p_connection_id uuid,
    p_lease_id uuid, p_lease_expires_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_connection_credentials(p_owner_user_id uuid, p_connection_id uuid)
    TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_connection_status(p_owner_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_disconnect(p_owner_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_mark_reconnect_required(p_owner_user_id uuid, p_connection_id
    uuid, p_connection_connected_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_oauth_begin(p_owner_user_id uuid, p_state_hash bytea, p_state_expires_at
    timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_oauth_complete(p_owner_user_id uuid, p_connection_id uuid, p_encrypted_refresh_token
    bytea, p_token_key_version text, p_granted_scopes text[]) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_oauth_consume_state(p_state_hash bytea) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_refresh_list(p_owner_user_id uuid, p_connection_id uuid, p_calendar_list
    jsonb) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_release_refresh_lease(p_connection_id uuid, p_lease_id uuid) TO
    service_role;
GRANT ALL ON FUNCTION public.google_calendar_save_choices(p_owner_user_id uuid, p_connection_id uuid, p_choices
    jsonb) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_shared_freshness(p_viewer_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_sync_begin_selected(p_owner_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_sync_claim_next(p_owner_user_id uuid, p_lease_id uuid, p_lease_expires_at
    timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_sync_commit_page(p_owner_user_id uuid, p_calendar_row_id uuid,
    p_run_id uuid, p_lease_id uuid, p_generation bigint, p_events jsonb, p_removed_event_ids jsonb, p_next_page_token
    text, p_next_sync_token text) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_sync_fail(p_owner_user_id uuid, p_calendar_row_id uuid, p_run_id
    uuid, p_lease_id uuid, p_generation bigint, p_error_code text) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_sync_mark_lost(p_owner_user_id uuid, p_calendar_row_id uuid, p_run_id
    uuid, p_lease_id uuid, p_generation bigint) TO service_role;
GRANT ALL ON FUNCTION public.google_calendar_sync_reset_to_rebuild(p_owner_user_id uuid, p_calendar_row_id
    uuid, p_run_id uuid, p_lease_id uuid, p_generation bigint) TO service_role;
GRANT ALL ON TABLE private.google_calendars TO service_role;
GRANT ALL ON TABLE private.google_connections TO service_role;
GRANT ALL ON TABLE public.imported_calendar_events TO service_role;
GRANT SELECT (id, household_id, title, description, location, html_link, all_day, starts_at, ends_at, time_zone,
    start_date, end_date, google_updated_at, imported_at, synced_at) ON TABLE public.imported_calendar_events
    TO authenticated;
