-- Schema-level guarantees: RLS everywhere, least-privilege grants, seeds.
begin;
select plan(13);

select ok(
  not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity),
  'every table in public has row level security enabled'
);

select is_empty(
  $$ select table_name, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT' $$,
  'anon has no insert, update or delete grant on any public table'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'select')
  and not has_table_privilege('anon', 'public.bookings', 'select')
  and not has_table_privilege('anon', 'public.payments', 'select')
  and not has_table_privilege('anon', 'public.user_roles', 'select')
  and not has_table_privilege('anon', 'public.audit_log', 'select'),
  'anon cannot read private tables at all'
);

select ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'insert')
  and not has_table_privilege('authenticated', 'public.user_roles', 'update')
  and not has_table_privilege('authenticated', 'public.user_roles', 'delete')
  and not has_table_privilege('authenticated', 'public.staff_permissions', 'insert')
  and not has_table_privilege('authenticated', 'public.audit_log', 'insert'),
  'signed-in users have no write grant on roles, permissions or the audit log'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'level', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'status', 'update')
  and has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update'),
  'players may update their name but not their confirmed level or account status'
);

select ok(
  not has_function_privilege('authenticated', 'private.bootstrap_first_admin(text)', 'execute')
  and not has_function_privilege('anon', 'private.bootstrap_first_admin(text)', 'execute')
  and not has_function_privilege('service_role', 'private.bootstrap_first_admin(text)', 'execute'),
  'first-admin provisioning cannot be called through the API'
);

select ok(
  not has_function_privilege('anon', 'public.admin_grant_role(uuid, public.app_role, text)', 'execute'),
  'anon cannot call admin functions'
);

select is(
  (select count(*)::int from pg_constraint where conname = 'booking_slots_no_overlap' and contype = 'x'),
  1,
  'booking_slots has the no-overlap exclusion constraint'
);

select is((select count(*)::int from public.courts where environment = 'indoor'), 3, 'three indoor courts are seeded');
select is((select count(*)::int from public.rate_rules), 0, 'no rates are invented');
select is((select count(*)::int from public.operating_hours), 0, 'no opening hours are invented');
select is((select count(*)::int from public.payment_methods), 0, 'no payment accounts are invented');

select is(
  (select public from storage.buckets where id = 'payment-proofs'),
  false,
  'payment-proofs bucket is private'
);

select * from finish();
rollback;
