-- ============================================================================
-- Save a photo set's order in one step (drag to reorder on Club → Photos)
--
--   * staff_reorder_gallery_album(_album, _ids): the set's photos in their new
--     order. Every photo of the set must be listed exactly once, so a page that
--     is out of date (a photo added or removed meanwhile) is refused instead of
--     scrambling the order.
--
-- Additive only: one new function.
-- ============================================================================

create or replace function public.staff_reorder_gallery_album(_album text, _ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _count int;
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  perform 1 from public.gallery_photos where album = _album for update;
  select count(*) into _count from public.gallery_photos where album = _album;
  if _count = 0 then
    raise exception 'That photo set no longer exists.' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(_ids), 0) <> _count
     or (select count(distinct x) from unnest(_ids) x) <> _count
     or exists (select 1 from unnest(_ids) x
                 where not exists (select 1 from public.gallery_photos g where g.id = x and g.album = _album)) then
    raise exception 'The photos changed while you were arranging them. Reload the page and try again.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Tournament photos reordered', true);
  update public.gallery_photos g set sort_order = o.pos
    from unnest(_ids) with ordinality as o(id, pos)
   where g.id = o.id and g.sort_order is distinct from o.pos::int;
end;
$$;

revoke all on function public.staff_reorder_gallery_album(text, uuid[]) from public, anon, authenticated;
grant execute on function public.staff_reorder_gallery_album(text, uuid[]) to authenticated;
