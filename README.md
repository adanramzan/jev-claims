# Jev Claims

First-notice-of-loss triage for car insurance: one photo and a short customer story become a routing decision in under a second.

![Jev Claims desk demo](media/demo.gif)

## What it does

Jev reads the photo and one-line story in one call. It returns a damage class, a box around the damage, whether the photo matches the story, and whether the image looks like stock photography. The desk routes the claim to one of seven lanes: glass partner, roadside assist, fast-track estimate, body shop, total-loss desk, fraud check, or adjuster review when the model is unsure. The box is a visual aid, not a measurement.

## Why Jev

Jev gives typed answers with confidence: choice, score, probability, and box in one roughly 0.7-second call at about $0.0008 per claim. Confidence lets the desk send uncertain claims to a person, which is necessary for safe straight-through processing.

## Quick start

Requires Node 22 or newer.

```sh
npm install
npx playwright install chromium # for tests and recording
JEV_API_KEY=... npm start
```

Open http://localhost:5181. `JEV_BUDGET` defaults to $1.50. Spend is tracked in `.jev-spend.json`. The desk starts without a key, but triage returns HTTP 503. `JEV_BASE_URL` and `PORT` can override the API host and port.

## Results and limits

**Demo set:** On 23 claims in `data/claims.json`, damage class was correct for 20/23 and route for 22/23. The miss was CLM-2416: a head-on crash went to the total-loss desk instead of the body shop. Stock 0.9, match 0.2, confident 0.6, and wrecked 2.75 thresholds were tuned on this same set. These results are calibration, not accuracy. See [the latest demo run](reports/eval-2026-10-16T03-16-47.164Z.md).

**Held-out set:** 60 CarDD-derived images, 10 each of dent, scratch, crack, glass shatter, lamp broken, and tire flat. On matching stories, route-family accuracy was 87.5%. Accuracy above confidence 0.6 was 94.6% at 92.5% coverage; above 0.8, 97.1% at 87.5% coverage; above 0.9, 96.7% at 75% coverage. False fraud flags on genuine claims were 2.5%; mismatched stories were caught 55% of the time. Box centre hit was 46.7%, so the box is weak and should not be used as a measurement. Latency was 623 ms p50 and 978 ms p95. Cost was $0.69 per 1,000 claims. See [the final held-out run](reports/eval-2026-10-16T00-43-38.843Z.md).

The [first held-out run](reports/eval-2026-10-16T00-42-45.573Z.md) used story templates naming parts such as “door” and “windscreen.” The match question checks the part, and 40% of genuine claims went to fraud. The templates were changed to part-neutral stories before the final run. Real customer stories name parts, so the match and fraud signal needs tuning on real data.

The evaluation images come from the CarDD-derived Hugging Face dataset `gigwegbe/damaged-car-dataset-annotated`. Its licence is unclear, so the images are not redistributed. `npm run eval:fetch` downloads them into gitignored `eval/data/`. Dataset fetching is macOS only (uses sips). To reproduce the saved reports, run `npm run eval -- --demo` for the bundled claims or `npm run eval -- --limit N` for N fetched held-out images; both require `JEV_API_KEY`.

## How routing works

The first matching rule wins:

1. Stock-image probability at least 0.9 → fraud check.
2. No visible damage, or story-match probability below 0.2 → fraud check.
3. Damage confidence below 0.6 → adjuster review.
4. Total-loss class, or severity at least 2.75 → total-loss desk.
5. Glass → glass partner; tyre → roadside assist; cosmetic → fast-track estimate; collision → body shop.

## API

- `GET /api/claims` lists demo and uploaded claims with cached results where available.
- `POST /api/claims/:id/triage` triages a claim, then caches its result. Unknown IDs return 404.
- `POST /api/claims` creates and triages a claim from `{ customer?, vehicle?, description, photoBase64, format: "jpeg" | "png" }`. Description is 1–500 characters and image data is limited to 1.5 MB base64. Uploaded photos are held in memory and served at `/api/photos/:id`.
- `POST /api/reset` clears results and uploaded claims, but keeps the spend ledger.

Triage responses include the result, latency, cost, and total spend. Jev errors return 502; exhausted budget returns 402. Requests with a foreign Host, or POSTs with a foreign Origin, return 403. An upload interrupted by reset returns 409.

## Project layout

- `core/`: Jev client, questions, budget guard, and routing.
- `server.mjs`: HTTP API and static desk server.
- `app/`: single-page desk and credited demo photos.
- `data/claims.json`: 23 labelled demo claims.
- `eval/`: dataset fetcher and evaluation runner; `reports/`: saved evaluation results.
- `test/`: offline unit, server, and browser tests.
- `scripts/`: demo recorder and LinkedIn video builder; `media/`: recordings and post copy.

## Tests and recording

`npm test` runs 76 tests against a stub Jev, offline. `node scripts/record.mjs` records a real-model desk run and requires `JEV_API_KEY`; it spends against the same budget ledger.

## Credits

Demo photos are Creative Commons images via Openverse; see [photo credits](app/img/CREDITS.md). The visual language draws on the [Mercury `DESIGN.md` in VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT), a community analysis unaffiliated with Mercury. This project is unaffiliated with TypeSafe.
