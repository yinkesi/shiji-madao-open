/* ============================================================
 * 实验史记·马刀行 —— 战斗覆盖层（自马刀风云 ui.js 解耦）
 * 世界探索之上覆盖的马刀战棋：Canvas 渲染 / HUD / 猜拳 / 对话 / 结算。
 * 引擎（SJI_ENGINE）通过 window.SJI_UI 钩子与本模块通信。
 * ============================================================ */
/* ============================================================
 * 【新手导读】window.SJI_UI 的正式提供者 —— 战斗覆盖层
 *
 * 【这个文件是干嘛的】
 * 一开打就全屏盖在校园画面上的「战场」界面：Canvas 棋盘渲染、血条按钮等 HUD、
 * 猜拳弹窗、买刀买马、对话气泡、胜负结算。它只管「表现」（画画+收玩家输入），
 * 不管规则（伤害怎么算、AI 怎么走都归引擎）。
 *
 * 【架构位置】三方分工与钩子契约：
 *   · 引擎 js/battle/engine.js（window.SJI_ENGINE）：只算数不画画。它在开局/回合/
 *     受伤等时机通过 window.SJI_UI.xxx(...) 钩子请本模块做表现，比如
 *     SJI_UI.fxHit(谁, 几点) 弹飘字、await SJI_UI.rpsRound(battle) 弹猜拳框、
 *     await SJI_UI.playerPhase(battle) 把操作权交给玩家（玩家点了「结束回合」，
 *     这个 Promise 才算完成，引擎继续跑）。
 *   · 世界侧 js/main.js：管校园探索。它调 SJI_UI.startBattle(cfg) 发起战斗；打完
 *     后本模块反过来调世界侧备好的 window.SJI_BATTLE_HOOKS.onResult / onDone
 *     （发奖励、存档、回校园）。window.BATTLE_ACTIVE=true 期间世界输入让位，
 *     两边互不打架。
 *   · 出身：原版《马刀风云》的 js/battle/ui.js（该文件已不被 index.html 加载，
 *     仅留参考），本文件是它拆掉自有主菜单后改造成的「覆盖层」版本。
 *
 * 【暴露的全局名】
 *   window.SJI_UI —— 对外接口，就是文件末尾 IIFE return 的那个对象；
 *   window.SJI   —— 顺手建的全局命名空间，引擎靠 SJI.settings 读播放速度；
 *   window.SJI_DEBUG —— 控制台调试工具（F12 里可直接干预战局）。
 *
 * 【新手阅读提示】
 *   · 全文件是一个 IIFE（定义即执行的函数），中间的函数都是内部零件，外界只能用
 *     return 出去的名字；各 <script> 按固定顺序共享全局作用域，没有 import/export。
 *   · 大坑：别的文件顶层写 const X = ... 时 X 不会挂到 window 上，跨文件用裸名 X
 *     前得 typeof X !== 'undefined' 判活（见 speakerOf 里对 PEOPLE_BY_ID 的防法）。
 *   · 战场参数在 cfg.stage：hpScale=敌人血量倍率、restFull=波次间回满血、
 *     blocked=障碍格坐标、terrain=障碍物画法（桌子/柜子/柱子…）。
 * ============================================================ */
window.SJI_UI = (function () {
  "use strict";
  // 把常用命名空间抓成本地短名：D=剧本数据 E=战斗引擎 SAVE=存档 AU=战斗音效（index.html 已先行加载）。
  const D = window.SJI_DATA, E = window.SJI_ENGINE, SAVE = window.SJI_SAVE, AU = window.SJI_AUDIO;
  // CFG=全局配置，GRID 是棋盘几何：TILE=每格边长、PAD=棋盘四周留白、CS=画布总边长。
  const CFG = window.SJI_CONFIG, GRID = CFG.GRID;
  const TILE = GRID.TILE, PAD = GRID.PAD, CS = GRID.CS;

  /* ---------- 模块内部状态：外界碰不到，只能通过末尾 return 出去的方法间接读写 ---------- */
  let battle = null;
  let mode = null;            // null | 'knife' | 'horse' | 'skill'
  let hoverTile = null;
  // floaters=头顶飘字（「-2」「+3」这类），banner=棋盘中央的大字提示；都是攒起来随帧老化消失。
  let floaters = [], banner = null;
  // rafOn=requestAnimationFrame 动画循环的开关；bgCanvas=预绘好的背景图（见 buildBG）。
  let rafOn = false, bgCanvas = null;
  let onEndCb = null;         // 战斗结束回调（世界侧注入）

  // 两个极简 DOM 工具：$ 取第一个匹配元素，$$ 取全部并展开成真数组（jQuery 风格惯用缩写）。
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ---------------- 覆盖层 ---------------- */
  /* ---------- 覆盖层开关：#battle 是 index.html 里盖在世界画面上的全屏 div ---------- */
  function showOverlay() {
    $("#battle").classList.remove("hidden");
    $("#battle").classList.add("on");
    // 立全局旗子：世界侧见到 BATTLE_ACTIVE=true 就暂停自己的键盘鼠标响应，让位给战场。
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
    // 弹层串行的核心：modalChain 当「队尾」，新弹层用 then 排在它后面，保证猜拳/三选一/
    // 对话一个放完再放下一个。then(run, run)=前面的弹层无论正常关闭还是出错都接着排队。
  function queueModal(open) {
    const run = () => Promise.resolve().then(open);
    const p = modalChain.then(run, run);
    modalChain = p.then(() => {}, () => {});
    return p;
  }

  // 打开通用弹窗：把 HTML 塞进 #modal-box、点亮遮罩。返回 box 是为了接下来往里绑按钮事件。
  function modal(html) {
    const mask = $("#modal-mask"), box = $("#modal-box");
    box.innerHTML = html;
    mask.classList.add("on");
    mask.onclick = null;
    return box;
  }
  function closeModal() { $("#modal-mask").classList.remove("on"); }

  // 拼一小段 HTML：角色的「头像牌」（色块底+单字），用在弹窗说话人和敌人列表里。
  function face(ch, extraCls) {
    return '<span class="tokenface ' + (extraCls || "") + '" style="background:' + ch.color + '">' + ch.glyph + "</span>";
  }

  /* ---------------- 说话人解析（马刀剧本 + 世界人物通吃） ---------------- */
  // 剧本对白里的中文缩写 → 世界侧角色 id 的对照表（作者写对白时可以偷懒只写一个字）。
  const SHORTHAND = {
    "史": "yinkesi", "大哥": "dage", "神人": "shenren", "神": "shenren", "仙女": "xiannv",
    "上": "hanxiao", "豪": "luhao", "铭": "shaoming", "慧": "xinhui", "问": "wonder",
    "斌": "wenbin", "润": "yurun", "震": "wanzhen", "波": "shibo", "荣": "weirong",
    "法": "qinfa", "国": "chongguo", "兵": "weibing", "头": "touge", "帆": "lifan",
    "琛": "zichen", "川": "xiaochuan", "因": "guyin", "呱": "guayu", "蛙": "yiran",
    "展": "dazhan", "怡": "keai", "羚": "limo", "东": "xiangdong", "生": "mob",
    "翔": "shengxiang", "岳": "qiyue", "烨": "ziye", "奇": "lianqi",
  };
  // 不在名册里的路人角色的兜底配色盘（speakerOf 里按 id 哈希取色）。
  const PALETTE = ["#a63a2b", "#4a6d9c", "#2e8b74", "#8c5a3c", "#7d4a6b", "#5a8c46", "#8f8f5c", "#555577"];
  // 把「谁在说话」解析成 {名字, 称号, 单字头像, 颜色}：先查剧本缩写表，再查世界侧人物
  // 表 PEOPLE_BY_ID / MINOR_FIGS。它们是别的文件顶层的 const、不挂 window，所以必须
  // 用 typeof 判活——这就是本项目「跨文件裸名 + typeof 判活」的典型写法。
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
  // 世界侧调 SJI_UI.startBattle(cfg) 发起战斗：cfg 带敌人名单、难度、战场参数 cfg.stage、
  // 开场对话 introScene 等。第二参 onEnd 本文件只存不用（重开时原样回传），真正
  // 「打完回世界」走文件末尾的 SJI_BATTLE_HOOKS.onDone（见 onBattleEnd / showResult）。
  function startBattle(cfg, onEnd) {
    mode = null; floaters = []; banner = null;
    onEndCb = onEnd || null;
    Blades.registerChar();
    // 规则与数值全在引擎的 Battle 类里；UI 只握住实例句柄，用来读数值、画画。
    battle = new E.Battle(cfg);
    // 挂到全局命名空间：控制台调试器（SJI_DEBUG）与世界侧都能拿到当前战局。
    window.SJI.battle = battle;
    Blades.applyBoons(battle);
    $("#battle-title").textContent = cfg.title || "马刀场";
    $("#battle-log").innerHTML = "";
    buildBG();
    startRaf();
    updateAll();
    showScreenStage();
    showOverlay();
    // 开场流程：先播开场对话（若有），再让引擎 run()。run 返回 Promise，过程中引擎会
    // 反复回调本文件的钩子；catch 兜底：出错弹个 toast，页面不至于白屏崩掉。
    const boot = async () => {
      if (cfg.introScene) await showDialogue(cfg.introScene);
      battle.run().catch(err => { console.error(err); toast("战场出了差池：" + err.message); });
    };
    boot();
  }

  /* ---------------- HUD ---------------- */
  // 战斗日志：引擎每 pushLog 一句就调这里——追加一行到日志框并自动滚到底。
  function onLog(s) {
    const el = $("#battle-log");
    if (!el) return;
    const div = document.createElement("div");
      // 按内容分级样式：「——」开头的是系统消息，含「倒下/血祭」的是强调消息（CSS 上变色）。
    if (s.indexOf("——") === 0) div.className = "sys";
    else if (s.indexOf("倒下") >= 0 || s.indexOf("血祭") >= 0) div.className = "em";
    div.textContent = s;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  /* ---------- HUD 全量刷新：把引擎里 battle 的最新数值抄写到各个 DOM 元素 ----------
   * 本文件更新界面用「每次重建 innerHTML」的土办法，直白但够用，新手最容易看懂。 */
  function updateAll() {
    if (!battle) return;
    const p = battle.player;
    const pc = $("#pc-face");
    pc.style.background = p.ch.color;
    pc.textContent = p.ch.glyph;
    $("#pc-name").innerHTML = "<b>" + p.ch.name + "</b>（" + p.ch.hao + "）";
    // 血条：内层 div 宽度=血量百分比；血量不足三成时加 .low / .critical 类（告警交给 CSS）。
    const hpPct = Math.max(0, p.hp / p.maxhp * 100);
    const inner = $("#pc-hp-in");
    inner.style.width = hpPct + "%";
    inner.classList.toggle("low", p.hp <= p.maxhp * 0.3);
    if ($("#pc-hp-ghost")) $("#pc-hp-ghost").style.width = hpPct + "%";
    $("#player-card").classList.toggle("critical", p.alive && p.hp <= p.maxhp * 0.3);
    $("#pc-hp-tx").textContent = "血 " + Math.max(0, p.hp) + " / " + p.maxhp;
    const pips = $("#ap-pips");
    // 行动点（AP）：有几动就摆几个小圆点。老套路：先清空容器再重摆。
    pips.innerHTML = "";
    for (let i = 0; i < Math.max(p.apNow, 0); i++) {
      const d = document.createElement("div"); d.className = "ap-pip on"; pips.appendChild(d);
    }
    const chips = $("#pc-st");
    chips.innerHTML = "";
    const addChip = (txt, color) => { const s = document.createElement("span"); s.className = "st-chip"; s.style.background = color; s.textContent = txt; chips.appendChild(s); };
    // 状态角标：刀/马/毒/盾…有哪个摆哪个，一个彩色小标签。
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
    // 接下来一排 .disabled=... 是「按钮何时点不了」的规则汇总（要和引擎判定保持一致）：
    // 没刀不能砍、没行动点不能动、没轮到玩家（phaseLocked）全锁、「锁门」特则禁马踢等。
    $("#b-knife").disabled = p.hasKnife || (!(!phaseLocked() && p.apNow > 0) && p.charId !== "lifan");
    $("#b-knife").textContent = p.hasKnife ? "已持刀" : "购刀" + (p.charId === "lifan" ? "·免动" : "·1动");
    $("#b-horse").disabled = p.hasHorse || phaseLocked() || p.apNow <= 0;
    $("#b-horse").textContent = p.hasHorse ? "已购马" : "购马·1动";
    $("#b-attack").disabled = phaseLocked() || !p.hasKnife || p.apNow <= 0 || p.st.seal > 0 || !battle.opponentsOf(p).some(f => E.adj(p, f));
    $("#b-horseatk").disabled = phaseLocked() || !p.hasHorse || p.apNow <= 0 || !E.isWall(p.r, p.c) || (battle.rule && battle.rule.id === "suomen") || !battle.opponentsOf(p).some(f => E.isWall(f.r, f.c) && E.manh(p, f) <= 3);
    $("#b-drive").disabled = phaseLocked() || !p.hasHorse || p.apNow <= 0 || E.isWall(p.r, p.c) || (battle.rule && battle.rule.id === "suomen") || !battle.opponentsOf(p).some(f => E.adj(p, f) && !E.isWall(f.r, f.c));
    // 禁用原因提示（tooltip）：让玩家知道「为什么用不了」
    const seized = p.st.seal > 0 || p.st.disarm > 0;
    $("#b-attack").title = seized ? "缴械中：本回合不能刀击" : (!p.hasKnife ? "尚未持刀：先购刀" : (!battle.opponentsOf(p).some(f => E.adj(p, f)) ? "无相邻敌人" : ""));
    $("#b-horseatk").title = !p.hasHorse ? "尚未购马" : (!E.isWall(p.r, p.c) ? "你不在城墙上" : (!battle.opponentsOf(p).some(f => E.isWall(f.r, f.c) && E.manh(p, f) <= 3) ? "墙上无三格内的敌人" : (battle.rule && battle.rule.id === "suomen") ? "锁门特则：马踢封禁" : ""));
    $("#b-drive").title = !p.hasHorse ? "尚未购马" : (E.isWall(p.r, p.c) ? "你在城墙上（驱赶仅限空地）" : ((battle.rule && battle.rule.id === "suomen") ? "锁门特则：封禁" : (!battle.opponentsOf(p).some(f => E.adj(p, f) && !E.isWall(f.r, f.c)) ? "无相邻的空地敌人" : "")));
    $("#b-blood").disabled = phaseLocked() || p.apNow <= 0 || p.hp < 2;
    const undoN = (p._undo && p._undo.length) || 0;
    $("#b-undo").disabled = phaseLocked() || undoN === 0;
    $("#b-undo").textContent = undoN ? "撤销移动(" + undoN + ")" : "撤销移动";
    $("#b-wait").disabled = phaseLocked();
    // 敌人列表
    const elist = $("#enemy-list");
    elist.innerHTML = "";
      // 每个敌人拼一行 HTML：头像、称号、行动点小点、血条；阵亡的加 .dead 类变灰。
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
    renderRareChips();
    if ($("#ai-label")) {
        // 顶部小字：难度与 AI 风格文案，按当前战局的 diff / aiAggr 查表拼出来。
      const nm = CFG.AI_LABEL || {};
      const dn = { easy: "简单", normal: "普通", hard: "困难", extreme: "极难", nightmare: "噩梦" };
      const diffTxt = dn[battle.diff] || "普通";
      const aiTxt = (battle.diff === "nightmare") ? "最优(强制)" : ((battle.diff === "extreme") ? "狂攻(强制)" : (nm[battle.aiAggr] || "主动"));
      $("#ai-label").textContent = diffTxt + " · AI " + aiTxt;
    }
  }

  /* 稀有刀卡携带选择器（战场左上角）：每场只能携带一张，点选即时切换 */
  function renderRareChips() {
    const box = document.getElementById("rare-chips");
    if (!box) return;
    const owned = (window.Blades && Blades.rareList()) || [];
    if (!owned.length) { box.innerHTML = ""; return; }
    const carried = Blades.selectedRare();
    box.innerHTML = '<span class="rare-chips-label">携带</span>' + owned.map(id => {
      const r = Blades.RARE_BOONS[id];
      if (!r) return "";
      return `<button class="rare-chip ${id === carried ? "on" : ""}" data-rare="${id}" title="${r.desc}">${r.name}</button>`;
    }).join("");
    box.querySelectorAll(".rare-chip").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (battle && !battle.over) Blades.switchRare(battle, btn.dataset.rare);
        else Blades.switchRare(null, btn.dataset.rare);
        toast("携带刀卡切换为「" + Blades.RARE_BOONS[btn.dataset.rare].name + "」", "谱");
      };
    });
  }

  // 「现在能不能点按钮」：战斗没开始 / 已结束 / 还没轮到玩家，都算锁死。
  function phaseLocked() { return !battle || battle.over || battle._playerPhaseActive !== true; }

  /* ---------- 玩家回合：引擎 await 本函数，直到玩家收手才放行 ----------
   * 奥妙在 _phaseResolve：把 Promise 的 resolve 暂存到战局对象上，endPlayerPhase()
   * 再调用它——「把放行开关交给别人保管」是异步代码的常见手法。 */
  async function playerPhase(b) {
    battle = b;
    b._playerPhaseActive = true;
    await showBanner("汝之回合", 700);
    if (checkAutoEnd()) { b._playerPhaseActive = false; return; }
    updateAll();
    // 卡在这一行等玩家：resolve 被存进 _phaseResolve，endPlayerPhase() 调用它才继续往下走。
    await new Promise(resolve => { b._phaseResolve = resolve; });
    b._playerPhaseActive = false;
    mode = null;
    updateAll();
  }

  // 行动点耗尽 / 倒下 / 被遣返 / 战斗已分胜负：这些情况回合自动收，不用玩家点按钮。
  function checkAutoEnd() {
    if (!battle) return true;
    const p = battle.player;
    return battle.over || p.apNow <= 0 || !p.alive || p.offField > 0;
  }

  // 玩家每次操作（移动/攻击/买刀…）完成后都走这里：刷新界面 + 检查要不要自动收回合。
  function afterPlayerAction() {
    updateAll();
    if (checkAutoEnd()) endPlayerPhase();
  }
  // 收回合：调用先前暂存的 resolve，把 playerPhase 里的 await 放行。
  function endPlayerPhase() {
    mode = null;
    if (battle && battle._phaseResolve) { const r = battle._phaseResolve; battle._phaseResolve = null; r(); }
  }

  /* ---------------- 行动按钮 ---------------- */
  // arm=进入「选目标」模式（再点一次同按钮可取消）；真正出手发生在画布的点击逻辑里。
  function arm(m) { mode = (mode === m) ? null : m; updateAll(); }
  // 把 HUD 各按钮的 onclick 绑好。只在 boot 时绑一次，之后按钮不换、只换数据。
  function bindActions() {
    $("#b-knife").onclick = async () => { AU.click(); await battle.doBuyKnife(battle.player); afterPlayerAction(); };
    $("#b-horse").onclick = async () => { AU.click(); await battle.doBuyHorse(battle.player); afterPlayerAction(); };
    $("#b-attack").onclick = () => { AU.click(); arm("knife"); };
    $("#b-horseatk").onclick = () => { AU.click(); arm("horse"); };
    $("#b-drive").onclick = () => { AU.click(); arm("drive"); };
      // 技能按钮：需要选目标的技能进入 mode='skill'（再点敌人），无需目标的直接放。
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
      // 认输/离场都先弹确认框，确认了才调引擎 finish("lose") 结算败北。
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
    // 战场快捷键：Esc 取消选目标，空格=结束回合。只在 BATTLE_ACTIVE 时响应。
    document.addEventListener("keydown", ev => {
      if (!window.BATTLE_ACTIVE) return;
      if (ev.key === "Escape" && mode) { mode = null; updateAll(); }
      if (ev.key === " " && battle && battle._playerPhaseActive) { ev.preventDefault(); endPlayerPhase(); }
    });
  }

  /* ---------------- 猜拳 ---------------- */
  // 猜拳三选项：k=内部键名，g=手势 emoji，n=中文名。
  const RPS = [{ k: "rock", g: "✊", n: "石头" }, { k: "scissors", g: "✌", n: "剪刀" }, { k: "paper", g: "✋", n: "布" }];
  /* ---------- 猜拳：引擎开局 await ui.rpsRound(this) 领行动点 ----------
   * 返回 {res:"胜/和/负", ap:2~4}。设置选「自动」就按概率直接随机，否则弹窗让玩家出拳。 */
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
    // 排队开弹窗；返回的 Promise 要等玩家出拳、结果展示完才 resolve（引擎正 await 它）。
    return queueModal(() => new Promise(resolve => {
      modal(
        '<div class="rps-title">猜 拳</div>' +
        '<div class="rps-sub">胜得四动 · 和得三动 · 负得二动</div>' +
        '<div class="rps-btns">' + RPS.map((r, i) => '<button class="rps-btn" data-i="' + i + '"><span class="g">' + r.g + "</span>" + r.n + "</button>").join("") + "</div>" +
        '<div class="rps-vs" id="rps-vs">　</div>' +
        '<div class="rps-result" id="rps-res">　</div>'
      );
      const vs = $("#rps-vs"), res = $("#rps-res");
      // 给三个手势按钮绑点击：点一下走完「对手手势滚动→判定→展示结果」的小演出。
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
      // 调试开关 autoRps：30 毫秒后替玩家随机点一个，用来自动演算。
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
      // 候选池：两个普通增益 + 一个稀有增益，各自洗牌取头部，已拿过的不再出现。
      // sort(() => Math.random() - 0.5) 是「胡乱洗牌」的民间偏方；不够三个拿普通凑。
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
  /* ---------- 剧情对话：逐字打字机效果的弹层，lines=[[说话人, 台词], ...] ----------
   * 返回 Promise：读完最后一行/点跳过/按 Esc 才 resolve，方便外层 await 串场。 */
  function showDialogue(lines) {
    if (window.SJI_DEBUG && window.SJI_DEBUG.skipScenes) return Promise.resolve();
    const runScene = () => new Promise(resolve => {
      const mask = $("#modal-mask"), box = $("#modal-box");
      let idx = 0, typing = null, done = false;
      // finish=收尾：清打字机定时器、摘键盘监听、关弹层，然后 resolve 放行。
      // done 标志保证只收一次：连点、连按导致的重复触发会被直接忽略。
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
      // 渲染一行对话：拼 HTML、点亮遮罩，再开 setInterval 每 22 毫秒多露一个字。
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
        // 点击弹层：字没打完→立即显示整句；打完了→翻下一行（或结束）。
        box.onclick = () => {
          if (typing) { clearInterval(typing); typing = null; tx.textContent = pair[1]; return; }
          idx++;
          if (idx >= lines.length) finish(); else showLine();
        };
      }
      // 键盘也想当鼠标用：空格/回车等效点击弹层，Esc 直接跳过整段。
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
  // 顶部大横幅（「汝之回合」这类）：亮 ms 毫秒自动熄灭；返回 Promise 供 await 等它熄完。
  function showBanner(text, ms) {
    const el = $("#phase-banner");
    el.textContent = text;
    el.classList.add("on");
    return new Promise(r => setTimeout(() => { el.classList.remove("on"); r(); }, (window.SJI_DEBUG && window.SJI_DEBUG.fast ? 60 : ms)));
  }

  // 格子逻辑坐标(r,c) → 画布像素坐标：取该格中心。u.rx/ry 是「显示用坐标」（见 draw 的插值）。
  function uPos(u) {
    return { x: PAD + u.rx * TILE + TILE / 2, y: PAD + u.ry * TILE + TILE / 2 };
  }
  // 往单位头顶塞一条飘字；文本以 + 开头的还顺手撒一把绿色小粒子（回复的仪式感）。
  function fxFloat(u, text, color) {
    floaters.push({ u, text, color, t: 1, dy: 0 });
    if (text && text[0] === "+") {
      const P = uPos(u);
      spawnParticles(P.x, P.y, { n: 8, colors: ["#7fe08a", "#ffd98a"], speed: 55, life: 0.7, grav: -70, size: 2.5 });
    }
  }
  // 受击三件套：白闪 + 伤害飘字 + 撞粒子；毒伤紫色、马踢尘土色，伤害≥3 再加屏震。
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
  // 瞬移对齐：把显示坐标直接拽到逻辑坐标——引擎改了 r/c 后调它，免得棋子慢慢滑过去。
  function snap(u) { u.rx = u.c; u.ry = u.r; }

  /* ---------------- 打击特效系统 ---------------- */
  // 各类特效的「弹夹」（数组）：spawn 进来、draw 里每帧老化，寿命归零就移除。
  // shakeT/shakeMag=屏震的剩余时间与强度。
  let particles = [], slashes = [], projectiles = [], rings = [], ghosts = [], vignettes = [];
  let shakeT = 0, shakeMag = 0;
  // 每个角色远程弹道画风：[样式, 颜色]——箭矢/光束/纸符/波纹…按 charId 查表。
  const PROJ_STYLE = {
    wenbin: ["arrow", "#3a2a1a"], wonder: ["beam", "#d8a11f"], shaoming: ["paper", "#f5efe0"],
    xinhui: ["wave", "#c04a6a"], shibo: ["beam", "#4f6d8c"], weirong: ["beam", "#6b4f8c"],
    qinfa: ["line", "#3d4a5c"], xiangdong: ["beam", "#8a8ab8"], limo: ["wave", "#8f8f5c"],
    dage: ["paper", "#e8d8c0"], lifan: ["wave", "#3f7d8c"], ziye: ["paper", "#8c6a2f"],
    zichen: ["ring", "#7d4a6b"], luhao: ["paper", "#4a6d9c"], guyin: ["wave", "#555555"],
    keai: ["paper", "#c76b98"], wanzhen: ["beam", "#6a8577"], tree: ["dab", "#4c6b3c"],
    yinkesi: ["paper", "#a63a2b"]
  };

  // 撒 n 颗粒子：角度速度随机、寿命随机；grav 正=下坠、负=上升（回血粒子往上飘）。
  // 粒子超 320 颗就丢最老的，防止大混战时无限堆积拖垮帧率。
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

  /* 攻击演出调度：贴脸（切比雪夫距离≤1）→扑身+刀光；马踢→冲击环+扬尘；
   * 远距离→按 PROJ_STYLE 发一枚飞行道具。引擎只报「谁打谁」，画面这里自己挑。 */
  function fxAttack(att, def, opts) {
    if (!att || !def) return;
    const A = uPos(att), B = uPos(def);
    // 切比雪夫距离：棋盘上横竖斜都算一步的距离，本作「相邻」判定全靠它。
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

  // 阵亡演出：留一具上浮渐隐的「遗影」，再撒一把该角色颜色的碎屑。
  function fxDeath(u) {
    const P = uPos(u);
    ghosts.push({ x: P.x, y: P.y, glyph: u.ch.glyph, color: u.ch.color, t: 1.3 });
    spawnParticles(P.x, P.y, { n: 22, colors: [u.ch.color, "#6a615a", "#2b2622"], speed: 150, life: 0.7, size: 3.5 });
  }

  // 全屏边缘晕影（血祭时红色渐染），rgb 形如 "166,58,43"。
  function fxVignette(rgb) { vignettes.push({ rgb, t: 1 }); }

  /* ---------------- 画布 ---------------- */
  /* ---------- 背景预绘制：静态战场画进一张离屏 canvas，之后每帧只贴图 ----------
   * Canvas 游戏经典提速手法：砖墙/草叶/障碍/角楼/旗帜画一次就够，不必每帧重画。
   * 障碍物画法由 cfg.stage.terrain 决定（terrain 只管长相，能不能走由引擎说了算）。 */
  function buildBG() {
    bgCanvas = document.createElement("canvas");
    bgCanvas.width = CS; bgCanvas.height = CS;
    const g = bgCanvas.getContext("2d");
    g.fillStyle = "#efe4c8"; g.fillRect(0, 0, CS, CS);
    // 先铺 900 条极淡的半透明小短条，做出旧纸/羊皮底的质感。
    for (let i = 0; i < 900; i++) {
      g.fillStyle = "rgba(" + (120 + Math.random() * 60 | 0) + "," + (100 + Math.random() * 50 | 0) + "," + (60 + Math.random() * 40 | 0) + "," + (Math.random() * 0.05) + ")";
      g.fillRect(Math.random() * CS, Math.random() * CS, Math.random() * 26 + 4, Math.random() * 3 + 1);
    }
    // 逐格画棋盘：城墙格画砖缝、空地画草叶（最外圈即城墙，规则见引擎 isWall）。
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
        // 用格子坐标凑个伪随机 seed：每格草叶位置固定，重绘也不乱跳。
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
    // 战场参数从战局配置取：blocked=障碍格列表，terrain=障碍物画成什么物件。
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
        // 默认画法：课桌+凳+书+墨水瓶（terrain 缺省或 desk 都走这支）。
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
    // 最后盖个 10% 透明度的「馬刀」大字水印；save/restore 把透明度改动限制在这一小段内。
    g.save();
    g.globalAlpha = 0.1;
    g.font = "bold 120px KaiTi, STKaiti, serif";
    g.fillStyle = "#5a4020"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("馬刀", PAD + 3.5 * TILE, PAD + 3.5 * TILE);
    g.restore();
  }

  // 画质档位：full 全特效 / lite 减粒子 / off 关特效，读存档里的设置。
  function fxLevel() { return SAVE.settings.fx || "full"; }

  /* ---------- 动画主循环：requestAnimationFrame 反复调 draw ----------
   * dt=距上一帧的秒数（封顶 0.05，防止标签页切走再回来时棋子瞬移）。
   * 所有动画量都按 dt 老化：帧率高慢都不影响速度观感。 */
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

  /* ---------- 每帧绘制：背景→可走点→目标高亮→单位→特效→飘字→晕影 ----------
   * 顺序即图层：后画的盖在先画的上面。 */
  function draw(ctx, dt) {
    if (!bgCanvas) return;
    ctx.clearRect(0, 0, CS, CS);
    ctx.drawImage(bgCanvas, 0, 0);
    if (!battle) return;
    ctx.save();
    // 屏幕震动：随机平移画布原点，幅度随 shakeT 衰减（外层有 save/restore 保护现场）。
    if (shakeT > 0 && fxLevel() !== "off") {
      shakeT -= dt * 2.4;
      const m = shakeMag * Math.max(0, shakeT);
      ctx.translate((Math.random() - .5) * m, (Math.random() - .5) * m);
    }
    // 播放速度倍率（速×1/2/3 档）：数值越小，后面插值追得越快，动作显得越快。
    const speedK = [1, 0.6, 0.3][SAVE.settings.speed - 1] || 1;

    const p = battle.player;
    // 轮到玩家且没在选目标时：把移动可达的格子点上绿点（可达集合由引擎 _reachable 算好）。
    if (battle._playerPhaseActive && p.alive && p.offField <= 0 && mode === null && !checkAutoEnd()) {
      const reach = battle._reachable(p, battle.moveRange(p));
      ctx.fillStyle = "rgba(80,140,70,.30)";
      for (const key of reach.keys) {
        const [r, c] = key.split(",").map(Number);
        if (battle.unitAt(r, c) || (r === p.r && c === p.c)) continue;
        dot(ctx, PAD + c * TILE + TILE / 2, PAD + r * TILE + TILE / 2, 10);
      }
    }
    // 选目标模式：给所有合法目标描红框，透明度随 sin 波动产生闪烁感。
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

    // 画单位。先排序：敌方在前玩家在后，保证玩家棋子总盖在敌人上面。
    const order = [...battle.units].sort((a, b) => (a.side === "player" ? 1 : 0) - (b.side === "player" ? 1 : 0));
    for (const u of order) {
      if (!u.alive || u.offField > 0) continue;
      // 平滑移动：显示坐标 rx/ry 每帧向逻辑坐标 r/c 靠近一部分（比例插值），看着像滑动。
      u.rx += (u.c - u.rx) * Math.min(1, dt * 8 / speedK);
      u.ry += (u.r - u.ry) * Math.min(1, dt * 8 / speedK);
      if (u.flash > 0) u.flash -= dt * 3;
      let px = PAD + u.rx * TILE + TILE / 2, py = PAD + u.ry * TILE + TILE / 2;
      // 受击白闪：flash 从 1 衰减到 0，期间高频左右抖动、底色瞬间变白。
      if (u.flash > 0) {
        px += Math.sin(u.flash * 40) * 5 * u.flash;
      }
      // 扑击位移：朝目标方向冲出去再收回（sin 曲线先冲后退），让近战有「撞上去」的手感。
      if (u._lunge) {
        u._lunge.t -= dt * 5;
        if (u._lunge.t <= 0) delete u._lunge;
        else { const k = Math.sin(u._lunge.t * Math.PI) * 16; px += u._lunge.dx * k; py += u._lunge.dy * k; }
      }
      ctx.fillStyle = "rgba(60,40,20,.18)";
      ctx.beginPath(); ctx.ellipse(px, py + 26, 26, 8, 0, 0, 7); ctx.fill();
      // arc 的结束角写 7（大于 2π≈6.28）是本文件惯例：多画一点保证闭合成整圆。
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
      // 头顶血条：深色底 + 白色「残影」层 + 实际血量层（绿/红）。
      // hpGhost 是「追血」显示：掉血后白条花几帧慢慢追上红条，反馈更有余韵。
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
      // 右上角小角标：有刀写「刀」、有马写「马」（bx 左移防重叠）。
      let bx = px + 20;
      if (u.hasKnife) { ctx.fillStyle = "#ffd98a"; ctx.fillText("刀", bx, py - 26); bx -= 15; }
      if (u.hasHorse) { ctx.fillStyle = "#d8c8ff"; ctx.fillText("马", bx, py - 26); }
      // 头顶状态小字：毒/祭/晕/封，逐个往上叠一行。
      let sy = py - 40;
      ctx.font = "12px serif";
      if (u.st.poison > 0) { ctx.fillStyle = "#b06ad0"; ctx.fillText("毒" + u.st.poison, px, sy); sy -= 13; }
      if (u.st.bloodlust > 0) { ctx.fillStyle = "#ff5a5a"; ctx.fillText("祭", px, sy); sy -= 13; }
      if (u.st.skip > 0) { ctx.fillStyle = "#8a7a3a"; ctx.fillText("晕", px, sy); sy -= 13; }
      if (u.st.seal > 0) { ctx.fillStyle = "#666"; ctx.fillText("封", px, sy); sy -= 13; }
    }

    // 被遣返回家的单位：在出生位画半透明虚线圈 + 「返家」二字。
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

    // 鼠标悬停的单位描一圈深色外框（悬停格 hoverTile 在 mousemove 里更新）。
    const hu = hoverUnit();
    if (hu && hu.alive) {
      const pos = uPos(hu);
      ctx.strokeStyle = "rgba(43,38,34,.6)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 34, 0, 7); ctx.stroke();
    }

    const FX = fxLevel();
    // 画质开关落地：off 清空全部特效队列；lite 把粒子砍到 40 颗以内。
    if (FX === "off") { slashes.length = 0; projectiles.length = 0; rings.length = 0; ghosts.length = 0; particles.length = 0; }
    else if (FX === "lite" && particles.length > 40) particles.length = 40;
    // 下面五个特效循环一个套路：倒序遍历（方便 splice 删除不乱序）→老化→到点移除→画。
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
      // 弹道插值：从起点线性走向终点，再叠一个 sin 抬升，让弹道呈弧线。
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
      // 径向渐变晕影：中心透明→边缘染色，每帧新建一次渐变对象（量小，可接受）。
      const g = ctx.createRadialGradient(CS / 2, CS / 2, CS * 0.28, CS / 2, CS / 2, CS * 0.72);
      g.addColorStop(0, "rgba(" + v.rgb + ",0)");
      g.addColorStop(1, "rgba(" + v.rgb + "," + (v.t * 0.4).toFixed(3) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CS, CS);
    }
  }

  // 技能射程判定：切比雪夫距离 ≤ 技能 range（没写 range 默认贴脸 1 格）。
  function chebSkillRange(p, f) {
    const sk = battle.skillOf(p, 0);
    if (!sk) return false;
    const rng = sk.range || 1;
    return Math.max(Math.abs(p.r - f.r), Math.abs(p.c - f.c)) <= rng;
  }

  function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

  /* 鼠标坐标 → 格子坐标：canvas 的 CSS 显示尺寸可能被拉伸，与内部分辨率不一致，
   * 得先按 rect 的缩放比换算回画布坐标，再减 PAD、除 TILE、取整得到格点。 */
  function tileFromEvent(ev) {
    const cv = $("#battle-canvas");
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (CS / rect.width);
    const y = (ev.clientY - rect.top) * (CS / rect.height);
    const c = Math.floor((x - PAD) / TILE), r = Math.floor((y - PAD) / TILE);
    if (r < 0 || c < 0 || r >= E.SIZE || c >= E.SIZE) return null;
    return { r, c };
  }
  // 当前悬停格上有没有单位（没有则 null）。
  function hoverUnit() {
    if (!hoverTile || !battle) return null;
    return battle.unitAt(hoverTile.r, hoverTile.c);
  }

  // 是触屏设备吗？手机上没有 mousemove 悬停提示，点击判定得另走一套（见 bindCanvasTouch）。
  const IS_TOUCH = (typeof window !== "undefined") && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  // 桌面端画布交互：悬停提示框、点击（移动/出手）、右键取消选目标。
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
    // 点击画布总入口：正选目标→试着对点中的对象出手（不合法就取消）；
    // 没在选目标→试着走到点中的格子（必须在引擎算出的可达集合里）。
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
      // 走到这说明不是在选目标：点中的格子在可达集合（「r,c」键）里就执行移动。
      const reach = battle._reachable(p, battle.moveRange(p));
      const key = tile.r + "," + tile.c;
      if (reach.keys.includes(key) && !battle.unitAt(tile.r, tile.c)) {
        await battle.doMove(p, tile.r, tile.c);
        afterPlayerAction();
      }
    });
    // 右键=取消选目标；preventDefault 挡掉浏览器右键菜单。
    cv.addEventListener("contextmenu", ev => { ev.preventDefault(); mode = null; updateAll(); });
  }

  // 触屏版：没有悬停，只有 pointerup「点哪算哪」，判定与桌面 click 相同的浓缩版。
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
  /* ---------- 结算：引擎分出胜负后调这里，本模块负责收尾演出 ----------
   * 流程：音效 → 停 1.3 秒 → 播胜利/败北对话（cfg 配的或场景表 SJI_SCENES 的）→
   * 请世界侧钩子 onResult(b) 生成奖励文案 → 弹结算面板。 */
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

  // 拼结算面板 HTML：胜/败大印、战报、按钮；败了才给「重整旗鼓」。
  function showResult(b, extraHtml) {
    const win = b.result === "win";
    $("#result-body").innerHTML =
      '<div class="result-seal seal' + (win ? "" : " lose") + '">' + (win ? "胜" : "败") + "</div>" +
      '<div class="result-title">' + (win ? "活者为王" : (b.result === "timeout" ? "高考终了" : "出师未捷")) + "</div>" +
      '<div class="result-stats">回合：' + b.round + "　·　击破：" + b.stats.kills + "　·　用技：" + (b.stats.usedSkill ? "有" : "无") + "　·　血祭：" + (b.stats.usedBlood ? "有" : "无") + "</div>" +
      (extraHtml || "") +
      '<div class="btnrow" style="justify-content:center;margin-top:18px">' +
      (win ? "" : '<button class="btn" id="r-retry">重整旗鼓</button>') +
      '<button class="btn primary" id="r-menu">回校园</button></div>';
    const retryBtn = $("#r-retry");
    if (retryBtn) retryBtn.onclick = () => {
      AU.click();
      // 重开一场：浅拷贝 cfg 并删掉开场对话，再打就不用重听对白了。
      const cfg = Object.assign({}, b.cfg);
      delete cfg.introScene;
      startBattle(cfg, onEndCb);
    };
    // 回校园：先叫世界侧钩子 onDone(b)（发奖励/存档/切场景），再撤覆盖层。
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
  // 启动绑定：页面 DOM 就绪后调一次——绑按钮、绑画布、把速度/音效按钮的文字归位。
  function boot() {
    bindActions();
    bindCanvas();
    $("#b-speed").textContent = "速×" + SAVE.settings.speed;
    $("#b-mute").textContent = SAVE.settings.sfx ? "音" : "默";
    AU.setSfx(SAVE.settings.sfx !== false);
  }

  /* ---------- 对外接口：return 出去的对象就是 window.SJI_UI ----------
   * 引擎与世界侧只通过这里列出的名字与本模块打交道。battle/active 是 getter，
   * 外界只能读、不能直接改模块内部状态。 */
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
// 全局命名空间：引擎 sleep() 按 SJI.settings.speed 定节奏；battle 槽开局时挂当前战局。
window.SJI = {
  get settings() { return window.SJI_SAVE.settings; },
  battle: null
};
// DOM 树就绪再启动战斗层：绑事件的前提是按钮、画布这些元素已经存在。
document.addEventListener("DOMContentLoaded", () => {
  try { window.SJI_UI.boot(); } catch (e) { console.error("战斗层启动失败:", e); }
});
// 首次交互解锁战斗音效（浏览器手势策略）
document.addEventListener("pointerdown", () => { window.SJI_AUDIO.unlock(); }, { once: true });
// 控制台调试工具：F12 里敲 SJI_DEBUG.killEnemies() 等可直接干预战局，方便测试。
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
