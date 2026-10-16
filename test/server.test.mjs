import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { startStubJev } from './stub-jev.mjs';

async function fixture(t, options = {}, handler) {
  const stub = await startStubJev(handler);
  const dir = await mkdtemp(join(tmpdir(), 'claims-test-'));
  const app = await startServer({ apiKey: 'stub', baseUrl: stub.url, budgetUsd: 1, ledgerPath: join(dir, 'ledger.json'), ...options });
  t.after(async () => { await app.close(); await stub.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path, method = 'GET', body) => fetch(app.url + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { stub, request, app };
}
test('claims omit expected', async t => { const { request } = await fixture(t); const claims = await (await request('/api/claims')).json(); assert.equal(claims.length, 23); assert.equal('expected' in claims[0], false); });
test('triage is cached and costs one call', async t => { const { request, stub } = await fixture(t); const first = await (await request('/api/claims/CLM-2401/triage', 'POST')).json(); const second = await (await request('/api/claims/CLM-2401/triage', 'POST')).json(); assert.equal(first.result.lane, 'glass'); assert.ok(Math.abs(first.costUsd - .000756) < 1e-12); assert.equal(second.result.lane, 'glass'); assert.equal(stub.calls.length, 1); });
test('unknown id returns 404', async t => { const { request } = await fixture(t); assert.equal((await request('/api/claims/missing/triage', 'POST')).status, 404); });
for (const [name, body] of [['missing description', { photoBase64: 'iVBORw0KGgo=', format: 'png' }], ['large photo', { description: 'x', photoBase64: 'a'.repeat(1_500_001), format: 'png' }], ['bad format', { description: 'x', photoBase64: 'iVBORw0KGgo=', format: 'gif' }], ['not image', { description: 'x', photoBase64: Buffer.from('hello').toString('base64'), format: 'png' }]]) test(name, async t => { const { request, stub } = await fixture(t); const res = await request('/api/claims', 'POST', body); assert.equal(res.status, 400); assert.ok((await res.json()).error); assert.equal(stub.calls.length, 0); });
test('upload creates triaged claim and serves photo', async t => { const { request } = await fixture(t); const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex'); const res = await request('/api/claims', 'POST', { description: 'cracked glass', photoBase64: bytes.toString('base64'), format: 'png' }); assert.equal(res.status, 200); const data = await res.json(); assert.equal(data.result.lane, 'glass'); assert.equal((await request(`/api/photos/${data.claim.id}`)).headers.get('content-type'), 'image/png'); assert.equal((await (await request('/api/claims')).json()).length, 24); });
test('budget exhausted', async t => { const { request, stub } = await fixture(t, { budgetUsd: .0001 }); await request('/api/claims/CLM-2401/triage', 'POST'); const res = await request('/api/claims/CLM-2402/triage', 'POST'); assert.equal(res.status, 402); assert.deepEqual(await res.json(), { error: 'Jev budget exhausted' }); assert.equal(stub.calls.length, 1); });
test('Jev 500 becomes 502', async t => { const { request } = await fixture(t, {}, () => ({ status: 500, body: { error: { message: 'down' } } })); assert.equal((await request('/api/claims/CLM-2401/triage', 'POST')).status, 502); });
test('missing key returns 503', async t => { const { request } = await fixture(t, { apiKey: '' }); assert.equal((await request('/api/claims/CLM-2401/triage', 'POST')).status, 503); });
test('reset clears results and uploads', async t => { const { request } = await fixture(t); await request('/api/claims/CLM-2401/triage', 'POST'); assert.equal((await request('/api/reset', 'POST')).status, 200); const claims = await (await request('/api/claims')).json(); assert.equal(claims[0].result, undefined); });
test('static traversal is blocked', async t => { const { request } = await fixture(t); for (const path of ['/../server.mjs', '/%2e%2e/server.mjs']) assert.equal((await request(path)).status, 404); });
test('concurrent triage pays once', async t => { const { request, stub } = await fixture(t); const results = await Promise.all(Array.from({ length: 3 }, () => request('/api/claims/CLM-2401/triage', 'POST'))); assert.ok(results.every(r => r.status === 200)); assert.equal(stub.calls.length, 1); });
