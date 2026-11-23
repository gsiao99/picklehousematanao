# Picklehouse Matanao

Booking and venue management for Picklehouse Matanao, a pickleball venue in Purok 3, New Visayas, Matanao, Davao del Sur. *dine, drink, enjoy.*

**Status: Phase 0 (setup and rebrand).** Started from a copy of the Dink District Digos code, without its git history. Nothing is deployed. The plan:

| Phase | Scope |
| --- | --- |
| 0 | Setup, rebrand, conventions (`CLAUDE.md`) |
| 1 | Guest court bookings without accounts: display name + PH mobile, reference code, private manage link, GCash receipt or cash, cancel up to 30 minutes before start |
| 2 | Guest event registration, open play by name, leaderboard by guest player |
| 3 | Trimmed admin: Dashboard, Schedule, Payments, Bookings, Reports, Events, Settings |
| 4 | Launch: Supabase (Singapore), Vercel, domain |

The code in `src/` still contains the source system's player accounts, café, inventory, rentals, gallery and sales. They are removed in Phases 1–3. Test status and inherited database test failures: `docs/launch-readiness.md`. Supabase configuration and the security model: `docs/backend-setup.md`. Deployment runbook: `docs/deployment.md`.

## Run it

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run typecheck` | TypeScript check (`tsc -b`) |
| `npm run lint` | Lint with oxlint |
| `npm run build` | Type check, then production build to `dist/` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:db` | Apply migrations to a local PostgreSQL and run the RLS tests |
| `npm run check` | Type check, lint, unit tests and build in one go |
| `npm run build:preview` | Demo build with sample data to `dist-preview/` (never deployed as the live site) |
| `npm run verify:env` | Checks the deploy environment variables (runs before every Vercel build) |
| `npm run test:upgrade` | Proves migrations upgrade an existing database without losing rows |

## Where things are

```text
src/
├── app/            router, lazy pages, layouts (Public, Auth, Player, Admin), legacy redirects
├── routes/         pages: public, auth, booking, player, me, account, events, admin
├── features/       auth, booking, payments, notifications, events, open-play,
│                   tournaments, player, admin (desk tools, live board), reports, venue
├── components/
│   ├── ui/         Button, Badge, Section, Container, Accordion, loading/empty/error states
│   ├── brand/      Logo (official asset), CourtDiagram, CourtRally
│   └── layout/     SiteHeader (with mobile menu), SiteFooter
├── config/         venue facts, brand assets, navigation, FAQ
├── demo/           sample-data backend for the demo preview build only
├── lib/            supabase client + env guard, errors, cn, money, time, useAsync
├── types/          database.ts — generated from the migrations
└── styles/         index.css — all design tokens
supabase/           migrations, pgTAP tests, CLI config
scripts/local-db/   local Postgres stand-in, type generator, concurrency and upgrade tests
scripts/e2e/        browser tests (booking, payments, community, player area, mobile)
scripts/ops/        post-deploy smoke test, Storage backup
docs/               backend setup, deployment runbook, launch readiness
public/             manifest, robots.txt (icons and sitemap once the logo and domain are in)
brand-source/       original logo file, once committed (not served)
```

## Content rules

- **No invented facts.** Live opening hours and rates come from the database (`operating_hours`, `rate_rules`). `src/config/venue.ts` holds the owner-confirmed fallback: open 8:00 AM – 11:00 PM; ₱100 from 8:00 AM to 5:00 PM and ₱200 from 5:00 PM to 10:00 PM. The 10:00 – 11:00 PM rate, whether rates are per court or per player, the number of courts, the public name and all contact details are not confirmed and show "To be announced". "Picklehouse Matanao" is the working name.
- **No fake availability.** Bookings, open play sessions and events come only from the database. Sample data exists only in the demo preview build (`npm run build:preview`), which shows a demo banner.

## Brand

Colours are sampled from the official logo.

| Token | Value | Use |
| --- | --- | --- |
| `brand-green` | #0D5A2B | Primary surfaces, buttons, links, dark sections |
| `accent` | #C6E62C | The one main call to action and "open / live now" marks; text on it uses `accent-ink` (#062A12). Never lime text on white. |
| `brand-charcoal` | #2F3A34 | Body text |
| `brand-white` | #FFFFFF | Backgrounds, text on green |
| `font-display` | Outfit | Display headlines only |
| `font-sans` | Inter | All interface and body text |

Tints and shades (`brand-green-50` … `-900`, `brand-charcoal-200/500/800`, `night`, `midnight`) are mixed from the brand colours. Every text/background pair in use meets WCAG AA. Fonts are self-hosted through Fontsource.

The logo is white and lime on deep green. Use the cropped files from `src/config/brand.ts` only; never recolour, stretch or redraw it. Until the logo file is committed the header shows the venue name as text.

## Deployment

Planned for Phase 4: Vercel builds the site from this repository; `vercel.json` sets the build command, single-page routing and the security headers, including the Content-Security-Policy. Runbook: `docs/deployment.md`.
