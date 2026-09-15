# 《实验史记·马刀行》交接报告

> 更新于 2026-09-15（第二棒）。上一版交接见 git 提交 `3e8133b`。
> 项目：`D:\code\shiji-madao-open`（git 单仓，main 分支，工作树干净）
> 桌面成品：`C:\Users\LENOVO\Desktop\实验史记·马刀行\`
> **接手第一件事：读 §4「用户已拍板的三个决定」与 §6「剩余未完成」，再按 §7 自检。**

---

## 1. 一句话现状

用户提出的**剧情架构完全重构已完成并全链路实测通过**：原「17 章 × 每天 4 时段 × 行动点」时间线已废除，换成**任务驱动的自由开放世界**（主线 9 节 + 支线 7 条 + 难度自选 + 指引卡 + 点将出征）。

测试全绿：**引擎 15 个 Node 测试 ALL PASS** + **剧情链路 30 项 ALL PASS** + **冒烟 56 项 ALL PASS（源码版与打包单文件版双跑，无页面错误）**。

途中抓到并修掉 5 处**同一根因的静默 bug**（`const` 顶层声明不挂 `window`，导致 `window.X` 判定恒假、静默走兜底分支）——详见 §5。

## 2. 用户已拍板的三个决定（不要再问）

上一版报告 §4 建议开工前确认三件事，用户已明确回答：

| 问题 | 用户决定 | 对工作的影响 |
|---|---|---|
| 立传/撰史系统怎么处理 | **降级为可选支线** | 撤下成传战门禁，与主线解耦；保留 15 卷完全部内容与玩法 |
| 「比较大的世界」要多大 | **就 12 个场景，不扩图；力气放到任务与战斗** | 上一版 §5#3「扩到 18-20 区域」**取消**，不要再铺地图 |
| 主线长度 | **保持 9 节** | 不增删节数，力气用于打磨已有 9 节 |

## 3. 这一棒做了什么（对应上一版 §5 未完成清单）

| 原 # | 任务 | 状态 | 落地位置 |
|---|---|---|---|
| 1 | 开局难度入口 | ✅ 完成 | `main.js pickDifficulty()`：`#btn-new` → 四档面板 → `SJI_SAVE.setSetting('lastDiff', v)` → 开新档 |
| 2 | 支线解锁与点将实测 | ✅ 完成并实测 | `tests/quest_flow.mjs` 断言：好感达标→支线出现在卡片与地图→完成→人物入 `G.roster`→点将面板→以其本卡开战→结算记为完成 |
| 3 | 移除时段门控 + 扩图 | ⚠️ 部分完成 | **门控已移除**（见下）；**扩图已按用户决定取消** |
| 4 | 立传降级/移除 | ✅ 完成 | `Writing.duelReady()` 恒真、新增 `duelWon()` 降级为软提示；`ui.js panelBook` 去掉门禁分支 |
| 5 | 任务点冲突 | ✅ 完成 | `Quests.markers()` 新增显示位置 `dpos`：同场景 <70px 的点按扇形摊开；绘制/点击/靠近统一用 `dpos`，寻路仍用原锚点 |
| 6 | smoke 覆盖任务与难度 | ✅ 完成 | smoke 42 → **56 项**；另立 `tests/quest_flow.mjs` **30 项** |
| 7 | 文档与交付刷新 | ✅ 完成 | README / 玩法说明 / 技术报告 全部重写相关章节；`python build.py` 重打包；docx/pdf 重生成；桌面目录已刷新 |
| 8 | 老档迁移说明 | ⚠️ 部分完成 | `normalizeG()` 加 `flags.legacyMigrated`，继续游戏时 toast 说明「主线九节从头接起，此前胜场刀谱进度皆保留」；**未用真实旧格式存档实测**（见 §6） |

### 3.1 时间线解耦具体改了什么（原 §5#3 的轻量版）

| 维度 | 原 | 现 |
|---|---|---|
| 章节 `G.ch` | 睡够 `chDef().days` 天 → 下章 | `Quests.chapterNow()` 由主线完成度映射，`Engine.syncChapter()` 单向推进、只进不退 |
| 映射表 | — | `quests.js CH_AFTER = { m1:1, m2:3, m3:5, m4:8, m5:9, m6:12, m7:13, m8:14, m9:16 }` |
| 事件可见性 | `ch + day + periods` 三重门控 | 只按章过滤，本章之事皆可亲历；已走过章节漏掉未收集的史料仍可打听 |
| 行动点 | 探索消耗，不足禁行 | `spendAP()` 恒真；HUD 原 ⚡ 位改显示**主线进度 n/9** |
| 时段 | 门控风险与事件 | 纯氛围，每天随机轮换 |
| 巡查风险 | 限上午/下午课 | 只与地点有关（教学楼内 9%） |
| 推进按钮 | 「下一时段 ▸」 | 「歇一日 ▸」随时可用（写日记/夜谈/早睡三选一） |
| 开局 | 序章转场卡 → 走廊 | 择难度 → 直接落到操场（主线首节所在地）+ 任务指引 |
| 章节卡 | 每次睡觉/换章 | 只在**主线推进带来章节变化**时弹一次（`Engine.pendingCh` 挂起 → 战斗结束回世界时消费） |

这套映射的收益：协会开张、刀禁期、试炼解锁、番外人物客串这些既有内容**全部只认 `G.ch` 阈值**，于是"打 m4 → 协会开张""打 m6 → 刀禁期起"自动成立，没改一处判断。`Engine.syncWorldFlags()` 负责按当前 `G.ch` 补齐解锁（老档亦然）。

## 4. 当前测试与验证（照这个跑）

```bash
# 前置：本机 Git Bash 缺 POSIX 工具路径，且 playwright 不在仓库里，先补两行
export PATH="/c/Program Files/Git/usr/bin:$PATH"
export NODE_PATH="/c/Users/LENOVO/.workbuddy/binaries/node/workspace/node_modules"

cd /d/code/shiji-madao-open

# 1. 引擎层（纯 Node，无需浏览器）
cd tests/battle/engine && for t in test_rules2 test_bugfix test_features test_status test_duel stress; do node $t.mjs; done

# 2. 剧情链路（30 项）
cd /d/code/shiji-madao-open && node tests/quest_flow.mjs

# 3. 冒烟（56 项，源码版 + 成品版双跑）
node smoke.mjs
python build.py && node smoke.mjs "实验史记·马刀行.html"

# 4. 文档三件套（docx 用全局 docx 包；pdf 走 Word + pywin32）
NODE_PATH=/c/Users/LENOVO/AppData/Roaming/npm/node_modules node md2docx.cjs 技术报告.md 技术报告.docx
/c/Users/LENOVO/.workbuddy/binaries/python/envs/default/Scripts/python.exe export_pdf.py 技术报告.docx 技术报告.pdf

# 5. 刷新桌面
cp 实验史记·马刀行.html 实验史记·马刀行-玩法说明.txt README.md 技术报告.md 技术报告.docx 技术报告.pdf "/c/Users/LENOVO/Desktop/实验史记·马刀行/"
```

浏览器人工过一遍：双击 `index.html` → 开卷 → **先选难度** → 落到操场 → 看右侧任务卡「主线 · 初执马刀」与世界金色「令」气泡 → 点「前往」→ 开战 → 胜利后确认弹出一道章节里程碑卡、卡片推进到「实验三异能者」→ 底部「歇一日」走一天 → 系统·设置里改难度再打一场，确认敌方变强、赏格变大。

## 5. 这一棒踩到的坑（重要，别再踩）

**`const` 顶层声明不挂 `window`——上一版报告已警告，但代码里仍潜伏 5 处，全部是静默失效（不报错、只走兜底分支），所以旧测试全都通过。**

| 位置 | 写法 | 后果 |
|---|---|---|
| `ui.js` HUD 段位章 | `(window.Blades && Blades.rankName()) \|\| '未入册'` | **HUD 段位永远显示「未入册」**；旧断言只查 `textContent.length > 0`，被"未入册"蒙混过关 |
| `ui.js` 设置面板 | `if (window.DIFFS && window.SJI_SAVE)` | **难度选择器从不渲染**（上一版报告称"已可用"，实际不可用） |
| `main.js` 终章评语 | `(window.Blades && ...)` | 终章刀客评语段位恒为「未入册」 |
| `battle-ui.js` 说话人 | `window.PEOPLE_BY_ID` | 战斗内对话的真人头像一律退化到 `MINOR_FIGS` 兜底 |
| `blades.js` 道具销毁 | `if (window.Save) Save.write()` | 战大道具用后不落盘，重载后"复活" |

另修一处字段名错：`Sfx.tone` 查 `G.muted`，实际字段是 `G.settings.muted` —— 静音开关一直无效。

**规范**：跨脚本一律用裸名 + `typeof X !== 'undefined'` 判活。新增断言时要写**正向断言**（如"不得含未入册"），不要只查"非空"。

**环境坑**（都在 §4 的命令里处理了）：
- 本机 Git Bash 的 PATH 里没有 `/c/Program Files/Git/usr/bin`，`ls/head/grep` 全部 command not found。用 PowerShell 工具则输出为空，所以**必须走 Bash + 先 export PATH**。
- 仓库不含 `node_modules`，playwright 已装到 `/c/Users/LENOVO/.workbuddy/binaries/node/workspace/node_modules`（v1.63.0，浏览器缓存在 `~/AppData/Local/ms-playwright`，实测可直连）。
- PDF 导出依赖 pywin32，本机原先三个 python 都没有；已装进隔离 venv `/c/Users/LENOVO/.workbuddy/binaries/python/envs/default`（Word 已安装在 `C:\Program Files\Microsoft Office\root\Office16`）。

## 6. 剩余未完成（承接重点，按优先级）

| # | 任务 | 说明 |
|---|---|---|
| 1 | **主线 9 节的内容厚度** | 目前每节只有 `goal` + `hint` 两行文案，开战前只有一句通用台词（`Main.onQuest` 里的 `pick([...])`）。用户要"主线都是高难关卡"，机制已够，但**战前/战后的专属剧情文本还没写**——这是最值得投的下一块。承接位置：`quests.js MAIN[].goal/hint` 与 `main.js onQuest` 的 Dialog 脚本。 |
| 2 | 老档迁移真机实测 | `flags.legacyMigrated` 的逻辑只走了代码审查。需造一个"有 `G.ch>0`、无 `quests`"的旧存档灌进 localStorage，确认 toast 与解锁补齐都对。 |
| 3 | 支线数量与条件曲线 | 只有 7 条，集中在"好感≥N / 胜场≥10 / 已胜某人"三类。可加到 10-12 条，并引入互相前置（做完 A 才开 B）。数据位置：`quests.js SIDE`。 |
| 4 | 时段字段未删干净 | `G.periodIdx` 仍被 NPC 调度与画面氛围读取（每天随机轮换），只是门控语义移除了；`G.ap` / `chDef().days` 已成死字段，仅为老档兼容保留。彻底去时段化需一并改 `World.placement()`。 |
| 5 | 新手引导 | 目前只有 4 条自动 toast（`Main.prologue()`），没有交互式引导。 |
| 6 | 战斗断点续战 | 马刀原版功能，快照机制保留但未接入口。 |
| 7 | 难度平衡复核 | 极难档（×1.6、强制狂攻、击破不回血）叠加上主线 m9 的 `hpScale 1.6` 后未做胜率采样。`tests/battle/engine/test_duel.mjs` / `winrate4.mjs` 可作为起点。 |

## 7. 架构地图（已更新）

```
index.html      世界 HUD（含 #questcard 任务卡）+ #battle 覆盖层 + #modal-mask + 脚本顺序（敏感！）
build.py        单文件打包 → 实验史记·马刀行.html
smoke.mjs       Playwright 冒烟 56 项；截图入 testshots/
tests/quest_flow.mjs  剧情链路测试 30 项（择难度/章节映射/支线/点将/立传解耦/任务点错位）
css/style.css   玻璃风世界 UI + #questcard 任务卡样式 + #battle 战场
js/
  config.js     世界工具：$/$$/el/Spring/Sfx/toast/Save（世界存档 KEY='shiji_cqb_v1'，序列化整个 G）
  engine.js     世界状态机：syncChapter()（主线→章节）/syncWorldFlags()/eventsNow()（不再门控）
                /nextDay()（歇一日）/spendAP()（恒真）/riskCheck()/ACHIEVEMENTS + window.G
  world.js      World：Canvas/BFS/NPC 调度/主循环（BATTLE_ACTIVE 时暂停）+ 任务标记绘制（用 dpos）/点击/靠近
  dialog.js     Dialog：世界对话播放器
  writing.js    Writing：立传四槽（已与主线解耦，duelReady 恒真）
  ui.js         UI：HUD（令位=主线进度）/面板/图鉴/商店/成就/设置（含难度自选，已修好）
  quests.js     【任务系统】DIFFS 难度表 + MAIN 主线 9 节 + SIDE 支线 7 条 + CH_AFTER 章节映射
                + markers()/dpos 错位 + render() 指引卡 + pickAndStart 点将 + complete() 赏格结算
  main.js       Main：pickDifficulty/beginNewGame/onQuest/结算钩子（含 pendingCh 里程碑卡）
                /panelBlades/panelQuests/rest()/finale/锦标赛/试炼
  blades.js     Blades：registerChar 主角卡/grant 录技/buyUpgrade 修炼/grantRare/applyBoons
  battle-ui.js  SJI_UI 战斗覆盖层；文件尾自启动 boot()
  battle/       马刀风云移植（除标注处勿动）
    engine.js   SJI_ENGINE.Battle：DOM 无关可 Node 直测；9 种特则
                （马刀原版 dyad/uprising/chaos + 本作 cans/stench/yansuan/suomen/zhengshi/zhongshu）
    data.js     CHARACTERS 33 角色卡 / BOONS 增益 / STAGES 25 关
    config.js   难度表 AI 档位 规则常量；audio.js/save.js(key shiji_madao_v1)/scenes.js 台词卷
  data/         people(30+4)/scenes(12)/events(68)/volumes(15卷+17章CHAPTERS)/items(29)
tests/battle/   引擎测试 15 个（helpers/engine_env.mjs 在 Node 里 stub 全部依赖）
```

**两侧对接命脉（改世界层时必须保住）**
1. 开战：`SJI_UI.startBattle(cfg, onEnd)`；cfg 字段 `{mode:'story'|'survival', playerChar, enemies[], allies[], waves?, stage:{id,blocked,terrain,hpScale,restFull}, rule:{id,desc}, diff, aiAggr, trialId?, tournament?, questId?, title, introScene}`。
2. 结算回流：`window.SJI_BATTLE_HOOKS.onResult(b)` 返回结算 html（录技/发赏/成就/任务推进都在这里）；`onDone()` 恢复世界并消费 `Engine.takePendingChapter()`。
3. 引擎硬依赖 `window.SJI_UI` 的 `rpsRound/playerPhase/pickBoon/onBattleEnd/onLog/onState/snap/fx*/banner/showDialogue`。
4. `window.BATTLE_ACTIVE` 为 true 时 world 主循环与输入暂停。
5. 主角卡 `SJI_DATA.CHARACTERS.yinkesi` 由 `Blades.registerChar()` 合成；开战前 `Blades.applyBoons(battle)` 注入。
6. 特则通道 `cfg.rule={id,desc}`，引擎已实现 9 种。新增特则照此模式加，并配 `test_rules2.mjs` 断言。
7. 战斗覆盖层显隐必须**同时**切 `hidden` 与 `on` 两个类。

## 8. 接手自检清单（第一小时）

```bash
export PATH="/c/Program Files/Git/usr/bin:$PATH"
export NODE_PATH="/c/Users/LENOVO/.workbuddy/binaries/node/workspace/node_modules"
cd /d/code/shiji-madao-open

git log --oneline | head -5      # 应看到「剧情重构：任务驱动 + 难度自选 + 立传解耦」等提交
git status                        # 应干净

node tests/quest_flow.mjs                          # 30 项
node smoke.mjs                                     # 56 项
python build.py && node smoke.mjs "实验史记·马刀行.html"   # 成品 56 项
cd tests/battle/engine && node test_rules2.mjs && node stress.mjs
```

—— 战斗层、成长层、任务层、难度层都是**可跑的成品**，请大胆复用；剩余工作主要是**内容厚度**（主线剧情文本）与**平衡复核**，不是重写。祝顺利。
