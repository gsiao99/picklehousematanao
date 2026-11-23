# Backend setup (Supabase)

The database schema, security rules and storage buckets are migrations in `supabase/migrations/`. **No Supabase project exists for Picklehouse Matanao yet**; one is created in the Singapore region in Phase 4. The checklist that follows is how to set up a project (staging first, then production). Without Supabase settings (for example a local checkout with no `.env.local`), the site runs as a public homepage only.

## What remains to configure

| Step | Who | Where |
| --- | --- | --- |
| 1. Create two Supabase projects: `dd-staging` and `dd-production`, region Singapore | Owner | supabase.com |
| 2. Apply the migrations to staging, review, then production | Developer | Supabase CLI (below) |
| 3. Set the auth settings below on each project | Owner / developer | Dashboard → Authentication |
| 4. Set up email sending (custom SMTP, e.g. Resend) so confirmation and reset emails arrive reliably | Owner | Dashboard → Authentication → SMTP |
| 5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to `.env.local` and to the hosting provider | Developer | Project Settings → API Keys |
| 6. Sign up in the app with the owner's email, confirm it, then provision the first admin | Owner | App, then SQL editor |
| 7. Run the database tests against staging (`supabase test db`) | Developer | CLI |
| 8. Enter weekly opening hours and court rates in the app (**Booking settings**). Until then nothing is bookable | Owner | `/admin/settings` |
| 9. Check pg_cron and Realtime (below) | Developer | Dashboard → Database |
| 10. Add the club's GCash, Maya and/or bank account (and QR codes) in **Settings → Payment methods**. Until then players are told online payment is not set up | Owner | `/admin/settings` |
| 11. Give payment staff the `payments.verify` permission (admins have it already) | Owner | `/admin/members` |
| 12. Decide whether unpaid bookings should be cancelled automatically (**Booking rules → Cancel unpaid bookings after**). Off by default | Owner | `/admin/settings` |
| 13. Give event staff `events.manage` (all events) or `openplay.manage` (open play only); give desk staff `bookings.manage` to check in court rentals | Owner | `/admin/members` |
| 14. Add the club's event categories (for example Men's Doubles, Mixed Doubles, Singles) before creating divisions | Owner / staff | `/admin/events` |

## Apply the migrations

```bash
npx supabase login
npx supabase link --project-ref <staging-ref>
npx supabase db push --dry-run     # review exactly what will run
npx supabase db push
```

**Review before pushing to a project that already has data.** The migrations only create new objects, but note:

- They create types, tables and a trigger named `on_auth_user_created` on `auth.users`. If an earlier tool (for example Lovable) already created objects with these names, the push stops with an error instead of overwriting anything. Resolve the clash by hand.
- `20261011000800_api_grants.sql` changes the default privileges for **future** tables in `public`: new tables get no API access until a migration grants it. Existing tables from other tools are not changed.
- Sign-ups that already exist in `auth.users` before the migration get no profile automatically. Ask before back-filling them.

## Auth settings (Dashboard → Authentication)

| Setting | Value |
| --- | --- |
| Site URL | `https://<your-domain>` (staging: the staging URL) |
| Redirect URLs | `https://<your-domain>/auth/callback`, `https://<your-domain>/reset-password`, plus `http://localhost:5173/**` on staging only |
| Email provider | Enabled; **Confirm email** on |
| Anonymous sign-ins | Off |
| Minimum password length | 8, require letters and digits |
| Secure password change | On |

## Environment variables

Only these two values go in the browser build. Both are safe to expose; Row Level Security protects the data.

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # or the legacy "anon" key
VITE_SITE_URL=https://<your-domain>
```

**Never** put the secret key (`sb_secret_…`) or the legacy `service_role` key in a `VITE_` variable. The app checks for this and refuses to start if one is used.

## Provision the first administrator

Roles are never taken from sign-up data. The first admin is created once, by the owner, in the Supabase SQL editor (which runs as the database owner):

```sql
select private.bootstrap_first_admin('owner@example.com');
```

The function refuses if any admin already exists, and it cannot be called through the app's API. After that, admins manage staff and other admins in the app under **Members** (`/admin/members`). Every change needs a reason and is written to `audit_log`.

## Security model in one page

- **Roles** (`player`, `staff`, `admin`) live in `user_roles`; staff **permissions** in `staff_permissions`. Players have no write access to either; only admin RPCs change them.
- **Row Level Security** is on for every table. Players see their own profile, bookings, slots, payments and registrations. Staff see what their permissions allow. Admins hold every permission.
- **Column grants** stop players from changing their confirmed level or account status, even on their own profile.
- **Bookings and payments** cannot be written directly by players. The booking (Phase 4) and checkout (Phase 5) RPCs will be the only way in.
- **Payment proofs** go to the private `payment-proofs` bucket at `{player_id}/{booking_id}/{file}`. Upload is allowed only into the player's own booking folder; reading is limited to the owner and staff with `payments.verify`; nobody can overwrite or delete a proof through the API.
- **Audit log**: changes to roles, permissions, profiles, rates, settings, courts, bookings, slots and payments are recorded with the actor and reason. Admins can read it; nobody can edit it.

## Booking engine

- **Flow:** players select times → `hold_slots` holds them for `hold_minutes` (all or nothing) → `confirm_booking` revalidates under a row lock and confirms → `cancel_booking` releases them. Booking status (`held`, `confirmed`, `cancelled`, `expired`, `completed`) is separate from `payment_status` (`unpaid`, `pending_verification`, `paid`, `refund_due`, `refunded`, `waived`).
- **No double booking:** the `booking_slots_no_overlap` exclusion constraint rejects any overlapping live use of a court, whatever the timing. Blocks, maintenance, private events and event sessions are slots too, so they can never overlap bookings either.
- **Prices** come only from active `rate_rules` (peak / off-peak windows, optional per court). An hour with no rate shows "No rate set" and cannot be booked. Prices are snapshotted on each slot when held.
- **Hours** come from `operating_hours` (weekly) and `operating_hour_exceptions` (dates). A day with no hours is not bookable. Closing after midnight stays on the same operating day.
- **Policy settings** (`venue_settings`): `booking_window_days` (default 30), `hold_minutes` (15), `max_slots_per_booking` (8), `player_cancel_cutoff_hours` (empty = only staff can cancel confirmed bookings). These defaults are system starting values, not club policy — set them in Booking settings.
- **Scheduled jobs:** the migrations schedule `private.run_booking_jobs()` every minute with pg_cron when the extension is available. It expires stale holds and, if a payment deadline is set, cancels unpaid bookings past it. If pg_cron was not available when the migrations ran, enable it under Database → Extensions and run:
  ```sql
  select cron.schedule('dd-booking-jobs', '* * * * *', 'select private.run_booking_jobs()');
  ```
  Without it, holds still stop blocking courts on time (availability ignores expired holds, and every hold or confirm releases them), but **unpaid bookings are not cancelled at their deadline**.
- **Live updates:** the app subscribes to `public.schedule_signals` with Supabase Realtime. The migration adds it to the `supabase_realtime` publication when present; check Database → Publications. The app also refreshes every 20–30 seconds and when a tab regains focus, so it stays current even without Realtime.

## Payments (manual verification)

There is **no payment gateway**. Players send money by GCash, Maya or bank transfer outside the app, upload a screenshot, and staff check it against the club's account. Nothing is ever marked paid automatically.

- **Player:** booking page → amount due (computed by the database from the booking total minus approved payments) → choose an enabled method → see the account details and QR code → upload a receipt (JPG/PNG/WebP, 5 MB) → optional reference number → `submit_payment`. Booking `payment_status` becomes `pending_verification`; the booking itself stays `confirmed`.
- **Staff with `payments.verify`:** `/admin/payments` queue → open the receipt through a five-minute signed link → approve, or reject with a required reason (`staff_review_payment`). The reviewer and time are stored on the payment; the audit log records the change and reason. Approval sets `payment_status = paid` and confirms linked event registrations; rejection sets it back to `unpaid` so the player can pay again. Cash at the desk: `staff_record_cash_payment`. Refunds owed after a cancellation: `staff_record_refund`.
- **Protections:** nobody can review a payment for their own booking or one they submitted (admins included). Players cannot write the `payments` table, booking payment status, or amounts; only the database functions above can. One waiting submission per booking; a reference number or receipt file (SHA-256) cannot be reused for another live payment.
- **Private files:** receipts are in the private `payment-proofs` bucket under `{player}/{booking}/`, readable only by the player and payment verifiers, never updatable or deletable. QR codes are in the private `payment-qr` bucket (signed-in users can view; admins upload). Account details are no longer readable by visitors; players see them only through `get_payment_instructions` for their own confirmed booking.
- **Notifications** are in-app (`public.notifications`, bell in the header): verifiers are told about new submissions; players about approval, rejection (with reason), refunds and non-payment cancellations. Delivered by Realtime when enabled, otherwise within a minute by polling. **No email or SMS is sent.**
- **Payment deadline** (`payment_due_hours`, off by default): when set, a confirmed booking gets `payment_due_at` = the earlier of confirmation + N hours and its first hour. Bookings still `unpaid` after that are cancelled by the scheduled job and their times released; bookings with a payment being checked are kept.
- **Staff screens:** `/admin` dashboard (today's bookings, payments waiting, unpaid today, refunds due, courts in use, setup status, today's schedule), `/admin/bookings` (search by reference, name or phone; filter by date and statuses), `/admin/players` (lookup; email shown only to staff with `players.manage`).

## Community: open play, events and the queue

- **Events** (`events`, types open play, tournament, social, clinic, league) have a status (draft → registration open → closed → in progress → completed, or cancelled with a reason), optional skill range, capacity in players, registration open/close times, and a fee per player or per team. Registration closes at the deadline or when the event starts; staff can still add walk-ins.
- **Categories and divisions:** staff create the club's own `event_categories`; each event can have `event_divisions` (category, singles or doubles, skill range, entry limit, fee, and match format). Every `event_registrations` row stores the division **and** its category. "Who's Playing" (`get_whos_playing`) reads those, never the player's profile level.
- **Capacity and duplicates** are enforced in the database (a trigger under a per-event lock plus partial unique indexes), so they hold for parallel requests and direct writes. Paid entries create a slot-less booking that the player pays through the Phase 4 payment flow; approval confirms the entry.
- **Courts:** `staff_assign_event_courts` reserves courts as `booking_slots` (kind `open_play` or `event`), so the exclusion constraint blocks clashes with rentals, blocks and other events, and the booking grid and live court view show them. Matches and queue games can only use the event's own courts; two matches cannot share a court at the same time, and a player cannot be in two matches at once.
- **Attendance:** `staff_check_in` / `staff_mark_absent` for event entries, `staff_check_in_booking` for court rentals (needs `bookings.manage`). Each check-in is a `check_ins` row; **Play history** is built only from these.
- **Matches:** round robin (everyone plays everyone once; standings by wins, then point difference, then points scored) and single elimination (seeded, padded to a power of two, top seeds get byes, winners advance automatically). Results cannot be changed once the next round has been played. Nothing else (pools, double elimination, tiebreak games) is implemented.
- **Leaderboard rule:** from completed or walkover matches in events that were not cancelled — win 3 points, loss 1, walkover loss 0. Players who opt out are hidden. A second board counts check-ins in the last 30 days. Signed-in players only.
- **Paddle queue** (open play): checked-in players join (`join_queue`) or are added by staff; one active entry per player (unique index). Staff call the next players to a session court (waiting → called), start the game (→ playing), and finish it (→ completed; players rejoin the back of the queue, or winners stay on for up to the configured number of games). No-shows are recorded and replaced by the next waiting player; the rule sends them to the back or removes them.

## Reports

Staff with `reports.view` (admins have it) download CSV files at `/admin/reports`: revenue by day (approved payments only, by approval date, split by purpose and method), payments, bookings, check-ins, and one event's registrations. Values that would run as spreadsheet formulas are neutralised.

Deployment, monitoring, backups and rollback: `docs/deployment.md`. Launch status and test evidence: `docs/launch-readiness.md`.

## Tests

```bash
npm run test       # unit tests (Vitest)
npm run test:db    # migrations + RLS and booking tests on a local PostgreSQL
python3 scripts/local-db/concurrency-test.py   # parallel-session double-booking races
scripts/e2e/setup_local.sh /tmp/dd && python3 scripts/e2e/booking_local.py /tmp/dd    # booking, browser end to end
scripts/e2e/setup_local.sh /tmp/dd && python3 scripts/e2e/payments_local.py /tmp/dd   # payments, browser end to end
scripts/e2e/setup_local.sh /tmp/dd && python3 scripts/e2e/community_local.py /tmp/dd  # events, queue, matches, browser end to end
python3 scripts/e2e/mobile_sweep.py /tmp/dd           # every page at 360 px, CSV reports (after community_local)
python3 scripts/local-db/upgrade-path-test.py          # migrations applied in stages over existing data
scripts/local-db/start-postgres.sh                     # start the throwaway local PostgreSQL these use
supabase test db   # the same SQL tests on a Supabase stack (real pgTAP)
```

`scripts/local-db/rest-shim.py` is a test-only stand-in for Supabase's API gateway (signs in test users with an unsigned token and runs requests as `anon` / `authenticated` with JWT claims, like PostgREST). It also stands in for Storage uploads and signed links, inserting `storage.objects` rows as the caller so the real storage policies decide, and applying each bucket's size and type limits. It does not emulate Realtime. Never deploy it.

`npm run test:db` uses `scripts/local-db/`, a stand-in for Supabase's `auth` and `storage` schemas and a small pgTAP-compatible runner, for machines without Docker. It is for testing only and is never applied to a project.
