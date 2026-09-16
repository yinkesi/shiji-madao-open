/* 实验史记·春秋笔 —— 小游戏：月考迟到 / 陀螺 / 食堂冲刺 / 乒乓球 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   四个自包含小游戏的“总机”：月考迟到（限时点按闯关）、陀螺·
   三溴化氮（蓄力对撞）、食堂冲刺（三车道躲避）、乒乓球二十板
   （时机点击）。每个游戏都是一个工厂函数，把状态封在自己的闭包
   里；共用同一块 #mg-canvas 覆盖层和同一条动画循环，玩完把输赢
   经回调交还给主流程。

   【架构位置】
   排在 world.js 之后加载：借用 config.js 的 $、clamp、rand、irand、
   pick、Sfx，以及 world.js 顶层的 drawAvatar 和 roundRect（顶层
   function 声明会挂到全局对象，跨文件裸名直接可调）。对外只暴露
   const MG——顶层 const 不挂 window，跨文件用裸名 MG。dialog.js /
   main.js 调 MG.launch(名字, 完成回调) 开局；world.js / main.js 靠
   MG.active 判断小游戏是否占用输入，占用就给世界“让位”。

   【新手阅读提示】
   1) 每个小游戏返回一个“约定好形状”的对象：update(dt) 推进一帧
      逻辑、draw(ctx) 画一帧、point(x, y, down) 接收点击、key(k)
      接收左右键、swing() 接收空格。公共循环 loop() 每帧只做
      cur.update + cur.draw——像 Python 的“鸭子类型”：只要带齐这些
      方法，谁都能坐上 cur 这把交椅。
   2) 四个游戏共用一份事件监听（画布点击 / 全局键盘），切游戏只是
      换掉 cur，监听器不用重新挂。
   3) end(success) 里的 ended 旗子防重复结算：胜负只认第一次。
   ================================================================ */

/* MG 同样是 IIFE 模块。cur 是“当前在玩的游戏”对象；raf 存动画帧
   请求的编号（cancelAnimationFrame 靠它停循环）；ended 防重复结算；
   onEnd 存“玩完后交给谁”的回调 */
const MG = (() => {
  // 三个 DOM：root 是全屏覆盖层，cv 是画布，hud 是顶部说明文字那一行
  const root = $('#minigame'), cv = $('#mg-canvas'), hud = $('#mg-hud');
  const ctx = cv.getContext('2d');
  // 画布内部分辨率固定不变：游戏逻辑永远按这套坐标系写，不用关心窗口多大
  const W = 760, H = 540;
  let cur = null, raf = 0, last = 0, onEnd = null, ended = false;

  /* 开局布置：算出缩放比 d（不超过 1），把 CSS 显示尺寸乘上 d——
     画面整体塞进窗口且不变形，内部坐标仍是 760×540 */
  function setup() {
    const d = Math.min(window.innerWidth / W, window.innerHeight / H, 1);
    cv.width = W; cv.height = H;
    cv.style.width = W * d + 'px'; cv.style.height = H * d + 'px';
  }
  /* 结束一局：先立 ended 旗子（之后再有人喊 end 一律无视），停掉
     动画循环；900 毫秒后收起覆盖层并回调 onEnd(输赢)——延迟是让
     玩家看清结算画面。`cb && cb(success)`：有回调才调用（短路求值） */
  function end(success) {
    if (ended) return; ended = true;
    cancelAnimationFrame(raf);
    setTimeout(() => { root.classList.add('hidden'); const cb = onEnd; onEnd = null; cur = null; cb && cb(success); }, 900);
  }
  /* 四个游戏共用的主循环：让当前游戏推进一帧、画一帧；只要没结束
     就继续预约下一帧。dt 夹在 0.05 秒内，防止切走标签页回来时“时间
     大跳”（小球瞬移、倒计时狂掉） */
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (cur) { cur.update(dt); cur.draw(ctx); }
    if (!ended) raf = requestAnimationFrame(loop);
  }
  // 铺米色纸面 + 细横线：四个游戏共用的“作业本”底
  function bg() {
    ctx.fillStyle = '#f4efe0'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(60,55,40,.06)';
    for (let y = 0; y < H; y += 26) ctx.fillRect(0, y, W, 1);
  }
  // 带默认值的写字小工具：不传颜色/字体/对齐就用默认，省得每处写全七个参数
  function txt(s, x, y, size, color, font, align) {
    ctx.fillStyle = color || '#26241f';
    ctx.font = `${size}px ${font || 'serif'}`;
    ctx.textAlign = align || 'center';
    ctx.fillText(s, x, y);
  }
  /* 画一个按钮并返回它的矩形 {x, y, w, h}：调用方把返回值攒进数组，
     点击时用 inBtn 判断点中了哪个。hot=true 画成高亮红（选中感） */
  function button(x, y, w, h, label, hot) {
    ctx.fillStyle = hot ? '#b8432f' : '#fffdf5';
    roundRect(ctx, x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = hot ? '#8a2f1c' : 'rgba(0,0,0,.15)'; ctx.lineWidth = 1.5; ctx.stroke();
    txt(label, x + w / 2, y + h / 2 + 6, 17, hot ? '#fff6f0' : '#26241f', 'sans-serif');
    return { x, y, w, h };
  }
  // 点 (x, y) 是否落在按钮矩形内——最基础的矩形命中检测
  const inBtn = (b, x, y) => b && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
  // 画布点击统一转发给当前游戏的 point()。getBoundingClientRect 减去
  // 页面偏移得到画布内坐标；算出的缩放比 d 这里并没有参与换算
  // （坐标按 CSS 像素直传）
  cv.addEventListener('pointerdown', e => {
    if (!cur || !cur.point) return;
    const r = cv.getBoundingClientRect();
    const d = cv.width / r.width;
    cur.point(e.clientX - r.left, e.clientY - r.top, true);
  });

  /* ============ 1. 月考迟到 ============ */
  /* 六个 stage 串成的一天早上：看表(0)→开锁(1)→找笔(2)→找考场(3)→
     填考号(4)→done(5)。timer 是总倒计时（秒），点错一次 fail() 扣 8
     秒；clicks 是“本关已点次数”，每过一关清零复用；btns 攒当前画面
     上按钮的矩形，供 point() 命中检测 */
  function gameLate() {
    let stage = 0, timer = 90, clicks = 0, wrongFlash = 0, msg = '';
    let btns = [];
    const stages = ['clock', 'lock', 'bag', 'room', 'number', 'done'];
    // 点错的代价：留一句提示、倒计时狠扣 8 秒、红光闪 0.5 秒
    function fail(t) { msg = t; timer = Math.max(0, timer - 8); wrongFlash = 0.5; }
    return {
      update(dt) {
        // 还没通关时倒计时才走；红光余量随时间消退。hud 是顶部那行说明文字
        if (stage < 5) { timer -= dt; wrongFlash = Math.max(0, wrongFlash - dt); }
        hud.textContent = `月考之晨 · 剩余 ${Math.ceil(timer)} 秒 · ${msg}`;
        // 超时：定格在失败文案上并 end(false)；stage 拨到 5 让倒计时停下
        if (timer <= 0 && stage < 5) {
          bg(); txt('钟声响时，你还在走廊里。', W / 2, H / 2 - 20, 30, '#b8432f');
          txt('（卒得109。除姓名外靡不毕缪。）', W / 2, H / 2 + 24, 19, '#5a564c');
          stage = 5; end(false);
        }
        // 通关路径把 stage 拨到 5 后在这里收尾；若刚因超时 end(false)
        // 过，ended 旗子会让这次 end(true) 无效——胜负只认第一次
        if (stage === 5) end(true);
      },
      draw() {
        bg();
        txt('大展的清晨', W / 2, 52, 30, '#26241f');
        txt('── 七点五十五分，距离月考还有一切要办的事 ──', W / 2, 84, 15, '#8d887a', 'sans-serif');
        // 每帧重建按钮坐标表：按钮是画出来的，命中全靠这份矩形清单
        btns = [];
        const st = stages[stage];
        if (st === 'clock') {
          txt('① 逼视表', W / 2, 160, 20, '#b8432f');
          roundRect(ctx, W / 2 - 90, 200, 180, 180, 20); ctx.fillStyle = '#fffdf5'; ctx.fill();
          ctx.strokeStyle = '#26241f'; ctx.lineWidth = 3; ctx.stroke();
          const flip = clicks > 0;
          txt(flip ? '7:55' : '6:55', W / 2, 305, 52, flip ? '#b8432f' : '#26241f');
          txt(flip ? '大惊。' : '善，恰吾不欲上早读。（点一下再看）', W / 2, 420, 17, '#5a564c', 'sans-serif');
        } else if (st === 'lock') {
          txt('② 宿舍西大门的锁', W / 2, 160, 20, '#b8432f');
          txt('宿管说：此锁乃虚铁。', W / 2, 196, 16, '#5a564c', 'sans-serif');
          const open = clicks >= 3;
          txt(open ? '🔓 开了' : '🔒', W / 2, 300, clicks >= 3 ? 40 : 90);
          if (!open) txt(`点 3 下开锁（${clicks}/3）`, W / 2, 420, 17, '#5a564c', 'sans-serif');
          else txt('置锁于吾桌，尔便得出。', W / 2, 420, 17, '#5a564c', 'sans-serif');
        } else if (st === 'bag') {
          txt('③ 翻遍教室外的书包找笔', W / 2, 160, 20, '#b8432f');
          txt('准考证、笔俱在七班内。点一个书包：', W / 2, 196, 16, '#5a564c', 'sans-serif');
          // right 每帧重新随机，只影响提示文案；真正的命中判定在下方 point()
          const right = irand(0, 2);
          const got = clicks > 0;
          for (let i = 0; i < 3; i++) btns.push(button(120 + i * 180, 240, 140, 120, ['🎒 书包', '🎒 书包', '🎒 书包'][i], false));
          if (got) txt(clicks === right + 1 ? '可怡的一支黑笔！' : '没有笔……再找。', W / 2, 420, 18, clicks === right + 1 ? '#3e7a5e' : '#b8432f', 'sans-serif');
          if (got && clicks === right + 1) stage = 3;
        } else if (st === 'room') {
          txt('④ 找考场', W / 2, 160, 20, '#b8432f');
          txt('隐知己考场为 12、17。', W / 2, 196, 16, '#5a564c', 'sans-serif');
          if (clicks === 0) txt('（提示：试两次才知道真正在哪）', W / 2, 420, 15, '#8d887a', 'sans-serif');
          btns.push(button(140, 240, 140, 90, '17 考场', false));
          btns.push(button(310, 240, 140, 90, '12 考场', false));
          btns.push(button(480, 240, 140, 90, '19 考场', false));
          if (clicks === 1) txt('17：无有缺考者。', W / 2, 400, 17, '#5a564c', 'sans-serif');
          // 剧情点：第二次试探才暴露真考场（19），把 stage 推到 4；
          // 行尾那个空的 setTimeout 什么也不做，可无视
          if (clicks === 2) { txt('12：恰有缺考者，入。——然吾之考场为 19 也。', W / 2, 400, 17, '#b8432f', 'sans-serif'); stage = 4; setTimeout(() => {}, 0); }
        } else if (st === 'number') {
          txt('⑤ 考号', W / 2, 160, 20, '#b8432f');
          txt('监考员给了你一张 22058 的准考证格式。', W / 2, 200, 16, '#5a564c', 'sans-serif');
          btns.push(button(170, 260, 200, 80, '凭记忆填上', false));
          btns.push(button(400, 260, 200, 80, '空着不填', false));
          txt('（原典：不知考号，卒未填。然考号实未变也。）', W / 2, 400, 15, '#8d887a', 'sans-serif');
        }
        if (wrongFlash > 0) { ctx.fillStyle = `rgba(184,67,47,${wrongFlash * 0.3})`; ctx.fillRect(0, 0, W, H); }
      },
      /* 点击判定：按 stage 分派。bag 关不累加 clicks，正确书包的序号
         是 clicks % 3（此时已被上一关清零）；room 关必须先查 17 再查 12 */
      point(x, y) {
        const st = stages[stage];
        if (st === 'clock') { clicks++; if (clicks >= 2) { stage = 1; clicks = 0; } }
        else if (st === 'lock') { clicks++; if (clicks >= 3) { stage = 2; clicks = 0; } }
        else if (st === 'bag') {
          for (let i = 0; i < 3; i++) if (inBtn(btns[i], x, y)) {
            if (i === clicks % 3) { msg = '可怡的一支黑笔！'; stage = 3; }
            else fail('翻错了书包');
          }
        } else if (st === 'room') {
          if (clicks === 0 && inBtn(btns[0], x, y)) { clicks = 1; msg = '17：无有缺考者。'; }
          else if (clicks === 1 && inBtn(btns[1], x, y)) { clicks = 2; stage = 4; }
          else fail('不是这个考场');
        } else if (st === 'number') {
          if (inBtn(btns[0], x, y)) fail('填错考号，靡不毕缪');
          else if (inBtn(btns[1], x, y)) { stage = 5; end(true); }
        }
      },
    };
  }

  /* ============ 2. 陀螺·三溴化氮 ============ */
  /* 双陀螺对撞：按住蓄力、松手朝对方发射。P 是玩家、E 是对手；e 是
     陀螺能量（转速），随时间自耗、相撞时按撞击猛烈程度互扣，先归零
     的倒下。over：1=你赢、2=你输。onUp:true 向公共监听声明“本游戏
     需要松手事件”（见文件底部 window 的 pointerup 转发） */
  function gameSpin() {
    // x/y 位置，vx/vy 速度，r 半径（碰撞用），ang 是画面自转角
    const P = { x: W * 0.3, y: H * 0.6, vx: 0, vy: 0, e: 100, r: 26, ang: 0 };
    const E = { x: W * 0.7, y: H * 0.4, vx: 0, vy: 0, e: 100, r: 26, ang: 0 };
    let charging = false, charge = 0, over = 0, tipp = 0;
    // 发射：朝敌方的单位方向 ×（基础 260 + 蓄力最多再加 320）的速度
    function launch() {
      const dx = E.x - P.x, dy = E.y - P.y, d = Math.hypot(dx, dy);
      const v = 260 + charge * 320;
      P.vx = dx / d * v; P.vy = dy / d * v;
    }
    return {
      update(dt) {
        // 蓄力条最多充到 1；分出胜负后等 0.9 秒再结算，留出“倒下”时间
        if (charging) charge = Math.min(1, charge + dt * 1.4);
        if (over) { tipp += dt; if (tipp > 0.9) end(over === 1); return; }
        // 物理一步：位置按速度推进；速度乘 (1 - 1.1*dt) 模拟摩擦（逐帧
        // 衰减）；四条边界把陀螺夹回场内并反弹、保留七成速度
        [P, E].forEach((t, i) => {
          t.x += t.vx * dt; t.y += t.vy * dt;
          t.vx *= (1 - 1.1 * dt); t.vy *= (1 - 1.1 * dt);
          if (t.x < 40 + t.r) { t.x = 40 + t.r; t.vx = Math.abs(t.vx) * 0.7; }
          if (t.x > W - 40 - t.r) { t.x = W - 40 - t.r; t.vx = -Math.abs(t.vx) * 0.7; }
          if (t.y < 90 + t.r) { t.y = 90 + t.r; t.vy = Math.abs(t.vy) * 0.7; }
          if (t.y > H - 40 - t.r) { t.y = H - 40 - t.r; t.vy = -Math.abs(t.vy) * 0.7; }
          // 能量自然流失（i=0 是玩家，流得稍慢一点）；ang 是给画面看的自转角
          t.e -= dt * (5.2 - i * 0.4);
          t.ang += (Math.hypot(t.vx, t.vy) * 0.02 + 6) * dt * 10;
        });
        const dx = E.x - P.x, dy = E.y - P.y, d = Math.hypot(dx, dy);
        // 相撞：n 是连线方向的单位向量，rel 是相对速度（撞击猛烈程度）。
        // 双方按 rel 扣能量（对方 1.15 倍略吃亏），再沿 n 交换动量——
        // 至少 120 的“弹开下限”保证撞完一定分开，不会贴着不放
        if (d < P.r + E.r) {
          const nx = dx / d, ny = dy / d;
          const rel = Math.abs(P.vx - E.vx) + Math.abs(P.vy - E.vy);
          const imp = 0.10;
          P.e -= rel * imp; E.e -= rel * imp * 1.15;
          const tm = (P.vx * nx + P.vy * ny), te = (E.vx * nx + E.vy * ny);
          P.vx += nx * Math.max(120, rel * 0.5) - nx * tm; P.vy += ny * Math.max(120, rel * 0.5) - ny * tm;
          E.vx -= nx * Math.max(120, rel * 0.5) - nx * te; E.vy -= ny * Math.max(120, rel * 0.5) - ny * te;
          Sfx.tap();
        }
        // 裁判：谁的能量先见底谁输（hud 里的 `| 0` 是截断取整的惯用法）
        if (P.e <= 0) over = 2; else if (E.e <= 0) over = 1;
        hud.textContent = `三溴化氮之战 · 你 ${Math.max(0, P.e | 0)} ─ ${Math.max(0, E.e | 0)} 头哥`;
      },
      draw() {
        bg();
        ctx.fillStyle = '#d9cfb4'; ctx.beginPath(); ctx.ellipse(W / 2, H / 2 + 30, W / 2 - 30, H / 2 - 70, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.1)'; ctx.stroke();
        // 陀螺本体：两条交叉的圆角矩形绕中心旋转（rotate(t.ang)），
        // 底下加影子，静止画面也能看出“高速旋转”
        [[P, '#41608c', '你'], [E, '#8a4a2f', '三溴化氮']].forEach(([t, col, name]) => {
          ctx.save(); ctx.translate(t.x, t.y);
          ctx.fillStyle = 'rgba(30,26,16,.2)'; ctx.beginPath(); ctx.ellipse(0, 10, t.r, 8, 0, 0, 7); ctx.fill();
          ctx.rotate(t.ang);
          ctx.fillStyle = col; roundRect(ctx, -t.r, -6, t.r * 2, 12, 6); ctx.fill();
          ctx.rotate(Math.PI / 3);
          roundRect(ctx, -t.r, -6, t.r * 2, 12, 6); ctx.fill();
          ctx.restore();
          txt(name, t.x, t.y - 34, 14, '#403a2e', 'sans-serif');
        });
        if (!over) {
          if (charging) {
            ctx.fillStyle = '#fffdf5'; roundRect(ctx, W / 2 - 130, H - 70, 260, 26, 13); ctx.fill();
            ctx.fillStyle = '#b8432f'; roundRect(ctx, W / 2 - 126, H - 66, 252 * charge, 18, 9); ctx.fill();
            txt('蓄力中……松手发射！', W / 2, H - 86, 15, '#b8432f', 'sans-serif');
          } else if (charge === 0 && Math.hypot(P.vx, P.vy) < 10) {
            txt('按住蓄力，松手发射，撞飞三溴化氮！', W / 2, H - 60, 16, '#5a564c', 'sans-serif');
            txt('（碰撞后可继续点击追击）', W / 2, H - 36, 13, '#8d887a', 'sans-serif');
          }
        } else {
          ctx.fillStyle = 'rgba(244,239,224,.75)'; ctx.fillRect(0, 0, W, H);
          txt(over === 1 ? '三溴化氮，倒了！' : '你的陀螺先停了……', W / 2, H / 2, 34, over === 1 ? '#3e7a5e' : '#b8432f');
        }
      },
      /* down=true 是按下、false 是松手（由全局 pointerup 转发过来）。
         按下：几乎静止时才开始蓄力（防连点骚扰）；松手：发射并清蓄力
         （延迟 100 毫秒清零，让进度条先走完再消失） */
      point(x, y, down) {
        if (over) return;
        if (down) {
          if (!charging && Math.hypot(P.vx, P.vy) < 30) { charging = true; charge = 0; }
        } else if (charging) {
          charging = false; launch();
          Sfx.seal();
          setTimeout(() => { charge = 0; }, 100);
        }
      },
      onUp: true,
    };
  }

  /* ============ 3. 食堂冲刺 ============ */
  /* 三车道跑酷：点左/右半屏（或方向键）换线，躲开挡路的同学，冲满
     goal 步到窗口即赢。速度随时间越来越快；撞人只踉跄 1.4 秒（变慢）
     不清场；超过 40 秒没到则失败。laneX 预存三条车道的中线横坐标 */
  function gameCanteen() {
    let lane = 1, dist = 0, time = 0, over = 0, stumble = 0, speed = 210;
    let obs = []; let nextSpawn = 0.5;
    const laneX = [W * 0.3, W * 0.5, W * 0.7];
    const goal = 2600;
    return {
      update(dt) {
        if (over) { over += dt; if (over > 1) end(dist >= goal); return; }
        time += dt; stumble = Math.max(0, stumble - dt);
        speed = 210 + time * 6;
        dist += stumble > 0 ? speed * 0.25 * dt : speed * dt;
        nextSpawn -= dt;
        // 生成障碍：到点投一个随机车道的同学，四成概率再补一个错位的
        if (nextSpawn <= 0) {
          nextSpawn = rand(0.45, 0.85);
          const l = irand(0, 2);
          obs.push({ lane: l, y: -40, hit: false });
          if (Math.random() < 0.4) { let l2 = (l + irand(1, 2)) % 3; obs.push({ lane: l2, y: -40 - rand(30, 90), hit: false }); }
        }
        obs.forEach(o => o.y += speed * dt * 1.15);
        // 出屏的障碍直接丢弃，数组不会越积越大（filter 留下“还没出屏”的）
        obs = obs.filter(o => o.y < H + 60);
        // 碰撞：同车道且纵向贴近（34 像素内）就算撞上；hit 标记防重复扣
        obs.forEach(o => {
          if (!o.hit && o.lane === lane && Math.abs(o.y - (H - 110)) < 34) {
            o.hit = true; stumble = 1.4; Sfx.bad();
          }
        });
        hud.textContent = `羚羊奔食 · ${Math.max(0, (goal - dist) | 0)} 步到窗口${stumble > 0 ? ' · 踉跄！' : ''}`;
        // over 从 0.001 起步当“结束计时器”：涨过 1 秒才 end，给结果画面留定格时间
        if (dist >= goal) over = 0.001;
        if (time > 40) { over = 0.001; dist = 0; }
      },
      draw() {
        bg();
        // 走廊三线
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? '#e7dcc2' : '#e2d6ba';
          ctx.fillRect(W / 3 * i, 70, W / 3, H - 110);
        }
        ctx.fillStyle = '#c9b389'; ctx.fillRect(0, 40, W, 30);
        txt('食堂打饭窗口 ↑', W / 2, 62, 15, '#6a5a3a', 'sans-serif');
        // 障碍（同学）
        obs.forEach(o => {
          const x = laneX[o.lane], y = o.y;
          drawAvatar(ctx, { look: { hair: pick(['#2a2620', '#3a3020', '#1c1812']), style: pick(['short', 'flat', 'bob']) }, role: 's', cls: '6' }, x, y, 52);
        });
        // 玩家（羚羊）
        const px = laneX[lane], py = H - 110;
        ctx.save();
        ctx.translate(px, py + Math.sin(time * 22) * (stumble > 0 ? 5 : 2.5));
        drawAvatar(ctx, { look: { hair: '#191612', style: 'short', acc: '🏃' }, role: 's', cls: '8' }, 0, 0, 58);
        ctx.restore();
        // 进度条
        ctx.fillStyle = '#fffdf5'; roundRect(ctx, W / 2 - 150, H - 28, 300, 14, 7); ctx.fill();
        ctx.fillStyle = '#b8432f'; roundRect(ctx, W / 2 - 147, H - 25, 294 * clamp(dist / goal, 0, 1), 8, 4); ctx.fill();
        if (over) {
          ctx.fillStyle = 'rgba(244,239,224,.75)'; ctx.fillRect(0, 0, W, H);
          txt(dist >= goal ? '先以右足探地——第一！' : '队伍排到了门口……', W / 2, H / 2, 32, dist >= goal ? '#3e7a5e' : '#b8432f');
        } else txt('点击左右半边（或 ← →）换线躲人', W / 2, H - 48, 14, '#8d887a', 'sans-serif');
      },
      /* 两种等价操作：点左/右半屏换线；key(k) 接方向键（由文件底部
         window 的 keydown 监听转发）。x < 0 是“松手转发”的占位调用，
         直接忽略。到边界车道就不再移 */
      point(x, y) {
        if (over || x < 0) return;
        if (x < W / 2 && lane > 0) { lane--; Sfx.chat(); }
        else if (x >= W / 2 && lane < 2) { lane++; Sfx.chat(); }
      },
      key(k) {
        if (k === 'ArrowLeft' && lane > 0) lane--;
        if (k === 'ArrowRight' && lane < 2) lane++;
      },
    };
  }

  /* ============ 4. 乒乓球二十板 ============ */
  /* 时机游戏：光标在计时条上左右折返，进入红区时点击（或空格）才算
     有效回球；连满 20 板过关，脱板一次清零。pos 归一化到 0~1，speed
     随板数增加，红区中心 zoneC 每板重掷——越打越快、越打越刁 */
  function gamePingpong() {
    let hits = 0, pos = 0, dir = 1, speed = 0.55, zoneC = rand(0.3, 0.7), zoneW = 0.16, over = 0, label = '正手';
    // 当前有效区间：红区中心 ± 半宽，clamp 防止越出条外
    function hitZone() { return { a: clamp(zoneC - zoneW, 0, 1), b: clamp(zoneC + zoneW, 0, 1) }; }
    return {
      update(dt) {
        if (over) { over += dt; if (over > 1.1) end(hits >= 20); return; }
        // 光标折返运动：碰到两头就反向；speed 随 hits 增长
        pos += dir * speed * dt;
        if (pos > 1) { pos = 1; dir = -1; }
        if (pos < 0) { pos = 0; dir = 1; }
        speed = 0.55 + hits * 0.028;
        hud.textContent = `乒乓球期末 · ${hits} / 20 板 · 本拍：${label}${hits === 16 ? '（差四板！）' : ''}`;
      },
      draw() {
        bg();
        txt('反手与正手，凡三度，每度须满二十板。', W / 2, 70, 18, '#26241f');
        txt(`当前 ${hits} 板（至多十六板？）`, W / 2, 104, 15, '#8d887a', 'sans-serif');
        // 球台
        ctx.fillStyle = '#3e7a5e'; roundRect(ctx, W / 2 - 260, 330, 520, 150, 10); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(W / 2, 330); ctx.lineTo(W / 2, 480); ctx.stroke();
        // 计时条
        ctx.fillStyle = '#fffdf5'; roundRect(ctx, W / 2 - 240, 210, 480, 40, 20); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.stroke();
        const z = hitZone();
        ctx.fillStyle = '#b8432f33'; roundRect(ctx, W / 2 - 240 + 480 * z.a, 210, 480 * (z.b - z.a), 40, 12); ctx.fill();
        ctx.fillStyle = '#26241f'; ctx.beginPath(); ctx.arc(W / 2 - 240 + 480 * pos, 230, 12, 0, 7); ctx.fill();
        txt(`这一板用「${label}」`, W / 2, 190, 17, '#b8432f');
        // 球拍示意
        ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(W / 2 - 240 + 480 * pos, 285, 22, 0, 7); ctx.fill();
        ctx.fillStyle = '#d9b48a'; ctx.fillRect(W / 2 - 240 + 480 * pos - 4, 292, 8, 30);
        if (over) {
          ctx.fillStyle = 'rgba(244,239,224,.78)'; ctx.fillRect(0, 0, W, H);
          txt(hits >= 20 ? '二十板，成！' : '球又不过网……', W / 2, H / 2 - 10, 34, hits >= 20 ? '#3e7a5e' : '#b8432f');
          if (hits >= 20) txt('（师长亦大惊：吾一直以为尔在陪对面。）', W / 2, H / 2 + 30, 16, '#5a564c');
        } else txt('光标进入红区时点击（或按空格）回球', W / 2, H - 46, 14, '#8d887a', 'sans-serif');
      },
      /* 出手判定：光标在红区内 → 得板、红区换位置、正/反手交替报名
         （第 8、13 板有彩蛋台词）；出界 → 清零重来。Sfx 播对/错音效 */
      swing() {
        if (over) return;
        const z = hitZone();
        if (pos >= z.a && pos <= z.b) {
          hits++; Sfx.good();
          zoneC = rand(0.22, 0.78);
          label = hits % 2 ? '反手' : '正手';
          if (hits === 8) label = '——等等，这是正手还是反手？';
          if (hits === 13) label = '师长：吾以为尔在陪对面';
        } else { hits = 0; Sfx.bad(); label = '正手'; }
      },
      // this 指当前返回的这个游戏对象；_lastUp 从未被赋值（恒为
      // undefined），所以这道保险目前永远放行，直接走 swing
      point() { if (this._lastUp) return; this.swing(); },
    };
  }

  // 名字 → 工厂函数的登记表：launch 靠它按名字开工
  const GAMES = { late: gameLate, spin: gameSpin, canteen: gameCanteen, pingpong: gamePingpong };
  // 全局键盘转发：左右键给带 key() 的游戏，空格给带 swing() 的游戏
  // （并阻止页面滚动）。cur 上“有没有这个方法”决定要不要转发
  window.addEventListener('keydown', e => {
    if (!cur || !cur.key) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') cur.key(e.key);
    if (e.key === ' ' && cur.swing) { e.preventDefault(); cur.swing(); }
  });
  // 全局松手转发：只投给声明了 onUp 的游戏（陀螺靠它感知“松手发射”），
  // 坐标传 -1 表示“这次只关心松开这个动作，位置无所谓”
  window.addEventListener('pointerup', e => { if (cur && cur.onUp) cur.point(-1, -1, false); });

  /* 对外只有两个成员：active 供外界判断“小游戏占用中”；launch 按名字
     开一局——找不到同名游戏时直接视为通关回调 onDone(true)，主流程
     不会被卡死。cancelAnimationFrame 先清旧循环再开新的，防止两条
     循环同时跑 */
  return {
    get active() { return !!cur; },
    launch(kind, onDone) {
      if (!GAMES[kind]) { onDone && onDone(true); return; }
      setup(); ended = false; onEnd = onDone;
      cur = GAMES[kind]();
      root.classList.remove('hidden');
      hud.textContent = '';
      last = performance.now();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
  };
})();
