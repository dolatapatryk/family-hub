-- One-time household invitations are stored outside the exposed API schema.
-- The browser can only create an invite or redeem a code through the RPCs below.
create table private.household_invites (
    token uuid primary key default pg_catalog.gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    created_by uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default pg_catalog.now(),
    expires_at timestamptz not null,
    used_at timestamptz,
    used_by uuid references auth.users (id) on delete set null,
    constraint household_invites_expiry_after_creation
        check (expires_at > created_at),
    constraint household_invites_consumption_after_creation
        check (used_at is null or used_at >= created_at)
);

create index household_invites_household_id_idx
    on private.household_invites (household_id);

alter table private.household_invites enable row level security;
revoke all on table private.household_invites from public, anon, authenticated;

-- Any existing household member can create a 24-hour invite. The opaque UUID
-- is returned once; only its private table row can resolve it to a household.
create or replace function public.create_household_invite()
returns table (invite_token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    target_household_id uuid;
    new_token uuid := pg_catalog.gen_random_uuid();
    new_expiration timestamptz := pg_catalog.now() + interval '24 hours';
begin
    if current_user_id is null then
        raise exception 'Authentication is required to create a household invite'
            using errcode = '42501';
    end if;

    select profile.household_id
    into target_household_id
    from public.profiles as profile
    where profile.id = current_user_id;

    if target_household_id is null then
        raise exception 'You must belong to a household to create an invite'
            using errcode = '42501';
    end if;

    insert into private.household_invites (token, household_id, created_by, expires_at)
    values (new_token, target_household_id, current_user_id, new_expiration);

    return query select new_token, new_expiration;
end;
$$;

revoke all on function public.create_household_invite() from public, anon, authenticated;
grant execute on function public.create_household_invite() to authenticated;

-- Redemption checks and consumes the invite in one transaction, then creates
-- the caller's own profile. No household or profile ID comes from the browser.
create or replace function public.join_household(
    p_invite_token text,
    p_profile_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    normalized_profile_name text := pg_catalog.btrim(p_profile_name);
    target_household_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to join a household'
            using errcode = '42501';
    end if;

    if normalized_profile_name is null
        or pg_catalog.char_length(normalized_profile_name) = 0 then
        raise exception 'Profile name must not be blank'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.profiles as profile
        where profile.id = current_user_id
    ) then
        raise exception 'User already belongs to a household'
            using errcode = '23505';
    end if;

    update private.household_invites as invite
    set used_at = pg_catalog.clock_timestamp(),
        used_by = current_user_id
    where invite.token::text = pg_catalog.lower(pg_catalog.btrim(p_invite_token))
      and invite.used_at is null
      and invite.expires_at > pg_catalog.now()
    returning invite.household_id into target_household_id;

    if target_household_id is null then
        raise exception 'Invite is invalid, expired, or already used'
            using errcode = '22023';
    end if;

    insert into public.profiles (id, household_id, name)
    values (current_user_id, target_household_id, normalized_profile_name);

    return target_household_id;
end;
$$;

revoke all on function public.join_household(text, text) from public, anon, authenticated;
grant execute on function public.join_household(text, text) to authenticated;
