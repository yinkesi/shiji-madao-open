import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForTimeout(800);
await page.click('#btn-new'); await page.waitForTimeout(600);
// 选噩梦开卷
await page.evaluate(() => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes('噩梦')); c && c.click(); });
await page.waitForTimeout(500);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await page.waitForTimeout(700);
// 授予鲁豪卡并装备 + 两张稀有卡，然后直接开 m1（难度随玩家=噩梦）
await page.evaluate(() => {
  SJI_SAVE.setSetting('lastDiff', 'nightmare');
  Blades.grant('luhao'); Blades.equip('luhao');
  Blades.grantRare('b_firststrike'); Blades.grantRare('b_killheal');
  G.flags.xiehui = true;
  World.travel('playground');
});
await page.waitForTimeout(500);
await page.evaluate(() => Quests.pickAndStart(Quests.byId('m1')));
for (let i = 0; i < 8; i++) { if (await page.evaluate(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(250); }
await page.waitForTimeout(900);
console.log('噩梦实战:', JSON.stringify(await page.evaluate(() => {
  const b = window.SJI.battle, p = b.player;
  const f = b.living('enemy')[0]; p.hasKnife = true; p.r = f.r; p.c = f.c + 1 <= 6 ? f.c + 1 : f.c - 1;
  return {
    diff: b.diff,
    learnedFrom: p._learnedFrom,                 // 应为 luhao
    knifeMul: b.hasPassive(p, 'luhao'),          // 装备鲁豪卡→被动应生效
    knifeDmg: b.calcDamage(p, f, 1, { type: 'knife' }),  // 应为 2
    firstStrike: p.boons.firstStrike || 0,       // 稀有卡「先手刀」应=1
    killHeal: p.boons.killHeal || 0,             // 未携带应为 0
    chipsText: (document.querySelector('#rare-chips') || {}).textContent || '',
  };
})));
await browser.close();
