-- A follow-up is required because 20261011100000 may already be deployed.
-- jsonb_object_length is not available in this PostgreSQL environment, so
-- count keys through jsonb_object_keys and redirect the existing validator.
create or replace function private.gym_jsonb_object_length(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
    select pg_catalog.count(*)::integer
    from pg_catalog.jsonb_object_keys(p_value) as object_key(key);
$$;

revoke all on function private.gym_jsonb_object_length(jsonb) from public, anon, authenticated;

do $$
declare
    validator_definition text;
    unsupported_function text := 'pg_catalog.jsonb_object_length';
begin
    validator_definition := pg_catalog.pg_get_functiondef(
        'private.validate_gym_template_definition(jsonb,smallint)'::pg_catalog.regprocedure
    );

    -- Fresh installs already use the supported helper in the earlier
    -- migration. Existing installs still have the old built-in reference.
    if pg_catalog.strpos(validator_definition, unsupported_function) > 0 then
        validator_definition := pg_catalog.replace(
            validator_definition,
            unsupported_function,
            'private.gym_jsonb_object_length'
        );
        execute validator_definition;
    end if;
end;
$$;
