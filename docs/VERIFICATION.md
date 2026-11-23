# Verification evidence

The recorded integration run on November 23, 2026 passed **16 tests, with 0 failures and 0 skipped tests**. The complete machine-readable output is in [test-results.txt](test-results.txt). These are local integration results, not a production load benchmark or a claim about other implementations.

## Reproduce

Install the committed dependencies, then run:

```sh
npm ci
npm test
```

To emit TAP instead of the terminal reporter:

```sh
node scripts/test.mjs --test-reporter=tap
```

The runner transpiles the actual `src/server/*.ts` modules into ignored `work/test-build/` files. It invokes Node's test runner against those modules. It does not copy the purchasing algorithm into the tests. Type checking and application builds are separate checks.

The recorded environment was Windows x64, Node v26.13.1, and SQLite 3.54.1. The project requires Node 24 or newer. CI configuration is provided separately; a configured workflow is not evidence of an executed CI run.

## What passed

| Case | Observed evidence |
| --- | --- |
| Competing approvals | **25 fresh fixtures**, each with a $100.00 budget and two submitted $70.00 requests. Two independent SQLite connections in separate worker threads were released by a shared-memory barrier. Every fixture produced one success, one `BUDGET_EXCEEDED`, one order, one outbox job, $70.00 reserved, and $30.00 available. |
| Same approval key | Concurrent matching retries created one reservation and one order. Successful responses identified the same result. Reusing the key for another request returned `IDEMPOTENCY_CONFLICT` and left that request submitted. |
| Different approval keys | Concurrent approvals of one request could not create a second order or reservation. |
| Tenant isolation | A known custom request ID could not be approved from another organization or authenticated owner's scope. Another owner's snapshot did not disclose the private request. |
| Authorization | Employee, finance, and invented personas could not approve. Self-approval failed. Other users could not edit an owned draft; finance could not create a request. Submitted purchase values stayed frozen. |
| Vendor recovery | The simulator durably accepted an order, then stopped before acknowledgement. Processing after the lease expired retained one vendor order and completed dispatch. |
| Duplicate early receipts | Two independent connections delivered the same signed receipt before dispatch acknowledgement. One event was stored, reserved became $0.00, and spent became $70.00. Later dispatch acknowledgement preserved `received`. |
| Receipt validation | Altered HMAC, expired timestamp, unknown order, wrong currency, incorrect amount, and changed payload under an existing provider event ID were rejected. Invalid events did not move funds. |
| Money validation | Zero, negative, fractional, and out-of-range integer-cent inputs were rejected before creating a request. |
| Date validation | The impossible date `2026-02-31` was rejected. |
| Approval crash boundaries | A separate OS process exited abruptly after executing approval statements but before COMMIT: no reservation/order survived. A second process exited after COMMIT but before returning a result: retrying the same key returned the durable purchase without a second reservation/order. |
| Lease fencing | A controlled clock expired a lease; a new token reclaimed it. The new owner completed, then the old owner resumed. The stale acknowledgement returned false and could not alter the delivered job or received order. |
| Retry exhaustion | Five simulated crash-after-accept attempts followed by lease expiry produced an operator-visible failed job and one vendor order. |
| Receive key collision | Two connections reused one retry key for different orders. One receipt committed; the conflicting operation returned `IDEMPOTENCY_CONFLICT` with its accounting effects rolled back. |
| Dispatch key collision | Two connections reused one retry key with different dispatch inputs. One operation contacted one vendor order; the conflicting operation did not claim another job. |
| Database safeguards | Direct attempts to overspend a budget or make spent funds negative failed CHECK constraints and left balances unchanged. |

## Implementation and evidence boundaries

The handbook proposes PostgreSQL row locking and a separately supervised worker. This release deliberately uses **Cloudflare D1/SQLite**, with conditional SQL, atomic D1 batches, budget CHECK constraints, tenant-scoped composite foreign keys, and database triggers. The local adapter uses real SQLite, `BEGIN IMMEDIATE` for each atomic batch, WAL, and independent connections. These results establish the tested SQLite behavior. They do not establish PostgreSQL isolation behavior, D1 replica behavior, hosted concurrency performance, or a broad security certification.

The hosted application uses Sites' ChatGPT sign-in and owner-isolated demo workspaces. The named employee, approver, finance, and administrator are selectable **demo personas inside that owner's sandbox**. Persona switching is not a membership-management system for a real shared company. Atlas and Nova are seeded demonstration organizations; the budget period is November 2026.

The vendor and fulfillment events are simulators. No purchase, email, bank transfer, external vendor integration, or automatic fulfillment occurs. Dispatch processing is initiated from the application rather than a continuously running external worker. The vendor's accepted-order table is durable, but both sides of this simulator reside in the application's database; this is not proof of a real vendor's idempotency contract.

Dispatch first persists an accepted operation key before contacting the simulator. If processing stops before its completed response is persisted, replay may report the accepted operation as pending. The outbox is the recovery authority; an operator can process again after lease expiry. That is an intentional recovery contract, not an end-to-end exactly-once guarantee.

The pre/post-COMMIT tests terminate a child process at instrumented boundaries inside the actual database adapter. They do not simulate a host power failure. The crash-after-vendor-acceptance and lease-expiry tests use explicit simulator controls and a controlled clock. Browser usability, hosted authentication, deployment status, backup restoration, and real network failures require their own evidence. No backup-restore or live external-vendor claim is made by this report.

The built-in reliability lab runs fresh, isolated database fixtures using the same triggers and dispatch/receipt services. Its interactive result is useful for inspection; the separate-connection and forced-process-exit evidence is the integration suite above.

## Application and browser verification

Final `npm run typecheck` and the Sites production build both completed successfully on November 23, 2026. The generated Worker contains the workspace, actions, signed-receipt, and health routes. Local D1 migrations applied successfully through `npm run db:migrate`; an authenticated workspace seeded and served real persisted records.

Browser checks used the local Vinext development server with its loopback-only identity adapter:

- Signed in, selected Maya, entered an invalid fractional-cent amount, and confirmed that the error preserved the form contents.
- Created a $199.99 equipment draft (`REQ-1043`), submitted it, selected Alex, reviewed the confirmation, and approved with keyboard Enter.
- Observed Engineering available funds change from $43,360.00 to $43,160.01, with one new purchase order and an audit event.
- Dispatched the simulated order and recorded its receipt. The order became `received`; Engineering spent became $3,399.99 and available remained $43,160.01.
- Ran the interactive Reliability lab: **5 / 5 passed** using local D1, including competing approvals, crash recovery, duplicate receipt, organization-scoped lookup, and signature rejection.
- Searched for the acceptance request and exported CSV. The download contained the single matching received request with amount $199.99.
- Checked the phone breakpoint at 390 × 844: body text 16px, task statuses 14px, and lab descriptions 16px. The closed mobile drawer is hidden from assistive technology and inert. Escape closes dialogs. Tables scroll inside their panel; document scroll width equals its available client width (375px after the vertical scrollbar), with no page-level horizontal overflow.
- Inspected the fresh browser tab's error log after the completed workflow: no JavaScript errors were recorded. A development-only late dependency optimization problem found earlier was repaired by prebundling the client React/Lucide dependencies together.

Screenshots are retained under `docs/screenshots/`. These browser results do not imply a complete accessibility audit. Hosted identity and deployment are separate from the local test identity; publication status is recorded in the external release receipt.
