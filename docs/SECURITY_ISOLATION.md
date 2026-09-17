# SEC-001 — security and isolation

Verified on 2026-09-17 on `codex/integrate-telephony-and-finish`.

## Boundaries covered

- Regional SQLite repositories: identical appointment, customer and idempotency IDs
  in MX/US and two tenants remain isolated. Cancelling one record leaves the other
  region, tenant and location records intact; location-filtered lists remain scoped.
- Administrative API: valid foreign-tenant sessions, wrong roles/origins and nested
  tenant/region selectors are rejected. Rejected logout requests do not revoke the
  legitimate session.
- Every model tool rejects caller-supplied tenant/location/customer/call identifiers,
  idempotency keys, region, turn sequence and developer authorization, including
  unexpected nested arguments, before service side effects.
- Confirmation tokens require the original trusted scope, action, arguments and a
  later caller turn; existing expiry and single-use behavior remain covered.
- Telephony: malformed ARI events are ignored; external-media channels are not
  treated as incoming callers. Existing integrated tests reject an unknown DID
  before media/Realtime allocation and exercise the trusted DID-to-location path.
- Existing Google event ownership/etag tests and full conversation/media regressions
  run alongside the new checks.

## Reproduced gaps and narrow fixes

Before changes, 15 new test cases failed:

1. Ephemeral tool maps used only `callId`. Reusing that ID with a different trusted
   tenant/location/customer could retrieve an earlier appointment reference or
   availability. Reusing an authorized developer session ID without its authorization
   could also inherit developer mode. Database ownership checks were an additional
   defense for appointment mutations, but did not isolate the cached state itself.
2. Confirmation tokens checked call ID but not tenant, location, customer or developer
   authorization. A token presented to the same executor under a changed scope could
   reach the delegate if action/arguments/turn otherwise matched.
3. The two developer tools accepted unexpected arguments (the authorization check
   still existed). Both now enforce their existing empty-argument contract.
4. A JSON `null` ARI WebSocket message threw while reading `channel`. The adapter now
   validates event/channel objects before accessing their fields.

A shared key now binds ephemeral tool state and confirmation tokens to tenant,
location, call, customer and developer authorization. JSON tuple encoding avoids
separator ambiguity. Region remains bound by the application/repository instance;
it is not added to model arguments or duplicated in call contracts.

These are defensive isolation fixes. The tests deliberately reuse IDs/change trusted
contexts; they do not demonstrate that a phone caller can set server-owned context
or obtain another session's opaque token. Normal call IDs must still be unique.
No scheduling policy, calendar routing, media format or database schema changed.

## Validation and limits

- 87 focused tests passed; full suite result is recorded in `PROJECT_STATUS.md`.
- Backend and dashboard typechecks and production build passed.
- Synthetic fixtures only; no live credentials, customer records or provider calls.
- ARI is an authenticated server connection. DID and dialplan configuration remain
  trusted deployment inputs; caller ID is not proof of a person's identity.
- Existing RTP transport pins its first valid peer and uses unencrypted UDP. Network
  access must remain restricted to the PBX; these tests do not establish protection
  against an attacker who can inject the first packet on that network.
- Live PBX/provider security and call validation remain deployment checks. E2E-001
  is the next roadmap task; this task does not claim that work is complete.
