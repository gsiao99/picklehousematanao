-- ============================================================================
-- Picklehouse Matanao — schema baseline
--
-- One file in place of the 51 migrations inherited from Dink District Digos.
-- It is the final state of those migrations with the café, inventory, desk
-- sales, paddle/ball rentals, gallery and player avatars removed, generated
-- with pg_dump (23 Nov 2026) and then reviewed. Comments on each object are
-- kept as COMMENT ON statements and inside function bodies.
--
-- Guest bookings (no player accounts) are added by the next migration.
-- Seed data at the end holds only facts confirmed by the owner.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- New tables and functions in public get no API access until a migration
-- grants it; new functions are not executable by PUBLIC.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges revoke execute on functions from public;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS private;




--
-- Name: account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_status AS ENUM (
    'active',
    'suspended'
);


--
-- Name: app_permission; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_permission AS ENUM (
    'payments.verify',
    'bookings.manage',
    'bookings.cancel',
    'schedule.manage',
    'openplay.manage',
    'events.manage',
    'players.manage',
    'content.manage',
    'reports.view'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'player',
    'staff',
    'admin'
);


--
-- Name: booking_payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_payment_status AS ENUM (
    'unpaid',
    'pending_verification',
    'paid',
    'refund_due',
    'refunded',
    'waived'
);


--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_status AS ENUM (
    'cart',
    'held',
    'pending_verification',
    'confirmed',
    'rejected',
    'expired',
    'cancelled',
    'completed'
);


--
-- Name: TYPE booking_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.booking_status IS 'Reservation lifecycle. The engine uses held → confirmed → completed, plus expired and cancelled. The legacy values cart, pending_verification and rejected are unused; payment progress lives in bookings.payment_status.';


--
-- Name: court_environment; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.court_environment AS ENUM (
    'indoor',
    'outdoor'
);


--
-- Name: court_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.court_status AS ENUM (
    'active',
    'maintenance',
    'inactive'
);


--
-- Name: event_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_status AS ENUM (
    'draft',
    'published',
    'registration_open',
    'registration_closed',
    'ongoing',
    'completed',
    'cancelled'
);


--
-- Name: event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_type AS ENUM (
    'open_play',
    'tournament',
    'clinic',
    'league',
    'social'
);


--
-- Name: payment_method_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method_kind AS ENUM (
    'gcash',
    'maya',
    'bank_transfer',
    'cash'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'submitted',
    'approved',
    'rejected'
);


--
-- Name: player_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.player_level AS ENUM (
    'novice',
    'low_intermediate',
    'high_intermediate',
    'advanced'
);


--
-- Name: rate_product; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rate_product AS ENUM (
    'court_rental',
    'open_play'
);


--
-- Name: registration_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.registration_status AS ENUM (
    'pending',
    'confirmed',
    'waitlisted',
    'cancelled',
    'rejected'
);


--
-- Name: slot_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.slot_kind AS ENUM (
    'rental',
    'open_play',
    'event',
    'block',
    'maintenance',
    'private_event'
);


--
-- Name: slot_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.slot_status AS ENUM (
    'held',
    'pending_verification',
    'confirmed',
    'checked_in',
    'completed',
    'no_show',
    'released',
    'cancelled'
);


--
-- Name: add_event_codes(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.add_event_codes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into private.event_codes (event_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: event_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    division_id uuid NOT NULL,
    stage text NOT NULL,
    round smallint NOT NULL,
    match_no smallint NOT NULL,
    entry_a uuid,
    entry_b uuid,
    next_match_id uuid,
    next_slot text,
    court_id uuid,
    scheduled tstzrange,
    status text DEFAULT 'scheduled'::text NOT NULL,
    score_a smallint,
    score_b smallint,
    winner uuid,
    result_note text,
    recorded_by uuid,
    recorded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_matches_check CHECK (((court_id IS NULL) = (scheduled IS NULL))),
    CONSTRAINT event_matches_check1 CHECK (((status <> 'completed'::text) OR ((score_a IS NOT NULL) AND (score_b IS NOT NULL) AND (winner IS NOT NULL)))),
    CONSTRAINT event_matches_match_no_check CHECK ((match_no > 0)),
    CONSTRAINT event_matches_next_slot_check CHECK ((next_slot = ANY (ARRAY['a'::text, 'b'::text]))),
    CONSTRAINT event_matches_result_note_check CHECK (((result_note IS NULL) OR (char_length(result_note) <= 300))),
    CONSTRAINT event_matches_round_check CHECK ((round > 0)),
    CONSTRAINT event_matches_scheduled_check CHECK (((scheduled IS NULL) OR ((NOT isempty(scheduled)) AND lower_inc(scheduled) AND (NOT upper_inc(scheduled))))),
    CONSTRAINT event_matches_score_a_check CHECK (((score_a IS NULL) OR (score_a >= 0))),
    CONSTRAINT event_matches_score_b_check CHECK (((score_b IS NULL) OR (score_b >= 0))),
    CONSTRAINT event_matches_stage_check CHECK ((stage = ANY (ARRAY['round_robin'::text, 'elimination'::text]))),
    CONSTRAINT event_matches_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'walkover'::text, 'bye'::text, 'cancelled'::text])))
);


--
-- Name: advance_winner(public.event_matches, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.advance_winner(_m public.event_matches, _winner uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if _m.next_match_id is null then
    return;
  end if;
  if _m.next_slot = 'a' then
    update public.event_matches set entry_a = _winner where id = _m.next_match_id;
  else
    update public.event_matches set entry_b = _winner where id = _m.next_match_id;
  end if;
end;
$$;


--
-- Name: amount_due(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.amount_due(_booking_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select greatest(b.total_centavos - coalesce((
           select sum(p.amount_centavos) from public.payments p
           where p.booking_id = b.id and p.status = 'approved'), 0), 0)
  from public.bookings b where b.id = _booking_id;
$$;


--
-- Name: audit_to_staff_notification(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_to_staff_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _t text := new.table_name;
  _a text := new.action;
  _n jsonb := coalesce(new.new_data, '{}'::jsonb);
  _o jsonb := coalesce(new.old_data, '{}'::jsonb);
  _d jsonb := coalesce(new.new_data, new.old_data, '{}'::jsonb);
  _title text;
  _body text;
  _link text;
  _who text;
  _by text;
  _why text := nullif(new.reason, '');
begin
  -- Who did it, when it was a staff member acting on someone else's record.
  select ' · by ' || p.full_name into _by
  from public.profiles p
  where p.id = new.actor_id
    and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role in ('staff', 'admin'));

  if _t = 'bookings' then
    select full_name into _who from public.profiles where id = (_d ->> 'player_id')::uuid;
    _link := '/admin/bookings/' || (_d ->> 'id');
    if _a = 'update' and _o ->> 'status' = 'held' and _n ->> 'status' = 'confirmed' then
      _title := 'New booking';
      _body := concat_ws(' · ', _d ->> 'reference', _who, private.booking_when((_d ->> 'id')::uuid),
                         private.peso((_d ->> 'total_centavos')::bigint));
    elsif _a = 'update' and _n ->> 'status' = 'cancelled' and _o ->> 'status' is distinct from 'cancelled'
          and _o ->> 'status' <> 'held' then
      _title := 'Booking cancelled';
      _body := concat_ws(' · ', _d ->> 'reference', _who, _n ->> 'cancel_reason');
    elsif _a = 'update' and _n ->> 'status' = 'confirmed' and _o ->> 'payment_status' is distinct from _n ->> 'payment_status' then
      _title := case _n ->> 'payment_status'
        when 'paid' then 'Booking paid'
        when 'unpaid' then case when _o ->> 'payment_status' = 'paid' then 'Payment reversed' end
        when 'refund_due' then 'Refund due'
        when 'refunded' then 'Refund recorded'
        when 'waived' then 'Payment waived'
      end;
      _body := concat_ws(' · ', _d ->> 'reference', _who, private.peso((_d ->> 'total_centavos')::bigint));
    elsif _a = 'update' and _n ->> 'payment_status' in ('refund_due', 'refunded')
          and _o ->> 'payment_status' is distinct from _n ->> 'payment_status' then
      _title := case _n ->> 'payment_status' when 'refund_due' then 'Refund due' else 'Refund recorded' end;
      _body := concat_ws(' · ', _d ->> 'reference', _who, private.peso((_d ->> 'total_centavos')::bigint));
    end if;

  elsif _t = 'payments' then
    -- Submissions already reach verifiers as 'payment_submitted'; approvals show up as "Booking paid".
    if _a = 'update' and _n ->> 'status' = 'rejected' and _o ->> 'status' is distinct from 'rejected' then
      select full_name into _who from public.profiles where id = (_d ->> 'submitted_by')::uuid;
      select concat_ws(' · ', b.reference, _who, private.peso((_d ->> 'amount_centavos')::bigint)),
             '/admin/bookings/' || b.id
        into _body, _link
      from public.bookings b where b.id = (_d ->> 'booking_id')::uuid;
      _title := 'Payment rejected';
    end if;

  elsif _t = 'booking_slots' then
    -- Staff blocks, maintenance and private events (rental and event slots are covered elsewhere).
    if _d ->> 'kind' in ('block', 'maintenance', 'private_event') then
      _link := '/admin/schedule?date=' || (_d ->> 'operating_date');
      if _a = 'insert' then
        _title := case _d ->> 'kind' when 'maintenance' then 'Court under maintenance'
                                     when 'private_event' then 'Private event added' else 'Court blocked' end;
      elsif _a = 'update' and _n ->> 'status' = 'cancelled' and _o ->> 'status' <> 'cancelled' then
        _title := 'Court block removed';
      end if;
      if _title is not null then
        select concat_ws(' · ', c.name,
                         to_char(lower((_d ->> 'slot')::tstzrange) at time zone private.venue_time_zone(), 'Dy, Mon FMDD'),
                         private.fmt_time(lower((_d ->> 'slot')::tstzrange)) || '–' || private.fmt_time(upper((_d ->> 'slot')::tstzrange)),
                         nullif(_d ->> 'note', ''))
          into _body
        from public.courts c where c.id = (_d ->> 'court_id')::uuid;
      end if;
    end if;

  elsif _t = 'user_roles' then
    select full_name into _who from public.profiles where id = (_d ->> 'user_id')::uuid;
    if _a = 'insert' and _d ->> 'role' = 'player' then
      _title := 'New player registered';
      _body := coalesce(_who, 'A new player') || ' created an account.';
      _link := '/admin/players?q=' || coalesce(_who, '');
    elsif _a = 'insert' then
      _title := 'Role granted';
      _body := coalesce(_who, 'A member') || ' is now ' || (_d ->> 'role');
      _link := '/admin/members';
    elsif _a = 'delete' and _d ->> 'role' <> 'player' then
      _title := 'Role removed';
      _body := coalesce(_who, 'A member') || ' is no longer ' || (_d ->> 'role');
      _link := '/admin/members';
    end if;

  elsif _t = 'staff_permissions' then
    select full_name into _who from public.profiles where id = (_d ->> 'user_id')::uuid;
    _title := 'Staff permissions changed';
    _body := coalesce(_who, 'A staff member') || '’s permissions were updated';
    _link := '/admin/members';
    _why := null;  -- one combined message per save

  elsif _t = 'profiles' then
    -- Only changes made by someone else (a player editing their own profile is not news).
    if _a = 'update' and new.actor_id is distinct from (_d ->> 'id')::uuid then
      _title := case when _o ->> 'status' is distinct from _n ->> 'status'
                     then case _n ->> 'status' when 'suspended' then 'Player suspended' else 'Player reactivated' end
                     when _o ->> 'level' is distinct from _n ->> 'level' then 'Player level changed'
                     else 'Player profile updated' end;
      _body := concat_ws(' · ', _n ->> 'full_name', case when _o ->> 'level' is distinct from _n ->> 'level'
                                                         then replace(coalesce(_n ->> 'level', 'not set'), '_', ' ') end);
      _link := '/admin/players?q=' || coalesce(_n ->> 'full_name', '');
    end if;

  elsif _t = 'events' then
    _link := case when _a = 'delete' then '/admin/events' else '/admin/events/' || (_d ->> 'id') end;
    if _a = 'insert' then
      _title := 'Event created';
    elsif _a = 'delete' then
      _title := 'Event deleted';
    elsif _o ->> 'status' is distinct from _n ->> 'status' then
      _title := case _n ->> 'status'
        when 'cancelled' then 'Event cancelled' when 'registration_open' then 'Registration opened'
        when 'registration_closed' then 'Registration closed' when 'published' then 'Event published'
        when 'ongoing' then 'Event started' when 'completed' then 'Event completed' else 'Event status changed' end;
    else
      _title := 'Event updated';
    end if;
    _body := _d ->> 'title';

  elsif _t = 'event_divisions' then
    select title, '/admin/events/' || id into _body, _link from public.events where id = (_d ->> 'event_id')::uuid;
    if _body is not null then
      _title := 'Event divisions changed';
    end if;

  elsif _t = 'event_registrations' then
    select full_name into _who from public.profiles where id = (_d ->> 'player_id')::uuid;
    select concat_ws(' · ', _who, title), '/admin/events/' || id into _body, _link
    from public.events where id = (_d ->> 'event_id')::uuid;
    if _a = 'insert' then
      _title := 'New registration';
    elsif _a = 'update' and _n ->> 'status' in ('cancelled', 'rejected') and _o ->> 'status' is distinct from _n ->> 'status' then
      _title := 'Registration cancelled';
    end if;

  elsif _t = 'check_ins' and _a = 'insert' then
    select full_name into _who from public.profiles where id = (_d ->> 'player_id')::uuid;
    _title := 'Player checked in';
    if _d ->> 'event_id' is not null then
      select concat_ws(' · ', _who, title), '/admin/events/' || id into _body, _link
      from public.events where id = (_d ->> 'event_id')::uuid;
    else
      select concat_ws(' · ', _who, b.reference, private.booking_when(b.id)), '/admin' into _body, _link
      from public.bookings b where b.id = (_d ->> 'booking_id')::uuid;
    end if;
    _body := coalesce(_body, _who);

  elsif _t = 'event_matches' then
    if _a = 'update' and _n ->> 'status' in ('completed', 'walkover') and _o ->> 'status' is distinct from _n ->> 'status' then
      _title := 'Match result recorded';
      select title, '/admin/events/' || id into _body, _link from public.events where id = (_d ->> 'event_id')::uuid;
    end if;

  elsif _t in ('venue_settings', 'courts', 'operating_hours', 'operating_hour_exceptions', 'rate_rules', 'payment_methods') then
    _title := 'Settings changed';
    _body := case _t
      when 'venue_settings' then 'Club settings were updated'
      when 'courts' then 'Courts were updated'
      when 'operating_hours' then 'Opening hours were updated'
      when 'operating_hour_exceptions' then 'Special opening hours were updated'
      when 'rate_rules' then 'Court rates were updated'
      when 'payment_methods' then 'Payment methods were updated'
    end;
    _link := '/admin/settings';
    _why := null;  -- one combined message per save
  end if;

  if _title is not null then
    perform private.notify_staff(
      _title,
      concat_ws(' · ', nullif(_body, ''), case when _why is not null and _title not in ('New booking', 'New player registered')
                                               then _why end) || coalesce(_by, ''),
      coalesce(_link, '/admin'),
      new.actor_id);
  end if;
  return null;
exception when others then
  -- Never let a notification problem undo the change that was being recorded.
  raise warning 'staff notification skipped for % %: %', _t, _a, sqlerrm;
  return null;
end;
$$;


--
-- Name: auto_confirm_level(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.auto_confirm_level() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.level is null and new.self_rated_level is not null then
    new.level := new.self_rated_level;
  end if;
  return new;
end;
$$;


--
-- Name: booking_when(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.booking_when(_booking_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select c.name || ' · ' || to_char(lower(bs.slot) at time zone private.venue_time_zone(), 'Dy, Mon FMDD') || ' · '
         || private.fmt_time(lower(bs.slot))
         || case when count(*) over () > 1 then ' (+' || (count(*) over () - 1) || ' more)' else '' end
  from public.booking_slots bs join public.courts c on c.id = bs.court_id
  where bs.booking_id = _booking_id
  order by lower(bs.slot)
  limit 1;
$$;


--
-- Name: bootstrap_first_admin(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.bootstrap_first_admin(_email text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _user_id uuid;
begin
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'An administrator already exists. Use admin_grant_role instead.' using errcode = '42501';
  end if;
  select id into _user_id from auth.users where lower(email) = lower(btrim(_email));
  if _user_id is null then
    raise exception 'No account uses %. Sign up in the app first, then run this again.', _email
      using errcode = 'P0002';
  end if;
  perform set_config('app.audit_reason', 'Initial administrator provisioning', true);
  insert into public.user_roles (user_id, role) values (_user_id, 'admin') on conflict do nothing;
  return _user_id;
end;
$$;


--
-- Name: bump_schedule_signal(date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.bump_schedule_signal(_date date) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.schedule_signals (operating_date) values (_date)
  on conflict (operating_date) do update
    set version = public.schedule_signals.version + 1, changed_at = now();
$$;


--
-- Name: can_manage_event_type(public.event_type); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_manage_event_type(_type public.event_type) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.has_permission('events.manage')
      or (_type = 'open_play' and private.has_permission('openplay.manage'));
$$;


--
-- Name: event_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    player_id uuid,
    partner_id uuid,
    booking_id uuid,
    status public.registration_status DEFAULT 'pending'::public.registration_status NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    division_id uuid,
    category_id uuid,
    attendance text,
    checked_in_at timestamp with time zone,
    checked_in_by uuid,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    created_by uuid,
    seed smallint,
    guest_name text,
    guest_phone text,
    partner_guest_name text,
    walk_in_paid_centavos bigint,
    walk_in_method public.payment_method_kind,
    walk_in_reference text,
    walk_in_recorded_at timestamp with time zone,
    walk_in_recorded_by uuid,
    walk_in_fee_due_centavos bigint,
    CONSTRAINT event_registrations_attendance_check CHECK ((attendance = ANY (ARRAY['present'::text, 'no_show'::text]))),
    CONSTRAINT event_registrations_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (char_length(cancel_reason) <= 300))),
    CONSTRAINT event_registrations_check CHECK (((partner_id IS NULL) OR (partner_id <> player_id))),
    CONSTRAINT event_registrations_guest_name_check CHECK (((guest_name IS NULL) OR ((char_length(btrim(guest_name)) >= 2) AND (char_length(btrim(guest_name)) <= 80)))),
    CONSTRAINT event_registrations_guest_phone_check CHECK (((guest_phone IS NULL) OR (guest_phone ~ '^09[0-9]{9}$'::text))),
    CONSTRAINT event_registrations_note_check CHECK (((note IS NULL) OR (char_length(note) <= 300))),
    CONSTRAINT event_registrations_one_partner CHECK (((partner_id IS NULL) OR (partner_guest_name IS NULL))),
    CONSTRAINT event_registrations_partner_guest_name_check CHECK (((partner_guest_name IS NULL) OR ((char_length(btrim(partner_guest_name)) >= 2) AND (char_length(btrim(partner_guest_name)) <= 80)))),
    CONSTRAINT event_registrations_seed_check CHECK (((seed IS NULL) OR (seed > 0))),
    CONSTRAINT event_registrations_walk_in_fee_due_centavos_check CHECK (((walk_in_fee_due_centavos IS NULL) OR (walk_in_fee_due_centavos > 0))),
    CONSTRAINT event_registrations_walk_in_paid_centavos_check CHECK (((walk_in_paid_centavos IS NULL) OR (walk_in_paid_centavos >= 0))),
    CONSTRAINT event_registrations_walk_in_payment CHECK (((walk_in_paid_centavos IS NULL) = (walk_in_method IS NULL))),
    CONSTRAINT event_registrations_walk_in_reference_check CHECK (((walk_in_reference IS NULL) OR (char_length(walk_in_reference) <= 60))),
    CONSTRAINT event_registrations_who CHECK (((player_id IS NOT NULL) OR (guest_name IS NOT NULL)))
);


--
-- Name: COLUMN event_registrations.category_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_registrations.category_id IS 'The category of the division the player registered in, recorded on the registration itself.';


--
-- Name: COLUMN event_registrations.guest_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_registrations.guest_name IS 'Walk-in entry: the name of someone without an account, entered by an admin (player_id is then null).';


--
-- Name: COLUMN event_registrations.walk_in_fee_due_centavos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_registrations.walk_in_fee_due_centavos IS 'Open play walk-in who pays later: the fee still owed. Cleared when staff record the payment.';


--
-- Name: cancel_registration(public.event_registrations, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cancel_registration(_reg public.event_registrations, _by uuid, _why text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform set_config('app.audit_reason', _why, true);
  update public.event_registrations
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(_why, 300)
   where id = _reg.id;
  if _reg.booking_id is not null then
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = _by, cancel_reason = left(_why, 300),
           payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                                 else payment_status end
     where id = _reg.booking_id and status = 'confirmed';
  end if;
  -- Waiting places go; a game already called or in progress finishes normally.
  update public.queue_entries
     set status = 'removed', ended_at = now()
   where event_id = _reg.event_id and status = 'waiting'
     and (player_id in (_reg.player_id, _reg.partner_id) or (player_id is null and registration_id = _reg.id));
end;
$$;


--
-- Name: cancel_registrations_for_booking(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cancel_registrations_for_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status in ('cancelled', 'expired') and old.status is distinct from new.status then
    update public.event_registrations
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = left(coalesce(new.cancel_reason, 'Entry fee booking ' || new.status), 300)
     where booking_id = new.id and status in ('pending', 'confirmed', 'waitlisted');
  end if;
  return null;
end;
$$;


--
-- Name: category_level(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.category_level() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    new.level_key := coalesce(new.level_key, private.level_key_for(new.slug));
    perform private.ensure_player_level(new.level_key, new.sort_order);
  else
    new.level_key := old.level_key;
  end if;
  return new;
end;
$$;


--
-- Name: check_capacity_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.check_capacity_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _taken int;
begin
  if new.capacity is null or new.capacity >= coalesce(old.capacity, 2147483647) then
    return new;
  end if;
  if tg_table_name = 'events' then
    perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.id::text));
    _taken := private.event_people(new.id);
  else
    perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.event_id::text));
    _taken := private.division_entries(new.id);
  end if;
  if new.capacity < _taken then
    raise exception 'Capacity cannot be lower than the % places already taken.', _taken using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: check_registration(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.check_registration() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events;
  _d public.event_divisions;
  _becoming_active boolean;
  _has_partner boolean := new.partner_id is not null or new.partner_guest_name is not null;
begin
  if new.status not in ('pending', 'confirmed', 'waitlisted') then
    return new;
  end if;

  -- Serialise every registration change for this event.
  perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.event_id::text));
  select * into _e from public.events where id = new.event_id;

  if new.division_id is not null then
    select * into _d from public.event_divisions where id = new.division_id;
    if not found or _d.event_id <> new.event_id then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
    new.category_id := _d.category_id;
    if _d.team_size = 2 and not _has_partner then
      raise exception '% is a doubles division. Add your partner.', _d.name using errcode = '22023';
    end if;
    if _d.team_size = 1 and _has_partner then
      raise exception '% is a singles division.', _d.name using errcode = '22023';
    end if;
  elsif exists (select 1 from public.event_divisions where event_id = new.event_id) then
    raise exception 'Choose a division.' using errcode = '22023';
  end if;

  if new.partner_id = new.player_id then
    raise exception 'Your partner must be another player.' using errcode = '22023';
  end if;

  -- Nobody may hold two live places in the same division (as player or partner).
  if exists (
    select 1 from public.event_registrations r
    where r.id <> new.id and r.event_id = new.event_id
      and r.division_id is not distinct from new.division_id
      and r.status in ('pending', 'confirmed', 'waitlisted')
      and (r.player_id in (new.player_id, new.partner_id) or r.partner_id in (new.player_id, new.partner_id))
  ) then
    raise exception '%', case when new.partner_id is null
      then 'You are already registered for this.'
      else 'You or your partner are already registered for this.' end
      using errcode = '23505';
  end if;

  _becoming_active := tg_op = 'INSERT'
    or old.status not in ('pending', 'confirmed')
    or (old.partner_id is null and new.partner_id is not null)
    or old.division_id is distinct from new.division_id;

  if _becoming_active and new.status in ('pending', 'confirmed') then
    if _e.capacity is not null
       and private.event_people(new.event_id, new.id) + 1 + _has_partner::int > _e.capacity then
      raise exception '% is full.', _e.title using errcode = '22023';
    end if;
    if new.division_id is not null and _d.capacity is not null
       and private.division_entries(new.division_id, new.id) + 1 > _d.capacity then
      raise exception '% is full.', _d.name using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: close_event_queue(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.close_event_queue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status in ('cancelled', 'completed') and old.status is distinct from new.status then
    update public.queue_games set status = 'cancelled', ended_at = now()
     where event_id = new.id and status in ('called', 'playing');
    update public.queue_entries set status = 'removed', ended_at = now()
     where event_id = new.id and status in ('waiting', 'called', 'playing');
  end if;
  return null;
end;
$$;


--
-- Name: confirm_registrations_for_booking(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.confirm_registrations_for_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r record;
begin
  if new.payment_status in ('paid', 'waived') and old.payment_status is distinct from new.payment_status
     and new.status = 'confirmed' then
    for _r in
      update public.event_registrations set status = 'confirmed'
       where booking_id = new.id and status = 'pending'
      returning player_id, event_id
    loop
      perform private.notify(_r.player_id, 'registration_confirmed', 'You’re in: ' || e.title,
        'Your entry fee was received. Your place is confirmed.', '/my/events')
      from public.events e where e.id = _r.event_id;
    end loop;
  end if;
  return null;
end;
$$;


--
-- Name: create_registration(uuid, uuid, uuid, uuid, uuid, boolean, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.create_registration(_event_id uuid, _division_id uuid, _player_id uuid, _partner_id uuid, _by uuid, _waive_fee boolean, _note text) RETURNS TABLE(registration_id uuid, status public.registration_status, booking_id uuid, amount_due_centavos bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
  _d public.event_divisions;
  _min public.player_level;
  _max public.player_level;
  _who record;
  _fee bigint;
  _reg uuid;
  _booking uuid;
  _status public.registration_status;
  _hours int;
begin
  select * into _e from public.events where id = _event_id;
  if _division_id is not null then
    select * into _d from public.event_divisions where id = _division_id and event_id = _event_id;
    if not found then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
  end if;

  -- Skill requirement: staff-assessed level, else the player's own rating.
  _min := coalesce(_d.skill_min, _e.skill_min);
  _max := coalesce(_d.skill_max, _e.skill_max);
  if _min is not null or _max is not null then
    for _who in
      select p.id, p.full_name, coalesce(p.level, p.self_rated_level) as lvl
      from public.profiles p where p.id in (_player_id, _partner_id)
    loop
      if _who.lvl is null then
        raise exception '% has no skill level set. Add it in the profile first.',
          case when _who.id = _player_id and _by = _player_id then 'Your account' else _who.full_name end
          using errcode = '22023';
      end if;
      if (_min is not null and _who.lvl < _min) or (_max is not null and _who.lvl > _max) then
        raise exception 'Level required: %. % %.',
          case when _min is null then 'up to ' || private.level_label(_max)
               when _max is null then private.level_label(_min) || ' or higher'
               when _min = _max then private.level_label(_min)
               else private.level_label(_min) || ' to ' || private.level_label(_max) end,
          case when _who.id = _player_id and _by = _player_id then 'Your level is' else _who.full_name || '''s level is' end,
          private.level_label(_who.lvl)
          using errcode = '22023';
      end if;
    end loop;
  end if;

  _fee := coalesce(_d.fee_centavos, _e.fee_centavos)
          * case when _e.fee_unit = 'per_player' then 1 + (_partner_id is not null)::int else 1 end;
  _status := case when _fee > 0 and not _waive_fee then 'pending' else 'confirmed' end;

  begin
    insert into public.event_registrations (event_id, division_id, player_id, partner_id, status, note, created_by)
    values (_event_id, _division_id, _player_id, _partner_id, _status, nullif(btrim(coalesce(_note, '')), ''), _by)
    returning id into _reg;
  exception when unique_violation then
    raise exception '%', case when sqlerrm like 'duplicate key%' then 'You or your partner are already registered for this.'
                              else sqlerrm end using errcode = '23505';
  end;

  if _fee > 0 then
    select payment_due_hours into _hours from public.venue_settings limit 1;
    insert into public.bookings (player_id, created_by, status, total_centavos, payment_status, confirmed_at, event_id,
                                 payment_due_at, notes)
    values (_player_id, _by, 'confirmed', _fee,
            case when _waive_fee then 'waived'::public.booking_payment_status else 'unpaid'::public.booking_payment_status end,
            now(), _event_id,
            case when _hours is not null and not _waive_fee then least(now() + make_interval(hours => _hours), _e.starts_at) end,
            left('Entry fee: ' || _e.title || coalesce(' · ' || _d.name, ''), 500))
    returning id into _booking;
    update public.event_registrations set booking_id = _booking where id = _reg;
  end if;

  perform private.notify(_player_id,
    case when _status = 'confirmed' then 'registration_confirmed' else 'registration_pending_payment' end,
    case when _status = 'confirmed' then 'You’re in: ' || _e.title else 'Pay to confirm: ' || _e.title end,
    case when _status = 'confirmed' then coalesce(_d.name || ' · ', '') || 'Your place is confirmed.'
         else 'Your place is held. Pay the entry fee of ₱' || to_char(_fee / 100.0, 'FM999,999,990.00')
              || ' to confirm it.' end,
    case when _booking is not null and _status = 'pending' then '/bookings/' || _booking else '/my/events' end);
  if _partner_id is not null then
    perform private.notify(_partner_id, 'partner_added', 'You’ve been added as a partner',
      private.public_name(_player_id) || ' registered you for ' || _e.title || coalesce(' · ' || _d.name, '') || '.',
      '/my/events');
  end if;

  return query select _reg, _status, _booking, case when _status = 'pending' then _fee else 0::bigint end;
end;
$$;


--
-- Name: division_entries(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.division_entries(_division_id uuid, _exclude uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select count(*)::int from public.event_registrations
  where division_id = _division_id and status in ('pending', 'confirmed')
    and (_exclude is null or id <> _exclude);
$$;


--
-- Name: enqueue(uuid, uuid, uuid, integer, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.enqueue(_event_id uuid, _player_id uuid, _reg uuid, _consecutive integer, _stay_court uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _id uuid;
begin
  insert into public.queue_entries (event_id, player_id, registration_id, consecutive_games, stay_court_id, queued_at)
  values (_event_id, _player_id, _reg, _consecutive, _stay_court, clock_timestamp())
  returning id into _id;
  return _id;
exception when unique_violation then
  raise exception '% already in the queue.',
    case when _player_id = auth.uid() then 'You are' else coalesce(private.queue_person_name(_player_id, _reg), 'This player') || ' is' end
    using errcode = '23505';
end;
$$;


--
-- Name: ensure_player_level(text, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.ensure_player_level(_key text, _sort integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _before text;
begin
  if exists (select 1 from pg_enum e where e.enumtypid = 'public.player_level'::regtype and e.enumlabel = _key) then
    return;
  end if;
  select c.level_key into _before
  from public.event_categories c
  join pg_enum e on e.enumtypid = 'public.player_level'::regtype and e.enumlabel = c.level_key
  where c.sort_order > _sort and c.level_key <> _key
  order by c.sort_order, c.name
  limit 1;
  if _before is not null then
    execute format('alter type public.player_level add value %L before %L', _key, _before);
  else
    execute format('alter type public.player_level add value %L', _key);
  end if;
end;
$$;


--
-- Name: entry_label(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.entry_label(_registration_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(private.public_name(r.player_id), r.guest_name)
         || coalesce(' / ' || coalesce(private.public_name(r.partner_id), r.partner_guest_name), '')
  from public.event_registrations r where r.id = _registration_id;
$$;


--
-- Name: event_people(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.event_people(_event_id uuid, _exclude uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(sum(1 + (partner_id is not null or partner_guest_name is not null)::int), 0)::int
  from public.event_registrations
  where event_id = _event_id and status in ('pending', 'confirmed')
    and (_exclude is null or id <> _exclude);
$$;


--
-- Name: expire_stale_holds(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.expire_stale_holds() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _ids uuid[];
begin
  with expired as (
    update public.bookings
       set status = 'expired', expired_at = now()
     where status = 'held' and hold_expires_at <= now()
    returning id
  )
  select coalesce(array_agg(id), '{}') into _ids from expired;

  if cardinality(_ids) > 0 then
    update public.booking_slots set status = 'released'
     where booking_id = any (_ids) and status = 'held';
  end if;
  return cardinality(_ids);
end;
$$;


--
-- Name: expire_unpaid_bookings(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.expire_unpaid_bookings() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _b record;
  _n int := 0;
begin
  for _b in
    select b.id, b.player_id, b.reference, b.event_id, e.title
    from public.bookings b left join public.events e on e.id = b.event_id
    where b.status = 'confirmed' and b.payment_status = 'unpaid'
      and b.payment_due_at is not null and b.payment_due_at <= now()
    for update of b skip locked
  loop
    perform set_config('app.audit_reason', 'Payment not received by the deadline', true);
    update public.booking_slots set status = 'cancelled'
     where booking_id = _b.id and status in ('held', 'confirmed');
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not received by the deadline'
     where id = _b.id;
    perform private.notify(_b.player_id, 'booking_cancelled',
      case when _b.event_id is null then 'Booking cancelled' else 'Entry cancelled: ' || _b.title end,
      case when _b.event_id is null
        then format('%s was cancelled because payment was not received in time. The times are open again.', _b.reference)
        else 'Your entry was cancelled because the fee was not paid in time. The place is open again.' end,
      case when _b.event_id is null then '/bookings/' || _b.id else '/my/events' end);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;


--
-- Name: extend_payment_due_after_rejection(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.extend_payment_due_after_rejection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _first timestamptz;
begin
  if new.status = 'confirmed' and new.payment_due_at is not null
     and old.payment_status = 'pending_verification' and new.payment_status = 'unpaid' then
    select min(lower(slot)) into _first from public.booking_slots
     where booking_id = new.id and status not in ('released', 'cancelled');
    new.payment_due_at := least(greatest(new.payment_due_at, now() + interval '30 minutes'),
                                coalesce(_first, 'infinity'::timestamptz));
    new.payment_reminder_sent_at := null;
  end if;
  return new;
end;
$$;


--
-- Name: find_partner(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.find_partner(_email text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _id uuid;
begin
  if _email is null or btrim(_email) = '' then
    return null;
  end if;
  select p.id into _id from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(_email)) and p.status = 'active';
  if _id is null then
    raise exception 'No active player uses that email. Your partner needs an account first.' using errcode = 'P0002';
  end if;
  return _id;
end;
$$;


--
-- Name: fmt_time(timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.fmt_time(_ts timestamp with time zone) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select case to_char(_ts at time zone private.venue_time_zone(), 'HH24:MI')
    when '12:00' then '12:00 NN'
    when '00:00' then '12:00 MN'
    else ltrim(to_char(_ts at time zone private.venue_time_zone(), 'HH12:MI AM'), '0')
  end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _name text := btrim(coalesce(_meta ->> 'full_name', ''));
  _phone text := regexp_replace(coalesce(_meta ->> 'phone', ''), '[^0-9]', '', 'g');
  _level text := _meta ->> 'self_rated_level';
  _consent boolean := coalesce((_meta ->> 'privacy_consent')::boolean, false);
begin
  if char_length(_name) < 2 then
    _name := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Player');
  end if;
  if char_length(_name) > 80 then
    _name := left(_name, 80);
  end if;
  if _phone ~ '^639[0-9]{9}$' then
    _phone := '0' || substr(_phone, 3);
  end if;
  if _phone !~ '^09[0-9]{9}$' then
    _phone := null;
  end if;
  -- Only levels on offer: the active event categories.
  if _level is not null and not exists (
    select 1 from public.event_categories c where c.level_key = _level and c.is_active
  ) then
    _level := null;
  end if;

  insert into public.profiles (id, full_name, phone, self_rated_level, privacy_consent_at)
  values (new.id, _name, _phone, _level::public.player_level, case when _consent then now() end);

  insert into public.user_roles (user_id, role) values (new.id, 'player');

  return new;
end;
$_$;


--
-- Name: has_permission(public.app_permission); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.has_permission(_permission public.app_permission) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_admin()
      or (
        private.has_role('staff')
        and exists (
          select 1 from public.staff_permissions sp
          where sp.user_id = auth.uid() and sp.permission = _permission
        )
      );
$$;


--
-- Name: has_role(public.app_role); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.has_role(_role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = _role
      and p.status = 'active'
  );
$$;


--
-- Name: is_active_user(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_active_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.has_role('admin');
$$;


--
-- Name: is_staff(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.has_role('staff') or private.has_role('admin');
$$;


--
-- Name: level_key_for(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.level_key_for(_slug text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select left(case when k ~ '^[a-z]' then k else 'level_' || k end, 63)
  from (select trim(both '_' from regexp_replace(lower(coalesce(_slug, '')), '[^a-z0-9]+', '_', 'g')) as k) s;
$$;


--
-- Name: level_label(public.player_level); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.level_label(_l public.player_level) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    (select c.name from public.event_categories c where c.level_key = _l::text),
    case _l::text when 'novice' then 'Novice' when 'low_intermediate' then 'Low intermediate'
                  when 'high_intermediate' then 'High intermediate' when 'advanced' then 'Advanced'
                  else initcap(replace(_l::text, '_', ' ')) end);
$$;


--
-- Name: match_results(date, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.match_results(_from date, _to date) RETURNS TABLE(player_id uuid, match_id uuid, event_id uuid, played_on date, won boolean, walkover boolean, points_for integer, points_against integer, points integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p.pid, m.id, m.event_id, private.operating_date_of(coalesce(lower(m.scheduled), m.recorded_at)),
         x.entry = m.winner, m.status = 'walkover',
         x.pf, x.pa,
         case when x.entry = m.winner then 3 when m.status = 'walkover' then 0 else 1 end
  from public.event_matches m
  join public.events e on e.id = m.event_id and e.status <> 'cancelled'
  cross join lateral (values (m.entry_a, coalesce(m.score_a, 0), coalesce(m.score_b, 0)),
                             (m.entry_b, coalesce(m.score_b, 0), coalesce(m.score_a, 0))) as x(entry, pf, pa)
  join public.event_registrations r on r.id = x.entry
  cross join lateral unnest(array[r.player_id, r.partner_id]) as p(pid)
  where m.status in ('completed', 'walkover') and p.pid is not null
    and (_from is null or private.operating_date_of(coalesce(lower(m.scheduled), m.recorded_at)) >= _from)
    and (_to is null or private.operating_date_of(coalesce(lower(m.scheduled), m.recorded_at)) <= _to);
$$;


--
-- Name: next_booking_reference(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.next_booking_reference() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select 'DD-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-'
         || lpad(nextval('private.booking_reference_seq')::text, 4, '0');
$$;


--
-- Name: notify(uuid, text, text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify(_user uuid, _kind text, _title text, _body text, _link text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.notifications (user_id, kind, title, body, link)
  select _user, _kind, _title, _body, _link where _user is not null;
$$;


--
-- Name: notify_on_deck(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify_on_deck(_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events;
  _q record;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.event_type <> 'open_play' then
    return;
  end if;
  for _q in
    select w.id, w.player_id, w.pos from (
      select q.id, q.player_id, q.on_deck_notified_at,
             row_number() over (partition by q.division_id
                                order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
      from public.queue_entries q
      where q.event_id = _event_id and q.status = 'waiting'
    ) w
    where w.pos <= 2 * _e.queue_players_per_game and w.on_deck_notified_at is null
  loop
    update public.queue_entries set on_deck_notified_at = now() where id = _q.id;
    perform private.notify(_q.player_id, 'queue_soon', 'You’re on deck',
      format('You’re #%s in line for %s. Stay close, you’ll be called soon.', _q.pos, _e.title),
      '/player/paddle-stacking');
  end loop;
end;
$$;


--
-- Name: notify_payment_verifiers(text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify_payment_verifiers(_title text, _body text, _link text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct p.id, 'payment_submitted', _title, _body, _link
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  where p.status = 'active'
    and (ur.role = 'admin'
         or (ur.role = 'staff' and exists (select 1 from public.staff_permissions sp
                                           where sp.user_id = p.id and sp.permission = 'payments.verify')));
$$;


--
-- Name: notify_staff(text, text, text, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.notify_staff(_title text, _body text, _link text, _actor uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct p.id, 'staff_activity', left(_title, 120), left(_body, 500), _link
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id and ur.role in ('staff', 'admin')
  where p.status = 'active'
    and p.id is distinct from _actor
    and not exists (
      select 1 from public.notifications n
      where n.user_id = p.id and n.kind = 'staff_activity'
        and n.title = left(_title, 120) and n.body is not distinct from left(_body, 500)
        and n.created_at > now() - interval '20 seconds');
$$;


--
-- Name: on_event_cancelled(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.on_event_cancelled() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
  _why text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    _why := coalesce(new.cancel_reason, 'Event cancelled');
    update public.booking_slots set status = 'cancelled'
     where event_id = new.id and status not in ('cancelled', 'released');
    for _r in select * from public.event_registrations
              where event_id = new.id and status in ('pending', 'confirmed', 'waitlisted') loop
      perform private.cancel_registration(_r, auth.uid(), _why);
      perform private.notify(_r.player_id, 'event_cancelled', 'Cancelled: ' || new.title, _why, '/my/events');
      if _r.partner_id is not null then
        perform private.notify(_r.partner_id, 'event_cancelled', 'Cancelled: ' || new.title, _why, '/my/events');
      end if;
    end loop;
  end if;
  return null;
end;
$$;


--
-- Name: open_play_division_individual(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.open_play_division_individual() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.event_type = 'open_play') then
    new.team_size := 1;
  end if;
  return new;
end;
$$;


--
-- Name: open_play_registration_individual(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.open_play_registration_individual() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.partner_id is not null
     and exists (select 1 from public.events e where e.id = new.event_id and e.event_type = 'open_play') then
    raise exception 'Open play is for individual players. Each player books their own place.' using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: operating_date_of(timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.operating_date_of(_ts timestamp with time zone) RETURNS date
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _cutoff time;
  _local timestamp := _ts at time zone private.venue_time_zone();
begin
  select operating_day_cutoff into _cutoff from public.venue_settings limit 1;
  _cutoff := coalesce(_cutoff, '04:00');
  return case when _local::time < _cutoff then (_local - interval '1 day')::date else _local::date end;
end;
$$;


--
-- Name: operating_window(date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.operating_window(_date date) RETURNS TABLE(state text, opens_at timestamp with time zone, closes_at timestamp with time zone, note text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _tz text := private.venue_time_zone();
  _cutoff time;
  _closed boolean;
  _open time;
  _close time;
  _note text;
  _found boolean := false;
begin
  select operating_day_cutoff into _cutoff from public.venue_settings limit 1;
  _cutoff := coalesce(_cutoff, '04:00');

  select e.is_closed, e.opens_at, e.closes_at, e.note into _closed, _open, _close, _note
  from public.operating_hour_exceptions e where e.date = _date;
  _found := found;
  if not _found then
    select h.is_closed, h.opens_at, h.closes_at into _closed, _open, _close
    from public.operating_hours h where h.weekday = extract(dow from _date)::smallint;
    _found := found;
  end if;

  if not _found then
    return query select 'unconfigured'::text, null::timestamptz, null::timestamptz, null::text;
    return;
  end if;
  if _closed then
    return query select 'closed'::text, null::timestamptz, null::timestamptz, _note;
    return;
  end if;

  -- Closing after midnight belongs to the same operating day, capped at the day cutoff.
  if _close <= _open and _close > _cutoff then
    _close := _cutoff;
  end if;

  return query select
    'open'::text,
    (_date + _open) at time zone _tz,
    (case when _close <= _open then _date + 1 else _date end + _close) at time zone _tz,
    _note;
end;
$$;


--
-- Name: owns_booking(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owns_booking(_booking_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.bookings b where b.id = _booking_id and b.player_id = auth.uid());
$$;


--
-- Name: payment_deadline_for(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.payment_deadline_for(_booking_id uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _due_minutes int;
  _hours int;
  _same_day int;
  _first timestamptz;
  _first_date date;
  _due timestamptz;
begin
  select payment_due_minutes, payment_due_hours, same_day_payment_minutes
    into _due_minutes, _hours, _same_day
  from public.venue_settings limit 1;
  if _due_minutes is null and _hours is null then
    return null;
  end if;
  select lower(slot), operating_date into _first, _first_date
  from public.booking_slots
  where booking_id = _booking_id and status not in ('released', 'cancelled')
  order by lower(slot)
  limit 1;
  _due := now() + coalesce(make_interval(mins => _due_minutes), make_interval(hours => _hours));
  if _same_day is not null and _first_date = private.operating_date_of(now()) then
    _due := least(_due, now() + make_interval(mins => _same_day));
  end if;
  return least(_due, coalesce(_first, 'infinity'::timestamptz));
end;
$$;


--
-- Name: peso(bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.peso(_centavos bigint) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select '₱' || to_char(coalesce(_centavos, 0) / 100.0, 'FM999,999,990.00');
$$;


--
-- Name: price_for_slot(uuid, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.price_for_slot(_court_id uuid, _starts_at timestamp with time zone) RETURNS TABLE(rate_id uuid, price_centavos bigint, label text, tier text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with t as (
    select private.operating_date_of(_starts_at) as op_date,
           (_starts_at at time zone private.venue_time_zone())::time as local_time
  )
  select r.id, r.price_centavos, r.label, r.tier
  from public.rate_rules r, t
  where r.product = 'court_rental'
    and r.unit = 'per_court_hour'
    and r.is_active
    and (r.court_id is null or r.court_id = _court_id)
    and extract(dow from t.op_date)::smallint = any (r.weekdays)
    and (r.valid_from is null or r.valid_from <= t.op_date)
    and (r.valid_to is null or r.valid_to >= t.op_date)
    and case when r.starts_at < r.ends_at
             then t.local_time >= r.starts_at and t.local_time < r.ends_at
             else t.local_time >= r.starts_at or t.local_time < r.ends_at end
  order by (r.court_id is not null) desc, r.priority desc, r.created_at desc
  limit 1;
$$;


--
-- Name: proof_path_is_mine(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.proof_path_is_mine(_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _folders text[] := storage.foldername(_name);
  _booking uuid;
begin
  if auth.uid() is null or cardinality(_folders) <> 2 then
    return false;
  end if;
  if _folders[1] <> auth.uid()::text then
    return false;
  end if;
  begin
    _booking := _folders[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return private.owns_booking(_booking);
end;
$$;


--
-- Name: public_name(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.public_name(_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    nullif(btrim(p.display_name), ''),
    split_part(btrim(p.full_name), ' ', 1)
      || case when position(' ' in btrim(p.full_name)) > 0
              then ' ' || left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1) || '.' else '' end)
  from public.profiles p where p.id = _id;
$$;


--
-- Name: queue_entry_division(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_entry_division() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.registration_id is not null then
    select r.division_id into new.division_id from public.event_registrations r where r.id = new.registration_id;
  end if;
  return new;
end;
$$;


--
-- Name: queue_games_on_deck(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_games_on_deck() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.notify_on_deck(new.event_id);
  return null;
end;
$$;


--
-- Name: queue_last_outcome(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_last_outcome(_event_id uuid, _who uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select q.outcome from public.queue_entries q
  where q.event_id = _event_id and coalesce(q.player_id, q.registration_id) = _who and q.status = 'completed'
  order by q.ended_at desc nulls last, q.id desc
  limit 1;
$$;


--
-- Name: queue_partner_count(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_partner_count(_event_id uuid, _a uuid, _b uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select count(*)::int
  from public.queue_entries x
  join public.queue_entries y on y.game_id = x.game_id and y.team = x.team and y.id <> x.id
  where x.event_id = _event_id and x.status = 'completed'
    and coalesce(x.player_id, x.registration_id) = _a and coalesce(y.player_id, y.registration_id) = _b;
$$;


--
-- Name: queue_person_name(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_person_name(_player_id uuid, _registration_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(private.public_name(_player_id),
                  (select r.guest_name from public.event_registrations r where r.id = _registration_id));
$$;


--
-- Name: queue_registration(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_registration(_event_id uuid, _player_id uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
begin
  select * into _r from public.event_registrations
  where event_id = _event_id and _player_id in (player_id, partner_id) and status in ('pending', 'confirmed')
  order by status = 'confirmed' desc limit 1;
  if not found then
    raise exception 'Register for this session first.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'Your entry fee has not been confirmed yet.' using errcode = '22023';
  end if;
  if _r.attendance is distinct from 'present' then
    raise exception 'Check in at the desk before joining the queue.' using errcode = '22023';
  end if;
  return _r.id;
end;
$$;


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    event_type public.event_type NOT NULL,
    category_id uuid,
    description text,
    level public.player_level,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    registration_opens_at timestamp with time zone,
    registration_closes_at timestamp with time zone,
    capacity integer,
    fee_centavos bigint DEFAULT 0 NOT NULL,
    fee_unit text DEFAULT 'per_player'::text NOT NULL,
    status public.event_status DEFAULT 'draft'::public.event_status NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    skill_min public.player_level,
    skill_max public.player_level,
    queue_players_per_game smallint DEFAULT 4 NOT NULL,
    queue_rotation text DEFAULT 'all_off'::text NOT NULL,
    queue_max_consecutive smallint DEFAULT 2 NOT NULL,
    queue_no_show_rule text DEFAULT 'back_of_queue'::text NOT NULL,
    cancel_reason text,
    queue_game_minutes smallint DEFAULT 15,
    queue_game_points smallint,
    queue_record_results boolean DEFAULT true NOT NULL,
    queue_matching text DEFAULT 'balanced'::text NOT NULL,
    queue_auto_fill boolean DEFAULT false NOT NULL,
    CONSTRAINT events_cancel_needs_reason CHECK (((status <> 'cancelled'::public.event_status) OR (char_length(btrim(COALESCE(cancel_reason, ''::text))) >= 3))),
    CONSTRAINT events_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (char_length(cancel_reason) <= 300))),
    CONSTRAINT events_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0))),
    CONSTRAINT events_check CHECK ((ends_at > starts_at)),
    CONSTRAINT events_check1 CHECK (((registration_closes_at IS NULL) OR (registration_opens_at IS NULL) OR (registration_closes_at > registration_opens_at))),
    CONSTRAINT events_fee_centavos_check CHECK ((fee_centavos >= 0)),
    CONSTRAINT events_fee_unit_check CHECK ((fee_unit = ANY (ARRAY['per_player'::text, 'per_team'::text]))),
    CONSTRAINT events_queue_game_minutes_check CHECK (((queue_game_minutes IS NULL) OR ((queue_game_minutes >= 5) AND (queue_game_minutes <= 60)))),
    CONSTRAINT events_queue_game_points_check CHECK (((queue_game_points IS NULL) OR ((queue_game_points >= 5) AND (queue_game_points <= 25)))),
    CONSTRAINT events_queue_matching_check CHECK ((queue_matching = ANY (ARRAY['balanced'::text, 'social'::text, 'winners_losers'::text]))),
    CONSTRAINT events_queue_max_consecutive_check CHECK (((queue_max_consecutive >= 1) AND (queue_max_consecutive <= 10))),
    CONSTRAINT events_queue_no_show_rule_check CHECK ((queue_no_show_rule = ANY (ARRAY['back_of_queue'::text, 'remove'::text]))),
    CONSTRAINT events_queue_players_per_game_check CHECK ((queue_players_per_game = ANY (ARRAY[2, 4]))),
    CONSTRAINT events_queue_rotation_check CHECK ((queue_rotation = ANY (ARRAY['all_off'::text, 'winners_stay'::text]))),
    CONSTRAINT events_skill_range CHECK (((skill_min IS NULL) OR (skill_max IS NULL) OR (skill_min <= skill_max))),
    CONSTRAINT events_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT events_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 120)))
);


--
-- Name: COLUMN events.level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.level IS 'Unused; see skill_min / skill_max.';


--
-- Name: COLUMN events.capacity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.capacity IS 'Most players (registrants plus partners) with a pending or confirmed entry. NULL: no limit.';


--
-- Name: COLUMN events.queue_game_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.queue_game_minutes IS 'Open play: the game time limit shown on the court board, in minutes. NULL: no limit.';


--
-- Name: COLUMN events.queue_game_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.queue_game_points IS 'Open play per-game format: games are played to this score. NULL: timed or unset.';


--
-- Name: COLUMN events.queue_record_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.queue_record_results IS 'Open play: staff record the winning team of each game (standings, winners-stay). Off: games are just finished.';


--
-- Name: COLUMN events.queue_matching; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.queue_matching IS 'Open play: how games are made. balanced (default), social (ignore levels, new partners), winners_losers (same last result).';


--
-- Name: COLUMN events.queue_auto_fill; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.queue_auto_fill IS 'Open play: when a game is finished, call the next game on that court automatically.';


--
-- Name: queue_session(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_session(_event_id uuid) RETURNS public.events
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status = 'draft' then
    raise exception 'That session was not found.' using errcode = 'P0002';
  end if;
  if _e.event_type <> 'open_play' then
    raise exception 'Only open play sessions have a queue.' using errcode = '22023';
  end if;
  if _e.status in ('cancelled', 'completed') then
    raise exception 'This session is %.', _e.status using errcode = '22023';
  end if;
  return _e;
end;
$$;


--
-- Name: queue_were_partners(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_were_partners(_event_id uuid, _a uuid, _b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from (
      select q.game_id, q.team, coalesce(q.player_id, q.registration_id) as who,
             row_number() over (partition by coalesce(q.player_id, q.registration_id) order by q.ended_at desc, q.id) as rn
      from public.queue_entries q
      where q.event_id = _event_id and coalesce(q.player_id, q.registration_id) in (_a, _b) and q.status = 'completed'
    ) last_game
    join public.queue_entries p on p.game_id = last_game.game_id and p.team = last_game.team
                               and coalesce(p.player_id, p.registration_id) = case when last_game.who = _a then _b else _a end
    where last_game.rn = 1
  );
$$;


--
-- Name: queue_wins(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.queue_wins(_event_id uuid, _player_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select count(*)::int from public.queue_entries q
  where q.event_id = _event_id and coalesce(q.player_id, q.registration_id) = _player_id and q.outcome = 'won';
$$;


--
-- Name: recalculate_booking_total(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.recalculate_booking_total(_booking_id uuid) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update public.bookings b
     set total_centavos = coalesce((
       select sum(s.price_centavos) from public.booking_slots s
       where s.booking_id = b.id and s.status not in ('released', 'cancelled')), 0)
   where b.id = _booking_id
  returning b.total_centavos;
$$;


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text DEFAULT private.next_booking_reference() NOT NULL,
    player_id uuid NOT NULL,
    created_by uuid,
    status public.booking_status DEFAULT 'cart'::public.booking_status NOT NULL,
    total_centavos bigint DEFAULT 0 NOT NULL,
    hold_expires_at timestamp with time zone,
    verify_by timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_status public.booking_payment_status DEFAULT 'unpaid'::public.booking_payment_status NOT NULL,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    expired_at timestamp with time zone,
    payment_due_at timestamp with time zone,
    event_id uuid,
    display_name text,
    payment_reminder_sent_at timestamp with time zone,
    CONSTRAINT bookings_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (char_length(cancel_reason) <= 300))),
    CONSTRAINT bookings_check CHECK (((status <> 'held'::public.booking_status) OR (hold_expires_at IS NOT NULL))),
    CONSTRAINT bookings_display_name_check CHECK (((display_name IS NULL) OR ((char_length(display_name) >= 1) AND (char_length(display_name) <= 30)))),
    CONSTRAINT bookings_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 500))),
    CONSTRAINT bookings_total_centavos_check CHECK ((total_centavos >= 0))
);


--
-- Name: COLUMN bookings.event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.event_id IS 'Set for an event entry fee: a booking with no court slots, paid through the normal payment flow.';


--
-- Name: COLUMN bookings.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.display_name IS 'Optional public name for the court board, chosen by the player. Shown to everyone on Live courts.';


--
-- Name: record_desk_cash(public.bookings, bigint, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.record_desk_cash(_b public.bookings, _received bigint, _why text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _due bigint := private.amount_due(_b.id);
  _left bigint;
begin
  if _received is null or _received <= 0 then
    raise exception 'Enter the cash received.' using errcode = '22023';
  end if;
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  if _received > _due then
    raise exception 'Only ₱% is still due. Enter that amount and give change for the rest.',
      to_char(_due / 100.0, 'FM999,999,990.00') using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  insert into public.payments (booking_id, method_kind, amount_centavos, status, submitted_by, reviewed_by, reviewed_at, review_note)
  values (_b.id, 'cash', _received, 'approved', _uid, _uid, now(), _why);

  _left := _due - _received;
  if _left = 0 then
    update public.bookings set payment_status = 'paid', payment_due_at = null where id = _b.id;
    update public.event_registrations set status = 'confirmed' where booking_id = _b.id and status = 'pending';
    perform private.notify(_b.player_id, 'payment_approved', 'Booking confirmed',
      format('Your payment for %s is confirmed. See you on court!', _b.reference), '/bookings/' || _b.id);
  else
    perform private.notify(_b.player_id, 'payment_approved', 'Part of your payment received',
      format('₱%s cash was received for %s. ₱%s is still due.',
             to_char(_received / 100.0, 'FM999,999,990.00'), _b.reference, to_char(_left / 100.0, 'FM999,999,990.00')),
      '/bookings/' || _b.id);
  end if;
  return _left;
end;
$$;


--
-- Name: registration_state(public.events); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.registration_state(_e public.events) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select case
    when _e.status not in ('published', 'registration_open') then
      case when _e.status in ('registration_closed', 'ongoing') then 'closed' else 'unavailable' end
    when now() >= _e.starts_at then 'closed'
    when _e.registration_opens_at is not null and now() < _e.registration_opens_at then 'not_yet'
    when _e.registration_closes_at is not null and now() >= _e.registration_closes_at then 'closed'
    else 'open' end;
$$;


--
-- Name: remind_unpaid_bookings(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.remind_unpaid_bookings() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _b record;
  _n int := 0;
begin
  for _b in
    select b.id, b.player_id, b.reference, b.payment_due_at
    from public.bookings b
    where b.status = 'confirmed' and b.payment_status = 'unpaid' and b.event_id is null
      and b.payment_due_at is not null and b.payment_reminder_sent_at is null
      and b.payment_due_at > now() and b.payment_due_at <= now() + interval '30 minutes'
      and b.payment_due_at - coalesce(b.confirmed_at, b.created_at) > interval '45 minutes'
    for update of b skip locked
  loop
    update public.bookings set payment_reminder_sent_at = now() where id = _b.id;
    perform private.notify(_b.player_id, 'payment_reminder', 'Pay soon to keep your booking',
      format('%s will be cancelled at %s unless you send your payment and upload the receipt.',
             _b.reference, private.fmt_time(_b.payment_due_at)),
      '/player/bookings/' || _b.id);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;


--
-- Name: require_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_admin() RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.is_admin() then
    raise exception 'Only administrators can do this.' using errcode = '42501';
  end if;
end;
$$;


--
-- Name: require_bookable_player(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_bookable_player() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to book a court.' using errcode = '42501';
  end if;
  if not private.is_active_user() then
    raise exception 'Your account cannot make bookings right now. Contact the club for help.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;


--
-- Name: require_event_manager(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_event_manager(_event_id uuid) RETURNS public.events
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  if not private.can_manage_event_type(_e.event_type) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  return _e;
end;
$$;


--
-- Name: require_profile(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_profile(_user_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (select 1 from public.profiles where id = _user_id) then
    raise exception 'That member was not found.' using errcode = 'P0002';
  end if;
end;
$$;


--
-- Name: require_reason(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_reason(_reason text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
begin
  if _reason is null or char_length(btrim(_reason)) < 3 then
    raise exception 'Give a short reason for this change.' using errcode = '22023';
  end if;
  return left(btrim(_reason), 300);
end;
$$;


--
-- Name: require_report_access(date, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_report_access(_from date, _to date) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.has_permission('reports.view') then
    raise exception 'You do not have permission to view reports.' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from then
    raise exception 'Choose a start date and an end date on or after it.' using errcode = '22023';
  end if;
  if _to - _from > 366 then
    raise exception 'Reports cover at most one year at a time.' using errcode = '22023';
  end if;
end;
$$;


--
-- Name: require_staff(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_staff() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.is_staff() then
    raise exception 'Only club staff can do this.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;


--
-- Name: run_booking_jobs(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.run_booking_jobs() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.expire_stale_holds();
  perform private.remind_unpaid_bookings();
  perform private.expire_unpaid_bookings();
end;
$$;


--
-- Name: set_operating_date(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_operating_date() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.operating_date := private.operating_date_of(lower(new.slot));
  return new;
end;
$$;


--
-- Name: set_payment_due(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_payment_due() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.payment_status = 'unpaid' then
    new.payment_due_at := private.payment_deadline_for(new.id);
    new.payment_reminder_sent_at := null;
  end if;
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: signal_booking_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.signal_booking_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _d date;
begin
  for _d in select distinct operating_date from public.booking_slots where booking_id = new.id loop
    perform private.bump_schedule_signal(_d);
  end loop;
  return null;
end;
$$;


--
-- Name: signal_config_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.signal_config_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.bump_schedule_signal('2000-01-01');
  return null;
end;
$$;


--
-- Name: signal_slot_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.signal_slot_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.bump_schedule_signal(new.operating_date);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.operating_date <> new.operating_date) then
    perform private.bump_schedule_signal(old.operating_date);
  end if;
  return null;
end;
$$;


--
-- Name: signal_today(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.signal_today() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.bump_schedule_signal(private.operating_date_of(now()));
  return null;
end;
$$;


--
-- Name: skill_text(public.player_level, public.player_level); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.skill_text(_min public.player_level, _max public.player_level) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select case
    when _min is null and _max is null then 'All levels'
    when _min = _max then private.level_label(_min)
    when _max is null then private.level_label(_min) || ' and up'
    when _min is null then 'Up to ' || private.level_label(_max)
    else private.level_label(_min) || ' to ' || private.level_label(_max) end;
$$;


--
-- Name: slot_is_live(public.slot_status, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.slot_is_live(_status public.slot_status, _booking_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when _status in ('released', 'cancelled') then false
    when _status = 'held' then exists (
      select 1 from public.bookings b
      where b.id = _booking_id and b.status = 'held' and b.hold_expires_at > now())
    else true
  end;
$$;


--
-- Name: stack_rotation(uuid, public.events); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.stack_rotation(_division_id uuid, _e public.events) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select d.queue_rotation from public.event_divisions d where d.id = _division_id), _e.queue_rotation);
$$;


--
-- Name: venue_time_zone(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.venue_time_zone() RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ select 'Asia/Manila'::text $$;


--
-- Name: write_audit(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.write_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  _new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  _id text := coalesce(_new ->> 'id', _old ->> 'id',
                       concat_ws(':', coalesce(_new, _old) ->> 'user_id', coalesce(_new, _old) ->> 'role',
                                 coalesce(_new, _old) ->> 'permission'));
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    _id,
    _old,
    _new,
    nullif(current_setting('app.audit_reason', true), '')
  );
  return coalesce(new, old);
end;
$$;


--
-- Name: admin_add_walk_in(uuid, uuid, text, text, uuid, text, bigint, public.payment_method_kind, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_add_walk_in(_event_id uuid, _division_id uuid, _name text, _phone text DEFAULT NULL::text, _partner_id uuid DEFAULT NULL::uuid, _partner_name text DEFAULT NULL::text, _paid_centavos bigint DEFAULT 0, _method public.payment_method_kind DEFAULT NULL::public.payment_method_kind, _reference text DEFAULT NULL::text, _pay_later boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  _uid uuid := auth.uid();
  _e public.events;
  _d public.event_divisions;
  _clean_name text := btrim(regexp_replace(coalesce(_name, ''), '\s+', ' ', 'g'));
  _clean_partner text := nullif(btrim(regexp_replace(coalesce(_partner_name, ''), '\s+', ' ', 'g')), '');
  _clean_phone text := nullif(regexp_replace(coalesce(_phone, ''), '[\s-]', '', 'g'), '');
  _has_partner boolean;
  _fee bigint;
  _paid bigint := coalesce(_paid_centavos, 0);
  _later boolean := coalesce(_pay_later, false);
  _id uuid;
begin
  select * into _e from public.events where id = _event_id;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  -- Open play is run at the desk: its managers may add walk-ins. Everything else: admins only.
  if _e.event_type = 'open_play' then
    perform private.require_event_manager(_event_id);
  else
    perform private.require_admin();
  end if;
  select * into _e from public.events where id = _event_id for update;
  if _e.status in ('draft', 'cancelled', 'completed') then
    raise exception 'Walk-ins can only be added to a published event that has not finished.' using errcode = '22023';
  end if;
  if _later and _e.event_type <> 'open_play' then
    raise exception 'Paying later is only for open play. Enter the amount received.' using errcode = '22023';
  end if;
  if char_length(_clean_name) < 2 or char_length(_clean_name) > 80 then
    raise exception 'Enter the player''s name.' using errcode = '22023';
  end if;
  if _clean_phone is not null and _clean_phone !~ '^09[0-9]{9}$' then
    raise exception 'Enter the mobile number as 09XXXXXXXXX, or leave it empty.' using errcode = '22023';
  end if;
  if _partner_id is not null and _clean_partner is not null then
    raise exception 'Choose the partner''s account or type a name, not both.' using errcode = '22023';
  end if;
  if _clean_partner is not null and char_length(_clean_partner) > 80 then
    raise exception 'The partner''s name is too long.' using errcode = '22023';
  end if;
  if _partner_id is not null and not exists (select 1 from public.profiles where id = _partner_id and status = 'active') then
    raise exception 'That partner was not found.' using errcode = 'P0002';
  end if;
  if _division_id is not null then
    select * into _d from public.event_divisions where id = _division_id and event_id = _event_id;
    if not found then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
  end if;

  _has_partner := _partner_id is not null or _clean_partner is not null;
  _fee := coalesce(_d.fee_centavos, _e.fee_centavos, 0)
          * case when _e.fee_unit = 'per_player' then 1 + _has_partner::int else 1 end;
  if _later then
    _paid := 0;
  else
    if _paid < 0 then
      raise exception 'Enter the amount received.' using errcode = '22023';
    end if;
    if _paid < _fee then
      raise exception 'The entry fee is ₱%. Enter the full amount received.', to_char(_fee / 100.0, 'FM999,999,990.00')
        using errcode = '22023';
    end if;
    if _paid > 0 and _method is null then
      raise exception 'Choose how the fee was paid.' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.audit_reason', case when _later and _fee > 0 then 'Walk-in entry added (pays later)' else 'Walk-in entry added' end, true);
  insert into public.event_registrations (
    event_id, division_id, player_id, partner_id, guest_name, guest_phone, partner_guest_name, status, created_by,
    walk_in_paid_centavos, walk_in_method, walk_in_reference, walk_in_recorded_at, walk_in_recorded_by, walk_in_fee_due_centavos)
  values (
    _event_id, _division_id, null, _partner_id, _clean_name, _clean_phone, _clean_partner, 'confirmed', _uid,
    case when _paid > 0 then _paid end, case when _paid > 0 then _method end,
    case when _paid > 0 then nullif(left(btrim(coalesce(_reference, '')), 60), '') end,
    case when _paid > 0 then now() end, case when _paid > 0 then _uid end,
    case when _later and _fee > 0 then _fee end)
  returning id into _id;

  if _partner_id is not null then
    perform private.notify(_partner_id, 'partner_added', 'You’ve been added as a partner',
      _clean_name || ' (walk-in) and you are registered for ' || _e.title || coalesce(' · ' || _d.name, '') || '.', '/my/events');
  end if;
  return _id;
end;
$_$;


--
-- Name: admin_grant_role(uuid, public.app_role, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_grant_role(_user_id uuid, _role public.app_role, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if _role is null then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  insert into public.user_roles (user_id, role, granted_by)
  values (_user_id, _role, auth.uid())
  on conflict (user_id, role) do nothing;
end;
$$;


--
-- Name: admin_list_members(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_members(_search text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0) RETURNS TABLE(id uuid, full_name text, email text, phone text, roles public.app_role[], permissions public.app_permission[], status public.account_status, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _pattern text := '%' || replace(replace(replace(coalesce(btrim(_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform private.require_admin();
  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    coalesce((select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = p.id),
             '{}'::public.app_role[]),
    coalesce((select array_agg(sp.permission order by sp.permission) from public.staff_permissions sp
              where sp.user_id = p.id), '{}'::public.app_permission[]),
    p.status,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(btrim(_search), '') = ''
     or p.full_name ilike _pattern
     or u.email ilike _pattern
     or p.phone ilike _pattern
  order by p.full_name
  limit least(greatest(coalesce(_limit, 50), 1), 200)
  offset greatest(coalesce(_offset, 0), 0);
end;
$$;


--
-- Name: admin_revoke_role(uuid, public.app_role, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_role(_user_id uuid, _role public.app_role, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if _role = 'player' then
    raise exception 'Every member keeps the player role.' using errcode = '22023';
  end if;

  -- Serialise admin changes so two admins cannot remove each other at once.
  perform pg_advisory_xact_lock(hashtext('dd.admin_roles'));

  if _role = 'admin'
     and exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
     and (select count(*) from public.user_roles ur join public.profiles p on p.id = ur.user_id
          where ur.role = 'admin' and p.status = 'active') <= 1 then
    raise exception 'At least one administrator must remain.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  delete from public.user_roles where user_id = _user_id and role = _role;
  if _role = 'staff' then
    delete from public.staff_permissions where user_id = _user_id;
  end if;
end;
$$;


--
-- Name: admin_set_account_status(uuid, public.account_status, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_account_status(_user_id uuid, _status public.account_status, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if _user_id = auth.uid() and _status = 'suspended' then
    raise exception 'You cannot suspend your own account.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.profiles set status = _status where id = _user_id;
end;
$$;


--
-- Name: admin_set_staff_permissions(uuid, public.app_permission[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_staff_permissions(_user_id uuid, _permissions public.app_permission[], _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
  _wanted public.app_permission[] := coalesce(_permissions, '{}');
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if cardinality(_wanted) > 0
     and not exists (select 1 from public.user_roles where user_id = _user_id and role = 'staff') then
    raise exception 'Give this member the staff role before adding permissions.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  delete from public.staff_permissions
  where user_id = _user_id and not (permission = any (_wanted));
  insert into public.staff_permissions (user_id, permission, granted_by)
  select _user_id, p, auth.uid() from unnest(_wanted) as p
  on conflict (user_id, permission) do nothing;
end;
$$;


--
-- Name: cancel_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking(_booking_id uuid, _reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _is_owner boolean;
  _is_staff boolean := private.has_permission('bookings.cancel');
  _cutoff int;
  _first timestamptz;
  _why text;
begin
  if _uid is null then
    raise exception 'Sign in to manage bookings.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  _is_owner := _b.player_id = _uid;
  if not _is_owner and not _is_staff then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status not in ('held', 'confirmed') then
    raise exception 'This booking is already %.', _b.status using errcode = '22023';
  end if;

  select min(lower(slot)) into _first from public.booking_slots
   where booking_slots.booking_id = _b.id and status not in ('released', 'cancelled');

  if _is_staff and not (_is_owner and _b.status = 'held') then
    _why := private.require_reason(_reason);
  elsif _b.status = 'confirmed' then
    if not private.is_active_user() then
      raise exception 'Your account cannot change bookings right now. Contact the club for help.' using errcode = '42501';
    end if;
    select player_cancel_cutoff_hours into _cutoff from public.venue_settings limit 1;
    if _cutoff is null then
      raise exception 'Contact the club to cancel a confirmed booking.' using errcode = '42501';
    end if;
    if _first is not null and _first - now() < make_interval(hours => _cutoff) then
      raise exception 'Bookings can be cancelled up to % hours before the first time slot.', _cutoff using errcode = '42501';
    end if;
    _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Cancelled by player');
  else
    _why := 'Cart cancelled';
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled'
   where booking_slots.booking_id = _b.id and status in ('held', 'confirmed');
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid, cancel_reason = left(_why, 300),
         hold_expires_at = case when status = 'held' then hold_expires_at end,
         payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                               else payment_status end
   where id = _b.id;
end;
$$;


--
-- Name: confirm_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_booking(_booking_id uuid) RETURNS TABLE(status text, booking_id uuid, reference text, total_centavos bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _uid uuid := private.require_bookable_player();
  _b public.bookings;
  _s record;
  _w record;
  _count int;
begin
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or _b.player_id <> _uid then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;

  if _b.status = 'confirmed' then
    return query select 'confirmed'::text, _b.id, _b.reference, _b.total_centavos;
    return;
  end if;
  -- Another session's expiry job may have expired this hold a moment ago.
  if _b.status = 'expired' then
    return query select 'expired'::text, _b.id, _b.reference, 0::bigint;
    return;
  end if;
  if _b.status <> 'held' then
    raise exception 'This booking can no longer be confirmed.' using errcode = '22023';
  end if;

  if _b.hold_expires_at <= now() then
    update public.bookings set status = 'expired', expired_at = now() where id = _b.id;
    update public.booking_slots set status = 'released' where booking_id = _b.id and booking_slots.status = 'held';
    return query select 'expired'::text, _b.id, _b.reference, 0::bigint;
    return;
  end if;

  select count(*) into _count from public.booking_slots where booking_slots.booking_id = _b.id and booking_slots.status = 'held';
  if _count = 0 then
    raise exception 'Your cart is empty.' using errcode = '22023';
  end if;

  -- Revalidate: still in the future, still within opening hours, court still open.
  for _s in
    select bs.id, bs.slot, c.name as court_name, c.status as court_status
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id = _b.id and bs.status = 'held'
    order by lower(bs.slot)
    for update of bs
  loop
    if lower(_s.slot) <= now() then
      raise exception '% at % has already started. Remove it to continue.', _s.court_name, private.fmt_time(lower(_s.slot))
        using errcode = '22023';
    end if;
    if _s.court_status <> 'active' then
      raise exception '% is no longer available. Remove it to continue.', _s.court_name using errcode = '22023';
    end if;
    select * into _w from private.operating_window(private.operating_date_of(lower(_s.slot)));
    if _w.state <> 'open' or lower(_s.slot) < _w.opens_at or upper(_s.slot) > _w.closes_at then
      raise exception 'The club''s hours changed and % at % is no longer open. Remove it to continue.',
        _s.court_name, private.fmt_time(lower(_s.slot)) using errcode = '22023';
    end if;
  end loop;

  update public.booking_slots set status = 'confirmed' where booking_slots.booking_id = _b.id and booking_slots.status = 'held';
  update public.bookings
     set status = 'confirmed', confirmed_at = now(), hold_expires_at = null
   where id = _b.id;
  perform private.recalculate_booking_total(_b.id);

  return query select 'confirmed'::text, b.id, b.reference, b.total_centavos from public.bookings b where b.id = _b.id;
end;
$$;


--
-- Name: get_attendance_leaderboard(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_attendance_leaderboard(_days integer DEFAULT 30, _limit integer DEFAULT 50) RETURNS TABLE(rank integer, player_name text, sessions integer, is_me boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see the leaderboard.' using errcode = '42501';
  end if;
  return query
  select (rank() over (order by count(*) desc))::int, private.public_name(c.player_id), count(*)::int,
         c.player_id = auth.uid()
  from public.check_ins c
  join public.profiles p on p.id = c.player_id and not p.leaderboard_opt_out and p.status = 'active'
  where c.checked_in_at >= now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 366))
  group by c.player_id
  order by 1, 2
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;


--
-- Name: get_court_availability(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_court_availability(_date date) RETURNS TABLE(court_id uuid, court_number smallint, court_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, price_centavos bigint, rate_label text, tier text, label text, is_mine boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _w record;
  _today date := private.operating_date_of(now());
  _window int;
  _uid uuid := auth.uid();
begin
  select * into _w from private.operating_window(_date);
  if _w.state <> 'open' then
    return;
  end if;
  select booking_window_days into _window from public.venue_settings limit 1;

  return query
  select
    c.id, c.number, c.name, h.hour_start, h.hour_start + interval '1 hour',
    case
      when s.id is not null then
        case s.kind
          when 'rental' then
            case when s.status = 'held' then (case when s.mine then 'in_cart' else 'held' end)
                 when s.mine then 'mine'
                 when s.payment_status in ('paid', 'waived') then 'booked'
                 else 'pending' end
          when 'maintenance' then 'maintenance'
          when 'block' then 'blocked'
          when 'private_event' then 'private_event'
          else 'event'
        end
      when c.status = 'maintenance' then 'maintenance'
      when h.hour_start <= now() then 'past'
      when _date > _today + _window or _date < _today then 'not_bookable'
      when p.price_centavos is null then 'unpriced'
      else 'available'
    end,
    case when s.id is null and c.status = 'active' then p.price_centavos
         when s.mine then s.price_centavos end,
    p.label,
    p.tier,
    case
      when s.kind in ('event', 'open_play') then coalesce(s.event_title, 'Event')
      when s.kind = 'private_event' then 'Private event'
      when s.kind = 'maintenance' or (s.id is null and c.status = 'maintenance') then 'Maintenance'
      when s.kind = 'block' then 'Unavailable'
      when s.kind = 'rental' and s.status <> 'held' then s.display_name
    end,
    coalesce(s.mine, false)
  from public.courts c
  cross join lateral generate_series(_w.opens_at, _w.closes_at - interval '1 hour', interval '1 hour') as h(hour_start)
  left join lateral (
    select bs.id, bs.kind, bs.status, bs.price_centavos, b.payment_status, b.display_name,
           (b.player_id = _uid and _uid is not null) as mine,
           case when e.status <> 'draft' then e.title end as event_title
    from public.booking_slots bs
    left join public.bookings b on b.id = bs.booking_id
    left join public.events e on e.id = bs.event_id
    where bs.court_id = c.id
      and bs.slot && tstzrange(h.hour_start, h.hour_start + interval '1 hour')
      and private.slot_is_live(bs.status, bs.booking_id)
    order by (bs.kind = 'rental') asc
    limit 1
  ) s on true
  left join lateral private.price_for_slot(c.id, h.hour_start) p on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number, h.hour_start;
end;
$$;


--
-- Name: get_division_standings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_division_standings(_division_id uuid) RETURNS TABLE(rank integer, registration_id uuid, label text, played integer, wins integer, losses integer, points_for integer, points_against integer, point_diff integer, is_mine boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see standings.' using errcode = '42501';
  end if;
  select e.* into _e from public.events e join public.event_divisions d on d.event_id = e.id where d.id = _division_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That division was not found.' using errcode = 'P0002';
  end if;
  return query
  with entries as (
    select r.id, r.player_id, r.partner_id, r.created_at from public.event_registrations r
    where r.division_id = _division_id and r.status = 'confirmed'
  ), results as (
    select x.entry, x.won, x.pf, x.pa
    from public.event_matches m
    cross join lateral (values (m.entry_a, m.winner = m.entry_a, coalesce(m.score_a, 0), coalesce(m.score_b, 0)),
                               (m.entry_b, m.winner = m.entry_b, coalesce(m.score_b, 0), coalesce(m.score_a, 0)))
                as x(entry, won, pf, pa)
    where m.division_id = _division_id and m.stage = 'round_robin' and m.status in ('completed', 'walkover')
  ), totals as (
    select en.id, en.player_id, en.partner_id, en.created_at,
           count(rs.entry)::int as played,
           count(*) filter (where rs.won)::int as wins,
           count(*) filter (where not rs.won)::int as losses,
           coalesce(sum(rs.pf), 0)::int as pf, coalesce(sum(rs.pa), 0)::int as pa
    from entries en left join results rs on rs.entry = en.id
    group by en.id, en.player_id, en.partner_id, en.created_at
  )
  select (rank() over (order by t.wins desc, t.pf - t.pa desc, t.pf desc))::int,
         t.id, private.entry_label(t.id), t.played, t.wins, t.losses, t.pf, t.pa, t.pf - t.pa,
         auth.uid() in (t.player_id, t.partner_id)
  from totals t
  order by 1, private.entry_label(t.id);
end;
$$;


--
-- Name: get_event_matches(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_matches(_event_id uuid) RETURNS TABLE(match_id uuid, division_id uuid, division_name text, stage text, round smallint, match_no smallint, entry_a uuid, entry_b uuid, label_a text, label_b text, court_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, score_a smallint, score_b smallint, winner uuid, is_mine boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see matches.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select m.id, m.division_id, d.name, m.stage, m.round, m.match_no, m.entry_a, m.entry_b,
         private.entry_label(m.entry_a), private.entry_label(m.entry_b), c.name, lower(m.scheduled), upper(m.scheduled),
         m.status, m.score_a, m.score_b, m.winner,
         exists (select 1 from public.event_registrations r where r.id in (m.entry_a, m.entry_b)
                 and auth.uid() in (r.player_id, r.partner_id))
  from public.event_matches m
  join public.event_divisions d on d.id = m.division_id
  left join public.courts c on c.id = m.court_id
  where m.event_id = _event_id
  order by d.sort_order, d.name, m.stage desc, m.round, m.match_no;
end;
$$;


--
-- Name: get_events(text, public.event_type, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_events(_slug text DEFAULT NULL::text, _type public.event_type DEFAULT NULL::public.event_type, _include_past boolean DEFAULT false) RETURNS TABLE(id uuid, slug text, title text, event_type public.event_type, status public.event_status, category_name text, description text, starts_at timestamp with time zone, ends_at timestamp with time zone, registration_opens_at timestamp with time zone, registration_closes_at timestamp with time zone, registration_state text, capacity integer, players_registered integer, spots_left integer, fee_centavos bigint, fee_unit text, skill_min public.player_level, skill_max public.player_level, skill_text text, courts jsonb, divisions jsonb, cancel_reason text, queue_players_per_game smallint, queue_rotation text, queue_max_consecutive smallint, queue_no_show_rule text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select e.id, e.slug, e.title, e.event_type, e.status, c.name, e.description, e.starts_at, e.ends_at,
         e.registration_opens_at, e.registration_closes_at, private.registration_state(e),
         e.capacity, private.event_people(e.id),
         case when e.capacity is null then null else greatest(e.capacity - private.event_people(e.id), 0) end,
         e.fee_centavos, e.fee_unit, e.skill_min, e.skill_max, private.skill_text(e.skill_min, e.skill_max),
         coalesce((select jsonb_agg(jsonb_build_object('slot_id', s.id, 'court_id', s.court_id, 'court_name', ct.name,
                                    'starts_at', lower(s.slot), 'ends_at', upper(s.slot)) order by lower(s.slot), ct.sort_order)
                   from public.booking_slots s join public.courts ct on ct.id = s.court_id
                   where s.event_id = e.id and s.status not in ('cancelled', 'released')), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', d.id, 'name', d.name, 'category_id', d.category_id, 'category_name', dc.name,
                     'team_size', d.team_size, 'skill_min', d.skill_min, 'skill_max', d.skill_max,
                     'skill_text', private.skill_text(coalesce(d.skill_min, e.skill_min), coalesce(d.skill_max, e.skill_max)),
                     'capacity', d.capacity, 'entries', private.division_entries(d.id),
                     'fee_centavos', coalesce(d.fee_centavos, e.fee_centavos), 'format', d.format) order by d.sort_order, d.name)
                   from public.event_divisions d join public.event_categories dc on dc.id = d.category_id
                   where d.event_id = e.id), '[]'::jsonb),
         e.cancel_reason, e.queue_players_per_game, e.queue_rotation, e.queue_max_consecutive, e.queue_no_show_rule
  from public.events e
  left join public.event_categories c on c.id = e.category_id
  where (e.status <> 'draft' or private.can_manage_event_type(e.event_type))
    and (_slug is null or e.slug = _slug)
    and (_type is null or e.event_type = _type)
    and (_slug is not null or _include_past or e.ends_at > now())
    and (_slug is not null or e.status <> 'draft')
  order by e.starts_at
  limit 200;
$$;


--
-- Name: get_leaderboard(date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leaderboard(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _limit integer DEFAULT 50) RETURNS TABLE(rank integer, player_name text, played integer, wins integer, losses integer, points integer, point_diff integer, is_me boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see the leaderboard.' using errcode = '42501';
  end if;
  return query
  select (rank() over (order by sum(mr.points) desc, count(*) filter (where mr.won) desc,
                       sum(mr.points_for - mr.points_against) desc))::int,
         private.public_name(mr.player_id), count(*)::int, (count(*) filter (where mr.won))::int,
         (count(*) filter (where not mr.won))::int, sum(mr.points)::int, sum(mr.points_for - mr.points_against)::int,
         mr.player_id = auth.uid()
  from private.match_results(_from, _to) mr
  join public.profiles p on p.id = mr.player_id and not p.leaderboard_opt_out and p.status = 'active'
  group by mr.player_id
  order by 1, 2
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;


--
-- Name: get_live_courts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_live_courts() RETURNS TABLE(court_id uuid, court_number smallint, court_name text, status text, label text, until timestamp with time zone, next_starts_at timestamp with time zone, next_status text, as_of timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _today date := private.operating_date_of(now());
  _w record;
begin
  select * into _w from private.operating_window(_today);
  return query
  with live as (
    select bs.court_id, bs.slot, bs.kind, bs.status, bs.event_id,
           case when e.status <> 'draft' then e.title end as event_title,
           (b.payment_status in ('paid', 'waived')) as paid,
           b.display_name
    from public.booking_slots bs
    left join public.events e on e.id = bs.event_id
    left join public.bookings b on b.id = bs.booking_id
    where bs.operating_date in (_today, _today + 1)
      and bs.status not in ('released', 'cancelled', 'held')
  )
  select
    c.id, c.number, c.name,
    case
      when c.status = 'maintenance' then 'maintenance'
      when cur.kind = 'rental' and cur.paid then 'in_use'
      when cur.kind = 'rental' then 'reserved'
      when cur.kind = 'maintenance' then 'maintenance'
      when cur.kind = 'block' then 'blocked'
      when cur.kind = 'private_event' then 'private_event'
      when cur.kind is not null then 'event'
      when _w.state <> 'open' or now() < _w.opens_at or now() >= _w.closes_at then 'closed'
      else 'available'
    end,
    case
      when cur.kind = 'rental' then cur.display_name
      when cur.kind = 'open_play' then coalesce(cur.event_title, 'Open play')
        || case qg.status when 'playing' then ' · game in progress' when 'called' then ' · players called' else '' end
      when cur.kind = 'event' then coalesce(cur.event_title, 'Event') || coalesce(' · ' || mt.division_name, '')
      when cur.kind = 'private_event' then 'Private event'
      when cur.kind = 'maintenance' or c.status = 'maintenance' then 'Maintenance'
    end,
    upper(cur.slot),
    nxt.starts,
    case
      when nxt.kind is null then null
      when nxt.kind = 'rental' and nxt.paid then 'booked'
      when nxt.kind = 'rental' then 'reserved'
      when nxt.kind = 'maintenance' then 'maintenance'
      when nxt.kind = 'block' then 'blocked'
      when nxt.kind = 'private_event' then 'private_event'
      else 'event'
    end,
    now()
  from public.courts c
  left join lateral (
    select l.kind, l.slot, l.event_title, l.event_id, l.paid, l.display_name from live l
    where l.court_id = c.id and l.slot @> now()
    limit 1
  ) cur on true
  left join lateral (
    select g.status from public.queue_games g
    where g.court_id = c.id and g.event_id = cur.event_id and g.status in ('called', 'playing')
    limit 1
  ) qg on true
  left join lateral (
    select d.name as division_name from public.event_matches m join public.event_divisions d on d.id = m.division_id
    where m.court_id = c.id and m.event_id = cur.event_id and m.scheduled @> now()
      and m.status in ('scheduled', 'in_progress')
    limit 1
  ) mt on true
  left join lateral (
    select lower(l.slot) as starts, l.kind, l.paid from live l
    where l.court_id = c.id and lower(l.slot) > now()
    order by lower(l.slot)
    limit 1
  ) nxt on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number;
end;
$$;


--
-- Name: get_my_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_access() RETURNS TABLE(user_id uuid, roles public.app_role[], permissions public.app_permission[], status public.account_status)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    p.id,
    coalesce((select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = p.id),
             '{}'::public.app_role[]),
    case
      when p.status <> 'active' then '{}'::public.app_permission[]
      when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'admin')
        then enum_range(null::public.app_permission)
      when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'staff')
        then coalesce((select array_agg(sp.permission order by sp.permission)
                       from public.staff_permissions sp where sp.user_id = p.id),
                      '{}'::public.app_permission[])
      else '{}'::public.app_permission[]
    end,
    p.status
  from public.profiles p
  where p.id = auth.uid();
$$;


--
-- Name: get_my_match_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_match_history() RETURNS TABLE(match_id uuid, event_title text, event_slug text, division_name text, played_on date, opponent text, won boolean, walkover boolean, score text, points integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select mr.match_id, e.title, e.slug, d.name, mr.played_on,
         private.entry_label(case when r.id = m.entry_a then m.entry_b else m.entry_a end),
         mr.won, mr.walkover,
         case when mr.walkover then 'Walkover' else mr.points_for || '–' || mr.points_against end,
         mr.points
  from private.match_results(null, null) mr
  join public.event_matches m on m.id = mr.match_id
  join public.events e on e.id = m.event_id
  join public.event_divisions d on d.id = m.division_id
  join public.event_registrations r on r.id in (m.entry_a, m.entry_b) and mr.player_id in (r.player_id, r.partner_id)
  where mr.player_id = auth.uid()
  order by mr.played_on desc, e.title;
$$;


--
-- Name: get_my_payments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_payments() RETURNS TABLE(payment_id uuid, status public.payment_status, method_kind public.payment_method_kind, amount_centavos bigint, reference_no text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, review_note text, booking_id uuid, booking_reference text, booking_payment_status public.booking_payment_status, purpose text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p.id, p.status, p.method_kind, p.amount_centavos, p.reference_no, p.created_at, p.reviewed_at,
         case when p.status = 'rejected' then p.review_note end,
         b.id, b.reference, b.payment_status,
         case when b.event_id is not null then 'Entry fee · ' || e.title else 'Court booking' end
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  left join public.events e on e.id = b.event_id
  where b.player_id = auth.uid()
  order by p.created_at desc;
$$;


--
-- Name: get_my_play_history(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_play_history(_limit integer DEFAULT 100) RETURNS TABLE(check_in_id uuid, checked_in_at timestamp with time zone, kind text, event_type public.event_type, title text, detail text, event_slug text, booking_id uuid, booking_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select c.id, c.checked_in_at, c.kind, e.event_type,
         case when c.kind = 'event' then e.title else 'Court rental' end,
         case when c.kind = 'event' then coalesce(d.name, private.skill_text(e.skill_min, e.skill_max))
              else (select string_agg(distinct ct.name, ', ' order by ct.name)
                    from public.booking_slots s join public.courts ct on ct.id = s.court_id
                    where s.booking_id = c.booking_id
                      and s.operating_date = private.operating_date_of(c.checked_in_at)) end,
         e.slug, c.booking_id, b.reference
  from public.check_ins c
  left join public.events e on e.id = c.event_id
  left join public.event_registrations r on r.id = c.registration_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.bookings b on b.id = c.booking_id
  where c.player_id = auth.uid()
  order by c.checked_in_at desc
  limit least(greatest(coalesce(_limit, 100), 1), 500);
$$;


--
-- Name: get_my_registrations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_registrations() RETURNS TABLE(registration_id uuid, event_id uuid, event_slug text, event_title text, event_type public.event_type, event_status public.event_status, starts_at timestamp with time zone, ends_at timestamp with time zone, division_name text, category_name text, role text, player_name text, partner_name text, status public.registration_status, attendance text, booking_id uuid, booking_reference text, payment_status public.booking_payment_status, fee_centavos bigint, created_at timestamp with time zone, cancel_reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select r.id, e.id, e.slug, e.title, e.event_type, e.status, e.starts_at, e.ends_at, d.name, c.name,
         case when r.player_id = auth.uid() then 'registrant' else 'partner' end,
         private.public_name(r.player_id), private.public_name(r.partner_id),
         r.status, r.attendance, b.id, b.reference, b.payment_status, b.total_centavos, r.created_at, r.cancel_reason
  from public.event_registrations r
  join public.events e on e.id = r.event_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where auth.uid() in (r.player_id, r.partner_id)
  order by e.starts_at desc, r.created_at desc;
$$;


--
-- Name: get_operating_day(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_operating_day(_date date) RETURNS TABLE(operating_date date, state text, opens_at timestamp with time zone, closes_at timestamp with time zone, note text, bookable boolean, first_bookable_date date, last_bookable_date date)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _today date := private.operating_date_of(now());
  _window int;
begin
  select booking_window_days into _window from public.venue_settings limit 1;
  return query
  select _date, w.state, w.opens_at, w.closes_at, w.note,
         (w.state = 'open' and _date between _today and _today + _window),
         _today, _today + _window
  from private.operating_window(_date) w;
end;
$$;


--
-- Name: get_payment_instructions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_payment_instructions(_booking_id uuid) RETURNS TABLE(payment_method_id uuid, kind public.payment_method_kind, label text, account_name text, account_number text, bank_name text, qr_image_path text, instructions text, amount_due_centavos bigint, booking_reference text, payment_due_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _b public.bookings;
begin
  select * into _b from public.bookings where id = _booking_id;
  if not found or (_b.player_id <> auth.uid() and not private.has_permission('payments.verify')) then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be paid.' using errcode = '22023';
  end if;
  return query
  select m.id, m.kind, m.label, m.account_name, m.account_number, m.bank_name, m.qr_image_path, m.instructions,
         private.amount_due(_b.id), _b.reference, _b.payment_due_at
  from public.payment_methods m
  where m.is_active and m.kind <> 'cash'
  order by m.sort_order, m.label;
end;
$$;


--
-- Name: get_queue(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_queue(_event_id uuid) RETURNS TABLE(entry_id uuid, player_name text, status text, queue_position integer, queued_at timestamp with time zone, game_id uuid, game_status text, court_id uuid, court_name text, team text, consecutive_games smallint, games_played integer, stays_on_court boolean, is_me boolean, division_id uuid, division_name text, wins integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or auth.uid() is null then
    raise exception 'That session was not found.' using errcode = 'P0002';
  end if;
  if not private.can_manage_event_type(_e.event_type)
     and not exists (select 1 from public.event_registrations r where r.event_id = _e.id
                     and auth.uid() in (r.player_id, r.partner_id) and r.status = 'confirmed') then
    raise exception 'Only players registered for this session can see its queue.' using errcode = '42501';
  end if;
  return query
  select q.id, private.queue_person_name(q.player_id, q.registration_id), q.status,
         case when q.status = 'waiting'
              then (row_number() over (partition by (q.status = 'waiting'), q.division_id
                                       order by (q.stay_court_id is not null) desc, q.queued_at, q.id))::int end,
         q.queued_at, q.game_id, g.status, q.court_id, c.name, q.team, q.consecutive_games,
         (select count(*)::int from public.queue_entries x where x.event_id = _e.id
            and coalesce(x.player_id, x.registration_id) = coalesce(q.player_id, q.registration_id)
            and x.status = 'completed'),
         q.stay_court_id is not null, coalesce(q.player_id = auth.uid(), false),
         q.division_id, d.name, private.queue_wins(_e.id, coalesce(q.player_id, q.registration_id))
  from public.queue_entries q
  left join public.queue_games g on g.id = q.game_id
  left join public.courts c on c.id = coalesce(q.court_id, q.stay_court_id)
  left join public.event_divisions d on d.id = q.division_id
  where q.event_id = _e.id and q.status in ('waiting', 'called', 'playing')
  order by q.status = 'waiting', c.sort_order, q.team, d.sort_order, 4, q.queued_at;
end;
$$;


--
-- Name: get_session_board(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_session_board(_event_id uuid, _code text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status = 'draft'
     or not exists (select 1 from private.event_codes c where c.event_id = _e.id and c.board_code = btrim(coalesce(_code, ''))) then
    raise exception 'This court board link is not valid.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'title', _e.title,
    'status', _e.status,
    'starts_at', _e.starts_at,
    'ends_at', _e.ends_at,
    'game_minutes', _e.queue_game_minutes,
    'game_points', _e.queue_game_points,
    'players_per_game', _e.queue_players_per_game,
    'now', now(),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court_id', c.id,
        'court_name', c.name,
        'lane', (select d.name from public.event_court_lanes l join public.event_divisions d on d.id = l.division_id
                 where l.event_id = _e.id and l.court_id = c.id),
        'game_division', (select d.name from public.event_divisions d where d.id = g.division_id),
        'game_status', g.status,
        'called_at', g.called_at,
        'started_at', g.started_at,
        'team_a', (select coalesce(jsonb_agg(private.queue_person_name(q.player_id, q.registration_id) order by q.called_at, q.queued_at), '[]'::jsonb)
                   from public.queue_entries q where q.game_id = g.id and q.team = 'a' and q.status in ('called', 'playing')),
        'team_b', (select coalesce(jsonb_agg(private.queue_person_name(q.player_id, q.registration_id) order by q.called_at, q.queued_at), '[]'::jsonb)
                   from public.queue_entries q where q.game_id = g.id and q.team = 'b' and q.status in ('called', 'playing'))
      ) order by c.sort_order, c.name), '[]'::jsonb)
      from public.courts c
      left join public.queue_games g on g.court_id = c.id and g.event_id = _e.id and g.status in ('called', 'playing')
      where exists (select 1 from public.booking_slots s
                    where s.event_id = _e.id and s.court_id = c.id and s.status not in ('cancelled', 'released')
                      and s.slot && tstzrange(_e.starts_at, _e.ends_at))
    ),
    'next', (
      select coalesce(jsonb_agg(w.name order by w.pos), '[]'::jsonb)
      from (select private.queue_person_name(q.player_id, q.registration_id) as name,
                   row_number() over (order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
            from public.queue_entries q where q.event_id = _e.id and q.status = 'waiting') w
      where w.pos <= 12
    ),
    'stacks', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'waiting', s.waiting, 'next', s.next)
                                order by s.sort_order nulls first, s.name), '[]'::jsonb)
      from (
        select d.name, d.sort_order, k.division_id,
               (select count(*) from public.queue_entries q
                where q.event_id = _e.id and q.status = 'waiting' and q.division_id is not distinct from k.division_id) as waiting,
               (select coalesce(jsonb_agg(w.name order by w.pos), '[]'::jsonb)
                from (select private.queue_person_name(q.player_id, q.registration_id) as name,
                             row_number() over (order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
                      from public.queue_entries q
                      where q.event_id = _e.id and q.status = 'waiting' and q.division_id is not distinct from k.division_id) w
                where w.pos <= 8) as next
        from (select x.id as division_id from public.event_divisions x where x.event_id = _e.id
              union
              select q.division_id from public.queue_entries q
              where q.event_id = _e.id and q.status = 'waiting' and q.division_id is null) k
        left join public.event_divisions d on d.id = k.division_id
      ) s
    ),
    'waiting', (select count(*) from public.queue_entries q where q.event_id = _e.id and q.status = 'waiting')
  );
end;
$$;


--
-- Name: get_session_standings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_session_standings(_event_id uuid) RETURNS TABLE(rank integer, player_name text, games integer, wins integer, losses integer, is_me boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or auth.uid() is null then
    raise exception 'That session was not found.' using errcode = 'P0002';
  end if;
  if not private.can_manage_event_type(_e.event_type)
     and not exists (select 1 from public.event_registrations r where r.event_id = _e.id
                     and auth.uid() in (r.player_id, r.partner_id) and r.status = 'confirmed') then
    raise exception 'Only players registered for this session can see its standings.' using errcode = '42501';
  end if;
  return query
  select (rank() over (order by count(*) filter (where q.outcome = 'won') desc, count(*) desc))::int,
         private.queue_person_name(max(q.player_id::text)::uuid, max(q.registration_id::text)::uuid),
         count(*)::int,
         (count(*) filter (where q.outcome = 'won'))::int,
         (count(*) filter (where q.outcome = 'lost'))::int,
         coalesce(bool_or(q.player_id = auth.uid()), false)
  from public.queue_entries q
  where q.event_id = _e.id and q.status = 'completed'
  group by coalesce(q.player_id, q.registration_id)
  order by 1, 2;
end;
$$;


--
-- Name: get_whos_playing(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_whos_playing(_event_id uuid) RETURNS TABLE(registration_id uuid, division_id uuid, division_name text, category_name text, team_size smallint, player_name text, partner_name text, status public.registration_status, checked_in boolean, is_me boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see who is playing.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select r.id, r.division_id, d.name, c.name, d.team_size,
         coalesce(private.public_name(r.player_id), r.guest_name),
         coalesce(private.public_name(r.partner_id), r.partner_guest_name),
         r.status, r.attendance = 'present',
         coalesce(auth.uid() in (r.player_id, r.partner_id), false)
  from public.event_registrations r
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  where r.event_id = _event_id and r.status in ('pending', 'confirmed')
  order by d.sort_order nulls first, d.name, r.created_at;
end;
$$;


--
-- Name: hold_slots(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_slots(_slots jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _settings public.venue_settings;
  _booking public.bookings;
  _item record;
  _court public.courts;
  _date date;
  _w record;
  _rate record;
  _today date;
  _count int;
begin
  if _slots is null or jsonb_typeof(_slots) <> 'array' or jsonb_array_length(_slots) = 0 then
    raise exception 'Choose at least one time slot.' using errcode = '22023';
  end if;

  select * into _settings from public.venue_settings limit 1;
  perform private.expire_stale_holds();
  _today := private.operating_date_of(now());

  -- One cart per player; serialise this player's cart changes.
  perform pg_advisory_xact_lock(hashtext('dd.cart'), hashtext(_uid::text));
  select * into _booking from public.bookings
   where player_id = _uid and status = 'held' and hold_expires_at > now()
   order by created_at desc limit 1
   for update;
  if not found then
    insert into public.bookings (player_id, created_by, status, hold_expires_at)
    values (_uid, _uid, 'held', now() + make_interval(mins => _settings.hold_minutes))
    returning * into _booking;
  end if;

  -- Validate and insert in a fixed order to avoid lock-order deadlocks.
  for _item in
    select distinct (e ->> 'court_id')::uuid as court_id, (e ->> 'starts_at')::timestamptz as starts_at
    from jsonb_array_elements(_slots) e
    order by 1, 2
  loop
    if _item.court_id is null or _item.starts_at is null then
      raise exception 'Each slot needs a court and a start time.' using errcode = '22023';
    end if;

    select * into _court from public.courts where id = _item.court_id;
    if not found or _court.status = 'inactive' then
      raise exception 'That court is not available for booking.' using errcode = '22023';
    end if;
    if _court.status = 'maintenance' then
      raise exception '% is closed for maintenance.', _court.name using errcode = '22023';
    end if;
    if extract(epoch from _item.starts_at)::bigint % 3600 <> 0 then
      raise exception 'Bookings start on the hour.' using errcode = '22023';
    end if;
    if _item.starts_at <= now() then
      raise exception '% at % has already started.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '22023';
    end if;

    _date := private.operating_date_of(_item.starts_at);
    if _date < _today or _date > _today + _settings.booking_window_days then
      raise exception 'You can book up to % days ahead.', _settings.booking_window_days using errcode = '22023';
    end if;

    select * into _w from private.operating_window(_date);
    if _w.state <> 'open' or _item.starts_at < _w.opens_at or _item.starts_at + interval '1 hour' > _w.closes_at then
      raise exception 'The club is not open at % on that day.', private.fmt_time(_item.starts_at) using errcode = '22023';
    end if;

    select * into _rate from private.price_for_slot(_item.court_id, _item.starts_at);
    if _rate.rate_id is null then
      raise exception 'No court rate is set for % at %. Contact the club.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '22023';
    end if;

    begin
      insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos, price_breakdown, created_by)
      values (
        _booking.id, _item.court_id,
        tstzrange(_item.starts_at, _item.starts_at + interval '1 hour', '[)'),
        'rental', 'held', _rate.price_centavos,
        jsonb_build_object('rate_id', _rate.rate_id, 'label', _rate.label, 'tier', _rate.tier,
                           'price_centavos', _rate.price_centavos),
        _uid
      );
    -- Two sessions inserting the same hour at the same instant can each wait on
    -- the other inside the exclusion check; Postgres then aborts one with a
    -- deadlock. The loser gets the same "just taken" answer either way.
    exception when exclusion_violation or deadlock_detected then
      raise exception '% at % was just taken. Remove it and try again.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '23P01',
              detail = jsonb_build_object('court_id', _item.court_id, 'starts_at', _item.starts_at)::text;
    end;
  end loop;

  select count(*) into _count from public.booking_slots
   where booking_id = _booking.id and status = 'held';
  if _count > _settings.max_slots_per_booking then
    raise exception 'One booking can hold up to % court-hours.', _settings.max_slots_per_booking using errcode = '22023';
  end if;

  perform private.recalculate_booking_total(_booking.id);
  return _booking.id;
end;
$$;


--
-- Name: join_queue(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_queue(_event_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _e public.events := private.queue_session(_event_id);
begin
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  return private.enqueue(_e.id, _uid, private.queue_registration(_e.id, _uid), 0, null);
end;
$$;


--
-- Name: leave_queue(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_queue(_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _q public.queue_entries;
begin
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_event_id::text));
  select * into _q from public.queue_entries
  where event_id = _event_id and player_id = _uid and status in ('waiting', 'called', 'playing');
  if not found then
    raise exception 'You are not in the queue.' using errcode = 'P0002';
  end if;
  if _q.status <> 'waiting' then
    raise exception 'You are on court. Ask staff to take you off.' using errcode = '22023';
  end if;
  update public.queue_entries set status = 'left', ended_at = now() where id = _q.id;
end;
$$;


--
-- Name: mark_notifications_read(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notifications_read(_ids uuid[] DEFAULT NULL::uuid[]) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (_ids is null or id = any (_ids));
$$;


--
-- Name: register_for_event(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_for_event(_event_id uuid, _division_id uuid DEFAULT NULL::uuid, _partner_email text DEFAULT NULL::text, _note text DEFAULT NULL::text) RETURNS TABLE(registration_id uuid, status public.registration_status, booking_id uuid, amount_due_centavos bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _uid uuid := private.require_bookable_player();
  _e public.events;
  _state text;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status = 'draft' then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  _state := private.registration_state(_e);
  if _state = 'not_yet' then
    raise exception 'Registration opens %.', to_char(_e.registration_opens_at at time zone 'Asia/Manila', 'Dy, Mon FMDD at FMHH12:MI AM')
      using errcode = '22023';
  elsif _state <> 'open' then
    raise exception 'Registration for % is closed.', _e.title using errcode = '22023';
  end if;
  return query select * from private.create_registration(
    _event_id, _division_id, _uid, private.find_partner(_partner_email), _uid, false, _note);
end;
$$;


--
-- Name: release_held_slot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_held_slot(_slot_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _booking_id uuid;
begin
  select s.booking_id into _booking_id
  from public.booking_slots s join public.bookings b on b.id = s.booking_id
  where s.id = _slot_id and b.player_id = _uid and b.status = 'held' and s.status = 'held'
  for update of s, b;
  if _booking_id is null then
    raise exception 'That time is no longer in your cart.' using errcode = 'P0002';
  end if;

  update public.booking_slots set status = 'released' where id = _slot_id;
  if not exists (select 1 from public.booking_slots where booking_id = _booking_id and status = 'held') then
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid,
                               cancel_reason = 'Cart emptied', hold_expires_at = hold_expires_at
     where id = _booking_id;
  end if;
  perform private.recalculate_booking_total(_booking_id);
end;
$$;


--
-- Name: report_bookings(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_bookings(_from date, _to date) RETURNS TABLE(reference text, kind text, operating_date date, first_start timestamp with time zone, courts text, court_hours integer, player_name text, player_phone text, booking_status public.booking_status, payment_status public.booking_payment_status, total_centavos bigint, approved_centavos bigint, event_title text, created_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  with s as (
    select bs.booking_id, min(bs.operating_date) as op_date, min(lower(bs.slot)) as first_at,
           string_agg(distinct c.name, ', ' order by c.name) as courts,
           count(*) filter (where bs.status not in ('released', 'cancelled'))::int as hours
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id is not null and bs.status <> 'released'
    group by bs.booking_id
  )
  select b.reference,
         case when b.event_id is not null then 'event_fee' else 'court_rental' end,
         coalesce(s.op_date, private.operating_date_of(b.created_at)), s.first_at, s.courts, coalesce(s.hours, 0),
         p.full_name, p.phone, b.status, b.payment_status, b.total_centavos,
         coalesce((select sum(x.amount_centavos) from public.payments x where x.booking_id = b.id and x.status = 'approved'), 0)::bigint,
         e.title, b.created_at, b.cancelled_at, b.cancel_reason
  from public.bookings b
  join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  left join public.events e on e.id = b.event_id
  where b.status not in ('cart', 'held')
    and coalesce(s.op_date, private.operating_date_of(b.created_at)) between _from and _to
  order by 3, s.first_at nulls last, b.reference;
end;
$$;


--
-- Name: report_check_ins(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_check_ins(_from date, _to date) RETURNS TABLE(checked_in_at timestamp with time zone, kind text, player_name text, what text, booking_reference text, checked_in_by text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  select ci.checked_in_at, ci.kind, p.full_name, coalesce(e.title, 'Court rental'), b.reference, s.full_name
  from public.check_ins ci
  join public.profiles p on p.id = ci.player_id
  left join public.events e on e.id = ci.event_id
  left join public.bookings b on b.id = ci.booking_id
  left join public.profiles s on s.id = ci.checked_in_by
  where private.operating_date_of(ci.checked_in_at) between _from and _to
  order by ci.checked_in_at;
end;
$$;


--
-- Name: report_event_registrations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_event_registrations(_event_id uuid) RETURNS TABLE(event_title text, event_date date, division text, category text, player_name text, player_phone text, partner_name text, status public.registration_status, attendance text, checked_in_at timestamp with time zone, fee_centavos bigint, payment_status public.booking_payment_status, registered_at timestamp with time zone, cancel_reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events;
begin
  if not private.has_permission('reports.view') then
    raise exception 'You do not have permission to view reports.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select _e.title, private.operating_date_of(_e.starts_at), d.name, c.name,
         coalesce(p.full_name, r.guest_name || ' (walk-in)'), coalesce(p.phone, r.guest_phone),
         coalesce(q.full_name, r.partner_guest_name),
         r.status, r.attendance, r.checked_in_at, coalesce(b.total_centavos, r.walk_in_paid_centavos),
         case when r.player_id is null and r.walk_in_paid_centavos > 0 then 'paid'::public.booking_payment_status else b.payment_status end,
         r.created_at, r.cancel_reason
  from public.event_registrations r
  left join public.profiles p on p.id = r.player_id
  left join public.profiles q on q.id = r.partner_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where r.event_id = _e.id
  order by d.sort_order nulls first, d.name, r.created_at;
end;
$$;


--
-- Name: report_payments(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_payments(_from date, _to date) RETURNS TABLE(submitted_at timestamp with time zone, booking_reference text, purpose text, player_name text, method public.payment_method_kind, amount_centavos bigint, reference_no text, status public.payment_status, reviewed_by text, reviewed_at timestamp with time zone, review_note text, booking_payment_status public.booking_payment_status)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  select x.created_at, b.reference,
         case when b.event_id is not null then 'Entry fee: ' || coalesce(e.title, 'event') else 'Court rental' end,
         p.full_name, x.method_kind, x.amount_centavos, x.reference_no, x.status,
         r.full_name, x.reviewed_at, x.review_note, b.payment_status
  from public.payments x
  join public.bookings b on b.id = x.booking_id
  join public.profiles p on p.id = b.player_id
  left join public.profiles r on r.id = x.reviewed_by
  left join public.events e on e.id = b.event_id
  where private.operating_date_of(x.created_at) between _from and _to
  order by x.created_at;
end;
$$;


--
-- Name: report_revenue_daily(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_revenue_daily(_from date, _to date) RETURNS TABLE(day date, payments_approved integer, court_rental_centavos bigint, event_fee_centavos bigint, cash_centavos bigint, online_centavos bigint, total_centavos bigint, refunded_or_due_centavos bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  with a as (
    select private.operating_date_of(x.reviewed_at) as d, x.amount_centavos as amt, x.method_kind as m,
           b.event_id is not null as is_event, b.payment_status in ('refund_due', 'refunded') as refunded
    from public.payments x join public.bookings b on b.id = x.booking_id
    where x.status = 'approved' and private.operating_date_of(x.reviewed_at) between _from and _to
    union all
    -- Walk-in entry fees received at the desk.
    select private.operating_date_of(r.walk_in_recorded_at), r.walk_in_paid_centavos, r.walk_in_method, true, false
    from public.event_registrations r
    where r.walk_in_paid_centavos > 0 and private.operating_date_of(r.walk_in_recorded_at) between _from and _to
  )
  select g.d::date, count(a.amt)::int,
         coalesce(sum(a.amt) filter (where not a.is_event), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.is_event), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.m = 'cash'), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.m <> 'cash'), 0)::bigint,
         coalesce(sum(a.amt), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.refunded), 0)::bigint
  from generate_series(_from, _to, interval '1 day') g(d)
  left join a on a.d = g.d::date
  group by g.d
  order by g.d;
end;
$$;


--
-- Name: self_check_in(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.self_check_in(_event_id uuid, _code text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _e public.events;
  _r public.event_registrations;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status in ('draft', 'cancelled', 'completed') then
    raise exception 'That session was not found or is not running.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from private.event_codes c where c.event_id = _e.id and c.checkin_code = btrim(coalesce(_code, ''))) then
    raise exception 'This check-in code is not valid. Scan the QR code at the desk again.' using errcode = '22023';
  end if;
  if now() < _e.starts_at - interval '45 minutes' then
    raise exception 'Check-in opens 45 minutes before the start (%).', private.fmt_time(_e.starts_at) using errcode = '22023';
  end if;
  if now() > _e.ends_at then
    raise exception 'This session has ended.' using errcode = '22023';
  end if;

  select * into _r from public.event_registrations
  where event_id = _e.id and _uid in (player_id, partner_id) and status in ('pending', 'confirmed', 'waitlisted')
  order by status = 'confirmed' desc
  limit 1
  for update;
  if not found then
    raise exception 'You are not booked for %. Book it first, then scan again.', _e.title using errcode = '22023';
  end if;
  if _r.status = 'pending' then
    raise exception 'Your fee has not been confirmed yet. Show your payment at the desk.' using errcode = '22023';
  end if;
  if _r.status = 'waitlisted' then
    raise exception 'You are on the waitlist for %. The desk will tell you if a place opens.', _e.title using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Self check-in (QR)', true);
  update public.event_registrations
     set attendance = 'present', checked_in_at = coalesce(checked_in_at, now()), checked_in_by = coalesce(checked_in_by, _uid)
   where id = _r.id;
  insert into public.check_ins (player_id, event_id, registration_id, checked_in_by, kind)
  values (_uid, _e.id, _r.id, _uid, 'event')
  on conflict do nothing;

  -- Open play: straight into the stack ('queued' also when already in it, so a second scan is harmless).
  if _e.event_type = 'open_play' then
    perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
    if not exists (select 1 from public.queue_entries q
                   where q.event_id = _e.id and q.player_id = _uid and q.status in ('waiting', 'called', 'playing')) then
      perform private.enqueue(_e.id, _uid, _r.id, 0, null);
    end if;
    return 'queued';
  end if;
  return 'checked_in';
end;
$$;


--
-- Name: set_booking_display_name(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_booking_display_name(_booking_id uuid, _name text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _clean text;
begin
  if _uid is null then
    raise exception 'Sign in to manage bookings.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or (_b.player_id <> _uid and not private.has_permission('bookings.manage')) then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status not in ('held', 'confirmed') then
    raise exception 'This booking can no longer be changed.' using errcode = '22023';
  end if;

  -- One line of plain text: control characters removed, spaces collapsed.
  _clean := nullif(btrim(regexp_replace(regexp_replace(coalesce(_name, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
  if _clean is not null and char_length(_clean) > 30 then
    raise exception 'Keep the court board name to 30 characters or fewer.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Court board name changed', true);
  update public.bookings set display_name = _clean where id = _b.id;
  return _clean;
end;
$$;


--
-- Name: staff_assign_event_courts(uuid, uuid[], timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_assign_event_courts(_event_id uuid, _court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _reason text DEFAULT NULL::text) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.require_event_manager(_event_id);
  _court public.courts;
  _clash record;
  _id uuid;
begin
  if _e.status in ('cancelled', 'completed') then
    raise exception 'This event is %.', _e.status using errcode = '22023';
  end if;
  if coalesce(cardinality(_court_ids), 0) = 0 then
    raise exception 'Choose at least one court.' using errcode = '22023';
  end if;
  if _ends_at <= _starts_at then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if _starts_at < _e.starts_at or _ends_at > _e.ends_at then
    raise exception 'Court times must fall within the event (% to %).',
      private.fmt_time(_e.starts_at), private.fmt_time(_e.ends_at) using errcode = '22023';
  end if;
  perform private.expire_stale_holds();
  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Courts assigned to ' || _e.title), true);

  for _court in select * from public.courts where id = any (_court_ids) order by sort_order, number loop
    if _court.status = 'inactive' then
      raise exception '% is not in use.', _court.name using errcode = '22023';
    end if;
    begin
      insert into public.booking_slots (event_id, court_id, slot, kind, status, price_centavos, note, created_by)
      values (_e.id, _court.id, tstzrange(_starts_at, _ends_at, '[)'),
              case when _e.event_type = 'open_play' then 'open_play'::public.slot_kind else 'event'::public.slot_kind end,
              'confirmed', 0, left(_e.title, 300), auth.uid())
      returning id into _id;
    exception when exclusion_violation then
      select s.kind, b.reference, ev.title, lower(s.slot) as starts into _clash
      from public.booking_slots s
      left join public.bookings b on b.id = s.booking_id
      left join public.events ev on ev.id = s.event_id
      where s.court_id = _court.id and s.slot && tstzrange(_starts_at, _ends_at, '[)')
        and private.slot_is_live(s.status, s.booking_id)
      order by lower(s.slot) limit 1;
      raise exception '% is already taken at % (%).', _court.name, private.fmt_time(_clash.starts),
        case when _clash.reference is not null then 'booking ' || _clash.reference
             when _clash.title is not null then _clash.title
             else replace(_clash.kind::text, '_', ' ') end
        using errcode = '23P01';
    end;
    return next _id;
  end loop;
end;
$$;


--
-- Name: staff_block_courts(uuid[], timestamp with time zone, timestamp with time zone, public.slot_kind, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_block_courts(_court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _kind public.slot_kind, _note text, _reason text) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
  _court public.courts;
  _ids uuid[] := '{}';
  _id uuid;
  _clash text;
begin
  if not private.has_permission('schedule.manage') then
    raise exception 'You do not have permission to block courts.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  if _kind not in ('block', 'maintenance', 'private_event') then
    raise exception 'Choose a block, maintenance or private event.' using errcode = '22023';
  end if;
  if _court_ids is null or cardinality(_court_ids) = 0 then
    raise exception 'Choose at least one court.' using errcode = '22023';
  end if;
  if _ends_at <= _starts_at then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if extract(epoch from _starts_at)::bigint % 3600 <> 0 or extract(epoch from _ends_at)::bigint % 3600 <> 0 then
    raise exception 'Blocks start and end on the hour.' using errcode = '22023';
  end if;

  perform private.expire_stale_holds();
  perform set_config('app.audit_reason', _why, true);

  for _court in select * from public.courts where id = any (_court_ids) order by number loop
    begin
      insert into public.booking_slots (court_id, slot, kind, status, note, created_by)
      values (_court.id, tstzrange(_starts_at, _ends_at, '[)'), _kind, 'confirmed', nullif(btrim(coalesce(_note, '')), ''), auth.uid())
      returning id into _id;
      _ids := _ids || _id;
    exception when exclusion_violation then
      select coalesce('booking ' || b.reference, initcap(replace(bs.kind::text, '_', ' '))) into _clash
      from public.booking_slots bs left join public.bookings b on b.id = bs.booking_id
      where bs.court_id = _court.id and bs.slot && tstzrange(_starts_at, _ends_at, '[)')
        and private.slot_is_live(bs.status, bs.booking_id)
      order by lower(bs.slot) limit 1;
      raise exception '% already has % in that time. Cancel or move it first.', _court.name, coalesce(_clash, 'something')
        using errcode = '23P01';
    end;
  end loop;

  if cardinality(_ids) <> cardinality(_court_ids) then
    raise exception 'One of those courts was not found.' using errcode = 'P0002';
  end if;
  return _ids;
end;
$$;


--
-- Name: staff_booking_balances(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_booking_balances(_booking_ids uuid[]) RETURNS TABLE(booking_id uuid, total_centavos bigint, paid_centavos bigint, due_centavos bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  if not private.is_staff() then
    raise exception 'Only club staff can see balances.' using errcode = '42501';
  end if;
  return query
  select b.id, b.total_centavos,
         coalesce((select sum(p.amount_centavos) from public.payments p where p.booking_id = b.id and p.status = 'approved'), 0)::bigint,
         private.amount_due(b.id)
  from public.bookings b
  where b.id = any(_booking_ids);
end;
$$;


--
-- Name: staff_booking_history(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_booking_history(_booking_id uuid) RETURNS TABLE(id bigint, occurred_at timestamp with time zone, actor_id uuid, action text, table_name text, old_data jsonb, new_data jsonb, reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _payments boolean := private.has_permission('payments.verify');
begin
  if not private.is_staff() then
    raise exception 'Only club staff can see booking history.' using errcode = '42501';
  end if;
  return query
  select a.id, a.occurred_at, a.actor_id, a.action, a.table_name, a.old_data, a.new_data, a.reason
  from public.audit_log a
  where (a.table_name = 'bookings' and a.record_id = _booking_id::text)
     or (_payments and a.table_name = 'payments'
         and (a.new_data ->> 'booking_id' = _booking_id::text or a.old_data ->> 'booking_id' = _booking_id::text))
  order by a.occurred_at, a.id;
end;
$$;


--
-- Name: staff_call_next(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_call_next(_event_id uuid, _court_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.queue_session(_event_id);
  _n int := _e.queue_players_per_game;
  _matching text := coalesce(_e.queue_matching, 'balanced');
  _social boolean := coalesce(_e.queue_matching, 'balanced') = 'social';
  _court public.courts;
  _lane uuid;
  _has_lane boolean;
  _stack uuid;
  _stack_name text;
  _rotation text;
  _game uuid;
  _picked uuid[];
  _players uuid[];
  _stayers int;
  _waiting int;
  _order int[];
  _teams text[];
  _wins_differ boolean;
  _mate int;
  _j int;
  _rest int[];
  _i int;
  _anchor text;
  _cost int;
  _best int;
begin
  perform private.require_event_manager(_event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  select * into _court from public.courts where id = _court_id;
  if not exists (select 1 from public.booking_slots s
                 where s.event_id = _e.id and s.court_id = _court_id and s.status not in ('cancelled', 'released')
                   and s.slot @> now()) then
    raise exception '% is not reserved for this session right now.', coalesce(_court.name, 'That court') using errcode = '22023';
  end if;
  if exists (select 1 from public.queue_games where event_id = _e.id and court_id = _court_id and status in ('called', 'playing')) then
    raise exception '% already has a game. Finish it first.', _court.name using errcode = '22023';
  end if;

  -- Which stack plays. Social mix: everyone is one line. Otherwise winners staying here
  -- keep theirs, then the court's level, then (Flex) the longest stack.
  if not _social then
    select l.division_id into _lane from public.event_court_lanes l where l.event_id = _e.id and l.court_id = _court_id;
    _has_lane := found;
    select q.division_id into _stack from public.queue_entries q
    where q.event_id = _e.id and q.status = 'waiting' and q.stay_court_id = _court_id
    order by q.queued_at, q.id limit 1;
    if not found then
      if _has_lane then
        _stack := _lane;
      else
        select w.division_id into _stack from (
          select q.division_id, count(*) as n, min(q.queued_at) as first_at
          from public.queue_entries q
          where q.event_id = _e.id and q.status = 'waiting' and q.stay_court_id is null
          group by q.division_id
        ) w
        order by (w.n >= _n) desc, w.n desc, w.first_at
        limit 1;
      end if;
    end if;
    select d.name into _stack_name from public.event_divisions d where d.id = _stack;
  end if;

  -- Winners vs losers: the first in line decides the game's group (their last result).
  if _matching = 'winners_losers' then
    select coalesce(private.queue_last_outcome(_e.id, coalesce(q.player_id, q.registration_id)), 'none') into _anchor
    from public.queue_entries q
    where q.event_id = _e.id and q.status = 'waiting'
      and (_social or q.division_id is not distinct from _stack)
      and (q.stay_court_id is null or q.stay_court_id = _court_id)
    order by (q.stay_court_id = _court_id) desc nulls last, q.queued_at, q.id
    limit 1;
  end if;

  -- Winners staying on this court first, then the line (same-result people first in Winners vs losers).
  -- _players holds who each place is: the account, or a walk-in's registration.
  select array_agg(x.id order by x.rn), array_agg(x.who order by x.rn), count(*) filter (where x.stays)
    into _picked, _players, _stayers
  from (
    select q.id, coalesce(q.player_id, q.registration_id) as who, coalesce(q.stay_court_id = _court_id, false) as stays,
           row_number() over (
             order by (q.stay_court_id = _court_id) desc nulls last,
                      case when _anchor is not null
                           then coalesce(private.queue_last_outcome(_e.id, coalesce(q.player_id, q.registration_id)), 'none') = _anchor
                      end desc nulls last,
                      q.queued_at, q.id) as rn
    from public.queue_entries q
    where q.event_id = _e.id and q.status = 'waiting'
      and (_social or q.division_id is not distinct from _stack)
      and (q.stay_court_id is null or q.stay_court_id = _court_id)
  ) x
  where x.rn <= _n;
  _waiting := coalesce(cardinality(_picked), 0);
  if _waiting < _n then
    raise exception 'Only % of % % players are waiting.', _waiting, _n, coalesce(_stack_name, '')
      using errcode = '22023';
  end if;

  -- Teams.
  _rotation := private.stack_rotation(_stack, _e);
  _teams := array_fill('b'::text, array[_n]);
  if _stayers > 0 and _rotation = 'winners_split' then
    for _i in 1.._n loop
      _teams[_i] := case when _i % 2 = 1 then 'a' else 'b' end;
    end loop;
  elsif _stayers > 0 or _n = 2 then
    for _i in 1.._n loop
      _teams[_i] := case when _i <= _n / 2 then 'a' else 'b' end;
    end loop;
  elsif _social then
    -- Social mix: of the three ways to pair four people, the one whose partners played together least.
    _best := null;
    foreach _j in array array[2, 3, 4] loop
      select array_agg(k order by k) into _rest from unnest(array[2, 3, 4]) k where k <> _j;
      _cost := private.queue_partner_count(_e.id, _players[1], _players[_j])
             + private.queue_partner_count(_e.id, _players[_rest[1]], _players[_rest[2]]);
      if _best is null or _cost < _best then
        _best := _cost;
        _mate := _j;
      end if;
    end loop;
    _teams[1] := 'a';
    _teams[_mate] := 'a';
  else
    -- Balanced (also Winners vs losers): most wins partners fewest wins; avoid last game's partner.
    select array_agg(i order by private.queue_wins(_e.id, _players[i]) desc, i),
           count(distinct private.queue_wins(_e.id, _players[i])) > 1
      into _order, _wins_differ
    from generate_subscripts(_players, 1) i;
    _mate := null;
    foreach _j in array case when _wins_differ then array[4, 3, 2] else array[2, 3, 4] end loop
      select array_agg(k order by k) into _rest from unnest(array[2, 3, 4]) k where k <> _j;
      if not private.queue_were_partners(_e.id, _players[_order[1]], _players[_order[_j]])
         and not private.queue_were_partners(_e.id, _players[_order[_rest[1]]], _players[_order[_rest[2]]]) then
        _mate := _j;
        exit;
      end if;
    end loop;
    _mate := coalesce(_mate, case when _wins_differ then 4 else 2 end);
    _teams[_order[1]] := 'a';
    _teams[_order[_mate]] := 'a';
  end if;

  insert into public.queue_games (event_id, court_id, called_by, division_id) values (_e.id, _court_id, auth.uid(), _stack)
  returning id into _game;
  for _i in 1.._waiting loop
    update public.queue_entries
       set status = 'called', game_id = _game, court_id = _court_id, called_at = now(), team = _teams[_i]
     where id = _picked[_i];
  end loop;
  perform private.notify(q.player_id, 'queue_called', 'You’re up on ' || _court.name,
    'Head to ' || _court.name || ' now.', '/events/' || _e.slug)
  from public.queue_entries q where q.game_id = _game;
  return _game;
end;
$$;


--
-- Name: staff_cancel_event(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_cancel_event(_event_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.require_event_manager(_event_id);
  _why text := private.require_reason(_reason);
begin
  if _e.status in ('cancelled', 'completed') then
    raise exception 'This event is already %.', _e.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.events set status = 'cancelled', cancel_reason = left(_why, 300) where id = _e.id;
end;
$$;


--
-- Name: staff_cancel_game(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_cancel_game(_game_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _g public.queue_games;
begin
  select * into _g from public.queue_games where id = _game_id for update;
  if not found then
    raise exception 'That game was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_g.event_id);
  if _g.status not in ('called', 'playing') then
    raise exception 'This game is already %.', _g.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Queue game cancelled; players keep their places', true);
  update public.queue_games set status = 'cancelled', ended_at = now() where id = _g.id;
  update public.queue_entries
     set status = 'waiting', game_id = null, court_id = null, team = null, called_at = null, started_at = null
   where game_id = _g.id and status in ('called', 'playing');
end;
$$;


--
-- Name: staff_cancel_registration(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_cancel_registration(_registration_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
  _e public.events;
  _why text := private.require_reason(_reason);
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_r.event_id);
  if _r.status not in ('pending', 'confirmed', 'waitlisted') then
    raise exception 'This registration is already %.', _r.status using errcode = '22023';
  end if;
  perform private.cancel_registration(_r, auth.uid(), _why);
  perform private.notify(_r.player_id, 'registration_cancelled', 'Registration cancelled: ' || _e.title, _why, '/my/events');
  if _r.partner_id is not null then
    perform private.notify(_r.partner_id, 'registration_cancelled', 'Registration cancelled: ' || _e.title, _why, '/my/events');
  end if;
end;
$$;


--
-- Name: staff_check_in(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_check_in(_registration_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_r.event_id);
  if _e.status in ('cancelled', 'draft') then
    raise exception 'This event is not running.' using errcode = '22023';
  end if;
  if _r.status = 'pending' then
    raise exception 'The entry fee has not been confirmed yet.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'This registration is %.', _r.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Checked in', true);
  update public.event_registrations
     set attendance = 'present', checked_in_at = coalesce(checked_in_at, now()), checked_in_by = auth.uid()
   where id = _r.id;
  insert into public.check_ins (player_id, event_id, registration_id, checked_in_by, kind)
  select p, _r.event_id, _r.id, auth.uid(), 'event'
  from unnest(array[_r.player_id, _r.partner_id]) p where p is not null
  on conflict do nothing;

  -- Open play: straight into the stack (as with the QR self check-in), unless already in it.
  if _e.event_type = 'open_play' and _e.status <> 'completed' then
    perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
    if _r.player_id is not null then
      if not exists (select 1 from public.queue_entries q
                     where q.event_id = _e.id and q.player_id = _r.player_id and q.status in ('waiting', 'called', 'playing')) then
        perform private.enqueue(_e.id, _r.player_id, _r.id, 0, null);
      end if;
    elsif not exists (select 1 from public.queue_entries q
                      where q.event_id = _e.id and q.player_id is null and q.registration_id = _r.id
                        and q.status in ('waiting', 'called', 'playing')) then
      perform private.enqueue(_e.id, null, _r.id, 0, null);
    end if;
  end if;
end;
$$;


--
-- Name: staff_check_in_all(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_check_in_all(_event_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _id uuid;
  _n int := 0;
begin
  perform private.require_event_manager(_event_id);
  for _id in
    select r.id from public.event_registrations r
    where r.event_id = _event_id and r.status = 'confirmed' and r.attendance is distinct from 'present'
    order by r.created_at
  loop
    perform public.staff_check_in(_id);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;


--
-- Name: staff_check_in_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_check_in_booking(_booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _b public.bookings;
  _today date := private.operating_date_of(now());
begin
  if not private.has_permission('bookings.manage') then
    raise exception 'You do not have permission to check in bookings.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be checked in.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.booking_slots where booking_id = _b.id and operating_date = _today
                 and status in ('confirmed', 'checked_in')) then
    raise exception 'This booking has no court time today.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Checked in at the desk', true);
  update public.booking_slots set status = 'checked_in'
   where booking_id = _b.id and operating_date = _today and status = 'confirmed';
  insert into public.check_ins (player_id, booking_id, checked_in_by, kind)
  values (_b.player_id, _b.id, auth.uid(), 'court_rental')
  on conflict do nothing;
end;
$$;


--
-- Name: staff_complete_game(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_complete_game(_game_id uuid, _winning_team text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _g public.queue_games;
  _e public.events;
  _q public.queue_entries;
  _rotation text;
  _stays boolean;
begin
  select * into _g from public.queue_games where id = _game_id;
  if not found then
    raise exception 'That game was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_g.event_id);
  _e := private.queue_session(_g.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_g.event_id::text));
  select * into _g from public.queue_games where id = _game_id for update;
  if _g.status = 'called' then
    raise exception 'Start the game before finishing it.' using errcode = '22023';
  end if;
  if _g.status <> 'playing' then
    raise exception 'This game is already %.', _g.status using errcode = '22023';
  end if;
  if _winning_team is not null and _winning_team not in ('a', 'b') then
    raise exception 'The winning team must be A or B.' using errcode = '22023';
  end if;
  _rotation := private.stack_rotation(_g.division_id, _e);
  if _rotation in ('winners_stay', 'winners_split') and _winning_team is null then
    raise exception 'Winners stay on in this stack. Choose the winning team.' using errcode = '22023';
  end if;

  update public.queue_games set status = 'completed', ended_at = now(), winning_team = _winning_team where id = _g.id;
  for _q in select * from public.queue_entries where game_id = _g.id and status = 'playing'
            order by (team = _winning_team) desc nulls last, queued_at, id loop
    update public.queue_entries
       set status = 'completed', ended_at = now(),
           outcome = case when _winning_team is null then null when team = _winning_team then 'won' else 'lost' end
     where id = _q.id;
    _stays := _rotation in ('winners_stay', 'winners_split') and _q.team = _winning_team
              and _q.consecutive_games + 1 < _e.queue_max_consecutive;
    perform private.enqueue(_g.event_id, _q.player_id, _q.registration_id,
      case when _stays then _q.consecutive_games + 1 else 0 end,
      case when _stays then _g.court_id end);
  end loop;

  -- Auto-fill: call the next game on this court now. Not enough players waiting
  -- (or the court's time is over): leave the court free; the result still stands.
  if _e.queue_auto_fill then
    begin
      perform public.staff_call_next(_g.event_id, _g.court_id);
    exception when sqlstate '22023' then
      null;
    end;
  end if;
end;
$$;


--
-- Name: staff_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_dashboard() RETURNS TABLE(operating_date date, bookings_today integer, court_hours_today integer, unpaid_today integer, pending_payments integer, oldest_pending_at timestamp with time zone, refunds_due integer, active_holds integer, courts_total integer, courts_in_use integer, courts_maintenance integer, hours_configured boolean, rates_configured boolean, payment_methods_active integer, payment_due_hours integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _today date := private.operating_date_of(now());
begin
  if not private.is_staff() then
    raise exception 'Only club staff can view the dashboard.' using errcode = '42501';
  end if;
  return query
  select
    _today,
    (select count(distinct s.booking_id)::int from public.booking_slots s join public.bookings b on b.id = s.booking_id
      where s.operating_date = _today and b.status = 'confirmed' and s.status in ('confirmed', 'checked_in', 'completed')),
    (select count(*)::int from public.booking_slots s join public.bookings b on b.id = s.booking_id
      where s.operating_date = _today and b.status = 'confirmed' and s.status in ('confirmed', 'checked_in', 'completed')),
    (select count(distinct b.id)::int from public.bookings b join public.booking_slots s on s.booking_id = b.id
      where s.operating_date = _today and b.status = 'confirmed' and b.payment_status = 'unpaid'),
    (select count(*)::int from public.payments where status = 'submitted'),
    (select min(created_at) from public.payments where status = 'submitted'),
    (select count(*)::int from public.bookings where payment_status = 'refund_due'),
    (select count(*)::int from public.bookings where status = 'held' and hold_expires_at > now()),
    (select count(*)::int from public.courts where status <> 'inactive'),
    (select count(distinct s.court_id)::int from public.booking_slots s
      where s.slot @> now() and s.status in ('confirmed', 'checked_in') and s.kind in ('rental', 'open_play', 'event')),
    (select count(*)::int from public.courts c where c.status = 'maintenance'
       or exists (select 1 from public.booking_slots s where s.court_id = c.id and s.kind = 'maintenance'
                  and s.status = 'confirmed' and s.slot @> now())),
    exists (select 1 from public.operating_hours where not is_closed),
    exists (select 1 from public.rate_rules where is_active and product = 'court_rental'),
    (select count(*)::int from public.payment_methods where is_active and kind <> 'cash'),
    (select v.payment_due_hours from public.venue_settings v limit 1);
end;
$$;


--
-- Name: staff_delete_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_delete_booking(_booking_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _why text;
  _b public.bookings;
  _who text;
  _when text;
  _received bigint;
begin
  if not private.is_admin() then
    raise exception 'Only admins can delete bookings.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;

  select full_name into _who from public.profiles where id = _b.player_id;
  _when := private.booking_when(_b.id);
  select coalesce(sum(amount_centavos), 0) into _received
  from public.payments where booking_id = _b.id and status = 'approved';

  perform set_config('app.audit_reason', 'Booking deleted: ' || _why, true);

  -- Event entry: cancel first so the registration is cancelled the usual way.
  if _b.event_id is not null and _b.status in ('held', 'confirmed') then
    update public.booking_slots set status = 'cancelled' where booking_id = _b.id and status in ('held', 'confirmed');
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid, cancel_reason = left(_why, 300)
     where id = _b.id;
  end if;

  -- Payments (accepted or not) go with it; the audit log keeps a copy of each.
  delete from public.payments where booking_id = _b.id;
  -- Court hours cascade with the booking; check-ins keep their history without the link.
  delete from public.bookings where id = _b.id;

  if _b.player_id is distinct from _uid and _b.status in ('confirmed', 'completed') then
    perform private.notify(_b.player_id, 'booking_cancelled', 'Booking removed',
      format('Your booking %s%s was removed by the club. Reason: %s%s', _b.reference,
             coalesce(' (' || _when || ')', ''), _why,
             case when _received > 0 then ' The club will contact you about your payment.' else '' end),
      '/player/bookings');
  end if;
  perform private.notify_staff('Booking deleted',
    concat_ws(' · ', _b.reference, _who, _when,
              case when _received > 0 then private.peso(_received) || ' had been received: refund outside the system' end,
              _why)
      || coalesce((select ' · by ' || full_name from public.profiles where id = _uid), ''),
    '/admin/bookings', _uid);
end;
$$;


--
-- Name: staff_delete_event(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_delete_event(_event_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.require_event_manager(_event_id);
  _why text := private.require_reason(_reason);
begin
  if _e.event_type = 'open_play' then
    if _e.status not in ('cancelled', 'completed') then
      perform set_config('app.audit_reason', 'Cancelled before deletion: ' || _why, true);
      update public.events set status = 'cancelled', cancel_reason = left(_why, 300) where id = _e.id;
    end if;
    perform set_config('app.audit_reason', 'Event deleted: ' || _why, true);
    -- Check-ins stay as play history. Detach them from the registrations first:
    -- deleting the event removes its registrations and clears check_ins.event_id
    -- in the same statement, which otherwise trips check_ins_registration_id_fkey.
    update public.check_ins set registration_id = null where event_id = _e.id and registration_id is not null;
    delete from public.events where id = _e.id;
    return;
  end if;

  if exists (select 1 from public.event_registrations where event_id = _e.id) then
    raise exception 'Players have registered for this event, so it cannot be deleted. Cancel it instead: players are told and refunds are tracked.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.bookings where event_id = _e.id)
     or exists (select 1 from public.check_ins where event_id = _e.id)
     or exists (select 1 from public.event_matches where event_id = _e.id)
     or exists (select 1 from public.queue_games where event_id = _e.id)
     or exists (select 1 from public.queue_entries where event_id = _e.id) then
    raise exception 'This event already has payments, check-ins or games recorded, so it cannot be deleted. Cancel it instead.'
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Event deleted: ' || _why, true);
  delete from public.events where id = _e.id;
end;
$$;


--
-- Name: staff_event_codes(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_event_codes(_event_id uuid) RETURNS TABLE(checkin_code text, board_code text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  perform private.require_event_manager(_event_id);
  insert into private.event_codes (event_id) values (_event_id) on conflict do nothing;
  return query select c.checkin_code, c.board_code from private.event_codes c where c.event_id = _event_id;
end;
$$;


--
-- Name: staff_find_players(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_find_players(_query text) RETURNS TABLE(player_id uuid, full_name text, phone text, level public.player_level)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
begin
  if not (private.has_permission('events.manage') or private.has_permission('openplay.manage')) then
    raise exception 'You do not have permission to add players to events.' using errcode = '42501';
  end if;
  if _q is null or char_length(_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.full_name, p.phone, coalesce(p.level, p.self_rated_level)
  from public.profiles p join auth.users u on u.id = p.id
  where p.status = 'active'
    and (p.full_name ilike '%' || _q || '%' or p.phone like '%' || _q || '%' or lower(u.email) = lower(_q))
  order by p.full_name
  limit 20;
end;
$$;


--
-- Name: staff_generate_matches(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_generate_matches(_division_id uuid, _reason text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _d public.event_divisions;
  _e public.events;
  _ids uuid[];
  _n int;
  _m int;
  _r int;
  _i int;
  _k int;
  _count int := 0;
  _size int;
  _rounds int;
  _order int[];
  _next int[];
  _s int;
  _prev uuid[];
  _cur uuid[];
  _a uuid;
  _b uuid;
  _match public.event_matches;
begin
  select * into _d from public.event_divisions where id = _division_id;
  if not found then
    raise exception 'That division was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_d.event_id);
  if _d.format = 'none' then
    raise exception '% has no match format. Set round robin or single elimination first.', _d.name using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(_e.id::text));
  if exists (select 1 from public.event_matches where division_id = _d.id
             and status in ('completed', 'walkover', 'in_progress')) then
    raise exception 'Results are already recorded for %. Matches cannot be regenerated.', _d.name using errcode = '22023';
  end if;

  select array_agg(id order by seed nulls last, created_at) into _ids
  from public.event_registrations where division_id = _d.id and status = 'confirmed';
  _n := coalesce(cardinality(_ids), 0);
  if _n < 2 then
    raise exception '% needs at least two confirmed entries.', _d.name using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Matches generated for ' || _d.name), true);
  delete from public.event_matches where division_id = _d.id;

  if _d.format = 'round_robin' then
    if _n % 2 = 1 then
      _ids := _ids || null::uuid;
    end if;
    _m := cardinality(_ids);
    for _r in 1.._m - 1 loop
      _k := 0;
      for _i in 1.._m / 2 loop
        _a := _ids[_i];
        _b := _ids[_m + 1 - _i];
        if _a is not null and _b is not null then
          _k := _k + 1;
          insert into public.event_matches (event_id, division_id, stage, round, match_no, entry_a, entry_b)
          values (_e.id, _d.id, 'round_robin', _r, _k, _a, _b);
          _count := _count + 1;
        end if;
      end loop;
      -- Circle method: first entry fixed, the rest rotate one place.
      _ids := array[_ids[1], _ids[_m]] || _ids[2:_m - 1];
    end loop;
  else
    _size := 1;
    while _size < _n loop
      _size := _size * 2;
    end loop;
    _rounds := round(ln(_size) / ln(2))::int;
    -- Standard seeding order (1 v 8, 4 v 5, 2 v 7, 3 v 6 for 8)
    _order := array[1];
    while cardinality(_order) < _size loop
      _next := '{}';
      foreach _s in array _order loop
        _next := _next || _s || (2 * cardinality(_order) + 1 - _s);
      end loop;
      _order := _next;
    end loop;

    -- Create from the final backwards so each match knows where its winner goes.
    _prev := '{}';
    for _r in reverse _rounds..1 loop
      _cur := '{}';
      for _i in 1..(_size / (2 ^ _r)::int) loop
        insert into public.event_matches (event_id, division_id, stage, round, match_no, next_match_id, next_slot,
                                          entry_a, entry_b)
        values (_e.id, _d.id, 'elimination', _r, _i,
                case when _r < _rounds then _prev[(_i + 1) / 2] end,
                case when _r < _rounds then case when _i % 2 = 1 then 'a' else 'b' end end,
                case when _r = 1 and _order[2 * _i - 1] <= _n then _ids[_order[2 * _i - 1]] end,
                case when _r = 1 and _order[2 * _i] <= _n then _ids[_order[2 * _i]] end)
        returning id into _a;
        _cur := _cur || _a;
        _count := _count + 1;
      end loop;
      _prev := _cur;
    end loop;

    -- Byes: the seeded entry goes straight through.
    for _match in select * from public.event_matches
                  where division_id = _d.id and stage = 'elimination' and round = 1
                    and (entry_a is null or entry_b is null) loop
      _a := coalesce(_match.entry_a, _match.entry_b);
      update public.event_matches set status = 'bye', winner = _a where id = _match.id;
      perform private.advance_winner(_match, _a);
    end loop;
  end if;
  return _count;
end;
$$;


--
-- Name: staff_get_schedule(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_get_schedule(_date date) RETURNS TABLE(slot_id uuid, court_id uuid, court_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, kind public.slot_kind, slot_status public.slot_status, booking_id uuid, booking_reference text, booking_status public.booking_status, payment_status public.booking_payment_status, player_name text, player_phone text, note text, event_title text, display_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  if not private.is_staff() then
    raise exception 'Only club staff can view the full schedule.' using errcode = '42501';
  end if;
  return query
  select bs.id, bs.court_id, c.name, lower(bs.slot), upper(bs.slot), bs.kind, bs.status,
         b.id, b.reference, b.status, b.payment_status, p.full_name, p.phone, bs.note, e.title, b.display_name
  from public.booking_slots bs
  join public.courts c on c.id = bs.court_id
  left join public.bookings b on b.id = bs.booking_id
  left join public.profiles p on p.id = b.player_id
  left join public.events e on e.id = bs.event_id
  where bs.operating_date = _date
    and private.slot_is_live(bs.status, bs.booking_id)
  order by c.sort_order, c.number, lower(bs.slot);
end;
$$;


--
-- Name: staff_list_payments(public.payment_status, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_list_payments(_status public.payment_status DEFAULT 'submitted'::public.payment_status, _limit integer DEFAULT 100) RETURNS TABLE(payment_id uuid, status public.payment_status, method_kind public.payment_method_kind, method_label text, amount_centavos bigint, reference_no text, proof_path text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, reviewer_name text, review_note text, booking_id uuid, booking_reference text, booking_status public.booking_status, booking_total_centavos bigint, first_slot_at timestamp with time zone, player_name text, player_phone text, is_own boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;
  return query
  select p.id, p.status, p.method_kind, coalesce(m.label, initcap(replace(p.method_kind::text, '_', ' '))),
         p.amount_centavos, p.reference_no, p.proof_path, p.created_at, p.reviewed_at, r.full_name, p.review_note,
         b.id, b.reference, b.status, b.total_centavos,
         (select min(lower(s.slot)) from public.booking_slots s where s.booking_id = b.id and s.status not in ('released', 'cancelled')),
         pl.full_name, pl.phone,
         (b.player_id = auth.uid() or p.submitted_by = auth.uid())
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  join public.profiles pl on pl.id = b.player_id
  left join public.payment_methods m on m.id = p.payment_method_id
  left join public.profiles r on r.id = p.reviewed_by
  where _status is null or p.status = _status
  order by case when p.status = 'submitted' then p.created_at end asc nulls last, p.reviewed_at desc nulls last
  limit least(greatest(coalesce(_limit, 100), 1), 500);
end;
$$;


--
-- Name: staff_list_registrations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_list_registrations(_event_id uuid) RETURNS TABLE(registration_id uuid, division_id uuid, division_name text, category_name text, player_id uuid, player_name text, player_phone text, player_level public.player_level, partner_id uuid, partner_name text, status public.registration_status, attendance text, checked_in_at timestamp with time zone, booking_id uuid, booking_reference text, payment_status public.booking_payment_status, fee_centavos bigint, seed smallint, created_at timestamp with time zone, cancel_reason text, is_walk_in boolean, walk_in_paid_centavos bigint, walk_in_method public.payment_method_kind, walk_in_reference text, walk_in_fee_due_centavos bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
begin
  perform private.require_event_manager(_event_id);
  return query
  select r.id, r.division_id, d.name, c.name, r.player_id, coalesce(p.full_name, r.guest_name), coalesce(p.phone, r.guest_phone),
         coalesce(p.level, p.self_rated_level),
         r.partner_id, coalesce(pp.full_name, r.partner_guest_name), r.status, r.attendance, r.checked_in_at, b.id, b.reference,
         case when r.player_id is null and r.walk_in_paid_centavos > 0 then 'paid'::public.booking_payment_status
              when r.player_id is null and r.walk_in_fee_due_centavos > 0 then 'unpaid'::public.booking_payment_status
              else b.payment_status end,
         coalesce(b.total_centavos, r.walk_in_paid_centavos, r.walk_in_fee_due_centavos), r.seed, r.created_at, r.cancel_reason,
         r.player_id is null, r.walk_in_paid_centavos, r.walk_in_method, r.walk_in_reference, r.walk_in_fee_due_centavos
  from public.event_registrations r
  left join public.profiles p on p.id = r.player_id
  left join public.profiles pp on pp.id = r.partner_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where r.event_id = _event_id
  order by (r.status in ('pending', 'confirmed')) desc, d.sort_order nulls first, d.name, r.created_at;
end;
$$;


--
-- Name: staff_lookup_players(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_lookup_players(_query text, _limit integer DEFAULT 25) RETURNS TABLE(player_id uuid, full_name text, phone text, email text, level public.player_level, self_rated_level public.player_level, status public.account_status, bookings_total integer, bookings_upcoming integer, unpaid_bookings integer, last_booking_at timestamp with time zone, member_since timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
  _can_email boolean := private.has_permission('players.manage');
begin
  if not private.is_staff() then
    raise exception 'Only club staff can look up players.' using errcode = '42501';
  end if;
  _pattern := case when _q is null then null
                   else '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  return query
  select p.id, p.full_name, p.phone,
         case when _can_email then u.email::text end,
         p.level, p.self_rated_level, p.status,
         (select count(*)::int from public.bookings b where b.player_id = p.id and b.status in ('confirmed', 'completed', 'cancelled')),
         (select count(*)::int from public.bookings b where b.player_id = p.id and b.status = 'confirmed'
            and exists (select 1 from public.booking_slots s where s.booking_id = b.id and upper(s.slot) > now()
                        and s.status = 'confirmed')),
         (select count(*)::int from public.bookings b where b.player_id = p.id and b.status = 'confirmed' and b.payment_status = 'unpaid'),
         (select max(b.created_at) from public.bookings b where b.player_id = p.id),
         p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where _pattern is null
     or p.full_name ilike _pattern or p.phone ilike _pattern or (_can_email and u.email ilike _pattern)
  order by lower(p.full_name)
  limit least(greatest(coalesce(_limit, 25), 1), 1000);
end;
$$;


--
-- Name: staff_mark_absent(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_mark_absent(_registration_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_r.event_id);
  if _r.attendance = 'present' then
    raise exception 'This player is already checked in.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'This registration is %.', _r.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Marked no-show', true);
  update public.event_registrations set attendance = 'no_show' where id = _r.id;
end;
$$;


--
-- Name: staff_mark_booking_paid(uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_mark_booking_paid(_booking_id uuid, _note text DEFAULT NULL::text, _received_centavos bigint DEFAULT NULL::bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to confirm payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot confirm payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only an active booking can be marked paid (this one is %).', _b.status using errcode = '22023';
  end if;
  if _b.payment_status in ('paid', 'waived') then
    return;
  end if;
  if _b.payment_status = 'pending_verification'
     or exists (select 1 from public.payments where booking_id = _b.id and status = 'submitted') then
    raise exception 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
      using errcode = '22023';
  end if;
  if _b.payment_status <> 'unpaid' then
    raise exception 'This booking''s payment is %; it cannot be marked paid.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform private.record_desk_cash(_b, _received_centavos,
    coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Cash received at the desk'));
end;
$$;


--
-- Name: staff_mark_booking_unpaid(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_mark_booking_unpaid(_booking_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to change payments.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot change payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only an active booking can be changed (this one is %).', _b.status using errcode = '22023';
  end if;
  if _b.payment_status in ('unpaid', 'pending_verification') then
    return;
  end if;
  if _b.payment_status <> 'paid' then
    raise exception 'This booking''s payment is %; it cannot be set back to pending.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = 'rejected', reviewed_by = _uid, reviewed_at = now(), review_note = left('Reversed: ' || _why, 500)
   where booking_id = _b.id and status = 'approved';
  update public.bookings set payment_status = 'unpaid' where id = _b.id;

  perform private.notify(_b.player_id, 'payment_rejected', 'Payment needed',
    format('Your booking %s is waiting for payment again. Reason: %s', _b.reference, _why), '/bookings/' || _b.id);
end;
$$;


--
-- Name: staff_mark_walk_in_paid(uuid, bigint, public.payment_method_kind, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_mark_walk_in_paid(_registration_id uuid, _received_centavos bigint, _method public.payment_method_kind, _reference text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found or _r.player_id is not null then
    raise exception 'That walk-in was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_r.event_id);
  if _r.walk_in_fee_due_centavos is null then
    raise exception 'Nothing is owed for this entry.' using errcode = '22023';
  end if;
  if _method is null then
    raise exception 'Choose how the fee was paid.' using errcode = '22023';
  end if;
  if coalesce(_received_centavos, 0) < _r.walk_in_fee_due_centavos then
    raise exception 'The entry fee is ₱%. Enter the full amount received.',
      to_char(_r.walk_in_fee_due_centavos / 100.0, 'FM999,999,990.00') using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Walk-in fee received', true);
  update public.event_registrations
     set walk_in_paid_centavos = _received_centavos, walk_in_method = _method,
         walk_in_reference = nullif(left(btrim(coalesce(_reference, '')), 60), ''),
         walk_in_recorded_at = now(), walk_in_recorded_by = auth.uid(), walk_in_fee_due_centavos = null
   where id = _r.id;
end;
$$;


--
-- Name: staff_money_summary(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_money_summary(_date date DEFAULT NULL::date) RETURNS TABLE(kind text, method public.payment_method_kind, items integer, centavos bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _day date := coalesce(_date, private.operating_date_of(now()));
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to see payment totals.' using errcode = '42501';
  end if;
  return query
  select 'booking_payment'::text, p.method_kind, count(*)::int, sum(p.amount_centavos)::bigint
  from public.payments p
  where p.status = 'approved' and private.operating_date_of(coalesce(p.reviewed_at, p.created_at)) = _day
  group by p.method_kind
  union all
  select 'walk_in_fee'::text, r.walk_in_method, count(*)::int, sum(r.walk_in_paid_centavos)::bigint
  from public.event_registrations r
  where r.walk_in_paid_centavos > 0 and private.operating_date_of(r.walk_in_recorded_at) = _day
  group by r.walk_in_method
  union all
  select 'refund'::text, p.method_kind, count(distinct a.record_id)::int, sum(p.amount_centavos)::bigint
  from public.audit_log a
  join public.payments p on p.booking_id::text = a.record_id and p.status = 'approved'
  where a.table_name = 'bookings'
    and a.old_data ->> 'payment_status' = 'refund_due' and a.new_data ->> 'payment_status' = 'refunded'
    and private.operating_date_of(a.occurred_at) = _day
  group by p.method_kind;
end;
$$;


--
-- Name: staff_queue_add(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_queue_add(_event_id uuid, _player_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.queue_session(_event_id);
begin
  perform private.require_event_manager(_event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  return private.enqueue(_e.id, _player_id, private.queue_registration(_e.id, _player_id), 0, null);
end;
$$;


--
-- Name: staff_queue_add_walk_in(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_queue_add_walk_in(_registration_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id;
  if not found or _r.player_id is not null then
    raise exception 'That walk-in was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_r.event_id);
  _e := private.queue_session(_r.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  select * into _r from public.event_registrations where id = _registration_id;
  if _r.status <> 'confirmed' then
    raise exception 'This entry is %.', _r.status using errcode = '22023';
  end if;
  if _r.attendance is distinct from 'present' then
    raise exception 'Check % in at the desk first.', _r.guest_name using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Walk-in added to the stack', true);
  return private.enqueue(_e.id, null, _r.id, 0, null);
end;
$$;


--
-- Name: staff_queue_no_show(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_queue_no_show(_entry_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _q public.queue_entries;
  _e public.events;
  _court text;
  _repl uuid;
begin
  select * into _q from public.queue_entries where id = _entry_id;
  if not found then
    raise exception 'That queue entry was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_q.event_id);
  _e := private.queue_session(_q.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_q.event_id::text));
  select * into _q from public.queue_entries where id = _entry_id;
  if _q.status <> 'called' then
    raise exception 'Only a called player can be marked as a no-show.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Queue no-show', true);
  update public.queue_entries set status = 'no_show', ended_at = now() where id = _q.id;
  if _e.queue_no_show_rule = 'back_of_queue' then
    perform private.enqueue(_q.event_id, _q.player_id, _q.registration_id, 0, null);
  end if;

  -- Call the next waiting player of the same stack into the same place.
  select id into _repl from public.queue_entries
  where event_id = _q.event_id and status = 'waiting'
    and coalesce(player_id, registration_id) <> coalesce(_q.player_id, _q.registration_id) and stay_court_id is null
    and division_id is not distinct from _q.division_id
  order by queued_at, id limit 1;
  if _repl is not null then
    update public.queue_entries
       set status = 'called', game_id = _q.game_id, court_id = _q.court_id, team = _q.team, called_at = now()
     where id = _repl;
    select name into _court from public.courts where id = _q.court_id;
    perform private.notify(player_id, 'queue_called', 'You’re up on ' || _court, 'Head to ' || _court || ' now.',
      '/events/' || _e.slug)
    from public.queue_entries where id = _repl;
  end if;
  return _repl;
end;
$$;


--
-- Name: staff_queue_remove(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_queue_remove(_entry_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _q public.queue_entries;
  _why text := private.require_reason(_reason);
begin
  select * into _q from public.queue_entries where id = _entry_id;
  if not found then
    raise exception 'That queue entry was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_q.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_q.event_id::text));
  select * into _q from public.queue_entries where id = _entry_id;
  if _q.status <> 'waiting' then
    raise exception 'Only waiting players can be removed. Use no-show or finish the game instead.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.queue_entries set status = 'removed', ended_at = now() where id = _q.id;
end;
$$;


--
-- Name: staff_record_cash_payment(uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_record_cash_payment(_booking_id uuid, _note text DEFAULT NULL::text, _received_centavos bigint DEFAULT NULL::bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _id uuid;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot record a payment for your own booking.' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments where booking_id = _b.id and status = 'submitted') then
    raise exception 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
      using errcode = '22023';
  end if;
  if _b.status <> 'confirmed' or _b.payment_status <> 'unpaid' then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  perform private.record_desk_cash(_b, _received_centavos,
    coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Cash received at the desk'));
  select id into _id from public.payments
   where booking_id = _b.id and method_kind = 'cash' and submitted_by = _uid
   order by created_at desc limit 1;
  return _id;
end;
$$;


--
-- Name: staff_record_match_result(uuid, integer, integer, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_record_match_result(_match_id uuid, _score_a integer DEFAULT NULL::integer, _score_b integer DEFAULT NULL::integer, _walkover_winner uuid DEFAULT NULL::uuid, _note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _m public.event_matches;
  _next public.event_matches;
  _winner uuid;
begin
  select * into _m from public.event_matches where id = _match_id for update;
  if not found then
    raise exception 'That match was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_m.event_id);
  if _m.status in ('bye', 'cancelled') then
    raise exception 'This match is %.', _m.status using errcode = '22023';
  end if;
  if _m.entry_a is null or _m.entry_b is null then
    raise exception 'Both sides of this match are not known yet.' using errcode = '22023';
  end if;

  if _walkover_winner is not null then
    if _walkover_winner not in (_m.entry_a, _m.entry_b) then
      raise exception 'The walkover winner must be one of the two entries.' using errcode = '22023';
    end if;
    _winner := _walkover_winner;
  else
    if _score_a is null or _score_b is null or _score_a < 0 or _score_b < 0 then
      raise exception 'Enter both scores.' using errcode = '22023';
    end if;
    if _score_a = _score_b then
      raise exception 'A match needs a winner; the scores cannot be level.' using errcode = '22023';
    end if;
    _winner := case when _score_a > _score_b then _m.entry_a else _m.entry_b end;
  end if;

  if _m.next_match_id is not null then
    select * into _next from public.event_matches where id = _m.next_match_id for update;
    if _next.status in ('completed', 'walkover', 'in_progress') and _m.winner is distinct from _winner then
      raise exception 'The next round has already started. Clear that result before changing this one.' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Match result recorded'), true);
  update public.event_matches
     set status = case when _walkover_winner is not null then 'walkover' else 'completed' end,
         score_a = case when _walkover_winner is null then _score_a end,
         score_b = case when _walkover_winner is null then _score_b end,
         winner = _winner, result_note = left(nullif(btrim(coalesce(_note, '')), ''), 300),
         recorded_by = auth.uid(), recorded_at = now()
   where id = _m.id;
  perform private.advance_winner(_m, _winner);
end;
$$;


--
-- Name: staff_record_refund(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_record_refund(_booking_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to record refunds.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.payment_status <> 'refund_due' then
    raise exception 'This booking has no refund due.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.bookings set payment_status = 'refunded' where id = _b.id;
  perform private.notify(_b.player_id, 'refund_recorded', 'Refund sent',
    format('Your refund for %s was recorded: %s', _b.reference, _why), '/bookings/' || _b.id);
end;
$$;


--
-- Name: staff_register_player(uuid, uuid, uuid, uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_register_player(_event_id uuid, _player_id uuid, _division_id uuid DEFAULT NULL::uuid, _partner_id uuid DEFAULT NULL::uuid, _waive_fee boolean DEFAULT false, _reason text DEFAULT NULL::text) RETURNS TABLE(registration_id uuid, status public.registration_status, booking_id uuid, amount_due_centavos bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _e public.events := private.require_event_manager(_event_id);
begin
  if _e.status in ('cancelled', 'completed', 'draft') then
    raise exception 'Players can only be added to a published event that has not finished.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = _player_id and status = 'active') then
    raise exception 'That player was not found.' using errcode = 'P0002';
  end if;
  perform set_config('app.audit_reason',
    coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Registered by staff') || case when _waive_fee then ' (fee waived)' else '' end, true);
  if _waive_fee then
    perform private.require_reason(_reason);
  end if;
  return query select * from private.create_registration(
    _event_id, _division_id, _player_id, _partner_id, auth.uid(), _waive_fee, null);
end;
$$;


--
-- Name: staff_release_event_court(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_release_event_court(_slot_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _s public.booking_slots;
  _why text := private.require_reason(_reason);
begin
  select * into _s from public.booking_slots where id = _slot_id and kind in ('open_play', 'event') for update;
  if not found then
    raise exception 'That court assignment was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_s.event_id);
  if _s.status in ('cancelled', 'released') then
    raise exception 'That court was already released.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled' where id = _s.id;
end;
$$;


--
-- Name: staff_remove_block(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_remove_block(_slot_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
begin
  if not private.has_permission('schedule.manage') then
    raise exception 'You do not have permission to change blocks.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled'
   where id = _slot_id and kind in ('block', 'maintenance', 'private_event') and status <> 'cancelled';
  if not found then
    raise exception 'That block was not found.' using errcode = 'P0002';
  end if;
end;
$$;


--
-- Name: staff_review_payment(uuid, boolean, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_review_payment(_payment_id uuid, _approve boolean, _reason text DEFAULT NULL::text, _received_centavos bigint DEFAULT NULL::bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _p public.payments;
  _b public.bookings;
  _why text;
  _counted bigint;
  _left bigint;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'That payment was not found.' using errcode = 'P0002';
  end if;
  select * into _b from public.bookings where id = _p.booking_id for update;

  if _b.player_id = _uid or _p.submitted_by = _uid then
    raise exception 'You cannot review a payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _p.status <> 'submitted' then
    raise exception 'This payment was already %.', _p.status using errcode = '22023';
  end if;

  if _approve then
    if _received_centavos is not null and _received_centavos <= 0 then
      raise exception 'Enter the amount shown on the receipt.' using errcode = '22023';
    end if;
    _counted := coalesce(_received_centavos, _p.amount_centavos);
    _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''),
                     case when _counted < _p.amount_centavos
                          then format('Part payment: ₱%s of ₱%s received', to_char(_counted / 100.0, 'FM999,999,990.00'),
                                      to_char(_p.amount_centavos / 100.0, 'FM999,999,990.00'))
                          else 'Payment verified' end);
  else
    if _reason is null or char_length(btrim(_reason)) < 3 then
      raise exception 'Give the player a reason for rejecting this payment.' using errcode = '22023';
    end if;
    _why := left(btrim(_reason), 500);
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = case when _approve then 'approved'::public.payment_status else 'rejected'::public.payment_status end,
         amount_centavos = case when _approve then _counted else amount_centavos end,
         reviewed_by = _uid, reviewed_at = now(), review_note = _why
   where id = _p.id;

  if _approve then
    _left := private.amount_due(_b.id);
    -- A booking cancelled while its payment was being checked keeps 'refund_due':
    -- the money arrived, so the club owes it back.
    update public.bookings
       set payment_status = case
             when status <> 'confirmed' then 'refund_due'::public.booking_payment_status
             when _left = 0 then 'paid'::public.booking_payment_status
             else 'unpaid'::public.booking_payment_status end,
           payment_due_at = null
     where id = _b.id;
    -- Paid event entries linked to this booking are confirmed.
    update public.event_registrations set status = 'confirmed'
     where booking_id = _b.id and status = 'pending' and _left = 0;
    if _b.status = 'confirmed' and _left > 0 then
      perform private.notify(_b.player_id, 'payment_approved', 'Part of your payment received',
        format('₱%s was received for %s. ₱%s is still due: send the rest from your booking.',
               to_char(_counted / 100.0, 'FM999,999,990.00'), _b.reference, to_char(_left / 100.0, 'FM999,999,990.00')),
        '/bookings/' || _b.id);
    else
      perform private.notify(_b.player_id, 'payment_approved', 'Payment approved',
        format('Your payment for %s was verified. See you on court!', _b.reference), '/bookings/' || _b.id);
    end if;
  else
    -- Confirmed: the player can pay again. Cancelled while being checked: nothing
    -- was received, so no refund is owed after all.
    update public.bookings set payment_status = 'unpaid'
     where id = _b.id
       and (status = 'confirmed'
            or (payment_status = 'refund_due'
                and not exists (select 1 from public.payments where booking_id = _b.id and status = 'approved')));
    perform private.notify(_b.player_id, 'payment_rejected', 'Payment not accepted',
      format('Your payment for %s was not accepted. Reason: %s%s', _b.reference, _why,
             case when _b.status = 'confirmed' then ' You can submit a new payment from your booking.' else '' end),
      '/bookings/' || _b.id);
  end if;
end;
$$;


--
-- Name: staff_schedule_match(uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_schedule_match(_match_id uuid, _court_id uuid, _starts_at timestamp with time zone, _ends_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _m public.event_matches;
  _e public.events;
  _court text;
begin
  select * into _m from public.event_matches where id = _match_id for update;
  if not found then
    raise exception 'That match was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_m.event_id);
  if _m.status not in ('scheduled', 'in_progress') then
    raise exception 'This match is already %.', _m.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Match court and time set', true);
  if _court_id is null then
    update public.event_matches set court_id = null, scheduled = null where id = _m.id;
    return;
  end if;
  if _ends_at is null or _ends_at <= _starts_at then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  select name into _court from public.courts where id = _court_id;
  if not exists (select 1 from public.booking_slots s
                 where s.event_id = _e.id and s.court_id = _court_id and s.status not in ('cancelled', 'released')
                   and s.slot @> tstzrange(_starts_at, _ends_at, '[)')) then
    raise exception '% is not reserved for % at that time. Assign the court to the event first.', coalesce(_court, 'That court'), _e.title
      using errcode = '22023';
  end if;
  -- A player cannot be in two matches at once (any division of this event).
  if exists (
    select 1 from public.event_matches o
    join public.event_registrations ro on ro.id in (o.entry_a, o.entry_b)
    join public.event_registrations rm on rm.id in (_m.entry_a, _m.entry_b)
    where o.event_id = _m.event_id and o.id <> _m.id and o.scheduled is not null
      and o.status not in ('cancelled', 'bye')
      and o.scheduled && tstzrange(_starts_at, _ends_at, '[)')
      and (ro.player_id in (rm.player_id, rm.partner_id) or ro.partner_id in (rm.player_id, rm.partner_id))
  ) then
    raise exception 'A player in this match is already playing another match at that time.' using errcode = '23P01';
  end if;
  begin
    update public.event_matches set court_id = _court_id, scheduled = tstzrange(_starts_at, _ends_at, '[)')
     where id = _m.id;
  exception when exclusion_violation then
    raise exception '% already has another match at %.', _court, private.fmt_time(_starts_at) using errcode = '23P01';
  end;
  if _m.entry_a is not null and _m.entry_b is not null then
    perform private.notify(u, 'match_scheduled', 'Match scheduled: ' || _e.title,
      private.entry_label(_m.entry_a) || ' vs ' || private.entry_label(_m.entry_b) || ' · ' || _court || ' at '
        || private.fmt_time(_starts_at),
      '/events/' || _e.slug)
    from (select unnest(array[r.player_id, r.partner_id]) u from public.event_registrations r
          where r.id in (_m.entry_a, _m.entry_b)) x
    where u is not null;
  end if;
end;
$$;


--
-- Name: staff_search_bookings(text, date, date, public.booking_status, public.booking_payment_status, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_search_bookings(_query text DEFAULT NULL::text, _from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _status public.booking_status DEFAULT NULL::public.booking_status, _payment_status public.booking_payment_status DEFAULT NULL::public.booking_payment_status, _limit integer DEFAULT 50) RETURNS TABLE(booking_id uuid, reference text, status public.booking_status, payment_status public.booking_payment_status, total_centavos bigint, player_id uuid, player_name text, player_phone text, first_slot_at timestamp with time zone, operating_date date, slot_count integer, courts text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
begin
  if not private.is_staff() then
    raise exception 'Only club staff can search bookings.' using errcode = '42501';
  end if;
  _pattern := '%' || replace(replace(replace(coalesce(_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with s as (
    select bs.booking_id, min(lower(bs.slot)) as first_at, min(bs.operating_date) as op_date, count(*)::int as n,
           string_agg(distinct c.name, ', ' order by c.name) as courts
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id is not null and bs.status <> 'released'
    group by bs.booking_id
  )
  select b.id, b.reference, b.status, b.payment_status, b.total_centavos, p.id, p.full_name, p.phone,
         s.first_at, s.op_date, coalesce(s.n, 0), s.courts, b.created_at
  from public.bookings b
  join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  where (_q is null or b.reference ilike _pattern or p.full_name ilike _pattern or p.phone ilike _pattern
         or exists (select 1 from public.payments pa where pa.booking_id = b.id and pa.reference_no ilike _pattern))
    and (_from is null or s.op_date >= _from)
    and (_to is null or s.op_date <= _to)
    and (_status is null or b.status = _status)
    and (_payment_status is null or b.payment_status = _payment_status)
    and b.status <> 'cart'
  order by s.first_at desc nulls last, b.created_at desc
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;


--
-- Name: staff_search_payments(text, public.payment_status, date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_search_payments(_query text DEFAULT NULL::text, _status public.payment_status DEFAULT NULL::public.payment_status, _from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _limit integer DEFAULT 100) RETURNS TABLE(payment_id uuid, status public.payment_status, method_kind public.payment_method_kind, method_label text, amount_centavos bigint, declared_centavos bigint, reference_no text, proof_path text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, reviewer_name text, review_note text, booking_id uuid, booking_reference text, booking_status public.booking_status, booking_payment_status public.booking_payment_status, booking_total_centavos bigint, booking_due_centavos bigint, first_slot_at timestamp with time zone, player_name text, player_phone text, is_own boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;
  _pattern := '%' || replace(replace(replace(coalesce(_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.status, p.method_kind, coalesce(m.label, initcap(replace(p.method_kind::text, '_', ' '))),
         p.amount_centavos, p.declared_centavos, p.reference_no, p.proof_path, p.created_at, p.reviewed_at, r.full_name, p.review_note,
         b.id, b.reference, b.status, b.payment_status, b.total_centavos, private.amount_due(b.id),
         (select min(lower(s.slot)) from public.booking_slots s where s.booking_id = b.id and s.status not in ('released', 'cancelled')),
         pl.full_name, pl.phone,
         (b.player_id = auth.uid() or p.submitted_by = auth.uid())
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  join public.profiles pl on pl.id = b.player_id
  left join public.payment_methods m on m.id = p.payment_method_id
  left join public.profiles r on r.id = p.reviewed_by
  where (_status is null or p.status = _status)
    and (_q is null or b.reference ilike _pattern or pl.full_name ilike _pattern or pl.phone ilike _pattern
         or p.reference_no ilike _pattern)
    and (_from is null or private.operating_date_of(p.created_at) >= _from)
    and (_to is null or private.operating_date_of(p.created_at) <= _to)
  order by case when p.status = 'submitted' then p.created_at end asc nulls last, coalesce(p.reviewed_at, p.created_at) desc
  limit least(greatest(coalesce(_limit, 100), 1), 500);
end;
$$;


--
-- Name: staff_set_court_lane(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_set_court_lane(_event_id uuid, _court_id uuid, _division_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.require_event_manager(_event_id);
begin
  if _e.event_type <> 'open_play' then
    raise exception 'Only open play sessions have court levels.' using errcode = '22023';
  end if;
  if _division_id is not null
     and not exists (select 1 from public.event_divisions d where d.id = _division_id and d.event_id = _e.id) then
    raise exception 'That category is not part of this session.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.booking_slots s
                 where s.event_id = _e.id and s.court_id = _court_id and s.status not in ('cancelled', 'released')) then
    raise exception 'That court is not reserved for this session.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Open play court level changed', true);
  if _division_id is null then
    delete from public.event_court_lanes where event_id = _e.id and court_id = _court_id;
  else
    insert into public.event_court_lanes (event_id, court_id, division_id) values (_e.id, _court_id, _division_id)
    on conflict (event_id, court_id) do update set division_id = excluded.division_id;
  end if;
end;
$$;


--
-- Name: staff_set_player_level(uuid, public.player_level, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_set_player_level(_user_id uuid, _level public.player_level, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _why text;
begin
  if not private.has_permission('players.manage') then
    raise exception 'You do not have permission to change player levels.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  perform set_config('app.audit_reason', _why, true);
  update public.profiles set level = _level where id = _user_id;
end;
$$;


--
-- Name: staff_start_game(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_start_game(_game_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _g public.queue_games;
begin
  select * into _g from public.queue_games where id = _game_id for update;
  if not found then
    raise exception 'That game was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_g.event_id);
  if _g.status <> 'called' then
    raise exception 'This game is already %.', _g.status using errcode = '22023';
  end if;
  update public.queue_games set status = 'playing', started_at = now() where id = _g.id;
  update public.queue_entries set status = 'playing', started_at = now() where game_id = _g.id and status = 'called';
end;
$$;


--
-- Name: staff_start_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_start_session(_event_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _e public.events := private.queue_session(_event_id);
  _court uuid;
  _n int := 0;
  _free int := 0;
begin
  perform private.require_event_manager(_event_id);
  for _court in
    select s.court_id from public.booking_slots s
    join public.courts c on c.id = s.court_id
    where s.event_id = _e.id and s.status not in ('cancelled', 'released') and s.slot @> now()
      and not exists (select 1 from public.queue_games g
                      where g.event_id = _e.id and g.court_id = s.court_id and g.status in ('called', 'playing'))
    group by s.court_id, c.sort_order, c.name
    order by c.sort_order, c.name
  loop
    _free := _free + 1;
    begin
      perform public.staff_call_next(_e.id, _court);
      _n := _n + 1;
    exception when sqlstate '22023' then
      -- Not enough players waiting for this court's stack: leave it free.
      null;
    end;
  end loop;
  if _n = 0 then
    raise exception '%', case when _free = 0
      then 'No court is free: every court reserved for now already has a game, or none is reserved for this time.'
      else format('Not enough players are waiting: each game needs %s from the same level.', _e.queue_players_per_game) end
      using errcode = '22023';
  end if;
  return _n;
end;
$$;


--
-- Name: submit_payment(uuid, uuid, text, text, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_payment(_booking_id uuid, _payment_method_id uuid, _proof_path text, _reference_no text DEFAULT NULL::text, _proof_sha256 text DEFAULT NULL::text, _amount_centavos bigint DEFAULT NULL::bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _b public.bookings;
  _m public.payment_methods;
  _due bigint;
  _id uuid;
  _ref text := nullif(btrim(coalesce(_reference_no, '')), '');
begin
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or _b.player_id <> _uid then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be paid.' using errcode = '22023';
  end if;
  if _b.payment_status = 'pending_verification' then
    raise exception 'A payment for this booking is already being checked.' using errcode = '22023';
  end if;
  if _b.payment_status <> 'unpaid' then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  select * into _m from public.payment_methods where id = _payment_method_id and is_active and kind <> 'cash';
  if not found then
    raise exception 'Choose one of the club''s payment methods.' using errcode = '22023';
  end if;

  -- The proof must be a file this player uploaded to this booking's private folder.
  if _proof_path is null or _proof_path not like _uid::text || '/' || _b.id::text || '/%' then
    raise exception 'Upload your proof of payment first.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-proofs' and o.name = _proof_path
      and (o.owner = _uid or o.owner_id = _uid::text)
  ) then
    raise exception 'Your proof of payment was not found. Upload it again.' using errcode = '22023';
  end if;

  _due := private.amount_due(_b.id);
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  -- Full payments only.
  if _amount_centavos is not null and _amount_centavos < _due then
    raise exception 'Send the full amount due (₱%). Part payments are not accepted.', to_char(_due / 100.0, 'FM999,999,990.00')
      using errcode = '22023';
  end if;

  begin
    insert into public.payments (booking_id, payment_method_id, method_kind, amount_centavos, declared_centavos, reference_no,
                                 proof_path, proof_sha256, status, submitted_by)
    values (_b.id, _m.id, _m.kind, _due, _amount_centavos, _ref, _proof_path, lower(nullif(_proof_sha256, '')), 'submitted', _uid)
    returning id into _id;
  exception when unique_violation then
    raise exception 'That reference number or receipt was already used for another payment.' using errcode = '23505';
  end;

  update public.bookings set payment_status = 'pending_verification' where id = _b.id;

  perform private.notify_payment_verifiers(
    'Payment to check: ' || _b.reference,
    format('%s · ₱%s', _m.label, to_char(coalesce(_amount_centavos, _due) / 100.0, 'FM999,999,990.00')),
    '/admin/payments');
  return _id;
end;
$$;


--
-- Name: withdraw_registration(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.withdraw_registration(_registration_id uuid, _reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  _uid uuid := private.require_bookable_player();
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  -- Either member of a team may withdraw it.
  if not found or _uid not in (_r.player_id, coalesce(_r.partner_id, _r.player_id)) then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  if _r.status not in ('pending', 'confirmed', 'waitlisted') then
    raise exception 'This registration is already %.', _r.status using errcode = '22023';
  end if;
  select * into _e from public.events where id = _r.event_id;
  if now() >= _e.starts_at then
    raise exception 'The event has started. Ask the club to withdraw you.' using errcode = '22023';
  end if;
  perform private.cancel_registration(_r, _uid,
    coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Withdrawn by player'));
  if _r.partner_id is not null then
    perform private.notify(case when _uid = _r.player_id then _r.partner_id else _r.player_id end,
      'registration_cancelled', 'Entry withdrawn: ' || _e.title,
      private.public_name(_uid) || ' withdrew your team''s entry.', '/my/events');
  end if;
end;
$$;


--
-- Name: booking_reference_seq; Type: SEQUENCE; Schema: private; Owner: -
--

CREATE SEQUENCE private.booking_reference_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_codes; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.event_codes (
    event_id uuid NOT NULL,
    checkin_code text DEFAULT substr(md5((gen_random_uuid())::text), 1, 10) NOT NULL,
    board_code text DEFAULT substr(md5((gen_random_uuid())::text), 1, 16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    table_name text NOT NULL,
    record_id text,
    old_data jsonb,
    new_data jsonb,
    reason text,
    CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    event_id uuid,
    court_id uuid NOT NULL,
    slot tstzrange NOT NULL,
    operating_date date NOT NULL,
    kind public.slot_kind NOT NULL,
    status public.slot_status DEFAULT 'held'::public.slot_status NOT NULL,
    price_centavos bigint DEFAULT 0 NOT NULL,
    price_breakdown jsonb,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_slots_check CHECK (((kind <> 'rental'::public.slot_kind) OR (((upper(slot) - lower(slot)) = '01:00:00'::interval) AND (((EXTRACT(epoch FROM lower(slot)))::bigint % (3600)::bigint) = 0)))),
    CONSTRAINT booking_slots_check1 CHECK (((kind <> 'rental'::public.slot_kind) OR (booking_id IS NOT NULL))),
    CONSTRAINT booking_slots_check2 CHECK (((kind <> ALL (ARRAY['block'::public.slot_kind, 'maintenance'::public.slot_kind])) OR (booking_id IS NULL))),
    CONSTRAINT booking_slots_check3 CHECK (((kind <> 'event'::public.slot_kind) OR (event_id IS NOT NULL))),
    CONSTRAINT booking_slots_note_check CHECK (((note IS NULL) OR (char_length(note) <= 300))),
    CONSTRAINT booking_slots_price_centavos_check CHECK ((price_centavos >= 0)),
    CONSTRAINT booking_slots_slot_check CHECK (((NOT isempty(slot)) AND lower_inc(slot) AND (NOT upper_inc(slot)) AND (lower(slot) IS NOT NULL) AND (upper(slot) IS NOT NULL)))
);


--
-- Name: check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_id uuid NOT NULL,
    event_id uuid,
    registration_id uuid,
    booking_id uuid,
    checked_in_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_in_by uuid,
    kind text NOT NULL,
    CONSTRAINT check_ins_kind_check CHECK ((kind = ANY (ARRAY['event'::text, 'court_rental'::text])))
);


--
-- Name: courts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number smallint NOT NULL,
    name text NOT NULL,
    environment public.court_environment DEFAULT 'indoor'::public.court_environment NOT NULL,
    surface text,
    status public.court_status DEFAULT 'active'::public.court_status NOT NULL,
    photo_path text,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT courts_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
    CONSTRAINT courts_number_check CHECK ((number > 0))
);


--
-- Name: event_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    level_key text,
    CONSTRAINT event_categories_level_key_check CHECK ((level_key ~ '^[a-z][a-z0-9_]{0,62}$'::text)),
    CONSTRAINT event_categories_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 60))),
    CONSTRAINT event_categories_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: COLUMN event_categories.level_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_categories.level_key IS 'The public.player_level value this category stands for. Set when the category is created; never changes.';


--
-- Name: event_court_lanes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_court_lanes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    court_id uuid NOT NULL,
    division_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event_divisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_divisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    team_size smallint DEFAULT 1 NOT NULL,
    skill_min public.player_level,
    skill_max public.player_level,
    capacity integer,
    fee_centavos bigint,
    format text DEFAULT 'round_robin'::text NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    queue_rotation text,
    CONSTRAINT event_divisions_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0))),
    CONSTRAINT event_divisions_check CHECK (((skill_min IS NULL) OR (skill_max IS NULL) OR (skill_min <= skill_max))),
    CONSTRAINT event_divisions_fee_centavos_check CHECK (((fee_centavos IS NULL) OR (fee_centavos >= 0))),
    CONSTRAINT event_divisions_format_check CHECK ((format = ANY (ARRAY['round_robin'::text, 'single_elimination'::text, 'none'::text]))),
    CONSTRAINT event_divisions_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 80))),
    CONSTRAINT event_divisions_queue_rotation_check CHECK ((queue_rotation = ANY (ARRAY['all_off'::text, 'winners_stay'::text, 'winners_split'::text]))),
    CONSTRAINT event_divisions_team_size_check CHECK ((team_size = ANY (ARRAY[1, 2])))
);


--
-- Name: COLUMN event_divisions.capacity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_divisions.capacity IS 'Most entries (teams, or players in singles). NULL: no limit.';


--
-- Name: COLUMN event_divisions.fee_centavos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_divisions.fee_centavos IS 'NULL: use the event fee.';


--
-- Name: COLUMN event_divisions.queue_rotation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_divisions.queue_rotation IS 'Open play: what happens after a game in this stack. NULL: the session rule.';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_body_check CHECK (((body IS NULL) OR (char_length(body) <= 500))),
    CONSTRAINT notifications_kind_check CHECK ((kind = ANY (ARRAY['payment_submitted'::text, 'payment_approved'::text, 'payment_rejected'::text, 'booking_cancelled'::text, 'refund_recorded'::text, 'registration_confirmed'::text, 'registration_pending_payment'::text, 'registration_cancelled'::text, 'partner_added'::text, 'event_cancelled'::text, 'queue_called'::text, 'match_scheduled'::text, 'staff_activity'::text, 'payment_reminder'::text, 'queue_soon'::text]))),
    CONSTRAINT notifications_link_check CHECK (((link IS NULL) OR (link ~ '^/'::text))),
    CONSTRAINT notifications_title_check CHECK ((char_length(title) <= 120))
);


--
-- Name: operating_hour_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_hour_exceptions (
    date date NOT NULL,
    is_closed boolean DEFAULT true NOT NULL,
    opens_at time without time zone,
    closes_at time without time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operating_hour_exceptions_check CHECK ((is_closed OR ((opens_at IS NOT NULL) AND (closes_at IS NOT NULL) AND (opens_at <> closes_at) AND (EXTRACT(minute FROM opens_at) = (0)::numeric) AND (EXTRACT(minute FROM closes_at) = (0)::numeric)))),
    CONSTRAINT operating_hour_exceptions_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);


--
-- Name: operating_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_hours (
    weekday smallint NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    opens_at time without time zone,
    closes_at time without time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operating_hours_check CHECK ((is_closed OR ((opens_at IS NOT NULL) AND (closes_at IS NOT NULL) AND (opens_at <> closes_at)))),
    CONSTRAINT operating_hours_on_the_hour CHECK ((is_closed OR ((EXTRACT(minute FROM opens_at) = (0)::numeric) AND (EXTRACT(second FROM opens_at) = (0)::numeric) AND (EXTRACT(minute FROM closes_at) = (0)::numeric) AND (EXTRACT(second FROM closes_at) = (0)::numeric)))),
    CONSTRAINT operating_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.payment_method_kind NOT NULL,
    label text NOT NULL,
    account_name text,
    account_number text,
    bank_name text,
    qr_image_path text,
    instructions text,
    is_active boolean DEFAULT false NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_methods_check CHECK (((kind = 'cash'::public.payment_method_kind) OR (NOT is_active) OR ((account_name IS NOT NULL) AND (account_number IS NOT NULL)))),
    CONSTRAINT payment_methods_check1 CHECK (((kind <> 'bank_transfer'::public.payment_method_kind) OR (NOT is_active) OR (bank_name IS NOT NULL))),
    CONSTRAINT payment_methods_label_check CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 60)))
);


--
-- Name: TABLE payment_methods; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_methods IS 'The club''s receiving accounts. Not public: staff read them directly; players see them only through get_payment_instructions.';


--
-- Name: COLUMN payment_methods.qr_image_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_methods.qr_image_path IS 'Path of the QR code image in the private payment-qr bucket (shown to signed-in players with a booking to pay).';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    payment_method_id uuid,
    method_kind public.payment_method_kind NOT NULL,
    amount_centavos bigint NOT NULL,
    reference_no text,
    proof_path text,
    proof_sha256 text,
    status public.payment_status DEFAULT 'submitted'::public.payment_status NOT NULL,
    submitted_by uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    declared_centavos bigint,
    CONSTRAINT payments_amount_centavos_check CHECK ((amount_centavos > 0)),
    CONSTRAINT payments_check1 CHECK (((status = 'submitted'::public.payment_status) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT payments_declared_centavos_check CHECK (((declared_centavos IS NULL) OR (declared_centavos > 0))),
    CONSTRAINT payments_online_needs_proof CHECK (((method_kind = 'cash'::public.payment_method_kind) OR (proof_path IS NOT NULL))),
    CONSTRAINT payments_proof_path_check CHECK (((proof_path IS NULL) OR (proof_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'::text))),
    CONSTRAINT payments_proof_sha256_check CHECK (((proof_sha256 IS NULL) OR (proof_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT payments_reference_no_check CHECK (((reference_no IS NULL) OR ((char_length(btrim(reference_no)) >= 4) AND (char_length(btrim(reference_no)) <= 64)))),
    CONSTRAINT payments_review_note_check CHECK (((review_note IS NULL) OR (char_length(review_note) <= 500)))
);


--
-- Name: COLUMN payments.declared_centavos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.declared_centavos IS 'What the player said they sent. amount_centavos is what the club counts (set by staff from the receipt when approving).';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    display_name text,
    phone text,
    self_rated_level public.player_level,
    level public.player_level,
    leaderboard_opt_out boolean DEFAULT false NOT NULL,
    status public.account_status DEFAULT 'active'::public.account_status NOT NULL,
    privacy_consent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_display_name_check CHECK (((display_name IS NULL) OR ((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 40)))),
    CONSTRAINT profiles_full_name_check CHECK (((char_length(btrim(full_name)) >= 2) AND (char_length(btrim(full_name)) <= 80))),
    CONSTRAINT profiles_phone_check CHECK (((phone IS NULL) OR (phone ~ '^09[0-9]{9}$'::text)))
);


--
-- Name: queue_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    player_id uuid,
    registration_id uuid,
    status text DEFAULT 'waiting'::text NOT NULL,
    queued_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    game_id uuid,
    court_id uuid,
    team text,
    stay_court_id uuid,
    consecutive_games smallint DEFAULT 0 NOT NULL,
    outcome text,
    called_at timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    on_deck_notified_at timestamp with time zone,
    division_id uuid,
    CONSTRAINT queue_entries_check CHECK (((status <> ALL (ARRAY['called'::text, 'playing'::text])) OR ((game_id IS NOT NULL) AND (court_id IS NOT NULL) AND (team IS NOT NULL)))),
    CONSTRAINT queue_entries_outcome_check CHECK ((outcome = ANY (ARRAY['won'::text, 'lost'::text]))),
    CONSTRAINT queue_entries_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'called'::text, 'playing'::text, 'completed'::text, 'no_show'::text, 'left'::text, 'removed'::text]))),
    CONSTRAINT queue_entries_team_check CHECK ((team = ANY (ARRAY['a'::text, 'b'::text]))),
    CONSTRAINT queue_entries_who CHECK (((player_id IS NOT NULL) OR (registration_id IS NOT NULL)))
);


--
-- Name: queue_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    court_id uuid NOT NULL,
    status text DEFAULT 'called'::text NOT NULL,
    winning_team text,
    called_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    called_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    division_id uuid,
    CONSTRAINT queue_games_status_check CHECK ((status = ANY (ARRAY['called'::text, 'playing'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT queue_games_winning_team_check CHECK ((winning_team = ANY (ARRAY['a'::text, 'b'::text])))
);


--
-- Name: rate_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product public.rate_product NOT NULL,
    label text NOT NULL,
    court_id uuid,
    weekdays smallint[] DEFAULT '{0,1,2,3,4,5,6}'::smallint[] NOT NULL,
    starts_at time without time zone NOT NULL,
    ends_at time without time zone NOT NULL,
    price_centavos bigint NOT NULL,
    unit text,
    is_active boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tier text DEFAULT 'standard'::text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    CONSTRAINT rate_rules_check CHECK ((ends_at <> starts_at)),
    CONSTRAINT rate_rules_check1 CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT rate_rules_label_check CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 60))),
    CONSTRAINT rate_rules_price_centavos_check CHECK ((price_centavos >= 0)),
    CONSTRAINT rate_rules_priority_check CHECK (((priority >= '-100'::integer) AND (priority <= 100))),
    CONSTRAINT rate_rules_tier_check CHECK ((tier = ANY (ARRAY['peak'::text, 'off_peak'::text, 'standard'::text]))),
    CONSTRAINT rate_rules_unit_check CHECK ((unit = ANY (ARRAY['per_court_hour'::text, 'per_player'::text]))),
    CONSTRAINT rate_rules_weekdays_check CHECK (((weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]) AND (cardinality(weekdays) > 0)))
);


--
-- Name: sale_reference_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sale_reference_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schedule_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_signals (
    operating_date date NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_permissions (
    user_id uuid NOT NULL,
    permission public.app_permission NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venue_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_settings (
    id boolean DEFAULT true NOT NULL,
    name text NOT NULL,
    tagline text,
    street_address text,
    city text NOT NULL,
    province text NOT NULL,
    map_url text,
    phone text,
    email text,
    facebook_url text,
    instagram_url text,
    time_zone text DEFAULT 'Asia/Manila'::text NOT NULL,
    booking_window_days integer DEFAULT 30 NOT NULL,
    hold_minutes integer DEFAULT 15 NOT NULL,
    verify_window_hours integer DEFAULT 12 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    operating_day_cutoff time without time zone DEFAULT '04:00:00'::time without time zone NOT NULL,
    max_slots_per_booking integer DEFAULT 8 NOT NULL,
    player_cancel_cutoff_hours integer,
    payment_due_hours integer,
    same_day_payment_minutes integer,
    payment_due_minutes integer,
    CONSTRAINT venue_settings_booking_window_days_check CHECK (((booking_window_days >= 1) AND (booking_window_days <= 365))),
    CONSTRAINT venue_settings_email_check CHECK (((email IS NULL) OR (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))),
    CONSTRAINT venue_settings_facebook_url_check CHECK (((facebook_url IS NULL) OR (facebook_url ~ '^https://'::text))),
    CONSTRAINT venue_settings_hold_minutes_check CHECK (((hold_minutes >= 5) AND (hold_minutes <= 120))),
    CONSTRAINT venue_settings_id_check CHECK (id),
    CONSTRAINT venue_settings_instagram_url_check CHECK (((instagram_url IS NULL) OR (instagram_url ~ '^https://'::text))),
    CONSTRAINT venue_settings_map_url_check CHECK (((map_url IS NULL) OR (map_url ~ '^https://'::text))),
    CONSTRAINT venue_settings_max_slots_per_booking_check CHECK (((max_slots_per_booking >= 1) AND (max_slots_per_booking <= 48))),
    CONSTRAINT venue_settings_payment_due_hours_check CHECK (((payment_due_hours IS NULL) OR ((payment_due_hours >= 1) AND (payment_due_hours <= 720)))),
    CONSTRAINT venue_settings_payment_due_minutes_check CHECK (((payment_due_minutes IS NULL) OR ((payment_due_minutes >= 10) AND (payment_due_minutes <= 1440)))),
    CONSTRAINT venue_settings_player_cancel_cutoff_hours_check CHECK (((player_cancel_cutoff_hours IS NULL) OR ((player_cancel_cutoff_hours >= 0) AND (player_cancel_cutoff_hours <= 720)))),
    CONSTRAINT venue_settings_same_day_payment_minutes_check CHECK (((same_day_payment_minutes IS NULL) OR ((same_day_payment_minutes >= 10) AND (same_day_payment_minutes <= 240)))),
    CONSTRAINT venue_settings_verify_window_hours_check CHECK (((verify_window_hours >= 1) AND (verify_window_hours <= 72)))
);


--
-- Name: COLUMN venue_settings.hold_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_settings.hold_minutes IS 'How long selected times are held in a cart before they are released.';


--
-- Name: COLUMN venue_settings.operating_day_cutoff; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_settings.operating_day_cutoff IS 'Slots starting before this local time belong to the previous operating day (e.g. a 12:30 AM slot on Saturday files under Friday).';


--
-- Name: COLUMN venue_settings.player_cancel_cutoff_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_settings.player_cancel_cutoff_hours IS 'Players may cancel a confirmed booking up to this many hours before its first slot. NULL: only staff can cancel confirmed bookings.';


--
-- Name: COLUMN venue_settings.payment_due_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_settings.payment_due_hours IS 'Confirmed bookings with no payment submitted within this many hours (or by their first slot, if sooner) are cancelled automatically. NULL: never cancelled for non-payment.';


--
-- Name: COLUMN venue_settings.same_day_payment_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_settings.same_day_payment_minutes IS 'With a payment deadline set: bookings that play on the same day they are made must be paid within this many minutes instead (never later than their first slot). NULL: same-day bookings use payment_due_hours.';


--
-- Name: COLUMN venue_settings.payment_due_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_settings.payment_due_minutes IS 'Court bookings: minutes a player has after reserving to send payment and upload the receipt, or the courts are released. NULL: use payment_due_hours.';


--
-- Name: event_codes event_codes_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.event_codes
    ADD CONSTRAINT event_codes_pkey PRIMARY KEY (event_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: booking_slots booking_slots_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_slots
    ADD CONSTRAINT booking_slots_no_overlap EXCLUDE USING gist (court_id WITH =, slot WITH &&) WHERE ((status <> ALL (ARRAY['released'::public.slot_status, 'cancelled'::public.slot_status])));


--
-- Name: booking_slots booking_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_slots
    ADD CONSTRAINT booking_slots_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_reference_key UNIQUE (reference);


--
-- Name: check_ins check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_pkey PRIMARY KEY (id);


--
-- Name: courts courts_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courts
    ADD CONSTRAINT courts_name_key UNIQUE (name);


--
-- Name: courts courts_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courts
    ADD CONSTRAINT courts_number_key UNIQUE (number);


--
-- Name: courts courts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courts
    ADD CONSTRAINT courts_pkey PRIMARY KEY (id);


--
-- Name: event_categories event_categories_level_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT event_categories_level_key_key UNIQUE (level_key);


--
-- Name: event_categories event_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT event_categories_name_key UNIQUE (name);


--
-- Name: event_categories event_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT event_categories_pkey PRIMARY KEY (id);


--
-- Name: event_categories event_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT event_categories_slug_key UNIQUE (slug);


--
-- Name: event_court_lanes event_court_lanes_event_id_court_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_court_lanes
    ADD CONSTRAINT event_court_lanes_event_id_court_id_key UNIQUE (event_id, court_id);


--
-- Name: event_court_lanes event_court_lanes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_court_lanes
    ADD CONSTRAINT event_court_lanes_pkey PRIMARY KEY (id);


--
-- Name: event_divisions event_divisions_event_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_divisions
    ADD CONSTRAINT event_divisions_event_id_name_key UNIQUE (event_id, name);


--
-- Name: event_divisions event_divisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_divisions
    ADD CONSTRAINT event_divisions_pkey PRIMARY KEY (id);


--
-- Name: event_matches event_matches_division_id_stage_round_match_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_division_id_stage_round_match_no_key UNIQUE (division_id, stage, round, match_no);


--
-- Name: event_matches event_matches_no_court_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_no_court_overlap EXCLUDE USING gist (court_id WITH =, scheduled WITH &&) WHERE (((court_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'bye'::text]))));


--
-- Name: event_matches event_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_pkey PRIMARY KEY (id);


--
-- Name: event_registrations event_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: events events_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_slug_key UNIQUE (slug);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: operating_hour_exceptions operating_hour_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_hour_exceptions
    ADD CONSTRAINT operating_hour_exceptions_pkey PRIMARY KEY (date);


--
-- Name: operating_hours operating_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_hours
    ADD CONSTRAINT operating_hours_pkey PRIMARY KEY (weekday);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: queue_entries queue_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_pkey PRIMARY KEY (id);


--
-- Name: queue_games queue_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_games
    ADD CONSTRAINT queue_games_pkey PRIMARY KEY (id);


--
-- Name: rate_rules rate_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT rate_rules_pkey PRIMARY KEY (id);


--
-- Name: schedule_signals schedule_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_signals
    ADD CONSTRAINT schedule_signals_pkey PRIMARY KEY (operating_date);


--
-- Name: staff_permissions staff_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_pkey PRIMARY KEY (user_id, permission);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);


--
-- Name: venue_settings venue_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_settings
    ADD CONSTRAINT venue_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_log_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_id);


--
-- Name: audit_log_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_occurred_at_idx ON public.audit_log USING btree (occurred_at DESC);


--
-- Name: audit_log_table_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_table_record_idx ON public.audit_log USING btree (table_name, record_id);


--
-- Name: booking_slots_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_slots_booking_idx ON public.booking_slots USING btree (booking_id);


--
-- Name: booking_slots_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_slots_created_by_idx ON public.booking_slots USING btree (created_by);


--
-- Name: booking_slots_day_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_slots_day_court_idx ON public.booking_slots USING btree (operating_date, court_id);


--
-- Name: booking_slots_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_slots_event_idx ON public.booking_slots USING btree (event_id);


--
-- Name: bookings_cancelled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_cancelled_by_idx ON public.bookings USING btree (cancelled_by);


--
-- Name: bookings_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_created_by_idx ON public.bookings USING btree (created_by);


--
-- Name: bookings_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_event_idx ON public.bookings USING btree (event_id) WHERE (event_id IS NOT NULL);


--
-- Name: bookings_hold_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_hold_expires_idx ON public.bookings USING btree (hold_expires_at) WHERE (status = 'held'::public.booking_status);


--
-- Name: bookings_player_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_player_created_idx ON public.bookings USING btree (player_id, created_at DESC);


--
-- Name: bookings_player_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_player_status_idx ON public.bookings USING btree (player_id, status);


--
-- Name: bookings_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_status_idx ON public.bookings USING btree (status);


--
-- Name: check_ins_checked_in_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_ins_checked_in_by_idx ON public.check_ins USING btree (checked_in_by);


--
-- Name: check_ins_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_ins_event_idx ON public.check_ins USING btree (event_id);


--
-- Name: check_ins_one_per_booking_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX check_ins_one_per_booking_day ON public.check_ins USING btree (booking_id, player_id, (((checked_in_at AT TIME ZONE 'Asia/Manila'::text))::date)) WHERE (booking_id IS NOT NULL);


--
-- Name: check_ins_one_per_registration; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX check_ins_one_per_registration ON public.check_ins USING btree (registration_id, player_id) WHERE (registration_id IS NOT NULL);


--
-- Name: check_ins_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX check_ins_player_idx ON public.check_ins USING btree (player_id, checked_in_at DESC);


--
-- Name: event_court_lanes_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_court_lanes_court_idx ON public.event_court_lanes USING btree (court_id);


--
-- Name: event_court_lanes_division_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_court_lanes_division_idx ON public.event_court_lanes USING btree (division_id);


--
-- Name: event_divisions_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_divisions_category_idx ON public.event_divisions USING btree (category_id);


--
-- Name: event_divisions_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_divisions_event_idx ON public.event_divisions USING btree (event_id, sort_order);


--
-- Name: event_matches_entry_a_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_matches_entry_a_idx ON public.event_matches USING btree (entry_a);


--
-- Name: event_matches_entry_b_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_matches_entry_b_idx ON public.event_matches USING btree (entry_b);


--
-- Name: event_matches_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_matches_event_idx ON public.event_matches USING btree (event_id, division_id, stage, round, match_no);


--
-- Name: event_matches_next_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_matches_next_match_idx ON public.event_matches USING btree (next_match_id);


--
-- Name: event_matches_recorded_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_matches_recorded_by_idx ON public.event_matches USING btree (recorded_by);


--
-- Name: event_matches_winner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_matches_winner_idx ON public.event_matches USING btree (winner);


--
-- Name: event_registrations_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_booking_idx ON public.event_registrations USING btree (booking_id);


--
-- Name: event_registrations_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_category_idx ON public.event_registrations USING btree (category_id);


--
-- Name: event_registrations_checked_in_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_checked_in_by_idx ON public.event_registrations USING btree (checked_in_by);


--
-- Name: event_registrations_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_created_by_idx ON public.event_registrations USING btree (created_by);


--
-- Name: event_registrations_division_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_division_idx ON public.event_registrations USING btree (division_id);


--
-- Name: event_registrations_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_event_idx ON public.event_registrations USING btree (event_id, status);


--
-- Name: event_registrations_one_active_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_registrations_one_active_partner ON public.event_registrations USING btree (event_id, COALESCE(division_id, '00000000-0000-0000-0000-000000000000'::uuid), partner_id) WHERE ((partner_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::public.registration_status, 'confirmed'::public.registration_status, 'waitlisted'::public.registration_status])));


--
-- Name: event_registrations_one_active_player; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_registrations_one_active_player ON public.event_registrations USING btree (event_id, COALESCE(division_id, '00000000-0000-0000-0000-000000000000'::uuid), player_id) WHERE (status = ANY (ARRAY['pending'::public.registration_status, 'confirmed'::public.registration_status, 'waitlisted'::public.registration_status]));


--
-- Name: event_registrations_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_partner_idx ON public.event_registrations USING btree (partner_id);


--
-- Name: event_registrations_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_registrations_player_idx ON public.event_registrations USING btree (player_id);


--
-- Name: events_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_category_idx ON public.events USING btree (category_id);


--
-- Name: events_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_created_by_idx ON public.events USING btree (created_by);


--
-- Name: events_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_starts_at_idx ON public.events USING btree (starts_at);


--
-- Name: events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_status_idx ON public.events USING btree (status);


--
-- Name: notifications_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: payments_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_booking_idx ON public.payments USING btree (booking_id);


--
-- Name: payments_one_pending_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_one_pending_per_booking ON public.payments USING btree (booking_id) WHERE (status = 'submitted'::public.payment_status);


--
-- Name: payments_payment_method_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_payment_method_idx ON public.payments USING btree (payment_method_id);


--
-- Name: payments_proof_hash_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_proof_hash_unique ON public.payments USING btree (proof_sha256) WHERE ((proof_sha256 IS NOT NULL) AND (status <> 'rejected'::public.payment_status));


--
-- Name: payments_reference_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_reference_unique ON public.payments USING btree (method_kind, lower(btrim(reference_no))) WHERE ((reference_no IS NOT NULL) AND (status <> 'rejected'::public.payment_status));


--
-- Name: payments_reviewed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_reviewed_by_idx ON public.payments USING btree (reviewed_by);


--
-- Name: payments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_status_idx ON public.payments USING btree (status, created_at);


--
-- Name: payments_submitted_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_submitted_by_idx ON public.payments USING btree (submitted_by);


--
-- Name: profiles_full_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_full_name_idx ON public.profiles USING btree (lower(full_name));


--
-- Name: queue_entries_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_court_idx ON public.queue_entries USING btree (court_id);


--
-- Name: queue_entries_division_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_division_idx ON public.queue_entries USING btree (division_id);


--
-- Name: queue_entries_game_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_game_idx ON public.queue_entries USING btree (game_id);


--
-- Name: queue_entries_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX queue_entries_one_active ON public.queue_entries USING btree (event_id, player_id) WHERE (status = ANY (ARRAY['waiting'::text, 'called'::text, 'playing'::text]));


--
-- Name: queue_entries_one_active_walk_in; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX queue_entries_one_active_walk_in ON public.queue_entries USING btree (event_id, registration_id) WHERE ((player_id IS NULL) AND (status = ANY (ARRAY['waiting'::text, 'called'::text, 'playing'::text])));


--
-- Name: queue_entries_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_player_idx ON public.queue_entries USING btree (player_id);


--
-- Name: queue_entries_registration_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_registration_idx ON public.queue_entries USING btree (registration_id);


--
-- Name: queue_entries_stack_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_stack_idx ON public.queue_entries USING btree (event_id, division_id, queued_at) WHERE (status = 'waiting'::text);


--
-- Name: queue_entries_stay_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_stay_court_idx ON public.queue_entries USING btree (stay_court_id);


--
-- Name: queue_entries_waiting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_waiting_idx ON public.queue_entries USING btree (event_id, queued_at) WHERE (status = 'waiting'::text);


--
-- Name: queue_games_called_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_games_called_by_idx ON public.queue_games USING btree (called_by);


--
-- Name: queue_games_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_games_court_idx ON public.queue_games USING btree (court_id);


--
-- Name: queue_games_division_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_games_division_idx ON public.queue_games USING btree (division_id);


--
-- Name: queue_games_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_games_event_idx ON public.queue_games USING btree (event_id, status);


--
-- Name: queue_games_one_active_per_court; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX queue_games_one_active_per_court ON public.queue_games USING btree (event_id, court_id) WHERE (status = ANY (ARRAY['called'::text, 'playing'::text]));


--
-- Name: rate_rules_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_rules_active_idx ON public.rate_rules USING btree (product, is_active);


--
-- Name: rate_rules_court_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_rules_court_idx ON public.rate_rules USING btree (court_id);


--
-- Name: staff_permissions_granted_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_permissions_granted_by_idx ON public.staff_permissions USING btree (granted_by);


--
-- Name: user_roles_granted_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_granted_by_idx ON public.user_roles USING btree (granted_by);


--
-- Name: user_roles_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_role_idx ON public.user_roles USING btree (role);


--
-- Name: audit_log audit_log_notify_staff; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_notify_staff AFTER INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION private.audit_to_staff_notification();


--
-- Name: booking_slots booking_slots_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_slots_audit AFTER INSERT OR DELETE OR UPDATE ON public.booking_slots FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: booking_slots booking_slots_set_operating_date; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_slots_set_operating_date BEFORE INSERT OR UPDATE OF slot ON public.booking_slots FOR EACH ROW EXECUTE FUNCTION private.set_operating_date();


--
-- Name: booking_slots booking_slots_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_slots_set_updated_at BEFORE UPDATE ON public.booking_slots FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: booking_slots booking_slots_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_slots_signal AFTER INSERT OR DELETE OR UPDATE ON public.booking_slots FOR EACH ROW EXECUTE FUNCTION private.signal_slot_change();


--
-- Name: bookings bookings_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_audit AFTER INSERT OR DELETE OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: bookings bookings_cancel_registrations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_cancel_registrations AFTER UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.cancel_registrations_for_booking();


--
-- Name: bookings bookings_confirm_registrations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_confirm_registrations AFTER UPDATE OF payment_status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.confirm_registrations_for_booking();


--
-- Name: bookings bookings_extend_payment_due; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_extend_payment_due BEFORE UPDATE OF payment_status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.extend_payment_due_after_rejection();


--
-- Name: bookings bookings_set_payment_due; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_set_payment_due BEFORE UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.set_payment_due();


--
-- Name: bookings bookings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: bookings bookings_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_signal AFTER UPDATE OF payment_status, display_name ON public.bookings FOR EACH ROW WHEN (((old.payment_status IS DISTINCT FROM new.payment_status) OR (old.display_name IS DISTINCT FROM new.display_name))) EXECUTE FUNCTION private.signal_booking_change();


--
-- Name: check_ins check_ins_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_ins_audit AFTER INSERT OR DELETE OR UPDATE ON public.check_ins FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: courts courts_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courts_audit AFTER INSERT OR DELETE OR UPDATE ON public.courts FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: courts courts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courts_set_updated_at BEFORE UPDATE ON public.courts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: courts courts_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courts_signal AFTER INSERT OR DELETE OR UPDATE ON public.courts FOR EACH STATEMENT EXECUTE FUNCTION private.signal_config_change();


--
-- Name: event_categories event_categories_level; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_categories_level BEFORE INSERT OR UPDATE ON public.event_categories FOR EACH ROW EXECUTE FUNCTION private.category_level();


--
-- Name: event_categories event_categories_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_categories_set_updated_at BEFORE UPDATE ON public.event_categories FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: event_court_lanes event_court_lanes_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_court_lanes_audit AFTER INSERT OR DELETE OR UPDATE ON public.event_court_lanes FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: event_court_lanes event_court_lanes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_court_lanes_set_updated_at BEFORE UPDATE ON public.event_court_lanes FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: event_divisions event_divisions_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_divisions_audit AFTER INSERT OR DELETE OR UPDATE ON public.event_divisions FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: event_divisions event_divisions_capacity_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_divisions_capacity_check BEFORE UPDATE OF capacity ON public.event_divisions FOR EACH ROW EXECUTE FUNCTION private.check_capacity_change();


--
-- Name: event_divisions event_divisions_open_play_individual; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_divisions_open_play_individual BEFORE INSERT OR UPDATE ON public.event_divisions FOR EACH ROW EXECUTE FUNCTION private.open_play_division_individual();


--
-- Name: event_divisions event_divisions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_divisions_set_updated_at BEFORE UPDATE ON public.event_divisions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: event_matches event_matches_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_matches_audit AFTER INSERT OR DELETE OR UPDATE ON public.event_matches FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: event_matches event_matches_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_matches_set_updated_at BEFORE UPDATE ON public.event_matches FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: event_matches event_matches_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_matches_signal AFTER INSERT OR DELETE OR UPDATE ON public.event_matches FOR EACH STATEMENT EXECUTE FUNCTION private.signal_today();


--
-- Name: event_registrations event_registrations_a_open_play_individual; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_registrations_a_open_play_individual BEFORE INSERT OR UPDATE OF partner_id ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION private.open_play_registration_individual();


--
-- Name: event_registrations event_registrations_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_registrations_audit AFTER INSERT OR DELETE OR UPDATE ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: event_registrations event_registrations_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_registrations_check BEFORE INSERT OR UPDATE OF status, division_id, player_id, partner_id ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION private.check_registration();


--
-- Name: event_registrations event_registrations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_registrations_set_updated_at BEFORE UPDATE ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: events events_add_codes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_add_codes AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION private.add_event_codes();


--
-- Name: events events_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_audit AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: events events_capacity_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_capacity_check BEFORE UPDATE OF capacity ON public.events FOR EACH ROW EXECUTE FUNCTION private.check_capacity_change();


--
-- Name: events events_close_queue; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_close_queue AFTER UPDATE OF status ON public.events FOR EACH ROW EXECUTE FUNCTION private.close_event_queue();


--
-- Name: events events_on_cancelled; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_on_cancelled AFTER UPDATE OF status ON public.events FOR EACH ROW EXECUTE FUNCTION private.on_event_cancelled();


--
-- Name: events events_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: operating_hour_exceptions operating_hour_exceptions_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_hour_exceptions_audit AFTER INSERT OR DELETE OR UPDATE ON public.operating_hour_exceptions FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: operating_hour_exceptions operating_hour_exceptions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_hour_exceptions_set_updated_at BEFORE UPDATE ON public.operating_hour_exceptions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: operating_hour_exceptions operating_hour_exceptions_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_hour_exceptions_signal AFTER INSERT OR DELETE OR UPDATE ON public.operating_hour_exceptions FOR EACH STATEMENT EXECUTE FUNCTION private.signal_config_change();


--
-- Name: operating_hours operating_hours_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_hours_audit AFTER INSERT OR DELETE OR UPDATE ON public.operating_hours FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: operating_hours operating_hours_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_hours_set_updated_at BEFORE UPDATE ON public.operating_hours FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: operating_hours operating_hours_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_hours_signal AFTER INSERT OR DELETE OR UPDATE ON public.operating_hours FOR EACH STATEMENT EXECUTE FUNCTION private.signal_config_change();


--
-- Name: payment_methods payment_methods_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_methods_audit AFTER INSERT OR DELETE OR UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: payment_methods payment_methods_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_methods_set_updated_at BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: payments payments_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_audit AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: payments payments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: profiles profiles_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_audit AFTER DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: profiles profiles_auto_confirm_level; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_auto_confirm_level BEFORE INSERT OR UPDATE OF self_rated_level ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.auto_confirm_level();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: queue_entries queue_entries_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_audit AFTER INSERT OR DELETE OR UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: queue_entries queue_entries_division; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_division BEFORE INSERT OR UPDATE OF registration_id ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION private.queue_entry_division();


--
-- Name: queue_entries queue_entries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_set_updated_at BEFORE UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: queue_games queue_games_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_games_audit AFTER INSERT OR DELETE OR UPDATE ON public.queue_games FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: queue_games queue_games_on_deck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_games_on_deck AFTER UPDATE OF status ON public.queue_games FOR EACH ROW EXECUTE FUNCTION private.queue_games_on_deck();


--
-- Name: queue_games queue_games_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_games_set_updated_at BEFORE UPDATE ON public.queue_games FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: queue_games queue_games_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_games_signal AFTER INSERT OR DELETE OR UPDATE ON public.queue_games FOR EACH STATEMENT EXECUTE FUNCTION private.signal_today();


--
-- Name: rate_rules rate_rules_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rate_rules_audit AFTER INSERT OR DELETE OR UPDATE ON public.rate_rules FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: rate_rules rate_rules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rate_rules_set_updated_at BEFORE UPDATE ON public.rate_rules FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: rate_rules rate_rules_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rate_rules_signal AFTER INSERT OR DELETE OR UPDATE ON public.rate_rules FOR EACH STATEMENT EXECUTE FUNCTION private.signal_config_change();


--
-- Name: staff_permissions staff_permissions_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER staff_permissions_audit AFTER INSERT OR DELETE OR UPDATE ON public.staff_permissions FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: user_roles user_roles_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_roles_audit AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: venue_settings venue_settings_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER venue_settings_audit AFTER INSERT OR DELETE OR UPDATE ON public.venue_settings FOR EACH ROW EXECUTE FUNCTION private.write_audit();


--
-- Name: venue_settings venue_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER venue_settings_set_updated_at BEFORE UPDATE ON public.venue_settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: venue_settings venue_settings_signal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER venue_settings_signal AFTER UPDATE ON public.venue_settings FOR EACH STATEMENT EXECUTE FUNCTION private.signal_config_change();


--
-- Name: event_codes event_codes_event_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.event_codes
    ADD CONSTRAINT event_codes_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: booking_slots booking_slots_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_slots
    ADD CONSTRAINT booking_slots_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_slots booking_slots_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_slots
    ADD CONSTRAINT booking_slots_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE RESTRICT;


--
-- Name: booking_slots booking_slots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_slots
    ADD CONSTRAINT booking_slots_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: booking_slots booking_slots_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_slots
    ADD CONSTRAINT booking_slots_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: check_ins check_ins_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: check_ins check_ins_checked_in_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: check_ins check_ins_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: check_ins check_ins_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: check_ins check_ins_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.event_registrations(id) ON DELETE SET NULL;


--
-- Name: event_court_lanes event_court_lanes_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_court_lanes
    ADD CONSTRAINT event_court_lanes_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE CASCADE;


--
-- Name: event_court_lanes event_court_lanes_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_court_lanes
    ADD CONSTRAINT event_court_lanes_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.event_divisions(id) ON DELETE CASCADE;


--
-- Name: event_court_lanes event_court_lanes_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_court_lanes
    ADD CONSTRAINT event_court_lanes_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_divisions event_divisions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_divisions
    ADD CONSTRAINT event_divisions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.event_categories(id) ON DELETE RESTRICT;


--
-- Name: event_divisions event_divisions_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_divisions
    ADD CONSTRAINT event_divisions_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_matches event_matches_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE RESTRICT;


--
-- Name: event_matches event_matches_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.event_divisions(id) ON DELETE CASCADE;


--
-- Name: event_matches event_matches_entry_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_entry_a_fkey FOREIGN KEY (entry_a) REFERENCES public.event_registrations(id) ON DELETE SET NULL;


--
-- Name: event_matches event_matches_entry_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_entry_b_fkey FOREIGN KEY (entry_b) REFERENCES public.event_registrations(id) ON DELETE SET NULL;


--
-- Name: event_matches event_matches_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_matches event_matches_next_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_next_match_id_fkey FOREIGN KEY (next_match_id) REFERENCES public.event_matches(id) ON DELETE SET NULL;


--
-- Name: event_matches event_matches_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: event_matches event_matches_winner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_winner_fkey FOREIGN KEY (winner) REFERENCES public.event_registrations(id) ON DELETE SET NULL;


--
-- Name: event_registrations event_registrations_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: event_registrations event_registrations_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.event_categories(id) ON DELETE RESTRICT;


--
-- Name: event_registrations event_registrations_checked_in_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: event_registrations event_registrations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: event_registrations event_registrations_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.event_divisions(id) ON DELETE RESTRICT;


--
-- Name: event_registrations event_registrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_registrations event_registrations_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: event_registrations event_registrations_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: event_registrations event_registrations_walk_in_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_walk_in_recorded_by_fkey FOREIGN KEY (walk_in_recorded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: events events_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.event_categories(id) ON DELETE SET NULL;


--
-- Name: events events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: payments payments_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;


--
-- Name: payments payments_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: payments payments_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.event_divisions(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.queue_games(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.event_registrations(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_stay_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_stay_court_id_fkey FOREIGN KEY (stay_court_id) REFERENCES public.courts(id) ON DELETE SET NULL;


--
-- Name: queue_games queue_games_called_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_games
    ADD CONSTRAINT queue_games_called_by_fkey FOREIGN KEY (called_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: queue_games queue_games_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_games
    ADD CONSTRAINT queue_games_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE RESTRICT;


--
-- Name: queue_games queue_games_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_games
    ADD CONSTRAINT queue_games_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.event_divisions(id) ON DELETE SET NULL;


--
-- Name: queue_games queue_games_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_games
    ADD CONSTRAINT queue_games_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: rate_rules rate_rules_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_rules
    ADD CONSTRAINT rate_rules_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE CASCADE;


--
-- Name: staff_permissions staff_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: staff_permissions staff_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: event_codes; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.event_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles Active players update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Active players update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_active_user() AS is_active_user))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: courts Admins add courts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins add courts" ON public.courts FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_admin() AS is_admin));


--
-- Name: operating_hour_exceptions Admins manage hour exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage hour exceptions" ON public.operating_hour_exceptions TO authenticated USING (( SELECT private.is_admin() AS is_admin)) WITH CHECK (( SELECT private.is_admin() AS is_admin));


--
-- Name: operating_hours Admins manage operating hours; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage operating hours" ON public.operating_hours TO authenticated USING (( SELECT private.is_admin() AS is_admin)) WITH CHECK (( SELECT private.is_admin() AS is_admin));


--
-- Name: payment_methods Admins manage payment methods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage payment methods" ON public.payment_methods TO authenticated USING (( SELECT private.is_admin() AS is_admin)) WITH CHECK (( SELECT private.is_admin() AS is_admin));


--
-- Name: rate_rules Admins manage rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage rates" ON public.rate_rules TO authenticated USING (( SELECT private.is_admin() AS is_admin)) WITH CHECK (( SELECT private.is_admin() AS is_admin));


--
-- Name: staff_permissions Admins read all permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all permissions" ON public.staff_permissions FOR SELECT TO authenticated USING (( SELECT private.is_admin() AS is_admin));


--
-- Name: user_roles Admins read all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (( SELECT private.is_admin() AS is_admin));


--
-- Name: audit_log Admins read the audit log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read the audit log" ON public.audit_log FOR SELECT TO authenticated USING (( SELECT private.is_admin() AS is_admin));


--
-- Name: courts Admins remove courts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins remove courts" ON public.courts FOR DELETE TO authenticated USING (( SELECT private.is_admin() AS is_admin));


--
-- Name: venue_settings Admins update venue settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update venue settings" ON public.venue_settings FOR UPDATE TO authenticated USING (( SELECT private.is_admin() AS is_admin)) WITH CHECK (( SELECT private.is_admin() AS is_admin));


--
-- Name: event_categories Anyone reads active categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads active categories" ON public.event_categories FOR SELECT TO anon, authenticated USING ((is_active OR ( SELECT private.has_permission('events.manage'::public.app_permission) AS has_permission)));


--
-- Name: rate_rules Anyone reads active rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads active rates" ON public.rate_rules FOR SELECT TO anon, authenticated USING ((is_active OR ( SELECT private.is_staff() AS is_staff)));


--
-- Name: courts Anyone reads courts that are not retired; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads courts that are not retired" ON public.courts FOR SELECT TO anon, authenticated USING (((status <> 'inactive'::public.court_status) OR ( SELECT private.is_staff() AS is_staff)));


--
-- Name: event_divisions Anyone reads divisions of visible events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads divisions of visible events" ON public.event_divisions FOR SELECT TO anon, authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_divisions.event_id) AND ((e.status <> 'draft'::public.event_status) OR private.can_manage_event_type(e.event_type))))));


--
-- Name: operating_hour_exceptions Anyone reads hour exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads hour exceptions" ON public.operating_hour_exceptions FOR SELECT TO anon, authenticated USING (true);


--
-- Name: operating_hours Anyone reads operating hours; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads operating hours" ON public.operating_hours FOR SELECT TO anon, authenticated USING (true);


--
-- Name: events Anyone reads published events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads published events" ON public.events FOR SELECT TO anon, authenticated USING (((status <> 'draft'::public.event_status) OR private.can_manage_event_type(event_type)));


--
-- Name: schedule_signals Anyone reads schedule signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads schedule signals" ON public.schedule_signals FOR SELECT TO anon, authenticated USING (true);


--
-- Name: venue_settings Anyone reads venue settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone reads venue settings" ON public.venue_settings FOR SELECT TO anon, authenticated USING (true);


--
-- Name: events Event managers create events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers create events" ON public.events FOR INSERT TO authenticated WITH CHECK (private.can_manage_event_type(event_type));


--
-- Name: events Event managers delete draft events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers delete draft events" ON public.events FOR DELETE TO authenticated USING (((status = 'draft'::public.event_status) AND private.can_manage_event_type(event_type)));


--
-- Name: event_categories Event managers manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers manage categories" ON public.event_categories TO authenticated USING (( SELECT private.has_permission('events.manage'::public.app_permission) AS has_permission)) WITH CHECK (( SELECT private.has_permission('events.manage'::public.app_permission) AS has_permission));


--
-- Name: event_divisions Event managers manage divisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers manage divisions" ON public.event_divisions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_divisions.event_id) AND private.can_manage_event_type(e.event_type))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_divisions.event_id) AND private.can_manage_event_type(e.event_type)))));


--
-- Name: event_court_lanes Event managers read court levels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers read court levels" ON public.event_court_lanes FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_court_lanes.event_id) AND private.can_manage_event_type(e.event_type)))));


--
-- Name: event_matches Event managers read matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers read matches" ON public.event_matches FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_matches.event_id) AND private.can_manage_event_type(e.event_type)))));


--
-- Name: queue_entries Event managers read queue entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers read queue entries" ON public.queue_entries FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = queue_entries.event_id) AND private.can_manage_event_type(e.event_type)))));


--
-- Name: queue_games Event managers read queue games; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers read queue games" ON public.queue_games FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = queue_games.event_id) AND private.can_manage_event_type(e.event_type)))));


--
-- Name: event_registrations Event managers read registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers read registrations" ON public.event_registrations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_registrations.event_id) AND private.can_manage_event_type(e.event_type)))));


--
-- Name: events Event managers update events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Event managers update events" ON public.events FOR UPDATE TO authenticated USING (private.can_manage_event_type(event_type)) WITH CHECK (private.can_manage_event_type(event_type));


--
-- Name: payments Payment verifiers read all payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Payment verifiers read all payments" ON public.payments FOR SELECT TO authenticated USING (( SELECT private.has_permission('payments.verify'::public.app_permission) AS has_permission));


--
-- Name: booking_slots Players read slots of their bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read slots of their bookings" ON public.booking_slots FOR SELECT TO authenticated USING (((booking_id IS NOT NULL) AND private.owns_booking(booking_id)));


--
-- Name: bookings Players read their own bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read their own bookings" ON public.bookings FOR SELECT TO authenticated USING ((player_id = ( SELECT auth.uid() AS uid)));


--
-- Name: check_ins Players read their own check-ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read their own check-ins" ON public.check_ins FOR SELECT TO authenticated USING ((player_id = ( SELECT auth.uid() AS uid)));


--
-- Name: payments Players read their own payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read their own payments" ON public.payments FOR SELECT TO authenticated USING (private.owns_booking(booking_id));


--
-- Name: profiles Players read their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read their own profile" ON public.profiles FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: queue_entries Players read their own queue entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read their own queue entries" ON public.queue_entries FOR SELECT TO authenticated USING ((player_id = ( SELECT auth.uid() AS uid)));


--
-- Name: event_registrations Players read their own registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players read their own registrations" ON public.event_registrations FOR SELECT TO authenticated USING (((player_id = ( SELECT auth.uid() AS uid)) OR (partner_id = ( SELECT auth.uid() AS uid))));


--
-- Name: booking_slots Schedule managers add blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Schedule managers add blocks" ON public.booking_slots FOR INSERT TO authenticated WITH CHECK (((kind = ANY (ARRAY['block'::public.slot_kind, 'maintenance'::public.slot_kind])) AND (booking_id IS NULL) AND ( SELECT private.has_permission('schedule.manage'::public.app_permission) AS has_permission)));


--
-- Name: booking_slots Schedule managers change blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Schedule managers change blocks" ON public.booking_slots FOR UPDATE TO authenticated USING (((kind = ANY (ARRAY['block'::public.slot_kind, 'maintenance'::public.slot_kind])) AND ( SELECT private.has_permission('schedule.manage'::public.app_permission) AS has_permission))) WITH CHECK (((kind = ANY (ARRAY['block'::public.slot_kind, 'maintenance'::public.slot_kind])) AND (booking_id IS NULL) AND ( SELECT private.has_permission('schedule.manage'::public.app_permission) AS has_permission)));


--
-- Name: booking_slots Schedule managers remove blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Schedule managers remove blocks" ON public.booking_slots FOR DELETE TO authenticated USING (((kind = ANY (ARRAY['block'::public.slot_kind, 'maintenance'::public.slot_kind])) AND ( SELECT private.has_permission('schedule.manage'::public.app_permission) AS has_permission)));


--
-- Name: courts Schedule managers update courts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Schedule managers update courts" ON public.courts FOR UPDATE TO authenticated USING (( SELECT private.has_permission('schedule.manage'::public.app_permission) AS has_permission)) WITH CHECK (( SELECT private.has_permission('schedule.manage'::public.app_permission) AS has_permission));


--
-- Name: bookings Staff read all bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff read all bookings" ON public.bookings FOR SELECT TO authenticated USING (( SELECT private.is_staff() AS is_staff));


--
-- Name: profiles Staff read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff read all profiles" ON public.profiles FOR SELECT TO authenticated USING (( SELECT private.is_staff() AS is_staff));


--
-- Name: booking_slots Staff read all slots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff read all slots" ON public.booking_slots FOR SELECT TO authenticated USING (( SELECT private.is_staff() AS is_staff));


--
-- Name: check_ins Staff read check-ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff read check-ins" ON public.check_ins FOR SELECT TO authenticated USING (( SELECT private.is_staff() AS is_staff));


--
-- Name: payment_methods Staff read payment methods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff read payment methods" ON public.payment_methods FOR SELECT TO authenticated USING (( SELECT private.is_staff() AS is_staff));


--
-- Name: notifications Users read their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read their own notifications" ON public.notifications FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: staff_permissions Users read their own permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read their own permissions" ON public.staff_permissions FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_roles Users read their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: check_ins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;

--
-- Name: courts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;

--
-- Name: event_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: event_court_lanes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_court_lanes ENABLE ROW LEVEL SECURITY;

--
-- Name: event_divisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_divisions ENABLE ROW LEVEL SECURITY;

--
-- Name: event_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: event_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: operating_hour_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operating_hour_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: operating_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_games ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA private TO anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION add_event_codes(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.add_event_codes() FROM PUBLIC;


--
-- Name: TABLE event_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_matches TO service_role;
GRANT SELECT ON TABLE public.event_matches TO authenticated;


--
-- Name: FUNCTION advance_winner(_m public.event_matches, _winner uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.advance_winner(_m public.event_matches, _winner uuid) FROM PUBLIC;


--
-- Name: FUNCTION amount_due(_booking_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.amount_due(_booking_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION audit_to_staff_notification(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.audit_to_staff_notification() FROM PUBLIC;


--
-- Name: FUNCTION auto_confirm_level(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.auto_confirm_level() FROM PUBLIC;


--
-- Name: FUNCTION booking_when(_booking_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.booking_when(_booking_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION bootstrap_first_admin(_email text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.bootstrap_first_admin(_email text) FROM PUBLIC;


--
-- Name: FUNCTION bump_schedule_signal(_date date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.bump_schedule_signal(_date date) FROM PUBLIC;


--
-- Name: FUNCTION can_manage_event_type(_type public.event_type); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.can_manage_event_type(_type public.event_type) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_manage_event_type(_type public.event_type) TO anon;
GRANT ALL ON FUNCTION private.can_manage_event_type(_type public.event_type) TO authenticated;
GRANT ALL ON FUNCTION private.can_manage_event_type(_type public.event_type) TO service_role;


--
-- Name: TABLE event_registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_registrations TO service_role;
GRANT SELECT ON TABLE public.event_registrations TO authenticated;


--
-- Name: FUNCTION cancel_registration(_reg public.event_registrations, _by uuid, _why text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.cancel_registration(_reg public.event_registrations, _by uuid, _why text) FROM PUBLIC;


--
-- Name: FUNCTION cancel_registrations_for_booking(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.cancel_registrations_for_booking() FROM PUBLIC;


--
-- Name: FUNCTION category_level(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.category_level() FROM PUBLIC;


--
-- Name: FUNCTION check_capacity_change(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.check_capacity_change() FROM PUBLIC;


--
-- Name: FUNCTION check_registration(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.check_registration() FROM PUBLIC;


--
-- Name: FUNCTION close_event_queue(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.close_event_queue() FROM PUBLIC;


--
-- Name: FUNCTION confirm_registrations_for_booking(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.confirm_registrations_for_booking() FROM PUBLIC;


--
-- Name: FUNCTION create_registration(_event_id uuid, _division_id uuid, _player_id uuid, _partner_id uuid, _by uuid, _waive_fee boolean, _note text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.create_registration(_event_id uuid, _division_id uuid, _player_id uuid, _partner_id uuid, _by uuid, _waive_fee boolean, _note text) FROM PUBLIC;


--
-- Name: FUNCTION division_entries(_division_id uuid, _exclude uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.division_entries(_division_id uuid, _exclude uuid) FROM PUBLIC;


--
-- Name: FUNCTION enqueue(_event_id uuid, _player_id uuid, _reg uuid, _consecutive integer, _stay_court uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.enqueue(_event_id uuid, _player_id uuid, _reg uuid, _consecutive integer, _stay_court uuid) FROM PUBLIC;


--
-- Name: FUNCTION ensure_player_level(_key text, _sort integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.ensure_player_level(_key text, _sort integer) FROM PUBLIC;


--
-- Name: FUNCTION entry_label(_registration_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.entry_label(_registration_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION event_people(_event_id uuid, _exclude uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.event_people(_event_id uuid, _exclude uuid) FROM PUBLIC;


--
-- Name: FUNCTION expire_stale_holds(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.expire_stale_holds() FROM PUBLIC;
GRANT ALL ON FUNCTION private.expire_stale_holds() TO service_role;


--
-- Name: FUNCTION expire_unpaid_bookings(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.expire_unpaid_bookings() FROM PUBLIC;
GRANT ALL ON FUNCTION private.expire_unpaid_bookings() TO service_role;


--
-- Name: FUNCTION extend_payment_due_after_rejection(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.extend_payment_due_after_rejection() FROM PUBLIC;


--
-- Name: FUNCTION find_partner(_email text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.find_partner(_email text) FROM PUBLIC;


--
-- Name: FUNCTION fmt_time(_ts timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.fmt_time(_ts timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC;


--
-- Name: FUNCTION has_permission(_permission public.app_permission); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.has_permission(_permission public.app_permission) FROM PUBLIC;
GRANT ALL ON FUNCTION private.has_permission(_permission public.app_permission) TO anon;
GRANT ALL ON FUNCTION private.has_permission(_permission public.app_permission) TO authenticated;
GRANT ALL ON FUNCTION private.has_permission(_permission public.app_permission) TO service_role;


--
-- Name: FUNCTION has_role(_role public.app_role); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.has_role(_role public.app_role) FROM PUBLIC;
GRANT ALL ON FUNCTION private.has_role(_role public.app_role) TO anon;
GRANT ALL ON FUNCTION private.has_role(_role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION private.has_role(_role public.app_role) TO service_role;


--
-- Name: FUNCTION is_active_user(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_active_user() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_active_user() TO anon;
GRANT ALL ON FUNCTION private.is_active_user() TO authenticated;
GRANT ALL ON FUNCTION private.is_active_user() TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_admin() TO anon;
GRANT ALL ON FUNCTION private.is_admin() TO authenticated;
GRANT ALL ON FUNCTION private.is_admin() TO service_role;


--
-- Name: FUNCTION is_staff(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_staff() TO anon;
GRANT ALL ON FUNCTION private.is_staff() TO authenticated;
GRANT ALL ON FUNCTION private.is_staff() TO service_role;


--
-- Name: FUNCTION level_key_for(_slug text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.level_key_for(_slug text) FROM PUBLIC;


--
-- Name: FUNCTION level_label(_l public.player_level); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.level_label(_l public.player_level) FROM PUBLIC;


--
-- Name: FUNCTION match_results(_from date, _to date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.match_results(_from date, _to date) FROM PUBLIC;


--
-- Name: FUNCTION next_booking_reference(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.next_booking_reference() FROM PUBLIC;
GRANT ALL ON FUNCTION private.next_booking_reference() TO authenticated;
GRANT ALL ON FUNCTION private.next_booking_reference() TO service_role;


--
-- Name: FUNCTION notify(_user uuid, _kind text, _title text, _body text, _link text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.notify(_user uuid, _kind text, _title text, _body text, _link text) FROM PUBLIC;


--
-- Name: FUNCTION notify_on_deck(_event_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.notify_on_deck(_event_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION notify_payment_verifiers(_title text, _body text, _link text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.notify_payment_verifiers(_title text, _body text, _link text) FROM PUBLIC;


--
-- Name: FUNCTION notify_staff(_title text, _body text, _link text, _actor uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.notify_staff(_title text, _body text, _link text, _actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION on_event_cancelled(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.on_event_cancelled() FROM PUBLIC;


--
-- Name: FUNCTION open_play_division_individual(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.open_play_division_individual() FROM PUBLIC;


--
-- Name: FUNCTION open_play_registration_individual(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.open_play_registration_individual() FROM PUBLIC;


--
-- Name: FUNCTION operating_date_of(_ts timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.operating_date_of(_ts timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.operating_date_of(_ts timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION private.operating_date_of(_ts timestamp with time zone) TO service_role;


--
-- Name: FUNCTION operating_window(_date date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.operating_window(_date date) FROM PUBLIC;


--
-- Name: FUNCTION owns_booking(_booking_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owns_booking(_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.owns_booking(_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.owns_booking(_booking_id uuid) TO service_role;


--
-- Name: FUNCTION payment_deadline_for(_booking_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.payment_deadline_for(_booking_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION peso(_centavos bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.peso(_centavos bigint) FROM PUBLIC;


--
-- Name: FUNCTION price_for_slot(_court_id uuid, _starts_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.price_for_slot(_court_id uuid, _starts_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION proof_path_is_mine(_name text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.proof_path_is_mine(_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.proof_path_is_mine(_name text) TO authenticated;
GRANT ALL ON FUNCTION private.proof_path_is_mine(_name text) TO service_role;


--
-- Name: FUNCTION public_name(_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.public_name(_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_entry_division(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_entry_division() FROM PUBLIC;


--
-- Name: FUNCTION queue_games_on_deck(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_games_on_deck() FROM PUBLIC;


--
-- Name: FUNCTION queue_last_outcome(_event_id uuid, _who uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_last_outcome(_event_id uuid, _who uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_partner_count(_event_id uuid, _a uuid, _b uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_partner_count(_event_id uuid, _a uuid, _b uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_person_name(_player_id uuid, _registration_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_person_name(_player_id uuid, _registration_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_registration(_event_id uuid, _player_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_registration(_event_id uuid, _player_id uuid) FROM PUBLIC;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.events TO service_role;
GRANT SELECT ON TABLE public.events TO anon;
GRANT SELECT,DELETE ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.slug; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(slug),UPDATE(slug) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.title; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(title),UPDATE(title) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.event_type; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(event_type),UPDATE(event_type) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.category_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(category_id),UPDATE(category_id) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.description; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(description),UPDATE(description) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.level; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(level),UPDATE(level) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.starts_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(starts_at),UPDATE(starts_at) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.ends_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ends_at),UPDATE(ends_at) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.registration_opens_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(registration_opens_at),UPDATE(registration_opens_at) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.registration_closes_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(registration_closes_at),UPDATE(registration_closes_at) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.capacity; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(capacity),UPDATE(capacity) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.fee_centavos; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(fee_centavos),UPDATE(fee_centavos) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.fee_unit; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(fee_unit),UPDATE(fee_unit) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.status; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(status),UPDATE(status) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.skill_min; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(skill_min),UPDATE(skill_min) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.skill_max; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(skill_max),UPDATE(skill_max) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_players_per_game; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_players_per_game),UPDATE(queue_players_per_game) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_rotation; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_rotation),UPDATE(queue_rotation) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_max_consecutive; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_max_consecutive),UPDATE(queue_max_consecutive) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_no_show_rule; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_no_show_rule),UPDATE(queue_no_show_rule) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.cancel_reason; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(cancel_reason),UPDATE(cancel_reason) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_game_minutes; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_game_minutes),UPDATE(queue_game_minutes) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_game_points; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_game_points),UPDATE(queue_game_points) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_record_results; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_record_results),UPDATE(queue_record_results) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_matching; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_matching),UPDATE(queue_matching) ON TABLE public.events TO authenticated;


--
-- Name: COLUMN events.queue_auto_fill; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(queue_auto_fill),UPDATE(queue_auto_fill) ON TABLE public.events TO authenticated;


--
-- Name: FUNCTION queue_session(_event_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_session(_event_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_were_partners(_event_id uuid, _a uuid, _b uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_were_partners(_event_id uuid, _a uuid, _b uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_wins(_event_id uuid, _player_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.queue_wins(_event_id uuid, _player_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION recalculate_booking_total(_booking_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.recalculate_booking_total(_booking_id uuid) FROM PUBLIC;


--
-- Name: TABLE bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bookings TO service_role;
GRANT SELECT ON TABLE public.bookings TO authenticated;


--
-- Name: FUNCTION record_desk_cash(_b public.bookings, _received bigint, _why text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.record_desk_cash(_b public.bookings, _received bigint, _why text) FROM PUBLIC;


--
-- Name: FUNCTION registration_state(_e public.events); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.registration_state(_e public.events) FROM PUBLIC;


--
-- Name: FUNCTION remind_unpaid_bookings(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.remind_unpaid_bookings() FROM PUBLIC;
GRANT ALL ON FUNCTION private.remind_unpaid_bookings() TO service_role;


--
-- Name: FUNCTION require_admin(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION private.require_admin() TO authenticated;
GRANT ALL ON FUNCTION private.require_admin() TO service_role;


--
-- Name: FUNCTION require_bookable_player(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_bookable_player() FROM PUBLIC;


--
-- Name: FUNCTION require_event_manager(_event_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_event_manager(_event_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION require_profile(_user_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_profile(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.require_profile(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.require_profile(_user_id uuid) TO service_role;


--
-- Name: FUNCTION require_reason(_reason text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_reason(_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.require_reason(_reason text) TO authenticated;
GRANT ALL ON FUNCTION private.require_reason(_reason text) TO service_role;


--
-- Name: FUNCTION require_report_access(_from date, _to date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_report_access(_from date, _to date) FROM PUBLIC;


--
-- Name: FUNCTION require_staff(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_staff() FROM PUBLIC;


--
-- Name: FUNCTION run_booking_jobs(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.run_booking_jobs() FROM PUBLIC;
GRANT ALL ON FUNCTION private.run_booking_jobs() TO service_role;


--
-- Name: FUNCTION set_operating_date(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.set_operating_date() FROM PUBLIC;


--
-- Name: FUNCTION set_payment_due(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.set_payment_due() FROM PUBLIC;


--
-- Name: FUNCTION signal_booking_change(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.signal_booking_change() FROM PUBLIC;


--
-- Name: FUNCTION signal_config_change(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.signal_config_change() FROM PUBLIC;


--
-- Name: FUNCTION signal_slot_change(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.signal_slot_change() FROM PUBLIC;


--
-- Name: FUNCTION signal_today(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.signal_today() FROM PUBLIC;


--
-- Name: FUNCTION skill_text(_min public.player_level, _max public.player_level); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.skill_text(_min public.player_level, _max public.player_level) FROM PUBLIC;


--
-- Name: FUNCTION slot_is_live(_status public.slot_status, _booking_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.slot_is_live(_status public.slot_status, _booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.slot_is_live(_status public.slot_status, _booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.slot_is_live(_status public.slot_status, _booking_id uuid) TO service_role;


--
-- Name: FUNCTION stack_rotation(_division_id uuid, _e public.events); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.stack_rotation(_division_id uuid, _e public.events) FROM PUBLIC;


--
-- Name: FUNCTION venue_time_zone(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.venue_time_zone() FROM PUBLIC;
GRANT ALL ON FUNCTION private.venue_time_zone() TO authenticated;
GRANT ALL ON FUNCTION private.venue_time_zone() TO service_role;


--
-- Name: FUNCTION write_audit(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.write_audit() FROM PUBLIC;


--
-- Name: FUNCTION admin_add_walk_in(_event_id uuid, _division_id uuid, _name text, _phone text, _partner_id uuid, _partner_name text, _paid_centavos bigint, _method public.payment_method_kind, _reference text, _pay_later boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_add_walk_in(_event_id uuid, _division_id uuid, _name text, _phone text, _partner_id uuid, _partner_name text, _paid_centavos bigint, _method public.payment_method_kind, _reference text, _pay_later boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_add_walk_in(_event_id uuid, _division_id uuid, _name text, _phone text, _partner_id uuid, _partner_name text, _paid_centavos bigint, _method public.payment_method_kind, _reference text, _pay_later boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_add_walk_in(_event_id uuid, _division_id uuid, _name text, _phone text, _partner_id uuid, _partner_name text, _paid_centavos bigint, _method public.payment_method_kind, _reference text, _pay_later boolean) TO authenticated;


--
-- Name: FUNCTION admin_grant_role(_user_id uuid, _role public.app_role, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_grant_role(_user_id uuid, _role public.app_role, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_grant_role(_user_id uuid, _role public.app_role, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.admin_grant_role(_user_id uuid, _role public.app_role, _reason text) TO authenticated;


--
-- Name: FUNCTION admin_list_members(_search text, _limit integer, _offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_members(_search text, _limit integer, _offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_members(_search text, _limit integer, _offset integer) TO service_role;
GRANT ALL ON FUNCTION public.admin_list_members(_search text, _limit integer, _offset integer) TO authenticated;


--
-- Name: FUNCTION admin_revoke_role(_user_id uuid, _role public.app_role, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_revoke_role(_user_id uuid, _role public.app_role, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_revoke_role(_user_id uuid, _role public.app_role, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.admin_revoke_role(_user_id uuid, _role public.app_role, _reason text) TO authenticated;


--
-- Name: FUNCTION admin_set_account_status(_user_id uuid, _status public.account_status, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_account_status(_user_id uuid, _status public.account_status, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_account_status(_user_id uuid, _status public.account_status, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_account_status(_user_id uuid, _status public.account_status, _reason text) TO authenticated;


--
-- Name: FUNCTION admin_set_staff_permissions(_user_id uuid, _permissions public.app_permission[], _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_staff_permissions(_user_id uuid, _permissions public.app_permission[], _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_staff_permissions(_user_id uuid, _permissions public.app_permission[], _reason text) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_staff_permissions(_user_id uuid, _permissions public.app_permission[], _reason text) TO authenticated;


--
-- Name: FUNCTION cancel_booking(_booking_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_booking(_booking_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_booking(_booking_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.cancel_booking(_booking_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION confirm_booking(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_booking(_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_booking(_booking_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.confirm_booking(_booking_id uuid) TO authenticated;


--
-- Name: FUNCTION get_attendance_leaderboard(_days integer, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_attendance_leaderboard(_days integer, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_attendance_leaderboard(_days integer, _limit integer) TO service_role;
GRANT ALL ON FUNCTION public.get_attendance_leaderboard(_days integer, _limit integer) TO authenticated;


--
-- Name: FUNCTION get_court_availability(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_court_availability(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_court_availability(_date date) TO service_role;
GRANT ALL ON FUNCTION public.get_court_availability(_date date) TO anon;
GRANT ALL ON FUNCTION public.get_court_availability(_date date) TO authenticated;


--
-- Name: FUNCTION get_division_standings(_division_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_division_standings(_division_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_division_standings(_division_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_division_standings(_division_id uuid) TO authenticated;


--
-- Name: FUNCTION get_event_matches(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_event_matches(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_event_matches(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_event_matches(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION get_events(_slug text, _type public.event_type, _include_past boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_events(_slug text, _type public.event_type, _include_past boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_events(_slug text, _type public.event_type, _include_past boolean) TO service_role;
GRANT ALL ON FUNCTION public.get_events(_slug text, _type public.event_type, _include_past boolean) TO anon;
GRANT ALL ON FUNCTION public.get_events(_slug text, _type public.event_type, _include_past boolean) TO authenticated;


--
-- Name: FUNCTION get_leaderboard(_from date, _to date, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_leaderboard(_from date, _to date, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_leaderboard(_from date, _to date, _limit integer) TO service_role;
GRANT ALL ON FUNCTION public.get_leaderboard(_from date, _to date, _limit integer) TO authenticated;


--
-- Name: FUNCTION get_live_courts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_live_courts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_live_courts() TO service_role;
GRANT ALL ON FUNCTION public.get_live_courts() TO anon;
GRANT ALL ON FUNCTION public.get_live_courts() TO authenticated;


--
-- Name: FUNCTION get_my_access(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_access() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_access() TO service_role;
GRANT ALL ON FUNCTION public.get_my_access() TO authenticated;


--
-- Name: FUNCTION get_my_match_history(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_match_history() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_match_history() TO service_role;
GRANT ALL ON FUNCTION public.get_my_match_history() TO authenticated;


--
-- Name: FUNCTION get_my_payments(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_payments() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_payments() TO service_role;
GRANT ALL ON FUNCTION public.get_my_payments() TO authenticated;


--
-- Name: FUNCTION get_my_play_history(_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_play_history(_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_play_history(_limit integer) TO service_role;
GRANT ALL ON FUNCTION public.get_my_play_history(_limit integer) TO authenticated;


--
-- Name: FUNCTION get_my_registrations(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_registrations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_registrations() TO service_role;
GRANT ALL ON FUNCTION public.get_my_registrations() TO authenticated;


--
-- Name: FUNCTION get_operating_day(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_operating_day(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_operating_day(_date date) TO service_role;
GRANT ALL ON FUNCTION public.get_operating_day(_date date) TO anon;
GRANT ALL ON FUNCTION public.get_operating_day(_date date) TO authenticated;


--
-- Name: FUNCTION get_payment_instructions(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_payment_instructions(_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_payment_instructions(_booking_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_payment_instructions(_booking_id uuid) TO authenticated;


--
-- Name: FUNCTION get_queue(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_queue(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_queue(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_queue(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION get_session_board(_event_id uuid, _code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_session_board(_event_id uuid, _code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_session_board(_event_id uuid, _code text) TO service_role;
GRANT ALL ON FUNCTION public.get_session_board(_event_id uuid, _code text) TO anon;
GRANT ALL ON FUNCTION public.get_session_board(_event_id uuid, _code text) TO authenticated;


--
-- Name: FUNCTION get_session_standings(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_session_standings(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_session_standings(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_session_standings(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION get_whos_playing(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_whos_playing(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_whos_playing(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_whos_playing(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION hold_slots(_slots jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_slots(_slots jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_slots(_slots jsonb) TO service_role;
GRANT ALL ON FUNCTION public.hold_slots(_slots jsonb) TO authenticated;


--
-- Name: FUNCTION join_queue(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_queue(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_queue(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.join_queue(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION leave_queue(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.leave_queue(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.leave_queue(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.leave_queue(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION mark_notifications_read(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_notifications_read(_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_notifications_read(_ids uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.mark_notifications_read(_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION register_for_event(_event_id uuid, _division_id uuid, _partner_email text, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.register_for_event(_event_id uuid, _division_id uuid, _partner_email text, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_for_event(_event_id uuid, _division_id uuid, _partner_email text, _note text) TO service_role;
GRANT ALL ON FUNCTION public.register_for_event(_event_id uuid, _division_id uuid, _partner_email text, _note text) TO authenticated;


--
-- Name: FUNCTION release_held_slot(_slot_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_held_slot(_slot_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_held_slot(_slot_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.release_held_slot(_slot_id uuid) TO authenticated;


--
-- Name: FUNCTION report_bookings(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_bookings(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_bookings(_from date, _to date) TO service_role;
GRANT ALL ON FUNCTION public.report_bookings(_from date, _to date) TO authenticated;


--
-- Name: FUNCTION report_check_ins(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_check_ins(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_check_ins(_from date, _to date) TO service_role;
GRANT ALL ON FUNCTION public.report_check_ins(_from date, _to date) TO authenticated;


--
-- Name: FUNCTION report_event_registrations(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_event_registrations(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_event_registrations(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.report_event_registrations(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION report_payments(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_payments(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_payments(_from date, _to date) TO service_role;
GRANT ALL ON FUNCTION public.report_payments(_from date, _to date) TO authenticated;


--
-- Name: FUNCTION report_revenue_daily(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_revenue_daily(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_revenue_daily(_from date, _to date) TO service_role;
GRANT ALL ON FUNCTION public.report_revenue_daily(_from date, _to date) TO authenticated;


--
-- Name: FUNCTION self_check_in(_event_id uuid, _code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.self_check_in(_event_id uuid, _code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.self_check_in(_event_id uuid, _code text) TO service_role;
GRANT ALL ON FUNCTION public.self_check_in(_event_id uuid, _code text) TO authenticated;


--
-- Name: FUNCTION set_booking_display_name(_booking_id uuid, _name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_booking_display_name(_booking_id uuid, _name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_booking_display_name(_booking_id uuid, _name text) TO service_role;
GRANT ALL ON FUNCTION public.set_booking_display_name(_booking_id uuid, _name text) TO authenticated;


--
-- Name: FUNCTION staff_assign_event_courts(_event_id uuid, _court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_assign_event_courts(_event_id uuid, _court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_assign_event_courts(_event_id uuid, _court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_assign_event_courts(_event_id uuid, _court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_block_courts(_court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _kind public.slot_kind, _note text, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_block_courts(_court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _kind public.slot_kind, _note text, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_block_courts(_court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _kind public.slot_kind, _note text, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_block_courts(_court_ids uuid[], _starts_at timestamp with time zone, _ends_at timestamp with time zone, _kind public.slot_kind, _note text, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_booking_balances(_booking_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_booking_balances(_booking_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_booking_balances(_booking_ids uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.staff_booking_balances(_booking_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION staff_booking_history(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_booking_history(_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_booking_history(_booking_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_booking_history(_booking_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_call_next(_event_id uuid, _court_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_call_next(_event_id uuid, _court_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_call_next(_event_id uuid, _court_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_call_next(_event_id uuid, _court_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_cancel_event(_event_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_cancel_event(_event_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_cancel_event(_event_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_cancel_event(_event_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_cancel_game(_game_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_cancel_game(_game_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_cancel_game(_game_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_cancel_game(_game_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_cancel_registration(_registration_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_cancel_registration(_registration_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_cancel_registration(_registration_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_cancel_registration(_registration_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_check_in(_registration_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_check_in(_registration_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_check_in(_registration_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_check_in(_registration_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_check_in_all(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_check_in_all(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_check_in_all(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_check_in_all(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_check_in_booking(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_check_in_booking(_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_check_in_booking(_booking_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_check_in_booking(_booking_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_complete_game(_game_id uuid, _winning_team text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_complete_game(_game_id uuid, _winning_team text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_complete_game(_game_id uuid, _winning_team text) TO service_role;
GRANT ALL ON FUNCTION public.staff_complete_game(_game_id uuid, _winning_team text) TO authenticated;


--
-- Name: FUNCTION staff_dashboard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_dashboard() TO service_role;
GRANT ALL ON FUNCTION public.staff_dashboard() TO authenticated;


--
-- Name: FUNCTION staff_delete_booking(_booking_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_delete_booking(_booking_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_delete_booking(_booking_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_delete_booking(_booking_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_delete_event(_event_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_delete_event(_event_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_delete_event(_event_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_delete_event(_event_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_event_codes(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_event_codes(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_event_codes(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_event_codes(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_find_players(_query text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_find_players(_query text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_find_players(_query text) TO service_role;
GRANT ALL ON FUNCTION public.staff_find_players(_query text) TO authenticated;


--
-- Name: FUNCTION staff_generate_matches(_division_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_generate_matches(_division_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_generate_matches(_division_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_generate_matches(_division_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_get_schedule(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_get_schedule(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_get_schedule(_date date) TO service_role;
GRANT ALL ON FUNCTION public.staff_get_schedule(_date date) TO authenticated;


--
-- Name: FUNCTION staff_list_payments(_status public.payment_status, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_list_payments(_status public.payment_status, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_list_payments(_status public.payment_status, _limit integer) TO service_role;
GRANT ALL ON FUNCTION public.staff_list_payments(_status public.payment_status, _limit integer) TO authenticated;


--
-- Name: FUNCTION staff_list_registrations(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_list_registrations(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_list_registrations(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_list_registrations(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_lookup_players(_query text, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_lookup_players(_query text, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_lookup_players(_query text, _limit integer) TO service_role;
GRANT ALL ON FUNCTION public.staff_lookup_players(_query text, _limit integer) TO authenticated;


--
-- Name: FUNCTION staff_mark_absent(_registration_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_mark_absent(_registration_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_mark_absent(_registration_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_mark_absent(_registration_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_mark_booking_paid(_booking_id uuid, _note text, _received_centavos bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_mark_booking_paid(_booking_id uuid, _note text, _received_centavos bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_mark_booking_paid(_booking_id uuid, _note text, _received_centavos bigint) TO service_role;
GRANT ALL ON FUNCTION public.staff_mark_booking_paid(_booking_id uuid, _note text, _received_centavos bigint) TO authenticated;


--
-- Name: FUNCTION staff_mark_booking_unpaid(_booking_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_mark_booking_unpaid(_booking_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_mark_booking_unpaid(_booking_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_mark_booking_unpaid(_booking_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_mark_walk_in_paid(_registration_id uuid, _received_centavos bigint, _method public.payment_method_kind, _reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_mark_walk_in_paid(_registration_id uuid, _received_centavos bigint, _method public.payment_method_kind, _reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_mark_walk_in_paid(_registration_id uuid, _received_centavos bigint, _method public.payment_method_kind, _reference text) TO service_role;
GRANT ALL ON FUNCTION public.staff_mark_walk_in_paid(_registration_id uuid, _received_centavos bigint, _method public.payment_method_kind, _reference text) TO authenticated;


--
-- Name: FUNCTION staff_money_summary(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_money_summary(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_money_summary(_date date) TO service_role;
GRANT ALL ON FUNCTION public.staff_money_summary(_date date) TO authenticated;


--
-- Name: FUNCTION staff_queue_add(_event_id uuid, _player_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_queue_add(_event_id uuid, _player_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_queue_add(_event_id uuid, _player_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_queue_add(_event_id uuid, _player_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_queue_add_walk_in(_registration_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_queue_add_walk_in(_registration_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_queue_add_walk_in(_registration_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_queue_add_walk_in(_registration_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_queue_no_show(_entry_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_queue_no_show(_entry_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_queue_no_show(_entry_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_queue_no_show(_entry_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_queue_remove(_entry_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_queue_remove(_entry_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_queue_remove(_entry_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_queue_remove(_entry_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_record_cash_payment(_booking_id uuid, _note text, _received_centavos bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_record_cash_payment(_booking_id uuid, _note text, _received_centavos bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_record_cash_payment(_booking_id uuid, _note text, _received_centavos bigint) TO service_role;
GRANT ALL ON FUNCTION public.staff_record_cash_payment(_booking_id uuid, _note text, _received_centavos bigint) TO authenticated;


--
-- Name: FUNCTION staff_record_match_result(_match_id uuid, _score_a integer, _score_b integer, _walkover_winner uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_record_match_result(_match_id uuid, _score_a integer, _score_b integer, _walkover_winner uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_record_match_result(_match_id uuid, _score_a integer, _score_b integer, _walkover_winner uuid, _note text) TO service_role;
GRANT ALL ON FUNCTION public.staff_record_match_result(_match_id uuid, _score_a integer, _score_b integer, _walkover_winner uuid, _note text) TO authenticated;


--
-- Name: FUNCTION staff_record_refund(_booking_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_record_refund(_booking_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_record_refund(_booking_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_record_refund(_booking_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_register_player(_event_id uuid, _player_id uuid, _division_id uuid, _partner_id uuid, _waive_fee boolean, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_register_player(_event_id uuid, _player_id uuid, _division_id uuid, _partner_id uuid, _waive_fee boolean, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_register_player(_event_id uuid, _player_id uuid, _division_id uuid, _partner_id uuid, _waive_fee boolean, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_register_player(_event_id uuid, _player_id uuid, _division_id uuid, _partner_id uuid, _waive_fee boolean, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_release_event_court(_slot_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_release_event_court(_slot_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_release_event_court(_slot_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_release_event_court(_slot_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_remove_block(_slot_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_remove_block(_slot_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_remove_block(_slot_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_remove_block(_slot_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_review_payment(_payment_id uuid, _approve boolean, _reason text, _received_centavos bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_review_payment(_payment_id uuid, _approve boolean, _reason text, _received_centavos bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_review_payment(_payment_id uuid, _approve boolean, _reason text, _received_centavos bigint) TO service_role;
GRANT ALL ON FUNCTION public.staff_review_payment(_payment_id uuid, _approve boolean, _reason text, _received_centavos bigint) TO authenticated;


--
-- Name: FUNCTION staff_schedule_match(_match_id uuid, _court_id uuid, _starts_at timestamp with time zone, _ends_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_schedule_match(_match_id uuid, _court_id uuid, _starts_at timestamp with time zone, _ends_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_schedule_match(_match_id uuid, _court_id uuid, _starts_at timestamp with time zone, _ends_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.staff_schedule_match(_match_id uuid, _court_id uuid, _starts_at timestamp with time zone, _ends_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION staff_search_bookings(_query text, _from date, _to date, _status public.booking_status, _payment_status public.booking_payment_status, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_search_bookings(_query text, _from date, _to date, _status public.booking_status, _payment_status public.booking_payment_status, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_search_bookings(_query text, _from date, _to date, _status public.booking_status, _payment_status public.booking_payment_status, _limit integer) TO service_role;
GRANT ALL ON FUNCTION public.staff_search_bookings(_query text, _from date, _to date, _status public.booking_status, _payment_status public.booking_payment_status, _limit integer) TO authenticated;


--
-- Name: FUNCTION staff_search_payments(_query text, _status public.payment_status, _from date, _to date, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_search_payments(_query text, _status public.payment_status, _from date, _to date, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_search_payments(_query text, _status public.payment_status, _from date, _to date, _limit integer) TO service_role;
GRANT ALL ON FUNCTION public.staff_search_payments(_query text, _status public.payment_status, _from date, _to date, _limit integer) TO authenticated;


--
-- Name: FUNCTION staff_set_court_lane(_event_id uuid, _court_id uuid, _division_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_set_court_lane(_event_id uuid, _court_id uuid, _division_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_set_court_lane(_event_id uuid, _court_id uuid, _division_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_set_court_lane(_event_id uuid, _court_id uuid, _division_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_set_player_level(_user_id uuid, _level public.player_level, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_set_player_level(_user_id uuid, _level public.player_level, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_set_player_level(_user_id uuid, _level public.player_level, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.staff_set_player_level(_user_id uuid, _level public.player_level, _reason text) TO authenticated;


--
-- Name: FUNCTION staff_start_game(_game_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_start_game(_game_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_start_game(_game_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_start_game(_game_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_start_session(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_start_session(_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_start_session(_event_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.staff_start_session(_event_id uuid) TO authenticated;


--
-- Name: FUNCTION submit_payment(_booking_id uuid, _payment_method_id uuid, _proof_path text, _reference_no text, _proof_sha256 text, _amount_centavos bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_payment(_booking_id uuid, _payment_method_id uuid, _proof_path text, _reference_no text, _proof_sha256 text, _amount_centavos bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_payment(_booking_id uuid, _payment_method_id uuid, _proof_path text, _reference_no text, _proof_sha256 text, _amount_centavos bigint) TO service_role;
GRANT ALL ON FUNCTION public.submit_payment(_booking_id uuid, _payment_method_id uuid, _proof_path text, _reference_no text, _proof_sha256 text, _amount_centavos bigint) TO authenticated;


--
-- Name: FUNCTION withdraw_registration(_registration_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.withdraw_registration(_registration_id uuid, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.withdraw_registration(_registration_id uuid, _reason text) TO service_role;
GRANT ALL ON FUNCTION public.withdraw_registration(_registration_id uuid, _reason text) TO authenticated;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO service_role;
GRANT SELECT ON TABLE public.audit_log TO authenticated;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;


--
-- Name: TABLE booking_slots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_slots TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booking_slots TO authenticated;


--
-- Name: TABLE check_ins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.check_ins TO service_role;
GRANT SELECT ON TABLE public.check_ins TO authenticated;


--
-- Name: TABLE courts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.courts TO service_role;
GRANT SELECT ON TABLE public.courts TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.courts TO authenticated;


--
-- Name: TABLE event_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_categories TO service_role;
GRANT SELECT ON TABLE public.event_categories TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.event_categories TO authenticated;


--
-- Name: TABLE event_court_lanes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_court_lanes TO service_role;
GRANT SELECT ON TABLE public.event_court_lanes TO authenticated;


--
-- Name: TABLE event_divisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_divisions TO service_role;
GRANT SELECT ON TABLE public.event_divisions TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.event_divisions TO authenticated;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO service_role;
GRANT SELECT ON TABLE public.notifications TO authenticated;


--
-- Name: TABLE operating_hour_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operating_hour_exceptions TO service_role;
GRANT SELECT ON TABLE public.operating_hour_exceptions TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.operating_hour_exceptions TO authenticated;


--
-- Name: TABLE operating_hours; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operating_hours TO service_role;
GRANT SELECT ON TABLE public.operating_hours TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.operating_hours TO authenticated;


--
-- Name: TABLE payment_methods; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_methods TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payment_methods TO authenticated;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO service_role;
GRANT SELECT ON TABLE public.payments TO authenticated;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.full_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(full_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.display_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(display_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.phone; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(phone) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.self_rated_level; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(self_rated_level) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.leaderboard_opt_out; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(leaderboard_opt_out) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE queue_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.queue_entries TO service_role;
GRANT SELECT ON TABLE public.queue_entries TO authenticated;


--
-- Name: TABLE queue_games; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.queue_games TO service_role;
GRANT SELECT ON TABLE public.queue_games TO authenticated;


--
-- Name: TABLE rate_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_rules TO service_role;
GRANT SELECT ON TABLE public.rate_rules TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rate_rules TO authenticated;


--
-- Name: SEQUENCE sale_reference_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sale_reference_seq TO service_role;


--
-- Name: TABLE schedule_signals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.schedule_signals TO service_role;
GRANT SELECT ON TABLE public.schedule_signals TO anon;
GRANT SELECT ON TABLE public.schedule_signals TO authenticated;


--
-- Name: TABLE staff_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_permissions TO service_role;
GRANT SELECT ON TABLE public.staff_permissions TO authenticated;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT SELECT ON TABLE public.user_roles TO authenticated;


--
-- Name: TABLE venue_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venue_settings TO service_role;
GRANT SELECT ON TABLE public.venue_settings TO anon;
GRANT SELECT,UPDATE ON TABLE public.venue_settings TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--




-- ============================================================================
-- Outside the public and private schemas
-- ============================================================================
reset row_security;

-- New sign-ins get a profile (staff accounts are created by an admin).
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Storage buckets: all private except venue assets (public photos for the site).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('payment-proofs', 'payment-proofs', false, 5242880, '{image/jpeg,image/png,image/webp}'),
  ('payment-qr', 'payment-qr', false, 2097152, '{image/jpeg,image/png,image/webp}'),
  ('venue-assets', 'venue-assets', true, 5242880, '{image/jpeg,image/png,image/webp,image/svg+xml}')
on conflict (id) do nothing;

create policy "Admins delete payment QR codes" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'payment-qr'::text) AND ( SELECT private.is_admin() AS is_admin)));
create policy "Admins update payment QR codes" on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'payment-qr'::text) AND ( SELECT private.is_admin() AS is_admin))) with check (((bucket_id = 'payment-qr'::text) AND ( SELECT private.is_admin() AS is_admin)));
create policy "Admins upload payment QR codes" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'payment-qr'::text) AND ( SELECT private.is_admin() AS is_admin)));
create policy "Content managers delete venue assets" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'venue-assets'::text) AND ( SELECT private.has_permission('content.manage'::public.app_permission) AS has_permission)));
create policy "Content managers read venue assets" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'venue-assets'::text) AND ( SELECT private.has_permission('content.manage'::public.app_permission) AS has_permission)));
create policy "Content managers update venue assets" on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'venue-assets'::text) AND ( SELECT private.has_permission('content.manage'::public.app_permission) AS has_permission))) with check (((bucket_id = 'venue-assets'::text) AND ( SELECT private.has_permission('content.manage'::public.app_permission) AS has_permission)));
create policy "Content managers upload venue assets" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'venue-assets'::text) AND ( SELECT private.has_permission('content.manage'::public.app_permission) AS has_permission)));
create policy "Payment verifiers read all proofs" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'payment-proofs'::text) AND ( SELECT private.has_permission('payments.verify'::public.app_permission) AS has_permission)));
create policy "Signed-in users view payment QR codes" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'payment-qr'::text));

-- Booking jobs every minute (hold expiry, unpaid-booking deadline). Without
-- pg_cron the jobs still run before every hold.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('ph-booking-jobs', '* * * * *', 'select private.run_booking_jobs()');
    exception when others then
      raise notice 'pg_cron could not be scheduled (%). Enable it in the dashboard and run: select cron.schedule(''ph-booking-jobs'', ''* * * * *'', ''select private.run_booking_jobs()'');', sqlerrm;
    end;
  end if;
end $$;

-- ============================================================================
-- Seed data: facts confirmed by the owner, 23 Nov 2026
-- ============================================================================
insert into public.venue_settings (name, tagline, street_address, city, province)
values ('Picklehouse Matanao', 'dine, drink, enjoy', 'Purok 3, New Visayas', 'Matanao', 'Davao del Sur');

-- Monday to Sunday, 8:00 AM – 11:00 PM.
insert into public.operating_hours (weekday, is_closed, opens_at, closes_at)
select d, false, '08:00', '23:00' from generate_series(0, 6) d;

-- Amounts confirmed; the basis (per court or per player, per hour) is not, so
-- unit stays null: the rates are shown but cannot be booked until an admin
-- sets the basis. The 10:00 – 11:00 PM rate is not confirmed and is absent.
insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit, tier) values
  ('court_rental', 'Daytime', '08:00', '17:00', 10000, null, 'standard'),
  ('court_rental', 'Evening', '17:00', '22:00', 20000, null, 'standard');

-- GCash stays inactive until an admin enters the account details.
insert into public.payment_methods (kind, label, is_active, sort_order) values
  ('gcash', 'GCash', false, 1),
  ('cash', 'Cash at the desk', true, 2);

-- No courts are seeded: the number of courts is not confirmed.
