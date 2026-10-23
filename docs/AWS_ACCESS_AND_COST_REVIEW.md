# AWS access and cost review — 23 October 2026

## Current state

The owner reports an active **Free plan, $100 credit balance, 183 days remaining,
and registered MFA**. This is owner-provided information, not an authenticated AWS
API check. The Mac has no AWS CLI, AWS config or credentials file. No AWS resources,
IAM identities, policies, access keys, DNS records or plan changes were created.
The reviewed integration branch remains `codex/launch-integration-reviewed`.

## First access step: inspect only

The owner should open the AWS account menu and identify whether the session is
root or an IAM user. Do not send passwords, MFA codes, access keys or login URLs
containing authorization codes. We will confirm the identity setup before creating
anything or attaching permissions.

Proposed connection, subject to owner approval of the exact IAM changes:

1. A dedicated non-root identity named `yibo-codex-audit`, with console access and
   its own MFA. If an appropriate restricted identity already exists, reuse it.
2. Grant only the EC2 inventory permissions in
   `deploy/aws/codex-audit-policy.example.json`, plus AWS's
   `SignInLocalDevelopmentAccess` policy for temporary browser-based CLI login.
   The example is **not applied**. It grants no deployment actions, database/object
   access, secrets retrieval, IAM administration or plan changes. `Resource: "*"`
   supports inventory APIs; the allowed actions remain explicitly enumerated.
   Adding it to an administrator does not restrict that administrator: use an
   identity with no broader attached/group permissions.
3. Install the official AWS CLI v2 locally (minimum 2.32.0), then use a named
   `yibo-audit` profile with `aws login`. The owner completes sign-in/MFA and reviews
   the CLI authorization. No long-lived access keys are needed; temporary sessions
   can refresh for up to 12 hours. Never use root for this Codex session.
4. Verify session identity and perform read-only EC2/network inventory. Keep
   credential caches outside the repository and don't print/export them. Keep
   Codex approval controls enabled; an AWS write remains separately unauthorized.
   End the session with `aws logout --profile yibo-audit` when finished.

AWS documentation: [temporary local login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html),
[SignInLocalDevelopmentAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SignInLocalDevelopmentAccess.html).

No suitable EC2/deployment plugin was found in the available plugin directory;
the available AWS analytics plugin does not serve this task. Use the official CLI.
Do not enable Organizations/Control Tower as a shortcut to authentication: some
account actions automatically upgrade the Free plan. The currently proposed IAM
connection does not require them.
[Free-plan transition rules](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

## Preliminary hosting estimate

Assumptions: Linux in **us-east-1 (N. Virginia)**, 730 running hours/month, one
instance, 20 GiB total gp3 storage at baseline performance, one public IPv4,
existing DNS provider/domain, and low initial traffic. This is a planning estimate,
not an approved resource selection or an AWS account-specific quote.

| Component | x86 baseline | Conditional ARM trial |
| --- | ---: | ---: |
| 2 GiB EC2 | t3.small: about $15.26/month | t4g.small: $0 compute during eligible 750-hour trial |
| 20 GiB gp3 | about $1.60/month | about $1.60/month |
| One public IPv4 | about $3.65/month | about $3.65/month |
| Base subtotal | about **$20.51/month** | about **$5.25/month** during trial |
| Initial allowance for small backups/monitoring/requests | $1–3/month planning reserve | $1–3/month planning reserve |
| Initial planning range | **$22–24/month** | **$6–8/month**, trial only |

Arithmetic uses AWS's current T3 product table ($0.0209/hour), gp3 storage planning
rate ($0.08/GiB-month), and public IPv4 ($0.005/hour). Confirm actual selected-region
rates and eligible discounts in AWS before launching. The reserve is our allowance,
not a quoted bundle or spending cap; storage churn, logs and transfer can exceed it.
[T3 rates](https://aws.amazon.com/ec2/instance-types/t3/),
[EBS pricing](https://aws.amazon.com/ebs/pricing/),
[IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

AWS currently states that new/existing customers receive **750 aggregate monthly
t4g.small hours until December 31, 2026 (UTC)** in eligible regions, including
N. Virginia. Only compute is covered; surplus CPU credits and other resources
remain separate. Verify the offer on this account and run Linux ARM validation
before selecting it. Its post-trial compute rate is **not yet verified here** and
must be included in the 183-day forecast before approval.
[T4g trial terms](https://aws.amazon.com/ec2/faqs/).

The x86 planning range uses $100 in roughly **4.2–4.5 months**, shorter than the
reported 183-day limit. The conditional ARM trial may extend that runway, but it
does not make the entire system free. Eligible usage can consume credits while
the Free plan remains active; do not upgrade it to continue automatically when
credits or time run out. AWS documents loss of access at Free-plan expiry.
[Account-plan limits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

These totals exclude domain registration, taxes, excess traffic/logs/backups and
burstable-CPU surcharges. Use Standard CPU-credit mode for the initial synthetic
evaluation to avoid surplus CPU charges, then evaluate throttling before voice
production. Do not silently trade real-call quality for a lower estimate. Existing
DigitalOcean, Telnyx and direct OpenAI costs are separate and not paid by AWS credits.
No NAT gateway, load balancer, managed database, reserved commitment or Spot instance
is proposed. Budget alerts should precede resource launch; they do not cap usage.

## Next gates

1. Identify the current AWS sign-in type; approve a narrowly scoped read-only
   identity setup if needed. Complete the CLI connection before provisioning.
2. Verify regional availability/account limits, the ARM trial and post-trial rate;
   obtain the approved domain and produce the final resource/cost proposal.
3. Obtain explicit approval for infrastructure, then start with synthetic data.
   Existing hosted OAuth, Voice Lab, backup and real-call gates remain in
   [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md). No production deployment is authorized.
