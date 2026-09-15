/* 实验史记·春秋笔 —— 撰史系统：拼版 / 笔法 / 品级 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   “撰史”玩法：把收集到的史料像排文章一样放进起/承/转/合四个槽位，
   选“直笔/曲笔”笔法，按槽位匹配度与文笔算分定品级（下/中/上/神品），
   发表一卷立传并结算奖励，最后播“判词”面板与传主反应。

   【架构位置】
   在 dialog.js 之后、ui.js 之前加载。
   依赖：data/events.js 的 SHARDS（史料表）、data/volumes.js 的
   SLOTS / VOLS / VOL_BY_NO（槽位与卷目），以及 config 的 el / toast /
   Sfx / Save、Engine（资源与成就）、UI（面板）、Dialog（传主反应）。
   入口在 ui.js 的史记面板：点某卷 → Writing.open(卷号)。

   【暴露的全局名】
   Writing（IIFE 返回：open / duelReady / duelWon / openPublished）。
   volNo、placed、style 等编辑状态全是闭包私有，外界碰不到。

   【新手阅读提示】
   1) 本玩法已与主线解耦：不需要打赢传主也能立传（duelReady 恒返回 true），
      “与传主切磋”只是图鉴里的软提示。
   2) 界面采用“整体重画”模式：任何一次点击都把面板 DOM 全部重建
      （重新执行 render()），而不是精细修改某个元素——代码简单，
      状态与界面永远不会对不上，小面板完全够用。
   ================================================================ */

const Writing = (() => {
  /* 闭包私有状态：当前编辑的卷号；四个槽各放了哪条史料（null=空）；
     笔法（'直' 或 '曲'）。 */
  let volNo = 0;
  let placed = { qi: null, cheng: null, zhuan: null, he: null }; // shardId
  let style = '直';

  /* 某卷可用的全部史料：卷池 + 该卷所有采访/额外史料（如 sh_pingpong） */
  /* 从 SHARDS 全表里筛出属于第 no 卷的史料 id 列表。 */
  function volPool(no) { return Object.keys(SHARDS).filter(id => SHARDS[id].vol === no); }

  const SLOT_KEYS = ['qi', 'cheng', 'zhuan', 'he'];
  /* 槽位定义查表；accepts 判断史料能否进某槽：
     槽定义里的 only 标签列表是硬门槛（如“合”槽只收带「评」标签的采访）。 */
  function slotDef(k) { return SLOTS.find(s => s.key === k); }
  function accepts(slotKey, shardId) {
    const def = slotDef(slotKey);
    const tags = SHARDS[shardId].tags;
    if (def.only && !def.only.some(t => tags.includes(t))) return false;
    return true;
  }
  /* 点史料卡时自动挑槽，优先级：
     1) 带「评」且合槽空着 → 直接入合槽；
     2) 按起→承→转找一个“空着 + 放得进 + 标签对味（prefer 命中）”的槽；
     3) 退而求其次：任意空着且放得进的槽；
     4) 全满返回 null（由调用方提示先取回一条）。 */
  function autoSlotFor(shardId) {
    const tags = SHARDS[shardId].tags;
    // 合槽优先收评
    if (tags.includes('评') && !placed.he) return 'he';
    for (const k of ['qi', 'cheng', 'zhuan']) {
      if (placed[k]) continue;
      if (!accepts(k, shardId)) continue;
      if (slotDef(k).prefer.some(t => tags.includes(t))) return k;
    }
    for (const k of ['qi', 'cheng', 'zhuan']) if (!placed[k] && accepts(k, shardId)) return k;
    return null;
  }

  /* 评分：每槽 = 该史料文笔值 ×（标签命中槽位 prefer 记 1.5 倍，否则 1 倍），
     再加角色文笔 G.wen 的 25%、直笔固定 +2。
     Math.round(s * 10) / 10 是“四舍五入保留一位小数”的惯用法
     （JS 没有按位数四舍五入的内置函数）。 */
  function score() {
    let s = 0;
    SLOT_KEYS.forEach(k => {
      const id = placed[k];
      if (!id) return;
      const def = slotDef(k);
      const tags = SHARDS[id].tags;
      const mult = def.prefer.some(t => tags.includes(t)) ? 1.5 : 1;
      s += G.shards[id].wen * mult;
    });
    s += G.wen * 0.25;
    if (style === '直') s += 2;
    return Math.round(s * 10) / 10;
  }
  /* 得分 → 品级 1~4（连续三元表达式按阈值分档）→ 品级名。 */
  function gradeOf(s) { return s >= 36 ? 4 : s >= 28 ? 3 : s >= 20 ? 2 : 1; }
  function gradeName(g) { return { 4:'神品', 3:'上品', 2:'中品', 1:'下品' }[g]; }

  /* 撰史界面的搭建与刷新：UI.openPanel(标题, build) 里 build(body) 是回调，
     面板打开后把 body 元素交过来、由这里往里填内容。
     左栏 = 四槽 + 笔法切换 + 得分预览 + 发表按钮；右栏 = 拥有的史料卡池。
     所有交互（点槽取回、换笔法、点料入槽）都是改闭包状态后整体重画。 */
  function render() {
    const v = VOL_BY_NO[volNo];
    UI.openPanel(`撰史 · ${v.title}（${v.i}）`, body => {
      const grid = el('div', 'writ-grid');
      /* 左：四槽 + 笔法 + 发表 */
      const left = el('div', '');
      const slots = el('div', 'slot-row');
      SLOT_KEYS.forEach(k => {
        const def = slotDef(k);
        const id = placed[k];
        const slot = el('div', 'slot' + (id ? '' : ' empty'));
        /* 模板字符串拼 HTML：反引号里 ${...} 可嵌任意表达式，
           类似 Python 的 f-string。槽里有料显示名字/标签/全文，
           空槽显示引导文案（合槽额外说明只收「评」）。 */
        slot.innerHTML = `<span class="slot-tag">${def.tag}</span>
          ${id ? `<div class="s-name">${SHARDS[id].name} <span class="pill gold">${SHARDS[id].tags.join('')} · 文${G.shards[id].wen}</span></div>
                  <div class="s-text">${SHARDS[id].text}</div>`
               : `<div class="s-name">${def.label}</div><div class="s-text">${k === 'he' ? '只收「评」——采访所得' : '点右侧史料放入'}</div>`}`;
        /* 点已放料的槽 = 取回该史料（置 null 后重画，卡池里它会复活）。 */
        slot.onclick = () => {
          if (placed[k]) { delete placed[k]; Sfx.tap(); render(); }
        };
        slots.appendChild(slot);
      });
      left.appendChild(slots);
      // 笔法
      /* 笔法二选一：直笔据实而书（发表时声望 +2，得罪传主），
         曲笔温柔敦厚（声望 -2，传主欢喜）。选中的按钮加 .on 高亮。 */
      const styleRow = el('div', '');
      styleRow.style.cssText = 'display:flex;gap:8px;margin:14px 0;align-items:center';
      styleRow.innerHTML = '<b style="font-size:13.5px">笔法：</b>';
      [['直', '直笔 · 据实而书（声望+2，传主未必高兴）'], ['曲', '曲笔 · 温柔敦厚（传主欢喜，声望-2）']].forEach(([key, tip]) => {
        /* forEach 的参数 [key, tip] 是解构：直接把数组拆成两个变量。 */
        const b = el('button', 'seg' + (style === (key === '直' ? '直' : '曲') ? ' on' : ''), key + '笔');
        b.title = tip;
        b.onclick = () => { style = key === '直' ? '直' : '曲'; Sfx.tap(); render(); };
        styleRow.appendChild(b);
      });
      left.appendChild(styleRow);
      left.appendChild(el('div', 'muted', `预计得分 ${score()} · 文笔 ${G.wen}（≥${v.minWen} 可发）· 神品≥36 上品≥28 中品≥20`));
      const pubBtn = el('button', 'btn btn-primary', '定稿 · 发表此卷');
      pubBtn.style.cssText = 'width:100%;margin-top:12px;padding:14px;font-size:17px';
      pubBtn.onclick = () => publish();
      left.appendChild(pubBtn);
      grid.appendChild(left);
      /* 右：史料池 */
      const right = el('div', '');
      right.appendChild(el('div', 'muted', `本卷史料（点选入槽，点槽可取回）`));
      const pool = el('div', 'shard-pool');
      pool.style.marginTop = '8px';
      /* 只展示玩家已拥有的本卷史料；已在槽里的卡标记 used（置灰防重复入槽）。 */
      const owned = volPool(volNo).filter(s => G.shards[s]);
      owned.forEach(sid => {
        const sh = SHARDS[sid];
        const used = Object.values(placed).includes(sid);
        const card = el('div', 'shard-card' + (used ? ' used' : ''));
        const srcName = { scene:'亲历', gossip:'转述', interview:'采访' }[G.shards[sid].src] || '';
        card.innerHTML = `<div class="sc-tags">${sh.tags.join('')} · 文${G.shards[sid].wen} · ${srcName}</div>
          <div class="sc-name">${sh.name}</div><div class="sc-text">${sh.text}</div>`;
        /* 点史料卡 = 让 autoSlotFor 挑个好槽自动放入。 */
        card.onclick = () => {
          if (used) return;
          const k = autoSlotFor(sid);
          if (!k) { toast('四槽已满，点槽取回一条再放'); return; }
          placed[k] = sid; Sfx.page(); render();
        };
        pool.appendChild(card);
      });
      /* 还没收集到的史料列个清单，提醒玩家去哪补——缺料也允许发表。 */
      const missing = volPool(volNo).filter(s => !G.shards[s]);
      if (missing.length) {
        pool.appendChild(el('div', 'muted', `尚缺 ${missing.length} 条：「${missing.map(s => SHARDS[s].name).join('」「')}」。缺料也可发（凑满四槽即可），但选择少了。`));
      }
      right.appendChild(pool);
      grid.appendChild(right);
      body.appendChild(grid);
    });
  }

  /* 发表前的三道门槛：四槽必须全满（不成卷不发表）、文笔要够该卷下限、
     个别卷还要求传主好感达标。任一不过就 toast 说明原因并返回 false。 */
  function checks() {
    const v = VOL_BY_NO[volNo];
    if (SLOT_KEYS.some(k => !placed[k])) { toast('四槽未满，不成卷'); return false; }
    if (G.wen < v.minWen) { toast(`文笔不足（${G.wen}/${v.minWen}），去图书馆读书、写日记`, '恶'); return false; }
    if (v.needFavor && Engine.favorOf(v.needFavor.id) < v.needFavor.v) {
      toast(v.needFavor.hint, '恶'); return false;
    }
    return true;
  }

  /* 定稿发表（本文件的核心结算）：
     1) 算分定品级，把这一卷“落卷”进 G.vols 存档；
     2) 结算奖励：文笔 +5，声望/零花钱按卷配置，直/曲笔再 ±2 修正，
        按卷配置给相关人物加好感；
     3) 直/曲笔各解锁一枚成就并按笔法增减传主（cast[0]）好感 ±4；
     4) 判定卷数/品级类成就（卷八、八卷、十五卷且均品上）；
     5) 打开“发刊词”面板展示品级判词，点“看看传主反应”播收尾对话；
     6) 最后清空四槽，为写下一卷做准备。 */
  function publish() {
    if (!checks()) return;
    const v = VOL_BY_NO[volNo];
    const s = score(), g = gradeOf(s);
    // 落卷
    G.vols[volNo] = { grade: g, score: s, style, shards: SLOT_KEYS.map(k => placed[k]) };
    G.stats.published++;
    Engine.addWen(5);
    Engine.addRep(v.rep + (style === '直' ? 2 : -2));
    Engine.addMoney(v.money);
    Object.entries(v.favor).forEach(([id, n]) => Engine.addFavor(id, n));
    if (style === '直') {
      G.stats.direct++;
      Engine.award('ach_direct');
      Engine.addFavor(v.cast[0], -4);
    } else {
      G.stats.curve++;
      Engine.award('ach_curve');
      Engine.addFavor(v.cast[0], 4);
    }
    if (volNo === 8) Engine.award('ach_v8');
    if (G.stats.published >= 8) Engine.award('ach_half');
    /* “太史公”成就：十五卷全部发表且平均品级 ≥ 3（平均达上品）。 */
    if (G.stats.published >= 15) {
      const avg = Object.values(G.vols).reduce((a, b) => a + b.grade, 0) / 15;
      if (avg >= 3) Engine.award('ach_taishi');
    }
    Sfx.seal();
    Save.write();
    // 判词画面
    /* openPanel 的 build 回调是同步执行的：此刻 placed 还没被清空，
       所以判词里能列出本卷四槽的史料名；面板建好之后才执行下面那行清空。 */
    UI.openPanel(`发刊 · ${v.title}`, body => {
      const verd = el('div', 'writ-verdict');
      verd.innerHTML = `
        <div class="muted" style="letter-spacing:.4em;margin-bottom:6px">实 验 史 记 · 卷${v.i}</div>
        <h3 style="font-family:var(--font-cl);font-size:22px">${v.title}</h3>
        <div class="grade">${gradeName(g)}</div>
        <div class="muted">得分 ${s} · ${style}笔 · ${placedToDesc()}</div>
        <div style="margin-top:10px" class="card">
          <div class="meta">声望 ${v.rep + (style === '直' ? 2 : -2) >= 0 ? '+' : ''}${v.rep + (style === '直' ? 2 : -2)} · 零花钱 +${v.money} · 文笔 +5<br>立传入册：${v.cast.map(id => (PEOPLE_BY_ID[id] || {}).name || id).join('、')}</div>
        </div>
        <button class="btn btn-primary" style="margin-top:14px" id="after-vol">看看传主反应</button>`;
      body.appendChild(verd);
      $('#after-vol').onclick = () => {
        UI.closePanel();
        const after = v.after || [{ who:'旁白', text:'卷成。' }];
        Dialog.play(after);
      };
    });
    placed = { qi: null, cheng: null, zhuan: null, he: null };
  }
  /* 把四槽的史料名连成一句话（空槽自动跳过），用在判词画面。 */
  function placedToDesc() {
    return SLOT_KEYS.map(k => SHARDS[placed[k]] ? SHARDS[placed[k]].name : '').filter(Boolean).join(' / ');
  }

  /* 立传已与主线解耦：不再需要先胜传主（原「成传之战」门禁撤下）。
     保留下方 duelReady / duelWon 两个函数，供面板作「可切磋」的软提示。 */
  function duelReady() { return true; }
  /* 传主若配了马刀卡，看刀谱（Blades）里录没录到他的刀；
     只用于图鉴里显示“可切磋”的提示，不影响立传本身。
     typeof 判活：blades.js 在本文件之后加载，运行时才检查是否存在。 */
  function duelWon(no) {
    const v = VOL_BY_NO[no];
    return !v.duel || (typeof Blades !== 'undefined' && Blades.hasCard(v.duel));
  }

  /* 对外接口：open 进入某卷的撰写面板（每次进入都重置槽位与笔法）；
     openPublished 只是跳转到 UI.viewVol 阅读已发表的成卷。 */
  return {
    open(no) {
      volNo = no;
      placed = { qi: null, cheng: null, zhuan: null, he: null };
      style = '直';
      render();
    },
    duelReady,
    duelWon,
    openPublished(no) { UI.viewVol(no); },
  };
})();
