/* 剧情链路测试：验证剧情重构基础链路
   （择难度 → 开局即主线 → 赏格随难度 → 章节映射链 → 歇一日 → 立传解耦 → 支线解锁 → 点将出征 → 任务点错位）
   用法：NODE_PATH=<装有 playwright 的 node_modules> node tests/quest_flow.mjs */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const HTML = path.join(ROOT, '..', 'index.html');

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

let fails = 0;
const check = (name, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
  if (!cond) fails++;
};

await page.goto(pathToFileURL(HTML).href);
await page.waitForTimeout(800);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(800);
// 战斗内自动猜拳（与 smoke 同法），否则会卡在猜拳弹层
await page.evaluate(() => { window.SJI_DEBUG.autoRps = true; });

// ===== 1. 开局难度入口 =====
await page.click('#btn-new');
await page.waitForTimeout(600);
const panelTitle = await page.evaluate(() => document.querySelector('#panel-title').textContent);
check('开卷前弹出难度选择面板', /难度/.test(panelTitle), panelTitle);
const diffBtns = await page.evaluate(() => [...document.querySelectorAll('#panel-body .card h3')].map(h => h.textContent.trim()));
check('四档难度齐列', diffBtns.length === 4, diffBtns.join(' | '));

// 选「极难」（第 4 档）
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#panel-body .card')];
  const hit = cards.find(c => c.textContent.includes('极难'));
  hit.querySelector('button').click();
});
await page.waitForTimeout(1000);
const diffApplied = await page.evaluate(() => window.SJI_SAVE.settings.lastDiff);
check('难度写入战斗层设置', diffApplied === 'extreme', 'lastDiff=' + diffApplied);
check('进入世界', await page.evaluate(() => World.active && !window.BATTLE_ACTIVE));

// ===== 2. 开局即主线：任务卡 + 令标记 =====
const qc = await page.evaluate(() => document.querySelector('#questcard').textContent);
check('任务卡显示主线首节「初执马刀」', qc.includes('初执马刀'), qc.replace(/\s+/g, ' ').slice(0, 60));
check('任务卡带主线进度', qc.includes('0/9'), qc.slice(0, 30));
const hud = await page.evaluate(() => document.querySelector('#hud-ap-v').textContent);
check('HUD「令」位显示主线进度', hud === '0/9', hud);
const mk = await page.evaluate(() => Quests.markers().map(m => ({ id: m.q.id, main: m.main, where: m.q.where, dpos: m.dpos })));
check('世界存在「令」标记', mk.some(m => m.main && m.q === undefined && m.id === 'm1'), JSON.stringify(mk.slice(0, 2)));
check('开局落在操场（主线首节所在地）', await page.evaluate(() => World.sceneId === 'playground'));

// ===== 3. 难度影响赏格：直接结算 m1 =====
const reward = await page.evaluate(() => {
  const before = G.money;
  const q = Quests.byId('m1');
  Quests.complete(q);
  return { before, after: G.money, gain: G.money - before, ch: G.ch, next: Quests.current().id, quests: Object.keys(G.quests) };
});
check('完成主线后推进到 m2', reward.next === 'm2', 'next=' + reward.next);
check('极难赏格 ×1.6 生效（8 → 13）', reward.gain === 13, 'money +' + reward.gain);
check('章节随主线推进（m1 → ch1）', reward.ch === 1, 'ch=' + reward.ch);

// ===== 4. 章节推进链（m4 后协会开张，m9 后终章） =====
const chain = await page.evaluate(() => {
  const out = [];
  ['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'].forEach(id => {
    Quests.complete(Quests.byId(id));
    out.push({ id, ch: G.ch, xiehui: !!G.flags.xiehui });
  });
  return out;
});
const at = id => chain.find(c => c.id === id);
check('m4 完成 → ch≥8 且协会开张', at('m4').ch >= 8 && at('m4').xiehui === true, JSON.stringify(at('m4')));
check('m6 完成 → ch≥12（刀禁期起）', at('m6').ch >= 12, 'ch=' + at('m6').ch);
check('m9 完成 → ch16（终章）', at('m9').ch === 16, 'ch=' + at('m9').ch);
const done = await page.evaluate(() => ({
  label: Quests.progressLabel(), cur: Quests.current(), card: document.querySelector('#questcard').textContent,
}));
check('主线全成：进度 9/9 且卡片转为收卷态', done.label === '9/9' && done.cur === null, done.label);
check('收卷态提供终章入口', done.card.includes('终章'), done.card.replace(/\s+/g, ' ').slice(0, 50));

// ===== 5. 歇一日 =====
const rest = await page.evaluate(async () => {
  const d0 = G.day, m0 = G.money;
  const btn = [...document.querySelectorAll('#placelist .place-btn')].find(b => b.textContent.includes('歇一日'));
  if (!btn) return { err: '没有歇一日按钮' };
  btn.click();
  return { has: true, d0, m0 };
});
check('底部有「歇一日」按钮（不再是「下一时段」）', rest.has === true, JSON.stringify(rest));
await page.waitForTimeout(500);
// 走完对话：选「早些睡」
for (let i = 0; i < 8; i++) {
  const st = await page.evaluate(() => ({ active: Dialog.active, choices: document.querySelectorAll('#dialog-choices .dlg-choice, #dialog-choices button').length }));
  if (!st.active) break;
  if (st.choices) await page.evaluate(() => { const b = document.querySelector('#dialog-choices .dlg-choice, #dialog-choices button'); b && b.click(); });
  else await page.click('#dialog-box');
  await page.waitForTimeout(400);
}
await page.waitForTimeout(600);
const dayAfter = await page.evaluate(() => ({ day: G.day, money: G.money, label: document.querySelector('#hud-date-main').textContent, ch: document.querySelector('#hud-period').textContent }));
check('歇一日推进日子', dayAfter.day >= 2, JSON.stringify(dayAfter));
check('HUD 显示章节名而非时段', !/早读|晚自习|午休/.test(dayAfter.ch), dayAfter.ch);

// ===== 6. 立传已解耦（未胜传主也能开撰史） =====
const writ = await page.evaluate(() => {
  const ready = Writing.duelReady(1);
  const won = Writing.duelWon(1);
  return { ready, won, hasDage: Blades.hasCard('dage') };
});
check('立传门禁已撤下（duelReady 恒真）', writ.ready === true);
check('未胜传主时 duelWon 为假（仅作软提示）', writ.won === writ.hasDage, JSON.stringify(writ));

// ===== 7. 任务点重叠错位（造出 m1 与 s_win30 同在操场 750,450 的局面） =====
const spread = await page.evaluate(() => {
  const keep = Object.assign({}, G.quests);
  G.quests = {};           // 主线回到首节 m1（操场 750,450）
  G.wins = 40;             // 满足 s_win30 条件（也是操场 750,450）
  const ms = Quests.markers().filter(m => m.q.where === 'playground');
  const out = ms.map(m => ({ id: m.q.id, pos: m.q.pos, dpos: m.dpos }));
  // 分别站在两个错位点的下方，看各自能否命中（这是玩家真实交互路径）
  const hit = out.map(m => {
    const n = Quests.nearMarker('playground', m.dpos[0], m.dpos[1] + 40, 100);
    return n ? n.m.q.id : null;
  });
  G.quests = keep;
  return { out, hit };
});
check('重叠任务点被摊开（同场景两点相距 >40px）',
  spread.out.length === 2 && Math.hypot(spread.out[0].dpos[0] - spread.out[1].dpos[0], spread.out[0].dpos[1] - spread.out[1].dpos[1]) > 40,
  JSON.stringify(spread.out));
check('两个任务点各自可被单独命中（互不遮蔽）',
  spread.hit.length === 2 && spread.hit[0] === spread.out[0].id && spread.hit[1] === spread.out[1].id,
  spread.hit.join(' / '));

// ===== 8. 立传解耦的端到端：未胜传主也能真正打开撰史面板 =====
const writOpen = await page.evaluate(() => {
  // 卷一传主是 dage；确保没胜过他
  G.blades.cards = (G.blades.cards || []).filter(c => c !== 'dage');
  // 造够四料，让卷可发
  const pool = Object.keys(SHARDS).filter(id => SHARDS[id].vol === 1).slice(0, 4);
  pool.forEach(id => { G.shards[id] = { src: 'scene', wen: SHARDS[id].wen }; });
  Writing.open(1);
  return {
    panelOpen: !document.querySelector('#panel').classList.contains('hidden'),
    title: document.querySelector('#panel-title').textContent,
    hasDage: Blades.hasCard('dage'),
  };
});
check('未胜传主也能打开撰史面板（门禁已撤）', writOpen.panelOpen === true && /撰史/.test(writOpen.title) && !writOpen.hasDage,
  JSON.stringify(writOpen));
await page.evaluate(() => UI.closePanel());
await page.waitForTimeout(400);

// ===== 9. 支线解锁 → 强力人物入册 → 点将出征 =====
const sideShow = await page.evaluate(() => {
  G.ch = 1;
  Engine.addFavorQuiet('dage', 40);      // 满足 s_dage 的 cond（好感≥20）
  Quests.render();                       // 真实流程里由 afterAction/enterScene 触发
  const open = Quests.sideOpen().map(q => q.id);
  const onMap = Quests.markers().filter(m => !m.main).map(m => m.q.id);
  return { open, onMap, card: document.querySelector('#questcard').textContent.includes('支线可接') };
});
check('条件满足后支线出现', sideShow.open.includes('s_dage'), sideShow.open.join(','));
check('支线在世界上画出「刀」标记', sideShow.onMap.includes('s_dage'), sideShow.onMap.join(','));
check('任务卡列出可接支线', sideShow.card === true);

const unlock = await page.evaluate(() => {
  const before = Quests.roster().slice();
  const res = Quests.complete(Quests.byId('s_dage'));
  return { before, after: Quests.roster().slice(), hasText: res.includes('强力人物解锁') };
});
check('完成支线后强力人物入册', unlock.after.includes('dage') && !unlock.before.includes('dage'), unlock.after.join(','));
check('结算文案点明「强力人物解锁」', unlock.hasText === true);

// 点将面板：roster > 1 时应弹选择面板，选大哥后以其本卡出战
const pick = await page.evaluate(async () => {
  const q = Quests.byId('s_luhao');
  Quests.pickAndStart(q);
  const names = [...document.querySelectorAll('#panel-body .card h3')].map(h => h.textContent.trim());
  return { title: document.querySelector('#panel-title').textContent, names };
});
check('点将面板弹出并列出可选之人', /点将出征/.test(pick.title) && pick.names.length >= 2, pick.names.join(' | ').slice(0, 80));
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#panel-body .card')];
  const hit = cards.find(c => c.textContent.includes('大哥'));
  hit.click();
});
await page.waitForTimeout(1400);
const inBattle = await page.evaluate(() => ({
  active: !!window.BATTLE_ACTIVE,
  player: window.SJI.battle && window.SJI.battle.player.charId,
  questId: window.SJI.battle && window.SJI.battle.cfg.questId,
}));
check('选大哥后以其本卡开战', inBattle.active === true && inBattle.player === 'dage' && inBattle.questId === 's_luhao',
  JSON.stringify(inBattle));
await page.waitForTimeout(2600);   // 等猜拳自动走完、进入玩家阶段
await page.evaluate(() => { window.SJI_DEBUG && window.SJI_DEBUG.killEnemies && window.SJI_DEBUG.killEnemies(); });
for (let i = 0; i < 14; i++) {
  const done = await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'));
  if (done) break;
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
}
const afterSide = await page.evaluate(() => ({
  done: !!G.quests.s_luhao,
  result: window.SJI.battle && window.SJI.battle.result,
  rare: Blades.rareList().slice(),
}));
check('支线战斗结算并记为完成', afterSide.done === true, JSON.stringify(afterSide));
await page.click('#r-menu');
await page.waitForTimeout(900);
check('支线后回到校园', await page.evaluate(() => !window.BATTLE_ACTIVE && World.active));

console.log(errors.length ? '\n页面错误:\n' + errors.join('\n') : '\n无页面错误');
console.log(fails === 0 ? '\n=== 剧情链路 ALL PASS ===' : `\n!! ${fails} 项失败`);
await browser.close();
process.exit(errors.length ? 1 : fails);
