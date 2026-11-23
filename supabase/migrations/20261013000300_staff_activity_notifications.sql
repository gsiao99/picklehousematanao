-- ============================================================================
-- Staff activity notifications
--
-- Every change worth knowing about already lands in audit_log (written by
-- triggers on bookings, payments, events, registrations, roles, settings…).
-- A trigger on audit_log turns each entry into a short 'staff_activity'
-- notification for every active staff member and admin, so the dashboard
-- bell (and its sound) covers all activity however it happened: the app,
-- the database's own jobs, or the SQL editor.
--
--   * The person who did it is not notified about their own action.
--   * Routine noise is skipped: carts being filled or expiring, open play
--     queue moves, players editing their own profile.
--   * The same title and text for the same person within 20 seconds is sent
--     once (e.g. five permissions changed in one save → one notification).
--   * It can never block the action itself: any error here is swallowed.
-- ============================================================================

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'payment_submitted', 'payment_approved', 'payment_rejected', 'booking_cancelled', 'refund_recorded',
  'registration_confirmed', 'registration_pending_payment', 'registration_cancelled', 'partner_added',
  'event_cancelled', 'queue_called', 'match_scheduled', 'staff_activity'));

-- Everyone on the club team (active staff and admins), except the actor.
create or replace function private.notify_staff(_title text, _body text, _link text, _actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
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

create or replace function private.peso(_centavos bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '₱' || to_char(coalesce(_centavos, 0) / 100.0, 'FM999,999,990.00');
$$;

-- When and where a booking plays: "Court 2 · Tue, Oct 13 · 5:00 PM" (first slot).
create or replace function private.booking_when(_booking_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.name || ' · ' || to_char(lower(bs.slot) at time zone private.venue_time_zone(), 'Dy, Mon FMDD') || ' · '
         || private.fmt_time(lower(bs.slot))
         || case when count(*) over () > 1 then ' (+' || (count(*) over () - 1) || ' more)' else '' end
  from public.booking_slots bs join public.courts c on c.id = bs.court_id
  where bs.booking_id = _booking_id
  order by lower(bs.slot)
  limit 1;
$$;

create or replace function private.audit_to_staff_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    _link := '/admin/bookings?q=' || (_d ->> 'reference');
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

create trigger audit_log_notify_staff
after insert on public.audit_log
for each row execute function private.audit_to_staff_notification();

revoke all on function
  private.notify_staff(text, text, text, uuid),
  private.peso(bigint),
  private.booking_when(uuid),
  private.audit_to_staff_notification()
  from public;
