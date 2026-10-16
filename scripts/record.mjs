// Records the desk triaging every demo claim with the real Jev: node scripts/record.mjs [outDir]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = process.argv[2] || `${root}media/raw`;
if (!process.env.JEV_API_KEY) throw new Error('JEV_API_KEY is required');
const server = await startServer({ apiKey: process.env.JEV_API_KEY, budgetUsd: Number(process.env.JEV_BUDGET || 1.5), ledgerPath: `${root}.jev-spend.json`, root });
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: outDir, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
try {
  await fetch(`${server.url}/api/reset`, { method: 'POST' });
  await page.goto(server.url);
  await page.waitForSelector('[data-testid=claim-row]');
  await page.waitForTimeout(1500);
  await page.click('[data-testid=triage-all]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=triage-all]').disabled && document.querySelector('#count-triaged').textContent === document.querySelector('#count-claims').textContent, null, { timeout: 180_000 });
  await page.waitForTimeout(2500);
  console.log('video:', await page.video().path());
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
