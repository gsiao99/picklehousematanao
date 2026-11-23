# Launch readiness report

Picklehouse Matanao booking system · started 23 November 2026 from a copy of the Dink District Digos code (no history).

## Classification: NOT READY

Phase 0 (setup and rebrand) only. Nothing has been deployed: there is no Supabase project, Vercel project or domain yet (planned for Phase 4). Guest bookings without accounts (Phase 1) are not built.

Mark a condition as passed only when its check has been run against this project and the result is written down here. Evidence from Dink District Digos does not count.

### Blocking conditions

| # | Condition | How to verify |
| --- | --- | --- |
| C1 | Staging Supabase project created; migrations applied with a reviewed dry run | `supabase db push --dry-run`, then push; `docs/deployment.md` §1 |
| C2 | Smoke test passes on staging and production | `scripts/ops/smoke-test.mjs` (read-only, publishable key) |
| C3 | Payment receipts are private on **real** Storage: no public URL, visitors and other players cannot sign links, a signed link expires | Smoke test + manual check in deployment.md §3.3 |
| C4 | Booking and payment flows walked on staging with test accounts and test images (no real payments) | deployment.md §3.2 |
| C5 | Auth: Site URL and both redirect URLs set; SMTP configured; a real sign-up confirmation and password reset email arrive and work | deployment.md §1.6–1.7 |
| C6 | `pg_cron` enabled and `dd-booking-jobs` runs every minute (hold expiry, unpaid-booking deadline) | `cron.job_run_details` |
| C7 | Backups in place: managed daily backups or PITR (paid plan) or scheduled `db dump`; Storage copy with `backup-storage.mjs`; one restore tested | deployment.md §6 |
| C8 | Custom domain on Vercel with HTTPS; `VITE_SITE_URL` set to it; `http://` redirects to `https://` | Smoke test |
| C9 | Supabase Security and Performance advisors run, findings resolved or recorded | Dashboard → Advisors |
| C10 | Real business data entered by the club: hours, rates, payment accounts, staff permissions | App settings |

## Evidence so far

| Date | Check | Result |
| --- | --- | --- |
| 23 Nov 2026 | `npm run check` (typecheck, lint with no warnings, 92 unit tests, build) | Passed |
| 23 Nov 2026 | `npm run lint -- --deny-warnings` | Passed |
| 23 Nov 2026 | Homepage at 360 px and 1280 px: no horizontal scroll | Passed (Playwright, local preview build) |
| 23 Nov 2026 | `npm run test:db` (local PostgreSQL 16) | **648 passed, 11 failed.** The same 11 fail on an untouched copy of the source repository, so they were inherited, not introduced. Listed below. |

### Inherited database test failures

To be resolved by the Phase 1 schema baseline (the files are rewritten or removed there):

- `09_community`: 23 skill requirements are enforced; 82 a checked-in player joins the queue; 85 staff add four more players in order; 133 open play refuses a partner
- `14_auto_confirm_levels`: aborts — unsafe use of new enum value `rookie_test` in the same transaction
- `17_desk_cash_amounts`: aborts at line 101 — permission denied for function `amount_due`
- `19_walk_in`: 10 registrations list shows walk-ins by name (order); 13 a walk-in can be cancelled (more than one row returned by a subquery); aborts at line 63 — permission denied for function `entry_label`
- `21_session_setup`: aborts at line 39 — "You do not have permission to see payment totals."
- `22_matching_modes`: 5 winners vs losers pairing

## Known gaps carried into Phase 1

- Logo files are not in the repository yet; the header and footer show the venue name as text.
- The schema still contains player accounts, café, inventory, rentals, gallery and sales from the source; it seeds three indoor courts that are not confirmed for this venue. Phase 1 replaces all migrations with a single baseline and seeds only confirmed facts (hours 8:00 AM – 11:00 PM; ₱100 8 AM – 5 PM; ₱200 5 PM – 10 PM).
- The player area (`/player/*`) and sign-up still exist and still describe accounts.
