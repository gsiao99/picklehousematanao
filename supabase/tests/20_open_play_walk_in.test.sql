-- Open play walk-ins: added by open play staff, checked in, put in the stack
-- by name, one place each, removed from the stack when cancelled; wins are
-- counted per walk-in. Sessions and fees are TEST FIXTURES (rolled back).
begin;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-4000-8000-000000000001', 'opstaff@test.local', '{"full_name":"Ola Staff"}'),
  ('b1000000-0000-4000-8000-000000000002', 'plain@test.local', '{"full_name":"Pip Staff"}');
insert into public.user_roles (user_id, role) values
  ('b1000000-0000-4000-8000-000000000001', 'staff'),
  ('b1000000-0000-4000-8000-000000000002', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('b1000000-0000-4000-8000-000000000001', 'openplay.manage');

select set_config('app.audit_reason', 'Test fixtures', true);
insert into public.event_categories (id, name, slug) values ('b2000000-0000-4000-8000-000000000001', 'Test OP Level', 'test-op-level');
insert into public.events (id, slug, title, event_type, starts_at, ends_at, status, fee_centavos, fee_unit) values
  ('b3000000-0000-4000-8000-000000000001', 'test-op-walk', 'Test OP Night', 'open_play', now() - interval '1 hour', now() + interval '2 hours',
   'registration_open', 15000, 'per_player');
insert into public.event_divisions (id, event_id, category_id, name, sort_order, team_size) values
  ('b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Test Novice Stack', 1, 1);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_add_walk_in('b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
  'Gio Walk', null, null, null, 15000, 'cash') $$, '42501', null, 'staff without open play permission cannot add walk-ins');

select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.admin_add_walk_in('b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
  'Gio Walk', null, null, null, 15000, 'cash') $$, 'open play staff add a paid walk-in to a level stack');
select throws_ok($$ select public.staff_queue_add_walk_in((select id from public.event_registrations where guest_name = 'Gio Walk')) $$,
  '22023', null, 'a walk-in must be checked in before joining the stack');
select lives_ok($$ select public.staff_check_in((select id from public.event_registrations where guest_name = 'Gio Walk')) $$,
  'the walk-in is checked in');
select is((select count(*)::int from public.get_queue('b3000000-0000-4000-8000-000000000001')), 1,
  'checking in at the desk puts them in the stack');
select throws_ok($$ select public.staff_queue_add_walk_in((select id from public.event_registrations where guest_name = 'Gio Walk')) $$,
  '23505', null, 'a walk-in holds one place at a time');
select is((select player_name || ':' || division_name || ':' || queue_position from public.get_queue('b3000000-0000-4000-8000-000000000001')),
  'Gio Walk:Test Novice Stack:1', 'the stack shows the walk-in by name, in their level');
select is((select count(*)::int from public.check_ins where registration_id = (select id from public.event_registrations where guest_name = 'Gio Walk')),
  0, 'no play history is written for a walk-in');

-- A finished game counts as a win for the walk-in's registration.
reset role;
update public.queue_entries set outcome = 'won', status = 'completed'
 where registration_id = (select id from public.event_registrations where guest_name = 'Gio Walk');
select is(private.queue_wins('b3000000-0000-4000-8000-000000000001', (select id from public.event_registrations where guest_name = 'Gio Walk')),
  1, 'wins are counted per walk-in');
update public.queue_entries set outcome = null, status = 'waiting', ended_at = null
 where registration_id = (select id from public.event_registrations where guest_name = 'Gio Walk');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.staff_cancel_registration((select id from public.event_registrations where guest_name = 'Gio Walk'), 'Went home') $$,
  'the walk-in is cancelled');
select is((select count(*)::int from public.get_queue('b3000000-0000-4000-8000-000000000001')), 0, 'and leaves the stack');

select * from finish();
rollback;
