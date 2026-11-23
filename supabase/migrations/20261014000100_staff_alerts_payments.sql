-- ============================================================================
-- Staff activity notifications: payments and booking links
--
--   * A rejected payment now notifies the rest of the team ("Payment
--     rejected"), so every payment outcome rings the admin bell.
--   * Booking notifications open the booking's details page instead of a
--     search for its reference.
-- Same function as 20261013000300, with those two changes.
-- ============================================================================

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

revoke all on function private.audit_to_staff_notification() from public;
