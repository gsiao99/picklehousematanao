-- Schema-level guarantees: RLS everywhere, least-privilege grants, seeds.
begin;
select plan(14);

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

-- Seed data holds only facts confirmed by the owner (23 Nov 2026).
select is((select count(*)::int from public.courts), 0, 'no courts are seeded (count not confirmed)');
select is((select string_agg(format('%s %s-%s %s', label, starts_at, ends_at, price_centavos), '; ' order by starts_at)
           from public.rate_rules where unit is null and is_active),
  'Daytime 08:00:00-17:00:00 10000; Evening 17:00:00-22:00:00 20000',
  'only the confirmed rates are seeded, with no basis');
select is((select count(*)::int from public.rate_rules), 2, 'no other rates are invented (10–11 PM not confirmed)');
select is((select count(*)::int from public.operating_hours where not is_closed and opens_at = '08:00' and closes_at = '23:00'), 7,
  'open Monday to Sunday, 8:00 AM – 11:00 PM');
select is((select count(*)::int from public.payment_methods where account_name is not null or account_number is not null), 0,
  'no payment accounts are invented');
select is(
  (select public from storage.buckets where id = 'payment-proofs'),
  false,
  'payment-proofs bucket is private'
);

select * from finish();
rollback;
