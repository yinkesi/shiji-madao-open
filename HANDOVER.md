# 《实验史记·马刀行》交接报告

> 更新于 2026-09-15（第三棒）。前两棒见 git：`3e8133b`（初交接）、`80f5e55`/`0d47432`（剧情重构）。
> 项目：`D:\code\shiji-madao-open`（git 单仓，main 分支，工作树干净，HEAD `fdfe81d`）
> 桌面成品：`C:\Users\LENOVO\Desktop\实验史记·马刀行\`
> **接手第一件事：读 §3「这一棒修了什么」与 §5「剩余未完成」，再按 §6 自检。**

---

## 1. 一句话现状

剧情重构（任务驱动 + 难度自选 + 时间线解耦 + 立传降级）已完成并全绿；本棒把**剧情文本层**（283→4813 字）、**三个移动 bug**、**两个平衡级静默 bug** 一并修掉，并把**对话/面板回调链**做了健壮化。

测试全绿：**剧情链路 50 项、smoke 61 项（源码版与成品单文件版双跑）、引擎特则 6 则、引擎修复验证，均 PASS，无页面错误。**

## 2. 用户已拍板的三个决定（不要再问）

| 问题 | 决定 |
|---|---|
| 立传/撰史系统 | **降级为可选支线**（门禁已撤，玩法与文案全保留） |
| 世界规模 | **就 12 个场景，不扩图**，力气放任务与战斗 |
| 主线长度 | **保持 9 节** |

## 3. 这一棒修了什么（全部有测试/实测）

### 3.1 移动三 bug（用户实测报的，已全部复现并修复）

| 用户原话 | 根因 | 修复 | 位置 |
|---|---|---|---|
| 到了走廊就不能动了 | **默认落点踩进道具碰撞盒**，落地即被 `collides` 四向锁死。共 4 个场景踩中：走廊长椅(600,380)、食堂圆桌(490,500)、宿舍柜(420,560)、办公楼档案柜(400,500)。此前测试只走门口/传送，从没在默认落点停过，所以一直没抓到 | 新增 `World.freeSpot()`（落点就近避让到最近的空位），`enterScene` 统一走它 | `js/world.js` |
| 不由自主往下走 | 任务气泡命中区 46px，**抢走了附近地面的点击**，把人拉向标记 | 收紧到只认气泡与名牌本身（30px） | `js/world.js` |
| 进入操场会有大 bug | 未单独复现——操场落点无碰撞、静止不漂移、移动正常。判断与前两个同源（落点/命中区），修完那两条后未再报 | — | — |

### 3.2 剧情文本层（上一棒欠的「完全重构剧情」）

- 主线 9 节 + 支线 7 条全部补 **`pre`（战前）/ `post`（战胜）/ `postLose`（战败）/ `foe`（对手随机挑衅池）**，从 283 字扩到 **4813 字**。每节对手台词都是专属（人名、号、被动、特则都对得上），无一句通用兜底（有断言守）。
- 播放链路：`Main.onQuest` 战前播 `pre`；`Quests.complete` 挂起 `post`；`SJI_BATTLE_HOOKS.onDone` 回世界后先弹章节里程碑卡、再播战后一幕（两者成对消费，不串场）。

### 3.3 两个平衡级静默 bug（最要紧，都是"不报错、只失效"）

1. **hpScale / restFull 放错位置**：`quests.js` 把这两个战场参数写在 `cfg` 顶层，但引擎只从 `cfg.stage` 读（`engine.js:108,1230`）。于是**主线/支线 11 处的血量缩放与阵间回血全部静默失效**——m4 本应敌人变弱却没变（打不过）、m7/m9 本应更难却没变（偏易）。修复：`Quests.start()` 把它们归位进 `cfg.stage`。
2. **支线 s_win30 奖励不兑现**：奖励写 `rare:'b_horse'`，但 `RARE_BOONS` 里没有 `b_horse` 条目（`b_horse` 只在 `BOONS` 里是普通增益）。打完什么都不给，还不报错。修复：补 `RARE_BOONS.b_horse`「马踏连营」。

### 3.4 回调链健壮化（一类隐患的根修）

`Dialog.finish()` / `SheetFX.close()` 的收尾回调原来**赌弹簧动画一定跑完**；一旦动画链异常，回调就丢，表现为"对话/面板卡住、后续流程（开战/战后一幕）永不触发"。这正是 smoke 偶发"未开战/点将面板不出"的根源。修复：

- 两处的收尾都改成 **幂等 cleanup + 320ms 超时兜底**——弹簧只负责视觉滑出，回调保证执行；
- `Spring.tick` 加 `try/catch`，**单个弹簧回调出错不再拖垮整条动画链**。

### 3.5 难度平衡采样

新增 `tests/battle/engine/mainquest_winrate.mjs`：主线 9 节 × 4 难度 × 每格 N 场的胜率表（玩家模型按"到该节时大致有多强"分档）。**发现 m2/m3/m4 在多档难度 0% 胜率（greedyBot 视角）**，见 §5。

## 4. 这一棒踩到的坑（别再踩）

1. **`const` 顶层声明不挂 `window`**——延续上一棒的坑，本棒又补 1 处（静音读 `G.muted` 应为 `G.settings.muted`）。规范照旧：跨脚本一律裸名 + `typeof X !== 'undefined'` 判活。
2. **测试别信"固定 sleep"**：对话结束的回调挂在弹簧动画里，等 700ms 是临界值，时好时坏。一律用 `waitFor` 轮询页面状态，别用魔法数字 sleep（`smoke.mjs` / `quest_flow.mjs` 里已统一）。
3. **断言要写正向断言**：`textContent.length > 0` 会被兜底值（如"未入册"）蒙混过关；要断"**不得含某词**"或"**必须含专属词**"。
4. **面板标题关面板后不清空**：`#panel-title` 保留上一次的标题。判"面板是否开着"必须连 `#panel` 的 `hidden` 类一起看，不能只看标题。
5. **环境**（跑测试前必做）：
   ```bash
   export PATH="/c/Program Files/Git/usr/bin:$PATH"        # 否则 ls/grep 全 command not found
   export NODE_PATH="/c/Users/LENOVO/.workbuddy/binaries/node/workspace/node_modules"   # playwright 装这
   ```
   PowerShell 工具在本机返回空输出，一律走 Bash。

## 5. 剩余未完成（承接重点，按优先级）

| # | 任务 | 现状 / 承接点 |
|---|---|---|
| 1 | **「获得一个角色的技能 = 获得全部技能（主动+被动）」**（用户明确要的，本棒因修移动 bug 未开工） | **关键事实**：引擎里**被动是 44 处 `charId ===` 硬编码**（`js/battle/engine.js`），角色卡上的 `passive` 对象只是展示文案。所以"音克思获得被动"不能靠克隆 passive 对象。**两条可行路**：①（推荐，小改动）引擎加一个 `passiveOwner(u)`——音克思装备某卡时，把 44 处 `charId` 检查的主角卡换成"装备卡的出处"，让被动对装备者生效；②（大重构，风险高）把 44 处硬编码被动改成数据驱动执行器。另外：**点将出征已经能以该角色全技能（主动+被动）出战**，若用户接受"点将即全套"，此条需求其实已部分满足——需先跟用户确认到底要"音克思本人继承"还是"可点将全套"即可。 |
| 2 | **m2 / m3 / m4 在多档难度 0% 胜率** | `mainquest_winrate.mjs` 测出（greedyBot 视角）：m2 三连战无阵间回血、m3 小川缴械+鲁豪刀伤翻倍+dyad 相邻加伤，对 bot 是 0%。但 bot 水平有限，**需人工或换更强 bot 复核**后再调（降 waves、加 restFull、降 dyad 或削鲁豪 knifeMul）。hpScale 归位后 m4 已变易，需重测。 |
| 3 | 技术报告/README 未随本棒更新 | 本棒动了 `world/dialog/config/quests/blades/main`，`技术报告.md` 的 §2.3/§4/§5 还是上一棒的。刷新后照 §6 重新生成 docx/pdf。 |
| 4 | 老档迁移只过了 quest_flow 的合成旧档测试 | 建议拿一个真实玩出来的旧档（`shiji_cqb_v1`）再人工过一遍。 |
| 5 | 「进操场大 bug」未单独复现 | 修完落点/命中区后未再复现，建议用户实测确认；若仍在，先抓 `#dialog`/`#chapter-card`/`#modal-mask` 是否残留遮挡。 |

## 6. 接手自检（第一小时）

```bash
export PATH="/c/Program Files/Git/usr/bin:$PATH"
export NODE_PATH="/c/Users/LENOVO/.workbuddy/binaries/node/workspace/node_modules"
cd /d/code/shiji-madao-open

git log --oneline | head -5      # 应见 fdfe81d（本棒）80f5e55/0d47432（剧情重构）
git status                        # 应干净

node tests/quest_flow.mjs                          # 剧情链路 50 项
node smoke.mjs                                     # 冒烟 61 项
python build.py && node smoke.mjs "实验史记·马刀行.html"   # 成品 61 项
cd tests/battle/engine && node test_rules2.mjs && node mainquest_winrate.mjs 16

# 文档（docx 用全局 docx 包；pdf 走 Word + pywin32）
NODE_PATH=/c/Users/LENOVO/AppData/Roaming/npm/node_modules node md2docx.cjs 技术报告.md 技术报告.docx
/c/Users/LENOVO/.workbuddy/binaries/python/envs/default/Scripts/python.exe export_pdf.py 技术报告.docx 技术报告.pdf
```

人工过一遍：双击 `index.html` → 开卷选难度 → 操场跟「令」打 m1 → 看完战前/战后对话 → 去走廊点「前往」确认**不再卡死** → 点任务气泡**附近**的地面确认**不再被拉走**。

## 7. 架构要点速查

- **任务数据**全在 `js/quests.js`（`DIFFS` 难度表 / `MAIN` 主线9节 / `SIDE` 支线7条 / `CH_AFTER` 章节映射）。主线每节含 `pre/post/postLose/foe` 剧情。
- **章节 `G.ch` 由主线完成度推导**（`Quests.chapterNow()` → `Engine.syncChapter()`，单向只进不退）。旧内容（协会≥8、刀禁期≥12、番外≥15、试炼各阈值）全认 `G.ch`。
- **对接命脉**：`SJI_UI.startBattle(cfg)` 开战 → `SJI_BATTLE_HOOKS.onResult(b)` 结算 → `onDone()` 回世界（消费 `Engine.takePendingChapter()` 里程碑卡 + `Quests.takePendingPost()` 战后一幕）。
- **特则通道** `cfg.rule={id,desc}`：引擎已实现 9 种（原版 dyad/uprising/chaos + 本作 cans/stench/yansuan/suomen/zhengshi/zhongshu）。新增特则照此加，并配 `test_rules2.mjs` 断言。
- **战斗参数归位**：`hpScale/restFull/blocked/terrain` 必须放 `cfg.stage`，引擎只读这里。
- **回调兜底**：任何挂在动画（Spring）上的收尾，都要幂等 + 超时兜底，不能赌动画跑完。

—— 战斗层、成长层、任务层、剧情文本层、难度层都是**可跑的成品**。剩余主要是 §5 第 1 条（获得全部技能）与第 2 条（平衡复核），都不是重写。祝顺利。
