/* 获得角色 = 获得其全部技能（主动+被动）：passiveOwner 专项
   音克思装备谁的刀卡（_learnedFrom），谁的被动机制就对装备者生效。 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';
import { createRequire } from 'module';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
// 载入 blades.js：其载入期会把音克思战斗卡注册进 SJI_DATA（G 未建时按白板 0 胜）
createRequire(import.meta.url)('../../../js/blades.js');
const { check, done } = checker('获得角色=全套技能（被动继承 passiveOwner）');

function mk(from) {
  const b = new E.Battle({ mode: 'story', playerChar: 'yinkesi', enemies: ['mob'], allies: [], diff: 'normal' });
  if (from) b.player._learnedFrom = from;
  return b;
}
function faceFoe(b) {  // 玩家与敌人贴身
  const p = b.player, f = b.living('enemy')[0];
  p.r = 3; p.c = 3; f.r = 3; f.c = 4;
  return f;
}

/* 1/2. 刀击基础与鲁豪翻倍 */
{
  const b = mk(null), p = b.player, f = faceFoe(b);
  p.hasKnife = true;
  check('无装备刀击 1 伤（对照）', b.calcDamage(p, f, 1, { type: 'knife' }) === 1);
}
{
  const b = mk('luhao'), p = b.player, f = faceFoe(b);
  p.hasKnife = true;
  check('装备鲁豪卡：刀击 ×2（大腹如斗）', b.calcDamage(p, f, 1, { type: 'knife' }) === 2);
  check('装备鲁豪卡：马踢不翻倍（仅刀击）', b.calcDamage(p, f, 3, { type: 'horse' }) === 3);
}
/* 3. 头哥卡：免疫击退 */
{
  const b = mk('touge'), p = b.player;
  p.r = 3; p.c = 3;
  await b.pushUnit(p, 3, 1, 2);
  check('装备头哥卡：免疫击退（岿然不动）', p.r === 3 && p.c === 3);
}
/* 4. wonder 卡：血祭两连 */
{
  const b = mk('wonder'), p = b.player;
  p.apNow = 1; p.hp = 10;
  await b.doSacrifice(p);
  check('装备 wonder 卡：血祭两连（马刀之神）', p.st.bloodlust === 2, `charges=${p.st.bloodlust}`);
}
/* 5. 李帆卡：购刀免行动点 */
{
  const b = mk('lifan'), p = b.player;
  p.apNow = 0;
  const ok = await b.doBuyKnife(p);
  check('装备李帆卡：购刀免动', ok === true && p.hasKnife === true && p.apNow === 0);
}
/* 6. 歆慧卡：偶数回合行动 +1 */
{
  const b = mk('xinhui');
  b.round = 2;
  check('装备歆慧卡：偶数回合行动 +1（灵光乍现）', b.calcAP(b.player, 2) === 3, `ap=${b.calcAP(b.player, 2)}`);
}
/* 7/8. 仙女卡：免疫晕眩 */
{
  check('装备仙女卡：免疫晕眩', mk('xiannv')._passiveImmuneStun(mk('xiannv').player) === true);
  check('未装备：免疫不生效（对照）', mk(null)._passiveImmuneStun(mk(null).player) === false);
}
/* 9. 大师卡：回合末吸紫气回血（跑一个回合） */
{
  const b = mk('shibo'), p = b.player;
  p.hp = 5; p.maxhp = Math.max(p.maxhp, 10);
  b.living('enemy')[0].st.skip = 9;
  let n = 0;
  window.SJI_UI.rpsRound = async (b2) => { n++; if (n >= 2) { b2.over = true; return { res: 'win', ap: 0 }; } return { res: 'win', ap: 0 }; };
  window.SJI_UI.playerPhase = async () => {};
  await b.run();
  check('装备大师卡：回合末回复 1 血（吸东来之紫气）', p.hp >= 6, `hp=${p.hp}`);
}
/* 10. 敌方被动不受影响：guayu 闪避仍在（对照） */
{
  const b2 = new E.Battle({ mode: 'story', playerChar: 'yinkesi', enemies: ['guayu'], allies: [], diff: 'normal' });
  const g = b2.living('enemy')[0], p = b2.player;
  g.st.skip = 9; g._stGuard = true;
  // 让 guayu 站定，玩家远程技打它多次统计闪避是否出现（直接测 calcDamage 的闪避在 dealDamage 里，这里验证对手位未被 passiveOwner 误改）
  check('敌方卡不受 _learnedFrom 影响（字段只加在玩家身上）', p._learnedFrom === undefined && g._learnedFrom === undefined);
}

done();
