# AWS synthetic staging validation

28 October 2026 deployment; owner access and recovery-key handoff followed up
29 October 2026.

## Deployed scope

The owner approved exactly one Ohio Lightsail `yibo-staging` instance
(`small_3_0`, Ubuntu 24.04, x86-64, 2 GB RAM / 2 vCPU / 60 GB), one attached static
IPv4, and one private `small_1_0` backup bucket. These resources now exist. Base
cost remains **$13/month** ($12 instance + $1 bucket), excluding tax/overage.
No optional snapshots, domain, load balancer, database service or extra instance.

Application release: `282f5c777d5780a66d9cccd36a3f908468d21fe0`, immutable under
`/opt/yibo/releases`, selected by `/opt/yibo/current`. Node 22.23.4, pnpm 11.19.0,
Caddy 2.11.7 and Ubuntu restic 0.16.4 are installed. Standard Ubuntu security
updates were applied; no Ubuntu release upgrade or Pro subscription was enabled.

Vue assets and Fastify share the assigned IP's trusted HTTPS origin. Fastify binds
only `127.0.0.1:3000`; Caddy administration is also loopback-only. Public ingress
is TCP 80/443; SSH is restricted to Lightsail browser-connect sources. There is
no public development voice server.

Database: `/var/lib/yibo/staging-us.sqlite`, tenant `tenant-yibo-demo-us`.
Runtime, Calendar and voice providers are synthetic; live provider readiness
correctly reports false. No existing `.env`, phone configuration, Google grant,
production database, customer data or AWS administrator key was copied.

## Deployment corrections

1. **Lightsail user-data shell:** the generated wrapper invoked the nested Bash
   installer with `/bin/sh`, failing at `set -o pipefail` before installation.
   The exact reviewed installer was extracted and SHA-256 verified, then invoked
   explicitly with `/bin/bash` through systemd. The AWS-generated SSH bootstrap
   wrapper was not rerun. Future user data must explicitly execute Bash; a nested
   shebang does not change the wrapper's interpreter.
2. **IP-address HTTPS:** issuance succeeded, but clients omitting SNI failed TLS.
   Explicit IP SNI passed certificate verification, reproducing certificate
   selection failure behind Lightsail's public/private address translation.
   The staging wrapper now sets `default_sni` to the configured public hostname/IP.
   Browsers and curl subsequently passed with normal certificate verification.
   No trust-store changes, internal CA or insecure TLS flags were used.

The installed correction is root-owned `/etc/caddy/yibo-staging.Caddyfile`,
importing the immutable release's original AWS routes by absolute path. The
staging Caddy service drop-in selects this file; its previous drop-in is preserved
privately. Application release contents were not edited. The repository wrapper
contains the equivalent fix for future releases.
[Caddy's documented behavior](https://caddyserver.com/docs/caddyfile/options#default_sni).

Reproduce/verify on staging with its actual assigned IP:

```sh
# Before: TLS internal error. After: verification OK.
openssl s_client -connect 127.0.0.1:443 -noservername \
  -verify_ip "$YIBO_PUBLIC_HOSTNAME" -verify_return_error -brief </dev/null
# Explicit -servername "$YIBO_PUBLIC_HOSTNAME" already passed before the fix.
curl --fail "https://$YIBO_PUBLIC_HOSTNAME/api/health"
```

## Results actually observed

| Check | Result |
| --- | --- |
| Native Linux x86 locked install and built-in SQLite | Pass; no copied Mac modules |
| Focused staging/backup/bootstrap suite | **37/37 on the actual Lightsail host**, also rerun locally |
| Backend/frontend typechecks and production build | Pass on Node 22 on the host, also rerun locally |
| Caddy and systemd validation | Pass before activation/reload |
| Synthetic HTTPS runtime acceptance | **17 checks passed** |
| Dashboard, hashed assets, SPA navigation | Pass; browser login screen renders normally |
| Login/logout and Secure/HttpOnly/SameSite cookie | Pass through deployed HTTPS with generated synthetic accounts |
| Owner's private password setup and manual browser login | Pass on 29 October; active owner account verified, office schedule and available slots visibly loaded |
| Invalid Origin, read-only mutation, tenant-selector rejection | Pass |
| Availability, booking, idempotent replay, double-booking rejection | Pass |
| Reschedule same synthetic event, cancel, event history | Pass; no Google request |
| API restart / forced failure | Automatic recovery; stored login, appointment and history survive |
| Caddy forced failure | Automatic recovery; trusted certificate retained |
| Full host reboot | API, Caddy and backup timer auto-start; HTTPS, login and history survive |
| HTTP redirect / TLS | Exact HTTPS redirect; trusted IP certificate without SNI |
| Private routes/ports | `/voice` and `/ari` 404; external TCP 3000/4317/5038/5060/2019 unreachable |
| Bucket access | Native Lightsail instance resource access; no static AWS keys |
| Encrypted upload / repository integrity | Pass against the actual private bucket |
| Off-host restoration | Fresh directories only; active DB untouched; restored appointment and password hash verified; approximately 2.34 seconds for this tiny fixture |
| Hourly persistent backup timer | Enabled after remote restore; first timer-triggered upload succeeded |

The runtime checks include local SQLite snapshot restore. Separate off-host tests
downloaded and verified the encrypted bucket data, restored SQLite and authenticated
the stored test account. Scripts, generated credentials and detailed logs remain
private on staging, outside the checkout/web root; do not commit them.
After validation, both generated acceptance accounts were deactivated, their
sessions cleared, and the updated staging database backed up. The owner account
uses a separate private password-entry step. Reboot checks also passed again after
installing the remaining standard AWS kernel security update.

Prior full validation remains **773 passed / 1 optional live test skipped** on
Linux ARM64. Application logic did not change, so the full suite was not repeated.
The focused suite and production build were rerun for this deployment checkpoint.

## Owner access and remaining gates

- **Owner access is complete:** on 29 October the owner privately created the
  separate synthetic `owner@example.test` account using the existing interactive
  admin CLI. A read-only database check confirmed its active owner role. A fresh
  encrypted off-host backup completed successfully afterward, and the owner's
  browser sign-in visibly reached the office schedule with available slots.
  The password was not read or copied into chat, code or documentation. This
  confirms staging access only; real providers remain disabled.
- **Recovery-key custody confirmed by the owner:** on 29 October the owner
  reported saving the existing restic recovery key and repository details in a
  locked Apple Note and closing the private terminal handoff. The agent did not
  inspect the note or read, record or commit the key. This is a manual custody
  confirmation, separate from the earlier successful off-host restore; a restore
  using the owner's saved copy has not been independently tested.
- **Read-only closeout check:** API, Caddy and the backup timer are active. The
  latest scheduled backup completed successfully at 17:04:32 UTC on 29 October;
  the root disk has 53.58 GiB free. Public HTTPS certificate verification and the
  dashboard/health endpoints pass; unauthenticated `/api/auth/me` returns 401 and
  `/voice` and `/ari` return 404. No configuration or application changes were
  needed for this check.
- **Natural certificate renewal:** issuance and persistence passed; observe the
  first renewal before the initial certificate expires on 4 November 2026 UTC.
- **Operations:** monitor backup freshness, disk and 5 GB bucket growth. Retention,
  backup-failure/application-uptime alerting, immutable backups and high availability
  remain future work. No backup was pruned or optional billable service enabled.
  The [operations follow-up](AWS_STAGING_OPERATIONS.md) confirms recent encrypted
  snapshots and healthy services. On 30 October, explicit owner approval was
  followed by three included Lightsail alarms and a verified email contact.
  CPU/status alarms are `OK`; bucket capacity remains `INSUFFICIENT_DATA` pending
  its daily metric. One native test notification completed `Succeeded`; the owner
  confirmed receiving that separate test email on 30 October. Public
  HTTPS/auth/private-route checks pass again. No application code changed.
- **Real providers:** hosted Google OAuth return-state validation, an owned
  business hostname, approved Calendar authorization, authenticated Voice Lab WSS
  and a reviewed private phone handover remain separate gates. DigitalOcean
  Asterisk is unchanged. This is not a paying-customer launch.

AWS Settings displayed **$100.00 credits and 178 Free-plan days** on 28 October,
ending 23 April 2027. Billing can post later; this does not mean running resources
cost zero. Recheck posted usage and monitor weekly. No plan upgrade or additional
resource is authorized by this checkpoint.
