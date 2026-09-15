/* 实验史记·马刀行 —— M1 冒烟测试：世界→约战→马刀对决→结算回世界
 * 用法：node smoke.mjs（需 playwright；截图入 testshots/ 供视觉验收） */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const HTML = path.join(ROOT, process.argv[2] || 'index.html');   // 可传打包后的单文件路径
const OUT = path.join(ROOT, 'testshots');
fs.mkdirSync(OUT, { recursive: true });

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
await page.screenshot({ path: `${OUT}/m1-01-title.png` });

// ===== 1. 全局装配检查 =====
const assembled = await page.evaluate(() => ({
  engine: !!window.SJI_ENGINE, data: !!window.SJI_DATA, ui: !!window.SJI_UI,
  blades: typeof Blades === 'object', battleUi: !!window.SJI_UI.startBattle,
  world: typeof World === 'object', main: typeof Main === 'object',
  yinkesi: !!window.SJI_DATA.CHARACTERS.yinkesi,
}));
check('战斗引擎/数据/UI 全部装配', assembled.engine && assembled.data && assembled.ui && assembled.battleUi);
check('世界与主流程装配', assembled.world && assembled.main);
check('音克思战斗卡已注册', assembled.yinkesi);

// ===== 2. 新开一局进世界 =====
await page.click('#btn-new');
await page.waitForTimeout(600);
try { await page.click('#chapter-card', { timeout: 4000 }); } catch (e) {}
await page.waitForTimeout(900);
check('进入世界（校园画布激活）', await page.evaluate(() => World.active && !window.BATTLE_ACTIVE));
await page.screenshot({ path: `${OUT}/m1-02-world.png` });

// ===== 3. 约战歆慧（图书馆有她）=====
await page.evaluate(() => {
  window.SJI_DEBUG.autoRps = true;           // 自动猜拳
  World.travel('library');
});
await page.waitForTimeout(700);
// challenge 会在 80 距离外先寻路走近，轮询直到对话弹出
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.xinhui));
  await page.waitForTimeout(900);
  if (await page.evaluate(() => Dialog.active)) break;
}
check('约战对话弹出', await page.evaluate(() => Dialog.active));
if (errors.length) console.log('  [页面错误]', errors.splice(0).join(' | '));
await page.screenshot({ path: `${OUT}/m1-03-banter.png` });
// 打完战前对话
for (let i = 0; i < 10; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  await page.click('#dialog-box');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(900);
if (errors.length) console.log('  [开战前页面错误]', errors.splice(0).join(' | '));
check('战场覆盖层打开', await page.evaluate(() => window.BATTLE_ACTIVE && document.querySelector('#battle').classList.contains('on')));
check('玩家是音克思', await page.evaluate(() => window.SJI.battle && window.SJI.battle.player.charId === 'yinkesi'));
check('敌军是歆慧', await page.evaluate(() => window.SJI.battle && window.SJI.battle.units.some(u => u.charId === 'xinhui' && u.side === 'enemy')));
// 首战可能有战前剧本对话——用空格推进（打字/翻页），顺带等 rps 自动猜拳完成
for (let i = 0; i < 14; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(320); }
await page.screenshot({ path: `${OUT}/m1-04-battle.png` });

// ===== 4. 天降正义 + 结束回合 → 胜利 =====
await page.waitForTimeout(2200);   // 等猜拳动画走完、进入玩家阶段
await page.evaluate(() => window.SJI_DEBUG.killEnemies());
for (let i = 0; i < 10; i++) {
  const done = await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'));
  if (done) break;
  await page.keyboard.press('Space');   // 结束玩家回合，让引擎推进到回合结算
  await page.waitForTimeout(800);
}
const resultShown = await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'));
check('结算页出现', resultShown);
check('判定为胜', await page.evaluate(() => window.SJI.battle.result === 'win'));
const rewards = await page.evaluate(() => ({ wins: G.wins, card: Blades.hasCard('xinhui'), hpB: Blades.hpBonus() }));
check('胜场入账', rewards.wins === 1, 'wins=' + rewards.wins);
check('歆慧之技录入刀谱', rewards.card === true);
await page.screenshot({ path: `${OUT}/m1-05-result.png` });

// ===== 5. 回校园，世界恢复 =====
await page.click('#r-menu');
await page.waitForTimeout(700);
check('覆盖层关闭，回到校园', await page.evaluate(() => !window.BATTLE_ACTIVE && World.active && !document.querySelector('#battle').classList.contains('on')));
await page.screenshot({ path: `${OUT}/m1-06-back-to-world.png` });

// ===== 6. 刀谱面板 =====
await page.evaluate(() => Main.panelBlades());
await page.waitForTimeout(600);
check('刀谱面板可开', await page.evaluate(() => !document.querySelector('#panel').classList.contains('hidden')));
await page.screenshot({ path: `${OUT}/m1-07-blades.png` });
await page.click('#panel-close');
await page.waitForTimeout(400);

// ===== 7. M2：首战剧情对话 + 成传战门禁 =====
// 7a. 首战大哥应挂上马刀风云卷一剧本（introScene）
const introAttached = await page.evaluate(() => {
  const cfg = Main.startDuel && null; // 不真开战，仅构建 cfg
  return true;
});
const cfgProbe = await page.evaluate(() => {
  // 借 challenge 的 cfg 构建：直接构造（与 duelCfg 同逻辑的可见结果在首战时验证）
  return typeof Main.challenge === 'function';
});
check('challenge 可调用', cfgProbe);
// 7b. 成传战门禁：未胜大哥时卷一不可撰
const gateBlocked = await page.evaluate(() => {
  const v = VOL_BY_NO[1];
  return !Writing.duelReady(1) && !Blades.hasCard('dage');
});
check('未胜传主时卷一门禁生效', gateBlocked);
await page.evaluate(() => UI.panelBook());
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/m2-01-book-gate.png` });
const gateHint = await page.evaluate(() => document.querySelector('#panel-body').innerHTML.includes('未胜传主'));
check('卷目面板显示「未胜传主」提示', gateHint);
await page.click('#panel-close');
await page.waitForTimeout(300);
// 7c. 战胜大哥（模拟录入）后门禁解除
const grantInfo = await page.evaluate(() => {
  const r = Blades.grant('dage');
  Save.write();
  return { fresh: r.fresh, cards: G.blades.cards.slice(), ready: Writing.duelReady(1) };
});
console.log('  [grant dage]', JSON.stringify(grantInfo));
check('胜传主后门禁解除', grantInfo.ready === true);
// 7d. HUD 段位章
check('HUD 段位章刷新', await page.evaluate(() => document.querySelector('#hud-blade-name').textContent.length > 0));
// 7e. 首战剧情：清档重来验证 introScene 挂接
const sceneAttach = await page.evaluate(() => {
  // 直接走 duelCfg 内部逻辑：challenge 不可拆，这里验证 SCENE_OF_CHAR 存在于 Main 闭包外的可见效果——
  // 用真开战验证：开战后 SJI.battle.cfg.introScene 应存在（挑一个未录过的：wenbin）
  return Blades.hasCard('wenbin') ? 'won' : 'fresh';
});
if (sceneAttach === 'fresh') {
  await page.evaluate(() => { World.travel('classroom6'); });
  await page.waitForTimeout(700);
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => Main.challenge(PEOPLE_BY_ID.wenbin));
    await page.waitForTimeout(900);
    if (await page.evaluate(() => Dialog.active)) break;
  }
  check('汶斌约战对话弹出', await page.evaluate(() => Dialog.active));
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => !Dialog.active)) break;
    await page.click('#dialog-box');
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(900);
  const hasIntro = await page.evaluate(() => !!(window.SJI.battle && window.SJI.battle.cfg.introScene));
  check('首战汶斌挂上卷五战前剧本', hasIntro);
  await page.screenshot({ path: `${OUT}/m2-02-first-duel-scene.png` });
  // 推进战斗内剧本对话（空格），再等猜拳、天降正义收尾
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(320); }
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.SJI_DEBUG.killEnemies());
  for (let i = 0; i < 10; i++) {
    const done = await page.evaluate(() => !document.querySelector('#battle-result').classList.contains('hidden'));
    if (done) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1600);
  const vicShown = await page.evaluate(() => document.querySelector('#result-body').innerHTML.includes('胜'));
  check('汶斌之战胜利结算', vicShown);
  await page.screenshot({ path: `${OUT}/m2-03-wenbin-win.png` });
  await page.click('#r-menu');
  await page.waitForTimeout(600);
  check('再次回到校园', await page.evaluate(() => !window.BATTLE_ACTIVE && World.active));
}

// ===== 8. M3：协会锦标赛（三连战）+ 生存模式 =====
await page.evaluate(() => {
  while (G.ch < 9) Engine.nextChapter();     // 卷九
  G.flags.xiehui = true;                     // 协会已立
  World.travel('playground');
  UI.updateHUD();
});
await page.waitForTimeout(800);
// 走到操场空地触发 ctx 按钮
await page.evaluate(() => World.walkTo(750, 450));
await page.waitForTimeout(2200);
const clubBtns = await page.evaluate(() => document.querySelector('#ctxbar').textContent);
check('操场出现协会入口', clubBtns.includes('协会锦标赛') && clubBtns.includes('生存'));
// 8a. 锦标赛
await page.evaluate(() => { const b = [...document.querySelectorAll('#ctxbar .ctx-btn')].find(x => x.textContent.includes('锦标赛')); b && b.click(); });
await page.waitForTimeout(1400);
check('锦标赛开战', await page.evaluate(() => window.BATTLE_ACTIVE && window.SJI.battle.cfg.tournament === true));
check('锦标赛三波配置', await page.evaluate(() => (window.SJI.battle.cfg.waves || []).length === 3));
// 推进卷八开场剧本（空格翻页），等自动猜拳
for (let i = 0; i < 20; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(300); }
await page.waitForTimeout(1500);
// 逐波天降正义：只在玩家阶段按空格，等下一波/下一回合就绪再动
for (let w = 0; w < 30; w++) {
  const st = await page.evaluate(() => {
    const b = window.SJI.battle;
    return { over: b.over, wave: b.waveIndex, foes: b.living('enemy').length, phase: b._playerPhaseActive === true };
  });
  if (st.over) break;
  if (st.foes > 0) await page.evaluate(() => window.SJI_DEBUG.killEnemies());
  else if (st.phase) await page.keyboard.press('Space');
  await page.waitForTimeout(650);
}
await page.waitForTimeout(2500);
const champ = await page.evaluate(() => ({
  result: window.SJI.battle.result, wins: G.wins,
  luhao: Blades.hasCard('luhao'), xiaochuan: Blades.hasCard('xiaochuan'), zichen: Blades.hasCard('zichen'),
  ach: !!G.ach.ach_champion,
}));
check('锦标赛胜利', champ.result === 'win');
check('三委员之技全录刀谱', champ.luhao && champ.xiaochuan && champ.zichen);
check('协会冠军成就', champ.ach);
await page.screenshot({ path: `${OUT}/m3-01-tournament.png` });
await page.click('#r-menu');
await page.waitForTimeout(700);
check('锦标赛后回校园', await page.evaluate(() => !window.BATTLE_ACTIVE));
// 8b. 生存模式
await page.evaluate(() => { const b = [...document.querySelectorAll('#ctxbar .ctx-btn')].find(x => x.textContent.includes('生存')); b && b.click(); });
await page.waitForTimeout(1600);
check('生存开战', await page.evaluate(() => window.BATTLE_ACTIVE && window.SJI.battle.mode === 'survival'));
for (let i = 0; i < 8; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(300); }
// 打完第一波：杀敌 → 玩家阶段结束 → 波间增益点选 → 第二波
for (let i = 0; i < 25; i++) {
  const boon = await page.$('#modal-box .boon-b');
  if (boon) { await boon.click(); await page.waitForTimeout(450); }
  const st = await page.evaluate(() => {
    const b = window.SJI.battle;
    return { over: b.over, foes: b.living('enemy').length, phase: b._playerPhaseActive === true, wave: b.survivalWaveNo };
  });
  if (st.over || st.wave >= 2) break;
  if (st.foes > 0) await page.evaluate(() => window.SJI_DEBUG.killEnemies());
  else if (st.phase) await page.keyboard.press('Space');
  await page.waitForTimeout(650);
}
await page.waitForTimeout(1500);
const wave2 = await page.evaluate(() => window.SJI.battle.survivalWaveNo >= 2);
check('生存进入第二波（增益已选）', wave2);
await page.screenshot({ path: `${OUT}/m3-02-survival.png` });
await page.evaluate(() => { window.SJI.battle.finish('lose'); });
await page.waitForTimeout(2400);
// 等战斗弹层（猜拳等）全部关闭，避免拦截结算按钮
for (let i = 0; i < 12; i++) {
  const off = await page.evaluate(() => !document.querySelector('#modal-mask').classList.contains('on'));
  if (off) break;
  await page.waitForTimeout(500);
}
await page.click('#r-menu');
await page.waitForTimeout(700);
check('生存后回校园', await page.evaluate(() => !window.BATTLE_ACTIVE && World.active));

// ===== 结果 =====
console.log(errors.length ? '\n页面错误:\n' + errors.join('\n') : '\n无页面错误');
console.log(fails === 0 ? '\n=== M1 SMOKE ALL PASS ===' : `\n!! ${fails} 项失败`);
await browser.close();
process.exit(errors.length ? 1 : fails);
