-- Households, member profiles, onboarding and invitations. Shared authorization helpers.
-- Fresh-install schema; definitions include all prior fixes.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Tables

CREATE TABLE public.households (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint households_name_not_blank check (char_length(btrim(name)) > 0),
    CONSTRAINT households_pkey PRIMARY KEY (id)
);

CREATE TABLE private.household_invites (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by uuid,
    constraint household_invites_consumption_after_creation
        check (used_at is null or used_at >= created_at),
    constraint household_invites_expiry_after_creation
        check (expires_at > created_at),
    CONSTRAINT household_invites_pkey PRIMARY KEY (token),
    CONSTRAINT household_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE
        CASCADE,
    CONSTRAINT household_invites_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE,
    CONSTRAINT household_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    household_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint profiles_name_not_blank check (char_length(btrim(name)) > 0),
    CONSTRAINT profiles_household_user_unique UNIQUE (household_id, id),
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE
        CASCADE,
    CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Indexes

create index household_invites_household_id_idx
    on private.household_invites (household_id);

create index profiles_household_id_idx
    on public.profiles (household_id);

-- Functions

CREATE FUNCTION private.is_household_member(target_household_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    select exists (
        select 1
        from public.profiles
        where public.profiles.id = (select auth.uid())
          and public.profiles.household_id = target_household_id
    );
$$;

CREATE FUNCTION public.create_household(household_name text, profile_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    new_household_id uuid;
    current_user_id uuid := (select auth.uid());
    normalized_household_name text := pg_catalog.btrim(household_name);
    normalized_profile_name text := pg_catalog.btrim(profile_name);
begin
    if current_user_id is null then
        raise exception 'Authentication is required to create a household'
            using errcode = '42501';
    end if;

    if pg_catalog.char_length(normalized_household_name) = 0 then
        raise exception 'Household name must not be blank'
            using errcode = '22023';
    end if;

    if pg_catalog.char_length(normalized_profile_name) = 0 then
        raise exception 'Profile name must not be blank'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.profiles
        where public.profiles.id = current_user_id
    ) then
        raise exception 'User already belongs to a household'
            using errcode = '23505';
    end if;

    insert into public.households (name)
    values (normalized_household_name)
    returning public.households.id into new_household_id;

    insert into public.profiles (id, household_id, name)
    values (current_user_id, new_household_id, normalized_profile_name);

    return new_household_id;
end;
$$;

CREATE FUNCTION public.create_household_invite(

) RETURNS TABLE(invite_token uuid, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.join_household(p_invite_token text, p_profile_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

-- Row-level security

ALTER TABLE private.household_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policies

create policy households_select_for_members
on public.households
for select
to authenticated
using ((select private.is_household_member(id)));

create policy profiles_select_for_members
on public.profiles
for select
to authenticated
using ((select private.is_household_member(household_id)));

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON FUNCTION private.is_household_member(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_household(text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_household_invite() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.join_household(text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE private.household_invites FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.households FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON FUNCTION private.is_household_member(target_household_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_household(household_name text, profile_name text) TO service_role;
GRANT ALL ON FUNCTION public.create_household(household_name text, profile_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_household_invite() TO service_role;
GRANT ALL ON FUNCTION public.create_household_invite() TO authenticated;
GRANT ALL ON FUNCTION public.join_household(p_invite_token text, p_profile_name text) TO service_role;
GRANT ALL ON FUNCTION public.join_household(p_invite_token text, p_profile_name text) TO authenticated;
GRANT ALL ON TABLE public.households TO service_role;
GRANT SELECT ON TABLE public.households TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;
