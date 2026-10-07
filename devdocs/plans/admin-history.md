# Administration and incident history

Preserve existing SQLite data with additive migrations. Keep incident summaries and correction audit records indefinitely; prune raw checks using the existing retention policy and record its cutoff. Admin history uses bounded pagination and monitor/time/state filters. Detail exposes private failure reasons and surrounding checks only to authenticated administrators.

False-positive corrections store fixed start/end intervals and a required reason, with revocation rather than deletion. Subtract their union from measured availability coverage without changing raw checks. Ongoing incidents may only exclude time through submission; later failures remain measured and visible. Public incident hiding requires full coverage of the incident through its latest observation; partial corrections remain visible.

Monitor management adds private groups, search/status/archive filters, duplicate drafts, ordering, transactional bulk enable/disable/group/maintenance/archive/restore. Archive stops monitoring and removes public display while retaining history. Restore leaves monitoring paused. Existing explicit DELETE API remains compatible; the UI uses archive instead.

Validate migrations, interval overlap/boundaries/revocation, authenticated pagination and corrections, retention, archive and atomic bulk operations; run typecheck, unit/integration tests, build and browser tests.
