/* 实验史记·春秋笔 —— UI：HUD / 面板 / 图鉴 / 成就 / 设置 */
'use strict';

const UI = (() => {
  const panel = $('#panel'), scrim = $('#scrim');
  let panelOpen = false, onPanelClose = null;

  function openPanel(title, build) {
    $('#panel-title').textContent = title;
    const body = $('#panel-body');
    body.innerHTML = '';
    build(body);
    panel.classList.remove('hidden');
    scrim.classList.remove('hidden');
    SheetFX.open(panel);
    panelOpen = true;
    Sfx.page();
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    SheetFX.close(panel, () => {});
    scrim.classList.add('hidden');
    const cb = onPanelClose; onPanelClose = null; cb && cb();
    setTimeout(flushToasts, 150);
  }
  $('#panel-close').onclick = closePanel;
  scrim.addEventListener('click', closePanel);

  function bump(stat) {
    const elx = $('#hud-' + stat + '-v');
    const chip = $('#hud-' + stat);
    if (!elx) return;
    elx.textContent = stat === 'ap' ? G.ap : G[stat === 'wen' ? 'wen' : stat === 'rep' ? 'rep' : 'money'];
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
  }
  function updateHUD() {
    $('#hud-date-main').textContent = Engine.dateLabel();
    $('#hud-period').textContent = PERIOD_LABEL[Engine.period()];
    $('#hud-ap-v').textContent = G.ap;
    $('#hud-wen-v').textContent = G.wen;
    $('#hud-rep-v').textContent = G.rep;
    $('#hud-money-v').textContent = G.money;
    document.body.classList.remove('theme-morning', 'theme-day', 'theme-night');
    document.body.classList.add(PERIOD_THEME[Engine.period()]);
  }
  function renderPlaces() {
    const bar = $('#placelist');
    bar.innerHTML = '';
    SCENES.forEach(s => {
      const b = el('button', 'place-btn' + (s.id === World.sceneId ? ' here' : ''), s.short);
      b.onclick = () => { if (s.id !== World.sceneId && !Dialog.active) World.travel(s.id); UI.closePanel(); };
      bar.appendChild(b);
    });
  }
  function renderHearsay() {
    const list = $('#hearsay-list');
    if (!list) return;
    list.innerHTML = '';
    const evs = Engine.eventsToday();
    if (evs.length) {
      evs.slice(0, 4).forEach(ev => {
        const done = G.doneEvents.includes(ev.id);
        const d = el('div', 'hearsay-item');
        d.innerHTML = `<b>${ev.name}</b> · ${SCENE_BY_ID[ev.scene].short} ${done ? '<span class="done">已记</span>' : ''}`;
        list.appendChild(d);
      });
    }
    const missed = Engine.missedEvents();
    if (missed.length) {
      const d = el('div', 'hearsay-item');
      d.innerHTML = `<b>${missed.length} 条错过的史料</b>可打听（史记页查看）`;
      d.style.cursor = 'pointer';
      d.onclick = () => { UI.closePanel(); UI.panelBook('gossip'); };
      list.appendChild(d);
    }
    if (!evs.length && !missed.length) list.innerHTML = '<div class="hearsay-item">今日风平浪静，宜读书访友。</div>';
  }
  function toastScene(name) { toast(name, '行'); }

  /* ============ 史记面板 ============ */
  function gradeName(g) { return { 4:'神品', 3:'上品', 2:'中品', 1:'下品' }[g] || ''; }
  function panelBook(mode) {
    openPanel('史记 · 卷目', body => {
      const pub = Object.keys(G.vols).length;
      const head = el('div', '', `<div class="muted">已立 ${pub} / 15 卷 · 直笔 ${G.stats.direct} 次 · 曲笔 ${G.stats.curve} 次</div><div style="height:10px"></div>`);
      body.appendChild(head);
      VOLS.forEach(v => {
        const st = G.vols[v.no];
        const pool = Object.keys(SHARDS).filter(id => SHARDS[id].vol === v.no);
        const owned = pool.filter(s => G.shards[s]).length;
        const row = el('div', 'vol-row' + (st ? '' : owned ? '' : ' locked'));
        const right = st ? `<span class="vol-grade g${st.grade}">${gradeName(st.grade)}</span>`
          : `<span class="muted">${owned}/${pool.length} 料</span>`;
        row.innerHTML = `<div class="vol-no">${v.i}</div>
          <div class="vol-name">${v.title}<small>${st ? `${st.style === '直' ? '直笔' : '曲笔'} · 得意 ${st.shards.length} 条` : `集 ${pool.length} 料取其四 · 文笔≥${v.minWen}`}</small>
          ${st ? '' : `<div class="progress-bar"><i style="width:${Math.round(owned / pool.length * 100)}%"></i></div>`}</div>${right}`;
        row.onclick = () => {
          if (st) viewVol(v.no);
          else if (owned >= 4) Writing.open(v.no);
          else {
            const missing = v.pool.filter(s => !G.shards[s]);
            toast(`还差 ${4 - owned} 条：「${missing.slice(0, 3).map(s => SHARDS[s].name).join('」「')}」…`);
          }
        };
        body.appendChild(row);
      });
      // 打听区
      const missed = Engine.missedEvents();
      if (missed.length) {
        body.appendChild(el('div', '', '<div style="height:16px"></div><h3 style="font-family:var(--font-cl)">错过的史料 · 可打听</h3><div class="muted" style="margin-bottom:8px">花 1 行动点托人带话（需对方好感≥15），转述版文笔-1。</div>'));
        missed.forEach(ev => {
          const sh = SHARDS[ev.shard];
          if (G.shards[ev.shard]) return;
          const from = PEOPLE_BY_ID[ev.cast[0]];
          const row = el('div', 'vol-row');
          row.innerHTML = `<div class="vol-no">询</div><div class="vol-name">${sh.name}<small>向 ${from ? from.hao || from.name : '知情人'} 打听 · 好感 ${from ? Engine.favorOf(from.id) : 0}/15</small></div>
            <span class="pill ${Engine.favorOf(ev.cast[0]) >= 15 ? 'jade' : 'gray'}">${Engine.favorOf(ev.cast[0]) >= 15 ? '可打听' : '好感不足'}</span>`;
          row.onclick = () => {
            if (Engine.favorOf(ev.cast[0]) < 15) { toast('好感不足，他不肯多说'); return; }
            if (!Engine.spendAP(1)) return;
            Engine.grantShard(ev.shard, 'gossip');
            G.stats.gossip++;
            if (G.stats.gossip >= 8) Engine.award('ach_gossip');
            Engine.addFavor(ev.cast[0], 1);
            UI.closePanel(); UI.panelBook('gossip'); UI.renderHearsay();
          };
          body.appendChild(row);
        });
      }
    });
  }
  function viewVol(no) {
    const v = VOL_BY_NO[no], st = G.vols[no];
    openPanel(`${v.title}（${v.i}）`, body => {
      const wrap = el('div', 'card');
      wrap.style.fontFamily = 'var(--font-cl)';
      wrap.innerHTML = `<div class="muted" style="text-align:center;letter-spacing:.4em">实 验 史 记</div>
        <h3 style="text-align:center;font-size:19px;margin:6px 0 10px">${v.title} 第${v.i}</h3>
        ${st.shards.map(id => `<p style="font-size:14.5px;line-height:1.9;margin:8px 0">${SHARDS[id].text}</p>`).join('')}
        <p style="font-size:14.5px;line-height:1.9;margin:10px 0 4px;color:var(--cinnabar)">音克思曰：${SHARDS[st.shards[st.shards.length-1]].text.replace(/^音克思曰：/, '')}</p>
        <div style="text-align:right;margin-top:8px"><span class="vol-grade g${st.grade}">${gradeName(st.grade)} · ${st.style}笔</span></div>`;
      body.appendChild(wrap);
    });
  }

  /* ============ 图鉴 ============ */
  function panelCodex() {
    openPanel('图鉴 · 史中人', body => {
      const grid = el('div', 'pgrid');
      const all = PEOPLE.concat(PEOPLE_WAI);
      all.forEach(p => {
        const volNo = p.vol ? VOLS.find(v => v.no === p.vol) : null;
        const published = p.vol && G.vols[p.vol];
        const met = G.flags.metPeople.includes(p.id);
        const card = el('div', 'card pcard');
        card.appendChild(World.avatarCanvas(p, 56));
        const info = el('div', '');
        info.innerHTML = `<div class="pname">${met || published ? p.name : '？？？'}<span class="phao">${met || published ? (p.hao || '') : '未识'}</span></div>
          <div class="pbio">${published ? p.bio : met ? p.intro + '<br><span class="muted">立传后解锁全文小传。</span>' : '尚未结识。多去校园里走走。'}</div>
          ${published && p.quote ? `<div class="pquote">${p.quote}</div>` : ''}
          ${met && !published ? `<div class="muted" style="margin-top:4px">好感 ${Engine.favorOf(p.id)}${p.interview ? Engine.hasShard(p.interview.give) ? ' · 已采访' : ` · ${p.ivNeed != null ? p.ivNeed : 30} 可采访` : ''}</div>` : ''}`;
        card.appendChild(info);
        grid.appendChild(card);
      });
      body.appendChild(grid);
    });
  }

  /* ============ 行囊 ============ */
  function panelBag() {
    openPanel('行囊', body => {
      const ids = Object.keys(G.bag).filter(k => G.bag[k] > 0);
      if (!ids.length) { body.appendChild(el('div', 'muted', '空空如也。小卖部有售。')); return; }
      ids.forEach(id => {
        const it = ITEM_BY_ID[id];
        const c = el('div', 'card');
        c.innerHTML = `<h3>${it.name} <span class="pill gray">×${G.bag[id]}</span></h3><div class="meta">${it.desc}</div>`;
        body.appendChild(c);
      });
    });
  }

  /* ============ 小卖部 ============ */
  function panelShop() {
    openPanel('小卖部', body => {
      body.appendChild(el('div', 'muted', `零花钱 ◉${G.money} · 买东西送人，好感是采访与打听的本钱。`));
      body.appendChild(el('div', '', '<div style="height:8px"></div>'));
      ITEMS.forEach(it => {
        const c = el('div', 'card');
        c.style.display = 'flex'; c.style.alignItems = 'center'; c.style.gap = '12px';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${it.name} <span class="pill gold">◉${it.price}</span></h3><div class="meta">${it.desc}</div></div>`;
        const b = el('button', 'btn', '买');
        b.style.padding = '8px 18px';
        b.disabled = G.money < it.price;
        b.onclick = () => {
          if (G.money < it.price) return;
          Engine.addMoney(-it.price);
          G.bag[it.id] = (G.bag[it.id] || 0) + 1;
          Sfx.good(); toast(`购得「${it.name}」`, '购');
          Save.write(); UI.closePanel(); UI.panelShop();
        };
        c.appendChild(b);
        body.appendChild(c);
      });
    });
  }

  /* ============ 成就 ============ */
  function panelAch() {
    openPanel('成就', body => {
      const got = ACHIEVEMENTS.filter(a => G.ach[a.id]).length;
      body.appendChild(el('div', 'muted', `${got} / ${ACHIEVEMENTS.length}`));
      body.appendChild(el('div', '', '<div style="height:8px"></div>'));
      const grid = el('div', 'ach-grid');
      ACHIEVEMENTS.forEach(a => {
        const c = el('div', 'card ach' + (G.ach[a.id] ? ' got' : ''));
        c.innerHTML = `<span class="aicon">${a.icon}</span><h3>${a.name}</h3><div class="meta">${a.desc}</div>`;
        grid.appendChild(c);
      });
      body.appendChild(grid);
    });
  }

  /* ============ 设置 ============ */
  function panelSettings() {
    openPanel('系统', body => {
      const mk = (label, segs, cur, cb) => {
        const row = el('div', 'setrow');
        row.appendChild(el('div', '', label));
        const w = el('div', 'segs');
        segs.forEach(s => {
          const b = el('button', 'seg' + (s.v === cur ? ' on' : ''), s.t);
          b.onclick = () => { cb(s.v); UI.closePanel(); UI.panelSettings(); };
          w.appendChild(b);
        });
        row.appendChild(w);
        body.appendChild(row);
      };
      mk('音效', [{ t:'开', v:false }, { t:'静音', v:true }], G.settings.muted, v => { G.settings.muted = v; });
      mk('打字速度', [{ t:'从容', v:1 }, { t:'风驰', v:2 }], G.settings.speed, v => { G.settings.speed = v; });
      body.appendChild(el('div', '', '<div style="height:14px"></div>'));
      const ex = el('div', 'card');
      ex.innerHTML = '<h3>导出存档</h3><div class="meta" style="margin-bottom:8px">换设备或清缓存前，把这串文字保存好。</div>';
      const ta1 = el('textarea', 'savebox'); ta1.readOnly = true; ta1.value = Save.export();
      ex.appendChild(ta1);
      const cb1 = el('button', 'btn', '复制到剪贴板'); cb1.style.marginTop = '8px';
      cb1.onclick = () => { ta1.select(); document.execCommand && document.execCommand('copy'); toast('已复制', '存'); };
      ex.appendChild(cb1);
      body.appendChild(ex);
      const im = el('div', 'card');
      im.innerHTML = '<h3>导入存档</h3><div class="meta" style="margin-bottom:8px">粘贴此前的存档文字。</div>';
      const ta2 = el('textarea', 'savebox'); ta2.placeholder = '粘贴到此处…';
      im.appendChild(ta2);
      const cb2 = el('button', 'btn btn-primary', '导入并重载'); cb2.style.marginTop = '8px';
      cb2.onclick = () => {
        try { Save.import(ta2.value); location.reload(); }
        catch (e) { toast('存档格式不对'); }
      };
      im.appendChild(cb2);
      body.appendChild(im);
      const rs = el('div', 'card');
      const cb3 = el('button', 'btn', '重开一局（清除存档）');
      cb3.onclick = () => {
        confirmBox('重开将清除当前全部进度，确定？', () => { Save.clear(); location.reload(); });
      };
      rs.appendChild(cb3);
      body.appendChild(rs);
      body.appendChild(el('div', 'muted', '<div style="height:14px"></div>据 音克思《实验史记》改编。文言引文皆出自原文。'));
    });
  }

  /* ============ 确认框 ============ */
  function confirmBox(text, onYes) {
    const w = el('div');
    w.style.cssText = 'position:fixed;inset:0;z-index:95;display:grid;place-items:center;background:rgba(20,18,12,.4)';
    const card = el('div', 'card');
    card.style.cssText = 'width:min(340px,86vw);text-align:center';
    card.innerHTML = `<h3 style="margin-bottom:10px">${text}</h3>`;
    const row = el('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:center';
    const yes = el('button', 'btn btn-primary', '确定');
    const no = el('button', 'btn', '再想想');
    yes.onclick = () => { w.remove(); onYes(); };
    no.onclick = () => w.remove();
    row.appendChild(yes); row.appendChild(no); card.appendChild(row); w.appendChild(card);
    document.body.appendChild(w);
  }

  return { openPanel, closePanel, bump, updateHUD, renderPlaces, renderHearsay, toastScene,
    panelBook, viewVol, panelCodex, panelBag, panelShop, panelAch, panelSettings, confirmBox,
    get panelOpen() { return panelOpen; }, set onClose(f) { onPanelClose = f; } };
})();
