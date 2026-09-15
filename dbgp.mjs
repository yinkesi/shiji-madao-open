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
await page.waitForTimeout(500);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await page.evaluate(() => {
  window.SJI_DEBUG.autoRps = true;
  Blades.grant('luhao'); Blades.equip('luhao');   // 录鲁豪卡并装备
  World.travel('library');
});
await page.waitForTimeout(600);
await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.xinhui));
for (let i = 0; i < 8; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  await page.click('#dialog-box'); await page.waitForTimeout(280);
}
await page.waitForTimeout(900);
console.log('开战:', await page.evaluate(() => !!window.BATTLE_ACTIVE));
console.log('实战状态:', JSON.stringify(await page.evaluate(() => {
  const b = window.SJI.battle, p = b.player;
  return { learnedFrom: p._learnedFrom, equip: G.blades.equip,
           knifeMulActive: b.passiveOwner(p) === 'luhao',
           calc: (() => { const f = b.living('enemy')[0]; p.hasKnife = true; p.r = f.r; p.c = f.c + 1 <= 6 ? f.c + 1 : f.c - 1; return b.calcDamage(p, f, 1, { type: 'knife' }); })() };
})));
await browser.close();
