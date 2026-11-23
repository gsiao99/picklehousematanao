-- ============================================================================
-- Open play sessions can be deleted even when players have registered
--
-- Deleting an upcoming session cancels it first, through the same path as
-- staff_cancel_event: players are told, courts are freed, unpaid entry fees
-- are cancelled and paid ones are marked refund due. Then the session is
-- deleted (its registrations, queue and court reservations go with it).
-- Payment records stay on their bookings and check-ins stay in play history.
--
-- Tournaments and other events keep the old rule: once players are involved
-- they can only be cancelled.
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
  if _e.event_type = 'open_play' then
    if _e.status not in ('cancelled', 'completed') then
      perform set_config('app.audit_reason', 'Cancelled before deletion: ' || _why, true);
      update public.events set status = 'cancelled', cancel_reason = left(_why, 300) where id = _e.id;
    end if;
    perform set_config('app.audit_reason', 'Event deleted: ' || _why, true);
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

revoke all on function public.staff_delete_event(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_delete_event(uuid, text) to authenticated;
