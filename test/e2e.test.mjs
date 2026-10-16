import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../server.mjs';
import { startStubJev } from './stub-jev.mjs';

async function fixture(t, options = {}) {
  const stub = await startStubJev();
  const dir = await mkdtemp(join(tmpdir(), 'claims-e2e-'));
  const app = await startServer({ apiKey: 'stub', baseUrl: stub.url, budgetUsd: 1, ledgerPath: join(dir, 'ledger.json'), ...options });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  t.after(async () => { await browser.close(); await app.close(); await stub.close(); await rm(dir, { recursive: true, force: true }); });
  await page.goto(app.url + '/?fast=1');
  return { page, stub };
}

test('triage all routes 23 claims once and shows a real photo box', async t => {
  const { page, stub } = await fixture(t);
  assert.equal(await page.getByTestId('claim-row').count(), 23);
  await page.getByTestId('triage-all').dblclick();
  await page.getByTestId('counter-triaged').getByText('23').waitFor();
  assert.equal(await page.getByTestId('lane-chip').count(), 23);
  assert.equal(stub.calls.length, 23);
  await page.getByTestId('claim-row').first().click();
  const box = page.getByTestId('photo-box');
  await box.waitFor();
  const size = await box.boundingBox();
  assert.ok(size.width > 0 && size.height > 0);
});

test('budget exhaustion appears inline and queue remains usable', async t => {
  const { page } = await fixture(t, { budgetUsd: .0001 });
  await page.getByTestId('triage-all').click();
  await page.getByTestId('decision').getByText('Jev budget exhausted').waitFor();
  assert.equal(await page.getByTestId('claim-row').count(), 23);
});

test('new photo claim is triaged and reset clears the board', async t => {
  const { page } = await fixture(t);
  const form = page.getByTestId('new-claim-form');
  await form.locator('textarea').fill('A cracked windscreen');
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; return canvas.toDataURL('image/png').split(',')[1]; });
  await form.locator('input[type=file]').setInputFiles({ name: 'claim.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await form.getByRole('button', { name: /submit/i }).click();
  await page.getByTestId('claim-row').filter({ hasText: 'A cracked windscreen' }).waitFor();
  assert.equal(await page.getByTestId('lane-chip').count(), 1);
  await page.getByTestId('reset').click();
  await page.getByTestId('claim-row').filter({ hasText: 'A cracked windscreen' }).waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('claim-row').count(), 23);
  assert.equal(await page.getByTestId('lane-chip').count(), 0);
});
