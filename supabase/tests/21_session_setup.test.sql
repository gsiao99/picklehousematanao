-- Open play session setup: walk-ins who pay later and are marked paid, check
-- in all (straight into the stack), standings per person. Sessions and fees
-- are TEST FIXTURES inside this rolled-back transaction.
begin;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'setupstaff@test.local', '{"full_name":"Sam Setup"}'),
  ('c1000000-0000-4000-8000-000000000002', 'setupadmin@test.local', '{"full_name":"Ada Setup"}');
insert into public.user_roles (user_id, role) values
  ('c1000000-0000-4000-8000-000000000001', 'staff'),
  ('c1000000-0000-4000-8000-000000000002', 'admin');
insert into public.staff_permissions (user_id, permission) values ('c1000000-0000-4000-8000-000000000001', 'openplay.manage');

select set_config('app.audit_reason', 'Test fixtures', true);
insert into public.events (id, slug, title, event_type, starts_at, ends_at, status, fee_centavos, fee_unit) values
  ('c3000000-0000-4000-8000-000000000001', 'test-setup-op', 'Test Setup Night', 'open_play', now() - interval '1 hour', now() + interval '2 hours',
   'registration_open', 15000, 'per_player'),
  ('c3000000-0000-4000-8000-000000000002', 'test-setup-cup', 'Test Setup Cup', 'tournament', now() + interval '1 day', now() + interval '2 days',
   'registration_open', 40000, 'per_player');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.admin_add_walk_in('c3000000-0000-4000-8000-000000000001', null, 'Lia Later',
  _pay_later => true) $$, 'open play walk-ins may pay later');
select is((select walk_in_fee_due_centavos from public.event_registrations where guest_name = 'Lia Later'), 15000::bigint,
  'the fee owed is kept on the entry');
select lives_ok($$ select public.admin_add_walk_in('c3000000-0000-4000-8000-000000000001', null, 'Mo Now', null, null, null, 15000, 'cash') $$,
  'another walk-in pays now');
select lives_ok($$ select public.staff_check_in_all('c3000000-0000-4000-8000-000000000001') $$, 'check in all');
select is((select count(*)::int from public.get_queue('c3000000-0000-4000-8000-000000000001') where status = 'waiting'), 2,
  'everyone checked in is in the stack');
select throws_ok($$ select public.staff_mark_walk_in_paid((select id from public.event_registrations where guest_name = 'Lia Later'), 10000, 'gcash') $$,
  '22023', null, 'less than the fee owed is refused');
select lives_ok($$ select public.staff_mark_walk_in_paid((select id from public.event_registrations where guest_name = 'Lia Later'), 15000, 'gcash', 'GC-1') $$,
  'the fee is marked paid');
select is((select centavos from public.staff_money_summary() where kind = 'walk_in_fee' and method = 'gcash'), 15000::bigint,
  'and counts in today''s money');

reset role;
update public.queue_entries set status = 'completed', outcome = 'won', ended_at = now()
 where registration_id = (select id from public.event_registrations where guest_name = 'Mo Now');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select player_name || ':' || games || ':' || wins from public.get_session_standings('c3000000-0000-4000-8000-000000000001') where rank = 1),
  'Mo Now:1:1', 'standings show games and wins per person');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_add_walk_in('c3000000-0000-4000-8000-000000000002', null, 'Tia Later', _pay_later => true) $$,
  '22023', null, 'paying later is only for open play');

select * from finish();
rollback;
