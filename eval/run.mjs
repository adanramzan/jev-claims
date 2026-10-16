import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createJev, claimQuestions, route, MODEL } from '../core/jev.mjs';
import { claimFor, familyCorrect, centreHit, summarise } from './metrics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pct = value => `${value.toFixed(1)}%`;
const money = value => `$${value.toFixed(6)}`;
const table = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}`;
export function reportMarkdown(summary, { demo, date, model }) {
  const matched = summary.mismatch.find(row => row.matched);
  const mismatched = summary.mismatch.find(row => !row.matched);
  return `# Jev claims eval\n\nDate: ${date}  \nModel: ${model}  \nN: ${summary.n}\n\n## Headline\n\n${table(['Metric', 'Value'], [[demo ? 'Route accuracy' : 'Route family accuracy', pct(summary.accuracyPct)], ...(demo ? [['Damage accuracy', pct(summary.damageAccuracyPct)]] : [['Box centre hit', pct(summary.boxHitPct)]])])}\n\n## Confidence coverage\n\n${table(['Threshold', 'Coverage %', 'Accuracy %'], summary.coverage.map(row => [row.threshold.toFixed(1), pct(row.coveragePct), pct(row.accuracyPct)]))}\n\n## Per class\n\n${table(['Class', 'N', 'Family correct', 'Top lane'], summary.perClass.map(row => [row.cls, row.n, `${row.correct}/${row.n} (${pct(row.accuracyPct)})`, row.topLane]))}\n\n## Mismatch detection\n\n${table(['Claim text', 'N', 'Fraud rate'], [['Mismatched', mismatched.n, pct(mismatched.fraudRatePct)], ['Matched', matched.n, pct(matched.fraudRatePct)]])}\n\n## Latency and cost\n\n${table(['Metric', 'Value'], [['Latency p50', `${summary.latencyP50Ms.toFixed(0)} ms`], ['Latency p95', `${summary.latencyP95Ms.toFixed(0)} ms`], ['Cost total', money(summary.costUsd)], ['Cost per 1,000', money(summary.costPer1000Usd)]])}\n`;
}
export async function run(argv = process.argv.slice(2), env = process.env) {
  const demo = argv.includes('--demo');
  const limitAt = argv.indexOf('--limit');
  const limit = limitAt < 0 ? Infinity : Number(argv[limitAt + 1]);
  if (limitAt >= 0 && (!Number.isInteger(limit) || limit <= 0)) throw new Error('--limit requires a positive number');
  if (!env.JEV_API_KEY) throw new Error('JEV_API_KEY is required');
  const ledgerPath = path.join(root, '.jev-spend.json');
  const spentUsd = JSON.parse(await readFile(ledgerPath, 'utf8').catch(() => '{"spentUsd":0}')).spentUsd;
  const jev = createJev({ apiKey: env.JEV_API_KEY, baseUrl: env.JEV_BASE_URL, budgetUsd: Number(env.JEV_BUDGET || 1.5), spentUsd, onSpend: total => writeFile(ledgerPath, JSON.stringify({ spentUsd: total })) });
  const items = demo ? JSON.parse(await readFile(path.join(root, 'data/claims.json'), 'utf8')) : JSON.parse(await readFile(path.join(root, 'eval/data/meta.json'), 'utf8'));
  const rows = [];
  for (const [index, item] of items.slice(0, limit).entries()) {
    const claim = demo ? { text: item.description, matched: true } : claimFor(item.cls, index);
    const photo = demo ? path.join(root, 'app', item.photo) : path.join(root, 'eval/data', item.file);
    const before = jev.spent();
    const reply = await jev.ask({ state: { photo: 'p', claim: claim.text }, assets: { p: { type: 'image', format: 'jpeg', data_base64: (await readFile(photo)).toString('base64') } }, questions: claimQuestions() });
    const result = route(reply.answers);
    const row = { id: demo ? item.id : item.file, cls: demo ? item.expected.damage : item.cls, matched: claim.matched, lane: result.lane, damage: result.damage, confidence: result.confidence, correct: demo ? result.lane === item.expected.route : familyCorrect(item.cls, result.lane), damageCorrect: demo ? result.damage === item.expected.damage : null, boxHit: demo ? null : centreHit(result.box, item.bbox, item.w, item.h), latencyMs: reply.latencyMs, costUsd: jev.spent() - before, inputTokens: reply.usage?.input_tokens ?? null };
    rows.push(row);
    console.log(`${rows.length}/${Math.min(items.length, limit)} ${row.id}: ${row.lane} ${row.correct ? 'correct' : 'incorrect'}`);
  }
  const summary = summarise(rows);
  if (demo) summary.damageAccuracyPct = rows.length ? rows.filter(row => row.damageCorrect).length * 100 / rows.length : 0;
  const date = new Date().toISOString();
  const model = MODEL;
  const basename = `eval-${date.replaceAll(':', '-')}`;
  await mkdir(path.join(root, 'reports'), { recursive: true });
  await writeFile(path.join(root, 'reports', `${basename}.json`), JSON.stringify({ date, model, demo, summary, rows }, null, 2));
  await writeFile(path.join(root, 'reports', `${basename}.md`), reportMarkdown(summary, { demo, date, model }));
  return { summary, rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error => { console.error(error); process.exitCode = 1; });
