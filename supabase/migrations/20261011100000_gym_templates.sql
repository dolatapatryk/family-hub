-- Private, versioned training templates. Plans and workout history are added
-- in later migrations; a template is already stored as an immutable-shaped
-- definition document so the future plan snapshot can copy it in one read.
create table public.gym_templates (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    weeks_count smallint not null,
    days_per_week smallint not null,
    definition jsonb not null,
    definition_version smallint not null default 1,
    revision integer not null default 1,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint gym_templates_name_not_blank check (char_length(btrim(name)) between 1 and 120),
    constraint gym_templates_weeks_count_range check (weeks_count between 1 and 52),
    constraint gym_templates_days_per_week_range check (days_per_week between 1 and 7),
    constraint gym_templates_definition_object check (jsonb_typeof(definition) = 'object'),
    constraint gym_templates_definition_version_supported check (definition_version = 1),
    constraint gym_templates_revision_positive check (revision > 0),
    constraint gym_templates_id_owner_unique unique (id, owner_user_id)
);

create index gym_templates_owner_updated_idx
    on public.gym_templates (owner_user_id, archived_at, updated_at desc);

alter table public.gym_templates enable row level security;

create policy gym_templates_select_own
on public.gym_templates
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on table public.gym_templates from public, anon, authenticated;
grant select (
    id, owner_user_id, name, weeks_count, days_per_week, definition,
    definition_version, revision, archived_at, created_at, updated_at
) on table public.gym_templates to authenticated;

-- PostgreSQL exposes jsonb_object_keys, but not jsonb_object_length on every
-- supported server version. Count the object's keys through the stable API.
create function private.gym_jsonb_object_length(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
    select pg_catalog.count(*)::integer
    from pg_catalog.jsonb_object_keys(p_value) as object_key(key);
$$;

revoke all on function private.gym_jsonb_object_length(jsonb) from public, anon, authenticated;

create function private.validate_gym_template_definition(
    p_definition jsonb,
    p_days_per_week smallint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
    day_value jsonb;
    block_value jsonb;
    exercise_value jsonb;
    days_value jsonb;
    blocks_value jsonb;
    exercises_value jsonb;
    item_id uuid;
    item_id_text text;
    item_type text;
    item_name text;
    item_sets numeric;
    item_target_min numeric;
    item_target_max numeric;
    seen_ids uuid[] := array[]::uuid[];
    day_number integer := 0;
    block_number integer;
    exercise_number integer;
begin
    if p_definition is null or pg_catalog.jsonb_typeof(p_definition) <> 'object' then
        raise exception 'Template definition must be a JSON object' using errcode = '22023';
    end if;
    if pg_catalog.octet_length(p_definition::text) > 262144 then
        raise exception 'Template definition exceeds the 256 KiB size limit' using errcode = '22023';
    end if;
    if private.gym_jsonb_object_length(p_definition) <> 1
       or not (p_definition ?& array['days']) then
        raise exception 'Template definition must contain only a days array' using errcode = '22023';
    end if;
    days_value := p_definition -> 'days';
    if pg_catalog.jsonb_typeof(days_value) <> 'array'
       or pg_catalog.jsonb_array_length(days_value) <> p_days_per_week then
        raise exception 'Template must contain exactly the configured number of days' using errcode = '22023';
    end if;

    for day_value in select element.value from pg_catalog.jsonb_array_elements(days_value) as element(value)
    loop
        day_number := day_number + 1;
        if pg_catalog.jsonb_typeof(day_value) <> 'object'
           or private.gym_jsonb_object_length(day_value) <> 3
           or not (day_value ?& array['id', 'name', 'blocks']) then
            raise exception 'Day % must contain only id, name, and blocks', day_number using errcode = '22023';
        end if;

        if pg_catalog.jsonb_typeof(day_value -> 'id') <> 'string' then
            raise exception 'Day % has an invalid id', day_number using errcode = '22023';
        end if;
        item_id_text := day_value ->> 'id';
        if item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
            raise exception 'Day % has an invalid id', day_number using errcode = '22023';
        end if;
        item_id := item_id_text::uuid;
        if item_id = any(seen_ids) then raise exception 'Definition ids must be unique' using errcode = '22023'; end if;
        seen_ids := pg_catalog.array_append(seen_ids, item_id);

        if pg_catalog.jsonb_typeof(day_value -> 'name') <> 'string'
           or pg_catalog.char_length(day_value ->> 'name') > 80 then
            raise exception 'Day % name must be text of at most 80 characters', day_number using errcode = '22023';
        end if;
        blocks_value := day_value -> 'blocks';
        if pg_catalog.jsonb_typeof(blocks_value) <> 'array'
           or pg_catalog.jsonb_array_length(blocks_value) < 1 then
            raise exception 'Day % must contain at least one block', day_number using errcode = '22023';
        end if;

        block_number := 0;
        for block_value in select element.value from pg_catalog.jsonb_array_elements(blocks_value) as element(value)
        loop
            block_number := block_number + 1;
            if pg_catalog.jsonb_typeof(block_value) <> 'object'
               or private.gym_jsonb_object_length(block_value) <> 3
               or not (block_value ?& array['id', 'type', 'exercises']) then
                raise exception 'Day %, block % must contain only id, type, and exercises', day_number, block_number using errcode = '22023';
            end if;

            if pg_catalog.jsonb_typeof(block_value -> 'id') <> 'string' then
                raise exception 'Day %, block % has an invalid id', day_number, block_number using errcode = '22023';
            end if;
            item_id_text := block_value ->> 'id';
            if item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
                raise exception 'Day %, block % has an invalid id', day_number, block_number using errcode = '22023';
            end if;
            item_id := item_id_text::uuid;
            if item_id = any(seen_ids) then raise exception 'Definition ids must be unique' using errcode = '22023'; end if;
            seen_ids := pg_catalog.array_append(seen_ids, item_id);

            if pg_catalog.jsonb_typeof(block_value -> 'type') <> 'string'
               or block_value ->> 'type' not in ('single', 'superset') then
                raise exception 'Day %, block % has an unsupported type', day_number, block_number using errcode = '22023';
            end if;
            item_type := block_value ->> 'type';
            exercises_value := block_value -> 'exercises';
            if pg_catalog.jsonb_typeof(exercises_value) <> 'array' then
                raise exception 'Day %, block % exercises must be an array', day_number, block_number using errcode = '22023';
            end if;
            if (item_type = 'single' and pg_catalog.jsonb_array_length(exercises_value) <> 1)
               or (item_type = 'superset' and pg_catalog.jsonb_array_length(exercises_value) < 2) then
                raise exception 'Day %, block % has the wrong number of exercises for its type', day_number, block_number using errcode = '22023';
            end if;

            exercise_number := 0;
            for exercise_value in select element.value from pg_catalog.jsonb_array_elements(exercises_value) as element(value)
            loop
                exercise_number := exercise_number + 1;
                if pg_catalog.jsonb_typeof(exercise_value) <> 'object'
                   or private.gym_jsonb_object_length(exercise_value) <> 8
                   or not (exercise_value ?& array['id', 'name', 'sets', 'mode', 'target_min', 'target_max', 'unilateral', 'load_type']) then
                    raise exception 'Day %, block %, exercise % has an invalid shape', day_number, block_number, exercise_number using errcode = '22023';
                end if;

                if pg_catalog.jsonb_typeof(exercise_value -> 'id') <> 'string' then
                    raise exception 'Day %, block %, exercise % has an invalid id', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                item_id_text := exercise_value ->> 'id';
                if item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
                    raise exception 'Day %, block %, exercise % has an invalid id', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                item_id := item_id_text::uuid;
                if item_id = any(seen_ids) then raise exception 'Definition ids must be unique' using errcode = '22023'; end if;
                seen_ids := pg_catalog.array_append(seen_ids, item_id);

                if pg_catalog.jsonb_typeof(exercise_value -> 'name') <> 'string' then
                    raise exception 'Day %, block %, exercise % name must be text', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                item_name := pg_catalog.btrim(exercise_value ->> 'name');
                if item_name = '' or pg_catalog.char_length(item_name) > 100 then
                    raise exception 'Day %, block %, exercise % name must contain 1 to 100 characters', day_number, block_number, exercise_number using errcode = '22023';
                end if;

                if pg_catalog.jsonb_typeof(exercise_value -> 'sets') <> 'number' then
                    raise exception 'Day %, block %, exercise % sets must be a positive integer', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                item_sets := (exercise_value ->> 'sets')::numeric;
                if item_sets < 1 or item_sets > 2147483647 or item_sets <> pg_catalog.trunc(item_sets) then
                    raise exception 'Day %, block %, exercise % sets must be a positive integer', day_number, block_number, exercise_number using errcode = '22023';
                end if;

                if pg_catalog.jsonb_typeof(exercise_value -> 'mode') <> 'string'
                   or exercise_value ->> 'mode' not in ('reps', 'time') then
                    raise exception 'Day %, block %, exercise % mode must be reps or time', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                if pg_catalog.jsonb_typeof(exercise_value -> 'target_min') <> 'number'
                   or pg_catalog.jsonb_typeof(exercise_value -> 'target_max') <> 'number' then
                    raise exception 'Day %, block %, exercise % target must be a positive integer range', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                item_target_min := (exercise_value ->> 'target_min')::numeric;
                item_target_max := (exercise_value ->> 'target_max')::numeric;
                if item_target_min < 1 or item_target_max < 1
                   or item_target_min > 2147483647 or item_target_max > 2147483647
                   or item_target_min <> pg_catalog.trunc(item_target_min)
                   or item_target_max <> pg_catalog.trunc(item_target_max)
                   or item_target_min > item_target_max then
                    raise exception 'Day %, block %, exercise % target must be a positive integer range with minimum <= maximum', day_number, block_number, exercise_number using errcode = '22023';
                end if;

                if pg_catalog.jsonb_typeof(exercise_value -> 'unilateral') <> 'boolean' then
                    raise exception 'Day %, block %, exercise % unilateral must be boolean', day_number, block_number, exercise_number using errcode = '22023';
                end if;
                if pg_catalog.jsonb_typeof(exercise_value -> 'load_type') <> 'string'
                   or exercise_value ->> 'load_type' not in ('weight', 'bodyweight') then
                    raise exception 'Day %, block %, exercise % load_type must be weight or bodyweight', day_number, block_number, exercise_number using errcode = '22023';
                end if;
            end loop;
        end loop;
    end loop;
end;
$$;

revoke all on function private.validate_gym_template_definition(jsonb, smallint) from public, anon, authenticated;

create function public.save_gym_template(
    p_template_id uuid,
    p_expected_revision integer,
    p_name text,
    p_weeks_count smallint,
    p_days_per_week smallint,
    p_definition jsonb,
    p_definition_version smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    normalized_name text := pg_catalog.btrim(p_name);
    template_revision integer;
    new_template_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to save a training template' using errcode = '42501';
    end if;
    if normalized_name is null or pg_catalog.char_length(normalized_name) = 0 or pg_catalog.char_length(normalized_name) > 120 then
        raise exception 'Template name must contain 1 to 120 characters' using errcode = '22023';
    end if;
    if p_weeks_count is null or p_weeks_count not between 1 and 52 then
        raise exception 'Template duration must be between 1 and 52 weeks' using errcode = '22023';
    end if;
    if p_days_per_week is null or p_days_per_week not between 1 and 7 then
        raise exception 'Training days per week must be between 1 and 7' using errcode = '22023';
    end if;
    if p_definition_version is distinct from 1 then
        raise exception 'Unsupported template definition version' using errcode = '22023';
    end if;
    perform private.validate_gym_template_definition(p_definition, p_days_per_week);

    if p_template_id is null then
        if p_expected_revision is not null then
            raise exception 'A new template cannot have an expected revision' using errcode = '22023';
        end if;
        insert into public.gym_templates (
            owner_user_id, name, weeks_count, days_per_week, definition, definition_version
        ) values (
            current_user_id, normalized_name, p_weeks_count, p_days_per_week, p_definition, p_definition_version
        ) returning id into new_template_id;
        return new_template_id;
    end if;

    select revision into template_revision
    from public.gym_templates
    where id = p_template_id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Training template was not found' using errcode = '42501';
    end if;
    if exists (
        select 1 from public.gym_templates
        where id = p_template_id and owner_user_id = current_user_id and archived_at is not null
    ) then
        raise exception 'Archived templates cannot be edited' using errcode = '22023';
    end if;
    if p_expected_revision is null or template_revision <> p_expected_revision then
        raise exception 'This template changed elsewhere. Reload it before saving your changes.' using errcode = '40001';
    end if;

    update public.gym_templates
    set name = normalized_name,
        weeks_count = p_weeks_count,
        days_per_week = p_days_per_week,
        definition = p_definition,
        definition_version = p_definition_version,
        revision = revision + 1,
        updated_at = pg_catalog.now()
    where id = p_template_id and owner_user_id = current_user_id;
    return p_template_id;
end;
$$;

revoke all on function public.save_gym_template(uuid, integer, text, smallint, smallint, jsonb, smallint) from public, anon, authenticated;
grant execute on function public.save_gym_template(uuid, integer, text, smallint, smallint, jsonb, smallint) to authenticated;

create function public.archive_gym_template(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
begin
    if current_user_id is null then
        raise exception 'Authentication is required to archive a training template' using errcode = '42501';
    end if;
    update public.gym_templates
    set archived_at = coalesce(archived_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    where id = p_template_id and owner_user_id = current_user_id;
    if not found then
        raise exception 'Training template was not found' using errcode = '42501';
    end if;
    return p_template_id;
end;
$$;

revoke all on function public.archive_gym_template(uuid) from public, anon, authenticated;
grant execute on function public.archive_gym_template(uuid) to authenticated;
