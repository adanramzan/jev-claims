# Jev Claims: design

**Pitch:** First-notice-of-loss triage for car insurance. A customer submits a photo and a one-line story; in under a second, Jev names the damage, boxes it on the photo, checks the photo against the story, and routes the claim: glass partner, roadside assist, fast-track estimate, body shop, total-loss desk, fraud check, or a human adjuster when it isn't sure.

**Why Jev:** typed answers (a choice, a score, a probability, a box) with calibrated confidence, ~0.8 s and ~$0.0008 per claim. Confidence is what makes "straight-through processing" safe: confident claims are routed automatically, unsure ones go to a person.

## Components

| Path | Responsibility |
|---|---|
| `core/jev.mjs` | Jev client with budget guard (copied from jev-desk), `LANES`, `claimQuestions()`, `route(answers)` |
| `server.mjs` | Node `http` server, port 5181: static `app/`, claims API, calls Jev, spend ledger |
| `app/` | Single-page claims desk: `index.html`, `app.js`, `styles.css`, `img/` (23 CC photos + `CREDITS.md`) |
| `data/claims.json` | 23 demo claims: `{ id, customer, vehicle, description, photo, expected: { damage, route } }` |
| `eval/fetch.mjs`, `eval/run.mjs` | Held-out eval on a public car-damage dataset; writes `reports/eval-*.md` and `.json` |
| `test/` | `node --test`; never calls the real Jev (stub server) |

No dependencies besides `playwright` (dev, for e2e and recording). Node ≥ 22, ESM, no build step.

## Jev wire format (verified live)

`POST {JEV_BASE_URL||https://api.typesafe.ai}/v1/systemone`, headers `Authorization: Bearer <key>`, `content-type: application/json`, `TypeSafe-Danger-Zone-Images: true`.
Body: `{ model: 'jev-1.14.0', state: { photo: 'p', claim: '<description>' }, assets: { p: { type: 'image', format: 'jpeg'|'png', data_base64 } }, questions }`.
Response: `{ answers: { <name>: { type, choice, confidence } | { type, score } | { type, noul } | { type, box: { top, bottom, left, right } } }, usage: { input_tokens } }` (box values are 0–1 fractions of the image).
Images larger than ~800 px on the long side fail with `400 {detail:{error_type:'max_tokens_exceeded'}}`: the server must downscale uploads (browser side: canvas to max 800 px, JPEG 0.85) and reject server-side anything over 1.5 MB base64.
Cost: `input_tokens × 42e-9` USD (≈ 18k tokens ≈ $0.00076 per claim).

## Questions (`claimQuestions()`)

```js
{
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
}
```

## Routing (`route(answers, t = THRESHOLDS)`), first rule that matches wins

`THRESHOLDS = { stock: 0.9, match: 0.2, confident: 0.6, wrecked: 2.75 }`

1. `stock.noul ≥ 0.9` → `fraud`, reason "Photo looks like a stock image"
2. `damage.choice === 'none'` or `match.noul < 0.2` → `fraud`, reason "Photo doesn't show the damage described"
3. `damage.confidence < 0.6` → `adjuster`, reason "Not sure what the damage is"
4. `damage.choice === 'total_loss'` or `severity.score ≥ 2.75` → `totalloss`
5. `glass` → `glass`, `tyre` → `roadside`, `cosmetic` → `fasttrack`, `collision` → `bodyshop`

Returns `{ lane, reason, damage, confidence, severity, match, stock, box }` (`box` null when damage is `none`).
`LANES` (order shown in the UI): `fasttrack` Fast-track estimate, `glass` Glass partner, `roadside` Roadside assist, `bodyshop` Body shop, `totalloss` Total-loss desk, `fraud` Fraud check, `adjuster` Adjuster review.
Missing/malformed answers must not throw: treat as confidence 0 → `adjuster`.

Thresholds were set on the 23 demo claims (22/23 routed as labelled). The README must say so, and quote the held-out eval for accuracy.

## Server API

- `GET /api/claims` → demo claims without `expected`, plus any triage result already cached: `[{ id, customer, vehicle, description, photo, result?, latencyMs?, costUsd? }]` (`latencyMs`/`costUsd` are present once triaged; the UI shows them)
- `POST /api/claims/:id/triage` → runs Jev on that claim (photo read from `app/`), caches and returns `{ result, latencyMs, costUsd, spentUsd }`. Second call returns the cached result without calling Jev. Unknown id → 404.
- `POST /api/claims` with JSON `{ customer?, vehicle?, description, photoBase64, format: 'jpeg'|'png' }` → creates `CLM-<next>` (photo kept in memory, served at `/api/photos/:id`), triages it, returns `{ claim, result, latencyMs, costUsd, spentUsd }`. Description required (1–500 chars), photo required, ≤ 1.5 MB base64 → else 400 with `{ error }`.
- `POST /api/reset` → clears cached results and uploaded claims (spend ledger kept).
- Jev failures → 502 `{ error }`; budget exhausted → 402 `{ error: 'Jev budget exhausted' }`.
- Spend ledger `.jev-spend.json` `{ spentUsd }`, cap `JEV_BUDGET` (default 1.5 USD). Env: `JEV_API_KEY` (required to triage; server still starts and serves without it, triage returns 503), `JEV_BASE_URL`, `PORT` (default 5181).
- Static files: only from `app/`, no path traversal.

## UI (single page, no framework)

- Header: "Jev Claims", counters (claims, triaged, auto-routed %, spend $).
- Left: claim queue (id, customer, vehicle, one-line description, status chip).
- Centre: selected claim: photo with Jev's box drawn as an overlay (red, labelled with the damage), the customer's story, and a decision card: lane, reason, damage + confidence bar, severity, "photo matches story" %, "stock image" %, latency and cost.
- Bottom/right: lane board, one column per `LANES` entry with count and claim chips; a chip animates into its lane when triaged.
- "Triage all" button: triages untriaged claims one by one, selecting each so the photo/box/decision are visible ~1.2 s each (demo pacing; `?fast=1` skips the delay).
- "New claim" form: description textarea + photo file input (downscale in browser to ≤ 800 px JPEG) → POST, then shows it like any claim.
- "Reset" button → `/api/reset`.
- Errors show inline in the decision card, never `alert()`.

## Eval

`eval/fetch.mjs`: downloads 10 images per class (dent, scratch, crack, glass shatter, lamp broken, tire flat = 60) from the Hugging Face datasets-server rows API for `gigwegbe/damaged-car-dataset-annotated` (CarDD-derived; not redistributed: `eval/data/` is git-ignored), downscaled to ≤ 800 px, with `meta.json` `{ file, cls, bbox:[x,y,w,h] px, w, h }`.
`eval/run.mjs [--limit N] [--demo]`:
- each image gets a claim text: 2 of every 3 match its class, 1 of 3 describes a different class (deterministic by index);
- metrics: route-family accuracy (glass_shatter→glass, tire_flat→roadside, dent/scratch/crack/lamp broken→fasttrack|bodyshop|totalloss), per-class confusion, accuracy and coverage above confidence 0.6/0.8/0.9, box centre-hit rate (centre of Jev's box inside the labelled box), mismatch detection (fraud rate on mismatched vs matched texts), p50/p95 latency, cost total and per 1,000.
- `--demo` runs the 23 demo claims instead and reports route accuracy vs `expected`.
- writes `reports/eval-<timestamp>.md` and `.json`; respects the same ledger and cap.

## Testing

Unit: `route()` on every rule and boundary, malformed answers; `claimQuestions()` shape; eval metric helpers. Server: every endpoint against a stub Jev (local http server returning canned answers), cache, budget 402, upload validation, path traversal. E2E (Playwright, stub Jev): Triage all fills lanes, box overlay visible, new-claim upload works.

## Out of scope

Auth, persistence beyond the ledger, real insurer integrations, cost estimates in currency for repairs.
