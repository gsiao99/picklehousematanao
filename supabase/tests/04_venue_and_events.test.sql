-- Public venue data, admin-only writes, staff permission scoping, events.
begin;
select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('44444444-4444-4444-8444-444444444444', 'schedule.manage'),
  ('44444444-4444-4444-8444-444444444444', 'openplay.manage');

insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit, is_active) values
  ('court_rental', 'Test active rate', '12:00', '17:00', 100, 'per_court_hour', true),
  ('court_rental', 'Test retired rate', '17:00', '23:00', 100, 'per_court_hour', false);
insert into public.events (slug, title, event_type, starts_at, ends_at, status) values
  ('test-draft', 'Draft event', 'tournament', now() + interval '10 days', now() + interval '11 days', 'draft'),
  ('test-open', 'Published event', 'tournament', now() + interval '12 days', now() + interval '13 days', 'registration_open');

-- ---- Anonymous visitor ------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is((select count(*)::int from public.courts), 3, 'visitors can see the three courts');
select is((select name from public.venue_settings), 'Picklehouse Matanao', 'visitors can read venue settings');
select is((select count(*)::int from public.rate_rules), 1, 'visitors see active rates only');
select is((select count(*)::int from public.events), 1, 'visitors see published events, not drafts');
select throws_ok($$ insert into public.courts (number, name) values (9, 'Court 9') $$,
  '42501', null, 'visitors cannot add courts');
select throws_ok($$ update public.rate_rules set price_centavos = 0 $$,
  '42501', null, 'visitors cannot change rates');

-- ---- Ana (player) -----------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select throws_ok($$ insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit)
                   values ('court_rental', 'Free', '06:00', '07:00', 0, 'per_court_hour') $$,
  '42501', null, 'a player cannot create rates');
select is_empty($$ update public.courts set status = 'maintenance' returning id $$, 'a player cannot change courts');
select is_empty($$ update public.venue_settings set name = 'Hacked' returning id $$, 'a player cannot change venue settings');
select throws_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at)
                   values ('mine', 'My event', 'social', now(), now() + interval '1 hour') $$,
  '42501', null, 'a player cannot create events');

-- ---- Carla (staff, no permissions) -------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select is_empty($$ update public.courts set status = 'maintenance' returning id $$,
  'staff without schedule.manage cannot change courts');
select throws_ok($$ insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit)
                   values ('court_rental', 'Staff rate', '06:00', '07:00', 0, 'per_court_hour') $$,
  '42501', null, 'staff cannot create rates');

-- ---- Dan (staff with schedule.manage + openplay.manage) -----------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select isnt_empty($$ update public.courts set status = 'maintenance' where number = 3 returning id $$,
  'a schedule manager can put a court into maintenance');
select is_empty($$ update public.venue_settings set booking_window_days = 90 returning id $$,
  'a schedule manager still cannot change venue settings');
select lives_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at, status)
                  values ('morning-open-play', 'Morning open play', 'open_play', now() + interval '1 day',
                          now() + interval '1 day 3 hours', 'published') $$,
  'an open play manager can create an open play session');
select throws_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at)
                   values ('dan-cup', 'Dan Cup', 'tournament', now(), now() + interval '1 day') $$,
  '42501', null, 'an open play manager cannot create tournaments');

-- ---- Lea (admin) ------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);

select lives_ok($$ insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit)
                  values ('open_play', 'Admin rate', '06:00', '12:00', 100, 'per_player') $$,
  'an admin can create rates');
select throws_ok($$ insert into public.payment_methods (kind, label, is_active) values ('gcash', 'GCash', true) $$,
  '23514', null, 'an active GCash account needs an account name and number');
select lives_ok($$ insert into public.payment_methods (kind, label, account_name, account_number, is_active)
                  values ('gcash', 'GCash', 'Test Account', '09000000000', true) $$,
  'an admin can add a complete payment account');
select is((select count(*)::int from public.audit_log where table_name = 'rate_rules'
           and actor_id = '55555555-5555-4555-8555-555555555555'), 1,
  'rate changes are recorded in the audit log');

reset role;
select * from finish();
rollback;
