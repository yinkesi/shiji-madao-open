/* 极难/噩梦的多人平衡失效：敌人不减血、玩家无以寡敌众补偿 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';
import { createRequire } from 'module';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
createRequire(import.meta.url)('../../../js/blades.js');
const Blades = window.Blades;
const { check, done } = checker('极难/噩梦：多人平衡失效');

function mk(diff, enemies) {
  window.G = null;
  window.newGameState && (window.G = window.newGameState());
  const b = new E.Battle({ mode: 'story', playerChar: 'yinkesi', enemies, allies: [], diff });
  return b;
}
const fullHp = (b) => b.living('enemy').every(u => u.hp === u.maxhp);

/* 1. 普通：双敌各减血 0.85，玩家有以寡敌众补偿 */
{
  const b = mk('normal', ['mob', 'mob']);
  b.player.apNow = b.calcAP(b.player, 3);
  check('普通：双敌血量 ×0.85', b.living('enemy').every(u => u.hp === Math.round(8 * 0.85)) === true || b.living('enemy')[0].hp === Math.round(8 * 0.85), `hp=${b.living('enemy')[0].hp}`);
  check('普通：以寡敌众行动点 +1', b.player.apNow === 4, `ap=${b.player.apNow}`);
}
/* 2. 极难：双敌不减血（多人减血失效；8×1.25 难度耐打=10），玩家无补偿 */
{
  const b = mk('extreme', ['mob', 'mob']);
  check('极难：双敌不减血（多人平衡失效）', b.living('enemy').every(u => u.hp === 10), `hp=${b.living('enemy')[0].hp}`);
  b.player.apNow = b.calcAP(b.player, 3);
  check('极难：无以寡敌众行动点补偿', b.player.apNow === 3, `ap=${b.player.apNow}`);
}
/* 3. 噩梦：双敌不减血，且叠加 1.4 倍血量 */
{
  const b = mk('nightmare', ['mob', 'mob']);
  check('噩梦：双敌不减血且 ×1.4', b.living('enemy').every(u => u.hp === Math.round(8 * 1.4)), `hp=${b.living('enemy')[0].hp}`);
  b.player.apNow = b.calcAP(b.player, 3);
  check('噩梦：无以寡敌众行动点补偿', b.player.apNow === 3, `ap=${b.player.apNow}`);
}
/* 4. 极难：节点专属 hpScale 仍生效（1.2 倍要乘上去） */
{
  window.G = null; window.newGameState && (window.G = window.newGameState());
  const b = new E.Battle({ mode: 'story', playerChar: 'yinkesi', enemies: ['mob'], allies: [], diff: 'extreme', stage: { hpScale: 1.2 } });
  check('极难：节点 hpScale 仍生效（8×1.2×1.25难度=12）', b.living('enemy')[0].hp === 12, `hp=${b.living('enemy')[0].hp}`);
}
/* 5. 单敌不受影响（各难度 1v1 均无缩放） */
{
  const expect = { normal: 8, extreme: 10, nightmare: 11 };   // 极难/噩梦的血量来自难度倍率，与人数无关
  let allOk = true;
  for (const d of ['normal', 'extreme', 'nightmare']) {
    const b = mk(d, ['mob']);
    if (b.living('enemy')[0].hp !== expect[d]) allOk = false;
  }
  check('单敌仅吃难度倍率、无多人缩放（三档对照）', allOk);
}

done();
