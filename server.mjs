import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJev, BudgetError, JevError, claimQuestions, route, PRICE_PER_INPUT_TOKEN } from './core/jev.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const error = (res, status, message) => send(res, status, { error: message });
function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2_100_000) throw new Error('Request too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error('Invalid JSON'); }
}
function photoBytes(data, format) {
  if (!['jpeg', 'png'].includes(format) || typeof data !== 'string' || !data || data.length > 1_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Valid photo required (jpeg or png, up to 1.5 MB base64)');
  const bytes = Buffer.from(data, 'base64');
  const valid = format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (!valid) throw new Error('Photo is not a valid image');
  return bytes;
}
export async function startServer({ port = 0, apiKey = process.env.JEV_API_KEY, baseUrl = process.env.JEV_BASE_URL, budgetUsd = Number(process.env.JEV_BUDGET || 1.5), ledgerPath = join(projectRoot, '.jev-spend.json'), root = projectRoot } = {}) {
  const appRoot = resolve(root, 'app');
  const original = JSON.parse(await readFile(resolve(root, 'data/claims.json'), 'utf8'));
  let claims = original.map(({ expected, ...claim }) => claim);
  const uploads = new Map(), pending = new Map();
  let spentUsd = 0;
  try { spentUsd = JSON.parse(await readFile(ledgerPath, 'utf8')).spentUsd || 0; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const jev = createJev({ apiKey, baseUrl, budgetUsd, spentUsd, onSpend: async total => writeFile(ledgerPath, JSON.stringify({ spentUsd: total })) });
  async function triage(claim) {
    if (claim.result) return { result: claim.result, latencyMs: claim.latencyMs, costUsd: claim.costUsd, spentUsd: jev.spent() };
    if (pending.has(claim.id)) return pending.get(claim.id);
    const work = (async () => {
      const photo = uploads.get(claim.id);
      const bytes = photo?.bytes || await readFile(resolve(appRoot, claim.photo));
      const format = photo?.format || (extname(claim.photo).toLowerCase() === '.png' ? 'png' : 'jpeg');
      const reply = await jev.ask({ state: { photo: 'p', claim: claim.description }, assets: { p: { type: 'image', format, data_base64: bytes.toString('base64') } }, questions: claimQuestions() });
      claim.result = route(reply.answers);
      claim.latencyMs = reply.latencyMs;
      claim.costUsd = (reply.usage?.input_tokens ?? 5000) * PRICE_PER_INPUT_TOKEN;
      return { result: claim.result, latencyMs: claim.latencyMs, costUsd: claim.costUsd, spentUsd: jev.spent() };
    })();
    pending.set(claim.id, work);
    try { return await work; } finally { pending.delete(claim.id); }
  }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/claims') return send(res, 200, claims);
      if (req.method === 'POST' && path === '/api/reset') { claims = original.map(({ expected, ...claim }) => claim); uploads.clear(); pending.clear(); return send(res, 200, { ok: true, spentUsd: jev.spent() }); }
      const triageId = /^\/api\/claims\/([^/]+)\/triage$/.exec(path)?.[1];
      if (req.method === 'POST' && triageId) {
        const claim = claims.find(c => c.id === triageId);
        if (!claim) return error(res, 404, 'Claim not found');
        if (!apiKey) return error(res, 503, 'Jev API key unavailable');
        return send(res, 200, await triage(claim));
      }
      if (req.method === 'POST' && path === '/api/claims') {
        const input = await body(req);
        if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 500) return error(res, 400, 'Description must be 1–500 characters');
        const bytes = photoBytes(input.photoBase64, input.format);
        if (!apiKey) return error(res, 503, 'Jev API key unavailable');
        const next = Math.max(...claims.map(c => Number(c.id.match(/^CLM-(\d+)$/)?.[1]) || 0)) + 1;
        const claim = { id: `CLM-${next}`, customer: input.customer || 'New customer', vehicle: input.vehicle || 'Unknown vehicle', description: input.description.trim(), photo: `api/photos/CLM-${next}` };
        uploads.set(claim.id, { bytes, format: input.format });
        try { const result = await triage(claim); claims.push(claim); return send(res, 200, { claim, ...result }); }
        catch (e) { uploads.delete(claim.id); throw e; }
      }
      const photoId = /^\/api\/photos\/([^/]+)$/.exec(path)?.[1];
      if (req.method === 'GET' && photoId) { const photo = uploads.get(photoId); return photo ? send(res, 200, photo.bytes, `image/${photo.format}`) : error(res, 404, 'Photo not found'); }
      if (req.method !== 'GET' || path.startsWith('/api/')) return error(res, 404, 'Not found');
      const relative = decodeURIComponent(req.url.split('?')[0]);
      const file = resolve(appRoot, '.' + (relative === '/' ? '/index.html' : relative));
      if (!file.startsWith(appRoot + sep)) return error(res, 404, 'Not found');
      try { return send(res, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); } catch (e) { if (e.code === 'ENOENT' || e.code === 'EISDIR') return error(res, 404, 'Not found'); throw e; }
    } catch (e) {
      if (e instanceof BudgetError) return error(res, 402, 'Jev budget exhausted');
      if (e instanceof JevError) return error(res, 502, e.message);
      if (e instanceof SyntaxError || /^(Request too large|Invalid JSON|Valid photo|Photo is not)/.test(e.message)) return error(res, 400, e.message);
      return error(res, 500, 'Internal server error');
    }
  });
  await new Promise(resolveListen => server.listen(port, '127.0.0.1', resolveListen));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolveClose => server.close(resolveClose)) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer({ port: Number(process.env.PORT || 5181) }).then(({ url }) => console.log(url));
