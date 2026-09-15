/* 实验史记·马刀行 —— 刀谱：音克思的战斗成长系统
   白板基础（血 10、无技、无数值养成）→ 击败录技（主动+被动）→ 支线身怀之技 → 稀有刀卡单携带。
   段位仅为称号。战斗卡牌数据取自 SJI_DATA.CHARACTERS，引擎侧由 _execLearned/hasPassive 数据驱动执行。 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   主角"音克思"的战斗成长系统（游戏里叫"刀谱"）。开局是一张纯白板
   战斗卡（血 10、只有最基础的"史笔"一技），之后每击败一个对手就把
   他的招式"录"进刀谱、变成可装备的战斗卡；完成支线能拿到"身怀之技"
   （永久生效的被动，无需装备）；高难内容奖励"稀有刀卡"（强力被动，
   每场只能携带一张）。段位（九品刀客之类）只是称号，不加数值。

   【架构位置】
   融合层，站在数据层与战斗引擎之间：registerChar() 按当前成长拼出
   音克思的战斗卡、塞回 SJI_DATA.CHARACTERS（数据在 js/data/ 里）；
   applyBoons(battle) 在开战瞬间把装备卡被动、身怀之技、稀有刀卡、
   战大道具注入战斗单位（引擎在 js/battle/engine.js，靠 _innates /
   _learnedFrom / hasPassive 消费这些标记）。quests.js（发奖励）、
   main.js（开战）都会调它。

   【暴露的全局名】
   BLADE_RANKS（段位表）、NO_SKILL_CARD（不出技卡的角色表）、
   BATTLE_ITEMS（战大道具表）、INNATE_INFO（身怀之技说明表）、
   RARE_BOONS（稀有刀卡表）、Blades（主对象：registerChar / grant /
   equip / cards / hasCard / skillCardOf / equippedSkillId / rankName /
   applyBoons / grantRare / innates / grantInnate / selectedRare /
   switchRare / rareList）。

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

/* 段位表：按累计胜场数 w 换算称号，数组按门槛从小到大排。
   查段位时从头扫、取最后一个"门槛 ≤ 胜场"的条目（见 rankOf）。
   段位只是称号，不加任何数值——成长全靠下面的刀谱卡与身怀之技。 */
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
/* key 是道具 id，boon 指向 SJI_DATA.BOONS 里的增益 id——开战时
   applyBoons 按这张表把道具翻译成战斗增益，用完即从 flags 清除。 */
const BATTLE_ITEMS = {
  handcream: { boon: 'b_shield', label: '开局护盾 3' },
  ruler:     { boon: 'b_knife', label: '刀击伤害 +1' },
  corn:      { boon: 'b_firststrike', label: '每回合首刀 +1' },
  bottle:    { boon: 'b_ap', label: '每回合行动点 +1' },
  spin:      { boon: 'b_horse', label: '马踢伤害 +1' },
};

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

/* ----------------------------------------------------------------
   刀谱系统本体：IIFE（立即执行函数表达式）——定义一个函数并立刻调用，
   把返回值存进 Blades。函数内部声明的变量与函数都是私有成员，
   外界只能用到末尾 return 出来的那几个（最朴素的"模块"写法）。
   ---------------------------------------------------------------- */
const Blades = (() => {

  /* 主角白板自带的初始技"史笔"。写成函数（每次调用返回一个全新对象）
     而不是共享常量，避免多处持有同一引用、一处改动处处遭殃。 */
  const defaultSkill = () => ({
    name: '史笔', kind: 'unit', range: 2, ap: 1, dmg: 1, cd: 2,
    desc: '距二内一敌受1伤。（史笔如铁，据实而书）',
  });

  /* 读全局存档状态里的累计胜场。window.G 可能尚未初始化，
     用 && 短路 + || 兜底：G 不存在或没记胜场，一律返回 0。 */
  function wins() { return (window.G && G.wins) || 0; }

  /* 把胜场数换算成段位：从头扫段位表，门槛 w 不超过胜场就记下来，
     扫完手里就是"够得着的最高段位"（表按门槛升序排，所以可行）。 */
  function rankOf(w) {
    let r = BLADE_RANKS[0];
    for (const t of BLADE_RANKS) if (w >= t.w) r = t;
    return r;
  }
  function rankName() { return rankOf(wins()).name; }
  /* 下一档段位：find 返回第一个满足条件的元素，找不到时是 undefined，
     || null 把它规整成 null——JS 表示"没有"有 undefined/null 两种值，
     统一成一种更好判断。 */
  function nextRank() { return BLADE_RANKS.find(t => t.w > wins()) || null; }

  /* 稀有刀卡持有列表。这里是"惰性初始化"惯用法：字段不存在就先用
     || 补上默认值再返回，调用方永远拿到能直接 push 的数组，
     不必先判断它存不存在。 */
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
  /* 发身怀之技：查表确认合法 → includes 去重（已身怀就不再发）→
     存档、弹提示、重新注册主角战斗卡（身怀附加的血量要重算进去）。
     返回 true 表示此次为新入手（结算页据此显示不同文案）。 */
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

  /* 段位仅为称号（无数值加成）——养成只走刀谱卡与身怀之技 */
  /* 发稀有刀卡：同样去重。这里只是"收进列表"，真正生效要等开战时
     applyBoons 把当前携带的那张注入战斗单位。 */
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

  /* 稀有刀卡每场只能携带一张：selectedRare 返回当前携带者（缺省取第一张） */
  function selectedRare() {
    const list = rareList();
    if (!list.length) return null;
    const cur = G.blades.rareEquip;
    if (cur && list.includes(cur)) return cur;
    G.blades.rareEquip = list[0];
    return list[0];
  }
  /* 战斗中切换携带：旧卡效果移除、新卡生效（增益字段一一逆操作） */
  /* 每个 case 都是 battle._applyBoon 加成的手工逆运算——加过几就减几，
     Math.max(0, …) 夹住不让数值变负；项目里没有通用"撤销"机制，
     只能逐项手写，这是无框架小项目的常见取舍。 */
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
  /* 换携带（战斗内外皆可）：battle 传 null 就只改存档记录；
     传 battle 则先摘旧卡效果、把新卡增益注入玩家单位，再写一条战报。 */
  function switchRare(battle, boonId) {
    if (!RARE_BOONS[boonId] || !rareList().includes(boonId)) return false;
    const cur = selectedRare();
    if (battle && cur && cur !== boonId && !battle.over) _removeBoonFx(battle.player, cur);
    G.blades.rareEquip = boonId;
    if (battle) {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === boonId);
      if (boon) battle._applyBoon(battle.player, boon);
      battle.pushLog("更换携带刀卡：「" + RARE_BOONS[boonId].name + "」。（每场仅可携带一张）");
    }
    if (typeof Save !== 'undefined') Save.write();
    return true;
  }

  /* 刀谱已录角色卡的 id 列表，及"录没录过"的快捷判断
     （includes 相当于 Python 的 in）。 */
  function cards() { return (G.blades && G.blades.cards) || []; }
  function hasCard(id) { return cards().includes(id); }

  /* 当前装备的技能卡（角色 id）。NO_SKILL_CARD 里的角色（召唤物/
     纯辅助）不能当技能装备——他们被录时只记其被动为"注疏"。 */
  function equippedSkillId() {
    const eq = (window.G && G.blades && G.blades.equip) || null;
    if (eq && hasCard(eq) && !NO_SKILL_CARD[eq]) return eq;
    return null;
  }

  /* 从角色卡提炼可学技能（拷贝一份，附出处注） */
  /* 角色数据有两种形状（skills 数组或单个 skill 字段），三目运算符
     取其一；召唤类技能不可录。Object.assign({}, sk, …) 是浅拷贝 sk
     再追加 from/fromName 两个出处字段，不会污染原始角色数据。 */
  function skillCardOf(charId) {
    const ch = window.SJI_DATA.CHARACTERS[charId];
    if (!ch || NO_SKILL_CARD[charId]) return null;
    const sk = ch.skills ? ch.skills[0] : ch.skill;
    if (!sk || sk.kind === 'summon') return null;
    return Object.assign({}, sk, { from: charId, fromName: ch.name + '（' + ch.hao + '）' });
  }

  /* 击败后录技入谱；返回 {fresh, name} */
  /* 已录过不重复收录；录到第一张带技能的卡时顺手装备上（equip 还是
     空的话）——新手打完第一场就能直接用上新技，就是这里安排的。 */
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

  /* 手动换装备卡：只能装已收录且出技卡的角色；传空值则卸下
     （!charId 为真时跳过校验、直接置 null）。 */
  function equip(charId) {
    if (charId && (!hasCard(charId) || NO_SKILL_CARD[charId])) return false;
    G.blades = G.blades || { cards: [], equip: null };
    G.blades.equip = charId;
    Save.write();
    return true;
  }

  /* 构建音克思战斗卡并注册进 SJI_DATA（纯白板基础血 10；成长只来自刀谱卡与身怀之技） */
  /* 每次都整卡重造：段位称号、装备技能、身怀血量全是现算的——所以
     开战前重算一次就能反映最新成长。引擎、图鉴、立绘读的都是这里
     写进 SJI_DATA.CHARACTERS 的这一份。 */
  function registerChar() {
    const eqId = equippedSkillId();
    const sk = eqId ? skillCardOf(eqId) : null;
    const innateHp = innates().reduce((a, id) => a + ((INNATE_INFO[id] && INNATE_INFO[id].hp) || 0), 0);
    window.SJI_DATA.CHARACTERS.yinkesi = {
      id: 'yinkesi', name: '音克思', hao: '史官 · ' + rankName(), juan: '各卷',
      glyph: '史', color: '#a63a2b',
      /* 白板基础血 10 + 各身怀之技的附加血量（如「大腹如斗」+10） */
      hp: 10 + innateHp,
      /* 被动描述是模板字符串拼出来的文案：反引号内可跨行、${…} 插值。
         内容 = 称号（纯荣誉）+ 装备卡出处 + 身怀之技清单。 */
      passive: {
        name: eqId ? '刀谱 · ' + rankName() : '白板 · ' + rankName(),
        desc: `称号「${rankName()}」（胜${wins()}场，纯荣誉）。`
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

  /* 开战前注入加成：音克思享刀谱被动与身怀之技，全名册共享稀有刀卡与道具 */
  /* 依次做四件事：
     ① 装备卡被动（记在 _learnedFrom）与身怀之技（记在 _innates）——
        只授给亲自上阵的音克思，引擎的 hasPassive 查这两个集合放行被动；
     ② 文斗增益（骂阵/檄文，读 G.flags.duelWen，一次性）；
     ③ 稀有刀卡（每场携带的那一张）；
     ④ 战大道具（读 G.flags.duelItem，一次性）。
     "flags 取完就置 null" 是本项目的一次性触发惯用法。 */
  function applyBoons(battle) {
    /* 只有主角亲自出战（charId 为空或就是 yinkesi）才吃刀谱/身怀加成；
       点将派别人出战时，对方按自己的本卡打。 */
    const asLead = !battle.player.charId || battle.player.charId === 'yinkesi';
    if (asLead) {
      /* 获得角色 = 获得其全部技能：装备谁的卡，其被动机制即对音克思生效（引擎 hasPassive 多来源） */
      battle.player._learnedFrom = equippedSkillId() || null;
      /* 身怀之技（支线永久继承的被动）：注入多来源集合 */
      battle.player._innates = innates().slice();
      if (innates().length) battle.pushLog("身怀之技：" + innates().map(id => INNATE_INFO[id] ? INNATE_INFO[id].name : '').filter(Boolean).join('、') + "。");
    }
    /* 文笔文斗（约战前选择）：骂阵削敌 / 檄文减冷却；此时才扣文笔 */
    /* 骂阵：扣 10 文笔、敌方全体先掉 1 血（Math.max(1, …) 保底，
       削血但不直接削死）；檄文：扣 20 文笔、本场技能冷却 -1。
       两个分支用完都把 flags 清回 null，防止下一场战斗重复触发。 */
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
    /* 稀有刀卡：每场只能携带一张（左上角可切换） */
    const carried = selectedRare();
    if (carried) {
      const boon = window.SJI_DATA.BOONS.find(b => b.id === carried);
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

  /* 对外出口：只有这个对象字面量里列出的成员外界才够得着
     （registerChar 这种简写表示"属性名与变量同名"）。 */
  return { registerChar, grant, equip, cards, hasCard, skillCardOf, equippedSkillId,
           rankName, applyBoons, grantRare,
           innates, grantInnate, INNATE_INFO,
           selectedRare, switchRare,
           rareList, RARE_BOONS, BATTLE_ITEMS, BLADE_RANKS };
})();

/* 载入即注册音克思战斗卡（G 未建时按 0 胜计；开战时 Blades.registerChar 会按最新胜场重算） */
try { Blades.registerChar(); } catch (e) {}
/* 显式挂载：const 不自动挂 window——跨脚本判活与 Node 测试直读皆依赖此行 */
window.Blades = Blades;
