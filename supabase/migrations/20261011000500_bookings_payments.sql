-- ============================================================================
-- Bookings, booking slots, payments, event registrations
--
-- A booking is one checkout (cart → held → pending_verification → confirmed).
-- Each booked hour is a booking_slot. Every use of a court — rentals, open
-- play, events, blocks and maintenance — is a booking_slot, so one exclusion
-- constraint makes overlapping use of a court impossible.
--
-- Players never write these tables directly. Booking, checkout and payment
-- RPCs arrive with the booking engine (Phase 4) and checkout (Phase 5).
-- ============================================================================

alter table public.venue_settings
  add column operating_day_cutoff time not null default '04:00';

comment on column public.venue_settings.operating_day_cutoff is
  'Slots starting before this local time belong to the previous operating day (e.g. a 12:30 AM slot on Saturday files under Friday).';

-- ---------------------------------------------------------------------------
-- Booking references: DD-YYMMDD-0001 (Manila date)
-- ---------------------------------------------------------------------------
create sequence private.booking_reference_seq;

create or replace function private.next_booking_reference()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'DD-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-'
         || lpad(nextval('private.booking_reference_seq')::text, 4, '0');
$$;

revoke all on function private.next_booking_reference() from public;
grant execute on function private.next_booking_reference() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.next_booking_reference(),
  player_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  status public.booking_status not null default 'cart',
  total_centavos bigint not null default 0 check (total_centavos >= 0),
  hold_expires_at timestamptz,
  verify_by timestamptz,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'held' or hold_expires_at is not null)
);

create index bookings_player_created_idx on public.bookings (player_id, created_at desc);
create index bookings_status_idx on public.bookings (status);
create index bookings_hold_expires_idx on public.bookings (hold_expires_at) where status = 'held';

create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function private.set_updated_at();

create trigger bookings_audit
after insert or update or delete on public.bookings
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- booking_slots
-- ---------------------------------------------------------------------------
create table public.booking_slots (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  slot tstzrange not null,
  operating_date date not null,
  kind public.slot_kind not null,
  status public.slot_status not null default 'held',
  price_centavos bigint not null default 0 check (price_centavos >= 0),
  price_breakdown jsonb,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (not isempty(slot) and lower_inc(slot) and not upper_inc(slot)
         and lower(slot) is not null and upper(slot) is not null),
  -- Rentals are single hours on the hour; nonconsecutive hours are separate rows.
  check (kind <> 'rental' or (
    upper(slot) - lower(slot) = interval '1 hour'
    and extract(epoch from lower(slot))::bigint % 3600 = 0
  )),
  check (kind <> 'rental' or booking_id is not null),
  check (kind not in ('block', 'maintenance') or booking_id is null),
  check (kind <> 'event' or event_id is not null),

  -- No two live uses of the same court may overlap.
  constraint booking_slots_no_overlap
    exclude using gist (court_id with =, slot with &&)
    where (status not in ('released', 'cancelled'))
);

create index booking_slots_booking_idx on public.booking_slots (booking_id);
create index booking_slots_event_idx on public.booking_slots (event_id);
create index booking_slots_day_court_idx on public.booking_slots (operating_date, court_id);

create or replace function private.set_operating_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _cutoff time;
  _local timestamp := lower(new.slot) at time zone 'Asia/Manila';
begin
  select operating_day_cutoff into _cutoff from public.venue_settings limit 1;
  _cutoff := coalesce(_cutoff, '04:00');
  new.operating_date := case
    when _local::time < _cutoff then (_local - interval '1 day')::date
    else _local::date
  end;
  return new;
end;
$$;

revoke all on function private.set_operating_date() from public;

create trigger booking_slots_set_operating_date
before insert or update of slot on public.booking_slots
for each row execute function private.set_operating_date();

create trigger booking_slots_set_updated_at
before update on public.booking_slots
for each row execute function private.set_updated_at();

create trigger booking_slots_audit
after insert or update or delete on public.booking_slots
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- payments: a submitted proof of payment for a booking
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  payment_method_id uuid references public.payment_methods (id) on delete set null,
  method_kind public.payment_method_kind not null,
  amount_centavos bigint not null check (amount_centavos > 0),
  reference_no text check (reference_no is null or char_length(btrim(reference_no)) between 4 and 64),
  -- Object path in the private payment-proofs bucket: {player_id}/{booking_id}/{file}
  proof_path text check (proof_path is null or proof_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'),
  proof_sha256 text check (proof_sha256 is null or proof_sha256 ~ '^[0-9a-f]{64}$'),
  status public.payment_status not null default 'submitted',
  submitted_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method_kind = 'cash' or (reference_no is not null and proof_path is not null)),
  check (status = 'submitted' or (reviewed_by is not null and reviewed_at is not null))
);

-- The same receipt cannot be used twice.
create unique index payments_reference_unique on public.payments (method_kind, lower(btrim(reference_no)))
  where reference_no is not null;
create unique index payments_proof_hash_unique on public.payments (proof_sha256)
  where proof_sha256 is not null;
create index payments_booking_idx on public.payments (booking_id);
create index payments_status_idx on public.payments (status, created_at);

create trigger payments_set_updated_at
before update on public.payments
for each row execute function private.set_updated_at();

create trigger payments_audit
after insert or update or delete on public.payments
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- event_registrations
-- ---------------------------------------------------------------------------
create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  partner_id uuid references public.profiles (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  status public.registration_status not null default 'pending',
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, player_id),
  check (partner_id is null or partner_id <> player_id)
);

create index event_registrations_player_idx on public.event_registrations (player_id);
create index event_registrations_booking_idx on public.event_registrations (booking_id);

create trigger event_registrations_set_updated_at
before update on public.event_registrations
for each row execute function private.set_updated_at();

create trigger event_registrations_audit
after insert or update or delete on public.event_registrations
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- Ownership helper for policies (bookings are the anchor for slots/payments)
-- ---------------------------------------------------------------------------
create or replace function private.owns_booking(_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bookings b where b.id = _booking_id and b.player_id = auth.uid());
$$;

revoke all on function private.owns_booking(uuid) from public;
grant execute on function private.owns_booking(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;
alter table public.booking_slots enable row level security;
alter table public.payments enable row level security;
alter table public.event_registrations enable row level security;

-- bookings: owner and staff read; writes only through RPCs (none yet)
create policy "Players read their own bookings" on public.bookings
for select to authenticated using (player_id = (select auth.uid()));

create policy "Staff read all bookings" on public.bookings
for select to authenticated using ((select private.is_staff()));

-- booking_slots: owner (through the booking) and staff read
create policy "Players read slots of their bookings" on public.booking_slots
for select to authenticated using (booking_id is not null and private.owns_booking(booking_id));

create policy "Staff read all slots" on public.booking_slots
for select to authenticated using ((select private.is_staff()));

-- Schedule managers may place and lift blocks and maintenance directly.
create policy "Schedule managers add blocks" on public.booking_slots
for insert to authenticated
with check (kind in ('block', 'maintenance') and booking_id is null
            and (select private.has_permission('schedule.manage')));

create policy "Schedule managers change blocks" on public.booking_slots
for update to authenticated
using (kind in ('block', 'maintenance') and (select private.has_permission('schedule.manage')))
with check (kind in ('block', 'maintenance') and booking_id is null
            and (select private.has_permission('schedule.manage')));

create policy "Schedule managers remove blocks" on public.booking_slots
for delete to authenticated
using (kind in ('block', 'maintenance') and (select private.has_permission('schedule.manage')));

-- payments: owner reads; staff who verify payments read
create policy "Players read their own payments" on public.payments
for select to authenticated using (private.owns_booking(booking_id));

create policy "Payment verifiers read all payments" on public.payments
for select to authenticated using ((select private.has_permission('payments.verify')));

-- registrations: owner, partner and event managers read
create policy "Players read their own registrations" on public.event_registrations
for select to authenticated
using (player_id = (select auth.uid()) or partner_id = (select auth.uid()));

create policy "Event managers read registrations" on public.event_registrations
for select to authenticated
using (exists (
  select 1 from public.events e
  where e.id = event_id and private.can_manage_event_type(e.event_type)
));
