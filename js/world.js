/* 实验史记·春秋笔 —— Canvas 校园世界 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   游戏的“探索世界”层：用 Canvas 2D 把校园画出来（教室/食堂/操场等
   场景、桌椅黑板等道具、Q 版小人），并负责玩家在其中的一切活动——
   点地面走路（BFS 网格寻路）、碰门切场景、靠近人物/事件/任务点时
   弹出交互条、键盘方向键移动、相机平滑跟随。文件顶部的两个函数
   drawAvatar / roundRect 是全站共用的画图小工具（对话、图鉴、小
   游戏都来借）。

   【架构位置】
   index.html 按固定顺序加载 22 个 <script>，本文件排在 config、
   data/、engine 之后、dialog/ui/main 之前：它要用前面定义好的
   $、clamp、SCENE_BY_ID、PEOPLE、Engine 等，又被后面的 dialog/
   main/minigames 使用（minigames.js 就直接借走了 drawAvatar 和
   roundRect）。世界↔战斗的命脉在 main.js：世界收到约战 →
   window.SJI_UI.startBattle(cfg) 开战 → 战斗层立起
   window.BATTLE_ACTIVE = true → 本文件的点击处理与主循环看到这面
   旗子就让位（世界“暂停”，给战斗画面腾地方）。

   【暴露的全局名】
   1) drawAvatar(ctx, p, cx, cy, s)、roundRect(ctx, x, y, w, h, r)
      ——顶层 function 声明。经典 <script> 里顶层 function 会挂到
      全局对象上，别的文件直接裸名调用即可。
   2) const World——下面 IIFE 返回的对象（enter/travel/walkTo/
      npcPos/isNearNPC/avatarCanvas/setOnCtx/start…），main.js 主要
      跟它打交道。注意大坑：顶层 const 不挂 window！跨文件只能裸名
      World，不能 window.World；判活写 typeof World !== 'undefined'。

   【新手阅读提示】
   1) Canvas 是“整页重画”模型：画面上没有“留住的小人”，只有每帧
      在 requestAnimationFrame 回调里把整个世界重新画一遍（draw），
      一秒约 60 次。看到的连续动画，其实是高速翻页。
   2) 两处防御性设计值得细读：a) freeSpot()——默认落点可能恰好踩进
      道具的碰撞盒，一落地就被卡住不能动，所以落地前先螺旋找最近的
      空位；b) pointerdown 里任务标记的命中区只有 30 像素、只认气泡
      与名牌本身——命中区若太大，点标记附近的地面总被它“抢走”，
      玩家会莫名其妙被拉向标记。
   3) 满屏的 arc(x, y, r, 0, 7)：一整圈是 2π≈6.28 弧度，结尾写 7
      是偷懒的“画满圆”（多出来的角度画不出东西）。
   ================================================================ */

/* ---------- 头像绘制（世界/对话/图鉴通用） ---------- */
/* 画一个 Q 版小人：p 是人物数据（主要读 p.look 里的发型/眼镜等外
   观字段），(cx, cy) 是小人脚底中心的位置，s 是身高像素。第一个
   参数收 ctx（画笔），所以世界、对话头像、小游戏都能借它画到各自
   的画布上。`p.look || {}`：|| 在此当“取不到就用备胎”，防止没有
   外观数据时读 undefined 的属性直接报错。 */
function drawAvatar(ctx, p, cx, cy, s) {
  const L = p.look || {};
  const hair = L.hair || '#2a2620';
  const skin = '#f2d6b3';
  /* save/restore 成对使用：先“存档”当前画笔状态，再 translate 把
     坐标原点挪到小人脚下（此后坐标都相对小人自己），画完“读档”
     还原，不污染外面的坐标系——Canvas 局部绘制的标准套路 */
  ctx.save();
  ctx.translate(cx, cy);
  const u = s / 64; // 基准 64
  // 影
  ctx.fillStyle = 'rgba(30,26,16,.18)';
  ctx.beginPath(); ctx.ellipse(0, 30 * u, 20 * u, 7 * u, 0, 0, 7); ctx.fill();
  // 身体（制服色）
  // 嵌套三目相当于一串 if-else：主角/校长/老师有专属制服色，其余按班级配色
  const body = p.role === 'x' ? '#f4efe2' : p.role === 'p' ? '#3a352c' : p.role === 't' ? '#5a4a38'
    : p.cls === '6' ? '#41608c' : p.cls === '7' ? '#3e7a5e' : '#7a5f8a';
  ctx.fillStyle = body;
  roundRect(ctx, -14 * u, 8 * u, 28 * u, 26 * u, 10 * u); ctx.fill();
  if (p.role === 'x') { ctx.fillStyle = '#b8432f'; roundRect(ctx, -12 * u, 8 * u, 24 * u, 7 * u, 4 * u); ctx.fill(); }
  // 头
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(0, -6 * u, 15 * u, 0, 7); ctx.fill();
  // 发型
  ctx.fillStyle = hair;
  // 发型分发：st 依次与各发型比对，全不中就走最后的 else（即默认短发）
  const st = L.style || 'short';
  if (st === 'bald') { ctx.beginPath(); ctx.arc(0, -8 * u, 13.5 * u, Math.PI, 0); ctx.fill(); }
  else if (st === 'long') { roundRect(ctx, -15 * u, -20 * u, 30 * u, 26 * u, 12 * u); ctx.fill(); ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -5 * u, 12.5 * u, 0, 7); ctx.fill(); ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(0, -9 * u, 13 * u, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); }
  else if (st === 'bob') { ctx.beginPath(); ctx.arc(0, -6 * u, 15.5 * u, Math.PI * 0.9, Math.PI * 2.1); ctx.fill(); roundRect(ctx, -16 * u, -8 * u, 32 * u, 8 * u, 4 * u); ctx.fill(); }
  else if (st === 'bun') { ctx.beginPath(); ctx.arc(0, -9 * u, 14 * u, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.arc(0, -22 * u, 6.5 * u, 0, 7); ctx.fill(); }
  else if (st === 'buzz') { ctx.fillStyle = hair + 'cc'; ctx.beginPath(); ctx.arc(0, -8 * u, 14 * u, Math.PI, 0); ctx.fill(); }
  else if (st === 'spiky') { ctx.beginPath(); ctx.arc(0, -7 * u, 14.5 * u, Math.PI, 0); ctx.fill(); for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 5 * u, -18 * u); ctx.lineTo(i * 5 * u + 2 * u, -25 * u); ctx.lineTo(i * 5 * u + 5 * u, -17 * u); ctx.fill(); } }
  else if (st === 'messy') { ctx.beginPath(); ctx.arc(0, -8 * u, 14.5 * u, Math.PI * 0.9, Math.PI * 2.05); ctx.fill(); ctx.beginPath(); ctx.arc(-8 * u, -20 * u, 5 * u, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(7 * u, -21 * u, 4 * u, 0, 7); ctx.fill(); }
  else if (st === 'flat') { roundRect(ctx, -14 * u, -20 * u, 28 * u, 12 * u, 3 * u); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(0, -7 * u, 14.5 * u, Math.PI * 0.92, Math.PI * 2.08); ctx.fill(); }
  // 眼镜
  if (L.glasses) { ctx.strokeStyle = '#4a4438'; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.arc(-5.5 * u, -4 * u, 4.5 * u, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(5.5 * u, -4 * u, 4.5 * u, 0, 7); ctx.stroke(); }
  // 眼
  ctx.fillStyle = '#2c2820';
  ctx.beginPath(); ctx.arc(-5 * u, -4 * u, 1.7 * u, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(5 * u, -4 * u, 1.7 * u, 0, 7); ctx.fill();
  // 随身标识
  if (L.acc) { ctx.font = `${15 * u}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(L.acc, 19 * u, -12 * u); }
  ctx.restore();
}
/* 画圆角矩形路径（只描路径不上色，调用方随后自己 fill/stroke）。
   arcTo 用四段圆弧把四个角抹圆；第一行先把 r 夹到不超过边长一半，
   防止半径比矩形还大时画出现怪图形。它是顶层 function 声明，
   本文件的道具/名牌和 minigames.js 的按钮都在用它。 */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- 世界 ---------- */
/* World 是一个 IIFE（立即执行函数表达式）：定义完马上执行一次，
   return 出去的对象才是外界能摸到的接口；cv、player、npcs 这些变量
   被关在闭包里当私有状态，外部只能通过接口方法间接读写——这是没有
   模块系统的年代最朴素的“模块”写法，作用类似 Python 里整个 .py 文件。 */
const World = (() => {
  // $ 是 config.js 的 DOM 查询工具（按 CSS 选择器找元素），#world 是
  // index.html 里铺满窗口的 <canvas>；getContext('2d') 拿到“画笔”，
  // 之后所有绘制都通过它进行
  const cv = $('#world');
  const ctx = cv.getContext('2d');
  let scene = null, sceneId = '';
  // player：主角状态。path 是待走的路径点队列（点地面后由寻路填入），speed 单位是“像素/秒”
  let player = { x: 200, y: 300, path: [], speed: 230 };
  // cam：相机。x/y 是镜头中心对准的世界坐标，scale 是缩放倍率
  let cam = { x: 0, y: 0, scale: 1 };
  let npcs = [];       // {p, x, y, busy}
  let doorCd = 0;      // 进门冷却
  let t0 = performance.now();
  // keys：键盘按下状态表，键名是 e.key（如 'w'、'ArrowLeft'），值为 true/false
  let keys = {};
  let onCtx = null;    // (ctxObj|null) 邻近交互回调
  // near：玩家此刻“够得着”的可交互对象（事件/NPC/任务/门），一旦变化就回调 onCtx 刷新交互条
  let near = null;

  /* ---- 网格与寻路 ---- */
  /* 寻路思路：把场景切成 T×T（40 像素）的方格，1=可走、0=被道具占住。
     点地面时先算出一条格子序列，主角沿着格子中心走——比逐像素判碰撞
     省事得多，也保证永远不会一头扎进桌子 */
  const T = 40;
  let grid = null, gw = 0, gh = 0;
  /* 把场景里的道具“盖章”到网格上：道具占到的格子一律记 0。
     window/track/mat/board（窗、跑道、垫子、黑板）是贴墙或贴地的
     装饰，人要能从跟前走过，所以豁免、不入网格 */
  function buildGrid() {
    gw = Math.ceil(scene.w / T); gh = Math.ceil(scene.h / T);
    grid = Array.from({ length: gh }, () => Array(gw).fill(1));
    scene.props.forEach(pr => {
      if (pr.t === 'window' || pr.t === 'track' || pr.t === 'mat' || pr.t === 'board') return;
      const x0 = Math.max(0, Math.floor(pr.x / T)), x1 = Math.min(gw - 1, Math.floor((pr.x + pr.w - 1) / T));
      const y0 = Math.max(0, Math.floor(pr.y / T)), y1 = Math.min(gh - 1, Math.floor((pr.y + pr.h - 1) / T));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = 0;
    });
  }
  // 判断世界坐标 (x, y) 所在的格子能不能走：先换算成格子下标，再查表
  function walk(x, y) { const gx = Math.floor(x / T), gy = Math.floor(y / T); return gx >= 0 && gy >= 0 && gx < gw && gy < gh && grid[gy][gx] === 1; }
  /* BFS（广度优先搜索）寻路：从起点一格一格向外“水波式扩散”，第一
     次摸到终点的那条路线必然步数最少。prev 这个 Map 记录“我这格是
     从哪格走过来的”，到终点后顺着 prev 一路回溯，就能拼出完整路径 */
  function bfsPath(sx, sy, tx, ty) {
    const s = [Math.floor(sx / T), Math.floor(sy / T)], t = [Math.floor(tx / T), Math.floor(ty / T)];
    if (!walk(t[0] * T + 20, t[1] * T + 20)) { // 目标不可走则找邻近
      // 暴力扫全图，取离目标最近的可走格当新目标（1e9 即 10 亿，当“无穷大”初值用）
      let best = null, bd = 1e9;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y][x]) {
        const d = (x - t[0]) ** 2 + (y - t[1]) ** 2; if (d < bd) { bd = d; best = [x, y]; }
      }
      if (!best) return null; t[0] = best[0]; t[1] = best[1];
    }
    // 二维下标压成一维编号 (x, y) → y*gw+x：查重、存 Map 都只需一个数字
    const key = (x, y) => y * gw + x;
    const prev = new Map(); const q = [s]; prev.set(key(s[0], s[1]), null);
    // q 当队列用：shift() 取队头（最早入队的先出），正是 BFS 的扩散顺序
    while (q.length) {
      const [x, y] = q.shift();
      if (x === t[0] && y === t[1]) {
        // 到达终点：从终点沿 prev 回溯到起点；unshift 逐个往前插，
        // 最终 path 正好按“从起点到终点”排列，每个点取格子中心
        const path = []; let k = [x, y];
        while (k) { path.unshift({ x: k[0] * T + 20, y: k[1] * T + 20 }); k = prev.get(key(k[0], k[1])); }
        return path;
      }
      // 枚举右/左/下/上四个相邻格：越界或撞墙（≠1）跳过，走过的（prev 已有）跳过
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || grid[ny][nx] !== 1) return;
        if (prev.has(key(nx, ny))) return;
        prev.set(key(nx, ny), [x, y]); q.push([nx, ny]);
      });
    }
    return null;
  }

  /* ---- NPC 调度 ---- */
  /* 极简字符串哈希：把 id 揉成一个 0~65535 的数。不是加密，只求
     “同一个 id 每次算出来都一样、不同 id 尽量散得开”——这样 NPC
     的站位不用存档，每次进场景都能稳定重现 */
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h; }
  /* 给人物 id 挑一个场景里的站位：先从场景 spots 里按哈希取一个
     锚点，再叠加确定性的随机偏移把人散开 */
  function sceneSpot(sceneId2, id) {
    const sc = SCENE_BY_ID[sceneId2]; if (!sc) return [sc ? sc.w / 2 : 300, sc ? sc.h / 2 : 300];
    const spots = Object.values(sc.spots || {});
    if (!spots.length) return [sc.w / 2, sc.h - 120];
    const s = spots[hash(id) % spots.length];
    // 大幅度确定性散开，避免多人挤成一团
    return [
      clamp(s[0] + (hash(id + 'x') % 340) - 170, 80, sc.w - 80),
      clamp(s[1] + (hash(id + 'y') % 120) - 60, 80, sc.h - 90),
    ];
  }
  function placement(p) {
    // 事件优先：把事件角色临时放到事件现场
    for (const ev of Engine.eventsNow()) {
      if (ev.cast.includes(p.id)) return { scene: ev.scene, pos: ev.pos.slice(), busy: true };
    }
    /* 时段（Engine.period）在此**只作氛围调度**（每天随机轮换），不再门控任何玩法：
       它决定 NPC 此刻更像在教室、在食堂还是在走廊，仅此而已。 */
    const per = Engine.period();
    // 第 15 章（番外）开启后，“二中番外四人”（PEOPLE_WAI）固定到校门口候场
    if (G.ch >= 15 && PEOPLE_WAI.some(w => w.id === p.id)) return { scene: 'gate', pos: [700, 300] };
    // 校长：全天蹲办公室的校长位
    if (p.role === 'p') return { scene: 'office', pos: SCENE_BY_ID.office.spots.of_head };
    // 老师：上午/下午有课则去六班讲台，其余回办公室（hanxiao 等有专座）
    if (p.role === 't') {
      if ((per === 'morning' || per === 'aft') && p.cls === '6' && p.id !== 'hanxiao')
        return { scene: 'classroom6', pos: [540, 210] };
      const o = p.id === 'hanxiao' ? SCENE_BY_ID.office.spots.of_hx : p.id === 'chongguo' ? SCENE_BY_ID.office.spots.of_head : [280, 500];
      return { scene: 'office', pos: o };
    }
    // 学生
    // 晚自习回教室；中午约六成学生去食堂（hash 决定，天天一致）；平时待在“家”（默认走廊）
    if (per === 'eve' && (p.cls === '6' || p.cls === '7'))
      return { scene: p.cls === '6' ? 'classroom6' : 'classroom7', pos: sceneSpot(p.cls === '6' ? 'classroom6' : 'classroom7', p.id) };
    if (per === 'noon' && (hash(p.id) % 10) < 6) return { scene: 'canteen', pos: sceneSpot('canteen', p.id) };
    return { scene: p.home || 'corridor', pos: sceneSpot(p.home || 'corridor', p.id) };
  }
  /* 按 placement() 重排全场 NPC，只把“身在当前场景”的留下来。
     切场景、时段切换、事件开演之后都会调它，让众人重新就位 */
  function refreshNPCs() {
    npcs = [];
    PEOPLE.forEach(p => {
      const pl = placement(p);
      if (pl.scene !== sceneId) return;
      npcs.push({ p, x: pl.pos[0], y: pl.pos[1], busy: !!pl.busy });
    });
  }

  /* ---- 场景 ---- */
  /* 落点避让：默认/门口落点可能恰好踩在道具碰撞盒里（曾在走廊长椅、食堂圆桌、
     宿舍柜、办公楼档案柜四处复现"落地即卡死"），故就近找一个能站的位置 */
  function freeSpot(x, y) {
    if (!collides(x, y)) return [x, y];
    // 螺旋找空位：半径从 26 起步、每圈放大 22，每圈均测 16 个方向，
    // 撞见第一个不碰撞的点就用；全都失败则原样返回（极端兜底）
    for (let r = 26; r <= 300; r += 22) {
      for (let a = 0; a < 16; a++) {
        const nx = x + Math.cos(a / 16 * Math.PI * 2) * r;
        const ny = y + Math.sin(a / 16 * Math.PI * 2) * r;
        if (!collides(nx, ny)) return [nx, ny];
      }
    }
    return [x, y];
  }
  /* 进场景总入口：换场景数据 → 重建网格 → 定落点 → 重排 NPC →
     通知各面板刷新。atDoor 是可选落点（从某扇门穿过来时由 doorTarget
     算好传入），不传就落默认位置 */
  function enterScene(id, atDoor) {
    scene = SCENE_BY_ID[id]; sceneId = id;
    // 记入“到访过”清单（探索度/成就类玩法用），并记下最后所在场景供读档恢复
    if (!G.flags.visitedScenes.includes(id)) G.flags.visitedScenes.push(id);
    G.flags.lastScene = id;
    buildGrid();
    let sx, sy;
    if (atDoor) { sx = clamp(atDoor[0], 40, scene.w - 40); sy = clamp(atDoor[1], 40, scene.h - 40); }
    else { sx = scene.w / 2; sy = scene.h - 110; }
    // freeSpot 兜底：落点若恰好撞进道具碰撞盒，就近挪到能站的位置（见上方 freeSpot 注释）
    const sp = freeSpot(sx, sy);
    player.x = sp[0]; player.y = sp[1];
    player.path = [];
    refreshNPCs();
    // 进场景可能改变“可去之处/传闻/任务”的显示，把相关面板都刷一遍
    UI.renderPlaces();
    UI.renderHearsay();
    // 跨文件判活惯用法：Quests 定义在后面的文件里，先用 typeof 探一探，
    // 没加载就安静跳过，绝不会抛 ReferenceError（裸名直接比较会炸）
    if (typeof Quests !== 'undefined') Quests.render();
  }
  /* 算“穿过这扇门后落在对面哪里”：在对面场景找一扇通回本场景的门，
     落在它下方 34 像素处——两个场景的门因此互相对得上，来回穿不迷路 */
  function doorTarget(d) {
    const sc = SCENE_BY_ID[d.to];
    // 落点：对面场景的某扇回到本场景的门旁
    const back = sc.doors.find(dd => dd.to === sceneId);
    if (back) return [back.x + back.w / 2, back.y + back.h + 34];
    return [sc.w / 2, sc.h - 110];
  }

  /* ---- 绘制 ---- */
  /* 画一个道具：按 pr.t（道具类型）用基础图形拼装简笔画。先设
     fillStyle 再画形状；多数配方按“阴影 → 底色 → 高光”三层叠加，
     两三个矩形就能叠出立体感 */
  function drawProp(pr) {
    const c = ctx;
    // 局部小工具：在道具下方写一行灰色小字（很多 case 的末尾调用它）
    const label = f => { if (pr.label) { c.fillStyle = 'rgba(60,55,40,.55)'; c.font = '10px sans-serif'; c.textAlign = 'center'; c.fillText(pr.label, pr.x + pr.w / 2, pr.y + pr.h + 12); } };
    switch (pr.t) {
      case 'wall': c.fillStyle = '#8d8371'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 4); c.fill(); break;
      case 'desk': case 'longtable': case 'table': {
        c.fillStyle = 'rgba(30,26,16,.10)'; roundRect(c, pr.x + 3, pr.y + 5, pr.w, pr.h, 8); c.fill();
        c.fillStyle = pr.t === 'desk' ? '#c9b389' : '#b89d72'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.fill();
        c.fillStyle = 'rgba(255,255,255,.25)'; roundRect(c, pr.x + 3, pr.y + 3, pr.w - 6, pr.h * 0.35, 6); c.fill();
        label(); break; }
      case 'round': {
        c.fillStyle = 'rgba(30,26,16,.10)'; c.beginPath(); c.ellipse(pr.x + pr.w / 2 + 3, pr.y + pr.h / 2 + 5, pr.w / 2, pr.h / 2, 0, 0, 7); c.fill();
        c.fillStyle = '#b89d72'; c.beginPath(); c.ellipse(pr.x + pr.w / 2, pr.y + pr.h / 2, pr.w / 2, pr.h / 2, 0, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.ellipse(pr.x + pr.w / 2, pr.y + pr.h / 2 - 6, pr.w / 2.6, pr.h / 4, 0, 0, 7); c.fill(); break; }
      case 'bookshelf': case 'shelf': {
        c.fillStyle = pr.t === 'bookshelf' ? '#7a5f40' : '#9a8a6a'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 6); c.fill();
        const cols = ['#b8432f', '#3e7a5e', '#41608c', '#a8842c'];
        for (let i = 0; i < 4; i++) { c.fillStyle = cols[(i + pr.x) % 4]; c.fillRect(pr.x + 6 + i * (pr.w - 12) / 4 + 2, pr.y + 8, (pr.w - 12) / 4 - 4, pr.h * 0.4); }
        c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(pr.x + 4, pr.y + pr.h * 0.52, pr.w - 8, 3); label(); break; }
      case 'board': c.fillStyle = '#3f4a3c'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.fill();
        c.strokeStyle = '#8d6b4a'; c.lineWidth = 4; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '12px serif'; c.textAlign = 'center';
        c.fillText('温故而知新', pr.x + pr.w / 2, pr.y + pr.h / 2 + 4); break;
      case 'podium': c.fillStyle = '#8d6b4a'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 6); c.fill(); label(); break;
      case 'window': c.fillStyle = '#bcd6e2'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 4); c.fill();
        c.strokeStyle = '#ffffff88'; c.lineWidth = 2; c.strokeRect(pr.x + 2, pr.y + 2, pr.w - 4, pr.h - 4); break;
      case 'bunk': c.fillStyle = '#a08a64'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.fill();
        c.fillStyle = '#e8e0cc'; roundRect(c, pr.x + 6, pr.y + 6, pr.w * 0.3, pr.h - 12, 6); c.fill();
        c.fillStyle = '#6b84a0'; roundRect(c, pr.x + pr.w * 0.38, pr.y + 6, pr.w * 0.56, pr.h - 12, 6); c.fill(); label(); break;
      case 'locker': c.fillStyle = '#9aa4ac'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 6); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.2)'; c.lineWidth = 1.5;
        for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(pr.x + 4, pr.y + i * pr.h / 4); c.lineTo(pr.x + pr.w - 4, pr.y + i * pr.h / 4); c.stroke(); } label(); break;
      case 'fan': c.fillStyle = '#7d8892'; c.beginPath(); c.arc(pr.x + 25, pr.y + 25, 22, 0, 7); c.fill();
        // 叶片角度直接用当前时间算——“拿时间当参数”是最省事的物件动画
        c.fillStyle = '#cfd6dc';
        for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(pr.x + 25, pr.y + 25, 16, 5, i * 2.09 + performance.now() / 300, 0, 7); c.fill(); }
        c.fillStyle = '#5a646e'; c.beginPath(); c.arc(pr.x + 25, pr.y + 25, 4, 0, 7); c.fill(); break;
      case 'tree': c.fillStyle = '#7a5a3a'; c.fillRect(pr.x + pr.w / 2 - 5, pr.y + pr.h * 0.5, 10, pr.h * 0.5);
        c.fillStyle = '#5d8a5a'; c.beginPath(); c.arc(pr.x + pr.w / 2, pr.y + pr.h * 0.38, pr.w / 2, 0, 7); c.fill();
        c.fillStyle = '#6f9a68'; c.beginPath(); c.arc(pr.x + pr.w / 2 - 8, pr.y + pr.h * 0.3, pr.w / 3.2, 0, 7); c.fill(); break;
      case 'plant': c.fillStyle = '#b0653a'; roundRect(c, pr.x + 8, pr.y + pr.h - 16, 24, 16, 4); c.fill();
        c.fillStyle = '#5d8a5a'; c.beginPath(); c.arc(pr.x + 20, pr.y + 12, 13, 0, 7); c.fill();
        c.fillStyle = '#6f9a68'; c.beginPath(); c.arc(pr.x + 13, pr.y + 8, 8, 0, 7); c.fill(); break;
      case 'track': c.strokeStyle = '#c47a54'; c.lineWidth = 26; c.beginPath();
        c.ellipse(pr.x + pr.w / 2, pr.y + pr.h / 2, pr.w / 2 - 13, pr.h / 2 - 13, 0, 0, 7); c.stroke();
        c.fillStyle = '#b8d48a'; c.beginPath(); c.ellipse(pr.x + pr.w / 2, pr.y + pr.h / 2, pr.w / 2 - 34, pr.h / 2 - 34, 0, 0, 7); c.fill(); break;
      case 'basket': c.strokeStyle = '#6a6458'; c.lineWidth = 5; c.beginPath(); c.moveTo(pr.x + pr.w / 2, pr.y + pr.h); c.lineTo(pr.x + pr.w / 2, pr.y); c.stroke();
        c.fillStyle = '#e8e2d4'; roundRect(c, pr.x - 8, pr.y - 14, pr.w + 16, 22, 4); c.fill(); break;
      case 'pingpong': c.fillStyle = '#3e7a5e'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 6); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(pr.x + pr.w / 2, pr.y); c.lineTo(pr.x + pr.w / 2, pr.y + pr.h); c.stroke();
        c.strokeStyle = '#ffffffaa'; c.beginPath(); c.moveTo(pr.x + pr.w / 2, pr.y - 6); c.lineTo(pr.x + pr.w / 2, pr.y + pr.h + 6); c.stroke(); label(); break;
      case 'counter': c.fillStyle = '#a99a78'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.fill();
        c.fillStyle = '#cbb98e'; roundRect(c, pr.x, pr.y, pr.w, 12, 6); c.fill(); label(); break;
      case 'sofa': c.fillStyle = '#7a6a8a'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 14); c.fill(); label(); break;
      case 'pc': c.fillStyle = '#b89d72'; roundRect(c, pr.x, pr.y + pr.h - 18, pr.w, 18, 4); c.fill();
        c.fillStyle = '#3a3f46'; roundRect(c, pr.x + 8, pr.y, pr.w - 16, pr.h - 22, 4); c.fill();
        c.fillStyle = '#7ec8e0'; roundRect(c, pr.x + 12, pr.y + 4, pr.w - 24, pr.h - 32, 2); c.fill(); break;
      case 'machine': c.fillStyle = '#aab4bc'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.fill();
        c.fillStyle = 'rgba(255,255,255,.4)'; roundRect(c, pr.x + 6, pr.y + 6, pr.w - 12, pr.h * 0.3, 4); c.fill(); label(); break;
      case 'mat': c.fillStyle = '#c5c0a8'; for (let i = 0; i < 3; i++) { roundRect(c, pr.x + i * (pr.w / 3) + 4, pr.y, pr.w / 3 - 8, pr.h, 10); c.fill(); } break;
      case 'gate': c.fillStyle = '#8d6b4a'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 10); c.fill();
        c.fillStyle = '#f0e9d6'; c.font = 'bold 26px serif'; c.textAlign = 'center';
        c.fillText('实验', pr.x + pr.w / 2, pr.y + pr.h / 2 + 9); break;
      case 'bench': c.fillStyle = '#a08a64'; roundRect(c, pr.x, pr.y, pr.w, pr.h, 8); c.fill(); label(); break;
    }
  }

  /* 每帧一次的全量重画（世界的心脏）：适配窗口 → 摆相机 → 画地板/
     边墙/道具/门/热点/任务标记 → 人和 NPC 按 y 排序绘制 → 叠时段
     色调与暗角。上一帧的残影不用擦：整个画布每帧都被盖掉重画 */
  function draw() {
    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    // 高分屏适配：物理像素 = CSS 像素 × dpr。canvas 内部分辨率跟着窗口
    // 走；setTransform 让之后的绘制仍按 CSS 像素计数，图形在 Retina 屏
    // 上才不会发虚。窗口尺寸变了就顺手改画布大小
    if (cv.width !== vw * dpr || cv.height !== vh * dpr) { cv.width = vw * dpr; cv.height = vh * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 相机
    // 期望缩放随窗口高度走（夹在 0.72~1.5，太小看不清、太大看不全），
    // lerp 让缩放平滑过渡；cx/cy 是“想对准”的镜头中心，clamp 保证
    // 镜头不出场景边界（四周不露黑）；cam.x/y 再逐帧靠近目标，就是
    // “慢慢跟上”的跟随手感
    const targetScale = clamp(vh / 620, 0.72, 1.5);
    cam.scale = lerp(cam.scale || targetScale, targetScale, 0.1);
    const vw2 = vw / cam.scale, vh2 = vh / cam.scale;
    const cx = clamp(player.x, vw2 / 2, Math.max(vw2 / 2, scene.w - vw2 / 2));
    const cy = clamp(player.y, vh2 / 2, Math.max(vh2 / 2, scene.h - vh2 / 2));
    cam.x = lerp(cam.x, cx, 0.12); cam.y = lerp(cam.y, cy, 0.12);
    // 背景
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, vw, vh);
    // 把画布原点挪到镜头左上角：先 scale（缩放）再 translate（平移），
    // 之后一律用“世界坐标”作画——相机怎么动都不用改绘制代码
    ctx.save();
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(vw2 / 2 - cam.x, vh2 / 2 - cam.y);
    // 地板
    ctx.fillStyle = scene.floor; ctx.fillRect(0, 0, scene.w, scene.h);
    ctx.fillStyle = 'rgba(60,55,40,.05)';
    for (let x = 0; x < scene.w; x += 80) ctx.fillRect(x, 0, 1, scene.h);
    for (let y = 0; y < scene.h; y += 80) ctx.fillRect(0, y, scene.w, 1);
    // 边墙
    ctx.fillStyle = '#6e6553';
    ctx.fillRect(0, 0, scene.w, 12); ctx.fillRect(0, scene.h - 12, scene.w, 12);
    ctx.fillRect(0, 0, 12, scene.h); ctx.fillRect(scene.w - 12, 0, 12, scene.h);
    scene.props.forEach(drawProp);
    // 门
    scene.doors.forEach(d => {
      ctx.fillStyle = 'rgba(184,67,47,.16)';
      roundRect(ctx, d.x, d.y, d.w, d.h, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(184,67,47,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(90,50,35,.85)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.label, d.x + d.w / 2, d.y + d.h / 2 + 4);
    });
    // 热点
    Engine.eventsNow().forEach(ev => {
      if (ev.scene !== sceneId) return;
      const bob = Math.sin(now / 300 + ev.pos[0]) * 4;
      ctx.fillStyle = '#b8432f';
      ctx.beginPath(); ctx.arc(ev.pos[0], ev.pos[1] - 46 + bob, 13, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px serif'; ctx.textAlign = 'center';
      ctx.fillText('记', ev.pos[0], ev.pos[1] - 41 + bob);
      ctx.fillStyle = 'rgba(40,30,20,.75)'; roundRect(ctx, ev.pos[0] - 34, ev.pos[1] - 26, 68, 20, 10); ctx.fill();
      ctx.fillStyle = '#f3efe4'; ctx.font = '11px sans-serif';
      ctx.fillText(ev.name, ev.pos[0], ev.pos[1] - 12);
    });
    // 任务标记（主线「令」／支线「刀」）
    if (typeof Quests !== 'undefined') {
      Quests.markers().forEach(mk => {
        if (mk.q.where !== sceneId) return;
        const mp = mk.dpos || mk.q.pos;
        // bob：随时间上下浮动的偏移，让标记像悬浮的气球；主线「令」金色、支线「刀」绿色
        const bob = Math.sin(now / 320 + mp[1]) * 4;
        const col = mk.main ? '#a8842c' : '#3e7a5e';
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(mp[0], mp[1] - 52 + bob, 14, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mp[0], mp[1] - 52 + bob, 14, 0, 7); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px serif'; ctx.textAlign = 'center';
        ctx.fillText(mk.main ? '令' : '刀', mp[0], mp[1] - 46 + bob);
        ctx.fillStyle = 'rgba(40,30,20,.78)'; roundRect(ctx, mp[0] - 46, mp[1] - 32, 92, 20, 10); ctx.fill();
        ctx.fillStyle = '#f3efe4'; ctx.font = '11px sans-serif';
        ctx.fillText(mk.q.name, mp[0], mp[1] - 18);
      });
    }
    // NPC
    // 画家算法：把人和 NPC 放一起按 y 从小到大排（y 大 = 更靠下 = 离
    // 镜头近），从远到近地画，站位重叠时才有“前面的人挡住后面的人”
    const sortables = npcs.map(n => ({ y: n.y, draw: () => drawNPC(n, now) }));
    sortables.push({ y: player.y, draw: () => drawPlayer(now) });
    sortables.sort((a, b) => a.y - b.y).forEach(o => o.draw());
    ctx.restore();
    // 时段氛围（纯视觉：晨光/午后/夜色，无玩法含义）
    const per = Engine.period();
    if (per === 'morning') { ctx.fillStyle = 'rgba(255,190,120,.10)'; ctx.fillRect(0, 0, vw, vh); }
    else if (per === 'aft') { ctx.fillStyle = 'rgba(255,215,150,.07)'; ctx.fillRect(0, 0, vw, vh); }
    else if (per === 'eve') { ctx.fillStyle = 'rgba(18,22,48,.34)'; ctx.fillRect(0, 0, vw, vh); }
    // 暗角
    // 径向渐变从透明到半透明黑：四周变暗、中心透亮，把视线聚到画面中间
    const g = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.4, vw / 2, vh / 2, vh * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,15,5,.22)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
  }
  /* 画一个 NPC：save+translate 挪到对方脚下，先画人再画头顶名牌。
     measureText 量出名字的实际宽度，名牌长短跟着文字走 */
  function drawNPC(n, now) {
    // sin 波让每个人轻轻“呼吸”；加上 n.x 当相位，各人起伏错开不同步
    const bob = Math.sin(now / 450 + n.x) * 1.5;
    ctx.save(); ctx.translate(n.x, n.y + bob);
    drawAvatar(ctx, n.p, 0, 0, 56);
    if (n.busy) { // 事件人物头上有笔墨提示
      ctx.fillStyle = '#b8432f'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('◆', 20, -34);
    }
    // 名牌
    const name = n.p.hao || n.p.name;
    ctx.font = '11px sans-serif';
    const w = ctx.measureText(name).width + 14;
    ctx.fillStyle = 'rgba(252,250,244,.82)'; roundRect(ctx, -w / 2, -44, w, 18, 9); ctx.fill();
    ctx.fillStyle = '#403a2e'; ctx.textAlign = 'center'; ctx.fillText(name, 0, -31);
    ctx.restore();
  }
  /* 画主角：与 drawNPC 同一套路（save/translate 局部坐标系）。走路时
     （path 非空）bob 摆幅更大，看起来在迈步；白衫、朱砂围巾和手里的
     笔是主角的视觉标识，名牌底色也用主角专属的朱红 */
  function drawPlayer(now) {
    ctx.save(); ctx.translate(player.x, player.y);
    const bob = Math.sin(now / 160) * (player.path.length ? 2.2 : 1);
    ctx.translate(0, bob * 0.4);
    // 主角：白衫 + 朱砂围巾
    ctx.fillStyle = 'rgba(30,26,16,.2)'; ctx.beginPath(); ctx.ellipse(0, 30, 20, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f4efe2'; roundRect(ctx, -14, 8, 28, 26, 10); ctx.fill();
    ctx.fillStyle = '#b8432f'; roundRect(ctx, -12, 8, 24, 8, 5); ctx.fill();
    ctx.fillStyle = '#f2d6b3'; ctx.beginPath(); ctx.arc(0, -6, 15, 0, 7); ctx.fill();
    ctx.fillStyle = '#1c1812'; roundRect(ctx, -14, -20, 28, 11, 4); ctx.fill();
    ctx.fillStyle = '#2c2820';
    ctx.beginPath(); ctx.arc(-5, -4, 1.7, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -4, 1.7, 0, 7); ctx.fill();
    // 手中笔
    ctx.strokeStyle = '#26241f'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(16, 14); ctx.lineTo(23, 4); ctx.stroke();
    ctx.fillStyle = '#b8432f'; ctx.beginPath(); ctx.arc(23.6, 3, 2.2, 0, 7); ctx.fill();
    const name = '音克思';
    ctx.font = '11px sans-serif';
    const w = ctx.measureText(name).width + 14;
    ctx.fillStyle = 'rgba(184,67,47,.92)'; roundRect(ctx, -w / 2, -44, w, 18, 9); ctx.fill();
    ctx.fillStyle = '#fff6f0'; ctx.textAlign = 'center'; ctx.fillText(name, 0, -31);
    ctx.restore();
  }

  /* ---- 移动 ---- */
  /* 主角每帧的位移：键盘有输入就按方向走（并清空点击路径，两套输入
     不打架）；没按键盘才沿寻路队列逐点走。末尾顺带做“是否踩到门”
     的检测（有冷却，防止两个场景来回横跳） */
  function tickMove(dt) {
    // 键盘优先
    // 布尔值参与加减会变成 1/0：两行算出水平/垂直方向（-1/0/1）。
    // 再用 Math.hypot 求向量长度做归一化——斜着走不会比直走更快
    let kx = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0);
    let ky = (keys.s || keys.ArrowDown ? 1 : 0) - (keys.w || keys.ArrowUp ? 1 : 0);
    if (kx || ky) {
      player.path = [];
      const len = Math.hypot(kx, ky) || 1;
      tryMove(kx / len * player.speed * dt, ky / len * player.speed * dt);
    } else if (player.path.length) {
      // 沿路径走：离当前路点不足 6 像素就算到达（shift 弃掉它），否则朝它挪
      const t = player.path[0];
      const dx = t.x - player.x, dy = t.y - player.y, d = Math.hypot(dx, dy);
      if (d < 6) player.path.shift();
      else tryMove(dx / d * player.speed * dt, dy / d * player.speed * dt);
    }
    // 门检测
    // doorCd 是进门冷却（秒）：刚穿门后 0.5 秒内不再检测，
    // 防止站在门边被相邻两扇门“弹来弹去”
    if (doorCd > 0) doorCd -= dt;
    else {
      // 找玩家所站的门（判定框比门四周各大 6 像素，好踩上去）；校长室走专属分支
      const d = scene.doors.find(d => player.x > d.x - 6 && player.x < d.x + d.w + 6 && player.y > d.y - 6 && player.y < d.y + d.h + 6);
      if (d) {
        Sfx.page();
        const at = doorTarget(d);
        if (d.inner && d.zone === 'principal') { enterScene('office', at); doorCd = 0.5; UI.toastScene('校长室'); }
        else { enterScene(d.to, at); doorCd = 0.5; UI.toastScene(SCENE_BY_ID[d.to].name); }
      }
    }
  }
  /* 点 (x, y) 能不能站：先查是否出界（四周留 26 像素），再逐个道具
     查矩形重叠（留 12/10 像素余量，碰撞盒比画面稍大一圈，手感更稳）。
     window/track/mat/board 与寻路网格口径一致地豁免 */
  function collides(x, y) {
    if (x < 26 || y < 26 || x > scene.w - 26 || y > scene.h - 26) return true;
    for (const pr of scene.props) {
      if (['window', 'track', 'mat', 'board'].includes(pr.t)) continue;
      if (x > pr.x - 12 && x < pr.x + pr.w + 12 && y > pr.y - 10 && y < pr.y + pr.h + 12) return true;
    }
    return false;
  }
  /* 分轴移动：x、y 各自试探，哪根轴撞了就只废掉那半步。贴着墙走会
     “滑过去”而不是原地卡死——2D 游戏最经典的碰撞小技巧 */
  function tryMove(dx, dy) {
    if (!collides(player.x + dx, player.y)) player.x += dx;
    if (!collides(player.x, player.y + dy)) player.y += dy;
  }

  /* ---- 输入 ---- */
  /* 屏幕坐标 → 世界坐标：draw 里相机做的是“先 scale 再 translate”，
     这里做逆运算（除回缩放、减回平移），点击才能点准世界里的点 */
  function toWorld(mx, my) {
    const vw2 = window.innerWidth / cam.scale, vh2 = window.innerHeight / cam.scale;
    return { x: (mx / cam.scale) + cam.x - vw2 / 2, y: (my / cam.scale) + cam.y - vh2 / 2 };
  }
  /* 一次点击的“接力赛”：对话/小游戏/战斗进行中时世界让位（直接
     return，一个字符都不处理——BATTLE_ACTIVE 就是战斗层立的那面
     旗子）；否则按 热点事件 → 任务标记 → NPC → 走路 的优先级逐个
     尝试，谁先命中谁消费这次点击，后面的就不再看 */
  cv.addEventListener('pointerdown', e => {
    if (Dialog.active || MG.active || window.BATTLE_ACTIVE) return;
    // getBoundingClientRect 拿 canvas 在页面里的位置和尺寸，
    // 减去左上角偏移才得到“canvas 内部”的点击坐标
    const r = cv.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    // 热点
    const ev = Engine.eventsNow().find(ev => ev.scene === sceneId && Math.hypot(w.x - ev.pos[0], w.y - ev.pos[1] + 20) < 44);
    if (ev) { Main.onEvent(ev); return; }
    // 任务标记
    if (typeof Quests !== 'undefined') {
      const mk = Quests.markers().find(mk => {
        if (mk.q.where !== sceneId) return false;
        const mp = mk.dpos || mk.q.pos;
        /* 只认气泡与名牌本身（约锚点上 -52 与 -22 两处），
           勿把附近的地面点击抢走（否则会出现"不由自主被拉向标记"） */
        return Math.hypot(w.x - mp[0], w.y - (mp[1] - 37)) < 30;
      });
      if (mk) { Main.onQuest(mk.q); return; }
    }
    // NPC
    const n = npcs.find(n => Math.hypot(w.x - n.x, w.y - n.y + 6) < 36);
    if (n) { Main.onNPC(n.p); return; }
    // 移动
    // 谁都没命中：把点击处当目的地，BFS 算路后交给 tickMove 逐点走。
    // path.shift() 丢掉第一个点——那格就是脚下，不必走
    const path = bfsPath(player.x, player.y, w.x, w.y);
    if (path) { path.shift(); player.path = path; }
  });
  // 键盘按下记 true、松开记 false，凑成“按住持续走、松手就停”。
  // 方向键 preventDefault 掉，防止页面跟着滚动
  window.addEventListener('keydown', e => { keys[e.key] = true; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault(); });
  window.addEventListener('keyup', e => { keys[e.key] = false; });

  /* ---- 主循环 ---- */
  /* 主循环：requestAnimationFrame 请浏览器“下一帧再叫我”（屏幕约每
     秒刷 60 次），游戏的心跳。小游戏或战斗进行中只暂停世界逻辑，
     循环本身继续转——一旦不预约下一帧，就再也没有人来叫醒它了 */
  let last = performance.now();
  function loop() {
    const now = performance.now();
    // dt：这一帧距上一帧的秒数，所有位移都乘它，帧率快慢不影响速度。
    // 夹到 0.05 秒以内，防止切走标签页再回来时角色“瞬移”
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // 世界可动的前提：场景已加载，且小游戏/战斗都没在占用
    if (scene && !MG.active && !window.BATTLE_ACTIVE) {
      tickMove(dt);
      draw();
      // 邻近检测：事件优先（限时时限，错过不再来），其次 NPC
      let best = null;
      Engine.eventsNow().forEach(ev => { if (ev.scene !== sceneId) return; const d = Math.hypot(ev.pos[0] - player.x, ev.pos[1] - player.y); if (d < 100) best = { type: 'event', ev }; });
      if (!best) {
        let bd = 90;
        npcs.forEach(n => { const d = Math.hypot(n.x - player.x, n.y - player.y); if (d < bd) { bd = d; best = { type: 'npc', p: n.p }; } });
      }
      if (!best && typeof Quests !== 'undefined') {
        const qm = Quests.nearMarker(sceneId, player.x, player.y, 100);
        if (qm) best = { type: 'quest', q: qm.m.q, main: qm.m.main };
      }
      if (!best) {
        const door = scene.doors.find(d => Math.hypot(d.x + d.w / 2 - player.x, d.y + d.h / 2 - player.y) < 70);
        if (door) best = { type: 'door', door };
      }
      // “附近对象”发生变化才回调 onCtx 刷新交互条：JSON.stringify 把
      // 两个对象转成字符串再比相等，是偷懒但够用的深比较
      if ((best && !near) || (!best && near) || (best && near && JSON.stringify(best) !== JSON.stringify(near))) { near = best; onCtx && onCtx(near); }
    }
    requestAnimationFrame(loop);
  }

  /* 对外接口：get 开头的是“只读视图”（外面能读不能改，保护闭包里的
     内部状态）；其余是主流程会调用的动作——walkTo/travel 让 main.js
     远程指挥主角（比如“先走到任务点”），setOnCtx 注册交互条回调 */
  return {
    // getter 写法：像读属性一样用（World.sceneId），实际执行的是这个小函数
    get sceneId() { return sceneId; },
    get playerPos() { return [player.x, player.y]; },
    get active() { return !!scene; },
    enter(id) { enterScene(id); cam.x = player.x; cam.y = player.y; },
    refresh() { if (scene) refreshNPCs(); },
    setOnCtx(f) { onCtx = f; },
    start() { requestAnimationFrame(loop); },
    travel(id) { if (SCENE_BY_ID[id]) { Sfx.page(); enterScene(id); UI.toastScene(SCENE_BY_ID[id].name); } },
    walkTo(x, y) { const p = bfsPath(player.x, player.y, x, y); if (p) { p.shift(); player.path = p; } },
    resetNear() { near = null; },
    npcPos(id) { const n = npcs.find(n => n.p.id === id); return n ? [n.x, n.y] : null; },
    isNearNPC(id) { return npcs.some(n => n.p.id === id && Math.hypot(n.x - player.x, n.y - player.y) < 90); },
    /* 现画一张头像 canvas 交给面板当图片用：内部尺寸按像素密度放大
       保证清晰，style.width/height 再把它显示为请求的 CSS 大小 */
    avatarCanvas(p, size) {
      const c = document.createElement('canvas');
      const d = window.devicePixelRatio || 1;
      c.width = size * d; c.height = size * 1.25 * d;
      c.style.width = size + 'px'; c.style.height = size * 1.25 + 'px';
      const cc = c.getContext('2d'); cc.scale(d, d);
      drawAvatar(cc, p, size / 2, size * 0.56, size * 0.8);
      return c;
    },
  };
})();
