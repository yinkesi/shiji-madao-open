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
await page.click('#btn-new'); await page.waitForTimeout(600);
await page.evaluate(() => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes('开卷')); c && c.click(); });
await page.waitForTimeout(500);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await page.waitForTimeout(700);
// 直接口袋：m1-m8 全部完成（模拟终焉之战刚打完的状态）
await page.evaluate(() => {
  for (let i = 1; i <= 8; i++) G.quests['m' + i] = true;
  G.ch = 15; Save.write(); Engine.syncChapter(); Engine.syncWorldFlags();
  World.travel('gate');
});
await page.waitForTimeout(800);
console.log('1) 当前主线:', await page.evaluate(() => { const c = Quests.current(); return c ? c.id + '@' + c.where : 'null(全部完成)'; }));
console.log('2) 任务卡文本:', await page.evaluate(() => (document.querySelector('#questcard').textContent || '').replace(/\s+/g, ' ').slice(0, 80)));
// 接 m9：直接走 onQuest → 点将 → 选音克思
await page.evaluate(() => { window.SJI_DEBUG.autoRps = true; Quests.pickAndStart(Quests.byId('m9')); });
await page.waitForTimeout(700);
console.log('3) 点将面板弹出:', await page.evaluate(() => !document.querySelector('#panel').classList.contains('hidden')));
await page.evaluate(() => { const cards = [...document.querySelectorAll('#panel .card')]; const me = cards.find(c => c.textContent.includes('音克思')); if (me) me.click(); });
await page.waitForTimeout(1200);
console.log('4) m9 开战:', JSON.stringify(await page.evaluate(() => ({ active: !!window.BATTLE_ACTIVE, questId: window.SJI.battle && window.SJI.battle.cfg.questId, diff: window.SJI.battle && window.SJI.battle.diff, rule: window.SJI.battle && window.SJI.battle.cfg.rule && window.SJI.battle.cfg.rule.id }))));
// 打完 m9
for (let i = 0; i < 16; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(300); }
await page.evaluate(() => window.SJI_DEBUG.killEnemies());
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'))) break;
  await page.keyboard.press('Space'); await page.waitForTimeout(700);
}
await page.waitForTimeout(1800);
console.log('5) m9 结果:', JSON.stringify(await page.evaluate(() => ({ result: window.SJI.battle && window.SJI.battle.result, done: !!G.quests.m9, current: Quests.current() ? Quests.current().id : 'null(主线全通)' }))));
// 通关后：还能自由约战吗？
await page.click('#r-menu'); await page.waitForTimeout(800);
await page.evaluate(() => { World.travel('library'); });
await page.waitForTimeout(700);
await page.evaluate(() => { const p = World.npcPos('xinhui'); if (p) World.walkTo(p[0], p[1] - 40); });
await page.waitForTimeout(2000);
console.log('5b) 诊断:', JSON.stringify(await page.evaluate(() => ({
  ch: G.ch, ban: G.flags.duelBanDays, period: Engine.period(), scene: World.sceneId,
  screenGame: !document.querySelector('#screen-game').classList.contains('hidden'),
}))));
// 打点：监控 startBattle / Dialog.play / knifeBanRiskOk 链路
await page.evaluate(() => {
  window.__trace = [];
  const origStart = SJI_UI.startBattle.bind(SJI_UI);
  SJI_UI.startBattle = (cfg) => { window.__trace.push('startBattle:' + cfg.title); return origStart(cfg); };
  const origPlay = Dialog.play.bind(Dialog);
  Dialog.play = (script, done) => { window.__trace.push('dialog:' + (script[0] && script[0].who) + '/' + script.length + '步'); return origPlay(script, done); };
  const origChoice = document.getElementById('dialog-choices');
});
for (let attempt = 0; attempt < 5; attempt++) {
  await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.xinhui));
  await page.waitForTimeout(700);
  if (await page.evaluate(() => Dialog.active)) break;
  // 可能在走位，继续
}
console.log('6) 约战对话:', await page.evaluate(() => Dialog.active));
console.log('6a) 对话内容:', JSON.stringify(await page.evaluate(() => ({
  name: document.querySelector('#dialog-name') ? document.querySelector('#dialog-name').textContent : null,
  text: document.querySelector('#dialog-text') ? document.querySelector('#dialog-text').textContent.slice(0, 60) : null,
  choices: [...document.querySelectorAll('#dialog-choices .choice-btn')].map(b => b.textContent.slice(0, 20)),
}))));
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  // 有选项就点选项
  const choice = await page.$('#dialog-choices .choice-btn');
  if (choice) { await choice.click(); } else { await page.click('#dialog-box'); }
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1200);
console.log('6b) 处理完巡查后对话仍在:', await page.evaluate(() => Dialog.active), ' 战斗已开:', await page.evaluate(() => !!window.BATTLE_ACTIVE));
console.log('6c) 链路打点:', JSON.stringify(await page.evaluate(() => ({ trace: window.__trace, ban: G.flags.duelBanDays, bag: G.bag }))));
console.log('7) 约战开战:', await page.evaluate(() => !!window.BATTLE_ACTIVE && !!window.SJI.battle));
await browser.close();
