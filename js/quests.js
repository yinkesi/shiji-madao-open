/* 实验史记·马刀行 —— 任务系统：主线任务链（高难关卡）+ 条件触发支线（解锁强力人物/效果）
   自由度：世界可自由行走，任务是"指引"不是"门禁"；未接主线也能满校园挑战刀手。
   据卷八《马刀书》兴亡史编排主线。 */
'use strict';

/* 难度自选：影响敌方强度与赏格（写进 SJI_SAVE.settings.lastDiff，战斗层直接读） */
const DIFFS = [
  { v: 'easy',    n: '简单', mul: 0.8, tip: '敌方行动点少、伤害低；赏格 ×0.8' },
  { v: 'normal',  n: '普通', mul: 1.0, tip: '标准强度（默认）' },
  { v: 'hard',    n: '困难', mul: 1.3, tip: '敌方更狠；赏格 ×1.3' },
  { v: 'extreme', n: '极难', mul: 1.6, tip: '敌方 5 动、强制狂攻、击破不回血；赏格 ×1.6' },
];
const DIFF_BY_V = {};
DIFFS.forEach(d => DIFF_BY_V[d.v] = d);

const Quests = (() => {

  /* ============ 主线：马刀兴亡史（每节皆高难关卡） ============
     need(): 解锁条件；cfg: 战斗配置（rule 特则见 battle/engine.js）；reward: 赏格 */
  const MAIN = [
    { id: 'm1', name: '初执马刀', where: 'playground', pos: [750, 450],
      goal: '操场寻万震，讨教第一刀', hint: '白板之身，先赢一场，录他一技',
      need: () => true,
      cfg: { enemies: ['wanzhen'], rule: null },
      reward: { money: 8, rep: 2 } },
    { id: 'm2', name: '实验三异能者', where: 'corridor', pos: [720, 260],
      goal: '连战大哥、神人、仙女三人', hint: '三阵连战，阵间回血；异能者各有异能',
      need: () => Q.done('m1'),
      cfg: { enemies: ['dage'], waves: [['dage'], ['shenren'], ['xiannv']], rule: { id: 'dyad', desc: '相邻敌人伤害+1（二声部合唱）' } },
      reward: { money: 12, rep: 3 } },
    { id: 'm3', name: '操场三国刀', where: 'playground', pos: [520, 560],
      goal: '胜小川与鲁豪，夺三国刀之名', hint: '小川缴械、鲁豪刀伤翻倍——先破其一',
      need: () => Q.done('m2'),
      cfg: { enemies: ['xiaochuan', 'luhao'], rule: { id: 'dyad', desc: '相邻敌人伤害+1（三国刀同气连枝）' } },
      reward: { money: 15, rep: 3 } },
    { id: 'm4', name: '世界马刀协会', where: 'playground', pos: [950, 300],
      goal: '协会锦标赛三连胜：鲁豪→小川→子琛', hint: '阵间充分休整；子琛会召唤援军',
      need: () => Q.done('m3'),
      cfg: { enemies: ['luhao'], waves: [['luhao'], ['xiaochuan'], ['zichen']], restFull: true, hpScale: 0.68,
             rule: { id: 'uprising', desc: '第三回合敌人援军二人入场（起义）' } },
      reward: { money: 25, rep: 5, rare: 'b_killheal' } },
    { id: 'm5', name: '七班刀合流', where: 'classroom7', pos: [540, 430],
      goal: '胜李帆与头哥，六七合流', hint: '李帆购刀免动、笑场之歌能惑人；头哥免疫击退',
      need: () => Q.done('m4'),
      cfg: { enemies: ['lifan', 'touge'], rule: { id: 'stench', desc: '鲍鱼之肆：回合结束相邻敌我互蚀各 1 血' } },
      reward: { money: 18, rep: 4 } },
    { id: 'm6', name: '刀禁令风波', where: 'office', pos: [240, 500],
      goal: '主任钦法坐镇办公楼，闯过去', hint: '钦法当场缴械；此战特则：来人即是巡查',
      need: () => Q.done('m5'),
      cfg: { enemies: ['qinfa', 'weibing'], rule: { id: 'suomen', desc: '锁门：楼内无墙可踢，双方马踢不可用' } },
      reward: { money: 20, rep: 4, unlock: 'qinfa' } },
    { id: 'm7', name: '马刀之神', where: 'playground', pos: [750, 450],
      goal: '与 wonder 决战，证马刀之神之名', hint: '〔验算〕他血量为偶则回血——把他打成奇数',
      need: () => Q.done('m6'),
      cfg: { enemies: ['wonder'], diff: null, hpScale: 1.4,
             rule: { id: 'yansuan', desc: '验算：回合末 wonder 血量为偶数则回 1 血——算好伤害' } },
      reward: { money: 30, rep: 6, rare: 'b_bloodfree', unlock: 'wonder' } },
    { id: 'm8', name: '终焉之战', where: 'office', pos: [860, 260],
      goal: '再入校长室，与崇国做个了断', hint: '〔种树不绝〕他每回合种树；为兵为你助阵',
      need: () => Q.done('m7'),
      cfg: { enemies: ['qinfa', 'chongguo'], allies: ['weibing'], diff: 'hard', hpScale: 0.78,
             rule: { id: 'zhongshu', desc: '种树不绝：每回合开始崇国自动种树（至多三株）' } },
      reward: { money: 40, rep: 8, rare: 'b_horsereach', unlock: 'chongguo' } },
    { id: 'm9', name: '马刀的结局', where: 'gate', pos: [430, 300],
      goal: '校门口，为这部刀史收卷', hint: '与最强者（wonder）作最后一战，或和平收卷',
      need: () => Q.done('m8'),
      cfg: { enemies: ['wonder'], hpScale: 1.6, diff: 'hard',
             rule: { id: 'cans', desc: '看台飞瓶：与他同行或同列，回合开始被砸 1 血' } },
      reward: { money: 60, rep: 12, rare: 'b_cleave' } },
  ];

  /* ============ 支线：满足条件触发，完成解锁强力人物或永久效果 ============ */
  const SIDE = [
    { id: 's_dage', name: '大哥的护手霜', where: 'corridor', pos: [400, 300],
      goal: '大哥好感≥20，再与他一战', cond: () => Engine.favorOf('dage') >= 20,
      cfg: { enemies: ['dage'], hpScale: 1.2 },
      reward: { unlock: 'dage', money: 10, text: '岳豪之梦已录：可点将出征「大哥」' } },
    { id: 's_xinhui', name: '歆慧的一声滚', where: 'library', pos: [700, 380],
      goal: '歆慧好感≥25，接她一击', cond: () => Engine.favorOf('xinhui') >= 25,
      cfg: { enemies: ['xinhui'], hpScale: 1.25, rule: { id: 'dyad', desc: '她的「一声滚」可击退两格——莫贴边' } },
      reward: { unlock: 'xinhui', money: 12, text: '可点将出征「歆慧」' } },
    { id: 's_luhao', name: '锦绣昼行', where: 'dorm', pos: [450, 300],
      goal: '胜鲁豪一次（腹大如斗，刀伤翻倍）', cond: () => Blades.hasCard('luhao'),
      cfg: { enemies: ['luhao'], hpScale: 1.2 },
      reward: { rare: 'b_firststrike', money: 15, text: '稀有刀卡「先手刀」入手' } },
    { id: 's_touge', name: '三溴化氮', where: 'classroom7', pos: [540, 200],
      goal: '头哥好感≥30，试他的陀螺', cond: () => Engine.favorOf('touge') >= 30,
      cfg: { enemies: ['touge'], hpScale: 1.3, rule: { id: 'stench', desc: '溴味蚀人：回合末相邻互蚀 1 血——别贴他' } },
      reward: { unlock: 'touge', money: 12, text: '可点将出征「头哥」' } },
    { id: 's_guayu', name: '提壶狂奔', where: 'canteen', pos: [540, 170],
      goal: '胜呱宇一次（二成闪避，难缠）', cond: () => Blades.hasCard('guayu'),
      cfg: { enemies: ['guayu', 'yiran'], hpScale: 0.85 },
      reward: { rare: 'b_shield', money: 18, text: '稀有刀卡「班主任的偏爱」入手' } },
    { id: 's_zichen', name: '体育课起义', where: 'playground', pos: [950, 300],
      goal: '子琛好感≥35，接他的起义', cond: () => Engine.favorOf('zichen') >= 35,
      cfg: { enemies: ['zichen'], hpScale: 1.3, rule: { id: 'uprising', desc: '第三回合其二心腹入场（起义）' } },
      reward: { unlock: 'zichen', money: 15, text: '可点将出征「子琛」' } },
    { id: 's_win30', name: '以刀会友', where: 'playground', pos: [750, 450],
      goal: '累计胜 10 场，与协会委员再战一场', cond: () => (G.wins || 0) >= 10,
      cfg: { enemies: ['luhao', 'xiaochuan', 'zichen'], hpScale: 0.62, rule: { id: 'chaos', desc: '三人各有二成机率打错人（同门相争）' } },
      reward: { rare: 'b_horse', money: 25, text: '稀有刀卡「马踏连营」入手' } },
  ];

  const Q = {
    all() { return MAIN.concat(SIDE); },
    mainList() { return MAIN.slice(); },
    sideList() { return SIDE.slice(); },
    byId(id) { return this.all().find(q => q.id === id); },
    done(id) { return !!G.quests[id]; },
    /* 当前主线：第一个未完成的主线 */
    current() { return MAIN.find(q => !this.done(q.id)) || null; },
    /* 可接支线：条件满足且未完成 */
    sideOpen() { return SIDE.filter(q => !this.done(q.id) && q.cond()); },
    /* 世界上此刻该显示的任务点（主线当前 + 已解锁支线） */
    markers() {
      const cur = this.current();
      const list = [];
      if (cur) list.push({ q: cur, main: true });
      this.sideOpen().forEach(q => list.push({ q, main: false }));
      return list;
    },
    /* 玩家附近的任务点（供交互条） */
    nearMarker(sceneId, x, y, r) {
      r = r || 100;
      return this.markers().filter(m => m.q.where === sceneId)
        .map(m => ({ m, d: Math.hypot(m.q.pos[0] - x, m.q.pos[1] - y) }))
        .filter(o => o.d < r).sort((a, b) => a.d - b.d)[0] || null;
    },
    /* 开战：难度自选 + 出战角色选择 → SJI_UI.startBattle */
    start(q, fighterId) {
      const diff = Quests.diffV();
      Blades.registerChar();
      const cfg = Object.assign({
        mode: 'story', questId: q.id,
        title: (MAIN.indexOf(q) >= 0 ? '主线 · ' : '支线 · ') + q.name,
        playerChar: fighterId || 'yinkesi',
        enemies: [], allies: [], diff: diff, aiAggr: 'active',
      }, q.cfg);
      if (q.cfg.diff === null) cfg.diff = diff;      // diff:null 表示随玩家难度
      if (!cfg.rule) cfg.rule = null;
      SJI_UI.startBattle(cfg);
    },
    pickAndStart(q) {
      const roster = Quests.roster();
      if (roster.length <= 1) { this.start(q); return; }
      UI.openPanel('点将出征 · ' + q.name, body => {
        body.appendChild(el('div', 'muted', '选定出战之人。音克思保有刀谱与修炼；他人以其本卡出战（保留稀有刀卡与道具）。'));
        body.appendChild(el('div', '', '<div style="height:8px"></div>'));
        roster.forEach(id => {
          const ch = window.SJI_DATA.CHARACTERS[id];
          if (!ch) return;
          const c = el('div', 'card');
          c.style.cssText = 'display:flex;align-items:center;gap:12px;cursor:pointer';
          c.innerHTML = `<span class="tokenface" style="background:${ch.color}">${ch.glyph}</span>
            <div style="flex:1"><h3 style="margin:0">${ch.name} <span class="phao" style="color:var(--cinnabar);font-size:12px">${ch.hao}</span></h3>
            <div class="meta">血 ${ch.hp} · 被动「${ch.passive.name}」${ch.skill ? ` · 技「${ch.skill.name}」` : ''}</div></div>`;
          c.onclick = () => { UI.closePanel(); Quests.start(q, id); };
          body.appendChild(c);
        });
      });
    },
    /* 完成结算：发赏、解锁、推进 */
    complete(q) {
      const rw = q.reward || {};
      const mul = DIFF_BY_V[Quests.diffV()].mul;
      const money = Math.round((rw.money || 0) * mul);
      const rep = Math.round((rw.rep || 0) * mul);
      let lines = [`<div><b>任务完成：「${q.name}」</b></div>`];
      if (money) { Engine.addMoney(money); lines.push(`<div>零花钱 +${money}${mul !== 1 ? `（难度 ×${mul}）` : ''}</div>`); }
      if (rep) { Engine.addRep(rep); lines.push(`<div>声望 +${rep}</div>`); }
      if (rw.rare) {
        const rareDefs = Blades.RARE_BOONS;
        if (rareDefs[rw.rare] && Blades.grantRare(rw.rare)) lines.push(`<div>稀有刀卡「${rareDefs[rw.rare].name}」入手</div>`);
        else if (rareDefs[rw.rare]) lines.push(`<div>（稀有刀卡「${rareDefs[rw.rare].name}」已在囊中）</div>`);
      }
      if (rw.unlock) {
        const ch = window.SJI_DATA.CHARACTERS[rw.unlock];
        if (Quests.unlockFighter(rw.unlock) && ch) lines.push(`<div>强力人物解锁：<b>${ch.name}（${ch.hao}）</b>可点将出征</div>`);
        else if (ch) lines.push(`<div>（${ch.hao} 早已在列）</div>`);
      }
      if (rw.text) lines.push(`<div class="yueks">${rw.text}</div>`);
      G.quests[q.id] = true;
      Engine.award('ach_quest');
      const cur = this.current();
      if (cur) lines.push(`<div style="margin-top:6px">▸ 新任务：「${cur.name}」——${cur.hint}</div>`);
      else if (!rw.text || true) lines.push(`<div style="margin-top:6px" class="yueks">音克思曰：刀者，终将入书。全书将成。</div>`);
      Save.write();
      this.render();
      return '<div class="result-extra">' + lines.join('') + '</div>';
    },
    /* 出战名册 */
    roster() { if (!G.roster) G.roster = ['yinkesi']; return G.roster; },
    unlockFighter(id) {
      const r = this.roster();
      if (r.includes(id)) return false;
      r.push(id);
      const ch = window.SJI_DATA.CHARACTERS[id];
      toast(`强力人物入列：「${ch ? ch.name + '（' + ch.hao + '）' : id}」——点将可选出战`, '将');
      Save.write(); this.render();
      return true;
    },
    diffV() {
      const d = (window.SJI_SAVE && SJI_SAVE.settings.lastDiff) || 'normal';
      return DIFF_BY_V[d] ? d : 'normal';
    },
    /* HUD 任务指引卡 */
    render() {
      const box = document.getElementById('questcard');
      if (!box) return;
      const cur = this.current();
      const sides = this.sideOpen();
      let h = '';
      if (cur) {
        const sc = SCENE_BY_ID[cur.where];
        h += `<div class="qc-main"><div class="qc-tag">主线</div>
          <div class="qc-name">${cur.name}</div>
          <div class="qc-goal">${cur.goal}</div>
          <div class="qc-hint">${cur.hint}</div>
          <button class="ctx-btn duel qc-btn" data-quests="${cur.id}">前往 · ${sc ? sc.short : cur.where}</button></div>`;
      } else {
        h += `<div class="qc-main"><div class="qc-tag done">主线已成</div><div class="qc-name">刀史收卷</div>
          <div class="qc-goal">纵刀已封，书已成。校园仍可自由来去。</div></div>`;
      }
      if (sides.length) {
        h += `<div class="qc-sides"><div class="qc-sides-title">支线可接（${sides.length}）</div>` +
          sides.slice(0, 3).map(q => {
            const sc = SCENE_BY_ID[q.where];
            return `<div class="qc-side"><b>${q.name}</b> · ${sc ? sc.short : q.where}
              <button class="ctx-btn qc-btn" data-quests="${q.id}">前往</button></div>`;
          }).join('') + '</div>';
      }
      box.innerHTML = h;
      box.classList.remove('hidden');
      box.querySelectorAll('[data-quests]').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          const q = Quests.byId(b.dataset.quests);
          if (!q) return;
          if (World.sceneId !== q.where) World.travel(q.where);
          setTimeout(() => World.walkTo(q.pos[0], q.pos[1] + 40), 120);
          toast(`前往：${q.goal}`, '令');
        };
      });
    },
  };
  return Q;
})();
