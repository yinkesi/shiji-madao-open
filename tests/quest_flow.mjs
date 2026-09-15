/* 剧情链路测试：验证剧情重构基础链路
   （择难度 → 开局即主线 → 赏格随难度 → 章节映射链 → 歇一日 → 立传解耦 → 支线解锁 → 点将出征 → 任务点错位）
   用法：NODE_PATH=<装有 playwright 的 node_modules> node tests/quest_flow.mjs */
// ================================================================
// 【这个文件是干嘛的】
// 剧情链路测试：把剧情系统的关键链路从头到尾走一遍。它和
// smoke.mjs 一样用 Playwright 遥控真浏览器（Playwright 是什么、
// page.evaluate 怎么用，见 smoke.mjs 文件头，此处不重复），区别
// 在于专测"剧情与任务"这条线，战斗只用"天降正义"作弊速通。
// 覆盖的链路（按测试段落顺序）：
//   择难度 → 开局即主线 → 赏格随难度 → 章节随主线推进 → 歇一日
//   → 立传解耦 → 任务点错位 → 支线解锁 → 点将出征 → 剧情文本
//   齐备 → 战前/战后对话真实播放 → 老档迁移
//
// 【新手阅读提示】
// 1) 大量断言直接读 JS 全局（G、Quests、Writing、Blades…）：
//    page.evaluate 就是在网页里跑代码，游戏内部状态一览无余。
// 2) 等动画/回调一律用 waitFor 轮询页面状态，不用固定 sleep 硬等
//    （动画时长是魔数，睡 700ms 时好时坏）。
// ================================================================
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const HTML = path.join(ROOT, '..', 'index.html');

// ---------- 测试环境搭建 ----------
// 与 smoke.mjs 同款：无头 Chrome + 1280x800 视口 + 报错监听 +
// 自制断言器 check。ROOT 定位在 tests/ 目录，页面取上一级的
// index.html（本测试只跑源码版）。
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => { errors.push('PAGEERROR: ' + e.message); console.log('  [页面错误] ' + e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push('CONSOLE: ' + m.text()); console.log('  [控制台错误] ' + m.text()); } });

let fails = 0;
const check = (name, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
  if (!cond) fails++;
};

/* 轮询等待：对话结束后的回调挂在弹簧动画里，固定 sleep 是临界值 */
const waitFor = async (fn, tries = 30, gap = 150) => {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(gap);
  }
  return false;
};
const clearDialog = async (max = 40, tag = '') => {
  for (let i = 0; i < max; i++) {
    const st = await page.evaluate(() => ({
      active: typeof Dialog !== 'undefined' && Dialog.active,
      typing: document.querySelector('#dialog-text').classList.contains('typing'),
      text: document.querySelector('#dialog-text').textContent.slice(0, 12),
    }));
    if (!st.active) { if (tag) console.log(`  [clearDialog${tag}] 第 ${i} 次后关闭`); return true; }
    if (tag && i < 26) console.log(`  [clearDialog${tag}] #${i}`, JSON.stringify(st));
    await page.click('#dialog-box');
    await page.waitForTimeout(220);
  }
  if (tag) console.log(`  [clearDialog${tag}] 点满 ${max} 次仍未关闭`);
  return false;
};

// 先清一次 localStorage 再刷新：保证从"零存档"的干净状态开测
// （上一次运行留下的进度会污染断言）。顺带打开 autoRps 调试开关，
// 让战斗里的猜拳自动出、不卡弹层。
await page.goto(pathToFileURL(HTML).href);
await page.waitForTimeout(800);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(800);
// 战斗内自动猜拳（与 smoke 同法），否则会卡在猜拳弹层
await page.evaluate(() => { window.SJI_DEBUG.autoRps = true; });

// ===== 1. 开局难度入口 =====
// 点「开卷」应先弹难度面板、五档齐列；脚本选「极难」（第 4 档），
// 难度应写进战斗层设置（lastDiff=extreme）并正常进入世界。
await page.click('#btn-new');
await page.waitForTimeout(600);
const panelTitle = await page.evaluate(() => document.querySelector('#panel-title').textContent);
check('开卷前弹出难度选择面板', /难度/.test(panelTitle), panelTitle);
const diffBtns = await page.evaluate(() => [...document.querySelectorAll('#panel-body .card h3')].map(h => h.textContent.trim()));
check('五档难度齐列', diffBtns.length === 5, diffBtns.join(' | '));

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
// 新档不该"开局没事做"：任务卡应直接挂着主线首节「初执马刀」、
// 带 0/9 进度，HUD 同步；世界上画出 m1 的「令」标记，出生地在
// 主线所在的操场。
const qc = await page.evaluate(() => document.querySelector('#questcard').textContent);
check('任务卡显示主线首节「初执马刀」', qc.includes('初执马刀'), qc.replace(/\s+/g, ' ').slice(0, 60));
check('任务卡带主线进度', qc.includes('0/9'), qc.slice(0, 30));
const hud = await page.evaluate(() => document.querySelector('#hud-ap-v').textContent);
check('HUD「令」位显示主线进度', hud === '0/9', hud);
const mk = await page.evaluate(() => Quests.markers().map(m => ({ id: m.q.id, main: m.main, where: m.q.where, dpos: m.dpos })));
check('世界存在「令」标记', mk.some(m => m.main && m.q === undefined && m.id === 'm1'), JSON.stringify(mk.slice(0, 2)));
check('开局落在操场（主线首节所在地）', await page.evaluate(() => World.sceneId === 'playground'));

// ===== 3. 难度影响赏格：直接结算 m1 =====
// 不真打：直接调 Quests.complete(m1) 结算。极难档赏格 ×1.6
// （8→13）应生效，主线自动推进到 m2，章节 ch 0→1。
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
// 连续 complete 掉 m2~m9，验证"任务节 → 章节数"的映射链：
// m4 后协会开张、m6 进入刀禁期（ch≥12）、m9 收卷进终章（ch16）；
// 主线全成后进度 9/9，任务卡转为收卷态并提供终章入口。
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
// 底部地点条末尾应常驻「歇一日」按钮（而非旧的「下一时段」）；
// 点开后把过场对话走完（有选项就选第一项"早些睡"），日子应推进，
// HUD 日期位改显章节名而非"早读/午休"这类时段。
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
// duelReady 恒为真（门禁已撤）；duelWon 只如实反映"胜没胜过传主"，
// 供界面做软提示，不再拦人。
const writ = await page.evaluate(() => {
  const ready = Writing.duelReady(1);
  const won = Writing.duelWon(1);
  return { ready, won, hasDage: Blades.hasCard('dage') };
});
check('立传门禁已撤下（duelReady 恒真）', writ.ready === true);
check('未胜传主时 duelWon 为假（仅作软提示）', writ.won === writ.hasDage, JSON.stringify(writ));

// ===== 7. 任务点重叠错位（造出 m1 与 s_win30 同在操场 750,450 的局面） =====
// 两个任务恰好落同一点会让玩家点谁全凭运气：系统应把重叠标记
// 自动"摊开"（同场景两点相距 >40px），且站在各自点位下方能分别
// 命中、互不遮蔽。测试先备份 G.quests、伪造条件（wins=40 满足
// s_win30 的解锁条件），验完原样还原，不污染后续段落。
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
// 摘掉大哥的卡确保"未胜传主"，伪造四枚卷一碎片把卷凑齐，再调
// Writing.open(1)：撰史面板应能真正打开（标题含"撰史"）。
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
// 给大哥刷好感（addFavorQuiet 40，过 s_dage 的"好感≥20"门槛），
// 再按真实流程刷新任务面板：支线应出现在可接列表、世界画出
// 「刀」标记、任务卡列出"支线可接"；complete 后大哥入册（可被
// 点将），结算文案点明「强力人物解锁」。
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

// ===== 10. 剧情文本：每节都必须有专属的战前/战胜/战败/挑衅台词 =====
// 内容体检三连：主线+支线每一节都须备齐 pre/post/postLose/foe
// 台词；剧情总字量须超过 4000 字（防止缩水回通用句）；通用兜底
// 台词一个都不许漏进任何一节。随后是"奖励可发放性"体检：任务
// 里写的稀有刀卡/解锁人物必须真实存在——曾出过奖励写了 rare
// 却无对应条目、打通了也拿不到还不报错的坑。
const story = await page.evaluate(() => {
  const miss = [];
  let chars = 0;
  Quests.all().forEach(q => {
    ['pre', 'post', 'postLose'].forEach(k => {
      if (!Array.isArray(q[k]) || !q[k].length) miss.push(q.id + '.' + k);
      else chars += q[k].reduce((a, s) => a + (s.text || '').length, 0);
    });
    if (!q.foe || !q.foe.who || !Array.isArray(q.foe.pool) || !q.foe.pool.length) miss.push(q.id + '.foe');
    else chars += q.foe.pool.join('').length;
    chars += (q.goal || '').length + (q.hint || '').length;
  });
  // 通用兜底句不得出现在任何节里（否则说明那节没写专属台词）
  const generic = ['既来之，则战之。', '重开重开，谁怕谁。'];
  const leaked = Quests.all().filter(q => q.foe && q.foe.pool.some(l => generic.includes(l))).map(q => q.id);
  return { n: Quests.all().length, miss, chars, leaked };
});
check(`主线+支线共 ${story.n} 节，全部备齐 pre/post/postLose/foe`, story.miss.length === 0, story.miss.join(',') || '齐');
check('剧情文本体量 > 4000 字（重构前仅 283 字）', story.chars > 4000, story.chars + ' 字');
check('无任何节沿用通用兜底台词', story.leaked.length === 0, story.leaked.join(',') || '无');

// 奖励可发放性：曾出现支线奖励写 rare:'b_horse' 但 RARE_BOONS 无此条目 → 打通了也什么都拿不到、还不报错
const rareOk = await page.evaluate(() => {
  const bad = [];
  Quests.all().forEach(q => {
    const r = q.reward && q.reward.rare;
    if (!r) return;
    if (!Blades.RARE_BOONS[r]) bad.push(q.id + ' 缺 RARE_BOONS');
    if (!window.SJI_DATA.BOONS.some(b => b.id === r)) bad.push(q.id + ' 缺 BOONS');
    if (q.reward.unlock && !window.SJI_DATA.CHARACTERS[q.reward.unlock]) bad.push(q.id + ' 解锁人物不存在');
  });
  return bad;
});
check('所有任务的稀有刀卡/解锁人物都能真正兑现', rareOk.length === 0, rareOk.join(', ') || '齐');

// ===== 11. 战前/战后对话真的会播（走真实链路：走近 → 战前 → 点将 → 开战 → 回世界 → 战后） =====
// 不走捷径，完整打一遍支线 s_luhao：走近弹出战前对话 → 清完
// 对话 → 弹"点将出征"面板（名册里已有第 9 段解锁的大哥）→ 点大哥
// 以其本卡开战 →"天降正义"取胜结算 → 回到世界后应自动播出该节
// 专属的战后收束一幕。
// 先清掉第 4 节直接 complete() 留下的挂起状态（章节里程碑卡 + 战后对话），避免串场；
// 真实流程里这两者都由同一场战斗的 onResult/onDone 成对消费，不会残留。
await page.evaluate(() => { Engine.takePendingChapter(); Quests.takePendingPost(); });
await page.evaluate(() => World.travel('dorm'));
await page.waitForTimeout(700);
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => Main.onQuest(Quests.byId('s_luhao')));
  await page.waitForTimeout(850);
  if (await page.evaluate(() => Dialog.active)) break;
}
const preText = await page.evaluate(() => (Dialog.active ? document.querySelector('#dialog-text').textContent : ''));
check('走近支线后弹出战前对话', await page.evaluate(() => Dialog.active), preText.slice(0, 24));
/* 打字机动画会让一行吃两次点击（先补完、再翻页），故给足次数；只以「对话结束」为退出条件 */
await clearDialog(40, ':s_luhao');
// 名册 > 1 时应弹点将面板；对话结束回调经弹簧动画触发，须轮询等
await waitFor(() => !!window.BATTLE_ACTIVE || /点将出征/.test(document.querySelector('#panel-title').textContent));
/* 注意：#panel-title 关面板后不会清空，须连「面板可见」一起判 */
const pickPanel = await page.evaluate(() => ({
  on: !document.querySelector('#panel').classList.contains('hidden'),
  title: document.querySelector('#panel-title').textContent,
  names: [...document.querySelectorAll('#panel-body .card h3')].map(h => h.textContent.trim()),
  battle: !!window.BATTLE_ACTIVE,
  dlg: typeof Dialog !== 'undefined' && Dialog.active,
  dlgVis: !document.querySelector('#dialog').classList.contains('hidden'),
  roster: Quests.roster().length,
}));
check('点将面板弹出并列出可选之人', pickPanel.on && /点将出征/.test(pickPanel.title),
  JSON.stringify({ on: pickPanel.on, title: pickPanel.title, battle: pickPanel.battle, dlg: pickPanel.dlg, roster: pickPanel.roster }));
check('可选之人含支线解锁的「大哥」', pickPanel.names.some(n => n.includes('大哥')), pickPanel.names.length + ' 人');
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
// 战后收束一幕应在回到世界后自动播出
const postShown = await waitFor(() => typeof Dialog !== 'undefined' && Dialog.active);
const postText = await page.evaluate(() => (Dialog.active ? document.querySelector('#dialog-text').textContent : ''));
check('回到世界后自动播出战后收束一幕', postShown, postText.slice(0, 24));
const postAll = await page.evaluate(async () => {
  let acc = '';
  for (let i = 0; i < 24; i++) {
    if (!Dialog.active) break;
    acc += document.querySelector('#dialog-text').textContent;
    document.querySelector('#dialog-box').click();
    await new Promise(r => setTimeout(r, 220));
  }
  return acc;
});
check('战后一幕内容为该节专属（非通用句）',
  /桌洞里抢回|锦绣|绍铭/.test(postAll), postAll.slice(0, 40));

// ===== 12. 老档迁移：有章节进度、无任务记录（旧格式存档） =====
// 手工造一份"旧格式"存档（有 ch/wins/刀谱等进度，但没有新系统的
// 任务记录字段）塞进 localStorage 再刷新：应出现「继续上局」；
// 读档后旧进度原样保留、章节不倒退，任务系统按新规则从 m1 重新
// 接起；按章节补发协会解锁（ch≥8 → 开张）；弹一次迁移说明且
// 只弹这一次（标记消费掉）。
const LEGACY = {
  ver: 1, ch: 9, day: 3, periodIdx: 2, ap: 1, apMax: 3,
  wen: 30, rep: 70, money: 40,
  favor: { dage: 50, xinhui: 40 }, shards: { sh_shuban: { src: 'scene', wen: 5 } },
  doneEvents: ['ev_shuban'], vols: {}, giftToday: {}, chatCount: 0, caughtToday: false,
  bag: { snack: 1 }, ach: { ach_duel1: 1 },
  flags: { visitedScenes: ['library'], metPeople: ['dage'], prologue: true, duelBanDays: 0 },
  wins: 12, duelsLost: 3,
  blades: { cards: ['xinhui', 'dage'], equip: 'xinhui', rare: ['b_killheal'] },
  upgrades: { hp: 2, knife: 1 }, trialDone: {}, duelDone: {},
  settings: { muted: false, motion: 'full', speed: 1 },
  stats: { chats: 5, gifts: 2, reads: 1, gossip: 0, caught: 0, listened: 0, direct: 0, curve: 0, plays: {}, published: 0 },
};
await page.evaluate(s => { localStorage.setItem('shiji_cqb_v1', JSON.stringify(s)); }, LEGACY);
await page.reload();
await page.waitForTimeout(900);
const canContinue = await page.evaluate(() => !document.querySelector('#btn-continue').classList.contains('hidden'));
check('旧档可被识别（出现「继续上局」）', canContinue === true);
await page.click('#btn-continue');
await page.waitForTimeout(1500);
const migrated = await page.evaluate(() => ({
  ch: G.ch, day: G.day, wins: G.wins, money: G.money,
  cards: G.blades.cards.slice(), rare: G.blades.rare.slice(),
  upgrades: JSON.parse(JSON.stringify(G.upgrades)),
  roster: Quests.roster().slice(),
  nQuests: Object.keys(G.quests).length,
  xiehui: !!G.flags.xiehui,
  cur: Quests.current() && Quests.current().id,
  label: Quests.progressLabel(),
  flag: !!G.flags.legacyMigrated,
  toasts: document.querySelector('#toasts').textContent,
}));
check('旧档进度原样保留（胜场/刀谱/稀有卡/修炼/钱）',
  migrated.wins === 12 && migrated.cards.includes('dage') && migrated.rare.includes('b_killheal')
  && migrated.upgrades.hp === 2 && migrated.money === 40,
  JSON.stringify({ wins: migrated.wins, cards: migrated.cards, rare: migrated.rare, up: migrated.upgrades }));
check('旧档章节不倒退（ch 仍为 9）', migrated.ch >= 9, 'ch=' + migrated.ch);
check('主线九节从头接起（当前 m1、任务记录为空）',
  migrated.cur === 'm1' && migrated.nQuests === 0 && migrated.label === '0/9', migrated.label);
check('按章节补齐协会解锁（ch≥8 → 协会开张）', migrated.xiehui === true);
check('给出迁移说明提示', /旧档已并入刀史/.test(migrated.toasts), migrated.toasts.slice(0, 40));
check('迁移提示只出一次（标记已消费）', migrated.flag === false);

// ---------- 收尾 ----------
// 与 smoke.mjs 相同的收尾：页面报错非空判整体失败、
// 进程退出码 = 失败断言数（0 即全过）。
console.log(errors.length ? '\n页面错误:\n' + errors.join('\n') : '\n无页面错误');
console.log(fails === 0 ? '\n=== 剧情链路 ALL PASS ===' : `\n!! ${fails} 项失败`);
await browser.close();
process.exit(errors.length ? 1 : fails);
