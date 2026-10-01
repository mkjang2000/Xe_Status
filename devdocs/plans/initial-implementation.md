# Purpose
Build a compact, customizable public status page for a single administrator.

# Requirements and scope
- React/Vite + Node/Fastify + TypeScript + SQLite; separate worker process.
- Ping, HTTP/HTTPS and dotted-path JSON assertions; bounded intervals, timeouts and concurrency.
- Public page: brand header, summary, service rows with 30 daily bars, recent incidents.
- Admin: login, monitor CRUD/pause/maintenance, branding and SMTP configuration/test.
- Mail once on incident and recovery, suppression during maintenance; alert if still down after maintenance.
- Empty installations show real empty states; never seed imaginary operational history.

# Interfaces and data flow
Shared types live in `shared/types.ts`. API routes use JSON request/response bodies.
`GET /api/status` is public. `/api/auth/login`, `/api/auth/logout`, `/api/auth/session` manage cookies.
Authenticated `/api/admin/monitors`, `/api/admin/branding`, `/api/admin/smtp` manage settings.
`GET /api/admin/monitors/:id/checks` supplies private recent diagnostics.
`POST /api/admin/smtp/test` enqueues a test email for worker delivery.
Worker writes results, updates consecutive success/failure counters and emits incident events transactionally.

# Failure handling and state
Timeout, remote DNS/connect/TLS error, invalid JSON or mismatched assertion means a failed check.
Missing worker/probe executable is unknown, never synthetic downtime. Stale results become unknown.
Displayed state and incident transitions use consecutive thresholds; uptime uses individual checks.
Each result covers at most one configured interval forward, clipped by the next result and report boundary.
Unknown gaps are excluded; daily downtime during maintenance still lowers uptime.
Pause ends coverage at pause time; resuming resets streaks and schedules a fresh check.
SMTP delivery is separate from probes, bounded, retried and visible in admin diagnostics.

# Compatibility and security
New project, no existing data/API. Single administrator supplied by environment; no default password.
Encrypt stored request headers/body and SMTP password with an environment-provided encryption key.
Reject private/special IPs, validate each redirected URL, cap redirects and response size, no user code execution.
HTTP headers/body and SMTP authentication are never returned publicly; private failures are generic.

# Validation
Strict type check and production build; unit tests for JSON, state transitions and availability intervals.
Fastify injection tests for session authorization, public redaction and configuration validation.
Local isolated integration checks for worker persistence and SMTP using test doubles where needed.
Browser smoke checks for public/admin navigation and key form flows if tooling is available.
