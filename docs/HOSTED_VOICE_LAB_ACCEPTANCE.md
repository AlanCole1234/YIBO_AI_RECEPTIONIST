# Authenticated hosted Voice Lab — activated, 11 November 2026

**Activated on the existing AWS staging host with the owner's approval.**
https://staging.getyibo.com runs reviewed release
`d5eb70ef0f707f62c51da2ebb982d7d5b09e1606`. Owner login, authenticated public WSS
preview readiness and encrypted recovery restore pass. The microphone remains
off; **no real AI session has started**. The owner must perform the voice test
below before conversational/provider acceptance can be marked complete.

The existing Google-test database, owner password and Google grant were preserved.
The prior `eb9af245124f0e4c151655da06a3f729fb413202` release remains available for
rollback. No AWS resources, phone services, production data or application code
were changed during activation. The four approved staging environment changes
are recorded below; OpenAI credentials remain private on the server.

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

## Approved AWS activation procedure — completed

The startup guard now recognizes a **separate** `voice-lab-test` profile. Existing
`synthetic` and `google-calendar-test` profiles still reject OpenAI credentials
and hosted voice activation. The following procedure was approved and completed
on the existing staging host; future deployments still require authorization:

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
   readiness. The owner separately starts the microphone test below; this step
   does not authorize an automated real AI session.
   Roll back release and private environment to the prior reviewed profile if
   startup/health/access fails; preserve the database and test evidence.

This document is a reviewable procedure, not authorization to activate providers.
Do not change the DigitalOcean PBX, 7001, Stasis ownership, live Google application,
main, production data or any Cloudflare configuration.

## Validation before deployment

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

## AWS activation and verification evidence

- Native Ubuntu 24.04 x86-64 / Node **22.23.4** / pnpm **11.19.0**:
  frozen-lockfile installation, **154/154 tests in 15 files**, backend typecheck,
  dashboard typecheck and production build passed before the switch. These are
  the 135 focused cases above plus 19 regional-backup cases. Checks ran as the
  unprivileged build user without provider credentials. No unrelated full suite
  was repeated.
- The GitHub source archive and all **492 tracked source files** matched the
  reviewed commit. No dependency, schema or runtime-code edits were made on AWS.
- Activation completed at approximately **02:23 UTC on 11 November**. Encrypted
  DB backups passed before and after switching at **02:23:12.788** and
  **02:23:17.127 UTC**. Both the original synthetic and Google-test database
  schemas/content matched their pre-restart hashes, preserving owner, grant and
  appointment history. Only the staging API restarted; Caddy's PID, public env,
  service configuration and reverse proxy stayed unchanged. The backup release
  SHA was updated and its timer restored.
- Only `YIBO_STAGING_PROVIDER=voice-lab-test`, `YIBO_RUNTIME=openai-realtime`,
  `YIBO_HOSTED_VOICE_LAB=1` and the privately entered `OPENAI_API_KEY` changed in
  the backend environment. No model override was added. Rollback files and
  evidence are root-only under
  `/etc/yibo/rollback/voice-d5eb70e-20261111T021920Z`.
- At **18:33 UTC**, encrypted off-host runtime recovery backup and isolated
  restore passed. The backend env, public env and release metadata were restored
  into a separate directory and byte-compared: **3/3 files identical**. Nothing
  was restored over the live database/configuration. This uses the existing
  private backup repository and the owner's previously saved recovery key.
- **12/12 external HTTPS/WSS checks passed**: dashboard/health, exact JS/CSS
  hashes from the validated build, HTTP → canonical HTTPS, unauthenticated
  identity/status/upgrade denial, foreign-Origin and client-tenant-selector
  rejection, and `/voice`/`/ari` remaining unavailable. No provider calls were
  made. The temporary external probe was closed after results were saved.
- The owner confirmed re-login with the existing password. Authenticated hosted
  browser checks show **Ready when you are**, microphone off, the saved
  `gpt-realtime-2.1` / `marin` configuration, Calendar tools available, Google
  connected and America/Chicago. The unused preview closed once at 120 seconds;
  Recent Activity recorded closure and a fresh preview connected after returning
  to AI agent. Cost remained **$0.0000 / zero tokens / zero tools**. No browser
  warnings/errors; at the current 582 px viewport, no horizontal overflow.
- Final read-only verification: API, Caddy and backup timer active/enabled;
  scheduled DB backup at **18:02:30.742 UTC** targets the active release;
  **zero call records** after preview checks. No microphone or WAV was started.
  Home correctly still reports phone/email setup pending.

Base AWS hosting remains **$13/month**; no additional resources were created.
Current credits were not refreshed during this checkpoint. OpenAI usage is
separate from AWS credits and starts only when the owner starts a voice test.
Configured-key readiness does not prove provider authentication, model access or
billing; those require the first real test. Revoke any superseded OpenAI key
privately; revocation was not independently inspected.

## Remaining manual acceptance

**Not claimed complete:** real model audio, microphone echo/interruptions,
natural conversational rules, spoken confirmation, provider-reported costs, and
a fresh conversation after logout/re-login. The previous real Google
create/reschedule/cancel checks remain valid evidence; they were not repeated
during this voice activation. The separate External/Testing Google grant's
seven-day lifetime remains a pre-pilot limitation.

1. At https://staging.getyibo.com, sign in and open **AI agent**.
2. Click **Start Voice Test** and grant microphone access when the browser asks.
   If the unused preview has closed, starting a test reconnects it. Only the
   owner performs this step; real OpenAI usage may incur charges.
3. Use synthetic contact details and only **YIBO AWS STAGING TEST**. Begin with
   “I'd like to book a consultation. What times are available?” Choose a date
   and time that YIBO offers, then ask to label the appointment as a staging test.
4. Confirm the actual Calendar event, reschedule that same appointment, then
   cancel it. Expect one clear confirmation after each successful operation,
   no duplicate event or repeated question, and the correct clinic-local time.
5. Say goodbye; check completion, released microphone, retained Recent Activity
   and usage/cost. Start a second short test, then end it. Report any failure
   before changing provider settings or phone routing.

Later, separately approve phone handover and a real full call; browser voice is
not PBX acceptance. Production funding, OAuth readiness and the remaining launch
PDF gates must pass before a paying-customer launch.
