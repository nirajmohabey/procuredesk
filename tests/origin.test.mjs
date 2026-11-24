import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin } from '../src/server/origin.ts';

const request = (origin, extra = {}) => new Request('http://localhost:3015/api/actions', {
  method: 'POST', headers: { host: '127.0.0.1:3015', ...(origin ? { origin } : {}), ...extra },
});

test('same-origin writes work when Next internally reconstructs a localhost URL', () => {
  assert.equal(isSameOrigin(request('http://127.0.0.1:3015')), true);
});

test('cross-site, missing, null and path-bearing origins cannot mutate a workspace', () => {
  for (const origin of [undefined, 'null', 'http://attacker.example', 'http://127.0.0.1:3015/path', 'http://127.0.0.1:3016']) {
    assert.equal(isSameOrigin(request(origin)), false);
  }
  assert.equal(isSameOrigin(request('http://127.0.0.1:3015', { 'sec-fetch-site': 'cross-site' })), false);
});

test('hosted requests require HTTPS and do not trust a forged forwarding host', () => {
  const make = (origin, extra = {}) => new Request('http://localhost/api/actions', { method: 'POST', headers: { host: 'procuredesk.example', origin, ...extra } });
  assert.equal(isSameOrigin(make('https://procuredesk.example'), true), true);
  assert.equal(isSameOrigin(make('http://procuredesk.example'), true), false);
  assert.equal(isSameOrigin(make('https://attacker.example', { 'x-forwarded-host': 'attacker.example' }), true), false);
});
