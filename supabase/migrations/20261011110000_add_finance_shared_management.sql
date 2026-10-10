-- Narrow, retry-safe mutations for shared reserve/project records. Read RLS
-- remains in place; revoke both table and column writes to prevent bypasses.
revoke insert, update, delete on public.finance_irregular_expense_plans,
    public.finance_projects, public.finance_project_expenses from authenticated;
revoke insert (household_id, created_by, name, annual_amount, sort_order),
    update (name, annual_amount, sort_order) on public.finance_irregular_expense_plans from authenticated;
revoke insert (household_id, created_by, name, description, target_budget, is_archived, sort_order),
    update (name, description, target_budget, is_archived, sort_order) on public.finance_projects from authenticated;
revoke insert (household_id, created_by, project_id, expense_date, name, amount, notes, sort_order),
    update (project_id, expense_date, name, amount, notes, sort_order) on public.finance_project_expenses from authenticated;
create function public.finance_mutate_shared_record(
    p_household_id uuid, p_request_id uuid, p_entity text, p_id uuid,
    p_expected_version bigint, p_delete boolean, p_details jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_hash text;
    v_saved_hash text;
    v_result jsonb;
    v_current bigint;
    v_id uuid;
    v_version bigint;
    v_name text := pg_catalog.btrim(p_details->>'name');
    v_amount public.finance_minor_units := (p_details->>'amount_minor')::bigint;
    v_target public.finance_minor_units := (p_details->>'target_budget_minor')::bigint;
    v_project_id uuid := (p_details->>'project_id')::uuid;
    v_date date := (p_details->>'expense_date')::date;
begin
    if v_actor is null or not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    if p_request_id is null or p_entity is null or p_entity not in ('reserve', 'project', 'expense')
        or p_delete is null or (p_id is null and (p_delete or p_expected_version is not null))
        or (p_id is not null and (p_expected_version is null or p_expected_version < 1)) then
        raise exception 'Invalid shared finance mutation request' using errcode = '22023';
    end if;
    perform private.finance_lock_household(p_household_id);
    if not private.is_household_member(p_household_id) then
        raise exception 'Finance household access denied' using errcode = '42501';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'entity', p_entity, 'id', p_id, 'version', p_expected_version, 'delete', p_delete, 'details', p_details)::text, 'UTF8'), 'sha256'), 'hex');
    select r.request_sha256, r.result into v_saved_hash, v_result from private.finance_operation_receipts r
    where r.household_id = p_household_id and r.actor_id = v_actor
      and r.operation_name = 'finance_mutate_shared_record' and r.request_id = p_request_id;
    if found then
        if v_hash <> v_saved_hash then
            raise exception 'Finance request ID was already used with different input' using errcode = 'P0001';
        end if;
        return v_result;
    end if;
    if p_id is not null then
        if p_entity = 'reserve' then
            select version into v_current from public.finance_irregular_expense_plans where household_id = p_household_id and id = p_id for update;
        elsif p_entity = 'project' then
            select version into v_current from public.finance_projects where household_id = p_household_id and id = p_id for update;
        else
            select version into v_current from public.finance_project_expenses where household_id = p_household_id and id = p_id for update;
        end if;
        if v_current is null then
            raise exception 'Shared finance record access denied' using errcode = '42501';
        end if;
        if v_current <> p_expected_version then
            return pg_catalog.jsonb_build_object('conflict', true, 'current_version', v_current);
        end if;
    end if;
    if p_delete then
        if p_entity = 'reserve' then
            delete from public.finance_irregular_expense_plans where household_id = p_household_id and id = p_id;
        elsif p_entity = 'project' then
            if exists (select 1 from public.finance_project_expenses where household_id = p_household_id and project_id = p_id) then
                raise exception 'Archive projects with expenses instead of deleting their history' using errcode = '22023';
            end if;
            delete from public.finance_projects where household_id = p_household_id and id = p_id;
        else
            if exists (select 1 from public.finance_project_expenses e
                join public.finance_projects p on p.household_id = e.household_id and p.id = e.project_id
                where e.household_id = p_household_id and e.id = p_id and p.is_archived) then
                raise exception 'Restore the project before deleting its expenses' using errcode = '22023';
            end if;
            delete from public.finance_project_expenses where household_id = p_household_id and id = p_id;
        end if;
        v_result := pg_catalog.jsonb_build_object('id', p_id, 'deleted', true);
    else
        if v_name is null or pg_catalog.char_length(v_name) = 0 or pg_catalog.char_length(v_name) > 160
            or pg_catalog.char_length(p_details->>'description') > 2000
            or pg_catalog.char_length(p_details->>'notes') > 2000 then
            raise exception 'Invalid shared finance details' using errcode = '22023';
        end if;
        if p_entity = 'reserve' then
            if v_amount is null or v_amount < 0 then
                raise exception 'Annual reserve must be nonnegative' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_irregular_expense_plans (household_id, created_by, name, annual_amount, sort_order)
                values (p_household_id, v_actor, v_name, v_amount, coalesce((p_details->>'sort_order')::integer, 0)) returning id, version into v_id, v_version;
            else
                update public.finance_irregular_expense_plans set name = v_name, annual_amount = v_amount,
                    sort_order = coalesce((p_details->>'sort_order')::integer, 0)
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        elsif p_entity = 'project' then
            if v_target is not null and v_target <= 0 then
                raise exception 'Project target must be positive' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_projects (household_id, created_by, name, description, target_budget, is_archived, sort_order)
                values (p_household_id, v_actor, v_name, nullif(pg_catalog.btrim(p_details->>'description'), ''), v_target,
                    coalesce((p_details->>'is_archived')::boolean, false), coalesce((p_details->>'sort_order')::integer, 0)) returning id, version into v_id, v_version;
            else
                update public.finance_projects set name = v_name, description = nullif(pg_catalog.btrim(p_details->>'description'), ''),
                    target_budget = v_target, is_archived = coalesce((p_details->>'is_archived')::boolean, false),
                    sort_order = coalesce((p_details->>'sort_order')::integer, 0)
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        else
            if v_amount is null or v_project_id is null then
                raise exception 'An expense requires an amount and a project' using errcode = '22023';
            end if;
            if not exists (select 1 from public.finance_projects where household_id = p_household_id and id = v_project_id and not is_archived) then
                raise exception 'Restore the project before adding or editing its expenses' using errcode = '22023';
            end if;
            if p_id is not null and exists (select 1 from public.finance_project_expenses e
                join public.finance_projects p on p.household_id = e.household_id and p.id = e.project_id
                where e.household_id = p_household_id and e.id = p_id and (p.is_archived or e.project_id <> v_project_id)) then
                raise exception 'Expenses cannot move projects or be edited in archived projects' using errcode = '22023';
            end if;
            if p_id is null then
                insert into public.finance_project_expenses (household_id, created_by, project_id, expense_date, name, amount, notes, sort_order)
                values (p_household_id, v_actor, v_project_id, v_date, v_name, v_amount, nullif(pg_catalog.btrim(p_details->>'notes'), ''),
                    coalesce((p_details->>'sort_order')::integer, 0)) returning id, version into v_id, v_version;
            else
                update public.finance_project_expenses set expense_date = v_date, name = v_name, amount = v_amount,
                    notes = nullif(pg_catalog.btrim(p_details->>'notes'), ''), sort_order = coalesce((p_details->>'sort_order')::integer, 0)
                where household_id = p_household_id and id = p_id returning id, version into v_id, v_version;
            end if;
        end if;
        v_result := pg_catalog.jsonb_build_object('id', v_id, 'version', v_version, 'deleted', false);
    end if;
    insert into private.finance_operation_receipts (household_id, actor_id, operation_name, request_id, request_sha256, result)
    values (p_household_id, v_actor, 'finance_mutate_shared_record', p_request_id, v_hash, v_result);
    return v_result;
end;
$$;
revoke all on function public.finance_mutate_shared_record(uuid, uuid, text, uuid, bigint, boolean, jsonb) from public, anon;
grant execute on function public.finance_mutate_shared_record(uuid, uuid, text, uuid, bigint, boolean, jsonb) to authenticated;
