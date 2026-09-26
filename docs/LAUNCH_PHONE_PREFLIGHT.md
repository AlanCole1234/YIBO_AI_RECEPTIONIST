# ACCEPT-001 — launch candidate phone preflight

**BLOCKED / real call not performed — 26 September 2026.**
RISK-001 is complete (`3046c82`), and real Google acceptance is complete
([evidence](LAUNCH_GOOGLE_ACCEPTANCE.md), `a437ea2`). The ordered next gate is the
real isolated phone call. Deployment/restore and pilot onboarding have not begun.

## Read-only evidence

- Attempted SSH to the previously configured PBX with batch authentication,
  strict existing host-key verification and an 8-second connection deadline.
  Connection timed out before any remote command ran. The requested commands were
  read-only dialplan displays and active-channel count, with no reload/restart.
- At **17:28:41 UTC**, attempted the exact ARI endpoints used by the current client:
  `GET /ari/asterisk/info`, `/ari/applications`, `/ari/channels`, `/ari/bridges`.
  All four timed out after 6 seconds. Credentials were read privately; no headers,
  secrets, endpoint payloads, caller identifiers or recordings were displayed.
- No websocket subscription, call originate, channel/bridge/media operation,
  service start/restart, configuration edit or dialplan reload occurred.
- Therefore current loaded routes, active calls and media reachability **cannot
  be verified from this Mac**. These timeouts do not establish that the phone
  service is down, nor distinguish an offline PBX from a network/firewall issue.

The last recorded routing attempt restored 7001 and verified the original file,
`from-yibo-test` and `from-pstn` snapshots after its validation failure. No fresh
claim is made about current live state. That rollback remains the required stable
baseline; do not repeat the old routing change automatically.

## Follow-up: local network blocker identified

Read-only checks later on September 26 again timed out for SSH and all four ARI
endpoints. Tailscale's local status and preferences now establish a specific
prerequisite that is missing:

- Backend state `Stopped`, `WantRunning=false`, `LoggedOut=false`.
- This Mac reports offline with no active Tailscale IP. The route to the configured
  PBX uses the ordinary Wi-Fi interface/default gateway, rather than a Tailscale path.
- The saved profile accepts private routes and Tailscale DNS; no exit node or
  advertised routes are configured. No setting was changed during inspection.

Reconnect the existing profile before drawing conclusions about PBX health. This
finding explains the absent local private connection, but does not prove the PBX
will be reachable afterward or resolve the earlier 7001 validation failure.

The installed CLI documents that `tailscale up` **with no flags** reconnects without
changing saved settings. Proposed action: run
`/Applications/Tailscale.app/Contents/MacOS/Tailscale up`, then repeat only status,
route, SSH and ARI reads. Do not use `--reset`, change profiles, enable an exit node
or alter Asterisk. Reconnection activates the saved DNS/private routes on this Mac,
so approval was requested under the user's working-phone preservation constraint.
At this checkpoint no reconnect was performed; approval/operator reconnection is
pending. No real call or RTP verification has occurred.

## Operator action and next safe steps

1. Reconnect this Mac's existing Tailscale profile after approval (or have the
   operator reconnect it), then verify private-network access to the PBX. If it
   remains unreachable, check the PBX host/network connection without changing its
   working phone routes. No new DID or infrastructure is needed for this check.
2. Once reachable, inspect the loaded 7001 context, public route, registered ARI
   applications and active resources read-only. Diagnose the earlier
   `test_route_not_loaded` validation failure before proposing another change.
3. Prepare a fresh isolated application/database using the current launch commit,
   separate ports and RTP 50500–50509; verify no overlap and bidirectional media
   reachability. Do not enable an ingress that could receive production calls.
4. Present the exact dedicated-route change and rollback procedure for **explicit
   approval** before altering Asterisk/Telnyx or a working route. Historical approval
   to attempt 7001 does not override the later instruction to preserve its rollback.
5. After approved setup passes its safety checks, have the user place a real call
   from Linphone. Verify incoming/audio both ways, natural turn-taking and barge-in,
   no repeated questions, contact/availability/booking, one success confirmation,
   reschedule/cancel if exercised, full goodbye and clean channel/bridge/RTP teardown.
   Do not substitute a scripted or synthetic conversation for this manual gate.

No merge to main or deployment is authorized by this preflight.
