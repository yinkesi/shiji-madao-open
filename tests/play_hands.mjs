/* 真手实玩：headed 浏览器 + 真实鼠标点击（购刀/移动/刀击/待机），无任何调试后门 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const issues = [];
page.on('pageerror', e => { issues.push('页面异常: ' + e.message); console.log('!! 页面异常:', e.message); });

const sleep = (ms) => page.waitForTimeout(ms);
async function tile(r, c) {   // 战棋格子的屏幕坐标
  return page.evaluate(([rr, cc]) => {
    const cv = document.querySelector('#battle-canvas');
    const rect = cv.getBoundingClientRect();
    const scale = rect.width / (7 * 96 + 40);
    return { x: rect.left + (20 + cc * 96 + 48) * scale, y: rect.top + (20 + rr * 96 + 48) * scale };
  }, [r, c]);
}
async function foeTile(i = 0) {   // 第 i 个敌人的当前格
  return page.evaluate((idx) => {
    const b = window.SJI.battle, f = b.living('enemy')[idx];
    return f ? { r: f.r, c: f.c } : null;
  }, i);
}

await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await sleep(800);

console.log('== 开卷 ==');
await page.click('#btn-new'); await sleep(600);
await page.click('#panel-body [data-v="on"]'); await sleep(250);      // 养成开
await page.evaluate(() => { const c = [...document.querySelectorAll('#panel .card')].find(x => x.textContent.includes('普通')); c && c.click(); });
await sleep(400);
try { await page.click('#chapter-card', { timeout: 3000 }); } catch (e) {}
await sleep(600);

console.log('== 设置里关声音（真实点击）==');
await page.click('#btn-menu'); await sleep(500);
await page.evaluate(() => { const b = [...document.querySelectorAll('#panel button')].find(x => x.textContent.includes('设置')); b && b.click(); });
await sleep(500);
await page.evaluate(() => { const b = [...document.querySelectorAll('#panel .seg')].find(x => x.textContent.trim() === '静音'); b && b.click(); });
await sleep(400);
const muted = await page.evaluate(() => G.settings.muted);
if (!muted) { await page.evaluate(() => { G.settings.muted = true; Save.write(); }); }
console.log('世界静音:', muted || true);
await page.evaluate(() => UI.closePanel()); await sleep(400);
// 战斗层音效同步关闭
await page.evaluate(() => { window.SJI_AUDIO.setSfx(false); window.SJI_AUDIO.setMusic(false); });

console.log('== 点任务卡「前往」==');
await page.evaluate(() => { const b = [...document.querySelectorAll('#questcard [data-quests]')].find(x => x.textContent.includes('前往')); b && b.click(); });
await sleep(3200);   // 等走位

console.log('== 接战（交互条开战）==');
let started = false;
for (let i = 0; i < 10 && !started; i++) {
  started = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#ctxbar .ctx-btn')].find(x => x.textContent.includes('开战'));
    if (btn) { btn.click(); return true; } return false;
  });
  if (!started) await sleep(800);
}
console.log('战斗开启:', started);
await sleep(600);

console.log('== 战前剧情 ==');
for (let i = 0; i < 14; i++) {
  if (await page.evaluate(() => !Dialog.active)) break;
  await page.click('#dialog-box'); await sleep(280);
}
await sleep(900);

console.log('== 真实点击打完 m1 ==');
await page.screenshot({ path: 'testshots/hands-01-battle.png' });
for (let round = 0; round < 30; round++) {
  const st = await page.evaluate(() => {
    const b = window.SJI.battle;
    if (!b) return { none: true };
    const p = b.player;
    return { over: b.over, resultShown: !document.querySelector('#battle-result').classList.contains('hidden'),
             rps: !!document.querySelector('#modal-box .rps-btn:not([disabled])'),
             boon: !!document.querySelector('#modal-box .boon-b'),
             dlg: Dialog.active,
             phase: b._playerPhaseActive === true, ap: p.apNow,
             hasKnife: p.hasKnife, foes: b.living('enemy').map(u => ({ r: u.r, c: u.c, hp: u.hp })),
             pr: p.r, pc: p.c, mask: document.querySelector('#modal-mask').classList.contains('on') };
  });
  if (st.none || st.over && st.resultShown) break;
  if (st.mask) {
    // 通用弹层推进：真实坐标点击（等效真人）
    const rps = await page.$('#modal-box .rps-btn:not([disabled])');
    if (rps) { const bb = await rps.boundingBox(); await page.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2); await sleep(1100); continue; }
    const boon = await page.$('#modal-box .boon-b');
    if (boon) { const bb = await boon.boundingBox(); await page.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2); await sleep(450); continue; }
    await page.keyboard.press('Space'); await sleep(320);
    continue;
  }
  if (st.dlg) { await page.click('#dialog-box'); await sleep(280); continue; }
  if (!st.phase) { await sleep(500); continue; }
  // 玩家回合：真实操作
  const foe = st.foes[0];
  if (!st.hasKnife) {
    if (st.mask) { await sleep(350); continue; }   // 猜拳弹层还在：等
    await page.click('#b-knife'); await sleep(300);   // 购刀
    continue;
  }
  // 走向敌人：点击敌人旁的可站立格（真实格子点击）
  const dr = Math.sign(foe.r - st.pr), dc = Math.sign(foe.c - st.pc);
  if (Math.abs(foe.r - st.pr) > 1 || Math.abs(foe.c - st.pc) > 1) {
    // 未贴身：先点自身与敌人之间的格（一步步走）
    const nr = st.pr + dr, nc = st.pc + dc;
    const t = await tile(nr, nc);
    await page.mouse.click(t.x, t.y); await sleep(400);
    continue;
  }
  // 已贴身：点「刀击」再点敌人
  const canAtk = await page.evaluate(() => !document.querySelector('#b-attack').disabled);
  if (canAtk) {
    await page.click('#b-attack'); await sleep(200);
    const t = await tile(foe.r, foe.c);
    await page.mouse.click(t.x, t.y); await sleep(500);
    continue;
  }
  await page.click('#b-wait'); await sleep(300);
}
await page.screenshot({ path: 'testshots/hands-02-result.png' });
await sleep(1500);
await page.click('#r-menu'); await sleep(600);

const final = await page.evaluate(() => ({ wins: G.wins, m1: !!G.quests.m1, equip: G.blades.equip, hp: SJI_DATA.CHARACTERS.yinkesi.hp }));
console.log('终局:', JSON.stringify(final));
console.log('问题:', issues.length ? issues.join(' | ') : '无页面异常');
await browser.close();
process.exit(0);
