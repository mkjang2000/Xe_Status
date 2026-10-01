# Administrator password changes

- Add an authenticated, origin-checked and rate-limited POST /api/admin/password plus a console password tab.
- Require the current password, a different new password (12–1024 characters) and matching confirmation.
- The environment password remains the initial credential until a password is changed in the console.
- Persist a random salt and scrypt hash in the existing settings table; never persist the new plaintext password.
- Change the credential and clear all sessions atomically. Compare the credential snapshot after asynchronous verification to reject concurrent outdated login/change requests.
- Database credentials take precedence after restart; no schema migration or environment-file write is needed.
- Validate invalid input, current-password mismatch, session invalidation, persistence across app restart, and the complete browser change/relogin flow in isolated test databases.

## Validation result
- Authentication/password tests: 12 passed, including credential persistence and concurrent change handling.
- Browser suite: 4 passed, including password change and relogin using an isolated test DB.
- Production build and strict type check passed. Running development server serves the new form and rejects unauthenticated password changes.
