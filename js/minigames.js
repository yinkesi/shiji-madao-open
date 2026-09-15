/* 实验史记·春秋笔 —— 小游戏：月考迟到 / 陀螺 / 食堂冲刺 / 乒乓球 */
'use strict';

const MG = (() => {
  const root = $('#minigame'), cv = $('#mg-canvas'), hud = $('#mg-hud');
  const ctx = cv.getContext('2d');
  const W = 760, H = 540;
  let cur = null, raf = 0, last = 0, onEnd = null, ended = false;

  function setup() {
    const d = Math.min(window.innerWidth / W, window.innerHeight / H, 1);
    cv.width = W; cv.height = H;
    cv.style.width = W * d + 'px'; cv.style.height = H * d + 'px';
  }
  function end(success) {
    if (ended) return; ended = true;
    cancelAnimationFrame(raf);
    setTimeout(() => { root.classList.add('hidden'); const cb = onEnd; onEnd = null; cur = null; cb && cb(success); }, 900);
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (cur) { cur.update(dt); cur.draw(ctx); }
    if (!ended) raf = requestAnimationFrame(loop);
  }
  function bg() {
    ctx.fillStyle = '#f4efe0'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(60,55,40,.06)';
    for (let y = 0; y < H; y += 26) ctx.fillRect(0, y, W, 1);
  }
  function txt(s, x, y, size, color, font, align) {
    ctx.fillStyle = color || '#26241f';
    ctx.font = `${size}px ${font || 'serif'}`;
    ctx.textAlign = align || 'center';
    ctx.fillText(s, x, y);
  }
  function button(x, y, w, h, label, hot) {
    ctx.fillStyle = hot ? '#b8432f' : '#fffdf5';
    roundRect(ctx, x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = hot ? '#8a2f1c' : 'rgba(0,0,0,.15)'; ctx.lineWidth = 1.5; ctx.stroke();
    txt(label, x + w / 2, y + h / 2 + 6, 17, hot ? '#fff6f0' : '#26241f', 'sans-serif');
    return { x, y, w, h };
  }
  const inBtn = (b, x, y) => b && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
  cv.addEventListener('pointerdown', e => {
    if (!cur || !cur.point) return;
    const r = cv.getBoundingClientRect();
    const d = cv.width / r.width;
    cur.point(e.clientX - r.left, e.clientY - r.top, true);
  });

  /* ============ 1. 月考迟到 ============ */
  function gameLate() {
    let stage = 0, timer = 90, clicks = 0, wrongFlash = 0, msg = '';
    let btns = [];
    const stages = ['clock', 'lock', 'bag', 'room', 'number', 'done'];
    function fail(t) { msg = t; timer = Math.max(0, timer - 8); wrongFlash = 0.5; }
    return {
      update(dt) {
        if (stage < 5) { timer -= dt; wrongFlash = Math.max(0, wrongFlash - dt); }
        hud.textContent = `月考之晨 · 剩余 ${Math.ceil(timer)} 秒 · ${msg}`;
        if (timer <= 0 && stage < 5) {
          bg(); txt('钟声响时，你还在走廊里。', W / 2, H / 2 - 20, 30, '#b8432f');
          txt('（卒得109。除姓名外靡不毕缪。）', W / 2, H / 2 + 24, 19, '#5a564c');
          stage = 5; end(false);
        }
        if (stage === 5) end(true);
      },
      draw() {
        bg();
        txt('大展的清晨', W / 2, 52, 30, '#26241f');
        txt('── 七点五十五分，距离月考还有一切要办的事 ──', W / 2, 84, 15, '#8d887a', 'sans-serif');
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
  function gameSpin() {
    const P = { x: W * 0.3, y: H * 0.6, vx: 0, vy: 0, e: 100, r: 26, ang: 0 };
    const E = { x: W * 0.7, y: H * 0.4, vx: 0, vy: 0, e: 100, r: 26, ang: 0 };
    let charging = false, charge = 0, over = 0, tipp = 0;
    function launch() {
      const dx = E.x - P.x, dy = E.y - P.y, d = Math.hypot(dx, dy);
      const v = 260 + charge * 320;
      P.vx = dx / d * v; P.vy = dy / d * v;
    }
    return {
      update(dt) {
        if (charging) charge = Math.min(1, charge + dt * 1.4);
        if (over) { tipp += dt; if (tipp > 0.9) end(over === 1); return; }
        [P, E].forEach((t, i) => {
          t.x += t.vx * dt; t.y += t.vy * dt;
          t.vx *= (1 - 1.1 * dt); t.vy *= (1 - 1.1 * dt);
          if (t.x < 40 + t.r) { t.x = 40 + t.r; t.vx = Math.abs(t.vx) * 0.7; }
          if (t.x > W - 40 - t.r) { t.x = W - 40 - t.r; t.vx = -Math.abs(t.vx) * 0.7; }
          if (t.y < 90 + t.r) { t.y = 90 + t.r; t.vy = Math.abs(t.vy) * 0.7; }
          if (t.y > H - 40 - t.r) { t.y = H - 40 - t.r; t.vy = -Math.abs(t.vy) * 0.7; }
          t.e -= dt * (5.2 - i * 0.4);
          t.ang += (Math.hypot(t.vx, t.vy) * 0.02 + 6) * dt * 10;
        });
        const dx = E.x - P.x, dy = E.y - P.y, d = Math.hypot(dx, dy);
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
        if (P.e <= 0) over = 2; else if (E.e <= 0) over = 1;
        hud.textContent = `三溴化氮之战 · 你 ${Math.max(0, P.e | 0)} ─ ${Math.max(0, E.e | 0)} 头哥`;
      },
      draw() {
        bg();
        ctx.fillStyle = '#d9cfb4'; ctx.beginPath(); ctx.ellipse(W / 2, H / 2 + 30, W / 2 - 30, H / 2 - 70, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.1)'; ctx.stroke();
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
        if (nextSpawn <= 0) {
          nextSpawn = rand(0.45, 0.85);
          const l = irand(0, 2);
          obs.push({ lane: l, y: -40, hit: false });
          if (Math.random() < 0.4) { let l2 = (l + irand(1, 2)) % 3; obs.push({ lane: l2, y: -40 - rand(30, 90), hit: false }); }
        }
        obs.forEach(o => o.y += speed * dt * 1.15);
        obs = obs.filter(o => o.y < H + 60);
        obs.forEach(o => {
          if (!o.hit && o.lane === lane && Math.abs(o.y - (H - 110)) < 34) {
            o.hit = true; stumble = 1.4; Sfx.bad();
          }
        });
        hud.textContent = `羚羊奔食 · ${Math.max(0, (goal - dist) | 0)} 步到窗口${stumble > 0 ? ' · 踉跄！' : ''}`;
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
  function gamePingpong() {
    let hits = 0, pos = 0, dir = 1, speed = 0.55, zoneC = rand(0.3, 0.7), zoneW = 0.16, over = 0, label = '正手';
    function hitZone() { return { a: clamp(zoneC - zoneW, 0, 1), b: clamp(zoneC + zoneW, 0, 1) }; }
    return {
      update(dt) {
        if (over) { over += dt; if (over > 1.1) end(hits >= 20); return; }
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
      point() { if (this._lastUp) return; this.swing(); },
    };
  }

  const GAMES = { late: gameLate, spin: gameSpin, canteen: gameCanteen, pingpong: gamePingpong };
  window.addEventListener('keydown', e => {
    if (!cur || !cur.key) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') cur.key(e.key);
    if (e.key === ' ' && cur.swing) { e.preventDefault(); cur.swing(); }
  });
  window.addEventListener('pointerup', e => { if (cur && cur.onUp) cur.point(-1, -1, false); });

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
