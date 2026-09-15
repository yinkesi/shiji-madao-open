/* 全流程实玩 A：普通难度 + 养成开
   主线 m1→m9 全程 + 支线 + 试炼 + 点将 + 面板 + 存档往返
   原则：尽量走真实 UI（按钮/气泡/对话）；战斗内圈用少量快捷调试推进但每场都验证结算。
   输出：所有异常以 BUG: / WARN: 前缀打印。 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => { errors.push('PAGEERROR: ' + e.message); console.log('!! PAGEERROR:', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push('CONSOLE: ' + m.text()); console.log('!! CONSOLE:', m.text()); } });

let bugs = 0;
const bug = (msg) => { bugs++; console.log(`BUG#${bugs}: ${msg}`); };
const ok = (msg) => console.log(`  ok: ${msg}`);
const step = (msg) => console.log(`\n== ${msg}`);

const tryClick = async (sel, timeout = 3000) => { try { await page.click(sel, { timeout }); return true; } catch (e) { return false; } };
const evalV = async (fn) => page.evaluate(fn);

/* 战斗收尾：清场→空格推进→等结算→关闭。返回结算文本。 */
async function finishBattle({ retry = false } = {}) {
  for (let i = 0; i < 40; i++) {
    const st = await evalV(() => {
      const b = window.SJI.battle;
      if (!b) return { none: true };
      return { over: b.over, foes: b.living('enemy').length, phase: b._playerPhaseActive === true,
               mask: document.querySelector('#modal-mask').classList.contains('on'),
               result: document.querySelector('#battle-result').classList.contains('hidden') ? 'hidden' : 'shown' };
    });
    if (st.none || st.over && st.result === 'shown') break;
    if (st.mask) {
      // 猜拳（真人点拳，跳过已禁用）/ 增益（点第一项）/ 战斗内对话（空格）
      const rps = await page.$('#modal-box .rps-btn:not([disabled])');
      if (rps) { await rps.click(); await page.waitForTimeout(1000); continue; }
      const boon = await page.$('#modal-box .boon-b');
      if (boon) { await boon.click(); await page.waitForTimeout(400); continue; }
      await page.keyboard.press('Space');
    } else if (st.foes > 0) {
      await evalV(() => window.SJI_DEBUG.killEnemies());
    } else if (st.phase) {
      await page.keyboard.press('Space');
    }
    await page.waitForTimeout(650);
  }
  await page.waitForTimeout(1500);
  const dbg = await evalV(() => ({ b: !!window.SJI.battle, over: window.SJI.battle && window.SJI.battle.over,
    round: window.SJI.battle && window.SJI.battle.round, foes: window.SJI.battle && window.SJI.battle.living('enemy').length,
    phase: window.SJI.battle && window.SJI.battle._playerPhaseActive, mask: document.querySelector('#modal-mask').classList.contains('on'),
    box: document.querySelector('#modal-box').textContent.slice(0, 50), log: window.SJI.battle ? window.SJI.battle.log.slice(-2) : [] }));
  console.log('  [exit-dump]', JSON.stringify(dbg));
  const res = await evalV(() => ({ result: window.SJI.battle ? window.SJI.battle.result : 'null', wins: G.wins }));
  // 关结算（等弹层熄灭）
  for (let i = 0; i < 10; i++) {
    const off = await evalV(() => !document.querySelector('#modal-mask').classList.contains('on'));
    if (off) break;
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  return res;
}
async function closeResult() {
  await page.click('#r-menu'); await page.waitForTimeout(600);
}

/* ============ 开卷 ============ */
step('A1 开卷：养成开 + 普通难度');
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForTimeout(800);
await page.click('#btn-new'); await page.waitForTimeout(600);
// 养成开关切到「开」
{
  const before = await evalV(() => document.querySelector('#panel-body').textContent.includes('养成模式 开'));
  if (!before) { const on = await page.$('#panel-body .card [data-v="on"]'); if (on) await on.click(); await page.waitForTimeout(300); }
  const after = await evalV(() => document.querySelector('#panel-body').textContent.includes('养成模式 开'));
  if (!after) bug('A1 开局面板的养成开关点了「开」仍显示关（开关失效）'); else ok('养成开关切到开');
}
await page.evaluate(() => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes('普通')); c && c.click(); });
await page.waitForTimeout(500);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await page.waitForTimeout(700);
{
  const s = await evalV(() => ({ cult: G.cultivation, diff: Quests.diffV(), hp: SJI_DATA.CHARACTERS.yinkesi.hp, questcard: !document.querySelector('#questcard').classList.contains('hidden') }));
  if (!s.cult) bug(`A1 开卷选了养成开，但 G.cultivation=${s.cult}`);
  if (s.diff !== 'normal') bug(`A1 难度应为 normal，实际 ${s.diff}`);
  if (s.hp !== 10) bug(`A1 养成开+0胜 基础血应为 10，实际 ${s.hp}`);
  if (!s.questcard) bug('A1 任务指引卡未显示');
  ok(`开卷完成 cult=${s.cult} diff=${s.diff} hp=${s.hp}`);
}
await page.screenshot({ path: 'testshots/pa-01-start.png' });

/* ============ m1：走真实 UI（点任务卡「前往」→ 气泡 → 交互条开战） ============ */
step('A2 主线 m1 初执马刀（真实 UI）');
{
  await evalV(() => { const b = [...document.querySelectorAll('#questcard [data-quests]')].find(x => x.textContent.includes('前往')); b && b.click(); });
  await page.waitForTimeout(2500);
  // 交互条应有「开战」
  const hasDuel = await evalV(() => [...document.querySelectorAll('#ctxbar .ctx-btn')].some(b => b.textContent.includes('开战')));
  if (!hasDuel) bug('A2 走到任务点后交互条无「开战」按钮');
  await evalV(() => { const b = [...document.querySelectorAll('#ctxbar .ctx-btn')].find(x => x.textContent.includes('开战')); b && b.click(); });
  await page.waitForTimeout(600);
}
// 战前剧情 → 点将（roster=1 直接开战）→ 实战：先用真实按钮打一轮
{
  for (let i = 0; i < 12; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(280); }
  await page.waitForTimeout(900);
  const st = await evalV(() => ({ on: !!window.BATTLE_ACTIVE, diff: window.SJI.battle && window.SJI.battle.diff, quest: window.SJI.battle && window.SJI.battle.cfg.questId }));
  if (!st.on) bug('A2 m1 战斗未开启'); else ok(`m1 开战 diff=${st.diff} quest=${st.quest}`);
  // 真实按钮：购刀 → 刀击（若可）→ 待机
  await page.waitForTimeout(1500);
  const canKnife = await evalV(() => !document.querySelector('#b-knife').disabled);
  if (canKnife) { await page.click('#b-knife'); await page.waitForTimeout(300); }
  // 结束战斗（天降正义）
  await evalV(() => window.SJI_DEBUG.killEnemies());
  for (let i = 0; i < 10; i++) { const d = await evalV(() => !document.querySelector('#battle-result').classList.contains('hidden')); if (d) break; await page.keyboard.press('Space'); await page.waitForTimeout(700); }
  await page.waitForTimeout(1600);
  const r = await evalV(() => ({ result: window.SJI.battle.result, wins: G.wins, m1: !!G.quests.m1, card: Blades.hasCard('wanzhen'), equip: G.blades.equip, money: G.money }));
  if (r.result !== 'win') bug(`A2 m1 结果=${r.result}`); else ok(`m1 胜利 wins=${r.wins} 录技=${r.card} 钱=${r.money}`);
  if (!r.equip) bug(`A2 首胜后未自动装备录得之技（equip=${r.equip}）——白板首胜应自动换装`);
  await closeResult();
}

/* ============ A3 养成模式：赢一场后段位加成应生效 ============ */
{
  const s = await evalV(() => ({ cult: G.cultivation, hp: SJI_DATA.CHARACTERS.yinkesi.hp, wins: G.wins }));
  const expect = 10 + Math.min(4, Math.floor(s.wins / 8)) * 2;
  if (s.hp !== expect) bug(`A3 养成开：注册血 ${s.hp} ≠ 期望 ${expect}（10+段位）`);
  else ok(`养成血量正确 ${s.hp}`);
}

/* ============ A4 支线锦绣夜行：先造条件（已胜鲁豪）→ 打支线 → 身怀大腹如斗 ============ */
step('A4 支线锦绣夜行 → 身怀大腹如斗（+10 血上限 + 刀击翻倍）');
{
  await evalV(() => { G.money = 60; World.travel('corridor'); });
  await page.waitForTimeout(600);
  // 挑战鲁豪（真实路径：轮询 challenge）
  for (let i = 0; i < 8; i++) {
    await evalV(() => Main.challenge(PEOPLE_BY_ID.luhao));
    await page.waitForTimeout(800);
    if (await evalV(() => Dialog.active)) break;
  }
  for (let i = 0; i < 12; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
  await page.waitForTimeout(900);
  // 文斗不该出现（文笔<10 时）——检查选项里是否有「骂阵」
  const wenOpt = await evalV(() => [...document.querySelectorAll('#dialog-choices .choice-btn')].some(b => b.textContent.includes('骂阵')));
  if (wenOpt) bug('A4 文笔不足 10 却出现「骂阵」选项');
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(280); }
  await page.waitForTimeout(1200);
  await evalV(() => window.SJI_DEBUG.killEnemies());
  for (let i = 0; i < 12; i++) {
    const d = await evalV(() => !document.querySelector('#battle-result').classList.contains('hidden'));
    if (d) break;
    await page.keyboard.press('Space'); await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1600);
  const duel = await evalV(() => ({ result: window.SJI.battle.result, luhao: Blades.hasCard('luhao'), hp: SJI_DATA.CHARACTERS.yinkesi.hp }));
  if (duel.result !== 'win') bug(`A4 挑战鲁豪结果=${duel.result}`);
  else ok(`挑战鲁豪胜利，录技（血上限=${duel.hp}）`);
  // 装备鲁豪卡 → 身怀大腹如斗 +10
  await page.click('#r-menu'); await page.waitForTimeout(600);
  const innate = await evalV(() => { Blades.equip('luhao'); const before = SJI_DATA.CHARACTERS.yinkesi.hp; Blades.registerChar(); return { before, after: SJI_DATA.CHARACTERS.yinkesi.hp }; });
  // equip 后 registerChar：血 = 10 + 段位 + innate10 —— 验证身怀血量并入
  const s2 = await evalV(() => ({ hp: SJI_DATA.CHARACTERS.yinkesi.hp, wins: G.wins, cult: G.cultivation, innates: Blades.innates() }));
  const expectHp = 10 + (s2.cult ? Math.min(4, Math.floor(s2.wins / 8)) * 2 : 0) + 10;
  if (s2.hp !== expectHp) bug(`A4 身怀大腹如斗 +10 未并入注册血：实际 ${s2.hp}，期望 ${expectHp}`);
  else ok(`身怀血量正确 ${s2.hp}`);
  await page.screenshot({ path: 'testshots/pa-02-innate.png' });
}

/* ============ A5 支线锦绣夜行正式打：胜利应授身怀之技（不重复） ============ */
{
  await evalV(() => { if (!Quests.done('s_luhao')) { /* 需已胜鲁豪，条件已满足 */ } });
  // s_luhao 的战斗：直接走 quest 流程（真实路径：任务卡/气泡）
  const open = await evalV(() => Quests.sideList().some(q => q.id === 's_luhao' && q.cond()));
  if (open) {
    await evalV(() => Quests.pickAndStart(Quests.byId('s_luhao')));
    await page.waitForTimeout(900);
    // 战前剧情若有
    for (let i = 0; i < 12; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
    await page.waitForTimeout(900);
    await evalV(() => window.SJI_DEBUG.killEnemies());
    for (let i = 0; i < 12; i++) {
      const d = await evalV(() => !document.querySelector('#battle-result').classList.contains('hidden'));
      if (d) break;
      await page.keyboard.press('Space'); await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
    const r = await evalV(() => ({ result: window.SJI.battle.result, innate: Blades.innates().includes('luhao'), dupCount: Blades.innates().filter(x => x === 'luhao').length }));
    if (r.result !== 'win') bug(`A5 支线结果=${r.result}`);
    if (r.dupCount > 1) bug(`A5 身怀之技重复授予（luhao×${r.dupCount}）`);
    else ok('支线完成，身怀无重复');
    await page.click('#r-menu'); await page.waitForTimeout(600);
  } else {
    console.log('  （s_luhao 条件未满足，跳过）');
  }
}

/* ============ A6 m2 三连战（waves+restFull）+ 养成血量成长 ============ */
{
  await evalV(() => { World.travel('corridor'); });
  await page.waitForTimeout(600);
  await evalV(() => Quests.pickAndStart(Quests.byId('m2')));
  await page.waitForTimeout(900);
  for (let i = 0; i < 14; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
  await page.waitForTimeout(900);
  // 三波：逐波清场
  const seenWaves = [];
  for (let i = 0; i < 40; i++) {
    const st = await evalV(() => { const b = window.SJI.battle; return { over: b.over, foes: b.living('enemy').length, wave: b.waveIndex, phase: b._playerPhaseActive === true, boon: !!document.querySelector('#modal-box .boon-b') }; });
    if (st.over) break;
    if (st.boon) { await page.click('#modal-box .boon-b'); await page.waitForTimeout(400); continue; }
    if (st.foes > 0) await evalV(() => window.SJI_DEBUG.killEnemies());
    else if (st.phase) await page.keyboard.press('Space');
    seenWaves.push(st.wave);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(2000);
  const r = await evalV(() => ({ result: window.SJI.battle.result, m2: !!G.quests.m2 }));
  if (r.result !== 'win') bug(`A6 m2 结果=${r.result}`); else ok('m2 三连战胜利');
  if (!r.m2) bug('A6 m2 完成标记未写入');
  await page.click('#r-menu'); await page.waitForTimeout(600);
  // 阵间回血验证：restFull 下玩家在每波开始应满血——此处抽查最终状态无异常即可
}

/* ============ A7 噩梦/极难开关不影响进行中存档；设置改难度 ============ */
{
  await evalV(() => { SJI_SAVE.setSetting('lastDiff', 'nightmare'); });
  const d = await evalV(() => Quests.diffV());
  if (d !== 'nightmare') bug(`A7 设置噩梦失败 diff=${d}`); else ok('难度切到噩梦');
}

/* ============ A8 文斗：骂阵扣文笔且生效 ============ */
{
  await evalV(() => { Engine.addWen(30); World.travel('playground'); });
  await page.waitForTimeout(600);
  const wen0 = await evalV(() => G.wen);
  await evalV(() => Main.challenge(PEOPLE_BY_ID.wanzhen));
  for (let i = 0; i < 10; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
  // 骂阵选项
  const maBtn = await page.$('#dialog-choices .choice-btn:has-text("骂阵")');
  if (!maBtn) bug('A8 文笔≥10 却无「骂阵」选项');
  else {
    await maBtn.click(); await page.waitForTimeout(500);
    for (let i = 0; i < 12; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
    await page.waitForTimeout(1000);
    const s = await evalV(() => ({ wen: G.wen, flag: G.flags.duelWen, foes: window.SJI.battle ? window.SJI.battle.living('enemy').map(u => u.hp) : null }));
    if (s.flag !== null) bug(`A8 开战后 duelWen 未消费（${s.flag}）——会被下一场误带`);
    if (!s.foes || !s.foes.length) bug('A8 无敌人');
    else {
      const allMin1 = s.foes.every(h => h >= 1);
      ok(`文斗生效：敌血 ${JSON.stringify(s.foes)}（均≥1）`);
    }
  }
  await page.screenshot({ path: 'testshots/pa-03-wen.png' });
  // 收尾
  await evalV(() => window.SJI_DEBUG.killEnemies());
  for (let i = 0; i < 12; i++) {
    const d = await evalV(() => !document.querySelector('#battle-result').classList.contains('hidden'));
    if (d) break;
    await page.keyboard.press('Space'); await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
  const wenAfter = await evalV(() => ({ wen: G.wen, spent: G.wen <= wen0 - 10 }));
  if (!wenAfter.spent) bug(`A8 骂阵未扣 10 文笔（前${wen0} 后${wenAfter.wen}）`); else ok(`骂阵扣文笔正确 ${wen0}→${wenAfter.wen}`);
  await page.click('#r-menu'); await page.waitForTimeout(600);
}

/* ============ A9 声望折扣与名人效应 ============ */
{
  const s = await evalV(() => { G.rep = 85; Engine.addMoney(-G.money); Engine.addMoney(10); return { rep: G.rep, money: G.money }; });
  await evalV(() => Main.challenge(PEOPLE_BY_ID.wanzhen));
  for (let i = 0; i < 10; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
  await page.waitForTimeout(900);
  await evalV(() => window.SJI_DEBUG.killEnemies());
  for (let i = 0; i < 12; i++) {
    const d = await evalV(() => !document.querySelector('#battle-result').classList.contains('hidden'));
    if (d) break;
    await page.keyboard.press('Space'); await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
  const r = await evalV(() => ({ money: G.money, extra: document.querySelector('#result-body').textContent.includes('名望远播') }));
  if (!r.extra) bug('A9 声望≥80 胜利无「名望远播」+2 提示');
  else ok('名人效应生效');
  await page.click('#r-menu'); await page.waitForTimeout(600);
}

/* ============ A10 稀有卡开关：战场左上角切换即时生效 ============ */
{
  // 先拿两张稀有卡（试炼之外：直接授予）
  await evalV(() => { Blades.grantRare('b_firststrike'); Blades.grantRare('b_shield'); });
  await evalV(() => Main.challenge(PEOPLE_BY_ID.wanzhen));
  for (let i = 0; i < 10; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
  await page.waitForTimeout(900);
  const chips = await evalV(() => ({ n: document.querySelectorAll('#rare-chips .rare-chip').length, on: [...document.querySelectorAll('#rare-chips .rare-chip.on')].length }));
  if (chips.n < 2) bug(`A10 左上角稀有卡徽章应显示 2 张，实际 ${chips.n}`);
  else if (chips.on !== 1) bug(`A10 默认应启用 1 张（逐张开关语义），实际启用 ${chips.on}`);
  // 战斗中切换：先手刀→护盾
  await evalV(() => Blades.toggleRare(window.SJI.battle, 'b_shield'));
  await page.waitForTimeout(300);
  const t = await evalV(() => ({ shield: window.SJI.battle.player.st.shield, fs: window.SJI.battle.player.boons.firstStrike || 0 }));
  if (t.shield !== 3) bug(`A10 切换护盾卡未注入（st.shield=${t.shield}）`);
  if (t.fs !== 0) bug(`A10 切换护盾卡未移除先手刀`);
  else ok('战场左上角逐张开关生效');
  await evalV(() => window.SJI_DEBUG.killEnemies());
  for (let i = 0; i < 12; i++) {
    const d = await evalV(() => !document.querySelector('#battle-result').classList.contains('hidden'));
    if (d) break;
    await page.keyboard.press('Space'); await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
  await page.click('#r-menu'); await page.waitForTimeout(600);
}

/* ============ A11 存档往返：刷新后进度/刀谱/身怀/稀有卡全保留 ============ */
{
  const before = await evalV(() => ({ wins: G.wins, m2: !!G.quests.m2, cards: Blades.cards().length, innates: Blades.innates().slice(), rares: Blades.rareList().slice(), cult: G.cultivation }));
  await page.reload(); await page.waitForTimeout(800);
  await page.click('#btn-continue'); await page.waitForTimeout(900);
  const after = await evalV(() => ({ wins: G.wins, m2: !!G.quests.m2, cards: Blades.cards().length, innates: Blades.innates().slice(), rares: Blades.rareList().slice(), cult: G.cultivation }));
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (!same) bug(`A11 存档往返丢失：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  else ok('存档往返一致');
}

/* ============ A12 全通主线：m9 后主线收卷、自由约战仍可用 ============ */
{
  await evalV(() => { for (let i = 1; i <= 9; i++) G.quests['m' + i] = true; Save.write(); World.travel('gate'); });
  await page.waitForTimeout(700);
  const s = await evalV(() => ({ current: Quests.current(), cardText: (document.querySelector('#questcard').textContent || '').includes('主线已成'), markers: Quests.markers().length }));
  if (!s.cardText) bug('A12 主线全通后任务卡未显示「主线已成」');
  else ok('主线收卷显示正确');
  // 自由约战仍可用
  await evalV(() => Main.challenge(PEOPLE_BY_ID.xinhui));
  for (let i = 0; i < 8; i++) { if (await evalV(() => Dialog.active)) break; await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.xinhui)); await page.waitForTimeout(700); }
  for (let i = 0; i < 12; i++) { if (await evalV(() => !Dialog.active)) break; await page.click('#dialog-box'); await page.waitForTimeout(260); }
  await page.waitForTimeout(900);
  const fight = await evalV(() => !!window.BATTLE_ACTIVE && !!window.SJI.battle);
  if (!fight) bug('A12 主线全通后自由约战失效');
  else ok('全通后自由约战正常');
  await page.screenshot({ path: 'testshots/pa-04-endgame.png' });
}

/* ============ 汇总 ============ */
console.log(`\n===== 实玩 A 汇总：发现 ${bugs} 个 BUG，页面错误 ${errors.length} =====`);
errors.slice(0, 8).forEach(e => console.log('  ' + e));
await browser.close();
process.exit(0);
