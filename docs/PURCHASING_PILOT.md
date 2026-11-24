# Simulated purchasing pilot

**Status: internal AI-assisted exercise completed on November 23, 2026, America/New_York.** The six bounded cases below were recorded using the existing local application, UI observations, and persisted-state snapshots. The stakeholders are fictional roles, and the operator is the development agent. No outside participant, customer acceptance, human feedback, paid engagement, production purchasing, time savings, or business benefit has been established. An external stakeholder pilot remains pending. Audit timestamps use UTC, so the late-evening observations appear as November 24 in raw records.

## Problem, outcomes, and constraints

The simulated purchasing operator needs to request equipment, obtain another person's approval within a department budget, and explain what happens when dispatch stops after vendor acceptance. Finance needs to reconcile the resulting commitment without changing the purchase decision.

The three desired outcomes are:

1. An employee can submit a traceable request and another persona can approve its frozen amount without exceeding the department budget.
2. The operator can distinguish **queued**, **dispatched**, and **received**, recover interrupted delivery, and avoid a second vendor order.
3. Finance can inspect balances and the decision trail while server permissions prevent finance from purchasing or approving.

This is a USD, one-item, whole-receipt sandbox with seeded November 2026 budgets. Sites/Cloudflare D1, the existing interface, and the current simulator are retained. Dispatch processes one eligible job per operator action; requeue does not dispatch. There is no live supplier, autonomous delivery worker, real-company membership administration, payment, or measured manual-process baseline.

## Existing-system mapping

| Boundary | Current mapping |
| --- | --- |
| Real owner | Hosted Sites ChatGPT sign-in establishes the owner of an isolated sandbox. Fresh local observations in this packet use `local_seedy`, the loopback-only test identity; they do not independently verify hosted sign-in. |
| Organization | Atlas and Nova are separate demo organizations scoped beneath that owner. This exercise uses **Nova Labs**. Switching organizations does not switch the authenticated owner. |
| Persona | Maya requests; Alex approves another person's request and operates dispatch; Jordan inspects finance records without write authority. The selector chooses seeded demo permissions, not another real account. |
| Request | The employee's draft records item, supplier, integer-cent amount, department, and business reason. Submission freezes its commercial values. The accepted equipment request is display number `REQ-1043`, record key `REQ-FE3A159A`, and purchase order `PO-1043`. |
| Budget | The request binds to Nova's Engineering monthly budget. Approval reserves the amount; receipt transfers it from reserved to spent. Available equals limit minus reserved minus spent. |
| Outbox | Approval creates one purchase order and one durable dispatch job in the same transaction as its reservation. Delivery claims a 30-second lease; completion must match its current fencing token. |
| Simulated vendor | The purchase-order ID is the durable acceptance key. Acceptance can survive interruption before local acknowledgement. Both simulator sides use the application database. |
| Receipt | A timestamped raw-body HMAC, provider event ID, and payload hash validate the simulated receipt. A duplicate event cannot transfer funds twice, and later dispatch acknowledgement cannot regress `received`. |

No cookie, signing secret, authorization header, or private account data belongs in this packet.

## Immediate accounting snapshots

The Nova sandbox was not reset to hide existing activity. Immediately before `REQ-1043`, it already contained a prior unrelated approval. That commitment is retained in the baseline; this packet does not attribute that approval to a caller. The same 4,800,000-cent ($48,000.00) limit applies throughout.

| Immediate observation | Reserved cents | Spent cents | Available cents |
| --- | --- | --- | --- |
| Before `REQ-1043`; also after its submission | 354,000 ($3,540.00) | 320,000 ($3,200.00) | 4,126,000 ($41,260.00) |
| After Alex approved `REQ-1043` / `PO-1043` | 373,999 ($3,739.99) | 320,000 ($3,200.00) | 4,106,001 ($41,060.01) |
| Before and after the rejected approval attempt for `REQ-1044` | 373,999 ($3,739.99) | 320,000 ($3,200.00) | 4,106,001 ($41,060.01) |
| After dispatch and receipt of `PO-1043` | 354,000 ($3,540.00) | 339,999 ($3,399.99) | 4,106,001 ($41,060.01) |

Approval added exactly 19,999 cents to reserved and reduced available by that amount. Receipt moved those 19,999 cents from reserved to spent without changing available. Requeue and dispatch did not move funds. The recovery observation for seeded `PO-1039` occurred before `REQ-1043`; the case labels below group behaviors rather than assert chronological execution.

The existing crash-after-acceptance control was used for seeded `PO-1039`. Before the copy improvement, selecting **Retry** showed the toast **“Delivery retried safely.”**, while `JOB-1039` was `pending`, attempts were `0`, and the purchase remained approved / awaiting dispatch. The action had requeued the job rather than delivered it. See the [captured before state](pilot-evidence/before-requeue.jpg).

This is an observed mismatch between the message and the resulting state. It is simulated-operator evidence from the development agent, not a quotation or finding from an outside user.

## Fresh acceptance record

All six cases below were observed in the local Nova sandbox on November 23, 2026 ET. Their scope is the specific expected behavior and evidence stated, not independent stakeholder approval. The screenshots and current [integration TAP](pilot-evidence/integration.tap) are retained alongside this packet; the immediate ledger snapshots above summarize the captured server state.

| Case | Preconditions and action | Expected result | Observed outcome / evidence |
| --- | --- | --- | --- |
| P01: employee request | In Nova as Maya, create a $199.99 Engineering equipment draft, then submit it. | The request progresses from draft to submitted. Submission preserves the amount and department. Budget values remain at the immediate baseline. | **Passed.** `REQ-1043` / `REQ-FE3A159A`, “Pilot equipment request,” vendor Demo Supply, amount 19,999 cents, was created and submitted as Maya. Its business reason states that the exercise is simulated. Submission left reserved 354,000, spent 320,000, and available 4,126,000 cents. |
| P02: approval boundary | As Alex, review and approve P01. Inspect the request details and resulting order. | One order and one dispatch job exist, the reservation increases by 19,999 cents, and the submitted purchase values stay frozen. | **Passed.** `PO-1043` and pending `JOB-1043` appeared. Reserved was 373,999, spent 320,000, and available 4,106,001 cents. Request details showed the unchanged $199.99 amount, Engineering department, Maya requester, and “Submitted and approved request values are locked.” The audit recorded Alex's approval. |
| P03: requeue and dispatch | Use interrupted `JOB-1039` after lease expiry. Select **Queue for dispatch**, inspect the result, then separately select **Dispatch next order**. | Requeue alone leaves the job pending and order awaiting dispatch, with an accurate next-step message. Dispatch retains one vendor acceptance and does not move budget funds. | **Passed after correction.** The [after capture](pilot-evidence/after-requeue.jpg) shows “Job queued. Choose Dispatch next order to send it.” `JOB-1039` was pending with 0 attempts; `PO-1039` remained approved / awaiting dispatch. A separate dispatch completed the job with 1 attempt and changed the order to dispatched. Its durable vendor-order count stayed **1**, with no accounting movement. Compare the [before capture](pilot-evidence/before-requeue.jpg). |
| P04: insufficient budget | As Maya, submit a separate $99,999.00 Engineering request; as Alex, attempt approval. | Approval returns `BUDGET_EXCEEDED`; the request stays submitted, no order/job is created for it, and pre-attempt budget values remain unchanged. | **Passed.** `REQ-1044` / `REQ-981FCE0A`, “Pilot budget boundary,” amount 9,999,900 cents, remained submitted with no purchase order. The confirmation showed $41,060.01 available and the budget-exceeded error. Reserved 373,999, spent 320,000, and available 4,106,001 cents were unchanged. |
| P05: finance permission | Select Jordan in Nova and inspect the workspace and purchase-order controls. | Finance can inspect records without initiating purchases, dispatch, or receipt. Server authorization remains authoritative. | **Passed for the observed UI scope.** The finance view had **0 New request, 0 dispatch, and 0 receipt controls**. Direct server permission denials are separately covered by the current integration suite; this UI observation is not a substitute for those tests. |
| P06: fulfillment and failure replay | Dispatch eligible orders, record `PO-1043`'s receipt, and run the existing isolated Reliability lab and integration checks. | Dispatch identifies the actual eligible job; receipt moves 19,999 cents from reserved to spent once. Isolated failure checks report their own outcomes without changing Nova's ledger. | **Passed.** The older pending `PO-1031` dispatched before `PO-1043`, confirming queue order rather than per-row dispatch. `PO-1043` then dispatched and became **received**; its vendor-order count was **1**. Final reserved was 354,000, spent 339,999, and available 4,106,001 cents. The [fresh local lab replay](pilot-evidence/reliability-replay.jpg) reported **5/5**; the [current integration run](pilot-evidence/integration.tap) reported **16/16**, including duplicate/signed-receipt, tampering, crash, and fencing checks. |

## Feedback-to-change trace

| Stage | Record |
| --- | --- |
| Observed friction | The local development agent saw a delivery-complete-sounding Retry toast while the job was only pending. The before screenshot and queue state above are the evidence. |
| Bounded correction | The existing control is now labeled **Queue for dispatch** and its success message is **“Job queued. Choose Dispatch next order to send it.”** Existing Help content explains the recovery step. No dispatcher, schema, permission, or accounting behavior is changed by this copy correction. |
| Acceptance | P03 recorded the exact corrected message alongside the unchanged pending state, followed by a separate successful dispatch and one vendor order. The existing exhaustion/requeue regression was extended and the full current suite passed 16/16; no extra test was added to inflate the count. |
| External feedback | None collected. An independent operator's understanding and stakeholder acceptance remain unmeasured. |

## Earlier evidence, kept separate

The original release already recorded **16 integration tests passed**, including **25 fresh independent-connection approval-race fixtures within that suite**, plus five hosted Reliability lab checks. The earlier $199.99 browser journey and its balances are described in [VERIFICATION.md](VERIFICATION.md); they are distinct from the fresh Nova P01/P02 observations and the fresh **local** 5/5 lab replay above. The fresh 16/16 TAP was produced after the bounded update; it does not establish a new hosted CI result or hosted pilot.

[GitHub Actions run 45281320661](https://github.com/nirajmohabey/procuredesk/actions/runs/45281320661) passed installation, type checking, all 16 tests, and the production build on Ubuntu / Node 24.22.3 for commit `aa5360ffd7e3bbd63dcbdd1c6973c0e43df28673`. That historical result does not verify later source changes. New executions must record their own command, revision, result, and date.

Use the [operator handoff](OPERATOR_HANDOFF.md) for access, role boundaries, normal operation, requeue/dispatch recovery, escalation, and rollback limits. This packet records a completed, bounded **local simulated purchasing exercise**. Hosted sign-in for this updated flow, independent operator use, external stakeholder acceptance, real vendor integration, and business savings remain outside its evidence.
