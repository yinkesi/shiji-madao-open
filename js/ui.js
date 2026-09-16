/* 实验史记·春秋笔 —— UI：HUD / 面板 / 图鉴 / 成就 / 设置 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   世界侧的全部界面：顶部 HUD 刷新、地点快捷移动、“今日风闻”栏、
   史记面板（15 卷书架 + 打听错过的史料）、成卷阅读、人物图鉴（含
   马刀被动/技展示）、行囊、小卖部、成就墙、系统设置（音效/打字速度/
   马刀难度自选/存档导出导入/重开）、通用确认框。

   【架构位置】
   在 minigames.js 之后、战斗层之前由 index.html 加载（第 12 个 <script>）。
   依赖：config 的 $ / el / SheetFX / Sfx / Save / toast / flushToasts，
   Engine、World、Writing，以及 data 里的 VOLS / SHARDS / PEOPLE / ITEMS /
   SCENES 等表；同时被 main.js / quests.js / blades.js 到处调用。
   注意 UI 与 Writing 互相引用（UI 的史记面板调 Writing.open，
   Writing 的判词回调又调 UI.closePanel）——没有模块系统也照样跑得通，
   靠的是“全局裸名 + 运行时才解析”。

   【暴露的全局名】
   UI（IIFE 返回的大对象）：openPanel closePanel bump updateHUD
   renderPlaces renderHearsay toastScene panelBook viewVol panelCodex
   panelBag panelShop panelAch panelSettings confirmBox，
   另有 panelOpen 只读访问器和 onClose 只写访问器。

   【新手阅读提示】
   1) openPanel(标题, build)：build 是“回调函数”——面板骨架先打开，
      再把 body 元素交给你、由你往里填内容。函数在 JS 里和数字一样
      是“值”，可以当参数传来传去（同 Python 把函数作实参）。
   2) 面板内容普遍是“模板字符串拼 HTML + onclick 赋值”的直白写法；
      每次操作后关面板再重开（或整段重建）来刷新，这是本项目的一贯风格。
   ================================================================ */

const UI = (() => {
  /* panel 是底部抽屉面板本体，scrim 是它背后那层半透明遮罩（点遮罩也可关闭）。 */
  const panel = $('#panel'), scrim = $('#scrim');
  let panelOpen = false, onPanelClose = null;

  /* 打开抽屉面板：写标题 → 清空旧内容 → 调 build(body) 让调用方填内容
     → 遮罩与面板取消隐藏 → SheetFX 负责弹性滑入。 */
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
  /* 关面板：先把 panelOpen 置 false（toast 的排队判断等立即生效），
     滑出动画交给 SheetFX；onPanelClose 是“下次关闭时执行一次”的回调
     （用完即清空，防止重复触发）；稍候 150ms 再补播排队中的 toast。 */
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    SheetFX.close(panel, () => {});
    scrim.classList.add('hidden');
    const cb = onPanelClose; onPanelClose = null; cb && cb();
    setTimeout(flushToasts, 150);
  }
  /* 关闭按钮（面板右上角 ×）和遮罩点击都指向 closePanel。 */
  $('#panel-close').onclick = closePanel;
  scrim.addEventListener('click', closePanel);

  /* 让 HUD 某一项更新数字并“跳一下”。小技巧：先移除 .bump 再加回之前，
     读一次 chip.offsetWidth 强制浏览器立刻重算布局（reflow）——
     否则同一个 class 连续加两次，CSS 动画不会重播。
     “令”那一位显示的是主线进度（行动点已退化为风味设定）。 */
  function bump(stat) {
    const elx = $('#hud-' + stat + '-v');
    const chip = $('#hud-' + stat);
    if (!elx) return;
    /* 「令」位现为主线进度（原行动点已退化为风味，不再是探索门禁） */
    if (stat === 'ap') elx.textContent = (typeof Quests !== 'undefined') ? Quests.progressLabel() : '0/9';
    else elx.textContent = stat === 'wen' ? G.wen : stat === 'rep' ? G.rep : G.money;
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
  }
  /* 全量刷新顶部 HUD：日期/章节/主线进度/三项资源/刀卡名号，
     最后按当前时段给 <body> 换主题 class（白天/夜间配色随之切换）。 */
  function updateHUD() {
    $('#hud-date-main').textContent = Engine.dateLabel();
    $('#hud-period').textContent = Engine.chLabel();
    $('#hud-ap-v').textContent = (typeof Quests !== 'undefined') ? Quests.progressLabel() : '0/9';
    $('#hud-wen-v').textContent = G.wen;
    $('#hud-rep-v').textContent = G.rep;
    $('#hud-money-v').textContent = G.money;
    /* 刀卡名号：Blades（刀谱系统）可能还没加载，typeof 判活后再用；
       没打赢过就显示“未入册”，有胜场就追加“· N胜”。 */
    if ($('#hud-blade-name')) {
      const rn = (typeof Blades !== 'undefined' && Blades.rankName()) || '未入册';
      $('#hud-blade-name').textContent = rn === '马刀之神' ? '马刀之神' : (rn + (G.wins ? ` · ${G.wins}胜` : ''));
    }
    document.body.classList.remove('theme-morning', 'theme-day', 'theme-night');
    document.body.classList.add(PERIOD_THEME[Engine.period()]);
  }
  /* 底部地点栏：每个场景一个按钮，当前所在地高亮（here 类）；
     点别处就瞬移（对话播放中禁止），顺手关掉面板。 */
  function renderPlaces() {
    const bar = $('#placelist');
    bar.innerHTML = '';
    SCENES.forEach(s => {
      const b = el('button', 'place-btn' + (s.id === World.sceneId ? ' here' : ''), s.short);
      b.onclick = () => { if (s.id !== World.sceneId && !Dialog.active) World.travel(s.id); UI.closePanel(); };
      bar.appendChild(b);
    });
  }
  /* “今日风闻”栏：列本章可亲历的事件（最多 4 条，已记的打勾）；
     有错过的史料就追加一条可点击的入口，跳去史记页打听；
     什么都没有则显示“风平浪静”。 */
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
    if (!evs.length && !missed.length) list.innerHTML = '<div class="hearsay-item">此地风平浪静，宜读书访友。</div>';
  }
  function toastScene(name) { toast(name, '行'); }

  /* ============ 史记面板 ============ */
  function gradeName(g) { return { 4:'神品', 3:'上品', 2:'中品', 1:'下品' }[g] || ''; }
  /* 史记面板：15 卷的“书架”。已发表的显示品级、点开阅读；未发表的显示
     收集进度（x/y 料）与进度条，凑满 4 条可点进去撰写（Writing.open），
     不够则 toast 提示还缺哪些。下方另有“错过的史料·可打听”区：
     对应人物好感 ≥15 才肯开口，托人带话换转述版史料（文笔 -1）。 */
  function panelBook(mode) {
    openPanel('史记 · 卷目', body => {
      const pub = Object.keys(G.vols).length;
      const head = el('div', '', `<div class="muted">已立 ${pub} / 15 卷 · 直笔 ${G.stats.direct} 次 · 曲笔 ${G.stats.curve} 次 · 文笔 ${G.wen} · 声望 ${G.rep}</div>
        <div class="muted" style="margin-top:3px">立传为可选支线：与主线无关，随时可写。集满四料即可定稿，成卷自有报偿。</div><div style="height:10px"></div>`);
      body.appendChild(head);
      VOLS.forEach(v => {
        const st = G.vols[v.no];
        const pool = Object.keys(SHARDS).filter(id => SHARDS[id].vol === v.no);
        const owned = pool.filter(s => G.shards[s]).length;
        const duelWon = !v.duel || (typeof Blades !== 'undefined' && Blades.hasCard(v.duel));
        const row = el('div', 'vol-row' + (st ? '' : owned ? '' : ' locked'));
        const right = st ? `<span class="vol-grade g${st.grade}">${gradeName(st.grade)}</span>`
          : `<span class="muted">${owned}/${pool.length} 料</span>`;
        /* 传主若配了马刀卡且还没打赢，行内附一条小字：不影响立传，胜了可录他的技。 */
        const duelNote = (!st && v.duel && !duelWon)
          ? `<small>未与传主「${(window.SJI_DATA.CHARACTERS[v.duel] || {}).hao || v.duel}」一战——不影响立传，胜之另可录其技</small>`
          : '';
        row.innerHTML = `<div class="vol-no">${v.i}</div>
          <div class="vol-name">${v.title}<small>${st ? `${st.style === '直' ? '直笔' : '曲笔'} · 得意 ${st.shards.length} 条` : `集 ${pool.length} 料取其四 · 文笔≥${v.minWen}`}</small>${duelNote}
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
            /* 打听成功：以 gossip 来源拿到（文笔 -1 的）转述版史料，
               累计 8 次解锁“锦绣昼行”成就，再给对方 +1 好感表示感谢。 */
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
  /* 阅读已发表的某卷：按当时入槽顺序把四条史料拼成全文，
     最后一条若以“音克思曰：”开头就单独抬成朱色史评
     （replace 的正则 /^音克思曰：/ 把开头去掉，避免与标题重复）。 */
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
  /* 人物图鉴：图鉴人物 PEOPLE + 外校来客 PEOPLE_WAI 全员上墙，三档解锁——
     没见过 → “？？？未识”；见过（G.flags.metPeople 有记录）→ 姓名 + 简介 +
     马刀被动/技一行；给他立过传（G.vols 里有对应卷）→ 再解锁全文小传与语录。 */
  function panelCodex() {
    openPanel('图鉴 · 史中人', body => {
      const grid = el('div', 'pgrid');
      const all = PEOPLE.concat(PEOPLE_WAI);
      all.forEach(p => {
        const volNo = p.vol ? VOLS.find(v => v.no === p.vol) : null;
        const published = p.vol && G.vols[p.vol];
        const met = G.flags.metPeople.includes(p.id);
        const card = el('div', 'card pcard');
        /* 每张卡的小头像也是 Canvas 现画的（World.avatarCanvas）。 */
        card.appendChild(World.avatarCanvas(p, 56));
        const info = el('div', '');
        /* 马刀数据在战斗层的数据表 window.SJI_DATA.CHARACTERS 里；
           只有见过的人才展示这行“武学情报”。 */
        const bch = window.SJI_DATA && SJI_DATA.CHARACTERS[p.id];
        const bladeLine = (met && bch)
          ? `<div class="meta" style="color:var(--cinnabar)">马刀 · 被动「${bch.passive.name}」${bch.skill ? ` · 技「${bch.skill.name}」` : (bch.skills ? ` · 技「${bch.skills[0].name}」` : '')}</div>`
          : '';
        /* 一长串模板字符串里嵌了多个三元表达式，按 published/met 组合出不同文案。 */
        info.innerHTML = `<div class="pname">${met || published ? p.name : '？？？'}<span class="phao">${met || published ? (p.hao || '') : '未识'}</span></div>
          <div class="pbio">${published ? p.bio : met ? p.intro + '<br><span class="muted">立传后解锁全文小传。</span>' : '尚未结识。多去校园里走走。'}</div>
          ${bladeLine}
          ${published && p.quote ? `<div class="pquote">${p.quote}</div>` : ''}
          ${met && !published ? `<div class="muted" style="margin-top:4px">好感 ${Engine.favorOf(p.id)}${p.interview ? Engine.hasShard(p.interview.give) ? ' · 已采访' : ` · ${p.ivNeed != null ? p.ivNeed : 30} 可采访` : ''}</div>` : ''}`;
        card.appendChild(info);
        grid.appendChild(card);
      });
      body.appendChild(grid);
    });
  }

  /* ============ 行囊 ============ */
  /* 行囊：把 G.bag 里数量大于 0 的东西逐个列成卡片；空则提示去小卖部。 */
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
  /* 小卖部：声望 ≥80 / ≥50 享八折 / 九折（嵌套三元表达式按阈值取折扣）。
     买不起的按钮直接 disabled 置灰。买完关面板立刻重开 = 整体刷新
     余额与价格，依旧贯彻“重画”风格。 */
  function panelShop() {
    openPanel('小卖部', body => {
      const disc = G.rep >= 80 ? 0.8 : G.rep >= 50 ? 0.9 : 1;
      const discName = disc === 0.8 ? '八折' : disc === 0.9 ? '九折' : '无折扣';
      body.appendChild(el('div', 'muted', `零花钱 ◉${G.money} · 声望 ${G.rep}（${discName}）· 买东西送人，好感是采访与打听的本钱。`));
      body.appendChild(el('div', '', '<div style="height:8px"></div>'));
      ITEMS.forEach(it => {
        const price = Math.ceil(it.price * disc);
        const c = el('div', 'card');
        c.style.display = 'flex'; c.style.alignItems = 'center'; c.style.gap = '12px';
        c.innerHTML = `<div style="flex:1"><h3 style="margin:0">${it.name} <span class="pill gold">◉${price}</span></h3><div class="meta">${it.desc}</div></div>`;
        const b = el('button', 'btn', '买');
        b.style.padding = '8px 18px';
        b.disabled = G.money < price;
        b.onclick = () => {
          if (G.money < price) return;
          Engine.addMoney(-price);
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
  /* 成就墙：整表渲染 ACHIEVEMENTS，解锁的卡片加 .got 高亮。 */
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
  /* 系统设置。先用 mk() 把“一行标签 + 一组段选按钮”做成局部小工厂函数，
     之后音效/打字速度/难度各调一次就生成一行——用函数消除重复代码。
     点任一选项都会关面板再重开设置面板（重画模式），选中态立现。 */
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
      /* 难度自选：写入战斗层设置，直接影响所有对决/试炼/任务的敌方强度与赏格 */
      /* 难度不存进本游戏的 G：而是写入战斗层自己的存档（window.SJI_SAVE，
         由 js/battle/save.js 提供）。DIFFS / DIFF_BY_V 来自战斗层配置。
         typeof + window 判活：战斗层文件万一缺失，设置页也不能崩。 */
      if (typeof DIFFS !== 'undefined' && window.SJI_SAVE) {
        mk('马刀难度', DIFFS.map(d => ({ t: d.n, v: d.v })), Quests.diffV(), v => {
          SJI_SAVE.setSetting('lastDiff', v);
          const d = DIFF_BY_V[v];
          toast(`难度改为「${d.n}」：${d.tip}`, '刀');
          Save.write();
        });
        const dv = DIFF_BY_V[Quests.diffV()];
        body.appendChild(el('div', 'muted', `当前：${dv.n} —— ${dv.tip}。难度只改敌方强度与赏格，不改剧情。`));
      }
      body.appendChild(el('div', '', '<div style="height:14px"></div>'));
      /* 导出存档：Save.export() 转成 base64 文本放进只读文本框；
         复制用的是较老的 document.execCommand('copy')——比新的
         navigator.clipboard 兼容性更稳（也不要求 HTTPS）。 */
      const ex = el('div', 'card');
      ex.innerHTML = '<h3>导出存档</h3><div class="meta" style="margin-bottom:8px">换设备或清缓存前，把这串文字保存好。</div>';
      const ta1 = el('textarea', 'savebox'); ta1.readOnly = true; ta1.value = Save.export();
      ex.appendChild(ta1);
      const cb1 = el('button', 'btn', '复制到剪贴板'); cb1.style.marginTop = '8px';
      cb1.onclick = () => { ta1.select(); document.execCommand && document.execCommand('copy'); toast('已复制', '存'); };
      ex.appendChild(cb1);
      body.appendChild(ex);
      /* 导入存档：解析成功就 location.reload() 整页刷新，以新存档启动；
         解析失败（粘错了内容）会被 Save.import 抛出的错误打断，
         catch 里 toast 提示，页面不会崩。 */
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
      /* 重开一局：先弹确认框防手滑，确认后才清存档并刷新页面。 */
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
  /* 通用确认框：现场造一层全屏遮罩 + 一张卡片 + 确定/再想想两个按钮，
     直接 append 到 <body>（不入面板）。cssText 一条字符串写多条内联样式。
     确定 = 先移除遮罩再执行 onYes；再想想 = 只移除遮罩什么都不做。 */
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

  /* 对外接口一览。get panelOpen / set onClose 是“访问器属性”：
     外界读 UI.panelOpen、或写 UI.onClose = 某函数 时，实际执行的是
     这两个小函数——内部变量依然私有，赋值进去的回调也只在
     closePanel 里被取用一次。 */
  return { openPanel, closePanel, bump, updateHUD, renderPlaces, renderHearsay, toastScene,
    panelBook, viewVol, panelCodex, panelBag, panelShop, panelAch, panelSettings, confirmBox,
    get panelOpen() { return panelOpen; }, set onClose(f) { onPanelClose = f; } };
})();
