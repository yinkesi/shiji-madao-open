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
await page.evaluate(() => { window.SJI_DEBUG.autoRps = true; World.travel('classroom6'); });
await page.waitForTimeout(700);
await page.evaluate(() => { const p = World.npcPos('wenbin'); if (p) World.walkTo(p[0], p[1] - 40); });
await page.waitForTimeout(2400);
await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.wenbin));
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  await page.click('#dialog-box');
  await page.waitForTimeout(280);
}
await page.waitForTimeout(900);
console.log('intro:', await page.evaluate(() => !!window.SJI.battle?.cfg.introScene));
await page.waitForTimeout(2200);
await page.evaluate(() => window.SJI_DEBUG.killEnemies());
for (let i = 0; i < 10; i++) {
  const done = await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'));
  if (done) break;
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1800);
const info = await page.evaluate(() => {
  const b = window.SJI.battle;
  const btn = document.querySelector('#r-menu');
  return {
    over: b?.over, result: b?.result, round: b?.round,
    battleCls: document.querySelector('#battle').className,
    active: window.BATTLE_ACTIVE,
    resultCls: document.querySelector('#battle-result').className,
    stageCls: document.querySelector('#battle-stage').className,
    maskCls: document.querySelector('#modal-mask').className,
    btnRect: btn ? (r => ({ w: r.width, h: r.height, y: r.y }))(btn.getBoundingClientRect()) : null,
    resultText: document.querySelector('#result-body').textContent.slice(0, 60),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
