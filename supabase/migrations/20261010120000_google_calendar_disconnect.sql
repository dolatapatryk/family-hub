-- Removing the connection row atomically invalidates sync state and cascades
-- through calendars and imported events. Return only the encrypted credential
-- so the management Edge Function can attempt revocation after local cleanup.
create function public.google_calendar_disconnect(p_owner_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.google_calendar_disconnect(uuid) from public, anon, authenticated;
grant execute on function public.google_calendar_disconnect(uuid) to service_role;
