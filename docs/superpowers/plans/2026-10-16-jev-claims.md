# Jev Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A car-insurance claims desk where Jev classifies the damage photo, checks it against the customer's story and routes each claim to a lane.

**Architecture:** Shared `core/jev.mjs` (client + questions + routing), a dependency-free Node `http` server that calls Jev and serves a vanilla-JS single page, and an eval script on a public dataset.

**Tech Stack:** Node ≥ 22 ESM, `node:test`, Playwright (dev only).

**Spec:** `docs/superpowers/specs/2026-10-16-jev-claims-design.md`. It is binding; exact strings, thresholds, endpoints and the Jev wire format live there.

## Global Constraints

- No runtime dependencies. Dev dependency: `playwright` only.
- Tests never call the real Jev; use a local stub http server. `npm test` must pass offline.
- Never read `your env file` or use a real key in tests.
- ESM `.mjs`, 2-space indent, small files, no frameworks, no TypeScript.
- Commit after each task with a conventional message.

## Review Focus

1. Jev returns partial/malformed answers (missing `box`, missing `confidence`) → claim goes to `adjuster`, no crash.
2. Uploaded photo too large or not an image → 400 with a clear error, Jev not called, no spend.
3. Budget reached mid "Triage all" → remaining claims show "Jev budget exhausted", UI keeps working.
4. Path traversal on static files (`/../server.mjs`, encoded `%2e%2e`) → 404.
5. Double-click "Triage all" → each claim triaged (and paid for) once.

---

### Task 1: core (`core/jev.mjs`, `test/core.test.mjs`, `package.json`)

**Interfaces — Produces:**
- `createJev({ apiKey, baseUrl, model, budgetUsd, spentUsd, onSpend, fetchImpl, sleep })` → `{ spent(), ask({ state, questions, assets }) → { answers, usage, latencyMs, model } }`, `BudgetError`, `JevError`, `MODEL`, `PRICE_PER_INPUT_TOKEN`: copy verbatim from `../jev-desk/core/jev.mjs` lines 1–5 and 17–56 (drop the helpdesk-specific CATEGORIES, screenshotState, triageQuestions, markQuestion, decide).
- `LANES`: array of `[key, label]` in spec order.
- `THRESHOLDS`, `claimQuestions()`, `route(answers, t = THRESHOLDS)` exactly as the spec.
- `package.json`: `"type": "module"`, scripts `test: node --test test/*.test.mjs`, `start: node server.mjs`, `eval: node eval/run.mjs`, `eval:fetch: node eval/fetch.mjs`; devDependency `playwright` same version as jev-desk (`^1.64.1`).

- [ ] Tests first: one test per routing rule (use the calibration numbers below as fixtures), each boundary (`stock` 0.9 → fraud, 0.8999 → not; `match` 0.2 → not fraud, 0.1999 → fraud; confidence 0.6 → routed, 0.5999 → adjuster; severity 2.75 → totalloss), rule precedence (stock beats everything; fraud beats low confidence), `{}` and `undefined` answers → `adjuster`, `box` null when damage `none`; `claimQuestions()` has exactly the 5 keys with the spec types; budget guard throws `BudgetError` when spent ≥ budget (stub `fetchImpl`).
  Fixtures (real Jev outputs): `{damage:{choice:'collision',confidence:0.99},severity:{score:2.72},match:{noul:0.78},stock:{noul:0.98}}` → fraud; `{damage:{choice:'glass',confidence:0.95},severity:{score:2.16},match:{noul:0.04},stock:{noul:0.29}}` → fraud; `{damage:{choice:'collision',confidence:0.83},severity:{score:2.9},match:{noul:0.83},stock:{noul:0.22}}` → totalloss; `{damage:{choice:'tyre',confidence:0.92},severity:{score:0.55},match:{noul:0.27},stock:{noul:0.39}}` → roadside; `{damage:{choice:'cosmetic',confidence:0.95},severity:{score:1.19},match:{noul:0.92},stock:{noul:0.85}}` → fasttrack.
- [ ] Implement, `npm install`, `npm test` green, commit.

### Task 2: server (`server.mjs`, `test/server.test.mjs`, `test/stub-jev.mjs`)

**Interfaces — Consumes:** Task 1 exports. **Produces:** the HTTP API in the spec; `export async function startServer({ port = 0, apiKey, baseUrl, budgetUsd, ledgerPath, root }) → { url, close() }` so tests can start it on a random port; running `node server.mjs` starts it with env values and logs the URL.

- `test/stub-jev.mjs`: `startStubJev(handler?) → { url, calls, close() }`; default handler answers every question with canned values (`damage` choice from `state.claim` keywords is NOT needed; a fixed `glass` 0.97 answer is fine; handler overridable per test), `usage.input_tokens: 18000`.
- Tests: GET claims (no `expected` leaked); triage returns result + cost and caches (stub called once on 2 calls); unknown id 404; upload validation (missing description, too-large photo, bad format → 400, stub not called); upload success → claim listed and photo served at `/api/photos/:id`; budget exhausted → 402; Jev 500 → 502; no API key → 503; reset; static traversal `/../server.mjs` and `/%2e%2e/server.mjs` → 404; concurrent duplicate triage of one claim calls Jev once (in-flight promise cache).
- [ ] Tests first, implement, green, commit.

### Task 3: UI (`app/index.html`, `app/app.js`, `app/styles.css`, `test/e2e.test.mjs`)

**Interfaces — Consumes:** the HTTP API in the spec (Task 2; e2e uses `startServer` + `startStubJev`). Photos already exist in `app/img/`; do not modify them or `data/claims.json`.

Visual direction: clean insurance back-office tool, light theme, neutral greys, one accent (#d93025 red for Jev's box and highlights), system font, dense but readable at 1440×900 and recordable at 1280×800. Lane colours subtle. The photo is the hero: big, with the red box overlay and a label tag ("collision 100%"). The decision card reads like a verdict: lane name large, reason underneath, then the evidence rows.

- E2E (Playwright, stub Jev, `?fast=1`): page loads 23 claims; "Triage all" results in 23 chips across lanes and the counters update; selecting a triaged claim shows the box overlay element with non-zero size; budget error from server is shown inline; upload a small generated PNG + description → new claim appears triaged.
- [ ] Implement, e2e green, commit.

### Task 4: eval (`eval/fetch.mjs`, `eval/run.mjs`, `eval/metrics.mjs`, `test/metrics.test.mjs`)

**Interfaces — Consumes:** Task 1 (`createJev`, `claimQuestions`, `route`). **Produces:** the eval CLI per spec.

- `eval/metrics.mjs` pure helpers: `routeFamily(cls)`, `familyCorrect(cls, lane)`, `centreHit(box, bbox, w, h)`, `claimFor(cls, index)` (deterministic match/mismatch texts, one matching and one mismatching template per class), `summarise(rows)` → numbers the report prints. Unit-tested.
- `fetch.mjs`: page through `https://datasets-server.huggingface.co/rows?dataset=gigwegbe/damaged-car-dataset-annotated&config=default&split=train&offset=O&length=100` until 10 per class; download `row.image.src`; downscale with `sips -Z 800` (macOS) and scale the bbox accordingly (store final w/h); write `eval/data/meta.json`. Skip rows whose image fails.
- `run.mjs`: reads `JEV_API_KEY` from env, ledger `.jev-spend.json`, cap `JEV_BUDGET` (default 1.5); `--limit N`; `--demo`; prints a row per item and writes `reports/eval-<ISO>.md` + `.json`.
- [ ] Metrics tests first, implement, green, commit. Do NOT run against the real Jev.
