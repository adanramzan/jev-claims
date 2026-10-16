import test from 'node:test';
import assert from 'node:assert/strict';
import { route, claimQuestions, createJev, BudgetError, JevError, LANES } from '../core/jev.mjs';

const base = { damage: { choice: 'glass', confidence: .95 }, severity: { score: 2.16 }, match: { noul: .8 }, stock: { noul: .1 }, box: { box: { top: .1, bottom: .5, left: .2, right: .6 } } };
const withAnswers = patch => ({ ...base, ...patch });
for (const [name, patch, lane] of [
  ['stock fraud', { stock: { noul: .98 } }, 'fraud'],
  ['mismatch fraud', { match: { noul: .04 } }, 'fraud'],
  ['low confidence', { damage: { choice: 'glass', confidence: .59 } }, 'adjuster'],
  ['total loss choice', { damage: { choice: 'total_loss', confidence: .9 } }, 'totalloss'],
  ['wrecked score', { severity: { score: 2.9 } }, 'totalloss'],
  ['glass', {}, 'glass'],
  ['tyre', { damage: { choice: 'tyre', confidence: .92 } }, 'roadside'],
  ['cosmetic', { damage: { choice: 'cosmetic', confidence: .95 } }, 'fasttrack'],
  ['collision', { damage: { choice: 'collision', confidence: .83 } }, 'bodyshop'],
  ['none', { damage: { choice: 'none', confidence: .9 } }, 'fraud'],
  ['stock boundary', { stock: { noul: .9 } }, 'fraud'],
  ['below stock boundary', { stock: { noul: .8999 } }, 'glass'],
  ['match boundary', { match: { noul: .2 } }, 'glass'],
  ['below match boundary', { match: { noul: .1999 } }, 'fraud'],
  ['confidence boundary', { damage: { choice: 'glass', confidence: .6 } }, 'glass'],
  ['below confidence boundary', { damage: { choice: 'glass', confidence: .5999 } }, 'adjuster'],
  ['severity boundary', { severity: { score: 2.75 } }, 'totalloss'],
  ['stock precedence', { stock: { noul: .98 }, match: { noul: 0 }, damage: { choice: 'glass', confidence: 0 } }, 'fraud'],
  ['fraud precedence', { match: { noul: 0 }, damage: { choice: 'glass', confidence: 0 } }, 'fraud'],
  ['low confidence beats total loss', { damage: { choice: 'total_loss', confidence: .3 } }, 'adjuster'],
  ['none beats low confidence', { damage: { choice: 'none', confidence: .1 } }, 'fraud'],
]) test(name, () => assert.equal(route(withAnswers(patch)).lane, lane));
for (const [name, patch, reason] of [
  ['stock', { stock: { noul: .98 } }, 'Photo looks like a stock image'],
  ['mismatch', { match: { noul: .04 } }, "Photo doesn't show the damage described"],
  ['none', { damage: { choice: 'none', confidence: .9 } }, "Photo doesn't show the damage described"],
  ['low confidence', { damage: { choice: 'glass', confidence: .59 } }, 'Not sure what the damage is'],
  ['total loss', { damage: { choice: 'total_loss', confidence: .9 } }, 'Car is wrecked'],
  ['wrecked score', { severity: { score: 2.9 } }, 'Car is wrecked'],
  ['glass', {}, 'Glass damage'],
  ['tyre', { damage: { choice: 'tyre', confidence: .92 } }, 'Tyre damage'],
  ['cosmetic', { damage: { choice: 'cosmetic', confidence: .95 } }, 'Minor body damage'],
  ['collision', { damage: { choice: 'collision', confidence: .83 } }, 'Collision damage'],
]) test(`reason: ${name}`, () => assert.equal(route(withAnswers(patch)).reason, reason));
test('missing confidence is coerced to 0', () => assert.equal(route({ damage: { choice: 'glass' } }).confidence, 0));
for (const answers of [{}, undefined, { damage: { choice: 'glass' } }, { damage: { choice: 'glass', confidence: 'high' } }]) test(`malformed ${JSON.stringify(answers)}`, () => assert.equal(route(answers).lane, 'adjuster'));
test('none has no box', () => assert.equal(route(withAnswers({ damage: { choice: 'none', confidence: .9 } })).box, null));
test('question types and lanes', () => { assert.deepEqual(Object.entries(claimQuestions()).map(([k, v]) => [k, v.type]), [['damage','choice'],['severity','score'],['match','noul'],['stock','noul'],['box','box']]); assert.deepEqual(LANES, [['fasttrack', 'Fast-track estimate'], ['glass', 'Glass partner'], ['roadside', 'Roadside assist'], ['bodyshop', 'Body shop'], ['totalloss', 'Total-loss desk'], ['fraud', 'Fraud check'], ['adjuster', 'Adjuster review']]); });
test('claimQuestions text matches the spec', () => assert.deepEqual(claimQuestions(), {
  damage: { type: 'choice', instructions: 'What is the main damage to the car in `photo`?', criteria: {
    glass: 'Broken, cracked or shattered windscreen or window glass',
    tyre: 'Flat, punctured or shredded tyre',
    cosmetic: 'Minor body damage: scratches, scuffs or small dents; the car is otherwise intact',
    collision: 'Collision damage: crushed or torn panels, smashed bumper or lights, deformed body',
    total_loss: 'Wrecked, burnt or destroyed car that is not worth repairing',
    none: 'No visible damage on the car' } },
  severity: { type: 'score', instructions: 'How severe is the damage to the car in `photo`?', criteria: ['None', 'Cosmetic', 'Needs a body shop', 'Car is wrecked'] },
  match: { type: 'noul', instructions: 'Does `photo` show the damage that `claim` describes, on the part of the car it mentions?' },
  stock: { type: 'noul', instructions: 'Is `photo` a studio stock image or 3D render rather than a real photo taken by a car owner?' },
  box: { type: 'box', instructions: 'the damaged area of the car in `photo`' },
}));
test('empty baseUrl falls back to the default host', async () => { let url; const j = createJev({ apiKey: 'k', baseUrl: '', budgetUsd: 1, fetchImpl: async u => { url = u; return { ok: true, json: async () => ({ answers: {}, usage: { input_tokens: 1000 } }) }; } }); await j.ask({}); assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); });
test('retries 5xx and 429 but not 4xx; accounts spend', async () => {
  const run = async statuses => { let calls = 0, spend = []; const j = createJev({ apiKey: 'k', budgetUsd: 1, sleep: async () => {}, onSpend: (t, d) => spend.push([t, d]), fetchImpl: async () => { const status = statuses[calls++]; return { ok: status === 200, status, json: async () => status === 200 ? { answers: {}, usage: { input_tokens: 1000 } } : { error: { message: 'x' } } }; } }); return { j, spend, calls: () => calls }; };
  const ok = await run([500, 429, 200]); await ok.j.ask({}); assert.equal(ok.calls(), 3); assert.equal(ok.spend.length, 1); assert.ok(Math.abs(ok.spend[0][1] - 1000 * 42e-9) < 1e-15); assert.equal(ok.j.spent(), ok.spend[0][0]);
  const bad = await run([400, 200]); await assert.rejects(bad.j.ask({}), JevError); assert.equal(bad.calls(), 1); assert.equal(bad.spend.length, 0);
});
test('budget guard prevents fetch', async () => { let calls = 0; const j = createJev({ apiKey: 'stub', budgetUsd: 1, spentUsd: 1, fetchImpl: () => { calls++; } }); await assert.rejects(j.ask({}), BudgetError); assert.equal(calls, 0); });
