-- Extend the already-applied monthly bill schema with a two-month cadence and
-- an auditable way to advance a bill without recording a payment.
alter table public.bills
    add column interval_months smallint not null default 1,
    add constraint bills_interval_months_supported check (interval_months in (1, 2));

comment on column public.bills.interval_months is
    'Number of months between bill cycles; supported values are 1 and 2.';

create table public.bill_skips (
    id uuid primary key default gen_random_uuid(),
    bill_id uuid not null,
    household_id uuid not null,
    due_on date not null,
    skipped_by uuid not null references auth.users (id) on delete restrict,
    skipped_at timestamptz not null default now(),
    constraint bill_skips_bill_household_fk
        foreign key (bill_id, household_id)
        references public.bills (id, household_id)
        on delete cascade,
    constraint bill_skips_due_on_finite check (isfinite(due_on)),
    constraint bill_skips_one_per_cycle unique (bill_id, due_on)
);

create index bill_skips_bill_due_idx
    on public.bill_skips (bill_id, due_on desc);

alter table public.bill_skips enable row level security;

create policy bill_skips_select_for_members
on public.bill_skips
for select to authenticated
using ((select private.is_household_member(household_id)));

revoke all on table public.bill_skips from public, anon, authenticated;
grant select (
    id, bill_id, household_id, due_on, skipped_by, skipped_at
) on table public.bill_skips to authenticated;

create function private.next_bill_due(
    p_due_day smallint,
    p_interval_months smallint,
    p_current_due date
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
    next_month_start date;
    days_in_next_month integer;
begin
    next_month_start := (
        pg_catalog.make_date(
            extract(year from p_current_due)::integer,
            extract(month from p_current_due)::integer,
            1
        ) + pg_catalog.make_interval(months => p_interval_months)
    )::date;
    days_in_next_month := extract(day from (
        next_month_start + pg_catalog.make_interval(months => 1) - interval '1 day'
    ))::integer;
    return next_month_start + (least(p_due_day, days_in_next_month) - 1);
end;
$$;

revoke all on function private.next_bill_due(smallint, smallint, date) from public, anon, authenticated;

drop function public.create_bill(uuid, text, date, bigint, text);

create function public.create_bill(
    p_household_id uuid,
    p_title text,
    p_next_due_on date,
    p_interval_months smallint default 1,
    p_expected_amount_minor bigint default null,
    p_currency text default 'PLN'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    normalized_title text := pg_catalog.btrim(p_title);
    normalized_currency text := pg_catalog.upper(pg_catalog.btrim(p_currency));
    new_bill_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to create a bill'
            using errcode = '42501';
    end if;

    if not private.is_household_member(p_household_id) then
        raise exception 'You must belong to the selected household'
            using errcode = '42501';
    end if;

    if normalized_title is null or pg_catalog.char_length(normalized_title) = 0 then
        raise exception 'Bill name must not be blank'
            using errcode = '22023';
    end if;

    if p_next_due_on is null or not isfinite(p_next_due_on) then
        raise exception 'A valid next due date is required'
            using errcode = '22023';
    end if;

    if p_expected_amount_minor is not null and p_expected_amount_minor <= 0 then
        raise exception 'Expected amount must be greater than zero'
            using errcode = '22023';
    end if;

    if p_interval_months is null or p_interval_months not in (1, 2) then
        raise exception 'Bill interval must be one or two months'
            using errcode = '22023';
    end if;

    if normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter code such as PLN or EUR'
            using errcode = '22023';
    end if;

    insert into public.bills (
        household_id, title, due_day, interval_months, next_due_on,
        expected_amount_minor, currency, created_by
    )
    values (
        p_household_id,
        normalized_title,
        extract(day from p_next_due_on)::smallint,
        p_interval_months,
        p_next_due_on,
        p_expected_amount_minor,
        normalized_currency,
        current_user_id
    )
    returning id into new_bill_id;

    return new_bill_id;
end;
$$;

revoke all on function public.create_bill(uuid, text, date, smallint, bigint, text) from public, anon, authenticated;
grant execute on function public.create_bill(uuid, text, date, smallint, bigint, text) to authenticated;

drop function public.update_bill(uuid, text, date, bigint, text);

create function public.update_bill(
    p_bill_id uuid,
    p_title text,
    p_next_due_on date,
    p_interval_months smallint,
    p_expected_amount_minor bigint,
    p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    bill_row public.bills%rowtype;
    normalized_title text := pg_catalog.btrim(p_title);
    normalized_currency text := pg_catalog.upper(pg_catalog.btrim(p_currency));
begin
    if (select auth.uid()) is null then
        raise exception 'Authentication is required to update a bill'
            using errcode = '42501';
    end if;

    select * into bill_row
    from public.bills
    where public.bills.id = p_bill_id
    for update;

    if not found or not private.is_household_member(bill_row.household_id) then
        raise exception 'Bill was not found in your household'
            using errcode = '42501';
    end if;

    if normalized_title is null or pg_catalog.char_length(normalized_title) = 0 then
        raise exception 'Bill name must not be blank'
            using errcode = '22023';
    end if;

    if p_next_due_on is null or not isfinite(p_next_due_on) then
        raise exception 'A valid next due date is required'
            using errcode = '22023';
    end if;

    if p_expected_amount_minor is not null and p_expected_amount_minor <= 0 then
        raise exception 'Expected amount must be greater than zero'
            using errcode = '22023';
    end if;

    if p_interval_months is null or p_interval_months not in (1, 2) then
        raise exception 'Bill interval must be one or two months'
            using errcode = '22023';
    end if;

    if normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter code such as PLN or EUR'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.bill_payments
        where public.bill_payments.bill_id = p_bill_id
          and public.bill_payments.due_on = p_next_due_on
    ) then
        raise exception 'That cycle already has a payment in the history'
            using errcode = '23505';
    end if;

    if exists (
        select 1
        from public.bill_skips
        where public.bill_skips.bill_id = p_bill_id
          and public.bill_skips.due_on = p_next_due_on
    ) then
        raise exception 'That cycle already has a skipped entry in the history'
            using errcode = '23505';
    end if;

    update public.bills
    set title = normalized_title,
        due_day = extract(day from p_next_due_on)::smallint,
        interval_months = p_interval_months,
        next_due_on = p_next_due_on,
        expected_amount_minor = p_expected_amount_minor,
        currency = normalized_currency
    where public.bills.id = p_bill_id;

    return p_bill_id;
end;
$$;

revoke all on function public.update_bill(uuid, text, date, smallint, bigint, text) from public, anon, authenticated;
grant execute on function public.update_bill(uuid, text, date, smallint, bigint, text) to authenticated;

create or replace function public.skip_bill_cycle(p_bill_id uuid, p_due_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    bill_row public.bills%rowtype;
    new_skip_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to skip a bill cycle'
            using errcode = '42501';
    end if;

    select * into bill_row
    from public.bills
    where public.bills.id = p_bill_id
    for update;

    if not found or not private.is_household_member(bill_row.household_id) then
        raise exception 'Bill was not found in your household'
            using errcode = '42501';
    end if;

    if not bill_row.active then
        raise exception 'Paused bills cannot skip cycles'
            using errcode = '55000';
    end if;

    if p_due_on is null or not isfinite(p_due_on) or p_due_on <> bill_row.next_due_on then
        raise exception 'This bill cycle has changed. Refresh the page and try again.'
            using errcode = '40001';
    end if;

    if exists (
        select 1
        from public.bill_payments
        where public.bill_payments.bill_id = p_bill_id
          and public.bill_payments.due_on = p_due_on
    ) then
        raise exception 'A paid cycle cannot be skipped'
            using errcode = '23505';
    end if;

    insert into public.bill_skips (bill_id, household_id, due_on, skipped_by)
    values (bill_row.id, bill_row.household_id, bill_row.next_due_on, current_user_id)
    returning id into new_skip_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.interval_months, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_skip_id;
end;
$$;

revoke all on function public.skip_bill_cycle(uuid, date) from public, anon, authenticated;
grant execute on function public.skip_bill_cycle(uuid, date) to authenticated;

create or replace function public.record_bill_payment(
    p_bill_id uuid,
    p_due_on date,
    p_paid_on date,
    p_amount_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := (select auth.uid());
    bill_row public.bills%rowtype;
    new_payment_id uuid;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to record a bill payment'
            using errcode = '42501';
    end if;

    select * into bill_row
    from public.bills
    where public.bills.id = p_bill_id
    for update;

    if not found or not private.is_household_member(bill_row.household_id) then
        raise exception 'Bill was not found in your household'
            using errcode = '42501';
    end if;

    if not bill_row.active then
        raise exception 'Paused bills cannot receive payments'
            using errcode = '55000';
    end if;

    if p_due_on is null or not isfinite(p_due_on) or p_due_on <> bill_row.next_due_on then
        raise exception 'This bill cycle has changed. Refresh the page and try again.'
            using errcode = '40001';
    end if;

    if p_paid_on is null or not isfinite(p_paid_on) then
        raise exception 'A valid payment date is required'
            using errcode = '22023';
    end if;

    if p_amount_minor is null or p_amount_minor <= 0 then
        raise exception 'Amount paid must be greater than zero'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.bill_skips
        where public.bill_skips.bill_id = p_bill_id
          and public.bill_skips.due_on = p_due_on
    ) then
        raise exception 'A skipped cycle cannot be marked as paid'
            using errcode = '23505';
    end if;

    insert into public.bill_payments (
        bill_id, household_id, due_on, paid_on, amount_minor, currency, created_by
    )
    values (
        bill_row.id, bill_row.household_id, bill_row.next_due_on, p_paid_on,
        p_amount_minor, bill_row.currency, current_user_id
    )
    returning id into new_payment_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.interval_months, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_payment_id;
end;
$$;

revoke all on function public.record_bill_payment(uuid, date, date, bigint) from public, anon, authenticated;
grant execute on function public.record_bill_payment(uuid, date, date, bigint) to authenticated;
