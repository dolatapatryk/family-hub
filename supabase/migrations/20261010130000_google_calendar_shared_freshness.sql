create function public.google_calendar_shared_freshness(p_viewer_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.google_calendar_shared_freshness(uuid)
    from public, anon, authenticated;
grant execute on function public.google_calendar_shared_freshness(uuid)
    to service_role;
