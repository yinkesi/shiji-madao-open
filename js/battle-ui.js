/* ============================================================
 * 实验史记·马刀行 —— 战斗覆盖层（自马刀风云 ui.js 解耦）
 * 世界探索之上覆盖的马刀战棋：Canvas 渲染 / HUD / 猜拳 / 对话 / 结算。
 * 引擎（SJI_ENGINE）通过 window.SJI_UI 钩子与本模块通信。
 * ============================================================ */
window.SJI_UI = (function () {
  "use strict";
  const D = window.SJI_DATA, E = window.SJI_ENGINE, SAVE = window.SJI_SAVE, AU = window.SJI_AUDIO;
  const CFG = window.SJI_CONFIG, GRID = CFG.GRID;
  const TILE = GRID.TILE, PAD = GRID.PAD, CS = GRID.CS;

  let battle = null;
  let mode = null;            // null | 'knife' | 'horse' | 'skill'
  let hoverTile = null;
  let floaters = [], banner = null;
  let rafOn = false, bgCanvas = null;
  let onEndCb = null;         // 战斗结束回调（世界侧注入）

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ---------------- 覆盖层 ---------------- */
  function showOverlay() {
    $("#battle").classList.remove("hidden");
    $("#battle").classList.add("on");
    window.BATTLE_ACTIVE = true;
  }
  function hideOverlay() {
    $("#battle").classList.add("hidden");
    $("#battle").classList.remove("on");
    window.BATTLE_ACTIVE = false;
    stopRaf();
    battle = null;
  }

  function toast(text) { if (window.toast) window.toast(text, "刀"); }

  /* 弹层串行化：猜拳 / 增益三选一 / 剧情对话共用 #modal-box */
  let modalChain = Promise.resolve();
  function queueModal(open) {
    const run = () => Promise.resolve().then(open);
    const p = modalChain.then(run, run);
    modalChain = p.then(() => {}, () => {});
    return p;
  }

  function modal(html) {
    const mask = $("#modal-mask"), box = $("#modal-box");
    box.innerHTML = html;
    mask.classList.add("on");
    mask.onclick = null;
    return box;
  }
  function closeModal() { $("#modal-mask").classList.remove("on"); }

  function face(ch, extraCls) {
    return '<span class="tokenface ' + (extraCls || "") + '" style="background:' + ch.color + '">' + ch.glyph + "</span>";
  }

  /* ---------------- 说话人解析（马刀剧本 + 世界人物通吃） ---------------- */
  const SHORTHAND = {
    "史": "yinkesi", "大哥": "dage", "神人": "shenren", "神": "shenren", "仙女": "xiannv",
    "上": "hanxiao", "豪": "luhao", "铭": "shaoming", "慧": "xinhui", "问": "wonder",
    "斌": "wenbin", "润": "yurun", "震": "wanzhen", "波": "shibo", "荣": "weirong",
    "法": "qinfa", "国": "chongguo", "兵": "weibing", "头": "touge", "帆": "lifan",
    "琛": "zichen", "川": "xiaochuan", "因": "guyin", "呱": "guayu", "蛙": "yiran",
    "展": "dazhan", "怡": "keai", "羚": "limo", "东": "xiangdong", "生": "mob",
    "翔": "shengxiang", "岳": "qiyue", "烨": "ziye", "奇": "lianqi",
  };
  const PALETTE = ["#a63a2b", "#4a6d9c", "#2e8b74", "#8c5a3c", "#7d4a6b", "#5a8c46", "#8f8f5c", "#555577"];
  function speakerOf(who) {
    const cid = SHORTHAND[who] || who;
    const ch = D.CHARACTERS[cid];
    if (ch) return { name: ch.name, hao: ch.hao, glyph: ch.glyph, color: ch.color };
    const p = (typeof PEOPLE_BY_ID !== 'undefined' && PEOPLE_BY_ID[who])
      || (typeof MINOR_FIGS !== 'undefined' && MINOR_FIGS[who]);
    if (p) {
      let h = 0; for (const c of (p.id || who)) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
      const glyph = (p.hao || p.name || who)[0];
      return { name: p.name, hao: p.hao, glyph, color: PALETTE[h % PALETTE.length] };
    }
    return { name: who, glyph: (who || "?")[0], color: "#6a615a" };
  }

  /* ---------------- 开战 ---------------- */
  function startBattle(cfg, onEnd) {
    mode = null; floaters = []; banner = null;
    onEndCb = onEnd || null;
    Blades.registerChar();
    battle = new E.Battle(cfg);
    window.SJI.battle = battle;
    Blades.applyBoons(battle);
    $("#battle-title").textContent = cfg.title || "马刀场";
    $("#battle-log").innerHTML = "";
    buildBG();
    startRaf();
    updateAll();
    showScreenStage();
    showOverlay();
    const boot = async () => {
      if (cfg.introScene) await showDialogue(cfg.introScene);
      battle.run().catch(err => { console.error(err); toast("战场出了差池：" + err.message); });
    };
    boot();
  }

  /* ---------------- HUD ---------------- */
  function onLog(s) {
    const el = $("#battle-log");
    if (!el) return;
    const div = document.createElement("div");
    if (s.indexOf("——") === 0) div.className = "sys";
    else if (s.indexOf("倒下") >= 0 || s.indexOf("血祭") >= 0) div.className = "em";
    div.textContent = s;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function updateAll() {
    if (!battle) return;
    const p = battle.player;
    const pc = $("#pc-face");
    pc.style.background = p.ch.color;
    pc.textContent = p.ch.glyph;
    $("#pc-name").innerHTML = "<b>" + p.ch.name + "</b>（" + p.ch.hao + "）";
    const hpPct = Math.max(0, p.hp / p.maxhp * 100);
    const inner = $("#pc-hp-in");
    inner.style.width = hpPct + "%";
    inner.classList.toggle("low", p.hp <= p.maxhp * 0.3);
    if ($("#pc-hp-ghost")) $("#pc-hp-ghost").style.width = hpPct + "%";
    $("#player-card").classList.toggle("critical", p.alive && p.hp <= p.maxhp * 0.3);
    $("#pc-hp-tx").textContent = "血 " + Math.max(0, p.hp) + " / " + p.maxhp;
    const pips = $("#ap-pips");
    pips.innerHTML = "";
    for (let i = 0; i < Math.max(p.apNow, 0); i++) {
      const d = document.createElement("div"); d.className = "ap-pip on"; pips.appendChild(d);
    }
    const chips = $("#pc-st");
    chips.innerHTML = "";
    const addChip = (txt, color) => { const s = document.createElement("span"); s.className = "st-chip"; s.style.background = color; s.textContent = txt; chips.appendChild(s); };
    if (p.hasKnife) addChip("刀", "#7a5c30");
    if (p.hasHorse) addChip("马", "#5c3070");
    if (p.st.bloodlust > 0) addChip("血祭×" + p.st.bloodlust, "#a63a2b");
    if (p.st.poison > 0) addChip("毒" + p.st.poison, "#6a4a8c");
    if (p.st.skip > 0) addChip("晕", "#8a7a3a");
    if (p.st.seal > 0) addChip("被封", "#555");
    if (p.st.silence > 0) addChip("默", "#555");
    if (p.st.shield > 0) addChip("盾" + p.st.shield, "#3a6a8a");
    if (p.st.grudge > 0) addChip("尝胆+" + p.st.grudge, "#2e8b74");
    if (p.st.empower > 0) addChip("势+" + p.st.empower, "#9a7b2d");
    if (p.offField > 0) addChip("返家途中", "#8a6a2a");
    // 技能按钮
    const skBtn = $("#b-skill");
    const sk = battle.skillOf(p, 0);
    const cd = battle.skillCd(p, 0);
    const skOk = sk && cd <= 0 && p.apNow >= (sk.ap || 1) && p.st.silence <= 0;
    skBtn.innerHTML = sk ? sk.name + (cd > 0 ? "（歇" + cd + "）" : (sk.ap ? "·" + sk.ap + "动" : "")) : "无技";
    skBtn.disabled = !sk || !skOk || phaseLocked();
    // 其它按钮
    $("#b-knife").disabled = p.hasKnife || (!(!phaseLocked() && p.apNow > 0) && p.charId !== "lifan");
    $("#b-knife").textContent = p.hasKnife ? "已持刀" : "购刀" + (p.charId === "lifan" ? "·免动" : "·1动");
    $("#b-horse").disabled = p.hasHorse || phaseLocked() || p.apNow <= 0;
    $("#b-horse").textContent = p.hasHorse ? "已购马" : "购马·1动";
    $("#b-attack").disabled = phaseLocked() || !p.hasKnife || p.apNow <= 0 || p.st.seal > 0 || !battle.opponentsOf(p).some(f => E.adj(p, f));
    $("#b-horseatk").disabled = phaseLocked() || !p.hasHorse || p.apNow <= 0 || !E.isWall(p.r, p.c) || (battle.rule && battle.rule.id === "suomen") || !battle.opponentsOf(p).some(f => E.isWall(f.r, f.c) && E.manh(p, f) <= 3);
    $("#b-drive").disabled = phaseLocked() || !p.hasHorse || p.apNow <= 0 || E.isWall(p.r, p.c) || (battle.rule && battle.rule.id === "suomen") || !battle.opponentsOf(p).some(f => E.adj(p, f) && !E.isWall(f.r, f.c));
    $("#b-blood").disabled = phaseLocked() || p.apNow <= 0 || p.hp < 2;
    const undoN = (p._undo && p._undo.length) || 0;
    $("#b-undo").disabled = phaseLocked() || undoN === 0;
    $("#b-undo").textContent = undoN ? "撤销移动(" + undoN + ")" : "撤销移动";
    $("#b-wait").disabled = phaseLocked();
    // 敌人列表
    const elist = $("#enemy-list");
    elist.innerHTML = "";
    battle.units.filter(u => u.side === "enemy").forEach(u => {
      const row = document.createElement("div");
      row.className = "enemy-row" + (u.alive ? "" : " dead");
      const apDots = (u.alive && u.offField <= 0) ? Array.from({ length: Math.max(0, Math.min(6, u.apNow)) }, () => '<span class="ap-mini"></span>').join("") : "";
      row.innerHTML = face(u.ch) + '<div style="min-width:64px">' + u.ch.hao + (u.offField > 0 ? "（家）" : "") + '</div>'
        + '<div style="min-width:34px">' + apDots + '</div>'
        + '<div class="ehp"><i style="width:' + (u.alive ? Math.max(0, u.hp / u.maxhp * 100) : 0) + '%"></i></div><div style="min-width:38px;text-align:right">' + (u.alive ? u.hp + "/" + u.maxhp : "亡") + "</div>";
      elist.appendChild(row);
    });
    $("#round-no").textContent = "第 " + battle.round + " 回合" + (battle.mode === "survival" ? " · 第" + battle.survivalWaveNo + "波" : "");
    if ($("#ai-label")) {
      const nm = CFG.AI_LABEL || {};
      const dn = { easy: "简单", normal: "普通", hard: "困难", extreme: "极难", nightmare: "噩梦" };
      const diffTxt = dn[battle.diff] || "普通";
      const aiTxt = (battle.diff === "nightmare") ? "最优(强制)" : ((battle.diff === "extreme") ? "狂攻(强制)" : (nm[battle.aiAggr] || "主动"));
      $("#ai-label").textContent = diffTxt + " · AI " + aiTxt;
    }
  }

  function phaseLocked() { return !battle || battle.over || battle._playerPhaseActive !== true; }

  async function playerPhase(b) {
    battle = b;
    b._playerPhaseActive = true;
    await showBanner("汝之回合", 700);
    if (checkAutoEnd()) { b._playerPhaseActive = false; return; }
    updateAll();
    await new Promise(resolve => { b._phaseResolve = resolve; });
    b._playerPhaseActive = false;
    mode = null;
    updateAll();
  }

  function checkAutoEnd() {
    if (!battle) return true;
    const p = battle.player;
    return battle.over || p.apNow <= 0 || !p.alive || p.offField > 0;
  }

  function afterPlayerAction() {
    updateAll();
    if (checkAutoEnd()) endPlayerPhase();
  }
  function endPlayerPhase() {
    mode = null;
    if (battle && battle._phaseResolve) { const r = battle._phaseResolve; battle._phaseResolve = null; r(); }
  }

  /* ---------------- 行动按钮 ---------------- */
  function arm(m) { mode = (mode === m) ? null : m; updateAll(); }
  function bindActions() {
    $("#b-knife").onclick = async () => { AU.click(); await battle.doBuyKnife(battle.player); afterPlayerAction(); };
    $("#b-horse").onclick = async () => { AU.click(); await battle.doBuyHorse(battle.player); afterPlayerAction(); };
    $("#b-attack").onclick = () => { AU.click(); arm("knife"); };
    $("#b-horseatk").onclick = () => { AU.click(); arm("horse"); };
    $("#b-drive").onclick = () => { AU.click(); arm("drive"); };
    $("#b-skill").onclick = () => {
      AU.click();
      const p = battle.player, sk = battle.skillOf(p, 0);
      if (sk && sk.kind === "unit") arm("skill");
      else { battle.doSkill(p, 0, null).then(afterPlayerAction); }
    };
    $("#b-blood").onclick = async () => { AU.click(); await battle.doSacrifice(battle.player); afterPlayerAction(); };
    $("#b-undo").onclick = async () => {
      AU.click();
      if (battle.undoMove()) { mode = null; updateAll(); }
    };
    $("#b-wait").onclick = () => { AU.click(); endPlayerPhase(); };
    $("#b-surrender").onclick = () => {
      modal('<h3>认输？</h3><p>胜负乃兵家常事，重开重开。</p><div class="btnrow"><button class="btn" id="m-no">再战</button><button class="btn primary" id="m-yes">认输</button></div>');
      $("#m-no").onclick = closeModal;
      $("#m-yes").onclick = () => { closeModal(); battle.finish("lose"); };
    };
    $("#b-exit").onclick = () => {
      AU.click();
      modal('<h3>离场？</h3><p>此刻离场，视作认负。江湖路远，何必恋战。</p><div class="btnrow"><button class="btn" id="m-no">再战</button><button class="btn primary" id="m-yes">离场</button></div>');
      $("#m-no").onclick = closeModal;
      $("#m-yes").onclick = () => { closeModal(); if (battle && !battle.over) battle.finish("lose"); };
    };
    $("#b-speed").onclick = () => {
      const s = SAVE.settings.speed === 3 ? 1 : SAVE.settings.speed + 1;
      SAVE.setSetting("speed", s);
      $("#b-speed").textContent = "速×" + s;
      AU.click();
    };
    $("#b-mute").onclick = () => {
      const v = !SAVE.settings.sfx;
      SAVE.setSetting("sfx", v);
      AU.setSfx(v);
      $("#b-mute").textContent = v ? "音" : "默";
      AU.click();
    };
    document.addEventListener("keydown", ev => {
      if (!window.BATTLE_ACTIVE) return;
      if (ev.key === "Escape" && mode) { mode = null; updateAll(); }
      if (ev.key === " " && battle && battle._playerPhaseActive) { ev.preventDefault(); endPlayerPhase(); }
    });
  }

  /* ---------------- 猜拳 ---------------- */
  const RPS = [{ k: "rock", g: "✊", n: "石头" }, { k: "scissors", g: "✌", n: "剪刀" }, { k: "paper", g: "✋", n: "布" }];
  async function rpsRound(b) {
    battle = b;
    if (SAVE.settings.rpsMode === "auto") {
      const k = Math.random();
      const resK = k < 0.4 ? "胜" : (k < 0.75 ? "和" : "负");
      const ap = resK === "胜" ? 4 : (resK === "和" ? 3 : 2);
      b.pushLog("—— 自动猜拳：" + resK + "，得" + ap + "动。——");
      if (window.SJI_DEBUG && window.SJI_DEBUG.skipScenes) return { res: resK, ap };
      await showBanner("猜拳 " + resK + "　得" + ap + "动", 460);
      return { res: resK, ap };
    }
    await showBanner("猜拳定行动", 650);
    if (b.over) return { res: "和", ap: 2 };
    return queueModal(() => new Promise(resolve => {
      modal(
        '<div class="rps-title">猜 拳</div>' +
        '<div class="rps-sub">胜得四动 · 和得三动 · 负得二动</div>' +
        '<div class="rps-btns">' + RPS.map((r, i) => '<button class="rps-btn" data-i="' + i + '"><span class="g">' + r.g + "</span>" + r.n + "</button>").join("") + "</div>" +
        '<div class="rps-vs" id="rps-vs">　</div>' +
        '<div class="rps-result" id="rps-res">　</div>'
      );
      const vs = $("#rps-vs"), res = $("#rps-res");
      $$("#modal-box .rps-btn").forEach(btn => {
        btn.onclick = async () => {
          const mine = RPS[+btn.dataset.i];
          const foe = RPS[Math.floor(Math.random() * 3)];
          $$("#modal-box .rps-btn").forEach(x => x.disabled = true);
          for (let i = 0; i < 6; i++) {
            vs.textContent = mine.g + "　对　" + RPS[i % 3].g;
            AU.click();
            await new Promise(r => setTimeout(r, 80));
          }
          vs.textContent = mine.g + "　对　" + foe.g;
          let resK, ap;
          if (mine.k === foe.k) { resK = "和"; ap = 3; AU.rpsDraw(); }
          else if ((mine.k === "rock" && foe.k === "scissors") || (mine.k === "scissors" && foe.k === "paper") || (mine.k === "paper" && foe.k === "rock")) { resK = "胜"; ap = 4; AU.rpsWin(); }
          else { resK = "负"; ap = 2; AU.rpsLose(); }
          res.textContent = resK + "！天命予汝" + ap + "动";
          res.style.color = resK === "胜" ? "#a63a2b" : (resK === "负" ? "#555" : "#9a7b2d");
          setTimeout(() => { closeModal(); resolve({ res: resK, ap }); }, window.SJI_DEBUG && window.SJI_DEBUG.fast ? 30 : 850);
        };
      });
      if (window.SJI_DEBUG && window.SJI_DEBUG.autoRps) {
        setTimeout(() => { const b2 = $$("#modal-box .rps-btn")[Math.floor(Math.random() * 3)]; if (b2 && !b2.disabled) b2.click(); }, 30);
      }
    }));
  }

  /* ---------------- 增益三选一（生存模式） ---------------- */
  async function pickBoon(b) {
    battle = b;
    if (b.over) return null;
    const taken = b.boonsTaken || [];
    const commons = D.BOONS.filter(x => !x.rare && !taken.includes(x.id)).sort(() => Math.random() - 0.5);
    const rares = D.BOONS.filter(x => x.rare && !taken.includes(x.id)).sort(() => Math.random() - 0.5);
    const pool = commons.slice(0, 2).concat(rares.slice(0, 1)).sort(() => Math.random() - 0.5);
    while (pool.length < 3 && commons.length > pool.length) pool.push(commons[pool.length]);
    return queueModal(() => new Promise(resolve => {
      modal(
        '<h3>苔藓之间，拾得一策</h3>' +
        '<div class="sub">破败城墙 · 三选其一</div>' +
        '<div class="boon-btns">' + pool.map((bo, i) =>
          '<button class="btn boon-b" data-i="' + i + '"><span class="bn">「' + bo.name + "」</span><span class=\"bd\">" + bo.desc + "</span></button>").join("") + "</div>"
      );
      $$("#modal-box .boon-b").forEach(btn => {
        btn.onclick = () => { AU.select(); closeModal(); resolve(pool[+btn.dataset.i]); };
      });
    }));
  }

  /* ---------------- 剧情对话（战斗内弹层） ---------------- */
  function showDialogue(lines) {
    if (window.SJI_DEBUG && window.SJI_DEBUG.skipScenes) return Promise.resolve();
    const runScene = () => new Promise(resolve => {
      const mask = $("#modal-mask"), box = $("#modal-box");
      let idx = 0, typing = null, done = false;
      function finish() {
        if (done) return;
        done = true;
        if (typing) clearInterval(typing);
        document.removeEventListener("keydown", onKey);
        mask.classList.remove("on");
        mask.onclick = null;
        box.onclick = null;
        box.innerHTML = "";
        resolve();
      }
      function showLine() {
        const pair = lines[idx];
        const sp = speakerOf(pair[0]);
        box.innerHTML =
          '<div class="dlg">' +
          '<div class="dlg-head">' + face(sp) +
          '<div><div class="dlg-name" style="color:' + sp.color + '">' + sp.name + "</div>" +
          '<div class="dlg-role">' + (pair[0] === "史" || sp.name === "音克思" ? "史官" : (sp.hao || "")) + "</div></div>" +
          '<button class="btn small" id="dlg-skip">跳过</button></div>' +
          '<div class="dlg-text" id="dlg-text"></div>' +
          '<div class="dlg-next">▼</div></div>';
        mask.classList.add("on");
        const tx = $("#dlg-text");
        let i = 0;
        tx.textContent = "";
        typing = setInterval(() => {
          i++;
          tx.textContent = pair[1].slice(0, i);
          if (i >= pair[1].length) { clearInterval(typing); typing = null; }
        }, 22);
        $("#dlg-skip").onclick = (e) => { e.stopPropagation(); finish(); };
        box.onclick = () => {
          if (typing) { clearInterval(typing); typing = null; tx.textContent = pair[1]; return; }
          idx++;
          if (idx >= lines.length) finish(); else showLine();
        };
      }
      function onKey(e) {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (box.onclick) box.onclick(); }
        if (e.key === "Escape") finish();
      }
      document.addEventListener("keydown", onKey);
      showLine();
    });
    return queueModal(runScene);
  }

  /* ---------------- 横幅/特效 ---------------- */
  function showBanner(text, ms) {
    const el = $("#phase-banner");
    el.textContent = text;
    el.classList.add("on");
    return new Promise(r => setTimeout(() => { el.classList.remove("on"); r(); }, (window.SJI_DEBUG && window.SJI_DEBUG.fast ? 60 : ms)));
  }

  function uPos(u) {
    return { x: PAD + u.rx * TILE + TILE / 2, y: PAD + u.ry * TILE + TILE / 2 };
  }
  function fxFloat(u, text, color) {
    floaters.push({ u, text, color, t: 1, dy: 0 });
    if (text && text[0] === "+") {
      const P = uPos(u);
      spawnParticles(P.x, P.y, { n: 8, colors: ["#7fe08a", "#ffd98a"], speed: 55, life: 0.7, grav: -70, size: 2.5 });
    }
  }
  function fxHit(u, dmg, opts) {
    u.flash = 1;
    fxFloat(u, "-" + dmg, opts && opts.poison ? "#b06ad0" : "#d63a2a");
    const P = uPos(u);
    if (opts && opts.poison) spawnParticles(P.x, P.y, { n: 6, color: "#b06ad0", speed: 60, life: 0.6, grav: -40, size: 2.5 });
    else if (opts && opts.type === "horse") spawnParticles(P.x, P.y, { n: 10, color: "#c9b28a", speed: 150, life: 0.45, grav: 240 });
    else spawnParticles(P.x, P.y, { n: Math.min(14, 4 + dmg * 2), colors: ["#d63a2a", "#a63a2b", "#f2ead8"], speed: 110, life: 0.45 });
    if (dmg >= 3) addShake(6);
  }
  function fxStatus(u, text) { banner = { text, t: 1.4 }; }
  function snap(u) { u.rx = u.c; u.ry = u.r; }

  /* ---------------- 打击特效系统 ---------------- */
  let particles = [], slashes = [], projectiles = [], rings = [], ghosts = [], vignettes = [];
  let shakeT = 0, shakeMag = 0;
  const PROJ_STYLE = {
    wenbin: ["arrow", "#3a2a1a"], wonder: ["beam", "#d8a11f"], shaoming: ["paper", "#f5efe0"],
    xinhui: ["wave", "#c04a6a"], shibo: ["beam", "#4f6d8c"], weirong: ["beam", "#6b4f8c"],
    qinfa: ["line", "#3d4a5c"], xiangdong: ["beam", "#8a8ab8"], limo: ["wave", "#8f8f5c"],
    dage: ["paper", "#e8d8c0"], lifan: ["wave", "#3f7d8c"], ziye: ["paper", "#8c6a2f"],
    zichen: ["ring", "#7d4a6b"], luhao: ["paper", "#4a6d9c"], guyin: ["wave", "#555555"],
    keai: ["paper", "#c76b98"], wanzhen: ["beam", "#6a8577"], tree: ["dab", "#4c6b3c"],
    yinkesi: ["paper", "#a63a2b"]
  };

  function spawnParticles(x, y, o) {
    const n = o.n || 10;
    for (let i = 0; i < n; i++) {
      if (particles.length > 320) particles.shift();
      const a = Math.random() * Math.PI * 2, sp = (o.speed || 90) * (0.4 + Math.random() * 0.8);
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0),
        life: (o.life || 0.55) * (0.6 + Math.random() * 0.7), t: 0,
        color: o.colors ? o.colors[Math.floor(Math.random() * o.colors.length)] : (o.color || "#a63a2b"),
        size: (o.size || 3) * (0.5 + Math.random()), grav: o.grav !== undefined ? o.grav : 160
      });
    }
  }
  function addShake(mag) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, 1); }

  function fxAttack(att, def, opts) {
    if (!att || !def) return;
    const A = uPos(att), B = uPos(def);
    const cheb = Math.max(Math.abs(att.r - def.r), Math.abs(att.c - def.c));
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    if (opts.type === "horse") {
      rings.push({ x: B.x, y: B.y, t: 1, color: "#8a6a3a", r: 16 });
      spawnParticles(B.x, B.y, { n: 14, color: "#a89066", speed: 130, life: 0.5, grav: 220, size: 3.5 });
      addShake(9);
      att._lunge = { dx: dx / len, dy: dy / len, t: 1 };
      return;
    }
    if (cheb <= 1) {
      att._lunge = { dx: dx / len, dy: dy / len, t: 1 };
      slashes.push({ x: B.x, y: B.y, a: Math.atan2(dy, dx), t: 1, color: opts.type === "skill" ? "#d8a11f" : "#f2ead8" });
      spawnParticles(B.x, B.y, { n: 7, colors: ["#f2ead8", "#a63a2b"], speed: 120, life: 0.4, size: 2.5 });
      return;
    }
    const st = PROJ_STYLE[att.charId] || ["dab", "#5a5248"];
    projectiles.push({ x: A.x, y: A.y, tx: B.x, ty: B.y, t: 0, style: st[0], color: st[1] });
  }

  function fxDeath(u) {
    const P = uPos(u);
    ghosts.push({ x: P.x, y: P.y, glyph: u.ch.glyph, color: u.ch.color, t: 1.3 });
    spawnParticles(P.x, P.y, { n: 22, colors: [u.ch.color, "#6a615a", "#2b2622"], speed: 150, life: 0.7, size: 3.5 });
  }

  function fxVignette(rgb) { vignettes.push({ rgb, t: 1 }); }

  /* ---------------- 画布 ---------------- */
  function buildBG() {
    bgCanvas = document.createElement("canvas");
    bgCanvas.width = CS; bgCanvas.height = CS;
    const g = bgCanvas.getContext("2d");
    g.fillStyle = "#efe4c8"; g.fillRect(0, 0, CS, CS);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = "rgba(" + (120 + Math.random() * 60 | 0) + "," + (100 + Math.random() * 50 | 0) + "," + (60 + Math.random() * 40 | 0) + "," + (Math.random() * 0.05) + ")";
      g.fillRect(Math.random() * CS, Math.random() * CS, Math.random() * 26 + 4, Math.random() * 3 + 1);
    }
    for (let r = 0; r < E.SIZE; r++) for (let c = 0; c < E.SIZE; c++) {
      const x = PAD + c * TILE, y = PAD + r * TILE;
      if (E.isWall(r, c)) {
        g.fillStyle = "#cabd9e"; g.fillRect(x, y, TILE, TILE);
        g.strokeStyle = "rgba(90,75,50,.35)"; g.lineWidth = 1.4;
        for (let by = 0; by <= TILE; by += 24) {
          g.beginPath(); g.moveTo(x, y + by); g.lineTo(x + TILE, y + by); g.stroke();
        }
        for (let row = 0; row < 4; row++) {
          const offset = (row % 2) * 24;
          for (let bx = offset; bx <= TILE; bx += 48) {
            g.beginPath(); g.moveTo(x + bx, y + row * 24); g.lineTo(x + bx, y + row * 24 + 24); g.stroke();
          }
        }
        if (r === 1 || c === 1 || r === E.SIZE - 2 || c === E.SIZE - 2) {
          g.fillStyle = "rgba(60,45,25,.14)"; g.fillRect(x, y, TILE, TILE);
        }
      } else {
        g.fillStyle = "#eee2c2"; g.fillRect(x, y, TILE, TILE);
        const seed = (r * 7 + c * 13) % 5;
        g.strokeStyle = "rgba(120,130,70,.28)"; g.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          const gx = x + 16 + ((seed * 17 + i * 29) % (TILE - 30));
          const gy = y + 20 + ((seed * 31 + i * 37) % (TILE - 40));
          g.beginPath(); g.moveTo(gx, gy + 7); g.quadraticCurveTo(gx + 3, gy, gx + 7, gy - 4); g.stroke();
        }
      }
      g.strokeStyle = "rgba(90,75,50,.14)";
      g.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1);
    }
    // 障碍格：按关卡地形类型绘制
    const stage = (battle && battle.cfg && battle.cfg.stage) || null;
    const blocked = (stage && stage.blocked) || [];
    const ttype = (stage && stage.terrain) || "desk";
    for (const [br, bc] of blocked) {
      const x = PAD + bc * TILE, y = PAD + br * TILE;
      g.fillStyle = "rgba(60,40,20,.18)";
      g.beginPath(); g.ellipse(x + TILE / 2, y + TILE - 14, 30, 8, 0, 0, 7); g.fill();
      if (ttype === "pillar") {
        g.fillStyle = "#8f8478";
        g.fillRect(x + TILE / 2 - 15, y + 12, 30, TILE - 26);
        g.fillStyle = "#a99d8e";
        g.fillRect(x + TILE / 2 - 15, y + 12, 10, TILE - 26);
        g.fillStyle = "#6e6152";
        g.fillRect(x + TILE / 2 - 19, y + 8, 38, 8);
        g.fillRect(x + TILE / 2 - 19, y + TILE - 20, 38, 8);
      } else if (ttype === "table") {
        g.fillStyle = "#3f6e5e";
        g.fillRect(x + 8, y + 16, TILE - 16, TILE - 34);
        g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1.5;
        g.strokeRect(x + 10, y + 18, TILE - 20, TILE - 38);
        g.beginPath(); g.moveTo(x + 8, y + TILE / 2 - 2); g.lineTo(x + TILE - 8, y + TILE / 2 - 2); g.stroke();
        g.fillStyle = "#5a4a3a";
        g.fillRect(x + 12, y + TILE - 20, 5, 14); g.fillRect(x + TILE - 17, y + TILE - 20, 5, 14);
      } else if (ttype === "cabinet") {
        g.fillStyle = "#5c4a38";
        g.fillRect(x + 10, y + 8, TILE - 20, TILE - 16);
        g.fillStyle = "#6e5a44";
        g.fillRect(x + 13, y + 11, TILE - 26, TILE - 22);
        g.strokeStyle = "rgba(35,25,15,.6)"; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + 13, y + TILE / 2); g.lineTo(x + TILE - 13, y + TILE / 2); g.stroke();
        g.fillStyle = "#c9a227";
        g.fillRect(x + TILE / 2 - 2, y + TILE / 2 - 8, 4, 3);
        g.fillRect(x + TILE / 2 - 2, y + TILE / 2 + 5, 4, 3);
      } else if (ttype === "platform") {
        g.fillStyle = "#9a8f7c";
        g.fillRect(x + 6, y + TILE - 30, TILE - 12, 20);
        g.fillStyle = "#877c68";
        g.fillRect(x + 10, y + 16, TILE - 20, TILE - 46);
        g.fillStyle = "#a63a2b";
        g.fillRect(x + TILE / 2 - 10, y + 20, 20, 6);
      } else {
        const bw = TILE - 22, bh = TILE - 30;
        g.fillStyle = "#8a6a45";
        g.fillRect(x + 11, y + 12, bw, bh);
        g.fillStyle = "#b08a5c";
        g.fillRect(x + 11, y + 12, bw, 9);
        g.strokeStyle = "rgba(80,55,30,.35)"; g.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          g.beginPath(); g.moveTo(x + 13, y + 12 + i * (bh / 4)); g.lineTo(x + 9 + bw, y + 12 + i * (bh / 4)); g.stroke();
        }
        g.fillStyle = "#6b5033";
        g.fillRect(x + 14, y + 12 + bh, 6, 9);
        g.fillRect(x + 9 + bw - 6, y + 12 + bh, 6, 9);
        g.fillStyle = "#c94f3a";
        g.fillRect(x + TILE / 2 - 13, y + 22, 18, 11);
        g.fillStyle = "#f2ead8";
        g.fillRect(x + TILE / 2 - 13, y + 22, 18, 3);
        g.fillStyle = "#5a7d9a";
        g.beginPath(); g.arc(x + TILE / 2 + 11, y + 30, 6, 0, 7); g.fill();
        g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 1.5;
        g.strokeRect(x + 11.5, y + 12.5, bw - 1, bh - 1);
      }
    }
    // 角楼
    for (const [rr, cc] of [[0, 0], [0, E.SIZE - 1], [E.SIZE - 1, 0], [E.SIZE - 1, E.SIZE - 1]]) {
      const x = PAD + cc * TILE + TILE / 2, y = PAD + rr * TILE + TILE / 2;
      g.fillStyle = "#6e6152"; g.fillRect(x - 15, y - 18, 30, 36);
      g.fillStyle = "#453b30"; g.fillRect(x - 20, y - 24, 40, 9);
      g.fillStyle = "#8a7d63"; g.fillRect(x - 15, y - 18, 30, 5);
      g.fillStyle = "#a63a2b"; g.beginPath(); g.arc(x, y - 6, 4.5, 0, 7); g.fill();
      g.strokeStyle = "rgba(242,234,216,.9)"; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y - 6, 6.5, 0, 7); g.stroke();
    }
    // 旗帜
    for (const [rr, cc, ch] of [[0, 3, "實"], [E.SIZE - 1, 3, "驗"], [3, 0, "史"], [3, E.SIZE - 1, "記"]]) {
      const x = PAD + cc * TILE + TILE / 2, y = PAD + rr * TILE + TILE / 2;
      g.strokeStyle = "#5a4a3a"; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x - 22, y - 24); g.lineTo(x - 22, y + 24); g.stroke();
      g.fillStyle = "#a63a2b";
      g.beginPath();
      g.moveTo(x - 22, y - 22); g.lineTo(x + 2, y - 18); g.lineTo(x - 22, y - 6);
      g.closePath(); g.fill();
      g.fillStyle = "#f2ead8";
      g.font = "bold 11px KaiTi, serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(ch, x - 12, y - 15);
    }
    g.strokeStyle = "#8a7a58"; g.lineWidth = 3;
    g.strokeRect(PAD - 1.5, PAD - 1.5, E.SIZE * TILE + 3, E.SIZE * TILE + 3);
    g.save();
    g.globalAlpha = 0.1;
    g.font = "bold 120px KaiTi, STKaiti, serif";
    g.fillStyle = "#5a4020"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("馬刀", PAD + 3.5 * TILE, PAD + 3.5 * TILE);
    g.restore();
  }

  function fxLevel() { return SAVE.settings.fx || "full"; }

  function startRaf() {
    if (rafOn) return;
    rafOn = true;
    let last = performance.now();
    const cv = $("#battle-canvas");
    cv.width = CS; cv.height = CS;
    const ctx = cv.getContext("2d");
    function frame(now) {
      if (!rafOn) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      draw(ctx, dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function stopRaf() { rafOn = false; }

  function draw(ctx, dt) {
    if (!bgCanvas) return;
    ctx.clearRect(0, 0, CS, CS);
    ctx.drawImage(bgCanvas, 0, 0);
    if (!battle) return;
    ctx.save();
    if (shakeT > 0 && fxLevel() !== "off") {
      shakeT -= dt * 2.4;
      const m = shakeMag * Math.max(0, shakeT);
      ctx.translate((Math.random() - .5) * m, (Math.random() - .5) * m);
    }
    const speedK = [1, 0.6, 0.3][SAVE.settings.speed - 1] || 1;

    const p = battle.player;
    if (battle._playerPhaseActive && p.alive && p.offField <= 0 && mode === null && !checkAutoEnd()) {
      const reach = battle._reachable(p, battle.moveRange(p));
      ctx.fillStyle = "rgba(80,140,70,.30)";
      for (const key of reach.keys) {
        const [r, c] = key.split(",").map(Number);
        if (battle.unitAt(r, c) || (r === p.r && c === p.c)) continue;
        dot(ctx, PAD + c * TILE + TILE / 2, PAD + r * TILE + TILE / 2, 10);
      }
    }
    if (mode === "knife" || mode === "horse" || mode === "skill" || mode === "drive") {
      const t = performance.now() / 300;
      const targets = battle.opponentsOf(p).filter(f =>
        mode === "knife" ? E.adj(p, f) :
        mode === "horse" ? (E.isWall(p.r, p.c) && E.isWall(f.r, f.c) && E.manh(p, f) <= 3) :
        mode === "drive" ? (!E.isWall(p.r, p.c) && !E.isWall(f.r, f.c) && E.adj(p, f)) :
        chebSkillRange(p, f));
      for (const f of targets) {
        const pos = uPos(f);
        ctx.strokeStyle = "rgba(200,50,40," + (0.55 + 0.4 * Math.sin(t)) + ")";
        ctx.lineWidth = 3.5;
        ctx.strokeRect(pos.x - 32, pos.y - 32, 64, 64);
      }
    }

    const order = [...battle.units].sort((a, b) => (a.side === "player" ? 1 : 0) - (b.side === "player" ? 1 : 0));
    for (const u of order) {
      if (!u.alive || u.offField > 0) continue;
      u.rx += (u.c - u.rx) * Math.min(1, dt * 8 / speedK);
      u.ry += (u.r - u.ry) * Math.min(1, dt * 8 / speedK);
      if (u.flash > 0) u.flash -= dt * 3;
      let px = PAD + u.rx * TILE + TILE / 2, py = PAD + u.ry * TILE + TILE / 2;
      if (u.flash > 0) {
        px += Math.sin(u.flash * 40) * 5 * u.flash;
      }
      if (u._lunge) {
        u._lunge.t -= dt * 5;
        if (u._lunge.t <= 0) delete u._lunge;
        else { const k = Math.sin(u._lunge.t * Math.PI) * 16; px += u._lunge.dx * k; py += u._lunge.dy * k; }
      }
      ctx.fillStyle = "rgba(60,40,20,.18)";
      ctx.beginPath(); ctx.ellipse(px, py + 26, 26, 8, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 29, 0, 7);
      ctx.fillStyle = u.flash > 0 && Math.sin(u.flash * 50) > 0 ? "#ffffff" : u.ch.color;
      ctx.fill();
      ctx.lineWidth = u.side === "player" ? 4.5 : 3;
      ctx.strokeStyle = u.side === "player" ? "#d8a11f" : ((u.side === "ally" ? "#3a7d46" : "#6e2318"));
      ctx.stroke();
      if (u.st.bloodlust > 0) {
        ctx.strokeStyle = "rgba(255,90,90," + (0.35 + 0.3 * Math.sin(performance.now() / 140)) + ")";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px, py, 33, 0, 7); ctx.stroke();
      }
      if (u.st.shield > 0) {
        ctx.strokeStyle = "rgba(110,180,230,.8)";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px, py, 33, -2.4, -0.7); ctx.stroke();
      }
      ctx.font = "bold 30px KaiTi, STKaiti, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 3;
      ctx.strokeText(u.ch.glyph, px, py + 1);
      ctx.fillText(u.ch.glyph, px, py + 1);
      const hw = 56, hpc = Math.max(0, u.hp / u.maxhp);
      if (u.hpGhost === undefined) u.hpGhost = u.hp;
      if (u.hp < u.hpGhost) u.hpGhost = Math.max(u.hp, u.hpGhost - dt * 7);
      else u.hpGhost = u.hp;
      const ghc = Math.max(0, u.hpGhost / u.maxhp);
      ctx.fillStyle = "rgba(43,38,34,.75)";
      ctx.fillRect(px - hw / 2 - 1, py + 34, hw + 2, 8);
      ctx.fillStyle = "#e8ddc8";
      ctx.fillRect(px - hw / 2, py + 35, hw * ghc, 6);
      ctx.fillStyle = hpc > 0.3 ? "#6aa84f" : "#cc4125";
      ctx.fillRect(px - hw / 2, py + 35, hw * hpc, 6);
      ctx.font = "13px serif";
      let bx = px + 20;
      if (u.hasKnife) { ctx.fillStyle = "#ffd98a"; ctx.fillText("刀", bx, py - 26); bx -= 15; }
      if (u.hasHorse) { ctx.fillStyle = "#d8c8ff"; ctx.fillText("马", bx, py - 26); }
      let sy = py - 40;
      ctx.font = "12px serif";
      if (u.st.poison > 0) { ctx.fillStyle = "#b06ad0"; ctx.fillText("毒" + u.st.poison, px, sy); sy -= 13; }
      if (u.st.bloodlust > 0) { ctx.fillStyle = "#ff5a5a"; ctx.fillText("祭", px, sy); sy -= 13; }
      if (u.st.skip > 0) { ctx.fillStyle = "#8a7a3a"; ctx.fillText("晕", px, sy); sy -= 13; }
      if (u.st.seal > 0) { ctx.fillStyle = "#666"; ctx.fillText("封", px, sy); sy -= 13; }
    }

    for (const u of battle.units) {
      if (!u.alive || u.offField <= 0) continue;
      const pos = uPos(u);
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#8a7a58"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 22, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 15px KaiTi, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#6a5a3a";
      ctx.fillText("返家", pos.x, pos.y);
      ctx.globalAlpha = 1;
    }

    const hu = hoverUnit();
    if (hu && hu.alive) {
      const pos = uPos(hu);
      ctx.strokeStyle = "rgba(43,38,34,.6)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 34, 0, 7); ctx.stroke();
    }

    const FX = fxLevel();
    if (FX === "off") { slashes.length = 0; projectiles.length = 0; rings.length = 0; ghosts.length = 0; particles.length = 0; }
    else if (FX === "lite" && particles.length > 40) particles.length = 40;
    for (let i = slashes.length - 1; i >= 0; i--) {
      const sl = slashes[i];
      sl.t -= dt * 3.2;
      if (sl.t <= 0) { slashes.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(sl.x, sl.y); ctx.rotate(sl.a + 0.6);
      ctx.strokeStyle = "rgba(242,234,216," + sl.t.toFixed(2) + ")";
      ctx.lineWidth = 4 * sl.t + 1;
      ctx.beginPath(); ctx.arc(0, 0, 26, -0.9, 0.9); ctx.stroke();
      ctx.strokeStyle = "rgba(166,58,43," + (sl.t * 0.8).toFixed(2) + ")";
      ctx.lineWidth = 2 * sl.t + 0.5;
      ctx.beginPath(); ctx.arc(0, 0, 31, -0.7, 0.7); ctx.stroke();
      ctx.restore();
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.t += dt * 3.4;
      if (pr.t >= 1) {
        spawnParticles(pr.tx, pr.ty, { n: 9, colors: [pr.color, "#f2ead8"], speed: 100, life: 0.4 });
        projectiles.splice(i, 1); continue;
      }
      const x = pr.x + (pr.tx - pr.x) * pr.t, y = pr.y + (pr.ty - pr.y) * pr.t - Math.sin(pr.t * Math.PI) * 14;
      ctx.save();
      if (pr.style === "beam") {
        ctx.strokeStyle = pr.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      } else if (pr.style === "arrow") {
        const ang = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = pr.color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(7, 0); ctx.stroke();
        ctx.fillStyle = pr.color; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.fill();
      } else if (pr.style === "paper") {
        ctx.translate(x, y); ctx.rotate(Math.sin(pr.t * 9) * 0.5);
        ctx.fillStyle = pr.color; ctx.fillRect(-6, -8, 12, 16);
        ctx.strokeStyle = "rgba(90,70,40,.5)"; ctx.strokeRect(-6, -8, 12, 16);
      } else if (pr.style === "wave") {
        ctx.strokeStyle = pr.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke();
      } else if (pr.style === "ring") {
        ctx.strokeStyle = pr.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke();
      } else {
        ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t -= dt * 2.6; r.r += dt * 60;
      if (r.t <= 0) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = r.color; ctx.globalAlpha = r.t * 0.8; ctx.lineWidth = 3 * r.t + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i];
      g.t -= dt; g.y -= dt * 12;
      if (g.t <= 0) { ghosts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, g.t) * 0.55;
      ctx.fillStyle = g.color;
      ctx.beginPath(); ctx.arc(g.x, g.y, 27, 0, 7); ctx.fill();
      ctx.font = "bold 28px KaiTi, STKaiti, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.fillText(g.glyph, g.x, g.y + 1);
      ctx.globalAlpha = 1;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const pa = particles[i];
      pa.t += dt;
      if (pa.t >= pa.life) { particles.splice(i, 1); continue; }
      pa.vy += pa.grav * dt;
      pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      ctx.globalAlpha = Math.max(0, 1 - pa.t / pa.life);
      ctx.fillStyle = pa.color;
      ctx.fillRect(pa.x - pa.size / 2, pa.y - pa.size / 2, pa.size, pa.size);
      ctx.globalAlpha = 1;
    }

    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t -= dt * 0.9; f.dy -= dt * 34;
      if (f.t <= 0) { floaters.splice(i, 1); continue; }
      const pos = f.u ? uPos(f.u) : { x: CS / 2, y: CS / 2 };
      ctx.font = "bold 22px KaiTi, serif";
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, f.t * 1.6);
      ctx.fillStyle = f.color;
      ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 3;
      ctx.strokeText(f.text, pos.x, pos.y - 44 + f.dy);
      ctx.fillText(f.text, pos.x, pos.y - 44 + f.dy);
      ctx.globalAlpha = 1;
    }
    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
      else {
        ctx.font = "bold 44px KaiTi, serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.min(1, banner.t);
        ctx.fillStyle = "rgba(166,58,43,.92)";
        ctx.strokeStyle = "rgba(255,244,220,.9)"; ctx.lineWidth = 6;
        ctx.strokeText(banner.text, CS / 2, CS / 2 - 90);
        ctx.fillText(banner.text, CS / 2, CS / 2 - 90);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    for (let i = vignettes.length - 1; i >= 0; i--) {
      const v = vignettes[i];
      if (fxLevel() === "off") { vignettes.length = 0; break; }
      v.t -= dt * 1.6;
      if (v.t <= 0) { vignettes.splice(i, 1); continue; }
      const g = ctx.createRadialGradient(CS / 2, CS / 2, CS * 0.28, CS / 2, CS / 2, CS * 0.72);
      g.addColorStop(0, "rgba(" + v.rgb + ",0)");
      g.addColorStop(1, "rgba(" + v.rgb + "," + (v.t * 0.4).toFixed(3) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CS, CS);
    }
  }

  function chebSkillRange(p, f) {
    const sk = battle.skillOf(p, 0);
    if (!sk) return false;
    const rng = sk.range || 1;
    return Math.max(Math.abs(p.r - f.r), Math.abs(p.c - f.c)) <= rng;
  }

  function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

  function tileFromEvent(ev) {
    const cv = $("#battle-canvas");
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (CS / rect.width);
    const y = (ev.clientY - rect.top) * (CS / rect.height);
    const c = Math.floor((x - PAD) / TILE), r = Math.floor((y - PAD) / TILE);
    if (r < 0 || c < 0 || r >= E.SIZE || c >= E.SIZE) return null;
    return { r, c };
  }
  function hoverUnit() {
    if (!hoverTile || !battle) return null;
    return battle.unitAt(hoverTile.r, hoverTile.c);
  }

  const IS_TOUCH = (typeof window !== "undefined") && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  function bindCanvas() {
    const cv = $("#battle-canvas");
    if (cv) cv.style.touchAction = "manipulation";
    if (IS_TOUCH) return bindCanvasTouch(cv);
    cv.addEventListener("mousemove", ev => {
      hoverTile = tileFromEvent(ev);
      const u = hoverUnit();
      const tip = $("#tooltip");
      if (u && battle) {
        tip.style.display = "block";
        tip.style.left = (ev.clientX + 14) + "px";
        tip.style.top = (ev.clientY + 14) + "px";
        tip.innerHTML = '<div class="tt-n">' + u.ch.name + "（" + u.ch.hao + "）</div>血 " + u.hp + "/" + u.maxhp
          + "　行动 " + u.apNow + "　" + (u.hasKnife ? "持刀 " : "") + (u.hasHorse ? "有马 " : "")
          + "<br>被动「" + u.ch.passive.name + "」<br><span style='color:#ddd'>" + u.ch.passive.desc + "</span>"
          + (u.ch.skill ? "<br>技「" + u.ch.skill.name + "」<br><span style='color:#ddd'>" + u.ch.skill.desc + "</span>" : "");
      } else tip.style.display = "none";
    });
    cv.addEventListener("mouseleave", () => { hoverTile = null; $("#tooltip").style.display = "none"; });
    cv.addEventListener("click", async ev => {
      if (!battle || battle.over || !battle._playerPhaseActive) return;
      const tile = tileFromEvent(ev);
      if (!tile) return;
      const p = battle.player;
      const target = battle.unitAt(tile.r, tile.c);
      if (mode === "knife") {
        if (target && p.hasKnife && E.adj(p, target) && battle.opponentsOf(p).includes(target)) {
          mode = null;
          await battle.doKnife(p, target);
          afterPlayerAction();
          return;
        }
        mode = null; updateAll(); return;
      }
      if (mode === "horse") {
        if (target && p.hasHorse && E.isWall(p.r, p.c) && E.isWall(target.r, target.c) && E.manh(p, target) <= 3 && battle.opponentsOf(p).includes(target)) {
          mode = null;
          await battle.doHorse(p, target);
          afterPlayerAction();
          return;
        }
        mode = null; updateAll(); return;
      }
      if (mode === "drive") {
        if (target && p.hasHorse && !E.isWall(p.r, p.c) && !E.isWall(target.r, target.c) && E.adj(p, target) && battle.opponentsOf(p).includes(target)) {
          mode = null;
          await battle.doDrive(p, target);
          afterPlayerAction();
          return;
        }
        mode = null; updateAll(); return;
      }
      if (mode === "skill") {
        if (target && battle.opponentsOf(p).includes(target) && chebSkillRange(p, target)) {
          mode = null;
          await battle.doSkill(p, 0, target);
          afterPlayerAction();
          return;
        }
        mode = null; updateAll(); return;
      }
      if (target) return;
      const reach = battle._reachable(p, battle.moveRange(p));
      const key = tile.r + "," + tile.c;
      if (reach.keys.includes(key) && !battle.unitAt(tile.r, tile.c)) {
        await battle.doMove(p, tile.r, tile.c);
        afterPlayerAction();
      }
    });
    cv.addEventListener("contextmenu", ev => { ev.preventDefault(); mode = null; updateAll(); });
  }

  function bindCanvasTouch(cv) {
    cv.addEventListener("pointerup", async ev => {
      if (!battle || battle.over || !battle._playerPhaseActive) return;
      const tile = tileFromEvent(ev);
      if (!tile) return;
      const p = battle.player;
      const target = battle.unitAt(tile.r, tile.c);
      if (mode === "knife" && target && E.adj(p, target) && battle.opponentsOf(p).includes(target)) {
        mode = null; await battle.doKnife(p, target); afterPlayerAction(); return;
      }
      if (mode === "horse" && target && p.hasHorse && E.isWall(p.r, p.c) && E.isWall(target.r, target.c)
          && E.manh(p, target) <= 3 && battle.opponentsOf(p).includes(target)) {
        mode = null; await battle.doHorse(p, target); afterPlayerAction(); return;
      }
      if (mode === "drive" && target && p.hasHorse && !E.isWall(p.r, p.c) && !E.isWall(target.r, target.c) && E.adj(p, target) && battle.opponentsOf(p).includes(target)) {
        mode = null; await battle.doDrive(p, target); afterPlayerAction(); return;
      }
      if (mode === "skill" && target && battle.opponentsOf(p).includes(target) && chebSkillRange(p, target)) {
        mode = null; await battle.doSkill(p, 0, target); afterPlayerAction(); return;
      }
      if (mode) { mode = null; updateAll(); return; }
      if (target) return;
      const reach = battle._reachable(p, battle.moveRange(p));
      if (reach.keys.includes(tile.r + "," + tile.c) && !battle.unitAt(tile.r, tile.c)) {
        await battle.doMove(p, tile.r, tile.c);
        afterPlayerAction();
      }
    });
  }

  /* ---------------- 结算：交给世界侧的钩子渲染，然后回校园 ---------------- */
  function onBattleEnd(b) {
    battle = b;
    endPlayerPhase();
    updateAll();
    const win = b.result === "win";
    if (win) AU.victory(); else AU.defeat();
    setTimeout(async () => {
      const hooks = window.SJI_BATTLE_HOOKS || {};
      let scn = null;
      if (b.cfg && b.cfg.stageId && window.SJI_SCENES) scn = window.SJI_SCENES.stages[b.cfg.stageId];
      try {
        if (win && b.cfg.victoryScene) await showDialogue(b.cfg.victoryScene);
        else if (!win && b.cfg.defeatScene) await showDialogue(b.cfg.defeatScene);
        else if (scn && scn.victory && win) await showDialogue(scn.victory);
        else if (scn && scn.defeat && !win) await showDialogue(scn.defeat);
      } catch (e) { console.error(e); }
      const extra = (hooks.onResult) ? hooks.onResult(b) : "";
      showResult(b, extra);
    }, window.SJI_DEBUG && window.SJI_DEBUG.fast ? 150 : 1300);
  }

  function showResult(b, extraHtml) {
    const win = b.result === "win";
    $("#result-body").innerHTML =
      '<div class="result-seal seal' + (win ? "" : " lose") + '">' + (win ? "胜" : "败") + "</div>" +
      '<div class="result-title">' + (win ? "活者为王" : (b.result === "timeout" ? "高考终了" : "出师未捷")) + "</div>" +
      '<div class="result-stats">回合：' + b.round + "　·　击破：" + b.stats.kills + "　·　用技：" + (b.stats.usedSkill ? "有" : "无") + "　·　血祭：" + (b.stats.usedBlood ? "有" : "无") + "</div>" +
      (extraHtml || "") +
      '<div class="btnrow" style="justify-content:center;margin-top:18px">' +
      '<button class="btn" id="r-retry">重整旗鼓</button>' +
      '<button class="btn primary" id="r-menu">回校园</button></div>';
    $("#r-retry").onclick = () => {
      AU.click();
      const cfg = Object.assign({}, b.cfg);
      delete cfg.introScene;
      startBattle(cfg, onEndCb);
    };
    $("#r-menu").onclick = () => {
      AU.click();
      if (window.SJI_BATTLE_HOOKS && window.SJI_BATTLE_HOOKS.onDone) window.SJI_BATTLE_HOOKS.onDone(b);
      hideOverlay();
      closeModal();
    };
    showScreenResult();
  }
  function showScreenResult() {
    $("#battle-stage").classList.add("hidden");
    $("#battle-result").classList.remove("hidden");
    stopRaf();
  }
  function showScreenStage() {
    $("#battle-result").classList.add("hidden");
    $("#battle-stage").classList.remove("hidden");
  }

  /* ---------------- 启动绑定 ---------------- */
  function boot() {
    bindActions();
    bindCanvas();
    $("#b-speed").textContent = "速×" + SAVE.settings.speed;
    $("#b-mute").textContent = SAVE.settings.sfx ? "音" : "默";
    AU.setSfx(SAVE.settings.sfx !== false);
  }

  return {
    boot, toast, startBattle, onLog, onState: updateAll,
    rpsRound, playerPhase, pickBoon, onBattleEnd,
    fxFloat, fxHit, fxStatus, snap, fxAttack, fxDeath, fxVignette,
    banner: showBanner, showDialogue, speakerOf,
    showScreenStage,
    get battle() { return battle; },
    get active() { return window.BATTLE_ACTIVE === true; },
  };
})();

/* 全局命名空间（替代马刀 main.js）：设置与调试钩子 */
window.SJI = {
  get settings() { return window.SJI_SAVE.settings; },
  battle: null
};
document.addEventListener("DOMContentLoaded", () => {
  try { window.SJI_UI.boot(); } catch (e) { console.error("战斗层启动失败:", e); }
});
// 首次交互解锁战斗音效（浏览器手势策略）
document.addEventListener("pointerdown", () => { window.SJI_AUDIO.unlock(); }, { once: true });
window.SJI_DEBUG = {
  fast: false,
  skipScenes: false,
  autoRps: false,
  get battle() { return window.SJI.battle; },
  killEnemies() {
    const b = window.SJI.battle;
    if (!b || b.over) return "no battle";
    b.living("enemy").slice().forEach(u => b.rawHurt(u, u.hp, "天降正义"));
    return "ok";
  },
  healPlayer(n) {
    const b = window.SJI.battle;
    if (b) { b.player.hp = Math.min(b.player.maxhp, b.player.hp + (n || 99)); b.pushLog("（神迹）「" + b.player.ch.hao + "」回复了血。"); return "ok"; }
    return "no battle";
  },
  giveAll() {
    const b = window.SJI.battle;
    if (!b) return "no battle";
    b.player.hasKnife = true; b.player.hasHorse = true;
    return "ok";
  }
};
