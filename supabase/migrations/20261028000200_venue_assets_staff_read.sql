-- ============================================================================
-- venue-assets: content managers can read the bucket through the API
--
-- The bucket is public, so anyone can view its files by link, but Storage
-- also checks a SELECT policy when an upload replaces an existing file
-- (upsert). Without it, replacing an event poster was refused.
-- ============================================================================

drop policy if exists "Content managers read venue assets" on storage.objects;
create policy "Content managers read venue assets"
on storage.objects for select
to authenticated
using (bucket_id = 'venue-assets' and (select private.has_permission('content.manage')));
