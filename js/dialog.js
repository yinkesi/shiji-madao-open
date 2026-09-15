/* 实验史记·春秋笔 —— 对话系统：剧本播放 / 立绘 / 选项 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   世界侧的对话播放器，玩法类似 galgame/视觉小说：把“剧本”（一个数组，
   每项是一句台词/旁白/选项/成就/小游戏）逐条播出，负责打字机效果、
   舞台立绘的亮暗调度、选项分支与奖励结算；播完后通过 onDone 回调
   把控制权交还给调用方（开战、进下一幕等都挂在它后面）。

   【架构位置】
   在 config、data/*、engine、world 之后由 index.html 加载（第 9 个）。
   依赖：$ el（config）、World.avatarCanvas（画像素立绘）、Engine（发成就/
   加好感等）、Sfx、MG（minigames 的小游戏）、Save、flushToasts（config）。
   被 main.js、engine.js（被逮剧情）、quests.js 等调用：
   Dialog.play(剧本, 结束回调)。

   【暴露的全局名】
   MINOR_FIGS（配角立绘配置）、resolveFig（名字 → 立绘数据）、
   Dialog（播放器：play / tap / active / forceFinish）。

   【新手阅读提示】
   1) Dialog 是 IIFE 返回的对象，steps/idx/onDone/active 这些变量藏在
      闭包里成为私有状态，外界只能通过返回的那几个方法操作。
   2) 全文件最值得细读的是 finish()：收尾回调是“幂等 + 320ms 超时兜底”
      的双保险设计，为什么要兜底见 finish() 上方的大段注释。
   ================================================================ */

/* 剧本中出现、但不进入图鉴的师长配角 */
/* 以“名字字符串”为 key 的对象字面量（JS 对象即 Python 的 dict）。
   look 里的发色/发型/小物件会喂给 World.avatarCanvas 画成立绘。 */
const MINOR_FIGS = {
  '为兵':  { name:'为兵',    look:{ hair:'#2a2620', style:'short', glasses:true, acc:'📷' }, role:'t', cls:'7' },
  '钦法':  { name:'钦法',    look:{ hair:'#3a352c', style:'short', acc:'📋' }, role:'t', cls:'t' },
  '晓东':  { name:'晓东',    look:{ hair:'#26221c', style:'short', glasses:true, acc:'📐' }, role:'t', cls:'6' },
  '杨杰':  { name:'杨杰',    look:{ hair:'#4a4438', style:'short', acc:'🔑' }, role:'t', cls:'t' },
  '杨洪波': { name:'杨洪波',  look:{ hair:'#1c1812', style:'spiky', acc:'📢' }, role:'t', cls:'t' },
  '王明虎': { name:'王明虎',  look:{ hair:'#565043', style:'short', acc:'🌏' }, role:'t', cls:'6' },
  '卓本':  { name:'卓本',    look:{ hair:'#221e18', style:'short', acc:'🫓' }, role:'s', cls:'6' },
  '组员们': { name:'组员们',  look:{ hair:'#33302a', style:'short' }, role:'s', cls:'6' },
  '舍友们': { name:'舍友们',  look:{ hair:'#33302a', style:'messy' }, role:'s', cls:'6' },
};
/* 把台词里的 who（人名/称号/“旁白”）解析成立绘数据，查找顺序：
   旁白 → 没有立绘（null）；主角音克思 → 特殊标记 'PLAYER'；
   先按 id 查图鉴人物表 PEOPLE_BY_ID，再按本名或称号扫 PEOPLE 数组，
   最后落到配角表 MINOR_FIGS；都查不到返回 null。 */
function resolveFig(who) {
  if (!who || who === '旁白') return null;
  if (who === '音克思') return 'PLAYER';
  if (PEOPLE_BY_ID[who]) return PEOPLE_BY_ID[who];
  const byName = PEOPLE.find(p => p.name === who || p.hao === who);
  if (byName) return byName;
  if (MINOR_FIGS[who]) return MINOR_FIGS[who];
  return null;
}

/* Dialog 播放器本体：IIFE 返回值被存进 Dialog。
   steps（待播剧本）、idx（播到第几条）、onDone（结束回调）、active（是否在播）
   全部封在闭包里——外界碰不到，只能走下面 return 出口的那几个方法。 */
const Dialog = (() => {
  /* 把要反复操作的 DOM 元素在启动时一次性查好存进局部变量，
     后面直接用，免去每次重复查询。 */
  const root = $('#dialog'), cast = $('#dialog-cast'), box = $('#dialog-box');
  const nameEl = $('#dialog-name'), textEl = $('#dialog-text'), choicesEl = $('#dialog-choices'), nextBtn = $('#dialog-next');
  let steps = [], idx = 0, onDone = null, active = false;
  let typing = false, typeTimer = null, figs = {};
  let stepOver = null; // 选择后的附加处理

  /* 让当前说话者的立绘亮起，其余立绘加 .dim 调暗。
     Object.entries(对象) 把对象转成 [key, value] 数组来遍历，
     相当于 Python 的 dict.items()。 */
  function setFigs(who) {
    const f = resolveFig(who);
    if (!f) return;
    ensureFig(f);
    const key = f === 'PLAYER' ? 'PLAYER' : f.id || f.name;
    Object.entries(figs).forEach(([k, elx]) => elx.classList.toggle('dim', k !== key));
  }
  /* 确保该角色的立绘已在舞台上：没有就现画一个（Canvas 头像 + 名牌）
     插入 cast 容器并缓存进 figs（下次直接复用）。
     舞台最多同时站 3 人，超员就撤掉最早登台的那个——
     Object.keys 返回键的顺序即插入顺序，keys[0] 就是最早的。 */
  function ensureFig(f) {
    const key = f === 'PLAYER' ? 'PLAYER' : f.id || f.name;
    if (figs[key]) return figs[key];
    const figEl = el('div', 'cast-fig');
    const cvs = f === 'PLAYER'
      ? World.avatarCanvas({ look:{ hair:'#1c1812', style:'flat' }, role:'x', cls:'x' }, 190)
      : World.avatarCanvas(f, 190);
    figEl.appendChild(cvs);
    figEl.appendChild(el('div', 'cast-label', f === 'PLAYER' ? '音克思' : (f.hao && f.hao !== f.name ? `${f.name} · ${f.hao}` : f.name)));
    cast.appendChild(figEl);
    figs[key] = figEl;
    const keys = Object.keys(figs);
    if (keys.length > 3) { figs[keys[0]].remove(); delete figs[keys[0]]; }
    return figEl;
  }
  /* 开播前把整份剧本里会出场的角色一次性“预上舞台”并全部调暗。
     不这么做的话，每个角色第一次开口才突然冒出来，画面会一惊一乍。 */
  function preSpawn() {
    steps.forEach(st => {
      if (!st.who || st.who === '旁白') return;
      const f = resolveFig(st.who);
      if (f) ensureFig(f);
    });
    Object.values(figs).forEach(elx => elx.classList.add('dim'));
  }

  /* 播放器的状态机核心：取出当前步骤并 idx++，按步骤类型分派——
     ach=顺手发成就、mg=先玩小游戏（玩完带结果继续）、choice=出选项、
     普通台词=亮立绘 + 打字机。idx 越过末尾（剧本播完）就走 finish()。 */
  function showStep() {
    if (idx >= steps.length) return finish();
    const st = steps[idx++];
    if (st.ach) { Engine.award(st.ach); return showStep(); }
    /* 小游戏步骤：MG.launch 是异步的，第二个参数是“玩完后的回调”。
       结果记在该步骤对象身上且只记第一次（防回调重复触发被覆盖），
       剧本后续步骤可以查看它。 */
    if (st.mg) {
      MG.launch(st.mg, ok => {
        if (st._mgResult == null) st._mgResult = ok;
        showStep();
      });
      return;
    }
    if (st.choice) { renderChoices(st.choice); return; }
    setFigs(st.who);
    nameEl.textContent = st.who === '旁白' ? '——' : st.who;
    nameEl.style.opacity = st.who === '旁白' ? 0.55 : 1;
    typewrite(st.text);
  }

  /* 打字机效果：setInterval 每 26ms 多亮出一个字；玩家在设置里选了
     “风驰”（speed >= 2）就跳过动画整句上屏。
     开新定时器前先 clearInterval 清掉旧的，防止两个定时器抢同一个文本框。 */
  function typewrite(text) {
    typing = true; textEl.classList.add('typing');
    textEl.textContent = '';
    choicesEl.innerHTML = '';
    nextBtn.style.visibility = 'hidden';
    const full = G.settings.speed >= 2 ? '' : text;
    if (!full) { textEl.textContent = text; typing = false; textEl.classList.remove('typing'); nextBtn.style.visibility = 'visible'; return; }
    let i = 0;
    clearInterval(typeTimer);
    typeTimer = setInterval(() => {
      i += 1;
      textEl.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typeTimer); typing = false; textEl.classList.remove('typing'); nextBtn.style.visibility = 'visible'; }
    }, 26);
  }

  /* 点击对话框时：字没打完 → 立刻显示整句（视觉小说的惯例操作）；
     已经打完 → Sfx.tap 音效并推进到下一句。 */
  function completeOrNext() {
    if (!active) return;
    if (typing) { clearInterval(typeTimer); typing = false; textEl.classList.remove('typing');
      const st = steps[idx - 1]; textEl.textContent = st.text; nextBtn.style.visibility = 'visible'; return; }
    Sfx.tap();
    showStep();
  }

  /* 渲染选项分支：每个选项生成一个按钮塞进 choicesEl。
     c.run() 是选项自带的逻辑（常用来掷骰子定成败），可返回 { say: {...} }
     表示“选完后插播一句台词”；favor/rep/wen/money 是点击即结算的资源增减；
     c.fx 是按钮上显示的成功率小字（如“五五之数”）。 */
  function renderChoices(list) {
    textEl.textContent = '（你要——）';
    nextBtn.style.visibility = 'hidden';
    choicesEl.innerHTML = '';
    list.forEach(c => {
      const b = el('button', 'choice-btn');
      b.innerHTML = `${c.t}${c.fx ? `<span class="fx">${c.fx}</span>` : ''}`;
      b.onclick = () => {
        Sfx.tap();
        choicesEl.innerHTML = '';
        nextBtn.style.visibility = 'visible';
        let result = null;
        if (c.run) result = c.run() || null;
        /* Object.entries + forEach：把 { 传主id: 加减值 } 的好感表逐项结算。 */
        if (c.favor) Object.entries(c.favor).forEach(([id, v]) => Engine.addFavor(id, v));
        if (c.rep) Engine.addRep(c.rep);
        if (c.wen) Engine.addWen(c.wen);
        if (c.money) Engine.addMoney(c.money);
        const say = (result && result.say) || c.say;
        /* splice(idx, 0, say)：在待播位置插入插播台词——第二个参数 0
           表示不删除任何元素、只插入，原剧本其余部分顺序不变。 */
        if (say) { steps.splice(idx, 0, say); }
        Save.write();
        showStep();
      };
      choicesEl.appendChild(b);
    });
  }

  /* ============ 本文件最讲究的一处：收尾为什么必须有“兜底” ============
     对话结束时，台词框要播一个“下滑 + 淡出”的弹簧动画，而 onDone 回调
     曾经直接挂在动画的 done 上——等于赌“弹簧动画一定会跑完”。但动画链
     是脆弱的：任何一个别的弹簧回调抛异常把 rAF 循环带停、或浏览器对
     后台标签页限流暂停 rAF，done 就永远不会被调用。一旦 done 丢失：
     onDone 不触发 → Main.afterDialog() 与后续的战后一幕/开战流程全部
     落空，表现就是“对话关了，世界却冻住”。因此改成三重保险：
       1) cleanup 用 fired 标志做幂等：弹簧完成和超时兜底谁先到，
          收尾逻辑都只执行一次，不会重复刷新世界或二次调回调；
       2) try/catch 包住建弹簧：连创建都抛错时立刻手动 cleanup；
       3) setTimeout(cleanup, 320)：与动画完全无关的保底闹钟，
          就算动画压根没跑，320ms 后也强制收尾（正常动画远快于 320ms，
          玩家毫无感知）。
     教训：把“必须发生的业务收尾”寄托在“可能不发生的动画回调”上，
     就必须另备一条与动画无关的退路。 */
  function finish() {
    if (!active) return;
    active = false;
    /* 弹簧只负责视觉滑出；收尾与回调（onDone）必须保证执行，不能被动画链的健康状况拖累。
       之前出现过"对话结束回调丢失 → 后续流程（开战/战后一幕）永远不触发"的隐患。 */
    let fired = false;
    /* 收尾：藏起对话框、清空立绘与样式残留、刷新世界（afterDialog 会
       重刷 HUD/风闻/任务并写存档），最后取出 onDone 调用——
       “cb && cb()”是“有回调才调用”的惯用法，防止空指针。 */
    const cleanup = () => {
      if (fired) return; fired = true;
      root.classList.add('hidden'); cast.innerHTML = ''; figs = {};
      box.style.transform = ''; box.style.opacity = '';
      Main.afterDialog();
      World.resetNear();
      flushToasts();
      const cb = onDone; onDone = null; cb && cb();
    };
    /* 滑出动画：x 从 0 → 40（往下挪），透明度随之降到接近 0；
       动画自然结束时由弹簧触发 cleanup。 */
    try {
      Spring.make({
        x0: 0, target: 40, damping: 1, response: 0.25,
        update: x => { box.style.transform = `translateY(${x}px)`; box.style.opacity = String(1 - x / 60); },
        done: cleanup,
      });
    } catch (e) { cleanup(); return; }
    /* 保险 3：与动画无关的定时兜底（详见上方大注释）。 */
    setTimeout(cleanup, 320);
  }

  /* 强制收尾：不播动画、也不调 onDone，直接把所有状态清零。
     幂等：不在对话中就是空操作。 */
  /* 强制收尾：任何残留对话（如战后幕在结算画面下弹出、剧情回调中断遗留）
     都会卡住 Dialog.active，令约战/任务入口静默失效——此函数幂等地清理现场。 */
  function forceFinish() {
    if (!active) return;
    active = false;
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    typing = false; steps = []; idx = 0; onDone = null; stepOver = null;
    root.classList.add('hidden'); cast.innerHTML = ''; figs = {};
    box.style.transform = ''; box.style.opacity = '';
    choicesEl.innerHTML = ''; nextBtn.style.visibility = 'visible';
  }

  /* 对外接口。get active() 是“访问器属性”：外界读 Dialog.active 时
     实际执行这个函数返回私有变量——只能看，改不了。 */
  return {
    get active() { return active; },
    forceFinish,
    /* 播一段剧本：script.slice() 浅复制一份——选项插播时会对 steps 做
       splice，绝不能污染调用方手里的原剧本数组。
       开场先把台词框摆到下方 40px、半透明，再用弹簧送回原位，然后开播。 */
    play(script, done) {
      steps = script.slice(); idx = 0; onDone = done || null; active = true;
      cast.innerHTML = ''; figs = {};
      preSpawn();
      $('#ctxbar').classList.add('hidden');
      root.classList.remove('hidden');
      box.style.transform = 'translateY(40px)'; box.style.opacity = '0.4';
      Spring.make({ x0: 40, target: 0, damping: 0.85, response: 0.38, update: (x) => { box.style.transform = `translateY(${x}px)`; box.style.opacity = String(1 - x / 80); } });
      showStep();
    },
    tap: completeOrNext,
  };
})();

/* 事件绑定：点台词框任意空白处 = tap（推进对话）。
   点到“下一步”按钮或选项按钮时不算——它们有自己的 onclick，
   再冒泡到这里会连点两次；e.target.closest('.choice-btn') 沿祖先链
   向上找，判断点击落点是否在选项按钮内部。 */
$('#dialog-box').addEventListener('click', e => { if (e.target.id !== 'dialog-next' && !e.target.closest('.choice-btn')) Dialog.tap(); });
$('#dialog-next').addEventListener('click', () => Dialog.tap());
