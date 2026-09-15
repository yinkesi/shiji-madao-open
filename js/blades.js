/* 实验史记·马刀行 —— 刀谱：音克思的战斗成长系统
   击败马刀手 → 其技录入刀谱（可装备为技能）；声望段位随胜场提升（血上限/行动点加成）。
   战斗卡牌数据直接取自 SJI_DATA.CHARACTERS 的技能定义，引擎侧由 _execLearned 数据驱动执行。 */
'use strict';

const BLADE_RANKS = [
  { w: 0,  name: '未入册' },
  { w: 1,  name: '执刀生' },
  { w: 3,  name: '九品刀客' },
  { w: 6,  name: '八品刀客' },
  { w: 10, name: '七品刀客' },
  { w: 15, name: '六品刀客' },
  { w: 21, name: '五品刀客' },
  { w: 28, name: '四品刀客' },
  { w: 36, name: '三品刀客' },
  { w: 45, name: '二品刀客' },
  { w: 55, name: '一品刀客' },
  { w: 66, name: '马刀之神' },
];

/* 有些角色不出技卡（召唤/召唤物/纯辅助），只录其被动为注疏 */
const NO_SKILL_CARD = { chongguo: true, tree: true, mob: true, keai: true };

/* 行囊道具 → 战前一次性增益（来呀来呀前可择一使用） */
const BATTLE_ITEMS = {
  handcream: { boon: 'b_shield', label: '开局护盾 3' },
  ruler:     { boon: 'b_knife', label: '刀击伤害 +1' },
  corn:      { boon: 'b_firststrike', label: '每回合首刀 +1' },
  bottle:    { boon: 'b_ap', label: '每回合行动点 +1' },
  spin:      { boon: 'b_horse', label: '马踢伤害 +1' },
};

/* 修炼：零花钱买的永久强化（刀谱面板购买，映射到既有增益体系） */
const UPGRADES = [
  { id: 'hp',    name: '体魄', desc: '血上限 +2', max: 3, price: lv => 12 + lv * 8 },
  { id: 'knife', name: '刀锋', desc: '刀击伤害 +1', max: 1, price: () => 25 },
  { id: 'horse', name: '马政', desc: '马踢伤害 +1', max: 1, price: () => 25 },
  { id: 'dodge', name: '轻功', desc: '闪避 +15%', max: 1, price: () => 20 },
  { id: 'regen', name: '吐纳', desc: '每回合回复 1 血', max: 1, price: () => 30 },
  { id: 'cd',    name: '算学', desc: '技能冷却 -1', max: 1, price: () => 30 },
  { id: 'ap',    name: '气力', desc: '每回合行动点 +1', max: 1, price: () => 45 },
];
const UPGRADE_BOON = { knife: 'b_knife', horse: 'b_horse', dodge: 'b_dodge', regen: 'b_regen', cd: 'b_cd', ap: 'b_ap' };

/* 稀有刀卡：高难试炼首通所授的质变被动（每场常驻） */
const RARE_BOONS = {
  b_bloodfree:   { name: '以道代血', desc: '血祭不再损血，只耗行动点。（道之所在，血不轻洒）' },
  b_cleave:      { name: '刀扫一片', desc: '刀击同时波及相邻的另一名敌人。（马刀本是横扫之术）' },
  b_horsereach:  { name: '长杆马刀', desc: '马踢射程 +1。（加长一寸，强出一分）' },
  b_killheal:    { name: '庆功之宴', desc: '击破敌人回复 4 血，原为 2。（大胜而归，理当加餐）' },
  b_shield:      { name: '班主任的偏爱', desc: '每场开局获得 3 点护盾。（含笑素善大哥，此之谓也）' },
  b_firststrike: { name: '先手刀', desc: '每回合首次刀击伤害 +1。（唯快不破）' },
};

const Blades = (() => {

  const defaultSkill = () => ({
    name: '史笔', kind: 'unit', range: 2, ap: 1, dmg: 1, cd: 2,
    desc: '距二内一敌受1伤。（史笔如铁，据实而书）',
  });

  function wins() { return (window.G && G.wins) || 0; }

  function rankOf(w) {
    let r = BLADE_RANKS[0];
    for (const t of BLADE_RANKS) if (w >= t.w) r = t;
    return r;
  }
  function rankName() { return rankOf(wins()).name; }
  function nextRank() { return BLADE_RANKS.find(t => t.w > wins()) || null; }

  function upgrades() {
    if (!window.G) return {};
    G.upgrades = G.upgrades || {};
    return G.upgrades;
  }
  function rareList() {
    if (!window.G) return [];
    if (!G.blades) G.blades = { cards: [], equip: null };
    G.blades.rare = G.blades.rare || [];
    return G.blades.rare;
  }

  /* 段位 → 战斗加成（白板基础血 10，靠段位/修炼长上去） */
  function hpBonus() { return Math.min(4, Math.floor(wins() / 8)) + (upgrades().hp || 0) * 2; }
  function apBonus() { return Math.min(3, Math.floor(wins() / 15)) + (upgrades().ap || 0); }

  function buyUpgrade(id) {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return false;
    const lv = upgrades()[id] || 0;
    if (lv >= def.max) return false;
    const cost = def.price(lv);
    if (G.money < cost) { toast(`零花钱不够（需 ◉${cost}）`, '恶'); return false; }
    Engine.addMoney(-cost);
    upgrades()[id] = lv + 1;
    if (window.SJI_DATA) registerChar();
    Save.write();
    toast(`修炼有成：「${def.name}」${def.desc}`, '炼');
    Engine.award('ach_upgrade');
    return true;
  }

  function grantRare(boonId) {
    const def = RARE_BOONS[boonId];
    if (!def) return false;
    if (!rareList().includes(boonId)) {
      rareList().push(boonId);
      Save.write();
      toast(`稀有刀卡入手：「${def.name}」——${def.desc}`, '谱');
      return true;
    }
    return false;
  }

  function cards() { return (G.blades && G.blades.cards) || []; }
  function hasCard(id) { return cards().includes(id); }

  function equippedSkillId() {
    const eq = (window.G && G.blades && G.blades.equip) || null;
    if (eq && hasCard(eq) && !NO_SKILL_CARD[eq]) return eq;
    return null;
  }

  /* 从角色卡提炼可学技能（拷贝一份，附出处注） */
  function skillCardOf(charId) {
    const ch = window.SJI_DATA.CHARACTERS[charId];
    if (!ch || NO_SKILL_CARD[charId]) return null;
    const sk = ch.skills ? ch.skills[0] : ch.skill;
    if (!sk || sk.kind === 'summon') return null;
    return Object.assign({}, sk, { from: charId, fromName: ch.name + '（' + ch.hao + '）' });
  }

  /* 击败后录技入谱；返回 {fresh, name} */
  function grant(charId) {
    if (!G.blades) G.blades = { cards: [], equip: null };
    if (!G.blades.cards.includes(charId)) {
      G.blades.cards.push(charId);
      if (!G.blades.equip && skillCardOf(charId)) G.blades.equip = charId;
      const ch = window.SJI_DATA.CHARACTERS[charId];
      const sk = skillCardOf(charId);
      if (window.toast) toast(sk ? `刀谱录新技「${sk.name}」——出自 ${ch.hao}` : `刀谱录得「${ch.hao}」之名`, '谱');
      return { fresh: true, name: ch.hao };
    }
    return { fresh: false, name: window.SJI_DATA.CHARACTERS[charId].hao };
  }

  function equip(charId) {
    if (charId && (!hasCard(charId) || NO_SKILL_CARD[charId])) return false;
    G.blades = G.blades || { cards: [], equip: null };
    G.blades.equip = charId;
    Save.write();
    return true;
  }

  /* 构建音克思战斗卡并注册进 SJI_DATA（白板起步：无技、段位与修炼随成长实时变化） */
  function registerChar() {
    const eqId = equippedSkillId();
    const sk = eqId ? skillCardOf(eqId) : null;
    const up = upgrades();
    const upDesc = Object.keys(UPGRADE_BOON)
      .filter(k => up[k]).map(k => UPGRADES.find(u => u.id === k).name).join('、');
    window.SJI_DATA.CHARACTERS.yinkesi = {
      id: 'yinkesi', name: '音克思', hao: '史官 · ' + rankName(), juan: '各卷',
      glyph: '史', color: '#a63a2b',
      hp: 10 + hpBonus(),
      passive: {
        name: eqId ? '刀谱 · ' + rankName() : '白板 · ' + rankName(),
        desc: `胜${wins()}场：血上限+${hpBonus()}，每回合行动点+${apBonus()}。`
          + (upDesc ? `修炼：${upDesc}。` : '')
          + (eqId ? `技出「${window.SJI_DATA.CHARACTERS[eqId].hao}」所授。` : '白板无技——去赢一场，录他一技。'),
      },
      skill: sk,
      quote: '规则至简，而引人入胜。',
      bio: '史官执刀，为立传而战。胜一场，录一技。',
      playable: true, aggr: 0.7,
    };
    return window.SJI_DATA.CHARACTERS.yinkesi;
  }

  /* 开战前注入加成：音克思享段位+修炼，全名册共享稀有刀卡与道具 */
  function applyBoons(battle) {
    const asLead = !battle.player.charId || battle.player.charId === 'yinkesi';
    if (asLead) {
      const n = apBonus();
      for (let i = 0; i < n; i++) battle._applyBoon(battle.player, window.SJI_DATA.BOONS.find(b => b.id === 'b_ap'));
      for (const id of Object.keys(UPGRADE_BOON)) {
        if ((upgrades()[id] || 0) > 0) battle._applyBoon(battle.player, window.SJI_DATA.BOONS.find(b => b.id === UPGRADE_BOON[id]));
      }
    }
    for (const bid of rareList()) {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === bid);
      if (boon) battle._applyBoon(battle.player, boon);
    }
    const itemId = (window.G && G.flags && G.flags.duelItem) || null;
    if (itemId && BATTLE_ITEMS[itemId]) {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === BATTLE_ITEMS[itemId].boon);
      if (boon) battle._applyBoon(battle.player, boon);
      G.flags.duelItem = null;
      if (typeof Save !== 'undefined') Save.write();
    }
  }

  return { registerChar, grant, equip, cards, hasCard, skillCardOf, equippedSkillId,
           rankName, nextRank, hpBonus, apBonus, applyBoons, buyUpgrade, grantRare,
           upgrades, rareList, UPGRADES, RARE_BOONS, BATTLE_ITEMS, BLADE_RANKS };
})();

/* 载入即注册音克思战斗卡（G 未建时按 0 胜计；开战时 Blades.registerChar 会按最新胜场重算） */
try { Blades.registerChar(); } catch (e) {}
