-- ============================================================================
-- Guest court bookings (Phase 1): no player accounts
--
--   * A guest books with a display name (public, on the court board) and a PH
--     mobile number 09XXXXXXXXX (private: staff only).
--   * Each booking gets a reference code (PH-YYMMDD-0001) and a private manage
--     link holding a random token (32 bytes from gen_random_bytes). Only the
--     token's SHA-256 is stored; the raw token is returned once, at creation.
--   * Every guest action goes through a SECURITY DEFINER function that takes
--     the reference and the token. A wrong token, an unknown reference and a
--     locked-out reference all answer the same way ({"error":"not_found"}),
--     without raising, so failed attempts are recorded for rate limiting.
--   * Receipts: the guest asks for an upload grant (a random path under the
--     booking's folder, valid 15 minutes), uploads the image to that exact
--     path in the private payment-proofs bucket, then submits the payment.
--   * Guests can cancel until guest_cancel_cutoff_minutes (default 30) before
--     the first court time. A paid or pending payment becomes refund due for
--     staff; staff record refunds.
--   * Player booking and payment functions, player read policies and the
--     player role at sign-up are removed. New sign-ins (staff, created by an
--     admin) get a profile and no role until an admin grants one.
--   * Staff lists and reports show the guest's name and phone from the
--     booking when there is no profile.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  add column guest_cancel_cutoff_minutes int not null default 30 check (guest_cancel_cutoff_minutes between 0 and 2880),
  add column guest_bookings_per_hour int not null default 10 check (guest_bookings_per_hour between 1 and 100);
comment on column public.venue_settings.guest_cancel_cutoff_minutes is
  'Guests can cancel online until this many minutes before their first court time.';
comment on column public.venue_settings.guest_bookings_per_hour is
  'Abuse guard: new guest bookings allowed per mobile number per hour. Not a limit on how many bookings a number may hold.';
grant select (guest_cancel_cutoff_minutes, guest_bookings_per_hour) on public.venue_settings to anon, authenticated;
grant update (guest_cancel_cutoff_minutes, guest_bookings_per_hour) on public.venue_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Bookings: guest name, phone and manage-link token hash
-- ---------------------------------------------------------------------------
alter table public.bookings
  alter column player_id drop not null,
  add column guest_phone text check (guest_phone is null or guest_phone ~ '^09[0-9]{9}$'),
  add column manage_token_hash bytea check (manage_token_hash is null or octet_length(manage_token_hash) = 32),
  add column display_name_hidden boolean not null default false,
  add constraint bookings_guest_details check (
    player_id is not null or (display_name is not null and guest_phone is not null)
  );
create unique index bookings_manage_token_hash_key on public.bookings (manage_token_hash) where manage_token_hash is not null;
create index bookings_guest_phone_created_idx on public.bookings (guest_phone, created_at desc) where guest_phone is not null;
comment on column public.bookings.display_name is
  'Public name on the court board and live view (the guest''s display name). Staff can edit or hide it.';
comment on column public.bookings.guest_phone is 'Guest''s PH mobile number. Private: staff only.';
comment on column public.bookings.manage_token_hash is
  'SHA-256 of the manage-link token. The token itself is never stored. Not granted to any API role.';
comment on column public.bookings.display_name_hidden is 'Staff hid the display name: public views show no name.';
-- Staff read bookings through RLS ("Staff read all bookings"). The table-level
-- SELECT would include new columns automatically, so switch to column grants:
-- every column except manage_token_hash.
revoke select on public.bookings from authenticated;
do $$
begin
  execute (
    select format('grant select (%s) on public.bookings to authenticated',
                  string_agg(quote_ident(attname), ', ' order by attnum))
    from pg_attribute
    where attrelid = 'public.bookings'::regclass and attnum > 0 and not attisdropped
      and attname <> 'manage_token_hash'
  );
end $$;

-- Reference codes for Picklehouse.
create or replace function private.next_booking_reference()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'PH-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-'
         || lpad(nextval('private.booking_reference_seq')::text, 4, '0');
$$;

-- Check-ins for guest bookings have no account.
alter table public.check_ins
  alter column player_id drop not null,
  add constraint check_ins_has_subject check (player_id is not null or booking_id is not null or registration_id is not null);
-- One check-in per booking per day still holds when there is no account.
drop index public.check_ins_one_per_booking_day;
create unique index check_ins_one_per_booking_day on public.check_ins
  (booking_id, player_id, ((checked_in_at at time zone 'Asia/Manila')::date)) nulls not distinct
  where booking_id is not null;

-- ---------------------------------------------------------------------------
-- Remove player booking access
-- ---------------------------------------------------------------------------
drop policy "Players read their own bookings" on public.bookings;
drop policy "Players read slots of their bookings" on public.booking_slots;
drop policy "Players read their own payments" on public.payments;
drop function public.hold_slots(jsonb);
drop function public.confirm_booking(uuid);
drop function public.release_held_slot(uuid);
drop function public.submit_payment(uuid, uuid, text, text, text, bigint);
drop function public.get_payment_instructions(uuid);
drop function public.get_my_payments();
drop function public.set_booking_display_name(uuid, text);
drop function private.owns_booking(uuid);
drop function private.proof_path_is_mine(text);

-- Sign-ins are staff accounts: a profile, and roles only from an admin.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _name text := btrim(coalesce(_meta ->> 'full_name', ''));
begin
  if char_length(_name) < 2 then
    _name := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Staff');
  end if;
  insert into public.profiles (id, full_name) values (new.id, left(_name, 80));
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- One line of plain text, 1-30 characters, or null.
create or replace function private.clean_display_name(_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(c) between 1 and 30 then c end
  from (select nullif(btrim(regexp_replace(regexp_replace(coalesce(_name, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '') as c) x;
$$;

-- "0917 123 4567", "+63 917 123 4567" and "639171234567" become "09171234567"; anything else is null.
create or replace function private.normalize_ph_mobile(_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^09[0-9]{9}$' then d
    when d ~ '^639[0-9]{9}$' then '0' || substr(d, 3)
  end
  from (select regexp_replace(coalesce(_phone, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- "0917•••4567": enough for a guest to recognise their own number.
create or replace function private.mask_phone(_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when _phone is null then null else left(_phone, 4) || '•••' || right(_phone, 4) end;
$$;

create or replace function private.token_hash(_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(coalesce(_token, ''), 'UTF8'));
$$;

-- Failed manage-link lookups, for rate limiting (kept one day).
create table private.guest_failed_lookups (
  id bigint generated always as identity primary key,
  reference text not null,
  at timestamptz not null default now()
);
create index guest_failed_lookups_ref_at_idx on private.guest_failed_lookups (reference, at);
alter table private.guest_failed_lookups enable row level security;  -- no policies: functions only
revoke all on private.guest_failed_lookups from public, anon, authenticated;

-- The booking a reference + token opens, or null. Ten failed attempts on a
-- reference in 15 minutes lock it for the rest of that window, whatever the
-- token. Callers must not raise after a null, so the failure is kept.
create or replace function private.guest_booking_id(_reference text, _token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ref text := left(upper(btrim(coalesce(_reference, ''))), 40);
  _id uuid;
begin
  if (select count(*) from private.guest_failed_lookups f
      where f.reference = _ref and f.at > now() - interval '15 minutes') >= 10 then
    return null;
  end if;
  select b.id into _id from public.bookings b
   where b.reference = _ref and b.manage_token_hash = private.token_hash(_token)
     and b.player_id is null;
  if _id is null then
    insert into private.guest_failed_lookups (reference) values (_ref);
  end if;
  return _id;
end;
$$;

-- Adds one-hour rental slots (status 'held') to a booking, with every check
-- the old player cart made: court open, on the hour, in the future, within
-- the booking window and opening hours, with a bookable rate.
create or replace function private.add_rental_slots(_booking_id uuid, _slots jsonb, _actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _settings public.venue_settings;
  _item record;
  _court public.courts;
  _date date;
  _w record;
  _rate record;
  _today date := private.operating_date_of(now());
  _count int;
begin
  if _slots is null or jsonb_typeof(_slots) <> 'array' or jsonb_array_length(_slots) = 0 then
    raise exception 'Choose at least one time slot.' using errcode = '22023';
  end if;
  select * into _settings from public.venue_settings limit 1;

  -- Validate and insert in a fixed order to avoid lock-order deadlocks.
  for _item in
    select distinct (e ->> 'court_id')::uuid as court_id, (e ->> 'starts_at')::timestamptz as starts_at
    from jsonb_array_elements(_slots) e
    order by 1, 2
  loop
    if _item.court_id is null or _item.starts_at is null then
      raise exception 'Each slot needs a court and a start time.' using errcode = '22023';
    end if;

    select * into _court from public.courts where id = _item.court_id;
    if not found or _court.status = 'inactive' then
      raise exception 'That court is not available for booking.' using errcode = '22023';
    end if;
    if _court.status = 'maintenance' then
      raise exception '% is closed for maintenance.', _court.name using errcode = '22023';
    end if;
    if extract(epoch from _item.starts_at)::bigint % 3600 <> 0 then
      raise exception 'Bookings start on the hour.' using errcode = '22023';
    end if;
    if _item.starts_at <= now() then
      raise exception '% at % has already started.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '22023';
    end if;

    _date := private.operating_date_of(_item.starts_at);
    if _date < _today or _date > _today + _settings.booking_window_days then
      raise exception 'You can book up to % days ahead.', _settings.booking_window_days using errcode = '22023';
    end if;

    select * into _w from private.operating_window(_date);
    if _w.state <> 'open' or _item.starts_at < _w.opens_at or _item.starts_at + interval '1 hour' > _w.closes_at then
      raise exception 'The club is not open at % on that day.', private.fmt_time(_item.starts_at) using errcode = '22023';
    end if;

    select * into _rate from private.price_for_slot(_item.court_id, _item.starts_at);
    if _rate.rate_id is null then
      raise exception '% at % cannot be booked online yet. Contact the club.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '22023';
    end if;

    begin
      insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos, price_breakdown, created_by)
      values (
        _booking_id, _item.court_id,
        tstzrange(_item.starts_at, _item.starts_at + interval '1 hour', '[)'),
        'rental', 'held', _rate.price_centavos,
        jsonb_build_object('rate_id', _rate.rate_id, 'label', _rate.label, 'tier', _rate.tier,
                           'price_centavos', _rate.price_centavos),
        _actor
      );
    -- Two sessions inserting the same hour at the same instant can each wait on
    -- the other inside the exclusion check; Postgres then aborts one with a
    -- deadlock. The loser gets the same "just taken" answer either way.
    exception when exclusion_violation or deadlock_detected then
      raise exception '% at % was just taken. Choose another time.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '23P01',
              detail = jsonb_build_object('court_id', _item.court_id, 'starts_at', _item.starts_at)::text;
    end;
  end loop;

  select count(*) into _count from public.booking_slots
   where booking_id = _booking_id and status = 'held';
  if _count > _settings.max_slots_per_booking then
    raise exception 'One booking can hold up to % court-hours.', _settings.max_slots_per_booking using errcode = '22023';
  end if;
end;
$$;

-- The guest's view of a booking (no internal ids except payment methods).
create or replace function private.guest_booking_json(_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select * from public.bookings where id = _booking_id),
  s as (
    select bs.slot, bs.price_centavos, bs.status, c.name as court_name, c.number as court_number
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id = _booking_id and bs.status not in ('released')
  ),
  first_slot as (select min(lower(slot)) as starts_at from s where status not in ('cancelled')),
  cfg as (select guest_cancel_cutoff_minutes as cutoff from public.venue_settings limit 1)
  select jsonb_build_object(
    'reference', b.reference,
    'status', b.status,
    'payment_status', b.payment_status,
    'display_name', b.display_name,
    'display_name_hidden', b.display_name_hidden,
    'phone_masked', private.mask_phone(b.guest_phone),
    'created_at', b.created_at,
    'total_centavos', b.total_centavos,
    'amount_due_centavos', private.amount_due(b.id),
    'payment_due_at', b.payment_due_at,
    'cancelled_at', b.cancelled_at,
    'cancel_reason', b.cancel_reason,
    'first_starts_at', f.starts_at,
    'cancel_until', f.starts_at - make_interval(mins => cfg.cutoff),
    'can_cancel', b.status = 'confirmed' and f.starts_at is not null
                  and now() < f.starts_at - make_interval(mins => cfg.cutoff),
    'slots', coalesce((select jsonb_agg(jsonb_build_object(
                'court_name', s.court_name, 'court_number', s.court_number,
                'starts_at', lower(s.slot), 'ends_at', upper(s.slot),
                'price_centavos', s.price_centavos, 'status', s.status) order by lower(s.slot), s.court_number)
              from s), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
                'method_kind', p.method_kind, 'method_label', coalesce(m.label, p.method_kind::text),
                'amount_centavos', p.amount_centavos, 'status', p.status, 'reference_no', p.reference_no,
                'submitted_at', p.created_at, 'reviewed_at', p.reviewed_at,
                'review_note', case when p.status = 'rejected' then p.review_note end) order by p.created_at)
              from public.payments p left join public.payment_methods m on m.id = p.payment_method_id
              where p.booking_id = b.id), '[]'::jsonb),
    -- How to pay: only while something is due and nothing is being checked.
    'payment_methods', case when b.status = 'confirmed' and b.payment_status = 'unpaid' and private.amount_due(b.id) > 0 then
        coalesce((select jsonb_agg(jsonb_build_object(
                  'id', m.id, 'kind', m.kind, 'label', m.label, 'account_name', m.account_name,
                  'account_number', m.account_number, 'bank_name', m.bank_name,
                  'qr_image_path', m.qr_image_path, 'instructions', m.instructions) order by m.sort_order, m.label)
                from public.payment_methods m where m.is_active), '[]'::jsonb)
      else '[]'::jsonb end
  )
  from b, cfg left join first_slot f on true;
$$;

-- ---------------------------------------------------------------------------
-- Guest functions
-- ---------------------------------------------------------------------------
create or replace function public.guest_create_booking(_slots jsonb, _display_name text, _phone text)
returns table (reference text, token text, total_centavos bigint, payment_due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _name text := private.clean_display_name(_display_name);
  _ph text := private.normalize_ph_mobile(_phone);
  _settings public.venue_settings;
  _token text;
  _b public.bookings;
begin
  if _name is null then
    raise exception 'Enter the name to show on the court board (up to 30 characters).' using errcode = '22023';
  end if;
  if _ph is null then
    raise exception 'Enter a PH mobile number like 09171234567.' using errcode = '22023';
  end if;
  select * into _settings from public.venue_settings limit 1;

  -- Abuse guard per number (serialised so two requests cannot both slip under it).
  perform pg_advisory_xact_lock(hashtext('ph.guest_booking'), hashtext(_ph));
  if (select count(*) from public.bookings b
      where b.guest_phone = _ph and b.created_at > now() - interval '1 hour') >= _settings.guest_bookings_per_hour then
    raise exception 'Too many bookings from this number in the last hour. Try again later or contact the club.'
      using errcode = 'PT429';
  end if;

  perform private.expire_stale_holds();

  _token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  perform set_config('app.audit_reason', 'Guest booking', true);
  insert into public.bookings (player_id, created_by, status, hold_expires_at, display_name, guest_phone, manage_token_hash)
  values (null, null, 'held', now() + make_interval(mins => _settings.hold_minutes), _name, _ph, private.token_hash(_token))
  returning * into _b;

  perform private.add_rental_slots(_b.id, _slots, null);

  -- Confirm straight away: the court times are reserved; payment is separate.
  update public.booking_slots set status = 'confirmed' where booking_id = _b.id and status = 'held';
  update public.bookings set status = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = _b.id;
  perform private.recalculate_booking_total(_b.id);

  return query select b.reference, _token, b.total_centavos, b.payment_due_at from public.bookings b where b.id = _b.id;
end;
$$;

create or replace function public.guest_get_booking(_reference text, _token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid := private.guest_booking_id(_reference, _token);
begin
  if _id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  return private.guest_booking_json(_id);
end;
$$;

create or replace function public.guest_cancel_booking(_reference text, _token text, _reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid := private.guest_booking_id(_reference, _token);
  _b public.bookings;
  _cutoff int;
  _first timestamptz;
  _why text := left(coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Cancelled by guest'), 300);
begin
  if _id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into _b from public.bookings where id = _id for update;
  if _b.status <> 'confirmed' then
    raise exception 'This booking is already %.', _b.status using errcode = '22023';
  end if;
  select guest_cancel_cutoff_minutes into _cutoff from public.venue_settings limit 1;
  select min(lower(slot)) into _first from public.booking_slots
   where booking_id = _b.id and status not in ('released', 'cancelled');
  if _first is null or now() >= _first - make_interval(mins => _cutoff) then
    raise exception 'Bookings can be cancelled online up to % minutes before the start. Contact the club.', _cutoff
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled'
   where booking_id = _b.id and status in ('held', 'confirmed');
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = null, cancel_reason = _why,
         payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                               else payment_status end
   where id = _b.id
  returning * into _b;

  if _b.payment_status = 'refund_due' then
    perform private.notify_payment_verifiers(
      'Refund due: ' || _b.reference,
      _b.display_name || ' cancelled a paid booking online.',
      '/admin/bookings/' || _b.id);
  end if;
  return private.guest_booking_json(_b.id);
end;
$$;

-- Upload grants: one random path per receipt upload, valid 15 minutes.
create table private.receipt_upload_grants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index receipt_upload_grants_booking_idx on private.receipt_upload_grants (booking_id, created_at);
alter table private.receipt_upload_grants enable row level security;  -- no policies: functions only
revoke all on private.receipt_upload_grants from public, anon, authenticated;

create or replace function public.guest_begin_receipt_upload(_reference text, _token text, _extension text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid := private.guest_booking_id(_reference, _token);
  _b public.bookings;
  _ext text := lower(btrim(coalesce(_extension, '')));
  _grant uuid := gen_random_uuid();
  _path text;
begin
  if _id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into _b from public.bookings where id = _id;
  if _b.status <> 'confirmed' or _b.payment_status <> 'unpaid' or private.amount_due(_b.id) <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  if _ext not in ('jpg', 'jpeg', 'png', 'webp') then
    raise exception 'Upload a JPG, PNG or WebP image of your receipt.' using errcode = '22023';
  end if;
  if (select count(*) from private.receipt_upload_grants g
      where g.booking_id = _b.id and g.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many upload attempts. Try again later or pay at the desk.' using errcode = 'PT429';
  end if;
  _path := _b.id::text || '/' || _grant::text || '/receipt.' || _ext;
  insert into private.receipt_upload_grants (id, booking_id, path, expires_at)
  values (_grant, _b.id, _path, now() + interval '15 minutes');
  return jsonb_build_object('bucket', 'payment-proofs', 'path', _path);
end;
$$;

-- Storage INSERT check: the exact path of an open upload grant.
create or replace function private.receipt_upload_allowed(_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.receipt_upload_grants g
    where g.path = _name and g.used_at is null and g.expires_at > now()
  );
$$;

create or replace function public.guest_submit_payment(
  _reference text,
  _token text,
  _payment_method_id uuid,
  _proof_path text,
  _reference_no text default null,
  _proof_sha256 text default null,
  _amount_centavos bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid := private.guest_booking_id(_reference, _token);
  _b public.bookings;
  _m public.payment_methods;
  _g private.receipt_upload_grants;
  _due bigint;
  _ref text := nullif(btrim(coalesce(_reference_no, '')), '');
begin
  if _id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into _b from public.bookings where id = _id for update;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be paid.' using errcode = '22023';
  end if;
  if _b.payment_status = 'pending_verification' then
    raise exception 'A payment for this booking is already being checked.' using errcode = '22023';
  end if;
  if _b.payment_status <> 'unpaid' then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  select * into _m from public.payment_methods where id = _payment_method_id and is_active and kind <> 'cash';
  if not found then
    raise exception 'Choose one of the club''s payment methods.' using errcode = '22023';
  end if;

  -- The receipt must be the file uploaded with this booking's grant.
  select * into _g from private.receipt_upload_grants
   where path = _proof_path and booking_id = _b.id and used_at is null and created_at > now() - interval '1 hour'
   for update;
  if not found or not exists (
    select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = _proof_path
  ) then
    raise exception 'Upload your receipt first.' using errcode = '22023';
  end if;

  _due := private.amount_due(_b.id);
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  if _amount_centavos is not null and _amount_centavos < _due then
    raise exception 'Send the full amount due (₱%). Part payments are not accepted.', to_char(_due / 100.0, 'FM999,999,990.00')
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Guest payment submitted', true);
  begin
    insert into public.payments (booking_id, payment_method_id, method_kind, amount_centavos, declared_centavos, reference_no,
                                 proof_path, proof_sha256, status, submitted_by)
    values (_b.id, _m.id, _m.kind, _due, _amount_centavos, _ref, _proof_path, lower(nullif(_proof_sha256, '')), 'submitted', null);
  exception when unique_violation then
    raise exception 'That reference number or receipt was already used for another payment.' using errcode = '23505';
  end;
  update private.receipt_upload_grants set used_at = now() where id = _g.id;
  update public.bookings set payment_status = 'pending_verification' where id = _b.id;

  perform private.notify_payment_verifiers(
    'Payment to check: ' || _b.reference,
    format('%s · %s · ₱%s', _b.display_name, _m.label, to_char(coalesce(_amount_centavos, _due) / 100.0, 'FM999,999,990.00')),
    '/admin/payments');
  return private.guest_booking_json(_b.id);
end;
$$;

-- QR codes of active payment methods, for the guest checkout (signed links).
create or replace function private.is_active_payment_qr(_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.payment_methods m where m.is_active and m.qr_image_path = _name);
$$;

create policy "Guests upload receipts to a granted path" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'payment-proofs' and private.receipt_upload_allowed(name));
create policy "Anyone views QR codes of active payment methods" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'payment-qr' and private.is_active_payment_qr(name));

-- ---------------------------------------------------------------------------
-- Staff: cancel (with a reason) and the public name
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(_booking_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('bookings.cancel') then
    raise exception 'You do not have permission to cancel bookings.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status not in ('held', 'confirmed') then
    raise exception 'This booking is already %.', _b.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled'
   where booking_id = _b.id and status in ('held', 'confirmed');
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(_why, 300),
         hold_expires_at = case when status = 'held' then hold_expires_at end,
         payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                               else payment_status end
   where id = _b.id;
end;
$$;

create or replace function public.staff_set_booking_display_name(_booking_id uuid, _name text, _hidden boolean, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _clean text := private.clean_display_name(_name);
  _why text;
begin
  if not private.has_permission('bookings.manage') then
    raise exception 'You do not have permission to change bookings.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _clean is null and _b.player_id is null then
    raise exception 'A guest booking needs a name of 1 to 30 characters. Hide it instead to keep it off the board.'
      using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Display name changed: ' || _why, true);
  update public.bookings set display_name = _clean, display_name_hidden = coalesce(_hidden, false) where id = _b.id;
end;
$$;

-- Clean up old rate-limit rows and unused upload grants with the booking jobs.
create or replace function private.run_booking_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.expire_stale_holds();
  perform private.remind_unpaid_bookings();
  perform private.expire_unpaid_bookings();
  delete from private.guest_failed_lookups where at < now() - interval '1 day';
  delete from private.receipt_upload_grants where used_at is null and expires_at < now() - interval '1 day';
end;
$$;


-- ---------------------------------------------------------------------------
-- Staff lists, reports and public views (generated from the baseline
-- definitions; each change is noted above the function)
-- ---------------------------------------------------------------------------
-- Is this booking the staff member's own? An account booking they made, or a
-- guest booking under the phone number on their staff profile. Staff never
-- review, mark paid or record cash for their own bookings.
create or replace function private.booked_by(_b public.bookings, _uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(_uid is not null and (
    _b.player_id = _uid
    or (_b.guest_phone is not null and _b.guest_phone = (select p.phone from public.profiles p where p.id = _uid))
  ), false);
$$;
revoke all on function private.booked_by(public.bookings, uuid) from public;

-- public.report_bookings: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.report_bookings(_from date, _to date)
 RETURNS TABLE(reference text, kind text, operating_date date, first_start timestamp with time zone, courts text, court_hours integer, player_name text, player_phone text, booking_status booking_status, payment_status booking_payment_status, total_centavos bigint, approved_centavos bigint, event_title text, created_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  with s as (
    select bs.booking_id, min(bs.operating_date) as op_date, min(lower(bs.slot)) as first_at,
           string_agg(distinct c.name, ', ' order by c.name) as courts,
           count(*) filter (where bs.status not in ('released', 'cancelled'))::int as hours
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id is not null and bs.status <> 'released'
    group by bs.booking_id
  )
  select b.reference,
         case when b.event_id is not null then 'event_fee' else 'court_rental' end,
         coalesce(s.op_date, private.operating_date_of(b.created_at)), s.first_at, s.courts, coalesce(s.hours, 0),
         coalesce(p.full_name, b.display_name), coalesce(p.phone, b.guest_phone), b.status, b.payment_status, b.total_centavos,
         coalesce((select sum(x.amount_centavos) from public.payments x where x.booking_id = b.id and x.status = 'approved'), 0)::bigint,
         e.title, b.created_at, b.cancelled_at, b.cancel_reason
  from public.bookings b
  left join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  left join public.events e on e.id = b.event_id
  where b.status not in ('cart', 'held')
    and coalesce(s.op_date, private.operating_date_of(b.created_at)) between _from and _to
  order by 3, s.first_at nulls last, b.reference;
end;
$function$;

-- public.report_payments: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.report_payments(_from date, _to date)
 RETURNS TABLE(submitted_at timestamp with time zone, booking_reference text, purpose text, player_name text, method payment_method_kind, amount_centavos bigint, reference_no text, status payment_status, reviewed_by text, reviewed_at timestamp with time zone, review_note text, booking_payment_status booking_payment_status)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  select x.created_at, b.reference,
         case when b.event_id is not null then 'Entry fee: ' || coalesce(e.title, 'event') else 'Court rental' end,
         coalesce(p.full_name, b.display_name), x.method_kind, x.amount_centavos, x.reference_no, x.status,
         r.full_name, x.reviewed_at, x.review_note, b.payment_status
  from public.payments x
  join public.bookings b on b.id = x.booking_id
  left join public.profiles p on p.id = b.player_id
  left join public.profiles r on r.id = x.reviewed_by
  left join public.events e on e.id = b.event_id
  where private.operating_date_of(x.created_at) between _from and _to
  order by x.created_at;
end;
$function$;

-- public.report_check_ins: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.report_check_ins(_from date, _to date)
 RETURNS TABLE(checked_in_at timestamp with time zone, kind text, player_name text, what text, booking_reference text, checked_in_by text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  select ci.checked_in_at, ci.kind, coalesce(p.full_name, b.display_name), coalesce(e.title, 'Court rental'), b.reference, s.full_name
  from public.check_ins ci
  left join public.profiles p on p.id = ci.player_id
  left join public.events e on e.id = ci.event_id
  left join public.bookings b on b.id = ci.booking_id
  left join public.profiles s on s.id = ci.checked_in_by
  where private.operating_date_of(ci.checked_in_at) between _from and _to
  order by ci.checked_in_at;
end;
$function$;

-- public.staff_get_schedule: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_get_schedule(_date date)
 RETURNS TABLE(slot_id uuid, court_id uuid, court_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, kind slot_kind, slot_status slot_status, booking_id uuid, booking_reference text, booking_status booking_status, payment_status booking_payment_status, player_name text, player_phone text, note text, event_title text, display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.is_staff() then
    raise exception 'Only club staff can view the full schedule.' using errcode = '42501';
  end if;
  return query
  select bs.id, bs.court_id, c.name, lower(bs.slot), upper(bs.slot), bs.kind, bs.status,
         b.id, b.reference, b.status, b.payment_status, coalesce(p.full_name, b.display_name), coalesce(p.phone, b.guest_phone), bs.note, e.title, b.display_name
  from public.booking_slots bs
  join public.courts c on c.id = bs.court_id
  left join public.bookings b on b.id = bs.booking_id
  left join public.profiles p on p.id = b.player_id
  left join public.events e on e.id = bs.event_id
  where bs.operating_date = _date
    and private.slot_is_live(bs.status, bs.booking_id)
  order by c.sort_order, c.number, lower(bs.slot);
end;
$function$;

-- public.staff_review_payment: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_review_payment(_payment_id uuid, _approve boolean, _reason text DEFAULT NULL::text, _received_centavos bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _p public.payments;
  _b public.bookings;
  _why text;
  _counted bigint;
  _left bigint;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'That payment was not found.' using errcode = 'P0002';
  end if;
  select * into _b from public.bookings where id = _p.booking_id for update;

  if private.booked_by(_b, _uid) or _p.submitted_by = _uid then
    raise exception 'You cannot review a payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _p.status <> 'submitted' then
    raise exception 'This payment was already %.', _p.status using errcode = '22023';
  end if;

  if _approve then
    if _received_centavos is not null and _received_centavos <= 0 then
      raise exception 'Enter the amount shown on the receipt.' using errcode = '22023';
    end if;
    _counted := coalesce(_received_centavos, _p.amount_centavos);
    _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''),
                     case when _counted < _p.amount_centavos
                          then format('Part payment: ₱%s of ₱%s received', to_char(_counted / 100.0, 'FM999,999,990.00'),
                                      to_char(_p.amount_centavos / 100.0, 'FM999,999,990.00'))
                          else 'Payment verified' end);
  else
    if _reason is null or char_length(btrim(_reason)) < 3 then
      raise exception 'Give the player a reason for rejecting this payment.' using errcode = '22023';
    end if;
    _why := left(btrim(_reason), 500);
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = case when _approve then 'approved'::public.payment_status else 'rejected'::public.payment_status end,
         amount_centavos = case when _approve then _counted else amount_centavos end,
         reviewed_by = _uid, reviewed_at = now(), review_note = _why
   where id = _p.id;

  if _approve then
    _left := private.amount_due(_b.id);
    -- A booking cancelled while its payment was being checked keeps 'refund_due':
    -- the money arrived, so the club owes it back.
    update public.bookings
       set payment_status = case
             when status <> 'confirmed' then 'refund_due'::public.booking_payment_status
             when _left = 0 then 'paid'::public.booking_payment_status
             else 'unpaid'::public.booking_payment_status end,
           payment_due_at = null
     where id = _b.id;
    -- Paid event entries linked to this booking are confirmed.
    update public.event_registrations set status = 'confirmed'
     where booking_id = _b.id and status = 'pending' and _left = 0;
    if _b.status = 'confirmed' and _left > 0 then
      perform private.notify(_b.player_id, 'payment_approved', 'Part of your payment received',
        format('₱%s was received for %s. ₱%s is still due: send the rest from your booking.',
               to_char(_counted / 100.0, 'FM999,999,990.00'), _b.reference, to_char(_left / 100.0, 'FM999,999,990.00')),
        '/bookings/' || _b.id);
    else
      perform private.notify(_b.player_id, 'payment_approved', 'Payment approved',
        format('Your payment for %s was verified. See you on court!', _b.reference), '/bookings/' || _b.id);
    end if;
  else
    -- Confirmed: the player can pay again. Cancelled while being checked: nothing
    -- was received, so no refund is owed after all.
    update public.bookings set payment_status = 'unpaid'
     where id = _b.id
       and (status = 'confirmed'
            or (payment_status = 'refund_due'
                and not exists (select 1 from public.payments where booking_id = _b.id and status = 'approved')));
    perform private.notify(_b.player_id, 'payment_rejected', 'Payment not accepted',
      format('Your payment for %s was not accepted. Reason: %s%s', _b.reference, _why,
             case when _b.status = 'confirmed' then ' You can submit a new payment from your booking.' else '' end),
      '/bookings/' || _b.id);
  end if;
end;
$function$;

-- public.staff_record_cash_payment: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_record_cash_payment(_booking_id uuid, _note text DEFAULT NULL::text, _received_centavos bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _id uuid;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if private.booked_by(_b, _uid) then
    raise exception 'You cannot record a payment for your own booking.' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments where booking_id = _b.id and status = 'submitted') then
    raise exception 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
      using errcode = '22023';
  end if;
  if _b.status <> 'confirmed' or _b.payment_status <> 'unpaid' then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  perform private.record_desk_cash(_b, _received_centavos,
    coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Cash received at the desk'));
  select id into _id from public.payments
   where booking_id = _b.id and method_kind = 'cash' and submitted_by = _uid
   order by created_at desc limit 1;
  return _id;
end;
$function$;

-- public.staff_mark_booking_paid: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_mark_booking_paid(_booking_id uuid, _note text DEFAULT NULL::text, _received_centavos bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to confirm payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if private.booked_by(_b, _uid) then
    raise exception 'You cannot confirm payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only an active booking can be marked paid (this one is %).', _b.status using errcode = '22023';
  end if;
  if _b.payment_status in ('paid', 'waived') then
    return;
  end if;
  if _b.payment_status = 'pending_verification'
     or exists (select 1 from public.payments where booking_id = _b.id and status = 'submitted') then
    raise exception 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
      using errcode = '22023';
  end if;
  if _b.payment_status <> 'unpaid' then
    raise exception 'This booking''s payment is %; it cannot be marked paid.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform private.record_desk_cash(_b, _received_centavos,
    coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Cash received at the desk'));
end;
$function$;

-- public.staff_mark_booking_unpaid: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_mark_booking_unpaid(_booking_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to change payments.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if private.booked_by(_b, _uid) then
    raise exception 'You cannot change payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only an active booking can be changed (this one is %).', _b.status using errcode = '22023';
  end if;
  if _b.payment_status in ('unpaid', 'pending_verification') then
    return;
  end if;
  if _b.payment_status <> 'paid' then
    raise exception 'This booking''s payment is %; it cannot be set back to pending.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = 'rejected', reviewed_by = _uid, reviewed_at = now(), review_note = left('Reversed: ' || _why, 500)
   where booking_id = _b.id and status = 'approved';
  update public.bookings set payment_status = 'unpaid' where id = _b.id;

  perform private.notify(_b.player_id, 'payment_rejected', 'Payment needed',
    format('Your booking %s is waiting for payment again. Reason: %s', _b.reference, _why), '/bookings/' || _b.id);
end;
$function$;

-- public.staff_list_payments: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_list_payments(_status payment_status DEFAULT 'submitted'::payment_status, _limit integer DEFAULT 100)
 RETURNS TABLE(payment_id uuid, status payment_status, method_kind payment_method_kind, method_label text, amount_centavos bigint, reference_no text, proof_path text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, reviewer_name text, review_note text, booking_id uuid, booking_reference text, booking_status booking_status, booking_total_centavos bigint, first_slot_at timestamp with time zone, player_name text, player_phone text, is_own boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;
  return query
  select p.id, p.status, p.method_kind, coalesce(m.label, initcap(replace(p.method_kind::text, '_', ' '))),
         p.amount_centavos, p.reference_no, p.proof_path, p.created_at, p.reviewed_at, r.full_name, p.review_note,
         b.id, b.reference, b.status, b.total_centavos,
         (select min(lower(s.slot)) from public.booking_slots s where s.booking_id = b.id and s.status not in ('released', 'cancelled')),
         coalesce(pl.full_name, b.display_name), coalesce(pl.phone, b.guest_phone),
         (private.booked_by(b, auth.uid()) or coalesce(p.submitted_by = auth.uid(), false))
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  left join public.profiles pl on pl.id = b.player_id
  left join public.payment_methods m on m.id = p.payment_method_id
  left join public.profiles r on r.id = p.reviewed_by
  where _status is null or p.status = _status
  order by case when p.status = 'submitted' then p.created_at end asc nulls last, p.reviewed_at desc nulls last
  limit least(greatest(coalesce(_limit, 100), 1), 500);
end;
$function$;

-- public.staff_search_payments: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_search_payments(_query text DEFAULT NULL::text, _status payment_status DEFAULT NULL::payment_status, _from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _limit integer DEFAULT 100)
 RETURNS TABLE(payment_id uuid, status payment_status, method_kind payment_method_kind, method_label text, amount_centavos bigint, declared_centavos bigint, reference_no text, proof_path text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, reviewer_name text, review_note text, booking_id uuid, booking_reference text, booking_status booking_status, booking_payment_status booking_payment_status, booking_total_centavos bigint, booking_due_centavos bigint, first_slot_at timestamp with time zone, player_name text, player_phone text, is_own boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;
  _pattern := '%' || replace(replace(replace(coalesce(_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.status, p.method_kind, coalesce(m.label, initcap(replace(p.method_kind::text, '_', ' '))),
         p.amount_centavos, p.declared_centavos, p.reference_no, p.proof_path, p.created_at, p.reviewed_at, r.full_name, p.review_note,
         b.id, b.reference, b.status, b.payment_status, b.total_centavos, private.amount_due(b.id),
         (select min(lower(s.slot)) from public.booking_slots s where s.booking_id = b.id and s.status not in ('released', 'cancelled')),
         coalesce(pl.full_name, b.display_name), coalesce(pl.phone, b.guest_phone),
         (private.booked_by(b, auth.uid()) or coalesce(p.submitted_by = auth.uid(), false))
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  left join public.profiles pl on pl.id = b.player_id
  left join public.payment_methods m on m.id = p.payment_method_id
  left join public.profiles r on r.id = p.reviewed_by
  where (_status is null or p.status = _status)
    and (_q is null or b.reference ilike _pattern or pl.full_name ilike _pattern or pl.phone ilike _pattern or b.display_name ilike _pattern or b.guest_phone ilike _pattern
         or p.reference_no ilike _pattern)
    and (_from is null or private.operating_date_of(p.created_at) >= _from)
    and (_to is null or private.operating_date_of(p.created_at) <= _to)
  order by case when p.status = 'submitted' then p.created_at end asc nulls last, coalesce(p.reviewed_at, p.created_at) desc
  limit least(greatest(coalesce(_limit, 100), 1), 500);
end;
$function$;

-- public.staff_search_bookings: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_search_bookings(_query text DEFAULT NULL::text, _from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _status booking_status DEFAULT NULL::booking_status, _payment_status booking_payment_status DEFAULT NULL::booking_payment_status, _limit integer DEFAULT 50)
 RETURNS TABLE(booking_id uuid, reference text, status booking_status, payment_status booking_payment_status, total_centavos bigint, player_id uuid, player_name text, player_phone text, first_slot_at timestamp with time zone, operating_date date, slot_count integer, courts text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
begin
  if not private.is_staff() then
    raise exception 'Only club staff can search bookings.' using errcode = '42501';
  end if;
  _pattern := '%' || replace(replace(replace(coalesce(_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with s as (
    select bs.booking_id, min(lower(bs.slot)) as first_at, min(bs.operating_date) as op_date, count(*)::int as n,
           string_agg(distinct c.name, ', ' order by c.name) as courts
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id is not null and bs.status <> 'released'
    group by bs.booking_id
  )
  select b.id, b.reference, b.status, b.payment_status, b.total_centavos, p.id, coalesce(p.full_name, b.display_name), coalesce(p.phone, b.guest_phone),
         s.first_at, s.op_date, coalesce(s.n, 0), s.courts, b.created_at
  from public.bookings b
  left join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  where (_q is null or b.reference ilike _pattern or p.full_name ilike _pattern or p.phone ilike _pattern or b.display_name ilike _pattern or b.guest_phone ilike _pattern
         or exists (select 1 from public.payments pa where pa.booking_id = b.id and pa.reference_no ilike _pattern))
    and (_from is null or s.op_date >= _from)
    and (_to is null or s.op_date <= _to)
    and (_status is null or b.status = _status)
    and (_payment_status is null or b.payment_status = _payment_status)
    and b.status <> 'cart'
  order by s.first_at desc nulls last, b.created_at desc
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$function$;

-- public.staff_delete_booking: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.staff_delete_booking(_booking_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _why text;
  _b public.bookings;
  _who text;
  _when text;
  _received bigint;
begin
  if not private.is_admin() then
    raise exception 'Only admins can delete bookings.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;

  select coalesce((select full_name from public.profiles where id = _b.player_id), _b.display_name) into _who;
  _when := private.booking_when(_b.id);
  select coalesce(sum(amount_centavos), 0) into _received
  from public.payments where booking_id = _b.id and status = 'approved';

  perform set_config('app.audit_reason', 'Booking deleted: ' || _why, true);

  -- Event entry: cancel first so the registration is cancelled the usual way.
  if _b.event_id is not null and _b.status in ('held', 'confirmed') then
    update public.booking_slots set status = 'cancelled' where booking_id = _b.id and status in ('held', 'confirmed');
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid, cancel_reason = left(_why, 300)
     where id = _b.id;
  end if;

  -- Payments (accepted or not) go with it; the audit log keeps a copy of each.
  delete from public.payments where booking_id = _b.id;
  -- Court hours cascade with the booking; check-ins keep their history without the link.
  delete from public.bookings where id = _b.id;

  if _b.player_id is distinct from _uid and _b.status in ('confirmed', 'completed') then
    perform private.notify(_b.player_id, 'booking_cancelled', 'Booking removed',
      format('Your booking %s%s was removed by the club. Reason: %s%s', _b.reference,
             coalesce(' (' || _when || ')', ''), _why,
             case when _received > 0 then ' The club will contact you about your payment.' else '' end),
      '/player/bookings');
  end if;
  perform private.notify_staff('Booking deleted',
    concat_ws(' · ', _b.reference, _who, _when,
              case when _received > 0 then private.peso(_received) || ' had been received: refund outside the system' end,
              _why)
      || coalesce((select ' · by ' || full_name from public.profiles where id = _uid), ''),
    '/admin/bookings', _uid);
end;
$function$;

-- public.get_court_availability: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.get_court_availability(_date date)
 RETURNS TABLE(court_id uuid, court_number smallint, court_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, price_centavos bigint, rate_label text, tier text, label text, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  _w record;
  _today date := private.operating_date_of(now());
  _window int;
  _uid uuid := auth.uid();
begin
  select * into _w from private.operating_window(_date);
  if _w.state <> 'open' then
    return;
  end if;
  select booking_window_days into _window from public.venue_settings limit 1;

  return query
  select
    c.id, c.number, c.name, h.hour_start, h.hour_start + interval '1 hour',
    case
      when s.id is not null then
        case s.kind
          when 'rental' then
            case when s.status = 'held' then (case when s.mine then 'in_cart' else 'held' end)
                 when s.mine then 'mine'
                 when s.payment_status in ('paid', 'waived') then 'booked'
                 else 'pending' end
          when 'maintenance' then 'maintenance'
          when 'block' then 'blocked'
          when 'private_event' then 'private_event'
          else 'event'
        end
      when c.status = 'maintenance' then 'maintenance'
      when h.hour_start <= now() then 'past'
      when _date > _today + _window or _date < _today then 'not_bookable'
      when p.price_centavos is null then 'unpriced'
      else 'available'
    end,
    case when s.id is null and c.status = 'active' then p.price_centavos
         when s.mine then s.price_centavos end,
    p.label,
    p.tier,
    case
      when s.kind in ('event', 'open_play') then coalesce(s.event_title, 'Event')
      when s.kind = 'private_event' then 'Private event'
      when s.kind = 'maintenance' or (s.id is null and c.status = 'maintenance') then 'Maintenance'
      when s.kind = 'block' then 'Unavailable'
      when s.kind = 'rental' and s.status <> 'held' then s.display_name
    end,
    coalesce(s.mine, false)
  from public.courts c
  cross join lateral generate_series(_w.opens_at, _w.closes_at - interval '1 hour', interval '1 hour') as h(hour_start)
  left join lateral (
    select bs.id, bs.kind, bs.status, bs.price_centavos, b.payment_status, case when b.display_name_hidden then null else b.display_name end as display_name,
           (b.player_id = _uid and _uid is not null) as mine,
           case when e.status <> 'draft' then e.title end as event_title
    from public.booking_slots bs
    left join public.bookings b on b.id = bs.booking_id
    left join public.events e on e.id = bs.event_id
    where bs.court_id = c.id
      and bs.slot && tstzrange(h.hour_start, h.hour_start + interval '1 hour')
      and private.slot_is_live(bs.status, bs.booking_id)
    order by (bs.kind = 'rental') asc
    limit 1
  ) s on true
  left join lateral private.price_for_slot(c.id, h.hour_start) p on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number, h.hour_start;
end;
$function$;

-- public.get_live_courts: guests have no profile; their name and phone are on the booking.
CREATE OR REPLACE FUNCTION public.get_live_courts()
 RETURNS TABLE(court_id uuid, court_number smallint, court_name text, status text, label text, until timestamp with time zone, next_starts_at timestamp with time zone, next_status text, as_of timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  _today date := private.operating_date_of(now());
  _w record;
begin
  select * into _w from private.operating_window(_today);
  return query
  with live as (
    select bs.court_id, bs.slot, bs.kind, bs.status, bs.event_id,
           case when e.status <> 'draft' then e.title end as event_title,
           (b.payment_status in ('paid', 'waived')) as paid,
           case when b.display_name_hidden then null else b.display_name end as display_name
    from public.booking_slots bs
    left join public.events e on e.id = bs.event_id
    left join public.bookings b on b.id = bs.booking_id
    where bs.operating_date in (_today, _today + 1)
      and bs.status not in ('released', 'cancelled', 'held')
  )
  select
    c.id, c.number, c.name,
    case
      when c.status = 'maintenance' then 'maintenance'
      when cur.kind = 'rental' and cur.paid then 'in_use'
      when cur.kind = 'rental' then 'reserved'
      when cur.kind = 'maintenance' then 'maintenance'
      when cur.kind = 'block' then 'blocked'
      when cur.kind = 'private_event' then 'private_event'
      when cur.kind is not null then 'event'
      when _w.state <> 'open' or now() < _w.opens_at or now() >= _w.closes_at then 'closed'
      else 'available'
    end,
    case
      when cur.kind = 'rental' then cur.display_name
      when cur.kind = 'open_play' then coalesce(cur.event_title, 'Open play')
        || case qg.status when 'playing' then ' · game in progress' when 'called' then ' · players called' else '' end
      when cur.kind = 'event' then coalesce(cur.event_title, 'Event') || coalesce(' · ' || mt.division_name, '')
      when cur.kind = 'private_event' then 'Private event'
      when cur.kind = 'maintenance' or c.status = 'maintenance' then 'Maintenance'
    end,
    upper(cur.slot),
    nxt.starts,
    case
      when nxt.kind is null then null
      when nxt.kind = 'rental' and nxt.paid then 'booked'
      when nxt.kind = 'rental' then 'reserved'
      when nxt.kind = 'maintenance' then 'maintenance'
      when nxt.kind = 'block' then 'blocked'
      when nxt.kind = 'private_event' then 'private_event'
      else 'event'
    end,
    now()
  from public.courts c
  left join lateral (
    select l.kind, l.slot, l.event_title, l.event_id, l.paid, l.display_name from live l
    where l.court_id = c.id and l.slot @> now()
    limit 1
  ) cur on true
  left join lateral (
    select g.status from public.queue_games g
    where g.court_id = c.id and g.event_id = cur.event_id and g.status in ('called', 'playing')
    limit 1
  ) qg on true
  left join lateral (
    select d.name as division_name from public.event_matches m join public.event_divisions d on d.id = m.division_id
    where m.court_id = c.id and m.event_id = cur.event_id and m.scheduled @> now()
      and m.status in ('scheduled', 'in_progress')
    limit 1
  ) mt on true
  left join lateral (
    select lower(l.slot) as starts, l.kind, l.paid from live l
    where l.court_id = c.id and lower(l.slot) > now()
    order by lower(l.slot)
    limit 1
  ) nxt on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.clean_display_name(text), private.normalize_ph_mobile(text), private.mask_phone(text),
  private.token_hash(text), private.guest_booking_id(text, text), private.add_rental_slots(uuid, jsonb, uuid),
  private.guest_booking_json(uuid), private.receipt_upload_allowed(text), private.is_active_payment_qr(text),
  private.next_booking_reference(), private.run_booking_jobs(),
  public.guest_create_booking(jsonb, text, text), public.guest_get_booking(text, text),
  public.guest_cancel_booking(text, text, text), public.guest_begin_receipt_upload(text, text, text),
  public.guest_submit_payment(text, text, uuid, text, text, text, bigint),
  public.cancel_booking(uuid, text), public.staff_set_booking_display_name(uuid, text, boolean, text)
from public;

-- Guests (anonymous visitors) and signed-in staff.
grant execute on function
  public.guest_create_booking(jsonb, text, text), public.guest_get_booking(text, text),
  public.guest_cancel_booking(text, text, text), public.guest_begin_receipt_upload(text, text, text),
  public.guest_submit_payment(text, text, uuid, text, text, text, bigint)
to anon, authenticated;
-- Evaluated inside storage policies, as the caller.
grant execute on function private.receipt_upload_allowed(text), private.is_active_payment_qr(text) to anon, authenticated;
-- Staff.
grant execute on function public.cancel_booking(uuid, text), public.staff_set_booking_display_name(uuid, text, boolean, text)
to authenticated;
