# systemd deployment

## Scope
Provide native Linux service units for the existing web and worker processes, grouped by a target. No application, database or credential changes; Docker Compose remains available separately.

## Design
- `xe-status-web.service` and `xe-status-worker.service` directly invoke Node with the existing tsx import and `.env` file, avoiding shell/npm intermediary processes.
- `xe-status.target` starts both services with Wants; each service declares PartOf for grouped stop/restart. A web crash does not stop monitoring.
- Failed processes restart after five seconds; repeated startup failures are rate-limited. SIGTERM allows normal shutdown with a 45-second limit.
- Templates assume /opt/xe-status, account xe-status and /usr/bin/node; operators must adjust these to match their deployment.
- NODE_ENV=production is supplied by systemd and takes precedence over the Node-loaded environment file. Existing .env, encryption key and database are preserved.
- The worker receives CAP_NET_RAW for Ping. The application listens on loopback when used with a host-installed cloudflared service.

## Validation
Check units with systemd-analyze; run the exact Node entry commands against a temporary database and verify HTTP response, shared worker heartbeat and SIGTERM exit. Do not install or enable services on this development host on behalf of the separate deployment server.

## Validation result
- systemd-analyze verify passed after substituting this host's Node/project paths in temporary unit copies. One unrelated pre-existing host unit emitted a legacy PIDFile warning.
- Exact direct Node entry commands started the web and worker with an isolated temporary database; HTTP 200, shared worker heartbeat, production environment precedence and clean SIGTERM exits were confirmed.
- No system services were installed or enabled on the development host. Target-server installation and boot recovery remain to be checked there.
