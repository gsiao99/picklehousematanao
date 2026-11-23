-- Player vs staff vs administrator: privilege escalation attempts and admin RPCs.
begin;
select plan(30);

-- Fixtures (as postgres) ------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');

-- ---- Ana (player) tries to escalate ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select throws_ok($$ insert into public.user_roles (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin') $$,
  '42501', null, 'a player cannot insert an admin role for themselves');
select throws_ok($$ update public.user_roles set role = 'admin' where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a player cannot upgrade their own role row');
select throws_ok($$ delete from public.user_roles where user_id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null, 'a player cannot delete another user''s role');
select throws_ok($$ insert into public.staff_permissions (user_id, permission) values ('11111111-1111-4111-8111-111111111111', 'payments.verify') $$,
  '42501', null, 'a player cannot grant themselves a staff permission');
select throws_ok($$ select public.admin_grant_role('11111111-1111-4111-8111-111111111111', 'admin', 'please') $$,
  '42501', 'Only administrators can do this.', 'a player cannot call admin_grant_role');
select throws_ok($$ select * from public.admin_list_members() $$,
  '42501', null, 'a player cannot list members');
select throws_ok($$ select private.bootstrap_first_admin('ana.reyes@test.local') $$,
  '42501', null, 'a player cannot call first-admin provisioning');
select throws_ok($$ select public.staff_set_player_level('11111111-1111-4111-8111-111111111111', 'advanced', 'self promote') $$,
  '42501', null, 'a player cannot set their own level');
select is((select roles::text || permissions::text from public.get_my_access()),
  '{}{}', 'an account with no role granted has no roles and no permissions');
select is((select count(*)::int from public.user_roles), 0, 'an account with no role sees no role rows');
select is_empty('select * from public.audit_log', 'a player cannot read the audit log');
select is((select count(*)::int from public.user_roles where role = 'admin'), 0,
  'after all attempts the player still has no admin role visible');

-- ---- Carla (staff, no permissions) ---------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select throws_ok($$ select public.admin_grant_role('33333333-3333-4333-8333-333333333333', 'admin', 'promote myself') $$,
  '42501', null, 'staff cannot grant roles, including to themselves');
select is((select permissions::text from public.get_my_access()), '{}', 'staff start with no permissions');
select throws_ok($$ select public.staff_set_player_level('11111111-1111-4111-8111-111111111111', 'advanced', 'level up') $$,
  '42501', null, 'staff without players.manage cannot set levels');

-- ---- Lea (admin) -----------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);

select is((select cardinality(permissions) from public.get_my_access()),
  (select cardinality(enum_range(null::public.app_permission))), 'an admin holds every permission');
select throws_ok($$ select public.admin_grant_role('22222222-2222-4222-8222-222222222222', 'staff', '') $$,
  '22023', null, 'role changes require a reason');
select lives_ok($$ select public.admin_grant_role('22222222-2222-4222-8222-222222222222', 'staff', 'Hired for the front desk') $$,
  'an admin can make a player staff');
select throws_ok($$ select public.admin_set_staff_permissions('11111111-1111-4111-8111-111111111111', '{payments.verify}', 'verify payments') $$,
  '22023', null, 'permissions can only be given to staff');
select lives_ok($$ select public.admin_set_staff_permissions('22222222-2222-4222-8222-222222222222', '{payments.verify,players.manage}', 'Cashier duties') $$,
  'an admin can give staff permissions');
select is((select count(*)::int from public.audit_log
           where table_name = 'user_roles' and action = 'insert' and reason = 'Hired for the front desk'
             and actor_id = '55555555-5555-4555-8555-555555555555'),
  1, 'the role grant is in the audit log with the admin and the reason');
select throws_ok($$ select public.admin_revoke_role('55555555-5555-4555-8555-555555555555', 'admin', 'stepping down') $$,
  '22023', 'At least one administrator must remain.', 'the last administrator cannot be removed');
select throws_ok($$ select public.admin_revoke_role('11111111-1111-4111-8111-111111111111', 'player', 'remove') $$,
  '22023', null, 'the player role cannot be removed');
select throws_ok($$ select public.admin_set_account_status('55555555-5555-4555-8555-555555555555', 'suspended', 'test') $$,
  '22023', null, 'an admin cannot suspend themselves');
select isnt_empty($$ select 1 from public.admin_list_members('ben.cruz') where email = 'ben.cruz@test.local' $$,
  'an admin can search members by email');
select throws_ok($$ select public.admin_grant_role(gen_random_uuid(), 'staff', 'nobody') $$,
  'P0002', null, 'granting a role to an unknown member fails clearly');

-- ---- Ben (now staff with players.manage) -------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select is((select permissions::text from public.get_my_access()), '{payments.verify,players.manage}',
  'staff see exactly the permissions they were given');
select lives_ok($$ select public.staff_set_player_level('11111111-1111-4111-8111-111111111111', 'low_intermediate', 'Assessed at open play') $$,
  'staff with players.manage can confirm a player''s level');

-- ---- Admin removes staff role: permissions go with it ---------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select lives_ok($$ select public.admin_revoke_role('22222222-2222-4222-8222-222222222222', 'staff', 'Left the club') $$,
  'an admin can remove the staff role');

-- ---- First-admin provisioning (SQL editor, as postgres) ------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select private.bootstrap_first_admin('ana.reyes@test.local') $$,
  '42501', null, 'provisioning refuses once an administrator exists');

select * from finish();
rollback;
