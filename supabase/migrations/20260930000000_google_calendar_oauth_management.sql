-- Narrow service-only RPCs let Edge Functions manage private Google metadata
-- without adding the private schema to the PostgREST exposed schemas.

alter table private.google_connections
    add column token_refresh_lease_id uuid,
    add column token_refresh_lease_expires_at timestamptz,
    add constraint google_connections_refresh_lease_pair check (
        (token_refresh_lease_id is null and token_refresh_lease_expires_at is null)
        or (token_refresh_lease_id is not null and token_refresh_lease_expires_at is not null)
    );

create function public.google_calendar_oauth_begin(
    p_owner_user_id uuid,
    p_state_hash bytea,
    p_state_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_oauth_consume_state(p_state_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_oauth_complete(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_encrypted_refresh_token bytea,
    p_token_key_version text,
    p_granted_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_connection_status(p_owner_user_id uuid)
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
            'lastSuccessfulSyncAt', calendar.last_successful_sync_at
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

create function public.google_calendar_connection_credentials(
    p_owner_user_id uuid,
    p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_acquire_refresh_lease(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_lease_id uuid,
    p_lease_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_release_refresh_lease(
    p_connection_id uuid,
    p_lease_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update private.google_connections connection
    set token_refresh_lease_id = null,
        token_refresh_lease_expires_at = null
    where connection.id = p_connection_id
      and connection.token_refresh_lease_id = p_lease_id;
end;
$$;

create function public.google_calendar_refresh_list(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_calendar_list jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_save_choices(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_choices jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.google_calendar_mark_reconnect_required(
    p_owner_user_id uuid,
    p_connection_id uuid,
    p_connection_connected_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.google_calendar_oauth_begin(uuid, bytea, timestamptz) from public, anon, authenticated;
revoke all on function public.google_calendar_oauth_consume_state(bytea) from public, anon, authenticated;
revoke all on function public.google_calendar_oauth_complete(uuid, uuid, bytea, text, text[]) from public, anon, authenticated;
revoke all on function public.google_calendar_connection_status(uuid) from public, anon, authenticated;
revoke all on function public.google_calendar_connection_credentials(uuid, uuid) from public, anon, authenticated;
revoke all on function public.google_calendar_acquire_refresh_lease(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.google_calendar_release_refresh_lease(uuid, uuid) from public, anon, authenticated;
revoke all on function public.google_calendar_refresh_list(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.google_calendar_save_choices(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.google_calendar_mark_reconnect_required(uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.google_calendar_oauth_begin(uuid, bytea, timestamptz) to service_role;
grant execute on function public.google_calendar_oauth_consume_state(bytea) to service_role;
grant execute on function public.google_calendar_oauth_complete(uuid, uuid, bytea, text, text[]) to service_role;
grant execute on function public.google_calendar_connection_status(uuid) to service_role;
grant execute on function public.google_calendar_connection_credentials(uuid, uuid) to service_role;
grant execute on function public.google_calendar_acquire_refresh_lease(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.google_calendar_release_refresh_lease(uuid, uuid) to service_role;
grant execute on function public.google_calendar_refresh_list(uuid, uuid, jsonb) to service_role;
grant execute on function public.google_calendar_save_choices(uuid, uuid, jsonb) to service_role;
grant execute on function public.google_calendar_mark_reconnect_required(uuid, uuid, timestamptz) to service_role;
