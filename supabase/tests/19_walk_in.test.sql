-- Walk-in entries: admins add someone without an account who has paid; the
-- usual capacity and division rules apply; walk-ins show by name and count
-- in the money totals. Events and amounts are TEST FIXTURES (rolled back).
begin;
select plan(14);
\ir _fixtures.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'walkadmin@test.local', '{"full_name":"Wes Admin"}'),
  ('a1000000-0000-4000-8000-000000000002', 'walkstaff@test.local', '{"full_name":"Sid Staff"}');
insert into public.user_roles (user_id, role) values
  ('a1000000-0000-4000-8000-000000000001', 'admin'),
  ('a1000000-0000-4000-8000-000000000002', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('a1000000-0000-4000-8000-000000000002', 'events.manage');

select set_config('app.audit_reason', 'Test fixtures', true);
insert into public.event_categories (id, name, slug) values ('a2000000-0000-4000-8000-000000000001', 'Test Walk Level', 'test-walk-level');
insert into public.events (id, slug, title, event_type, starts_at, ends_at, status, capacity, fee_centavos, fee_unit) values
  ('a3000000-0000-4000-8000-000000000001', 'test-walk-cup', 'Test Walk Cup', 'tournament', now() + interval '1 day', now() + interval '2 days',
   'registration_closed', 3, 40000, 'per_player'),
  ('a3000000-0000-4000-8000-000000000002', 'test-walk-op', 'Test Walk Open Play', 'open_play', now() + interval '1 day', now() + interval '2 days',
   'registration_open', null, 0, 'per_player');
insert into public.event_divisions (id, event_id, category_id, name, sort_order, team_size) values
  ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Test Singles', 1, 1),
  ('a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Test Doubles', 2, 2);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'Juan Walk', null, null, null, 40000, 'cash') $$, '42501', null, 'staff who are not admins cannot add walk-ins');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000002', null, 'Juan Walk') $$,
  'admins can also add open play walk-ins (free session here)');
select throws_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'Juan Walk', null, null, null, 20000, 'cash') $$, '22023', null, 'less than the entry fee is refused');
select throws_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'Juan Walk', '12345', null, null, 40000, 'cash') $$, '22023', null, 'a badly written mobile number is refused');
select lives_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'Juan Walk', '0917 123 4567', null, null, 40000, 'cash', 'OR-1') $$, 'an admin adds a paid walk-in, even after registration closed');
select throws_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002',
  'Ana Walk', null, null, null, 80000, 'gcash') $$, '22023', null, 'a doubles division needs a partner');
select throws_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002',
  'Ana Walk', null, null, 'Ben Walk', 40000, 'gcash') $$, '22023', null, 'per-player fees count the walk-in partner');
select lives_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002',
  'Ana Walk', null, null, 'Ben Walk', 80000, 'gcash', 'GC-9') $$, 'a walk-in pair is added');
select throws_ok($$ select public.admin_add_walk_in('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'Cara Walk', null, null, null, 40000, 'cash') $$, '22023', null, 'capacity counts walk-ins and their partners (3 places)');

select is((select string_agg(player_name || coalesce(' / ' || partner_name, '') || ':' || is_walk_in::text || ':' || coalesce(player_phone, '-'),
                             ', ' order by division_name)
           from public.staff_list_registrations('a3000000-0000-4000-8000-000000000001')),
  'Ana Walk / Ben Walk:true:-, Juan Walk:true:09171234567', 'the registrations list shows walk-ins by name (by division: Doubles, Singles)');
select is((select string_agg(method::text || '=' || centavos, ',' order by method::text) from public.staff_money_summary() where kind = 'walk_in_fee'),
  'cash=40000,gcash=80000', 'walk-in fees count in Today''s money by method');
select is((select event_fee_centavos from public.report_revenue_daily(private.operating_date_of(now()), private.operating_date_of(now()))),
  120000::bigint, 'and in the revenue report as event fees');
select lives_ok($$ select public.staff_cancel_registration(
  (select id from public.event_registrations where guest_name = 'Juan Walk' and event_id = 'a3000000-0000-4000-8000-000000000001'), 'Left early') $$,
  'a walk-in can be cancelled (no account to notify)');
reset role;  -- private helpers are not callable by API roles
select is((select private.entry_label(id) from public.event_registrations where guest_name = 'Ana Walk'), 'Ana Walk / Ben Walk',
  'brackets and standings name walk-ins');

select * from finish();
rollback;
