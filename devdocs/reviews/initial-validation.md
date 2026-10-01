# Initial implementation review

## Delivered scope
- React public status page and administrator console; branding and SMTP configuration.
- Fastify API, single-administrator sessions, encrypted monitor/SMTP settings and public redaction.
- Separate worker for Ping, HTTP/HTTPS, typed dotted JSON rules, incident transitions and ordered mail delivery.
- Unknown observations excluded from availability; maintenance observations included. Daily history uses KST.
- Configuration changes end an incident with an explicit configuration reason rather than claiming recovery.

## Validation performed
- `npm test`: 37 unit and integration tests passed.
- `npm run build`: strict TypeScript check and Vite production build passed.
- `npm run test:e2e`: 4 Chrome browser tests passed, covering public empty/error/service states, mobile width, daily tooltip, login, JSON monitor creation/editing, maintenance, branding and masked SMTP storage.
- `npm audit --omit=dev`: no reported vulnerabilities at validation time.
- Docker image built successfully. Isolated web/worker containers with a temporary shared volume passed public API/page and admin SPA responses, Secure session cookie, shared heartbeat, settings persistence after web restart and loopback Ping executable checks. Temporary containers and volume were removed.
- Desktop, mobile and administrator screenshots visually inspected. Browser fixtures exist only in tests; production has no fabricated monitors or observations.

## Review corrections
- Preserve outage-before-recovery ordering during SMTP retries.
- Cancel pending and claimed notifications on maintenance/configuration changes so failed in-flight messages do not reappear in the queue.
- Reuse free probe slots while other probes remain slow; protect results with configuration revision and lease checks.
- Use immediate configuration write transactions to avoid deferred WAL upgrade races.
- Validate HTTP headers against Node's actual supported values.
- Check authorization against registered route paths and keep raw credentials out of public responses/logging.

## Remaining operational checks
- Actual monitored addresses and SMTP credentials were not provided. No real external notification was sent; SMTP dispatch was exercised with an injected sender. Verify delivery using the administrator test-mail action after entering real credentials.
- A production domain/reverse proxy certificate was not deployed. Production requires an HTTPS APP_ORIGIN and HTTPS termination in front of the web container.
- SMTP cannot undo a message already accepted by the relay. A crash between relay acceptance and the SQLite commit can produce a duplicate.
- This is a single-host SQLite deployment with bounded concurrency, intended for a modest number of monitors. Long timeouts and many slow endpoints can delay checks; stale gaps remain unknown.
- HTTP redirects are limited to the same origin (maximum 3) and responses to 1 MiB. Ping depends on the host/container permitting ICMP.
- This workspace already had an unrelated listener on port 3000; tests used isolated API port 40531 and web port 5174, without stopping the existing listener.
