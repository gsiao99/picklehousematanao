-- ============================================================================
-- New enum values for the booking engine.
-- Kept in their own migration: Postgres cannot use a new enum value in the
-- same transaction that adds it.
-- ============================================================================

alter type public.slot_kind add value if not exists 'private_event';

-- Payment progress is tracked separately from the booking's own status.
create type public.booking_payment_status as enum (
  'unpaid',
  'pending_verification',
  'paid',
  'refund_due',
  'refunded',
  'waived'
);

comment on type public.booking_status is
  'Reservation lifecycle. The engine uses held → confirmed → completed, plus expired and cancelled. '
  'The legacy values cart, pending_verification and rejected are unused; payment progress lives in bookings.payment_status.';
