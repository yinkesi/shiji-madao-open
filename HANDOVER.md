# 《实验史记·马刀行》交接报告

> 写于 2026-09-15，上一个 agent 因额度耗尽交接。接手前请完整读完本文。
> 项目：`D:\code\shiji-madao-open`（git 仓库，main 分支，最新提交 `1459271`）
> 桌面交付：`C:\Users\LENOVO\Desktop\实验史记·马刀行\`（单文件 HTML + 玩法说明 + 文档）

---

## 0. 一句话现状

游戏本体已完成并交付：春秋笔的开放世界壳 + 马刀风云战棋内核 + 刀谱/修炼/锦标赛/生存/六座特则试炼，42 项浏览器冒烟 + 15 个引擎 Node 测试全绿。**但用户对剧情架构不满意，要求完全重构**（见 §4，这是你的核心任务）。

## 1. 交接时刻我正在做什么（收尾状态）

我刚完成"高难试炼特则"并已提交（`1459271`）：六座试炼各配专属机制而非数值堆高，引擎新增 6 条 rule（cans/stench/yansuan/suomen/zhengshi/zhongshu），`test_rules2.mjs` 8 断言全 PASS，打包成品 42 项冒烟全 PASS，桌面已刷新。**工作树干净，无未提交改动。**

一个后台全量引擎回归当时还在跑，最后一次可见输出全部 ALL PASS（test_duel/test_bugfix/test_features/test_status/test_extreme/test_review/test_bugs2/test_bugs3/test_aiaggr/test_rules2）；stress 未等到结果，**接手后请补跑一次**：`node tests/battle/engine/stress.mjs`。

## 2. 用户最新需求（你的任务书，原话+解读）

用户原话（2026-09-15）：
> "我不是很喜欢春秋笔的剧情架构，给我完全重构剧情，要求和春秋笔的写法完全不一样，要自由的开放世界。在一个比较大的世界里，初始会进入主线，然后给任务指引。过程中满足特定的条件会进入支线人物，获得强力人物或者效果，主线都是高难关卡，还有我要求可以自己选难度。"

解读成规格（建议开工前用一条消息跟用户确认关键取舍，见 §4.4）：

1. **剧情架构完全重构**：废除春秋笔的「17 章 × 每天 4 时段 × 行动点」时间线结构，也把"立传拼史料"从主线门禁的位置上撤下来。要的是**任务驱动（quest-driven）的自由开放世界**，类"接主线任务 → 地图探索 → 支线触发"的现代 RPG 循环，而不是校园生活模拟。
2. **更大的世界**：现有 12 个场景不够。扩地图（新增区域），场景间自由通行，弱化/移除"时段门控"。
3. **主线 + 任务指引**：开局进入主线，要有清晰的任务引导 UI（当前任务/目标/去向提示），玩家跟着指引走。
4. **条件触发支线 → 奖励"强力人物或效果"**：支线不是现在的"看剧情拿史料"，而是有玩法奖励。**"强力人物"是歧义点**——两种解读：(a) 解锁"可出战角色"（马刀风云的点将出征回归，约战时可切换出战者）；(b) 招募同伴参战（友军槽）。建议 (a)，成本低（引擎天然支持 playerChar 任选， blades 的段位/修炼目前绑在 yinkesi 上需要泛化）。
5. **主线 = 高难关卡**：主线节点就是 Boss 级特则战，把刚做完的 6 条特则机制（§3.4）当模板复用/扩展。
6. **难度自选**：现在 `duelDiff()` 读 `SJI_SAVE.settings.lastDiff` 但**没有任何 UI 能改它**。需要：难度选择器（开局选 + 设置里可改 + 战前可确认），diff 影响奖励（高难高赏）。

## 3. 项目现状（做完的东西，别重做）

### 3.1 玩法清单
- **世界层**（春秋笔基座）：12 场景自由行走、BFS 寻路点击/WASD 双操作、NPC 按时段调度、63+5 个限时事件、交谈/赠礼/采访好感、撰史立传（起承转合+直笔曲笔）、行动点/声望/零花钱/文笔、巡查风险、图鉴/行囊/商店/成就/设置、终章 AI 读史结局。
- **战斗层**（马刀风云整体移植，7×7 战棋）：猜拳定行动点、买刀买马、刀击/马踢/血祭/技能、击破回血、以寡敌众补偿、4 档难度、4 档 AI、生存波次增益、33 角色卡。
- **融合层**（新写）：
  - `blades.js` 刀谱：主角音克思白板开局（无技）→ 首胜录对手之技 → 换技出战；段位 12 档（胜场→血上限/行动点加成）；修炼 7 项（零花钱买永久强化）；稀有刀卡 6 张（试炼首通授，常驻）。
  - 战前道具（护手霜/黑棒/玉米/水壶/陀螺择一携带，一次性）。
  - 成传战门禁（未胜传主不可立传——**重构后此耦合要解除**）、首战自动挂台词卷（SCENE_OF_CHAR）、终焉之战特战。
  - 刀禁期（卷十二起课上约战 25% 被钦法查）。
  - 协会：锦标赛三连胜（waves）/破败城墙生存/**六座高难试炼（各有特则，首通授稀有刀卡）**。

### 3.2 架构地图（文件 → 职责 → 关键全局名）

```
index.html            世界 HUD + #battle 战斗覆盖层 + #modal-mask 战斗弹层 + 脚本加载顺序（顺序敏感！）
build.py              单文件打包（正则内联所有 script/link，输出 实验史记·马刀行.html）
smoke.mjs             Playwright 冒烟 42 项；node smoke.mjs [目标html]，源码/成品双跑；截图入 testshots/
css/style.css         玻璃风世界 UI + #battle 战场样式
js/
  config.js           世界工具：$/$$/el/Spring/Sfx/toast/Save（世界存档 KEY='shiji_cqb_v1'，序列化整个 G）
  engine.js           世界状态机 Engine + newGameState() + ACHIEVEMENTS 表 + window.G
  world.js            World：Canvas/BFS 寻路/NPC 调度 placement()/主循环（BATTLE_ACTIVE 时暂停）
  dialog.js           Dialog：世界对话播放器（choice/favor/rep/wen/mg 步骤）
  writing.js          Writing：立传四槽（重构时此系统降级或移除）
  ui.js               UI：HUD/面板/图鉴/商店/成就/设置；updateHUD 里有刀谱章
  main.js             Main：流程编排、challenge() 约战、SJI_BATTLE_HOOKS.onResult 结算钩子、
                      TRIALS 表、startTournament/startSurvival/startTrial、panelBlades/panelTrial、终章
  blades.js           Blades：registerChar 合成主角卡 / grant 录技 / buyUpgrade 修炼 / grantRare / applyBoons
  battle-ui.js        SJI_UI（战斗覆盖层）：startBattle(cfg)/渲染/HUD/猜拳/对话/结算；文件尾自启动 boot()
  battle/             ---- 马刀风云移植（除下述两处，别动）----
    engine.js         SJI_ENGINE.Battle：DOM 无关可 Node 直测；特则 rule 分支在 run()/_endRound()/doHorse()
                      已扩展处：yinkesi 通用技能执行器 _execLearned()
    data.js           SJI_DATA：CHARACTERS 33 角色卡 / BOONS 增益 / STAGES 25 关（台词与地形素材库）
    config.js         SJI_CONFIG：难度表/AI 档位/规则常量
    audio.js / save.js / scenes.js    SJI_AUDIO / SJI_SAVE(key='shiji_madao_v1') / SJI_SCENES 台词卷
  data/               people(30+4) / scenes(12) / events(68) / volumes(15卷+17章CHAPTERS) / items(29)
tests/battle/         引擎测试 15 个（helpers/engine_env.mjs 在 Node 里 stub 全部依赖）
```

### 3.3 两侧对接的命脉（重构世界层时必须保住的接口）
1. 世界侧开战：`SJI_UI.startBattle(cfg, onEnd)`；cfg 关键字段 `{mode:'story'|'survival', playerChar, enemies[], allies[], waves?, stage:{id,blocked,terrain,hpScale,restFull}, rule:{id,desc}, diff, aiAggr, trialId?, tournament?, title, introScene}`。
2. 战斗结算回流：`window.SJI_BATTLE_HOOKS.onResult(b)` 返回结算 html（奖励/录技/成就都在这里）；`onDone()` 恢复世界。
3. 战斗引擎钩子：`window.SJI_UI` 必须实现 `rpsRound/playerPhase/pickBoon/onBattleEnd/onLog/onState/snap/fx*/banner/showDialogue`（engine 硬依赖）。
4. `window.BATTLE_ACTIVE` 置 true 时 world.js 主循环与输入暂停。
5. 主角卡：`SJI_DATA.CHARACTERS.yinkesi` 由 `Blades.registerChar()` 合成注册，开战前 `Blades.applyBoons(battle)` 注入段位/修炼/稀有卡/道具增益。
6. 特则通道：`cfg.rule = {id, desc}`，引擎已实现 9 种 id：`dyad/uprising/chaos`（马刀原版）+ `cans/stench/yansuan/suomen/zhengshi/zhongshu`（本作新增）。新增特则照此模式加。

### 3.4 六条特则（主线高难关卡的机制素材库）
| id | 名 | 效果 |
|---|---|---|
| cans | 看台飞瓶 | 回合开始与敌人同行/同列者损 1 血 |
| stench | 鲍鱼之肆 | 回合结束相邻敌我互蚀各 1 血 |
| yansuan | 验算 | 回合末 wonder 血量为偶则回 1 血 |
| suomen | 锁门 | 双方马踢不可用 |
| zhengshi | 争食 | 场上三份饭，回合末站上者回 2 血各一次 |
| zhongshu | 种树不绝 | 崇国每回合自动种树（≤3） |
另有马刀原版 `dyad`（相邻敌伤+1）/`uprising`（第3回合援军）/`chaos`（20% 打错人）。

### 3.5 已知坑（都是踩过的，别再踩）
- **`const` 顶层全局不挂 window**：跨脚本访问 `World/Main/Blades/Writing/Dialog/PEOPLE_BY_ID` 用裸名或 `typeof X !== 'undefined'`，别写 `window.Xxx`（smoke 的 evaluate 同理）。
- 战斗覆盖层显隐必须同时切 `hidden` 和 `on` 两个类（showOverlay/hideOverlay 已处理好，别改坏）。
- 世界存档 `Save.write()` 序列化整个 G：给 G 加字段必须同时改 `newGameState()` **和** `Main.normalizeG()`（老档兼容）。
- 马刀引擎的 sleep 依赖 `window.SJI.settings.speed`；`window.SJI`/`SJI_DEBUG` 定义在 battle-ui.js 尾部，battle-ui 的 boot 靠 DOMContentLoaded 自启动。
- 引擎测试环境：`tests/battle/helpers/engine_env.mjs` require 路径是 `../../../js/battle/*.js`；给引擎加功能先写 Node 测试（单回合驱动模式参考 test_rules2.mjs 的 `oneRound()`+`st.skip` 锁敌技巧）。
- smoke 的战斗驱动：`SJI_DEBUG.autoRps=true` 自动猜拳；战场内对话用空格推进；杀敌 `SJI_DEBUG.killEnemies()`；生存模式波间要点 `.boon-b`；等 `#modal-mask` 熄灭再点结算按钮。
- 约战 80 距离外语义是"先走过去"，自动化要轮询调用直到 Dialog.active。
- D:\code\package.json 是 ESM，但本项目脚本是普通 script 标签；Node 测试用 .mjs + createRequire。

## 4. 剧情重构方案（建议稿，供你执行或与用户讨论后修订）

### 4.1 保留（不要动）
战斗层全部、blades 刀谱/修炼/稀有卡、试炼与特则系统、锦标赛/生存、battle-ui 覆盖层、对话播放器 Dialog、UI 面板框架、图鉴/商店/成就、build/smoke 工程链、所有人物与台词资产（people.js/battle/data.js/SJI_SCENES/events 里的文案）。

### 4.2 替换/移除（春秋笔骨架）
- 移除：`CHAPTERS` 17 章×天×时段（engine.js 的时间机、world.js placement 的时段调度、UI 的日期 HUD、main.js 的章节卡/enterPeriod/sleep）、`Writing` 立传门禁作为主线的地位、`events.js` 的 `ch/day/periods` 限时结构、刀禁期的"章节触发"。
- 改造：`volumes.js` 15 卷 → 主线任务链的任务定义；行动点系统移除或改为"体力"类轻资源。

### 4.3 新结构（建议）
- **世界**：把 scenes.js 扩到 ~18-20 个区域（新增：教学区、后山、家属院、二中大门、烧烤摊夜市、协会营地、旧库房等），大门互通，无时段门控（NPC 改按"主线进度+固定据点"放置，placement 简化）。
- **主线任务链**：以"马刀兴亡史"为脊柱（原著卷八天然是一条故事线）：执刀入门 → 操场三国刀 → 协会成立 → 七班刀合流 → 锦标赛扬名 → 刀禁令风波 → 终焉之战 → 马刀的结局。每节 = 一个主线任务 `{id, name, goal, hint, where, unlock(), done()}`，任务是**高难关卡**（复用 TRIALS 的特则 cfg 模板，重新组 7-8 关主线 Boss 战，难度高于普通对决）。
- **任务指引 UI**：HUD 或左侧加"当前任务"卡（任务名+目标+地点直达按钮）；`Quests.current()` 驱动；完成后 toast + 发奖 + 解锁下一节。
- **支线人物**：条件触发的支线（如好感≥X、持有某道具、胜场≥Y、去过某地），完成支线**解锁强力角色或效果**：建议 (a) 解锁"可出战角色"（约战/任务出战时选人，madao 的点将出征；段位/修炼泛化到"队伍"或按角色各自成长——最省的做法：解锁的角色使用其原版战斗卡原样出战，主角音克思保留刀谱成长）；(b) 也可以给"助战友军槽"。**先问用户选哪种**。
- **难度自选**：开局三档+设置可改+战前显示；diff 映射 SJI_CONFIG.DIFFICULTY，高难提高赏金与稀有掉落。
- **存档迁移**：老档字段直接 normalizeG 兜底即可（项目惯例）。

### 4.4 开工前建议向用户确认（一条消息搞定）
1. "强力人物"= 可出战角色（点将出征）还是参战同伴？
2. 立传/撰史系统：彻底删除，还是降级为一条支线玩法保留？
3. 世界规模预期：在现有 12 景上扩到 ~18 个是否够？

## 5. 验证与交付流程（照旧执行）

1. 引擎改动：`node tests/battle/engine/test_*.mjs`（新功能配新测试）；全量回归至少跑 test_duel/test_bugfix/test_features/test_rules2/stress。
2. 全链路：`node smoke.mjs`（源码）与 `node smoke.mjs "实验史记·马刀行.html"`（成品）双跑；重构后 smoke 的世界层断言（章节/立传相关）需要按新架构重写。
3. 打包：`python build.py`；桌面刷新：`cp 实验史记·马刀行.html 实验史记·马刀行-玩法说明.txt README.md 技术报告.md 技术报告.docx 技术报告.pdf /c/Users/LENOVO/Desktop/实验史记·马刀行/`。
4. 文档：README/玩法说明/技术报告三件套随版本更新；技术报告沿用 md→docx→pdf：`NODE_PATH=$(npm root -g) node md2docx.cjs 技术报告.md 技术报告.docx && python export_pdf.py 技术报告.docx 技术报告.pdf`。
5. git：小步提交，message 用中文写清里程碑（现有 5 个提交可作格式参考）。
6. 推 GitHub：用户未指示；需要时走 API + 本地代理 127.0.0.1:7890（参考 shiji-madao 的 push_via_api.py）。

## 6. 快速自检清单（接手第一小时）

```bash
cd /d/code/shiji-madao-open
git log --oneline | head -5          # 应见 5 个提交，HEAD=1459271
git status                            # 应干净
node tests/battle/engine/test_rules2.mjs          # 特则 8 断言
node tests/battle/engine/stress.mjs               # 补跑后台没等到的
node smoke.mjs                        # 42 项
python build.py && node smoke.mjs "实验史记·马刀行.html"
```
然后开浏览器双击 index.html 人工过一遍：新档白板→约战→胜→刀谱→修炼→操场三入口→试炼面板。

——交接完。战斗层与成长层是成品，请大胆复用；世界层按 §4 重构，小的改动多提交，祝顺利。
