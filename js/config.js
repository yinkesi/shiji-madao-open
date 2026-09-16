/* 实验史记·春秋笔 —— 全局工具 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   全项目的“工具箱”：DOM 查询与元素工厂、数学小工具、弹簧动画引擎、
   底部抽屉面板动画、程序合成音效、toast 提示、localStorage 存档。
   零依赖，全原生 JS。

   【架构位置】
   index.html 里第一个加载的 <script>（其后才是 data/ 数据、engine、
   world、dialog……最后是 main）。它不依赖任何别的文件，反而被所有
   文件依赖。注意战斗层还有个同名文件 js/battle/config.js，两者互不相干。

   【暴露的全局名】
   $ $$ el clamp lerp rand irand pick shuffle
   Spring（弹簧动画） SheetFX（抽屉滑入滑出） Sfx（音效）
   toastQueue / toast / flushToasts / showToastNow（提示弹幕）
   Save（存档，localStorage key 为 shiji_cqb_v1）

   【新手阅读提示】
   1) 本项目没有模块系统（没有 import/export），22 个 <script> 按顺序
      加载，文件之间靠“顶层全局变量”通信。JS 里顶层的 const/let 不会像
      var/function 那样挂到 window 上，所以跨文件只能用裸名（直接写
      Spring、Save），不能用 window.Spring；判断某物是否存在用
      typeof Spring !== 'undefined'（直接裸名比较会抛 ReferenceError，
      typeof 则安全）。
   2) 本文件大量使用 IIFE（立即执行函数表达式）：用函数包住内部状态、
      只 return 出想暴露的方法——这就是最朴素的“模块”写法，闭包让
      springs、ctx 这类内部变量外界摸不到。
   ================================================================ */

/* 两个 DOM 查询快捷方式：$ 找第一个匹配的元素，$$ 找全部。
   箭头函数是匿名函数的简写，(参数) => 表达式 意为“返回这个表达式”。
   第二个参数 el 可选：不传就用整个 document（|| 取第一个真值），
   传了就只在该元素内部找。 */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

/* 造 DOM 元素的小工厂：tag 是标签名（如 'div'），cls 是 class 名，
   html 是要塞进去的 innerHTML（可含标签的 HTML 字符串）。
   “!= null”会同时拦住 null 和 undefined 两种“没有值”，
   是 JS 里最常见的判空写法。 */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
/* ---------- 数学小工具 ---------- */
/* clamp：把 v 夹在 [a, b] 区间内（超出边界就取边界值）。
   lerp：线性插值，t=0 得 a、t=1 得 b，中间取过渡值，动画渐变的基石。
   rand：取 [a, b) 的随机小数；irand：随机整数（含两端）；
   pick：从数组里随机取一个元素。 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
/* shuffle：洗牌（Fisher-Yates 算法），从尾往头把每个位置与更前面的随机位交换。
   先 arr.slice() 浅复制一份再打乱，不污染调用者手里的原数组；
   [a[i], a[j]] = [a[j], a[i]] 是“解构赋值”交换两值，相当于 Python 的 a, b = b, a。 */
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- 弹簧动画（Apple: damping/response 参数化，可被打断） ---------- */
/* Spring：物理弹簧动画引擎。IIFE + 闭包把活动弹簧集合 springs 藏在内部，
   只对外暴露 make（新建）和 retarget（中途改目标）两个方法。
   每帧由 requestAnimationFrame 驱动：rAF 在浏览器每次重绘前调用 tick，
   是做动画的标准姿势（比 setInterval 顺滑，页面切后台时自动暂停）。
   damping=阻尼（越大弹跳越少），response=响应时间（秒，越小越快）。 */
const Spring = (() => {
  const springs = new Set();
  /* 每帧回调：遍历所有活着的弹簧，各自往前积分一小步。 */
  function tick() {
    const now = performance.now();
    springs.forEach(s => {
      if (s.cancelled) { springs.delete(s); return; }
      /* 单个弹簧回调出错不能拖垮整条动画链（否则后续所有弹簧都停摆，
         表现为"对话/面板卡住、回调丢失、世界像被冻住"） */
      try {
        /* dt = 距上一帧的秒数；夹到 0.032s 以内，防止切后台回来时一步跳太远穿帮。 */
        const dt = Math.min(0.032, (now - s.last) / 1000); s.last = now;
        // 半隐式欧拉积分
        /* 弹簧运动方程：a = -ω²·(x - 目标) - 2ζω·v。前一项是把物体拉回目标的
           “弹力”（离目标越远拉力越大），后一项是与速度成正比的“阻尼力”；
           omega 由 response 换算成角频率。 */
        const omega = 2 * Math.PI / Math.max(0.01, s.response);
        s.v += (-omega * omega * (s.x - s.target) - 2 * s.damping * omega * s.v) * dt;
        s.x += s.v * dt;
        /* 位置和速度都几乎贴住目标 → 视为动画结束：钉死在目标值并触发 done 回调。 */
        if (Math.abs(s.x - s.target) < 0.001 && Math.abs(s.v) < 0.001) {
          s.x = s.target; s.v = 0; springs.delete(s); s.done && s.done();
        }
        s.update(s.x, s.v);
      } catch (e) { springs.delete(s); try { console.error(e); } catch (e2) {} }
    });
    if (springs.size) requestAnimationFrame(tick); else running = false;
  }
  /* running 标记：整条动画链只允许一个 rAF 循环在跑，没有弹簧时自动停表。 */
  let running = false;
  function ensureLoop() { if (!running) { running = true; requestAnimationFrame(tick); } }
  // 创建弹簧：{x0, target, damping=1, response=0.35, update(x,v), done()}
  /* make：造一个弹簧加入集合。opt 里 x0=起点、target=终点、
     update(x, v)=每帧拿着当前值/速度去干活的回调（典型：改 style.transform）、
     done=结束回调。“!= null”式的默认值兜底保证参数可省。 */
  function make(opt) {
    const s = {
      x: opt.x0 || 0, v: opt.v0 || 0, target: opt.target != null ? opt.target : (opt.x0 || 0),
      damping: opt.damping != null ? opt.damping : 1.0,
      response: opt.response != null ? opt.response : 0.35,
      update: opt.update || (() => {}), done: opt.done, last: performance.now(),
    };
    springs.add(s); ensureLoop(); return s;
  }
  /* retarget：中途改目标（比如用户又点了别处，动画顺势改道），
     v0 可选地重设初速度；保证 rAF 循环在跑。 */
  function retarget(s, target, v0) { s.target = target; if (v0 != null) s.v = v0; ensureLoop(); }
  return { make, retarget };
})();

/* Sheet 弹入弹出：从当前呈现值出发（可被打断） */
/* SheetFX：底部抽屉面板的滑入/滑出动画。
   关键思路：不假设面板“从哪开始”，而是用 getComputedStyle 读出它
   当前真实的 transform 再解析成矩阵（m42 就是矩阵里 Y 方向的平移量），
   从当前位置出发滑向目标——于是动画随时可被打断再接上，不会瞬移。 */
const SheetFX = {
  /* 打开抽屉：若上一次的“关闭弹簧”还没跑完，先标记 cancelled 作废它，
     显示面板，再新建一个从当前位置滑回 0（屏幕内）的弹簧。 */
  open(panel) {
    if (panel._closeSpring) { panel._closeSpring.cancelled = true; panel._closeSpring = null; }
    panel.classList.remove('hidden');
    panel.style.transformOrigin = '50% 100%';
    const st = getComputedStyle(panel).transform;
    const m = new DOMMatrixReadOnly(st === 'none' ? '' : st);
    Spring.make({
      x0: m.m42 || 120, target: 0, damping: 0.85, response: 0.4,
      update: x => { panel.style.transform = `translateX(-50%) translateY(${x}px)`; },
    });
  },
  /* 关闭抽屉：目标值是“面板高度 + 60px”（彻底滑出屏幕）。
     done 里用 fired 标志做幂等：弹簧自然结束与下面的 320ms 兜底谁先到，
     “隐藏面板 + 执行回调 cb”这套收尾都只执行一次。 */
  close(panel, cb) {
    if (panel._closeSpring) panel._closeSpring.cancelled = true;
    const st = getComputedStyle(panel).transform;
    const m = new DOMMatrixReadOnly(st === 'none' ? '' : st);
    /* 弹簧只负责视觉滑出；收尾（隐藏层 + 回调）必须保证执行，故加超时兜底 */
    let fired = false;
    const done = () => {
      if (fired) return; fired = true;
      panel.classList.add('hidden'); panel._closeSpring = null; cb && cb();
    };
    try {
      panel._closeSpring = Spring.make({
        x0: m.m42 || 0, target: panel.offsetHeight + 60, damping: 1.0, response: 0.28,
        update: x => { panel.style.transform = `translateX(-50%) translateY(${x}px)`; },
        done,
      });
    } catch (e) { done(); return; }
    /* 保底闹钟：万一弹簧没跑完（回调抛错、rAF 被暂停），320ms 后强制收尾，
       保证面板一定藏起来、cb 一定执行。正常滑出远快于 320ms，玩家无感。 */
    setTimeout(done, 320);
  },
};

/* ---------- 音效：WebAudio 合成，静音可切 ---------- */
/* Sfx：不加载任何音频文件，直接用 WebAudio“现场合成”音效。
   惰性初始化：第一次要发声时才创建 AudioContext（浏览器规定音频必须
   在用户交互之后才能启动，建早了也是“挂起”状态）。
   tone() 是唯一发声原语：振荡器 o 产生指定波形的频率 f，
   增益节点 g 控制音量包络——音量从 0.0001 快速升到目标值再衰减回
   0.0001（指数插值不允许到 0，所以用极小值代替“静音”）。 */
const Sfx = (() => {
  let ctx = null;
  /* 拿到（或首次创建）AudioContext；创建失败返回 null，之后静默无声但不报错。 */
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return ctx; }
  function tone(f, dur, type, vol, delay) {
    /* window.G 是全局状态对象（engine.js 里挂到 window、main.js 里赋值）。
       先探 window.G 再摸 G.settings：读不存在的属性只会得到 undefined（安全），
       裸读一个未声明的变量才会抛 ReferenceError——防御性写法。 */
    if (!window.G || !G.settings || G.settings.muted) return;
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  /* 对外只暴露一组“具名音效”，每个都是用 tone() 拼出来的小旋律：
     tap=点按、page=翻页、good=好事、seal=落印、bad=坏事、
     unlock=解锁成就、chat=对话滴答（频率带随机扰动，避免千篇一律）。 */
  return {
    tap: () => tone(880, 0.06, 'triangle', 0.05),
    page: () => { tone(520, 0.09, 'sine', 0.07); tone(780, 0.1, 'sine', 0.05, 0.05); },
    good: () => { tone(660, 0.12, 'sine', 0.09); tone(880, 0.16, 'sine', 0.08, 0.09); },
    seal: () => { tone(140, 0.16, 'square', 0.1); tone(90, 0.22, 'sine', 0.12, 0.02); },
    bad: () => { tone(220, 0.18, 'sawtooth', 0.06); tone(160, 0.22, 'sawtooth', 0.06, 0.08); },
    unlock: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'sine', 0.07, i * 0.07)); },
    chat: () => tone(700 + rand(-40, 40), 0.05, 'triangle', 0.04),
  };
})();

/* ---------- Toast：弹层打开期间排队，关闭后补发；同屏至多 3 条 ---------- */
/* toast：屏幕上自动消失的短提示（第二个参数是可选的“印章”字，如『善』）。
   面板/对话开着时先排进队列，等它们关掉后由 flushToasts 补播，
   避免提示被弹层挡住白显示。 */
const toastQueue = [];
function toast(msg, sealChar) {
  /* UI / Dialog 是后面文件才定义的全局，本文件加载时它们还不存在；
     但这段代码只在用户交互时才执行，届时用 typeof 判活即可安全访问。 */
  if ((typeof UI !== 'undefined' && UI.panelOpen) || (typeof Dialog !== 'undefined' && Dialog.active)) {
    toastQueue.push([msg, sealChar]);
    /* 队列最多攒 6 条，超了丢最旧的（shift 从头部取出）。 */
    if (toastQueue.length > 6) toastQueue.shift();
    return;
  }
  showToastNow(msg, sealChar);
}
/* 把队列里攒下的提示一口气补播完（条件：弹层已经都关了）。 */
function flushToasts() {
  while (toastQueue.length && !((typeof UI !== 'undefined' && UI.panelOpen) || (typeof Dialog !== 'undefined' && Dialog.active))) {
    const [m, s] = toastQueue.shift();
    showToastNow(m, s);
  }
}
/* 真正把一条 toast 插进 #toasts 容器：同屏满 3 条先删最旧的；
   2.6 秒后给元素加 .out 类触发淡出 CSS 动画，再嵌套等 350ms
   动画播完才从 DOM 里移除——setTimeout 里再套 setTimeout 是
   “先播动画、后清理”的惯用法。 */
function showToastNow(msg, sealChar) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const t = el('div', 'toast');
  if (sealChar) t.appendChild(el('span', 'seal-stamp', sealChar));
  t.appendChild(el('span', '', msg));
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}

/* ---------- 存档 ---------- */
/* Save：存档读写。localStorage 只能存字符串，所以对象要先
   JSON.stringify 序列化、读出后 JSON.parse 反序列化。
   每个操作都包 try/catch：浏览器隐私模式/存储已满时 localStorage 会抛异常，
   游戏不能因此崩掉。export/import 把存档转成 base64 文本方便复制搬运：
   btoa 只认拉丁字符，中文要先 encodeURIComponent 变成纯 ASCII 才进得去。 */
const Save = {
  KEY: 'shiji_cqb_v1',
  write() { try { localStorage.setItem(this.KEY, JSON.stringify(G)); } catch (e) {} },
  read() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  /* 导出：JSON 字符串 → encodeURIComponent 百分号编码（全 ASCII）→ btoa 转 base64。
     escape/unescape 是被废弃的老 API，如今恰好还干着这活儿，读懂即可不必模仿。 */
  export() { return btoa(unescape(encodeURIComponent(JSON.stringify(G)))); },
  /* 导入：上一步的逆运算。校验 ver 字段挡住粘错的内容；
     导入即覆盖现有存档，调用方随后刷新页面让它生效。 */
  import(str) {
    const o = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    if (!o || !o.ver) throw new Error('bad');
    Save.clear(); localStorage.setItem(this.KEY, JSON.stringify(o)); return o;
  },
};
