# Deployment runbook

Production stack: **Vercel** (static site, HTTPS, custom domain) + **Supabase** (Postgres, Auth, Storage, Realtime) in the Singapore region. Deploy to **staging first**, run every check below there, then repeat for production. Never run destructive or concurrency tests against production, and never use real customer payments for tests.

## 0. Credentials and access needed

| What | Who holds it | Used for | Where it may live |
| --- | --- | --- | --- |
| Supabase organisation owner login | Owner | Creating projects, Auth settings, backups | Owner only |
| Staging and production project refs | Owner | `supabase link`, env vars | Not secret |
| Publishable key (`sb_publishable_…`) for each project | Owner | Browser app | Vercel env vars (`VITE_SUPABASE_PUBLISHABLE_KEY`) |
| Database password for each project | Owner | `supabase db push` | Password manager; never in the repo or Vercel |
| Secret key (`sb_secret_…`) | Owner | Storage backup script only | Password manager / the backup machine's environment; never `VITE_`, never in the repo |
| SMTP credentials and a sending domain (DNS) | Owner | Sign-up and password-reset emails | Supabase → Authentication → SMTP |
| Vercel account / team and the Git repository | Owner / developer | Builds and hosting | Vercel |
| Domain registrar DNS access | Owner | Custom domain and HTTPS | Registrar |
| Uptime monitor account (optional) | Owner | Monitoring | Monitor provider |

## 1. Supabase project (staging, then production)

1. Create the project in the Singapore region. For production use a paid plan if you need managed backups (see §6).
2. **Apply migrations** (they only add or replace objects; the upgrade-path test shows existing rows survive):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push --dry-run      # read the list; it must be only files you expect
   npx supabase db dump -f pre-push-$(date +%F).sql   # safety copy before applying
   npx supabase db push
   ```
   If the project already has tables from another tool, read "Review before pushing" in `docs/backend-setup.md` first.
3. **pg_cron**: Database → Extensions → enable `pg_cron`, then check the job exists:
   `select jobname, schedule, command from cron.job;` → `ph-booking-jobs` every minute. If missing:
   `select cron.schedule('dd-booking-jobs', '* * * * *', 'select private.run_booking_jobs()');`
   Then confirm it runs: `select status, start_time from cron.job_run_details order by start_time desc limit 5;`
4. **Realtime**: Database → Publications → `supabase_realtime` includes `schedule_signals` and `notifications`.
5. **Storage**: Storage → buckets `payment-proofs`, `payment-qr`, `avatars` are **private**; `venue-assets` is public. The migrations set this; confirm in the dashboard.
6. **Auth → URL Configuration**:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/callback`, `https://<your-domain>/reset-password` (staging: the staging domain's equivalents). The app sends exactly these two (staff password reset; sign-up is off).
7. **Auth → Providers → Email**: email sign-up on, **Confirm email on**, minimum password length 8, letters and digits. **Auth → SMTP**: your provider (the built-in sender is rate-limited and not for production).
8. **Database → Advisors**: run the Security and Performance advisors; resolve or record every finding.
9. **First administrator**: sign up in the app with the owner's email, confirm it, then in the SQL editor:
   `select private.bootstrap_first_admin('owner@example.com');`
10. Enter real data in the app: opening hours and rates (Settings), payment methods and QR codes (Settings → Payment methods), staff accounts and permissions (Members), event categories (Events).

## 2. Vercel project

1. Import the Git repository. `vercel.json` sets the framework, the build command (`npm run verify:env && npm run build`), SPA routing and security headers.
2. Environment variables (Production and Preview separately):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…` (never a secret key; the build refuses one)
   - `VITE_SITE_URL` = `https://<your-domain>` (production) / the staging domain (preview)
3. **Custom domain**: Project → Settings → Domains → add the domain, then create the DNS records Vercel shows at your registrar. Vercel issues and renews the HTTPS certificate. Make the apex or `www` the primary and redirect the other.
4. If you use a Supabase **custom domain** instead of `*.supabase.co`, add it to `img-src` and `connect-src` (https and wss) in the `Content-Security-Policy` header in `vercel.json`, or the app cannot reach the API.

## 3. Verify each deploy

1. Smoke test (read-only, publishable key only — safe for production):
   ```bash
   SITE_URL=https://<domain> SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_… node scripts/ops/smoke-test.mjs
   ```
   It checks HTTPS and redirects, security headers, SPA routes, that the bundle holds no secret key and points at this project, database connectivity and migration level, that visitors cannot read or write private tables or call staff functions, that receipt and QR buckets are private, and the email-confirmation setting.
2. On **staging only**, walk the booking and payment flows with test accounts: book → pay with a test receipt image → approve as a second staff account → check the notification. Do the same for an open-play session (register → check in → queue → call → finish).
3. Confirm a receipt URL cannot be opened without signing in (copy a signed link, wait 5 minutes, it must stop working).

## 4. Monitoring

- **Uptime**: monitor `https://<domain>/` and `https://<ref>.supabase.co/rest/v1/` (with the publishable key header) every 5 minutes; alert the owner by SMS or email.
- **Supabase**: Reports (API, database), Logs Explorer for errors, and the Security / Performance advisors after every migration. Alert on database CPU, disk and connection use.
- **Scheduled jobs**: weekly check that `cron.job_run_details` shows recent successful runs.
- **Vercel**: build failure notifications on; Runtime / Firewall logs for unusual traffic.
- **Business checks** (dashboard): payments waiting more than a day, refunds due, unpaid bookings today.
- The app has **no error-tracking service** (such as Sentry) built in. Browser errors are not collected; add one if you want them reported.

## 5. Rollback and recovery

| Situation | Action |
| --- | --- |
| Bad frontend release | Vercel → Deployments → the last good deployment → **Promote / Instant Rollback**. Takes effect in seconds. The database does not need to change: every migration so far is additive and older builds still work with it. |
| Bad migration, data intact | Do **not** edit an applied migration. Write a new migration that fixes forward; test it with `npm run test:db` and `python3 scripts/local-db/upgrade-path-test.py`, push to staging, then production. |
| Data damaged or deleted | Stop writes (set events to Registration closed, tell staff), then restore: with PITR to the second before the damage, otherwise to the latest daily backup. The project is offline during a restore and rows written after the restore point are lost; re-enter them from the CSV reports. To investigate without downtime, restore into a new project first. |
| Payment receipts lost | Database backups do **not** include Storage files. Re-upload from the latest off-site copy made by `scripts/ops/backup-storage.mjs` (same bucket and path; `manifest.json` lists them with checksums). |
| Secret key leaked | Supabase → Project Settings → API Keys → roll the secret key; update the backup machine. The publishable key is public by design. |
| Account takeover of staff | Members → remove the staff role or suspend the account; review `audit_log` for their changes. |

Keep this page and the database password where the owner can reach them if the developer is unavailable.

## 6. Backups

- **Database**: Supabase Pro, Team and Enterprise projects get automatic daily backups (Pro keeps 7 days). Point-in-time recovery is a paid add-on for those plans (restores to the second; when enabled, daily backups stop). The Free plan has no managed backups: run `npx supabase db dump` (schema and `--data-only`) on a schedule and keep the files off-site. Before every migration push, take a `db dump` as well.
- **Storage** (payment receipts, QR codes): run on a trusted machine, daily, keep copies encrypted:
  ```bash
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_… node scripts/ops/backup-storage.mjs ./backups
  ```
- **Test a restore** into a spare project at least once before launch and then quarterly.

Source for the backup facts: Supabase, "Database Backups" (supabase.com/docs/guides/platform/backups). Plans and prices change; check the current page before choosing a plan.
