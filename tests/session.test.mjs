import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { issueSession, verifySession } from '../src/server/session.ts';

const secret = 'test-only-session-key-with-at-least-32-bytes';
const instant = Date.UTC(2026, 10, 24, 12);

test('a signed demo session survives later requests and has an isolated random owner', () => {
  const first = issueSession(secret, instant);
  const second = issueSession(secret, instant);
  assert.equal(verifySession(first.token, secret, instant + 60_000), first.owner);
  assert.notEqual(first.owner, second.owner);
  assert.equal(first.maxAge, 30 * 24 * 60 * 60);
  assert.equal(verifySession(first.token, secret + '-other', instant), null);
});

test('editing an owner or signature does not grant another demo workspace', () => {
  const session = issueSession(secret, instant);
  const [body, signature] = session.token.split('.');
  const changed = JSON.parse(Buffer.from(body, 'base64url'));
  changed.sub = issueSession(secret, instant).owner;
  assert.equal(verifySession(`${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`, secret, instant), null);
  assert.equal(verifySession(`${body}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`, secret, instant), null);
});

test('expired and future-issued sessions are rejected', () => {
  const session = issueSession(secret, instant);
  assert.equal(verifySession(session.token, secret, instant + session.maxAge * 1000), null);
  assert.equal(verifySession(session.token, secret, instant - 120_000), null);
});

test('malformed and oversized cookies fail closed', () => {
  for (const token of [undefined, '', 'bad', 'a.b.c', '.abc', 'a.!', 'a'.repeat(1025)]) {
    assert.equal(verifySession(token, secret, instant), null);
  }
  const invalid = Buffer.from(JSON.stringify({ v: 2, sub: 'arbitrary-owner', iat: instant / 1000, exp: instant / 1000 + 1 })).toString('base64url');
  const signed = createHmac('sha256', secret).update(invalid).digest('base64url');
  assert.equal(verifySession(`${invalid}.${signed}`, secret, instant), null);
});

test('missing or weak server signing keys cannot create a demo identity', () => {
  assert.throws(() => issueSession('short', instant), /SESSION_SECRET/);
  assert.throws(() => verifySession(undefined, '', instant), /SESSION_SECRET/);
});
