import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForTimeout(800);
await page.click('#btn-new');
await page.waitForTimeout(600);
try { await page.click('#chapter-card', { timeout: 4000 }); } catch (e) {}
await page.evaluate(() => {
  window.SJI_DEBUG.autoRps = true;
  while (G.ch < 9) Engine.nextChapter();
  G.flags.xiehui = true;
  World.travel('playground');
});
await page.waitForTimeout(800);
await page.evaluate(() => Main.startTournament());
await page.waitForTimeout(1500);

let last = '';
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => {
    const b = window.SJI.battle;
    if (!b) return { none: true };
    return {
      over: b.over, wave: b.waveIndex, sw: b.survivalWaveNo, round: b.round,
      foes: b.living('enemy').map(u => u.charId), phase: b._playerPhaseActive === true,
      mask: document.querySelector('#modal-mask').classList.contains('on'),
      log: b.log[b.log.length - 1],
    };
  });
  const sig = JSON.stringify(st);
  if (sig !== last) { console.log(i, sig); last = sig; }
  if (st.over) break;
  if (st.none) break;
  if (st.foes && st.foes.length) await page.evaluate(() => window.SJI_DEBUG.killEnemies());
  else if (st.phase) await page.keyboard.press('Space');
  await page.waitForTimeout(500);
}
const fin = await page.evaluate(() => ({ result: window.SJI.battle.result, wave: window.SJI.battle.waveIndex }));
console.log('FIN', JSON.stringify(fin));
await browser.close();
