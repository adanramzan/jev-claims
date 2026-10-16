export const MODEL = 'jev-1.14.0', PRICE_PER_INPUT_TOKEN = 42e-9;
export class BudgetError extends Error {}
export class JevError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createJev({ apiKey, baseUrl, model = MODEL, budgetUsd, spentUsd = 0, onSpend = () => {}, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error('budgetUsd must be a finite positive number');
  return {
    spent: () => spentUsd,
    async ask({ state, questions, assets }) {
      if (spentUsd >= budgetUsd) throw new BudgetError('Jev budget exhausted');
      const started = performance.now();
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetchImpl(`${(baseUrl || 'https://api.typesafe.ai').replace(/\/$/, '')}/v1/systemone`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' },
            body: JSON.stringify({ model, state, questions, assets }),
            signal: AbortSignal.timeout(20_000),
          });
          data = response.ok ? await response.json() : await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new JevError(data.detail?.message || data.message || data.error?.message || `Jev HTTP ${response.status}`, response.status);
            if (response.status < 500 && response.status !== 429) throw error;
            if (attempt === 2) throw error;
          } else {
            break;
          }
        } catch (error) {
          if (error instanceof JevError && (error.status < 500 && error.status !== 429 || attempt === 2)) throw error;
          if (attempt === 2) throw new JevError(error.message);
        }
        await sleep(attempt === 0 ? 500 : 1000);
      }
      const deltaUsd = (data.usage?.input_tokens ?? 5000) * PRICE_PER_INPUT_TOKEN;
      spentUsd += deltaUsd;
      await onSpend(spentUsd, deltaUsd);
      return { answers: data.answers, usage: data.usage, latencyMs: performance.now() - started, model: data.model || model };
    },
  };
}


export const LANES = [['fasttrack', 'Fast-track estimate'], ['glass', 'Glass partner'], ['roadside', 'Roadside assist'], ['bodyshop', 'Body shop'], ['totalloss', 'Total-loss desk'], ['fraud', 'Fraud check'], ['adjuster', 'Adjuster review']];
export const THRESHOLDS = { stock: 0.9, match: 0.2, confident: 0.6, wrecked: 2.75 };
export function claimQuestions() {
  return {
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
  };
}
export function route(answers, t = THRESHOLDS) {
  const damage = answers?.damage?.choice;
  const confidence = answers?.damage?.confidence;
  const severity = answers?.severity?.score;
  const match = answers?.match?.noul;
  const stock = answers?.stock?.noul;
  const box = damage === 'none' ? null : answers?.box?.box ?? null;
  let lane, reason;
  if (typeof stock === 'number' && stock >= t.stock) [lane, reason] = ['fraud', 'Photo looks like a stock image'];
  else if (damage === 'none' || typeof match === 'number' && match < t.match) [lane, reason] = ['fraud', "Photo doesn't show the damage described"];
  else if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < t.confident || !['glass', 'tyre', 'cosmetic', 'collision', 'total_loss'].includes(damage)) [lane, reason] = ['adjuster', 'Not sure what the damage is'];
  else if (damage === 'total_loss' || typeof severity === 'number' && severity >= t.wrecked) [lane, reason] = ['totalloss', 'Car is wrecked'];
  else [lane, reason] = ({ glass: ['glass', 'Glass damage'], tyre: ['roadside', 'Tyre damage'], cosmetic: ['fasttrack', 'Minor body damage'], collision: ['bodyshop', 'Collision damage'] })[damage];
  return { lane, reason, damage, confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0, severity, match, stock, box };
}
