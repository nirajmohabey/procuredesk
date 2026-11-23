# Architecture and operating notes

## Product boundary

ProcureDesk demonstrates the full purchase lifecycle using authenticated, owner-isolated workspaces and fictional users and suppliers. The visitor may select a predefined demo persona only inside that visitor's sandbox. This is distinct from assigning a production role to a real colleague.

The organization timezone is America/New_York, audit timestamps are UTC, and the initial fixture is November 2026. The initial budgets are deliberate fixtures rather than live company spending. A budget's period is part of the request's frozen accounting context; the sandbox is designed to remain demonstrable after its fixture month.

## Persistence and transaction design

Cloudflare D1 supplies SQLite semantics and atomic prepared-statement batches. Unlike the PostgreSQL proposal in the handbook, SQLite serializes writes. The critical decision must therefore occur in the write transaction, never in an earlier UI read. SQL triggers validate the transition, update the budget, and create dependent records. A CHECK constraint independently prevents negative balances or reserved plus spent exceeding the limit. Composite references retain organization context.

This choice makes the app runnable locally and hostable without database credentials. It is suitable for the bounded demonstration. It does not claim PostgreSQL lock ordering, PostgreSQL throughput, or general distributed exactly-once delivery.

Official reference: [D1 database batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/). API handlers apply authorization close to data access, consistent with [Next.js authorization guidance](https://nextjs.org/docs/app/guides/authentication).

## Identity and permissions

The hosting layer validates ChatGPT sign-in and injects the stable Site user identity. Application handlers reject absent identity and resolve demo organizations under that owner. Request payloads may select a predefined persona and organization; they cannot provide an arbitrary role or cross into another visitor's sandbox.

The local test adapter is supplied by the portable development starter on loopback only and excluded from the production build. Do not expose the local development server as a production service. Mutation routes require same-origin requests and a payload-bound idempotency key. JSON responses are private and uncached.

Employees create and edit their own drafts. Managers approve or reject submitted requests belonging to someone else. Finance reads the ledger. Administrators may reset the sandbox and operate the simulator. These permissions are checked on the server independently of visible controls.

## Delivery semantics

Approval commits the intent to dispatch alongside its reservation. Delivery claims an outbox lease, persists the vendor's acceptance under the internal order ID, then acknowledges only if its fencing token is still current. The simulator's accepted-order record survives a worker crash. Retrying the same order does not create a second accepted order.

The dispatcher runs on an explicit operator request. Pending jobs do not automatically run while the app is closed. A production extension should move the existing claim/deliver/acknowledge functions behind a queue or scheduled worker and retain the same fencing contract.

Receipt signatures bind the timestamp and exact raw bytes with HMAC-SHA256. The integration's server-side configuration determines the owner and organization; an untrusted body cannot choose the accounting tenant. Event ID plus payload hash distinguishes a duplicate from an ID collision. A received order stays received even if an earlier dispatch acknowledgment arrives later.

Request creation, submission, review, and simulated receipt store their successful idempotency result in the transaction with the business mutation. Dispatch first binds its key to an accepted operation, then performs delivery; the outbox and vendor order key own recovery if the process stops before the result is recorded. A replay may report that accepted operation while delivery remains pending. A sandbox reset deliberately begins a new fixture history and clears the old history of keys; the Reliability lab creates a fresh isolated experiment on each invocation.

## Operations

- **Readiness:** use the workspace API after authentication to exercise identity, schema, and database access. HTTP failure shows a Retry state in the app; it does not trigger destructive resets.
- **Pending dispatch:** inspect Purchase orders for queued or leased work. Let an active lease expire before reclaiming it. Never manually mark a job delivered without checking its vendor key.
- **Failed dispatch:** inspect the recorded failure and retry through the allowed operator action. The vendor key remains the order ID.
- **Budget investigation:** compare the displayed limit, reserved, and spent values with orders and the append-only activity timeline. Approval and receipt are the only normal accounting movements.
- **Local migrations:** build and run `npm run db:migrate`. Hosted migrations are applied by Sites before deployment. Applied migrations are immutable; append a migration for changes.
- **Reset:** the UI reset action replaces only the current visitor's demo data. Do not use it as a recovery procedure for real purchasing records.
- **Rollback:** deploy a prior compatible source version. A source rollback does not undo an applied migration or reverse business events.
- **Backup:** no backup restoration drill has been claimed. Before real deployment, export the hosted database, restore into a disposable environment, then verify an approval and a receipt against that restore.

## Known limitations

The app is single-currency, uses fictional membership, has no external vendor network, and uses request-driven dispatch. Local database tests verify the implementation against SQLite, not the complete hosted D1 infrastructure. Browser checks and native deployment status provide separate evidence. The Reliability lab is a small deterministic acceptance suite, not a load test or a broad security certification.
