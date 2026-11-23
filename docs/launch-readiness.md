# Launch readiness report

Picklehouse Matanao booking system · started 23 November 2026 from a copy of the Dink District Digos code (no history).

## Classification: NOT READY

Phases 0 (setup and rebrand) and 1 (guest bookings) are built and tested locally. Nothing has been deployed: there is no Supabase project, Vercel project or domain yet (planned for Phase 4). Guest events, open play and the leaderboard come in Phase 2.

Mark a condition as passed only when its check has been run against this project and the result is written down here. Evidence from Dink District Digos does not count.

### Decisions needed before launch

- **Payment deadline.** Off by default. With no deadline, an unpaid guest booking holds its court until staff cancel it, so anyone could tie up courts. Set `payment_due_minutes` (or hours) in Booking settings.
- **Rate basis and courts.** The ₱100 / ₱200 rates are seeded without a basis (per court or per player, per hour), so online booking stays closed until the basis is set and courts are added.
- **Staff phones.** Set each staff member's phone on their profile: it is how the database recognises a staff member's own guest booking.

### Blocking conditions

| # | Condition | How to verify |
| --- | --- | --- |
| C1 | Staging Supabase project created; migrations applied with a reviewed dry run | `supabase db push --dry-run`, then push; `docs/deployment.md` §1 |
| C2 | Smoke test passes on staging and production | `scripts/ops/smoke-test.mjs` (read-only, publishable key) |
| C3 | Payment receipts are private on **real** Storage: no public URL, visitors and other players cannot sign links, a signed link expires | Smoke test + manual check in deployment.md §3.3 |
| C4 | Booking and payment flows walked on staging with test accounts and test images (no real payments) | deployment.md §3.2 |
| C5 | Auth: Site URL and both redirect URLs set; SMTP configured; a real sign-up confirmation and password reset email arrive and work | deployment.md §1.6–1.7 |
| C6 | `pg_cron` enabled and `ph-booking-jobs` runs every minute (hold expiry, unpaid-booking deadline) | `cron.job_run_details` |
| C7 | Backups in place: managed daily backups or PITR (paid plan) or scheduled `db dump`; Storage copy with `backup-storage.mjs`; one restore tested | deployment.md §6 |
| C8 | Custom domain on Vercel with HTTPS; `VITE_SITE_URL` set to it; `http://` redirects to `https://` | Smoke test |
| C9 | Supabase Security and Performance advisors run, findings resolved or recorded | Dashboard → Advisors |
| C10 | Real business data entered by the club: hours, rates, payment accounts, staff permissions | App settings |

## Evidence so far (local test stack only)

| Date | Check | Result |
| --- | --- | --- |
| 23 Nov 2026 | `npm run check` (typecheck, lint with no warnings, 86 unit tests, build) | Passed |
| 23 Nov 2026 | `npm run test:db` (local PostgreSQL 16, both migrations) | **601 assertions passed, 0 failed** |
| 23 Nov 2026 | `scripts/local-db/concurrency-test.py` (parallel guest bookings, deadlock bait, per-number limit, double cancel, event rushes) | 16 passed, 0 failed, three runs in a row |
| 23 Nov 2026 | `scripts/e2e/guest_booking_local.py` (real app behind the production headers: book, manage link, wrong token, receipt upload, staff approval, guest cancel and refund due, phone drawer, staff hides a name, no CSP errors) | 30 passed, 0 failed |
| 23 Nov 2026 | `scripts/local-db/upgrade-path-test.py` (baseline with live account bookings and a payment, then the guest migration: rows unchanged, guests can book, no double booking) | 9 passed, 0 failed |
| 23 Nov 2026 | `scripts/e2e/mobile_sweep.py` (every public, guest, staff and admin page at 360 px, CSV reports) | 28 passed, 0 failed |

### What happened to the 11 inherited database test failures

All resolved with the Phase 1 baseline:

- **Real bug, fixed:** deleting an open play session with check-ins failed on a foreign key (`staff_delete_event`).
- **Test bugs, fixed in the tests:** an ambiguous name lookup and a wrong expected order (19), a fixture missing `payments.verify` (21), a Winners-vs-losers scenario that contradicted the level rules (22), a call to a private helper as a staff user (17), and open-play check-in now queueing players automatically (09).
- **Retired with the features they tested:** player sign-up levels (14), and the café, sales and gallery tests (13, 15, 18).

### Found and fixed during Phase 1

- Guest bookings first confirmed their slots in a second step, which re-ran the exclusion check and **could deadlock under a rush**; slots are now inserted as confirmed.
- `bookings` had a table-level SELECT grant, so new columns (the manage-token hash) were readable by staff automatically; it now uses column grants without the hash.
- The own-booking rule only knew account bookings; staff could have approved payments for their own guest bookings. It now also matches the staff member's phone.
- The manage page ignored a different link pasted into the same tab (it kept showing the previous booking).

## Known gaps (Phase 2 and later)

- Logo files are not in the repository yet; the header and footer show the venue name as text.
- Event registration, open play queue and leaderboard still use the inherited account-based functions; until Phase 2 the public pages say to register at the desk and staff add walk-ins. `scripts/e2e/community_local.py` belongs to that design and is rewritten in Phase 2.
- The staff menu still has Players and Members; Phase 3 trims it to Dashboard, Schedule, Payments, Bookings, Reports, Events, Settings.
- Guests get no messages (no email or SMS); everything they need is on the manage link. A guest who loses the link can be helped by staff (search by mobile number), but a new link cannot be issued yet.
