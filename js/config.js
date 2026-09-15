/* 实验史记·春秋笔 —— 全局工具 */
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- 弹簧动画（Apple: damping/response 参数化，可被打断） ---------- */
const Spring = (() => {
  const springs = new Set();
  function tick() {
    const now = performance.now();
    springs.forEach(s => {
      if (s.cancelled) { springs.delete(s); return; }
      const dt = Math.min(0.032, (now - s.last) / 1000); s.last = now;
      // 半隐式欧拉积分
      const omega = 2 * Math.PI / Math.max(0.01, s.response);
      s.v += (-omega * omega * (s.x - s.target) - 2 * s.damping * omega * s.v) * dt;
      s.x += s.v * dt;
      if (Math.abs(s.x - s.target) < 0.001 && Math.abs(s.v) < 0.001) {
        s.x = s.target; s.v = 0; springs.delete(s); s.done && s.done();
      }
      s.update(s.x, s.v);
    });
    if (springs.size) requestAnimationFrame(tick); else running = false;
  }
  let running = false;
  function ensureLoop() { if (!running) { running = true; requestAnimationFrame(tick); } }
  // 创建弹簧：{x0, target, damping=1, response=0.35, update(x,v), done()}
  function make(opt) {
    const s = {
      x: opt.x0 || 0, v: opt.v0 || 0, target: opt.target != null ? opt.target : (opt.x0 || 0),
      damping: opt.damping != null ? opt.damping : 1.0,
      response: opt.response != null ? opt.response : 0.35,
      update: opt.update || (() => {}), done: opt.done, last: performance.now(),
    };
    springs.add(s); ensureLoop(); return s;
  }
  function retarget(s, target, v0) { s.target = target; if (v0 != null) s.v = v0; ensureLoop(); }
  return { make, retarget };
})();

/* Sheet 弹入弹出：从当前呈现值出发（可被打断） */
const SheetFX = {
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
  close(panel, cb) {
    if (panel._closeSpring) panel._closeSpring.cancelled = true;
    const st = getComputedStyle(panel).transform;
    const m = new DOMMatrixReadOnly(st === 'none' ? '' : st);
    panel._closeSpring = Spring.make({
      x0: m.m42 || 0, target: panel.offsetHeight + 60, damping: 1.0, response: 0.28,
      update: x => { panel.style.transform = `translateX(-50%) translateY(${x}px)`; },
      done: () => { panel.classList.add('hidden'); panel._closeSpring = null; cb && cb(); },
    });
  },
};

/* ---------- 音效：WebAudio 合成，静音可切 ---------- */
const Sfx = (() => {
  let ctx = null;
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return ctx; }
  function tone(f, dur, type, vol, delay) {
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
const toastQueue = [];
function toast(msg, sealChar) {
  if ((typeof UI !== 'undefined' && UI.panelOpen) || (typeof Dialog !== 'undefined' && Dialog.active)) {
    toastQueue.push([msg, sealChar]);
    if (toastQueue.length > 6) toastQueue.shift();
    return;
  }
  showToastNow(msg, sealChar);
}
function flushToasts() {
  while (toastQueue.length && !((typeof UI !== 'undefined' && UI.panelOpen) || (typeof Dialog !== 'undefined' && Dialog.active))) {
    const [m, s] = toastQueue.shift();
    showToastNow(m, s);
  }
}
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
const Save = {
  KEY: 'shiji_cqb_v1',
  write() { try { localStorage.setItem(this.KEY, JSON.stringify(G)); } catch (e) {} },
  read() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  export() { return btoa(unescape(encodeURIComponent(JSON.stringify(G)))); },
  import(str) {
    const o = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    if (!o || !o.ver) throw new Error('bad');
    Save.clear(); localStorage.setItem(this.KEY, JSON.stringify(o)); return o;
  },
};
