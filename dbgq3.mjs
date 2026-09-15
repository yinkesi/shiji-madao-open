import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const ROOT = 'D:/code/shiji-madao-open';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForTimeout(800);
await page.click('#btn-new'); await page.waitForTimeout(600);
await page.evaluate(() => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes('普通')); c && c.click(); });
await page.waitForTimeout(500);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await page.waitForTimeout(600);
console.log(JSON.stringify(await page.evaluate(() => {
  const cur = Quests.current();
  return { curId: cur && cur.id, curWhere: cur && cur.where,
           byIdM1: Quests.byId('m1') ? Object.keys(Quests.byId('m1')) : null,
           allLen: Quests.all().length, mainLen: Quests.mainList().length,
           ids: Quests.all().map(q => q.id).slice(0, 12) };
})));
await browser.close();
