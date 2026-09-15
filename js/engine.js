/* 实验史记·马刀行 —— 引擎：状态 / 进度 / 事件 / 成就
   自由开放世界：没有「章节靠睡觉推进」的时间线。章节（G.ch）由主线完成度驱动，
   时段与行动点退化为氛围与风味，不再门控任何玩法。 */
'use strict';

/* 时段仅作氛围与 NPC 调度参考（世界不按课表走） */
const PERIODS = ['morning', 'noon', 'aft', 'eve'];
const PERIOD_LABEL = { morning:'上午', noon:'午间', aft:'下午', eve:'夜间' };
const PERIOD_THEME = { morning:'theme-morning', noon:'theme-day', aft:'theme-day', eve:'theme-night' };

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
    blades: { cards: [], equip: null, rare: [] },   // 刀谱：击败者 id → 录技；rare → 试炼稀有刀卡
    quests: {},              // 任务完成记录（主线 9 节 + 支线 7 条）
    roster: ['yinkesi'],     // 出战名册（支线解锁强力人物）
    trialDone: {},           // 试炼首通记录
    duelDone: {},            // duelId -> true（成传战/支线战斗去重）
    settings: { muted:false, motion:'full', speed:1 },
    stats: { chats:0, gifts:0, reads:0, gossip:0, caught:0, listened:0,
             direct:0, curve:0, plays:{}, published:0 },
  };
}

window.G = null;

const Engine = {
  /* ---------- 进度（章节 ↔ 主线） ---------- */
  chDef() { return CHAPTERS[G.ch] || CHAPTERS[0]; },
  period() { return PERIODS[G.periodIdx] || 'morning'; },
  dateLabel() { const c = this.chDef(); return `${c.date} · 第 ${G.day} 日`; },
  chLabel() { return this.chDef().title; },
  /** 章节由主线完成度推导；只进不退（老档原进度保留） */
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
  takePendingChapter() { const c = this.pendingCh; this.pendingCh = null; return c == null ? null : c; },
  pendingCh: null,
  /** 仅供测试/调试：直接推进章节号（正式流程由 syncChapter 按主线驱动） */
  nextChapter() {
    if (G.ch >= CHAPTERS.length - 1) return 'finale-ready';
    G.ch++; Save.write(); return 'ok';
  },

  /* ---------- 事件：不再按时段/日期门控，本章之事皆可亲历 ---------- */
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
  spendAP() { return true; },
  addWen(n) { G.wen = clamp(G.wen + n, 0, 100); UI.bump('wen'); },
  addRep(n) { G.rep = clamp(G.rep + n, 0, 100); UI.bump('rep'); },
  addMoney(n) {
    G.money = clamp(G.money + n, 0, 99); UI.bump('money');
    if (G.money >= 40) this.award('ach_rich');
  },
  favorOf(id) { return G.favor[id] || 0; },
  addFavorQuiet(id, n) { G.favor[id] = clamp(this.favorOf(id) + n, 0, 100); },
  addFavor(id, n) {
    G.favor[id] = clamp(this.favorOf(id) + n, 0, 100);
    const p = PEOPLE_BY_ID[id];
    if (n > 0 && p) toast(`${p.hao || p.name} 好感 +${n}`, '善');
    else if (n < 0 && p) toast(`${p.hao || p.name} 好感 ${n}`, '恶');
  },

  /* ---------- 史料 ---------- */
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
  riskCheck() {
    if (G.caughtToday) return false;
    if (!['corridor', 'classroom6', 'classroom7', 'office'].includes(World.sceneId)) return false;
    if (Math.random() > 0.09) return false;
    G.caughtToday = true;
    return true;
  },
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
