# Synthetic staging release update — prepared, not applied

2 November 2026. This is the reviewed procedure for the existing Lightsail host;
it creates no resources and does not activate real providers. The running release
was read back on 2 November and remains unchanged.

| Item | Exact value |
| --- | --- |
| Branch | `codex/launch-integration-reviewed` |
| Current / rollback release | `282f5c777d5780a66d9cccd36a3f908468d21fe0` |
| Prepared target release | `f38de1316a88f00a5d3f1f36557c3079a2169dc9` |
| Existing website | `https://staging.getyibo.com` (hostname activated separately on 5 November; old IP redirects here) |
| Release archive SHA-256 | `730ada6d1059625738c25fff237b947b885684056b626482ec96df9da822f7db` |
| Archive size / contents | 722,995 bytes; 484 tracked files from the exact target commit |

## Reviewed scope and validation

Only two application source files differ from the running release: configured
application bootstrap and Google OAuth service. They implement the
[trusted HTTPS dashboard return](HOSTED_GOOGLE_OAUTH_RETURN.md). The remaining
delta is documentation, regression tests and the repository copy of the IP SNI
fix already installed on staging. There are no dependency, lockfile, database
migration, dashboard, appointment, Calendar event-adapter or phone-code changes.

On 2 November, the **same Node version as staging, 22.23.4**, passed all **82 focused
tests**, backend and frontend typechecks, and the Vite production build on Mac
ARM64. The official Node archive was downloaded into a temporary local directory
and verified against the vendor's SHA-256 list; no global runtime was replaced.
This supplements the previous Node 26 validation; it is not a new Linux x64 run.
No code or dependency changes were needed. Real provider calls were mocked.

The source archive was built with `git archive` from the exact target commit,
not the working directory. Runtime environment files, SQLite data, recordings,
private-key files, AWS/SSH directories and dependencies are absent. A scan of
all tracked files found no high-confidence private-key/provider-token patterns.
The artifact is local only; nothing was uploaded or installed in this checkpoint.

## Existing host contract, inspected read-only

- `/opt/yibo/current` selects the current immutable, root-owned 0755 release.
  Node is `/usr/bin/node`, version 22.23.4; the existing `yibo-build` user exists.
- API and backup service working directories follow `/opt/yibo/current`.
  `/etc/yibo/backup.env` identifies the current release with `YIBO_RELEASE_SHA`.
  Do not print or replace the other contents of private environment files.
- Caddy uses `/etc/caddy/yibo-staging.Caddyfile`, with the already working
  `default_sni` setting. Its import is
  `/opt/yibo/current/deploy/aws/Caddyfile.example`; the imported asset root is
  `/opt/yibo/current/dashboard/dist`, and the API upstream is loopback 3000.
  The imported routes are identical between these two commits. **No Caddy
  configuration change, restart or reload is needed for this release update.**
- API, Caddy and the backup timer are active and enabled. On 2 November the latest
  scheduled backup succeeded at 15:02:32 UTC, with 112 remote snapshot records and
  the newest about 38 minutes old. Free disk was 53.49 GiB. No backup was pruned.
- Persistent synthetic DB, instance lock, private credentials and certificate
  storage remain outside releases. Keep one writer and all real providers off.

## Execution order for the separate staging update

1. Recheck the exact current release, synthetic startup guard, service state,
   backup freshness and capacity. Stop if any no longer matches this procedure.
   Preserve the prior release and private configuration with its ownership/modes.
   Never copy secrets, the active DB or Mac dependencies into a source archive.
2. Transfer the reviewed archive to a new build directory on this host and verify
   its exact SHA-256. Do not overwrite an existing release directory. Install
   locked dependencies as the existing unprivileged build user using Node 22.23.4
   and pnpm 11.19.0. No environment file or provider credentials are used for tests.
3. Before activation, run the 82 focused OAuth/bootstrap/authentication/Calendar
   identity/precondition/stale-compensation/concurrency cases listed in the OAuth
   report, plus existing `tests/release/lightsail-staging.test.ts` and
   `tests/integrations/regional-backup.test.ts`. Run both typechecks and production
   build on the actual Linux x64 host. Tests use temporary or in-memory data only.
4. Make the completed release root-owned and read-only to runtime, as with the
   existing release. Verify the guard under the existing private staging
   environment without exposing its values or starting another application.
5. At the short staging maintenance window, stop only the backup **timer**, leaving
   its boot enablement intact. Let any active backup finish; do not kill a backup
   or remove its lock. Obtain and verify a fresh encrypted backup while the old
   release and old backup SHA still agree. Stop on backup failure.
6. Stop only `yibo-api.service`, confirm its writer exited cleanly, and atomically
   switch `/opt/yibo/current` to the prepared release. Update only
   `YIBO_RELEASE_SHA` in the existing private backup environment, preserving all
   other bytes/values and file ownership/mode. Then start the same API service.
   No unit, network, Caddy, provider or database-schema change is required.
7. Verify the process working directory resolves to the target release, HTTPS
   dashboard/health return 200, unauthenticated auth returns 401, and public voice
   and ARI remain 404. Verify owner login, roles/tenant separation and synthetic
   appointment create/reschedule/cancel using existing acceptance procedures.
   Restart invalidates admin sessions, so the owner must sign in again privately.
8. Verify an encrypted backup with the new release SHA, then restart the existing
   timer and confirm it remains enabled with a next trigger. Record evidence and
   recheck the next scheduled job. Do not delete the previous release or backups.

If activation fails, keep the backup timer paused, stop the new API and confirm
its writer exited. Atomically restore the previous release link and backup SHA,
then start the previous API and verify health before resuming the timer. These
two releases have identical schemas; **rollback does not restore, downgrade,
delete or overwrite the database**. If the schema or current release differs,
stop for review instead. Never leave the timer paused after a successful rollback.

Expected impact is a brief interruption to synthetic dashboard/API requests and
re-login for active admin sessions. DigitalOcean/Asterisk/7001 and all live
providers are outside this procedure. This is not a production launch.

## Hostname and live-provider boundary

The owned staging hostname is now available for synthetic HTTPS testing. Google requires an
eligible hostname for a hosted OAuth callback; raw-IP hosts are prohibited except
localhost. [Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

Since this procedure was prepared, the owner purchased `getyibo.com` and approved
the [separate hostname checkpoint](AWS_STAGING_DOMAIN.md). On 5 November,
`staging.getyibo.com` was verified at the existing attached IP with matching
Caddy/dashboard origin and trusted HTTPS. Registrar-included DNS avoids another
paid hosted zone; the AWS resource base remains $13/month.

The release update above is still **not applied**. Its Caddy import contract is
unchanged by the hostname checkpoint; preserve the current host wrapper and IP
redirect. A future, separately approved staging Google client would use exactly
`https://staging.getyibo.com/api/integrations/google/callback`. No Google client,
credential or grant has been changed. Real-provider activation must also have its
own reviewed staging guard/environment procedure; it is not authorized by the
domain or synthetic-release update. Authenticated hosted Voice Lab and private
phone handover remain separate gates.
