/* 实验史记·春秋笔 —— 对话系统：剧本播放 / 立绘 / 选项 */
'use strict';

/* 剧本中出现、但不进入图鉴的师长配角 */
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
function resolveFig(who) {
  if (!who || who === '旁白') return null;
  if (who === '音克思') return 'PLAYER';
  if (PEOPLE_BY_ID[who]) return PEOPLE_BY_ID[who];
  const byName = PEOPLE.find(p => p.name === who || p.hao === who);
  if (byName) return byName;
  if (MINOR_FIGS[who]) return MINOR_FIGS[who];
  return null;
}

const Dialog = (() => {
  const root = $('#dialog'), cast = $('#dialog-cast'), box = $('#dialog-box');
  const nameEl = $('#dialog-name'), textEl = $('#dialog-text'), choicesEl = $('#dialog-choices'), nextBtn = $('#dialog-next');
  let steps = [], idx = 0, onDone = null, active = false;
  let typing = false, typeTimer = null, figs = {};
  let stepOver = null; // 选择后的附加处理

  function setFigs(who) {
    const f = resolveFig(who);
    if (!f) return;
    ensureFig(f);
    const key = f === 'PLAYER' ? 'PLAYER' : f.id || f.name;
    Object.entries(figs).forEach(([k, elx]) => elx.classList.toggle('dim', k !== key));
  }
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
  function preSpawn() {
    steps.forEach(st => {
      if (!st.who || st.who === '旁白') return;
      const f = resolveFig(st.who);
      if (f) ensureFig(f);
    });
    Object.values(figs).forEach(elx => elx.classList.add('dim'));
  }

  function showStep() {
    if (idx >= steps.length) return finish();
    const st = steps[idx++];
    if (st.ach) { Engine.award(st.ach); return showStep(); }
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

  function completeOrNext() {
    if (!active) return;
    if (typing) { clearInterval(typeTimer); typing = false; textEl.classList.remove('typing');
      const st = steps[idx - 1]; textEl.textContent = st.text; nextBtn.style.visibility = 'visible'; return; }
    Sfx.tap();
    showStep();
  }

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
        if (c.favor) Object.entries(c.favor).forEach(([id, v]) => Engine.addFavor(id, v));
        if (c.rep) Engine.addRep(c.rep);
        if (c.wen) Engine.addWen(c.wen);
        if (c.money) Engine.addMoney(c.money);
        const say = (result && result.say) || c.say;
        if (say) { steps.splice(idx, 0, say); }
        Save.write();
        showStep();
      };
      choicesEl.appendChild(b);
    });
  }

  function finish() {
    if (!active) return;
    active = false;
    /* 弹簧只负责视觉滑出；收尾与回调（onDone）必须保证执行，不能被动画链的健康状况拖累。
       之前出现过"对话结束回调丢失 → 后续流程（开战/战后一幕）永远不触发"的隐患。 */
    let fired = false;
    const cleanup = () => {
      if (fired) return; fired = true;
      root.classList.add('hidden'); cast.innerHTML = ''; figs = {};
      box.style.transform = ''; box.style.opacity = '';
      Main.afterDialog();
      World.resetNear();
      flushToasts();
      const cb = onDone; onDone = null; cb && cb();
    };
    try {
      Spring.make({
        x0: 0, target: 40, damping: 1, response: 0.25,
        update: x => { box.style.transform = `translateY(${x}px)`; box.style.opacity = String(1 - x / 60); },
        done: cleanup,
      });
    } catch (e) { cleanup(); return; }
    setTimeout(cleanup, 320);
  }

  return {
    get active() { return active; },
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

$('#dialog-box').addEventListener('click', e => { if (e.target.id !== 'dialog-next' && !e.target.closest('.choice-btn')) Dialog.tap(); });
$('#dialog-next').addEventListener('click', () => Dialog.tap());
