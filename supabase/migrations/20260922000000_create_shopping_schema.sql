create schema if not exists private;

create table public.households (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now(),
    constraint households_name_not_blank check (char_length(btrim(name)) > 0)
);

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    household_id uuid not null references public.households (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    constraint profiles_name_not_blank check (char_length(btrim(name)) > 0)
);

create table public.shopping_items (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    name text not null,
    quantity text,
    store text,
    completed boolean not null default false,
    added_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint shopping_items_name_not_blank check (char_length(btrim(name)) > 0)
);

create index profiles_household_id_idx
    on public.profiles (household_id);

create index shopping_items_household_id_idx
    on public.shopping_items (household_id);

-- Keep the normalization currently performed by the Kotlin shopping domain
-- when writes come directly from the browser.
create function private.normalize_shopping_item_texts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.name := pg_catalog.btrim(new.name);
    new.quantity := nullif(pg_catalog.btrim(new.quantity), '');
    new.store := nullif(pg_catalog.btrim(new.store), '');
    return new;
end;
$$;

create trigger shopping_items_normalize_texts
before insert or update of name, quantity, store
on public.shopping_items
for each row
execute function private.normalize_shopping_item_texts();

-- This function is intentionally kept outside the exposed API schemas. It is
-- used only by RLS policies to answer the current user's membership question.
create function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where public.profiles.id = (select auth.uid())
          and public.profiles.household_id = target_household_id
    );
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;

revoke all on function private.is_household_member(uuid) from public;
grant execute on function private.is_household_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.shopping_items enable row level security;

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

create policy shopping_items_select_for_members
on public.shopping_items
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy shopping_items_insert_for_members
on public.shopping_items
for insert
to authenticated
with check (
    (select private.is_household_member(household_id))
    and added_by = (select auth.uid())
);

create policy shopping_items_update_for_members
on public.shopping_items
for update
to authenticated
using ((select private.is_household_member(household_id)))
with check (
    (select private.is_household_member(household_id))
    and added_by = (select auth.uid())
);

create policy shopping_items_delete_for_members
on public.shopping_items
for delete
to authenticated
using ((select private.is_household_member(household_id)));

-- Explicit grants keep the browser API limited to the operations needed by
-- the app. In particular, scope and audit columns are not client-updatable.
revoke all on table public.households, public.profiles, public.shopping_items
from public, anon, authenticated;

grant select on table public.households, public.profiles, public.shopping_items
to authenticated;

grant insert (household_id, name, quantity, store, added_by)
on table public.shopping_items
to authenticated;

grant update (name, quantity, store, completed)
on table public.shopping_items
to authenticated;

grant delete on table public.shopping_items to authenticated;
