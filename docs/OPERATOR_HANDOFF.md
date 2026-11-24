# ProcureDesk operator handoff

The project maintainer, **Niraj Mohabey**, owns code, release, and incident decisions. This handoff covers the current Sites application, Cloudflare D1 database, and operator-triggered vendor simulator. It is a portfolio sandbox. No outside customer or independent pilot operator has been onboarded, and no external pilot acceptance is claimed.

## Access and identity

Open [ProcureDesk](https://procuredesk-niraj.flowerycider4.chatgpt.site) and use **Sign in with ChatGPT**. The authenticated Site user is the true owner of an isolated sandbox. Atlas and Nova are separate demonstration organizations under that owner. Another visitor's ChatGPT account has a different sandbox.

The persona selector chooses a fictional member inside the signed-in owner's sandbox. It does not change the authenticated account, grant Site administration, or impersonate a real colleague. There is no production membership-provisioning workflow. Check the selected organization and persona before every mutation.

| Demo persona | Read access | Create, edit, and submit | Approve or reject | Dispatch, requeue, and receive | Reset sample data |
| --- | --- | --- | --- | --- | --- |
| Maya Chen, employee (`maya`) | Own requests and their activity; department budgets | Own drafts only | No | No | No |
| Alex Morgan, approver (`alex`) | Organization requests, budgets, activity, and dispatches | Own drafts only | Other people's submitted requests | Yes | No |
| Jordan Lee, finance (`jordan`) | Organization ledger, requests, activity, and dispatches | No | No | No | No |
| Niraj Mohabey, administrator (`admin`) | Organization requests, budgets, activity, and dispatches | Own drafts only | Other people's submitted requests | Yes | Yes, selected demo organization only |

The server enforces these permissions. No persona may approve or reject its own request. **Reset requires the Niraj administrator persona**; a visible button does not authorize Alex or Jordan to reset data. Budget and membership administration are seeded rather than an editable management interface.

## Normal purchase workflow

1. Select Maya and create a request with one item, a vendor, integer-cent USD amount, department, needed-by date, and business reason. Save the draft, review it, then submit. Only its requester may edit or submit it; submission freezes its commercial details.
2. Select Alex, open the submitted request, inspect the department's available funds, and approve or reject. Approval atomically reserves funds and creates one internal purchase order, dispatch job, and audit event. Rejection reserves nothing. If availability changed, refresh and review the budget conflict before attempting another decision.
3. Open Purchase orders and note the intended purchase-order number in **Order tracking** and **Dispatch queue**. Trigger **Dispatch next order**. Each invocation handles at most one eligible job, selected oldest first by creation time and job ID. An older seeded job may be processed first. Inspect the refreshed queue row for the matching purchase-order number and its delivery state/attempts; invoke dispatch again if that order is still pending. The normal UI does not display the action response's internal job ID.
4. Confirm that the intended queue row is **Delivered** and its order is **Dispatched to vendor**; a previously received order must remain received. Then simulate its receipt. The signed receipt moves that order's amount from reserved to spent once. Review the request timeline and department balances. These visible states are the operator check; independent counting of durable simulator acceptances is a maintainer verification described below.

The successful request states are `draft -> submitted -> approved -> ordered -> received`. A submitted request can instead become `rejected`. An approved order has no cancellation/refund flow in this release. A valid early receipt may move an approved request directly to `received`; a later dispatch acknowledgement must preserve that terminal state.

Dispatch does not run automatically while the application is closed. Recording a simulated receipt does not assert that real goods arrived. There are no outbound vendor purchases, payment transfers, external supplier messages, or autonomous worker processes.

## Dispatch recovery

Inspect the job in the correct organization before acting. The current dispatcher uses a **30-second lease** and allows **five attempts** before exhaustion. The deliberate crash control stops after durable vendor acceptance and before local acknowledgement; it leaves a leased job for recovery.

| Job condition | Operator action | Expected result |
| --- | --- | --- |
| `pending` | Note the purchase-order number, trigger dispatch, then inspect its queue row and order status. Account for older eligible jobs. | One eligible job is claimed and delivered, unless a simulated interruption occurs. |
| `leased`, lease still active | Wait for the lease deadline and refresh. Do not reset the fixture or try to force an active lease. | Requeue is denied while the lease is active. |
| `leased`, lease expired, fewer than five attempts | Trigger dispatch to reclaim it, or explicitly requeue then trigger dispatch. | A new lease token fences the old attempt. The original vendor order ID is reused. |
| `leased`, expired fifth attempt | Trigger dispatch and refresh. | The exhausted lease becomes a visible `failed` job; that invocation may handle a different eligible job. |
| `failed` | Preserve the evidence, then use the retry/requeue control if the failure is understood. **Trigger dispatch separately afterward.** | Requeue sets the same job to `pending`, clears its lease/error, and resets attempts to zero. Requeue alone performs no delivery. |
| `delivered` | Inspect the associated order and receipt state. | No dispatch retry is required. A received request remains received. |

**Ordinary UI verification:** after requeue, the matching purchase-order row must show **Pending**, attempts **0**, and no completed delivery; Order tracking must still show **Awaiting dispatch** unless the order was already received. Requeue must not change department reserved, spent, or available amounts. After a separate dispatch, check that purchase-order row for **Delivered** and the order for **Dispatched to vendor** or its preserved received state. If an older order was processed, the intended row remains pending; continue one attempt at a time and inspect the matching number. Do not infer a second vendor acceptance from an increased attempt count.

**Maintainer verification of vendor acceptance:** the ordinary UI does not display the simulator's durable acceptance count or internal job IDs. For a controlled recovery check, use the existing integration tests, or inspect the authenticated workspace API response in the browser's Network panel after a normal refresh (`GET /api/workspace?org=<selected organization>&actor=alex`, or the administrator persona). In that response, locate the matching `orderId` in `outbox` and `vendorOrders`; count only `vendorOrders` entries for that exact purchase order and retain a focused before/after record. A crash-after-acceptance fixture should have one acceptance before recovery and one afterward; a first successful dispatch changes zero to one. Match the outbox job's internal `id` only when investigating server/API evidence. Never copy cookies, authentication headers, signing secrets, or unrelated records into the handoff evidence.

A stale worker's acknowledgement must not overwrite a newer lease owner's work. That fencing property and the acceptance-count invariant are tested independently of the visible UI states. Five attempts and lease expiry are bounded simulator behavior, not a service-level availability promise.

If a dispatch response was lost, retry the identical operation with its original scoped idempotency key when available. A replay may report an accepted operation as pending if processing stopped before its completed response was saved. The outbox remains the recovery authority. Changing the input under the same key is a conflict; repeated clicking with new keys is not a substitute for checking the job.

## Reconcile the money

Use integer cents throughout; the UI formats those amounts as USD. For each department and fixture month:

```text
available_cents = limit_cents - reserved_cents - spent_cents
limit_cents >= reserved_cents + spent_cents
reserved_cents >= 0; spent_cents >= 0
```

Approval increases reserved by the request amount and reduces available by that amount. Dispatch, a crash, requeue, and dispatch acknowledgement must not move money. The first valid receipt decreases reserved and increases spent by the same amount, so available stays unchanged. A duplicate receipt must not move money again.

For a changed balance, trace the purchase order back to its request, department budget, approval audit event, and receipt. Confirm the frozen amount, currency, and organization agree. Treat rejected signatures, expired timestamps, unknown orders, amount/currency mismatches, and reused provider event IDs with changed payloads as rejected operations; they must leave accounting unchanged. Escalate an unexplained discrepancy rather than editing counters or resetting data.

## Evidence and escalation

Capture the following for the **project maintainer (Niraj Mohabey)** to review; this document does not send a message or open an incident automatically:

- UTC observation time, selected organization and demo persona, the action, and expected versus observed state.
- Request ID, purchase-order ID, dispatch-job ID, status, attempts, and lease deadline when present.
- HTTP correlation ID: the `X-Request-ID` response header, `traceId` on a successful action, or `requestId` on an error. A successful action's business `requestId` identifies the purchase request and is distinct from its `traceId`.
- Stable error code and a sanitized error message, plus before/after integer-cent balances. Include a screenshot or the relevant audit entries if useful.
- For maintainers using server logs, correlate the trace with organization, actor, operation, outcome, and duration. Avoid copying unrelated records.

Never attach authentication headers, session cookies, signing secrets, environment values, or full sensitive payloads. If refreshing does not resolve a state conflict, a rejected operation changes accounting, or a job cannot recover using the documented states, stop further mutations on that case and hand the evidence to the project maintainer role for investigation. There is no external support team or guaranteed response schedule.

## Release rollback and fixture reset

For an application regression, the project maintainer should identify the exact last verified **saved Site version**, confirm its source and schema compatibility with the current D1 database, and use the supported Sites deployment operation for that existing version. Preserve the Site's current audience and database binding. After deployment completes, verify the live version, sign-in, workspace reads, and a bounded workflow in a disposable sandbox.

Re-deploying an older application version is an application rollback; it does not reverse database migrations or restore data. Applied migration SQL and journal entries stay immutable. Do not revert a migration, erase D1, or replay old migration files to make an incompatible version run. If no saved version is compatible with the current schema, prepare and verify a forward fix. This handoff makes no tested backup-restoration claim.

**Reset demo is only a fixture tool.** The Niraj administrator persona can replace the selected owner's demo organization with its original sample requests, budgets, orders, activity, and idempotency history. Reset destroys that organization's demonstration changes. It is not dispatch recovery, reconciliation, rollback, or a backup restore, and it must not be used to hide a failing acceptance case.

For measured checks and their limits, see [verification evidence](VERIFICATION.md). This handoff describes the implemented sandbox; independent operator use and customer pilot acceptance remain unverified.
