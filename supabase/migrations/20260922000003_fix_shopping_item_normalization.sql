-- NULLIF is PostgreSQL syntax rather than a schema-qualified function.
-- Replace the trigger body for databases that already applied the original
-- shopping schema migration.
create or replace function private.normalize_shopping_item_texts()
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
