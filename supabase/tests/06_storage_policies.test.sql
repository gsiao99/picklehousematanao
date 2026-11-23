-- Storage: private payment proofs and avatars, public venue assets.
-- Rows in storage.objects are what Supabase Storage writes as the caller.
begin;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('44444444-4444-4444-8444-444444444444', 'payments.verify');
insert into public.bookings (id, player_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');

-- ---- Ana (player) -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select lives_ok($$ insert into storage.objects (bucket_id, name, owner) values ('payment-proofs',
  '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/receipt.jpg',
  '11111111-1111-4111-8111-111111111111') $$,
  'a player can upload a proof for their own booking');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs',
  '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/fake.jpg') $$,
  '42501', null, 'a player cannot upload into another player''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs',
  '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/fake.jpg') $$,
  '42501', null, 'a player cannot attach a proof to someone else''s booking');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs',
  '11111111-1111-4111-8111-111111111111/receipt.jpg') $$,
  '42501', null, 'a proof must sit in a booking folder');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'a player can read their own proof');
select is_empty($$ update storage.objects set name = name || '.bak' where bucket_id = 'payment-proofs' returning id $$,
  'a player cannot overwrite or rename a submitted proof');
select is_empty($$ delete from storage.objects where bucket_id = 'payment-proofs' returning id $$,
  'a player cannot delete a submitted proof');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('avatars',
  '11111111-1111-4111-8111-111111111111/avatar.webp') $$,
  'a player can upload their own avatar');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('avatars',
  '22222222-2222-4222-8222-222222222222/avatar.webp') $$,
  '42501', null, 'a player cannot upload someone else''s avatar');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('venue-assets', 'courts/court-1.jpg') $$,
  '42501', null, 'a player cannot upload venue images');

-- ---- Ben (player) ----------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is_empty($$ select 1 from storage.objects where bucket_id in ('payment-proofs', 'avatars') $$,
  'another player cannot see Ana''s proof or avatar');

-- ---- Anonymous visitor -------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'visitors cannot list payment proofs');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs',
  '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.jpg') $$,
  '42501', null, 'visitors cannot upload proofs');

-- ---- Carla (staff, no permissions) ----------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'staff without payments.verify cannot open payment proofs');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'avatars' $$,
  'staff can see player avatars at the desk');

-- ---- Dan (payments.verify) ----------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'a payment verifier can open payment proofs');

-- ---- Lea (admin) -------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('venue-assets', 'courts/court-1.jpg') $$,
  'an admin can upload venue images');

reset role;
select * from finish();
rollback;
