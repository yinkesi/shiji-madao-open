/* 缴械（seal/disarm）统一回归：为兵的「缴械」真实生效、一回合后过期 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
const { check, done } = checker('缴械机制：seal/disarm 统一');

function mk() {
  return new E.Battle({ mode: 'story', playerChar: 'luhao', enemies: ['mob'], allies: [], diff: 'normal' });
}
function face(b) {
  const p = b.player, f = b.living('enemy')[0];
  p.hasKnife = true; p.apNow = 3; p.r = 3; p.c = 3; f.r = 3; f.c = 4;
  return [p, f];
}

/* 1. seal：缴械后刀击不可用；回合结束递减 */
{
  const b = mk(); const [p, f] = face(b);
  p.st.seal = 1;
  check('seal：缴械中刀击被拒', await b.doKnife(p, f) === false && p.apNow === 3);
  b._tickStatusEnd(p);
  check('seal：回合结束递减', p.st.seal === 0);
  check('seal：过期后刀击恢复', await b.doKnife(p, f) === true);
}
/* 2. disarm（为兵破门而入）：同样封锁刀击并会过期 */
{
  const b = mk(); const [p, f] = face(b);
  p.st.disarm = 1;
  check('disarm：缴械中刀击被拒', await b.doKnife(p, f) === false);
  b._tickStatusEnd(p);
  check('disarm：回合结束过期', p.st.disarm === 0 && (await b.doKnife(p, f) === true));
}
/* 3. AI 尊重 disarm：被缴械的敌人不再刀击 */
{
  const b = mk(); const [p, f] = face(b);
  f.st.disarm = 9; f.st.skip = 0;
  const hp0 = p.hp;
  b.playerPhase = null;
  window.SJI_UI.rpsRound = async (b2) => { b2.over = true; return { res: 'win', ap: 0 }; };
  window.SJI_UI.playerPhase = async () => {};
  f.apNow = 2;
  await b.aiAct(f);
  /* mob 的「围观」是技能（缴械不封技能），刀击被缴——故恰好只损 1 血 */
  check('AI 尊重缴械：敌只放技能不刀击', p.hp === hp0 - 1, `玩家 ${hp0}→${p.hp}（仅技能 1 伤）`);
}

done();
