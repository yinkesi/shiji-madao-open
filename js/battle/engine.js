/* ============================================================
 * 实验史记 · 马刀风云 —— 战斗引擎（据卷八《马刀书》）
 * 规则：开局人皆位于己城，中有空地。以猜拳定行动：胜三动、和二动、负一动。
 * 行动：买刀、买马、用技、行动、血祭。猜拳胜四动、和三动、负二动。同城（城墙）以马踢之，扣三血并踢下城；
 * 同区以刀击之，扣一血。血祭者，扣当前之半血而令下次伤害翻倍。活者为王。
 * ============================================================ */
/* ============================================================
 * 【新手导读】SJI_ENGINE —— 马刀战棋的「规则大脑」（DOM 无关）
 *
 * 【这个文件是干嘛的】
 * 7×7 棋盘上的回合制战棋引擎：开局众人立于己方城墙，猜拳定行动点
 * （胜多、和次、负少），随后买刀买马、走位、刀击/马踢/血祭/放技能，
 * 放倒所有敌人即胜。它只「算规则」，不画一像素：所有演出（飘字、音效、
 * 弹窗、动画）都通过 window.SJI_UI 钩子请 js/battle-ui.js 代劳。
 * 正因为不碰页面元素，它能在 Node 里裸跑——tests/battle/engine/ 下的
 * test_*.mjs 测试就是把它和假 UI 拼在一起跑的。
 *
 * 【架构位置】
 * battle 层（window.SJI_* 命名空间）三件套：js/battle/config.js 出平衡
 * 参数（本文件里的 CFG），js/battle/data.js 出角色与技能数据（D），本文件
 * 把两者搅在一起模拟整场战斗；js/battle-ui.js 是它的「显示器 + 手柄」。
 * 这套「引擎/UI 分离」是全项目最值得学的设计：规则不依赖浏览器，才能被
 * 自动化测试反复锤打。本项目没有 import/export，index.html 按固定顺序
 * 加载 22 个 <script>；顶层 const 不挂 window，跨文件一律走 window.SJI_*。
 *
 * 【暴露的全局名】
 * window.SJI_ENGINE —— 即文件末尾 IIFE return 出来的
 * { Battle, isWall, inB, cheb, manh, adj, SIZE, makeUnit }。
 * 外界主要用 new SJI_ENGINE.Battle(cfg) 开一场战斗，await battle.run()
 * 跑到分出胜负，再查 battle.result。
 *
 * 【新手阅读提示】推荐顺序：
 *   1) 配置：js/battle/config.js 的 RULES / DIFFICULTY / AI_AGGR 等常量表；
 *   2) 状态初始化：makeUnit（一枚棋子的全部字段）→ 构造器 → _build（摆子、调血量）；
 *   3) 主回合循环：run()（一回合的完整时序，引擎的心跳）→ aiAct（AI 怎么过回合）；
 *   4) 技能/特则分派：doSkill 的 switch，以及散落各处的 this.rule.id（9 种剧情特则）；
 *   5) 收尾：伤害管线 calcDamage → dealDamage，回合末结算 _endRound。
 * 两个高频 JS 惯用法：await（在此暂停，等界面演完/玩家点完再继续）；
 * x || 默认值（取不到就兜底）。战场参数 hpScale/restFull/blocked 只从
 * cfg.stage 读取；terrain（障碍物画法）也在 stage，但由 UI 侧消费。
 * ============================================================ */
window.SJI_ENGINE = (function () {
  "use strict";
  // 依赖的全局配置中心与角色数据表（index.html 保证它们先于本文件加载）。
  const CFG = window.SJI_CONFIG;
  const D = window.SJI_DATA;
  // 棋盘边长（7×7）与单场回合上限（超时判负，见 run() 里的对应分支）。
  const SIZE = 7;
  const MAX_ROUND = 30;

  /* ---------- 几何小工具：引擎所有「距离/方位」讨论的语汇 ---------- */
  // isWall(r,c)：是否站在四周一圈「城墙」上（马踢只在墙上可用，站墙另有加成）。
  // inB(r,c)：坐标是否在棋盘内（r=行、c=列，都从 0 数起）。
  // cheb：切比雪夫距离（像国际象棋的王，斜走也算 1 格），判定「相邻」用它；
  // manh：曼哈顿距离（只横竖走），马踢射程用它量；adj：两者相邻（贴脸）。
  const isWall = (r, c) => r === 0 || r === SIZE - 1 || c === 0 || c === SIZE - 1;
  const inB = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const cheb = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
  const manh = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  const adj = (a, b) => cheb(a, b) === 1;
  // DIRS：八个方向的 [行增量, 列增量]，找邻格时挨个试。
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  // SPAWNS：8 个标准出生点（四角 + 四边中点），玩家固定占其中的 [6,3]。
  const SPAWNS = [[0,0],[0,6],[6,0],[6,6],[0,3],[6,3],[3,0],[3,6]];

  /* sleep：停 ms 毫秒再往下走（返回 Promise，配 await 用）。
     战斗里到处 await sleep(...)，是给界面动画留播放时间——引擎的节奏感全靠它；
     播放速度设置会把等待打 1 / 0.6 / 0.3 折（测试里拨到最快档，几乎不等）。 */
  function sleep(ms) {
    const mult = [1, 0.6, 0.3][(window.SJI.settings && window.SJI.settings.speed) ? window.SJI.settings.speed - 1 : 0];
    return new Promise(res => setTimeout(res, Math.max(16, ms * mult)));
  }

  /* ---------- 造棋子：一枚棋子 = 角色在本场的全部状态 ---------- */
  /* makeUnit：按角色 id 造一枚棋子。字段按组记——
     身份：uid（"阵营_序号"，存档对齐用）、ch（指向 data.js 的角色数据）、charId、side；
     血量：hp/maxhp；位置：r/c 逻辑格（rx/ry 渲染坐标，见 _place）；
     装备：hasKnife/hasHorse；状态：st 异常表、cds 冷却表、boons 增益表。
     之后所有战斗逻辑都在读写这些字段，看懂这里等于看懂半个引擎。 */
  function makeUnit(charId, side, idx) {
    const ch = D.CHARACTERS[charId];
    if (!ch) throw new Error("未知角色: " + charId);
    return {
      uid: side + "_" + idx, ch, charId, side,
      hp: ch.hp, maxhp: ch.hp,
      // r/c 是逻辑坐标；rx/ry 是给 UI 的渲染坐标（注意 rx 对应列、ry 对应行）。
      r: 0, c: 0, rx: 0, ry: 0,
      // offField > 0 表示「被遣返回家」，数值是倒数中的回家回合数。
      alive: true, offField: 0,
      hasKnife: false, hasHorse: false,
      // 异常状态表：skip=跳过回合数、poison=中毒回合数、apMod=行动点增减（多为负）、
      // disarm/seal=缴械（不能刀击）、silence=沉默（不能施技）、shield=护盾值、
      // bloodlust=血祭层数（下次伤害翻倍）、grudge/empower=一次性加伤值（用掉即清零）。
      st: { skip: 0, poison: 0, apMod: 0, disarm: 0, silence: 0, seal: 0, shield: 0, bloodlust: 0, grudge: 0, empower: 0 },
      // cds：各技能的剩余冷却（键=技能序号）；usedSave：免死被动「每场限一次」的记号。
      cds: {}, usedSave: false,
      // apNow：本回合剩余行动点（引擎里的「货币」）；roundDealt：本回合个人输出；
      // dampUsed：「依然」被动每回合一次减伤的记号。
      apNow: 0, roundDealt: 0, dampUsed: false,
      // boons：增益表（出身/生存三选一所得），多为永久加值，各结算处按需读取。
      boons: { knife: 0, horse: 0, move: 0, dodge: 0, regen: 0, apBonus: 0, cdReduce: 0, blood2: false,
               bloodFree: false, cleave: 0, horseRange: 0, killHeal: 0, shield: 0, firstStrike: 0 },
      // AI 个人进攻性（0~1，默认 0.6）。注意 || 兜底的副作用：aggr 为 0 也会被换成 0.6。
      aggr: ch.aggr || 0.6
    };
  }

/* ============================================================
 * Battle 类：一场战斗从摆子到分胜负的全部状态与逻辑。
 * 用法：const b = new Battle(cfg) 开局 → await b.run() 跑完 → 查 b.result。
 * ============================================================ */
  class Battle {
    /* cfg: {mode:'story'|'free'|'survival', stage, playerChar, enemies[], allies[], diff, survivalWave} */
    /* cfg 除注释所列还可带：rule（特则）、triggers（剧情台词）、aiAggr（AI 档位）、
       waves（多波敌人）。stage 是关卡参数包：hpScale=敌方血量倍率、
       restFull=波次间回满血、blocked=障碍格——引擎只从 cfg.stage 读取。 */
    constructor(cfg) {
      this.cfg = cfg;
      this.mode = cfg.mode;
      this.diff = cfg.diff || "normal";
      // 剧情特则 {id, desc}，共 9 种：dyad 同门 / uprising 起义 / chaos 党争（原版），
      // cans 看台飞瓶 / stench 鲍鱼之肆 / yansuan 验算 / suomen 锁门 /
      // zhengshi 争食 / zhongshu 种树不绝（本作新增）。引擎没有集中的特则区，
      // 各特则按触发时机散在 doKnife/doHorse/calcDamage/run/_endRound/aiAct 等处，
      // 全局搜 this.rule 可一网打尽。
      this.rule = cfg.rule || null;
      // 剧情台词触发器：[{when, round/wave/char, lines}]；这里给每条补 fired 标记，
      // 保证一段对话只播一次。
      this.triggers = (cfg.triggers || []).map(t => Object.assign({}, t, { fired: false }));
      // 敌方 AI 进攻性档位（passive 消极 / measured 守成 / active 主动 / frenzy 狂攻），
      // 具体数值查 config.js 的 AI_AGGR 表。
      this.aiAggr = cfg.aiAggr || "active";
      this.boonsTaken = [];
      // 地形：关卡可用 blocked 指定障碍格（桌子/讲台等），不可通行、不可站立
      const blk = (cfg.stage && cfg.stage.blocked) ? cfg.stage.blocked : [];
      this.blocked = new Set(blk.map(rc => rc[0] + "," + rc[1]));
      // round=回合数；over=终局旗（各处一见 over 便收手）；result 为 'win'/'lose'/'timeout'。
      this.round = 0;
      this.over = false;
      this.result = null; // 'win'|'lose'|'timeout'
      this.log = [];
      // units：全场所有棋子（含后来入场的树/援军）；player 是玩家棋子的快捷引用。
      this.units = [];
      // 多波次关卡：waves=[第 1 波敌人 id 表, 第 2 波, ...]；waveIndex=打到第几波。
      this.waveIndex = 0;
      this.waves = cfg.waves || [cfg.enemies];
      // stats：整场统计（结算与成就判定用）：是否用过技/买马/血祭、玩家全程最低血、
      // 是否离开过城墙、步数、治疗量、击杀数等。
      this.stats = {
        usedSkill: false, boughtHorse: false, usedBlood: false, minHp: undefined,
        everLeftWall: false, moves: 0, heals: 0, kills: 0, rushHit: false,
        startEnemies: 0
      };
      this._build();
    }

    /* ---------- 场地与生成 ---------- */
    _build() {
      // 玩家
      const p = makeUnit(this.cfg.playerChar, "player", 0);
      // 友军
      const allies = (this.cfg.allies || []).map((id, i) => makeUnit(id, "ally", i));
      // 敌人（首波）
      const wave = this.waves[0] || [];
      // 生存模式：程序生成
      let enemyIds = wave;
      if (this.mode === "survival") { enemyIds = this._survivalWave(1); this.survivalWaveNo = 1; }
      const enemies = enemyIds.map((id, i) => makeUnit(id, "enemy", i));
      this.stats.startEnemies = enemies.length;

      // 摆子：玩家钉在下方 [6,3]；其余出生点按行分成 far（上半场，留给敌人）与
      // near（下半场，留给友军），各自洗牌后挨个领取，不够就随机找空格。
      const spots = SPAWNS.slice();
      // 玩家固定下方，友军其侧，敌人远端
      const playerSpot = [6, 3];
      spots.splice(spots.findIndex(s => s[0] === 6 && s[1] === 3), 1);
      this._place(p, playerSpot);
      const ok = spots.filter(sp => this.passable(sp[0], sp[1]));
      const far = ok.filter(sp => sp[0] <= 2);
      const near = ok.filter(sp => sp[0] > 2);
      // 洗牌
      const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      shuf(far); shuf(near);
      allies.forEach(u => this._place(u, near.pop() || [3, 3]));
      enemies.forEach(u => this._place(u, far.pop() || this._randomFree()));

      // 乱斗难度血量修正
      if (this.mode === "free") {
        const mult = CFG.FREE_HP_MULT[this.diff] || 1;
        enemies.forEach(u => { if (!u.ch.boss) { u.maxhp = Math.max(4, Math.round(u.maxhp * mult)); u.hp = u.maxhp; } });
      } else {
        // 剧情/生存：敌方血池随人数递减，避免一对多时输出不敷
        // （极难/噩梦：多人平衡失效——敌人不减少血量；节点专属 hpScale 仍生效）
        const stg = (this.cfg && this.cfg.stage) ? this.cfg.stage : null;
        let k = (stg && stg.hpScale !== undefined) ? stg.hpScale
          : (this.diff === "extreme" || this.diff === "nightmare") ? 1.0
          : CFG.HP_BY_COUNT[Math.min(4, enemies.length)];
        if (this.diff === "extreme") k *= CFG.DIFFICULTY.extreme.hpExtra;   // 极难：敌方更耐打
        if (this.diff === "nightmare") k *= CFG.DIFFICULTY.nightmare.hpExtra;   // 噩梦：敌方更耐打
        if (k !== 1) enemies.forEach(u => { u.maxhp = Math.max(4, Math.round(u.maxhp * k)); u.hp = u.maxhp; });
      }

      this.units = [p, ...allies, ...enemies];

      this.player = p;
      // 开局护盾类出身：把 boons 里预存的护盾折算成本场实际生效的 st.shield。
      if (p.boons.shield > 0) p.st.shield += p.boons.shield;
      this._trackMinHp(p);
      // battle 级 roundDealt：玩家阵营本回合总输出（攒满 5 点亮「连环快攻」成就标记）。
      this.roundDealt = 0;
      this.pushLog("—— 马刀场开。规则至简，而引人入胜。——");
      if (this.rule) this.pushLog("【特则】" + this.rule.desc);
    }

    // 落子：写逻辑坐标，同时对齐渲染坐标（rx 跟列 c、ry 跟行 r）。
    _place(u, rc) { u.r = rc[0]; u.c = rc[1]; u.rx = u.c; u.ry = u.r; }

    // 随机找个能站的格子：先碰运气 120 次，不行就全图扫一遍，最坏回中心 [3,3]。
    _randomFree() {
      for (let t = 0; t < 120; t++) {
        const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
        if (this.passable(r, c)) return [r, c];
      }
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (this.passable(r, c)) return [r, c];
      return [3, 3];
    }

    // 生存模式第 n 波的敌人名单：小怪 1~4 只随波数增长，逢 5 波添一名精英压阵。
    _survivalWave(n) {
      const list = [];
      const count = Math.min(1 + Math.ceil(n / 2), 4);
      for (let i = 0; i < count; i++) list.push("mob");
      if (n === 5) list.push("hanxiao");
      if (n === 10) list.push("wonder");
      if (n === 15) list.push("chongguo");
      if (n === 20) list.push("weibing");
      // 「| 0」是按位或 0，效果等于砍掉小数取整；这句让 20 波后每 5 波从精英池轮换一个。
      if (n > 20 && n % 5 === 0) list.push(["hanxiao", "wonder", "chongguo", "weibing", "touge"][n / 5 % 5 | 0]);
      return list;
    }

    /* 可通行：在界内、非障碍、无单位（不含城墙——城墙是"同城"语义，可走） */
    passable(r, c) {
      return inB(r, c) && !this.blocked.has(r + "," + c) && !this.unitAt(r, c);
    }

    unitAt(r, c) {
      if (!this.units) return null;   // 布阵阶段 units 尚未装配
      return this.units.find(u => u.alive && u.offField <= 0 && u.r === r && u.c === c) || null;
    }
    // living：还活着且在场的某方单位列表；不传 side 就是全场（_endRound 遍历用）。
    living(side) { return this.units.filter(u => u.alive && u.offField <= 0 && (!side || u.side === side)); }
    // opponentsOf：u 的所有存活敌人——玩家与友军互为同阵营。
    opponentsOf(u) {
      const hostile = u.side === "enemy" ? ["player", "ally"] : ["enemy"];
      return this.units.filter(x => x.alive && x.offField <= 0 && hostile.includes(x.side));
    }

    // 战报：记入 log（只留最近 120 条），并实时推给 UI 显示。
    pushLog(s) { this.log.push(s); if (this.log.length > 120) this.log.shift(); if (window.SJI_UI) window.SJI_UI.onLog(s); }

    /* ---------- 伤害核心 ---------- */
    /* 被动多来源判定：角色自身 + 音克思装备的刀卡 + 身怀之技（支线永久继承，可叠加）
       全部被动判定一律走 hasPassive(u, charId)，不得直接比较 charId。 */
    hasPassive(u, id) {
      if (u.charId === id) return true;
      // 音克思（开放世界主角）没有天生被动，靠两处「学来的」补足：装备卡的来源
      // _learnedFrom、身怀之技数组 _innates——这就是「多来源判定」的另外两源。
      if (u.charId === "yinkesi") {
        if (u._learnedFrom === id) return true;
        if (u._innates && u._innates.includes(id)) return true;
      }
      return false;
    }

    _passiveImmuneStun(u) { return this.hasPassive(u, "xiannv") || this.hasPassive(u, "wanzhen"); }

    /* 伤害计算第一段：只「算数」，不扣血不演出（那是 dealDamage 的事）。
       流程分四段：攻方加成 → 倍率翻倍 → 守方减伤 → 至少 1 点封底。
       opts 开关：type=伤害类型、pierce=穿透、noBlood=不吃血祭、
       dyad=套用「同门」特则、noScale=不吃敌方人数缩放、min0=允许 0 伤。 */
    calcDamage(att, def, base, opts = {}) {
      let dmg = base;
      const t = opts.type || "knife";
      if (t === "knife") {
      // —— 攻方加成段：大哥站墙 +1、微荣 +1，再叠装备/增益的刀伤加成 ——
        if (this.hasPassive(att, "dage") && isWall(att.r, att.c)) dmg += 1;
        if (this.hasPassive(att, "weirong")) dmg += 1;
        dmg += att.boons.knife || 0;
      }
      if (t === "horse") dmg += att.boons.horse || 0;
      if (this.hasPassive(att, "luhao") && t === "knife") dmg *= 2;   // 大腹如斗：刀击数值翻倍
      if (att.boons && att.boons.firstStrike && t === "knife" && !att._usedFirstStrike) {
        att._usedFirstStrike = true; dmg += att.boons.firstStrike;
      }
      if (this.hasPassive(att, "wenbin") && t === "knife" && Math.random() < 0.3) {   // 秒之：三成机率双倍
        dmg *= 2;
        this.pushLog("「斌」秒之！一笔算出，伤害翻倍。");
        window.SJI_UI.fxFloat(def, "秒之！", "#ffd98a");
      }
      // 一次性资源兑现：血祭层数让伤害翻倍并消耗一层；empower/grudge 是加一次就清零的加值。
      if (att.st.bloodlust > 0 && !opts.noBlood) { dmg *= 2; att.st.bloodlust--; }
      if (att.st.empower > 0) { dmg += att.st.empower; att.st.empower = 0; }
      if (att.st.grudge > 0) { dmg += att.st.grudge; att.st.grudge = 0; }
      // 条件加成：玉润残血 +1；邵明/勤发打半血目标 +1；大展与可靠贴身 +1。
      if (this.hasPassive(att, "yurun") && att.hp < 5) dmg += 1;
      if (this.hasPassive(att, "shaoming") && def.hp <= def.maxhp / 2) dmg += 1;
      if (this.hasPassive(att, "qinfa") && def.hp <= def.maxhp / 2) dmg += 1;
      if (this.hasPassive(att, "dazhan") && this._keaiAdjacent(att)) dmg += 1;
      // 剧情规则：敌人相邻同门
      if (opts.dyad && (opts.type === "knife" || opts.type === "horse") && att.side === "enemy" && this.living("enemy").length === 2 && this._friendlyAdjacent(att)) dmg += 1;
      // 敌方伤害按人数缩放（围殴时单体递减，详见 enemyDmgScale）。
      if (att.side === "enemy" && !opts.noScale) {
        const sc = this.enemyDmgScale();
        if (sc !== 1) dmg = Math.max(1, Math.round(dmg * sc));
      }
      // 守方减伤
      if (!opts.pierce) {
        if (this.hasPassive(def, "hanxiao")) dmg -= 1;
        if (this.hasPassive(def, "zichen") && adj(att, def)) dmg -= 1;
        if (this.hasPassive(def, "yiran") && !def.dampUsed) { dmg -= 1; def.dampUsed = true; }
        // 护盾吸收已移至 dealDamage（在最小伤害钳制之后）
      }
      // 封底：伤害至少 1 点（min0 场景除外）——「绝对打不动」在马刀世界不存在。
      return Math.max(opts.min0 ? 0 : 1, dmg);
    }

    // 「同门」特则的判定：敌方恰好两名、且这人身边站着同伴（同伴压阵，刀马伤害 +1）。
    _friendlyAdjacent(u) {
      const same = u.side === "enemy" ? "enemy" : u.side;
      return this.living(same).some(x => x !== u && adj(x, u));
    }
    // 大展被动的触发条件：同阵营有个「可靠」贴身。
    _keaiAdjacent(dazhan) {
      return this.units.some(x => x.alive && x.offField <= 0 && x.charId === "keai" && x.side === dazhan.side && adj(x, dazhan));
    }

    /* 伤害计算第二段：真正「扣血 + 演出 + 死亡结算」。
       顺序：攻击动画 → 闪避判定 → 算伤 → 护盾吸收 → 扣血 → 死亡/击破回血。
       本身没有 await，标 async 只为与其它行动原语统一地 await 调用。 */
    async dealDamage(att, def, base, opts = {}) {
      if (!def.alive || def.offField > 0 || this.over) return 0;
      if (window.SJI_UI && window.SJI_UI.fxAttack) window.SJI_UI.fxAttack(att, def, { type: opts.type || "knife" });
      // pierce=穿透：无视闪避与减伤（卫兵的破门技自带，也可由 opts 传入）。
      const pierce = opts.pierce || (att && this.hasPassive(att, "weibing"));
      // 闪避
      if (!pierce && !opts.noDodge) {
        let dodge = 0;
        if (this.hasPassive(def, "guayu")) dodge += 0.2;
        if (this.hasPassive(def, "xiangdong")) dodge += 0.25;
        dodge += def.boons.dodge || 0;
        if (dodge > 0 && Math.random() < dodge) {
          this.pushLog("「" + def.ch.hao + "」疾如电，避之！");
          window.SJI_UI.fxFloat(def, "闪避！", "#7fb2ff");
          window.SJI_AUDIO.dodge();
          return 0;
        }
      }
      let dmg = this.calcDamage(att, def, base, { ...opts, pierce });
      // 护盾吸收（最小伤害钳制后，可完全格挡）
      if (!opts.pierce && def.st.shield > 0) {
        const ab = Math.min(def.st.shield, dmg);
        def.st.shield -= ab;
        dmg -= ab;
      }
      def.hp -= dmg;
      this._trackMinHp(def);
      // 记输出：battle 级（本回合全队）与 unit 级（个人）两本账。
      if (att.side === "player") { this.roundDealt += dmg; att.roundDealt = (att.roundDealt || 0) + dmg; }
      // 小川被动
      if (this.hasPassive(def, "xiaochuan") && dmg > 0) def.st.grudge = Math.min(2, def.st.grudge + 1);
      // 首次跌到半血：触发剧情对话（playerLow / enemyLow）。
      if (def.alive && def.hp > 0 && def.hp <= def.maxhp / 2) {
        if (def.side === "player") this._checkTriggers("playerLow");
        else if (def.side === "enemy") this._checkTriggers("enemyLow", def.charId);
      }
      // 表现层三连：受击飘字、音效、战报——引擎只发通知，怎么画是 UI 的事。
      window.SJI_UI.fxHit(def, dmg, opts);
      window.SJI_AUDIO[(opts.type === "horse") ? "kick" : (dmg >= 3 ? "crit" : "hit")]();
      const verb = opts.type === "horse" ? "以马踢之" : (opts.type === "skill" ? "以技击之" : (opts.type === "poison" ? "受毒" : "以刀击之"));
      const src = att ? "「" + att.ch.hao + "」" + verb + "「" + def.ch.hao + "」，损" + dmg + "血。" : "「" + def.ch.hao + "」损" + dmg + "血。";
      this.pushLog(src);
      // 个人单回合输出满 5：点亮「连环快攻」成就标记（置 -999 防重复点亮）。
      if (att && att.side === "player" && att.roundDealt >= 5) { att.roundDealt = -999; this.stats.rushHit = true; }
      // 死亡结算：先让「免死」被动抢救，救不回才正式倒下；玩家击杀敌人则按难度
      // 回血（击破回血），并触发 enemyDown 剧情对话。
      if (def.hp <= 0) {
        if (!opts.pierce && this._tryLethalSave(def)) return dmg;
        def.hp = 0; def.alive = false;
        this.pushLog("「" + def.ch.hao + "」倒下了！");
        window.SJI_AUDIO.die();
        if (def.side === "enemy") {
          this.stats.kills++;
          if (att && att.side === "player") {
            const dh = CFG.DIFFICULTY[this.diff] || CFG.DIFFICULTY.normal;
            const heal = dh.killHeal + (att.boons.killHeal || 0);
            if (heal > 0) this.heal(this.player, heal, "大胜而归，");
          }
          if (def.side === "enemy") this._checkTriggers("enemyDown", def.charId);
        }
        if (window.SJI_UI && window.SJI_UI.fxDeath) window.SJI_UI.fxDeath(def);
      }
      return dmg;
    }

    /* 记录玩家全程最低血量（成就「破败城墙」用） */
    _trackMinHp(u) {
      if (u !== this.player) return;
      const cur = Math.max(0, u.hp);
      this.stats.minHp = (this.stats.minHp === undefined) ? cur : Math.min(this.stats.minHp, cur);
    }

    // 免死判定：孤因/向东留 1 血、崇国回 3 血；每人每场限一次（usedSave 记号）。
    _tryLethalSave(def) {
      if (this.hasPassive(def, "guyin") && !def.usedSave) { def.usedSave = true; def.hp = 1; this.pushLog("皇太子庇佑！「因」保留一血。"); window.SJI_UI.fxFloat(def, "皇太子！", "#ffd700"); return true; }
      if (this.hasPassive(def, "xiangdong") && !def.usedSave) { def.usedSave = true; def.hp = 1; this.pushLog("「东」乘乱潜逃，保留一血！"); window.SJI_UI.fxFloat(def, "潜逃！", "#9db8ff"); return true; }
      if (this.hasPassive(def, "chongguo") && !def.usedSave) { def.usedSave = true; def.hp = 3; this.pushLog("「国」弃车保帅，回复三血！"); window.SJI_UI.fxFloat(def, "弃车保帅！", "#9dff9d"); return true; }
      return false;
    }

    /* 绕开一切加减成的「真实伤害」：毒发、撞墙、看台飞瓶等都走这里。
       与 dealDamage 的区别：不判闪避/护盾/攻方被动，但免死与死亡结算照走。 */
    rawHurt(def, n, why) {
      if (!def.alive) return;
      def.hp -= n;
      this._trackMinHp(def);
      window.SJI_UI.fxHit(def, n, { poison: why === "毒" });
      this.pushLog("「" + def.ch.hao + "」" + why + "，损" + n + "血。");
      if (def.hp <= 0) {
        if (this._tryLethalSave(def)) return;
        def.hp = 0; def.alive = false;
        this.pushLog("「" + def.ch.hao + "」倒下了！");
        window.SJI_AUDIO.die();
        if (def.side === "enemy") { this.stats.kills++; this._checkTriggers("enemyDown", def.charId); }
        if (window.SJI_UI && window.SJI_UI.fxDeath) window.SJI_UI.fxDeath(def);
      }
    }

    // 回血：溢出自动截断（real=实际回复量）；玩家的治疗还累计进存档统计。
    heal(u, n, why) {
      if (!u.alive) return;
      const real = Math.min(n, u.maxhp - u.hp);
      if (real <= 0) return;
      u.hp += real;
      if (u.side === "player") {
        this.stats.heals += real;
        if (window.SJI_SAVE && window.SJI_SAVE.bump) window.SJI_SAVE.bump("heals", real);
      }
      window.SJI_UI.fxFloat(u, "+" + real, "#7fe08a");
      window.SJI_AUDIO.heal();
      this.pushLog("「" + u.ch.hao + "」" + (why || "回复") + real + "血。");
    }

    // 晕眩：往 st.skip 叠回合数（取最大、不叠层）；有「定力」类被动的角色免疫。
    stun(u, rounds, why) {
      if (this._passiveImmuneStun(u)) { this.pushLog("「" + u.ch.hao + "」朗声诵书，不为所动！"); return; }
      u.st.skip = Math.max(u.st.skip, rounds);
      this.pushLog("「" + u.ch.hao + "」" + (why || "被惑") + "，下回合跳过。");
    }

    // 击退：沿「施力点→受力点」方向一格一格推，落点不合法就停；头哥岿然不动。
    async pushUnit(u, fromR, fromC, steps) {
      if (this.hasPassive(u, "touge")) { this.pushLog("「头」与球棍意念合一，岿然不动。"); return; }
      const dr = Math.sign(u.r - fromR), dc = Math.sign(u.c - fromC);
      let moved = 0;
      for (let i = 0; i < steps; i++) {
        const nr = u.r + (dr || 0), nc = u.c + (dc || 0);
        if (!this.passable(nr, nc)) break;
        u.r = nr; u.c = nc; moved++;
        window.SJI_UI.snap(u);
        await sleep(90);
      }
      if (moved > 0) this.pushLog("「" + u.ch.hao + "」被击退" + moved + "格。");
    }

    /* ---------- 行动原语 ---------- */
    /* 记录可撤销的移动快照（仅玩家、仅本回合、且此后未造成伤害） */
    _pushUndo(u) {
      // _undo：悔棋快照栈，每步存 {行, 列, 剩余行动点}。
      if (!u._undo) u._undo = [];
      if (u._undo.length > 12) u._undo.shift();
      u._undo.push({ r: u.r, c: u.c, apNow: u.apNow });
    }

    // 悔棋：弹出最近一条快照，位置与行动点一并还原（玩家专属福利）。
    undoMove() {
      const p = this.player;
      if (!p._undo || !p._undo.length) return false;
      const st = p._undo.pop();
      p.r = st.r; p.c = st.c; p.apNow = st.apNow;
      this.stats.moves = Math.max(0, this.stats.moves - 1);
      if (window.SJI_SAVE && window.SJI_SAVE.bump) window.SJI_SAVE.bump("moves", -1);
      if (window.SJI_UI && window.SJI_UI.snap) window.SJI_UI.snap(p);
      this.pushLog("「" + p.ch.hao + "」退回原位（行动点已退还）。");
      return true;
    }

    /* 任何"会造成影响"的行动都会封住撤销（避免用撤销试探信息） */
    lockUndo() {
      for (const u of this.units) if (u._undo) u._undo.length = 0;
    }

    // 走一格花 1 行动点；玩家走前先存快照（可悔棋），并统计步数、是否离开过城墙。
    async doMove(u, r, c) {
      if (u.apNow <= 0) return false;
      if (!this.passable(r, c)) return false;
      if (u.side === "player") this._pushUndo(u);
      u.apNow--; u.r = r; u.c = c;
      if (u.side === "player") {
        this.stats.moves++;
        window.SJI_SAVE.bump("moves");
        if (!isWall(r, c)) this.stats.everLeftWall = true;
      }
      window.SJI_AUDIO.click();
      this.pushLog("「" + u.ch.hao + "」" + (isWall(r, c) ? "行于城墙" : "行于空地") + "。");
      return true;
    }

    // 买刀：花 1 行动点；课代表（离樊）的被动「夺权」可免费白拿。
    async doBuyKnife(u) {
      const free = this.hasPassive(u, "lifan");
      if (u.hasKnife || (!free && u.apNow <= 0)) return false;
      if (!free) u.apNow--;
      u.hasKnife = true;
      window.SJI_AUDIO.select();
      this.pushLog("「" + u.ch.hao + "」市刀。" + (free ? "（课代表夺权，分文不取）" : ""));
      return true;
    }

    // 买马：花 1 行动点；买到即 lockUndo——有影响的行动之后不许悔棋。
    async doBuyHorse(u) {
      if (u.hasHorse || u.apNow <= 0) return false;
      u.apNow--;
      this.lockUndo();
      u.hasHorse = true;
      if (u.side === "player") this.stats.boughtHorse = true;
      window.SJI_AUDIO.select();
      this.pushLog("「" + u.ch.hao + "」市马。");
      return true;
    }

    /* 刀击：基础 1 点、须相邻、花 1 行动点；被缴械（seal/disarm）时封印。
       cleave（刀势）可让余波再扫中主目标旁至多 extra 名敌人。 */
    async doKnife(u, t) {
      if (!u.hasKnife || u.apNow <= 0 || !t || !t.alive) return false;
      if (u.st.seal > 0 || u.st.disarm > 0) {
        if (u.side === "player") this.pushLog("「" + u.ch.hao + "」之刀被缴，此回合不能击。");
        return false;
      }
      if (!adj(u, t)) return false;
      u.apNow--;
      this.lockUndo();
      const dyad = !!this.rule && this.rule.id === "dyad";
      const extra = u.boons.cleave || 0;
      // 刀势横扫：波及"主目标"的相邻者（不含主目标自身与攻击者）
      const splash = extra ? this.opponentsOf(u).filter(f => f !== t && adj(t, f)).slice(0, extra) : [];
      await this.dealDamage(u, t, 1, { type: "knife", dyad });
      for (const f of splash) {
        if (!f.alive) continue;
        this.pushLog("刀势未歇，波及「" + f.ch.hao + "」！");
        await this.dealDamage(u, f, 1, { type: "knife" });
      }
      return true;
    }

    /* 马踢：城墙专属重击——基础 3 点、双方都得在墙上、曼哈顿距离 ≤3。
       踢完若目标没死，就近找空地把人踢下城；四周无处落脚就退而求其次撞 1 点。 */
    async doHorse(u, t) {
      if (this.rule && this.rule.id === "suomen") { this.pushLog("禁闭室无墙可踢——马踢不可用。"); return false; }
      if (!u.hasHorse || u.apNow <= 0 || !t || !t.alive) return false;
      if (!isWall(u.r, u.c) || !isWall(t.r, t.c) || manh(u, t) > 3 + (u.boons.horseRange || 0)) return false;
      u.apNow--;
      this.lockUndo();
      const dealt = await this.dealDamage(u, t, 3, { type: "horse" });
      if (t.alive) {
        // 踢下城：寻相邻空地
        let best = null;
        for (const [dr, dc] of DIRS) {
          const nr = t.r + dr, nc = t.c + dc;
          if (this.passable(nr, nc) && !isWall(nr, nc)) { best = [nr, nc]; break; }
        }
        if (best) {
          t.r = best[0]; t.c = best[1];
          window.SJI_UI.snap(t);
          this.pushLog("「" + t.ch.hao + "」被踢下城墙！");
          if (t.side === "player") this.stats.everLeftWall = true;
        } else {
          this.rawHurt(t, 1, "撞墙");
        }
      }
      return dealt >= 0;
    }

    /* 空地驱赶：空地上与相邻敌人纵马驱之，推开至多两格；无处可退者受 1 点踩踏伤。
       与马踢互补——城墙用踢，空地用驱，马在全场都有用武之地。 */
    async doDrive(u, t) {
      if (this.rule && this.rule.id === "suomen") { this.pushLog("禁闭无马——驱赶亦不可用。"); return false; }
      if (!u.hasHorse || u.apNow <= 0 || !t || !t.alive) return false;
      if (isWall(u.r, u.c) || isWall(t.r, t.c)) return false;   // 仅限空地（城墙用马踢）
      if (!adj(u, t)) return false;
      u.apNow--;
      this.lockUndo();
      window.SJI_AUDIO.kick();
      const r0 = t.r, c0 = t.c;
      await this.pushUnit(t, u.r, u.c, 2);
      if (t.r === r0 && t.c === c0) {
        this.pushLog("无处可退，反受一踏！");
        await this.dealDamage(u, t, 1, { type: "horse" });
      } else if (t.alive) {
        this.pushLog("「" + t.ch.hao + "」被驱开，阵脚已乱。");
      }
      return true;
    }

    /* 血祭：花 1 行动点，砍掉当前一半血（血量不足 SAC_MIN_HP 不许祭，「以道代血」除外），
       换 st.bloodlust + 1——下次伤害翻倍；wonder / 双祭增益可一次叠两层。 */
    async doSacrifice(u) {
      if (u.apNow <= 0 || (!u.boons.bloodFree && u.hp < CFG.RULES.SAC_MIN_HP)) return false;
      u.apNow--;
      this.lockUndo();
      const loss = u.boons.bloodFree ? 0 : Math.floor(u.hp / 2);
      u.hp -= loss;
      this._trackMinHp(u);
      u.st.bloodlust += (this.hasPassive(u, "wonder") || u.boons.blood2) ? 2 : 1;
      if (u.side === "player") this.stats.usedBlood = true;
      window.SJI_UI.fxFloat(u, "-" + loss + " 血祭", "#ff5a5a");
      window.SJI_UI.fxStatus(u, "血祭！");
      if (window.SJI_UI && window.SJI_UI.fxVignette) window.SJI_UI.fxVignette("166,58,43");
      window.SJI_AUDIO.sacrifice();
      this.pushLog("「" + u.ch.hao + "」血祭！" + (loss ? "损" + loss + "血，" : "以道代血，毫发无伤，")
        + "下次伤害翻倍" + (u.st.bloodlust > 1 ? "（两度）" : "") + "。");
      if (u.hp <= 0) { u.hp = 0; u.alive = false; this.pushLog("「" + u.ch.hao + "」血祭过甚，倒下了！"); }
      return true;
    }

    /* ---------- 技能 ---------- */
    // 取技能数据：新角色带技能数组 skills（idx 区分第 1/2 个），老角色只有单个 skill。
    skillOf(u, idx) {
      const ch = u.ch;
      if (ch.skills) return ch.skills[idx || 0];
      return ch.skill;
    }
    // 技能是否就绪：cds 里剩余冷却 ≤0；_startCd 在放完后立刻挂 CD（可被增益缩短）。
    skillReady(u, idx) {
      const sk = this.skillOf(u, idx);
      if (!sk) return false;
      return (u.cds[idx || 0] || 0) <= 0;
    }
    skillCd(u, idx) { return u.cds[idx || 0] || 0; }
    _startCd(u, idx) {
      const sk = this.skillOf(u, idx);
      u.cds[idx || 0] = Math.max(1, (sk.cd || 1) - (u.boons.cdReduce || 0));
    }

    /* 施放技能的总入口：先验「有这技吗 / 转好 CD 没 / 行动点够吗 / 被沉默没」，
       扣点、挂 CD、播报之后按 sk.kind 分五路：
       unit=单体、self=强化自己、adj=贴身群伤、raoe=远程范围、summon=召唤。
       每个角色的具体效果写死在 switch(u.charId)——数值在 data.js，行为在这里。 */
    async doSkill(u, idx, target) {
      const sk = this.skillOf(u, idx);
      if (!sk || !this.skillReady(u, idx) || u.apNow < (sk.ap || 1)) return false;
      if (u.st.silence > 0) { this.pushLog("「" + u.ch.hao + "」被沉默，技不能出。"); return false; }
      const k = sk.kind;
      const dyad = !!this.rule && this.rule.id === "dyad";
      // V：从技能数据取字段、取不到用默认值——手写版的 sk[k] ?? d。
      const V = (k, d) => (sk[k] !== undefined ? sk[k] : d);
      u.apNow -= (sk.ap || 1);
      this.lockUndo();
      this._startCd(u, idx);
      if (u.side === "player") this.stats.usedSkill = true;
      window.SJI_AUDIO.skill();
      this.pushLog("「" + u.ch.hao + "」施「" + sk.name + "」！");

      const foes = this.opponentsOf(u);
      /* 音克思（开放世界主角）：技能全由「刀谱」所学卡牌数据驱动 */
      if (u.charId === "yinkesi") return this._execLearned(u, sk, target, foes, dyad);
      // 单体技：目标必须活着；下面 switch 一个角色一种口味，数值对照 data.js 的技能表。
      if (k === "unit") {
        if (!target || !target.alive) return false;
        switch (u.charId) {
          case "dage":
            await this.dealDamage(u, target, 1, { type: "skill", dyad }); this.stun(target, 1, "得护手霜而惑");
            break;
          case "shenren": this.stun(target, 1, "得原神明信片，欣然把玩"); break;
          case "xiannv":
            await this.dealDamage(u, target, 2, { type: "skill", dyad });
            if (target.alive) await this.pushUnit(target, u.r, u.c, 1);
            break;
          case "wonder": {
            const bonus = (target.hp % 2 === 0) ? 1 : 0;
            if (bonus) this.pushLog("其血为偶，数学之感，伤害+1！");
            await this.dealDamage(u, target, 2 + bonus, { type: "skill", dyad });
            break;
          }
          case "wenbin": await this.dealDamage(u, target, 2, { type: "skill", dyad }); break;
          case "luhao":
            await this.dealDamage(u, target, 2, { type: "skill", dyad });
            if (target.alive) { target.st.apMod -= 1; this.pushLog("锦绣昼行！「" + target.ch.hao + "」下回合行动-1。"); }
            break;
          case "xiaochuan":
            await this.dealDamage(u, target, 1, { type: "skill", dyad });
            if (target.alive) { target.st.seal = Math.max(target.st.seal, 1); this.pushLog("王霸之气！「" + target.ch.hao + "」下回合不能攻击。"); }
            break;
          case "guyin": {
            await this.dealDamage(u, target, 2, { type: "skill", dyad });
            if (u.alive && Math.random() < 0.15) { this.pushLog("误伤己手！"); this.rawHurt(u, 1, "坤拳误伤"); }
            break;
          }
          case "shaoming": await this.dealDamage(u, target, 3, { type: "skill", dyad }); break;
          case "xinhui":
            await this.dealDamage(u, target, 2, { type: "skill", dyad });
            if (target.alive) await this.pushUnit(target, u.r, u.c, 2);
            break;
          case "yiran":
            await this.dealDamage(u, target, 2, { type: "skill", dyad });
            this.heal(u, 1, "拍肚皮自得，");
            break;
          case "dazhan": await this.dealDamage(u, target, 3, { type: "skill", dyad }); break;
          case "limo":
            await this.dealDamage(u, target, 1, { type: "skill", dyad });
            this.heal(u, 1, "争食而肥，");
            break;
          case "xiangdong": await this.dealDamage(u, target, 2, { type: "skill", dyad }); break;
          case "wanzhen": await this.dealDamage(u, target, 2, { type: "skill", dyad }); break;
          case "weirong":
            target.st.apMod -= 2;
            this.pushLog("「" + target.ch.hao + "」奇彪无比！下回合行动-2。");
            break;
          case "qinfa":
            target.st.seal = Math.max(target.st.seal, 1);
            this.pushLog("当场抓获！「" + target.ch.hao + "」下回合不能攻击。");
            break;
          case "weibing": {
            // 破门而入：瞬移至目标相邻
            const spot = DIRS.map(([dr, dc]) => [target.r + dr, target.c + dc])
              .find(([r, c]) => this.passable(r, c));
            if (spot) { u.r = spot[0]; u.c = spot[1]; window.SJI_UI.snap(u); }
            target.st.disarm = Math.max(target.st.disarm, V("disarm", 1));
            this.pushLog("破门而入！「" + target.ch.hao + "」之刀被没收一回合。");
            await this.dealDamage(u, target, V("dmg", 1), { type: "skill", pierce: true });
            break;
          }
          case "hanxiao":
            if (this._passiveImmuneStun(target)) { this.pushLog("不为所动！"); break; }
            if (target.offField > 0) { this.pushLog("「" + target.ch.hao + "」已在家中。"); break; }
            // 记下被遣返时的位置，offField 倒数归零后从这里归队（见 _returnHome）。
            target.homeR = target.r; target.homeC = target.c;
            target.offField = V("offField", 1);
            this.pushLog("「" + target.ch.hao + "」被遣返回家，跳过下个回合后归位！");
            window.SJI_UI.fxFloat(target, "遣返回家！", "#ffb14e");
            break;
          case "keai": this.heal(target, V("heal", 2), "得一糖，"); break;
          case "shengxiang": await this.dealDamage(u, target, V("dmg", 2), { type: "skill", dyad }); break;
          case "qiyue": await this.dealDamage(u, target, V("dmg", 2), { type: "skill", dyad }); break;
          case "lianqi": await this.dealDamage(u, target, V("dmg", 2), { type: "skill", dyad }); break;
          case "ziye":
            await this.dealDamage(u, target, V("dmg", 1), { type: "skill", dyad });
            if (target.alive) { target.st.apMod -= V("apCut", 1); this.pushLog("谗言入耳！「" + target.ch.hao + "」下回合行动-1。"); }
            break;
          case "tree": await this.dealDamage(u, target, V("dmg", 1), { type: "skill", dyad }); break;
          default: await this.dealDamage(u, target, 1, { type: "skill", dyad });
        }
        return true;
      }
      // 自我强化技：现役只有玉润（回血）与呱屿（+2 行动点、下次伤害 +1）。
      if (k === "self") {
        if (u.charId === "yurun") this.heal(u, 3, "得面包，");
        if (u.charId === "guayu") {
          u.st.empower += 1;
          u.apNow += 2;   // 立即多出2行动点（可即刻再行两步）
          this.pushLog("提壶狂奔！「呱」行动点+2，下次伤害+1。");
          window.SJI_UI.fxFloat(u, "+2 动", "#ffd98a");
        }
        return true;
      }
      // 贴身群伤：打所有相邻敌人（.slice() 先复制再遍历，防止边遍历边改动出乱子）。
      if (k === "adj") {
        const adjDmg = V("dmg", 2), poisonR = V("poison", 2);
        for (const f of foes.filter(f => cheb(u, f) <= 1).slice()) {
          await this.dealDamage(u, f, adjDmg, { type: "skill", dyad });
          if (f.alive && u.charId === "touge") { f.st.poison = Math.max(f.st.poison, poisonR); this.pushLog("「" + f.ch.hao + "」中溴毒！"); }
        }
        return true;
      }
      // 远程范围技：chebyshev 距离 ≤ range 的敌人各吃一口，效果因角色而异。
      if (k === "raoe") {
        const rng = sk.range || 2;
        for (const f of foes.filter(f => cheb(u, f) <= rng).slice()) {
          if (u.charId === "lifan") {
            if (Math.random() < 0.5) this.stun(f, 1, "闻Say You而笑场");
          } else if (u.charId === "zichen") {
            await this.dealDamage(u, f, 1, { type: "skill", dyad });
            if (f.alive) { f.st.apMod -= 1; }
          } else if (u.charId === "shibo") {
            await this.dealDamage(u, f, 2, { type: "skill", dyad });
          } else if (u.charId === "chongguo") {
            if (!this._passiveImmuneStun(f)) {
              f.st.silence = Math.max(f.st.silence, 1);
              this.pushLog("「" + f.ch.hao + "」被评职称所困，本回合不能施技！");
            } else {
              this.pushLog("「" + f.ch.hao + "」不为所动！");
            }
          }
        }
        if (u.charId === "zichen") this.pushLog("夺话筒：马上解散，毋恐担责，凡有责任，在吾一人！");
        return true;
      }
      // 召唤技：现役只有崇国种树；树有场上上限（config 的 TREE_CAP），防战斗被无限拖长。
      if (k === "summon") {
        // 树木皆死：场上至多三株，否则战斗会被无限拖长
        const live = this.units.filter(x => x.alive && x.charId === "tree" && x.side === u.side).length;
        if (live >= CFG.RULES.TREE_CAP) {
          this.pushLog("崇国欲再种树，然树木皆死，地上已无隙可种。");
          return true;
        }
        const spot = DIRS.map(([dr, dc]) => [u.r + dr, u.c + dc]).find(([r, c]) => this.passable(r, c));
        if (spot) {
          const tr = makeUnit("tree", u.side, this.units.length);
          this._place(tr, spot);
          this.units.push(tr);
          this.pushLog("崇国种树一株！它看起来……快要死了。");
          window.SJI_UI.snap(tr);
        }
        return true;
      }
      return false;
    }

    /* 音克思的刀谱技：效果全部由卡牌数据（sk.dmg/push/stun/seal/apCut/heal/poison/silence…）驱动 */
    async _execLearned(u, sk, target, foes, dyad) {
      const k = sk.kind;
      if (k === "self") {
        if (sk.heal) this.heal(u, sk.heal, "掩卷调息，");
        if (sk.apGain) { u.apNow += sk.apGain; window.SJI_UI.fxFloat(u, "+" + sk.apGain + " 动", "#ffd98a"); }
        if (sk.empower) u.st.empower += sk.empower;
        return true;
      }
      // 内部小函数 hit：对单个敌人打 base 点，再按卡牌数据追加晕/缴/减行动/推/毒。
      // 音克思的技能差异全在卡牌数据里，逻辑只有这一份——「数据驱动」的典型写法。
      const hit = async (f, base) => {
        await this.dealDamage(u, f, base, { type: "skill", dyad });
        if (!f.alive) return;
        if (sk.stun) this.stun(f, sk.stun, "被「" + sk.name + "」所惑");
        if (sk.seal) { f.st.seal = Math.max(f.st.seal, sk.seal); this.pushLog("「" + f.ch.hao + "」之刀被缴，一回合不能击。"); }
        if (sk.apCut) { f.st.apMod -= sk.apCut; this.pushLog("「" + f.ch.hao + "」下回合行动-" + sk.apCut + "。"); }
        if (sk.push) await this.pushUnit(f, u.r, u.c, sk.push);
        if (sk.poison) { f.st.poison = Math.max(f.st.poison, sk.poison); this.pushLog("「" + f.ch.hao + "」中毒！"); }
      };
      if (k === "unit") {
        if (!target || !target.alive) return false;
        await hit(target, sk.dmg || 1);
        if (sk.healSelf && u.alive) this.heal(u, sk.healSelf, "录技反哺，");
        return true;
      }
      if (k === "adj") {
        for (const f of foes.filter(f => cheb(u, f) <= 1).slice()) await hit(f, sk.dmg || 1);
        return true;
      }
      if (k === "raoe") {
        const rng = sk.range || 2;
        for (const f of foes.filter(f => cheb(u, f) <= rng).slice()) {
          if (sk.silence) {
            if (this._passiveImmuneStun(f)) { this.pushLog("「" + f.ch.hao + "」不为所动！"); continue; }
            f.st.silence = Math.max(f.st.silence, sk.silence);
            this.pushLog("「" + f.ch.hao + "」被「" + sk.name + "」所困，本回合不能施技！");
          } else await hit(f, sk.dmg || 1);
        }
        return true;
      }
      return false;
    }

    /* ---------- AI ---------- */
    /* 引擎侧 AI 分两层：普通难度走 aiAct 的「优先级阶梯 + 概率」，噩梦走
       aiActNightmare 的「枚举落点 × 行动打分取最优」。测试里模拟玩家的机器人在
       tests/battle/helpers/bot.mjs：greedyBot 一味莽，对高倍率近战近乎 0 分，
       不能当人类基线；kiteBot 会打完就拉扯、优先残血，平衡测试都以它为准。 */
    _reachable(u, budget) {
      /* BFS（广度优先搜索）：像水波从脚下逐圈外扩，求 budget 步内可达的全部格子。
         seen=已访问集合（坐标拼成 "r,c" 字符串当键，顺便去重）；dist=各格最短步数。 */
      const seen = new Set([u.r + "," + u.c]);
      let frontier = [[u.r, u.c]];
      // 对象键外面包方括号是「计算属性名」：键由表达式算出，这里即起点坐标。
      const dist = { [u.r + "," + u.c]: 0 };
      for (let d = 0; d < budget; d++) {
        const next = [];
        for (const [r, c] of frontier) {
          for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            const key = nr + "," + nc;
            if (!this.passable(nr, nc) || seen.has(key)) continue;
            seen.add(key); dist[key] = d + 1; next.push([nr, nc]);
          }
        }
        frontier = next;
      }
      // [...seen]：把 Set 摊开成数组（Set 不能下标访问，转数组才顺手）。
      return { keys: [...seen], dist };
    }

    // 本回合可走格数：基础 1，大展/狸猫被动 2，再叠加增益加成。
    moveRange(u) {
      let mv = 1;
      if (this.hasPassive(u, "dazhan") || this.hasPassive(u, "limo")) mv = 2;
      mv += u.boons.move || 0;
      return mv;
    }

    // 朝目标挪一步：在可达空格里挑「离目标曼哈顿距离最小」的落点，同分取步数更省的。
    _stepToward(u, target) {
      const budget = this.moveRange(u);
      const reach = this._reachable(u, budget);
      let best = null, bestD = manh(u, target);
      for (const key of reach.keys) {
        const [r, c] = key.split(",").map(Number);
        if (this.unitAt(r, c)) continue;
        const d = Math.abs(r - target.r) + Math.abs(c - target.c);
        if (d < bestD || (d === bestD && best && reach.dist[key] < reach.dist[best])) { best = key; bestD = d; }
      }
      if (!best) return null;
      return best.split(",").map(Number);
    }

    /* AI 选技能：可怡是奶妈（目标是己方最残血者）；其余角色按 [技 0, 技 1] 的顺序，
       找第一个「转好 CD、点数够、射程内有敌人」的技能。返回 {idx, target} 或 null。 */
    aiPickSkill(u) {
      const ch = u.ch;
      // 治疗/辅助类技能（如可怡「一糖之恩」）目标应是己方，而非对手
      if (u.charId === "keai") {
        const allies = this.units.filter(x => x.alive && x.offField <= 0 && x.side === u.side);
        const hurt = allies.filter(a => a.hp < a.maxhp).sort((a, b) => a.hp - b.hp)[0];
        if (hurt && this.skillReady(u, 0) && u.apNow >= (this.skillOf(u, 0).ap || 1)) return { idx: 0, target: hurt };
        return null;
      }
      const idxs = ch.skills ? [0, 1] : [0];
      const foes = this.opponentsOf(u);
      for (const i of idxs) {
        const sk = this.skillOf(u, i);
        if (!sk || !this.skillReady(u, i) || u.apNow < (sk.ap || 1) || u.st.silence > 0) continue;
        if (sk.kind === "self") { if (u.hp <= u.maxhp - 2) return { idx: i, target: null }; continue; }
        if (sk.kind === "summon") return { idx: i, target: null };
        const rng = sk.kind === "adj" ? 1 : (sk.range || 2);
      // adj 按 1 格、raoe 按技能射程先数一遍「够得着的敌人」，随后各类技能分别判定。
        const inRange = foes.filter(f => cheb(u, f) <= (sk.kind === "raoe" ? rng : (sk.kind === "adj" ? 1 : rng)));
        if (sk.kind === "adj") { if (foes.some(f => adj(u, f))) return { idx: i, target: null }; continue; }
        if (sk.kind === "raoe") { if (inRange.length >= (u.charId === "lifan" ? 1 : 1)) return { idx: i, target: null }; continue; }
        if (inRange.length) {
          inRange.sort((a, b) => a.hp - b.hp);
          return { idx: i, target: inRange[0] };
        }
      }
      return null;
    }

    /* ---- 噩梦难度：最优行动 AI ----
       每花 1 行动点前，枚举「可站立格 × 可执行行动」并打分：
       分 = 期望输出（击杀重奖）+ 位置价值（城墙/远离威胁）− 落位威胁（玩家侧下一手最大反击）
       取最高分执行。不做深搜索——马刀的深度在位置经济，一层贪心 + 威胁模型已是碾压级。 */
    /* 威胁估价：假设「我」站在 (r,c)，把每个敌人下一手能打出的最大伤害加总。
       这是 nightmare AI 给落点打分用的「这里有多危险」尺子。 */
    aiThreatAt(u, r, c) {
      let threat = 0;
      for (const f of this.opponentsOf(u)) {
        if (!f.alive || f.offField > 0) continue;
        const cheb = Math.max(Math.abs(f.r - r), Math.abs(f.c - c));
        const manh = Math.abs(f.r - r) + Math.abs(f.c - c);
        let dmg = 0;
        if (f.hasKnife && cheb <= 1 + (this.hasPassive(f, "dazhan") ? 1 : 0)) {
          let d = 1;
          if (this.hasPassive(f, "luhao")) d *= 2;
          if (this.hasPassive(f, "dage") && isWall(r, c)) d += 1;
          if (this.hasPassive(f, "weirong")) d += 1;
          if (f.st.bloodlust > 0) d *= 2;
          dmg = Math.max(dmg, d);
        }
        if (f.hasHorse && isWall(r, c) && isWall(f.r, f.c) && manh <= 3 + (f.boons.horseRange || 0)) dmg = Math.max(dmg, 3);
        const sk = this.skillOf(f, 0);
        if (sk && sk.dmg && cheb <= (sk.range || 1) && (f.cds[0] || 0) <= 0 && !f.st.silence) dmg = Math.max(dmg, sk.dmg);
        threat += dmg;
      }
      return threat;
    }

    // 估算一次刀击的伤害（把主要加成粗抄一遍，给 nightmare AI 打分用）。
    aiEstKnife(att, def) {
      let d = 1;
      if (this.hasPassive(att, "luhao")) d *= 2;
      if (this.hasPassive(att, "dage") && isWall(att.r, att.c)) d += 1;
      if (this.hasPassive(att, "weirong")) d += 1;
      if (att.boons.knife) d += att.boons.knife;
      if (att.st.bloodlust > 0) d *= 2 * att.st.bloodlust;
      if (att.charId === "wenbin" || this.hasPassive(att, "wenbin")) d = Math.round(d * 1.3);
      return Math.max(1, d);
    }

    /* 噩梦 AI 主循环：每花 1 行动点，都重新「枚举落点 × 枚举行动」打分取最优；
       aiThreatAt / aiEstKnife 就是打分用的两把估尺。一层贪心 + 威胁模型，不做深搜。 */
    async aiActNightmare(u) {
      let guard = 0;
      // guard：保险丝计数，防「行动点没扣干净」之类的意外把循环变成死循环。
      while (u.apNow > 0 && u.alive && !this.over && guard++ < 10) {
        const foes = this.opponentsOf(u);
        if (!foes.length) break;
        // 枚举可站立格（含原地）
        const cells = [{ r: u.r, c: u.c }];
        const reach = this._reachable(u, this.moveRange(u));
        for (const key of reach.keys) {
          const [r, c] = key.split(",").map(Number);
          if (!this.unitAt(r, c) && !(r === u.r && c === u.c)) cells.push({ r, c });
        }
        let best = null;
        for (const cell of cells) {
          // stand：落点分 = 负威胁（越安全越好）+ 站城墙的小甜头。
          const stand = -this.aiThreatAt(u, cell.r, cell.c) + (isWall(cell.r, cell.c) ? 0.5 : 0);
          // 该格可执行的行动
          const acts = [];
          if (!u.hasKnife) acts.push({ kind: "buyknife", score: 6 });
          for (const f of foes) {
            const adj2 = Math.max(Math.abs(cell.r - f.r), Math.abs(cell.c - f.c)) <= 1;
            if (u.hasKnife && adj2 && !isWall(cell.r, cell.c) && !isWall(f.r, f.c) || (u.hasKnife && adj2)) {
              const d = this.aiEstKnife(u, f);
              acts.push({ kind: "knife", t: f, score: d * 3 + (f.hp <= d ? 14 : (f.hp - d <= 3 ? 4 : 0)) });
            }
            if (u.hasHorse && isWall(cell.r, cell.c) && isWall(f.r, f.c) && Math.abs(cell.r - f.r) + Math.abs(cell.c - f.c) <= 3) {
              acts.push({ kind: "horse", t: f, score: 3 * 3 + (f.hp <= 3 ? 14 : 0) });
            }
            if (u.hasHorse && !isWall(cell.r, cell.c) && !isWall(f.r, f.c) && adj2) {
              acts.push({ kind: "drive", t: f, score: 3 });
            }
          }
          // 技能
          const ch = u.ch;
          const idxs = ch.skills ? [0, 1] : [0];
          for (const i of idxs) {
            const sk = this.skillOf(u, i);
            if (!sk || !this.skillReady(u, i) || u.apNow < (sk.ap || 1) || u.st.silence > 0) continue;
            const rng = sk.kind === "adj" ? 1 : (sk.kind === "raoe" ? (sk.range || 2) : (sk.range || 1));
            if (sk.kind === "self") {
              if (sk.heal && u.hp <= u.maxhp - 2) acts.push({ kind: "skill", idx: i, t: null, score: sk.heal * 2 });
              continue;
            }
            let bestT = null, bestV = -1;
            for (const f of foes) {
              const cheb = Math.max(Math.abs(cell.r - f.r), Math.abs(cell.c - f.c));
              if (cheb > rng) continue;
              const v = (sk.dmg || 1) * 2.5 + (f.hp <= (sk.dmg || 1) ? 12 : 0);
              if (v > bestV) { bestV = v; bestT = f; }
            }
            if (bestT) acts.push({ kind: "skill", idx: i, t: bestT, score: bestV });
          }
          // 血祭：贴身且血量健康时才划算
          if (u.hasKnife && u.hp >= 6 && foes.some(f => Math.max(Math.abs(cell.r - f.r), Math.abs(cell.c - f.c)) <= 2)) {
            acts.push({ kind: "sac", score: 4 });
          }
          const top = acts.sort((a, b) => b.score - a.score)[0];
          if (!top) continue;
          const total = stand + top.score;
          if (!best || total > best.score) best = { score: total, cell, act: top };
        }
        if (!best || best.score <= -60) break;   // 全图皆死地：干脆不动（等死也好过送死）
        // 执行
        if (best.cell.r !== u.r || best.cell.c !== u.c) await this.doMove(u, best.cell.r, best.cell.c);
        const a = best.act;
        if (a.kind === "buyknife") await this.doBuyKnife(u);
        else if (a.kind === "knife") await this.doKnife(u, a.t);
        else if (a.kind === "horse") await this.doHorse(u, a.t);
        else if (a.kind === "drive") await this.doDrive(u, a.t);
        else if (a.kind === "sac") await this.doSacrifice(u);
        else if (a.kind === "skill") await this.doSkill(u, a.idx, a.t);
        await sleep(200);
      }
      // 剩余行动点：向最近的敌人逼近（不浪费节奏）
      if (u.apNow > 0 && u.alive && !this.over) {
        const foes = this.opponentsOf(u);
        if (foes.length) {
          const t = foes.sort((a, b) => manh(u, a) - manh(u, b))[0];
          const step = this._stepToward(u, t);
          if (step && !(step[0] === u.r && step[1] === u.c)) await this.doMove(u, step[0], step[1]);
        }
      }
    }

    /* 通用 AI 回合（普通/极难难度与友军）：一条 if 组成的「优先级阶梯」——
       每花一次行动点就从头再评估：买刀 > 残血撤退 > 技能 > 血祭 > 刀击 >
       驱赶/马踢 > 买马 > 逡巡/逼近。各项做不做的概率由 prof（AI_AGGR 档位）给出。 */
    async aiAct(u) {
      // 回合开始状态结算
      // 被遣返者：本回合不出场，offField 减到 0 就归队（见 _returnHome）。
      if (u.offField > 0) {
        u.offField--; u.apNow = 0;
        if (u.offField <= 0) this._returnHome(u);
        else this.pushLog("「" + u.ch.hao + "」犹在返家途中……");
        return;
      }
      // 晕眩/被惑：吃掉一层 skip，整回合罢工。
      if (this._tickStatusStart(u)) {
        this.pushLog("「" + u.ch.hao + "」晕眩/被惑，跳过此回合。");
        window.SJI_UI.fxFloat(u, "跳过", "#cccc88");
        this._tickStatusEnd(u);
        return;
      }
      window.SJI_UI.onState();
      await sleep(240);
      // 噩梦难度在此分岔：整回合交给最优行动 AI；其余难度走下面的概率阶梯。
      if (this.diff === "nightmare") {
        await this.aiActNightmare(u);
        this._tickStatusEnd(u);
        return;
      }
      let guard = 0;
      // 选 AI 档位：友军固定「主动」；极难强制「狂攻」；其余按关卡配置查 AI_AGGR 表。
      const prof = (u.side === "ally")
        ? CFG.AI_ALLY
        : (this.diff === "extreme" ? CFG.AI_AGGR.frenzy
            : this.aiProfile());
      while (u.apNow > 0 && u.alive && !this.over && guard++ < 10) {
        const foes = this.opponentsOf(u);
        if (!foes.length) break;
        let target = this._pickTarget(u, foes, prof.focus);
        // 党争：二成机率打最近之任何人
        if (this.rule && this.rule.id === "chaos" && u.side === "enemy" && Math.random() < 0.2) {
          const all = this.units.filter(x => x.alive && x.offField <= 0 && x !== u && x.side !== "enemy");
          const allies = this.units.filter(x => x.alive && x.offField <= 0 && x !== u && x.side === "enemy");
          const pool = [...all, ...allies];
          if (pool.length) {
            target = pool.slice().sort((a, b) => manh(u, a) - manh(u, b))[0];
            this.pushLog("党争起！「" + u.ch.hao + "」认错了人……");
          }
        }
        // 买刀
        if (!u.hasKnife) { await this.doBuyKnife(u); await sleep(180); continue; }
        // 残血撤退（消极/守成）
        if (prof.retreat > 0 && u.hp <= u.maxhp * 0.34 && Math.random() < prof.retreat) {
          const back = this._stepAway(u, target);
          if (back && !(back[0] === u.r && back[1] === u.c)) {
            await this.doMove(u, back[0], back[1]);
            this.pushLog("「" + u.ch.hao + "」见势不妙，退避三舍。");
            await sleep(260);
            continue;
          }
        }
        // 技能（按进攻性决定使用意愿）
        // 技能使用意愿 = 档位基数 + 角色个人进攻性微调（aggr 以 0.6 为基准线）。
        const skillP = Math.max(0.05, Math.min(1, prof.skill + (u.aggr - 0.6) * 0.25));
        if (Math.random() < skillP) {
          const pick = this.aiPickSkill(u);
          if (pick) { await this.doSkill(u, pick.idx, pick.target); await sleep(320); continue; }
        }
        // 血祭抢攻（按进攻性）
        if (u.st.bloodlust <= 0 && adj(u, target) && u.hp >= 5 && Math.random() < prof.sac) {
          await this.doSacrifice(u); await sleep(300); continue;
        }
        // 刀击
        if (u.hasKnife && u.st.seal <= 0 && u.st.disarm <= 0 && adj(u, target)) {
          await this.doKnife(u, target); await sleep(300); continue;
        }
        // 空地驱赶（互补于马踢）
        if (u.hasHorse && !isWall(u.r, u.c) && !isWall(target.r, target.c) && adj(u, target) && Math.random() < prof.horse * 0.6) {
          await this.doDrive(u, target); await sleep(300); continue;
        }
        // 马踢（同城）
        if (u.hasHorse && isWall(u.r, u.c) && isWall(target.r, target.c) && manh(u, target) <= 3) {
          await this.doHorse(u, target); await sleep(300); continue;
        }
        // 买马：城墙之上、或目标在城墙上、或尚有余动（消极者不热衷）
        if (!u.hasHorse && u.apNow >= 2 && Math.random() < prof.horse && (isWall(u.r, u.c) || isWall(target.r, target.c))) {
          await this.doBuyHorse(u); await sleep(200); continue;
        }
        // 移动：消极者可能逡巡不前，其余逼近
        if (prof.keep > 0 && Math.random() < prof.keep && manh(u, target) > 2) {
          const idle = this._stepAway(u, target);
          if (idle && !(idle[0] === u.r && idle[1] === u.c)) {
            await this.doMove(u, idle[0], idle[1]);
            this.pushLog("「" + u.ch.hao + "」逡巡不前。");
            await sleep(260);
            continue;
          }
        }
        const step = this._stepToward(u, target);
        if (step && !(step[0] === u.r && step[1] === u.c)) { await this.doMove(u, step[0], step[1]); await sleep(260); continue; }
        // 无路可进时，若有余动则买马备战
        if (!u.hasHorse && u.apNow >= 1) { await this.doBuyHorse(u); await sleep(200); continue; }
        break;
      }
      this._tickStatusEnd(u);   // 该单位本回合结束：缴械/沉默到期
    }

    /* ---------- 断点续战：序列化 ---------- */
    /* 断点续战：把整场战局拍成纯数据快照（每回合末由 _endRound 写入存档）。
       只存「复原所需最小集」：配置存 stageId（场景参数回头查 config），单位只存
       战场可变字段——设计目标是引擎能从任意中间状态原样重启。 */
    serialize() {
      return {
        v: 1,
        cfg: {
          mode: this.mode, diff: this.diff, aiAggr: this.aiAggr,
          playerChar: this.cfg.playerChar,
          stageId: (this.cfg.stage && this.cfg.stage.id) || null,
          enemies: this.cfg.enemies || null,
          allies: this.cfg.allies || [],
          free: this.cfg.mode === "free",
          enemyIds: this.cfg.mode === "free" ? (this.cfg.enemies || []) : null
        },
        round: this.round, waveIndex: this.waveIndex, survivalWaveNo: this.survivalWaveNo || 1,
        boonsTaken: this.boonsTaken,
        result: this.result, over: false,
        stats: this.stats,
        units: this.units.map(u => ({
          charId: u.charId, side: u.side, uid: u.uid, hp: u.hp, maxhp: u.maxhp,
          r: u.r, c: u.c, alive: u.alive, offField: u.offField,
          hasKnife: u.hasKnife, hasHorse: u.hasHorse,
          st: u.st, cds: u.cds, usedSave: u.usedSave, boons: u.boons,
          homeR: u.homeR, homeC: u.homeC, apNow: u.apNow,
          _undo: u._undo
        })),
        log: this.log.slice(-40)
      };
    }

    /* 静态方法（Battle.fromSave(...)，不必先 new）：从快照重建一场战斗。
       先按配置正常 _build 摆好棋，再用快照逐字段覆盖回去，单位按 uid 对齐。 */
    static fromSave(snap, stages) {
      const stg = snap.cfg.stageId ? stages.find(x => x.id === snap.cfg.stageId) : null;
      const cfg = {
        mode: snap.cfg.mode, diff: snap.cfg.diff, aiAggr: snap.cfg.aiAggr,
        playerChar: snap.cfg.playerChar, stage: stg || undefined,
        enemies: snap.cfg.enemies || [], allies: snap.cfg.allies || [],
        rule: stg ? stg.rule : null, waves: stg ? stg.waves : undefined,
        triggeredReset: true
      };
      const b = new Battle(cfg);
      // 还原单位（按 uid 对齐，缺者忽略，多者丢弃）
      // uid→快照 的 Map：键值查找是 Map 的本职，比在数组里反复 find 利索。
      const saved = new Map(snap.units.map(u => [u.uid, u]));
      const keep = [];
      for (const u of b.units) {
        const su = saved.get(u.uid);
        if (!su) continue;
        // Object.assign：把右侧对象的字段批量盖进 u（用存档值覆盖新建值）。
        // st/boons 先合并默认值再盖存档值——旧存档缺新字段时也不至于 undefined。
        Object.assign(u, {
          hp: su.hp, maxhp: su.maxhp, r: su.r, c: su.c, rx: su.c, ry: su.r,
          alive: su.alive, offField: su.offField, hasKnife: su.hasKnife, hasHorse: su.hasHorse,
          st: Object.assign({}, u.st, su.st), cds: su.cds || {}, usedSave: !!su.usedSave,
          boons: Object.assign({}, u.boons, su.boons), homeR: su.homeR, homeC: su.homeC,
          apNow: su.apNow || 0, _undo: su._undo || []
        });
        keep.push(u);
      }
      b.units = keep;
      b.player = keep.find(u => u.side === "player") || b.units[0];
      b.round = snap.round; b.waveIndex = snap.waveIndex;
      b.survivalWaveNo = snap.survivalWaveNo;
      b.boonsTaken = snap.boonsTaken || [];
      b.stats = Object.assign(b.stats, snap.stats || {});
      b.log = (snap.log || []).slice();
      return b;
    }

    /* ---------- 行动点 ---------- */
    /* 算行动点：基础值（猜拳结果）+ 增益 + 临时修正，封顶 AP_CAP。
       玩家侧附带「以寡敌众」补偿：敌人越多，行动点与血上限的补贴越多。 */
    calcAP(u, base) {
      let ap = base + (u.boons.apBonus || 0);
      // 上回合积欠的行动点修正（apMod，多为负数）在此兑现，用完即清零。
      ap += u.st.apMod || 0; u.st.apMod = 0;
      // 以寡敌众：每多一名敌人，玩家多得一点行动（至多+3），使一对多仍有输出
      // （极难/噩梦：多人平衡失效——无行动点与血上限补偿）
      if (u.side === "player" && this.diff !== "extreme" && this.diff !== "nightmare") {
        const n = this.living("enemy").length;
        if (n > 1) {
          const O = CFG.RULES.OUTNUMBER;
          const bonus = Math.min(O.apCap, (n - 1) * O.apPer);
          ap += bonus;
          const hpBonus = Math.min(O.hpCap, (n - 1) * O.hpPer);
          // 血上限补贴只在首次多打少时发一次（_outnumberedHp 兼当「已领过」记号）。
          if (!u._outnumberedHp) {
            u._outnumberedHp = hpBonus;
            u.maxhp += hpBonus; u.hp += hpBonus;
            this.pushLog("以寡敌众：行动点+" + bonus + "，血上限+" + hpBonus + "。");
          }
        }
      }
      if (this.hasPassive(u, "xinhui") && this.round % 2 === 0) { ap += 1; this.pushLog("「慧」灵光乍现，行动点+1！"); }
      return Math.max(0, Math.min(CFG.RULES.AP_CAP, ap));
    }

    // 敌方基础行动点：查难度表；3 名以上敌人用 apBig（人多反而更少，压总输出）。
    enemyBaseAP() {
      const d = CFG.DIFFICULTY[this.diff] || CFG.DIFFICULTY.normal;
      const big = this.living("enemy").length >= 3;
      if (this.mode === "survival") return d.apSolo;
      return big ? d.apBig : d.apSolo;
    }

    /* AI 进攻性档位：影响技能使用、血祭、目标选择与是否撤退 */
    aiProfile() {
      return CFG.AI_AGGR[this.aiAggr] || CFG.AI_AGGR.active;
    }

    // 挑目标：weakest=先打残血（同血比远近），否则就近打；slice() 先复制再排序，不动原数组。
    _pickTarget(u, foes, focus) {
      if (!foes.length) return null;
      if (focus === "weakest") {
        return foes.slice().sort((a, b) => (a.hp - b.hp) || (manh(u, a) - manh(u, b)))[0];
      }
      return foes.slice().sort((a, b) => manh(u, a) - manh(u, b))[0];
    }

    /* 远离某目标的可达格（消极/守成在残血时用） */
    _stepAway(u, threat) {
      const reach = this._reachable(u, this.moveRange(u));
      let best = null, bestScore = -1e9;
      for (const key of reach.keys) {
        const [r, c] = key.split(",").map(Number);
        if (this.unitAt(r, c)) continue;
        const d = Math.abs(r - threat.r) + Math.abs(c - threat.c);
        const near = this.opponentsOf(u).filter(f => Math.max(Math.abs(f.r - r), Math.abs(f.c - c)) <= 1).length;
        // 打分：离威胁越远越好（×2），落点旁的敌人越多扣得越狠（×4）。
        const sc = d * 2 - near * 4;
        if (sc > bestScore) { bestScore = sc; best = [r, c]; }
      }
      return best;
    }



    /* 敌方伤害缩放：以少打多为常态，人多则单体伤害递减，避免围殴瞬杀 */
    enemyDmgScale() {
      const n = this.living("enemy").length;
      let base = CFG.DMG_BY_COUNT[Math.min(4, n)];
      if (this.mode === "survival") base *= CFG.SURVIVAL_HP_EXTRA;
      base *= (CFG.DIFFICULTY[this.diff] || CFG.DIFFICULTY.normal).dmgMul;
      return base;
    }

    /* ---------- 回合循环 ---------- */
    /* ============================================================
     * run()：主回合循环——引擎的心跳。一回合的完整时序：
     *   回合数 +1 → 清「每回合一次」标记 → 剧情触发/特则（飞瓶、种树）→
     *   回合上限检查 → 起义援军 → await 猜拳（等玩家点弹窗）→ 发行动点 →
     *   玩家阶段（await 玩家操作）→ 友军各自动一回合 → 敌人各自动 → _endRound 收尾。
     * 任何一步都可能把 this.over 置真；循环一见 over 就停，返回胜负结果。
     * ============================================================ */
    async run() {
      // 把 UI 钩子抓个短名；下面所有 await ui.xxx 都是在「请界面做事」。
      const ui = window.SJI_UI;
      while (!this.over) {
        this.round++;
        // 「每回合一次」类记号（依然的减伤、首击加成）在回合开头统一复位。
        this.units.forEach(u => u.dampUsed = false);
        if (this.player._undo) this.player._undo.length = 0;
        for (const u of this.units) u._usedFirstStrike = false;
        await this._fireTriggers("roundStart");
        // 剧情特则：看台飞瓶（运动会）——与敌人同行或同列者，被饮料瓶砸中
        if (this.rule && this.rule.id === "cans" && !this.over) {
          const lined = this.living("enemy").some(u => u.r === this.player.r || u.c === this.player.c);
          if (lined) {
            this.pushLog("—— 看台上飞来饮料瓶！——");
            await this.rawHurt(this.player, 1, "被看台飞瓶砸中");
            window.SJI_UI.fxFloat(this.player, "飞瓶！", "#c9b28a");
          }
        }
        // 剧情特则：种树不绝（终焉）——崇国每回合自动种树
        if (this.rule && this.rule.id === "zhongshu" && !this.over) {
          const cg = this.living("enemy").find(u => u.charId === "chongguo");
          if (cg) {
            const live = this.units.filter(x => x.alive && x.charId === "tree" && x.side === "enemy").length;
            if (live < CFG.RULES.TREE_CAP) {
              const spot = DIRS.map(([dr, dc]) => [cg.r + dr, cg.c + dc]).find(([r, c]) => this.passable(r, c));
              if (spot) {
                const tr = makeUnit("tree", "enemy", this.units.length);
                this._place(tr, spot);
                this.units.push(tr);
                window.SJI_UI.snap(tr);
                this.pushLog("崇国种树一株！它看起来……快要死了。");
              }
            }
          }
        }
        ui.onState();
        // 30 回合打完仍未分胜负：判负（高考终了，视为败绩）。
        if (this.round > CFG.RULES.MAX_ROUND) { this.finish("timeout"); break; }
        // 起义援军
        if (this.rule && this.rule.id === "uprising" && this.round === 3) await this._spawnReinforcements();
        // 猜拳
        // 猜拳：引擎把控制权交给 UI 弹窗，玩家点完才 resolve，返回 {res, ap}。
        // 这是引擎/UI 异步协作的第一处——引擎只要结果，何时给由 UI 决定。
        const rps = await ui.rpsRound(this);
        if (this.over) break;
        // 发行动点：玩家按猜拳结果，友军固定 2 点，敌人按难度表。
        this.player.apNow = this.calcAP(this.player, rps.ap);
        this.living("ally").forEach(u => u.apNow = this.calcAP(u, 2));
        this.living("enemy").forEach(u => u.apNow = this.calcAP(u, this.enemyBaseAP()));
        ui.onState();
        // 玩家阶段（返家者本回合不得入场）
        if (this.player.offField > 0) {
          this.player.offField--;
          this.pushLog("「" + this.player.ch.hao + "」返家途中，此回合不得入场。");
          if (this.player.offField <= 0) this._returnHome(this.player);
          ui.onState();
          if (ui.banner) await ui.banner("返家途中", 900);
        } else if (this._tickStatusStart(this.player)) {
          // 被惑/晕眩：本回合跳过（此前玩家不经 aiAct，该项从未生效）
          this.pushLog("「" + this.player.ch.hao + "」晕眩/被惑，此回合跳过。");
          ui.onState();
          if (ui.banner) await ui.banner("此回合跳过", 900);
        } else {
          // 玩家操作阶段：battle-ui.js 会把 resolve 函数暂存进 _phaseResolve，
          // 直到玩家点「结束回合」才兑现这个 Promise——引擎在此冻结等操作。
          await ui.playerPhase(this);
        }
        // 缴械与沉默只封"本回合"，到此解除（否则会永久封锁）
        this._tickStatusEnd(this.player);
        ui.onState();
        if (this.over) break;
        // 友军
        for (const u of this.living("ally")) { await this.aiAct(u); if (this.over) break; }
        // 敌人
        for (const u of this.living("enemy")) { await this.aiAct(u); if (this.over) break; }
        if (this.over) break;
        await this._endRound();
      }
      return this.result;
    }

    /* 起义特则：第 3 回合，两名 9 血心腹在玩家附近入场。
       小细节：ui_onState 声明在使用之后——函数声明会「提升」所以能跑，但别学。 */
    async _spawnReinforcements() {
      this.pushLog("—— 起义！子琛之心腹二人入场：马上解散，毋恐担责！——");
      for (let i = 0; i < 2; i++) {
        const m = makeUnit("mob", "enemy", 100 + i);
        m.hp = m.maxhp = 9;
        const spot = this._freeNear(this.player.r, this.player.c, 3);
        this._place(m, spot);
        this.units.push(m);
        window.SJI_UI.snap(m);
      }
      ui_onState();
      function ui_onState() { window.SJI_UI.onState(); }
    }

    // 从 (r,c) 起一圈圈向外扩找空位（螺旋找位），实在没有就全图随机。
    _freeNear(r, c, maxD) {
      for (let d = 1; d <= maxD + 3; d++) {
        for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
          const nr = r + dr, nc = c + dc;
          if (this.passable(nr, nc)) return [nr, nc];
        }
      }
      return this._randomFree();
    }

    /* 遣返归队：优先回原位（homeR/homeC）；被占则全图找最近的空格落脚。 */
    _returnHome(u) {
      if (!u.alive) return;
      const hr = (u.homeR !== undefined) ? u.homeR : u.r;
      const hc = (u.homeC !== undefined) ? u.homeC : u.c;
      // 占位判定须排除自身（归位时其 offField 已归零，会被 unitAt 误判为占位者）
      const taken = (r, c) => this.units.some(x => x !== u && x.alive && x.offField <= 0 && x.r === r && x.c === c);
      if (!taken(hr, hc)) { u.r = hr; u.c = hc; }
      else {
        let best = null, bd = 999;
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
          if (taken(r, c)) continue;
          const d = Math.abs(r - hr) + Math.abs(c - hc);
          if (d < bd) { bd = d; best = [r, c]; }
        }
        if (best) { u.r = best[0]; u.c = best[1]; this.pushLog("「" + u.ch.hao + "」原位被占，就近归队。"); }
      }
      if (window.SJI_UI.fxFloat) window.SJI_UI.fxFloat(u, "归来", "#7fe08a");
      this.pushLog("「" + u.ch.hao + "」返家归来，归于原位。");
    }

    /* ---------- 状态计时（玩家与 AI 共用） ---------- */
    /* 回合开始：若处于"跳过"，消耗一层并返回 true（本回合不得行动） */
    _tickStatusStart(u) {
      if (u.st.skip > 0) { u.st.skip--; u.apNow = 0; return true; }
      return false;
    }

    /* 回合结束：缴械与沉默恰好覆盖"受害者自己的这一个回合"，到此解除 */
    _tickStatusEnd(u) {
      if (u.st.seal > 0) u.st.seal--;
      if (u.st.disarm > 0) u.st.disarm--;
      if (u.st.silence > 0) u.st.silence--;
    }

    /* 剧情对话触发器两姊妹：_fireTriggers 是 async（可 await 依次播），
       _checkTriggers 是同步（伤害结算中途调用，不能打断流程）；都只触发一次。 */
    async _fireTriggers(when) {
      for (const t of this.triggers) {
        if (t.fired || t.when !== when) continue;
        if (when === "roundStart" && t.round !== this.round) continue;
        if (when === "waveStart" && t.wave !== this.waveIndex + 1) continue;
        t.fired = true;
        if (window.SJI_UI && window.SJI_UI.showDialogue) await window.SJI_UI.showDialogue(t.lines);
      }
    }

    _checkTriggers(when, arg) {
      for (const t of this.triggers) {
        if (t.fired || t.when !== when) continue;
        if (when === "enemyLow" && t.char !== arg) continue;
        if (when === "enemyDown" && t.char && t.char !== "any" && t.char !== arg) continue;
        t.fired = true;
        if (window.SJI_UI && window.SJI_UI.showDialogue) window.SJI_UI.showDialogue(t.lines);
      }
    }

    /* 回合收尾，按顺序结算：回血类被动 → 毒/近身被动掉血 → 技能冷却 −1 →
       剧情特则（验算/争食/鲍鱼之肆）→ 写续战存档 → 检查战斗是否结束。 */
    async _endRound() {
      this._trackMinHp(this.player);
      // 回合结束被动
      for (const u of this.living()) {
        if (this.hasPassive(u, "shibo")) this.heal(u, 1, "吸东来之紫气，");
        if (u.boons.regen) this.heal(u, u.boons.regen, "吐纳，");
        if (u.charId === "keai") {
          const dz = this.units.find(x => x.alive && x.charId === "dazhan" && x.side === u.side);
          if (dz && adj(u, dz)) this.heal(dz, 1, "可怡心善展，");
        }
      }
      for (const u of this.living()) {
        if (this.hasPassive(u, "shenren")) {
          const foes = this.opponentsOf(u).filter(f => adj(u, f));
          for (const f of foes) { this.rawHurt(f, 1, "近鲍鱼之肆而受毒"); await sleep(120); }
        }
          // 中毒：先扣回合数再掉 1 血，剩几回合就疼几回合。
        if (u.st.poison > 0) {
          u.st.poison--;
          this.rawHurt(u, 1, "毒发");
          await sleep(120);
        }
      }
      // 冷却
      for (const u of this.units) {
        for (const k of Object.keys(u.cds)) if (u.cds[k] > 0) u.cds[k]--;
        u.roundDealt = 0;
      }
      this.roundDealt = 0;
      // 剧情特则：验算（九省联考）——wonder 血量为偶数则回合末回复 1 血
      if (this.rule && this.rule.id === "yansuan") {
        const w = this.living("enemy").find(u => u.charId === "wonder");
        if (w && w.hp > 0 && w.hp % 2 === 0 && w.hp < w.maxhp) this.heal(w, 1, "验算无误，");
      }
      // 剧情特则：争食（二楼巡征）——场上三份饭，回合结束站在饭上者食之
      if (this.rule && this.rule.id === "zhengshi") {
          // 三份饭的固定坐标（首次用到才初始化；被吃掉即从名单上划去）。
        if (!this._food) this._food = [[1, 3], [3, 3], [5, 3]];
        this._food = this._food.filter(([r, c]) => {
          const u = this.unitAt(r, c);
          if (u) {
            this.heal(u, 2, "抢得一时之食，");
            this.pushLog("—— 那份饭，没了。——");
            return false;
          }
          return true;
        });
      }
      // 剧情特则：鲍鱼之肆（宿舍之夜）——相邻敌我互相腐蚀
      if (this.rule && this.rule.id === "stench") {
        for (const u of this.living()) {
          for (const f of this.opponentsOf(u)) {
            if (adj(u, f)) await this.rawHurt(f, 1, "近鲍鱼之肆而受蚀");
          }
        }
      }
      ui_onState2();
      function ui_onState2() { window.SJI_UI.onState(); }
      // 断点续战：每回合末写一次快照（玩家可在标题页"继续上局"）
      if (window.SJI_SAVE && window.SJI_SAVE.saveBattle) {
        try { window.SJI_SAVE.saveBattle(this.serialize()); } catch (e) {}
      }
      await sleep(260);
      await this._checkBattleEnd();   // 必须等待：增益选择等弹层需在下一回合猜拳前结束
    }

    /* 胜负判定：玩家倒下即负；敌人清空时——多波关卡/生存模式进下一波，否则获胜。 */
    async _checkBattleEnd() {
      if (this.over) return;
      const foes = this.living("enemy");
      if (!this.player.alive) { this.finish("lose"); return; }
      if (foes.length === 0) {
        if (this.mode === "survival" || (this.waves.length > 1 && this.waveIndex < this.waves.length - 1)) {
          await this._nextWave();   // 等待波次流程（含增益选择）完毕
        } else {
          this.finish("win");
        }
      }
    }

    /* 下一波：生存模式=先选增益→小回 3 血→生成随波次变强的敌人；
       剧情模式=阵间休整（restFull 回满，否则回血上限 60%）→按 hpScale 调血放入新敌。
       收尾统一清掉玩家身上的负面状态。 */
    async _nextWave() {
      this.waveIndex++;
      if (this.mode === "survival") {
        // 选增益后再推进波次号（波次号在选完前不代表已入下一波）
        const boon = await window.SJI_UI.pickBoon(this);
        if (boon) this._applyBoon(this.player, boon);
        this.survivalWaveNo = this.waveIndex + 1;
        this.pushLog("—— 第" + this.survivalWaveNo + "波将至，苔藓不尽…… ——");
        this.heal(this.player, 3, "战间休整，");
        const ids = this._survivalWave(this.survivalWaveNo);
          // 敌人血量每深一波 +5%。
        const scale = 1 + 0.05 * (this.survivalWaveNo - 1);
        ids.forEach((id, i) => {
          const m = makeUnit(id, "enemy", 200 + this.waveIndex * 10 + i);
          m.maxhp = Math.round(m.maxhp * scale); m.hp = m.maxhp;
          const spot = this._freeSpawnFar();
          this._place(m, spot);
          this.units.push(m);
          window.SJI_UI.snap(m);
        });
        this.pushLog("第" + this.survivalWaveNo + "波：" + ids.length + "人入场。");
        window.SJI_UI.onState();
      } else {
        const stgR = (this.cfg && this.cfg.stage) ? this.cfg.stage : null;
        if (stgR && stgR.restFull) {
          this.pushLog("—— 下一阵！赛事之间，得以充分休整。——");
          this.heal(this.player, this.player.maxhp, "充分休整，");
        } else {
          // 阵间休整：至少回 4 点，否则回血上限的 60%（向上取整）。
          const rest = Math.max(4, Math.ceil(this.player.maxhp * 0.6));
          this.pushLog("—— 下一阵！阵间休整回复" + rest + "血。——");
          this.heal(this.player, rest, "阵间休整，");
        }
        const ids = this.waves[this.waveIndex] || [];
        const stg2 = (this.cfg && this.cfg.stage) ? this.cfg.stage : null;
        const k = (stg2 && stg2.hpScale !== undefined) ? stg2.hpScale
          : (this.diff === "extreme" || this.diff === "nightmare") ? 1.0
          : CFG.HP_BY_COUNT[Math.min(4, ids.length)];
        ids.forEach((id, i) => {
          const m = makeUnit(id, "enemy", 300 + this.waveIndex * 10 + i);
          if (k !== 1) { m.maxhp = Math.max(4, Math.round(m.maxhp * k)); m.hp = m.maxhp; }
          const spot = this._freeSpawnFar();
          this._place(m, spot);
          this.units.push(m);
          window.SJI_UI.snap(m);
        });
        window.SJI_UI.onState();
        await this._fireTriggers("waveStart");
      }
      // 清负面
      const p = this.player;
      Object.assign(p.st, { skip: 0, poison: 0, apMod: 0, disarm: 0, silence: 0, seal: 0 });
    }

    // 新敌人出生点：优先「离玩家曼哈顿 ≥3」的标准出生位，实在没有就近塞。
    _freeSpawnFar() {
      const spots = SPAWNS.filter(s => this.passable(s[0], s[1]) && manh({ r: s[0], c: s[1] }, this.player) >= 3);
      if (spots.length) return spots[Math.floor(Math.random() * spots.length)];
      return this._freeNear(0, 3, 3);
    }

    /* 生存模式选中的增益落地：往 boons 表写「永久修正值」，各结算处按需读取
       （如 calcDamage 读 boons.knife、moveRange 读 boons.move、calcAP 读 boons.apBonus）。 */
    _applyBoon(u, boon) {
      this.boonsTaken.push(boon.id);
      switch (boon.id) {
        case "b_hp": u.maxhp += 2; this.heal(u, 2, "奋进，"); break;
        case "b_bloodfree": u.boons.bloodFree = true; break;
        case "b_cleave": u.boons.cleave = Math.max(1, u.boons.cleave); break;
        case "b_horsereach": u.boons.horseRange += 1; break;
        case "b_killheal": u.boons.killHeal = 2; break;
        case "b_shield": u.boons.shield += 3; u.st.shield += 3; break;
        case "b_firststrike": u.boons.firstStrike += 1; break;
        case "b_knife": u.boons.knife += 1; break;
        case "b_horse": u.boons.horse += 1; break;
        case "b_regen": u.boons.regen += 1; break;
        case "b_dodge": u.boons.dodge += 0.15; break;
        case "b_blood": u.boons.blood2 = true; break;
        case "b_cd": u.boons.cdReduce += 1; break;
        case "b_move": u.boons.move += 1; break;
        case "b_ap": u.boons.apBonus += 1; break;
      }
      this.pushLog("得增益「" + boon.name + "」：" + boon.desc);
    }

    /* 终局：钉死 over/result，清掉续战存档，播报战果并通知 UI 弹结算。 */
    finish(result) {
      if (this.over) return;
      this.over = true;
      this.result = result;
      if (window.SJI_SAVE && window.SJI_SAVE.clearBattle) window.SJI_SAVE.clearBattle();
      this.pushLog(result === "win" ? "—— 活者为王！——" : (result === "timeout" ? "—— 高考终了，胜负未分，视为败绩。——" : "—— 汝倒下了。重开重开！——"));
      if (window.SJI_UI) window.SJI_UI.onBattleEnd(this);
    }
  }

  // IIFE 的「出口」：只有这个对象上的名字能被外界访问，其余都是模块内部零件。
  return { Battle, isWall, inB, cheb, manh, adj, SIZE, makeUnit };
})();
