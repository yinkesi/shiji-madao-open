# 《实验史记·马刀行》交接报告

> 写于 2026-09-15。上一个 agent 额度将尽，交接给下一个 agent。
> 项目：`D:\code\shiji-madao-open`（git 单仓，main 分支，HEAD `4dceb5f`，工作树干净）
> 桌面成品：`C:\Users\LENOVO\Desktop\实验史记·马刀行\`（单文件 HTML + 玩法说明 + 文档三件套）
> **接手第一件事：读本文 §4「用户新需求」与 §5「未完成清单」，然后按 §7 自检。**

---

## 1. 一句话现状

游戏本体**已成品、可玩、测试全绿**（春秋笔开放世界壳 + 马刀风云战棋内核 + 刀谱/修炼/锦标赛/生存/六座特则试炼；42 项浏览器冒烟 + 15 个引擎 Node 测试全 PASS）。
**但用户对剧情架构不满意，要求完全重构**（§4）。我已完成重构的**基础部分并实测跑通**（难度自选 + 任务系统骨架，见 §3.6），**剩余工作见 §5**。

## 2. 本 agent 最后时刻在做什么

1. 完成并提交「高难试炼特则」：六座试炼各配专属机制（非数值堆高），引擎新增 6 条 rule，`test_rules2.mjs` 8 断言全 PASS（提交 `1459271`）。
2. 写完交接报告（提交 `2d177c7`）。
3. 用户随后要求"继续"，我判断应把新需求落成**可运行的基础**而非只留计划，于是实现了 §3.6（提交 `4dceb5f`，标注 WIP），**实测通过**：
   - 新档 → 任务指引卡显示「主线 · 初执马刀」→ 世界出现「令」标记 → 开战 → 胜利 → 发赏（×难度）→ 自动推进到 m2 → 卡片刷新。
   - 过程中抓到并修掉一个真 bug：`Quests.complete()` 里裸调 `render()`（应为 `this.render()`），导致任务完成后指引卡不刷新（页面报 `render is not defined`）。
4. 全量引擎回归（含 stress）与 42 项冒烟在此之后重跑，**仍全 PASS**；打包已重新生成。

## 3. 项目现状（已完成的东西，别重做）

### 3.1 玩法清单
- **世界层**（春秋笔基座）：12 场景自由行走、BFS 寻路 + WASD/点击双操作、NPC 按时段调度、63+5 个限时事件、交谈/赠礼/采访好感、撰史立传、行动点/声望/零花钱/文笔、巡查风险、图鉴/行囊/商店/成就/设置、终章 AI 读史。
- **战斗层**（马刀风云整体移植，7×7 战棋）：猜拳定行动点、买刀买马、刀击/马踢/血祭/技能、击破回血、以寡敌众补偿、4 档难度、4 档 AI、生存波次增益、33 角色卡、25 关台词/地形素材。
- **融合层**：刀谱（白板开局→录技→换技）、段位 12 档、修炼 7 项（零花钱买永久强化）、稀有刀卡 6 张、战前道具、成传战门禁、首战自动挂台词卷、终焉之战、刀禁期、协会锦标赛/生存/六座特则试炼。

### 3.2 架构地图（文件 → 职责）

```
index.html      世界 HUD（含 #questcard 任务卡）+ #battle 战斗覆盖层 + #modal-mask + 脚本顺序（敏感！）
build.py        单文件打包 → 实验史记·马刀行.html
smoke.mjs       Playwright 冒烟 42 项：node smoke.mjs [目标html]；截图入 testshots/
css/style.css   玻璃风世界 UI + #battle 战场 + #questcard 任务卡样式
js/
  config.js     世界工具：$/$$/el/Spring/Sfx/toast/Save（世界存档 KEY='shiji_cqb_v1'，序列化整个 G）
  engine.js     世界状态机 Engine + newGameState() + ACHIEVEMENTS + window.G
  world.js      World：Canvas/BFS/NPC 调度/主循环（BATTLE_ACTIVE 时暂停）+ 任务标记绘制/点击/靠近检测
  dialog.js     Dialog：世界对话播放器（choice/favor/rep/wen/mg 步骤）
  writing.js    Writing：立传四槽（重构中待降级）
  ui.js         UI：HUD/面板/图鉴/商店/成就/设置（设置里已有难度选择器）
  main.js       Main：流程编排、challenge 约战、SJI_BATTLE_HOOKS.onResult 结算、TRIALS 试炼表、
                startTournament/startSurvival/startTrial、panelBlades/panelTrial/panelQuests、onQuest、终章
  quests.js     【新】Quests：DIFFS 难度表 + 主线 9 节 + 支线 7 条 + 指引卡渲染 + 点将出征 + 赏格结算
  blades.js     Blades：registerChar 主角卡/grant 录技/buyUpgrade 修炼/grantRare/applyBoons
  battle-ui.js  SJI_UI 战斗覆盖层：startBattle(cfg)/渲染/HUD/猜拳/对话/结算；文件尾自启动 boot()
  battle/       马刀风云移植（除标注处勿动）
    engine.js   SJI_ENGINE.Battle：DOM 无关可 Node 直测；特则分支在 run()/_endRound()/doHorse()；
                已扩展：yinkesi 通用技能执行器 _execLearned()
    data.js     CHARACTERS 33 角色卡 / BOONS 增益 / STAGES 25 关
    config.js   难度表 AI 档位 规则常量；audio.js/save.js(key shiji_madao_v1)/scenes.js 台词卷
  data/         people(30+4)/scenes(12)/events(68)/volumes(15卷+17章CHAPTERS)/items(29)
tests/battle/   引擎测试 15 个（helpers/engine_env.mjs 在 Node 里 stub 全部依赖）
```

### 3.3 两侧对接命脉（改世界层时必须保住）
1. 开战：`SJI_UI.startBattle(cfg, onEnd)`；cfg 字段 `{mode:'story'|'survival', playerChar, enemies[], allies[], waves?, stage:{id,blocked,terrain,hpScale,restFull}, rule:{id,desc}, diff, aiAggr, trialId?, tournament?, questId?, title, introScene}`。
2. 结算回流：`window.SJI_BATTLE_HOOKS.onResult(b)` 返回结算 html（录技/发赏/成就/任务推进都在这里）；`onDone()` 恢复世界。
3. 引擎硬依赖 `window.SJI_UI` 的 `rpsRound/playerPhase/pickBoon/onBattleEnd/onLog/onState/snap/fx*/banner/showDialogue`。
4. `window.BATTLE_ACTIVE` 为 true 时 world 主循环与输入暂停。
5. 主角卡 `SJI_DATA.CHARACTERS.yinkesi` 由 `Blades.registerChar()` 合成；开战前 `Blades.applyBoons(battle)` 注入（音克思享段位+修炼，全名册共享稀有卡+道具）。
6. 特则通道 `cfg.rule={id,desc}`，引擎已实现 9 种：马刀原版 `dyad/uprising/chaos` + 本作 `cans/stench/yansuan/suomen/zhengshi/zhongshu`。新增特则照此模式加。

### 3.4 六条特则（主线高难关卡的机制素材库）
| id | 名 | 效果 |
|---|---|---|
| cans | 看台飞瓶 | 回合开始与敌人同行/同列者损 1 血 |
| stench | 鲍鱼之肆 | 回合结束相邻敌我互蚀各 1 血 |
| yansuan | 验算 | 回合末 wonder 血量为偶则回 1 血 |
| suomen | 锁门 | 双方马踢不可用 |
| zhengshi | 争食 | 场上三份饭，回合末站上者回 2 血各一次 |
| zhongshu | 种树不绝 | 崇国每回合自动种树（≤3） |

### 3.5 已知坑（全是踩过的）
- **`const` 顶层全局不挂 window**：跨脚本访问 `World/Main/Blades/Quests/Writing/Dialog/PEOPLE_BY_ID` 用裸名或 `typeof X !== 'undefined'` 判活，**别写 `window.Xxx`**（我在这上面栽过两次：一次门禁恒锁，一次任务标记静默失效）。smoke 的 `page.evaluate` 里同理用裸名。
- `Quests` 的方法内部调自身方法要写 `this.xxx()`（曾裸调 `render()` 报 not defined）。
- 战斗覆盖层显隐必须**同时**切 `hidden` 与 `on` 两个类。
- 世界存档序列化整个 G：给 G 加字段必须同时改 `newGameState()` **和** `Main.normalizeG()`（老档兼容）。
- 引擎 sleep 依赖 `window.SJI.settings.speed`；`window.SJI`/`SJI_DEBUG` 定义在 battle-ui.js 尾部。
- 引擎测试 require 路径为 `../../../js/battle/*.js`；给引擎加功能先写 Node 测试（单回合驱动套路见 `test_rules2.mjs` 的 `oneRound()` + `st.skip=9` 锁敌）。
- smoke 战斗驱动：`SJI_DEBUG.autoRps=true` 自动猜拳；战场内对话按空格推进；`SJI_DEBUG.killEnemies()` 秒杀；生存模式波间要点 `.boon-b`；等 `#modal-mask` 熄灭再点结算按钮；约战 80 距离外语义是"先走过去"，需轮询调用直到 `Dialog.active`。

### 3.6 【WIP，已提交 4dceb5f，实测可用】剧情重构基础
- `js/quests.js`：`DIFFS` 难度 4 档（mul 0.8/1.0/1.3/1.6）；`MAIN` 主线 9 节（初执马刀 → 三异能者 → 三国刀 → 协会锦标赛 → 七班刀合流 → 刀禁令 → 马刀之神 → 终焉之战 → 马刀的结局，每节皆高难关，复用 `rule` 特则、`waves`、`hpScale`）；`SIDE` 支线 7 条（条件=好感/胜场/已达成的战斗记录，完成→解锁强力人物或稀有刀卡）。
- 指引 UI：HUD `#questcard`（当前主线 + 目标 + 提示 + 可接支线 + 「前往」直达[传送+自动走位]）；世界地图绘制「令/刀」任务气泡，可点击、可靠近出交互条。
- 出战名册 `G.roster`：支线解锁强力人物 → 点将出征面板（`pickAndStart`）；音克思享段位+修炼，他人以本卡出战并共享稀有卡与道具。
- 赏格随难度放大（实测极难 ×1.6 生效）；完成任务成就 `ach_quest`。
- **实测链路**：新档 → 卡片「主线·初执马刀」→ 世界「令」标记 → 开战(diff=extreme, questId=m1) → 胜 → 发赏 28 → 解锁 m2 → 卡片自动刷新为「实验三异能者」。

## 4. 用户新需求（任务书，原话 + 规格）

原话：
> "我不是很喜欢春秋笔的剧情架构，给我完全重构剧情，要求和春秋笔的写法完全不一样，要自由的开放世界。在一个比较大的世界里，初始会进入主线，然后给任务指引。过程中满足特定的条件会进入支线人物，获得强力人物或者效果，主线都是高难关卡，还有我要求可以自己选难度。"

规格化：
1. **剧情架构完全重构**：废除「17 章 × 每天 4 时段 × 行动点」时间线；立传/撰史从主线门禁位置撤下（降级为可选支线或移除）。改为**任务驱动的自由开放世界**。
2. **更大的世界**：现 12 场景要扩（建议 ~18-20 个区域），弱化/移除时段门控，自由通行。
3. **主线 + 任务指引**：开局即主线，清晰指引（§3.6 已给基础）。
4. **条件支线 → 强力人物/效果**：已完成基础（§3.6）；"强力人物"取"可出战角色"（点将出征）路线。
5. **主线皆高难关卡**：复用特则机制（§3.4）做 Boss 战（§3.6 的 MAIN 已是此形态）。
6. **难度自选**：已完成（设置面板 + `DIFFS` + 赏格联动）。

**开工前建议向用户确认**：① 立传系统彻底删除还是降级保留为支线？② 世界扩到 ~18 个区域是否够（还是想要更大）？③ 主线 9 节是否需要更长/更短。

## 5. 未完成清单（承接重点，按优先级）

| # | 任务 | 说明 |
|---|---|---|
| 1 | 开局难度入口 | `#btn-new` 目前仍是直接开新档（我最后一步的编辑因文件被 python 改写而失败）。需在开新档前弹 `DIFFS` 选择面板（`UI.openPanel` + `SJI_SAVE.setSetting('lastDiff',v)`）。设置面板里的难度选择器**已可用**。 |
| 2 | 支线解锁与点将实测 | `SIDE` 的 `cond()`、`unlockFighter`、`pickAndStart` 均已编码但**未端到端实测**（需造好感/胜场条件后打过支线，确认人物入册并可选出战）。 |
| 3 | 移除时段门控 + 扩图 | 世界层仍是 17 章×4 时段；需简化 `Engine` 时间机、`World.placement()` 改为"据点+进度"放置、`scenes.js` 扩区域。这是本次重构的**最大块**。 |
| 4 | 立传降级/移除 | `Writing` 与 `volumes.js` 的 `duel` 门禁目前仍与主线耦合，按用户确认结果处理。 |
| 5 | 任务点冲突 | 同场景多任务点重叠（如 m1 与 s_win30 都在操场 750,450）时 `nearMarker` 只取最近一个，需做去重/错位。 |
| 6 | smoke 覆盖任务与难度 | 目前 smoke 42 项**未包含**任务系统与难度选择，需补 5-8 项（参考 §3.6 实测脚本的思路）。 |
| 7 | 文档与交付刷新 | README/玩法说明/技术报告三件套仍是旧版（无任务/难度章节）；打包成品需重跑；桌面需刷新。 |
| 8 | 老档迁移说明 | `normalizeG()` 已补 `quests/roster`，但老档玩家会直接落在"主线首节"，需确认体验。 |

## 6. 验证与交付流程

1. 引擎改动：`node tests/battle/engine/test_*.mjs`（新功能配新测试）；回归至少跑 `test_duel/test_bugfix/test_features/test_rules2/test_status/stress`。
2. 全链路：`node smoke.mjs`（源码）与 `node smoke.mjs "实验史记·马刀行.html"`（成品）**双跑**。
3. 打包：`python build.py`；桌面刷新：
   `cp 实验史记·马刀行.html 实验史记·马刀行-玩法说明.txt README.md 技术报告.md 技术报告.docx 技术报告.pdf /c/Users/LENOVO/Desktop/实验史记·马刀行/`
4. 文档：`NODE_PATH=$(npm root -g) node md2docx.cjs 技术报告.md 技术报告.docx && python export_pdf.py 技术报告.docx 技术报告.pdf`
5. git：小步提交，中文 message 写清里程碑（现有 7 个提交可作格式参考）。推 GitHub 用户未指示；需要时走 API + 本地代理 `127.0.0.1:7890`。

## 7. 接手自检清单（第一小时）

```bash
cd /d/code/shiji-madao-open
git log --oneline | head -3        # HEAD 应为 4dceb5f（WIP 剧情重构基础）
git status                          # 应干净
node tests/battle/engine/test_rules2.mjs   # 特则 8 断言
node tests/battle/engine/stress.mjs        # 压测
node smoke.mjs                              # 42 项
python build.py && node smoke.mjs "实验史记·马刀行.html"
```
浏览器人工过一遍：双击 `index.html` → 新档 → 看左上「令」标记与右侧任务卡 → 点「前往」→ 开战 → 胜利后确认卡片推进到「实验三异能者」→ 系统·设置里改难度为极难 → 再打一场确认敌方变强、赏格变大。

—— 战斗层、成长层、任务/难度基础都是**可跑的成品**，请大胆复用；世界层按 §4/§5 重构，小步提交。祝顺利。
