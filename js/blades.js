/* 实验史记·马刀行 —— 刀谱：音克思的战斗成长系统
   白板基础（血 10、无技）→ 击败录技（主动+被动）→ 支线身怀之技 → 稀有刀卡逐张开关。
   养成模式（开卷可选）：开=段位与修炼提供数值加成，关=纯白板（段位仅为称号）。
   战斗卡牌数据取自 SJI_DATA.CHARACTERS，引擎侧由 _execLearned/hasPassive 数据驱动执行。 */
/* ================================================================
   【这个文件是干嘛的】
   主角"音克思"的战斗成长系统（游戏里叫"刀谱"）。开局是一张纯白板
   战斗卡（血 10、只有最基础的"史笔"一技），之后每击败一个对手就把
   他的招式"录"进刀谱、变成可装备的战斗卡；完成支线能拿到"身怀之技"
   （永久生效的被动，无需装备）；高难内容奖励"稀有刀卡"（强力被动，
   逐张开关、生效数量玩家自定）。开卷时还可选「养成模式」：开启后
   段位与零花钱买的修炼不再是纯荣誉，而是实打实的血量/行动点加成。

   【架构位置】
   融合层，站在数据层与战斗引擎之间：registerChar() 按当前成长拼出
   音克思的战斗卡、塞回 SJI_DATA.CHARACTERS（数据在 js/data/ 里）；
   applyBoons(battle) 在开战瞬间把装备卡被动、身怀之技、修炼增益、
   稀有刀卡、战大道具注入战斗单位（引擎在 js/battle/engine.js，靠
   _innates / _learnedFrom / hasPassive 消费这些标记）。quests.js
   （发奖励）、duels.js（约战开战）都会调它。

   【暴露的全局名】
   BLADE_RANKS（段位表）、NO_SKILL_CARD（不出技卡的角色表）、
   BATTLE_ITEMS（战大道具表）、UPGRADES/UPGRADE_BOON（修炼表）、
   INNATE_INFO（身怀之技说明表）、RARE_BOONS（稀有刀卡表）、
   Blades（主对象：registerChar / grant / equip / cards / hasCard /
   skillCardOf / equippedSkillId / rankName / applyBoons / grantRare /
   innates / grantInnate / cultivation / rareOn / isRareOn / toggleRare /
   buyUpgrade / upgrades / hpBonus / apBonus / rareList）。

   【新手阅读提示】
   1) 本文件是 IIFE 模块：const Blades = (() => { … return {…}; })()。
      用函数包住内部实现、只把 return 里的成员暴露出去——项目没有
      import/export，这就是最朴素的"模块"写法（详见 config.js 开头）。
   2) JS 的坑：顶层的 const 不会自动挂到 window 上，所以文件末尾有
      window.Blades = Blades 这行显式挂载；别的文件判断它在不在要写
      typeof Blades !== 'undefined'，直接裸名比较会抛 ReferenceError。
   3) G 是全局存档状态对象（在别处定义）。本文件大量使用
      (x && x.y) || 默认值 的"链式兜底"：读之前先确认对象存在，
      不存在就给个安全默认值，防止脚本加载早期 G 还没建好而报错。
   ================================================================ */
'use strict';

/* 段位表：累计胜场 w 达标即晋升（rankOf 会取"最后一个达标"的档位） */
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

/* 修炼（养成模式专用）：零花钱买的永久强化（刀谱面板购买，映射到既有增益体系）。
   price 是"当前等级升下一级"的花费函数：price(lv)，等级越高越贵。 */
const UPGRADES = [
  { id: 'hp',    name: '体魄', desc: '血上限 +2', max: 3, price: lv => 12 + lv * 8 },
  { id: 'knife', name: '刀锋', desc: '刀击伤害 +1', max: 1, price: () => 25 },
  { id: 'horse', name: '马政', desc: '马踢伤害 +1', max: 1, price: () => 25 },
  { id: 'dodge', name: '轻功', desc: '闪避 +15%', max: 1, price: () => 20 },
  { id: 'regen', name: '吐纳', desc: '每回合回复 1 血', max: 1, price: () => 30 },
  { id: 'cd',    name: '算学', desc: '技能冷却 -1', max: 1, price: () => 30 },
  { id: 'ap',    name: '气力', desc: '每回合行动点 +1', max: 1, price: () => 45 },
];
/* 修炼项 → 引擎增益 id 的映射：开战时按它把加成"借道"既有增益体系注入 */
const UPGRADE_BOON = { knife: 'b_knife', horse: 'b_horse', dodge: 'b_dodge', regen: 'b_regen', cd: 'b_cd', ap: 'b_ap' };

/* 身怀之技：支线完成永久继承的角色被动（可多张叠加、无需装备；hp 为额外生命上限）。
   机制侧由引擎 hasPassive(u, charId) 判定（_innates 注入），血量侧由 applyBoons 注入。 */
const INNATE_INFO = {
  dage:      { name: '城墙之梦', desc: '立于城墙时刀击伤害 +1', hp: 0 },
  xinhui:    { name: '灵光乍现', desc: '每第二回合行动点 +1', hp: 0 },
  luhao:     { name: '大腹如斗', desc: '生命上限 +10，刀击数值翻倍', hp: 10 },
  touge:     { name: '球棍意念', desc: '免疫击退', hp: 0 },
  guayu:     { name: '疾如电',   desc: '20% 闪避', hp: 0 },
  zichen:    { name: '班长之威', desc: '相邻敌人对汝伤害 -1', hp: 0 },
  xiaochuan: { name: '卧薪尝胆', desc: '每受伤一次，下次伤害 +1', hp: 0 },
  shenren:   { name: '鲍鱼之肆', desc: '回合结束，相邻敌人各损 1 血', hp: 0 },
  wonder:    { name: '马刀之神', desc: '血祭后接下来两次伤害翻倍', hp: 0 },
  lifan:     { name: '课代表夺权', desc: '购刀不需行动点', hp: 0 },
  guyin:     { name: '皇太子',   desc: '每场一次，受致命伤保留 1 血', hp: 0 },
  shibo:     { name: '吸东来之紫气', desc: '每回合回复 1 血', hp: 0 },
};

/* 稀有刀卡：高难试炼首通 / 支线所授的质变被动（每场常驻）
   注：每条都必须在 SJI_DATA.BOONS 里有对应的可注入增益，否则 applyBoons 静默失效 */
const RARE_BOONS = {
  b_bloodfree:   { name: '以道代血', desc: '血祭不再损血，只耗行动点。（道之所在，血不轻洒）' },
  b_cleave:      { name: '刀扫一片', desc: '刀击同时波及相邻的另一名敌人。（马刀本是横扫之术）' },
  b_horsereach:  { name: '长杆马刀', desc: '马踢射程 +1。（加长一寸，强出一分）' },
  b_killheal:    { name: '庆功之宴', desc: '击破敌人回复 4 血，原为 2。（大胜而归，理当加餐）' },
  b_shield:      { name: '班主任的偏爱', desc: '每场开局获得 3 点护盾。（含笑素善大哥，此之谓也）' },
  b_firststrike: { name: '先手刀', desc: '每回合首次刀击伤害 +1。（唯快不破）' },
  b_horse:       { name: '马踏连营', desc: '马踢伤害 +1。（一连踏营，声势浩大）' },
};

const Blades = (() => {

  /* 白板默认技「史笔」：射程 2、1 伤、冷却 2——开局唯一手段 */
  const defaultSkill = () => ({
    name: '史笔', kind: 'unit', range: 2, ap: 1, dmg: 1, cd: 2,
    desc: '距二内一敌受1伤。（史笔如铁，据实而书）',
  });

  /* 胜场数：刀谱成长的主时钟（段位、养成加成全看它）；window.G 未建时兜底 0 */
  function wins() { return (window.G && G.wins) || 0; }

  /* 段位查询三件套：从头扫段位表取"最后一个达标"的，就是当前段位 */
  function rankOf(w) {
    let r = BLADE_RANKS[0];
    for (const t of BLADE_RANKS) if (w >= t.w) r = t;
    return r;
  }
  function rankName() { return rankOf(wins()).name; }
  function nextRank() { return BLADE_RANKS.find(t => t.w > wins()) || null; }

  /* 已入手的稀有刀卡 id 列表（G.blades 结构没建就先补建——"懒初始化"惯用法） */
  function rareList() {
    if (!window.G) return [];
    if (!G.blades) G.blades = { cards: [], equip: null };
    G.blades.rare = G.blades.rare || [];
    return G.blades.rare;
  }
  /* 身怀之技：支线完成永久继承的被动（可叠加，无需装备） */
  function innates() {
    if (!window.G) return [];
    if (!G.blades) G.blades = { cards: [], equip: null };
    G.blades.innates = G.blades.innates || [];
    return G.blades.innates;
  }
  /* 授予身怀之技：去重→存档→弹提示→立刻重算战斗卡（血上限可能变了） */
  function grantInnate(charId) {
    if (!INNATE_INFO[charId]) return false;
    if (!innates().includes(charId)) {
      innates().push(charId);
      const info = INNATE_INFO[charId];
      if (typeof Save !== 'undefined') Save.write();
      if (window.toast) toast(`身怀之技＋1：「${info.name}」——${info.desc}（常驻，无需装备）`, '承');
      if (window.SJI_DATA) registerChar();
      return true;
    }
    return false;
  }

  /* 修炼等级表：形如 { hp: 2, knife: 1 }（没买过的项不在表里，读时 || 0 兜底） */
  function upgrades() {
    if (!window.G) return {};
    G.upgrades = G.upgrades || {};
    return G.upgrades;
  }
  /* 养成模式开关：关=纯白板（无数值加成），开=段位+修炼生效 */
  function cultivation() { return !!(window.G && window.G.cultivation); }
  /* 段位 → 战斗加成（仅养成模式）：血上限看胜场（8 场 +1，封顶 4）+ 体魄修炼；
     行动点看胜场（15 场 +1，封顶 3）+ 气力修炼 */
  function hpBonus() { return cultivation() ? Math.min(4, Math.floor(wins() / 8)) + (upgrades().hp || 0) * 2 : 0; }
  function apBonus() { return cultivation() ? Math.min(3, Math.floor(wins() / 15)) + (upgrades().ap || 0) : 0; }

  /* 买修炼：验开关→验条目→验等级上限→扣零花钱→等级+1→重算战斗卡→存档 */
  function buyUpgrade(id) {
    if (!cultivation()) { toast('养成模式未开：开卷时可选「养成模式」', '禁'); return false; }
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

  /* 发稀有刀卡：收进列表并默认启用。这里只是"收进列表"，真正生效要等
     开战时 applyBoons 把当前开关集合逐张注入战斗单位。 */
  function grantRare(boonId) {
    const def = RARE_BOONS[boonId];
    if (!def) return false;
    if (!rareList().includes(boonId)) {
      rareList().push(boonId);
      rareOn().push(boonId);   // 新入手默认启用（可在战场左上角或刀谱面板关闭）
      if (typeof Save !== 'undefined') Save.write();
      if (window.toast) toast(`稀有刀卡入手：「${def.name}」——${def.desc}`, '谱');
      return true;
    }
    return false;
  }

  /* 稀有刀卡：每张独立开关，生效数量由玩家自定（rareOn = 当前生效集合） */
  function rareOn() {
    if (!window.G) return [];
    if (!G.blades) G.blades = { cards: [], equip: null };
    G.blades.rareOn = (G.blades.rareOn || []).filter(id => rareList().includes(id));
    return G.blades.rareOn;
  }
  function isRareOn(id) { return rareOn().includes(id); }
  /* 把一张刀卡的增益从战斗单位上手工作"逆运算"摘除：每个 case 对应
     _applyBoon 加过的字段，加过几就减几，Math.max(0, …) 夹住不让数值
     变负。项目里没有通用"撤销"机制，只能逐项手写——这是无框架小项目
     的常见取舍。 */
  function _removeBoonFx(u, id) {
    const b = u.boons;
    switch (id) {
      case 'b_hp': u.maxhp = Math.max(1, u.maxhp - 2); u.hp = Math.min(u.hp, u.maxhp); break;
      case 'b_knife': b.knife = Math.max(0, (b.knife || 0) - 1); break;
      case 'b_horse': b.horse = Math.max(0, (b.horse || 0) - 1); break;
      case 'b_regen': b.regen = Math.max(0, (b.regen || 0) - 1); break;
      case 'b_dodge': b.dodge = Math.max(0, +((b.dodge || 0) - 0.15).toFixed(2)); break;
      case 'b_blood': b.blood2 = false; break;
      case 'b_cd': b.cdReduce = Math.max(0, (b.cdReduce || 0) - 1); break;
      case 'b_move': b.move = Math.max(0, (b.move || 0) - 1); break;
      case 'b_ap': b.apBonus = Math.max(0, (b.apBonus || 0) - 1); break;
      case 'b_bloodfree': b.bloodFree = false; break;
      case 'b_cleave': b.cleave = 0; break;
      case 'b_horsereach': b.horseRange = Math.max(0, (b.horseRange || 0) - 1); break;
      case 'b_killheal': b.killHeal = 0; break;
      case 'b_shield': b.shield = Math.max(0, (b.shield || 0) - 3); u.st.shield = Math.max(0, u.st.shield - 3); break;
      case 'b_firststrike': b.firstStrike = Math.max(0, (b.firstStrike || 0) - 1); break;
    }
  }
  /* 开/关一张稀有刀卡（战斗内外皆可）：battle 传 null 就只改存档记录；
     传 battle 则立刻注入（开）或逆运算摘除（关）该卡增益并写战报——
     战场上换卡不用等下一场。 */
  function toggleRare(battle, boonId) {
    if (!RARE_BOONS[boonId] || !rareList().includes(boonId)) return false;
    const on = isRareOn(boonId);
    if (on) {
      const list = rareOn();
      const i = list.indexOf(boonId);
      if (i >= 0) list.splice(i, 1);
      if (battle && !battle.over) _removeBoonFx(battle.player, boonId);
      battle && battle.pushLog("收回稀有刀卡：「" + RARE_BOONS[boonId].name + "」。（效果即刻解除）");
    } else {
      rareOn().push(boonId);
      if (battle && !battle.over) {
        const boon = window.SJI_DATA.BOONS.find(b => b.id === boonId);
        if (boon) battle._applyBoon(battle.player, boon);
      }
      battle && battle.pushLog("启用稀有刀卡：「" + RARE_BOONS[boonId].name + "」。（即刻生效）");
    }
    if (typeof Save !== 'undefined') Save.write();
    return true;
  }

  /* 已录技的角色 id 列表 / 判断某角色录没录过 */
  function cards() { return (G.blades && G.blades.cards) || []; }
  function hasCard(id) { return cards().includes(id); }

  /* 当前装备的技卡 id：必须是"已录且出技卡"的角色，否则视为白板（返回 null） */
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

  /* 击败后录技入谱；返回 {fresh, name} 供结算文案区分"首录"与"重复" */
  function grant(charId) {
    if (!G.blades) G.blades = { cards: [], equip: null };
    if (!G.blades.cards.includes(charId)) {
      G.blades.cards.push(charId);
      /* 首个可装备的技自动装上（白板期打完第一场立刻有技可用） */
      if (!G.blades.equip && skillCardOf(charId)) G.blades.equip = charId;
      const ch = window.SJI_DATA.CHARACTERS[charId];
      const sk = skillCardOf(charId);
      if (window.toast) toast(sk ? `刀谱录新技「${sk.name}」——出自 ${ch.hao}` : `刀谱录得「${ch.hao}」之名`, '谱');
      return { fresh: true, name: ch.hao };
    }
    return { fresh: false, name: window.SJI_DATA.CHARACTERS[charId].hao };
  }

  /* 换装备技卡：charId 传 null = 卸下回白板；没录过/不出技卡的角色拒绝 */
  function equip(charId) {
    if (charId && (!hasCard(charId) || NO_SKILL_CARD[charId])) return false;
    G.blades = G.blades || { cards: [], equip: null };
    G.blades.equip = charId;
    Save.write();
    return true;
  }

  /* 构建音克思战斗卡并注册进 SJI_DATA：基础血 10 + 养成加成 + 身怀附加血。
     开战前重算一次就能反映最新成长。引擎、图鉴、立绘读的都是这里
     写进 SJI_DATA.CHARACTERS 的这一份。 */
  function registerChar() {
    const eqId = equippedSkillId();
    const sk = eqId ? skillCardOf(eqId) : null;
    /* 各身怀之技的附加血量求和（如「大腹如斗」+10） */
    const innateHp = innates().reduce((a, id) => a + ((INNATE_INFO[id] && INNATE_INFO[id].hp) || 0), 0);
    window.SJI_DATA.CHARACTERS.yinkesi = {
      id: 'yinkesi', name: '音克思', hao: '史官 · ' + rankName(), juan: '各卷',
      glyph: '史', color: '#a63a2b',
      /* 血 10（白板底子）+ 养成血加成 + 身怀附加血 */
      hp: 10 + hpBonus() + innateHp,
      /* 被动描述是模板字符串拼出来的文案：反引号内可跨行、${…} 插值。
         内容 = 养成/称号段 + 装备卡出处 + 身怀之技清单。 */
      passive: {
        name: eqId ? '刀谱 · ' + rankName() : '白板 · ' + rankName(),
        desc: (cultivation()
          ? `养成中：血上限+${hpBonus()}，每回合行动点+${apBonus()}（胜${wins()}场）。`
          : `称号「${rankName()}」（胜${wins()}场，纯荣誉）。`)
          + (eqId ? `技与被动承「${window.SJI_DATA.CHARACTERS[eqId].hao}」——其被动机制对汝生效。`
                 : '白板无技——去赢一场，录他一技（连被动一并承之）。')
          + (innates().length ? ` 身怀：${innates().map(id => INNATE_INFO[id] ? '「' + INNATE_INFO[id].name + '」' : '').join('')}（常驻）。` : ''),
      },
      skill: sk,
      quote: '规则至简，而引人入胜。',
      bio: '史官执刀，为立传而战。胜一场，录一技。',
      playable: true, aggr: 0.7,
    };
    return window.SJI_DATA.CHARACTERS.yinkesi;
  }

  /* 开战前注入加成（按序执行）：
     ① 装备卡被动（记在 _learnedFrom）与身怀之技（记在 _innates）——
        只授给亲自上阵的音克思，引擎的 hasPassive 查这两个集合放行被动；
     ② 养成模式（仅开启时）：行动点加成与各项修炼，"借道"BOONS 增益注入；
     ③ 文斗增益（骂阵削敌/檄文减冷却，读 G.flags.duelWen，此时才扣文笔）；
     ④ 稀有刀卡（rareOn 开关集合，逐张注入）；
     ⑤ 战大道具（读 G.flags.duelItem，一次性）。
     "flags 取完就置 null" 是本项目的一次性触发惯用法。 */
  function applyBoons(battle) {
    /* 只有主角亲自出战（charId 为空或就是 yinkesi）才吃刀谱/身怀/修炼加成；
       点将派别人出战时，对方按自己的本卡打。 */
    const asLead = !battle.player.charId || battle.player.charId === 'yinkesi';
    if (asLead) {
      /* 获得角色 = 获得其全部技能：装备谁的卡，其被动机制即对音克思生效（引擎 hasPassive 多来源） */
      battle.player._learnedFrom = equippedSkillId() || null;
      if (battle.player._learnedFrom) {
        const src = window.SJI_DATA.CHARACTERS[battle.player._learnedFrom];
        battle.pushLog("承「" + src.hao + "」之技与被动「" + (src.passive ? src.passive.name : '') + "」。");
      }
      /* 身怀之技（支线永久继承的被动）：注入多来源集合 */
      battle.player._innates = innates().slice();
      if (innates().length) battle.pushLog("身怀之技：" + innates().map(id => INNATE_INFO[id] ? INNATE_INFO[id].name : '').filter(Boolean).join('、') + "。");
      /* 养成模式：行动点加成先注入，再按修炼表逐项借道对应增益 */
      if (cultivation()) {
        const n = apBonus();
        for (let i = 0; i < n; i++) battle._applyBoon(battle.player, window.SJI_DATA.BOONS.find(b => b.id === 'b_ap'));
        for (const id of Object.keys(UPGRADE_BOON)) {
          if ((upgrades()[id] || 0) > 0) battle._applyBoon(battle.player, window.SJI_DATA.BOONS.find(b => b.id === UPGRADE_BOON[id]));
        }
      }
    }
    /* 文笔文斗（约战前选择）：骂阵削敌 / 檄文减冷却；此时才扣文笔 */
    const duelWen = (window.G && G.flags && G.flags.duelWen) || null;
    if (duelWen === 'ma') {
      window.Engine.addWen(-10);
      let n = 0;
      battle.living('enemy').forEach(f => { f.hp = Math.max(1, f.hp - 1); n++; });
      battle.pushLog("骂阵先声：敌方全员 -1 血（共 " + n + " 人）。");
      window.G.flags.duelWen = null;
      if (typeof Save !== 'undefined') Save.write();
    } else if (duelWen === 'xi') {
      window.Engine.addWen(-20);
      const boon = window.SJI_DATA.BOONS.find(b => b.id === 'b_cd');
      if (boon) battle._applyBoon(battle.player, boon);
      battle.pushLog("檄文传遍战场：本场技能冷却 -1。");
      window.G.flags.duelWen = null;
      if (typeof Save !== 'undefined') Save.write();
    }
    /* 稀有刀卡：生效数量由玩家自定（逐张开关） */
    rareOn().forEach(bid => {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === bid);
      if (boon) battle._applyBoon(battle.player, boon);
    });
    /* 开战明示：本场哪些东西在生效（承技/身怀/稀有卡） */
    const carryNames = rareOn().map(bid => (RARE_BOONS[bid] || {}).name).filter(Boolean);
    if (carryNames.length) battle.pushLog("携带稀有刀卡：" + carryNames.map(n => '「' + n + '」').join('') + "。");
    /* 战大道具：一次性（用完置 null），增益同样借道 BOONS */
    const itemId = (window.G && G.flags && G.flags.duelItem) || null;
    if (itemId && BATTLE_ITEMS[itemId]) {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === BATTLE_ITEMS[itemId].boon);
      if (boon) battle._applyBoon(battle.player, boon);
      G.flags.duelItem = null;
      if (typeof Save !== 'undefined') Save.write();
    }
  }

  /* 对外接口：只有 return 里列出的成员外界才摸得到 */
  return { registerChar, grant, equip, cards, hasCard, skillCardOf, equippedSkillId,
           rankName, applyBoons, grantRare,
           innates, grantInnate, INNATE_INFO, cultivation,
           rareOn, isRareOn, toggleRare, buyUpgrade, upgrades, UPGRADES, hpBonus, apBonus,
           rareList, RARE_BOONS, BATTLE_ITEMS, BLADE_RANKS };
})();

/* 载入即注册音克思战斗卡（G 未建时按 0 胜计；开战时 Blades.registerChar 会按最新胜场重算） */
try { Blades.registerChar(); } catch (e) {}
/* 显式挂载：const 不自动挂 window——跨脚本判活与 Node 测试直读皆依赖此行 */
window.Blades = Blades;
