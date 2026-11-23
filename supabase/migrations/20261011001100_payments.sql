-- ============================================================================
-- Payments (manual verification) and staff operations
--
-- Player:  get_payment_instructions → upload proof (private bucket)
--          → submit_payment → wait → notified of approval or rejection
-- Staff:   staff_list_payments → open proof (signed URL) → staff_review_payment
--
-- Rules
--   * No payment gateway. Nothing is ever approved automatically.
--   * The amount due is computed here from the booking; clients cannot set it.
--   * Nobody can review a payment for their own booking or one they submitted.
--   * Booking status and payment status stay separate: approval sets
--     bookings.payment_status = 'paid'; the booking stays 'confirmed'.
--   * The club's account details and QR codes are visible only to staff and
--     to signed-in players with a booking to pay.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings and booking columns
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  add column payment_due_hours int check (payment_due_hours is null or payment_due_hours between 1 and 720);

comment on column public.venue_settings.payment_due_hours is
  'Confirmed bookings with no payment submitted within this many hours (or by their first slot, if sooner) are cancelled automatically. NULL: never cancelled for non-payment.';

alter table public.bookings add column payment_due_at timestamptz;

-- Set the payment deadline when a booking is confirmed, if the club uses one.
create or replace function private.set_payment_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _hours int;
  _first timestamptz;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.payment_status = 'unpaid' then
    select payment_due_hours into _hours from public.venue_settings limit 1;
    if _hours is not null then
      select min(lower(slot)) into _first from public.booking_slots
       where booking_id = new.id and status not in ('released', 'cancelled');
      new.payment_due_at := least(now() + make_interval(hours => _hours), coalesce(_first, 'infinity'::timestamptz));
    end if;
  end if;
  return new;
end;
$$;

create trigger bookings_set_payment_due
before update of status on public.bookings
for each row execute function private.set_payment_due();

-- ---------------------------------------------------------------------------
-- Payments: reference optional; proof required for online methods.
-- A rejected submission no longer blocks reusing its reference or file.
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint payments_check;
alter table public.payments
  add constraint payments_online_needs_proof check (method_kind = 'cash' or proof_path is not null);

drop index public.payments_reference_unique;
drop index public.payments_proof_hash_unique;
create unique index payments_reference_unique on public.payments (method_kind, lower(btrim(reference_no)))
  where reference_no is not null and status <> 'rejected';
create unique index payments_proof_hash_unique on public.payments (proof_sha256)
  where proof_sha256 is not null and status <> 'rejected';
-- At most one submission waiting for review per booking.
create unique index payments_one_pending_per_booking on public.payments (booking_id) where status = 'submitted';

-- ---------------------------------------------------------------------------
-- Payment methods: no longer public. Staff read all; players use
-- get_payment_instructions for a booking they need to pay.
-- ---------------------------------------------------------------------------
drop policy "Anyone reads active payment methods" on public.payment_methods;
create policy "Staff read payment methods" on public.payment_methods
for select to authenticated using ((select private.is_staff()));
revoke select on public.payment_methods from anon;

-- QR codes move to a private bucket (signed-in users can view; admins manage).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr', 'payment-qr', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Signed-in users view payment QR codes"
on storage.objects for select to authenticated
using (bucket_id = 'payment-qr');

create policy "Admins upload payment QR codes"
on storage.objects for insert to authenticated
with check (bucket_id = 'payment-qr' and (select private.is_admin()));

create policy "Admins update payment QR codes"
on storage.objects for update to authenticated
using (bucket_id = 'payment-qr' and (select private.is_admin()))
with check (bucket_id = 'payment-qr' and (select private.is_admin()));

create policy "Admins delete payment QR codes"
on storage.objects for delete to authenticated
using (bucket_id = 'payment-qr' and (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- In-app notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('payment_submitted', 'payment_approved', 'payment_rejected',
                                     'booking_cancelled', 'refund_recorded')),
  title text not null check (char_length(title) <= 120),
  body text check (body is null or char_length(body) <= 500),
  link text check (link is null or link ~ '^/'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy "Users read their own notifications" on public.notifications
for select to authenticated using (user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function private.notify(_user uuid, _kind text, _title text, _body text, _link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link) values (_user, _kind, _title, _body, _link);
$$;

-- Everyone who can verify payments (active staff with the permission, and admins).
create or replace function private.notify_payment_verifiers(_title text, _body text, _link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct p.id, 'payment_submitted', _title, _body, _link
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  where p.status = 'active'
    and (ur.role = 'admin'
         or (ur.role = 'staff' and exists (select 1 from public.staff_permissions sp
                                           where sp.user_id = p.id and sp.permission = 'payments.verify')));
$$;

create or replace function public.mark_notifications_read(_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (_ids is null or id = any (_ids));
$$;

-- ---------------------------------------------------------------------------
-- Amount still owed on a booking (total minus approved payments)
-- ---------------------------------------------------------------------------
create or replace function private.amount_due(_booking_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(b.total_centavos - coalesce((
           select sum(p.amount_centavos) from public.payments p
           where p.booking_id = b.id and p.status = 'approved'), 0), 0)
  from public.bookings b where b.id = _booking_id;
$$;

-- ---------------------------------------------------------------------------
-- Player: instructions and submission
-- ---------------------------------------------------------------------------
create or replace function public.get_payment_instructions(_booking_id uuid)
returns table (
  payment_method_id uuid,
  kind public.payment_method_kind,
  label text,
  account_name text,
  account_number text,
  bank_name text,
  qr_image_path text,
  instructions text,
  amount_due_centavos bigint,
  booking_reference text,
  payment_due_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _b public.bookings;
begin
  select * into _b from public.bookings where id = _booking_id;
  if not found or (_b.player_id <> auth.uid() and not private.has_permission('payments.verify')) then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be paid.' using errcode = '22023';
  end if;
  return query
  select m.id, m.kind, m.label, m.account_name, m.account_number, m.bank_name, m.qr_image_path, m.instructions,
         private.amount_due(_b.id), _b.reference, _b.payment_due_at
  from public.payment_methods m
  where m.is_active and m.kind <> 'cash'
  order by m.sort_order, m.label;
end;
$$;

create or replace function public.submit_payment(
  _booking_id uuid,
  _payment_method_id uuid,
  _proof_path text,
  _reference_no text default null,
  _proof_sha256 text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _b public.bookings;
  _m public.payment_methods;
  _due bigint;
  _id uuid;
  _ref text := nullif(btrim(coalesce(_reference_no, '')), '');
begin
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or _b.player_id <> _uid then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
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

  -- The proof must be a file this player uploaded to this booking's private folder.
  if _proof_path is null or _proof_path not like _uid::text || '/' || _b.id::text || '/%' then
    raise exception 'Upload your proof of payment first.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-proofs' and o.name = _proof_path
      and (o.owner = _uid or o.owner_id = _uid::text)
  ) then
    raise exception 'Your proof of payment was not found. Upload it again.' using errcode = '22023';
  end if;

  _due := private.amount_due(_b.id);
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  begin
    insert into public.payments (booking_id, payment_method_id, method_kind, amount_centavos, reference_no,
                                 proof_path, proof_sha256, status, submitted_by)
    values (_b.id, _m.id, _m.kind, _due, _ref, _proof_path, lower(nullif(_proof_sha256, '')), 'submitted', _uid)
    returning id into _id;
  exception when unique_violation then
    raise exception 'That reference number or receipt was already used for another payment.' using errcode = '23505';
  end;

  update public.bookings set payment_status = 'pending_verification' where id = _b.id;

  perform private.notify_payment_verifiers(
    'Payment to check: ' || _b.reference,
    format('%s · ₱%s', _m.label, to_char(_due / 100.0, 'FM999,999,990.00')),
    '/admin/payments');
  return _id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: payment queue and review
-- ---------------------------------------------------------------------------
create or replace function public.staff_list_payments(_status public.payment_status default 'submitted', _limit int default 100)
returns table (
  payment_id uuid,
  status public.payment_status,
  method_kind public.payment_method_kind,
  method_label text,
  amount_centavos bigint,
  reference_no text,
  proof_path text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_name text,
  review_note text,
  booking_id uuid,
  booking_reference text,
  booking_status public.booking_status,
  booking_total_centavos bigint,
  first_slot_at timestamptz,
  player_name text,
  player_phone text,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
         pl.full_name, pl.phone,
         (b.player_id = auth.uid() or p.submitted_by = auth.uid())
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  join public.profiles pl on pl.id = b.player_id
  left join public.payment_methods m on m.id = p.payment_method_id
  left join public.profiles r on r.id = p.reviewed_by
  where _status is null or p.status = _status
  order by case when p.status = 'submitted' then p.created_at end asc nulls last, p.reviewed_at desc nulls last
  limit least(greatest(coalesce(_limit, 100), 1), 500);
end;
$$;

create or replace function public.staff_review_payment(_payment_id uuid, _approve boolean, _reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _p public.payments;
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'That payment was not found.' using errcode = 'P0002';
  end if;
  select * into _b from public.bookings where id = _p.booking_id for update;

  if _b.player_id = _uid or _p.submitted_by = _uid then
    raise exception 'You cannot review a payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _p.status <> 'submitted' then
    raise exception 'This payment was already %.', _p.status using errcode = '22023';
  end if;

  if _approve then
    _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Payment verified');
  else
    if _reason is null or char_length(btrim(_reason)) < 3 then
      raise exception 'Give the player a reason for rejecting this payment.' using errcode = '22023';
    end if;
    _why := left(btrim(_reason), 500);
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = case when _approve then 'approved'::public.payment_status else 'rejected'::public.payment_status end,
         reviewed_by = _uid, reviewed_at = now(), review_note = _why
   where id = _p.id;

  if _approve then
    -- A booking cancelled while its payment was being checked keeps 'refund_due':
    -- the money arrived, so the club owes it back.
    update public.bookings
       set payment_status = case
             when status <> 'confirmed' then 'refund_due'::public.booking_payment_status
             when private.amount_due(_b.id) = 0 then 'paid'::public.booking_payment_status
             else 'unpaid'::public.booking_payment_status end,
           payment_due_at = null
     where id = _b.id;
    -- Paid event entries linked to this booking are confirmed.
    update public.event_registrations set status = 'confirmed'
     where booking_id = _b.id and status = 'pending';
    perform private.notify(_b.player_id, 'payment_approved', 'Payment approved',
      format('Your payment for %s was verified. See you on court!', _b.reference), '/bookings/' || _b.id);
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
$$;

-- Cash received at the front desk.
create or replace function public.staff_record_cash_payment(_booking_id uuid, _note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _due bigint;
  _id uuid;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot record a payment for your own booking.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' or _b.payment_status not in ('unpaid') then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  _due := private.amount_due(_b.id);
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Cash received at the desk'), true);
  insert into public.payments (booking_id, method_kind, amount_centavos, status, submitted_by, reviewed_by, reviewed_at, review_note)
  values (_b.id, 'cash', _due, 'approved', _uid, _uid, now(), coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Cash received at the desk'))
  returning id into _id;
  update public.bookings set payment_status = 'paid', payment_due_at = null where id = _b.id;
  perform private.notify(_b.player_id, 'payment_approved', 'Payment received',
    format('Cash payment for %s was recorded.', _b.reference), '/bookings/' || _b.id);
  return _id;
end;
$$;

-- Close out a refund owed after a cancellation (money returned outside the system).
create or replace function public.staff_record_refund(_booking_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to record refunds.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.payment_status <> 'refund_due' then
    raise exception 'This booking has no refund due.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.bookings set payment_status = 'refunded' where id = _b.id;
  perform private.notify(_b.player_id, 'refund_recorded', 'Refund sent',
    format('Your refund for %s was recorded: %s', _b.reference, _why), '/bookings/' || _b.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment deadline: cancel confirmed bookings left unpaid past their deadline
-- ---------------------------------------------------------------------------
create or replace function private.expire_unpaid_bookings()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b record;
  _n int := 0;
begin
  for _b in
    select id, player_id, reference from public.bookings
    where status = 'confirmed' and payment_status = 'unpaid'
      and payment_due_at is not null and payment_due_at <= now()
    for update skip locked
  loop
    perform set_config('app.audit_reason', 'Payment not received by the deadline', true);
    update public.booking_slots set status = 'cancelled'
     where booking_id = _b.id and status in ('held', 'confirmed');
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not received by the deadline'
     where id = _b.id;
    perform private.notify(_b.player_id, 'booking_cancelled', 'Booking cancelled',
      format('%s was cancelled because payment was not received in time. The times are open again.', _b.reference),
      '/bookings/' || _b.id);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

create or replace function private.run_booking_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.expire_stale_holds();
  perform private.expire_unpaid_bookings();
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('dd-expire-stale-holds');
    exception when others then
      null;
    end;
    perform cron.schedule('dd-booking-jobs', '* * * * *', 'select private.run_booking_jobs()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Staff operations: dashboard, booking search, player lookup
-- ---------------------------------------------------------------------------
create or replace function public.staff_dashboard()
returns table (
  operating_date date,
  bookings_today int,
  court_hours_today int,
  unpaid_today int,
  pending_payments int,
  oldest_pending_at timestamptz,
  refunds_due int,
  active_holds int,
  courts_total int,
  courts_in_use int,
  courts_maintenance int,
  hours_configured boolean,
  rates_configured boolean,
  payment_methods_active int,
  payment_due_hours int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _today date := private.operating_date_of(now());
begin
  if not private.is_staff() then
    raise exception 'Only club staff can view the dashboard.' using errcode = '42501';
  end if;
  return query
  select
    _today,
    (select count(distinct s.booking_id)::int from public.booking_slots s join public.bookings b on b.id = s.booking_id
      where s.operating_date = _today and b.status = 'confirmed' and s.status in ('confirmed', 'checked_in', 'completed')),
    (select count(*)::int from public.booking_slots s join public.bookings b on b.id = s.booking_id
      where s.operating_date = _today and b.status = 'confirmed' and s.status in ('confirmed', 'checked_in', 'completed')),
    (select count(distinct b.id)::int from public.bookings b join public.booking_slots s on s.booking_id = b.id
      where s.operating_date = _today and b.status = 'confirmed' and b.payment_status = 'unpaid'),
    (select count(*)::int from public.payments where status = 'submitted'),
    (select min(created_at) from public.payments where status = 'submitted'),
    (select count(*)::int from public.bookings where payment_status = 'refund_due'),
    (select count(*)::int from public.bookings where status = 'held' and hold_expires_at > now()),
    (select count(*)::int from public.courts where status <> 'inactive'),
    (select count(distinct s.court_id)::int from public.booking_slots s
      where s.slot @> now() and s.status in ('confirmed', 'checked_in') and s.kind = 'rental'),
    (select count(*)::int from public.courts c where c.status = 'maintenance'
       or exists (select 1 from public.booking_slots s where s.court_id = c.id and s.kind = 'maintenance'
                  and s.status = 'confirmed' and s.slot @> now())),
    exists (select 1 from public.operating_hours where not is_closed),
    exists (select 1 from public.rate_rules where is_active and product = 'court_rental'),
    (select count(*)::int from public.payment_methods where is_active and kind <> 'cash'),
    (select v.payment_due_hours from public.venue_settings v limit 1);
end;
$$;

create or replace function public.staff_search_bookings(
  _query text default null,
  _from date default null,
  _to date default null,
  _status public.booking_status default null,
  _payment_status public.booking_payment_status default null,
  _limit int default 50
)
returns table (
  booking_id uuid,
  reference text,
  status public.booking_status,
  payment_status public.booking_payment_status,
  total_centavos bigint,
  player_id uuid,
  player_name text,
  player_phone text,
  first_slot_at timestamptz,
  operating_date date,
  slot_count int,
  courts text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  select b.id, b.reference, b.status, b.payment_status, b.total_centavos, p.id, p.full_name, p.phone,
         s.first_at, s.op_date, coalesce(s.n, 0), s.courts, b.created_at
  from public.bookings b
  join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  where (_q is null or b.reference ilike _pattern or p.full_name ilike _pattern or p.phone ilike _pattern)
    and (_from is null or s.op_date >= _from)
    and (_to is null or s.op_date <= _to)
    and (_status is null or b.status = _status)
    and (_payment_status is null or b.payment_status = _payment_status)
    and b.status <> 'cart'
  order by s.first_at desc nulls last, b.created_at desc
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;

create or replace function public.staff_lookup_players(_query text, _limit int default 25)
returns table (
  player_id uuid,
  full_name text,
  phone text,
  email text,
  level public.player_level,
  self_rated_level public.player_level,
  status public.account_status,
  bookings_total int,
  bookings_upcoming int,
  unpaid_bookings int,
  last_booking_at timestamptz,
  member_since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
  _can_email boolean := private.has_permission('players.manage');
begin
  if not private.is_staff() then
    raise exception 'Only club staff can look up players.' using errcode = '42501';
  end if;
  if _q is null or char_length(_q) < 2 then
    raise exception 'Type at least two letters or digits to search.' using errcode = '22023';
  end if;
  _pattern := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.full_name, p.phone,
         case when _can_email then u.email::text end,
         p.level, p.self_rated_level, p.status,
         (select count(*)::int from public.bookings b where b.player_id = p.id and b.status in ('confirmed', 'completed', 'cancelled')),
         (select count(*)::int from public.bookings b where b.player_id = p.id and b.status = 'confirmed'
            and exists (select 1 from public.booking_slots s where s.booking_id = b.id and upper(s.slot) > now()
                        and s.status = 'confirmed')),
         (select count(*)::int from public.bookings b where b.player_id = p.id and b.status = 'confirmed' and b.payment_status = 'unpaid'),
         (select max(b.created_at) from public.bookings b where b.player_id = p.id),
         p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.full_name ilike _pattern or p.phone ilike _pattern or (_can_email and u.email ilike _pattern)
  order by p.full_name
  limit least(greatest(coalesce(_limit, 25), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.set_payment_due(), private.notify(uuid, text, text, text, text),
  private.notify_payment_verifiers(text, text, text), private.amount_due(uuid),
  private.expire_unpaid_bookings(), private.run_booking_jobs()
  from public, anon, authenticated;
grant execute on function private.run_booking_jobs(), private.expire_unpaid_bookings() to service_role;

revoke all on function
  public.mark_notifications_read(uuid[]), public.get_payment_instructions(uuid),
  public.submit_payment(uuid, uuid, text, text, text),
  public.staff_list_payments(public.payment_status, int), public.staff_review_payment(uuid, boolean, text),
  public.staff_record_cash_payment(uuid, text), public.staff_record_refund(uuid, text),
  public.staff_dashboard(),
  public.staff_search_bookings(text, date, date, public.booking_status, public.booking_payment_status, int),
  public.staff_lookup_players(text, int)
  from public, anon, authenticated;
grant execute on function
  public.mark_notifications_read(uuid[]), public.get_payment_instructions(uuid),
  public.submit_payment(uuid, uuid, text, text, text),
  public.staff_list_payments(public.payment_status, int), public.staff_review_payment(uuid, boolean, text),
  public.staff_record_cash_payment(uuid, text), public.staff_record_refund(uuid, text),
  public.staff_dashboard(),
  public.staff_search_bookings(text, date, date, public.booking_status, public.booking_payment_status, int),
  public.staff_lookup_players(text, int)
  to authenticated;

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

comment on column public.payment_methods.qr_image_path is
  'Path of the QR code image in the private payment-qr bucket (shown to signed-in players with a booking to pay).';
comment on table public.payment_methods is
  'The club''s receiving accounts. Not public: staff read them directly; players see them only through get_payment_instructions.';
