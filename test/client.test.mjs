import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { inspect } from 'node:util';
import { Zinix, ZinixApiError, ZinixNetworkError, ZinixTimeoutError, ZinixAbortError,
  ZinixProtocolError, ZinixValidationError, ZinixPollTimeoutError, isTerminalStatus } from '../dist/index.js';

const ID = '00000000-0000-4000-8000-000000000001';
const KEY = 'fake-api-key-for-offline-tests';
const request = { legal_entity_id: ID, applicant: { document: '00000000000' },
  vehicle: { type: 'car' }, terms: { asset_value_cents: 1850000, down_payment_cents: 0, installments: [36, 48] } };
const response = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const simulation = (status = 'completed') => ({ id: ID, status, legal_entity_id: ID, results: [
  { bank: 'bv', status: 'completed', conditions: [
    { condition_id: 'a', installments: 48, installment_value_cents: 90000, down_payment_cents: 0, monthly_rate: 2.9 },
    { condition_id: 'b', installments: 48, installment_value_cents: 81600, down_payment_cents: 185000, monthly_rate: 2.76 },
  ], issues: [{ code: 'bank_failed_processing', installments: 60, status: 'failed', message: 'Falha no banco.', down_payment_cents: 0 }] },
], progress: { expected_banks: 1, finished_banks: status === 'processing' ? 0 : 1, pending_banks: status === 'processing' ? 1 : 0 }, retry_after_ms: status === 'processing' ? 20000 : null });
function client(...responses) {
  const calls = [];
  const sdk = new Zinix({ apiKey: KEY, fetch: async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('Unexpected request');
    return next;
  } });
  return { sdk, calls };
}

test('all public endpoints, envelopes and query encoding', async () => {
  const { sdk, calls } = client(...Array.from({ length: 9 }, () => response({ data: [] })));
  await sdk.legalEntities.list(); await sdk.legalEntities.banks(ID);
  await sdk.vehicles.brands({ legal_entity_id: ID, type: 'car' });
  await sdk.vehicles.models({ legal_entity_id: ID, type: 'motorcycle', brand_code: 'A&B' });
  await sdk.vehicles.versions({ legal_entity_id: ID, type: 'motorcycle', brand_code: '103', model_code: 'CG 160', manufacture_year: 2025, model_year: 2025 });
  await sdk.usage.get({ from: '2026-09-01', to: '2026-09-29' }); await sdk.billing.get();
  assert.equal(calls[0].url, 'https://saas.zinix.com.br/v1/legal-entities');
  assert.equal(calls[1].url, `https://saas.zinix.com.br/v1/legal-entities/${ID}/banks`);
  assert.match(calls[3].url, /brand_code=A%26B/);
  assert.match(calls[4].url, /model_code=CG\+160/);
  assert.match(calls[5].url, /from=2026-09-01&to=2026-09-29/);
  for (const { init } of calls) {
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
  }
});
test('create uses explicit idempotency and submits exactly once', async () => {
  const { sdk, calls } = client(response({ id: ID, status: 'queued', status_url: 'https://evil.invalid', retry_after_ms: 20000 }, 202, { 'Retry-After': '20', 'X-Request-Id': 'trace' }));
  const r = await sdk.simulations.create(request, { idempotencyKey: 'operation-123' });
  assert.equal(r.meta.status, 202); assert.equal(r.meta.retryAfterMs, 20000); assert.equal(r.meta.requestId, 'trace');
  assert.equal(calls.length, 1); assert.equal(calls[0].init.headers['Idempotency-Key'], 'operation-123');
  assert.deepEqual(JSON.parse(calls[0].init.body), request);
});
test('idempotent replay can already be completed', async () => {
  const { sdk } = client(response({ id: ID, status: 'completed', idempotent_replay: true }, 202));
  assert.equal((await sdk.simulations.create(request, { idempotencyKey: 'same-operation' })).data.status, 'completed');
});
test('GET preserves all offers, entries, issues and metadata', async () => {
  const data = simulation();
  const { sdk } = client(response(data, 200, { ETag: 'etag-1', 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '28' }));
  const r = await sdk.simulations.get(ID);
  assert.deepEqual(r.data, data); assert.equal(r.meta.etag, 'etag-1'); assert.equal(r.meta.rateLimit.remaining, 28);
});
for (const status of [400, 401, 402, 403, 404, 409, 422, 429, 500, 502, 503]) {
  test(`HTTP ${status}: preserve structured error, never retry POST`, async () => {
    const { sdk, calls } = client(response({ error: { code: 'problem', message: 'Motivo.', details: [{ field: 'applicant.email' }] }, request_id: 'trace' }, status, { 'Retry-After': '25' }));
    await assert.rejects(sdk.simulations.create(request, { idempotencyKey: 'operation-123' }), e => {
      assert.ok(e instanceof ZinixApiError); assert.equal(e.status, status); assert.equal(e.code, 'problem');
      assert.equal(e.requestId, 'trace'); assert.equal(e.retryAfterMs, 25000); assert.equal(e.details[0].field, 'applicant.email'); return true;
    });
    assert.equal(calls.length, 1);
  });
}
test('no raw HTML, request payload or echoed API key in errors', async () => {
  const { sdk } = client(new Response(`<html>${KEY}</html>`, { status: 502 }), response({ error: { message: KEY, details: { secret: KEY } } }, 400));
  await assert.rejects(sdk.billing.get(), e => !inspect(e).includes(KEY) && !inspect(e).includes('<html>'));
  await assert.rejects(sdk.billing.get(), e => !inspect(e).includes(KEY));
  assert.ok(!inspect(sdk).includes(KEY)); assert.ok(!JSON.stringify(sdk).includes(KEY));
});
test('network failures do not expose causes or resubmit', async () => {
  const { sdk, calls } = client(new Error(KEY));
  await assert.rejects(sdk.simulations.create(request, { idempotencyKey: 'operation-123' }), e => e instanceof ZinixNetworkError && !inspect(e).includes(KEY));
  assert.equal(calls.length, 1);
});
test('malformed success is a protocol error', async () => {
  const { sdk } = client(new Response('not-json'), response({ data: {} }), response({ id: ID, status: 'made-up' }));
  await assert.rejects(sdk.billing.get(), ZinixProtocolError);
  await assert.rejects(sdk.legalEntities.list(), ZinixProtocolError);
  await assert.rejects(sdk.simulations.get(ID), ZinixProtocolError);
});
test('reject unsafe base URLs, missing key, path injection and invalid dates', () => {
  for (const baseUrl of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?x=1', 'https://example.com/v1#hash']) assert.throws(() => new Zinix({ apiKey: KEY, baseUrl }), ZinixValidationError);
  assert.doesNotThrow(() => new Zinix({ apiKey: KEY, baseUrl: 'http://127.0.0.1:8080/v1' }));
  assert.throws(() => new Zinix({ apiKey: '' }), ZinixValidationError);
  const { sdk } = client();
  assert.throws(() => sdk.simulations.get('../billing'), ZinixValidationError);
  assert.throws(() => sdk.simulations.create(request, { idempotencyKey: 'short' }), ZinixValidationError);
  assert.throws(() => sdk.usage.get({ from: '2026-02-30' }), ZinixValidationError);
  assert.throws(() => sdk.usage.get({ from: '2026-09-10', to: '2026-09-01' }), ZinixValidationError);
});
test('browser construction is blocked', () => {
  globalThis.window = {};
  try { assert.throws(() => new Zinix({ apiKey: KEY }), ZinixValidationError); }
  finally { delete globalThis.window; }
});
test('timeout aborts transport; no retry', async () => {
  let calls = 0;
  const sdk = new Zinix({ apiKey: KEY, timeoutMs: 10, fetch: (_url, init) => new Promise((_resolve, reject) => {
    calls++; init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  await assert.rejects(sdk.billing.get(), ZinixTimeoutError); assert.equal(calls, 1);
});
test('abort before request makes no HTTP call', async () => {
  const { sdk, calls } = client();
  await assert.rejects(sdk.billing.get({ signal: AbortSignal.abort() }), ZinixAbortError); assert.equal(calls.length, 0);
});
test('poll at 20s, preserve partial result, stop at terminal; no POST', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const { sdk, calls } = client(response(simulation('processing')), response(simulation('partial')));
  let updates = 0;
  const pending = sdk.simulations.wait(ID, { onUpdate: () => { updates++; } });
  t.mock.timers.tick(19999); await flush(); assert.equal(calls.length, 0);
  t.mock.timers.tick(1); await flush(); assert.equal(calls.length, 1);
  t.mock.timers.tick(20000); await flush();
  const result = await pending;
  assert.equal(result.data.status, 'partial'); assert.equal(updates, 2);
  assert.ok(calls.every(c => c.init.method === 'GET'));
});
test('poll respects Retry-After 429 and success body intervals', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const { sdk, calls } = client(response({ error: { code: 'rate_limit' } }, 429, { 'Retry-After': '40' }),
    response({ ...simulation('processing'), retry_after_ms: 30000 }), response(simulation()));
  const pending = sdk.simulations.wait(ID);
  t.mock.timers.tick(20000); await flush(); assert.equal(calls.length, 1);
  t.mock.timers.tick(39999); await flush(); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls.length, 2);
  t.mock.timers.tick(30000); await flush(); assert.equal((await pending).data.status, 'completed');
});
test('poll deadline retains UUID and last result, never creates another operation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const { sdk, calls } = client(response(simulation('processing')));
  const pending = assert.rejects(sdk.simulations.wait(ID, { timeoutMs: 30000 }), e => e instanceof ZinixPollTimeoutError && e.simulationId === ID && e.lastSimulation.status === 'processing');
  t.mock.timers.tick(20000); await flush(); t.mock.timers.tick(10000); await pending; assert.equal(calls.length, 1);
});
test('cancel polling during sleep', async () => {
  const { sdk, calls } = client(); const abort = new AbortController();
  const pending = assert.rejects(sdk.simulations.wait(ID, { signal: abort.signal }), ZinixAbortError);
  abort.abort(); await pending; assert.equal(calls.length, 0);
});
test('poll limits and all terminal states', async () => {
  const { sdk } = client();
  await assert.rejects(sdk.simulations.wait(ID, { intervalMs: 1 }), ZinixValidationError);
  await assert.rejects(sdk.simulations.wait(ID, { timeoutMs: 180001 }), ZinixValidationError);
  for (const status of ['completed', 'partial', 'failed', 'expired']) assert.ok(isTerminalStatus(status));
  for (const status of ['queued', 'processing']) assert.ok(!isTerminalStatus(status));
});
