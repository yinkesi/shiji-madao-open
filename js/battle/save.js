/* ============================================================
 * 实验史记 · 马刀风云 —— 存档（localStorage）
 * ============================================================ */
/* ============================================================
 * 【新手导读】
 * 【这个文件是干嘛的】战斗侧的存档中心：通关进度、角色解锁、成就、
 *   统计计数、设置，以及"打一半退出"的断点快照。数据存进浏览器自带的
 *   localStorage：主档键名 shiji_madao_v1，断点另存 shiji_madao_v1_battle。
 *   localStorage 按域名隔离、关浏览器也不丢，只能存字符串，所以这里
 *   到处是 JSON.stringify（对象→字符串）和 JSON.parse（字符串→对象）。
 * 【架构位置】battle 层，index.html 正常加载。engine.js / battle-ui.js
 *   经 window.SJI_SAVE 读写；世界侧（js/quests.js、js/ui.js 等）也来存
 *   设置（如最近难度 lastDiff）。本文件会反向查 window.SJI_DATA 的
 *   关卡/成就表、调 window.SJI_UI 弹成就提示——跨命名空间一律写全
 *   window. 前缀，避免顶层 const 不挂 window 的大坑。
 * 【暴露的全局名】window.SJI_SAVE，方法都挂在末尾 return 的对象上。
 * 【新手阅读提示】三个高频 JS 惯用法在本文件集齐：
 *   1) JSON.parse(JSON.stringify(obj)) —— "深拷贝"，复制一份互不影响的新对象；
 *   2) Object.assign(目标, 来源) —— 把来源的字段盖到目标上，这里用来给
 *      老版本的存档自动补上新字段；
 *   3) 所有 localStorage / JSON.parse 都裹在 try/catch 里——隐私模式会
 *      禁存储、手改的存档可能解析失败，坏一次不能让整个游戏起不来。
 * ============================================================ */
window.SJI_SAVE = (function () {
  "use strict";
  // localStorage 的主键名：同一浏览器、同一域名下全局唯一，换名等于全新存档。
  const KEY = "shiji_madao_v1";
  /* 存档的默认结构（DEF = default）。progress / unlocked / charWins / ach
     都是"字典"用法：键不存在就当 false / 0，所以查"通没通关"直接
     !!data.progress[id]。 */
  const DEF = {
    progress: {},          // stageId -> true
    unlocked: { dage: true },  // 已立传（可操作）角色
    charWins: {},          // charId -> 胜场数（角色挑战成就）
    ach: {},               // achId -> true
    bestSurvival: 0,
    totals: { moves: 0, heals: 0, kills: 0, wins: 0, losses: 0 },
    // 设置默认值；世界侧还会往里追加 extra 键（如 lastDiff 最近难度），读取处一律有兜底。
    settings: { sfx: true, music: true, speed: 1, aiAggr: "active", rpsMode: "ask", fx: "full", ngPlus: false }
  };
  // 启动即读档：脚本加载到这行时数据就进内存了，之后改动统一由 persist() 落盘。
  let data = load();
  // 本场战斗新解锁的成就 id 暂存区（结算页取走展示），见 beginAchLog / takeAchLog。
  let achLog = [];

  /* load：读档 + 版本迁移。三层 Object.assign：先把默认值深拷贝一份打底，
     再用读到的存档整体覆盖，最后 totals / settings 单独浅合并一层——
     这样新版本给默认值加的字段，老存档没有也能自动补上。 */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEF));
      const d = JSON.parse(raw);
      return Object.assign(JSON.parse(JSON.stringify(DEF)), d, {
        totals: Object.assign({}, DEF.totals, d.totals || {}),
        settings: Object.assign({}, DEF.settings, d.settings || {})
      });
    } catch (e) { return JSON.parse(JSON.stringify(DEF)); }
  }
  // 写盘。失败（隐私模式 / 配额满）就静默放弃——游戏照玩，只是不存。
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }

  /* 下面是对外接口。get data() 是 getter 语法：外面写 SJI_SAVE.data 像读
     属性一样，实际执行的是函数。注意 data 是引用——外部拿到后直接改
     它的字段也会改到存档本体。 */
  return {
    get data() { return data; },
    get settings() { return data.settings; },
    /* 一组"读-改-写"小方法：查/记通关、成就、计数，改完立即落盘，
       保证刷新页面不丢。!! 是"转成布尔"的惯用法。 */
    isCleared(id) { return !!data.progress[id]; },
    allCleared() { return window.SJI_DATA.STAGES.every(s => !!data.progress[s.id]); },
    clearedCount() { return Object.keys(data.progress).length; },
    clearStage(id) { data.progress[id] = true; persist(); },
    hasAch(id) { return !!data.ach[id]; },
    /* 解锁成就：已解锁就返回 false（幂等，重复触发无害）；否则登记、
       落盘、记入本场日志，并让界面弹一条 toast 气泡。 */
    unlockAch(id) {
      if (data.ach[id]) return false;
      data.ach[id] = true; persist();
      achLog.push(id);
      const a = window.SJI_DATA.ACHIEVEMENTS.find(x => x.id === id);
      if (a && window.SJI_UI) window.SJI_UI.toast("成就达成 「" + a.name + "」：" + a.desc);
      return true;
    },
    // 累计计数 +n（如移动、击杀）：没有的键从 0 起步；n 不传按 1 兜底（n || 1）。
    bump(k, n) { data.totals[k] = (data.totals[k] || 0) + (n || 1); persist(); },
    // 某角色胜场 +1。charWins 可能不在老存档里，先补建字典再记。
    bumpCharWin(cid) {
      if (!data.charWins) data.charWins = {};
      data.charWins[cid] = (data.charWins[cid] || 0) + 1;
      persist();
    },
    // 「人人有传」成就的判定：PLAYABLE 名单里的角色是否每人都赢过至少一场。
    allCharsWon() {
      const w = data.charWins || {};
      return window.SJI_DATA.PLAYABLE.every(c => (w[c] || 0) > 0);
    },
    // 记录生存模式最佳波次：只在破纪录时写盘并返回 true，方便界面报喜。
    setBestSurvival(n) { if (n > data.bestSurvival) { data.bestSurvival = n; persist(); return true; } return false; },
    setSetting(k, v) { data.settings[k] = v; persist(); },
    markPrologue() { data.prologueSeen = true; persist(); },

    /* ---- 角色解锁：击败谁就为谁立传 ---- */
    isUnlocked(cid) {
      if (data.settings.ngPlus) return true;          // 二周目全解锁
      if (!data.unlocked) data.unlocked = { dage: true };
      return !!data.unlocked[cid];
    },
    unlockChars(list) {
      if (!data.unlocked) data.unlocked = { dage: true };
      let fresh = [];
      for (const cid of list || []) {
        if (!data.unlocked[cid]) { data.unlocked[cid] = true; fresh.push(cid); }
      }
      if (fresh.length) persist();
      return fresh;
    },
    /* 旧存档迁移：按已通关关卡补算解锁（不含初始角色之外的无主角色） */
    migrateUnlocks() {
      if (data.unlocked) return;
      data.unlocked = { dage: true };
      const D = window.SJI_DATA;
      for (const st of D.STAGES) {
        if (data.progress[st.id] && st.unlocks) for (const cid of st.unlocks) data.unlocked[cid] = true;
      }
      persist();
    },

    /* ---- 成就：本场解锁记录（供结算页展示） ---- */
    beginAchLog() { achLog = []; },
    // "取走"本场成就记录：slice() 先拷贝一份再清空原数组，结算页拿去展示。
    takeAchLog() { const l = achLog.slice(); achLog = []; return l; },

    /* ---- 循环存档导出 / 导入 ---- */
    /* 导出 = 存档对象变一段 JSON 文本（玩家可自行备份/分享）；
       导入 = 解析文本、和 load() 一样三层合并后整体替换。 */
    exportJSON() { return JSON.stringify(data); },
    importJSON(txt) {
      try {
        const obj = JSON.parse(txt);
        // 简单合法性检查：必须能解析成对象且带 settings 字段，才认是本游戏的存档。
        if (!obj || typeof obj !== "object" || !obj.settings) return { ok: false, err: "内容不是本游戏的存档" };
        data = Object.assign(JSON.parse(JSON.stringify(DEF)), obj, {
          totals: Object.assign({}, DEF.totals, obj.totals || {}),
          settings: Object.assign({}, DEF.settings, obj.settings || {})
        });
        persist();
        return { ok: true };
      } catch (e) { return { ok: false, err: "无法解析：" + e.message }; }
    },

    /* ---- 战斗中断点续战 ---- */
    /* 断点续战：引擎每回合末把整场战斗序列化成快照存进另一个键。
       三个方法都裹 try/catch——快照失败不该影响战斗本身。 */
    saveBattle(snap) { try { localStorage.setItem(KEY + "_battle", JSON.stringify(snap)); } catch (e) {} },
    loadBattle() {
      try { const raw = localStorage.getItem(KEY + "_battle"); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    clearBattle() { try { localStorage.removeItem(KEY + "_battle"); } catch (e) {} },
    // 重置主档：用深拷贝的默认结构整个替换内存数据再落盘（断点键不受影响）。
    reset() { data = JSON.parse(JSON.stringify(DEF)); persist(); }
  };
})();
