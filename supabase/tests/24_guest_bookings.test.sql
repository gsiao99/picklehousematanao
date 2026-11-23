-- Guest bookings without accounts: manage-link tokens, privacy of phone
-- numbers, cancellation cutoff, rate limits and staff controls over the
-- public name. Hours, rates and bookings are TEST FIXTURES (rolled back).
begin;
select plan(46);
\ir _fixtures.sql

create function pg_temp.test_day() returns date language sql stable security definer as
  $$ select private.operating_date_of(now()) + 1 $$;
create function pg_temp.at_hour(_h int) returns timestamptz language sql stable security definer as
  $$ select (pg_temp.test_day()::timestamp + make_interval(hours => _h)) at time zone 'Asia/Manila' $$;
create function pg_temp.slot(_court int, _h int) returns jsonb language sql stable security definer as
  $$ select jsonb_build_object('court_id', (select id from public.courts where number = _court), 'starts_at', pg_temp.at_hour(_h)) $$;
create temp table ids (name text primary key, reference text, token text);
grant all on ids to public;
create function pg_temp.book(_name text, _court int, _h int, _guest text, _phone text) returns text language plpgsql as $$
declare _r record;
begin
  select * into _r from public.guest_create_booking(jsonb_build_array(pg_temp.slot(_court, _h)), _guest, _phone);
  insert into ids values (_name, _r.reference, _r.token);
  return _r.reference;
end $$;
create function pg_temp.ref(_name text) returns text language sql stable as $$ select reference from ids where name = _name $$;
create function pg_temp.tok(_name text) returns text language sql stable as $$ select token from ids where name = _name $$;
grant execute on function pg_temp.test_day(), pg_temp.at_hour(int), pg_temp.slot(int, int),
  pg_temp.book(text, int, int, text, text), pg_temp.ref(text), pg_temp.tok(text) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('66666666-6666-4666-8666-666666666666', 'no.role@test.local', '{"full_name":"No Role"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('44444444-4444-4444-8444-444444444444', 'bookings.manage'),
  ('44444444-4444-4444-8444-444444444444', 'payments.verify');

insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '23:00' from generate_series(0, 6) d;
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit) values
  ('court_rental', 'Test rate', 'standard', '06:00', '23:00', 10000, 'per_court_hour');

-- ---------------------------------------------------------------------------
-- Booking: name and phone checks
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select pg_temp.book('x', 1, 9, '   ', '09171234567') $$, '22023', null, 'a display name is required');
select throws_ok($$ select pg_temp.book('x', 1, 9, repeat('a', 31), '09171234567') $$, '22023', null,
  'a display name is at most 30 characters');
select throws_ok($$ select pg_temp.book('x', 1, 9, 'Ana', '12345') $$, '22023', 'Enter a PH mobile number like 09171234567.',
  'a mobile number must be a PH mobile');
select throws_ok($$ select pg_temp.book('x', 1, 9, 'Ana', '08171234567') $$, '22023', null, 'numbers not starting with 09 are refused');
select lives_ok($$ select pg_temp.book('ana', 1, 9, E'  Ana\tR.  ', '+63 917 123 4567') $$, 'a guest books with a name and mobile number');

reset role;
select ok((select display_name = 'Ana R.' and guest_phone = '09171234567' and player_id is null and created_by is null
           from public.bookings where reference = pg_temp.ref('ana')),
  'the name is cleaned to one line and the mobile number is normalised to 09XXXXXXXXX');
select ok((select manage_token_hash = sha256(convert_to(pg_temp.tok('ana'), 'UTF8')) from public.bookings where reference = pg_temp.ref('ana')),
  'only the SHA-256 of the token is stored');
select ok((select octet_length(decode(translate(pg_temp.tok('ana'), '-_', '+/') || '=', 'base64')) = 32),
  'the token is 32 random bytes (256 bits), base64url');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema in ('public', 'private') and c.column_name ~ 'token' and c.column_name <> 'manage_token_hash'),
  0, 'no table has a column for the raw token');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ---------------------------------------------------------------------------
-- The manage link
-- ---------------------------------------------------------------------------
select pg_temp.book('ben', 2, 9, 'Ben C.', '09170000002');
select ok((select v ->> 'reference' = pg_temp.ref('ana') and v ->> 'display_name' = 'Ana R.' and v ->> 'phone_masked' = '0917•••4567'
                  and (v ->> 'total_centavos')::bigint = 10000 and jsonb_array_length(v -> 'slots') = 1
                  and (v ->> 'can_cancel')::boolean
           from (select public.guest_get_booking(pg_temp.ref('ana'), pg_temp.tok('ana')) as v) x),
  'the right reference and token open the booking (phone masked)');
select ok(public.guest_get_booking(lower(pg_temp.ref('ana')), pg_temp.tok('ana')) ->> 'reference' = pg_temp.ref('ana'),
  'the reference is not case sensitive');
select is(public.guest_get_booking(pg_temp.ref('ana'), 'wrong') ->> 'error', 'not_found', 'a wrong token answers not found');
select is(public.guest_get_booking(pg_temp.ref('ana'), pg_temp.tok('ben')) ->> 'error', 'not_found',
  'another guest''s token does not open this booking');
select is(public.guest_get_booking('PH-000000-9999', pg_temp.tok('ana')) ->> 'error', 'not_found',
  'an unknown reference answers exactly like a wrong token');
select is(public.guest_get_booking(pg_temp.ref('ana'), null) ->> 'error', 'not_found', 'a missing token answers not found');
select ok(public.guest_get_booking(pg_temp.ref('ana'), pg_temp.tok('ana'))::text !~ '0917123', 'the full number is not shown on the manage link');
select is(public.guest_cancel_booking(pg_temp.ref('ana'), pg_temp.tok('ben')) ->> 'error', 'not_found',
  'cancelling with another guest''s token answers not found');

reset role;
select is((select count(*)::int from private.guest_failed_lookups), 5, 'failed lookups are recorded for rate limiting');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ---------------------------------------------------------------------------
-- No direct access; the phone stays private
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from public.bookings $$, '42501', null, 'visitors cannot read bookings');
select throws_ok($$ select * from public.booking_slots $$, '42501', null, 'visitors cannot read booking slots');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'visitors cannot read profiles');
select throws_ok($$ select * from private.guest_failed_lookups $$, '42501', null, 'visitors cannot read the rate-limit log');
select throws_ok($$ select private.guest_booking_id(pg_temp.ref('ana'), pg_temp.tok('ana')) $$, '42501', null,
  'visitors cannot call the private token check directly');
select ok((select string_agg(to_jsonb(a)::text, '') from public.get_court_availability(pg_temp.test_day()) a) !~ '0917',
  'the availability grid never includes a phone number');
select ok((select string_agg(label, ',' order by court_number) from public.get_court_availability(pg_temp.test_day())
           where starts_at = pg_temp.at_hour(9) and court_number in (1, 2)) = 'Ana R.,Ben C.',
  'the availability grid shows the guests'' display names');

-- Signed-in accounts without a staff role see nothing either.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select is_empty($$ select 1 from public.bookings where guest_phone is not null $$, 'an account without a staff role sees no guest phones');

-- ---------------------------------------------------------------------------
-- Staff: phone, and the public name (edit or hide)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select is((select player_phone from public.staff_search_bookings(pg_temp.ref('ana'))), '09171234567',
  'booking staff see the guest''s full mobile number');
select throws_ok($$ select public.staff_set_booking_display_name((select booking_id from public.staff_search_bookings(pg_temp.ref('ana'))),
  'Ana', true, '') $$, '22023', null, 'changing the public name needs a reason');
select throws_ok($$ select public.staff_set_booking_display_name((select booking_id from public.staff_search_bookings(pg_temp.ref('ana'))),
  '', false, 'Clean up') $$, '22023', null, 'a guest booking keeps a name (hide it instead)');
select lives_ok($$ select public.staff_set_booking_display_name((select booking_id from public.staff_search_bookings(pg_temp.ref('ben'))),
  'Ben', true, 'Asked not to be shown') $$, 'staff hide a guest''s name');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select throws_ok($$ select public.staff_set_booking_display_name(gen_random_uuid(), 'X', false, 'Test') $$, '42501', null,
  'staff without bookings.manage cannot change names');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select coalesce(label, '(none)') from public.get_court_availability(pg_temp.test_day())
           where starts_at = pg_temp.at_hour(9) and court_number = 2), '(none)',
  'a hidden name never reaches the public availability grid');
select is((select count(*)::int from public.get_live_courts() where label = 'Ben'), 0,
  'nor the live courts view');
select ok((public.guest_get_booking(pg_temp.ref('ben'), pg_temp.tok('ben')) ->> 'display_name_hidden')::boolean,
  'the guest can see that staff hid their name');

-- ---------------------------------------------------------------------------
-- Guest cancellation: up to 30 minutes before the start
-- ---------------------------------------------------------------------------
select ok((public.guest_cancel_booking(pg_temp.ref('ana'), pg_temp.tok('ana')) ->> 'status') = 'cancelled',
  'a guest can cancel well ahead of the start');
select throws_ok($$ select public.guest_cancel_booking(pg_temp.ref('ana'), pg_temp.tok('ana')) $$, '22023', 'This booking is already cancelled.',
  'a cancelled booking cannot be cancelled again');
select is((select status from public.get_court_availability(pg_temp.test_day())
           where starts_at = pg_temp.at_hour(9) and court_number = 1), 'available', 'cancelling frees the court time');

-- Within the cutoff: a paid booking on the next whole hour (0-60 minutes away),
-- with the cutoff set to 61 minutes so "now" is always inside it.
reset role;
insert into public.bookings (id, reference, status, total_centavos, display_name, guest_phone, manage_token_hash, payment_status) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'PH-TEST-SOON', 'confirmed', 10000, 'Cara M.', '09170000003',
   private.token_hash('token-soon'), 'paid');
insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', id,
       tstzrange(date_trunc('hour', now()) + interval '1 hour', date_trunc('hour', now()) + interval '2 hours'), 'rental', 'confirmed', 10000
from public.courts where number = 3;
update public.venue_settings set guest_cancel_cutoff_minutes = 61;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(not (public.guest_get_booking('PH-TEST-SOON', 'token-soon') ->> 'can_cancel')::boolean,
  'inside the cutoff the manage link does not offer cancelling');
select throws_ok($$ select public.guest_cancel_booking('PH-TEST-SOON', 'token-soon') $$, '22023',
  'Bookings can be cancelled online up to 61 minutes before the start. Contact the club.', 'cancelling inside the cutoff is refused');

reset role;
update public.venue_settings set guest_cancel_cutoff_minutes = 30;
update public.booking_slots set slot = tstzrange(date_trunc('hour', now()) + interval '3 hours', date_trunc('hour', now()) + interval '4 hours')
 where booking_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.guest_cancel_booking('PH-TEST-SOON', 'token-soon') ->> 'payment_status', 'refund_due',
  'cancelling a paid booking marks a refund due for staff');
reset role;
select ok(exists (select 1 from public.notifications where user_id = '44444444-4444-4444-8444-444444444444'
                  and title = 'Refund due: PH-TEST-SOON'), 'payment staff are told a refund is due');

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------
update public.venue_settings set guest_bookings_per_hour = 2;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.book('r1', 1, 15, 'Rate', '09179999999');
select pg_temp.book('r2', 1, 16, 'Rate', '09179999999');
select throws_ok($$ select pg_temp.book('r3', 1, 17, 'Rate', '09179999999') $$, 'PT429', null,
  'new bookings per mobile number per hour are limited');
select lives_ok($$ select pg_temp.book('r4', 1, 17, 'Other', '09178888888') $$, 'other numbers are not affected');

-- Ten failed attempts lock a reference for 15 minutes, even for the right token.
select count(*) from generate_series(1, 10) g where public.guest_get_booking(pg_temp.ref('r4'), 'guess-' || g) ->> 'error' = 'not_found';
select is(public.guest_get_booking(pg_temp.ref('r4'), pg_temp.tok('r4')) ->> 'error', 'not_found',
  'after ten failed attempts the reference is locked, even for the right token');
select ok(public.guest_get_booking(pg_temp.ref('r1'), pg_temp.tok('r1')) ->> 'reference' = pg_temp.ref('r1'),
  'other references are not locked');
reset role;
update private.guest_failed_lookups set at = now() - interval '16 minutes';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(public.guest_get_booking(pg_temp.ref('r4'), pg_temp.tok('r4')) ->> 'reference' = pg_temp.ref('r4'),
  'the lock lifts after 15 minutes');

reset role;
select * from finish();
rollback;
