/* 稀有刀卡开关模型：每张独立启用/收回，生效数量由玩家自定；身怀与承技不受影响 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';
import { createRequire } from 'module';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
createRequire(import.meta.url)('../../../js/blades.js');
const Blades = window.Blades;   // blades.js 已显式挂载
const { check, done } = checker('稀有刀卡：逐张开关、数量自定');

function baseGame() {
  if (!window.newGameState) {
    window.newGameState = () => ({
      ver: 1, ch: 0, day: 1, periodIdx: 0, ap: 3, apMax: 3, wen: 5, rep: 50, money: 99,
      favor: {}, shards: {}, doneEvents: [], vols: {}, giftToday: {}, chatCount: 0, caughtToday: false,
      bag: {}, ach: {}, wins: 0, duelsLost: 0, cultivation: false,
      blades: { cards: [], equip: null, rare: [], rareOn: [], rareInit: true },
      upgrades: {}, quests: {}, roster: ['yinkesi'], trialDone: {}, duelDone: {},
      flags: { visitedScenes: [], metPeople: [], prologue: false, duelBanDays: 0 },
      settings: { muted: false, motion: 'full', speed: 1 }, stats: { chats: 0, gifts: 0, reads: 0, gossip: 0, caught: 0, listened: 0, direct: 0, curve: 0, plays: {}, published: 0 },
    });
  }
}
baseGame();

function freshGame(rares) {
  window.G = null;
  const g = window.newGameState();
  window.G = g;
  rares.forEach(id => Blades.grantRare(id));   // 走真实入手流程：入谱即默认启用
  Blades.registerChar();
}
function newBattle() {
  return new E.Battle({ mode: 'story', playerChar: 'yinkesi', enemies: ['mob'], allies: [], diff: 'normal' });
}

/* 1. 默认：新入手即启用 */
freshGame(['b_firststrike', 'b_killheal']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  check('两张稀有卡默认都启用', (b.player.boons.firstStrike || 0) === 1 && (b.player.boons.killHeal || 0) === 2);
}
/* 2. 玩家自定数量：关掉一张 → 只剩一张生效 */
freshGame(['b_firststrike', 'b_killheal']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  Blades.toggleRare(b, 'b_firststrike');   // 收回先手刀
  check('收回先手刀：效果移除', (b.player.boons.firstStrike || 0) === 0);
  check('庆功之宴仍生效', (b.player.boons.killHeal || 0) === 2);
}
/* 3. 全部收回：零生效也合法（玩家自定 0 张） */
freshGame(['b_firststrike', 'b_killheal', 'b_shield']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  Blades.toggleRare(b, 'b_firststrike');
  Blades.toggleRare(b, 'b_killheal');
  Blades.toggleRare(b, 'b_shield');
  const r0 = b.player.boons;
  Blades.applyBoons(b);   // 重复调用不复活
  check('全部收回后零生效（重复注入不复活）', Blades.rareOn().length === 0 && (r0.shield || 0) === 0, `rareOn=${JSON.stringify(Blades.rareOn())} shield=${r0.shield || 0}`);
}
/* 4. 战斗中开启：即刻注入（先收回 → 再启用） */
freshGame(['b_shield']);
{
  const b = newBattle();
  Blades.toggleRare(null, 'b_shield');   // 先收回
  Blades.applyBoons(b);
  const before = b.player.boons.shield || 0;
  Blades.toggleRare(b, 'b_shield');      // 战斗中重新启用 → 即刻 +3 护盾
  check('战斗中启用即刻注入', (b.player.boons.shield || 0) === before + 3, `before=${before} after=${b.player.boons.shield || 0}`);
}
/* 5. 收回后再启用：来回不失真 */
freshGame(['b_killheal', 'b_firststrike']);
{
  const b = newBattle();
  Blades.applyBoons(b);
  Blades.toggleRare(b, 'b_firststrike');
  Blades.toggleRare(b, 'b_killheal');
  Blades.toggleRare(b, 'b_killheal');
  check('来回切换不失真', (b.player.boons.firstStrike || 0) === 0 && (b.player.boons.killHeal || 0) === 2, `fs=${b.player.boons.firstStrike || 0} killheal=${b.player.boons.killHeal || 0}`);
}

done();
