# Conventions for Claude

This repo is the Picklehouse Matanao booking system, built in phases from a copy of the Dink District Digos code (no history). Phases: 0 setup and rebrand; 1 guest bookings; 2 guest events, open play and leaderboard; 3 trimmed admin; 4 launch. Wait for the owner's approval before starting each phase. `docs/launch-readiness.md` records what is done and what was inherited.

## Stack
React 19, TypeScript (strict), Vite, Tailwind CSS v4, React Router, Supabase (Postgres, Auth for staff only, Storage, RLS). Backend setup and the security model: `docs/backend-setup.md`.

## Rules
- Never invent prices, opening hours, addresses, contact details, court counts or availability. Unknown values are `null` in `src/config/venue.ts` and render as "To be announced". Confirmed so far: Purok 3, New Visayas, Matanao, Davao del Sur; open Monday to Sunday, 8:00 AM – 11:00 PM; ₱100 8:00 AM – 5:00 PM and ₱200 5:00 PM – 10:00 PM. Not confirmed: the 10–11 PM rate, per-court or per-player and per-hour basis, number of courts, public name ("Picklehouse Matanao" is the working name), contact details.
- Never show sample bookings, sessions or tournaments as if they were live. Data functions return empty lists until the backend exists.
- Colours and fonts come only from tokens in `src/styles/index.css`. No raw hex in components. Lime (`accent`) is never text on a light surface; text on lime uses `accent-ink`.
- Outfit for display headlines only; Inter for everything else. No all-caps small labels.
- Money is integer centavos; format with `formatPeso`. Times are shown in Asia/Manila with `src/lib/time.ts` (12:00 NN, 12:00 MN).
- Every list has loading, empty and error states (`src/components/ui/states.tsx`).
- Mobile first: every screen works at 360 px wide with no horizontal scroll.
- Use the official logo from `src/config/brand.ts` (cropped from `brand-source/`, never recreated, recoloured or stretched; the "Dola AI" watermark is never shipped).
- Before finishing: `npm run check` must pass with no lint warnings.
- Preserve existing working code; prefer small, reviewed changes.

## Guest model (no player accounts)
- Guests never sign in. A booking or registration takes a display name (public) and a PH mobile number `09XXXXXXXXX` (private). Validate the format in the database, not only in the form.
- Each booking or registration gets a human reference code and a private manage link containing a random token (at least 128 bits from `gen_random_bytes`). Store only its SHA-256 hash; show the raw token once, at creation. Never log it, put it in a query the server stores, or send it to analytics. Compare hashes in the database.
- Every guest action (view, upload receipt, cancel, join open play, register) goes through a SECURITY DEFINER function that takes the reference and the token, checks the hash, and returns only that guest's own data. Anonymous users have no direct table access to guest data.
- Mobile numbers are visible to staff only (RLS + function return columns). Public views (Live Courts, event lists, leaderboard) show display names only; staff can edit or hide a display name, and hidden names never reach the public functions.
- Guests can cancel until 30 minutes before start; refunds are recorded by staff. There is no limit on open bookings per phone number.
- Guest endpoints are rate-limited in the database (per phone and per reference); failed token checks return the same error as "not found".
- Leaderboard: staff link entries that share a mobile number into one guest player; points accumulate per guest player.

## Routing rules
- Public pages (`/`, `/courts`, `/open-play`, `/events`, `/live`, and the guest booking and manage pages) use `PublicLayout`. Staff sign-in screens use `AuthLayout`. Staff pages stay under `/admin` in `StaffLayout` (grouped sidebar, phone bottom bar; admits staff and admins only), each page keeping its own `RequireAccess`. Admin menu: Dashboard, Schedule, Payments, Bookings, Reports, Events, Settings.
- Paths come from `src/config/navigation.ts`; never hard-code them. A manage link's token goes in the URL fragment or path segment handled only by the client and the token-checked function, and the page sets `Referrer-Policy: no-referrer`.
- After staff sign-in use `postSignInPath(next, { isStaff })`; `next` only if `safeNextPath` accepts it.
- Guards decide from `get_my_access` only, never from browser storage; RLS and the database functions remain the real enforcement.
- Until Phase 1 removes it, the inherited player area (`/player/*`) is legacy; do not extend it.

## Database rules
- Every schema change is a new file in `supabase/migrations/`; never edit a migration that has been applied to any hosted project. (Phase 1 replaces the inherited migrations with one baseline before anything is applied.)
- Every new table: enable RLS, add policies, and add explicit grants (default privileges give new tables no API access).
- Roles and permissions come only from `user_roles` / `staff_permissions`, checked with `private.has_role()` / `private.has_permission()`. Never trust anything the client sends, including user metadata.
- Privileged writes go through SECURITY DEFINER functions with `set search_path = ''`, an explicit permission check (staff permission, or guest token hash), a required reason for staff actions, and `app.audit_reason`.
- Only the publishable key may appear in frontend code. Secret / service-role keys stay server-side.
- Add pgTAP tests in `supabase/tests/` for every policy and every guest function (right token, wrong token, other guest's reference, anonymous table access denied, phone never in public output); run `npm run test:db`. After schema changes, regenerate `src/types/database.ts`.
- Route all errors through `toAppError` (`src/lib/errors.ts`).

## Booking rules
- Never write booking_slots or bookings from the client; use the booking functions (hold, release, confirm, guest cancel, staff block / remove block).
- The exclusion constraint `booking_slots_no_overlap` is the source of truth for availability. Do not replace it with application checks.
- Booking status and `payment_status` are separate; payment code changes `payment_status` only.
- Prices only from `rate_rules`, hours only from `operating_hours` / `operating_hour_exceptions`. Never hard-code either. Unconfirmed rates stay absent (not zero).
- New functions: Postgres grants EXECUTE to PUBLIC by default — revoke and grant explicitly, and keep test 07's anonymous-function allowlist current.
- Run `npm run test:db`, `python3 scripts/local-db/concurrency-test.py` and the e2e booking test before finishing booking work.

## Payment rules
- No payment gateway is integrated. Payment is a GCash/QR receipt upload or cash at the desk, reviewed by staff. Never describe payments as automatic or claim a gateway.
- Guests submit a receipt through the token-checked submit function (file uploaded under a path tied to the booking, via a signed upload URL issued by that function); staff decide with `staff_review_payment`, `staff_record_cash_payment`, `staff_record_refund`. Never write `payments` or `bookings.payment_status` from the client.
- Amounts due come from the database (`private.amount_due`), never from the browser.
- Nobody reviews their own payment; rejection always needs a reason; every decision is audited.
- Receipts and QR codes live in private buckets and are shown only through short-lived signed links. Payment account details are never public beyond what checkout needs.
- Notifications are in-app only. Do not claim email or SMS delivery unless it is built and configured.
- Run `scripts/e2e/payments_local.py` after payment work.

## Event rules
- Registrations go through database functions; never insert `event_registrations` from the client. Capacity and duplicates are enforced in the database; do not add client-side substitutes.
- A registration records its division and category; anything that shows what a guest entered reads the registration.
- Event courts are `booking_slots` reserved with `staff_assign_event_courts`; matches and queue games may only use those courts.
- Play history comes only from `check_ins`; leaderboard points only from recorded match results under the published rule (win 3, loss 1, walkover loss 0), summed per guest player.
- Run `scripts/e2e/community_local.py` and the concurrency test after event or queue work.

## Release rules
- Browser tests run behind the production headers from `vercel.json`; if a feature needs a new origin (images, API, fonts), update the Content-Security-Policy there and rerun them.
- Never point destructive, concurrency or e2e tests at staging or production; use `scripts/local-db/start-postgres.sh` and the local stand-ins.
- After any deploy or migration push, run `scripts/ops/smoke-test.mjs` against that environment.
- Migrations must stay additive once deployed so a Vercel rollback keeps working; prove it with `scripts/local-db/upgrade-path-test.py`.
- Keep `docs/launch-readiness.md` honest: list only checks with evidence as passed.
