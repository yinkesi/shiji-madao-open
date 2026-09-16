/* ============================================================
 * 实验史记 · 马刀风云 —— 配置中心（单一事实来源）
 * 所有可调参数集中于此：网格尺寸、规则常量、难度表、AI 档位、
 * 击破回血、以寡敌众补偿、敌方血量缩放、种树上限。
 * 改平衡只改这里；engine.js / ui.js 只读取。
 * ============================================================ */
/* ============================================================
 * 【新手导读】
 * 【这个文件是干嘛的】战斗的全部"可调数值"都集中在这张表里：棋盘
 *   大小、猜拳行动点、回合上限、难度曲线、AI 性格、画布尺寸……
 *   想调平衡只改这一个文件，不用碰任何逻辑代码。
 * 【架构位置】battle 层的最底层。index.html 正常加载它（排在 engine.js
 *   之前），engine.js / battle-ui.js 启动时经 window.SJI_CONFIG 读取。
 * 【暴露的全局名】window.SJI_CONFIG —— 即文件末尾 return 的那个对象：
 *   GRID / RULES / DIFFICULTY / DMG_BY_COUNT / HP_BY_COUNT /
 *   SURVIVAL_HP_EXTRA / FREE_HP_MULT / AI_AGGR / AI_LABEL / AI_ALLY / CANVAS。
 * 【新手阅读提示】整份文件用的是"模块模式"：
 *   window.SJI_CONFIG = (function () { ... })();  这种"定义完立刻自己
 *   调用自己"的写法叫 IIFE（立即执行函数表达式），return 出去的才是
 *   对外接口，中间那些 const 全是外部摸不到的私有表。
 *   "use strict" 是严格模式：让一些隐蔽写法直接报错，而不是默默容忍。
 * ============================================================ */
window.SJI_CONFIG = (function () {
  "use strict";

  /* ---------- 网格 ---------- */
  /* 棋盘几何三件套。{ 键: 值, ... } 是 JS 的对象字面量，之后用
     GRID.SIZE 这样"点"出字段；engine 按它摆棋盘，UI 按它算像素。 */
  const GRID = {
    SIZE: 7,        // 7×7
    TILE: 96,       // 单格像素
    PAD: 20         // 画布内边距
  };
  // 给 GRID 追加一个字段：画布总边长 = 7 格 × 96 像素 + 左右内边距。
  // （JS 对象随时可以"点"出新键，这里等于表建好后又补了一格。）
  GRID.CS = GRID.SIZE * GRID.TILE + GRID.PAD * 2;   // 画布边长

  /* ---------- 规则常量（卷八《马刀书》＋运营性补充） ---------- */
  /* 战斗规则的核心数字。这些键名被 engine.js 按原样引用
     （如 CFG.RULES.MAX_ROUND），想改名得两边同步。 */
  const RULES = {
    // 猜拳（开局前每回合猜一次）决定本回合行动点：赢家动 4 格，输的也能动 2 格。
    RPS_AP: { win: 4, draw: 3, lose: 2 },   // 猜拳胜/和/负 的行动点
    MAX_ROUND: 30,                          // 单场回合上限（超出按血量比例判定/判负）
    KILL_HEAL_BASE: 2,                      // 击破基础回血（极难为 0；「庆功之宴」+2）
    // 以寡敌众补偿：敌人每多 1 名，玩家 +1 行动点（封顶 apCap）、
    // 开局 +1 血上限（封顶 hpCap），让"一对多"还有得打（仅普通及以下难度）。
    OUTNUMBER: { apPer: 1, apCap: 3, hpPer: 1, hpCap: 2 },  // 以寡敌众补偿
    // 血祭的门槛：当前血量低于 2 不许祭（有「以道代血」增益则免疫此限制）。
    SAC_MIN_HP: 2,
    // 行动点上限：再怎么攒，一回合最多 8 点。
    // （注意：本行行尾那条注释实际说的是上一行 SAC_MIN_HP，是历史遗留的错位。）
    AP_CAP: 8,                          // 血祭所需最低血量（无「以道代血」时）
    TREE_CAP: 3,                            // 崇国场上树木上限（树木皆死）
    // 存的是增益 id 字符串，对应 data.js 里 BOONS 表的 b_bloodfree（「以道代血」）。
    BLOOD_FREE_BOON: "b_bloodfree"          // 使血祭免损血的增益 id
  };

  /* ---------- 难度表 ----------
   * apSolo / apBig : 敌方行动点（1–2 名敌人 / 3 名以上）
   * dmgMul         : 敌方伤害倍率（叠加在按人数的基础缩放之上）
   * hpExtra        : 敌方血量额外倍率（剧情/生存）
   * killHeal       : 玩家击破回血基础值
   * forceFrenzy    : 强制敌方 AI 使用「狂攻」档
   */
  const DIFFICULTY = {
    /* 键名（easy…nightmare）是难度档的"名字"，存档和引擎都按字符串取：
       engine 里写 CFG.DIFFICULTY[this.diff]。极难/噩梦的"强制狂攻 /
       最优 AI"由引擎直接判断难度名实现，这里的 forceFrenzy / optimal
       两个布尔值是说明位，引擎并不读它们。 */
    easy:    { apSolo: 2, apBig: 1, dmgMul: 0.70, hpExtra: 1.00, killHeal: 2, forceFrenzy: false },
    normal:  { apSolo: 3, apBig: 2, dmgMul: 1.00, hpExtra: 1.00, killHeal: 2, forceFrenzy: false },
    hard:    { apSolo: 4, apBig: 2, dmgMul: 1.15, hpExtra: 1.00, killHeal: 2, forceFrenzy: false },
    extreme: { apSolo: 5, apBig: 3, dmgMul: 1.35, hpExtra: 1.25, killHeal: 0, forceFrenzy: true },
    /* 噩梦：敌方全员最优行动（aiActNightmare 枚举走位×行动取最优），且资源碾压 */
    nightmare: { apSolo: 6, apBig: 4, dmgMul: 1.5, hpExtra: 1.4, killHeal: 0, forceFrenzy: false, optimal: true }
  };

  /* 下面两张表的键名直接写成数字。JS 对象的键其实都是字符串，
     写 1 会自动变成 "1"；用方括号 DMG_BY_COUNT[人数] 取值时同样
     自动转换，所以照常能用——这是 JS 的常用取表手法。 */
  /* 敌方按人数的基础伤害缩放（以少打多为常态，人多则单体递减） */
  const DMG_BY_COUNT = { 1: 0.90, 2: 0.88, 3: 0.75, 4: 0.65 };
  /* 剧情/生存敌方血量按人数缩放（乱斗模式另有难度倍率） */
  const HP_BY_COUNT = { 1: 1.00, 2: 0.85, 3: 0.70, 4: 0.62 };
  const SURVIVAL_HP_EXTRA = 0.90;           // 生存模式敌方血量额外系数
  // 乱斗（自由对战）模式里，敌方血量先按难度整体乘这个倍率（引擎读 FREE_HP_MULT[diff]）。
  const FREE_HP_MULT = { easy: 0.8, normal: 1, hard: 1.2, extreme: 1.35, nightmare: 1.5 };  // 乱斗血量倍率

  /* ---------- AI 进攻性档位 ----------
   * skill   : 技能使用意愿（会叠加角色 aggr 微调）
   * sac     : 血祭倾向
   * retreat : 残血（≤34%）撤退概率
   * keep    : 逡巡不前概率（远离目标）
   * focus   : 目标选择 nearest=最近 weakest=残血优先
   * horse   : 买马意愿
   */
  /* AI 性格档案表：难度与设置界面指定档位名，engine 整包取用
     （CFG.AI_AGGR.frenzy 之类），再叠加角色自己的 aggr 微调。 */
  const AI_AGGR = {
    passive:  { skill: 0.35, sac: 0.04, retreat: 0.70, keep: 0.55, focus: "nearest", horse: 0.30 },
    measured: { skill: 0.65, sac: 0.20, retreat: 0.35, keep: 0.25, focus: "nearest", horse: 0.70 },
    active:   { skill: 0.90, sac: 0.40, retreat: 0.10, keep: 0, focus: "weakest", horse: 1.0 },
    frenzy:   { skill: 1.00, sac: 0.75, retreat: 0, keep: 0, focus: "weakest", horse: 1.0 }
  };
  // 档位英文名 -> 中文显示名，界面上展示用。
  const AI_LABEL = { passive: "消极", measured: "守成", active: "主动", frenzy: "狂攻" };
  const AI_ALLY = AI_AGGR.active;   // 友军固定「主动」，避免拖累玩家

  /* ---------- 画布 ---------- */
  /* 画布绘制参数。TILE/PAD/CS 是把 GRID 里的值再抄一份给 UI 层用——
     常数只有一份，改 GRID 这边自动跟着变。 */
  const CANVAS = {
    TILE: GRID.TILE, PAD: GRID.PAD, CS: GRID.CS,
    TOKEN_R: 29,          // 单位半径
    HP_BAR_W: 56,         // 血条宽
    PARTICLE_CAP: 320     // 粒子池上限
  };

  /* 对外接口：把要公开的表打包 return，外面就以 window.SJI_CONFIG 的
     身份读取。没列在这里的（没有）外部拿不到。 */
  return {
    GRID, RULES, DIFFICULTY, DMG_BY_COUNT, HP_BY_COUNT, SURVIVAL_HP_EXTRA,
    FREE_HP_MULT, AI_AGGR, AI_LABEL, AI_ALLY, CANVAS
  };
})();
