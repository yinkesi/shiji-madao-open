import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const ROOT = 'D:/code/shiji-madao-open';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForTimeout(800);
await page.click('#btn-new'); await page.waitForTimeout(600);
await page.evaluate(() => { const on = [...document.querySelectorAll('#panel-body [data-v="on"]')][0]; on && on.click(); });
await page.waitForTimeout(300);
await page.evaluate(() => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes('普通')); c && c.click(); });
await page.waitForTimeout(500);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await page.waitForTimeout(700);
await page.evaluate(() => { Quests.pickAndStart(Quests.byId('m1')); });
await page.waitForTimeout(900);
for (let i = 0; i < 12; i++) { if (await page.evaluate(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
await page.waitForTimeout(900);
for (let t = 0; t < 12; t++) {
  const st = await page.evaluate(() => {
    const b = window.SJI.battle;
    const rps = document.querySelector('#modal-box .rps-btn');
    return { has: !!b, over: b && b.over, round: b && b.round, phase: b && b._playerPhaseActive === true,
             ap: b && b.player.apNow, foes: b ? b.living('enemy').map(u => u.hp + '/' + u.maxhp) : [],
             mask: document.querySelector('#modal-mask').classList.contains('on'),
             rpsBtn: !!rps, rpsDisabled: rps ? rps.disabled : null,
             battleResultHidden: document.querySelector('#battle-result').classList.contains('hidden'),
             log: b ? b.log.slice(-2) : [] };
  });
  console.log(t, JSON.stringify(st));
  if (st.over) break;
  if (st.rpsBtn && !st.rpsDisabled) { await page.click('#modal-box .rps-btn'); await page.waitForTimeout(1000); continue; }
  if (st.foes && st.foes.length && st.foes[0] !== '0') { await page.evaluate(() => window.SJI_DEBUG.killEnemies()); continue; }
  if (st.phase) await page.keyboard.press('Space');
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1800);
console.log('FINAL:', await page.evaluate(() => ({ result: window.SJI.battle && window.SJI.battle.result, hidden: document.querySelector('#battle-result').classList.contains('hidden') })));
await browser.close();
