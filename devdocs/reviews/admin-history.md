# Administration and history validation — 2026-10-05

## Changes
- Additive, idempotent SQLite correction table and indexes; legacy monitor configs default to ungrouped/unarchived.
- Administrator-only incident and raw-check pagination and period filters, detail diagnostics, fixed correction intervals and auditable revocation.
- Availability subtracts the union of active corrections, preserving original observations. Fully corrected incidents are hidden publicly; later observations of an ongoing incident make it visible again.
- Private monitor groups, search and status filters, duplicate draft, order controls, atomic bulk operations, archive/restore.
- Incident summaries/corrections no longer expire; raw check retention cutoff is recorded and displayed.

## Validation
- `npm test`: 49 passed, including new auth/origin, pagination, overlap filters, correction/revocation, partial exclusions, midnight and overlapping intervals, ongoing incidents, atomic bulk failure, archive versus an outstanding worker claim, retention, ordering and repeated legacy DB opening.
- `npm run build`: TypeScript and Vite production build passed.
- `npm run test:e2e`: 4 passed. Expanded admin flow covers duplicate, search, bulk resume, archive/restore, 27-incident pagination, detail correction/revocation and mobile overflow checks; existing branding, SMTP configuration and password-change coverage preserved.
- Mobile screenshot inspected; checkbox layout corrected. No production SMTP messages sent.
- `git diff --check`: passed.

## Review / deployment limits
- Mutations use existing session and origin protection; private reasons/groups/targets remain absent from public payloads. SQL values are bound parameters.
- Corrections and bulk mutations use SQLite transactions. Revocations retain original reasons. Archive invalidates outstanding work through existing configuration revisions.
- Public queries restrict active monitor IDs, stop after 20 visible incidents and load only correction ranges relevant to the 30-day chart.
- Existing permanent DELETE API remains backward compatible and destructive; admin UI uses archive.
- Update web and worker together. Old workers still prune closed incidents. Existing deleted history cannot be recovered.
- Changes are in the local workspace; no remote deployment or Git push was performed for this task. No target-server Docker rebuild was run.
