-- Household shopping lists: normalized item text and member access.
-- Fresh-install schema; definitions include all prior fixes.

-- Tables

CREATE TABLE public.shopping_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    name text NOT NULL,
    quantity text,
    store text,
    completed boolean DEFAULT false NOT NULL,
    added_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint shopping_items_name_not_blank check (char_length(btrim(name)) > 0),
    CONSTRAINT shopping_items_pkey PRIMARY KEY (id),
    CONSTRAINT shopping_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
    CONSTRAINT shopping_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
        ON DELETE CASCADE
);

-- Indexes

create index shopping_items_household_id_idx
    on public.shopping_items (household_id);

-- Functions

CREATE FUNCTION private.normalize_shopping_item_texts() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
    new.name := pg_catalog.btrim(new.name);
    new.quantity := nullif(pg_catalog.btrim(new.quantity), '');
    new.store := nullif(pg_catalog.btrim(new.store), '');
    return new;
end;
$$;

-- Triggers

create trigger shopping_items_normalize_texts
before insert or update of name, quantity, store
on public.shopping_items
for each row
execute function private.normalize_shopping_item_texts();

-- Row-level security

ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;

-- Policies

create policy shopping_items_delete_for_members
on public.shopping_items
for delete
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

create policy shopping_items_select_for_members
on public.shopping_items
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy shopping_items_update_for_members
on public.shopping_items
for update
to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON TABLE public.shopping_items FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON TABLE public.shopping_items TO service_role;
GRANT SELECT,DELETE ON TABLE public.shopping_items TO authenticated;

GRANT INSERT (name, quantity, store, household_id, added_by) ON TABLE public.shopping_items TO authenticated;
GRANT UPDATE (name, quantity, store, completed) ON TABLE public.shopping_items TO authenticated;
