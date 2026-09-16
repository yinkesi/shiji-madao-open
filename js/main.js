/* 实验史记·马刀行 —— 世界流程总指挥：开卷/日常/任务接战/章节/终章
   （战斗胶水——约战/结算钩子/锦标赛/试炼/生存——已拆至 js/duels.js） */
/* ================================================================
   【这个文件是干嘛的】
   校园生活的"总指挥"：开卷时选难度与养成模式；世界里的一切日常
   交互（交谈/赠礼/采访/名场面/读书听课/歇一日）都在这里处理；任务
   的「接战」入口、章节里程碑卡、终章（高考·毕业·AI 读史）也归它。
   与"战斗"有关的部分只剩转发起跳——真正的约战与结算在 js/duels.js。

   【架构位置】
   index.html 里最后一个加载的 script（它依赖前面所有人）。向下调
   World（画布）/UI（面板）/Dialog（对话）/Quests（任务）/Blades（刀谱）
   /Engine（状态机）/Duels（战斗胶水，js/duels.js）；向上被 World 的
   回调（onNPC/onEvent/onCtxChange）驱动。读档后先过 normalizeG()
   补齐新增字段，老档才能直接玩。

   【暴露的全局名】
   Main（boot / onNPC / onEvent / afterDialog / updateCtx / onQuest /
   panelQuests / panelBlades / finale / rest / pickDifficulty /
   showChapterCard / normalizeG…）。return 里的 challenge/startTournament/
   startSurvival/startTrial 等只是转发到 Duels 同名接口的"兼容薄包装"。

   【新手阅读提示】
   1) 理解全项目的钥匙是"一次约战的完整旅程"：交互条「来呀来呀」或
      任务卡「前往」→ Main.onQuest 播战前剧情 → Quests.pickAndStart /
      Duels.challenge 组配置开战（js/duels.js）→ 引擎算 → 结算钩子
      SJI_BATTLE_HOOKS（也在 duels.js）→ onDone 回世界。本文件负责
      这条链的头和尾，中段全在 duels.js。
   2) 本文件是 IIFE 模块 + 顶层 const Main（不挂 window，跨文件用裸名
      + typeof 判活；详见 config.js / blades.js 的头注释）。
   3) 界面代码的套路高度一致：el() 造元素 → innerHTML 填卡片 →
      onclick 挂行为 → appendChild 上树。看懂 panelQuests 一个，
      其余面板全都一个模子。
   ================================================================ */
'use strict';

const Main = (() => {
  /* ---------- 存档兼容：补齐马刀行新增字段 ---------- */
  /* 老档升级的统一入口：缺什么补什么、绝不改动已有值——这样旧玩家
     的进度永远安全。每加一个新存档字段，就在这里补一行默认值。 */
  function normalizeG() {
    if (G.wins == null) G.wins = 0;
    if (G.duelsLost == null) G.duelsLost = 0;
    if (!G.blades) G.blades = { cards: [], equip: null, rare: [] };
    if (!G.blades.rare) G.blades.rare = [];
    if (!G.blades.rareInit) { G.blades.rareOn = (G.blades.rare || []).slice(); G.blades.rareInit = true; }   // 老档迁移：已持有的稀有卡默认全部生效
    if (!G.blades.rareOn) G.blades.rareOn = [];
    if (!G.quests) G.quests = {};
    if (G.cultivation == null) G.cultivation = false;
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
    if (window.Quests && Quests.migrateInnates) Quests.migrateInnates();
  }

  /* ---------- 任务：接战 / 完成回流 ---------- */
  /* 任务接战的统一入口（任务卡「前往」和世界「令」气泡都会走到这）。
     流程：清残留对话 → 没走到就先走近 → 播战前剧情 → 开战。 */
  function onQuest(q) {
    if (!q || window.BATTLE_ACTIVE) return;
    if (Dialog.active) Dialog.forceFinish();   // 清掉残留对话（战后幕等）
    /* 任务点可能因同场景重叠而错位显示，取显示位置走近 */
    const onMap = Quests.markers().some(m => m.q.id === q.id);
    const pos = onMap ? Quests.walkPosOf(q.id) : [q.pos[0], q.pos[1]];
    const [px, py] = World.playerPos;
    /* 离任务点太远（>90px）先走过去——"先走近再办事"的项目惯例 */
    if (Math.hypot(pos[0] - px, pos[1] - py) > 90) { World.walkTo(pos[0], pos[1] + 40); return; }
    const isMain = Quests.current() && Quests.current().id === q.id;
    /* 专属战前剧情；缺数据时退回通用脚本 */
    const script = Quests.preScript(q) || Quests.fallbackPre(q, isMain);
    /* Dialog.play 的第二参是"播完回调"——剧情放完才真正开战 */
    Dialog.play(script, () => Quests.pickAndStart(q));
  }

  /* 任务面板：主线（按章节解锁）与支线（按条件解锁）两张清单 */
  function panelQuests() {
    UI.openPanel('任务 · 马刀行', body => {
      const cur = Quests.current();
      const mul = DIFF_BY_V[Quests.diffV()];
      /* 顶卡：当前难度与赏格倍率（难度随时可改，是全局乘数） */
      body.appendChild(el('div', 'card', `<h3>当前难度：${mul.n} <span class="pill gold">赏格 ×${mul.mul}</span></h3>
        <div class="meta">${mul.tip}　·　可在「系统 · 设置」中随时更改</div>`));
      body.appendChild(el('div', 'muted', '<div style="height:10px"></div>主线 · 马刀兴亡史（每节皆高难关卡）：'));
      /* 主线清单：need() 返回 false 的章节还没解锁（灰显） */
      Quests.mainList().forEach(q => {
        const done = Quests.done(q.id); const open = q.need ? q.need() : true;
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;opacity:' + (open ? 1 : 0.5);
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${q.name} ${done ? '<span class="pill jade">已成</span>' : cur && cur.id === q.id ? '<span class="pill">进行中</span>' : open ? '' : '<span class="pill gray">未接</span>'}</h3>
          <div class="meta">${q.goal}　·　${q.hint}</div></div>`;
        const b = el('button', 'btn' + (open && !done ? ' btn-primary' : ''), done ? '已成' : '前往');
        b.style.padding = '7px 13px';
        /* 「前往」= 先切场景再自动接战（setTimeout 150ms 等场景切换完成） */
        if (done) b.disabled = true;
        else b.onclick = () => { UI.closePanel(); const sc = SCENE_BY_ID[q.where]; if (World.sceneId !== q.where) World.travel(q.where); setTimeout(() => onQuest(q), 150); };
        c.appendChild(b);
        body.appendChild(c);
      });
      body.appendChild(el('div', 'muted', '<div style="height:12px"></div>支线 · 满足条件可接（完成即解锁强力人物或永久效果）：'));
      /* 支线清单：cond() 是解锁条件的布尔函数，condHint 是未达标时的提示文案 */
      Quests.sideList().forEach(q => {
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
  /* 刀谱面板：称号/养成加成/修炼购买/身怀之技/稀有刀卡开关/录技切换。
     全部每次打开时按当前 G 现算——"整体重画"惯用法，状态与界面永不脱节 */
  function panelBlades() {
    Blades.registerChar();   // 先按最新成长重算主角战斗卡，面板数据才不会旧
    UI.openPanel('刀谱 · 马刀行', body => {
      const w = G.wins || 0;
      const eqId = Blades.equippedSkillId();
      const eqSk = eqId ? Blades.skillCardOf(eqId) : null;
      /* 顶卡：段位/战绩/养成状态一览 */
      body.appendChild(el('div', 'card', `
        <h3>称号：${Blades.rankName()} <span class="pill gold">胜 ${w} 场</span>${G.duelsLost ? `<span class="pill gray">败 ${G.duelsLost}</span>` : ''}<span class="pill ${G.cultivation ? 'jade' : 'gray'}" style="margin-left:5px">${G.cultivation ? '养成模式' : '纯白板'}</span></h3>
        <div class="meta">${G.cultivation
          ? `养成加成：血上限 +${Blades.hpBonus()} · 每回合行动点 +${Blades.apBonus()}`
          : '纯白板：无数值养成——成长全凭刀谱之技、身怀之技与稀有刀卡。'}</div>
        <div style="height:8px"></div>
        <div class="meta">当前技：${eqSk ? `「${eqSk.name}」——${eqSk.desc}` : '<b style="color:var(--cinnabar)">白板无技</b>——赢下第一场对决，录他一技。'}</div>`));
      /* 修炼（养成模式专用）：花零花钱买永久强化 */
      if (G.cultivation) {
        body.appendChild(el('div', 'muted', '<div style="height:12px"></div>修炼 · 花零花钱买永久强化：'));
        Blades.UPGRADES.forEach(u => {
          const lv = Blades.upgrades()[u.id] || 0;
          const maxed = lv >= u.max;
          const cost = u.price(lv);
          const c = el('div', 'card');
          c.style.cssText = 'display:flex;align-items:center;gap:12px';
          c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${u.name} <span class="pill gray">Lv.${lv}/${u.max}</span></h3>
            <div class="meta">${u.desc}${maxed ? ' · 已臻化境' : ` · 花费 ◉${cost}`}</div></div>`;
          const b = el('button', 'btn' + (maxed ? '' : ' btn-primary'), maxed ? '已成' : '修炼');
          b.style.padding = '8px 14px';
          /* 买完关面板立刻重开——借"整体重画"刷新等级显示 */
          if (maxed) b.disabled = true;
          else b.onclick = () => { if (Blades.buyUpgrade(u.id)) { UI.closePanel(); panelBlades(); } };
          c.appendChild(b);
          body.appendChild(c);
        });
      }
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
      /* 稀有刀卡（试炼/支线所授）：每张独立开关，生效数量自定 */
      const rares = Blades.rareList();
      if (rares.length) {
        body.appendChild(el('div', 'muted', '<div style="height:12px"></div>稀有刀卡 · 每张独立开关，生效几张由你决定（战场左上角同款开关）：'));
        rares.forEach(bid => {
          const rw = Blades.RARE_BOONS[bid];
          if (!rw) return;
          const on = Blades.isRareOn(bid);
          const c = el('div', 'card');
          c.style.cssText = 'display:flex;align-items:center;gap:12px';
          c.innerHTML = `<div style="flex:1"><h3 style="margin:0">「${rw.name}」<span class="pill ${on ? 'jade' : 'gray'}">${on ? '生效中' : '已封存'}</span></h3><div class="meta">${rw.desc}</div></div>`;
          /* 战斗外切换：battle 传 null，只改存档（战场上还有同款开关） */
          const b = el('button', 'btn' + (on ? '' : ' btn-primary'), on ? '收回' : '启用');
          b.style.padding = '8px 14px';
          b.onclick = (e) => { e.stopPropagation(); Blades.toggleRare(null, bid); toast(Blades.isRareOn(bid) ? `启用「${rw.name}」` : `收回「${rw.name}」`, '谱'); UI.closePanel(); panelBlades(); };
          c.appendChild(b);
          body.appendChild(c);
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
    let cult = false;   // 养成模式：默认关
    UI.openPanel('择难度 · 新的史官', body => {
      body.appendChild(el('div', 'muted', '主线皆高难关卡。难度只改敌方强度与赏格，不改剧情；开卷后仍可在「系统 · 设置」随时更改。'));
      /* 养成模式开关（可选）：开=段位+修炼给数值，关=纯白板 */
      const cultRow = el('div', 'card');
      const renderCult = () => {
        /* 点"开/关"只改 cult 变量再整行重画——状态放闭包里，界面跟着重渲染 */
        cultRow.innerHTML = `<div style="flex:1"><h3 style="margin:0">养成模式 <span class="pill ${cult ? 'jade' : 'gray'}">${cult ? '开' : '关'}</span></h3>
          <div class="meta">开：胜场升段位（血上限/行动点加成）且可在刀谱花零花钱修炼；关：纯白板，全凭刀谱之技、身怀之技与稀有刀卡。</div></div>
          <div style="display:flex;gap:6px">
            <button class="btn ${!cult ? 'btn-primary' : ''}" data-v="off" style="padding:7px 14px">关</button>
            <button class="btn ${cult ? 'btn-primary' : ''}" data-v="on" style="padding:7px 14px">开</button>
          </div>`;
        cultRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:10px';
        cultRow.querySelectorAll('[data-v]').forEach(b => {
          b.onclick = e => { e.stopPropagation(); cult = b.dataset.v === 'on'; Sfx.tap(); renderCult(); };
        });
      };
      cultRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:10px';
      body.appendChild(cultRow);
      renderCult();
      body.appendChild(el('div', '', '<div style="height:10px"></div>'));
      /* 难度清单：点卡片或点按钮都直接开卷 */
      DIFFS.forEach(d => {
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px;cursor:pointer';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${d.n}<span class="pill ${d.v === cur ? 'gold' : 'gray'}" style="margin-left:8px">赏格 ×${d.mul}</span></h3>
          <div class="meta">${d.tip}</div></div>`;
        const b = el('button', 'btn' + (d.v === cur ? ' btn-primary' : ''), d.v === cur ? '按此开卷' : '选此');
        b.style.padding = '8px 16px';
        b.onclick = e => { e.stopPropagation(); beginNewGame(d.v, cult); };
        c.appendChild(b);
        c.onclick = () => beginNewGame(d.v, cult);
        body.appendChild(c);
      });
      body.appendChild(el('div', 'muted', '<div style="height:12px"></div>开卷后：世界自由来去；主线指引在右侧任务卡；走近「令」标记即可开战。'));
    });
  }
  /* 真正开新档：记难度偏好 → 重建全局状态 G → 写档 → 落地开局 */
  function beginNewGame(diffV, cult) {
    if (window.SJI_SAVE && SJI_SAVE.setSetting) SJI_SAVE.setSetting('lastDiff', diffV);
    UI.closePanel();
    Sfx.tap();
    /* newGameState() 造全新 G，normalizeG() 补齐字段——G 是 window 上的全局账本 */
    G = newGameState(); normalizeG();
    G.cultivation = !!cult;
    Save.write();
    startChapter(true);
    setTimeout(() => toast(G.cultivation ? '养成模式：胜场升段位，刀谱可修炼' : '纯白板模式：成长只凭刀谱之技、身怀之技与稀有刀卡', G.cultivation ? '炼' : '白'), 900);
  }

  /* 标题页三键：开卷/继续/导入存档 */
  function bindTitle() {
    $('#btn-new').onclick = () => { Sfx.tap(); pickDifficulty(); };
    $('#btn-continue').onclick = () => {
      const s = Save.read();
      if (!s) { toast('还没有存档'); return; }
      /* 读档 = 存档对象直接成为全局 G，再补齐新字段 */
      G = s; normalizeG(); Sfx.tap();
      $('#screen-title').classList.add('hidden');
      $('#screen-game').classList.remove('hidden');
      UI.updateHUD();
      World.enter(G.flags.lastScene || 'playground');
      enterPeriod(false);
      toast('继续上局', '史');
      /* 老档迁移提示只弹一次（flags 是"取完即清"的一次性标记） */
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
        /* 导入成功直接刷新页面重载新档，失败弹提示不崩 */
        b.onclick = () => {
          try { Save.import(ta.value); location.reload(); }
          catch (e) { toast('存档格式不对'); }
        };
        body.appendChild(b);
      });
    };
    /* 没有存档就藏起「继续上局」 */
    const has = !!Save.read();
    $('#btn-continue').classList.toggle('hidden', !has);
  }

  /* ---------- 章节卡 ---------- */
  /* 章节里程碑卡：全屏一闪的转场卡。点击或超时都算看完——fired 旗子
     保证回调只跑一次（幂等），这是"收尾不能赌动画"的轻量版兜底 */
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

  /* 进章节：新档直接落地主线首节（开局即主线），续档才放章节转场卡 */
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
  /* 开局四连提示：用定时错开的 toast 把基本玩法讲完（比教学弹窗轻） */
  function prologue() {
    toast('点击地面移动 · 走近带「令」的标记，接主线', '引');
    setTimeout(() => toast('右侧任务卡写有当前主线与可接支线 · 点「前往」直达', '令'), 1600);
    setTimeout(() => toast('想动手随时走近任何人：「来呀来呀」约战，胜则录技入刀谱', '刀'), 3400);
    setTimeout(() => toast('世界自由来去，没有时段门禁 · 底部「歇一日」推进日子', '游'), 5200);
    Save.write();
  }

  /* ---------- 日子流转（自由世界：随时可歇，不再是「下一时段」） ---------- */
  /* 每次进新时段/新一天都全量刷新一遍 HUD/地点/风闻/任务/世界 */
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
    /* 有对话/小游戏/战斗/面板开着时不响应（互斥守卫） */
    if (Dialog.active || MG.active || window.BATTLE_ACTIVE || UI.panelOpen) return;
    /* choice 步骤：Dialog.play 支持选项分支，每个选项的 run() 返回结果台词 */
    Dialog.play([
      { who: '旁白', text: `一日将尽（${Engine.dateLabel()}）。` },
      { choice: [
        { t: '写日记 · 文笔 +3', fx: '史官日课', run() {
            Engine.addWen(3);
            return { say: { who: '旁白', text: '今日所见尽落纸上。文笔 +3。' } };
        } },
        { t: '找人夜谈 · 好感 +2', fx: '卧谈会', run() {
            /* 从见过面的人里随机挑一个加好感 */
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
      /* 全部选项播完的收尾：日子+1，全量刷新 */
      Engine.nextDay();
      UI.updateHUD(); UI.renderPlaces(); UI.renderHearsay(); World.refresh(); Quests.render(); Save.write();
      toast(Engine.dateLabel(), '日');
    });
  }

  /* ---------- 交互条 ---------- */
  /* 底部交互条：World 每次探测到"走近了什么"就调这里重画。
     near 是 {type:'quest'|'npc'|'event'|'door', …}；没有 near 但场景
     有专属动作时也显示（读书/听课/购物/协会等）。 */
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
    /* 任务点：显示敌阵预告，点击走 onQuest 流程（战前剧情→开战） */
    if (near && near.type === 'quest') {
      bar.classList.remove('hidden');
      const q = near.q;
      bar.appendChild(el('span', 'ctx-name', (near.main ? '【主线】' : '【支线】') + q.name));
      const b = el('button', 'ctx-btn duel', '开战 · ' + (q.cfg.enemies || []).map(id => (window.SJI_DATA.CHARACTERS[id] || {}).hao || id).join('·'));
      b.onclick = () => onQuest(q);
      bar.appendChild(b);
    } else if (near && near.type === 'npc') {
      /* NPC：交谈/赠礼/采访/约战四件套（约战按钮只在会马刀的人身上出现） */
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
      const giftBtn = el('button', 'ctx-btn', G.giftToday[p.id] ? '已赠' : '赠礼');
      if (G.giftToday[p.id]) giftBtn.disabled = true;
      giftBtn.onclick = () => giftPick(p);
      bar.appendChild(giftBtn);
      // 采访
      if (p.interview) {
        const need = p.ivNeed != null ? p.ivNeed : 30;
        const ok = fav >= need && !Engine.hasShard(p.interview.give);
        const iv = el('button', 'ctx-btn' + (ok ? ' accent' : ''), ok ? '采访' : fav >= need ? '已采' : `采访 需好感${need}`);
        if (!ok) iv.disabled = true;
        iv.onclick = () => interview(p);
        bar.appendChild(iv);
      }
      // 约战（会马刀的人）——真正开战逻辑在 js/duels.js 的 Duels.challenge
      if (window.SJI_DATA && SJI_DATA.CHARACTERS[p.id]) {
        const duelBtn = el('button', 'ctx-btn duel', '来呀来呀 · 约战');
        duelBtn.onclick = () => Duels.challenge(p);
        bar.appendChild(duelBtn);
      }
    } else if (near && near.type === 'event') {
      /* 名场面：旁观亲历，播事件脚本 */
      bar.appendChild(el('span', 'ctx-name', '「' + near.ev.name + '」'));
      const b = el('button', 'ctx-btn accent', '旁观亲历');
      b.onclick = () => playEvent(near.ev);
      bar.appendChild(b);
    } else if (near && near.type === 'door') {
      /* 门/传送点：直接切场景 */
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
    /* 操场在协会成立（G.ch≥8）后长出三个战斗入口——全都转发到 Duels */
    if (World.sceneId === 'playground' && G.ch >= 8) {
      const clubOn = !!G.flags.xiehui;
      const t = el('button', 'ctx-btn' + (clubOn ? ' duel' : ''), clubOn ? '协会锦标赛' : '协会未立（推进主线至协会开张）');
      if (!clubOn) t.disabled = true;
      else t.onclick = () => Duels.startTournament();
      bar.appendChild(t);
      const tr = el('button', 'ctx-btn' + (clubOn ? ' duel' : ''), clubOn ? '高难试炼' : '试炼未开');
      if (!clubOn) tr.disabled = true;
      else tr.onclick = () => Duels.panelTrial();
      bar.appendChild(tr);
      const s = el('button', 'ctx-btn' + (clubOn ? ' duel' : ''), clubOn ? '破败城墙 · 生存' : '生存未开');
      if (!clubOn) s.disabled = true;
      else s.onclick = () => Duels.startSurvival();
      bar.appendChild(s);
    }
    if (World.sceneId === 'pingpong') {
      /* 小游戏：MG.launch(名字, 结算回调)——赢了拿文笔/零花钱/图鉴碎片 */
      const b = el('button', 'ctx-btn', '打乒乓球');
      b.onclick = () => {
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
  /* 任何"一次行为"结束后的统一收尾：刷 HUD/风闻/世界/任务 + 存档 */
  function afterAction() {
    UI.updateHUD(); UI.renderHearsay(); World.refresh(); Quests.render(); Save.write();
  }

  /* ---------- 行为 ---------- */
  /* 交谈：每天前 2 次免费，之后要花行动点；首次交谈算"结识" */
  function chat(p) {
    if (G.chatCount >= 2 && !Engine.spendAP(1)) return;
    G.chatCount++;
    G.stats.chats++;
    if (!G.flags.metPeople.includes(p.id)) { G.flags.metPeople.push(p.id); toast(`结识「${p.name}${p.hao ? ' · ' + p.hao : ''}」`, '识'); }
    const first = G.stats.chats === 1;
    /* 首次聊天连招呼语一起进随机池；pick() 是 config.js 的随机取一 */
    const line = pick(first ? p.greet.concat(p.chat) : p.chat);
    Engine.addFavor(p.id, 1);
    /* 巡查风险：掷骰失败会被逮住（caughtPlay 播被抓小剧场） */
    if (Engine.riskCheck()) { Engine.caughtPlay(() => afterAction()); return; }
    Dialog.play([{ who: p.hao || p.name, text: line }], afterAction);
  }
  /* 赠礼第一步：列出行囊里的道具，标出对方的爱/喜欢 */
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
  /* 赠礼结算：心头好 +12 / 喜欢 +6 / 普通 +2 好感，附专属反应台词 */
  function doGift(p, id) {
    G.bag[id]--;
    G.giftToday[p.id] = 1;
    G.stats.gifts++;
    const love = p.loves && p.loves.includes(id), like = p.likes && p.likes.includes(id);
    const n = love ? 12 : like ? 6 : 2;
    Engine.addFavor(p.id, n);
    if (love) Sfx.unlock(); else Sfx.good();
    if (p.id === 'keyi' && Engine.favorOf(p.id) >= 100) Engine.award('ach_sugar');
    if (G.money >= 40) Engine.award('ach_rich');
    UI.closePanel();
    Dialog.play([{ who: p.hao || p.name, text: love ? `（眼睛一亮）此物……汝如何知吾所好？善！大善！` : like ? '（收下，端详片刻）有心了。' : '（收下）……多谢。' }], afterAction);
  }
  /* 采访：耗行动点，拿图鉴碎片 + 好感，播专属采访稿 */
  function interview(p) {
    if (!Engine.spendAP(1)) return;
    Engine.grantShard(p.interview.give, 'interview');
    Engine.addFavor(p.id, 5);
    Dialog.play(p.interview.script, afterAction);
  }
  /* 名场面：播事件脚本，收尾记账（完成列表/开新去处/碎片/成就/好感） */
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
      /* 事件里可以内嵌小游戏（script 中带 mg 步骤）；结果记录在步骤对象上 */
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
  /* 听课：文笔+2；22% 概率触发随堂提问小剧场（答对声望+2，答错-1） */
  function listenClass() {
    if (!Engine.spendAP(1)) return;
    Engine.addWen(2); G.stats.listened++;
    if (G.stats.listened >= 10) Engine.award('ach_listen');
    if (Math.random() < 0.22) {
      /* 两个教室各自的"授课教师池"，随机请一位出场 */
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
  /* ---------- 世界回调 ---------- */  function onCtxChange(near) { updateCtx(near); }
  /* World 探测到玩家点了 NPC：先走近（>80px 就走过去），到了再弹交互条 */
  function onNPC(p) {
    if (Dialog.active || MG.active) return;
    const pos = World.npcPos(p.id);
    if (pos) {
      const [px, py] = World.playerPos;
      if (Math.hypot(pos[0] - px, pos[1] - py) > 80) { World.walkTo(pos[0], pos[1] - 50); return; }
    }
    updateCtx({ type:'npc', p });
  }
  /* World 探测到玩家点了名场面标记：同样是"先走近再办事" */
  function onEvent(ev) {
    if (Dialog.active || MG.active) return;
    const [px, py] = World.playerPos;
    if (Math.hypot(ev.pos[0] - px, ev.pos[1] - py) > 80) { World.walkTo(ev.pos[0], ev.pos[1] + 30); return; }
    playEvent(ev);
  }
  /* Dialog 播完任何脚本的统一收尾（World.refresh 让 NPC 重新流动） */
  function afterDialog() { UI.updateHUD(); UI.renderHearsay(); World.refresh(); Quests.render(); Save.write(); }

  /* ---------- 终章：高考 · 毕业 · AI ---------- */
  /* 终章第一幕：高考考场（主线 m9 通关后由 duels.js 的终章收尾调来） */
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
  /* 毕业册：全员去向一览（立过传/见过面的人才有"远方"文案） */
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
  /* 真·结局：AI 读史。按立传数/笔风/好感/声望/胜场现场拼出"AI 评语"
     ——全是模板字符串计算出来的，不是固定结局贴图 */
  function aiEpilogue() {
    Engine.award('ach_ai');
    const pub = Object.keys(G.vols).length;
    const avg = pub ? Object.values(G.vols).reduce((a, b) => a + b.grade, 0) / pub : 0;
    /* 称号按立传数分档（写得多还人缘好才是太史公） */
    let title = '残卷 · 史未成而人已散';
    if (pub >= 6) title = '史官 · 有所记，有所失';
    if (pub >= 10) title = '良史 · 秉笔直书，温润如玉';
    if (pub >= 15) title = G.rep >= 60 ? '太史公 · 究天人之际，通古今之变' : '太史公（孤本）· 书成而友尽？';
    /* 笔风 = 直笔/曲笔的统计对比（撰史时两种写法各自计数） */
    const styleLine = G.stats.direct > G.stats.curve * 2 ? '峻直' : G.stats.curve > G.stats.direct * 2 ? '敦厚' : '直曲相济';
    // 已立传诸人的平均好感
    const castIds = new Set();
    Object.keys(G.vols).forEach(no => VOL_BY_NO[no].cast.forEach(id => castIds.add(id)));
    const favAvg = castIds.size ? Math.round([...castIds].reduce((a, id) => a + Engine.favorOf(id), 0) / castIds.size) : 0;
    // 马刀行结局变体：胜场决定 AI 评语里"刀"的戏份
    const wins = G.wins || 0, cards = (G.blades && G.blades.cards || []).length;
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
  /* 系统菜单：六宫格入口。注意任务/刀谱两项是本文件的，其余借 UI 的 */
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
  function bindHUD() {
    $('#btn-hud-book').onclick = () => UI.panelBook();
    $('#btn-hud-blade').onclick = () => panelBlades();
    $('#btn-bag').onclick = () => UI.panelBag();
    $('#btn-menu').onclick = () => menuPanel();
  }

  /* 启动：绑按钮 → 挂世界回调 → 给地点栏打个"补丁" → 开主循环 */
  function boot() {
    bindTitle();
    bindHUD();
    World.setOnCtx(onCtxChange);
    // 底部导航末位追加「歇一日」（自由世界：随时可推进日子，无时段门禁）
    /* 猴子补丁（monkey patch）：不改 ui.js，包一层原函数往栏尾追加按钮——
       "打补丁而不改源"的 JS 惯用法 */
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

  /* 对外接口：challenge/startTournament 等一行箭头函数只是转发到 Duels
     的兼容包装（老调用点不必改）；真正实现都在 js/duels.js */
  return { boot, onNPC, onEvent, afterDialog, updateCtx, onCtxChange,
           challenge: (p) => Duels.challenge(p),
           startDuel: (p) => { Duels.challenge(p); },
           panelBlades, normalizeG,
           startTournament: () => Duels.startTournament(),
           startSurvival: () => Duels.startSurvival(),
           startTrial: (id) => Duels.startTrial(id),
           panelTrial: () => Duels.panelTrial(),
           trialById: (id) => Duels.trialById(id),
           showChapterCard,
           onQuest, panelQuests, finale, rest, pickDifficulty };
})();

/* main.js 是最后一个加载的脚本：DOM 就绪后一键启动整个游戏 */
window.addEventListener('DOMContentLoaded', () => Main.boot());
