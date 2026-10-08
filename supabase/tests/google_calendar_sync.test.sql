begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
    '11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'sync-owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.households (id, name)
values ('21000000-0000-4000-8000-000000000001', 'Sync test household');
insert into public.profiles (id, household_id, name)
values ('11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Sync owner');

insert into private.google_connections (
    id, household_id, owner_user_id, encrypted_refresh_token, token_key_version,
    granted_scopes, connection_status, connected_at
) values (
    '71000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    decode('01', 'hex'), 'test-v1', array['calendar.events.readonly'], 'connected', now()
);
insert into private.google_calendars (
    id, connection_id, household_id, google_calendar_id, display_name,
    time_zone, is_selected, sharing_mode, sync_token
) values (
    '81000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'primary@example.com', 'Primary', 'UTC', true, 'private', 'expired-sync-token'
);
insert into public.imported_calendar_events (
    household_id, connection_id, google_calendar_id, google_event_id,
    title, all_day, start_date, end_date, synced_at
) values
    ('21000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'primary@example.com', 'historic-event', 'Historic event', true, '2000-01-01', '2000-01-02', now() - interval '1 day'),
    ('21000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'primary@example.com', 'future-event', 'Future event', true, '2099-01-01', '2099-01-02', now() - interval '1 day');

create temporary table sync_claims (label text primary key, payload jsonb);

select extensions.is(
    public.google_calendar_sync_begin_selected('11000000-0000-4000-8000-000000000001'),
    1,
    'begin starts the selected calendar'
);

insert into sync_claims values (
    'first', public.google_calendar_sync_claim_next(
        '11000000-0000-4000-8000-000000000001',
        'a1100000-0000-4000-8000-000000000001', now() + interval '1 minute'
    )
);
select extensions.is((select payload->>'googleCalendarId' from sync_claims where label = 'first'), 'primary@example.com', 'worker claims the selected calendar');
select extensions.is((select payload->>'runKind' from sync_claims where label = 'first'), 'incremental', 'saved sync token starts an incremental run');
select extensions.is(
    public.google_calendar_sync_claim_next('11000000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000002', now() + interval '1 minute'),
    null::jsonb,
    'a second worker cannot claim a calendar with an active lease'
);

update private.google_calendars
set sync_lease_expires_at = now() - interval '1 second'
where id = '81000000-0000-4000-8000-000000000001';
insert into sync_claims values (
    'reclaimed', public.google_calendar_sync_claim_next(
        '11000000-0000-4000-8000-000000000001',
        'a1100000-0000-4000-8000-000000000003', now() + interval '1 minute'
    )
);
select extensions.is((select payload->>'googleCalendarId' from sync_claims where label = 'reclaimed'), 'primary@example.com', 'worker reclaims a calendar after its lease expires');
select extensions.is((select sync_lease_id from private.google_calendars where id = '81000000-0000-4000-8000-000000000001'), 'a1100000-0000-4000-8000-000000000003'::uuid, 'reclaim replaces the expired lease owner');

select extensions.ok(
    public.google_calendar_sync_reset_to_rebuild(
        '11000000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        ((select payload->>'runId' from sync_claims where label = 'reclaimed')::uuid),
        'a1100000-0000-4000-8000-000000000003',
        ((select payload->>'generation' from sync_claims where label = 'reclaimed')::bigint)
    ),
    '410 recovery resets the expired-token run into a rebuild'
);
select extensions.ok(
    (select sync_run_kind = 'rebuild' and sync_token is null and sync_page_token is null
        and sync_lease_id is null and sync_lease_expires_at is null and initial_sync_time_min is not null
     from private.google_calendars where id = '81000000-0000-4000-8000-000000000001'),
    'rebuild starts from a fresh cutoff and clears the old token and lease'
);
select extensions.is((select count(*)::integer from public.imported_calendar_events where connection_id = '71000000-0000-4000-8000-000000000001'), 2, '410 recovery keeps imported events until the rebuild finishes');

insert into sync_claims values (
    'rebuild', public.google_calendar_sync_claim_next(
        '11000000-0000-4000-8000-000000000001',
        'a1100000-0000-4000-8000-000000000004', now() + interval '1 minute'
    )
);
select extensions.is((select payload->>'runKind' from sync_claims where label = 'rebuild'), 'rebuild', 'worker claims the replacement rebuild run');

-- Give the run a later start time so fixture rows represent events imported
-- before this rebuild, while retaining the fresh cutoff generated by recovery.
update private.google_calendars
set sync_started_at = now() + interval '1 day'
where id = '81000000-0000-4000-8000-000000000001';

insert into sync_claims values (
    'commit', public.google_calendar_sync_commit_page(
        '11000000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        ((select payload->>'runId' from sync_claims where label = 'rebuild')::uuid),
        'a1100000-0000-4000-8000-000000000004',
        ((select payload->>'generation' from sync_claims where label = 'rebuild')::bigint),
        '[]'::jsonb, '[]'::jsonb, null, 'replacement-sync-token'
    )
);
select extensions.is((select payload->>'complete' from sync_claims where label = 'commit'), 'true', 'final rebuild page commits successfully');
select extensions.ok(exists(select 1 from public.imported_calendar_events where connection_id = '71000000-0000-4000-8000-000000000001' and google_event_id = 'historic-event'), 'rebuild preserves past imported events');
select extensions.ok(not exists(select 1 from public.imported_calendar_events where connection_id = '71000000-0000-4000-8000-000000000001' and google_event_id = 'future-event'), 'rebuild removes stale current and future imported events');
select extensions.ok(
    (select sync_status = 'idle' and sync_token = 'replacement-sync-token' and sync_run_id is null
        and sync_run_kind is null and sync_lease_id is null
     from private.google_calendars where id = '81000000-0000-4000-8000-000000000001'),
    'completed rebuild saves the new sync token and clears its run state'
);

select * from extensions.finish();
rollback;
