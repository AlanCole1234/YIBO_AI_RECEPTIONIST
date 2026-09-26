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

## Operator action and next safe steps

1. Make the existing PBX reachable from this Mac on its private network (previously
   Tailscale). Check the PBX host/network connection without changing its working
   phone routes. No new DID or replacement infrastructure is needed for this check.
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
