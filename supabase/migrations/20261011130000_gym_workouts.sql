-- Private exercise and set results, plus transactional workout lifecycle RPCs.
alter table public.gym_workouts
    add constraint gym_workouts_id_owner_unique unique (id, owner_user_id);

create table public.gym_workout_exercises (
    workout_id uuid not null,
    owner_user_id uuid not null references auth.users (id) on delete cascade,
    exercise_id uuid not null,
    default_weight_grams integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint gym_workout_exercises_default_weight_nonnegative
        check (default_weight_grams is null or default_weight_grams >= 0),
    constraint gym_workout_exercises_workout_owner_fk
        foreign key (workout_id, owner_user_id)
        references public.gym_workouts (id, owner_user_id) on delete cascade,
    constraint gym_workout_exercises_workout_exercise_pk
        primary key (workout_id, exercise_id),
    constraint gym_workout_exercises_workout_owner_exercise_unique
        unique (workout_id, owner_user_id, exercise_id)
);

create index gym_workout_exercises_owner_exercise_idx
    on public.gym_workout_exercises (owner_user_id, exercise_id);

alter table public.gym_workout_exercises enable row level security;

create policy gym_workout_exercises_select_own
on public.gym_workout_exercises
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on table public.gym_workout_exercises from public, anon, authenticated;
grant select (
    workout_id, owner_user_id, exercise_id, default_weight_grams, created_at, updated_at
) on table public.gym_workout_exercises to authenticated;

create table public.gym_workout_sets (
    workout_id uuid not null,
    owner_user_id uuid not null references auth.users (id) on delete cascade,
    exercise_id uuid not null,
    set_number integer not null,
    actual_reps integer,
    actual_seconds integer,
    weight_override_grams integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint gym_workout_sets_number_positive check (set_number > 0),
    constraint gym_workout_sets_actual_reps_nonnegative
        check (actual_reps is null or actual_reps >= 0),
    constraint gym_workout_sets_actual_seconds_nonnegative
        check (actual_seconds is null or actual_seconds >= 0),
    constraint gym_workout_sets_weight_nonnegative
        check (weight_override_grams is null or weight_override_grams >= 0),
    constraint gym_workout_sets_workout_owner_exercise_fk
        foreign key (workout_id, owner_user_id, exercise_id)
        references public.gym_workout_exercises (workout_id, owner_user_id, exercise_id)
        on delete cascade,
    constraint gym_workout_sets_workout_exercise_number_pk
        primary key (workout_id, exercise_id, set_number)
);

create index gym_workout_sets_owner_workout_idx
    on public.gym_workout_sets (owner_user_id, workout_id);

alter table public.gym_workout_sets enable row level security;

create policy gym_workout_sets_select_own
on public.gym_workout_sets
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on table public.gym_workout_sets from public, anon, authenticated;
grant select (
    workout_id, owner_user_id, exercise_id, set_number, actual_reps,
    actual_seconds, weight_override_grams, created_at, updated_at
) on table public.gym_workout_sets to authenticated;

create function private.gym_next_unfinished_slot(
    p_plan_id uuid,
    p_owner_user_id uuid,
    p_weeks_count smallint,
    p_days_per_week smallint
)
returns table (week_number integer, day_number integer)
language sql
stable
set search_path = ''
as $$
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

revoke all on function private.gym_next_unfinished_slot(uuid, uuid, smallint, smallint) from public, anon, authenticated;

create function private.validate_gym_workout_results(
    p_definition jsonb,
    p_day_number integer,
    p_results jsonb,
    p_require_complete boolean
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

revoke all on function private.validate_gym_workout_results(jsonb, integer, jsonb, boolean) from public, anon, authenticated;

create function private.normalize_gym_workout_results(p_results jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
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

revoke all on function private.normalize_gym_workout_results(jsonb) from public, anon, authenticated;

create function private.gym_workout_results_json(p_workout_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
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

revoke all on function private.gym_workout_results_json(uuid) from public, anon, authenticated;

create function private.gym_workout_completion_response(
    p_workout_id uuid,
    p_plan_id uuid,
    p_revision integer,
    p_plan_status text,
    p_weeks_count smallint,
    p_days_per_week smallint
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
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

revoke all on function private.gym_workout_completion_response(uuid, uuid, integer, text, smallint, smallint) from public, anon, authenticated;

create function public.start_gym_workout(
    p_plan_id uuid,
    p_week_number integer,
    p_day_number integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.start_gym_workout(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.start_gym_workout(uuid, integer, integer) to authenticated;

create function public.save_gym_workout_draft(
    p_workout_id uuid,
    p_expected_revision integer,
    p_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.save_gym_workout_draft(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_gym_workout_draft(uuid, integer, jsonb) to authenticated;

create function public.complete_gym_workout(
    p_workout_id uuid,
    p_expected_revision integer,
    p_results jsonb,
    p_performed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.complete_gym_workout(uuid, integer, jsonb, date) from public, anon, authenticated;
grant execute on function public.complete_gym_workout(uuid, integer, jsonb, date) to authenticated;

create function public.correct_gym_workout_results(
    p_workout_id uuid,
    p_expected_revision integer,
    p_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.correct_gym_workout_results(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.correct_gym_workout_results(uuid, integer, jsonb) to authenticated;
