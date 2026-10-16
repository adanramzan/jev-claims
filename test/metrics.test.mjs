import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, routeFamily, familyCorrect, centreHit, claimFor, summarise } from '../eval/metrics.mjs';

test('families and claim texts cover all six labels', () => {
  assert.equal(routeFamily('glass shatter'), 'glass');
  assert.equal(routeFamily('tire flat'), 'roadside');
  for (const cls of CLASSES) {
    assert.equal(claimFor(cls, 0).matched, true);
    assert.equal(claimFor(cls, 2).matched, false);
    assert.notEqual(claimFor(cls, 0).text, claimFor(cls, 2).text);
  }
  assert.equal(familyCorrect('dent', 'bodyshop'), true);
  assert.equal(familyCorrect('dent', 'fraud'), false);
});
test('centre hit uses scaled pixel coordinates', () => {
  assert.equal(centreHit({ left: .2, right: .4, top: .2, bottom: .4 }, [20, 20, 20, 20], 100, 100), true);
  assert.equal(centreHit({ left: .7, right: .9, top: .7, bottom: .9 }, [20, 20, 20, 20], 100, 100), false);
  assert.equal(centreHit(null, [0, 0, 10, 10], 100, 100), false);
});
test('summary calculates coverage, class, fraud, latency, and cost', () => {
  const s = summarise([
    { cls: 'dent', lane: 'bodyshop', correct: true, confidence: .9, matched: true, boxHit: true, latencyMs: 10, costUsd: .1 },
    { cls: 'dent', lane: 'fraud', correct: false, confidence: .5, matched: false, boxHit: false, latencyMs: 20, costUsd: .2 }
  ]);
  assert.equal(s.accuracyPct, 50);
  assert.equal(s.coverage[0].coveragePct, 50);
  assert.equal(s.coverage[0].accuracyPct, 100);
  assert.equal(s.perClass[0].topLane, 'bodyshop');
  assert.equal(s.mismatch[0].fraudRatePct, 100);
  assert.equal(s.boxHitPct, 50);
  assert.equal(s.latencyP95Ms, 20);
  assert.ok(Math.abs(s.costPer1000Usd - 150) < 1e-9);
});
