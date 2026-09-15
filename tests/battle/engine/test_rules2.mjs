/* 高难试炼特则专项：cans / stench / yansuan / suomen / zhengshi / zhongshu
 * 断言只看"第一个回合"——rps 第二次被调用即标记 over，防止 AI 全场行为污染。 */
import { loadEngine, checker } from '../helpers/engine_env.mjs';

const { E } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 0 }) } });
const { check, done } = checker('高难试炼特则六则');

function mk(cfg) {
  return new E.Battle(Object.assign({ mode: 'story', playerChar: 'luhao', allies: [], diff: 'normal' }, cfg));
}
/* 只跑一个回合：第二次猜拳时结束战斗 */
function oneRound(b) {
  let n = 0;
  window.SJI_UI.rpsRound = async (b2) => {
    n++;
    if (n >= 2) { b2.over = true; return { res: 'win', ap: 0 }; }
    return { res: 'win', ap: 0 };
  };
}
function stunAll(b) { b.living('enemy').forEach(u => { u.st.skip = 9; }); }

/* 1. 看台飞瓶：与敌人同行/同列 → 回合开始损 1 血 */
{
  const b = mk({ enemies: ['shaoming'], rule: { id: 'cans', desc: 'test' } });
  const foe = b.living('enemy')[0];
  b.player.r = foe.r; b.player.c = (foe.c + 1) % E.SIZE;   // 同行异列
  const hp0 = b.player.hp;
  oneRound(b);
  await b.run();
  check('看台飞瓶：同行者回合开始被砸 1 血', b.log.some(l => l.includes('饮料瓶')) && b.player.hp < hp0, `hp ${hp0}→${b.player.hp}`);
}

/* 2. 验算：wonder 回合末血量为偶 → 回 1 血（晕住他，防血祭污染） */
{
  const b = mk({ enemies: ['wonder'], rule: { id: 'yansuan', desc: 'test' } });
  const w = b.living('enemy')[0];
  w.st.skip = 9;
  w.hp = 6; w.maxhp = Math.max(w.maxhp, 10);
  oneRound(b);
  await b.run();
  check('验算：偶数血回合末 +1（6→7）', w.hp === 7, `hp=${w.hp}`);
}

/* 3. 锁门：马踢不可用 */
{
  const b = mk({ enemies: ['shaoming'], rule: { id: 'suomen', desc: 'test' } });
  const p = b.player;
  await b.doBuyHorse(p);
  const foe = b.living('enemy')[0];
  p.r = 0; p.c = 0; foe.r = 0; foe.c = 3;   // 双方都在城墙
  const ok = await b.doHorse(p, foe);
  check('锁门：城墙上马踢被特则封禁', ok === false);
}

/* 4. 争食：站在饭上回合末回 2 血，饭消失（晕住羚羊防抢饭） */
{
  const b = mk({ enemies: ['limo'], rule: { id: 'zhengshi', desc: 'test' } });
  const p = b.player;
  stunAll(b);
  p.hp = 5; p.maxhp = Math.max(p.maxhp, 10);
  p.r = 1; p.c = 3;   // 饭点
  oneRound(b);
  await b.run();
  check('争食：饭上者回 2 血', p.hp >= 7, `hp 5→${p.hp}`);
  check('争食：那份饭消失', b._food.length === 2, `剩 ${b._food.length} 份`);
}

/* 5. 鲍鱼之肆：相邻敌我互相腐蚀（确定性摆位于中央空地，晕住防噪声） */
{
  const b = mk({ enemies: ['touge'], rule: { id: 'stench', desc: 'test' } });
  const t = b.living('enemy')[0];
  const p = b.player;
  t.st.skip = 9;
  t.r = 3; t.c = 3;      // 中央空地
  p.r = 3; p.c = 4;      // 紧贴
  const pt = t.hp, pp = p.hp;
  oneRound(b);
  await b.run();
  check('鲍鱼之肆：贴身双方各损 1 血', t.hp === pt - 1 && p.hp === pp - 1, `头哥 ${pt}→${t.hp}，玩家 ${pp}→${p.hp}`);
}

/* 6. 种树不绝：崇国每回合自动种树（≤3） */
{
  const b = mk({ enemies: ['chongguo'], rule: { id: 'zhongshu', desc: 'test' } });
  oneRound(b);
  await b.run();
  const trees = b.units.filter(u => u.alive && u.charId === 'tree' && u.side === 'enemy').length;
  check('种树不绝：一回合后崇国已种树', trees >= 1, `树 ${trees} 株`);
}

/* 7. 无特则不误伤：普通战斗照常可胜 */
{
  const b = mk({ enemies: ['mob'] });
  window.SJI_UI.rpsRound = async () => ({ res: 'win', ap: 3 });
  const { bots } = await import('../helpers/bot.mjs');
  window.SJI_UI.playerPhase = bots(E).smartPlay;
  const r = await Promise.race([b.run(), new Promise(res => setTimeout(() => res('HANG'), 20000))]);
  check('普通战斗不受特则代码影响', r === 'win', `result=${r}`);
}

done();
