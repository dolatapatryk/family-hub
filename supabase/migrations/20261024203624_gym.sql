-- Private gym templates, plan snapshots, workouts and recorded sets.
-- Fresh-install schema; definitions include all prior fixes.

-- Tables

CREATE TABLE public.gym_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    weeks_count smallint NOT NULL,
    days_per_week smallint NOT NULL,
    definition jsonb NOT NULL,
    definition_version smallint DEFAULT 1 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint gym_templates_days_per_week_range check (days_per_week between 1 and 7),
    constraint gym_templates_definition_object check (jsonb_typeof(definition) = 'object'),
    constraint gym_templates_definition_version_supported check (definition_version = 1),
    constraint gym_templates_name_not_blank check (char_length(btrim(name)) between 1 and 120),
    constraint gym_templates_revision_positive check (revision > 0),
    constraint gym_templates_weeks_count_range check (weeks_count between 1 and 52),
    CONSTRAINT gym_templates_id_owner_unique UNIQUE (id, owner_user_id),
    CONSTRAINT gym_templates_pkey PRIMARY KEY (id),
    CONSTRAINT gym_templates_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE
        CASCADE
);

CREATE TABLE public.gym_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    source_template_id uuid,
    name text NOT NULL,
    weeks_count smallint NOT NULL,
    days_per_week smallint NOT NULL,
    definition_snapshot jsonb NOT NULL,
    definition_version smallint DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    abandoned_at timestamp with time zone,
    constraint gym_plans_days_per_week_range check (days_per_week between 1 and 7),
    constraint gym_plans_definition_object check (jsonb_typeof(definition_snapshot) = 'object'),
    constraint gym_plans_definition_version_supported check (definition_version = 1),
    constraint gym_plans_lifecycle_timestamps check (
        (status = 'active' and completed_at is null and abandoned_at is null)
        or (status = 'completed' and completed_at is not null and abandoned_at is null)
        or (status = 'abandoned' and completed_at is null and abandoned_at is not null)
    ),
    constraint gym_plans_name_not_blank check (char_length(btrim(name)) between 1 and 120),
    constraint gym_plans_status_valid check (status in ('active', 'completed', 'abandoned')),
    constraint gym_plans_weeks_count_range check (weeks_count between 1 and 52),
    CONSTRAINT gym_plans_id_owner_unique UNIQUE (id, owner_user_id),
    CONSTRAINT gym_plans_pkey PRIMARY KEY (id),
    CONSTRAINT gym_plans_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE
        CASCADE,
    CONSTRAINT gym_plans_source_template_owner_fk FOREIGN KEY (source_template_id, owner_user_id) REFERENCES
        public.gym_templates(id, owner_user_id)
);

CREATE TABLE public.gym_workouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    week_number smallint NOT NULL,
    day_number smallint NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    performed_on date,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint gym_workouts_day_positive check (day_number between 1 and 7),
    constraint gym_workouts_revision_positive check (revision > 0),
    constraint gym_workouts_status_timestamps check (
        (status = 'draft' and performed_on is null and completed_at is null)
        or (status = 'completed' and performed_on is not null and completed_at is not null)
    ),
    constraint gym_workouts_status_valid check (status in ('draft', 'completed')),
    constraint gym_workouts_week_positive check (week_number between 1 and 52),
    CONSTRAINT gym_workouts_id_owner_unique UNIQUE (id, owner_user_id),
    CONSTRAINT gym_workouts_pkey PRIMARY KEY (id),
    CONSTRAINT gym_workouts_plan_slot_unique UNIQUE (plan_id, week_number, day_number),
    CONSTRAINT gym_workouts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE
        CASCADE,
    CONSTRAINT gym_workouts_plan_owner_fk FOREIGN KEY (plan_id, owner_user_id) REFERENCES public.gym_plans(id,
        owner_user_id) ON DELETE CASCADE
);

CREATE TABLE public.gym_workout_exercises (
    workout_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    default_weight_grams integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint gym_workout_exercises_default_weight_nonnegative
        check (default_weight_grams is null or default_weight_grams >= 0),
    CONSTRAINT gym_workout_exercises_workout_exercise_pk PRIMARY KEY (workout_id, exercise_id),
    CONSTRAINT gym_workout_exercises_workout_owner_exercise_unique UNIQUE (workout_id, owner_user_id, exercise_id),
    CONSTRAINT gym_workout_exercises_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
        ON DELETE CASCADE,
    CONSTRAINT gym_workout_exercises_workout_owner_fk FOREIGN KEY (workout_id, owner_user_id) REFERENCES public.gym_workouts(id,
        owner_user_id) ON DELETE CASCADE
);

CREATE TABLE public.gym_workout_sets (
    workout_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    set_number integer NOT NULL,
    actual_reps integer,
    actual_seconds integer,
    weight_override_grams integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    constraint gym_workout_sets_actual_reps_nonnegative
        check (actual_reps is null or actual_reps >= 0),
    constraint gym_workout_sets_actual_seconds_nonnegative
        check (actual_seconds is null or actual_seconds >= 0),
    constraint gym_workout_sets_number_positive check (set_number > 0),
    constraint gym_workout_sets_weight_nonnegative
        check (weight_override_grams is null or weight_override_grams >= 0),
    CONSTRAINT gym_workout_sets_workout_exercise_number_pk PRIMARY KEY (workout_id, exercise_id, set_number),
    CONSTRAINT gym_workout_sets_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON
        DELETE CASCADE,
    CONSTRAINT gym_workout_sets_workout_owner_exercise_fk FOREIGN KEY (workout_id, owner_user_id, exercise_id)
        REFERENCES public.gym_workout_exercises(workout_id, owner_user_id, exercise_id) ON DELETE CASCADE
);

-- Indexes

create unique index gym_plans_one_active_per_owner_idx
    on public.gym_plans (owner_user_id)
    where status = 'active';

create index gym_plans_owner_status_started_idx
    on public.gym_plans (owner_user_id, status, started_at desc);

create index gym_templates_owner_updated_idx
    on public.gym_templates (owner_user_id, archived_at, updated_at desc);

create index gym_workout_exercises_owner_exercise_idx
    on public.gym_workout_exercises (owner_user_id, exercise_id);

create index gym_workout_sets_owner_workout_idx
    on public.gym_workout_sets (owner_user_id, workout_id);

create index gym_workouts_owner_status_idx
    on public.gym_workouts (owner_user_id, status);

-- Functions

CREATE FUNCTION private.gym_jsonb_object_length(p_value jsonb) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
    select pg_catalog.count(*)::integer
    from pg_catalog.jsonb_object_keys(p_value) as object_key(key);
$$;

CREATE FUNCTION private.gym_next_unfinished_slot(
    p_plan_id uuid,
    p_owner_user_id uuid,
    p_weeks_count smallint,
    p_days_per_week smallint
) RETURNS TABLE(week_number integer, day_number integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
    select week_slots.week_number, day_slots.day_number
    from pg_catalog.generate_series(1, p_weeks_count::integer) as week_slots(week_number)
    cross join pg_catalog.generate_series(1, p_days_per_week::integer) as day_slots(day_number)
    where not exists (
        select 1
        from public.gym_workouts as workout
        where workout.plan_id = p_plan_id
          and workout.owner_user_id = p_owner_user_id
          and workout.week_number = week_slots.week_number
          and workout.day_number = day_slots.day_number
          and workout.status = 'completed'
    )
    order by week_slots.week_number, day_slots.day_number
    limit 1;
$$;

CREATE FUNCTION private.gym_workout_completion_response(
    p_workout_id uuid,
    p_plan_id uuid,
    p_revision integer,
    p_plan_status text,
    p_weeks_count smallint,
    p_days_per_week smallint
) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
    completed_count integer;
    total_count integer := p_weeks_count::integer * p_days_per_week::integer;
    completed_weeks integer;
    workout_row public.gym_workouts%rowtype;
begin
    select * into workout_row
    from public.gym_workouts
    where id = p_workout_id;

    select pg_catalog.count(*)::integer into completed_count
    from public.gym_workouts
    where plan_id = p_plan_id and status = 'completed';

    select pg_catalog.count(*)::integer into completed_weeks
    from pg_catalog.generate_series(1, p_weeks_count::integer) as week_slots(week_number)
    where not exists (
        select 1
        from pg_catalog.generate_series(1, p_days_per_week::integer) as day_slots(day_number)
        where not exists (
            select 1 from public.gym_workouts as completed_workout
            where completed_workout.plan_id = p_plan_id
              and completed_workout.week_number = week_slots.week_number
              and completed_workout.day_number = day_slots.day_number
              and completed_workout.status = 'completed'
        )
    );

    return pg_catalog.jsonb_build_object(
        'workout_id', workout_row.id,
        'revision', p_revision,
        'status', workout_row.status,
        'performed_on', workout_row.performed_on,
        'completed_at', workout_row.completed_at,
        'plan_id', p_plan_id,
        'plan_status', p_plan_status,
        'completed_count', completed_count,
        'total_count', total_count,
        'completed_weeks', completed_weeks
    );
end;
$$;

CREATE FUNCTION private.gym_workout_results_json(p_workout_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
    select coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'exercise_id', exercise_result.exercise_id::text,
                'default_weight_grams', exercise_result.default_weight_grams,
                'sets', (
                    select coalesce(
                        pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                                'set_number', set_result.set_number,
                                'actual_reps', set_result.actual_reps,
                                'actual_seconds', set_result.actual_seconds,
                                'weight_override_grams', set_result.weight_override_grams
                            ) order by set_result.set_number
                        ), '[]'::jsonb
                    )
                    from public.gym_workout_sets as set_result
                    where set_result.workout_id = exercise_result.workout_id
                      and set_result.owner_user_id = exercise_result.owner_user_id
                      and set_result.exercise_id = exercise_result.exercise_id
                )
            ) order by exercise_result.exercise_id
        ), '[]'::jsonb
    )
    from public.gym_workout_exercises as exercise_result
    where exercise_result.workout_id = p_workout_id;
$$;

CREATE FUNCTION private.normalize_gym_workout_results(p_results jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
    select coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'exercise_id', result_item.value ->> 'exercise_id',
                'default_weight_grams', case
                    when pg_catalog.jsonb_typeof(result_item.value -> 'default_weight_grams') = 'null' then null
                    else ((result_item.value ->> 'default_weight_grams')::numeric)::integer
                end,
                'sets', (
                    select coalesce(
                        pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                                'set_number', ((set_item.value ->> 'set_number')::numeric)::integer,
                                'actual_reps', case
                                    when pg_catalog.jsonb_typeof(set_item.value -> 'actual_reps') = 'null' then null
                                    else ((set_item.value ->> 'actual_reps')::numeric)::integer
                                end,
                                'actual_seconds', case
                                    when pg_catalog.jsonb_typeof(set_item.value -> 'actual_seconds') = 'null' then null
                                    else ((set_item.value ->> 'actual_seconds')::numeric)::integer
                                end,
                                'weight_override_grams', case
                                    when pg_catalog.jsonb_typeof(set_item.value -> 'weight_override_grams') = 'null' then null
                                    else ((set_item.value ->> 'weight_override_grams')::numeric)::integer
                                end
                            ) order by ((set_item.value ->> 'set_number')::numeric)::integer
                        ), '[]'::jsonb
                    )
                    from pg_catalog.jsonb_array_elements(result_item.value -> 'sets') as set_item(value)
                )
            ) order by result_item.value ->> 'exercise_id'
        ), '[]'::jsonb
    )
    from pg_catalog.jsonb_array_elements(p_results) as result_item(value);
$$;

CREATE FUNCTION public.abandon_gym_plan(p_plan_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    plan_status text;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to end a training plan' using errcode = '42501';
    end if;

    select status into plan_status
    from public.gym_plans
    where id = p_plan_id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Training plan was not found' using errcode = '42501';
    end if;
    if plan_status <> 'active' then
        raise exception 'Only an active training plan can be ended early' using errcode = '55000';
    end if;

    -- Keep completed history and discard only an unfinished current slot.
    delete from public.gym_workouts
    where plan_id = p_plan_id and owner_user_id = current_user_id and status = 'draft';

    update public.gym_plans
    set status = 'abandoned', abandoned_at = pg_catalog.now()
    where id = p_plan_id and owner_user_id = current_user_id;

    return p_plan_id;
end;
$$;

CREATE FUNCTION public.archive_gym_template(p_template_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.validate_gym_template_definition(
    p_definition jsonb,
    p_days_per_week smallint
) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

CREATE FUNCTION private.validate_gym_workout_results(
    p_definition jsonb,
    p_day_number integer,
    p_results jsonb,
    p_require_complete boolean
) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
    day_value jsonb;
    block_value jsonb;
    exercise_value jsonb;
    result_value jsonb;
    set_value jsonb;
    exercise_id_text text;
    exercise_mode text;
    load_type text;
    prescribed_sets integer;
    expected_exercises integer := 0;
    matching_exercises integer;
    set_values jsonb;
    set_number_value numeric;
    actual_reps_value jsonb;
    actual_seconds_value jsonb;
    default_weight_value jsonb;
    override_weight_value jsonb;
    numeric_value numeric;
    seen_set_numbers integer[];
begin
    if p_definition is null or p_results is null
       or pg_catalog.jsonb_typeof(p_definition) <> 'object'
       or p_day_number is null or p_day_number < 1
       or pg_catalog.jsonb_typeof(p_results) <> 'array' then
        raise exception 'Workout results have an invalid shape' using errcode = '22023';
    end if;
    if pg_catalog.octet_length(p_results::text) > 262144 then
        raise exception 'Workout results exceed the 256 KiB size limit' using errcode = '22023';
    end if;

    day_value := p_definition -> 'days' -> (p_day_number - 1);
    if pg_catalog.jsonb_typeof(day_value) <> 'object'
       or pg_catalog.jsonb_typeof(day_value -> 'blocks') <> 'array' then
        raise exception 'The selected training day is invalid' using errcode = '22023';
    end if;

    for block_value in
        select block_item.value
        from pg_catalog.jsonb_array_elements(day_value -> 'blocks') as block_item(value)
    loop
        for exercise_value in
            select exercise_item.value
            from pg_catalog.jsonb_array_elements(block_value -> 'exercises') as exercise_item(value)
        loop
            expected_exercises := expected_exercises + 1;
            exercise_id_text := exercise_value ->> 'id';
            exercise_mode := exercise_value ->> 'mode';
            load_type := exercise_value ->> 'load_type';
            prescribed_sets := (exercise_value ->> 'sets')::integer;

            select pg_catalog.count(*)::integer
            into matching_exercises
            from pg_catalog.jsonb_array_elements(p_results) as result_item(value)
            where result_item.value ->> 'exercise_id' = exercise_id_text;
            if matching_exercises <> 1 then
                raise exception 'Workout must contain one result header for exercise %', exercise_id_text using errcode = '22023';
            end if;

            select result_item.value
            into result_value
            from pg_catalog.jsonb_array_elements(p_results) as result_item(value)
            where result_item.value ->> 'exercise_id' = exercise_id_text;

            if pg_catalog.jsonb_typeof(result_value) <> 'object'
               or private.gym_jsonb_object_length(result_value) <> 3
               or not (result_value ?& array['exercise_id', 'default_weight_grams', 'sets'])
               or pg_catalog.jsonb_typeof(result_value -> 'exercise_id') <> 'string'
               or result_value ->> 'exercise_id' <> exercise_id_text then
                raise exception 'Workout result for exercise % has an invalid shape', exercise_id_text using errcode = '22023';
            end if;

            default_weight_value := result_value -> 'default_weight_grams';
            if pg_catalog.jsonb_typeof(default_weight_value) <> 'null' then
                if pg_catalog.jsonb_typeof(default_weight_value) <> 'number' then
                    raise exception 'Default weight for exercise % must be integer grams or null', exercise_id_text using errcode = '22023';
                end if;
                numeric_value := (default_weight_value #>> '{}')::numeric;
                if numeric_value < 0 or numeric_value > 2147483647 or numeric_value <> pg_catalog.trunc(numeric_value) then
                    raise exception 'Default weight for exercise % must be nonnegative integer grams', exercise_id_text using errcode = '22023';
                end if;
            end if;
            if load_type = 'bodyweight' and pg_catalog.jsonb_typeof(default_weight_value) <> 'null' then
                raise exception 'Bodyweight exercises cannot have a default weight' using errcode = '22023';
            end if;

            set_values := result_value -> 'sets';
            if pg_catalog.jsonb_typeof(set_values) <> 'array'
               or pg_catalog.jsonb_array_length(set_values) <> prescribed_sets then
                raise exception 'Exercise % must contain exactly % set results', exercise_id_text, prescribed_sets using errcode = '22023';
            end if;
            seen_set_numbers := array[]::integer[];

            for set_value in select set_item.value from pg_catalog.jsonb_array_elements(set_values) as set_item(value)
            loop
                if pg_catalog.jsonb_typeof(set_value) <> 'object'
                   or private.gym_jsonb_object_length(set_value) <> 4
                   or not (set_value ?& array['set_number', 'actual_reps', 'actual_seconds', 'weight_override_grams']) then
                    raise exception 'Exercise % has a malformed set result', exercise_id_text using errcode = '22023';
                end if;

                if pg_catalog.jsonb_typeof(set_value -> 'set_number') <> 'number' then
                    raise exception 'Exercise % has an invalid set number', exercise_id_text using errcode = '22023';
                end if;
                set_number_value := (set_value ->> 'set_number')::numeric;
                if set_number_value < 1 or set_number_value > prescribed_sets
                   or set_number_value <> pg_catalog.trunc(set_number_value)
                   or set_number_value::integer = any(seen_set_numbers) then
                    raise exception 'Exercise % must have each prescribed set number exactly once', exercise_id_text using errcode = '22023';
                end if;
                seen_set_numbers := pg_catalog.array_append(seen_set_numbers, set_number_value::integer);

                actual_reps_value := set_value -> 'actual_reps';
                actual_seconds_value := set_value -> 'actual_seconds';
                if pg_catalog.jsonb_typeof(actual_reps_value) <> 'null'
                   and pg_catalog.jsonb_typeof(actual_reps_value) <> 'number' then
                    raise exception 'Actual repetitions must be a nonnegative integer or null' using errcode = '22023';
                end if;
                if pg_catalog.jsonb_typeof(actual_seconds_value) <> 'null'
                   and pg_catalog.jsonb_typeof(actual_seconds_value) <> 'number' then
                    raise exception 'Actual seconds must be a nonnegative integer or null' using errcode = '22023';
                end if;
                if pg_catalog.jsonb_typeof(actual_reps_value) <> 'null' then
                    numeric_value := (actual_reps_value #>> '{}')::numeric;
                    if numeric_value < 0 or numeric_value > 2147483647 or numeric_value <> pg_catalog.trunc(numeric_value) then
                        raise exception 'Actual repetitions must be a nonnegative integer' using errcode = '22023';
                    end if;
                end if;
                if pg_catalog.jsonb_typeof(actual_seconds_value) <> 'null' then
                    numeric_value := (actual_seconds_value #>> '{}')::numeric;
                    if numeric_value < 0 or numeric_value > 2147483647 or numeric_value <> pg_catalog.trunc(numeric_value) then
                        raise exception 'Actual seconds must be a nonnegative integer' using errcode = '22023';
                    end if;
                end if;
                if (exercise_mode = 'reps' and pg_catalog.jsonb_typeof(actual_seconds_value) <> 'null')
                   or (exercise_mode = 'time' and pg_catalog.jsonb_typeof(actual_reps_value) <> 'null') then
                    raise exception 'Actual result does not match the exercise mode' using errcode = '22023';
                end if;
                if p_require_complete and (
                    (exercise_mode = 'reps' and pg_catalog.jsonb_typeof(actual_reps_value) = 'null')
                    or (exercise_mode = 'time' and pg_catalog.jsonb_typeof(actual_seconds_value) = 'null')
                ) then
                    raise exception 'Every prescribed set needs an actual result before completion' using errcode = '22023';
                end if;

                override_weight_value := set_value -> 'weight_override_grams';
                if pg_catalog.jsonb_typeof(override_weight_value) <> 'null' then
                    if pg_catalog.jsonb_typeof(override_weight_value) <> 'number' then
                        raise exception 'Set weight override must be integer grams or null' using errcode = '22023';
                    end if;
                    numeric_value := (override_weight_value #>> '{}')::numeric;
                    if numeric_value < 0 or numeric_value > 2147483647 or numeric_value <> pg_catalog.trunc(numeric_value) then
                        raise exception 'Set weight override must be nonnegative integer grams' using errcode = '22023';
                    end if;
                end if;
                if load_type = 'bodyweight' and pg_catalog.jsonb_typeof(override_weight_value) <> 'null' then
                    raise exception 'Bodyweight exercises cannot have set weight overrides' using errcode = '22023';
                end if;
            end loop;
        end loop;
    end loop;

    if pg_catalog.jsonb_array_length(p_results) <> expected_exercises then
        raise exception 'Workout results contain an unknown or duplicate exercise' using errcode = '22023';
    end if;
end;
$$;

CREATE FUNCTION public.start_gym_workout(p_plan_id uuid, p_week_number integer, p_day_number integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    plan_row public.gym_plans%rowtype;
    existing_workout_id uuid;
    existing_status text;
    next_week integer;
    next_day integer;
    day_value jsonb;
    block_value jsonb;
    exercise_value jsonb;
    v_exercise_id uuid;
    exercise_sets integer;
    workout_id uuid;
    previous_workout_id uuid;
    previous_default_weight integer;
    previous_override_weight integer;
    set_index integer;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to start a workout' using errcode = '42501';
    end if;

    select * into plan_row
    from public.gym_plans
    where id = p_plan_id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Training plan was not found' using errcode = '42501';
    end if;
    if plan_row.status <> 'active' then
        raise exception 'Only an active training plan can start a workout' using errcode = '55000';
    end if;
    if p_week_number is null or p_day_number is null
       or p_week_number < 1 or p_week_number > plan_row.weeks_count
       or p_day_number < 1 or p_day_number > plan_row.days_per_week then
        raise exception 'Workout slot is outside this plan' using errcode = '22023';
    end if;

    select slot.week_number, slot.day_number into next_week, next_day
    from private.gym_next_unfinished_slot(
        plan_row.id, current_user_id, plan_row.weeks_count, plan_row.days_per_week
    ) as slot;
    if not found then
        raise exception 'This training plan has no unfinished workouts' using errcode = '55000';
    end if;
    if p_week_number <> next_week or p_day_number <> next_day then
        raise exception 'Complete workouts in order, starting with week %, day %', next_week, next_day using errcode = '55000';
    end if;

    select id, status into existing_workout_id, existing_status
    from public.gym_workouts
    where plan_id = plan_row.id and owner_user_id = current_user_id
      and week_number = p_week_number and day_number = p_day_number
    for update;
    if found then
        if existing_status = 'draft' then return existing_workout_id; end if;
        raise exception 'This workout is already complete' using errcode = '55000';
    end if;

    insert into public.gym_workouts (plan_id, owner_user_id, week_number, day_number)
    values (plan_row.id, current_user_id, p_week_number, p_day_number)
    returning id into workout_id;

    day_value := plan_row.definition_snapshot -> 'days' -> (p_day_number - 1);
    for block_value in
        select block_item.value
        from pg_catalog.jsonb_array_elements(day_value -> 'blocks') as block_item(value)
    loop
        for exercise_value in
            select exercise_item.value
            from pg_catalog.jsonb_array_elements(block_value -> 'exercises') as exercise_item(value)
        loop
            v_exercise_id := (exercise_value ->> 'id')::uuid;
            exercise_sets := (exercise_value ->> 'sets')::integer;
            previous_workout_id := null;
            previous_default_weight := null;

            if exercise_value ->> 'load_type' = 'weight' then
                select prior_workout.id, prior_exercise.default_weight_grams
                into previous_workout_id, previous_default_weight
                from public.gym_workouts as prior_workout
                join public.gym_workout_exercises as prior_exercise
                  on prior_exercise.workout_id = prior_workout.id
                 and prior_exercise.owner_user_id = prior_workout.owner_user_id
                where prior_workout.plan_id = plan_row.id
                  and prior_workout.owner_user_id = current_user_id
                  and prior_workout.status = 'completed'
                  and (prior_workout.week_number, prior_workout.day_number) < (p_week_number, p_day_number)
                  and prior_exercise.exercise_id = v_exercise_id
                order by prior_workout.week_number desc, prior_workout.day_number desc
                limit 1;
            end if;

            insert into public.gym_workout_exercises (
                workout_id, owner_user_id, exercise_id, default_weight_grams
            ) values (
                workout_id, current_user_id, v_exercise_id, previous_default_weight
            );

            for set_index in 1..exercise_sets loop
                previous_override_weight := null;
                if previous_workout_id is not null then
                    select prior_set.weight_override_grams into previous_override_weight
                    from public.gym_workout_sets as prior_set
                    where prior_set.workout_id = previous_workout_id
                      and prior_set.owner_user_id = current_user_id
                      and prior_set.exercise_id = v_exercise_id
                      and prior_set.set_number = set_index;
                end if;
                insert into public.gym_workout_sets (
                    workout_id, owner_user_id, exercise_id, set_number,
                    weight_override_grams
                ) values (
                    workout_id, current_user_id, v_exercise_id, set_index,
                    previous_override_weight
                );
            end loop;
        end loop;
    end loop;

    return workout_id;
end;
$$;

CREATE FUNCTION public.complete_gym_workout(
    p_workout_id uuid,
    p_expected_revision integer,
    p_results jsonb,
    p_performed_on date
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    target_plan_id uuid;
    plan_row public.gym_plans%rowtype;
    workout_row public.gym_workouts%rowtype;
    next_week integer;
    next_day integer;
    input_results jsonb;
    stored_results jsonb;
    result_value jsonb;
    set_value jsonb;
    v_exercise_id uuid;
    v_set_number integer;
    new_revision integer;
    completed_count integer;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to complete a workout' using errcode = '42501';
    end if;
    if p_performed_on is null then
        raise exception 'A workout date is required' using errcode = '22023';
    end if;
    select plan_id into target_plan_id
    from public.gym_workouts
    where id = p_workout_id and owner_user_id = current_user_id;
    if not found then
        raise exception 'Workout was not found' using errcode = '42501';
    end if;

    select * into plan_row
    from public.gym_plans
    where id = target_plan_id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Training plan was not found' using errcode = '42501';
    end if;
    select * into workout_row
    from public.gym_workouts
    where id = p_workout_id and plan_id = plan_row.id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Workout was not found' using errcode = '42501';
    end if;

    perform private.validate_gym_workout_results(
        plan_row.definition_snapshot, workout_row.day_number, p_results, true
    );
    input_results := private.normalize_gym_workout_results(p_results);

    -- A retry after a lost response succeeds only when it repeats the committed
    -- results and local performance date; corrections use their own RPC.
    if workout_row.status = 'completed' then
        stored_results := private.gym_workout_results_json(workout_row.id);
        if input_results is distinct from stored_results
           or p_performed_on is distinct from workout_row.performed_on then
            raise exception 'This workout is already complete with different results. Use the correction action.' using errcode = '55000';
        end if;
        return private.gym_workout_completion_response(
            workout_row.id, plan_row.id, workout_row.revision, plan_row.status,
            plan_row.weeks_count, plan_row.days_per_week
        );
    end if;

    if plan_row.status <> 'active' then
        raise exception 'Only the active plan can be completed' using errcode = '55000';
    end if;
    if p_expected_revision is null or workout_row.revision <> p_expected_revision then
        raise exception 'This workout changed elsewhere. Reload it before completing it.' using errcode = '40001';
    end if;

    select slot.week_number, slot.day_number into next_week, next_day
    from private.gym_next_unfinished_slot(
        plan_row.id, current_user_id, plan_row.weeks_count, plan_row.days_per_week
    ) as slot;
    if not found or workout_row.week_number <> next_week or workout_row.day_number <> next_day then
        raise exception 'Complete workouts in order' using errcode = '55000';
    end if;

    for result_value in select result_item.value from pg_catalog.jsonb_array_elements(p_results) as result_item(value)
    loop
        v_exercise_id := (result_value ->> 'exercise_id')::uuid;
        update public.gym_workout_exercises
        set default_weight_grams = case
                when pg_catalog.jsonb_typeof(result_value -> 'default_weight_grams') = 'null' then null
                else ((result_value ->> 'default_weight_grams')::numeric)::integer
            end,
            updated_at = pg_catalog.now()
        where gym_workout_exercises.workout_id = p_workout_id
          and gym_workout_exercises.owner_user_id = current_user_id
          and gym_workout_exercises.exercise_id = v_exercise_id;
        if not found then
            raise exception 'Workout exercise result was not found' using errcode = '55000';
        end if;

        for set_value in select set_item.value from pg_catalog.jsonb_array_elements(result_value -> 'sets') as set_item(value)
        loop
            v_set_number := ((set_value ->> 'set_number')::numeric)::integer;
            update public.gym_workout_sets
            set actual_reps = case
                    when pg_catalog.jsonb_typeof(set_value -> 'actual_reps') = 'null' then null
                    else ((set_value ->> 'actual_reps')::numeric)::integer
                end,
                actual_seconds = case
                    when pg_catalog.jsonb_typeof(set_value -> 'actual_seconds') = 'null' then null
                    else ((set_value ->> 'actual_seconds')::numeric)::integer
                end,
                weight_override_grams = case
                    when pg_catalog.jsonb_typeof(set_value -> 'weight_override_grams') = 'null' then null
                    else ((set_value ->> 'weight_override_grams')::numeric)::integer
                end,
                updated_at = pg_catalog.now()
            where gym_workout_sets.workout_id = p_workout_id
              and gym_workout_sets.owner_user_id = current_user_id
              and gym_workout_sets.exercise_id = v_exercise_id
              and gym_workout_sets.set_number = v_set_number;
            if not found then
                raise exception 'Workout set result was not found' using errcode = '55000';
            end if;
        end loop;
    end loop;

    update public.gym_workouts
    set status = 'completed', performed_on = p_performed_on,
        completed_at = pg_catalog.now(), updated_at = pg_catalog.now(),
        revision = revision + 1
    where id = p_workout_id and owner_user_id = current_user_id
    returning revision into new_revision;

    select pg_catalog.count(*)::integer into completed_count
    from public.gym_workouts
    where plan_id = plan_row.id and owner_user_id = current_user_id and status = 'completed';
    if completed_count = plan_row.weeks_count::integer * plan_row.days_per_week::integer then
        update public.gym_plans
        set status = 'completed', completed_at = pg_catalog.now()
        where id = plan_row.id and owner_user_id = current_user_id;
        plan_row.status := 'completed';
    end if;

    return private.gym_workout_completion_response(
        workout_row.id, plan_row.id, new_revision, plan_row.status,
        plan_row.weeks_count, plan_row.days_per_week
    );
end;
$$;

CREATE FUNCTION public.correct_gym_workout_results(
    p_workout_id uuid,
    p_expected_revision integer,
    p_results jsonb
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    target_plan_id uuid;
    plan_row public.gym_plans%rowtype;
    workout_row public.gym_workouts%rowtype;
    result_value jsonb;
    set_value jsonb;
    v_exercise_id uuid;
    v_set_number integer;
    new_revision integer;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to correct a workout' using errcode = '42501';
    end if;
    select plan_id into target_plan_id
    from public.gym_workouts
    where id = p_workout_id and owner_user_id = current_user_id;
    if not found then
        raise exception 'Workout was not found' using errcode = '42501';
    end if;
    select * into plan_row
    from public.gym_plans
    where id = target_plan_id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Training plan was not found' using errcode = '42501';
    end if;
    select * into workout_row
    from public.gym_workouts
    where id = p_workout_id and plan_id = plan_row.id and owner_user_id = current_user_id
    for update;
    if not found or workout_row.status <> 'completed' then
        raise exception 'Only a completed workout can be corrected' using errcode = '55000';
    end if;
    if p_expected_revision is null or workout_row.revision <> p_expected_revision then
        raise exception 'This workout changed elsewhere. Reload it before saving corrections.' using errcode = '40001';
    end if;

    perform private.validate_gym_workout_results(
        plan_row.definition_snapshot, workout_row.day_number, p_results, true
    );
    for result_value in select result_item.value from pg_catalog.jsonb_array_elements(p_results) as result_item(value)
    loop
        v_exercise_id := (result_value ->> 'exercise_id')::uuid;
        update public.gym_workout_exercises
        set default_weight_grams = case
                when pg_catalog.jsonb_typeof(result_value -> 'default_weight_grams') = 'null' then null
                else ((result_value ->> 'default_weight_grams')::numeric)::integer
            end,
            updated_at = pg_catalog.now()
        where gym_workout_exercises.workout_id = p_workout_id
          and gym_workout_exercises.owner_user_id = current_user_id
          and gym_workout_exercises.exercise_id = v_exercise_id;
        if not found then
            raise exception 'Workout exercise result was not found' using errcode = '55000';
        end if;

        for set_value in select set_item.value from pg_catalog.jsonb_array_elements(result_value -> 'sets') as set_item(value)
        loop
            v_set_number := ((set_value ->> 'set_number')::numeric)::integer;
            update public.gym_workout_sets
            set actual_reps = case
                    when pg_catalog.jsonb_typeof(set_value -> 'actual_reps') = 'null' then null
                    else ((set_value ->> 'actual_reps')::numeric)::integer
                end,
                actual_seconds = case
                    when pg_catalog.jsonb_typeof(set_value -> 'actual_seconds') = 'null' then null
                    else ((set_value ->> 'actual_seconds')::numeric)::integer
                end,
                weight_override_grams = case
                    when pg_catalog.jsonb_typeof(set_value -> 'weight_override_grams') = 'null' then null
                    else ((set_value ->> 'weight_override_grams')::numeric)::integer
                end,
                updated_at = pg_catalog.now()
            where gym_workout_sets.workout_id = p_workout_id
              and gym_workout_sets.owner_user_id = current_user_id
              and gym_workout_sets.exercise_id = v_exercise_id
              and gym_workout_sets.set_number = v_set_number;
            if not found then
                raise exception 'Workout set result was not found' using errcode = '55000';
            end if;
        end loop;
    end loop;

    update public.gym_workouts
    set revision = revision + 1, updated_at = pg_catalog.now()
    where id = p_workout_id and owner_user_id = current_user_id
    returning revision into new_revision;
    return new_revision;
end;
$$;

CREATE FUNCTION public.save_gym_template(
    p_template_id uuid,
    p_expected_revision integer,
    p_name text,
    p_weeks_count smallint,
    p_days_per_week smallint,
    p_definition jsonb,
    p_definition_version smallint DEFAULT 1
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.save_gym_workout_draft(
    p_workout_id uuid,
    p_expected_revision integer,
    p_results jsonb
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    target_plan_id uuid;
    plan_row public.gym_plans%rowtype;
    workout_row public.gym_workouts%rowtype;
    next_week integer;
    next_day integer;
    result_value jsonb;
    set_value jsonb;
    v_exercise_id uuid;
    v_set_number integer;
    new_revision integer;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to save a workout' using errcode = '42501';
    end if;
    select plan_id into target_plan_id
    from public.gym_workouts
    where id = p_workout_id and owner_user_id = current_user_id;
    if not found then
        raise exception 'Workout was not found' using errcode = '42501';
    end if;

    select * into plan_row
    from public.gym_plans
    where id = target_plan_id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Training plan was not found' using errcode = '42501';
    end if;
    select * into workout_row
    from public.gym_workouts
    where id = p_workout_id and plan_id = plan_row.id and owner_user_id = current_user_id
    for update;
    if not found then
        raise exception 'Workout was not found' using errcode = '42501';
    end if;
    if plan_row.status <> 'active' or workout_row.status <> 'draft' then
        raise exception 'Only the current draft in an active plan can be saved' using errcode = '55000';
    end if;
    if p_expected_revision is null or workout_row.revision <> p_expected_revision then
        raise exception 'This workout changed elsewhere. Reload it before saving your changes.' using errcode = '40001';
    end if;

    select slot.week_number, slot.day_number into next_week, next_day
    from private.gym_next_unfinished_slot(
        plan_row.id, current_user_id, plan_row.weeks_count, plan_row.days_per_week
    ) as slot;
    if not found or workout_row.week_number <> next_week or workout_row.day_number <> next_day then
        raise exception 'Only the next workout can be edited' using errcode = '55000';
    end if;

    perform private.validate_gym_workout_results(
        plan_row.definition_snapshot, workout_row.day_number, p_results, false
    );

    for result_value in select result_item.value from pg_catalog.jsonb_array_elements(p_results) as result_item(value)
    loop
        v_exercise_id := (result_value ->> 'exercise_id')::uuid;
        update public.gym_workout_exercises
        set default_weight_grams = case
                when pg_catalog.jsonb_typeof(result_value -> 'default_weight_grams') = 'null' then null
                else ((result_value ->> 'default_weight_grams')::numeric)::integer
            end,
            updated_at = pg_catalog.now()
        where gym_workout_exercises.workout_id = p_workout_id
          and gym_workout_exercises.owner_user_id = current_user_id
          and gym_workout_exercises.exercise_id = v_exercise_id;
        if not found then
            raise exception 'Workout exercise result was not found' using errcode = '55000';
        end if;

        for set_value in select set_item.value from pg_catalog.jsonb_array_elements(result_value -> 'sets') as set_item(value)
        loop
            v_set_number := ((set_value ->> 'set_number')::numeric)::integer;
            update public.gym_workout_sets
            set actual_reps = case
                    when pg_catalog.jsonb_typeof(set_value -> 'actual_reps') = 'null' then null
                    else ((set_value ->> 'actual_reps')::numeric)::integer
                end,
                actual_seconds = case
                    when pg_catalog.jsonb_typeof(set_value -> 'actual_seconds') = 'null' then null
                    else ((set_value ->> 'actual_seconds')::numeric)::integer
                end,
                weight_override_grams = case
                    when pg_catalog.jsonb_typeof(set_value -> 'weight_override_grams') = 'null' then null
                    else ((set_value ->> 'weight_override_grams')::numeric)::integer
                end,
                updated_at = pg_catalog.now()
            where gym_workout_sets.workout_id = p_workout_id
              and gym_workout_sets.owner_user_id = current_user_id
              and gym_workout_sets.exercise_id = v_exercise_id
              and gym_workout_sets.set_number = v_set_number;
            if not found then
                raise exception 'Workout set result was not found' using errcode = '55000';
            end if;
        end loop;
    end loop;

    update public.gym_workouts
    set revision = revision + 1, updated_at = pg_catalog.now()
    where id = p_workout_id and owner_user_id = current_user_id
    returning revision into new_revision;
    return new_revision;
end;
$$;

CREATE FUNCTION public.start_gym_plan(p_template_id uuid, p_name text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    template_row public.gym_templates%rowtype;
    normalized_name text;
    new_plan_id uuid;
    violated_constraint text;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to start a training plan' using errcode = '42501';
    end if;

    -- Serialize starts for this user before relying on the unique-index guard.
    perform 1 from public.profiles where id = current_user_id for update;
    if not found then
        raise exception 'A profile is required to start a training plan' using errcode = '42501';
    end if;

    if exists (
        select 1 from public.gym_plans
        where owner_user_id = current_user_id and status = 'active'
    ) then
        raise exception 'End your active training plan before starting another one' using errcode = '55000';
    end if;

    -- SHARE conflicts with edits so the copied name, duration, and definition
    -- all come from one committed template version.
    select * into template_row
    from public.gym_templates
    where id = p_template_id
      and owner_user_id = current_user_id
      and archived_at is null
    for share;
    if not found then
        raise exception 'Active training template was not found' using errcode = '42501';
    end if;
    if template_row.definition_version is distinct from 1 then
        raise exception 'Unsupported training template definition version' using errcode = '22023';
    end if;
    perform private.validate_gym_template_definition(template_row.definition, template_row.days_per_week);

    normalized_name := coalesce(nullif(pg_catalog.btrim(p_name), ''), template_row.name);
    if pg_catalog.char_length(normalized_name) > 120 then
        raise exception 'Plan name can contain at most 120 characters' using errcode = '22023';
    end if;

    insert into public.gym_plans (
        owner_user_id, source_template_id, name, weeks_count, days_per_week,
        definition_snapshot, definition_version
    ) values (
        current_user_id, template_row.id, normalized_name, template_row.weeks_count,
        template_row.days_per_week, template_row.definition, template_row.definition_version
    ) returning id into new_plan_id;

    return new_plan_id;
exception
    when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint = 'gym_plans_one_active_per_owner_idx' then
            raise exception 'End your active training plan before starting another one' using errcode = '55000';
        end if;
        raise;
end;
$$;

-- Row-level security

ALTER TABLE public.gym_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gym_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gym_workout_exercises ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gym_workout_sets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gym_workouts ENABLE ROW LEVEL SECURITY;

-- Policies

create policy gym_plans_select_own
on public.gym_plans
for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy gym_templates_select_own
on public.gym_templates
for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy gym_workout_exercises_select_own
on public.gym_workout_exercises
for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy gym_workout_sets_select_own
on public.gym_workout_sets
for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy gym_workouts_select_own
on public.gym_workouts
for select to authenticated
using (owner_user_id = (select auth.uid()));

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON FUNCTION private.gym_jsonb_object_length(jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.gym_next_unfinished_slot(uuid, uuid, smallint, smallint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.gym_workout_completion_response(uuid, uuid, integer, text, smallint, smallint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.gym_workout_results_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.normalize_gym_workout_results(jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_gym_template_definition(jsonb, smallint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.validate_gym_workout_results(jsonb, integer, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.abandon_gym_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.archive_gym_template(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_gym_workout(uuid, integer, jsonb, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.correct_gym_workout_results(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_gym_template(uuid, integer, text, smallint, smallint, jsonb, smallint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_gym_workout_draft(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_gym_plan(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_gym_workout(uuid, integer, integer) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.gym_plans FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.gym_templates FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.gym_workout_exercises FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.gym_workout_sets FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.gym_workouts FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.abandon_gym_plan(p_plan_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.abandon_gym_plan(p_plan_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.archive_gym_template(p_template_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.archive_gym_template(p_template_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.complete_gym_workout(p_workout_id uuid, p_expected_revision integer, p_results
    jsonb, p_performed_on date) TO service_role;
GRANT ALL ON FUNCTION public.complete_gym_workout(p_workout_id uuid, p_expected_revision integer, p_results
    jsonb, p_performed_on date) TO authenticated;
GRANT ALL ON FUNCTION public.correct_gym_workout_results(p_workout_id uuid, p_expected_revision integer, p_results
    jsonb) TO service_role;
GRANT ALL ON FUNCTION public.correct_gym_workout_results(p_workout_id uuid, p_expected_revision integer, p_results
    jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_gym_template(p_template_id uuid, p_expected_revision integer, p_name text,
    p_weeks_count smallint, p_days_per_week smallint, p_definition jsonb, p_definition_version smallint) TO
    service_role;
GRANT ALL ON FUNCTION public.save_gym_template(p_template_id uuid, p_expected_revision integer, p_name text,
    p_weeks_count smallint, p_days_per_week smallint, p_definition jsonb, p_definition_version smallint) TO
    authenticated;
GRANT ALL ON FUNCTION public.save_gym_workout_draft(p_workout_id uuid, p_expected_revision integer, p_results
    jsonb) TO service_role;
GRANT ALL ON FUNCTION public.save_gym_workout_draft(p_workout_id uuid, p_expected_revision integer, p_results
    jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.start_gym_plan(p_template_id uuid, p_name text) TO service_role;
GRANT ALL ON FUNCTION public.start_gym_plan(p_template_id uuid, p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.start_gym_workout(p_plan_id uuid, p_week_number integer, p_day_number integer)
    TO service_role;
GRANT ALL ON FUNCTION public.start_gym_workout(p_plan_id uuid, p_week_number integer, p_day_number integer)
    TO authenticated;
GRANT ALL ON TABLE public.gym_plans TO service_role;
GRANT ALL ON TABLE public.gym_templates TO service_role;
GRANT ALL ON TABLE public.gym_workout_exercises TO service_role;
GRANT ALL ON TABLE public.gym_workout_sets TO service_role;
GRANT ALL ON TABLE public.gym_workouts TO service_role;
GRANT SELECT (workout_id, owner_user_id, exercise_id, default_weight_grams, created_at, updated_at) ON TABLE
    public.gym_workout_exercises TO authenticated;

GRANT SELECT (
    id,
    owner_user_id,
    source_template_id,
    name,
    weeks_count,
    days_per_week,
    definition_snapshot,
    definition_version,
    status,
    started_at,
    completed_at,
    abandoned_at
) ON TABLE public.gym_plans TO authenticated;
GRANT SELECT (
    id,
    owner_user_id,
    name,
    weeks_count,
    days_per_week,
    definition,
    definition_version,
    revision,
    archived_at,
    created_at,
    updated_at
) ON TABLE public.gym_templates TO authenticated;
GRANT SELECT (
    workout_id,
    owner_user_id,
    exercise_id,
    set_number,
    actual_reps,
    actual_seconds,
    weight_override_grams,
    created_at,
    updated_at
) ON TABLE public.gym_workout_sets TO authenticated;
GRANT SELECT (
    id,
    plan_id,
    owner_user_id,
    week_number,
    day_number,
    status,
    revision,
    performed_on,
    started_at,
    completed_at,
    created_at,
    updated_at
) ON TABLE public.gym_workouts TO authenticated;
