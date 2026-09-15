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
  World.travel('library');
});
await page.waitForTimeout(700);
await page.evaluate(() => { const p = World.npcPos('xinhui'); if (p) World.walkTo(p[0], p[1] - 40); });
await page.waitForTimeout(2600);
await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.xinhui));
for (let i = 0; i < 10; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  await page.click('#dialog-box');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1200);
await page.waitForTimeout(2200);
await page.evaluate(() => window.SJI_DEBUG.killEnemies());
for (let i = 0; i < 10; i++) {
  const done = await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'));
  if (done) break;
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
}
await page.waitForTimeout(2000);
const info = await page.evaluate(() => {
  const btn = document.querySelector('#r-menu');
  const res = document.querySelector('#battle-result');
  const bat = document.querySelector('#battle');
  const cs = btn ? getComputedStyle(btn) : null;
  const cr = btn ? btn.getBoundingClientRect() : null;
  const rr = res.getBoundingClientRect();
  const br = bat.getBoundingClientRect();
  return {
    btnExists: !!btn,
    btnRect: cr ? { w: cr.width, h: cr.height, x: cr.x, y: cr.y } : null,
    btnDisplay: cs ? cs.display : null, btnVis: cs ? cs.visibility : null,
    resultClass: res.className, resultRect: { w: rr.width, h: rr.height },
    battleClass: bat.className, battleRect: { w: br.width, h: br.height },
    stageHidden: document.querySelector('#battle-stage').className,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
