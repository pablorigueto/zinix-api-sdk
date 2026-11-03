import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Zinix } from '../dist/index.js';

const MAIN = '00000000-0000-4000-8000-000000000001';
const ADDITIONAL = '00000000-0000-4000-8000-000000000002';
const SIM = '00000000-0000-4000-8000-000000000003';
const FOREIGN = '00000000-0000-4000-8000-000000000004';
const source = readFileSync(new URL('../examples/server/handlers.ts', import.meta.url), 'utf8')
  .replace("'@zinix/sdk'", JSON.stringify(new URL('../dist/index.js', import.meta.url).href));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { createHandlers } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(auth) {
  const seen = []; const ownership = [];
  const sdk = new Zinix({ apiKey: 'synthetic-multicnpj-key', fetch: async (url, init) => {
    seen.push({ url, init });
    if (init.method === 'POST') return Response.json({ id: SIM, status: 'queued' }, { status: 202 });
    if (url.endsWith('/legal-entities')) return Response.json({ data: [
      { id: MAIN, is_primary: true }, { id: ADDITIONAL, is_primary: false },
    ] });
    return Response.json({ data: [] });
  } });
  const handlers = createHandlers(sdk, {
    authorize: async () => auth, allowRequest: async () => true, validateInput: input => input,
    saveOwnership: async (...args) => { ownership.push(args); }, ownsSimulation: async () => true,
  });
  const post = id => handlers.POST(new Request('https://consumer.invalid/simulate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'operation-123' },
    body: JSON.stringify({ legal_entity_id: id }),
  }));
  return { sdk, seen, ownership, post };
}

test('SDK lists all CNPJs and preserves each selection across interleaved calls', async () => {
  const { sdk, seen } = fixture(null);
  const { data } = await sdk.legalEntities.list();
  assert.deepEqual(data.map(item => item.id), [MAIN, ADDITIONAL]);
  for (const id of [ADDITIONAL, MAIN, ADDITIONAL]) {
    await Promise.all([
      sdk.legalEntities.banks(id), sdk.vehicles.brands({ legal_entity_id: id, type: 'car' }),
      sdk.simulations.create({ legal_entity_id: id }, { idempotencyKey: `operation-${id}` }),
    ]);
    const [banks, catalog, create] = seen.slice(-3);
    assert.equal(banks.url, `https://saas.zinix.com.br/v1/legal-entities/${id}/banks`);
    assert.equal(new URL(catalog.url).searchParams.get('legal_entity_id'), id);
    assert.equal(JSON.parse(create.init.body).legal_entity_id, id);
  }
});

test('server example preserves an authorized additional CNPJ instead of overriding with session primary', async () => {
  const { seen, ownership, post } = fixture({ subject: 'user', legalEntityId: MAIN,
    legalEntityIds: [MAIN, ADDITIONAL], idempotencyScope: 'testscope' });
  for (const id of [ADDITIONAL, MAIN]) {
    assert.equal((await post(id)).status, 202);
    assert.equal(JSON.parse(seen.at(-1).init.body).legal_entity_id, id);
  }
  assert.equal(ownership.length, 2);
});

test('single-store compatibility rejects another CNPJ without submitting or saving ownership', async () => {
  const { seen, ownership, post } = fixture({ subject: 'user', legalEntityId: MAIN, idempotencyScope: 'testscope' });
  assert.equal((await post(ADDITIONAL)).status, 403);
  assert.equal(seen.length, 0); assert.equal(ownership.length, 0);
  assert.equal((await post(MAIN)).status, 202);
});

test('server authorization fails closed for foreign, empty or missing allowed stores', async () => {
  for (const auth of [
    { subject: 'user', legalEntityIds: [MAIN, ADDITIONAL], idempotencyScope: 'testscope' },
    { subject: 'user', legalEntityId: MAIN, legalEntityIds: [], idempotencyScope: 'testscope' },
    { subject: 'user', idempotencyScope: 'testscope' },
  ]) {
    const { seen, ownership, post } = fixture(auth);
    assert.equal((await post(FOREIGN)).status, 403);
    if (!auth.legalEntityIds?.length) assert.equal((await post(MAIN)).status, 403);
    assert.equal(seen.length, 0); assert.equal(ownership.length, 0);
  }
});
