-- Bills have their own monthly schedule and payment history. They stay
-- separate from recurring household tasks because a bill cycle is paid with
-- an amount and an explicit payment date.
create table public.bills (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    title text not null,
    due_day smallint not null,
    next_due_on date not null,
    expected_amount_minor bigint,
    currency varchar(3) not null default 'PLN',
    active boolean not null default true,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint bills_title_not_blank check (char_length(btrim(title)) > 0),
    constraint bills_due_day_range check (due_day between 1 and 31),
    constraint bills_next_due_on_finite check (isfinite(next_due_on)),
    constraint bills_expected_amount_positive check (expected_amount_minor is null or expected_amount_minor > 0),
    constraint bills_currency_code check (currency ~ '^[A-Z]{3}$'),
    constraint bills_id_household_unique unique (id, household_id)
);

create index bills_household_active_due_idx
    on public.bills (household_id, active, next_due_on);

create table public.bill_payments (
    id uuid primary key default gen_random_uuid(),
    bill_id uuid not null,
    household_id uuid not null,
    due_on date not null,
    paid_on date not null,
    amount_minor bigint not null,
    currency varchar(3) not null,
    created_by uuid not null references auth.users (id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint bill_payments_bill_household_fk
        foreign key (bill_id, household_id)
        references public.bills (id, household_id)
        on delete cascade,
    constraint bill_payments_due_on_finite check (isfinite(due_on)),
    constraint bill_payments_paid_on_finite check (isfinite(paid_on)),
    constraint bill_payments_amount_positive check (amount_minor > 0),
    constraint bill_payments_currency_code check (currency ~ '^[A-Z]{3}$'),
    constraint bill_payments_one_per_cycle unique (bill_id, due_on)
);

comment on column public.bills.expected_amount_minor is
    'Integer hundredths of the bill currency; 100.23 is stored as 10023.';
comment on column public.bill_payments.amount_minor is
    'Integer hundredths of the payment currency; 100.23 is stored as 10023.';

create index bill_payments_household_paid_on_idx
    on public.bill_payments (household_id, paid_on desc);

create index bill_payments_bill_due_idx
    on public.bill_payments (bill_id, due_on desc);

alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;

create policy bills_select_for_members
on public.bills
for select to authenticated
using ((select private.is_household_member(household_id)));

create policy bill_payments_select_for_members
on public.bill_payments
for select to authenticated
using ((select private.is_household_member(household_id)));

revoke all on table public.bills, public.bill_payments from public, anon, authenticated;
grant select (
    id, household_id, title, due_day, next_due_on, expected_amount_minor, currency, active, created_by, created_at
) on table public.bills to authenticated;
grant select (
    id, bill_id, household_id, due_on, paid_on, amount_minor, currency, created_by, created_at
) on table public.bill_payments to authenticated;
create function private.next_bill_due(p_due_day smallint, p_current_due date)
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
        ) + interval '1 month'
    )::date;
    days_in_next_month := extract(day from (next_month_start + interval '1 month' - interval '1 day'))::integer;
    return next_month_start + (least(p_due_day, days_in_next_month) - 1);
end;
$$;

revoke all on function private.next_bill_due(smallint, date) from public, anon, authenticated;

create or replace function public.create_bill(
    p_household_id uuid,
    p_title text,
    p_next_due_on date,
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

    if normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter code such as PLN or EUR'
            using errcode = '22023';
    end if;

    insert into public.bills (
        household_id, title, due_day, next_due_on, expected_amount_minor, currency, created_by
    )
    values (
        p_household_id,
        normalized_title,
        extract(day from p_next_due_on)::smallint,
        p_next_due_on,
        p_expected_amount_minor,
        normalized_currency,
        current_user_id
    )
    returning id into new_bill_id;

    return new_bill_id;
end;
$$;

revoke all on function public.create_bill(uuid, text, date, bigint, text) from public, anon, authenticated;
grant execute on function public.create_bill(uuid, text, date, bigint, text) to authenticated;

create or replace function public.update_bill(
    p_bill_id uuid,
    p_title text,
    p_next_due_on date,
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

    update public.bills
    set title = normalized_title,
        due_day = extract(day from p_next_due_on)::smallint,
        next_due_on = p_next_due_on,
        expected_amount_minor = p_expected_amount_minor,
        currency = normalized_currency
    where public.bills.id = p_bill_id;

    return p_bill_id;
end;
$$;

revoke all on function public.update_bill(uuid, text, date, bigint, text) from public, anon, authenticated;
grant execute on function public.update_bill(uuid, text, date, bigint, text) to authenticated;

create or replace function public.set_bill_active(p_bill_id uuid, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    bill_row public.bills%rowtype;
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

    update public.bills set active = p_active where public.bills.id = p_bill_id;
    return p_bill_id;
end;
$$;

revoke all on function public.set_bill_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_bill_active(uuid, boolean) to authenticated;

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

    insert into public.bill_payments (
        bill_id, household_id, due_on, paid_on, amount_minor, currency, created_by
    )
    values (
        bill_row.id, bill_row.household_id, bill_row.next_due_on, p_paid_on, p_amount_minor, bill_row.currency, current_user_id
    )
    returning id into new_payment_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_payment_id;
end;
$$;

revoke all on function public.record_bill_payment(uuid, date, date, bigint) from public, anon, authenticated;
grant execute on function public.record_bill_payment(uuid, date, date, bigint) to authenticated;
