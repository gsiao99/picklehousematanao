-- ============================================================================
-- Link a tournament photo set to its event
--
--   * gallery_photos.event_id: the event a photo set belongs to (the same on
--     every photo of the set). The homepage then shows that event's poster,
--     title, date and divisions above the photos ("Past tournament").
--   * staff_link_gallery_album: content managers pick (or clear) the event.
--   * get_gallery / staff_list_gallery also return the event details.
--
-- Additive: a new nullable column, a new function, and two functions recreated
-- with extra columns (callers reading the old columns keep working).
-- ============================================================================

alter table public.gallery_photos
  add column if not exists event_id uuid references public.events (id) on delete set null;

comment on column public.gallery_photos.event_id is
  'The event this photo set belongs to (same on every photo of the set); its poster and details show above the photos.';

-- Staff (content.manage): link a photo set to an event, or clear it (null).
create or replace function public.staff_link_gallery_album(_album text, _event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  if _event_id is not null and not exists (select 1 from public.events where id = _event_id and status <> 'draft') then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  perform set_config('app.audit_reason', 'Tournament photo set linked to an event', true);
  update public.gallery_photos set event_id = _event_id where album = _album;
  if not found then
    raise exception 'That photo set no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

-- Anyone: the homepage set, with its event's details (null when not linked).
drop function public.get_gallery();
create function public.get_gallery()
returns table (
  id uuid, album text, storage_path text, caption text, width int, height int, sort_order int,
  event_id uuid, event_title text, event_starts_at timestamptz, event_divisions text[], event_has_poster boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.album, g.storage_path, g.caption, g.width, g.height, g.sort_order,
         e.id, e.title, e.starts_at,
         (select array_agg(d.name order by d.sort_order, d.name) from public.event_divisions d where d.event_id = e.id),
         (e.id is not null and exists (select 1 from storage.objects o
                                        where o.bucket_id = 'venue-assets' and o.name = 'events/' || e.id::text || '/poster'))
  from public.gallery_photos g
  left join public.events e on e.id = g.event_id and e.status <> 'draft'
  where g.album = (select album from public.gallery_photos order by created_at desc, id limit 1)
  order by g.sort_order, g.created_at;
$$;

-- Staff: every photo, newest set first, with the linked event.
drop function public.staff_list_gallery();
create function public.staff_list_gallery()
returns table (
  id uuid, album text, storage_path text, caption text, width int, height int, sort_order int, created_at timestamptz,
  event_id uuid, event_title text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  return query
  select g.id, g.album, g.storage_path, g.caption, g.width, g.height, g.sort_order, g.created_at, e.id, e.title
  from public.gallery_photos g
  left join public.events e on e.id = g.event_id
  order by (select max(x.created_at) from public.gallery_photos x where x.album = g.album) desc, g.album, g.sort_order, g.created_at;
end;
$$;

-- New photos join their set's event automatically.
create or replace function private.gallery_inherit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_id is null then
    select g.event_id into new.event_id from public.gallery_photos g
     where g.album = new.album and g.event_id is not null limit 1;
  end if;
  return new;
end;
$$;
revoke all on function private.gallery_inherit_event() from public;
create trigger gallery_photos_inherit_event before insert on public.gallery_photos
for each row execute function private.gallery_inherit_event();

revoke all on function
  public.get_gallery(),
  public.staff_list_gallery(),
  public.staff_link_gallery_album(text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_gallery() to anon, authenticated;
grant execute on function public.staff_list_gallery(), public.staff_link_gallery_album(text, uuid) to authenticated;
