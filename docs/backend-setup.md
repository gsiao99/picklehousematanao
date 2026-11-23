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
| 10. Add the club's GCash account (and QR code) in **Settings → Payment methods**; GCash is seeded inactive. Until then guests are offered cash at the desk only | Owner | `/admin/settings` |
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

- **No player accounts.** Guests book with a display name (public) and a PH mobile number (private, staff only). Only staff sign in: public sign-up is off (`enable_signup = false`; also turn it off under Authentication → Providers → Email on the hosted project). New sign-ins get a profile and **no role** until an admin grants one.
- **Roles** (`staff`, `admin`; `player` is legacy until Phase 2) live in `user_roles`; staff **permissions** in `staff_permissions`. Only admin RPCs change them.
- **Row Level Security** is on for every table. Visitors (anon) cannot read bookings, slots, payments, profiles or the guest tables at all. Staff see what their permissions allow; any staff account can see guest phone numbers (to reach guests), nobody else can. Admins hold every permission.
- **Manage links.** Each guest booking has a reference (`PH-YYMMDD-0001`) and a private link `/booking/<reference>#<token>`. The token is 32 random bytes (`gen_random_bytes`); only its SHA-256 is stored (`bookings.manage_token_hash`, granted to no API role, not even staff). It sits in the URL fragment, which browsers never send to a server, and the page sets `referrer: no-referrer`.
- **Guest functions** (all SECURITY DEFINER, `search_path = ''`, executable by anon): `guest_create_booking`, `guest_get_booking`, `guest_cancel_booking`, `guest_begin_receipt_upload`, `guest_submit_payment`. Each checks the reference + token hash and returns only that booking. A wrong token, an unknown reference and a locked reference all answer `{"error":"not_found"}`.
- **Rate limits** (in the database): failed token checks are logged per reference; 10 failures in 15 minutes lock that reference for the rest of the window. New guest bookings per mobile number per hour are capped by `guest_bookings_per_hour` (default 10; an abuse guard, not a limit on how many bookings a number may hold). Receipt upload paths: 10 per booking per hour.
- **Public names:** the court board and live view show `bookings.display_name` unless staff hid it (`display_name_hidden`); hidden names never leave the database through public functions. Staff with `bookings.manage` edit or hide names with `staff_set_booking_display_name` (reason required, audited).
- **Own bookings:** staff never review, mark paid or record cash for their own booking. A guest booking counts as theirs when its phone matches the phone on their staff profile, so set every staff member's phone.
- **Audit log**: changes to roles, permissions, profiles, rates, settings, courts, bookings, slots and payments are recorded with the actor and reason. Admins can read it; nobody can edit it.

## Booking engine

- **Flow:** a guest chooses times in the browser (nothing is held) → `guest_create_booking` checks every time (court open, on the hour, in the window and opening hours, a bookable rate, no clash) and inserts the slots as confirmed in one transaction (all or nothing) → the guest pays or cancels through the manage link. Staff cancel with `cancel_booking` (reason required). Booking status is separate from `payment_status` (`unpaid`, `pending_verification`, `paid`, `refund_due`, `refunded`, `waived`).
- **No double booking:** the `booking_slots_no_overlap` exclusion constraint rejects any overlapping live use of a court, whatever the timing (proved by `scripts/local-db/concurrency-test.py`). Blocks, maintenance, private events and event sessions are slots too.
- **Prices** come only from active `rate_rules` whose basis (`unit`) is set. The seeded ₱100 / ₱200 rates have no basis yet (not confirmed), so they are shown but cannot be booked until an admin sets the basis. Prices are snapshotted on each slot.
- **Hours** come from `operating_hours` (seeded Monday to Sunday, 8:00 AM – 11:00 PM) and `operating_hour_exceptions`. Courts are not seeded: add them in Settings once the number is confirmed.
- **Policy settings** (`venue_settings`): `booking_window_days` (30), `max_slots_per_booking` (8), `guest_cancel_cutoff_minutes` (30), `guest_bookings_per_hour` (10), payment deadline (off). Starting values, not club policy.
- **Scheduled jobs:** `private.run_booking_jobs()` every minute with pg_cron (`ph-booking-jobs`) when available: payment reminders, cancelling unpaid bookings past a deadline (if one is set), and clearing old rate-limit rows and unused upload grants. If pg_cron was not available when the migrations ran, enable it under Database → Extensions and run:
  ```sql
  select cron.schedule('ph-booking-jobs', '* * * * *', 'select private.run_booking_jobs()');
  ```
- **Live updates:** the app subscribes to `public.schedule_signals` with Supabase Realtime, and also refreshes every 20–30 seconds and when a tab regains focus.

## Payments (manual verification)

There is **no payment gateway**. Guests pay by GCash outside the app and upload a screenshot, or pay cash at the desk; staff check every payment. Nothing is ever marked paid automatically.

- **Guest:** manage link → amount due (from the database) → GCash account details and QR code (signed link; only QR codes of active methods open for visitors) → `guest_begin_receipt_upload` returns a random path inside the booking's folder, valid 15 minutes → the browser uploads the image to exactly that path in the private `payment-proofs` bucket (the storage policy accepts only an open grant's path) → `guest_submit_payment` (amount sent, optional reference number). `payment_status` becomes `pending_verification`; the booking stays `confirmed`.
- **Staff with `payments.verify`:** `/admin/payments` queue (guest name and phone shown) → open the receipt through a five-minute signed link → approve with the amount on the receipt, or reject with a required reason (`staff_review_payment`). The guest sees the result and any rejection reason on the manage link. Cash at the desk: `staff_record_cash_payment`. Refunds owed after a cancellation: `staff_record_refund`.
- **Cancelling:** guests cancel through the manage link until `guest_cancel_cutoff_minutes` before the first court time; a paid or pending payment becomes `refund_due` and payment staff are notified.
- **Protections:** nobody can review a payment for their own booking or one they submitted (admins included). Nobody writes `payments`, booking payment status or amounts directly. One waiting submission per booking; a reference number or receipt file (SHA-256) cannot be reused for another live payment.
- **Notifications** are in-app for staff only (bell in the staff area). Guests have no inbox: they see everything on the manage link. **No email or SMS is sent.**
- **Payment deadline** (`payment_due_minutes` or `payment_due_hours`, off by default): when set, a booking gets `payment_due_at` = the earlier of booking time + the deadline and its first hour. Bookings still `unpaid` after that are cancelled by the scheduled job and their times released; bookings with a payment being checked are kept. **Decide this before launch:** with no deadline, unpaid guest bookings hold courts until staff cancel them.
- **Staff screens:** `/admin` dashboard (today's bookings, payments waiting, unpaid today, refunds due, courts in use, setup status, today's schedule), `/admin/bookings` (search by reference, name or phone; filter by date and statuses), `/admin/players` (lookup; email shown only to staff with `players.manage`).

## Community: open play, events and the queue

> **Inherited design, converted in Phase 2.** The registration, queue and leaderboard functions below still expect player accounts, which no longer exist; until Phase 2 staff add people as walk-ins and the public event pages say to register at the desk. Phase 2 replaces account registration with registration by name and mobile number, and links entries that share a mobile number into one guest player for the leaderboard.

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
scripts/e2e/setup_local.sh /tmp/ph && python3 scripts/e2e/guest_booking_local.py /tmp/ph   # guest booking and payments, browser end to end
python3 scripts/e2e/mobile_sweep.py /tmp/ph                                              # every page at 360 px
# scripts/e2e/community_local.py (events, queue, matches) still drives player accounts; it is rewritten in Phase 2.
python3 scripts/local-db/upgrade-path-test.py          # migrations applied in stages over existing data
scripts/local-db/start-postgres.sh                     # start the throwaway local PostgreSQL these use
supabase test db   # the same SQL tests on a Supabase stack (real pgTAP)
```

`scripts/local-db/rest-shim.py` is a test-only stand-in for Supabase's API gateway (signs in test users with an unsigned token and runs requests as `anon` / `authenticated` with JWT claims, like PostgREST). It also stands in for Storage uploads and signed links, inserting `storage.objects` rows as the caller so the real storage policies decide, and applying each bucket's size and type limits. It does not emulate Realtime. Never deploy it.

`npm run test:db` uses `scripts/local-db/`, a stand-in for Supabase's `auth` and `storage` schemas and a small pgTAP-compatible runner, for machines without Docker. It is for testing only and is never applied to a project.
