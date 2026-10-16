const LANES = [['fasttrack', 'Fast-track estimate'], ['glass', 'Glass partner'], ['roadside', 'Roadside assist'], ['bodyshop', 'Body shop'], ['totalloss', 'Total-loss desk'], ['fraud', 'Fraud check'], ['adjuster', 'Adjuster review']];
const $ = selector => document.querySelector(selector);
let claims = [], selected, spent = 0, busy = false, justTriaged, runId = 0;
const errors = new Map();
const fast = new URLSearchParams(location.search).has('fast');

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed'); error.status = response.status; throw error; }
  return data;
}
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}
function percent(value) { return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—'; }
function photoPath(path) { return new URL(path, location.href).href; }
function render() {
  const current = claims.find(claim => claim.id === selected) || claims[0];
  $('#count-claims').textContent = claims.length;
  const triaged = claims.filter(claim => claim.result);
  $('#count-triaged').textContent = triaged.length;
  $('#count-auto').textContent = triaged.length ? `${Math.round(triaged.filter(claim => !['adjuster', 'fraud'].includes(claim.result.lane)).length / triaged.length * 100)}%` : '0%';
  $('#count-spend').textContent = `$${spent.toFixed(4)}`;
  const queue = $('#queue-list'); queue.replaceChildren();
  for (const claim of claims) {
    const row = el('button', `claim-row${claim.id === current?.id ? ' selected' : ''}`);
    row.type = 'button'; row.dataset.testid = 'claim-row'; row.dataset.id = claim.id;
    row.append(el('strong', '', claim.id), el('span', '', claim.customer), el('small', '', claim.vehicle), el('p', '', claim.description), el('em', claim.result ? 'status done' : errors.has(claim.id) ? 'status error' : 'status', claim.result ? 'Triaged' : errors.has(claim.id) ? 'Error' : 'Pending'));
    row.onclick = () => { selected = claim.id; render(); };
    queue.append(row); if (claim.id === current?.id && busy) row.scrollIntoView({ block: 'nearest' });
  }
  const detail = $('#claim-detail'); detail.replaceChildren();
  if (current) {
    const head = el('div', 'detail-head'); const title = el('div'); title.append(el('small', '', current.id), el('h1', '', current.vehicle), el('p', 'customer', current.customer)); head.append(title);
    if (current.result) { const tag = el('span', `lane-tag lane-${current.result.lane}`, LANES.find(([key]) => key === current.result.lane)?.[1] || current.result.lane); head.append(tag); }
    detail.append(head);
    const wrap = el('div', 'photo-wrap'); const frame = el('div', 'photo-frame'); wrap.append(frame);
    const image = el('img'); image.src = photoPath(current.photo); image.alt = `Damage photo for ${current.id}`;
    frame.append(image);
    const box = current.result?.box;
    if (box && [box.top, box.bottom, box.left, box.right].every(Number.isFinite) && box.bottom > box.top && box.right > box.left) {
      const overlay = el('div', 'photo-box'); overlay.dataset.testid = 'photo-box';
      Object.assign(overlay.style, { top: `${box.top * 100}%`, left: `${box.left * 100}%`, width: `${(box.right - box.left) * 100}%`, height: `${(box.bottom - box.top) * 100}%` });
      overlay.append(el('span', '', `${current.result.damage || 'damage'} ${percent(current.result.confidence)}`)); frame.append(overlay);
    }
    const story = el('div', 'story'); story.append(el('small', '', 'CUSTOMER STORY'), el('p', '', `“${current.description}”`)); detail.append(wrap, story);
  }
  const decision = $('#decision'); decision.replaceChildren();
  decision.className = 'panel decision';
  if (errors.has(current?.id)) decision.append(el('div', 'inline-error', errors.get(current.id)));
  else if (current?.result) {
    const result = current.result;
    decision.className = `panel decision lane-${result.lane}`; decision.append(el('small', '', 'JEV DECISION'), el('h2', '', LANES.find(([key]) => key === result.lane)?.[1] || result.lane), el('p', 'reason', result.reason));
    const evidence = el('div', 'evidence');
    for (const [label, value] of [['Damage', `${result.damage || 'Unknown'} · ${percent(result.confidence)}`], ['Severity', typeof result.severity === 'number' ? `${result.severity.toFixed(2)} / 3` : '—'], ['Photo matches story', percent(result.match)], ['Stock image', percent(result.stock)], ['Latency', current.latencyMs == null ? '—' : `${Math.round(current.latencyMs)} ms`], ['Cost', current.costUsd == null ? '—' : `$${current.costUsd.toFixed(6)}`]]) { const row = el('div', 'evidence-row'); row.append(el('span', '', label), el('strong', '', value)); evidence.append(row); }
    const bar = el('div', 'confidence-track'); const fill = el('div', 'confidence-fill'); fill.style.width = `${Math.max(0, Math.min(100, result.confidence * 100 || 0))}%`; bar.append(fill); decision.append(evidence, bar);
  } else decision.className = 'panel decision', decision.append(el('small', '', 'JEV DECISION'), el('h2', '', 'Awaiting triage'), el('p', 'reason', 'Select Triage all to route pending claims.'));
  const lanes = $('#lanes'); lanes.replaceChildren();
  for (const [key, label] of LANES) {
    const routed = triaged.filter(claim => claim.result.lane === key);
    const lane = el('div', `lane lane-${key}`); lane.dataset.testid = `lane-${key}`;
    const head = el('div', 'lane-head'); head.append(el('strong', '', label), el('b', '', routed.length)); lane.append(head);
    for (const claim of routed) { const chip = el('button', `lane-chip${claim.id === justTriaged ? ' new' : ''}`, claim.id); chip.dataset.testid = 'lane-chip'; chip.onclick = () => { selected = claim.id; render(); }; lane.append(chip); }
    lanes.append(lane);
  }
}
async function triage(claim, run) {
  try {
    const data = await api(`/api/claims/${encodeURIComponent(claim.id)}/triage`, { method: 'POST' });
    if (run !== runId) return;
    Object.assign(claim, data); spent = data.spentUsd; errors.delete(claim.id); justTriaged = claim.id;
  } catch (error) { if (run !== runId) return; errors.set(claim.id, error.message); selected = claim.id; render(); return error.status; }
  selected = claim.id; render();
}
$('#triage-all').onclick = async () => {
  if (busy) return;
  busy = true; const run = ++runId; $('#triage-all').disabled = true;
  try { for (const claim of claims.filter(claim => !claim.result)) {
    if (run !== runId) break;
    const status = await triage(claim, run);
    if (run !== runId || status === 402 || status === 503) break;
    if (!fast) await new Promise(resolve => setTimeout(resolve, 1200));
  } } finally { busy = false; $('#triage-all').disabled = false; }
};
$('#reset').onclick = async () => {
  ++runId; busy = false; const button = $('#reset'); button.disabled = true; const label = button.textContent; button.textContent = 'Resetting…';
  try { const data = await api('/api/reset', { method: 'POST' }); claims = await api('/api/claims'); spent = data.spentUsd; errors.clear(); selected = claims[0]?.id; render(); }
  catch (error) { errors.set(selected, error.message); render(); }
  finally { button.disabled = false; button.textContent = label; }
};
$('#new-claim-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
  try {
    const file = form.photo.files[0];
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const photoBase64 = canvas.toDataURL('image/jpeg', .85).split(',')[1];
    const data = await api('/api/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: form.description.value, photoBase64, format: 'jpeg' }) });
    claims.push({ ...data.claim, result: data.result, latencyMs: data.latencyMs, costUsd: data.costUsd }); spent = data.spentUsd; selected = data.claim.id; errors.delete('form'); form.reset(); render();
  } catch (error) { const decision = $('#decision'); decision.replaceChildren(el('div', 'inline-error', error.message)); }
  finally { button.disabled = false; }
};
try { claims = await api('/api/claims'); selected = claims[0]?.id; render(); }
catch (error) { $('#decision').textContent = error.message; }
