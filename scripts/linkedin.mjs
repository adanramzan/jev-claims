// Build the portrait LinkedIn cut from the existing desk recording.
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = await mkdtemp(join(tmpdir(), 'jev-linkedin-'));
const out = join(root, 'media/linkedin.mp4');
const css = `<style>*{box-sizing:border-box}body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#171721;color:#ededf3;font-family:Inter,-apple-system,system-ui,sans-serif;font-weight:400}.eyebrow{font-size:27px;letter-spacing:3px;color:#9cb4e8}.accent{color:#9cb4e8}.card{height:100%;padding:108px 82px;display:flex;flex-direction:column;justify-content:center}.headline{font-size:78px;line-height:1.12;font-weight:480;letter-spacing:.01em;margin:42px 0}.sub{font-size:35px;line-height:1.4;color:#c3c3cc}.rule{height:2px;background:#5266eb;width:130px;border-radius:2px}</style>`;
const cards = {
  hook: `<div class="card"><div class="eyebrow">JEV CLAIMS</div><div class="headline">Car damage claims, <span class="accent">triaged from one photo</span> in under a second.</div><div class="rule"></div><div class="sub" style="margin-top:42px">Damage type, a box on the photo, a story check, and a lane.</div></div>`,
  frame: `<div style="position:absolute;top:0;width:100%;height:330px;background:#171721;padding:63px 72px"><div class="eyebrow">LIVE RUN · REAL MODEL · NO EDITS</div><div style="font-size:58px;line-height:1.14;font-weight:480;margin-top:24px">One photo and story. <span class="accent">One routing decision.</span></div></div><div style="position:absolute;top:1005px;width:100%;height:345px;background:#171721;padding:50px 72px;font-size:34px;line-height:1.85"><div><span class="accent">01</span> &nbsp; Reads the photo and the story</div><div><span class="accent">02</span> &nbsp; Routes to one of 7 lanes</div><div><span class="accent">03</span> &nbsp; Sends unsure claims to a person</div></div>`,
  results: `<div class="card" style="padding:74px 75px"><div class="eyebrow" style="margin-bottom:34px">HELD-OUT RESULTS · 60 PHOTOS</div>${[['94.6%','accurate at ≥0.6 confidence · 92.5% coverage'],['0.6 s','median per claim'],['$0.69','per 1,000 claims'],['2.5%','false fraud flags on genuine claims']].map(([n,t])=>`<div style="padding:25px 0;border-top:1px solid #454554"><div style="font-size:78px;color:#9cb4e8;font-weight:480">${n}</div><div style="font-size:27px;color:#c3c3cc">${t}</div></div>`).join('')}<div style="font-size:23px;color:#c3c3cc;margin-top:25px">Held-out: 60 public car-damage photos · Built on TypeSafe's Jev</div></div>`,
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  for (const [name, html] of Object.entries(cards)) {
    await page.setContent(css + `<body style="${name === 'frame' ? 'background:transparent' : ''}">${html}</body>`);
    await page.screenshot({ path: join(tmp, `${name}.png`), omitBackground: name === 'frame' });
  }
} finally { await browser.close(); }
try {
  const args = ['-y','-loop','1','-framerate','30','-t','3','-i',join(tmp,'hook.png'),'-i',join(root,'media/demo.mp4'),'-loop','1','-framerate','30','-t','19','-i',join(tmp,'frame.png'),'-loop','1','-framerate','30','-t','4','-i',join(tmp,'results.png'),'-filter_complex',
    '[0:v]fps=30,format=yuv420p,setsar=1[h];[1:v]setpts=PTS/2.562105,scale=1080:675:flags=lanczos,pad=1080:1350:0:330:color=#171721,fps=30,setsar=1[d];[2:v]format=rgba[ov];[d][ov]overlay=0:0:shortest=1,format=yuv420p,setsar=1[m];[3:v]fps=30,format=yuv420p,setsar=1[r];[h][m][r]concat=n=3:v=1:a=0[v]',
    '-map','[v]','-an','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-preset','medium','-movflags','+faststart',out];
  const ff = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.status}`);
} finally { await rm(tmp, { recursive: true, force: true }); }
