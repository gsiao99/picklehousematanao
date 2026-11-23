-- ============================================================================
-- Tournament photos on the homepage
--
--   * gallery_photos: photos grouped into a named set ("From the opening
--     tournament"). The homepage shows the set with the newest photo.
--   * Image files live in the public venue-assets bucket under gallery/:
--     {id}.webp (full size, for the viewer) and {id}-s.webp (small, for the strip).
--   * Anyone reads through get_gallery(); staff with content.manage (and
--     admins) add, caption, reorder, delete and rename through the staff_*
--     functions below. Every change is audited.
--
-- Additive only: a new table and new functions.
-- ============================================================================

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  album text not null check (char_length(btrim(album)) between 2 and 80),
  storage_path text not null unique check (storage_path ~ '^gallery/[0-9a-f-]{36}\.webp$'),
  caption text check (caption is null or char_length(caption) between 1 and 140),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  sort_order int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.gallery_photos is
  'Photos shown on the homepage (Tournaments). Files are in venue-assets/gallery/. Read through get_gallery(); changed through staff_* functions.';

create index gallery_photos_album_idx on public.gallery_photos (album, sort_order);

create trigger gallery_photos_set_updated_at before update on public.gallery_photos
for each row execute function private.set_updated_at();
create trigger gallery_photos_audit after insert or update or delete on public.gallery_photos
for each row execute function private.write_audit();

-- No direct table access from the API: everything goes through the functions.
alter table public.gallery_photos enable row level security;
create policy gallery_photos_content_read on public.gallery_photos
  for select to authenticated using ((select private.has_permission('content.manage')));
revoke all on public.gallery_photos from public, anon, authenticated;
grant select on public.gallery_photos to authenticated;

-- ---------------------------------------------------------------------------
-- Anyone: the photo set shown on the homepage (the one with the newest photo)
-- ---------------------------------------------------------------------------
create or replace function public.get_gallery()
returns table (id uuid, album text, storage_path text, caption text, width int, height int, sort_order int)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.album, g.storage_path, g.caption, g.width, g.height, g.sort_order
  from public.gallery_photos g
  where g.album = (select album from public.gallery_photos order by created_at desc, id limit 1)
  order by g.sort_order, g.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Staff (content.manage): every photo, newest set first
-- ---------------------------------------------------------------------------
create or replace function public.staff_list_gallery()
returns table (id uuid, album text, storage_path text, caption text, width int, height int, sort_order int, created_at timestamptz)
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
  select g.id, g.album, g.storage_path, g.caption, g.width, g.height, g.sort_order, g.created_at
  from public.gallery_photos g
  order by (select max(x.created_at) from public.gallery_photos x where x.album = g.album) desc, g.album, g.sort_order, g.created_at;
end;
$$;

-- Staff: add an uploaded file to a set (at the end). The file must already be in storage.
create or replace function public.staff_add_gallery_photo(
  _id uuid,
  _album text,
  _caption text default null,
  _width int default null,
  _height int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clean_album text := btrim(coalesce(_album, ''));
  _path text := 'gallery/' || _id::text || '.webp';
  _next int;
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  if char_length(_clean_album) < 2 or char_length(_clean_album) > 80 then
    raise exception 'Give the photo set a name (2 to 80 characters).' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'venue-assets' and name = _path) then
    raise exception 'The photo did not finish uploading. Try again.' using errcode = '22023';
  end if;
  select coalesce(max(sort_order), 0) + 1 into _next from public.gallery_photos where album = _clean_album;
  perform set_config('app.audit_reason', 'Tournament photo added', true);
  insert into public.gallery_photos (id, album, storage_path, caption, width, height, sort_order, created_by)
  values (_id, _clean_album, _path, nullif(left(btrim(coalesce(_caption, '')), 140), ''), _width, _height, _next, auth.uid());
  return _id;
end;
$$;

-- Staff: change a caption ('' removes it).
create or replace function public.staff_set_gallery_caption(_id uuid, _caption text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  perform set_config('app.audit_reason', 'Tournament photo caption changed', true);
  update public.gallery_photos set caption = nullif(left(btrim(coalesce(_caption, '')), 140), '') where id = _id;
  if not found then
    raise exception 'That photo no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

-- Staff: move a photo one place earlier (-1) or later (1) within its set.
create or replace function public.staff_move_gallery_photo(_id uuid, _direction int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _album text;
  _pos int;
  _count int;
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  if _direction not in (-1, 1) then
    raise exception 'Move a photo one place at a time.' using errcode = '22023';
  end if;
  select album into _album from public.gallery_photos where id = _id;
  if not found then
    raise exception 'That photo no longer exists.' using errcode = 'P0002';
  end if;
  perform 1 from public.gallery_photos where album = _album for update;
  perform set_config('app.audit_reason', 'Tournament photos reordered', true);

  -- Number the set 1..n in its current order, then swap with the neighbour.
  update public.gallery_photos g set sort_order = o.rn
    from (select id, row_number() over (order by sort_order, created_at, id)::int as rn
            from public.gallery_photos where album = _album) o
   where g.id = o.id and g.sort_order is distinct from o.rn;
  select sort_order into _pos from public.gallery_photos where id = _id;
  select count(*) into _count from public.gallery_photos where album = _album;
  if _pos + _direction < 1 or _pos + _direction > _count then
    return;
  end if;
  update public.gallery_photos
     set sort_order = case when id = _id then _pos + _direction else _pos end
   where album = _album and (id = _id or sort_order = _pos + _direction);
end;
$$;

-- Staff: remove a photo from the list; returns its file path so the page can delete the files.
create or replace function public.staff_delete_gallery_photo(_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _path text;
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  perform set_config('app.audit_reason', 'Tournament photo removed', true);
  delete from public.gallery_photos where id = _id returning storage_path into _path;
  if _path is null then
    raise exception 'That photo no longer exists.' using errcode = 'P0002';
  end if;
  return _path;
end;
$$;

-- Staff: rename a photo set (the heading shown on the homepage).
create or replace function public.staff_rename_gallery_album(_album text, _new_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clean text := btrim(coalesce(_new_name, ''));
begin
  if not private.has_permission('content.manage') then
    raise exception 'You do not have permission to manage photos.' using errcode = '42501';
  end if;
  if char_length(_clean) < 2 or char_length(_clean) > 80 then
    raise exception 'Give the photo set a name (2 to 80 characters).' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Tournament photo set renamed', true);
  update public.gallery_photos set album = _clean where album = _album;
  if not found then
    raise exception 'That photo set no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: get_gallery for everyone; the rest for signed-in users (each checks content.manage)
-- ---------------------------------------------------------------------------
revoke all on function
  public.get_gallery(),
  public.staff_list_gallery(),
  public.staff_add_gallery_photo(uuid, text, text, int, int),
  public.staff_set_gallery_caption(uuid, text),
  public.staff_move_gallery_photo(uuid, int),
  public.staff_delete_gallery_photo(uuid),
  public.staff_rename_gallery_album(text, text)
  from public, anon, authenticated;
grant execute on function public.get_gallery() to anon, authenticated;
grant execute on function
  public.staff_list_gallery(),
  public.staff_add_gallery_photo(uuid, text, text, int, int),
  public.staff_set_gallery_caption(uuid, text),
  public.staff_move_gallery_photo(uuid, int),
  public.staff_delete_gallery_photo(uuid),
  public.staff_rename_gallery_album(text, text)
  to authenticated;
