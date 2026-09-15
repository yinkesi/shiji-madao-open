/* 实验史记·春秋笔 —— 主线流程：章节 / 交互 / 晚自习 / 终章 */
'use strict';

/* ================================================================
   【这个文件是干嘛的】
   全游戏的“总指挥”（融合层·流程编排）：把前面所有模块拧在一起，
   负责玩家看得见的每一段流程——开卷选难度开局、世界交互条
   （交谈/赠礼/采访/约战按钮）、主线支线约战入口 Main.onQuest
   （战前先播 pre 剧情，再调 window.SJI_UI.startBattle(cfg) 开战）、
   战斗结算钩子 window.SJI_BATTLE_HOOKS.onResult(b)、打完回世界的
   onDone()（先弹章节里程碑卡 Engine.takePendingChapter()，再播战后
   一幕 Quests.takePendingPost()，两者成对消费不串场）、协会锦标赛
   三连胜、高难试炼、“刀禁期”风险，以及终章（高考·毕业·AI 读史）。

   【架构位置】
   index.html 按固定顺序加载 22 个 <script>，本文件排在最后——
   因为它依赖前面所有人（Engine/World/Dialog/UI/Blades/Quests/
   SJI_UI/Save/Sfx/MG…都是前面文件定义的顶层全局名）。文件之间
   不 import 不 export，全靠“大家共用同一个全局作用域、互相喊名字”
   通信。

   【暴露的全局名】
   对外只暴露一个：const Main（下面 IIFE 返回的对象，含 boot/onQuest/
   challenge/finale/rest 等入口）。另外往 window 挂了一个
   SJI_BATTLE_HOOKS（onResult/onDone），专供战斗层 battle-ui.js 回调。

   【新手阅读提示】
   1) 读懂全项目的钥匙是“一次约战的完整旅程”：
      玩家点「来呀来呀·约战」→ updateCtx 造按钮、challenge(p) 接单
      → knifeBanRiskOk 过刀禁期检查 → Dialog 播战前台词 →
      duelCfg(p) 组装配置 → SJI_UI.startBattle(cfg) 进入战斗覆盖层
      → 引擎打完调 window.SJI_BATTLE_HOOKS.onResult(b) 结算奖励
      → onDone() 回世界（先弹里程碑卡、再播战后一幕）。
      顺着这条线读，整个项目就通了。
   2) 跨文件大坑：顶层 `const X = ...` 不挂 window！所有 <script>
      共享全局词法作用域，裸名 X 跨文件能访问；但查 window.X 得到
      undefined。所以代码里到处是 `window.SJI_SAVE && ...`、
      `typeof X !== 'undefined'` 这类“判活”写法——先确认对方文件
      真的加载了，再动手。
   3) window.G 是有意挂 window 的“全局账本”（战斗层只认 window.G）。
      本文件在开新档/读档时对它整体赋值（G = newGameState() 或读档）。
   4) 战场参数（hpScale 敌方血量倍率 / restFull 波次间回满血 /
      blocked 障碍格 / terrain 地形）必须放进 cfg.stage 子对象，
      战斗引擎只读 cfg.stage，放顶层无效。
   5) Main 是 IIFE（立即执行函数表达式）：(() => { ... })() 定义完
      马上执行一次；return 出去的名字是公开接口，其余函数全封在
      闭包里当私有品——类似 Python 模块里“下划线开头”的约定。
   ================================================================ */
const Main = (() => {
  /* ---------- 存档兼容：补齐马刀行新增字段 ---------- */
  /* 给读进来的旧档“打补丁”：老版本存档缺新字段就补默认值，
     免得后面代码摸到 undefined 报错。`G.wins == null` 用两个等号只判
     null/undefined 两种“没有”——数值 0 能顺利通过，是 JS 判
     “存没存过”的惯用法（若用三个等号连 0 也会被当成“没存过”）。 */
  function normalizeG() {
    if (G.wins == null) G.wins = 0;
    if (G.duelsLost == null) G.duelsLost = 0;
    if (!G.blades) G.blades = { cards: [], equip: null, rare: [] };
    if (!G.blades.rare) G.blades.rare = [];
    if (!G.quests) G.quests = {};
    if (!G.roster || !G.roster.length) G.roster = ['yinkesi'];
    if (!G.trialDone) G.trialDone = {};
    if (!G.duelDone) G.duelDone = {};
    if (!G.flags) G.flags = {};
    if (G.flags.duelBanDays == null) G.flags.duelBanDays = 0;
    if (G.day == null) G.day = 1;
    if (G.periodIdx == null) G.periodIdx = 0;
    /* 老档（有章节进度、但从未接触任务系统）→ 主线九节从头接起，此前进度保留 */
    if (!Object.keys(G.quests).length && G.ch > 0) G.flags.legacyMigrated = true;
    /* 章节达标即解锁世界内容（协会/试炼/生存），老档与新档一视同仁 */
    Engine.syncChapter();
    Engine.syncWorldFlags();
    /* 老档补发：已完成支线对应的身怀之技（一次性静默补齐，toast 汇总） */
    /* window.Quests && ...：先判活再调用——Quests 若没加载，
       短路求值会让整行安静跳过而不是抛 ReferenceError */
    if (window.Quests && Quests.migrateInnates) Quests.migrateInnates();
  }

  /* ---------- 任务：接战 / 完成回流 ---------- */
  /* 主线/支线约战的统一入口——约战旅程的第一站。
     套路是“没走近就先走过去”：离任务点太远就下发走路指令并 return
     （本次调用到此为止），等世界层发现玩家走近了，会再次回调进来。 */
  function onQuest(q) {
    /* 战斗还没打完（BATTLE_ACTIVE 旗子由 battle-ui 开战时立起）不接新单 */
    if (!q || window.BATTLE_ACTIVE) return;
    if (Dialog.active) Dialog.forceFinish();   // 清掉残留对话（战后幕等）
    /* 任务点可能因同场景重叠而错位显示，取显示位置走近 */
    /* some() 是数组的“有没有一个满足”判断（近似 Python 的 any()） */
    const onMap = Quests.markers().some(m => m.q.id === q.id);
    const pos = onMap ? Quests.walkPosOf(q.id) : [q.pos[0], q.pos[1]];
    const [px, py] = World.playerPos;
    /* Math.hypot 按勾股定理算两点直线距离；超过 90 像素算“还没走近” */
    if (Math.hypot(pos[0] - px, pos[1] - py) > 90) { World.walkTo(pos[0], pos[1] + 40); return; }
    const isMain = Quests.current() && Quests.current().id === q.id;
    /* 专属战前剧情；缺数据时退回通用脚本 */
    /* || 在此当“取不到就用备胎” */
    const script = Quests.preScript(q) || Quests.fallbackPre(q, isMain);
    /* Dialog.play 的第二个参数是“播完后的回调”：把接下来要做的事打包成
       函数递过去，剧情播完由 Dialog 调用——JS 编排异步流程的经典手法 */
    Dialog.play(script, () => Quests.pickAndStart(q));
  }

  /* 「任务」面板：主线九节与各条支线渲染成卡片列表。
     el() 是 config.js 提供的造元素小工具：el('div', 'card', html)
     即建一个 class="card"、内容为 html 的 <div>；body 是面板内容容器。 */
  function panelQuests() {
    UI.openPanel('任务 · 马刀行', body => {
      const cur = Quests.current();
      const mul = DIFF_BY_V[Quests.diffV()];
      body.appendChild(el('div', 'card', `<h3>当前难度：${mul.n} <span class="pill gold">赏格 ×${mul.mul}</span></h3>
        <div class="meta">${mul.tip}　·　可在「系统 · 设置」中随时更改</div>`));
      body.appendChild(el('div', 'muted', '<div style="height:10px"></div>主线 · 马刀兴亡史（每节皆高难关卡）：'));
      Quests.mainList().forEach(q => {
        /* q.need 是可选的解锁条件函数：任务没写 need 就默认开放 */
        const done = Quests.done(q.id); const open = q.need ? q.need() : true;
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;opacity:' + (open ? 1 : 0.5);
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${q.name} ${done ? '<span class="pill jade">已成</span>' : cur && cur.id === q.id ? '<span class="pill">进行中</span>' : open ? '' : '<span class="pill gray">未接</span>'}</h3>
          <div class="meta">${q.goal}　·　${q.hint}</div></div>`;
        const b = el('button', 'btn' + (open && !done ? ' btn-primary' : ''), done ? '已成' : '前往');
        b.style.padding = '7px 13px';
        if (done) b.disabled = true;
        /* 关面板 → 必要时切场景 → 等 150ms 再触发 onQuest（给场景切换
           留时间；人还没走到任务点，onQuest 会自己先带路） */
        else b.onclick = () => { UI.closePanel(); const sc = SCENE_BY_ID[q.where]; if (World.sceneId !== q.where) World.travel(q.where); setTimeout(() => onQuest(q), 150); };
        c.appendChild(b);
        body.appendChild(c);
      });
      body.appendChild(el('div', 'muted', '<div style="height:12px"></div>支线 · 满足条件可接（完成即解锁强力人物或永久效果）：'));
      Quests.sideList().forEach(q => {
        /* 支线开放与否由 cond() 现场判定（好感/胜场/记录等条件） */
        const done = Quests.done(q.id); const open = q.cond();
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;opacity:' + (open ? 1 : 0.5);
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${q.name} ${done ? '<span class="pill jade">已成</span>' : open ? '<span class="pill">可接</span>' : '<span class="pill gray">条件未足</span>'}</h3>
          <div class="meta">${q.goal}</div><div class="meta">解锁条件：${open ? '已满足' : (q.condHint || '好感/胜场/记录未足——多走动、多交谈')}</div></div>`;
        const b = el('button', 'btn' + (open && !done ? ' btn-primary' : ''), done ? '已成' : '前往');
        b.style.padding = '7px 13px';
        if (done || !open) b.disabled = true;
        else b.onclick = () => { UI.closePanel(); if (World.sceneId !== q.where) World.travel(q.where); setTimeout(() => onQuest(q), 150); };
        c.appendChild(b);
        body.appendChild(c);
      });
    });
  }

  /* ---------- 马刀：约战 / 结算 ---------- */
  /* 首败即首战：角色 → 马刀风云剧本卷（战前/战胜/战败台词自动接上） */
  const SCENE_OF_CHAR = {
    wanzhen: 's0', dage: 's1', shenren: 's1', xiannv: 's1', hanxiao: 's2',
    shaoming: 's3', xinhui: 's3', shibo: 's4', weirong: 's4', wonder: 's5',
    wenbin: 's5', dazhan: 's6', touge: 's7', luhao: 's8', xiaochuan: 's8',
    guayu: 's9', yiran: 's9', zichen: 's10', guyin: 's11', lifan: 's12',
    limo: 's13', xiangdong: 's13', chongguo: 's14', qinfa: 's14',
    shengxiang: 's15', qiyue: 's15', ziye: 's15', lianqi: 's15',
  };
  /* 特殊战场（据马刀风云原关卡地形） */
  const DUEL_SPECIAL = {
    chongguo: {  // 卷十四 · 终焉之战：校长携钦法，为兵助阵
      enemies: ['qinfa', 'chongguo'], allies: ['weibing'],
      stage: { id: 's14', blocked: [[2, 3], [4, 3]], terrain: 'cabinet', hpScale: 0.78 },
      title: '终焉之战 · 校长室',
    },
  };

  /* 读玩家在设置里选的难度（存放在战斗层自己的存档 window.SJI_SAVE，
     不占用 G）。`(window.SJI_SAVE && SJI_SAVE.settings.lastDiff) || 'normal'`
     一行两层保险：SJI_SAVE 存在才取字段，取不到就兜底 normal。 */
  function duelDiff() {
    const d = (window.SJI_SAVE && SJI_SAVE.settings.lastDiff) || 'normal';
    return ['easy', 'normal', 'hard', 'extreme'].includes(d) ? d : 'normal';
  }

  /* 组装一场约战的配置 cfg（约战旅程的“行李单”）：敌人、难度、AI 攻性
     放顶层；战场参数（hpScale 敌方血量倍率 / restFull 波次回血 /
     blocked 障碍格 / terrain 地形）必须放 cfg.stage 子对象——引擎只读它。
     opts 允许调用方覆盖默认项，`opts || {}` 防止没传时 assign 出错。 */
  function duelCfg(p, opts) {
    Blades.registerChar();
    const id = p.id;
    const sp = DUEL_SPECIAL[id];
    /* first：刀谱里还没有此人的卡 = 从没赢过他 = 首战 */
    const first = !Blades.hasCard(id);
    const cfg = Object.assign({
      mode: 'story',
      title: (p.hao || p.name) + ' · 马刀场',
      playerChar: 'yinkesi',
      enemies: [id],
      allies: [],
      diff: duelDiff(),
      aiAggr: (window.SJI_SAVE && SJI_SAVE.settings.aiAggr) || 'active',
    }, opts || {});
    /* 特殊战场（如终焉之战）整套照抄预设；普通首战则挂上角色所属
       剧本卷的舞台，让开场地形呼应原关卡 */
    if (sp) {
      Object.assign(cfg, { enemies: sp.enemies, allies: sp.allies || [], stage: sp.stage, title: sp.title });
    } else if (first && window.SJI_SCENES) {
      const sid = SCENE_OF_CHAR[id];
      if (sid && SJI_SCENES.stages[sid]) {
        cfg.stage = { id: sid };
        cfg.introScene = SJI_SCENES.stages[sid].intro;
      }
    }
    return cfg;
  }

  /* 刀禁期（G.ch ≥ 12，即主线「刀禁令风波」之后）：楼内约战可能被钦法连人带刀收缴。
     自由开放世界：只与地点有关，不再限时段。 */
  /* onDecide 是“检查通过后再执行”的回调：把“接下来开战”这一步当参数
     传进来，可能被直接放行、可能卷进风险剧情、也可能当场拒绝。 */
  function knifeBanRiskOk(onDecide) {
    if (G.ch < 12) { onDecide(); return; }
    if (G.flags.duelBanDays > 0) { toast(`刀具尚在钦法处（还押 ${G.flags.duelBanDays} 日），约战不得`, '禁'); return; }
    const safe = ['dorm', 'playground', 'gate', 'canteen'].includes(World.sceneId);
    /* 安全场所随便打；其余地点掷骰——Math.random() > 0.25 即 75% 放行 */
    if (safe || Math.random() > 0.25) { onDecide(); return; }
    Dialog.play([
      { who: '钦法', text: '（从走廊尽头逼近）此何课也？尔等围于此，所为何物？' },
      /* 选项里每个 run() 负责掷骰并返回后续旁白 {say:...}；
         Math.random() < 0.55 即 55% 成功率（bad:true 标记坏结局） */
      { choice: [
        { t: '把马刀塞进袖口，佯装晨读', fx: '五五之数', run() {
            if (Math.random() < 0.55) return { say: { who: '旁白', text: '钦法扫了一眼，走了。刀柄上全是手汗。' } };
            G.flags.duelBanDays = 2;
            return { say: { who: '钦法', text: '此何物？马刀也。——缴矣。两日后还汝。' }, bad: true };
        } },
        { t: '称此乃历史教具，正在鉴古', fx: '六五之数', run() {
            if (Math.random() < 0.65) return { say: { who: '旁白', text: '钦法端详片刻：「……善。」——好险，他没认出来。' } };
            G.flags.fineTomorrow = true;
            return { say: { who: '钦法', text: '教具？站到后面去。明日行动点-1。' }, bad: true };
        } },
        { t: '抱起书包就跑', fx: '险中求活', run() {
            if (Math.random() < 0.8) { Engine.addRep(-2); return { say: { who: '旁白', text: '你一路冲进厕所，听见外面脚步声远去。' } }; }
            Engine.addRep(-5); Engine.award('ach_caught');
            G.flags.duelBanDays = 2;
            return { say: { who: '钦法', text: '站住！人赃并获——刀缴两日，通报于电子班牌！' }, bad: true };
        } },
      ] },
    ], () => {
      /* 风险剧情播完才进这个回调：先落存档；刀被缴了这战就黄了，
         否则才放行 onDecide */
      Save.write();
      if (G.flags.duelBanDays > 0) { afterAction(); return; }   // 刀被缴，这一战打不成了
      onDecide();
    });
  }

  /* 世界里「来呀来呀 · 约战」按钮的实现（自由约战，区别于任务战）：
     走近此人 → 播约战台词 → 选战前道具/文笔技 → 刀禁期检查 → 开战。
     一路用回调把“下一步”层层递下去，是回调式流程编排的典型样貌。 */
  function challenge(p) {
    /* 小游戏或战斗还没结束就不受理新约战 */
    if (MG.active || (window.BATTLE_ACTIVE)) return;
    if (Dialog.active) Dialog.forceFinish();   // 清掉残留对话（战后幕等），不再静默失效
    const pos = World.npcPos(p.id);
    if (pos) {
      const [px, py] = World.playerPos;
      if (Math.hypot(pos[0] - px, pos[1] - py) > 80) { World.walkTo(pos[0], pos[1] - 50); return; }
    }
    /* 战斗层的数据表 window.SJI_DATA.CHARACTERS 里没这个人 = 不会马刀 */
    if (!window.SJI_DATA.CHARACTERS[p.id]) { toast('此人不会马刀。', '刀'); return; }
    if ((G.flags.duelBanDays || 0) > 0) { toast(`刀具尚在钦法处（还押 ${G.flags.duelBanDays} 日），约战不得`, '禁'); return; }
    /* p.chat 存在且非空才用作台词池，否则给一句万能台词兜底 */
    const pool = (p.chat && p.chat.length) ? p.chat : ['来呀来呀。'];
    const script = [
      { who: p.hao || p.name, text: pick(pool) },
      { who: '音克思', text: '闲话少叙——马刀场上见真章。来呀来呀！' },
      { who: p.hao || p.name, text: pick(['来呀来呀，重开重开。', '规则至简，而引人入胜。——请。', '活者为王。开刀吧。']) },
    ];
    /* 战前准备：行囊战大道具（一次性）与文笔文斗（骂阵/檄文） */
    const choices = [];
    Object.keys(G.bag).filter(k => G.bag[k] > 0 && Blades.BATTLE_ITEMS[k]).forEach(id => {
      choices.push({
        t: `携「${ITEM_BY_ID[id].name}」入场`, fx: Blades.BATTLE_ITEMS[id].label,
        run() {
          G.bag[id]--; G.flags.duelItem = id; Save.write();
          return { say: { who: '旁白', text: `（${ITEM_BY_ID[id].name}入怀，刀意更稳。）` } };
        },
      });
    });
    if (G.wen >= 10) choices.push({
      t: '骂阵 · 10 文笔', fx: '开战敌方全员 -1 血',
      run() { G.flags.duelWen = 'ma'; Save.write();
        return { say: { who: '旁白', text: '（一纸骂檄先声夺人，对方阵脚未整。）' } }; },
    });
    if (G.wen >= 20) choices.push({
      t: '檄文 · 20 文笔', fx: '本场技能冷却 -1',
      run() { G.flags.duelWen = 'xi'; Save.write();
        return { say: { who: '旁白', text: '（笔扫千军，先声夺人。）' } }; },
    });
    /* 有可选项就把它们连同「空手赴战」兜底项一起，作为选择题插进剧本 */
    if (choices.length) script.push({ choice: choices.concat([{ t: '空手赴战', fx: '来呀来呀', run() { return null; } }]) });
    /* 台词播完 → 刀禁期检查放行 → SJI_UI.startBattle(cfg) 正式开战：
       战斗覆盖层接管画面，打完按约定回调 window.SJI_BATTLE_HOOKS */
    Dialog.play(script, () => {
      knifeBanRiskOk(() => SJI_UI.startBattle(duelCfg(p)));
    });
  }

  /* 战斗结算钩子：奖励 / 录技 / 段位（供 battle-ui 调用） */
  /* 挂到 window 上的“战斗结算钩子”，专供 battle-ui.js 按名回调：
     打完一仗先调 onResult(b)（b 是战斗引擎回传的结果包：胜负/波次/
     统计，以及当初传进去的 cfg），返回的 HTML 附在结算画面上；
     玩家点“回到世界”再调 onDone() 收尾。 */
  window.SJI_BATTLE_HOOKS = {
    onResult(b) {
      const win = b.result === 'win';
      /* 开打前先记下当前段位名，末尾比对，判断这一胜有没有带来晋阶 */
      const rankBefore = Blades.rankName();
      /* extra：攒要显示在结算画面上的 HTML 片段，函数末尾整段返回 */
      let extra = '<div class="result-extra">';
      /* 生存模式：按波次结算 */
      if (b.mode === 'survival') {
        const reached = b.survivalWaveNo || 1;
        const gained = Math.max(0, reached - 1) * 2;
        Engine.addMoney(gained);
        if (reached >= 3) { G.wins++; Engine.addRep(1); }
        if (reached >= 10) Engine.award('ach_surv10');
        extra += `<div>破败城墙，此行抵第 <b>${reached}</b> 波，零花钱 +${gained}。${reached >= 3 ? '计一胜。' : ''}</div>
          <div class="yueks">音克思曰：苔藓覆其上，其高极大以至于不能尽。吾走之其上久——终将尽之。</div>`;
        extra += '</div>';
        Save.write();
        return extra;
      }
      if (win) {
        G.wins++;
        const foes = b.cfg.enemies || [];
        const names = [];
        /* 逐个敌方结算：Blades.grant 把败者之技录进刀谱（fresh=首次录技，
           首录好感加得多），录过的人再胜只加少量好感 */
        foes.forEach(id => {
          const ch = window.SJI_DATA.CHARACTERS[id];
          if (!ch) return;
          names.push(ch.hao);
          const c = Blades.grant(id);
          if (PEOPLE_BY_ID[id]) Engine.addFavorQuiet(id, c.fresh ? 6 : 3);
        });
        Engine.addRep(2); Engine.addMoney(3);
        if (G.rep >= 80) { Engine.addMoney(2); extra += '<div>名望远播：小卖部赊账 +2。</div>'; }
        /* 战斗成就 */
        if (G.wins >= 1) Engine.award('ach_duel1');
        if (G.wins >= 30) Engine.award('ach_duel30');
        if (b.stats.usedBlood) Engine.award('ach_bloodwin');
        if (!b.stats.everLeftWall) Engine.award('ach_wallwin');
        /* 任务：主线/支线完成回流（发赏·解锁·推进） */
        if (b.cfg.questId) {
          const q = Quests.byId(b.cfg.questId);
          if (q && !Quests.done(q.id)) extra += Quests.complete(q);
        }        /* 高难试炼首通：追加稀有刀卡 */
        if (b.cfg.trialId && !G.trialDone[b.cfg.trialId]) {
          const t = trialById(b.cfg.trialId);
          G.trialDone[t.id] = true;
          Blades.grantRare(t.reward);
          Engine.addRep(3); Engine.addMoney(30);
          if (TRIALS.every(x => G.trialDone[x.id])) Engine.award('ach_trial');
          const rw = Blades.RARE_BOONS[t.reward];
          extra += `<div><b>试炼首通！</b>「${t.name}」授稀有刀卡「${rw.name}」：${rw.desc}（每场常驻生效）</div>
            <div>另声望 +3 · 零花钱 +30。</div>`;
        }
        /* 锦标赛收官局（cfg.tournament 标志位）：胜即一次性把三位对手
           之技全录进刀谱、发三连赏、授冠军成就 */
        if (b.cfg.tournament) {
          ['luhao', 'xiaochuan', 'zichen'].forEach(id => Blades.grant(id));
          Engine.addRep(4); Engine.addMoney(10);
          Engine.award('ach_champion');
          extra += `<div><b>锦标赛三连胜！</b>鲁豪、小川、子琛之技尽录刀谱。声望 +4 · 零花钱 +10。</div>
            <div class="yueks">音克思曰：马刀大兴盛，汝今列席协会，与有荣焉。</div>`;
        } else {
          extra += `<div>胜${names.length > 1 ? '众刀手' : '「' + names[0] + '」'}，其名其技录入刀谱。好感与声望各有进益。</div>`;
          /* 段位名和开打前不一样 = 晋阶了（段位只表战绩，无属性加成） */
          const rankNow = Blades.rankName();
          if (rankNow !== rankBefore) {
            toast(`刀道晋阶：「${rankNow}」`, '晋');
            extra += `<div class="yueks">音克思曰：今日封「${rankNow}」。刀是死的，人是活的。</div>`;
          } else {
            extra += `<div class="yueks">音克思曰：规则至简，而引人入胜。${pick(['来呀来呀。', '活者为王。', '重开重开。'])}</div>`;
          }
        }
      } else {
        /* 败仗：记败场、掉对方 1 点好感；若是任务战则把战败后的
           一小段剧情“寄存”起来，等回世界再播（见下面的 onDone） */
        G.duelsLost++;
        const foeId = (b.cfg.enemies || [])[0];
        const ch = foeId && window.SJI_DATA.CHARACTERS[foeId];
        if (foeId && PEOPLE_BY_ID[foeId]) Engine.addFavorQuiet(foeId, -1);
        /* 任务战败：挂起战败后的一段（回世界后播） */
        if (b.cfg.questId) {
          const q = Quests.byId(b.cfg.questId);
          if (q) { Quests.stashPost(q, false); extra += `<div class="muted" style="margin-top:4px">▸ 返回校园后，尚有一幕。</div>`; }
        }
        extra += `<div>败于${ch ? '「' + ch.hao + '」' : '刀下'}。胜负乃兵家常事。</div>
          <div class="yueks">音克思曰：${pick(['重开重开！', '既毕业，无复有刀者，悲哉——故今日之败，不足记也。', '汝倒下了。但史官还站着。'])}</div>`;
      }
      extra += '</div>';
      Save.write();
      return extra;
    },
    /* 战斗收尾、回到世界：afterAction 刷新界面并存档。之后按固定顺序
       “成对消费”两样待办——先取章节里程碑卡、再播战后收束一幕；
       takePending 都是“取走即清空”，取过一次就没有了，不会串场。 */
    onDone() {
      afterAction();
      World.refresh();
      /* 回到世界后：先弹主线里程碑卡（若有），再播战后收束一幕 */
      const playPost = () => {
        const post = Quests.takePendingPost();
        if (!post) return;
        Dialog.play(post, () => { UI.updateHUD(); Quests.render(); Save.write(); });
      };
      /* takePendingChapter 返回待弹的章节号（没有则 null）；有卡就先弹卡，
         把 playPost 挂成“卡片关闭后”的回调——回调套回调，保证先后顺序。
         `!= null` 会同时排除 null 和 undefined 两种“没有”。 */
      const ch = Engine.takePendingChapter();
      if (ch != null && CHAPTERS[ch]) {
        showChapterCard(CHAPTERS[ch], () => {
          UI.updateHUD(); UI.renderHearsay(); Quests.render(); playPost();
        });
      } else playPost();
    },
  };

  /* ---------- 刀谱面板 ---------- */
  /* 「刀谱」面板：称号战绩、身怀之技（支线永久被动）、稀有刀卡
     （试炼首通所授）、已录技列表与换技按钮，每次打开现查现画。 */
  function panelBlades() {
    Blades.registerChar();
    UI.openPanel('刀谱 · 马刀行', body => {
      const w = G.wins || 0;
      const eqId = Blades.equippedSkillId();
      const eqSk = eqId ? Blades.skillCardOf(eqId) : null;
      body.appendChild(el('div', 'card', `
        <h3>称号：${Blades.rankName()} <span class="pill gold">胜 ${w} 场</span>${G.duelsLost ? `<span class="pill gray">败 ${G.duelsLost}</span>` : ''}</h3>
        <div class="meta">称号仅表战绩，无数值加成——成长全凭刀谱之技与身怀之技。</div>
        <div style="height:8px"></div>
        <div class="meta">当前技：${eqSk ? `「${eqSk.name}」——${eqSk.desc}` : '<b style="color:var(--cinnabar)">白板无技</b>——赢下第一场对决，录他一技。'}</div>`));
      /* 身怀之技（支线永久继承的被动，可叠加、无需装备） */
      const inn = Blades.innates();
      if (inn.length) {
        body.appendChild(el('div', 'muted', '<div style="height:12px"></div>身怀之技 · 支线完成永久继承，无需装备常驻生效：'));
        inn.forEach(id => {
          const info = Blades.INNATE_INFO[id];
          if (!info) return;
          const ch = window.SJI_DATA.CHARACTERS[id];
          body.appendChild(el('div', 'card', `<h3 style="margin:0">「${info.name}」<span class="pill jade">常驻</span><span class="pill gray" style="margin-left:5px">承自 ${ch ? ch.hao : id}</span></h3><div class="meta">${info.desc}</div>`));
        });
      }
      /* 稀有刀卡（试炼首通所授） */
      const rares = Blades.rareList();
      if (rares.length) {
        body.appendChild(el('div', 'muted', '<div style="height:12px"></div>稀有刀卡 · 高难试炼首通所授，每场常驻：'));
        rares.forEach(bid => {
          const rw = Blades.RARE_BOONS[bid];
          if (rw) body.appendChild(el('div', 'card', `<h3 style="margin:0">「${rw.name}」<span class="pill">常驻</span></h3><div class="meta">${rw.desc}</div>`));
        });
      }
      /* 录技列表 */
      body.appendChild(el('div', 'muted', '<div style="height:12px"></div>击败马刀手，其技自动录入刀谱。点选可切换出战之技：'));
      const cards = Blades.cards();
      if (!cards.length) {
        body.appendChild(el('div', 'muted', '刀谱尚空。校园里处处是刀手——走近了，说「来呀来呀」。'));
        return;
      }
      cards.forEach(id => {
        const ch = window.SJI_DATA.CHARACTERS[id];
        if (!ch) return;
        const sk = Blades.skillCardOf(id);
        /* 支线获得的身怀被动：追加写在对应角色的卡面上 */
        const innate = Blades.innates().includes(id) ? Blades.INNATE_INFO[id] : null;
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${ch.name} <span class="phao" style="color:var(--cinnabar);font-size:12px">${ch.hao}</span>${innate ? '<span class="pill jade" style="margin-left:5px">身怀</span>' : ''}</h3>
          <div class="meta">${sk ? `「${sk.name}」：${sk.desc}` : '（其技不可录，徒留其名）'}</div>
          ${innate ? `<div class="meta" style="color:var(--jade)">身怀被动「${innate.name}」：${innate.desc}（支线所授，常驻生效）</div>` : ''}</div>`;
        const b = el('button', 'btn' + (eqId === id ? ' btn-primary' : ''), eqId === id ? '出战中' : (sk ? '换此技' : '不可选'));
        b.style.padding = '8px 14px';
        if (!sk || eqId === id) b.disabled = true;
        /* 换技后关面板再重开本面板——用“整个重画一遍”来刷新界面 */
        else b.onclick = () => { Blades.equip(id); toast(`已换技：「${sk.name}」`, '谱'); UI.closePanel(); panelBlades(); };
        c.appendChild(b);
        body.appendChild(c);
      });
    });
  }

  /* ---------- 标题页 ---------- */
  /* 开卷前先择难度：主线皆高难关卡，难度只改敌方强度与赏格，不改剧情 */
  function pickDifficulty() {
    const cur = Quests.diffV();
    UI.openPanel('择难度 · 新的史官', body => {
      body.appendChild(el('div', 'muted', '主线皆高难关卡。难度只改敌方强度与赏格，不改剧情；开卷后仍可在「系统 · 设置」随时更改。'));
      body.appendChild(el('div', '', '<div style="height:10px"></div>'));
      DIFFS.forEach(d => {
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;cursor:pointer';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${d.n}<span class="pill ${d.v === cur ? 'gold' : 'gray'}" style="margin-left:8px">赏格 ×${d.mul}</span></h3>
          <div class="meta">${d.tip}</div></div>`;
        const b = el('button', 'btn' + (d.v === cur ? ' btn-primary' : ''), d.v === cur ? '按此开卷' : '选此');
        b.style.padding = '8px 16px';
        /* stopPropagation()：点了按钮就别让这次点击“冒泡”到整张卡片的
           onclick——否则一次点击会触发两遍开新档 */
        b.onclick = e => { e.stopPropagation(); beginNewGame(d.v); };
        c.appendChild(b);
        c.onclick = () => beginNewGame(d.v);
        body.appendChild(c);
      });
      body.appendChild(el('div', 'muted', '<div style="height:12px"></div>开卷后：世界自由来去；主线指引在右侧任务卡；走近「令」标记即可开战。'));
    });
  }
  /* 开新档：记难度 → 造全新账本并打兼容补丁 → 发“开局”成就并存档 →
     进序章。`G = newGameState()` 是对全局账本 window.G 的整体换新。 */
  function beginNewGame(diffV) {
    if (window.SJI_SAVE && SJI_SAVE.setSetting) SJI_SAVE.setSetting('lastDiff', diffV);
    UI.closePanel();
    Sfx.tap();
    G = newGameState(); normalizeG(); Engine.award('ach_start'); Save.write();
    startChapter(true);
  }

  /* 给标题页三个按钮绑 onclick（“点击就调这个函数”的直白写法）：
     新开卷 / 继续上局 / 粘贴文本导入存档。 */
  function bindTitle() {
    $('#btn-new').onclick = () => { Sfx.tap(); pickDifficulty(); };
    $('#btn-continue').onclick = () => {
      /* 读档 = 从 localStorage 取回账本整体赋给 G（换账本即回到进度），
         再打一遍兼容补丁 */
      const s = Save.read();
      if (!s) { toast('还没有存档'); return; }
      G = s; normalizeG(); Sfx.tap();
      $('#screen-title').classList.add('hidden');
      $('#screen-game').classList.remove('hidden');
      UI.updateHUD();
      World.enter(G.flags.lastScene || 'playground');
      enterPeriod(false);
      toast('继续上局', '史');
      /* 老档迁移提示只弹一次：弹完立刻清掉旗子并存档，下次读档不再弹 */
      if (G.flags.legacyMigrated) {
        G.flags.legacyMigrated = false; Save.write();
        setTimeout(() => toast('旧档已并入刀史：主线九节从头接起，此前的胜场、刀谱与进度皆保留', '迁'), 900);
      }
    };
    $('#btn-import-title').onclick = () => {
      UI.openPanel('导入存档', body => {
        const ta = el('textarea', 'savebox'); ta.placeholder = '粘贴存档文字…';
        body.appendChild(ta);
        const b = el('button', 'btn btn-primary', '导入');
        b.style.marginTop = '8px';
        b.onclick = () => {
          /* try/catch：导入文本不合法时 Save.import 会抛异常，
             这里接住弹个提示，页面不至于直接崩掉 */
          try { Save.import(ta.value); location.reload(); }
          catch (e) { toast('存档格式不对'); }
        };
        body.appendChild(b);
      });
    };
    /* !!（两个非号）把任意值压成 true/false：有存档才显示「继续上局」 */
    const has = !!Save.read();
    $('#btn-continue').classList.toggle('hidden', !has);
  }

  /* ---------- 章节卡 ---------- */
  /* 全屏章节里程碑卡：填内容 → 显示 → 点一下或定时自动关闭。
     fired 旗子保证 done 只跑一次（手动点击与定时器谁先到谁生效）；
     `cb && cb()` 是“有回调才调”的惯用法，卡片关闭后把控制权交回调用方 */
  function showChapterCard(def, cb) {
    const card = $('#chapter-card');
    $('#cc-date').textContent = def.date;
    $('#cc-title').textContent = def.title;
    $('#cc-sub').textContent = def.sub || '';
    card.classList.remove('hidden');
    Sfx.page();
    let fired = false;
    const done = () => {
      if (fired) return; // 点击与自动定时只会生效一次
      fired = true;
      card.classList.add('hidden'); card.onclick = null; cb && cb();
    };
    card.onclick = done;
    setTimeout(done, G.settings.motion === 'off' ? 1200 : 3000);
  }

  /* 从标题页进入游戏：新档直接进序章指引；非新档（如刷新页面续玩）
     先弹章节卡，再落回上次的场景与时段。 */
  function startChapter(isNew) {
    const def = CHAPTERS[G.ch] || CHAPTERS[0];
    $('#screen-title').classList.add('hidden');
    $('#screen-game').classList.remove('hidden');
    UI.updateHUD();
    /* 新档不再走「序章转场卡」——开局即主线：直接落到主线首节所在地，并给指引 */
    if (isNew) {
      World.enter('playground');
      UI.renderPlaces(); UI.renderHearsay(); Quests.render();
      prologue();
      return;
    }
    showChapterCard(def, () => {
      World.enter(G.flags.lastScene || def.scene || 'corridor');
      enterPeriod(true);
    });
  }

  /* ---------- 序章 ---------- */
  /* 新档开场引导：四条操作提示用 setTimeout 错峰弹出（第二个参数是
     毫秒延迟），纯提示不拦操作，最后存一档。 */
  function prologue() {
    toast('点击地面移动 · 走近带「令」的标记，接主线', '引');
    setTimeout(() => toast('右侧任务卡写有当前主线与可接支线 · 点「前往」直达', '令'), 1600);
    setTimeout(() => toast('想动手随时走近任何人：「来呀来呀」约战，胜则录技入刀谱', '刀'), 3400);
    setTimeout(() => toast('世界自由来去，没有时段门禁 · 底部「歇一日」推进日子', '游'), 5200);
    Save.write();
  }

  /* ---------- 日子流转（自由世界：随时可歇，不再是「下一时段」） ---------- */
  /* 进入/刷新时段：把 HUD、地点、传闻、任务、世界全部重画一遍，
     并清空交互条（updateCtx(null)）。changed=true 时顺带报一声日期 */
  function enterPeriod(changed) {
    UI.updateHUD();
    UI.renderPlaces();
    UI.renderHearsay();
    Quests.render();
    World.refresh();
    updateCtx(null);
    if (changed) toast(Engine.dateLabel(), '日');
  }
  /* 歇一日：写日记 / 夜谈 / 直接睡 —— 全都免费，行动点不再门控探索 */
  function rest() {
    /* 对话/小游戏/战斗/面板任一开着都直接忽略，防状态错乱 */
    if (Dialog.active || MG.active || window.BATTLE_ACTIVE || UI.panelOpen) return;
    Dialog.play([
      { who: '旁白', text: `一日将尽（${Engine.dateLabel()}）。` },
      { choice: [
        { t: '写日记 · 文笔 +3', fx: '史官日课', run() {
            Engine.addWen(3);
            return { say: { who: '旁白', text: '今日所见尽落纸上。文笔 +3。' } };
        } },
        { t: '找人夜谈 · 好感 +2', fx: '卧谈会', run() {
            const met = G.flags.metPeople.filter(id => PEOPLE_BY_ID[id]);
            if (met.length) {
              const id = pick(met);
              Engine.addFavorQuiet(id, 2);
              const p = PEOPLE_BY_ID[id];
              return { say: { who: '旁白', text: `熄灯后的卧谈会。话题绕到了${p.name}——你听了些新的传闻，好感 +2。` } };
            }
            return { say: { who: '旁白', text: '宿舍里没人开口。你听着风扇声睡着了。' } };
        } },
        { t: '早些睡', fx: '养神', run() {
            return { say: { who: '旁白', text: '你早早睡了。明天仍是自由的一天。' } };
        } },
      ] },
    ], () => {
      Engine.nextDay();
      UI.updateHUD(); UI.renderPlaces(); UI.renderHearsay(); World.refresh(); Quests.render(); Save.write();
      toast(Engine.dateLabel(), '日');
    });
  }

  /* ---------- 交互条 ---------- */
  /* 世界交互条（屏幕下缘按钮条）的唯一绘制者：世界层在“玩家眼前是什么”
     变化时回调它，参数 near 描述眼前对象。按 near.type 分四种画法：
     任务开战 / NPC（交谈·赠礼·采访·约战）/ 名场面 / 门；末尾再补上
     场景专属动作。每次先 innerHTML 清空、从零重画。 */
  function updateCtx(near) {
    const bar = $('#ctxbar');
    bar.innerHTML = '';
    bar.classList.add('hidden');
    if (Dialog.active || MG.active) return;
    /* 场景特有动作（入景即可用，无需贴近谁） */
    const hasSceneAct = World.sceneId === 'library' || World.sceneId === 'shop' || World.sceneId === 'pingpong'
      || World.sceneId === 'playground'
      || World.sceneId === 'classroom6' || World.sceneId === 'classroom7';
    if (!near && !hasSceneAct) return;
    if (near) bar.classList.remove('hidden');
    if (near && near.type === 'quest') {
      bar.classList.remove('hidden');
      const q = near.q;
      bar.appendChild(el('span', 'ctx-name', (near.main ? '【主线】' : '【支线】') + q.name));
      const b = el('button', 'ctx-btn duel', '开战 · ' + (q.cfg.enemies || []).map(id => (window.SJI_DATA.CHARACTERS[id] || {}).hao || id).join('·'));
      b.onclick = () => onQuest(q);
      bar.appendChild(b);
    } else if (near && near.type === 'npc') {
      const p = near.p;
      const fav = Engine.favorOf(p.id);
      const head = el('span', 'ctx-name', p.hao || p.name);
      bar.appendChild(head);
      bar.appendChild(el('span', 'ctx-sub', `好感 ${fav}`));
      // 交谈
      const chatBtn = el('button', 'ctx-btn', '交谈');
      chatBtn.onclick = () => chat(p);
      bar.appendChild(chatBtn);
      // 赠礼
      /* 每人每天限赠一次：今天赠过就换成“已赠”文案并禁用按钮 */
      const giftBtn = el('button', 'ctx-btn', G.giftToday[p.id] ? '已赠' : '赠礼');
      if (G.giftToday[p.id]) giftBtn.disabled = true;
      giftBtn.onclick = () => giftPick(p);
      bar.appendChild(giftBtn);
      // 采访
      if (p.interview) {
        /* 采访门槛：角色可自定义好感需求（ivNeed），没写默认 30 */
        const need = p.ivNeed != null ? p.ivNeed : 30;
        const ok = fav >= need && !Engine.hasShard(p.interview.give);
        const iv = el('button', 'ctx-btn' + (ok ? ' accent' : ''), ok ? '采访' : fav >= need ? '已采' : `采访 需好感${need}`);
        if (!ok) iv.disabled = true;
        iv.onclick = () => interview(p);
        bar.appendChild(iv);
      }
      // 约战（会马刀的人）
      if (window.SJI_DATA && SJI_DATA.CHARACTERS[p.id]) {
        const duelBtn = el('button', 'ctx-btn duel', '来呀来呀 · 约战');
        duelBtn.onclick = () => challenge(p);
        bar.appendChild(duelBtn);
      }
    } else if (near && near.type === 'event') {
      bar.appendChild(el('span', 'ctx-name', '「' + near.ev.name + '」'));
      const b = el('button', 'ctx-btn accent', '旁观亲历');
      b.onclick = () => playEvent(near.ev);
      bar.appendChild(b);
    } else if (near && near.type === 'door') {
      const b = el('button', 'ctx-btn', '进入 · ' + near.door.label);
      b.onclick = () => World.travel(near.door.to);
      bar.appendChild(b);
    }
    // 场景特有动作（入景即可用，无需贴近谁）
    if (hasSceneAct) bar.classList.remove('hidden');
    if (World.sceneId === 'library') {
      const b = el('button', 'ctx-btn', '读书 → 文笔+4');
      b.onclick = () => {
        Engine.addWen(4); G.stats.reads++; Sfx.good();
        toast('读罢掩卷，文笔 +4', '文');
        if (Math.random() < 0.3) toast('（文言书看起来就是很上头）');
        Save.write();
      };
      bar.appendChild(b);
    }
    if (World.sceneId === 'classroom6' || World.sceneId === 'classroom7') {
      const b = el('button', 'ctx-btn', '听课 → 文笔+2');
      b.onclick = () => listenClass();
      bar.appendChild(b);
    }
    if (World.sceneId === 'shop') {
      const b = el('button', 'ctx-btn accent', '进店购物');
      b.onclick = () => UI.panelShop();
      bar.appendChild(b);
    }
    /* 操场三件套（锦标赛/试炼/生存）：主线推到协会开张才点亮 */
    if (World.sceneId === 'playground' && G.ch >= 8) {
      const clubOn = !!G.flags.xiehui;
      const t = el('button', 'ctx-btn' + (clubOn ? ' duel' : ''), clubOn ? '协会锦标赛' : '协会未立（推进主线至协会开张）');
      if (!clubOn) t.disabled = true;
      else t.onclick = () => startTournament();
      bar.appendChild(t);
      const tr = el('button', 'ctx-btn' + (clubOn ? ' duel' : ''), clubOn ? '高难试炼' : '试炼未开');
      if (!clubOn) tr.disabled = true;
      else tr.onclick = () => panelTrial();
      bar.appendChild(tr);
      const s = el('button', 'ctx-btn' + (clubOn ? ' duel' : ''), clubOn ? '破败城墙 · 生存' : '生存未开');
      if (!clubOn) s.disabled = true;
      else s.onclick = () => startSurvival();
      bar.appendChild(s);
    }
    if (World.sceneId === 'pingpong') {
      const b = el('button', 'ctx-btn', '打乒乓球');
      b.onclick = () => {
        /* MG.launch(游戏名, 结束回调)：小游戏玩完把输赢经 ok 传回来 */
        MG.launch('pingpong', ok => {
          if (ok) {
            Engine.award('ach_pp'); Engine.addWen(2); Engine.addMoney(5);
            if (!Engine.hasShard('sh_pingpong')) Engine.grantShard('sh_pingpong', 'scene');
            afterAction();
          } else { toast('差两板……再来一局？'); afterAction(); }
        });
      };
      bar.appendChild(b);
    }
  }

  /* ---------- 马刀协会：锦标赛与生存（操场 · 协会立后开放） ---------- */
  /* 协会锦标赛：waves 列出三波对手（鲁豪→小川→子琛），连赢三场才算
     夺冠；restFull=true 波次间回满血，hpScale 压低敌方血量让连战不磨。
     tournament 标志位专供结算钩子发三连赏。 */
  function startTournament() {
    if (!window.SJI_SCENES) return;
    const st = SJI_SCENES.stages.s8;
    SJI_UI.startBattle({
      mode: 'story', tournament: true,
      title: '世界马刀协会 · 锦标赛', playerChar: 'yinkesi',
      enemies: ['luhao'], waves: [['luhao'], ['xiaochuan'], ['zichen']],
      allies: [], diff: duelDiff(), aiAggr: 'active',
      stage: { id: 's8', hpScale: 0.68, restFull: true },
      introScene: st.intro,
    });
  }
  /* 生存模式：不给敌人名单（引擎自己按波刷怪），结算按撑过的波次给赏 */
  function startSurvival() {
    SJI_UI.startBattle({
      mode: 'survival', title: '破败城墙 · 生存', playerChar: 'yinkesi',
      diff: duelDiff(), aiAggr: 'active',
    });
  }

  /* ---------- 高难试炼：随剧情渐次解锁，各有特则，首通授稀有刀卡 ---------- */
  /* 六场高难试炼的“菜单”（IIFE 内的私有数据，外界只能走 startTrial/
     panelTrial/trialById 这几个出口访问）。每场带：解锁条件 ok()——
     是函数不是布尔，每次开面板都现算；战斗配置 cfg（战场参数照例放
     cfg.stage，rule 是本关特则）；首通奖励 reward（稀有刀卡 id）。 */
  const TRIALS = [
    { id: 't_yundonghui', name: '运动会 · 不怒自威', stars: 2,
      cond: '卷三后，且已胜绍铭', ok: () => G.ch >= 3 && Blades.hasCard('shaoming'),
      desc: '级部榜上前茅的绍铭：血厚一层，半血之下刀刀致命。',
      cfg: { enemies: ['shaoming'], stage: { id: 's3b', hpScale: 1.3, blocked: [[1, 2], [1, 4], [5, 2], [5, 4]], terrain: 'cabinet' },
             rule: { id: 'cans', desc: '看台飞瓶：与绍铭同行或同列，回合开始即被饮料瓶砸中 1 血——走位，别站在他的线上。' } },
      reward: 'b_firststrike' },
    { id: 't_sushe', name: '宿舍之夜 · 双臭临门', stars: 2,
      cond: '卷七后，且已胜头哥', ok: () => G.ch >= 7 && Blades.hasCard('touge'),
      desc: '头哥与神人同宿舍：溴味与臭袜齐飞，汝被锁在中间。',
      cfg: { enemies: ['touge', 'shenren'], stage: { id: 's7b' },
             rule: { id: 'stench', desc: '鲍鱼之肆：回合结束，所有相邻的敌我互相腐蚀，各损 1 血——贴身即换血，远程为王。' } },
      reward: 'b_shield' },
    { id: 't_liankao', name: '九省联考 · 牛刀小试', stars: 3,
      cond: '卷九后，已胜 wonder，且见证过「马刀神的试炼」', ok: () => G.ch >= 9 && Blades.hasCard('wonder') && G.flags.wonderTrial,
      desc: 'wonder 以牛顿定理破第十八题——你就是那道题。血厚五成，强制困难。',
      cfg: { enemies: ['wonder'], diff: 'hard', stage: { id: 's5b', hpScale: 1.5, blocked: [[3, 1], [3, 5]], terrain: 'table' },
             rule: { id: 'yansuan', desc: '验算：回合结束，wonder 血量为偶数则回复 1 血——算好伤害，把他打成奇数。' } },
      reward: 'b_bloodfree' },
    { id: 't_jinbi', name: '禁闭室 · 疯法同囚', stars: 3,
      cond: '卷十二后，且已胜李帆', ok: () => G.ch >= 12 && Blades.hasCard('lifan'),
      desc: '禁闭室狭小，李疯购刀免动，主任当场抓获——同囚即死斗。',
      cfg: { enemies: ['lifan', 'qinfa'], stage: { id: 's12b', blocked: [[3, 3]], terrain: 'cabinet' },
             rule: { id: 'suomen', desc: '锁门：禁闭室无墙可踢，双方马踢不可用——纯刀技的近身缠斗。' } },
      reward: 'b_killheal' },
    { id: 't_xunzheng', name: '二楼巡征 · 羚羊', stars: 3,
      cond: '卷十三后，且已胜李默', ok: () => G.ch >= 13 && Blades.hasCard('limo'),
      desc: '巡征的李默步幅极大、争食自愈，且已磨刀霍霍（血厚四成）。',
      cfg: { enemies: ['limo'], stage: { id: 's13b', hpScale: 1.4 },
             rule: { id: 'zhengshi', desc: '争食：场上三份饭，回合结束站在饭上者回复 2 血，每份一次——抢饭，或断他饭路。' } },
      reward: 'b_cleave' },
    { id: 't_zhongyan', name: '终焉 · 本纪重演', stars: 4,
      cond: '已在成传之战胜过校长', ok: () => Blades.hasCard('chongguo'),
      desc: '再入校长室：崇国弃车保帅、钦法环伺——强制困难。',
      cfg: { enemies: ['qinfa', 'chongguo'], allies: ['weibing'], diff: 'hard', stage: { id: 's14', blocked: [[2, 3], [4, 3]], terrain: 'cabinet' },
             rule: { id: 'zhongshu', desc: '种树不绝：每回合开始，崇国自动种树一株（至多三株）——树木堵路，亦是你的回血口粮。' } },
      reward: 'b_horsereach' },
  ];

  function trialById(id) { return TRIALS.find(t => t.id === id); }

  /* 开一场试炼：先核验解锁条件，再合成配置开战 */
  function startTrial(id) {
    const t = trialById(id);
    if (!t) return;
    if (!t.ok()) { toast('试炼未开：' + t.cond, '禁'); return; }
    Blades.registerChar();
    /* 三层 Object.assign 合并：基础配置 ← 试炼 cfg ←（若试炼强制难度）
       diff——越靠后的键越优先（后者覆盖前者） */
    SJI_UI.startBattle(Object.assign({
      mode: 'story', trialId: id,
      title: '高难试炼 · ' + t.name, playerChar: 'yinkesi',
      allies: [], diff: duelDiff(), aiAggr: 'active',
    }, t.cfg, t.cfg.diff ? { diff: t.cfg.diff } : {}));
  }

  /* 试炼面板：逐场列出星级/特则/解锁条件/首通赏；已首通的可无限再战 */
  function panelTrial() {
    Blades.registerChar();
    UI.openPanel('协会试炼 · 高难关卡', body => {
      const cleared = TRIALS.filter(t => G.trialDone[t.id]).length;
      body.appendChild(el('div', 'card', `
        <h3>据卷八《马刀书》：马刀之消，似于高中之时光也</h3>
        <div class="meta">试炼随剧情渐次解锁。首通授「稀有刀卡」一场常驻；再打无赏，纯为切磋。已首通 ${cleared}/${TRIALS.length}。</div>`));
      TRIALS.forEach(t => {
        const done = !!G.trialDone[t.id];
        const open = t.ok();
        const rw = Blades.RARE_BOONS[t.reward];
        const rule = t.cfg.rule;
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;opacity:' + (open ? 1 : 0.55);
        c.innerHTML = `<div style="flex:1;min-width:0"><h3 style="margin:0">${t.name} <span class="pill gold">${'★'.repeat(t.stars)}</span>${done ? '<span class="pill jade">已首通</span>' : open ? '<span class="pill">可挑战</span>' : '<span class="pill gray">未解锁</span>'}</h3>
          <div class="meta">${t.desc}</div>
          ${rule ? `<div class="meta" style="color:var(--cinnabar)"><b>〔特则〕</b>${rule.desc}</div>` : ''}
          <div class="meta">解锁：${t.cond}　·　首通赏：稀有刀卡「${rw.name}」——${rw.desc}</div></div>`;
        const b = el('button', 'btn' + (open ? ' btn-primary' : ''), done ? '再战' : open ? '挑战' : '未解锁');
        b.style.padding = '8px 14px';
        if (!open) b.disabled = true;
        else b.onclick = () => { UI.closePanel(); startTrial(t.id); };
        c.appendChild(b);
        body.appendChild(c);
      });
    });
  }

  /* “做完一件事”的统一收尾：刷新 HUD/传闻/世界/任务并存档。
     全文件十几处调用——一个集中收银台，免得每个动作重复这串 */
  function afterAction() {
    UI.updateHUD(); UI.renderHearsay(); World.refresh(); Quests.render(); Save.write();
  }

  /* ---------- 行为 ---------- */
  /* 交谈：每天头两句免费，之后要花 1 行动点；首次聊天记入“已结识”。
     加完好感还有 riskCheck——上课时间闲聊可能被巡查逮住
     （Engine.caughtPlay 播被抓剧情并接管后续） */
  function chat(p) {
    if (G.chatCount >= 2 && !Engine.spendAP(1)) return;
    G.chatCount++;
    G.stats.chats++;
    if (!G.flags.metPeople.includes(p.id)) { G.flags.metPeople.push(p.id); toast(`结识「${p.name}${p.hao ? ' · ' + p.hao : ''}」`, '识'); }
    const first = G.stats.chats === 1;
    const line = pick(first ? p.greet.concat(p.chat) : p.chat);
    Engine.addFavor(p.id, 1);
    if (Engine.riskCheck()) { Engine.caughtPlay(() => afterAction()); return; }
    Dialog.play([{ who: p.hao || p.name, text: line }], afterAction);
  }
  /* 赠礼选物面板：列出行囊物品并标注对方喜好；行囊空则直接带去商店 */
  function giftPick(p) {
    const ids = Object.keys(G.bag).filter(k => G.bag[k] > 0);
    if (!ids.length) { toast('行囊空空——去小卖部买点礼物', '囊'); UI.panelShop(); return; }
    UI.openPanel(`赠礼予 ${p.hao || p.name}`, body => {
      body.appendChild(el('div', 'muted', '投其所好，好感大涨。每人每天可赠一次。'));
      body.appendChild(el('div', '', '<div style="height:8px"></div>'));
      ids.forEach(id => {
        const it = ITEM_BY_ID[id];
        const love = p.loves && p.loves.includes(id), like = p.likes && p.likes.includes(id);
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;cursor:pointer';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${it.name} <span class="pill gray">×${G.bag[id]}</span>${love ? '<span class="pill">心头好</span>' : like ? '<span class="pill jade">会喜欢</span>' : ''}</h3><div class="meta">${it.desc}</div></div>`;
        const b = el('button', 'btn btn-primary', '赠');
        b.onclick = e => { e.stopPropagation(); doGift(p, id); };
        c.appendChild(b);
        body.appendChild(c);
      });
    });
  }
  /* 真正送礼：扣库存、记“今日已赠”，按心头好 12 / 喜欢 6 / 普通 2 加好感 */
  function doGift(p, id) {
    G.bag[id]--;
    G.giftToday[p.id] = 1;
    G.stats.gifts++;
    const love = p.loves && p.loves.includes(id), like = p.likes && p.likes.includes(id);
    const n = love ? 12 : like ? 6 : 2;
    Engine.addFavor(p.id, n);
    if (love) Sfx.unlock(); else Sfx.good();
    /* 顺手查两个条件型成就：特定人物好感满 100、零花钱达标 */
    if (p.id === 'keyi' && Engine.favorOf(p.id) >= 100) Engine.award('ach_sugar');
    if (G.money >= 40) Engine.award('ach_rich');
    UI.closePanel();
    Dialog.play([{ who: p.hao || p.name, text: love ? `（眼睛一亮）此物……汝如何知吾所好？善！大善！` : like ? '（收下，端详片刻）有心了。' : '（收下）……多谢。' }], afterAction);
  }
  /* 采访：花 1 行动点，白得一份史料碎片外加 5 好感，再播采访剧本 */
  function interview(p) {
    if (!Engine.spendAP(1)) return;
    Engine.grantShard(p.interview.give, 'interview');
    Engine.addFavor(p.id, 5);
    Dialog.play(p.interview.script, afterAction);
  }
  /* 旁观名场面：播完剧本记入 doneEvents（防重复），按剧本配置开新地点/
     发史料/给当事人加好感/发成就。mgStep 是剧本里夹的小游戏步骤，
     _mgResult 是 dialog.js 玩完后写回该步骤对象的输赢记录。 */
  function playEvent(ev) {
    Dialog.play(ev.script, () => {
      G.doneEvents.push(ev.id);
      if (ev.flag) { G.flags[ev.flag] = true; toast('新去处已开：' + ev.name, '开'); }
      // 亲历其事，当事人好感微增（不打扰，合并一条提示）
      if (ev.cast && ev.cast.length) {
        ev.cast.forEach(id => PEOPLE_BY_ID[id] && Engine.addFavorQuiet(id, 2));
        toast('亲历名场面，当事诸人好感 +2', '记');
      }
      if (ev.id === 'ev_shuban') Engine.award('ach_shuban');
      const mgStep = ev.script.find(s => s.mg);
      const mgOk = mgStep ? mgStep._mgResult !== false : true;
      if (ev.shard) {
        if (mgStep && !mgOk) { Engine.grantShard(ev.shard, 'gossip'); toast('过程有波折，但史料还是到手了'); }
        else Engine.grantShard(ev.shard, 'scene');
      }
      if (mgStep && mgOk) {
        if (ev.mg === 'late') Engine.award('ach_109');
        if (ev.mg === 'spin') Engine.award('ach_spin');
        if (ev.mg === 'canteen') Engine.award('ach_lingyang');
      }
      if (Engine.riskCheck()) { Engine.caughtPlay(() => afterAction()); return; }
      afterAction();
    });
  }
  /* 听课：花 1 行动点换 2 文笔；22% 概率触发课堂插曲——被老师点名，
     举手答对加声望、答错掉声望、低头装笔记稳过（一道选择题） */
  function listenClass() {
    if (!Engine.spendAP(1)) return;
    Engine.addWen(2); G.stats.listened++;
    if (G.stats.listened >= 10) Engine.award('ach_listen');
    if (Math.random() < 0.22) {
      const t = World.sceneId === 'classroom6'
        ? ['zouyu', 'shibo', 'weirong'] : ['shenren', 'xiannv', 'touge'];
      const who = pick(t);
      Dialog.play([
        { who: PEOPLE_BY_ID[who].name, text: pick(['此题选A者乃神人也！', '尔来答之。', '奇彪无比！', '找交线——找垂线！']) },
        { choice: [
          { t:'举手作答', fx:'七成之数', run() {
              if (Math.random() < 0.7) { Engine.addRep(2); return { say:{who:'旁白',text:'答毕，满座称善。声望 +2'} }; }
              Engine.addRep(-1); return { say:{who:'旁白',text:'答错，哄堂大笑。'}, bad:true };
          } },
          { t:'低头装笔记', fx:'稳', run() { return { say:{who:'旁白',text:'你埋头猛写，笔走龙蛇——其实画的是史料框架。'} }; } },
        ] },
      ], afterAction);
      return;
    }
    toast('听课认真，文笔 +2', '文');
    afterAction();
  }
  /* 世界层每当“玩家眼前是什么”变化就回调 onCtxChange，转手交给
     updateCtx 重画交互条 */
  /* ---------- 世界回调 ---------- */  function onCtxChange(near) { updateCtx(near); }
  /* 点击 NPC：太远就先走过去（onQuest 同款套路），走近了才弹交互条 */
  function onNPC(p) {
    if (Dialog.active || MG.active) return;
    const pos = World.npcPos(p.id);
    if (pos) {
      const [px, py] = World.playerPos;
      if (Math.hypot(pos[0] - px, pos[1] - py) > 80) { World.walkTo(pos[0], pos[1] - 50); return; }
    }
    updateCtx({ type:'npc', p });
  }
  /* 点击名场面标记：同样“先走近再触发” */
  function onEvent(ev) {
    if (Dialog.active || MG.active) return;
    const [px, py] = World.playerPos;
    if (Math.hypot(ev.pos[0] - px, ev.pos[1] - py) > 80) { World.walkTo(ev.pos[0], ev.pos[1] + 30); return; }
    playEvent(ev);
  }
  /* 对话播完的收尾（清单与 afterAction 相同），单列一份作为对外出口 */
  function afterDialog() { UI.updateHUD(); UI.renderHearsay(); World.refresh(); Quests.render(); Save.write(); }

  /* ---------- 终章：高考 · 毕业 · AI ---------- */
  /* 终章入口（主线推到顶时由任务层调用）：先弹“高考”章节卡，再进校门
     场景播最后一幕；中间给玩家一道选择（记心里+声望 / 做卷子+文笔），
     播完接 graduation() */
  function finale() {
    showChapterCard(CHAPTERS[16], () => {
      World.enter('gate');
      UI.updateHUD();
      Dialog.play([
        { who:'旁白', text:'六月七日。考场。你一抬眼——歆慧就坐在斜前方，大哥在她左后方。' },
        { who:'大哥', text:'（见之心善，探身）歆慧，汝亦在此。' },
        { who:'歆慧', text:'滚。' },
        { who:'旁白', text:'大哥于是遂走。开考铃响。' },
        { choice: [
          { t:'把这一幕原样记进心里', fx:'史官本能', rep:1, run(){ return { say:{who:'旁白',text:'你要让这一幕活过这个夏天。'} }; } },
          { t:'专心做卷子', fx:'考生本分', wen:2, run(){ return { say:{who:'旁白',text:'笔下如有神——这一场，你超常发挥。'} }; } },
        ] },
        { who:'旁白', text:'两日笔落如刀，收卷如史官封笔。后来听说，大哥托俊玥传了话，又亲口对歆慧说了三个字，歆慧对曰：善。' },
        { who:'旁白', text:'你忽然想起大哥的话：城墙者，高考也。你们都走完了那面墙。' },
      ], () => graduation());
    });
  }
  /* 毕业去向：本传+外传人物全列一遍——写过的给结局文案，没写过的
     只有一行遗憾。concat 把两个数组拼成一个新数组 */
  function graduation() {
    const all = PEOPLE.concat(PEOPLE_WAI);
    UI.openPanel('毕业 · 诸君去向', body => {
      body.appendChild(el('div', 'muted', '卷里卷外，皆是少年。你写下的每一个人，都有了自己的远方。'));
      body.appendChild(el('div', '', '<div style="height:10px"></div>'));
      all.forEach(p => {
        const met = G.flags.metPeople.includes(p.id) || (p.vol && G.vols[p.vol]);
        const c = el('div', 'card');
        c.style.marginBottom = '8px';
        c.innerHTML = `<h3 style="margin:0">${p.name} <span class="phao" style="color:var(--cinnabar);font-size:12.5px">${p.hao || ''}</span></h3>
          <div class="meta">${met ? p.out || '' : '（你在史书里没来得及写他/她。）'}</div>`;
        body.appendChild(c);
      });
      const b = el('button', 'btn btn-primary', '一年后……');
      b.style.cssText = 'width:100%;margin-top:12px;padding:14px';
      b.onclick = () => { UI.closePanel(); aiEpilogue(); };
      body.appendChild(b);
    });
  }
  /* 真结局“一年后 · AI 读史”：统计立传卷数、笔风直曲、平均好感、马刀
     战绩，拼成一篇 AI 读后感，并按立传数与声望授予最终称号 */
  function aiEpilogue() {
    Engine.award('ach_ai');
    const pub = Object.keys(G.vols).length;
    /* reduce 是数组的“滚雪球”汇总（近似 Python 的 sum）：把各卷评分
       累加起来再除以卷数，得平均分 */
    const avg = pub ? Object.values(G.vols).reduce((a, b) => a + b.grade, 0) / pub : 0;
    let title = '残卷 · 史未成而人已散';
    if (pub >= 6) title = '史官 · 有所记，有所失';
    if (pub >= 10) title = '良史 · 秉笔直书，温润如玉';
    if (pub >= 15) title = G.rep >= 60 ? '太史公 · 究天人之际，通古今之变' : '太史公（孤本）· 书成而友尽？';
    /* 笔风判定：直笔远多于曲笔是“峻直”，反之“敦厚”，势均力敌则“直曲相济” */
    const styleLine = G.stats.direct > G.stats.curve * 2 ? '峻直' : G.stats.curve > G.stats.direct * 2 ? '敦厚' : '直曲相济';
    // 已立传诸人的平均好感
    const castIds = new Set();
    Object.keys(G.vols).forEach(no => VOL_BY_NO[no].cast.forEach(id => castIds.add(id)));
    const favAvg = castIds.size ? Math.round([...castIds].reduce((a, id) => a + Engine.favorOf(id), 0) / castIds.size) : 0;
    // 马刀行结局变体
    /* 马刀行结局素材：零胜是“全书不提马刀”的文人局，30+ 胜则逼近“马刀之神” */
    const wins = G.wins || 0, cards = (G.blades && G.blades.cards || []).length;
    /* typeof Blades !== 'undefined'：跨文件判活惯用法——顶层 const 不挂
       window，裸名跨文件可用，但用前先探一探它是否存在 */
    const rank = (typeof Blades !== 'undefined' && Blades.rankName()) || '未入册';
    let bladePara;
    if (wins === 0) bladePara = '「全书几乎不提马刀。你站在刀场边上，把笔墨都留给了人。」';
    else if (wins >= 30) bladePara = `「另外——你的刀谱录了 ${cards} 人之技，生平 ${wins} 胜，封『${rank}』。马刀之神与你，只差一个名分。」`;
    else bladePara = `「另外——你放不下的还有那把马刀。刀谱录 ${cards} 人之技，生平 ${wins} 胜，位至『${rank}』。」`;
    const bladeTail = wins > 0
      ? '<p style="font-size:14px;line-height:1.9">「卷八有云：既毕业，无复有刀者，悲哉。但你把它一笔一笔写进了书里——写进书里的刀，就不会消。」</p>'
      : '';
    UI.openPanel('一年后 · AI 读史', body => {
      const card = el('div', 'card');
      card.style.fontFamily = 'var(--font-ui)';
      card.innerHTML = `
        <h3 style="font-size:18px">你把《实验史记》喂给了一个 AI。</h3>
        <div class="muted" style="margin-bottom:10px">——序云：「我想看看史记到底能不能看出我。」</div>
        <p style="font-size:14px;line-height:1.9">AI 读完了。它说：</p>
        <p style="font-size:14px;line-height:1.9">「全书立传 <b>${pub}/15</b> 卷，笔风<b>${styleLine}</b>（直笔 ${G.stats.direct} 处，曲笔 ${G.stats.curve} 处）。</p>
        <p style="font-size:14px;line-height:1.9">「书中诸人的平均好感 ${favAvg}/100，你在班中的声望 ${G.rep}/100——${G.rep >= 60 ? '你写作时显然没有失去太多朋友，这很了不起。' : '史官从来不好当，你得罪了一些人，但你没有删掉一个字。'}</p>
        <p style="font-size:14px;line-height:1.9">「最打动我的是：${pick(['你记录他们时，从未居高临下。', '你把小事故写成了大历史，又把大历史写得像小事。', '书里没有反派，只有没来得及好好说话的少年。'])}。</p>
        <p style="font-size:14px;line-height:1.9">「通过一个人的文字，真的能看出一个人的大部分。」</p>
        ${bladePara}${bladeTail}
        <div style="text-align:center;margin:18px 0 4px">
          <div style="font-family:var(--font-cl);font-size:30px;font-weight:900;color:var(--cinnabar)">${title}</div>
        </div>
        <button class="btn btn-primary" style="width:100%;padding:14px" id="btn-replay">重开重开</button>`;
      body.appendChild(card);
      $('#btn-replay').onclick = () => { Save.clear(); location.reload(); };
    });
    Sfx.unlock();
  }

  /* ---------- 菜单面板 ---------- */
  /* 系统面板：六个子面板入口排成两列网格（cssText 直接写行内样式） */
  function menuPanel() {
    UI.openPanel('系统', body => {
      const row = el('div', '');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px';
      [['任务 · 马刀行', () => panelQuests()], ['图鉴 · 史中人', () => UI.panelCodex()], ['刀谱 · 马刀行', () => panelBlades()], ['成就', () => UI.panelAch()],
       ['行囊', () => UI.panelBag()], ['设置 · 存档', () => UI.panelSettings()]].forEach(([t, fn]) => {
        const b = el('button', 'btn', t);
        b.onclick = fn;
        row.appendChild(b);
      });
      body.appendChild(row);
      body.appendChild(el('div', 'card', `<h3>操作</h3><div class="meta">点击地面移动 / 点击人物交谈 / 走近「记」旁观名场面。底部按钮可直达各处。误触不怕——没有不可撤销的损失。</div>`));
    });
  }

  /* ---------- 全局按钮 ---------- */
  /* 给 HUD 上四个常驻按钮（史书/刀谱/行囊/系统）绑回调 */
  function bindHUD() {
    $('#btn-hud-book').onclick = () => UI.panelBook();
    $('#btn-hud-blade').onclick = () => panelBlades();
    $('#btn-bag').onclick = () => UI.panelBag();
    $('#btn-menu').onclick = () => menuPanel();
  }

  /* 开机：绑好标题页与 HUD 按钮、把“玩家靠近了什么”的回调登记给
     世界层，然后启动世界主循环——整个游戏由此点亮 */
  function boot() {
    bindTitle();
    bindHUD();
    World.setOnCtx(onCtxChange);
    // 底部导航末位追加「歇一日」（自由世界：随时可推进日子，无时段门禁）
    /* 偷梁换柱（函数包装，俗称猴子补丁）：把原函数存进 orig，再用
       同名新函数先干原来的活、再往地点栏末尾追加「歇一日」按钮——
       不改别人文件的源码也能给别人的模块加功能 */
    const orig = UI.renderPlaces;
    UI.renderPlaces = function () {
      orig();
      const bar = $('#placelist');
      const b = el('button', 'place-btn here', '歇一日 ▸');
      b.onclick = () => rest();
      bar.appendChild(b);
    };
    World.start();
  }

  /* IIFE 的出口：只有列在这里的名字外界才摸得到（相当于模块的公开接口，
     其余函数全是闭包里的私有品）。`boot,` 是 ES6 简写，即 boot: boot */
  return { boot, onNPC, onEvent, afterDialog, updateCtx, onCtxChange,
           challenge, startDuel: p => SJI_UI.startBattle(duelCfg(p)), panelBlades, normalizeG,
           startTournament, startSurvival, startTrial, panelTrial, trialById,
           onQuest, panelQuests, finale, rest, pickDifficulty };
})();

/* HTML 解析完、DOM 树就绪后再开机（免得摸到还没生成的页面元素）。
   Main 是顶层 const、不挂 window，但这个回调与它同在本文件作用域里，
   闭包会记住它——所以这里能安全喊到 Main.boot() */
window.addEventListener('DOMContentLoaded', () => Main.boot());
