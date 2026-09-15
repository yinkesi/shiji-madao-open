/* 实验史记·春秋笔 —— 引擎：状态 / 时间 / 行动 / 事件 / 成就 */
'use strict';

const PERIODS = ['morning', 'noon', 'aft', 'eve'];
const PERIOD_LABEL = { morning:'上午 · 课上', noon:'午休', aft:'下午 · 课上', eve:'晚自习' };
const PERIOD_THEME = { morning:'theme-morning', noon:'theme-day', aft:'theme-day', eve:'theme-night' };

function newGameState() {
  return {
    ver: 1,
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
    flags: { visitedScenes:['library'], metPeople:[], prologue:false },
    wins: 0, duelsLost: 0,
    blades: { cards: [], equip: null },   // 刀谱：击败者 id → 录技
    duelDone: {},            // duelId -> true（成传战/支线战斗去重）
    settings: { muted:false, motion:'full', speed:1 },
    stats: { chats:0, gifts:0, reads:0, gossip:0, caught:0, listened:0,
             direct:0, curve:0, plays:{}, published:0 },
  };
}

window.G = null;

const Engine = {
  /* ---------- 时间 ---------- */
  chDef() { return CHAPTERS[G.ch]; },
  period() { return PERIODS[G.periodIdx]; },
  dateLabel() {
    const c = CHAPTERS[G.ch];
    return `${c.date} · 第${'一二三四五六日'[G.day - 1]}天`;
  },
  /** 当前时点活跃且未完成的事件 */
  eventsNow() {
    return EVENTS.filter(e => e.ch === G.ch
      && (Array.isArray(e.day) ? e.day.includes(G.day) : e.day === G.day)
      && (e.periods.includes(this.period()) || G.periodIdx === 3)
      && !G.doneEvents.includes(e.id));
  },
  /** 今天（含未来时段）未完成的事件，供风闻板 */
  eventsToday() {
    return EVENTS.filter(e => e.ch === G.ch
      && (Array.isArray(e.day) ? e.day.includes(G.day) : e.day === G.day)
      && !G.doneEvents.includes(e.id));
  },
  /** 已过期（本章节内没赶上）且未收集的史料 → 可打听 */
  missedEvents() {
    return EVENTS.filter(e => e.shard && !G.shards[e.shard] && !G.doneEvents.includes(e.id)
      && (e.ch < G.ch || (e.ch === G.ch && e.day < G.day)));
  },
  advancePeriod() {
    if (G.periodIdx < 3) { G.periodIdx++; return 'period'; }
    return 'eve'; // 调用方打开晚自习菜单
  },
  nextDay() {
    G.day++; G.periodIdx = 0; G.ap = G.apMax + (G.flags.rested ? 1 : 0) - (G.flags.fineTomorrow ? 1 : 0);
    G.flags.rested = false;
    if (G.flags.fineTomorrow) { toast('昨日罚站，今日行动点 -1', '恶'); G.flags.fineTomorrow = false; }
    G.giftToday = {}; G.chatCount = 0; G.caughtToday = false;
    G.money += 3; // 每日生活费
    if (G.day > this.chDef().days) { return 'chapter-end'; }
    Save.write(); return 'newday';
  },
  nextChapter() {
    if (G.ch >= CHAPTERS.length - 1) return 'finale-ready';
    G.ch++; G.day = 1; G.periodIdx = 0; G.ap = G.apMax;
    G.doneEvents = G.doneEvents.filter(id => EVENT_BY_ID[id] && EVENT_BY_ID[id].ch === G.ch); // 保留本章节（防止重复）
    Save.write(); return 'ok';
  },

  /* ---------- 资源 ---------- */
  spendAP(n) {
    n = n || 1;
    if (G.ap < n) { toast('行动点不足，晚自习前只有 ' + G.ap + ' 点'); return false; }
    G.ap -= n; UI.bump('ap'); Save.write(); return true;
  },
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

  /* ---------- 风险：被逮 ---------- */
  /** 课上时段在教室外行动，可能被巡查。返回是否触发了巡查 */
  riskCheck() {
    if (G.caughtToday) return false;
    if (G.periodIdx !== 0 && G.periodIdx !== 2) return false; // 只在上午/下午
    if (World.sceneId === 'classroom6' || World.sceneId === 'classroom7') return false;
    if (Math.random() > 0.14) return false;
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
