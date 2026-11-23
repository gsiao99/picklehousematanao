-- Registration trigger and profile access restrictions.
begin;
select plan(19);

-- Sign-up as Supabase Auth performs it: a row in auth.users with the
-- metadata the client sent. The client also tries to smuggle in a role.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local',
   '{"full_name":"Ana Reyes","phone":"+63 917 123 4567","self_rated_level":"novice",
     "privacy_consent":true,"role":"admin","roles":["admin","staff"],"permissions":["payments.verify"]}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local',
   '{"full_name":" ","phone":"not-a-number","self_rated_level":"pro"}');

select is((select full_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'Ana Reyes', 'sign-up creates a profile with the submitted name');
select is((select phone from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  '09171234567', 'phone is normalised to 09XXXXXXXXX');
select ok((select privacy_consent_at is not null from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'privacy consent time is recorded');
select is((select array_agg(role)::text from public.user_roles where user_id = '11111111-1111-4111-8111-111111111111'),
  '{player}', 'a role in sign-up metadata is ignored: new accounts are players only');
select is((select count(*)::int from public.staff_permissions where user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'permissions in sign-up metadata are ignored');
select is((select full_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'ben.cruz', 'a blank name falls back to the email name');
select ok((select phone is null and self_rated_level is null from public.profiles
           where id = '22222222-2222-4222-8222-222222222222'),
  'invalid phone and level values are dropped');

-- ---- Anonymous visitor ----------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok('select * from public.profiles', '42501', null, 'anonymous visitors cannot read profiles');

-- ---- Ana (player) ----------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'a player sees exactly one profile: their own');
select is_empty($$ select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$,
  'a player cannot read another player''s profile');
select lives_ok($$ update public.profiles set full_name = 'Ana Reyes-Santos', display_name = 'Ana'
                   where id = '11111111-1111-4111-8111-111111111111' $$,
  'a player can update their own name');
select is((select full_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'Ana Reyes-Santos', 'the name change is saved');
select throws_ok($$ update public.profiles set level = 'advanced' where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a player cannot set their own confirmed level');
select throws_ok($$ update public.profiles set status = 'active' where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a player cannot change their account status');
select is_empty($$ update public.profiles set full_name = 'Hacked' where id = '22222222-2222-4222-8222-222222222222' returning id $$,
  'a player cannot change another player''s profile');
select throws_ok($$ update public.profiles set phone = '12345' where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'an invalid phone number is rejected');
select throws_ok($$ insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fake') $$,
  '42501', null, 'a player cannot create profiles directly');
select throws_ok($$ delete from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a player cannot delete profiles');

-- ---- Suspended player ---------------------------------------------------------
reset role;
update public.profiles set status = 'suspended' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select is_empty($$ update public.profiles set full_name = 'Still Me' where id = '11111111-1111-4111-8111-111111111111' returning id $$,
  'a suspended player cannot edit their profile');

reset role;
select * from finish();
rollback;
