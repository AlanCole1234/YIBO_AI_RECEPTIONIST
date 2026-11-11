# Linux ARM64 validation — 24–25 October 2026

**PASS for local Linux ARM64 compatibility. Not an AWS deployment or live-provider
acceptance.** Source: `2232ade31c16ade7c6db77b8aab14f0275375c81` on
`codex/launch-integration-reviewed`. No application, dependency, schema or business
logic change was needed. Only this validation record and deployment planning docs
changed in the repository.

## Isolated environment

- Native ARM64 Ubuntu 24.04.5 LTS VM on the Mac, Lima 2.2.1/VZ; 2 vCPU, 2 GiB RAM,
  no swap, 20 GiB sparse disk. This tests Linux ARM64, not EC2 Graviton performance.
- Official Node **22.23.4 linux-arm64**, repo-pinned pnpm **11.19.0**, Caddy
  **2.11.7 linux-arm64**. Vendor checksums verified before use.
- Exported only tracked source with `git archive`; no host mounts, SSH-agent
  forwarding, existing `.env`, provider credentials, production databases or audio
  recordings. Synthetic owner/business/appointment data only.
- Frozen dependency install passed with existing pnpm build-script restrictions.
  Node's actual `node:sqlite` implementation ran; no database substitute.
- Used the existing `deploy/node/yibo-api.service.example` unmodified, dedicated
  `yibo-api` user, `/opt/yibo/current`, private environment and `/var/lib/yibo`
  persistence. Used the existing Caddy template with a local HTTP test address.
- No AWS resources/API sessions, public DNS/certificate, provider usage or hosting
  charge. No PBX/Asterisk/SIP/7001, live Calendar/OAuth or production data access.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS on Linux ARM64 |
| `pnpm test --maxWorkers=2 --minWorkers=1` | **773 passed, 0 failed, 1 optional live OpenAI test skipped**; 28.03 s |
| `pnpm exec tsc --noEmit` | PASS; 3.92 s |
| `pnpm exec vue-tsc --noEmit -p dashboard/tsconfig.json` | PASS; 5.77 s |
| `pnpm build` | PASS; both typechecks and Vite production assets; 10.62 s |
| `pnpm asterisk:check` | PASS; repository templates only, no PBX connection |
| `pnpm cost:model` | PASS |
| Existing systemd/Caddy configuration validation | PASS inside the guest |

Tests ran without provider keys and with checkout dotenv loading disabled. The
full suite includes Google transport/OAuth, scheduling, fencing/compensation,
idempotency, tenant/auth, SQLite and voice regressions. Google responses in that
suite are mocked; these results do not establish live Google authorization.

## Runtime smoke checks — 14 passed

Actual production Fastify and built Vue assets ran behind actual Caddy:

1. API health through the proxy.
2. Production dashboard HTML, hashed JS/CSS and SPA routes.
3. Private `/voice` and `/ari` routes return 404; unauthenticated API returns 401.
4. Untrusted Origin rejected with 403.
5. Persisted synthetic owner login and Secure/HttpOnly/SameSite cookie attributes.
6. Availability with location, service and professional selection.
7. Manual booking and identical idempotency replay retain one appointment.
8. Overlapping booking rejected with 409.
9. Reschedule keeps the same **synthetic provider** event ID.
10. Cancel persists CREATED → RESCHEDULED → CANCELLED appointment history.
11. Readiness reports missing real providers honestly in synthetic mode.
12. Clean systemd restart preserves account and SQLite data; fresh login succeeds.
13. Online SQLite snapshot, verify and restore to a separate directory preserve
    integrity and the appointment. No remote backup store was used.
14. Killing only the disposable guest's API triggers systemd recovery; dead-process
    instance lock is recovered and persisted data remains available.

The production login screen also rendered correctly in the in-app browser through
Mac loopback. **Browser form login was not exercised in this ARM run**; login and
appointment mutations above were real HTTP API requests. Earlier merged dashboard
browser acceptance is recorded separately in [COMBINED_INTEGRATION.md](launch/COMBINED_INTEGRATION.md).

## Voice Lab smoke checks — 5 passed

The actual `apps/dev-voice/server.ts` ran privately in the guest with a separate
synthetic SQLite database and the in-memory scripted runtime:

1. Voice Lab HTTP page and browser modules load.
2. WebSocket conversation 1 starts, accepts synthetic PCM and completes once,
   including a repeated completion request.
3. Conversation 2 starts fresh and independently completes once.
4. Distinct session IDs, completed call history and usage endpoint persist.
5. Shutdown releases the Voice Lab process and listening socket.

This tests real local server/WebSocket lifecycle, not human microphone capture,
spoken AI quality, live OpenAI usage, speakerphone echo or Asterisk media.

## Reboot checks — 4 passed

After a full disposable VM stop/start: boot identity changed; systemd started API
and Caddy automatically; stored owner login worked; cancelled appointment and its
three history entries survived. API memory observed after these checks was about
147 MiB current / 167 MiB peak, with Caddy about 51 MiB. This is an idle/smoke
observation, not a concurrent-voice capacity measurement.

## Findings and cleanup

- **No ARM64 compatibility defect found.** No existing tests were weakened.
- Admin sessions are process-local: restart revokes the old cookie; fresh login
  works with the persisted owner. The smoke harness was corrected to this existing
  contract, not by changing application behavior. Each harness run also uses new
  idempotency keys to avoid intentionally conflicting with its earlier data.
- The temporary Lima catch-all initially ignored only wildcard-bound guest ports,
  allowing extra guest loopback ports to be forwarded on Mac loopback. Stopped
  only the test VM, set `guestIPMustBeZero: false` on the ignore rule, and verified
  only the explicit preview port remained forwarded. Existing services were not
  stopped or replaced. This is a local test-harness correction, not a YIBO change.
- At completion the VM was stopped and test listeners released. Its temporary
  disk/helpers remain under `/private/tmp/yibo-lima-arm64` and
  `/private/tmp/yibo-arm64-validation` for reproduction; they are not durable
  repository artifacts. Guest-only synthetic credentials were not exported.
- The sanitized [result summary](launch/AWS_ARM64_RESULTS.json) is retained in Git.
  Raw `/tmp` suite output was cleared by the intentional guest reboot after the
  summary was saved. Do not confuse nested Vitest suite totals with test-file totals.

## Next deployment steps and approval gates

1. Use the verified balance/deadline and current [cost comparison](AWS_ACCESS_AND_COST_REVIEW.md).
   Check the lower-cost Lightsail candidate's actual target/quota and backup access
   read-only. If a different CPU architecture is chosen, validate that target too;
   the EC2 `t4g.small` ARM architecture is already covered here.
2. Confirm an owner-controlled hostname, one host/volume/address, management access,
   backup retention and a cost ceiling. Obtain explicit approval before creating
   infrastructure or renewing/expanding the expired audit authorization.
3. On an approved host, install the pinned runtime/release and existing systemd/
   Caddy templates. Use fresh synthetic SQLite and private secrets entered through
   a secure channel. Serve dashboard and `/api` on one HTTPS origin; keep ARI,
   Voice Lab and RTP private. Do not copy the Mac phone `.env` wholesale.
4. Verify public TLS, login/roles/tenant isolation, restart/reboot, off-host encrypted
   backup and restore, and monitoring. Keep the live PBX and database untouched.
5. Resolve the known hosted OAuth return-origin and authenticated Voice Lab WSS
   gates in [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md) before enabling those features.
6. With separate provider approval, verify real Calendar create/retrieve/reschedule/
   cancel. Then review the separate phone fix and one-owner private PBX handover,
   load-test the selected host and conduct a real call. No phone cutover is approved.
7. Obtain a funded continuity decision before the Free plan expires or credits run
   out; then run release preflight and obtain production approval. Local success
   is not a declaration that the application is ready for paying customers.
