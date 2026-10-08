begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

-- Three members model the connection owner, another household member, and an
-- unrelated household. Fixed IDs are rolled back at the end of this test.
insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'outsider@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.households (id, name) values
    ('20000000-0000-4000-8000-000000000001', 'Test household'),
    ('20000000-0000-4000-8000-000000000002', 'Other household');

insert into public.profiles (id, household_id, name) values
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Owner'),
    ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Member'),
    ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Outsider');

insert into public.shopping_items (id, household_id, name, added_by) values
    ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Milk', '10000000-0000-4000-8000-000000000001'),
    ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Bread', '10000000-0000-4000-8000-000000000003');

insert into public.tasks (id, household_id, title, created_by) values
    ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Shared task', '10000000-0000-4000-8000-000000000001'),
    ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Other task', '10000000-0000-4000-8000-000000000003');

insert into public.calendar_events (
    id, household_id, title, created_by, visibility, all_day, start_date, end_date
) values
    ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Shared event', '10000000-0000-4000-8000-000000000001', 'household', true, '2026-10-10', '2026-10-11'),
    ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Owner private event', '10000000-0000-4000-8000-000000000001', 'private', true, '2026-10-11', '2026-10-12'),
    ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Member private event', '10000000-0000-4000-8000-000000000002', 'private', true, '2026-10-12', '2026-10-13'),
    ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'Other event', '10000000-0000-4000-8000-000000000003', 'household', true, '2026-10-10', '2026-10-11');

insert into public.annual_dates (
    id, household_id, title, created_by, visibility, kind, month, day
) values
    ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Shared date', '10000000-0000-4000-8000-000000000001', 'household', 'other', 10, 10),
    ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Owner private date', '10000000-0000-4000-8000-000000000001', 'private', 'other', 10, 11),
    ('60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Member private date', '10000000-0000-4000-8000-000000000002', 'private', 'other', 10, 12),
    ('60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'Other date', '10000000-0000-4000-8000-000000000003', 'household', 'other', 10, 10);

insert into private.google_connections (
    id, household_id, owner_user_id, encrypted_refresh_token, token_key_version,
    granted_scopes, connection_status, connected_at
) values (
    '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    decode('01', 'hex'), 'test-v1', array['calendar.events.readonly'], 'connected', now()
);

insert into private.google_calendars (
    id, connection_id, household_id, google_calendar_id, display_name,
    is_selected, sharing_mode
) values
    ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'private-calendar', 'Private', true, 'private'),
    ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'shared-calendar', 'Shared', true, 'household');

insert into public.imported_calendar_events (
    id, household_id, connection_id, google_calendar_id, google_event_id,
    title, all_day, start_date, end_date
) values
    ('90000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'private-calendar', 'private-event', 'Private imported event', true, '2026-10-10', '2026-10-11'),
    ('90000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'shared-calendar', 'shared-event', 'Shared imported event', true, '2026-10-11', '2026-10-12');

select extensions.ok(not has_column_privilege('anon', 'public.calendar_events', 'title', 'SELECT'), 'anonymous users cannot read native calendar data');
select extensions.ok(not has_column_privilege('anon', 'public.imported_calendar_events', 'title', 'SELECT'), 'anonymous users cannot read imported calendar data');
select extensions.ok(not has_column_privilege('authenticated', 'public.imported_calendar_events', 'title', 'INSERT'), 'authenticated clients cannot insert imported rows');
select extensions.ok(not has_column_privilege('authenticated', 'public.imported_calendar_events', 'title', 'UPDATE'), 'authenticated clients cannot update imported rows');
select extensions.ok(not has_table_privilege('authenticated', 'public.imported_calendar_events', 'DELETE'), 'authenticated clients cannot delete imported rows');
select extensions.ok(not has_column_privilege('authenticated', 'public.calendar_events', 'created_by', 'UPDATE'), 'calendar ownership fields cannot be changed by clients');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select extensions.is((select count(*)::integer from public.tasks), 1, 'owner reads tasks from their household only');
select extensions.is((select count(*)::integer from public.shopping_items), 1, 'owner reads shopping items from their household only');
select extensions.is((select count(*)::integer from public.calendar_events), 2, 'owner sees shared events and private events they created');
select extensions.ok(exists(select 1 from public.calendar_events where title = 'Owner private event'), 'owner can read their private native event');
select extensions.ok(not exists(select 1 from public.calendar_events where title = 'Member private event'), 'owner cannot read another member private event');
select extensions.is((select count(*)::integer from public.annual_dates), 2, 'owner sees shared dates and private dates they created');
select extensions.ok(not exists(select 1 from public.annual_dates where title = 'Member private date'), 'owner cannot read another member private annual date');
select extensions.is((select count(*)::integer from public.imported_calendar_events), 2, 'connection owner can read private and household imported events');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select extensions.is((select count(*)::integer from public.tasks), 1, 'household member reads the shared task');
select extensions.is((select count(*)::integer from public.shopping_items), 1, 'household member reads the shared shopping item');
select extensions.is((select count(*)::integer from public.calendar_events), 2, 'member sees shared native events and their own private event');
select extensions.ok(exists(select 1 from public.calendar_events where title = 'Member private event'), 'member can read their private native event');
select extensions.ok(not exists(select 1 from public.calendar_events where title = 'Owner private event'), 'member cannot read the owner private native event');
select extensions.is((select count(*)::integer from public.annual_dates), 2, 'member sees shared annual dates and their own private date');
select extensions.ok(not exists(select 1 from public.annual_dates where title = 'Owner private date'), 'member cannot read the owner private annual date');
select extensions.is((select count(*)::integer from public.imported_calendar_events), 1, 'member sees only imported events from household-shared calendars');
select extensions.ok(exists(select 1 from public.imported_calendar_events where title = 'Shared imported event'), 'member can read a household-shared imported event');
select extensions.ok(not exists(select 1 from public.imported_calendar_events where title = 'Private imported event'), 'member cannot read a private imported event');
select extensions.lives_ok(
    $$update public.calendar_events set title = 'Edited by member' where id = '50000000-0000-4000-8000-000000000001'$$,
    'household member can edit a shared native event'
);
select extensions.is((select title from public.calendar_events where id = '50000000-0000-4000-8000-000000000001'), 'Edited by member', 'shared event updates are persisted');
select extensions.throws_ok(
    $$update public.calendar_events set visibility = 'private' where id = '50000000-0000-4000-8000-000000000001'$$,
    '42501', 'Only the creator can change calendar item visibility',
    'household member cannot change another creator visibility setting'
);
select extensions.throws_ok(
    $$update public.annual_dates set visibility = 'private' where id = '60000000-0000-4000-8000-000000000001'$$,
    '42501', 'Only the creator can change calendar item visibility',
    'household member cannot change another creator annual-date visibility setting'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select extensions.is((select count(*)::integer from public.tasks), 1, 'other household reads only its own task');
select extensions.ok(not exists(select 1 from public.tasks where title = 'Shared task'), 'other household cannot read this household task');
select extensions.is((select count(*)::integer from public.shopping_items), 1, 'other household reads only its own shopping item');
select extensions.ok(not exists(select 1 from public.shopping_items where name = 'Milk'), 'other household cannot read this household shopping item');
select extensions.is((select count(*)::integer from public.calendar_events), 1, 'other household reads only its own native event');
select extensions.ok(not exists(select 1 from public.calendar_events where title = 'Shared event'), 'other household cannot read this household event');
select extensions.is((select count(*)::integer from public.annual_dates), 1, 'other household reads only its own annual date');
select extensions.ok(not exists(select 1 from public.annual_dates where title = 'Shared date'), 'other household cannot read this household annual date');
select extensions.is((select count(*)::integer from public.imported_calendar_events), 0, 'other household cannot read imported events');

reset role;
update private.google_calendars
set sharing_mode = 'household'
where id = '80000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.imported_calendar_events), 2, 'changing a source calendar to household immediately exposes its existing imported rows');

select * from extensions.finish();
rollback;
