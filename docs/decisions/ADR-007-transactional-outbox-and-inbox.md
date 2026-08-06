# ADR-007: Transactional outbox and inbox

## Status

Accepted

Last updated: 2026-08-06

## Context

Payment processing cannot depend on unreliable in-process event dispatch:
if a payment is committed to the database but the corresponding outgoing
event is only published via an in-memory call that fails after commit, the
event is lost with no recovery path. Symmetrically, provider webhooks (see
[`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#webhook-boundary))
can arrive duplicated, delayed, or out of order, and must be durably
captured before processing so a crash between receipt and processing does
not lose the event. In both directions, API/database success and message
delivery must not be allowed to diverge silently.

## Decision

- A transactional outbox is used for internal and outgoing events created
  alongside a state change: the state mutation and the outbox write occur
  in the same database transaction.
- A durable inbox is used for incoming provider events: events are
  persisted before asynchronous processing begins.
- Events are persisted before being processed asynchronously, in both
  directions.
- Delivery is at-least-once, not exactly-once, in both directions.
- Consumers and handlers on both sides (inbox processing, outbox delivery)
  must be idempotent.
- FraterUnion Payments does not claim exactly-once delivery anywhere in
  the system.

## Consequences

### Positive

- Reliable recovery: a crash or restart between a state change and event
  delivery does not lose the event, because the event was already durably
  persisted.
- A clear replay model: both inbox and outbox are durable logs that can be
  reprocessed if a downstream consumer or handler had a bug.
- API/database success and event publication cannot silently diverge,
  because the outbox write is part of the same transaction as the state
  change it represents.

### Negative

- Additional tables, background workers, and retention/cleanup policies
  are required compared to publishing events directly after commit.
- Duplicate delivery is an expected, permanent property of the system, not
  an edge case — every consumer must be built for it from the start.
- Added latency between a state change and external event delivery,
  since delivery happens asynchronously via the outbox rather than
  synchronously in the request path.

### Risks and mitigations

- **A consumer or handler is not actually idempotent, and a duplicate
  delivery causes a duplicate effect (for example, a duplicate ledger
  entry).** Mitigated by requiring idempotency as a hard requirement for
  every inbox/outbox consumer, validated by tests, not treated as
  optional hardening.
- **Events are processed out of order.** Mitigated by minimizing ordering
  assumptions in consumers and validating state transitions against the
  allowed-transition rules in
  [`../architecture/payment-lifecycle.md`](../architecture/payment-lifecycle.md#allowed-transitions)
  rather than assuming events arrive in causal order.
- **A poison event blocks processing of subsequent events indefinitely.**
  Mitigated by defining retry and dead-letter states for failed events
  (see [Implementation implications](#implementation-implications)),
  rather than retrying forever or blocking the queue.

## Alternatives considered

- **Publishing events directly after a database commit** (no outbox).
  Rejected — a failure between commit and publish loses the event with no
  recovery path, which is unacceptable for payment-related events.
- **In-memory events** (an in-process event emitter with no durability).
  Rejected — does not survive a process crash or restart, and provides no
  replay capability.
- **Queue-first writes** (publish to a queue before/without a database
  transaction guaranteeing the corresponding state change happened).
  Rejected — risks publishing an event for a state change that did not
  actually commit, or vice versa.
- **Distributed transactions** spanning the database and a message broker.
  Rejected as unnecessary complexity — the transactional outbox pattern
  achieves the same effective guarantee (state change and event creation
  are atomic) using only the existing database transaction.
- **Claiming exactly-once delivery.** Rejected as unrealistic for a system
  integrating with external webhooks and distributed workers; at-least-once
  delivery with mandatory idempotency is a more honest and robust
  guarantee.
- **Adopting Kafka (or a similar broker) from day one.** Rejected for the
  initial implementation as more operational complexity than the current
  scale warrants; a relational outbox/inbox is sufficient and keeps event
  durability inside the same database used for domain and ledger data.

## Implementation implications

- State mutations and their corresponding outbox writes must share one
  database transaction — never issued as two separate operations that
  could partially fail.
- Inbox records use a uniqueness key (the provider's event identifier) to
  prevent processing the same incoming event twice.
- Workers processing outbox/inbox entries use leases or equivalent safe
  locking to avoid two workers processing the same entry concurrently.
- Failed events have explicit retry and dead-letter states; they are not
  silently dropped or retried indefinitely.
- Ordering assumptions in consumers must be minimized; where order
  matters, it is enforced explicitly (for example, via the payment state
  machine's allowed transitions) rather than assumed from delivery order.
- Outbound webhook deliveries to consumer products are tracked separately
  from the internal outbox, so delivery status/retries to external
  recipients can be inspected independently (see
  [`../product/v1-scope.md`](../product/v1-scope.md#admin)).

## Revisit conditions

- Throughput or ordering requirements, demonstrated by real operational
  load, justify dedicated event infrastructure (for example, a message
  broker) beyond a relational outbox/inbox.
- Operational evidence specifically supports adopting Kafka or another
  broker for part or all of event delivery.
- Even after any such migration, idempotent consumption remains mandatory
  — this ADR's at-least-once framing is not expected to change even if the
  underlying transport does.
