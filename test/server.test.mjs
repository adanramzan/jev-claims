import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
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
test('concurrent triage pays once', async t => { const { request, stub } = await fixture(t); const results = await Promise.all(Array.from({ length: 3 }, () => request('/api/claims/CLM-2401/triage', 'POST'))); assert.ok(results.every(r => r.status === 200)); assert.equal(stub.calls.length, 1); });

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex').toString('base64');
const upload = (request, extra = {}) => request('/api/claims', 'POST', { description: 'cracked glass', photoBase64: png, format: 'png', ...extra });
const raw = (app, path, method = 'GET', body) => new Promise((resolve, reject) => { const r = httpRequest(app.url + path, { method }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() })); }); r.on('error', reject); r.end(body); });
const gate = () => { let open; const promise = new Promise(r => open = r); return { promise, open }; };
const until = async cond => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond()); };
const answer = choice => ({ answers: { damage: { choice, confidence: .97 }, severity: { score: 1 }, match: { noul: .9 }, stock: { noul: .1 }, box: { box: { top: .1, bottom: .5, left: .2, right: .6 } } }, usage: { input_tokens: 18000 } });

test('static traversal is blocked (raw paths reach the guard)', async t => { const { app } = await fixture(t); for (const path of ['/../server.mjs', '/%2e%2e/server.mjs', '/%2E%2E%2Fserver.mjs', '/..%2fserver.mjs']) { const res = await raw(app, path); assert.equal(res.status, 404, path); assert.ok(!res.text.includes('startServer'), path); } });
test('malformed escapes and NUL are not 500', async t => { const { app } = await fixture(t); for (const path of ['/%E0%A4%A', '/%00', '/a%00.html']) assert.ok([400, 404].includes((await raw(app, path)).status), path); });
test('static text responses declare utf-8', async t => { const { app } = await fixture(t); for (const path of ['/', '/app.js', '/styles.css']) { const res = await raw(app, path); if (res.status === 200) assert.match(res.headers['content-type'], /charset=utf-8/); } assert.match((await raw(app, '/')).headers['content-type'], /text\/html; charset=utf-8/); });
test('concurrent uploads get distinct ids, results and photos', async t => {
  const { request, stub } = await fixture(t, {}, async body => { await new Promise(r => setTimeout(r, 30)); return answer(body.state.claim.includes('tyre') ? 'tyre' : 'glass'); });
  const [a, b] = await Promise.all([upload(request, { description: 'glass cracked' }), upload(request, { description: 'flat tyre' })]);
  const [da, db] = [await a.json(), await b.json()];
  assert.notEqual(da.claim.id, db.claim.id); assert.equal(da.result.lane, 'glass'); assert.equal(db.result.lane, 'roadside'); assert.equal(stub.calls.length, 2);
  const ids = (await (await request('/api/claims')).json()).map(c => c.id); assert.equal(new Set(ids).size, 25);
  for (const d of [da, db]) assert.equal((await request(`/api/photos/${d.claim.id}`)).status, 200);
});
test('reset during in-flight upload does not resurrect the claim', async t => {
  const g = gate(); const { request, stub } = await fixture(t, {}, async () => { await g.promise; return answer('glass'); });
  const pendingUpload = upload(request); await until(() => stub.calls.length === 1);
  await request('/api/reset', 'POST'); g.open();
  assert.equal((await pendingUpload).status, 409);
  const claims = await (await request('/api/claims')).json(); assert.equal(claims.length, 23);
  const next = await (await upload(request)).json(); assert.equal((await request(`/api/photos/${next.claim.id}`)).status, 200);
});
test('reset during in-flight triage does not pay twice for the same claim', async t => {
  const g = gate(); const { request, stub } = await fixture(t, {}, async () => { await g.promise; return answer('glass'); });
  const first = request('/api/claims/CLM-2401/triage', 'POST'); await until(() => stub.calls.length === 1);
  await request('/api/reset', 'POST'); const second = request('/api/claims/CLM-2401/triage', 'POST'); await new Promise(r => setTimeout(r, 30)); g.open();
  assert.equal((await first).status, 200); assert.equal((await second).status, 200); assert.equal(stub.calls.length, 1);
  assert.equal((await (await request('/api/claims')).json())[0].result.lane, 'glass');
});
test('concurrent triage of different claims cannot overshoot the budget', async t => {
  const { request, stub } = await fixture(t, { budgetUsd: .001 }, async () => { await new Promise(r => setTimeout(r, 20)); return answer('glass'); });
  const statuses = (await Promise.all(['CLM-2401', 'CLM-2402', 'CLM-2403'].map(id => request(`/api/claims/${id}/triage`, 'POST')))).map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 402]); assert.equal(stub.calls.length, 2);
});
test('ledger is written atomically, reloaded and kept on reset', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'claims-ledger-')); t.after(() => rm(dir, { recursive: true, force: true })); const ledgerPath = join(dir, 'ledger.json');
  const one = await fixture(t, { ledgerPath }); await Promise.all(['CLM-2401', 'CLM-2402', 'CLM-2403'].map(id => one.request(`/api/claims/${id}/triage`, 'POST')));
  const saved = JSON.parse(await readFile(ledgerPath, 'utf8')); assert.ok(Math.abs(saved.spentUsd - 3 * .000756) < 1e-12); assert.deepEqual(Object.keys(saved), ['spentUsd']);
  assert.equal((await (await one.request('/api/reset', 'POST')).json()).spentUsd, saved.spentUsd);
  assert.deepEqual((await readdir(dir)), ['ledger.json']);
  const two = await fixture(t, { ledgerPath, budgetUsd: saved.spentUsd }); const res = await two.request('/api/claims/CLM-2404/triage', 'POST');
  assert.equal(res.status, 402); assert.equal(two.stub.calls.length, 0);
});
test('corrupt ledger starts at zero with a warning', async t => {
  const warn = t.mock.method(console, 'warn', () => {}); const dir = await mkdtemp(join(tmpdir(), 'claims-ledger-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'ledger.json'), '{"spentUs');
  const { request } = await fixture(t, { ledgerPath: join(dir, 'ledger.json') }); assert.equal((await request('/api/claims/CLM-2401/triage', 'POST')).status, 200); assert.ok(warn.mock.callCount() >= 1);
});
test('ledger write failure does not lose the paid result', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { request, stub } = await fixture(t, { ledgerPath: join(tmpdir(), 'claims-missing-dir', 'nope', 'ledger.json') });
  const res = await request('/api/claims/CLM-2401/triage', 'POST'); assert.equal(res.status, 200); assert.equal((await res.json()).result.lane, 'glass');
  assert.equal((await (await request('/api/claims/CLM-2401/triage', 'POST')).json()).result.lane, 'glass'); assert.equal(stub.calls.length, 1); assert.ok(warn.mock.callCount() >= 1);
});
test('invalid bodies and fields are 400', async t => {
  const { request, app, stub } = await fixture(t);
  for (const body of ['null', '[]', '"x"', '5']) assert.equal((await raw(app, '/api/claims', 'POST', body)).status, 400, body);
  for (const extra of [{ customer: { a: 1 } }, { vehicle: 123 }, { customer: 'x'.repeat(81) }, { vehicle: 'y'.repeat(81) }, { description: '   ' }, { description: 'x'.repeat(501) }, { description: 'x'.repeat(500) + ' '.repeat(5) + 'y' }, { photoBase64: undefined }]) assert.equal((await upload(request, extra)).status, 400, JSON.stringify(extra).slice(0, 60));
  assert.equal(stub.calls.length, 0);
});
test('boundary values are accepted and trimmed', async t => {
  const { request } = await fixture(t);
  const res = await upload(request, { description: ` ${'x'.repeat(500)} \n`, customer: ' Ann ', vehicle: 'v'.repeat(80) }); assert.equal(res.status, 200);
  const { claim } = await res.json(); assert.equal(claim.description.length, 500); assert.equal(claim.customer, 'Ann'); assert.equal(claim.vehicle.length, 80);
});
test('GET /api/claims returns only documented fields', async t => {
  const { request } = await fixture(t); await request('/api/claims/CLM-2401/triage', 'POST');
  const claims = await (await request('/api/claims')).json(); const allowed = new Set(['id', 'customer', 'vehicle', 'description', 'photo', 'result', 'latencyMs', 'costUsd']);
  for (const c of claims) for (const k of Object.keys(c)) assert.ok(allowed.has(k), k);
  assert.deepEqual(Object.keys(claims[0]).sort(), [...allowed].sort()); assert.deepEqual(Object.keys(claims[1]).sort(), ['customer', 'description', 'id', 'photo', 'vehicle']);
});
test('partial Jev answers route to adjuster with 200', async t => {
  const { request } = await fixture(t, {}, () => ({ answers: { damage: { choice: 'glass' }, severity: { score: 1 }, match: { noul: .9 }, stock: { noul: .1 } }, usage: { input_tokens: 18000 } }));
  const res = await request('/api/claims/CLM-2401/triage', 'POST'); assert.equal(res.status, 200); const { result } = await res.json();
  assert.equal(result.lane, 'adjuster'); assert.equal(result.confidence, 0); assert.equal(result.box, null);
});
test('503 has a message and does not call Jev', async t => {
  const { request, stub } = await fixture(t, { apiKey: '' }); const res = await request('/api/claims/CLM-2401/triage', 'POST');
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'Jev API key unavailable' }); assert.equal(stub.calls.length, 0);
});

test('foreign Origin cannot triage, same Origin can', async t => {
  const { app, stub } = await fixture(t);
  const path = '/api/claims/CLM-2401/triage';
  const request = origin => fetch(app.url + path, { method: 'POST', headers: { Origin: origin } });
  const denied = await request('https://evil.example');
  assert.equal(denied.status, 403);
  assert.ok((await denied.json()).error);
  assert.equal(stub.calls.length, 0);
  assert.equal((await request(app.url)).status, 200);
  assert.equal(stub.calls.length, 1);
});

test('foreign Host is rejected before routing', async t => {
  const { app, stub } = await fixture(t);
  const res = await new Promise((resolve, reject) => {
    const req = httpRequest(app.url + '/api/claims/CLM-2401/triage', { method: 'POST', headers: { Host: 'evil.example' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(res.status, 403);
  assert.ok(res.body.error);
  assert.equal(stub.calls.length, 0);
});
