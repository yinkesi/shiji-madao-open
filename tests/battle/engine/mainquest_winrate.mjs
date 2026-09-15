/* 主线 9 节的难度平衡复核：极难档（×1.6、强制狂攻、击破不回血）叠加各节 hpScale 后是否仍可通关。
 *
 * 玩家模型：音克思。按主线推进给出「到这一节时玩家大致有多强」的档位
 * （白板 → 战胜若干人录技 → 拿到支线/试炼的稀有刀卡 → 段位与修炼加成）。
 * 这是保守估计：真实玩家还会去做支线、攒修炼。
 *
 * 用法：node tests/battle/engine/mainquest_winrate.mjs [每格场次，默认 24]
 */
import { loadEngine } from '../helpers/engine_env.mjs';
import { bots } from '../helpers/bot.mjs';

const N = Number(process.argv[2] || 24);
const { E, D, ui } = loadEngine({ ui: { rpsRound: async () => ({ res: 'win', ap: 3 }) } });
const { greedyBot } = bots(E);
ui.playerPhase = greedyBot;

/* 主线各节（与 js/quests.js MAIN 对齐：敌人 / 波次 / hpScale / 强制难度） */
const MAIN = [
  { id: 'm1', name: '初执马刀', enemies: ['wanzhen'], rule: null, hpScale: 1.0, diff: null },
  { id: 'm2', name: '实验三异能者', enemies: ['dage'], waves: [['dage'], ['shenren'], ['xiannv']], rule: 'dyad', hpScale: 1.0, diff: null },
  { id: 'm3', name: '操场三国刀', enemies: ['xiaochuan', 'luhao'], rule: 'dyad', hpScale: 1.0, diff: null },
  { id: 'm4', name: '世界马刀协会', enemies: ['luhao'], waves: [['luhao'], ['xiaochuan'], ['zichen']], rule: 'uprising', hpScale: 0.68, diff: null, restFull: true },
  { id: 'm5', name: '七班刀合流', enemies: ['lifan', 'touge'], rule: 'stench', hpScale: 1.0, diff: null },
  { id: 'm6', name: '刀禁令风波', enemies: ['qinfa', 'weibing'], rule: 'suomen', hpScale: 1.0, diff: null },
  { id: 'm7', name: '马刀之神', enemies: ['wonder'], rule: 'yansuan', hpScale: 1.4, diff: null },
  { id: 'm8', name: '终焉之战', enemies: ['qinfa', 'chongguo'], allies: ['weibing'], rule: 'zhongshu', hpScale: 0.78, diff: 'hard' },
  { id: 'm9', name: '马刀的结局', enemies: ['wonder'], rule: 'cans', hpScale: 1.6, diff: 'hard' },
];

/* 玩家档位：到该节时大致具备的加成（血上限额外 / 额外行动点 / 已持稀有卡 / 已录之技） */
const PROFILES = {
  m1: { hpBonus: 0, ap: 0, rares: [], skill: null },
  m2: { hpBonus: 0, ap: 0, rares: [], skill: null },
  m3: { hpBonus: 0, ap: 0, rares: [], skill: 'xinhui' },
  m4: { hpBonus: 1, ap: 0, rares: [], skill: 'xinhui' },
  m5: { hpBonus: 1, ap: 1, rares: ['b_killheal'], skill: 'xinhui' },
  m6: { hpBonus: 2, ap: 1, rares: ['b_killheal'], skill: 'xinhui' },
  m7: { hpBonus: 2, ap: 1, rares: ['b_killheal', 'b_firststrike'], skill: 'wonder' },
  m8: { hpBonus: 3, ap: 1, rares: ['b_killheal', 'b_firststrike'], skill: 'wonder' },
  m9: { hpBonus: 3, ap: 1, rares: ['b_killheal', 'b_firststrike', 'b_bloodfree'], skill: 'wonder' },
};

/* 登记音克思的测试卡（与 Blades.registerChar 的产物同构） */
function registerYinkesi(prof) {
  const src = prof.skill ? D.CHARACTERS[prof.skill] : null;
  const sk = src ? Object.assign({}, src.skills ? src.skills[0] : src.skill) : null;
  D.CHARACTERS.yinkesi = {
    id: 'yinkesi', name: '音克思', hao: '史官', juan: '各卷', glyph: '史', color: '#a63a2b',
    hp: 10 + prof.hpBonus,
    passive: { name: '刀谱', desc: '测试档位' },
    skill: sk, quote: '', bio: '', playable: true, aggr: 0.7,
  };
}

function applyRares(b, rares, ap) {
  for (let i = 0; i < ap; i++) {
    const boon = D.BOONS.find(x => x.id === 'b_ap');
    if (boon) b._applyBoon(b.player, boon);
  }
  rares.forEach(id => {
    const boon = D.BOONS.find(x => x.id === id);
    if (boon) b._applyBoon(b.player, boon);
  });
}

/* 随机猜拳，与 winrate4.mjs 同分布 */
function randRps() {
  return async () => {
    const r = Math.random();
    return r < 0.4 ? { res: 'win', ap: 4 } : r < 0.75 ? { res: 'draw', ap: 3 } : { res: 'lose', ap: 2 };
  };
}

const DIFFS = ['easy', 'normal', 'hard', 'extreme'];
const rows = [];

for (const q of MAIN) {
  const prof = PROFILES[q.id];
  registerYinkesi(prof);
  const row = { id: q.id, name: q.name, fixed: q.diff, hpScale: q.hpScale, rates: {} };
  for (const diff of DIFFS) {
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const cfg = {
        mode: 'story', playerChar: 'yinkesi',
        enemies: q.enemies.slice(), allies: (q.allies || []).slice(),
        diff: q.diff || diff, aiAggr: 'active',
        rule: q.rule ? { id: q.rule, desc: '平衡采样' } : null,
      };
      if (q.waves) cfg.waves = q.waves.map(w => w.slice());
      if (q.hpScale || q.restFull) {
        cfg.stage = { id: 'probe', hpScale: q.hpScale, restFull: !!q.restFull };
      }
      let b;
      try { b = new E.Battle(cfg); } catch (e) { row.rates[diff] = 'ERR ' + e.message; continue; }
      applyRares(b, prof.rares, prof.ap);
      ui.rpsRound = randRps();
      try { await b.run(); } catch (e) { row.rates[diff] = 'ERR'; continue; }
      if (b.result === 'win') wins++;
    }
    row.rates[diff] = Math.round(wins / N * 100);
  }
  rows.push(row);
}

const head = ['节', '强制', 'hpScale', ...DIFFS.map(d => d)];
const width = [4, 6, 8, 6, 7, 6, 8];
const pad = (s, w) => {
  let len = 0; for (const c of String(s)) len += /[\u4e00-\u9fa5]/.test(c) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, w - len));
};
console.log(head.map((h, i) => pad(h, width[i])).join(''));
console.log('-'.repeat(width.reduce((a, b) => a + b, 0)));
for (const r of rows) {
  console.log([
    pad(r.id, width[0]), pad(r.fixed || '随玩家', width[1]), pad(r.hpScale, width[2]),
    ...DIFFS.map((d, i) => pad(r.rates[d] + '%', width[3 + i])),
  ].join(''));
}
console.log('\n（每格 ' + N + ' 场，greedyBot 玩家，猜拳胜/和/负 = 40/35/25；「强制」列非空表示该节锁定难度，不随玩家设置）');
process.exit(0);
