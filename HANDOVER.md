# 《实验史记·马刀行》交接报告

> **✅ 交接状态：已完成并推送，下一个 agent 可以开始工作。**
> 本棒（第五棒）收尾内容：战斗胶水层拆分为 `js/duels.js`（main.js 1036→706 行）、
> 稀有刀卡改逐张开关（生效数量玩家自定）、极难/噩梦多人平衡删除、
> 为兵缴械死代码修复、文笔/声望获得实际用途（骂阵/檄文/折扣/门槛）。
> 验证：smoke 源码+成品双跑 60 项 ALL PASS、剧情链路 50 项、引擎专项全绿。
> **待办清单见 §5，接手自检见 §6。远端 main 已对齐（`2994054`），正常 push 即可。**

> 更新于 2026-09-15（第三棒）。前两棒见 git：`3e8133b`（初交接）、`80f5e55`/`0d47432`（剧情重构）。
> 项目：`D:\code\shiji-madao-open`（git 单仓，main 分支，工作树干净，HEAD `fdfe81d`）
> 桌面成品：`C:\Users\LENOVO\Desktop\实验史记·马刀行\`
> **接手第一件事：读 §3「这一棒修了什么」与 §5「剩余未完成」，再按 §6 自检。**

---

## 1. 一句话现状

剧情重构（任务驱动 + 难度自选 + 时间线解耦 + 立传降级）已完成并全绿；第三棒修了剧情文本/移动三 bug/平衡级静默 bug/回调健壮化；**第四棒（本棒）落地「获得角色=全套技能（被动继承）」+ 主线 m2-m6 平衡采样调平 + 平衡脚本直读真配置**。

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
| ~~1~~ | **「获得一个角色的技能 = 获得全部技能（主动+被动）」** ✅ 第四棒已完成（方案①） | 引擎新增 `passiveOwner(u)`：装备时 `Blades.applyBoons` 给玩家标 `_learnedFrom`，引擎 25 处被动 `charId` 判定统一改走该口（主动技本就走 `_execLearned`）。专项测试 `test_passives.mjs` 11 断言全 PASS。注意：基础血量不随继承；`NO_SKILL_CARD`（崇国/树/路人/可怡）无装备入口，其被动不可得。 |
| ~~2~~ | **m2/m3/m4 0% 胜率** ✅ 第四棒已调平（详见 技术报告.md §4.1） | 关键教训：**greedyBot 对高倍率近战（鲁豪）必 0 分，须用 kiteBot**（换 bot 后 m3 easy 13%→100%）。落地调整：m2 加 restFull+0.75；m3 改先后单挑+restFull+0.65+特则 dyad→chaos；m4 0.45；m5 0.85；m6 0.9。终采样（kiteBot×12 场）：easy/normal 全线无 0%。**遗留**：m2/m3 extreme 0%（白板期选极难本就近乎无解，已在玩法说明注明）；m3 normal 17% 为有意保留的风筝教学关。 |
| ~~3~~ | 技术报告/玩法说明 ✅ 第四棒已更新（被动继承/平衡采样记录/难度提示），docx/pdf 已重出 | 后续改动记得同步。 |
| 4 | 老档迁移只过了 quest_flow 的合成旧档测试 | 建议拿一个真实玩出来的旧档（`shiji_cqb_v1`）再人工过一遍。 |
| 5 | 「进操场大 bug」未单独复现 | 修完落点/命中区后未再复现，建议用户实测确认；若仍在，先抓 `#dialog`/`#chapter-card`/`#modal-mask` 是否残留遮挡。 |

## 5.5 推送注意事项（重要）

- 第四棒末尾因代理断连，最后一次同步走了 **GitHub API 快照推送**（push_via_api.py）：
  远端 main = `716dc92`（API 生成的快照提交，内容=本地 7e2efe7 的全量文件），本地与远端 **SHA 分叉但内容一致**。
- 代理恢复后请执行：`git pull --rebase origin main`（本地两枚提交会因树相同被跳过/合并），
  或直接 `git push --force-with-lease origin main`（单人仓库，内容一致，安全）。
- 【已处理】第五棒已 `push --force` 对齐（远端 main = 本地 00f96d0+），此后正常推送即可。

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
