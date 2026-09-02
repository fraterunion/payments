# Stripe Connect

How FraterUnion Payments creates and onboards Stripe connected accounts.

Last updated: 2026-09-02

Authoritative companion:
[`provider-account-connections.md`](./provider-account-connections.md).

## Decision

New connected accounts use **Accounts v2** (`/v2/core/accounts`).
Existing PaymentIntent execution stays on **v1**. Stripe documents that
v2 Accounts can be passed into v1 payment endpoints. There is no
PaymentIntents v2 migration.

Hosted onboarding uses **Account Links v2**
(`POST /v2/core/account_links`, `use_case.type = account_onboarding`).
Account Sessions are for embedded Connect components and are not used.
`@stripe/connect-js` is not installed.

FUP does not collect KYC, identity documents, or beneficial-owner
documents. Merchants complete Stripe-hosted onboarding.

## Merchant configuration

Create payload (V1):

- `display_name` — organization name
- `dashboard: full` — merchant retains Stripe Dashboard access
- `identity.country` — organization ISO country
- `identity.entity_type: company`
- `configuration.merchant.capabilities.card_payments.requested: true`
- `defaults.currency` — organization default currency
- `defaults.responsibilities.fees_collector: stripe`
- `defaults.responsibilities.losses_collector: stripe`
- `include`: `configuration.merchant`, `requirements`, `defaults`

No `customer` configuration (that would treat the connected account as a
customer). No `recipient` configuration (indirect charges / transfers).
No `application_fee_amount`, `transfer_data`, or destination charges.

Merchant configuration is the Accounts v2 persona for a connected account
that is merchant of record for **direct charges** later. Payouts are
observed from
`configuration.merchant.capabilities.stripe_balance.payouts.status`
after retrieve; Accounts v2 create does not expose a separate merchant
`stripe_balance.payouts` request field in the current SDK.

## Responsibilities and dashboard

Stripe sets `fees_collector` and `losses_collector` when merchant
configuration is first applied; they cannot be changed later.

`dashboard: express` requires `fees_collector = application` **and**
`losses_collector = application`. That would put fee collection and
negative-balance losses on FraterUnion. V1 therefore uses
`dashboard: full` with Stripe as fees and losses collector.

`requirements_collector` is computed by Stripe. The platform collects KYC
only when `losses_collector = application` and `dashboard = none`. FUP
does not take that path.

## Readiness mapping

Retrieve with `include: configuration.merchant, requirements, defaults`.

| FUP field         | Stripe fields                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `paymentsEnabled` | `configuration.merchant.capabilities.card_payments.status === 'active'`                                                                 |
| `payoutsEnabled`  | `configuration.merchant.capabilities.stripe_balance.payouts.status === 'active'`                                                        |
| `requirementsDue` | `requirements.summary.minimum_deadline.status` or any `requirements.entries[].minimum_deadline.status` is `currently_due` or `past_due` |
| `DISCONNECTED`    | `closed === true`                                                                                                                       |
| `ACTIVE`          | payments and payouts both enabled                                                                                                       |
| `REQUIRES_ACTION` | not ACTIVE and `requirementsDue`                                                                                                        |
| `RESTRICTED`      | not ACTIVE, not due, a required capability is `restricted`                                                                              |
| `PENDING`         | otherwise                                                                                                                               |

Unknown capability statuses are contract errors, not new FUP statuses.
`eventually_due` does not set `requirementsDue`. The full Stripe
requirements object is never persisted.

## Hosted onboarding

```json
{
  "account": "<acct_id>",
  "use_case": {
    "type": "account_onboarding",
    "account_onboarding": {
      "configurations": ["merchant"],
      "return_url": "<STRIPE_CONNECT_RETURN_URL>",
      "refresh_url": "<STRIPE_CONNECT_REFRESH_URL>"
    }
  }
}
```

Return/refresh URLs come from environment configuration only — never from
the request body. Production requires HTTPS. Local/test may use
`http://localhost`. Credentials in URLs are rejected.

The Account Link `url` is an execution credential:

- returned only on `POST .../onboarding-link`
- `Cache-Control: no-store`
- never persisted, audited, logged, or copied into metadata

Stripe supplies `expires_at` (RFC 3339). FUP does not invent expiry.

## Environment

Required only when `STRIPE_ENABLED=true`:

```text
STRIPE_SECRET_KEY
STRIPE_CONNECT_RETURN_URL
STRIPE_CONNECT_REFRESH_URL
```

Unrelated API startup stays green when Stripe is disabled. Test and
development refuse `sk_live_`. Keys are never printed, logged, or placed
in Swagger examples.

Pinned API version: `2026-08-26.dahlia` (stripe-node 22.6.1).

Stripe currently distinguishes some newer Sandbox functionality from
historical test mode (`sk_test_`). Connect v2 platform enablement must be
turned on in the Stripe Dashboard. If create returns
`accounts_v2_access_blocked`, `platform_registration_required`, or
`account_create_activation_required`, Connect is
`BLOCKED_STRIPE_CONNECT_PLATFORM_CONFIGURATION`.

Network integration tests use `STRIPE_TEST_SECRET_KEY` (`sk_test_` only)
and refuse live keys. They are skipped when that variable is unset.

## Isolation

Stripe SDK remains only in `packages/provider-stripe`.
`StripeConnectProvider` is separate from `StripePaymentProvider`.
`apps/api` depends on exported types/classes only.

## Not in this commit

- public Payment/Refund execution on the connected account
- application fees / destination charges / SCT
- disconnect / deauthorization
- webhooks
- embedded Connect components
- KYC document proxying
