import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { CLASSES } from './metrics.mjs';

const dataDir = fileURLToPath(new URL('./data/', import.meta.url));
const headers = { 'User-Agent': 'jev-claims-eval/1.0 (research evaluation)' };
const dimensions = file => {
  const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  return [Number(output.match(/pixelWidth: (\d+)/)?.[1]), Number(output.match(/pixelHeight: (\d+)/)?.[1])];
};
export async function fetchDataset() {
  await mkdir(dataDir, { recursive: true });
  const counts = Object.fromEntries(CLASSES.map(cls => [cls, 0]));
  const meta = [];
  let offset = 0, total = Infinity;
  while (offset < total && Object.values(counts).some(count => count < 10)) {
    const url = new URL('https://datasets-server.huggingface.co/rows');
    for (const [key, value] of Object.entries({ dataset: 'gigwegbe/damaged-car-dataset-annotated', config: 'default', split: 'train', offset, length: 100 })) url.searchParams.set(key, value);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Rows API HTTP ${response.status}`);
    const page = await response.json();
    total = page.num_rows_total;
    for (const item of page.rows) {
      const { image, bbox, category_id: cls } = item.row;
      if (!CLASSES.includes(cls) || counts[cls] >= 10 || !image?.src || !Array.isArray(bbox)) continue;
      const file = `${cls.replaceAll(' ', '_')}-${item.row_idx}.jpg`;
      const target = path.join(dataDir, file);
      try {
        const imageResponse = await fetch(image.src, { headers });
        if (!imageResponse.ok) throw new Error(`Image HTTP ${imageResponse.status}`);
        await writeFile(target, Buffer.from(await imageResponse.arrayBuffer()));
        execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '800', target, '--out', target], { stdio: 'ignore' });
        const [w, h] = dimensions(target);
        if (!w || !h || !image.width || !image.height) throw new Error('Missing image dimensions');
        meta.push({ file, cls, bbox: [bbox[0] * w / image.width, bbox[1] * h / image.height, bbox[2] * w / image.width, bbox[3] * h / image.height], w, h });
        counts[cls]++;
        console.log(`${cls}: ${counts[cls]}/10`);
      } catch (error) {
        await unlink(target).catch(() => {});
        console.error(`Skipped row ${item.row_idx}: ${error.message}`);
      }
    }
    offset += page.rows.length;
    if (!page.rows.length) break;
  }
  await writeFile(path.join(dataDir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) fetchDataset().catch(error => { console.error(error); process.exitCode = 1; });
