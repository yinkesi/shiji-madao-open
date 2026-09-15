/* 实验史记·春秋笔 —— 撰史系统：拼版 / 笔法 / 品级 */
'use strict';

const Writing = (() => {
  let volNo = 0;
  let placed = { qi: null, cheng: null, zhuan: null, he: null }; // shardId
  let style = '直';

  /* 某卷可用的全部史料：卷池 + 该卷所有采访/额外史料（如 sh_pingpong） */
  function volPool(no) { return Object.keys(SHARDS).filter(id => SHARDS[id].vol === no); }

  const SLOT_KEYS = ['qi', 'cheng', 'zhuan', 'he'];
  function slotDef(k) { return SLOTS.find(s => s.key === k); }
  function accepts(slotKey, shardId) {
    const def = slotDef(slotKey);
    const tags = SHARDS[shardId].tags;
    if (def.only && !def.only.some(t => tags.includes(t))) return false;
    return true;
  }
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
  function gradeOf(s) { return s >= 36 ? 4 : s >= 28 ? 3 : s >= 20 ? 2 : 1; }
  function gradeName(g) { return { 4:'神品', 3:'上品', 2:'中品', 1:'下品' }[g]; }

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
        slot.innerHTML = `<span class="slot-tag">${def.tag}</span>
          ${id ? `<div class="s-name">${SHARDS[id].name} <span class="pill gold">${SHARDS[id].tags.join('')} · 文${G.shards[id].wen}</span></div>
                  <div class="s-text">${SHARDS[id].text}</div>`
               : `<div class="s-name">${def.label}</div><div class="s-text">${k === 'he' ? '只收「评」——采访所得' : '点右侧史料放入'}</div>`}`;
        slot.onclick = () => {
          if (placed[k]) { delete placed[k]; Sfx.tap(); render(); }
        };
        slots.appendChild(slot);
      });
      left.appendChild(slots);
      // 笔法
      const styleRow = el('div', '');
      styleRow.style.cssText = 'display:flex;gap:8px;margin:14px 0;align-items:center';
      styleRow.innerHTML = '<b style="font-size:13.5px">笔法：</b>';
      [['直', '直笔 · 据实而书（声望+2，传主未必高兴）'], ['曲', '曲笔 · 温柔敦厚（传主欢喜，声望-2）']].forEach(([key, tip]) => {
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
      const owned = volPool(volNo).filter(s => G.shards[s]);
      owned.forEach(sid => {
        const sh = SHARDS[sid];
        const used = Object.values(placed).includes(sid);
        const card = el('div', 'shard-card' + (used ? ' used' : ''));
        const srcName = { scene:'亲历', gossip:'转述', interview:'采访' }[G.shards[sid].src] || '';
        card.innerHTML = `<div class="sc-tags">${sh.tags.join('')} · 文${G.shards[sid].wen} · ${srcName}</div>
          <div class="sc-name">${sh.name}</div><div class="sc-text">${sh.text}</div>`;
        card.onclick = () => {
          if (used) return;
          const k = autoSlotFor(sid);
          if (!k) { toast('四槽已满，点槽取回一条再放'); return; }
          placed[k] = sid; Sfx.page(); render();
        };
        pool.appendChild(card);
      });
      const missing = volPool(volNo).filter(s => !G.shards[s]);
      if (missing.length) {
        pool.appendChild(el('div', 'muted', `尚缺 ${missing.length} 条：「${missing.map(s => SHARDS[s].name).join('」「')}」。缺料也可发（凑满四槽即可），但选择少了。`));
      }
      right.appendChild(pool);
      grid.appendChild(right);
      body.appendChild(grid);
    });
  }

  function checks() {
    const v = VOL_BY_NO[volNo];
    if (SLOT_KEYS.some(k => !placed[k])) { toast('四槽未满，不成卷'); return false; }
    if (G.wen < v.minWen) { toast(`文笔不足（${G.wen}/${v.minWen}），去图书馆读书、写日记`, '恶'); return false; }
    if (v.needFavor && Engine.favorOf(v.needFavor.id) < v.needFavor.v) {
      toast(v.needFavor.hint, '恶'); return false;
    }
    return true;
  }

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
    if (G.stats.published >= 15) {
      const avg = Object.values(G.vols).reduce((a, b) => a + b.grade, 0) / 15;
      if (avg >= 3) Engine.award('ach_taishi');
    }
    Sfx.seal();
    Save.write();
    // 判词画面
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
  function placedToDesc() {
    return SLOT_KEYS.map(k => SHARDS[placed[k]] ? SHARDS[placed[k]].name : '').filter(Boolean).join(' / ');
  }

  return {
    open(no) {
      volNo = no;
      placed = { qi: null, cheng: null, zhuan: null, he: null };
      style = '直';
      render();
    },
    openPublished(no) { UI.viewVol(no); },
  };
})();
