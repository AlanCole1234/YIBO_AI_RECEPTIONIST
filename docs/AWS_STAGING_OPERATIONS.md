# AWS staging operations: observed health and next approval

Read-only follow-up: **30 October 2026, 00:54 UTC** (29 October in Denver).
Applies only to the existing synthetic Lightsail staging host and private bucket.
No new resources, alarms, subscriptions, provider credentials or service changes
were made during this audit.

## Observed health

| Check | Observed result |
| --- | --- |
| Trusted HTTPS | Pass; dashboard and `/api/health` return 200 |
| Authentication boundary | Unauthenticated `/api/auth/me` returns 401 |
| Private routes | Public `/voice` and `/ari` return 404 |
| API / Caddy / backup timer | Active and enabled at boot; API/Caddy restart counters are zero since their current activation |
| Latest completed backup job | Success, 30 October 00:01:32 UTC |
| Actual encrypted remote repository | Readable using existing instance access; 25 regional snapshots; latest snapshot 00:01:30 UTC, about 53 minutes old at inspection |
| Capacity | 53.57 GiB free root disk, 1,440 MiB available memory; local snapshots/logs about 5.6 MiB |
| Bucket storage metric | Console reports 0.04 MB / 5 GB and 26 objects; this metric updates daily, so it is not a current per-object inventory |
| Caddy errors | 26 historical API connection-refused errors, last on 29 October at 03:13 UTC; none in the preceding six hours; no configuration change needed |
| Certificate | Initial issuance still served; valid until 4 November 17:52:47 UTC, about 137 hours remaining; natural renewal is not yet verified |
| AWS alarms / notification contacts | Both inventories empty in Ohio |
| Refreshed account console | Displays $100 credits and 177 Free-plan days, ending 23 April 2027; charges can post later |

The remote check listed snapshot metadata only. It did not restore over the live
staging database, prune backups, reveal the recovery key or inspect the owner's
Apple Note. The previously verified restore remains the restore evidence.

## Proposed native Lightsail alarms — not created

Use the existing Ohio instance and its existing private 5 GB backup bucket. Do
not create a CloudWatch custom metric, load balancer, extra server or SNS topic.
AWS states that Lightsail's monitoring/alerting feature has no additional charge;
use email only, avoiding possible carrier SMS charges. The approved base remains
$13/month, excluding existing tax/overage.
[AWS Lightsail monitoring FAQ](https://aws.amazon.com/lightsail/faq/).

| Alarm | Existing resource / metric | Proposed trigger |
| --- | --- | --- |
| `yibo-staging-status` | Instance / `StatusCheckFailed` | Greater than 0, one five-minute period |
| `yibo-staging-cpu` | Instance / `CPUUtilization` | At least 80%, three consecutive five-minute periods |
| `yibo-staging-backup-capacity` | Existing bucket / `BucketSizeBytes` | At least 4 GB in the console's gigabytes selector; evaluated once daily |

Use the metric's native statistic. Retain missing-data visibility rather than
reporting it as healthy. Notify on ALARM and recovery to OK; no automatic
restart, scaling, deletion or resource upgrade. Re-read existing alarms before
creation so an intervening operator change is not overwritten.
The bucket form explicitly confirms daily evaluation; do not apply instance
five-minute evaluation settings to that metric.

**Approval needed:** the owner must authorize the email recipient and subscribing
it to AWS Lightsail notifications in Ohio. This sends a verification email; the
owner must confirm the subscription privately. Then create the three reviewed
alarms, read back settings and test the notification without causing an outage.
Do not put the recipient's personal address or a subscription link in Git.
[Notification setup](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-adding-editing-notification-contacts.html),
[status alarm settings](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configure-status-check-alarms.html),
[bucket alarms](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-adding-bucket-metric-alarms.html).

## Coverage limits and manual staging checks

Native alarms do **not** verify application login, HTTPS certificate expiry,
backup success/freshness, local disk/memory or recovery-key custody. Automatic
service restarts are recovery behavior, not an external uptime monitor. The
checks below remain operator tasks until separately tested alerting exists.

- **Daily:** verify the dashboard's trusted HTTPS and `/api/health`; investigate
  a missing/failed response. Do not bypass certificate warnings.
- **Daily:** inspect `systemctl show yibo-backup.service -p Result
  -p ExecMainStatus -p ExecMainExitTimestamp` and the active backup timer. Treat a
  failed job or no completed off-host snapshot within two hours as an issue.
  A zero exit code alone is insufficient if the recorded timestamp is stale.
- **Daily during this short staging trial:** inspect free disk and local backup
  growth, and the bucket's storage metric. At 80% use, investigate before
  approving more storage or a tested retention policy. Never silently prune.
- **Certificate:** observe a later trusted certificate with a changed serial
  and later validity dates. Investigate if less than 48 hours remain without
  renewal. Initial expiry is **4 November 2026, 17:52:47 UTC**. No forced renewal
  or certificate deletion was performed, and no background reminder was created.
- **Weekly:** review posted credits, transfer and bucket usage; the Free-plan
  deadline is separate from any later credit expiry. Do not upgrade the plan
  or add paid resources without approval.

## Separate release gates

Natural renewal, notification delivery and the remaining monitoring gaps must
be explicit in any launch decision. Staging can continue synthetic testing.
An owned business hostname, hosted OAuth return-state support, separately
approved real Calendar authorization, authenticated hosted Voice Lab and a
private phone handover remain separate. No DigitalOcean/Asterisk/7001 changes
or real-provider activation are authorized by this operations checkpoint.
