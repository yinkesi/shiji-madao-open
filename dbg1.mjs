import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForTimeout(800);
await page.click('#btn-new');
await page.waitForTimeout(600);
try { await page.click('#chapter-card', { timeout: 4000 }); } catch (e) {}
await page.evaluate(() => {
  window.SJI_DEBUG.autoRps = true;
  window.SJI_DEBUG.fast = true;   // 快进动画/等待
  World.travel('library');
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const pos = World.npcPos('xinhui');
  if (pos) World.walkTo(pos[0], pos[1] - 40);
});
await page.waitForTimeout(2600);
await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.xinhui));
for (let i = 0; i < 10; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  await page.click('#dialog-box');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1200);
console.log('battle on:', await page.evaluate(() => window.BATTLE_ACTIVE));

// 直接接管玩家阶段：用 bot 行动而不是杀敌，看流程是否能走通
for (let round = 0; round < 3; round++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => {
    const b = window.SJI.battle;
    if (!b) return { none: true };
    return {
      round: b.round, over: b.over, phase: !!b._playerPhaseActive,
      ap: b.player.apNow, foes: b.living('enemy').length, mode: b.mode,
      logTail: b.log.slice(-3),
    };
  });
  console.log('state:', JSON.stringify(st));
  if (st.over) break;
  // 玩家阶段：待机结束
  await page.keyboard.press('Space');
}
await page.waitForTimeout(2500);
console.log('final:', await page.evaluate(() => {
  const b = window.SJI.battle;
  return b ? { over: b.over, result: b.result, round: b.round } : 'no battle';
}));
console.log('result visible:', await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden')));
await browser.close();
