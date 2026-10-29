# YIBO synthetic Lightsail staging

**29 October update:** the owner approved this exact proposal and staging now
exists. Do not provision duplicates. See the [actual deployment and validation
record](../../../docs/AWS_STAGING_VALIDATION.md), including the IP TLS fix,
completed owner login and encrypted backup, and remaining recovery-vault/renewal
checks. The proposal and observations below are retained as historical
pre-provisioning context.

Prepared October 25, 2026 on `codex/launch-integration-reviewed`. **Nothing in this
directory provisions resources or runs during the application build.** No AWS
resource, public certificate, IAM grant, DNS record or production change has been
made. Do not run this procedure on the DigitalOcean PBX or a production database.

## Exact proposal

| Item | Proposed value | Observed evidence / cost |
| --- | --- | --- |
| Region | Ohio, `us-east-2` | Existing project region |
| Instance | One `yibo-staging`, `small_3_0` | API: 2 vCPU, 2 GB RAM, 60 GB SSD, 3,072 GB transfer, one public IPv4; **$12/month** |
| Image | `ubuntu_24_04`, OS only | API: active Ubuntu 24.04 LTS; its linked Canonical listing identifies **64-bit x86** |
| Public address | One static IPv4, attached immediately | Included while attached; the actual address is not allocated yet |
| Backup | One private `small_1_0` Lightsail bucket in Ohio | API: 5 GB storage, 25 GB transfer; **$1/month**; unique bucket name chosen at approval |
| Backup access | Attach only the new staging instance to its dedicated bucket | Lightsail resource access; no long-lived AWS keys |
| Instance snapshots | Initially disabled for synthetic staging | Optional daily snapshots retain seven; extra **$0.05 per GB-month** of stored blocks |
| Public ingress | TCP 80/443 IPv4 only | HTTP validation/redirect and HTTPS; no SIP, RTP, ARI, 3000 or 4317 |
| Management ingress | TCP 22, `lightsail-connect` alias only | Browser SSH through the authenticated Lightsail console; no world-open SSH or copied admin credentials |

Read-only account results: **0 instances / 0 vCPUs used, quota 10 vCPUs**;
**0 static IPs, quota 5**; **0 buckets** in Ohio. These are account-specific values,
not the larger generic quota. Read-only `get-blueprints`, `get-bundles`,
`get-instances`, `get-static-ips`, `get-buckets`, `get-bucket-bundles` and
`service-quotas list-service-quotas` succeeded through the already open CloudShell.
That console has the owner's permissions; it is not the expired IAM-enforced
audit session. No administrator credentials were copied to the Mac and no IAM
permissions were changed. Recheck availability/quota immediately before creation.

**Base recurring total: $13/month**, approximately **$78 for six full months**.
This excludes tax, transfer/storage overage, optional snapshots, domain purchases,
and external OpenAI/phone costs. There is no load balancer, NAT gateway, managed
database, CDN, extra disk or paid support in this proposal. Stopping an instance
does not stop its charges. An unattached static IP can incur $0.005/hour after
one hour; attach it immediately and do not leave an abandoned allocation.

The Free plan and $100 unused credits were observed October 24. AWS lists Lightsail
as eligible for this account experience. Credits can cover eligible usage; this
is **not permanently free hosting** or a guaranteed maximum bill. The plan ends
**April 23, 2027** even though credit expiry is later. Do not assume the old
Lightsail three-month trial stacks with this plan. Review actual credit usage and
disk/bucket size after the first day and weekly; seek approval before increasing
resources or enabling optional services. Decide funding/continuity before expiry.

## Architecture and compatibility

Use the existing **Vue static build → Caddy → loopback Fastify → regional SQLite**
architecture, one Node writer. Pin Node **22.23.4**, pnpm **11.19.0** and Caddy
**2.11.7**, verify official artifact checksums, and install Linux **x64** artifacts
on this image. `node:sqlite` is built into Node; the lockfile contains the Linux
x64 esbuild/Rollup packages. Never copy Mac or ARM64 `node_modules` to Lightsail.
Keep `tsx` and migration sources; `pnpm install --prod` alone is insufficient.

The full application already passed on native Ubuntu 24.04 ARM64 with Node 22.
That proves Linux behavior, **not native execution or capacity on the x86 Lightsail
host**. On the approved new host, first verify `uname -m` (`x86_64`),
`node -p 'process.platform + "/" + process.arch'` (`linux/x64`), `node:sqlite`,
locked dependency installation, focused tests and build. Stop if they fail; do
not connect real providers or upgrade the plan to work around a failure. Two GB
is a synthetic staging candidate, not a verified concurrent-call capacity claim.

## HTTPS without buying a domain

The owner has no domain. Use **`https://<assigned-static-IPv4>`** for this synthetic
stage; no hostname or IP is invented here. Set both entries in `public.env.example`
to that exact assigned address. A future owned hostname is also supported, with
separately approved DNS changes.

`Caddyfile.example` explicitly selects Let's Encrypt's `shortlived` ACME profile,
then imports the existing AWS routes unchanged. Caddy's ordinary IP default would
use a local CA; this wrapper explicitly requests a publicly trusted certificate.
Let's Encrypt IP certificates last about **160 hours**, so automatic renewal is
essential. Caddy's persistent `/var/lib/caddy` storage, restart policy and boot
enablement must be verified. No browser trust-store changes or certificate-warning
bypasses are part of this plan. Starting Caddy for public issuance requires the
owner's approval for ACME registration/terms and disclosure of the public IP to
the CA and certificate-transparency logs.

Local `caddy adapt` and `caddy validate` pass; the adapted policy has only the
explicit public ACME issuer, no internal issuer. The HTTP route configuration is
identical to the existing template. **Public issuance, a trusted browser visit and
automatic renewal remain post-provisioning gates.** Do not call the URL ready
until these work. A custom domain is recommended before real business/Google
OAuth activation; an IP preview is not a verified Google redirect solution.

## File installation contract — only on the approved new host

Use an immutable, root-owned `/opt/yibo/releases/<exact-commit>` and a reviewed
`/opt/yibo/current` symlink. Build/install as an unprivileged build user; the runtime
user cannot modify source. Archive only reviewed tracked files, never `.env`, Mac
data, keys, recordings or `node_modules`. No source or secret is uploaded yet.

| Source / setting | Target / behavior |
| --- | --- |
| Existing `deploy/node/yibo-api.service.example` | `/etc/systemd/system/yibo-api.service`; dedicated `yibo-api` user, loopback 3000, restart-on-failure, `/var/lib/yibo` persistent and private |
| `yibo-api-staging.conf.example` | `/etc/systemd/system/yibo-api.service.d/20-staging.conf`; shared public origin plus fail-closed staging environment check |
| `staging.env.example` | `/etc/yibo/backend.env`, root:root 0600; create a fresh random session key privately, do not print it |
| `public.env.example` | `/etc/yibo/public.env`, root:root 0644; exact assigned IP/HTTPS origin; no secret values |
| Vendor Caddy service + `caddy-env.conf.example` | `/etc/systemd/system/caddy.service.d/20-yibo.conf`; explicit config path, restart-on-failure; `/usr/bin/caddy` must be the verified binary |
| `Caddyfile.example` and parent AWS template | Read from the immutable release, preserving the relative import; API cookies/Origin/path behavior unchanged |
| `ports.json` | Proposed complete ingress rules for **only the new staging instance**; applying `put-instance-public-ports` replaces that instance's rules |
| Existing `deploy/backup/yibo-backup.service.example` / timer | `/etc/systemd/system/yibo-backup.service` / `.timer`; enable timer only after an off-host restore succeeds |
| `backup.env.example` | `/etc/yibo/backup.env`, root:root 0600; exact deployed commit and explicit staging DB |

Create `/etc/yibo` root:`yibo-api` 0750. Make the restic repository/password files
root:`yibo-api` 0640 so the backup service can read them, while backend/backup env
files remain root-only (systemd reads them). Keep the restic encryption password
in the owner's separate recovery vault; losing it makes the backup unusable.
Keep Caddy's user/home and persistent storage as supplied by its official package.
Do not enable the `caddy-api` service or expose its administration port.

The staging guard requires `in-memory`, `tenant-yibo-demo-us`, US region,
`/var/lib/yibo/staging-us.sqlite`, its dedicated lock, recording/outbound off,
loopback binding and exact HTTPS origin. It rejects provider credential settings,
non-staging DBs and short/missing session keys without logging their values. It
does not prove ownership of an IP/domain; read back the actual Lightsail attachment.
The production source/business rules are not changed.

Only a synthetic owner and synthetic appointments go in this database. Use the
existing interactive `src/cli/create-admin.ts` with the staging environment loaded,
explicit tenant/region and an address such as `owner@example.test`. The owner
enters a fresh password privately in the TTY; do not reuse the old acceptance
password or print passwords in commands/logs. Do not use `pnpm admin:create`
blindly: its existing script loads `.env`. No production account/database is copied.

## Database durability and backups

- Keep SQLite, WAL and instance lock on the local persistent SSD under
  `/var/lib/yibo`, outside release directories. One API process owns this DB.
  Do not put a live SQLite file on S3, share it with the Mac, or use a second writer.
- Reuse the existing online snapshot → verify → encrypted restic upload job.
  Repository: `s3:https://s3.us-east-2.amazonaws.com/<approved-private-bucket>/yibo-staging`.
  The region is explicit; no AWS keys belong in the app environment.
- Lightsail resource access grants the instance full access to this dedicated
  same-region bucket without static keys. Restic's credential chain supports
  instance metadata, and its MinIO dependency supports IMDSv2. **Actual Lightsail
  authentication must still be tested** before the backup timer is enabled.
  Do not make the bucket public, weaken IMDSv2, or add administrator keys if it fails.
- First initialize the encrypted repository, run one backup, check the remote
  repository, restore to a fresh directory and run the existing backup verifier
  and isolated SQLite restore. Compare synthetic appointment data and owner login.
  Restore must never target the active DB. Preserve the exact release/schema SHA.
- Then enable the existing hourly timer (five-minute jitter, persistent catch-up).
  Target recovery point is about one hour plus jitter **when jobs succeed**;
  recovery time must be measured, not promised. Inspect failures and last-success
  age daily during staging. Keep logs private and review disk/5 GB bucket growth.
- Existing jobs do not prune snapshots or logs automatically. This is suitable
  for a small initial synthetic trial; approve and test retention before sustained
  business use. Do not silently delete backups. Backups share the AWS account and
  instance resource access; they are off-host, **not immutable/ransomware-proof**.
- Optional Lightsail daily snapshots retain seven but cost extra and are not a
  replacement for consistent application backup/restore. Automatic snapshots
  disappear when the source is deleted unless copied to manual snapshots first.

## Approval and execution order

1. Approve this exact $13/month base proposal, static-IP public HTTPS, restricted
   browser SSH, dedicated private backup bucket/resource access and synthetic-only
   setup. No plan upgrade, real-provider activation or production transition is
   included. Recheck credits, bundles and quota before any creation.
2. Create only the named staging instance, attach its static IP, read back the
   proposed ingress rules, and confirm the image/architecture. No DigitalOcean,
   Asterisk, SIP, Telnyx, 7001 or Tailscale connection changes.
3. Install verified Node/pnpm/Caddy/restic and the reviewed release. Run target
   dependency/SQLite/tests/build checks, prepare private files and synthetic owner.
   Verify merged units with `systemd-analyze verify` and Caddy with `caddy validate`.
4. Enable the API and Caddy on boot; verify trusted HTTPS, redirect, login/logout,
   origin/role/tenant isolation and synthetic create/reschedule/cancel. Public
   `/voice` and `/ari` remain blocked. No live Calendar event is created.
5. Verify service crash recovery and a controlled staging reboot, persisted
   appointments, fresh login and attached static IP. Admin sessions currently
   require re-login after process restart; stored accounts and appointments persist.
6. Prove encrypted off-host restore; then enable the backup timer. Verify first
   scheduled backup and public certificate renewal. Record resource identifiers
   privately and sanitized results in the repository. Stop/report any failure.
7. Obtain separate approval before real Google/OpenAI/phone/email activation.
   Existing hosted OAuth redirect validation and authenticated Voice Lab WSS gates
   remain in `docs/AWS_DEPLOYMENT.md`. This stage does not solve those by exposing
   the unauthenticated development Voice Lab or copying live credentials.

The host is a low-cost **single point of failure**. Keep the previous release;
code rollback is safe only with compatible DB schema. Never downgrade the DB or
overwrite it blindly. Stopping a failed staging service is reversible, but resource
deletion, paid upgrades or a production transition need separate approval.

## Checks completed before approval

- **37/37 focused tests** on Mac and native Linux ARM64/Node 22.23.4: ten new staging
  guard tests, nineteen existing backup/restore tests, eight bootstrap tests.
- Backend and frontend typechecks and production build pass on Linux/Node 22.
- Caddy 2.11.7 adaptation/validation passes on Mac and Linux, without issuance.
- Seven Linux configuration checks pass: unchanged HTTP routes, explicit shortlived
  issuer, no internal issuer, merged API/Caddy units, backup service/timer and
  restricted ingress. Unit checking used disposable file locations, not an installed
  AWS service. No live providers were contacted.
- Prior unchanged application baseline: **773 passed, one optional live test
  skipped**, plus 23 Linux HTTP/SQLite/voice/reboot checks. Not repeated needlessly.
- Still pending on the actual new host: native x86 execution, public certificate
  issuance/renewal, Lightsail network/IMDS-backed backup, off-host restore, reboot
  and browser acceptance. None can be reported as passed before provisioning.

## Primary references

- [Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html),
  [bucket pricing](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-buckets.html),
  [billing rules](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html).
- [Free-plan services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html),
  [Ubuntu blueprint](https://docs.aws.amazon.com/lightsail/latest/userguide/compare-options-choose-lightsail-instance-image.html),
  [blueprint's linked x86 Canonical image](https://aws.amazon.com/marketplace/pp/prodview-s4zvkzmlirbga).
- [Lightsail bucket resource access](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-bucket-resource-access.html),
  [automatic snapshots](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-automatic-snapshots.html),
  [ingress and browser SSH alias](https://docs.aws.amazon.com/cli/latest/reference/lightsail/put-instance-public-ports.html).
- [IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability),
  [ACME profiles](https://letsencrypt.org/docs/profiles/),
  [Caddy issuer configuration](https://caddyserver.com/docs/caddyfile/directives/tls#issuers).
- [Restic credential chain](https://github.com/restic/restic/blob/master/internal/backend/s3/s3.go),
  [MinIO IMDSv2 support](https://github.com/minio/minio-go/blob/master/pkg/credentials/iam_aws.go).
