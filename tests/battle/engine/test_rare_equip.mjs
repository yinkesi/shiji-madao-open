/* 稀有刀卡单携带：每场只能带一张；切换时旧卡效果移除、新卡生效 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';
import { createRequire } from 'module';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
createRequire(import.meta.url)('../../../js/blades.js');
const Blades = window.Blades;   // blades.js 已显式挂载
const { check, done } = checker('稀有刀卡：单携带与切换');

function freshGame(rares) {
  window.G = null;
  const g = window.newGameState();
  g.blades.rare = rares.slice();
  window.G = g;
  Blades.registerChar();
}
function newBattle() {
  return new E.Battle({ mode: 'story', playerChar: 'yinkesi', enemies: ['mob'], allies: [], diff: 'normal' });
}
function baseGame() {  // 测试基建：newGameState 在浏览器里才有
  if (typeof newGameState !== 'function') {
    window.newGameState = () => ({
      ver: 1, ch: 0, day: 1, periodIdx: 0, ap: 3, apMax: 3, wen: 5, rep: 50, money: 99,
      favor: {}, shards: {}, doneEvents: [], vols: {}, giftToday: {}, chatCount: 0, caughtToday: false,
      bag: {}, ach: {}, wins: 0, duelsLost: 0, blades: { cards: [], equip: null, rare: [] },
      upgrades: {}, quests: {}, roster: ['yinkesi'], trialDone: {}, duelDone: {},
      flags: { visitedScenes: [], metPeople: [], prologue: false, duelBanDays: 0 },
      settings: { muted: false, motion: 'full', speed: 1 }, stats: { chats: 0, gifts: 0, reads: 0, gossip: 0, caught: 0, listened: 0, direct: 0, curve: 0, plays: {}, published: 0 },
    });
  }
}

baseGame();

/* 1. 持有两张：默认携带第一张，applyBoons 只注入一张（以 b_firststrike 为例） */
freshGame(['b_firststrike', 'b_regen']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  check('默认携带第一张：先手刀生效', b.player.boons.firstStrike === 1);
  check('未携带的卡不生效：无回血', (b.player.boons.regen || 0) === 0);
}
/* 2. switchRare：先手刀移除、回血生效 */
freshGame(['b_firststrike', 'b_killheal']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  const ok = Blades.switchRare(b, 'b_killheal');
  check('切换成功', ok === true);
  check('旧卡效果已移除：先手刀归零', (b.player.boons.firstStrike || 0) === 0);
  check('新卡效果生效：击破回血 4', (b.player.boons.killHeal || 0) === 2);
}
/* 3. 未持有的卡不可携带 */
freshGame(['b_firststrike']);
{
  const b = newBattle();
  check('未持有的卡不可携带', Blades.switchRare(b, 'b_regen') === false && Blades.selectedRare() === 'b_firststrike');
}
/* 4. 身怀之技不受稀有卡切换影响（多来源独立） */
freshGame(['b_firststrike']);
{
  const b = newBattle();
  b.player._innates = ['luhao'];
  const f = b.living('enemy')[0];
  f.st.skip = 9; f.r = 3; f.c = 4; b.player.r = 3; b.player.c = 3; b.player.hasKnife = true;
  Blades.applyBoons(b);
  const d = b.calcDamage(b.player, f, 1, { type: 'knife' });
  check('身怀大腹如斗独立于稀有卡：刀击仍 ×2', d === 2, `dmg=${d}`);
}
/* 5. 属性化移除后再切回可重新生效（来回切换不失真） */
freshGame(['b_killheal', 'b_firststrike']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  Blades.switchRare(b, 'b_firststrike');
  Blades.switchRare(b, 'b_killheal');
  check('来回切换不失真：击破回血恢复且先手归零', (b.player.boons.killHeal || 0) === 2 && (b.player.boons.firstStrike || 0) === 0);
}

done();
