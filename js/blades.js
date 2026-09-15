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

  /* 段位 → 战斗加成 */
  function hpBonus() { return Math.min(4, Math.floor(wins() / 8)); }
  function apBonus() { return Math.min(3, Math.floor(wins() / 15)); }

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

  /* 构建音克思战斗卡并注册进 SJI_DATA（段位加成随胜场实时变化） */
  function registerChar() {
    const sk = equippedSkillId() ? skillCardOf(equippedSkillId()) : defaultSkill();
    window.SJI_DATA.CHARACTERS.yinkesi = {
      id: 'yinkesi', name: '音克思', hao: '史官 · ' + rankName(), juan: '各卷',
      glyph: '史', color: '#a63a2b',
      hp: 10 + hpBonus(),
      passive: {
        name: '刀谱 · ' + rankName(),
        desc: `胜${wins()}场：血上限+${hpBonus()}，每回合行动点+${apBonus()}。`
          + (equippedSkillId() ? `技出「${window.SJI_DATA.CHARACTERS[equippedSkillId()].hao}」所授。` : '尚未录得他人之技。'),
      },
      skill: sk,
      quote: '规则至简，而引人入胜。',
      bio: '史官执刀，为立传而战。胜一场，录一技。',
      playable: true, aggr: 0.7,
    };
    return window.SJI_DATA.CHARACTERS.yinkesi;
  }

  /* 开战前注入段位加成与战大道具（在 Battle 构造后调用） */
  function applyBoons(battle) {
    const n = apBonus();
    for (let i = 0; i < n; i++) battle._applyBoon(battle.player, window.SJI_DATA.BOONS.find(b => b.id === 'b_ap'));
    const itemId = (window.G && G.flags && G.flags.duelItem) || null;
    if (itemId && BATTLE_ITEMS[itemId]) {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === BATTLE_ITEMS[itemId].boon);
      if (boon) battle._applyBoon(battle.player, boon);
      G.flags.duelItem = null;
      if (window.Save) Save.write();
    }
  }

  return { registerChar, grant, equip, cards, hasCard, skillCardOf, equippedSkillId,
           rankName, nextRank, hpBonus, apBonus, applyBoons, BLADE_RANKS, defaultSkill, BATTLE_ITEMS };
})();

/* 载入即注册音克思战斗卡（G 未建时按 0 胜计；开战时 Blades.registerChar 会按最新胜场重算） */
try { Blades.registerChar(); } catch (e) {}
