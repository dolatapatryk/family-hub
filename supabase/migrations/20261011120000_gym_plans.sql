-- Immutable training-plan snapshots and progress derived from workout slots.
create table public.gym_plans (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null references auth.users (id) on delete cascade,
    source_template_id uuid,
    name text not null,
    weeks_count smallint not null,
    days_per_week smallint not null,
    definition_snapshot jsonb not null,
    definition_version smallint not null default 1,
    status text not null default 'active',
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    abandoned_at timestamptz,
    constraint gym_plans_name_not_blank check (char_length(btrim(name)) between 1 and 120),
    constraint gym_plans_weeks_count_range check (weeks_count between 1 and 52),
    constraint gym_plans_days_per_week_range check (days_per_week between 1 and 7),
    constraint gym_plans_definition_object check (jsonb_typeof(definition_snapshot) = 'object'),
    constraint gym_plans_definition_version_supported check (definition_version = 1),
    constraint gym_plans_status_valid check (status in ('active', 'completed', 'abandoned')),
    constraint gym_plans_source_template_owner_fk
        foreign key (source_template_id, owner_user_id)
        references public.gym_templates (id, owner_user_id),
    constraint gym_plans_lifecycle_timestamps check (
        (status = 'active' and completed_at is null and abandoned_at is null)
        or (status = 'completed' and completed_at is not null and abandoned_at is null)
        or (status = 'abandoned' and completed_at is null and abandoned_at is not null)
    ),
    constraint gym_plans_id_owner_unique unique (id, owner_user_id)
);

create unique index gym_plans_one_active_per_owner_idx
    on public.gym_plans (owner_user_id)
    where status = 'active';

create index gym_plans_owner_status_started_idx
    on public.gym_plans (owner_user_id, status, started_at desc);

alter table public.gym_plans enable row level security;

create policy gym_plans_select_own
on public.gym_plans
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on table public.gym_plans from public, anon, authenticated;
grant select (
    id, owner_user_id, source_template_id, name, weeks_count, days_per_week,
    definition_snapshot, definition_version, status, started_at, completed_at, abandoned_at
) on table public.gym_plans to authenticated;

-- A workout row represents one prescribed plan/week/day slot. Detailed exercise
-- results are added with the workout-entry feature; progress reads only these
-- slot rows and never maintains a separate counter.
create table public.gym_workouts (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null,
    owner_user_id uuid not null references auth.users (id) on delete cascade,
    week_number smallint not null,
    day_number smallint not null,
    status text not null default 'draft',
    revision integer not null default 1,
    performed_on date,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint gym_workouts_plan_owner_fk
        foreign key (plan_id, owner_user_id)
        references public.gym_plans (id, owner_user_id) on delete cascade,
    constraint gym_workouts_week_positive check (week_number between 1 and 52),
    constraint gym_workouts_day_positive check (day_number between 1 and 7),
    constraint gym_workouts_status_valid check (status in ('draft', 'completed')),
    constraint gym_workouts_revision_positive check (revision > 0),
    constraint gym_workouts_status_timestamps check (
        (status = 'draft' and performed_on is null and completed_at is null)
        or (status = 'completed' and performed_on is not null and completed_at is not null)
    ),
    constraint gym_workouts_plan_slot_unique unique (plan_id, week_number, day_number)
);

create index gym_workouts_owner_status_idx
    on public.gym_workouts (owner_user_id, status);

alter table public.gym_workouts enable row level security;

create policy gym_workouts_select_own
on public.gym_workouts
for select to authenticated
using (owner_user_id = (select auth.uid()));

revoke all on table public.gym_workouts from public, anon, authenticated;
grant select (
    id, plan_id, owner_user_id, week_number, day_number, status, revision,
    performed_on, started_at, completed_at, created_at, updated_at
) on table public.gym_workouts to authenticated;

create function public.start_gym_plan(
    p_template_id uuid,
    p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.start_gym_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.start_gym_plan(uuid, text) to authenticated;

create function public.abandon_gym_plan(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.abandon_gym_plan(uuid) from public, anon, authenticated;
grant execute on function public.abandon_gym_plan(uuid) to authenticated;
