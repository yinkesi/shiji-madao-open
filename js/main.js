/* 实验史记·春秋笔 —— 主线流程：章节 / 交互 / 晚自习 / 终章 */
'use strict';

const Main = (() => {
  /* ---------- 存档兼容：补齐马刀行新增字段 ---------- */
  function normalizeG() {
    if (G.wins == null) G.wins = 0;
    if (G.duelsLost == null) G.duelsLost = 0;
    if (!G.blades) G.blades = { cards: [], equip: null };
    if (!G.duelDone) G.duelDone = {};
  }

  /* ---------- 马刀：约战 / 结算 ---------- */
  function duelDiff() {
    const d = (window.SJI_SAVE && SJI_SAVE.settings.lastDiff) || 'normal';
    return ['easy', 'normal', 'hard', 'extreme'].includes(d) ? d : 'normal';
  }

  function duelCfg(p, opts) {
    Blades.registerChar();
    return Object.assign({
      mode: 'story',
      title: (p.hao || p.name) + ' · 马刀场',
      playerChar: 'yinkesi',
      enemies: [p.id],
      allies: [],
      diff: duelDiff(),
      aiAggr: (window.SJI_SAVE && SJI_SAVE.settings.aiAggr) || 'active',
    }, opts || {});
  }

  function challenge(p) {
    if (Dialog.active || MG.active || (window.BATTLE_ACTIVE)) return;
    const pos = World.npcPos(p.id);
    if (pos) {
      const [px, py] = World.playerPos;
      if (Math.hypot(pos[0] - px, pos[1] - py) > 80) { World.walkTo(pos[0], pos[1] - 50); return; }
    }
    if (!window.SJI_DATA.CHARACTERS[p.id]) { toast('此人不会马刀。', '刀'); return; }
    const pool = (p.chat && p.chat.length) ? p.chat : ['来呀来呀。'];
    Dialog.play([
      { who: p.hao || p.name, text: pick(pool) },
      { who: '音克思', text: '闲话少叙——马刀场上见真章。来呀来呀！' },
      { who: p.hao || p.name, text: pick(['来呀来呀，重开重开。', '规则至简，而引人入胜。——请。', '活者为王。开刀吧。']) },
    ], () => {
      SJI_UI.startBattle(duelCfg(p));
    });
  }

  /* 战斗结算钩子：奖励 / 录技 / 段位（供 battle-ui 调用） */
  window.SJI_BATTLE_HOOKS = {
    onResult(b) {
      const win = b.result === 'win';
      const rankBefore = Blades.rankName();
      let extra = '<div class="result-extra">';
      if (win) {
        G.wins++;
        const foes = b.cfg.enemies || [];
        const names = [];
        foes.forEach(id => {
          const ch = window.SJI_DATA.CHARACTERS[id];
          if (!ch) return;
          names.push(ch.hao);
          const c = Blades.grant(id);
          if (PEOPLE_BY_ID[id]) Engine.addFavorQuiet(id, c.fresh ? 6 : 3);
        });
        Engine.addRep(2); Engine.addMoney(3);
        const rankNow = Blades.rankName();
        extra += `<div>胜${names.length > 1 ? '众刀手' : '「' + names[0] + '」'}，其名其技录入刀谱。好感与声望各有进益。</div>`;
        if (rankNow !== rankBefore) {
          toast(`刀道晋阶：「${rankNow}」`, '晋');
          extra += `<div class="yueks">音克思曰：今日封「${rankNow}」。刀是死的，人是活的。</div>`;
        } else {
          extra += `<div class="yueks">音克思曰：规则至简，而引人入胜。${pick(['来呀来呀。', '活者为王。', '重开重开。'])}</div>`;
        }
      } else {
        G.duelsLost++;
        const foeId = (b.cfg.enemies || [])[0];
        const ch = foeId && window.SJI_DATA.CHARACTERS[foeId];
        if (foeId && PEOPLE_BY_ID[foeId]) Engine.addFavorQuiet(foeId, -1);
        extra += `<div>败于${ch ? '「' + ch.hao + '」' : '刀下'}。胜负乃兵家常事。</div>
          <div class="yueks">音克思曰：${pick(['重开重开！', '既毕业，无复有刀者，悲哉——故今日之败，不足记也。', '汝倒下了。但史官还站着。'])}</div>`;
      }
      extra += '</div>';
      Save.write();
      return extra;
    },
    onDone() {
      afterAction();
      World.refresh();
    },
  };

  /* ---------- 刀谱面板 ---------- */
  function panelBlades() {
    Blades.registerChar();
    UI.openPanel('刀谱 · 马刀行', body => {
      const w = G.wins || 0;
      const next = Blades.nextRank();
      const eqId = Blades.equippedSkillId();
      const eqSk = eqId ? Blades.skillCardOf(eqId) : Blades.defaultSkill();
      body.appendChild(el('div', 'card', `
        <h3>段位：${Blades.rankName()} <span class="pill gold">胜 ${w} 场</span>${G.duelsLost ? `<span class="pill gray">败 ${G.duelsLost}</span>` : ''}</h3>
        <div class="meta">段位加成：血上限 +${Blades.hpBonus()} · 每回合行动点 +${Blades.apBonus()}
        ${next ? `　·　再胜 ${next.w - w} 场晋「${next.name}」` : '　·　已至刀道之巅'}</div>
        <div style="height:8px"></div>
        <div class="meta">当前技：「${eqSk.name}」——${eqSk.desc}</div>`));
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
        const c = el('div', 'card');
        c.style.cssText = 'display:flex;align-items:center;gap:12px';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${ch.name} <span class="phao" style="color:var(--cinnabar);font-size:12px">${ch.hao}</span></h3>
          <div class="meta">${sk ? `「${sk.name}」：${sk.desc}` : '（其技不可录，徒留其名）'}</div></div>`;
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
  function bindTitle() {
    $('#btn-new').onclick = () => { Sfx.tap(); G = newGameState(); normalizeG(); Save.write(); startChapter(true); };
    $('#btn-continue').onclick = () => {
      const s = Save.read();
      if (!s) { toast('还没有存档'); return; }
      G = s; normalizeG(); Sfx.tap();
      $('#screen-title').classList.add('hidden');
      $('#screen-game').classList.remove('hidden');
      UI.updateHUD();
      World.enter(G.flags.lastScene || 'corridor');
      enterPeriod(false);
      toast('继续上局', '史');
    };
    $('#btn-import-title').onclick = () => {
      UI.openPanel('导入存档', body => {
        const ta = el('textarea', 'savebox'); ta.placeholder = '粘贴存档文字…';
        body.appendChild(ta);
        const b = el('button', 'btn btn-primary', '导入');
        b.style.marginTop = '8px';
        b.onclick = () => {
          try { Save.import(ta.value); location.reload(); }
          catch (e) { toast('存档格式不对'); }
        };
        body.appendChild(b);
      });
    };
    const has = !!Save.read();
    $('#btn-continue').classList.toggle('hidden', !has);
  }

  /* ---------- 章节卡 ---------- */
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

  function startChapter(isNew) {
    const def = CHAPTERS[G.ch];
    $('#screen-title').classList.add('hidden');
    $('#screen-game').classList.remove('hidden');
    UI.updateHUD();
    showChapterCard(def, () => {
      const scene = def.scene || (G.ch === 15 ? 'gate' : 'corridor');
      World.enter(scene);
      if (isNew && G.ch === 0) prologue();
      else enterPeriod(true);
    });
  }

  function nextChapter() {
    if (G.ch >= CHAPTERS.length - 1) { finale(); return; }
    const toFinale = G.ch + 1 === CHAPTERS.length - 1; // 下一章即终章
    Engine.nextChapter();
    if (toFinale) { finale(); return; }
    startChapter(false);
  }

  /* ---------- 序章 ---------- */
  function prologue() {
    enterPeriod(true);
    toast('点击地面移动 · 走近带「记」的名场面旁观', '引');
    setTimeout(() => toast('右上「史记」随时翻阅卷目', '引'), 1800);
  }

  /* ---------- 时段流转 ---------- */
  function enterPeriod(changed) {
    UI.updateHUD();
    UI.renderPlaces();
    UI.renderHearsay();
    World.refresh();
    if (Engine.period() === 'eve') { /* 晚自习 ctx 由 updateCtx 处理 */ updateCtx(null); }
    else updateCtx(null);
    if (changed && Engine.period() === 'morning') toast(`${Engine.dateLabel()} · 早读铃响`, '晨');
  }
  function advancePeriod() {
    if (Dialog.active || MG.active || UI.panelOpen) return;
    const r = Engine.advancePeriod();
    if (r === 'period') { enterPeriod(true); Sfx.page(); }
    else if (r === 'eve') { enterPeriod(true); toast('晚自习——一日所获，可入史册', '夜'); Sfx.page(); }
  }
  function sleep() {
    if (Dialog.active || MG.active) return;
    const r = Engine.nextDay();
    if (r === 'chapter-end') {
      if (G.ch === 0) { Engine.award('ach_start'); }
      nextChapter();
    } else if (G.ch === CHAPTERS.length - 1 && G.day > CHAPTERS[G.ch].days) {
      finale();
    } else {
      enterPeriod(true);
      toast(`${Engine.dateLabel()}`, '晨');
    }
  }

  /* ---------- 交互条 ---------- */
  function updateCtx(near) {
    const bar = $('#ctxbar');
    bar.innerHTML = '';
    bar.classList.add('hidden');
    if (Dialog.active || MG.active) return;
    // 晚自习固定动作
    if (Engine.period() === 'eve') {
      bar.classList.remove('hidden');
      const mk = (t, cls, fn, dis) => { const b = el('button', 'ctx-btn' + (cls ? ' ' + cls : ''), t); b.disabled = !!dis; b.onclick = fn; bar.appendChild(b); return b; };
      mk('📖 撰史', '', () => UI.panelBook());
      mk('✒ 写日记', '', () => { Engine.addWen(3); G.flags.rested = true; toast('日记写成，文笔 +3；明日精神抖擞（行动点+1）', '文'); Save.write(); });
      mk('🌙 夜谈', '', nightTalk);
      mk('就寝 →', 'accent', sleep);
      return;
    }
    if (!near) return;
    bar.classList.remove('hidden');
    if (near.type === 'npc') {
      const p = near.p;
      const fav = Engine.favorOf(p.id);
      const head = el('span', 'ctx-name', p.hao || p.name);
      bar.appendChild(head);
      bar.appendChild(el('span', 'ctx-sub', `好感 ${fav}`));
      // 交谈
      const free = G.chatCount < 2;
      const chatBtn = el('button', 'ctx-btn', free ? '交谈' : '交谈 ⚡1');
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
        const iv = el('button', 'ctx-btn' + (ok ? ' accent' : ''), ok ? '采访 ⚡1' : fav >= need ? '已采' : `采访 需好感${need}`);
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
    } else if (near.type === 'event') {
      bar.appendChild(el('span', 'ctx-name', '「' + near.ev.name + '」'));
      const b = el('button', 'ctx-btn accent', '旁观亲历');
      b.onclick = () => playEvent(near.ev);
      bar.appendChild(b);
    } else if (near.type === 'door') {
      const b = el('button', 'ctx-btn', '进入 · ' + near.door.label);
      b.onclick = () => World.travel(near.door.to);
      bar.appendChild(b);
    }
    // 场景特有动作
    if (World.sceneId === 'library') {
      const b = el('button', 'ctx-btn', '读书 ⚡1 → 文笔+4');
      b.onclick = () => {
        if (!Engine.spendAP(1)) return;
        Engine.addWen(4); G.stats.reads++; Sfx.good();
        toast('读罢掩卷，文笔 +4', '文');
        if (Math.random() < 0.3) toast('（文言书看起来就是很上头）');
        Save.write();
      };
      bar.appendChild(b);
    }
    if ((World.sceneId === 'classroom6' || World.sceneId === 'classroom7') && (Engine.period() === 'morning' || Engine.period() === 'aft')) {
      const b = el('button', 'ctx-btn', '听课 ⚡1 → 文笔+2');
      b.onclick = () => listenClass();
      bar.appendChild(b);
    }
    if (World.sceneId === 'shop') {
      const b = el('button', 'ctx-btn accent', '进店购物');
      b.onclick = () => UI.panelShop();
      bar.appendChild(b);
    }
    if (World.sceneId === 'pingpong') {
      const b = el('button', 'ctx-btn', '打乒乓球 ⚡1');
      b.onclick = () => {
        if (!Engine.spendAP(1)) return;
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

  function afterAction() {
    UI.updateHUD(); UI.renderHearsay(); World.refresh(); Save.write();
  }

  /* ---------- 行为 ---------- */
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
  function interview(p) {
    if (!Engine.spendAP(1)) return;
    Engine.grantShard(p.interview.give, 'interview');
    Engine.addFavor(p.id, 5);
    Dialog.play(p.interview.script, afterAction);
  }
  function playEvent(ev) {
    Dialog.play(ev.script, () => {
      G.doneEvents.push(ev.id);
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
  function nightTalk() {
    const met = G.flags.metPeople.filter(id => PEOPLE_BY_ID[id]);
    if (Math.random() < 0.55 && met.length) {
      const id = pick(met);
      Engine.addFavor(id, 2);
      Dialog.play([{ who:'旁白', text:`熄灯后的卧谈会。话题不知怎么绕到了${PEOPLE_BY_ID[id].name}——你听了些新的传闻，好感 +2。` }], afterAction);
    } else {
      Dialog.play([{ who:'旁白', text:'卧谈话题从史记聊到高考，从高考聊到宇宙。什么都没记下来，但睡得很香。' }], afterAction);
    }
  }

  /* ---------- 世界回调 ---------- */
  function onCtxChange(near) { updateCtx(near); }
  function onNPC(p) {
    if (Dialog.active || MG.active) return;
    const pos = World.npcPos(p.id);
    if (pos) {
      const [px, py] = World.playerPos;
      if (Math.hypot(pos[0] - px, pos[1] - py) > 80) { World.walkTo(pos[0], pos[1] - 50); return; }
    }
    updateCtx({ type:'npc', p });
  }
  function onEvent(ev) {
    if (Dialog.active || MG.active) return;
    const [px, py] = World.playerPos;
    if (Math.hypot(ev.pos[0] - px, ev.pos[1] - py) > 80) { World.walkTo(ev.pos[0], ev.pos[1] + 30); return; }
    playEvent(ev);
  }
  function afterDialog() { UI.updateHUD(); UI.renderHearsay(); World.refresh(); Save.write(); }

  /* ---------- 终章：高考 · 毕业 · AI ---------- */
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
  function aiEpilogue() {
    Engine.award('ach_ai');
    const pub = Object.keys(G.vols).length;
    const avg = pub ? Object.values(G.vols).reduce((a, b) => a + b.grade, 0) / pub : 0;
    let title = '残卷 · 史未成而人已散';
    if (pub >= 6) title = '史官 · 有所记，有所失';
    if (pub >= 10) title = '良史 · 秉笔直书，温润如玉';
    if (pub >= 15) title = G.rep >= 60 ? '太史公 · 究天人之际，通古今之变' : '太史公（孤本）· 书成而友尽？';
    const styleLine = G.stats.direct > G.stats.curve * 2 ? '峻直' : G.stats.curve > G.stats.direct * 2 ? '敦厚' : '直曲相济';
    // 已立传诸人的平均好感
    const castIds = new Set();
    Object.keys(G.vols).forEach(no => VOL_BY_NO[no].cast.forEach(id => castIds.add(id)));
    const favAvg = castIds.size ? Math.round([...castIds].reduce((a, id) => a + Engine.favorOf(id), 0) / castIds.size) : 0;
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
  function menuPanel() {
    UI.openPanel('系统', body => {
      const row = el('div', '');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px';
      [['图鉴 · 史中人', () => UI.panelCodex()], ['刀谱 · 马刀行', () => panelBlades()], ['成就', () => UI.panelAch()],
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
    $('#btn-bag').onclick = () => UI.panelBag();
    $('#btn-menu').onclick = () => menuPanel();
  }

  function boot() {
    bindTitle();
    bindHUD();
    World.setOnCtx(onCtxChange);
    // 底部「下一时段」由 placelist 附加
    const orig = UI.renderPlaces;
    UI.renderPlaces = function () {
      orig();
      const bar = $('#placelist');
      if (Engine.period() !== 'eve') {
        const b = el('button', 'place-btn here', '下一时段 ▸');
        b.onclick = () => advancePeriod();
        bar.appendChild(b);
      }
    };
    World.start();
  }

  return { boot, onNPC, onEvent, afterDialog, updateCtx, onCtxChange,
           challenge, startDuel: p => SJI_UI.startBattle(duelCfg(p)), panelBlades, normalizeG };
})();

window.addEventListener('DOMContentLoaded', () => Main.boot());
