/* 实验史记·马刀行 —— 引擎：状态 / 进度 / 事件 / 成就
   自由开放世界：没有「章节靠睡觉推进」的时间线。章节（G.ch）由主线完成度驱动，
   时段与行动点退化为氛围与风味，不再门控任何玩法。 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   世界层的状态机：定义全局存档对象 G 的结构、章节进度推导、事件查询、
   风险判定（被巡查逮住的小剧场）、资源增减（文笔/声望/零花钱/好感）、
   史料收集与成就表。

   【架构位置】
   在 config.js 与 data/* 之后、world.js 之前加载。
   依赖：data 里的 CHAPTERS / EVENTS / SHARDS / PEOPLE*（顶层裸名），
   以及 config 的 clamp / toast / Sfx / Save；方法里还会调 UI、Dialog、
   World——这些文件在本文件之后加载也没关系，JS 的全局名是在“运行到
   那一行时”才去查找的，不是加载时。被几乎所有世界侧文件调用。

   【暴露的全局名】
   PERIODS / PERIOD_LABEL / PERIOD_THEME、newGameState、
   window.G（全局状态本体）、Engine、ACHIEVEMENTS。

   【新手阅读提示】
   1) G 是整个游戏唯一的“账本”，一切进度都在这一个对象里；它被特意挂到
      window 上（window.G = null），战斗层只认 window.G。
   2) 章节号 G.ch 不再由睡觉/日程推进，而是从主线任务完成度“推导”出来，
      且只进不退（见 Engine.syncChapter），老存档也不会章节回跳。
   3) 注意战斗层也有个 js/battle/engine.js，那是回合制对战的核心，
      与本文件是两个东西。
   ================================================================ */

/* 时段仅作氛围与 NPC 调度参考（世界不按课表走） */
/* 四个时段的 id 数组，外加两张映射表：显示名、<body> 上的主题 class
   （用于白天/夜间换肤）。PERIODS 的下标与 G.periodIdx 对应。 */
const PERIODS = ['morning', 'noon', 'aft', 'eve'];
const PERIOD_LABEL = { morning:'上午', noon:'午间', aft:'下午', eve:'夜间' };
const PERIOD_THEME = { morning:'theme-morning', noon:'theme-day', aft:'theme-day', eve:'theme-night' };

/* 造一份全新存档。整个游戏的所有进度都装在这一个对象里：
   ver=存档版本号（读档时据此做旧档兼容）、ch=章节、day/periodIdx=时间、
   wen/rep/money=文笔/声望/零花钱、shards=已得史料、vols=已发表各卷、
   bag=行囊、ach=成就、flags=一次性标记、blades/quests=刀卡与任务、
   settings=玩家设置、stats=统计数字（不少成就靠它判定）。
   存档时把整个对象 JSON.stringify 后写进 localStorage。 */
function newGameState() {
  return {
    ver: 2,
    ch: 0, day: 1, periodIdx: 0,
    ap: 3, apMax: 3,
    wen: 5, rep: 50, money: 12,
    favor: {},            // personId -> 0..100
    shards: {},           // shardId -> {src, wen}
    doneEvents: [],
    vols: {},             // no -> {grade(1-4), score, style, shards:[ids], text}
    giftToday: {}, chatCount: 0, caughtToday: false,
    bag: { snack:1, candy:2, note:1 },
    ach: {},
    flags: { visitedScenes:['playground'], metPeople:[], prologue:false, duelBanDays:0 },
    wins: 0, duelsLost: 0,
    blades: { cards: [], equip: null, rare: [], rareOn: [], rareInit: true },   // 刀谱：击败者 id → 录技；rareOn → 生效中的稀有刀卡
    quests: {},              // 任务完成记录（主线 9 节 + 支线 7 条）
    roster: ['yinkesi'],     // 出战名册（支线解锁强力人物）
    trialDone: {},           // 试炼首通记录
    duelDone: {},            // duelId -> true（成传战/支线战斗去重）
    settings: { muted:false, motion:'full', speed:1 },
    stats: { chats:0, gifts:0, reads:0, gossip:0, caught:0, listened:0,
             direct:0, curve:0, plays:{}, published:0 },
  };
}

/* 全局状态 G 的“户口”。特意用 window.G 而不是顶层 const：
   战斗层（blades.js 等）要通过 window.G 拿账本；真正的赋值发生在
   main.js 开新档/读档时（G = newGameState() 或 G = 读出的存档），
   此刻先占位 null。 */
window.G = null;

/* 世界状态机：一个普通对象字面量充当“命名空间”，方法之间用 this 互调
   （如 this.chDef()）。没有 class，也没有模块，就是最朴素的组织方式。 */
const Engine = {
  /* ---------- 进度（章节 ↔ 主线） ---------- */
  /* 当前章节的配置数据（CHAPTERS 表在 data/volumes.js）、时段、日期文案。 */
  chDef() { return CHAPTERS[G.ch] || CHAPTERS[0]; },
  period() { return PERIODS[G.periodIdx] || 'morning'; },
  dateLabel() { const c = this.chDef(); return `${c.date} · 第 ${G.day} 日`; },
  chLabel() { return this.chDef().title; },
  /** 章节由主线完成度推导；只进不退（老档原进度保留） */
  /* 章节同步：问主线任务系统 Quests“按现在的完成度应该是第几章”，
     只有想要的章节数更大才推进——单向推导、只进不退，
     旧存档里已到的进度绝不会往回拨。 */
  syncChapter() {
    if (typeof Quests === 'undefined') return false;
    const want = Quests.chapterNow();
    if (want > G.ch) { G.ch = want; this.pendingCh = G.ch; this.syncWorldFlags(); return true; }
    return false;
  },
  /** 章节达标即解锁对应世界内容（不再依赖某条史料去开门） */
  syncWorldFlags() {
    if (G.ch >= 8) G.flags.xiehui = true;   // 世界马刀协会开张（m4 后）
  },
  /* 取走“待播报的新章节”标记：一次性读取，读完即清空（null）。 */
  takePendingChapter() { const c = this.pendingCh; this.pendingCh = null; return c == null ? null : c; },
  pendingCh: null,
  /** 仅供测试/调试：直接推进章节号（正式流程由 syncChapter 按主线驱动） */
  nextChapter() {
    if (G.ch >= CHAPTERS.length - 1) return 'finale-ready';
    G.ch++; Save.write(); return 'ok';
  },

  /* ---------- 事件：不再按时段/日期门控，本章之事皆可亲历 ---------- */
  /* 当前章节中还没经历过的事件。filter 挑行 + includes 查“做过没有”，
     是 JS 里查“剩余项”的惯用组合。 */
  eventsNow() {
    return EVENTS.filter(e => e.ch === G.ch && !G.doneEvents.includes(e.id));
  },
  /** 供「今日风闻」板 */
  eventsToday() { return this.eventsNow(); },
  /** 已走过的章节里没赶上、且未收集的史料 → 可托人打听 */
  missedEvents() {
    return EVENTS.filter(e => e.shard && !G.shards[e.shard] && !G.doneEvents.includes(e.id) && e.ch < G.ch);
  },
  /** 歇一日：日子推进，时段随机轮换（纯氛围） */
  /* 过天结算：天数 +1、随机换时段（Math.floor(Math.random()*4) 取 0~3）、
     清空“每日限一次”类状态、发 3 文生活费；
     duelBanDays 是“马刀被没收”的剩余天数，减到 0 时 toast 报喜还刀。 */
  nextDay() {
    G.day++;
    G.periodIdx = Math.floor(Math.random() * 4);
    G.giftToday = {}; G.chatCount = 0; G.caughtToday = false;
    G.money += 3; // 每日生活费
    G.flags.fineTomorrow = false;
    if (G.flags.duelBanDays > 0) {
      G.flags.duelBanDays--;
      if (G.flags.duelBanDays === 0) toast('钦法还刀：马刀失而复得，可约战矣', '刀');
    }
    Save.write(); return 'newday';
  },

  /* ---------- 资源 ---------- */
  /** 自由开放世界：行动点不再是探索门禁。保留接口以免改动所有调用点。 */
  /* 四个“加资源”函数都走同一套路：先 clamp 夹进合法区间，再让 HUD 数字跳一下。
     addMoney 攒到 40 顺手解锁“家有余粮”成就。 */
  spendAP() { return true; },
  addWen(n) { G.wen = clamp(G.wen + n, 0, 100); UI.bump('wen'); },
  addRep(n) { G.rep = clamp(G.rep + n, 0, 100); UI.bump('rep'); },
  addMoney(n) {
    G.money = clamp(G.money + n, 0, 99); UI.bump('money');
    if (G.money >= 40) this.award('ach_rich');
  },
  /* 好感读档：没记录就当 0（|| 给默认值是 JS 处理“可能不存在”的惯用法）。 */
  favorOf(id) { return G.favor[id] || 0; },
  /* 静默版：只改数值不弹提示，供批量结算用。 */
  addFavorQuiet(id, n) { G.favor[id] = clamp(this.favorOf(id) + n, 0, 100); },
  /* 带提示版：弹出“某人称 好感 ±n”的 toast，文案优先称号（hao）再退回本名。 */
  addFavor(id, n) {
    G.favor[id] = clamp(this.favorOf(id) + n, 0, 100);
    const p = PEOPLE_BY_ID[id];
    if (n > 0 && p) toast(`${p.hao || p.name} 好感 +${n}`, '善');
    else if (n < 0 && p) toast(`${p.hao || p.name} 好感 ${n}`, '恶');
  },

  /* ---------- 史料 ---------- */
  /* 史料收集：!!x 把任意值转成 true/false。grantShard 记录来源并定文笔值：
     打听来的转述版（gossip）文笔 -1，亲历/采访拿全值；
     同一条史料不可重复获得（已有时返回 false）。 */
  hasShard(id) { return !!G.shards[id]; },
  grantShard(id, src) {
    if (!id || G.shards[id]) return false;
    const base = SHARDS[id];
    const cut = src === 'gossip' ? 1 : 0;
    G.shards[id] = { src, wen: Math.max(1, base.wen - cut) };
    const srcName = { scene:'亲历', gossip:'转述', interview:'采访' }[src] || '所得';
    toast(`史料「${base.name}」到手（${srcName}）`, '料');
    Sfx.good();
    return true;
  },

  /* ---------- 风险：被逮（自由世界：只与地点有关，不再限时段） ---------- */
  /** 在教学楼内行动，偶遇巡查。返回是否触发了巡查 */
  /* 风险掷骰：只在走廊/教室/办公室等“教学楼内”场景，9% 概率触发；
     每天至多一次（G.caughtToday 当天标记，nextDay 时清零）。 */
  riskCheck() {
    if (G.caughtToday) return false;
    if (!['corridor', 'classroom6', 'classroom7', 'office'].includes(World.sceneId)) return false;
    if (Math.random() > 0.09) return false;
    G.caughtToday = true;
    return true;
  },
  /* 被逮后的教学小剧场：播放一段带选项的对话。三个选项成功率
     50% / 65% / 80%，选项的 run() 里用 Math.random() 掷骰决定走向，
     失败扣声望甚至“通报电子班牌”（解锁 ach_caught 成就）。
     onDone 原样传给 Dialog.play——对话结束后由调用方继续自己的流程。 */
  caughtPlay(onDone) {
    G.stats.caught++;
    Dialog.play([
      { who:'钦法', text:'（从走廊尽头逼近）汝乃何人？此何课也？' },
      { choice: [
        { t:'把纸条塞进袖口，装作无事', fx:'五五之数', run() {
            if (Math.random() < 0.5) return { say:{who:'旁白',text:'钦法扫了一眼，走了。冷汗浸透了后背。'} };
            Engine.addRep(-3); return { say:{who:'钦法',text:'手拿出来。——记你一笔。'}, bad:true };
        } },
        { t:'淡定举起手中的书', fx:'六五之数', run() {
            if (Math.random() < 0.65) return { say:{who:'旁白',text:'钦法点点头：“善。”——幸好你带的是《读通鉴论》。'} };
            G.flags.fineTomorrow = true; return { say:{who:'钦法',text:'站到后面去。明日行动点-1。'}, bad:true };
        } },
        { t:'撒腿就跑', fx:'险中求活', run() {
            if (Math.random() < 0.8) { Engine.addRep(-2); return { say:{who:'旁白',text:'你一路冲进厕所，听见外面脚步声远去。'} }; }
            Engine.addRep(-5); Engine.award('ach_caught');
            return { say:{who:'钦法',text:'站住！通报于电子班牌！'}, bad:true };
        } },
      ] },
    ], onDone);
  },

  /* ---------- 成就 ---------- */
  /* 发成就：G.ach 里记一笔（已有就直接返回，保证幂等——重复触发不重复弹），
     从成就表查出名字弹 toast、播解锁音效并立刻写存档。 */
  award(id) {
    if (G.ach[id]) return;
    G.ach[id] = 1;
    const a = ACHIEVEMENTS.find(x => x.id === id);
    toast(`成就达成「${a ? a.name : id}」`, '成');
    Sfx.unlock();
    Save.write();
  },
};

/* ============ 成就表 ============ */
/* 成就的“户口表”：每个 id 与代码里某处 Engine.award(id) 的调用点一一对应；
   icon 是 emoji 直接进 UI。渲染成就墙时整表遍历，有没有解锁看 G.ach。 */
const ACHIEVEMENTS = [
  { id:'ach_start',   name:'开卷',      icon:'📖', desc:'完成序章，决定重写史记。' },
  { id:'ach_shuban',  name:'吾名为贾瀚元', icon:'🪶', desc:'亲历搬书问答。' },
  { id:'ach_wall',    name:'破败城墙',  icon:'🧱', desc:'听大哥讲完那个梦。' },
  { id:'ach_mother',  name:'汝母尚在',  icon:'🩴', desc:'见头哥魔方被碎之日，勇珺发言。' },
  { id:'ach_blood',   name:'血祭血祭',  icon:'🩸', desc:'围观一场马刀，听 wonder 喊完三连。' },
  { id:'ach_duel1',   name:'初执马刀',  icon:'🗡', desc:'赢下第一场马刀对决。' },
  { id:'ach_duel30',  name:'马刀之神',  icon:'⚡', desc:'马刀对决累计 30 胜。' },
  { id:'ach_bloodwin',name:'血祭翻倍',  icon:'🔺', desc:'在一场对决中血祭并取胜。（血祭血祭血血祭）' },
  { id:'ach_wallwin', name:'不离城墙',  icon:'🧱', desc:'全程不离城墙取得一场胜利。（吾终将尽城墙）' },
  { id:'ach_champion',name:'协会冠军',  icon:'🏆', desc:'赢下世界马刀协会锦标赛三连胜。' },
  { id:'ach_surv10',  name:'苔藓不尽',  icon:'🌾', desc:'破败城墙生存抵达第 10 波。' },
  { id:'ach_trial',   name:'试炼者',    icon:'⛰', desc:'六场高难试炼全部首通。' },
  { id:'ach_upgrade', name:'有备而来',  icon:'💪', desc:'养成模式下第一次修炼成功。' },
  { id:'ach_quest',   name:'听令行事',  icon:'📜', desc:'完成第一个任务。' },
  { id:'ach_jntm',    name:'鸡你太美',  icon:'🏀', desc:'只因在榻上高歌，自扫舍七日。' },
  { id:'ach_sayyou',  name:'适可而止',  icon:'🎤', desc:'李帆唱完 Say You Say Me 的第三次笑场。' },
  { id:'ach_direct',  name:'董狐直笔',  icon:'🖋', desc:'第一次选择直笔。史官不删。' },
  { id:'ach_curve',   name:'春秋笔法',  icon:'🎋', desc:'第一次选择曲笔。温柔敦厚。' },
  { id:'ach_spin',    name:'三溴化氮',  icon:'🌀', desc:'陀螺战胜头哥。' },
  { id:'ach_109',     name:'卒得109',   icon:'📝', desc:'亲历大展的月考清晨，走完整个流程。' },
  { id:'ach_lingyang',name:'羚羊奔食',  icon:'羚', desc:'食堂冲刺抢到头饭。' },
  { id:'ach_caught',  name:'当场抓获',  icon:'🚨', desc:'被钦法逮个正着。通报于电子班牌。' },
  { id:'ach_listen',  name:'奇彪无比',  icon:'📢', desc:'认真听课十次。' },
  { id:'ach_gossip',  name:'锦绣昼行',  icon:'📨', desc:'打听八条错过的史料。' },
  { id:'ach_rich',    name:'家有余粮',  icon:'🪙', desc:'零花钱攒到 40。' },
  { id:'ach_sugar',   name:'以糖为恩',  icon:'🍬', desc:'可怡好感满 100。' },
  { id:'ach_pp',      name:'正手？反手？', icon:'🏓', desc:'完成一场乒乓球二十板。' },
  { id:'ach_v8',      name:'马刀书成',  icon:'🗡', desc:'发表卷八《马刀书》。' },
  { id:'ach_half',    name:'半部史记',  icon:'📕', desc:'发表八卷。' },
  { id:'ach_taishi',  name:'太史公',    icon:'👑', desc:'十五卷全部发表，且平均品级达上品。' },
  { id:'ach_ai',      name:'以文观人',  icon:'🤖', desc:'把史记喂给 AI，看完它说你。' },
];
