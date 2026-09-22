-- Application onboarding for the first member of a household.
--
-- The function creates the household and the caller's profile atomically.
-- A later migration can add an invitation/join flow for additional members.

create or replace function public.create_household(
    household_name text,
    profile_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.create_household(text, text) from public, anon, authenticated;
grant execute on function public.create_household(text, text) to authenticated;
