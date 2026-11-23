-- Tournament photos: everyone sees the newest photo set; only content managers
-- (and admins) add, caption, reorder, rename or remove photos. Photos and
-- files below are TEST FIXTURES inside this rolled-back transaction.
begin;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-4000-8000-000000000001', 'photoadmin@test.local', '{"full_name":"Pia Admin"}'),
  ('f0000000-0000-4000-8000-000000000002', 'photostaff@test.local', '{"full_name":"Cam Staff"}'),
  ('f0000000-0000-4000-8000-000000000003', 'plainstaff@test.local', '{"full_name":"Rio Staff"}');
insert into public.user_roles (user_id, role) values
  ('f0000000-0000-4000-8000-000000000001', 'admin'),
  ('f0000000-0000-4000-8000-000000000002', 'staff'),
  ('f0000000-0000-4000-8000-000000000003', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('f0000000-0000-4000-8000-000000000002', 'content.manage');

-- A finished tournament with two divisions and a poster (test fixtures).
insert into public.events (id, slug, title, event_type, starts_at, ends_at, status) values
  ('f2000000-0000-4000-8000-000000000001', 'test-photo-cup', 'Test Photo Cup', 'tournament', now() - interval '7 days', now() - interval '6 days', 'completed'),
  ('f2000000-0000-4000-8000-000000000002', 'test-draft-cup', 'Test Draft Cup', 'tournament', now() + interval '7 days', now() + interval '8 days', 'draft');
insert into public.event_categories (id, name, slug) values ('f3000000-0000-4000-8000-000000000001', 'Test Photo Level', 'test-photo-level');
insert into public.event_divisions (event_id, category_id, name, sort_order) values
  ('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'Test Novice', 2),
  ('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'Test Rookie', 1);

-- Uploaded files (what Supabase Storage records on upload).
insert into storage.objects (bucket_id, name) values
  ('venue-assets', 'gallery/f1000000-0000-4000-8000-000000000001.webp'),
  ('venue-assets', 'gallery/f1000000-0000-4000-8000-000000000002.webp'),
  ('venue-assets', 'gallery/f1000000-0000-4000-8000-000000000003.webp'),
  ('venue-assets', 'events/f2000000-0000-4000-8000-000000000001/poster');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.staff_add_gallery_photo('f1000000-0000-4000-8000-000000000001', 'Opening tournament') $$,
  '42501', null, 'staff without the content permission cannot add photos');

select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.staff_add_gallery_photo('f1000000-0000-4000-8000-000000000009', 'Opening tournament') $$,
  '22023', null, 'a photo whose file was never uploaded is refused');
select throws_ok($$ select public.staff_add_gallery_photo('f1000000-0000-4000-8000-000000000001', ' ') $$,
  '22023', null, 'the photo set needs a name');
select lives_ok($$ select public.staff_add_gallery_photo('f1000000-0000-4000-8000-000000000001', 'Opening tournament', 'Finals') $$,
  'a content manager adds a photo');
select lives_ok($$ select public.staff_add_gallery_photo('f1000000-0000-4000-8000-000000000002', 'Opening tournament') $$,
  'and a second one');
select is((select string_agg(storage_path, ',' order by sort_order) from public.staff_list_gallery()),
  'gallery/f1000000-0000-4000-8000-000000000001.webp,gallery/f1000000-0000-4000-8000-000000000002.webp', 'photos go to the end of the set');
select lives_ok($$ select public.staff_move_gallery_photo('f1000000-0000-4000-8000-000000000002', -1) $$, 'a photo moves up');
select is((select string_agg(storage_path, ',' order by sort_order) from public.staff_list_gallery()),
  'gallery/f1000000-0000-4000-8000-000000000002.webp,gallery/f1000000-0000-4000-8000-000000000001.webp', 'the order is swapped');
select lives_ok($$ select public.staff_set_gallery_caption('f1000000-0000-4000-8000-000000000002', 'Opening ceremony') $$, 'captions can change');
select throws_ok($$ select public.staff_reorder_gallery_album('Opening tournament', array['f1000000-0000-4000-8000-000000000001']::uuid[]) $$,
  '22023', null, 'a new order that leaves out a photo is refused');
select lives_ok($$ select public.staff_reorder_gallery_album('Opening tournament',
  array['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002']::uuid[]) $$, 'a whole new order is saved in one step');
select is((select string_agg(storage_path, ',' order by sort_order) from public.staff_list_gallery()),
  'gallery/f1000000-0000-4000-8000-000000000001.webp,gallery/f1000000-0000-4000-8000-000000000002.webp', 'in that order');
select throws_ok($$ select public.staff_link_gallery_album('Opening tournament', 'f2000000-0000-4000-8000-000000000002') $$,
  'P0002', null, 'a draft event cannot be linked');
select lives_ok($$ select public.staff_link_gallery_album('Opening tournament', 'f2000000-0000-4000-8000-000000000001') $$,
  'a photo set is linked to its tournament');
select lives_ok($$ select public.staff_add_gallery_photo('f1000000-0000-4000-8000-000000000003', 'Opening tournament') $$,
  'a photo added later');
select is((select event_title from public.staff_list_gallery() where id = 'f1000000-0000-4000-8000-000000000003'), 'Test Photo Cup',
  'joins the set''s event by itself');

-- Visitors
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(caption, ',' order by sort_order) from public.get_gallery() where caption is not null), 'Finals,Opening ceremony',
  'visitors see the set, in order, with captions');
select throws_ok($$ select * from public.gallery_photos $$, '42501', null, 'visitors cannot read the table itself');
select is((select array[event_title, array_to_string(event_divisions, ','), event_has_poster::text] from public.get_gallery() limit 1),
  array['Test Photo Cup', 'Test Rookie,Test Novice', 'true'], 'visitors see the event title, divisions in order, and that it has a poster');
select throws_ok($$ select public.staff_delete_gallery_photo('f1000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'visitors cannot remove photos');

-- Admin
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.staff_delete_gallery_photo('f1000000-0000-4000-8000-000000000001'),
  'gallery/f1000000-0000-4000-8000-000000000001.webp', 'an admin removes a photo and gets its file path back');
select lives_ok($$ select public.staff_rename_gallery_album('Opening tournament', 'From the opening tournament') $$,
  'a photo set can be renamed');

select * from finish();
rollback;
