/* 双周目实玩（重写版）：真实 UI + 页内贪心机器人大脑
   周目A：普通+养成开；周目B：困难+养成关。
   铁律：page.evaluate 内不得引用 Node 变量；需要的一律经参数传入。 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const issues = [];
let bugN = 0;
page.on('pageerror', e => { bugN++; issues.push('页面异常: ' + e.message); console.log('!! 页面异常:', e.message); });
page.on('console', m => { if (m.type() === 'error') { bugN++; issues.push('控制台错误: ' + m.text()); console.log('!! 控制台错误:', m.text()); } });
const bug = (m) => { bugN++; issues.push(m); console.log(`BUG#${bugN}: ${m}`); };
const ok = (m) => console.log(`  ok: ${m}`);
const sec = (m) => console.log(`\n== ${m}`);
const sleep = (ms) => page.waitForTimeout(ms);

async function gotoGame() {
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForTimeout(800);
}

/* 页内机器人：接管玩家阶段 + 自动处理猜拳/增益/战斗内对话 */
const BOT_SRC = `
window.__ui = { rpsAuto: true };
(function () {
  const orig = SJI_UI.rpsRound.bind(SJI_UI);
  SJI_UI.rpsRound = async (b) => {
    if (b.over) return { res: '和', ap: 2 };
    const p = orig(b);
    (function clickRps() {
      const el = document.querySelector('#modal-box .rps-btn:not([disabled])');
      if (el) el.click();
      else if (!b.over) setTimeout(clickRps, 120);
    })();
    return p;
  };
})();
window.__botPlay = async (b) => {
  let guard = 0;
  const p = b.player;
  while (p.apNow > 0 && guard++ < 16 && !b.over && p.alive && p.offField <= 0) {
    const foes = b.opponentsOf(p);
    if (!foes.length) break;
    const t = foes.slice().sort((a, c) => (a.hp + SJI_ENGINE.manh(p, a) * 0.7) - (c.hp + SJI_ENGINE.manh(p, c) * 0.7))[0];
    if (b.skillCd(p, 0) <= 0 && p.st.silence <= 0 && b.skillOf(p, 0)) {
      const pick = b.aiPickSkill(p);
      if (pick && Math.random() < 0.8) { await b.doSkill(p, pick.idx, pick.target); continue; }
    }
    if (!p.hasKnife) { await b.doBuyKnife(p); continue; }
    if (!p.hasHorse && Math.random() < 0.6) { await b.doBuyHorse(p); continue; }
    const adj2 = foes.filter(f => SJI_ENGINE.adj(p, f));
    if (p.hp >= 6 && adj2.length && t.hp <= 4 && p.st.bloodlust <= 0 && Math.random() < 0.4) { await b.doSacrifice(p); continue; }
    if (p.hasHorse && SJI_ENGINE.isWall(p.r, p.c) && SJI_ENGINE.isWall(t.r, t.c) && SJI_ENGINE.manh(p, t) <= 3) { await b.doHorse(p, t); continue; }
    if (p.hasKnife && p.st.seal <= 0 && p.st.disarm <= 0 && adj2.length) { await b.doKnife(p, adj2[0]); continue; }
    if (p.hasHorse && !SJI_ENGINE.isWall(p.r, p.c) && !SJI_ENGINE.isWall(t.r, t.c) && SJI_ENGINE.adj(p, t)) { await b.doDrive(p, t); continue; }
    const reach = b._reachable(p, b.moveRange(p));
    let best = null, bs = -1e9;
    for (const key of reach.keys) {
      const [r, c] = key.split(',').map(Number);
      if (b.unitAt(r, c) || (r === p.r && c === p.c)) continue;
      const near = foes.filter(f => Math.max(Math.abs(f.r - r), Math.abs(f.c - c)) <= 1).length;
      const d = Math.abs(r - t.r) + Math.abs(c - t.c);
      const sc = -d * 2 - near * 3;
      if (sc > bs) { bs = sc; best = [r, c]; }
    }
    if (best) { await b.doMove(p, best[0], best[1]); continue; }
    break;
  }
};
SJI_UI.playerPhase = async (b) => {
  b._playerPhaseActive = true;
  await new Promise(r => setTimeout(r, 100));
  if (!b.over && b.player.alive && b.player.offField <= 0) await window.__botPlay(b);
  b._playerPhaseActive = false;
};
`;

async function autoBattle() {
  for (let i = 0; i < 70; i++) {
    const st = await page.evaluate(() => {
      const b = window.SJI.battle;
      if (!b) return { none: true };
      return { over: b.over, foes: b.living('enemy').length, wave: b.survivalWaveNo || 0,
               boon: !!document.querySelector('#modal-box .boon-b'),
               mask: document.querySelector('#modal-mask').classList.contains('on') };
    });
    if (st.none || st.over) return;
    if (st.boon) { await page.click('#modal-box .boon-b'); await page.waitForTimeout(350); continue; }
    await page.waitForTimeout(450);
  }
}
async function closeResultAndWorld() {
  await page.waitForTimeout(1400);
  for (let i = 0; i < 10; i++) {
    const off = await page.evaluate(() => !document.querySelector('#modal-mask').classList.contains('on'));
    if (off) break;
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  const okMenu = await page.click('#r-menu', { timeout: 8000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  if (!okMenu) bug('结算「回校园」按钮 8 秒内不可点');
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => !Dialog.active)) break;
    const choice = await page.$('#dialog-choices .choice-btn');
    if (choice) await choice.click(); else await page.click('#dialog-box');
    await page.waitForTimeout(260);
  }
}
async function playDialogOnce(maxClicks = 16) {
  for (let i = 0; i < maxClicks; i++) {
    if (await page.evaluate(() => !Dialog.active)) return true;
    const choice = await page.$('#dialog-choices .choice-btn');
    if (choice) await choice.click(); else await page.click('#dialog-box');
    await page.waitForTimeout(270);
  }
  return !(await page.evaluate(() => Dialog.active));
}
async function acceptQuest(qid) {
  for (let t = 0; t < 14; t++) {
    await page.evaluate((id) => Main.onQuest(Quests.byId(id)), qid);
    await page.waitForTimeout(600);
    const state = await page.evaluate((id) => ({
      dlg: Dialog.active,
      battle: !!(window.SJI.battle && window.SJI.battle.cfg && window.SJI.battle.cfg.questId === id),
      panel: !document.querySelector('#panel').classList.contains('hidden'),
    }), qid);
    if (state.battle) return 'battle';
    if (state.dlg) return 'dialog';
    if (state.panel) return 'panel';
  }
  return 'none';
}
async function pickFighterOrStart() {
  const picked = await page.evaluate(() => {
    const panel = document.querySelector('#panel');
    if (panel.classList.contains('hidden')) return 'no-panel';
    const cards = [...document.querySelectorAll('#panel .card')];
    const me = cards.find(c => c.textContent.includes('音克思')) || cards[0];
    if (!me) return 'no-card';
    me.click();
    return 'picked';
  });
  await page.waitForTimeout(900);
  return picked;
}

/* ================== 周目驱动 ================== */
async function playthrough({ tag, diff, diffId, cult }) {
  console.log(`\n########## 周目 ${tag}：${diff}${cult ? ' + 养成' : ' + 纯白板'} ##########`);
  await gotoGame();
  await page.click('#btn-new'); await page.waitForTimeout(600);
  {
    const btn = await page.$(`#panel-body [data-v="${cult ? 'on' : 'off'}"]`);
    if (btn) await btn.click(); await page.waitForTimeout(250);
  }
  await page.evaluate((d) => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes(d)); c && c.click(); }, diff);
  await page.waitForTimeout(500);
  try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
  await page.waitForTimeout(600);
  await page.evaluate(BOT_SRC);
  {
    const s = await page.evaluate(() => ({ cult: G.cultivation, diff: Quests.diffV(), hp: SJI_DATA.CHARACTERS.yinkesi.hp }));
    if (s.cult !== cult) bug(`${tag}0 养成开关不符（${s.cult}）`);
    if (s.diff !== diffId) bug(`${tag}0 难度不符（${s.diff} ≠ ${diffId}）`);
    if (s.hp !== 10) bug(`${tag}0 初始血应 10，实际 ${s.hp}`);
    ok(`开卷：cult=${s.cult} diff=${s.diff} hp=${s.hp}`);
  }

  for (let qi = 1; qi <= 9; qi++) {
    sec(`${tag}-主线 m${qi}`);
    const mode = await acceptQuest('m' + qi);
    if (mode === 'none') { bug(`${tag}-m${qi} 无法接取（14 次尝试无对话/战斗/面板）`); continue; }
    if (mode === 'dialog') {
      const done = await playDialogOnce(16);
      if (!done) bug(`${tag}-m${qi} 战前剧情未能播完`);
      await sleep(900);
      await pickFighterOrStart();
    } else if (mode === 'panel') {
      await pickFighterOrStart();
    }
    await sleep(900);
    const st = await page.evaluate(() => ({ on: !!window.BATTLE_ACTIVE, id: window.SJI.battle && window.SJI.battle.cfg.questId, diff: window.SJI.battle && window.SJI.battle.diff }));
    if (!st.on) { bug(`${tag}-m${qi} 开战失败（mode=${mode}）`); continue; }
    if (st.id !== 'm' + qi) bug(`${tag}-m${qi} questId 错位：${st.id}`);
    ok(`m${qi} 开战（${st.diff}）`);
    await autoBattle();
    await page.waitForTimeout(1600);   // 结算回调延迟 1.3s 后才写任务标记
    const qkey = 'm' + qi;
    const r = await page.evaluate((k) => ({ result: window.SJI.battle.result, done: !!G.quests[k], wins: G.wins }), qkey);
    if (r.result !== 'win') bug(`${tag}-m${qi} 结果=${r.result}（bot 打不过——平衡候选）`);
    if (r.result === 'win' && !r.done) bug(`${tag}-m${qi} 胜利但未标记完成`);
    ok(`m${qi} → ${r.result}（累计胜 ${r.wins}）`);
    await closeResultAndWorld();
  }

  sec(`${tag}-支线 锦绣夜行`);
  {
    const can = await page.evaluate(() => { const q = Quests.sideList().find(x => x.id === 's_luhao'); return q && q.cond(); });
    if (can) {
      await page.evaluate((id) => Main.onQuest(Quests.byId(id)), 's_luhao');
      await playDialogOnce(14);
      await sleep(900);
      await pickFighterOrStart();
      await autoBattle();
      const r = await page.evaluate(() => ({ result: window.SJI.battle.result, innate: Blades.innates().includes('luhao'), dup: Blades.innates().filter(x => x === 'luhao').length }));
      if (r.result !== 'win') bug(`${tag}-支线锦绣夜行 结果=${r.result}`);
      else if (r.dup > 1) bug(`${tag}-支线锦绣夜行 身怀重复授予 ×${r.dup}`);
      else ok('锦绣夜行胜利，身怀大腹如斗唯一');
      await closeResultAndWorld();
    } else ok(`${tag} 锦绣夜行条件未满足（跳过）`);
  }

  sec(`${tag}-稀有卡逐张开关`);
  {
    await page.evaluate(() => { Blades.grantRare('b_shield'); World.travel('playground'); });
    await page.waitForTimeout(500);
    await page.evaluate((id) => Main.challenge(PEOPLE_BY_ID[id]), 'wanzhen');
    await playDialogOnce(12);
    await page.waitForTimeout(900);
    const chips = await page.evaluate(() => ({ n: document.querySelectorAll('#rare-chips .rare-chip').length }));
    if (chips.n < 1) bug(`${tag}-稀有卡 战场无开关徽章`);
    else {
      const onChip = await page.$('#rare-chips .rare-chip.on');
      if (onChip) { await onChip.click(); await page.waitForTimeout(350); }
      const offChip = await page.$('#rare-chips .rare-chip:not(.on)');
      if (offChip) { await offChip.click(); await page.waitForTimeout(350); }
      const t = await page.evaluate(() => ({ on: Blades.rareOn().length }));
      ok(`稀有卡开关正常（启用 ${t.on} 张）`);
    }
    await page.screenshot({ path: `testshots/play-${tag}-rare.png` });
    await page.evaluate(() => window.SJI.battle.finish('lose'));
    await page.waitForTimeout(1500);
    await closeResultAndWorld();
  }

  sec(`${tag}-全通收卷`);
  {
    await page.evaluate(() => { for (let i = 1; i <= 9; i++) G.quests['m' + i] = true; Save.write(); World.travel('gate'); });
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => (document.querySelector('#questcard').textContent || '').includes('主线已成'));
    if (!s) bug(`${tag}-全通收卷显示缺失`); else ok('全通收卷显示正确');
    await page.evaluate((id) => Main.challenge(PEOPLE_BY_ID[id]), 'xinhui');
    await playDialogOnce(12);
    await page.waitForTimeout(900);
    const f = await page.evaluate(() => !!window.BATTLE_ACTIVE && !!window.SJI.battle);
    if (!f) bug(`${tag}-全通后自由约战失效`); else ok('全通后自由约战正常');
    await page.evaluate(() => window.SJI.battle && window.SJI.battle.finish('lose'));
    await page.waitForTimeout(1400);
    await closeResultAndWorld();
  }

  sec(`${tag}-存档往返`);
  {
    const before = await page.evaluate(() => JSON.stringify({ w: G.wins, q: Object.keys(G.quests).length, cards: Blades.cards(), inn: Blades.innates(), r: Blades.rareList(), ro: Blades.rareOn(), cult: G.cultivation }));
    await page.reload(); await page.waitForTimeout(800);
    await page.click('#btn-continue'); await page.waitForTimeout(900);
    const after = await page.evaluate(() => JSON.stringify({ w: G.wins, q: Object.keys(G.quests).length, cards: Blades.cards(), inn: Blades.innates(), r: Blades.rareList(), ro: Blades.rareOn(), cult: G.cultivation }));
    if (before !== after) bug(`${tag}-存档往返不一致 前=${before} 后=${after}`);
    else ok('存档往返一致');
    await page.screenshot({ path: `testshots/play-${tag}-save.png` });
  }
}

/* ============ 周目 A ============ */
const SKIP_A = process.argv.includes('--skip-a');
if (!SKIP_A) await playthrough({ tag: 'A', diff: '普通', diffId: 'normal', cult: true });
/* ============ 周目 B ============ */
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload(); await page.waitForTimeout(900);
if (SKIP_A) { await page.reload(); await page.waitForTimeout(800); }
await playthrough({ tag: 'B', diff: '困难', diffId: 'hard', cult: false });

console.log(`\n===== 双周目完成：共记录 ${bugN} 条问题 =====`);
issues.forEach((e, i) => console.log(`  [${i + 1}] ${e}`));
await browser.close();
process.exit(0);
