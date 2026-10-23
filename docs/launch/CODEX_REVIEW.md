# Launch intake and verified fixes

Reviewed 19–20 October 2026 (America/Denver).
This is a development checkpoint, not approval to merge or deploy.

Follow-up: the owner subsequently approved combining these sources. The
[23 October combined integration report](COMBINED_INTEGRATION.md) records that
result. The separate-branch results below remain the historical intake evidence.

## Exact sources

| Source | Reviewed commit | Meaning |
| --- | --- | --- |
| Original `AlanCole1234/YIBO_AI_RECEPTIONIST` main | `01dc29a7fc2385126dc88018d4e213099480696f` | Existing main, unchanged |
| David's fork PR #3 | `140a1692f763b9b755b54bd1c7ae17941236234c` | Demo/inbound-safety baseline; base for this review branch |
| David's fork PR #2 / original repository PR #19 | `2520609d22f1b8cb68e27157a52272877492f444` | Booking hardening and completed product work; still open |
| Corrected booking-hardening branch | `701d4348622fad4faec301098d22c3d707df80c1` | Includes the verified stale-compensation fix; preserved separately |
| Existing Cloudflare branch | `40f89423b4170d394db0b17d6fecd78b5637afe4` | Reusable dashboard Worker/configuration |

PR numbers are repository-specific. Original-repository PRs #2 and #3 are old,
already-merged scheduling/customer modules, not David's current launch work.
GitHub access to the original repository has push permissions; access to David's
fork is read-only. No PR or main branch was merged or changed.

## Reproduced defects fixed here

1. A second call to an old process-lock release function deleted a newer owner's
   lock. A foreign container hostname also allowed takeover without proving the
   original process had stopped. Replaced hostname/PID unlink logic with a held
   SQLite `BEGIN IMMEDIATE` transaction on a separate private lock file. Its OS
   lock survives neither process death nor descriptor close; the file is never
   unlinked. Added simultaneous-start, crash/restart, foreign-lock, single-owner
   and stale-release process tests. The old test expecting unsafe foreign-lock
   takeover now requires refusal. Twelve repeated simultaneous-start runs passed.
2. A nonexistent backup source was created as an empty SQLite database, then
   reported as a successful backup. The source now opens read-only.
3. SQLite accepted an existing empty backup destination despite the stated
   no-overwrite contract. Output is now exclusively reserved before copying.
4. Backups were created with 0644 permissions on this Mac. New snapshots are 0600
   from creation, including when the caller's umask is permissive.
5. PR #3's DST-gap rejection caused an availability search to throw `RangeError:
   Invalid time value` when business hours included the skipped hour. Scheduling
   now skips invalid instants and returns the valid slots before/after the gap.

All six failure cases (two lock cases, three backup cases, one DST case) were
reproduced with failing regression tests before the fixes. Eight tests were added
net, retaining existing backup-integrity and appointment coverage.

Container preparation also copies the existing pnpm build-approval policy before
installing dependencies, explicitly sets development mode only in the local demo
Compose file, and excludes environment files, local worktrees, rendered PBX
credentials, SQLite data and private key files from the Docker build context.
The base Docker image keeps production mode. No container was deployed.

## Validation

- PR #3 review branch: **508 passed, 1 optional live OpenAI test skipped**, across
  82 passing files and 1 skipped file. Provider credentials were removed from the
  test environment; local socket tests used disposable synthetic fixtures.
- Backend and frontend typechecks: passed. Vue production build: passed.
- Asterisk template validator and cost-model command: passed. These do not verify
  the installed PBX or actual provider costs. Docker is not installed here, so an
  actual Docker image/Compose smoke test remains pending.
- Corrected booking branch at `701d434`: **751 passed, 1 optional live OpenAI test
  skipped**, across 101 passing files and 1 skipped file, including stale
  compensation, recovery, idempotency, spend limits, shared hangup, tenant/role
  isolation, synthetic Google operations and phone lifecycle coverage.
- The two branches have **not** been combined; these are separate suite results,
  not a claim that a merged launch candidate is validated.

## Integration gate

Do not deploy PR #3 alone over the existing product. It is based on main and does
not include the completed product/dashboard work or booking protections present
in PR #2. PR #2 and original PR #19 still point to `2520609` and do not contain
`701d434`; carry that fix forward explicitly. The existing phone playback fix
`8db12d1` also remains separate and must be considered before any phone cutover.

After owner approval, prepare a combined candidate from the corrected booking
branch and the reviewed PR #3 changes, preserving both parents' intended work.
Direct overlap includes environment configuration, main startup, agent prompt
compilation and time conversion/tests. Reuse the existing regional backup workflow
from the booking branch instead of introducing a second production backup system.
Re-run the combined suite, both typechecks, production build and browser smoke
before requesting any production merge or deployment approval.

PR #3 also changes transfer behavior and supplies complete replacement PBX
templates. Its `yibo-internal`/`yibo-outbound-transfer` contexts are not evidence
that those contexts exist on Alan's current PBX. Never install those templates,
restart Asterisk, or change the existing 7001/public routes as part of integration.

## Actual infrastructure and account blockers

- Existing public dashboard: `https://yibo-ai-receptionist.28rc9ktmdp.workers.dev`.
  Browser verification shows the login page and **Authentication is unavailable
  right now**. A static dashboard is not a functioning authenticated product.
- Its recorded owning Cloudflare account is `cd9a637a5bc540ca195f7c8323cb81a1`.
  The currently signed-in Gmail account is `9ae2f226ce9f016ee04ced6511eac7fb`, and
  its switcher lists only that account. This does not mean the Worker is missing.
  Recover the original identity, or have an administrator of the owning account
  invite the current identity. Do not create a duplicate Worker or change DNS.
- Prior verified backend blocker: the deployed proxy had no usable `API_ORIGIN`.
  Current private bindings/build settings cannot be re-inspected without owning
  account access. No verified persistent HTTPS API origin has been established.
- Existing DigitalOcean PBX: `ubuntu-s-1vcpu-1gb-nyc1` in NYC1. The prior read-only
  inventory measured one CPU, about 962 MiB RAM, roughly 556 MiB available, no
  swap and about 6.7 GiB disk free. This is reusable phone infrastructure, not an
  empty application host. Co-hosting requires approved resource limits, a measured
  load test and a rollback plan; do not install/build on it speculatively.
- Reuse the original repository's Node/systemd, API-only Cloudflare Tunnel and
  Worker proxy drafts. Keep regional SQLite on durable Node storage, one
  authoritative writer, persistent backups, and secrets outside Git. Workers do
  not run the existing SQLite/UDP/ARI process unchanged.

The next gated step is approved integration on a separate launch-candidate branch
and recovery of the original Cloudflare account. Hosted login, public HTTPS API,
24/7 AI runtime, actual Google create/reschedule/cancel and a real phone call all
remain unverified for the final deployed candidate. No production configuration,
customer data, Google credentials, PBX service, route or purchase changed here.
