# Authenticated hosted Voice Lab — preparation, 10 November 2026

**Prepared locally; not activated on AWS.** Staging still runs approved release
`eb9af245124f0e4c151655da06a3f729fb413202`. Its real Google test-calendar acceptance
and owner login remain complete. This checkpoint addresses the next launch gate:
browser voice on the persistent host before any phone handover. No AWS resources,
provider requests, secrets, live configuration or production data changed.

## Implementation and boundaries

- Production builds connect to same-origin `/api/voice-lab/stream` using WSS over
  HTTPS. Caddy's existing `/api/*` reverse proxy handles the upgrade; port 4317,
  `/voice`, ARI and RTP remain private. The loopback HTTP Vite development workflow
  retains its existing local harness. No dependency or database schema was added.
- `YIBO_HOSTED_VOICE_LAB` is a server setting: unset/`0` means disabled, `1` opts
  in; other values fail configuration validation. The authenticated status endpoint
  reports setup guidance and the UI disables starts when unavailable.
- Upgrades use the existing HttpOnly admin cookie, session verification, tenant
  and role rules, plus an exact allowed dashboard Origin. Owner, tenant admin and
  office manager are eligible; a read-only role always denies access. Query
  credentials/selectors and subprotocols are rejected. Session access is checked
  on each message and every five seconds while idle/paused. Revocation/expiry
  closes the conversation; no browser API key or separate auth store is introduced.
- One preview connection is admitted at a time, including asynchronous admission.
  An unused preview closes after two minutes and can reconnect. Heartbeats remove
  abandoned connections. Existing conversation time/token limits are reused,
  unchanged. This is a controlled acceptance feature, not a load/capacity claim.
- Reuse the API application's existing runtime, repositories, saved agent
  configuration, calls, media registration and browser session controller. No
  second SQLite owner or standalone voice process. The first active location with
  a called number is selected on the server; the browser cannot choose a tenant,
  customer or routing identifier. Call startup also rejects cross-tenant routing
  changes. The synthetic caller number remains the existing harness number.
- The trusted `voice_lab` channel uses its saved tool policy without granting
  developer-only tools. Existing phone behavior stays unchanged when the opt-in
  is absent. Hosted previews are unavailable if phone/media gateways are installed
  or telephony readiness is active; they cannot answer a real Asterisk channel.
- Audio input/output is bounded: 2 MiB WebSocket messages, 256 KiB microphone
  frames, 256 pending messages, five seconds of queued PCM and a 1 MiB outbound
  backlog threshold. Hosted audio accepts 8–96 kHz, one/two channels. Overflow or
  malformed input closes the test. One WAV plays at a time. These transport bounds
  do not alter the existing call spending policy.
- Provider errors are redacted in the hosted harness; transcripts/debug audio
  stay off. Tool phase and usage metadata still feed Recent Activity/cost display.
  Microphone/WAV starts open the runtime; merely opening the screen does not.
  Natural goodbye still waits for browser playback drain. Manual end, disconnect
  during startup, logout, and API shutdown use the existing cleanup path.

Provider credentials remain server-side, consistent with the
[OpenAI server WebSocket connection guide](https://developers.openai.com/api/docs/guides/voice-websockets).
No Realtime model, protocol, Calendar integration, booking/confirmation policy,
customer/email subsystem, or phone service was redesigned.

## Prepared AWS activation — approval required before execution

The startup guard now recognizes a **separate** `voice-lab-test` profile. Existing
`synthetic` and `google-calendar-test` profiles still reject OpenAI credentials
and hosted voice activation. On the existing staging host only, after approval:

1. Verify the reviewed commit and run native Linux focused tests, both typechecks
   and build in a new release directory before switching. Check there is no
   active staging conversation; retain the current release for rollback.
2. Take an encrypted backup and preserve private environment/backup-target files.
   Keep `/var/lib/yibo/staging-google-us.sqlite`, owner account, encrypted Google
   grant/key, private test-calendar mapping, session key, public origin and lock.
3. Privately enter an approved OpenAI project key into the root-only backend env.
   Never enter it in chat, a URL, Git, dashboard JavaScript or a public file.
   OpenAI usage is billed separately from AWS credits and the $13/month host base.
4. Change only these activation settings:

   | Setting | Value / source |
   | --- | --- |
   | `YIBO_STAGING_PROVIDER` | `voice-lab-test` |
   | `YIBO_RUNTIME` | `openai-realtime` |
   | `YIBO_HOSTED_VOICE_LAB` | `1` |
   | `OPENAI_API_KEY` | Private approved project key; mandatory |
   | `OPENAI_REALTIME_MODEL` | Optional existing supported default; saved AgentConfiguration remains authoritative |

   Do not set `OPENAI_ADMIN_KEY`, local developer mode, email/phone/AWS access
   credentials. The same dedicated Google-test DB and complete existing Google
   configuration are required by the guard. There is no new domain, port, DNS,
   security group, reverse proxy or Google consent change in this activation.
5. Validate the guard, update only the release/backup SHA, restart only the staging
   API, and verify HTTPS, login, Calendar status, DB preservation and encrypted
   backup. An API restart ends active admin sessions, so owner re-login is expected.
6. Privately log in and open AI agent → Open saved-settings Voice Lab. Verify
   readiness, then obtain microphone permission and perform the manual test below.
   Roll back release and private environment to the prior reviewed profile if
   startup/health/access fails; preserve the database and test evidence.

This document is a reviewable procedure, not authorization to activate providers.
Do not change the DigitalOcean PBX, 7001, Stasis ownership, live Google application,
main, production data or any Cloudflare configuration.

## Validation and remaining acceptance

**135/135 focused tests in 14 files passed** on Mac ARM64 / Node 26.7.0 (38 new
cases). Backend typecheck, dashboard typecheck and the production Vite build pass.
The full unrelated suite was not repeated. `git diff --check` is clean.

Local synthetic automated checks cover authenticated WebSocket upgrades, blocked
roles/tenants/origins, default-off, phone-gateway exclusion, routing changes,
saved voice/channel policy, audio/usage forwarding, transcript suppression,
natural goodbye/drain, manual end, duplicate closure, fresh settings, logout,
pending startup/admission, shutdown and transport overload. Existing browser
lifecycle/cost, auth, call orchestration and Asterisk/Google booking regressions
are included. The staging guard checks all three profiles without opening a DB.

Built-dashboard browser checks used two loopback-only in-memory fixtures, no real
provider key, no persistent DB, and a one-second generated silent WAV. Login,
same-origin preview readiness, idle reconnect, WAV session start, manual end,
Start another test, retained Recent Activity and final cost display passed.
Disabled mode explains activation and disables microphone/WAV starts. No browser
console errors/warnings were observed. At 390 px, document width equals viewport
width; controls stack without horizontal overflow. No real microphone was used.

**Still manual / not claimed complete:** native Linux checks for this new commit,
approved AWS activation and WSS through its public proxy, real model audio,
microphone echo/interruptions, natural conversational rules, spoken confirmation,
provider-reported costs, and a fresh conversation after logout/re-login. Later,
separately approve phone handover and a real full call; browser voice is not PBX
acceptance.

For the controlled voice test, use only the dedicated staging calendar and
synthetic contact details. Ask for a service and price, request an available time,
book one clearly labeled test appointment, verify its actual event, reschedule
that same appointment, cancel it, and say goodbye. Check one confirmation per
successful operation and cleanup, then start a second test. Do not call this a
paying-customer launch until the remaining launch-PDF gates are complete.
