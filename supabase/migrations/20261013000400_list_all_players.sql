-- ============================================================================
-- Staff player list: an empty search returns everyone (A–Z), so the admin
-- Players page can show the whole club and filter it as staff type.
-- Same columns and permissions as before; only the minimum-length rule and
-- the result cap (now up to 1000) change.
-- ============================================================================

create or replace function public.staff_lookup_players(_query text, _limit int default 25)
returns table (
  player_id uuid,
  full_name text,
  phone text,
  email text,
  level public.player_level,
  self_rated_level public.player_level,
  status public.account_status,
  bookings_total int,
  bookings_upcoming int,
  unpaid_bookings int,
  last_booking_at timestamptz,
  member_since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
