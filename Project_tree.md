# Project Structure

## Overview
- Project: XE Status — single-admin monitoring and public status page
- Language: TypeScript; React + Vite frontend, Fastify API, separate Node.js worker
- Runtime: Node.js 22.12+; package manager: npm; database: SQLite (WAL)
- Development: `npm run dev`; build: `npm run build`; unit/integration tests: `npm test`; browser tests: `npm run test:e2e`
- Production: systemd `xe-status.target` (web + worker), or Docker Compose

## Managed Project Structure
```text
shared/           Shared API types and defaults
server/           Fastify routes, authentication, persistence and public projections
  index.ts        API startup; app.ts wires routes and serves the production SPA
  passwords.ts    Salted password hashing and persistent credential lookup
  db.ts           SQLite schema and encrypted configuration persistence
  availability.ts Interval-based daily availability with correction exclusions
  incidents.ts    Admin history, fixed correction intervals and audit/revocation
  monitor-management.ts Atomic bulk operations, archive/restore and ordering
worker/           Scheduling, probes, state transitions and SMTP outbox delivery
  index.ts        Worker startup; scheduler.ts manages the bounded probe pool
  state.ts        Monitor claims, result persistence and incident transitions
  mail.ts         Ordered SMTP outbox claims, delivery and retry
web/src/          React public page, administrator interface, forms and styles
  main.tsx        Browser entry point
  PublicPage.tsx  Public overview, daily bars and incident history
  AdminPage.tsx   Login and administration navigation
  MonitorManagement.tsx Search, groups, selection, archive and bulk operations
  IncidentHistory.tsx Paginated incident history, details and corrections
  CheckHistory.tsx Paginated raw checks and retention notice
  PasswordSettings.tsx Current/new password form and relogin flow
tests/            API, monitoring and persistence regression tests
  browser/        Playwright public/admin browser checks
deploy/systemd/  Native Linux web/worker units and a grouped target
scripts/setup.mjs Generates local environment and credentials without overwriting
devdocs/systemd.md Native Linux service installation and operation
devdocs/plans/    Implementation scope and decisions
devdocs/reviews/  Validation evidence and operational limits
vite.config.ts    Frontend build and development API proxy
playwright.config.ts Browser test servers and runner settings
tsconfig.json     Shared strict TypeScript configuration
package.json      Dependencies and run commands
.env.example      Configuration reference without operational secrets
Dockerfile        Production web/worker image
compose.yaml      Web and worker services sharing a persistent volume
```

## Main Execution Flow
Admin UI → authenticated API → SQLite configuration
Worker → due monitors → Ping/HTTP/JSON probes → results/incidents/outbox in SQLite
SMTP dispatcher → outbox → configured recipients
Public UI → sanitized public API → current state and daily history

## Architecture Notes
- One server and one worker share a persistent SQLite volume. No Redis required.
- Unknown and explicitly corrected time are excluded from availability; maintenance does not stop measurement.
- Incident summaries and correction audit records persist; raw checks have bounded retention.
- Archived monitors retain history and stop monitoring/public display; restore leaves them paused.
- Public API excludes targets, credentials, response bodies and detailed errors.
- Session cookies and same-origin mutation checks protect administrator routes.
- Only public network targets are supported. HTTP probes validate DNS and pin connections.
