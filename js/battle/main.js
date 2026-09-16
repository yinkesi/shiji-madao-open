/* ============================================================
 * 实验史记 · 马刀风云 —— 启动与调试钩子
 * ============================================================ */
/* ============================================================
 * 【新手导读】
 * 【这个文件是干嘛的】⚠️ 原版《马刀风云》单文件游戏的启动入口：
 *   定义 window.SJI（全局命名空间）与 window.SJI_DEBUG（控制台调试
 *   工具箱），并在页面加载完时调用 SJI_UI.boot() 启动战斗界面。
 * 【架构位置】⚠️ 本文件【不被 index.html 加载】，是原版遗留的参考件，
 *   仅留作对照。它做的事已被 js/battle-ui.js 末尾原样接管——那里重新
 *   定义了 window.SJI 和 window.SJI_DEBUG，并负责调用 SJI_UI.boot()。
 *   真实生效的启动链：index.html 按固定顺序执行 22 个 <script>，
 *   页面入口是 js/main.js（世界侧），战斗界面启动代码在 js/battle-ui.js
 *   尾部，都与本文件无关。
 * 【暴露的全局名】若被加载会是 window.SJI 与 window.SJI_DEBUG；
 *   由于不被加载，实际生效的版本在 js/battle-ui.js 里（同名同款）。
 * 【新手阅读提示】想用调试工具（fast 快进 / skipScenes 跳对话 /
 *   autoRps 自动猜拳 / killEnemies 秒敌 / healPlayer 回血 / giveAll
 *   刀马全给），请直接看 js/battle-ui.js 末尾的定义，在浏览器控制台
 *   敲 SJI_DEBUG.xxx() 即可。`get battle() { ... }` 是 getter：像读属性
 *   一样写 SJI_DEBUG.battle，每次都现场取 window.SJI.battle 的最新值。
 * ============================================================ */
// 全局命名空间：battle 字段在开战时会被赋成当前战斗对象（引擎实例），
// 战斗外是 null。settings 是只读快捷入口，指向存档里的设置。
window.SJI = {
  get settings() { return window.SJI_SAVE.settings; },
  battle: null
};

/* 调试工具箱：方法是挂在对象上的简写函数（foo() {} 等价 foo: function () {}）。
   每个都先取 window.SJI.battle，没在战斗中就返回字符串 "no battle"。 */
window.SJI_DEBUG = {
  fast: false,          // 快进动画
  skipScenes: false,    // 跳过全部剧情对话
  autoRps: false,       // 自动猜拳
  get battle() { return window.SJI.battle; },
  killEnemies() {       // 秒杀当前敌人（由引擎回合末自然结算）
    const b = window.SJI.battle;
    if (!b || b.over) return "no battle";
    // 先 slice() 复制一份再遍历：击杀过程中战斗对象会改数组，遍历副本才安全。
    b.living("enemy").slice().forEach(u => b.rawHurt(u, u.hp, "天降正义"));
    return "ok";
  },
  healPlayer(n) {
    const b = window.SJI.battle;
    if (b) { b.player.hp = Math.min(b.player.maxhp, b.player.hp + (n || 99)); b.pushLog("（神迹）「" + b.player.ch.hao + "」回复了血。"); return "ok"; }
    return "no battle";
  },
  giveAll() {           // 刀马全给
    const b = window.SJI.battle;
    if (!b) return "no battle";
    b.player.hasKnife = true; b.player.hasHorse = true;
    return "ok";
  }
};

// DOMContentLoaded：HTML 解析完毕时触发（不等工作做完，只等 DOM 树就绪）。
// 此时各 <script> 已按顺序执行完，UI 可以安全启动。（现役版本在 battle-ui.js 尾部。）
document.addEventListener("DOMContentLoaded", () => {
  window.SJI_UI.boot();
});
