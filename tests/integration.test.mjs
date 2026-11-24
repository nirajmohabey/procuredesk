import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SQLiteD1 } from './d1-adapter.mjs';
import { runRace } from './helpers.mjs';
import * as service from '../work/test-build/service.mjs';

const root = resolve('.');
const servicePath = join(root, 'work', 'test-build', 'service.mjs');
const directory = await mkdtemp(join(root, 'work', 'integration-'));
const migrations = await Promise.all((await readdir(join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort().map(name => readFile(join(root, 'drizzle', name), 'utf8')));
let fixtureCount = 0;
const databases = [];
after(async () => {
  for (const db of databases) db.close();
  await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const path = join(directory, `test-${++fixtureCount}.sqlite`);
  const db = new SQLiteD1(path);
  databases.push(db);
  for (const migration of migrations) await db.exec(migration);
  const owner = `test-owner-${fixtureCount}`;
  const org = 'atlas';
  await service.ensureWorkspace(db, owner, org);
  const scope = await service.scopeFor(owner, org);
  await db.prepare('DELETE FROM requests WHERE scope=?').bind(scope).run();
  await db.prepare('DELETE FROM audit WHERE scope=?').bind(scope).run();
  await db.prepare('DELETE FROM idempotency WHERE scope=?').bind(scope).run();
  await db.prepare('UPDATE budgets SET reserved_cents=0, spent_cents=0, limit_cents=10000 WHERE scope=?').bind(scope).run();
  const budget = await db.prepare("SELECT * FROM budgets WHERE scope=? AND department='Engineering'").bind(scope).first();
  assert.ok(budget, 'seed includes Engineering budget');
  return { db, path, owner, org, scope, budget };
}

let keyCount = 0;
const key = () => `test-key-${++keyCount}`;
async function action(f, actionName, fields = {}, actor = 'maya', idempotencyKey = key()) {
  return service.executeAction(f.db, f.owner, { action: actionName, actor, org: f.org, ...fields }, idempotencyKey);
}
async function submitted(f, { amountCents = 7000, actor = 'maya', title = 'Test purchase' } = {}) {
  const result = await action(f, 'create', { title, vendor: 'Test vendor', amountCents, department: 'Engineering', category: 'Equipment', neededBy: '2026-11-30', description: 'A deterministic integration test purchase.' }, actor);
  const requestId = result.requestId;
  assert.ok(requestId, JSON.stringify(result));
  await action(f, 'submit', { requestId }, actor);
  return requestId;
}
async function approved(f, options = {}) {
  const requestId = await submitted(f, options);
  const result = await action(f, 'approve', { requestId }, 'alex');
  const order = await f.db.prepare('SELECT * FROM purchase_orders WHERE scope=? AND request_id=?').bind(f.scope, requestId).first();
  assert.ok(order);
  return { requestId, orderId: order.id, result };
}
async function budget(f) { return f.db.prepare('SELECT * FROM budgets WHERE scope=? AND id=?').bind(f.scope, f.budget.id).first(); }
async function count(f, table) { return (await f.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE scope=?`).bind(f.scope).first()).n; }
async function rejection(promise, acceptedCodes) {
  try { await promise; assert.fail('Expected operation rejection'); }
  catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.ok(acceptedCodes.includes(error.code), `Expected ${acceptedCodes.join('/')} but got ${error.code}: ${error.message}`);
    return error;
  }
}
async function receipt(f, orderId, overrides = {}, options = {}) {
  const secret = (await f.db.prepare('SELECT secret FROM workspaces WHERE scope=?').bind(f.scope).first()).secret;
  const body = { eventId: 'evt-test-1', orderId, amountCents: 7000, currency: 'USD', ...overrides };
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = options.signature ?? await service.signReceipt(secret, raw, timestamp);
  return { raw, timestamp, signature, args: [f.scope, raw, timestamp, signature] };
}

test('T01: 25 independent-connection races preserve the $100 budget', async () => {
  for (let repetition = 0; repetition < 25; repetition++) {
    const f = await fixture();
    const requests = await Promise.all([submitted(f, { title: 'First competing purchase' }), submitted(f, { title: 'Second competing purchase' })]);
    const outcomes = await runRace(f.path, servicePath, requests.map(requestId => [f.owner, { action: 'approve', actor: 'alex', org: f.org, requestId }, key()]));
    assert.equal(outcomes.filter(item => item.ok).length, 1, JSON.stringify(outcomes));
    assert.equal(outcomes.find(item => !item.ok).error.code, 'BUDGET_EXCEEDED');
    const values = await budget(f);
    assert.equal(values.limit_cents, 10000);
    assert.equal(values.reserved_cents, 7000);
    assert.equal(values.spent_cents, 0);
    assert.equal(values.limit_cents - values.reserved_cents - values.spent_cents, 3000);
    assert.equal(await count(f, 'purchase_orders'), 1);
    assert.equal(await count(f, 'outbox'), 1);
  }
});

test('T02/T03: concurrent approval retries create one order and bind keys to inputs', async () => {
  const f = await fixture();
  const requestId = await submitted(f);
  const idempotencyKey = key();
  const args = [f.owner, { action: 'approve', actor: 'alex', org: f.org, requestId }, idempotencyKey];
  const outcomes = await runRace(f.path, servicePath, [args, args]);
  assert.equal(outcomes.filter(item => item.ok).length, 2, JSON.stringify(outcomes));
  const { replayed: _firstReplay, ...firstValue } = outcomes[0].value;
  const { replayed: _secondReplay, ...secondValue } = outcomes[1].value;
  assert.deepEqual(firstValue, secondValue);
  assert.equal(await count(f, 'purchase_orders'), 1);
  assert.equal((await budget(f)).reserved_cents, 7000);
  const otherRequestId = await submitted(f, { amountCents: 1000 });
  await rejection(action(f, 'approve', { requestId: otherRequestId }, 'alex', idempotencyKey), ['IDEMPOTENCY_CONFLICT']);
  assert.equal((await f.db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope, otherRequestId).first()).status, 'submitted');
});

test('T02: different concurrent approval keys cannot reserve twice', async () => {
  const f = await fixture();
  const requestId = await submitted(f);
  const outcomes = await runRace(f.path, servicePath, [key(), key()].map(idempotencyKey => [f.owner, { action: 'approve', actor: 'alex', org: f.org, requestId }, idempotencyKey]));
  assert.ok(outcomes.some(item => item.ok));
  assert.equal(await count(f, 'purchase_orders'), 1);
  assert.equal((await budget(f)).reserved_cents, 7000);
});

test('T04: known request IDs cannot cross organizations or authenticated owners', async () => {
  const f = await fixture();
  const requestId = await submitted(f, { title: 'Private Atlas record' });
  await service.ensureWorkspace(f.db, f.owner, 'nova');
  await rejection(service.executeAction(f.db, f.owner, { action: 'approve', actor: 'alex', org: 'nova', requestId }, key()), ['NOT_FOUND']);
  await service.ensureWorkspace(f.db, 'other-authenticated-owner', 'atlas');
  await rejection(service.executeAction(f.db, 'other-authenticated-owner', { action: 'approve', actor: 'alex', org: 'atlas', requestId }, key()), ['NOT_FOUND']);
  const snapshot = await service.snapshot(f.db, 'other-authenticated-owner', 'atlas', 'alex');
  assert.ok(!snapshot.requests.some(item => item.title === 'Private Atlas record'));
  assert.equal((await budget(f)).reserved_cents, 0);
});

test('T05: roles, draft ownership, and separation of duties are enforced server-side', async () => {
  const f = await fixture();
  const requestId = await submitted(f);
  await rejection(action(f, 'approve', { requestId }, 'maya'), ['FORBIDDEN']);
  await rejection(action(f, 'approve', { requestId }, 'jordan'), ['FORBIDDEN']);
  await rejection(action(f, 'approve', { requestId }, 'invented-admin'), ['FORBIDDEN', 'INVALID_ACTOR']);
  const ownRequest = await submitted(f, { actor: 'alex', amountCents: 1000 });
  await rejection(action(f, 'approve', { requestId: ownRequest }, 'alex'), ['SELF_APPROVAL']);
  const draftInput = { title: 'Owned draft', vendor: 'Test vendor', amountCents: 1000, department: 'Engineering', category: 'Equipment', neededBy: '2026-11-30', description: 'A draft that belongs to the administrator persona.' };
  const otherDraft = await action(f, 'create', draftInput, 'admin');
  await rejection(action(f, 'update', { ...draftInput, requestId: otherDraft.requestId }, 'alex'), ['FORBIDDEN']);
  await rejection(action(f, 'update', { ...draftInput, requestId: otherDraft.requestId }, 'maya'), ['NOT_FOUND']);
  await rejection(action(f, 'create', draftInput, 'jordan'), ['FORBIDDEN']);
  await rejection(action(f, 'update', { requestId, title: 'Changed after submission', vendor: 'Test vendor', amountCents: 7000, department: 'Engineering', category: 'Equipment', neededBy: '2026-11-30', description: 'This edit should be rejected after submission.' }, 'maya'), ['REQUEST_IMMUTABLE']);
  assert.equal((await budget(f)).reserved_cents, 0);
});

test('T06: a crash after vendor acceptance retries one persistent vendor order', async () => {
  const f = await fixture();
  const { orderId } = await approved(f);
  const now = Date.now();
  await service.processDispatch(f.db, f.scope, { crashAfterAccept: true, nowMs: now });
  assert.equal(await count(f, 'vendor_orders'), 1);
  await service.processDispatch(f.db, f.scope, { nowMs: now + 120000 });
  assert.equal(await count(f, 'vendor_orders'), 1);
  assert.equal((await f.db.prepare('SELECT status FROM purchase_orders WHERE scope=? AND id=?').bind(f.scope, orderId).first()).status, 'dispatched');
  assert.equal((await f.db.prepare('SELECT status FROM outbox WHERE scope=? AND order_id=?').bind(f.scope, orderId).first()).status, 'delivered');
});

test('T07/T08: concurrent duplicate early receipts transfer funds once and cannot regress', async () => {
  const f = await fixture();
  const { requestId, orderId } = await approved(f);
  const r = await receipt(f, orderId);
  const outcomes = await runRace(f.path, servicePath, [r.args, r.args], { receipt: true });
  assert.equal(outcomes.filter(item => item.ok).length, 2, JSON.stringify(outcomes));
  assert.equal(await count(f, 'receipts'), 1);
  assert.equal((await budget(f)).reserved_cents, 0);
  assert.equal((await budget(f)).spent_cents, 7000);
  await service.processDispatch(f.db, f.scope, {});
  assert.equal((await f.db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope, requestId).first()).status, 'received');
  assert.equal((await f.db.prepare('SELECT status FROM purchase_orders WHERE scope=? AND id=?').bind(f.scope, orderId).first()).status, 'received');
});

test('T09/T13: receipt validation rejects tampering and event collisions without ledger changes', async () => {
  const f = await fixture();
  const { orderId } = await approved(f);
  const invalidSignature = await receipt(f, orderId, {}, { signature: '00'.repeat(32) });
  await rejection(service.handleReceipt(f.db, ...invalidSignature.args), ['WEBHOOK_SIGNATURE_INVALID']);
  const expired = await receipt(f, orderId, {}, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
  await rejection(service.handleReceipt(f.db, ...expired.args), ['EXPIRED_TIMESTAMP', 'WEBHOOK_EXPIRED']);
  const unknown = await receipt(f, 'unknown-order');
  await rejection(service.handleReceipt(f.db, ...unknown.args), ['NOT_FOUND', 'ORDER_NOT_FOUND']);
  const currency = await receipt(f, orderId, { currency: 'EUR' });
  await rejection(service.handleReceipt(f.db, ...currency.args), ['CURRENCY_MISMATCH']);
  const amount = await receipt(f, orderId, { amountCents: 6999 });
  await rejection(service.handleReceipt(f.db, ...amount.args), ['AMOUNT_MISMATCH', 'RECEIPT_MISMATCH']);
  assert.equal(await count(f, 'receipts'), 0);
  assert.equal((await budget(f)).reserved_cents, 7000);
  assert.equal((await budget(f)).spent_cents, 0);
  const valid = await receipt(f, orderId);
  await service.handleReceipt(f.db, ...valid.args);
  const changed = await receipt(f, orderId, { amountCents: 6999 });
  await rejection(service.handleReceipt(f.db, ...changed.args), ['EVENT_CONFLICT', 'RECEIPT_CONFLICT']);
  assert.equal(await count(f, 'receipts'), 1);
  assert.equal((await budget(f)).spent_cents, 7000);
});

test('integer money validation rejects invalid inputs before creating a request', async () => {
  const f = await fixture();
  for (const amountCents of [0, -1, 70.5, Number.MAX_SAFE_INTEGER]) {
    await rejection(action(f, 'create', { title: 'Invalid amount', vendor: 'Vendor', amountCents, department: 'Engineering', category: 'Equipment', neededBy: '2026-11-30', description: 'Invalid amount test' }), ['VALIDATION_ERROR', 'INVALID_INPUT']);
  }
  assert.equal(await count(f, 'requests'), 0);
});

test('calendar date validation rejects impossible dates', async () => {
  const f = await fixture();
  await rejection(action(f, 'create', { title: 'Invalid date', vendor: 'Vendor', amountCents: 7000, department: 'Engineering', category: 'Equipment', neededBy: '2026-02-31', description: 'An impossible calendar date must be rejected.' }), ['VALIDATION_ERROR']);
  assert.equal(await count(f, 'requests'), 0);
});

test('T10: abrupt process loss before COMMIT rolls back; loss after COMMIT replays', async () => {
  for (const boundary of ['beforeCommit', 'afterCommit']) {
    const f = await fixture();
    const requestId = await submitted(f);
    const idempotencyKey = key();
    const body = { action: 'approve', actor: 'alex', org: f.org, requestId };
    const processResult = spawnSync(process.execPath, [join(root, 'tests', 'crash-worker.mjs')], {
      input: JSON.stringify({ serviceUrl: pathToFileURL(servicePath).href, path: f.path, owner: f.owner, body, key: idempotencyKey, boundary }),
      encoding: 'utf8', timeout: 20000,
    });
    assert.equal(processResult.status, boundary === 'beforeCommit' ? 88 : 89, processResult.stderr);
    assert.equal((await budget(f)).reserved_cents, boundary === 'beforeCommit' ? 0 : 7000);
    assert.equal(await count(f, 'purchase_orders'), boundary === 'beforeCommit' ? 0 : 1);
    await service.executeAction(f.db, f.owner, body, idempotencyKey);
    assert.equal((await budget(f)).reserved_cents, 7000);
    assert.equal(await count(f, 'purchase_orders'), 1);
    assert.equal(await count(f, 'outbox'), 1);
  }
});

test('T12: an expired dispatch lease can be reclaimed and the stale owner is fenced', async () => {
  const f = await fixture();
  const { requestId, orderId } = await approved(f);
  const now = Date.now();
  const firstLease = await service.claimDispatch(f.db, f.scope, now);
  assert.ok(firstLease);
  const secondLease = await service.claimDispatch(f.db, f.scope, now + 31000);
  assert.ok(secondLease);
  assert.notEqual(firstLease.leaseToken, secondLease.leaseToken);
  await f.db.prepare('INSERT INTO vendor_orders(scope,order_id,amount_cents,accepted_at) VALUES(?,?,?,?)').bind(f.scope, orderId, 7000, new Date(now + 31000).toISOString()).run();
  await service.acknowledgeDispatch(f.db, f.scope, secondLease.id, secondLease.leaseToken, now + 32000);
  const r = await receipt(f, orderId);
  await service.handleReceipt(f.db, ...r.args);
  const staleAcknowledgement = await service.acknowledgeDispatch(f.db, f.scope, firstLease.id, firstLease.leaseToken, now + 33000);
  assert.equal(staleAcknowledgement.acknowledged, false);
  const job = await f.db.prepare('SELECT * FROM outbox WHERE scope=? AND id=?').bind(f.scope, secondLease.id).first();
  assert.equal(job.status, 'delivered');
  assert.equal(job.attempts, 2);
  assert.equal(job.lease_token, null);
  assert.equal((await f.db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope, requestId).first()).status, 'received');
  assert.equal((await budget(f)).reserved_cents, 0);
  assert.equal((await budget(f)).spent_cents, 7000);
});

test('exhausted dispatch can be requeued without delivery, then dispatched once', async () => {
  const f = await fixture();
  const { requestId, orderId } = await approved(f);
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    await service.processDispatch(f.db, f.scope, { crashAfterAccept: true, nowMs: now + attempt * 31000 });
  }
  await service.processDispatch(f.db, f.scope, { nowMs: now + 5 * 31000 });
  const job = await f.db.prepare('SELECT * FROM outbox WHERE scope=? AND order_id=?').bind(f.scope, orderId).first();
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 5);
  assert.equal(await count(f, 'vendor_orders'), 1);

  const requestBeforeRetry = await f.db.prepare('SELECT * FROM requests WHERE scope=? AND id=?').bind(f.scope, requestId).first();
  const orderBeforeRetry = await f.db.prepare('SELECT * FROM purchase_orders WHERE scope=? AND id=?').bind(f.scope, orderId).first();
  const budgetBeforeRetry = await budget(f);
  const vendorOrdersBeforeRetry = await count(f, 'vendor_orders');
  const requeued = await action(f, 'retry', { jobId: job.id }, 'alex');
  assert.equal(requeued.ok, true);
  assert.equal(requeued.jobId, job.id);
  const pending = await f.db.prepare('SELECT * FROM outbox WHERE scope=? AND id=?').bind(f.scope, job.id).first();
  assert.equal(pending.status, 'pending', 'retry requeues the job; it does not deliver it');
  assert.equal(pending.attempts, 0);
  assert.equal(pending.lease_token, null);
  assert.equal(pending.lease_until, null);
  assert.equal(await count(f, 'vendor_orders'), vendorOrdersBeforeRetry, 'requeue must not contact the vendor');
  assert.equal((await f.db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope, requestId).first()).status, requestBeforeRetry.status);
  assert.equal((await f.db.prepare('SELECT status FROM purchase_orders WHERE scope=? AND id=?').bind(f.scope, orderId).first()).status, orderBeforeRetry.status);
  assert.deepEqual(await budget(f), budgetBeforeRetry, 'requeue must preserve the reservation and spent balance');

  const dispatched = await action(f, 'dispatch', {}, 'alex');
  assert.equal(dispatched.processed, 1);
  assert.equal(dispatched.orderId, orderId);
  assert.equal(dispatched.jobId, job.id);
  const delivered = await f.db.prepare('SELECT * FROM outbox WHERE scope=? AND id=?').bind(f.scope, job.id).first();
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.attempts, 1);
  assert.equal(await count(f, 'vendor_orders'), 1, 'dispatch must reuse the vendor acceptance from the interrupted attempts');
  assert.equal((await f.db.prepare('SELECT order_id FROM vendor_orders WHERE scope=?').bind(f.scope).first()).order_id, orderId);
  assert.equal((await f.db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope, requestId).first()).status, 'ordered');
  assert.equal((await f.db.prepare('SELECT status FROM purchase_orders WHERE scope=? AND id=?').bind(f.scope, orderId).first()).status, 'dispatched');
  assert.deepEqual(await budget(f), budgetBeforeRetry, 'dispatch acknowledgement must not reserve or spend funds again');
});

test('concurrent receive key reuse with changed order cannot apply both receipts', async () => {
  const f = await fixture();
  const first = await approved(f, { amountCents: 3000 });
  const second = await approved(f, { amountCents: 3000 });
  const idempotencyKey = key();
  const outcomes = await runRace(f.path, servicePath, [first, second].map(({ orderId }) => [f.owner, { action: 'receive', actor: 'alex', org: f.org, orderId }, idempotencyKey]));
  assert.equal(outcomes.filter(item => item.ok).length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.find(item => !item.ok).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(await count(f, 'receipts'), 1, 'the conflicting operation must not mutate accounting before its 409');
  assert.equal((await budget(f)).spent_cents, 3000);
  assert.equal((await budget(f)).reserved_cents, 3000);
});

test('concurrent dispatch key reuse with changed input cannot contact two orders', async () => {
  const f = await fixture();
  await approved(f, { amountCents: 3000 });
  await approved(f, { amountCents: 3000 });
  const idempotencyKey = key();
  const outcomes = await runRace(f.path, servicePath, [false, true].map(crashAfterAccept => [f.owner, { action: 'dispatch', actor: 'alex', org: f.org, crashAfterAccept }, idempotencyKey]));
  assert.equal(outcomes.filter(item => item.ok).length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.find(item => !item.ok).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(await count(f, 'vendor_orders'), 1);
  const attempts = await f.db.prepare('SELECT sum(attempts) AS n FROM outbox WHERE scope=?').bind(f.scope).first();
  assert.equal(attempts.n, 1);
});

test('database constraints independently prevent negative and overspent budgets', async () => {
  const f = await fixture();
  await assert.rejects(f.db.prepare('UPDATE budgets SET reserved_cents=10001 WHERE scope=? AND id=?').bind(f.scope, f.budget.id).run());
  await assert.rejects(f.db.prepare('UPDATE budgets SET spent_cents=-1 WHERE scope=? AND id=?').bind(f.scope, f.budget.id).run());
  assert.equal((await budget(f)).reserved_cents, 0);
  assert.equal((await budget(f)).spent_cents, 0);
});
