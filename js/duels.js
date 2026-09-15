/* ============================================================
 * 实验史记·马刀行 —— 战斗胶水模块（自 main.js 拆出）
 * 职责：约战入口 / 难度与特殊战场配置 / 文斗与战大道具结算 /
 *       任务完成回流 / 高难试炼 / 协会锦标赛与生存。
 * 依赖（均为全局）：Engine / Quests / Blades / World / Dialog / UI / SJI_UI / SJI_DATA / Main.afterAction
 * ============================================================ */
'use strict';

window.Duels = (function () {

  /* 战后世界刷新（与 main.js afterAction 同构；跨模块桥接用） */
  function afterActionBridge() {
    UI.updateHUD();
    UI.renderHearsay();
    if (typeof Quests !== 'undefined') Quests.render();
    World.refresh();
    if (typeof Save !== 'undefined') Save.write();
  }

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

  function duelDiff() {
    const d = (window.SJI_SAVE && SJI_SAVE.settings.lastDiff) || 'normal';
    return ['easy', 'normal', 'hard', 'extreme'].includes(d) ? d : 'normal';
  }

  function duelCfg(p, opts) {
    Blades.registerChar();
    const id = p.id;
    const sp = DUEL_SPECIAL[id];
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
  function knifeBanRiskOk(onDecide) {
    if (G.ch < 12) { onDecide(); return; }
    if (G.flags.duelBanDays > 0) { toast(`刀具尚在钦法处（还押 ${G.flags.duelBanDays} 日），约战不得`, '禁'); return; }
    const safe = ['dorm', 'playground', 'gate', 'canteen'].includes(World.sceneId);
    if (safe || Math.random() > 0.25) { onDecide(); return; }
    Dialog.play([
      { who: '钦法', text: '（从走廊尽头逼近）此何课也？尔等围于此，所为何物？' },
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
      Save.write();
      if (G.flags.duelBanDays > 0) { afterActionBridge(); return; }   // 刀被缴，这一战打不成了
      onDecide();
    });
  }

  function challenge(p) {
    if (MG.active || (window.BATTLE_ACTIVE)) return;
    if (Dialog.active) Dialog.forceFinish();   // 清掉残留对话（战后幕等），不再静默失效
    const pos = World.npcPos(p.id);
    if (pos) {
      const [px, py] = World.playerPos;
      if (Math.hypot(pos[0] - px, pos[1] - py) > 80) { World.walkTo(pos[0], pos[1] - 50); return; }
    }
    if (!window.SJI_DATA.CHARACTERS[p.id]) { toast('此人不会马刀。', '刀'); return; }
    if ((G.flags.duelBanDays || 0) > 0) { toast(`刀具尚在钦法处（还押 ${G.flags.duelBanDays} 日），约战不得`, '禁'); return; }
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
    if (choices.length) script.push({ choice: choices.concat([{ t: '空手赴战', fx: '来呀来呀', run() { return null; } }]) });
    Dialog.play(script, () => {
      knifeBanRiskOk(() => SJI_UI.startBattle(duelCfg(p)));
    });
  }

  /* 战斗结算钩子：奖励 / 录技 / 段位（供 battle-ui 调用） */
  window.SJI_BATTLE_HOOKS = {
    onResult(b) {
      const win = b.result === 'win';
      const rankBefore = Blades.rankName();
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
        if (b.cfg.tournament) {
          ['luhao', 'xiaochuan', 'zichen'].forEach(id => Blades.grant(id));
          Engine.addRep(4); Engine.addMoney(10);
          Engine.award('ach_champion');
          extra += `<div><b>锦标赛三连胜！</b>鲁豪、小川、子琛之技尽录刀谱。声望 +4 · 零花钱 +10。</div>
            <div class="yueks">音克思曰：马刀大兴盛，汝今列席协会，与有荣焉。</div>`;
        } else {
          extra += `<div>胜${names.length > 1 ? '众刀手' : '「' + names[0] + '」'}，其名其技录入刀谱。好感与声望各有进益。</div>`;
          const rankNow = Blades.rankName();
          if (rankNow !== rankBefore) {
            toast(`刀道晋阶：「${rankNow}」`, '晋');
            extra += `<div class="yueks">音克思曰：今日封「${rankNow}」。刀是死的，人是活的。</div>`;
          } else {
            extra += `<div class="yueks">音克思曰：规则至简，而引人入胜。${pick(['来呀来呀。', '活者为王。', '重开重开。'])}</div>`;
          }
        }
      } else {
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
    onDone() {
      afterActionBridge();
      World.refresh();
      /* 回到世界后：先弹主线里程碑卡（若有），再播战后收束一幕 */
      const playPost = () => {
        const post = Quests.takePendingPost();
        if (!post) return;
        Dialog.play(post, () => { UI.updateHUD(); Quests.render(); Save.write(); });
      };
      const ch = Engine.takePendingChapter();
      if (ch != null && CHAPTERS[ch]) {
        Main.showChapterCard(CHAPTERS[ch], () => {
          UI.updateHUD(); UI.renderHearsay(); Quests.render(); playPost();
        });
      } else playPost();
    },
  };

  /* ---------- 刀谱面板 ---------- */

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
  function startSurvival() {
    SJI_UI.startBattle({
      mode: 'survival', title: '破败城墙 · 生存', playerChar: 'yinkesi',
      diff: duelDiff(), aiAggr: 'active',
    });
  }

  /* ---------- 高难试炼：随剧情渐次解锁，各有特则，首通授稀有刀卡 ---------- */
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

  function startTrial(id) {
    const t = trialById(id);
    if (!t) return;
    if (!t.ok()) { toast('试炼未开：' + t.cond, '禁'); return; }
    Blades.registerChar();
    SJI_UI.startBattle(Object.assign({
      mode: 'story', trialId: id,
      title: '高难试炼 · ' + t.name, playerChar: 'yinkesi',
      allies: [], diff: duelDiff(), aiAggr: 'active',
    }, t.cfg, t.cfg.diff ? { diff: t.cfg.diff } : {}));
  }

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


  return {
    challenge, duelCfg, knifeBanRiskOk,
    startTrial, panelTrial, trialById, TRIALS,
    startTournament, startSurvival,
  };
})();
