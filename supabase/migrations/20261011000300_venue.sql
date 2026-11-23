-- ============================================================================
-- Venue: settings, courts, operating hours, rates, payment methods
--
-- Only confirmed facts are seeded: the club name, city and three indoor
-- courts. Rates, hours, contact details and payment accounts are left empty
-- for the admin to enter — nothing is invented.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- venue_settings: exactly one row
-- ---------------------------------------------------------------------------
create table public.venue_settings (
  id boolean primary key default true check (id),
  name text not null,
  tagline text,
  street_address text,
  city text not null,
  province text not null,
  map_url text check (map_url is null or map_url ~ '^https://'),
  phone text,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  facebook_url text check (facebook_url is null or facebook_url ~ '^https://'),
  instagram_url text check (instagram_url is null or instagram_url ~ '^https://'),
  time_zone text not null default 'Asia/Manila',
  booking_window_days int not null default 30 check (booking_window_days between 1 and 365),
  hold_minutes int not null default 15 check (hold_minutes between 5 and 120),
  verify_window_hours int not null default 12 check (verify_window_hours between 1 and 72),
  updated_at timestamptz not null default now()
);

create trigger venue_settings_set_updated_at
before update on public.venue_settings
for each row execute function private.set_updated_at();

create trigger venue_settings_audit
after insert or update or delete on public.venue_settings
for each row execute function private.write_audit();

insert into public.venue_settings (name, tagline, city, province)
values ('Picklehouse Matanao', 'dine, drink, enjoy', 'Matanao', 'Davao del Sur');

-- ---------------------------------------------------------------------------
-- courts
-- ---------------------------------------------------------------------------
create table public.courts (
  id uuid primary key default gen_random_uuid(),
  number smallint not null unique check (number > 0),
  name text not null unique check (char_length(btrim(name)) between 1 and 40),
  environment public.court_environment not null default 'indoor',
  surface text,
  status public.court_status not null default 'active',
  photo_path text,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger courts_set_updated_at
before update on public.courts
for each row execute function private.set_updated_at();

create trigger courts_audit
after insert or update or delete on public.courts
for each row execute function private.write_audit();

insert into public.courts (number, name, environment, sort_order) values
  (1, 'Court 1', 'indoor', 1),
  (2, 'Court 2', 'indoor', 2),
  (3, 'Court 3', 'indoor', 3);

-- ---------------------------------------------------------------------------
-- operating_hours: one row per weekday (0 = Sunday … 6 = Saturday).
-- closes_at earlier than opens_at means closing after midnight
-- (e.g. 06:00 → 01:00 belongs to the same operating day).
-- ---------------------------------------------------------------------------
create table public.operating_hours (
  weekday smallint primary key check (weekday between 0 and 6),
  is_closed boolean not null default false,
  opens_at time,
  closes_at time,
  updated_at timestamptz not null default now(),
  check (is_closed or (opens_at is not null and closes_at is not null and opens_at <> closes_at))
);

create trigger operating_hours_set_updated_at
before update on public.operating_hours
for each row execute function private.set_updated_at();

create trigger operating_hours_audit
after insert or update or delete on public.operating_hours
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- rate_rules: price for a product in a weekly time window.
-- court_id null = applies to every court.
-- ---------------------------------------------------------------------------
create table public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  product public.rate_product not null,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  court_id uuid references public.courts (id) on delete cascade,
  weekdays smallint[] not null default '{0,1,2,3,4,5,6}'
    check (weekdays <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(weekdays) > 0),
  starts_at time not null,
  ends_at time not null check (ends_at <> starts_at),
  price_centavos bigint not null check (price_centavos >= 0),
  -- 'per_court_hour' for rentals, 'per_player' for open play
  unit text not null check (unit in ('per_court_hour', 'per_player')),
  is_active boolean not null default true,
  valid_from date,
  valid_to date check (valid_to is null or valid_from is null or valid_to >= valid_from),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rate_rules_active_idx on public.rate_rules (product, is_active);
create index rate_rules_court_idx on public.rate_rules (court_id);

create trigger rate_rules_set_updated_at
before update on public.rate_rules
for each row execute function private.set_updated_at();

create trigger rate_rules_audit
after insert or update or delete on public.rate_rules
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- payment_methods: the venue's own accounts shown at checkout.
-- These are the club's receiving accounts, meant to be shown publicly.
-- ---------------------------------------------------------------------------
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  kind public.payment_method_kind not null,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  account_name text,
  account_number text,
  bank_name text,
  qr_image_path text,
  instructions text,
  is_active boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'cash' or not is_active or (account_name is not null and account_number is not null)),
  check (kind <> 'bank_transfer' or not is_active or bank_name is not null)
);

create trigger payment_methods_set_updated_at
before update on public.payment_methods
for each row execute function private.set_updated_at();

create trigger payment_methods_audit
after insert or update or delete on public.payment_methods
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.venue_settings enable row level security;
alter table public.courts enable row level security;
alter table public.operating_hours enable row level security;
alter table public.rate_rules enable row level security;
alter table public.payment_methods enable row level security;

-- Public reads
create policy "Anyone reads venue settings" on public.venue_settings
for select to anon, authenticated using (true);

create policy "Anyone reads courts that are not retired" on public.courts
for select to anon, authenticated using (status <> 'inactive' or (select private.is_staff()));

create policy "Anyone reads operating hours" on public.operating_hours
for select to anon, authenticated using (true);

create policy "Anyone reads active rates" on public.rate_rules
for select to anon, authenticated using (is_active or (select private.is_staff()));

create policy "Anyone reads active payment methods" on public.payment_methods
for select to anon, authenticated using (is_active or (select private.is_staff()));

-- Admin-only writes (settings, hours, rates, payment accounts)
create policy "Admins update venue settings" on public.venue_settings
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage operating hours" on public.operating_hours
for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage rates" on public.rate_rules
for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage payment methods" on public.payment_methods
for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Courts: admins, or staff allowed to manage the schedule (e.g. maintenance)
create policy "Schedule managers update courts" on public.courts
for update to authenticated
using ((select private.has_permission('schedule.manage')))
with check ((select private.has_permission('schedule.manage')));

create policy "Admins add courts" on public.courts
for insert to authenticated with check ((select private.is_admin()));

create policy "Admins remove courts" on public.courts
for delete to authenticated using ((select private.is_admin()));
