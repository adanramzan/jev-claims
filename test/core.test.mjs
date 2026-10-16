import test from 'node:test';
import assert from 'node:assert/strict';
import { route, claimQuestions, createJev, BudgetError, LANES } from '../core/jev.mjs';

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
]) test(name, () => assert.equal(route(withAnswers(patch)).lane, lane));
for (const answers of [{}, undefined, { damage: { choice: 'glass' } }, { damage: { choice: 'glass', confidence: 'high' } }]) test(`malformed ${JSON.stringify(answers)}`, () => assert.equal(route(answers).lane, 'adjuster'));
test('none has no box', () => assert.equal(route(withAnswers({ damage: { choice: 'none', confidence: .9 } })).box, null));
test('question types and lanes', () => { assert.deepEqual(Object.entries(claimQuestions()).map(([k, v]) => [k, v.type]), [['damage','choice'],['severity','score'],['match','noul'],['stock','noul'],['box','box']]); assert.deepEqual(LANES.map(x => x[0]), ['fasttrack','glass','roadside','bodyshop','totalloss','fraud','adjuster']); });
test('budget guard prevents fetch', async () => { let calls = 0; const j = createJev({ apiKey: 'stub', budgetUsd: 1, spentUsd: 1, fetchImpl: () => { calls++; } }); await assert.rejects(j.ask({}), BudgetError); assert.equal(calls, 0); });
