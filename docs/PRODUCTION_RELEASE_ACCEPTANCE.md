# Production release acceptance

This document is the final operator checklist for YIBO production release. It records
what the repository can verify automatically and what still requires the intended live
environment. Do not mark a live item complete from mocked or synthetic-provider tests.

## Automated software gate

Before touching live infrastructure, verify the exact candidate commit with:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm release:preflight
```

The release preflight must run with the intended production environment, not a local
development `.env`. It requires an explicit tenant, region, active regional database,
OpenAI Realtime, Google OAuth, Resend, stable signing/encryption keys, HTTPS dashboard
and redirect URLs, and complete Asterisk/UDP settings.

Record:

- Candidate commit:
- GitHub Actions run:
- Test count:
- Build result:
- Preflight result:
- Operator:
- Date/time:

## DEPLOY-001 — target host and data

Complete before admitting traffic.

- Identify the target host, region and tenant.
- Confirm Node >=22.13 and the repository pnpm version.
- Mount the active regional SQLite database on durable storage and set the matching
  `YIBO_DATABASE_<REGION>` path explicitly.
- Stop writers or use a consistent SQLite online backup before migration or restart.
- Store durable database backup, checksum and recovery keys outside Git.
- Verify `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on the backup.
- Preserve the Google token encryption key and admin session signing key in protected
  secret storage.
- Confirm HTTPS/reverse proxy, secure session behavior and the exact dashboard origin.
- Restrict ARI and RTP networking to the PBX/private network. Do not expose ARI or the
  RTP range publicly.
- Start the container/process and verify Docker/process health plus `/api/health`.
- Login as an authorized admin and verify `/api/admin/readiness` reports no blockers.
- Rehearse restore to a separate path and confirm the restored app can read expected
  business configuration without modifying production data.

Evidence:

- Host:
- Region / tenant:
- DB path:
- Backup location/reference:
- Backup checksum:
- Integrity check:
- Foreign-key check:
- Restore rehearsal:
- HTTPS/session:
- Network/firewall:
- Health/readiness:
- Operator/date:

## ACCEPT-001 / OPS-007 — live providers and call path

Use synthetic contacts and a dedicated test calendar. Do not use real patient/customer
information for acceptance.

### Google Calendar

- OAuth connection succeeds for the intended tenant.
- Every effective location/professional calendar route is accessible.
- FreeBusy returns for the intended calendar.
- Create a test booking and record the external event identity.
- Reschedule twice and confirm the same event identity is retained.
- Cancel the booking and confirm the intended event is cancelled/deleted according to
  the adapter contract.
- Confirm route-change protection blocks mappings while non-cancelled bookings depend
  on them.

### OpenAI Realtime and voice behavior

- A real Realtime session opens with the configured model.
- The assistant speaks the configured locale; es-MX must remain Spanish with the
  configured neutral Mexican style.
- Availability is checked before offering/bookings when required by policy.
- Customer/contact confirmation occurs before booking.
- Spoken appointment time is localized correctly.
- The assistant gives exactly one final farewell and the call ends cleanly.
- Interrupting the assistant cancels/continues correctly without duplicate actions.
- No duplicate booking occurs from repeated or retried tool output.

### PBX / Asterisk / RTP

- Test DID maps to exactly one intended tenant/location.
- Incoming call reaches the configured ARI application.
- Bidirectional audio is intelligible.
- External Media/RTP uses only the configured private host and UDP range.
- Human transfer reaches the trusted configured destination.
- Caller hangup and application-initiated hangup both clean up bridge, media channel,
  runtime session and call state.
- No stale bridge/session remains after failure or normal completion.

### Email / Resend

- Booking-created email is sent to the synthetic recipient.
- Reschedule email is sent.
- Cancellation email is sent.
- Delivery status is recorded.
- At least one provider failure/retry path is verified without changing appointment
  success semantics.

### Browser / administration

- Owner/tenant admin, operator/secretary and read-only behavior match role policy.
- Unsaved-change warnings work.
- Two-tab stale version conflict returns the intended conflict path; no silent
  overwrite occurs.
- Google reconnect flow works from the dashboard when the grant is absent/expired.
- Readiness reflects provider and location blockers accurately.

Evidence:

- Test phone/DID:
- Test calendar:
- Realtime model:
- Google OAuth result:
- Booking event identity:
- Reschedule identity retained:
- Cancellation result:
- Spoken locale/time:
- Farewell/hangup:
- Interruption:
- Transfer:
- RTP cleanup:
- Resend created/rescheduled/cancelled:
- Browser roles/conflict:
- Final `/api/admin/readiness`:
- Operator/date:

## Release decision

Release may be marked production-ready only when:

1. the software gate is green on the exact deployed commit;
2. DEPLOY-001 has complete target-host evidence;
3. ACCEPT-001 / OPS-007 has complete live-provider evidence;
4. no unresolved provider or location blocker appears in readiness;
5. the rollback/restore path has been rehearsed and the durable backup is available.

If any item is missing, describe the missing evidence rather than marking the gate
complete.
