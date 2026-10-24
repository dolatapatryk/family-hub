-- Recurring bills and unified paid/skipped cycle history.
-- Fresh-install schema; definitions include all prior fixes.

-- Tables

CREATE TABLE public.bills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    title text NOT NULL,
    due_day smallint NOT NULL,
    next_due_on date NOT NULL,
    expected_amount_minor bigint,
    currency character varying(3) DEFAULT 'PLN'::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    interval_months smallint DEFAULT 1 NOT NULL,
    constraint bills_currency_code check (currency ~ '^[A-Z]{3}$'),
    constraint bills_due_day_range check (due_day between 1 and 31),
    constraint bills_expected_amount_positive check (expected_amount_minor is null or expected_amount_minor > 0),
    constraint bills_interval_months_supported check (interval_months in (1, 2)),
    constraint bills_next_due_on_finite check (isfinite(next_due_on)),
    constraint bills_title_not_blank check (char_length(btrim(title)) > 0),
    CONSTRAINT bills_id_household_unique UNIQUE (id, household_id),
    CONSTRAINT bills_pkey PRIMARY KEY (id),
    CONSTRAINT bills_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
    CONSTRAINT bills_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE
        CASCADE
);

CREATE TABLE public.bill_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bill_id uuid NOT NULL,
    household_id uuid NOT NULL,
    due_on date NOT NULL,
    paid_on date,
    amount_minor bigint,
    currency character varying(3),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'paid'::text NOT NULL,
    constraint bill_payments_due_on_finite check (isfinite(due_on)),
    constraint bill_payments_state_valid check (
        (status = 'paid' and paid_on is not null and isfinite(paid_on)
            and amount_minor is not null and amount_minor > 0
            and currency is not null and currency ~ '^[A-Z]{3}$')
        or (status = 'skipped' and paid_on is null and amount_minor is null and currency is null)
    ),
    constraint bill_payments_status check (status in ('paid', 'skipped')),
    CONSTRAINT bill_payments_one_per_cycle UNIQUE (bill_id, due_on),
    CONSTRAINT bill_payments_pkey PRIMARY KEY (id),
    CONSTRAINT bill_payments_bill_household_fk FOREIGN KEY (bill_id, household_id) REFERENCES public.bills(id,
        household_id) ON DELETE CASCADE,
    CONSTRAINT bill_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT
);

-- Indexes

create index bill_payments_bill_due_idx
    on public.bill_payments (bill_id, due_on desc);

create index bill_payments_household_paid_on_idx
    on public.bill_payments (household_id, paid_on desc) where status = 'paid';

create index bills_household_active_due_idx
    on public.bills (household_id, active, next_due_on);

-- Functions

CREATE FUNCTION private.next_bill_due(p_due_day smallint, p_current_due date) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION private.next_bill_due(
    p_due_day smallint,
    p_interval_months smallint,
    p_current_due date
) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.create_bill(
    p_household_id uuid,
    p_title text,
    p_next_due_on date,
    p_interval_months smallint DEFAULT 1,
    p_expected_amount_minor bigint DEFAULT NULL::bigint,
    p_currency text DEFAULT 'PLN'::text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;

CREATE FUNCTION public.set_bill_active(p_bill_id uuid, p_active boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE FUNCTION public.update_bill(
    p_bill_id uuid,
    p_title text,
    p_next_due_on date,
    p_interval_months smallint,
    p_expected_amount_minor bigint,
    p_currency text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
        raise exception 'That cycle already has an entry in the history'
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
$_$;

CREATE FUNCTION public.record_bill_payment(
    p_bill_id uuid,
    p_due_on date,
    p_paid_on date,
    p_amount_minor bigint
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
        from public.bill_payments
        where public.bill_payments.bill_id = p_bill_id
          and public.bill_payments.due_on = p_due_on
          and public.bill_payments.status = 'skipped'
    ) then
        raise exception 'A skipped cycle cannot be marked as paid'
            using errcode = '23505';
    end if;

    insert into public.bill_payments (
        bill_id, household_id, due_on, status, paid_on, amount_minor, currency, created_by
    )
    values (
        bill_row.id, bill_row.household_id, bill_row.next_due_on, 'paid', p_paid_on,
        p_amount_minor, bill_row.currency, current_user_id
    )
    returning id into new_payment_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.interval_months, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_payment_id;
end;
$$;

CREATE FUNCTION public.skip_bill_cycle(p_bill_id uuid, p_due_on date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
    current_user_id uuid := (select auth.uid());
    bill_row public.bills%rowtype;
    new_history_id uuid;
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
        raise exception 'This cycle already has a history entry'
            using errcode = '23505';
    end if;

    insert into public.bill_payments (bill_id, household_id, due_on, status, paid_on, amount_minor, currency, created_by)
    values (bill_row.id, bill_row.household_id, bill_row.next_due_on, 'skipped', null, null, null, current_user_id)
    returning id into new_history_id;

    update public.bills
    set next_due_on = private.next_bill_due(bill_row.due_day, bill_row.interval_months, bill_row.next_due_on)
    where public.bills.id = bill_row.id;

    return new_history_id;
end;
$$;

-- Row-level security

ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

-- Policies

create policy bill_payments_select_for_members
on public.bill_payments
for select to authenticated
using ((select private.is_household_member(household_id)));

create policy bills_select_for_members
on public.bills
for select to authenticated
using ((select private.is_household_member(household_id)));

-- Documentation

COMMENT ON COLUMN public.bill_payments.amount_minor IS 'Integer hundredths of the payment currency; 100.23 is stored as 10023.';

COMMENT ON COLUMN public.bills.expected_amount_minor IS 'Integer hundredths of the bill currency; 100.23 is stored as 10023.';

COMMENT ON COLUMN public.bills.interval_months IS 'Number of months between bill cycles; supported values are 1 and 2.';

-- Explicit API privileges (independent of project default grants).

REVOKE ALL ON FUNCTION private.next_bill_due(smallint, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.next_bill_due(smallint, smallint, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_bill(uuid, text, date, smallint, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_bill_payment(uuid, date, date, bigint) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_bill_active(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.skip_bill_cycle(uuid, date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_bill(uuid, text, date, smallint, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.bill_payments FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.bills FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.create_bill(p_household_id uuid, p_title text, p_next_due_on date, p_interval_months
    smallint, p_expected_amount_minor bigint, p_currency text) TO service_role;
GRANT ALL ON FUNCTION public.create_bill(p_household_id uuid, p_title text, p_next_due_on date, p_interval_months
    smallint, p_expected_amount_minor bigint, p_currency text) TO authenticated;
GRANT ALL ON FUNCTION public.record_bill_payment(p_bill_id uuid, p_due_on date, p_paid_on date, p_amount_minor
    bigint) TO service_role;
GRANT ALL ON FUNCTION public.record_bill_payment(p_bill_id uuid, p_due_on date, p_paid_on date, p_amount_minor
    bigint) TO authenticated;
GRANT ALL ON FUNCTION public.set_bill_active(p_bill_id uuid, p_active boolean) TO service_role;
GRANT ALL ON FUNCTION public.set_bill_active(p_bill_id uuid, p_active boolean) TO authenticated;
GRANT ALL ON FUNCTION public.skip_bill_cycle(p_bill_id uuid, p_due_on date) TO service_role;
GRANT ALL ON FUNCTION public.skip_bill_cycle(p_bill_id uuid, p_due_on date) TO authenticated;
GRANT ALL ON FUNCTION public.update_bill(p_bill_id uuid, p_title text, p_next_due_on date, p_interval_months
    smallint, p_expected_amount_minor bigint, p_currency text) TO service_role;
GRANT ALL ON FUNCTION public.update_bill(p_bill_id uuid, p_title text, p_next_due_on date, p_interval_months
    smallint, p_expected_amount_minor bigint, p_currency text) TO authenticated;
GRANT ALL ON TABLE public.bill_payments TO service_role;
GRANT SELECT ON TABLE public.bill_payments TO authenticated;
GRANT ALL ON TABLE public.bills TO service_role;
GRANT SELECT ON TABLE public.bills TO authenticated;
GRANT SELECT (id, bill_id, household_id, due_on, paid_on, amount_minor, currency, created_by, created_at, status)
    ON TABLE public.bill_payments TO authenticated;

GRANT SELECT (
    id,
    household_id,
    title,
    due_day,
    next_due_on,
    expected_amount_minor,
    currency,
    active,
    created_by,
    created_at
) ON TABLE public.bills TO authenticated;
