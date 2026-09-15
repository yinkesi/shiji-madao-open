/* 马之二技：空地驱赶（doDrive）专项
   城墙马踢之外，空地可驱赶相邻敌人——推 2 格、无处可退反受 1 踏、锁门封禁、头哥免疫击退但吃踏。 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
const { check, done } = checker('马之二技：空地驱赶 doDrive');

function mk() {
  return new E.Battle({ mode: 'story', playerChar: 'luhao', enemies: ['mob'], allies: [], diff: 'normal' });
}
function setup(b) {   // 玩家与路人敌人空地贴身，玩家备马 3 动
  const p = b.player, f = b.living('enemy')[0];
  p.hasHorse = true; p.apNow = 3;
  p.r = 3; p.c = 3; f.r = 3; f.c = 4;
  return [p, f];
}

/* 1. 基本驱赶：推开 2 格 */
{
  const b = mk(); const [p, f] = setup(b);
  const ok = await b.doDrive(p, f);
  check('驱赶成功且耗 1 动', ok === true && p.apNow === 2 && f.c === 6, `敌位(${f.r},${f.c})`);
}
/* 2. 无路可退：反受 1 踏（退路被敌人自己人堵死） */
{
  const b = new E.Battle({ mode: 'story', playerChar: 'luhao', enemies: ['mob', 'mob'], allies: [], diff: 'normal' });
  const p = b.player;
  p.hasHorse = true; p.apNow = 3;
  const f = b.living('enemy')[0], b2 = b.living('enemy')[1];
  f.r = 1; f.c = 1; p.r = 2; p.c = 2;   // 我从斜下方驱之，其退向 [0,0]
  b2.r = 0; b2.c = 0;                    // 退路被同伙堵死
  const hp0 = f.hp;
  await b.doDrive(p, f);
  check('无处可退：受 1 点踩踏伤', f.hp === hp0 - 1 && f.r === 1 && f.c === 1, `hp ${hp0}→${f.hp}`);
}
/* 2b. 城墙可站：被驱上城墙者进入马踢射程（机制联动） */
{
  const b = mk(); const [p, f] = setup(b);
  await b.doDrive(p, f);                 // 从 [3,3] 驱向 [3,6]，中途退上城墙？——只验证位移合法
  check('被驱者仍存活且位置合法', f.alive === true && f.r >= 0 && f.c >= 0);
}
/* 3. 头哥卡免疫击退：不吃位移但吃踩踏（用 mob 打不出免疫，直接以头哥为被驱者） */
{
  const b = new E.Battle({ mode: 'story', playerChar: 'luhao', enemies: ['touge'], allies: [], diff: 'normal' });
  const p = b.player, t = b.living('enemy')[0];
  p.hasHorse = true; p.apNow = 3;
  t.st.skip = 9;
  p.r = 3; p.c = 3; t.r = 3; t.c = 4;
  const hp0 = t.hp;
  await b.doDrive(p, t);
  check('头哥免疫击退：不位移但受 1 踏', t.r === 3 && t.c === 4 && t.hp === hp0 - 1, `hp ${hp0}→${t.hp}`);
}
/* 4. 城墙上不可驱赶（该用马踢） */
{
  const b = mk(); const [p, f] = setup(b);
  p.r = 0; p.c = 3; f.r = 0; f.c = 4;   // 双方都在城墙
  const ok = await b.doDrive(p, f);
  check('城墙上驱赶无效（应改用马踢）', ok === false && p.apNow === 3);
}
/* 5. 无马不可驱赶 */
{
  const b = mk(); const [p, f] = setup(b);
  p.hasHorse = false;
  const ok = await b.doDrive(p, f);
  check('无马不可驱赶', ok === false);
}
/* 6. 锁门特则封禁驱赶 */
{
  const b = mk();
  b.rule = { id: 'suomen', desc: 'test' };
  const [p, f] = setup(b);
  const ok = await b.doDrive(p, f);
  check('锁门特则：驱赶亦被封禁', ok === false);
}
/* 7. 不相邻不可驱赶 */
{
  const b = mk(); const [p, f] = setup(b);
  f.r = 3; f.c = 6;   // 同行但隔 2 格
  const ok = await b.doDrive(p, f);
  check('不相邻不可驱赶', ok === false && p.apNow === 3);
}
/* 8. 马踢在城墙场景仍正常（回归） */
{
  const b = mk(); const [p, f] = setup(b);
  p.r = 0; p.c = 0; f.r = 0; f.c = 3;
  const hp0 = f.hp;
  const ok = await b.doHorse(p, f);
  check('马踢回归：城墙上仍可踢', ok === true && f.hp <= hp0 - 3, `hp ${hp0}→${f.hp}`);
}

done();
