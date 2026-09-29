import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Zinix, ZinixNetworkError } from '../dist/index.js';

test('native fetch reaches local server; redirects cannot leak credentials', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    if (req.url === '/v1/billing') { res.writeHead(302, { Location: '/capture' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'native-trace' });
    res.end(JSON.stringify({ data: [{ id: 'synthetic-id', cnpj_masked: '00.***.***/****-00' }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const sdk = new Zinix({ apiKey: 'synthetic-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1/` });
    const result = await sdk.legalEntities.list();
    assert.equal(result.data[0].id, 'synthetic-id'); assert.equal(result.meta.requestId, 'native-trace');
    await assert.rejects(sdk.billing.get(), ZinixNetworkError);
    assert.deepEqual(seen.map(r => r.url), ['/v1/legal-entities', '/v1/billing']);
    assert.ok(seen.every(r => r.authorization === 'Bearer synthetic-key'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
