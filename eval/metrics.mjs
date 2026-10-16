export const CLASSES = ['dent', 'scratch', 'crack', 'glass shatter', 'lamp broken', 'tire flat'];
// Part-neutral on purpose: the dataset doesn't say which part is damaged, and the match question checks the part.
const STORIES = {
  dent: 'My car got dented in a minor bump.',
  scratch: 'Someone scratched the paint on my car.',
  crack: 'A part of my car cracked in a small collision.',
  'glass shatter': 'Glass on my car got shattered.',
  'lamp broken': 'One of the lights on my car got broken.',
  'tire flat': 'My car has a flat tyre and cannot drive.'
};
export function routeFamily(cls) {
  if (cls === 'glass shatter') return 'glass';
  if (cls === 'tire flat') return 'roadside';
  if (CLASSES.includes(cls)) return 'body';
  throw new Error(`Unknown class: ${cls}`);
}
export function familyCorrect(cls, lane) {
  const family = routeFamily(cls);
  return family === 'body' ? ['fasttrack', 'bodyshop', 'totalloss'].includes(lane) : lane === family;
}
export function centreHit(box, bbox, w, h) {
  if (!box || !bbox || !(w > 0 && h > 0) || bbox.length !== 4) return false;
  const values = [box.left, box.right, box.top, box.bottom, ...bbox];
  if (!values.every(Number.isFinite)) return false;
  const x = (box.left + box.right) * w / 2;
  const y = (box.top + box.bottom) * h / 2;
  return x >= bbox[0] && x <= bbox[0] + bbox[2] && y >= bbox[1] && y <= bbox[1] + bbox[3];
}
export function claimFor(cls, index) {
  const position = CLASSES.indexOf(cls);
  if (position < 0) throw new Error(`Unknown class: ${cls}`);
  const matched = index % 3 !== 2;
  // +3 pairs each class with a visibly different one (dent↔glass, scratch↔lamp, crack↔tyre)
  return { text: STORIES[matched ? cls : CLASSES[(position + 3) % CLASSES.length]], matched };
}
const pct = (n, d) => d ? 100 * n / d : 0;
const percentile = (sorted, p) => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : 0;
// Routing accuracy is scored on claims whose story matches the photo; mismatched ones are scored by the fraud rate.
export function summarise(allRows) {
  const rows = allRows.filter(row => row.matched !== false);
  const n = rows.length;
  const correct = rows.filter(row => row.correct).length;
  const boxRows = allRows.filter(row => row.boxHit !== null && row.boxHit !== undefined);
  const coverage = [0.6, 0.8, 0.9].map(threshold => {
    const selected = rows.filter(row => row.confidence >= threshold);
    return { threshold, n: selected.length, coveragePct: pct(selected.length, n), accuracyPct: pct(selected.filter(row => row.correct).length, selected.length) };
  });
  const perClass = [...new Set(rows.map(row => row.cls))].map(cls => {
    const group = rows.filter(row => row.cls === cls);
    const counts = new Map();
    for (const row of group) counts.set(row.lane, (counts.get(row.lane) || 0) + 1);
    const topLane = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    return { cls, n: group.length, correct: group.filter(row => row.correct).length, accuracyPct: pct(group.filter(row => row.correct).length, group.length), topLane };
  });
  const mismatch = [false, true].map(matched => {
    const group = allRows.filter(row => row.matched === matched);
    return { matched, n: group.length, fraudRatePct: pct(group.filter(row => row.lane === 'fraud').length, group.length) };
  });
  const latency = allRows.map(row => row.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const costUsd = allRows.reduce((sum, row) => sum + (row.costUsd || 0), 0);
  return { n, correct, accuracyPct: pct(correct, n), boxHitPct: pct(boxRows.filter(row => row.boxHit).length, boxRows.length), coverage, perClass, mismatch, latencyP50Ms: percentile(latency, 0.5), latencyP95Ms: percentile(latency, 0.95), costUsd, total: allRows.length, costPer1000Usd: allRows.length ? costUsd * 1000 / allRows.length : 0 };
}
