/* 实验史记·春秋笔 —— Canvas 校园世界 */
'use strict';

/* ---------- 头像绘制（世界/对话/图鉴通用） ---------- */
function drawAvatar(ctx, p, cx, cy, s) {
  const L = p.look || {};
  const hair = L.hair || '#2a2620';
  const skin = '#f2d6b3';
  ctx.save();
  ctx.translate(cx, cy);
  const u = s / 64; // 基准 64
  // 影
  ctx.fillStyle = 'rgba(30,26,16,.18)';
  ctx.beginPath(); ctx.ellipse(0, 30 * u, 20 * u, 7 * u, 0, 0, 7); ctx.fill();
  // 身体（制服色）
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
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- 世界 ---------- */
const World = (() => {
  const cv = $('#world');
  const ctx = cv.getContext('2d');
  let scene = null, sceneId = '';
  let player = { x: 200, y: 300, path: [], speed: 230 };
  let cam = { x: 0, y: 0, scale: 1 };
  let npcs = [];       // {p, x, y, busy}
  let doorCd = 0;      // 进门冷却
  let t0 = performance.now();
  let keys = {};
  let onCtx = null;    // (ctxObj|null) 邻近交互回调
  let near = null;

  /* ---- 网格与寻路 ---- */
  const T = 40;
  let grid = null, gw = 0, gh = 0;
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
  function walk(x, y) { const gx = Math.floor(x / T), gy = Math.floor(y / T); return gx >= 0 && gy >= 0 && gx < gw && gy < gh && grid[gy][gx] === 1; }
  function bfsPath(sx, sy, tx, ty) {
    const s = [Math.floor(sx / T), Math.floor(sy / T)], t = [Math.floor(tx / T), Math.floor(ty / T)];
    if (!walk(t[0] * T + 20, t[1] * T + 20)) { // 目标不可走则找邻近
      let best = null, bd = 1e9;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y][x]) {
        const d = (x - t[0]) ** 2 + (y - t[1]) ** 2; if (d < bd) { bd = d; best = [x, y]; }
      }
      if (!best) return null; t[0] = best[0]; t[1] = best[1];
    }
    const key = (x, y) => y * gw + x;
    const prev = new Map(); const q = [s]; prev.set(key(s[0], s[1]), null);
    while (q.length) {
      const [x, y] = q.shift();
      if (x === t[0] && y === t[1]) {
        const path = []; let k = [x, y];
        while (k) { path.unshift({ x: k[0] * T + 20, y: k[1] * T + 20 }); k = prev.get(key(k[0], k[1])); }
        return path;
      }
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
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h; }
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
    const per = Engine.period();
    if (G.ch === 15 && PEOPLE_WAI.some(w => w.id === p.id)) return { scene: 'gate', pos: [700, 300] };
    if (p.role === 'p') return { scene: 'office', pos: SCENE_BY_ID.office.spots.of_head };
    if (p.role === 't') {
      if ((per === 'morning' || per === 'aft') && p.cls === '6' && p.id !== 'hanxiao')
        return { scene: 'classroom6', pos: [540, 210] };
      const o = p.id === 'hanxiao' ? SCENE_BY_ID.office.spots.of_hx : p.id === 'chongguo' ? SCENE_BY_ID.office.spots.of_head : [280, 500];
      return { scene: 'office', pos: o };
    }
    // 学生
    if (per === 'eve' && (p.cls === '6' || p.cls === '7'))
      return { scene: p.cls === '6' ? 'classroom6' : 'classroom7', pos: sceneSpot(p.cls === '6' ? 'classroom6' : 'classroom7', p.id) };
    if (per === 'noon' && (hash(p.id) % 10) < 6) return { scene: 'canteen', pos: sceneSpot('canteen', p.id) };
    return { scene: p.home || 'corridor', pos: sceneSpot(p.home || 'corridor', p.id) };
  }
  function refreshNPCs() {
    npcs = [];
    PEOPLE.forEach(p => {
      const pl = placement(p);
      if (pl.scene !== sceneId) return;
      npcs.push({ p, x: pl.pos[0], y: pl.pos[1], busy: !!pl.busy });
    });
  }

  /* ---- 场景 ---- */
  function enterScene(id, atDoor) {
    scene = SCENE_BY_ID[id]; sceneId = id;
    if (!G.flags.visitedScenes.includes(id)) G.flags.visitedScenes.push(id);
    G.flags.lastScene = id;
    buildGrid();
    if (atDoor) { player.x = clamp(atDoor[0], 40, scene.w - 40); player.y = clamp(atDoor[1], 40, scene.h - 40); }
    else { player.x = scene.w / 2; player.y = scene.h - 110; }
    player.path = [];
    refreshNPCs();
    UI.renderPlaces();
    UI.renderHearsay();
  }
  function doorTarget(d) {
    const sc = SCENE_BY_ID[d.to];
    // 落点：对面场景的某扇回到本场景的门旁
    const back = sc.doors.find(dd => dd.to === sceneId);
    if (back) return [back.x + back.w / 2, back.y + back.h + 34];
    return [sc.w / 2, sc.h - 110];
  }

  /* ---- 绘制 ---- */
  function drawProp(pr) {
    const c = ctx;
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

  function draw() {
    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (cv.width !== vw * dpr || cv.height !== vh * dpr) { cv.width = vw * dpr; cv.height = vh * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 相机
    const targetScale = clamp(vh / 620, 0.72, 1.5);
    cam.scale = lerp(cam.scale || targetScale, targetScale, 0.1);
    const vw2 = vw / cam.scale, vh2 = vh / cam.scale;
    const cx = clamp(player.x, vw2 / 2, Math.max(vw2 / 2, scene.w - vw2 / 2));
    const cy = clamp(player.y, vh2 / 2, Math.max(vh2 / 2, scene.h - vh2 / 2));
    cam.x = lerp(cam.x, cx, 0.12); cam.y = lerp(cam.y, cy, 0.12);
    // 背景
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, vw, vh);
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
    // NPC
    const sortables = npcs.map(n => ({ y: n.y, draw: () => drawNPC(n, now) }));
    sortables.push({ y: player.y, draw: () => drawPlayer(now) });
    sortables.sort((a, b) => a.y - b.y).forEach(o => o.draw());
    ctx.restore();
    // 时段氛围
    const per = Engine.period();
    if (per === 'morning') { ctx.fillStyle = 'rgba(255,190,120,.10)'; ctx.fillRect(0, 0, vw, vh); }
    else if (per === 'aft') { ctx.fillStyle = 'rgba(255,215,150,.07)'; ctx.fillRect(0, 0, vw, vh); }
    else if (per === 'eve') { ctx.fillStyle = 'rgba(18,22,48,.34)'; ctx.fillRect(0, 0, vw, vh); }
    // 暗角
    const g = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.4, vw / 2, vh / 2, vh * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,15,5,.22)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
  }
  function drawNPC(n, now) {
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
  function tickMove(dt) {
    // 键盘优先
    let kx = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0);
    let ky = (keys.s || keys.ArrowDown ? 1 : 0) - (keys.w || keys.ArrowUp ? 1 : 0);
    if (kx || ky) {
      player.path = [];
      const len = Math.hypot(kx, ky) || 1;
      tryMove(kx / len * player.speed * dt, ky / len * player.speed * dt);
    } else if (player.path.length) {
      const t = player.path[0];
      const dx = t.x - player.x, dy = t.y - player.y, d = Math.hypot(dx, dy);
      if (d < 6) player.path.shift();
      else tryMove(dx / d * player.speed * dt, dy / d * player.speed * dt);
    }
    // 门检测
    if (doorCd > 0) doorCd -= dt;
    else {
      const d = scene.doors.find(d => player.x > d.x - 6 && player.x < d.x + d.w + 6 && player.y > d.y - 6 && player.y < d.y + d.h + 6);
      if (d) {
        Sfx.page();
        const at = doorTarget(d);
        if (d.inner && d.zone === 'principal') { enterScene('office', at); doorCd = 0.5; UI.toastScene('校长室'); }
        else { enterScene(d.to, at); doorCd = 0.5; UI.toastScene(SCENE_BY_ID[d.to].name); }
      }
    }
  }
  function collides(x, y) {
    if (x < 26 || y < 26 || x > scene.w - 26 || y > scene.h - 26) return true;
    for (const pr of scene.props) {
      if (['window', 'track', 'mat', 'board'].includes(pr.t)) continue;
      if (x > pr.x - 12 && x < pr.x + pr.w + 12 && y > pr.y - 10 && y < pr.y + pr.h + 12) return true;
    }
    return false;
  }
  function tryMove(dx, dy) {
    if (!collides(player.x + dx, player.y)) player.x += dx;
    if (!collides(player.x, player.y + dy)) player.y += dy;
  }

  /* ---- 输入 ---- */
  function toWorld(mx, my) {
    const vw2 = window.innerWidth / cam.scale, vh2 = window.innerHeight / cam.scale;
    return { x: (mx / cam.scale) + cam.x - vw2 / 2, y: (my / cam.scale) + cam.y - vh2 / 2 };
  }
  cv.addEventListener('pointerdown', e => {
    if (Dialog.active || MG.active || window.BATTLE_ACTIVE) return;
    const r = cv.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    // 热点
    const ev = Engine.eventsNow().find(ev => ev.scene === sceneId && Math.hypot(w.x - ev.pos[0], w.y - ev.pos[1] + 20) < 44);
    if (ev) { Main.onEvent(ev); return; }
    // NPC
    const n = npcs.find(n => Math.hypot(w.x - n.x, w.y - n.y + 6) < 36);
    if (n) { Main.onNPC(n.p); return; }
    // 移动
    const path = bfsPath(player.x, player.y, w.x, w.y);
    if (path) { path.shift(); player.path = path; }
  });
  window.addEventListener('keydown', e => { keys[e.key] = true; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault(); });
  window.addEventListener('keyup', e => { keys[e.key] = false; });

  /* ---- 主循环 ---- */
  let last = performance.now();
  function loop() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
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
      if (!best) {
        const door = scene.doors.find(d => Math.hypot(d.x + d.w / 2 - player.x, d.y + d.h / 2 - player.y) < 70);
        if (door) best = { type: 'door', door };
      }
      if ((best && !near) || (!best && near) || (best && near && JSON.stringify(best) !== JSON.stringify(near))) { near = best; onCtx && onCtx(near); }
    }
    requestAnimationFrame(loop);
  }

  return {
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
