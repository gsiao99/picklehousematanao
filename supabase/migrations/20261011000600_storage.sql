-- ============================================================================
-- Storage buckets and object policies
--
--   payment-proofs  private  {player_id}/{booking_id}/{file}  JPEG/PNG/WebP ≤ 5 MB
--   avatars         private  {user_id}/{file}                 JPEG/PNG/WebP ≤ 2 MB
--   venue-assets    public   court photos, payment QR codes    JPEG/PNG/WebP/SVG ≤ 5 MB
--
-- Private files are only ever served through short-lived signed URLs.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('venue-assets', 'venue-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Does this object path start with the caller's id and (for proofs) one of
-- the caller's bookings?
create or replace function private.proof_path_is_mine(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
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

revoke all on function private.proof_path_is_mine(text) from public;
grant execute on function private.proof_path_is_mine(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- payment-proofs: players upload into their own booking folder and read
-- their own files. Payment verifiers read everything. Nobody overwrites or
-- deletes a proof through the API — proofs are evidence.
-- ---------------------------------------------------------------------------
create policy "Players upload proofs for their own bookings"
on storage.objects for insert
to authenticated
with check (bucket_id = 'payment-proofs' and private.proof_path_is_mine(name));

create policy "Players read their own proofs"
on storage.objects for select
to authenticated
using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Payment verifiers read all proofs"
on storage.objects for select
to authenticated
using (bucket_id = 'payment-proofs' and (select private.has_permission('payments.verify')));

-- ---------------------------------------------------------------------------
-- avatars: owner manages their folder; staff can view
-- ---------------------------------------------------------------------------
create policy "Users upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and cardinality(storage.foldername(name)) = 1
);

create policy "Users replace their own avatar"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own avatar"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users and staff view avatars"
on storage.objects for select
to authenticated
using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_staff()))
);

-- ---------------------------------------------------------------------------
-- venue-assets: public bucket (served without auth); content managers write
-- ---------------------------------------------------------------------------
create policy "Content managers upload venue assets"
on storage.objects for insert
to authenticated
with check (bucket_id = 'venue-assets' and (select private.has_permission('content.manage')));

create policy "Content managers update venue assets"
on storage.objects for update
to authenticated
using (bucket_id = 'venue-assets' and (select private.has_permission('content.manage')))
with check (bucket_id = 'venue-assets' and (select private.has_permission('content.manage')));

create policy "Content managers delete venue assets"
on storage.objects for delete
to authenticated
using (bucket_id = 'venue-assets' and (select private.has_permission('content.manage')));
