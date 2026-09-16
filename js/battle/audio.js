/* ============================================================
 * 实验史记 · 马刀风云 —— 音律（WebAudio 程序合成，无外部资源）
 * ============================================================ */
/* ============================================================
 * 【新手导读】
 * 【这个文件是干嘛的】游戏里的所有音效和背景音乐。项目里没有任何
 *   mp3/wav 文件——每个声音都是用浏览器的 WebAudio 接口"现场合成"的：
 *   振荡器（oscillator）发波形、增益节点（gain）控音量、随机采样
 *   缓冲做打击噪声，几组参数一凑就是一种音效。
 * 【架构位置】battle 层的工具命名空间，index.html 正常加载。
 *   engine.js / battle-ui.js 在事件时机调用，如命中时
 *   SJI_AUDIO.hit()、胜利时 SJI_AUDIO.victory()。
 * 【暴露的全局名】window.SJI_AUDIO —— 末尾 api 对象里的全部方法：
 *   开关与解锁（setSfx / setMusic / unlock）、事件音效（click / select /
 *   hit / crit / heal / dodge / sacrifice / rpsWin / rpsLose / rpsDraw /
 *   skill / kick / die）、乐曲（victory / defeat / startMusic / stopMusic）。
 *   基础合成函数 tone / noise / pluck 是内部的，不在导出之列。
 * 【新手阅读提示】浏览器规定：必须等用户点过页面后才允许网页发声
 *   （防止流氓网页乱放噪音），所以有 unlock()，由 battle-ui.js 在第一次
 *   按下鼠标时调用。合成声音的核心手法叫"包络"：音量从接近 0 快速
 *   冲到目标、再缓缓落回 0，听感才自然；指数曲线不允许到达 0，
 *   代码里一律用 0.0001 顶替。
 * ============================================================ */
window.SJI_AUDIO = (function () {
  "use strict";
  // 模块私有状态：ctx 音频上下文（WebAudio 的总入口）、master 总音量节点、
  // 音效/音乐两个开关、BGM 定时器与已走拍数。一行声明多个变量是 JS 惯用法。
  let ctx = null, master = null, sfxOn = true, musicOn = true;
  let musicTimer = null, musicStep = 0;

  /* ensure：惰性初始化——第一次要出声时才创建 AudioContext（它比较重）。
     创建的 gain 节点 master 是所有声音的"总闸"，音量 0.28，接到扬声器。
     try/catch 防老浏览器或不支持音频的环境直接崩掉；webkit 前缀兼容旧 Safari。 */
  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.28;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  /* tone：最基本的"哔"一声。freq 频率(Hz)、dur 时长(秒)、type 波形
     （sine 正弦柔和 / square 方阵电子 / sawtooth 锯齿刺耳 / triangle 三角居中）、
     vol 音量、delay 延迟几秒再响、slide 结束前滑到的频率（做下滑音）。
     流程：建振荡器+增益节点 → 排好"包络"（音量曲线）→ 接上总闸 → 定时启停。 */
  function tone(freq, dur, type, vol, delay, slide) {
    if (!ctx || !sfxOn) return;
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    // 传了 slide 才滑音；Math.max(30, ...) 防止滑进听不见的次声区（指数曲线也不接受 0）。
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    // 音量包络：从 0.0001 用 12 毫秒冲到目标音量，再在 dur 秒内衰减回 0.0001。
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /* noise：白噪声，打击感的来源。做法：开一段长度 = 采样率 × 秒数的
     缓冲，每个采样点填一个随机数，播放时再过低通滤波器滤掉刺耳高频，
     听起来就是"噗/沙"的一声闷响。 */
  function noise(dur, vol, delay) {
    if (!ctx || !sfxOn) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // 每个采样点取 -1~1 的随机数；再乘 (1 - i/len) 让噪声随时间线性变小。
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol || 0.3;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  /* 五声音阶（宫商角徵羽）拨弦 */
  // 一串频率值（Hz）：C 调五声音阶从低 do 到高 mi，BGM 随机从中挑音。
  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26];

  /* pluck：拨弦音，背景音乐的原料。两个振荡器叠加——基音 + 高一个
     八度（频率 ×2），包络快起长落，听感近似古筝/吉他拨一下。
     受 musicOn 开关控制（音效开关管不到它）。 */
  function pluck(freq, dur, vol, delay) {
    if (!ctx || !musicOn) return;
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o2.type = "sine";
    o.frequency.value = freq; o2.frequency.value = freq * 2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 1.4));
    o.connect(g); o2.connect(g); g.connect(master);
    o.start(t0); o2.start(t0); o.stop(t0 + 1.6); o2.stop(t0 + 1.6);
  }

  /* ---------- 对外接口 ---------- */
  /* 下面每个方法都是一种"音效配方"：把 tone / noise / pluck 叠两三层、
     用 delay 错开出场时间就成。不用逐个看参数，知道方法名对应该什么
     游戏事件即可（命名已经很直白）。 */
  const api = {
    setSfx(v) { sfxOn = !!v; },
    setMusic(v) {
      musicOn = !!v;
      if (!musicOn) api.stopMusic();
    },
    // 解锁音频：用户第一次点击页面时由 battle-ui.js 调（浏览器的自动播放限制）。
    unlock() { const c = ensure(); if (c && c.state === "suspended") c.resume(); },

    click() { ensure(); tone(660, 0.07, "square", 0.12); },
    select() { ensure(); tone(520, 0.09, "triangle", 0.2); tone(780, 0.09, "triangle", 0.12, 0.05); },

    hit() { ensure(); noise(0.14, 0.5); tone(160, 0.12, "square", 0.3, 0, 80); },
    crit() { ensure(); noise(0.2, 0.65); tone(120, 0.2, "sawtooth", 0.35, 0, 60); tone(880, 0.1, "square", 0.15, 0.02); },
    heal() { ensure(); tone(523, 0.12, "sine", 0.2); tone(659, 0.14, "sine", 0.18, 0.08); tone(784, 0.2, "sine", 0.15, 0.16); },
    dodge() { ensure(); tone(980, 0.06, "sine", 0.2, 0, 1400); },
    sacrifice() { ensure(); tone(110, 0.5, "sawtooth", 0.35, 0, 45); noise(0.35, 0.4); },
    rpsWin() { ensure(); tone(523, 0.1, "square", 0.22); tone(659, 0.1, "square", 0.22, 0.09); tone(784, 0.16, "square", 0.22, 0.18); },
    rpsLose() { ensure(); tone(392, 0.14, "square", 0.2); tone(311, 0.22, "square", 0.2, 0.12); },
    rpsDraw() { ensure(); tone(440, 0.12, "triangle", 0.2); },
    skill() { ensure(); tone(700, 0.1, "triangle", 0.2, 0, 1000); tone(500, 0.15, "sine", 0.18, 0.06); },
    kick() { ensure(); noise(0.18, 0.6); tone(90, 0.25, "square", 0.4, 0, 50); },
    die() { ensure(); tone(300, 0.4, "sawtooth", 0.3, 0, 60); noise(0.3, 0.4, 0.05); },

    /* 胜利曲：上行琶音 C-E-G-C + 三声拨弦收尾；失败曲：下行四音。
       forEach 回调的第二个参数 i 是序号，乘 0.13 秒就是每个音的出场间隔。 */
    victory() {
      ensure();
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, "triangle", 0.25, i * 0.13));
      [523, 659, 784].forEach((f, i) => pluck(f, 1.2, 0.12, 0.55 + i * 0.05));
    },
    defeat() {
      ensure();
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, "triangle", 0.22, i * 0.18));
    },

    /* startMusic：BGM 不是预制曲子，而是程序即兴——每 0.7 秒有 62% 的
     概率从五声音阶里随机拨一音，逢 4 的倍数拍补一个低音当鼓点。 */
    startMusic() {
      ensure();
      // 已经在放（或音频没初始化成功）就不再开第二个定时器，防叠音。
      if (musicTimer || !ctx) return;
      musicStep = 0;
      musicTimer = setInterval(() => {
        if (!musicOn || !ctx) return;
        musicStep++;
        const beat = musicStep % 16;
        if (beat % 4 === 0) pluck(PENTA[0] / 2, 1.6, 0.09);
        // Math.random() 落在 0~1，< 0.62 即 62% 概率本拍弹音（"密度"手感值）。
        if (Math.random() < 0.62) {
          const f = PENTA[Math.floor(Math.random() * PENTA.length)];
          pluck(f, 1.8, 0.055 + Math.random() * 0.04);
        }
      }, 700);
    },
    // 停曲 = 清掉定时器；关音乐开关时 setMusic 也会顺手调它。
    stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
  };
  return api;
})();
