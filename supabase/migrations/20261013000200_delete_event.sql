-- ============================================================================
-- Delete an event that nobody is involved in yet
--
-- Deleting an event removes its divisions, court reservations, matches and
-- queue with it (they cascade). That is only safe for a mistake or an unused
-- event, so the function refuses as soon as any player is involved:
-- registrations (any status), check-ins, entry-fee bookings, matches or
-- queue games. Those events are cancelled instead (staff_cancel_event), which
-- tells players and keeps refunds and history intact.
--
-- The delete is recorded in audit_log (events_audit trigger) with the reason.
-- ============================================================================

create or replace function public.staff_delete_event(_event_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.require_event_manager(_event_id);
  _why text := private.require_reason(_reason);
begin
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
  -- Its court reservations, divisions and settings go with it; the freed
  -- court times are signalled to open schedules by the booking_slots trigger.
  delete from public.events where id = _e.id;
end;
$$;

revoke all on function public.staff_delete_event(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_delete_event(uuid, text) to authenticated;
