/* 实验史记·马刀行 —— 任务系统：主线任务链（高难关卡）+ 条件触发支线（解锁强力人物/效果）
   自由度：世界可自由行走，任务是"指引"不是"门禁"；未接主线也能满校园挑战刀手。
   据卷八《马刀书》兴亡史编排主线。 */
'use strict';
/* ================================================================
   【这个文件是干嘛的】
   任务系统：主线任务链 MAIN（9 节，每节都是一场带专属剧情的高难
   战斗）+ 支线任务表 SIDE（7 条，好感/胜场等条件满足后出现，完成
   奖励强力人物或永久被动）+ 难度自选表 DIFFS。任务是"指引"不是
   "门禁"：只负责 HUD 指引卡、世界地图任务点、战前战后剧情与结算
   赏格，不拦着玩家在校园里自由行动。
   本文件数据与逻辑混编：上半是四张表（DIFFS/MAIN/SIDE/CH_AFTER），
   下半是 Quests 对象的查询/开战/结算/渲染方法。

   【架构位置】
   融合层，位于世界（main.js/world.js）与战斗（battle/）之间。
   数据依赖 SJI_DATA.CHARACTERS（角色卡）、SCENE_BY_ID（场景表）；
   逻辑依赖 config（el/pick/toast/Save）、Engine（金钱/声望/好感/
   syncChapter）、Blades（身怀之技/稀有刀卡）、UI（面板）、
   World（切场景/寻路）。
   世界↔战斗的命脉经过这里：main.js 战前调 preScript() 播剧情 →
   SJI_UI.startBattle(cfg) 开战 → 引擎打完经 SJI_BATTLE_HOOKS.onResult
   调 complete() → complete 里 stashPost() 把战后剧情挂起 → 回到世界
   后 main.js 用 takePendingPost() 取出播映。一存一取、成对消费。

   【暴露的全局名】
   DIFFS / DIFF_BY_V（难度表）、Quests（主对象：all / byId / done /
   chapterNow / progressLabel / current / sideOpen / markers /
   nearMarker / preScript / postScript / start / pickAndStart /
   complete / migrateInnates / roster / unlockFighter / diffV / render）。

   【新手阅读提示】
   1) JS 的坑：顶层 const 不会自动挂到 window——文件末尾的
      window.Quests = Quests 是显式挂载；别的文件判活要写
      typeof Quests !== 'undefined'，直接裸名比较会抛 ReferenceError。
   2) 章节号 G.ch 不随睡觉/时间推进，而是 chapterNow() 按主线完成度
      现算的；engine.js 的 syncChapter() 只在算出的章节数更大时才
      写入，所以章节"单向只进不退"，老存档的进度绝不会回跳。
   3) 全文件最大的坑在 start()：hpScale/restFull 这类战场参数必须
      放进 cfg.stage 子对象，战斗引擎只认 cfg.stage——写在 cfg 顶层
      会被静默忽略（曾导致十几处敌人血量缩放失效且无任何报错）。
      start() 末尾那段"归位"代码就是防它的。
   ================================================================ */

/* 难度自选：影响敌方强度与赏格（写进 SJI_SAVE.settings.lastDiff，战斗层直接读） */
/* 每档一条对象，字段结构：
     v   难度代号（存档里存的就是它，也是 DIFF_BY_V 的 key）
     n   界面显示名
     mul 赏格倍率——complete() 结算零花钱/声望时相乘
     tip 选项旁的一句说明
   共 5 档：简单/普通/困难/极难/噩梦，强度与赏格逐档上调。 */
const DIFFS = [
  { v: 'easy',    n: '简单', mul: 0.8, tip: '敌方行动点少、伤害低；赏格 ×0.8' },
  { v: 'normal',  n: '普通', mul: 1.0, tip: '标准强度（默认）' },
  { v: 'hard',    n: '困难', mul: 1.3, tip: '敌方更狠；赏格 ×1.3' },
  /* 代表条目（极难）：v 存档用、n 显示名、mul=1.6 即赏格乘 1.6、
     tip 是按钮旁的说明文字。"多人平衡失效"等术语由战斗引擎按难度解释。 */
  { v: 'extreme', n: '极难', mul: 1.6, tip: '敌方 5 动、强制狂攻、击破不回血、多人平衡失效（敌人不减血、汝无补偿）；赏格 ×1.6' },
  { v: 'nightmare', n: '噩梦', mul: 2.2, tip: '敌方全员最优行动 + 资源碾压 + 多人平衡失效；赏格 ×2.2' },
];
/* 由代号反查难度条目的索引表：先建空对象，再 forEach 把 DIFFS 逐条
   塞进去（key 用代号 v）。之后 DIFF_BY_V['hard'] 直接拿到"困难"档——
   JS 对象即 Python 的 dict，obj.k 与 obj['k'] 两种写法等价。 */
const DIFF_BY_V = {};
DIFFS.forEach(d => DIFF_BY_V[d.v] = d);

const Quests = (() => {

  /* ============ 主线：马刀兴亡史（每节皆高难关卡） ============
     need():  解锁条件
     goal/hint: 指引卡上的一行目标与一行提示
     cfg:     战斗配置（rule 特则见 battle/engine.js）
     reward:  赏格
     pre:     战前剧情脚本（世界 Dialog 格式）
     foe:     对手开战前的一句随机挑衅（追加在 pre 末尾；who 用能解析出头像的号）
     post:    战胜后的收束
     postLose:战败后的一段（接在结算页之后播） */
  /* MAIN 每条还有这些公共字段（上面未提到的）：
     id    任务代号——存档 G.quests[id] 记完成与否，全文件靠它检索
     name  任务名（HUD 指引卡与结算标题用）
     where 场景 id（任务发生在哪个场景，配合 SCENE_BY_ID 查短名）
     pos   场景内坐标 [x, y]，任务点与寻路锚点
     need  解锁条件函数：返回 true 才在世界上出现（主线=上一节已完成）
     cfg   战斗配置，最终交给 SJI_UI.startBattle：
           enemies 敌人 id 数组（首波）；waves 多波次（每波一个数组，
                   打完接下一波）；restFull 波次间回满血；hpScale 敌人
                   血量倍率（<1 放水、>1 加强）；rule 本关特则（引擎按
                   id 分发逻辑、desc 只是给玩家看的文案）；allies 援军；
                   diff 强制难度（null 表示随玩家自选难度）
   字段级示例见 m2（多波次 + 阵间回血 + 特则一应俱全）。 */
  const MAIN = [
    { id: 'm1', name: '初执马刀', where: 'playground', pos: [750, 450],
      goal: '操场寻万震，讨教第一刀', hint: '白板之身，先赢一场，录他一技',
      need: () => true,
      cfg: { enemies: ['wanzhen'], rule: null },
      reward: { money: 8, rep: 2 },
      pre: [
        { who: '旁白', text: '操场东南角。跑道内侧有一片被踩秃的草地，人谓「马刀场」。' },
        { who: '音克思', text: '（我写了三年别人的事。今天该自己上场了。）' },
        { who: 'Wonder震', text: '（他抬头半秒）题？给我。' },
        { who: '音克思', text: '非题。刀。' },
        { who: 'Wonder震', text: '……来。' },
      ],
      foe: { who: 'Wonder震', pool: ['来。', '（他把草稿纸折成刀的形状）这个，也行。', '刀者，如解方程：先消元，后归零。'] },
      post: [
        { who: '旁白', text: '草叶上有血。很淡，但确实有。' },
        { who: 'Wonder震', text: '……你第一刀，走的是斜线。' },
        { who: '音克思', text: '何以见得？' },
        { who: 'Wonder震', text: '因为我的刀落在你左边，而你砍到了我右边。——这是几何，不是刀法。' },
        { who: '音克思', text: '（六班之首，果然只谈数学。）' },
        { who: '旁白', text: '音克思曰：立传者，先立于场上。' },
      ],
      postLose: [
        { who: 'Wonder震', text: '（他把草稿纸捡起来，抚平）……继续。' },
        { who: '音克思', text: '（白板之身，果然不行。刀谱还空着——先赢一场再说。）' },
      ] },

    /* —— 代表条目 m2 逐字段 ——
       id/name/where/pos：代号 m2、显示名、发生在走廊场景、任务点坐标。
       goal/hint：指引卡上的目标一句话与战术提示一句话。
       need：上一节 m1 打完才解锁（done 查的是存档 G.quests['m1']）。 */
    { id: 'm2', name: '实验三异能者', where: 'corridor', pos: [720, 260],
      goal: '连战大哥、神人、仙女三人', hint: '三阵连战，阵间回血；异能者各有异能',
      need: () => Q.done('m1'),
      /* waves：三波轮战（大哥→神人→仙女）；restFull：波次之间回满血；
         hpScale: 0.75——三连战太难，把每波敌人血量压到 75% 作补偿；
         rule：本关特则（dyad 由引擎解释，desc 是给玩家看的文案）。 */
      cfg: { enemies: ['dage'], waves: [['dage'], ['shenren'], ['xiannv']], restFull: true, hpScale: 0.75, rule: { id: 'dyad', desc: '相邻敌人伤害+1（二声部合唱）' } },
      reward: { money: 12, rep: 3 },
      pre: [
        { who: '旁白', text: '走廊尽头，三个人站成一排。这是全校唯一一个会「合唱」的阵型。' },
        { who: '大哥', text: '音克思。闻汝执刀矣。' },
        { who: '音克思', text: '只赢过一场。' },
        { who: '大哥', text: '一场足矣。刀和人一样——立起来，就看得出成色。' },
        { who: '神人', text: '吾亦在阵中！吾乃班委——虽只任了一瞬。' },
        { who: '仙女', text: '（她的声音从走廊另一头传过来，比人先到）关尔屁事，要打便打！' },
        { who: '大哥', text: '三人一组，谓之「实验三异能者」。汝接得住否？' },
      ],
      foe: { who: '大哥', pool: ['来呀来呀。', '此不类高考乎？', '城墙者，高考也；苔藓者，困难也。'] },
      post: [
        { who: '大哥', text: '（他扶着墙站起来，先笑了）' },
        { who: '大哥', text: '三阵连战，汝一阵未歇。这一手，吾记下了。' },
        { who: '神人', text: '吾是第二个倒的！……第二个，亦算前列也。' },
        { who: '仙女', text: '（已经走远了，声音还留在走廊里）下次不许从背后动手！' },
        { who: '大哥', text: '音克思，吾有梦，梦一城墙，极高极大。他日汝若写吾，须写这一句。' },
        { who: '旁白', text: '音克思曰：三人合阵，其声部虽乱，其志未散。' },
      ],
      postLose: [
        { who: '大哥', text: '汝倒了。但史官倒在地上，也还是史官。' },
        { who: '神人', text: '吾等三对一，胜之不武。……不过吾还是胜了。' },
        { who: '音克思', text: '（今日之败，不足记也。明日再来。）' },
      ] },

    { id: 'm3', name: '操场三国刀', where: 'playground', pos: [520, 560],
      goal: '胜小川与鲁豪，夺三国刀之名', hint: '小川缴械、鲁豪刀伤翻倍——先破其一',
      need: () => Q.done('m2'),
      cfg: { enemies: ['xiaochuan'], waves: [['xiaochuan'], ['luhao']], restFull: true, hpScale: 0.65,
             rule: { id: 'chaos', desc: '三国相争：敌人各有二成机率打错人（同门相争，各怀鬼胎）' } },
      reward: { money: 15, rep: 3 },
      pre: [
        { who: '旁白', text: '操场北侧。两个人把刀插在土里，像插着两面旗。' },
        { who: '鲁豪', text: '（他掀了掀衣角）音克思，汝写史，吾是委员。今日须写一场。' },
        { who: '音克思', text: '两位一起？' },
        { who: '鲁豪', text: '道与德艺，本是一体。汝没听说过「以刀会友」么——友是后来的事，先是刀。' },
        { who: '小川', text: '吾只问一句：汝可有胆近身？' },
        { who: '音克思', text: '（小川的刀专缴兵器。鲁豪的刀伤翻倍。先破其一。）' },
        { who: '鲁豪', text: '恋爱而不让人知，如锦绣夜行——今日不如明着来。' },
      ],
      foe: { who: '鲁豪', pool: ['来呀来呀，重开重开。', '汝先打谁？吾等着。', '规矩是：活者为王。'] },
      post: [
        { who: '鲁豪', text: '（他坐在跑道边，肚子一起一伏）汝先破的小川。' },
        { who: '音克思', text: '缴械之人最险，须先断。' },
        { who: '鲁豪', text: '对。含笑老师也这么说吾：「最险者先除」。' },
        { who: '小川', text: '（他把刀收回鞘里，很慢）……下次，我不缴你刀。我扎你心口。' },
        { who: '旁白', text: '音克思曰：三国刀者，非三人，乃三种刀意。' },
      ],
      postLose: [
        { who: '小川', text: '刀已缴。汝拿什么再战？' },
        { who: '鲁豪', text: '回去练。吾等在此，跑不掉。' },
      ] },

    { id: 'm4', name: '世界马刀协会', where: 'playground', pos: [950, 300],
      goal: '协会锦标赛三连胜：鲁豪→小川→子琛', hint: '阵间充分休整；子琛会召唤援军',
      need: () => Q.done('m3'),
      cfg: { enemies: ['luhao'], waves: [['luhao'], ['xiaochuan'], ['zichen']], restFull: true, hpScale: 0.45,
             rule: { id: 'uprising', desc: '第三回合敌人援军二人入场（起义）' } },
      reward: { money: 25, rep: 5, rare: 'b_killheal' },
      pre: [
        { who: '旁白', text: '操场看台下支起一张折叠桌，桌上摊着手写的纸。纸上四个字：世界马刀协会。' },
        { who: '子琛', text: '音克思。（他把纸推过来）此为通知尔，非求建议也。' },
        { who: '音克思', text: '协会？' },
        { who: '子琛', text: '三人：道、德艺、武。委员之数，合于九省联考之三主科。' },
        { who: '鲁豪', text: '吾是道。' },
        { who: '小川', text: '吾是德艺。' },
        { who: '子琛', text: '吾是武。今日汝若连胜三阵，此名册上，加汝一位。' },
        { who: '音克思', text: '（三连胜。中间只给一次整休。）' },
        { who: '子琛', text: '号令两班，政由琛出。今日令出，汝接否？' },
      ],
      foe: { who: '子琛', pool: ['第一阵，鲁豪。', '第二阵，小川。', '第三阵——吾自下场。'] },
      post: [
        { who: '子琛', text: '（他把纸翻过来，添上第五个名字：音克思）' },
        { who: '子琛', text: '委员会自此四人。汝居末位。' },
        { who: '音克思', text: '末位亦可。' },
        { who: '子琛', text: '不急。武居末位者，历来升得最快。' },
        { who: '鲁豪', text: '吾之技……汝录了？' },
        { who: '音克思', text: '录了。' },
        { who: '鲁豪', text: '（他很满意）那便好。' },
        { who: '旁白', text: '音克思曰：协会既立，刀有规矩；有规矩处，始可称「道」。' },
      ],
      postLose: [
        { who: '子琛', text: '名册不改。汝再来。' },
        { who: '鲁豪', text: '三连胜，谈何容易。' },
      ] },

    { id: 'm5', name: '七班刀合流', where: 'classroom7', pos: [540, 430],
      goal: '胜李帆与头哥，六七合流', hint: '李帆购刀免动、笑场之歌能惑人；头哥免疫击退',
      need: () => Q.done('m4'),
      cfg: { enemies: ['lifan', 'touge'], hpScale: 0.85, rule: { id: 'stench', desc: '鲍鱼之肆：回合结束相邻敌我互蚀各 1 血' } },
      reward: { money: 18, rep: 4 },
      pre: [
        { who: '旁白', text: '七班教室。灯管频闪，像有人在蹦迪。' },
        { who: '李帆', text: '（他环顾四周，压低声音）神的教会，听说过么？' },
        { who: '音克思', text: '没有。' },
        { who: '李帆', text: '那便好。苹苹果得 C 等者，皆叛徒也——课代表是叛军之首，她不知道。' },
        { who: '头哥', text: '（他在包里摸出一张彩印的图，旦视暮抚）吾之三溴化氮，汝可见乎？' },
        { who: '音克思', text: '不见。' },
        { who: '头哥', text: '无有。那便以头抢地耳。' },
        { who: '李帆', text: '且慢。音克思，汝之刀史，七班须占半壁。' },
        { who: '音克思', text: '（灯管又闪了一下。两个人都笑了。）' },
      ],
      foe: { who: '李帆', pool: ['Q=CU。……谁在笑！', '嘘，小声。', '适可而止！'] },
      post: [
        { who: '李帆', text: '疯奇！——此语何来？' },
        { who: '音克思', text: '我写的。' },
        { who: '李帆', text: '（他愣了一下，然后大笑）好。此评语我要印在马刀卡上。' },
        { who: '头哥', text: '（他把球棍盒合上）三溴没了。……书里，能给我补一株么？' },
        { who: '音克思', text: '能。' },
        { who: '头哥', text: '那便好。多应谢芙芙于我心，渡我至彼岸。' },
        { who: '旁白', text: '音克思曰：七班之刀，在于乱；乱中自有秩序。' },
      ],
      postLose: [
        { who: '李帆', text: '苹苹果得 C 等，皆叛徒也——今日汝即叛徒。' },
        { who: '头哥', text: '（他把图收回去）再战，须带糖来。' },
      ] },

    { id: 'm6', name: '刀禁令风波', where: 'office', pos: [240, 500],
      goal: '主任钦法坐镇办公楼，闯过去', hint: '钦法当场缴械；此战特则：楼内无墙可踢',
      need: () => Q.done('m5'),
      cfg: { enemies: ['qinfa', 'weibing'], hpScale: 0.9, rule: { id: 'suomen', desc: '锁门：楼内无墙可踢，双方马踢不可用' } },
      reward: { money: 20, rep: 4, unlock: 'qinfa' },
      pre: [
        { who: '旁白', text: '办公楼二层。门关着，窗也关着。走廊里没有任何声音。' },
        { who: '钦法', text: '（他把一叠纸放在桌上，用手压住）马刀，是何物？' },
        { who: '音克思', text: '……是规矩。' },
        { who: '钦法', text: '规矩须有人管。三令五申，屡禁不止。' },
        { who: '为兵', text: '（他站在门口，手里是相机）豌豆射手，何为豌豆射手？' },
        { who: '音克思', text: '（这个问题我答不上来。）' },
        { who: '钦法', text: '此楼之内，无墙可踢。汝之马，进不来。' },
        { who: '音克思', text: '（锁门。马踢不可用。此处只余刀。）' },
        { who: '钦法', text: '「当场抓获」——此四字，汝今日会记住的。' },
      ],
      foe: { who: '钦法', pool: ['此何课也？', '汝手拿出来。', '记汝一笔。'] },
      post: [
        { who: '钦法', text: '（他慢慢把纸收了回去）' },
        { who: '钦法', text: '……汝之刀，比吾所见的干净。' },
        { who: '音克思', text: '主任也习刀？' },
        { who: '钦法', text: '吾不习。吾只管。' },
        { who: '为兵', text: '（他放下相机，没有拍）' },
        { who: '钦法', text: '今日之事，不上报。然此楼之内，此后不得再有人执刀。——先生可以走了。' },
        { who: '音克思', text: '（先生。他叫我先生。）' },
        { who: '旁白', text: '音克思曰：令行而刀止，令废而刀起；禁令所至，更见人之所执。' },
      ],
      postLose: [
        { who: '钦法', text: '刀，缴。' },
        { who: '音克思', text: '（马刀进了他的抽屉。两日后才还。）' },
      ] },

    { id: 'm7', name: '马刀之神', where: 'playground', pos: [750, 450],
      goal: '与 wonder 决战，证马刀之神之名', hint: '〔验算〕他血量为偶则回血——把他打成奇数',
      need: () => Q.done('m6'),
      cfg: { enemies: ['wonder'], diff: null, hpScale: 1.4,
             rule: { id: 'yansuan', desc: '验算：回合末 wonder 血量为偶数则回 1 血——算好伤害' } },
      reward: { money: 30, rep: 6, rare: 'b_bloodfree', unlock: 'wonder' },
      pre: [
        { who: '旁白', text: '操场正中，只站着一个人。他面前的地上，用粉笔画了一道题。' },
        { who: 'wonder', text: '来来来。汝会这道题否？' },
        { who: '音克思', text: '我不是来解题的。' },
        { who: 'wonder', text: '那你来解人。人也是题。' },
        { who: '音克思', text: '（他血量为偶数时会回血。要把他打成奇数。）' },
        { who: 'wonder', text: '刀是死的，人是活的。规则愈简，人愈多变。' },
        { who: 'wonder', text: '此刀，吾之所引进也。汝写刀史，须自吾始。' },
        { who: '音克思', text: '自你始。' },
        { who: 'wonder', text: 'GBC，算不算。' },
      ],
      foe: { who: 'wonder', pool: ['Wonder震，来不来。', '来呀来呀。', '重开重开。'] },
      post: [
        { who: 'wonder', text: '（他坐在地上，用手指把粉笔字擦掉了一半）' },
        { who: 'wonder', text: '奇数。你算过。' },
        { who: '音克思', text: '算过。' },
        { who: 'wonder', text: '（他笑了）好。刀史里，把我写成——「最早讲规则的人」。' },
        { who: '音克思', text: '可以。' },
        { who: 'wonder', text: '另外一句，也要写：自然数之和，是负十二分之一。' },
        { who: '音克思', text: '这一句我保留意见。' },
        { who: 'wonder', text: '保留便保留。' },
        { who: '旁白', text: '音克思曰：马刀之神者，非刀之神，乃定规矩之人。' },
      ],
      postLose: [
        { who: 'wonder', text: '偶数回血。你看，数学是不会骗人的。' },
        { who: '音克思', text: '（回去重算。）' },
      ] },

    { id: 'm8', name: '终焉之战', where: 'office', pos: [860, 260],
      goal: '再入校长室，与崇国做个了断', hint: '〔种树不绝〕他每回合种树；为兵为你助阵',
      need: () => Q.done('m7'),
      cfg: { enemies: ['qinfa', 'chongguo'], allies: ['weibing'], diff: 'hard', hpScale: 0.78,
             rule: { id: 'zhongshu', desc: '种树不绝：每回合开始崇国自动种树（至多三株）' } },
      reward: { money: 40, rep: 8, rare: 'b_horsereach', unlock: 'chongguo' },
      pre: [
        { who: '旁白', text: '校长室。三个人。桌上没有茶，只有一摞卷宗。' },
        { who: '崇国', text: '（他打量你的校牌）哪个班的？' },
        { who: '音克思', text: '高三。' },
        { who: '崇国', text: '校园内不许散步。' },
        { who: '音克思', text: '我不是来散步的。' },
        { who: '崇国', text: '汝在写什么？校史？' },
        { who: '音克思', text: '算是。' },
        { who: '崇国', text: '多写学生。少写吾。' },
        { who: '音克思', text: '（他种树皆死。全校都知道。）' },
        { who: '为兵', text: '（他从侧门进来，站到了另一边）校长，此次吾不站在门口了。' },
        { who: '崇国', text: '（长久的沉默）……汝之树，皆死。' },
        { who: '音克思', text: '树是死的。人是活的。' },
        { who: '钦法', text: '这一战，吾不拦。吾只是站着看。' },
      ],
      foe: { who: '崇国', pool: ['为师者，吾之属地也。', '有师敢不从吾乎？', '此局未终。'] },
      post: [
        { who: '崇国', text: '（他把卷宗合上，双手压在封皮上）' },
        { who: '崇国', text: '本纪第十四。汝写了多少页？' },
        { who: '音克思', text: '四页。' },
        { who: '崇国', text: '四页，够了。（他顿了顿）种树那一节，留着吧。' },
        { who: '音克思', text: '留着。' },
        { who: '崇国', text: '吾去二中，仍会种。……皆死。吾知道。' },
        { who: '音克思', text: '（他没有再看我。）' },
        { who: '旁白', text: '音克思曰：苛刻于人者，未必不知自己。知而不改，是另一门功课。' },
      ],
      postLose: [
        { who: '崇国', text: '卷宗拿回去。吾不看学生的东西。' },
        { who: '为兵', text: '（他把相机收进兜里）下次，我仍不拍。' },
        { who: '音克思', text: '（再入校长室。）' },
      ] },

    { id: 'm9', name: '马刀的结局', where: 'gate', pos: [430, 300],
      goal: '校门口，为这部刀史收卷', hint: '与最强者（wonder）作最后一战，或和平收卷',
      need: () => Q.done('m8'),
      cfg: { enemies: ['wonder'], hpScale: 1.6, diff: 'hard',
             rule: { id: 'cans', desc: '看台飞瓶：与他同行或同列，回合开始被砸 1 血' } },
      reward: { money: 60, rep: 12, rare: 'b_cleave' },
      pre: [
        { who: '旁白', text: '校门口。梧桐叶落在题着「实验」二字的铁门上。' },
        { who: 'wonder', text: '最后一次。' },
        { who: '音克思', text: '嗯。' },
        { who: 'wonder', text: '看台上有人扔瓶子。同行或同列，便要挨砸——这是规矩，不是我定的。' },
        { who: '音克思', text: '谁定的？' },
        { who: 'wonder', text: '看的人。（他抬手指了指空无一人的看台）他们永远在看。' },
        { who: '音克思', text: '（三年。刀起刀落，都是给看的人看的？）' },
        { who: 'wonder', text: '不。是给自己看的。——写完这一场，你就毕业了。' },
        { who: '音克思', text: '那你呢？' },
        { who: 'wonder', text: '我？我只想赢。' },
      ],
      foe: { who: 'wonder', pool: ['来呀来呀。', '最后一次，重开重开。', '活者为王。'] },
      post: [
        { who: 'wonder', text: '（他仰面躺在校门口，铁门的影子落在他身上）' },
        { who: 'wonder', text: '完了。' },
        { who: '音克思', text: '完了。' },
        { who: 'wonder', text: '既毕业，无复有刀者，悲哉。' },
        { who: '音克思', text: '我把它写进书里。' },
        { who: 'wonder', text: '写进书里的刀，就不会消。……这句，是你说的还是我听的？' },
        { who: '音克思', text: '都算。' },
        { who: '旁白', text: '音克思曰：刀史至此收卷。刀已封，人仍在。' },
      ],
      postLose: [
        { who: 'wonder', text: '还差一点。（他把粉笔捡起来，重新画了一道）' },
        { who: '音克思', text: '（收卷之前，这一场非赢不可。）' },
      ] },
  ];

  /* ============ 支线：满足条件触发，完成解锁强力人物或永久效果 ============ */
  /* SIDE 每条与主线同构（id/name/where/pos/goal/cfg/pre/foe/post/
     postLose 含义都相同），差别在触发与奖励两处：
       cond     触发条件函数（好感度/胜场/已录卡…），sideOpen() 每次刷
                HUD 都会执行一遍，条件满足且未完成才显示任务点
                （主线靠 need 排先后，支线靠 cond 论条件）
       condHint 条件的文字版，给玩家看"还差什么"
       reward   除 money 外还能发：unlock 把人物加进点将名册、
                innate 授身怀之技（永久被动）、rare 授稀有刀卡、
                text 结算页上的一行文言说明
   字段级示例见 s_dage。 */
  const SIDE = [
    /* —— 代表条目 s_dage 逐字段 ——
       cond: 大哥好感 ≥20 才触发（Engine.favorOf 读存档里的好感表）。
       condHint: 条件文字版「大哥好感≥20」。
       reward.unlock: 战胜后「大哥」进点将名册；reward.innate: 授身怀
       之技「城墙之梦」（永久生效、无需装备）；text: 结算页的说明行。 */
    { id: 's_dage', name: '大哥的护手霜', where: 'corridor', pos: [400, 300],
      goal: '大哥好感≥20，再与他一战', cond: () => Engine.favorOf('dage') >= 20,
      cfg: { enemies: ['dage'], hpScale: 1.2 },
      condHint: '大哥好感≥20',
      reward: { unlock: 'dage', innate: 'dage', money: 10, text: '「城墙之梦」常驻：立于城墙刀击+1；可点将出征「大哥」' },
      pre: [
        { who: '大哥', text: '音克思。吾有一物，欲托于汝。' },
        { who: '音克思', text: '何物？' },
        { who: '大哥', text: '护手霜。之韫所赠，吾未曾用。' },
        { who: '音克思', text: '那为何要与我对打一场？' },
        { who: '大哥', text: '吾梦城墙，走之无尽头。若汝能胜吾，吾便认——此梦不虚。' },
        { who: '音克思', text: '（他把护手霜放在走廊的窗台上，像供着什么。）' },
      ],
      foe: { who: '大哥', pool: ['来呀来呀。', '此不类高考乎？', '吾终将尽城墙。'] },
      post: [
        { who: '大哥', text: '（他拿起窗台上的护手霜，递过来）' },
        { who: '大哥', text: '拿着。汝写史，手会皴。' },
        { who: '音克思', text: '（我接下了。他转身走进人群，很快看不见了。）' },
        { who: '旁白', text: '音克思曰：梦不必真，信梦者真。' },
      ],
      postLose: [
        { who: '大哥', text: '梦未成。汝再来。' },
        { who: '音克思', text: '（窗台上的护手霜，他没有拿走。）' },
      ] },

    { id: 's_xinhui', name: '歆慧的一声滚', where: 'library', pos: [700, 380],
      goal: '歆慧好感≥25，接她一击', cond: () => Engine.favorOf('xinhui') >= 25,
      cfg: { enemies: ['xinhui'], hpScale: 1.25, rule: { id: 'dyad', desc: '她的「一声滚」可击退两格——莫贴边' } },
      condHint: '歆慧好感≥25',
      reward: { unlock: 'xinhui', innate: 'xinhui', money: 12, text: '「灵光乍现」常驻：偶数回合行动+1；可点将出征「歆慧」' },
      pre: [
        { who: '歆慧', text: '有事？' },
        { who: '音克思', text: '想请你接我一刀。' },
        { who: '歆慧', text: '（她合上书）为什么？' },
        { who: '音克思', text: '书里得有你动手的一次。' },
        { who: '歆慧', text: '别把我写成只会哭的人。我是先转身的那一个。' },
        { who: '音克思', text: '所以我来请你出手。' },
        { who: '歆慧', text: '……好。你自己站远些。我这一声，能推两格。' },
      ],
      foe: { who: '歆慧', pool: ['滚。', '站远些。', '我不说第二遍。'] },
      post: [
        { who: '歆慧', text: '（她收回手，指尖有点抖）' },
        { who: '歆慧', text: '既黑铭，吾觉未有之爽也。' },
        { who: '音克思', text: '这句，要写进去么？' },
        { who: '歆慧', text: '写。写完整。' },
        { who: '旁白', text: '音克思曰：列传之要，在于是谁先转身。' },
      ],
      postLose: [
        { who: '歆慧', text: '……你连我一声都接不住。' },
        { who: '音克思', text: '（再来。）' },
      ] },

    { id: 's_luhao', name: '锦绣昼行', where: 'dorm', pos: [450, 300],
      goal: '胜鲁豪一次（腹大如斗，刀伤翻倍）', cond: () => Blades.hasCard('luhao'),
      cfg: { enemies: ['luhao'], hpScale: 1.2 },
      condHint: '已胜鲁豪',
      reward: { innate: 'luhao', rare: 'b_firststrike', money: 15, text: '身怀「大腹如斗」：生命上限+10、刀击翻倍（常驻）；另得稀有刀卡「先手刀」' },
      pre: [
        { who: '鲁豪', text: '（他掀开被角又盖上）五日了，就等查寝。' },
        { who: '音克思', text: '我不是来查寝的。' },
        { who: '鲁豪', text: '那你来做什么？' },
        { who: '音克思', text: '你把「锦绣夜行」这四个字解释明白，我便走。' },
        { who: '鲁豪', text: '（他掀开被子坐了起来）恋爱而不让人知，如锦绣夜行，谁知之者！' },
        { who: '鲁豪', text: '吾知。' },
        { who: '音克思', text: '那你为何不说？' },
        { who: '鲁豪', text: '说了，就不是锦绣了。……来。汝想懂这四个字，先接吾一刀。' },
      ],
      foe: { who: '鲁豪', pool: ['来呀来呀。', '先破吾腹。', '吾腹大，汝刀小。'] },
      post: [
        { who: '鲁豪', text: '（他喘着气坐回床上）' },
        { who: '鲁豪', text: '你要写的不是我。' },
        { who: '音克思', text: '那是谁？' },
        { who: '鲁豪', text: '绍铭。他那张纸条，毓润坑他，是吾从桌洞里抢回来的。写这个。' },
        { who: '音克思', text: '先手刀，我收下了。' },
        { who: '旁白', text: '音克思曰：所谓「道」，是替人挡在暗处的那一刀。' },
      ],
      postLose: [
        { who: '鲁豪', text: '（他又躺了回去）不叠被，不打人。吾今日只等查寝。' },
        { who: '音克思', text: '（改日。）' },
      ] },

    { id: 's_touge', name: '三溴化氮', where: 'classroom7', pos: [540, 200],
      goal: '头哥好感≥30，试他的陀螺', cond: () => Engine.favorOf('touge') >= 30,
      cfg: { enemies: ['touge'], hpScale: 1.3, rule: { id: 'stench', desc: '溴味蚀人：回合末相邻互蚀 1 血——别贴他' } },
      condHint: '头哥好感≥30',
      reward: { unlock: 'touge', innate: 'touge', money: 12, text: '「球棍意念」常驻：免疫击退；可点将出征「头哥」' },
      pre: [
        { who: '头哥', text: '汝可见吾之三溴化氮？' },
        { who: '音克思', text: '盒中只有它。' },
        { who: '头哥', text: '它没了。以头抢地耳。' },
        { who: '音克思', text: '（他把陀螺的残片递过去。那就是三溴化氮。）' },
        { who: '头哥', text: '汝既拾得，便该与吾一战。——此物，也只认会转的人。' },
        { who: '音克思', text: '好。' },
        { who: '头哥', text: '记着：莫贴吾身。沾上溴味，是要蚀人的。' },
      ],
      foe: { who: '头哥', pool: ['三溴化氮。', '吾之陀螺，鲜有败绩。', '多应谢芙芙于我心。'] },
      post: [
        { who: '头哥', text: '（他把陀螺收进球棍盒，与那张彩印的图放在一起）' },
        { who: '头哥', text: '转得不错。' },
        { who: '音克思', text: '你也是。' },
        { who: '头哥', text: '多应谢芙芙于我心，渡我至彼岸。（他顿了顿）吾可入汝之名册。' },
        { who: '旁白', text: '音克思曰：所谓怪人，多是把自己的秩序藏得太深的人。' },
      ],
      postLose: [
        { who: '头哥', text: '（他把陀螺收回盒里）还差得远。' },
        { who: '音克思', text: '（再来。）' },
      ] },

    { id: 's_guayu', name: '提壶狂奔', where: 'canteen', pos: [540, 170],
      goal: '胜呱宇一次（二成闪避，难缠）', cond: () => Blades.hasCard('guayu') && G.rep >= 60, condHint: '已胜呱宇，且声望≥60',
      cfg: { enemies: ['guayu', 'yiran'], hpScale: 0.85 },
      reward: { innate: 'guayu', rare: 'b_shield', money: 18, text: '身怀「疾如电」：20% 闪避（常驻）；另得稀有刀卡「班主任的偏爱」' },
      pre: [
        { who: '呱宇', text: '（他举着水壶）借过，水，命。' },
        { who: '音克思', text: '打一场。' },
        { who: '呱宇', text: '打可以。但我先喝完。——拖堂了吗？没拖？' },
        { who: '音克思', text: '没拖。' },
        { who: '呱宇', text: '那我还能赶上 7:50。' },
        { who: '奕然', text: '（他从旁边插进来）打他，算我一个。他上次拍我肚皮。' },
        { who: '呱宇', text: '皇家曼彻斯特，懂？帅，是一种责任。' },
        { who: '音克思', text: '（食堂的地是滑的。两个人，一个跑得快，一个记仇。）' },
      ],
      foe: { who: '呱宇', pool: ['让我喝完。', '帅，是一种责任。', '你追不上我。'] },
      post: [
        { who: '呱宇', text: '（他把水壶举起来，晃了晃，还剩半瓶）' },
        { who: '呱宇', text: '输了。……没关系，帅不败。' },
        { who: '奕然', text: '他拍我肚皮的事，你得写。' },
        { who: '音克思', text: '写。' },
        { who: '呱宇', text: '帅，被写进史书了。（他提着水壶走了个正步）' },
        { who: '旁白', text: '音克思曰：少年之帅，与水壶一起，都是要入史的。' },
      ],
      postLose: [
        { who: '呱宇', text: '（他喝完最后一口）走了，上课要迟到了。' },
        { who: '奕然', text: '（他把袖子挽起来）再来。' },
      ] },

    { id: 's_zichen', name: '体育课起义', where: 'playground', pos: [950, 300],
      goal: '子琛好感≥35，接他的起义', cond: () => Engine.favorOf('zichen') >= 35,
      cfg: { enemies: ['zichen'], hpScale: 1.3, rule: { id: 'uprising', desc: '第三回合其二心腹入场（起义）' } },
      condHint: '子琛好感≥35',
      reward: { unlock: 'zichen', innate: 'zichen', money: 15, text: '「班长之威」常驻：相邻敌人伤害-1；可点将出征「子琛」' },
      pre: [
        { who: '子琛', text: '（他把演讲稿收进抽屉）体育课之事，汝听过什么风声？' },
        { who: '音克思', text: '听过。' },
        { who: '子琛', text: '今体育课辄跑操，无自由之时间。吾乃欲变此。' },
        { who: '音克思', text: '含笑老师知道么？' },
        { who: '子琛', text: '此通知尔，非求建议也。' },
        { who: '音克思', text: '（他连对老师都是这句话。第三回合，他的两个心腹会入场。）' },
        { who: '子琛', text: '号令两班，政由琛出。今日汝若挡我——便是挡两班。' },
      ],
      foe: { who: '子琛', pool: ['此为通知，非请教也。', '吾只服物竞。', '第三回合，你自会明白。'] },
      post: [
        { who: '子琛', text: '（他坐在地上，把演讲稿的角抚平）' },
        { who: '子琛', text: '上书被呈到校长那里了。' },
        { who: '音克思', text: '然后？' },
        { who: '子琛', text: '含笑老师说「尔敢起事，吾誓杀汝」。（他笑了）那一夜，也算威震。' },
        { who: '音克思', text: '我的名册里，还缺一个武。' },
        { who: '子琛', text: '那便算上。' },
        { who: '旁白', text: '音克思曰：政由琛出者，未必好斗；只是不肯把话咽下去罢了。' },
      ],
      postLose: [
        { who: '子琛', text: '汝拦不住我。（他把演讲稿重新收好）' },
        { who: '音克思', text: '（下一场。）' },
      ] },

    { id: 's_win30', name: '以刀会友', where: 'playground', pos: [750, 450],
      goal: '累计胜 10 场，与协会委员再战一场', cond: () => (G.wins || 0) >= 10 && G.rep >= 70, condHint: '胜场≥10，且声望≥70',
      cfg: { enemies: ['luhao', 'xiaochuan', 'zichen'], hpScale: 0.62, rule: { id: 'chaos', desc: '三人各有二成机率打错人（同门相争）' } },
      reward: { innate: 'xiaochuan', rare: 'b_horse', money: 25, text: '身怀「卧薪尝胆」：受伤后下次伤害+1（常驻）；另得稀有刀卡「马踏连营」' },
      pre: [
        { who: '旁白', text: '又是操场看台下那张折叠桌。纸上的名字，如今是四行。' },
        { who: '鲁豪', text: '十胜。' },
        { who: '音克思', text: '十胜。' },
        { who: '小川', text: '委员会有规矩：满十胜者，须与三人同时一战。' },
        { who: '音克思', text: '三对一？' },
        { who: '子琛', text: '此为通知尔，非求建议也。' },
        { who: '鲁豪', text: '不过吾等三人，各有二成机率打错人——同门相争，是常有的事。' },
        { who: '小川', text: '所以，汝不必怕三对一。汝只需站稳。' },
        { who: '音克思', text: '（马踏连营，成不成，在此一战。）' },
      ],
      foe: { who: '鲁豪', pool: ['以刀会友。', '三人同时，汝怕否？', '活者为王。'] },
      post: [
        { who: '鲁豪', text: '（他把纸上的第四行用红笔圈了一下）' },
        { who: '鲁豪', text: '十胜。此后汝非客，是委员。' },
        { who: '小川', text: '不过……' },
        { who: '子琛', text: '不过吾等三人，还是各打错了一个人。' },
        { who: '音克思', text: '我看见了。' },
        { who: '鲁豪', text: '（他大笑）写进去。这一条也写进去！' },
        { who: '旁白', text: '音克思曰：所谓同门，打错人也仍是同门。' },
      ],
      postLose: [
        { who: '鲁豪', text: '三对一，胜之不武。……不过吾等还是胜了。' },
        { who: '音克思', text: '（站稳，再来。）' },
      ] },
  ];

  /* ============ 主线完成度 → 章节进度 ============
     旧内容（协会开张、刀禁期、试炼解锁、番外人物客串）此前都挂在 G.ch 上。
     现在 G.ch 不再靠睡觉推进，而由主线进度翻译而来，于是「打完这一节，世界就变了一道」。
        m4 世界马刀协会 → ch≥8（协会/试炼/生存开）
        m6 刀禁令风波   → ch≥12（刀禁期起）
        m9 马刀的结局   → ch16（终章） */
  /* 表本体：key 是主线任务 id，value 是打完该节后应到达的章节号
     （chapterNow() 取所有已完成条目里的最大值）。 */
  const CH_AFTER = { m1: 1, m2: 3, m3: 5, m4: 8, m5: 9, m6: 12, m7: 13, m8: 14, m9: 16 };

  /* Quests 对象本体：以下方法都是对上面几张表的查询与驱动。
     done(id) { … } 这种是 ES6 对象方法简写，等价于 done: function (id) { … }；
     方法体里的 this 指代 Q 自身（所以能写 this.done / this.current）。 */
  const Q = {
    /* 三张表的便捷访问：all=主线+支线合并（concat 不改原数组、返回新
       数组）；byId 按 id 查任务；done 查存档——!! 把任意值强转成布尔
       （!!undefined === false），相当于 Python 的 bool()。 */
    all() { return MAIN.concat(SIDE); },
    mainList() { return MAIN.slice(); },
    sideList() { return SIDE.slice(); },
    byId(id) { return this.all().find(q => q.id === id); },
    done(id) { return !!G.quests[id]; },
    /* 主线进度 → 章节号 */
    /* 扫一遍已完成的主线，取 CH_AFTER 对应章节的最大值。注意它只负责
       "算"；真正写进 G.ch 的是 engine.js 的 syncChapter()——那边仅当
       算出的章节数更大时才赋值，因此章节单向只进不退，老存档的进度
       绝不会回跳。 */
    chapterNow() {
      let ch = 0;
      MAIN.forEach(q => { if (this.done(q.id) && CH_AFTER[q.id] != null) ch = Math.max(ch, CH_AFTER[q.id]); });
      return ch;
    },
    /* HUD 用：主线 n/9 + 支线已办 m/7 */
    progressLabel() {
      return MAIN.filter(q => this.done(q.id)).length + '/' + MAIN.length;
    },
    sideDoneLabel() {
      return SIDE.filter(q => this.done(q.id)).length + '/' + SIDE.length;
    },
    /* 当前主线：第一个未完成的主线 */
    current() { return MAIN.find(q => !this.done(q.id)) || null; },
    /* 可接支线：条件满足且未完成 */
    sideOpen() { return SIDE.filter(q => !this.done(q.id) && q.cond()); },
    /* 世界上此刻该显示的任务点（主线当前 + 已解锁支线）
       dpos = 显示/交互位置；q.pos 仍是寻路用的锚点。同场景重叠时扇形错开。 */
    markers() {
      const cur = this.current();
      const list = [];
      if (cur) list.push({ q: cur, main: true });
      this.sideOpen().forEach(q => list.push({ q, main: false }));
      /* 聚类后错位：距离 <70 的点视为一团，按扇形摊开（左右各展开约 42px） */
      /* 先按场景分组：byScene 是"场景 id → 该场景任务点数组"的表。
         (byScene[x] = byScene[x] || []).push(m) 是懒初始化惯用法——
         没有就先放个空数组再 push。 */
      const byScene = {};
      list.forEach(m => { (byScene[m.q.where] = byScene[m.q.where] || []).push(m); });
      Object.keys(byScene).forEach(sid => {
        const arr = byScene[sid];
        const groups = [];
        /* 聚类：给每个任务点找一个"距它 <70px"的已有组并入，找不到
           就自立一组。Math.hypot(dx,dy) 算直角三角形斜边长，即两点距离。 */
        arr.forEach(m => {
          const g = groups.find(g => Math.hypot(g[0].q.pos[0] - m.q.pos[0], g[0].q.pos[1] - m.q.pos[1]) < 70);
          if (g) g.push(m); else groups.push([m]);
        });
        groups.forEach(g => {
          /* 错位：只有一个点就原位显示（slice 浅拷贝坐标数组，防多处
             共用同一引用）；多个点按扇形摊开——ang 从正上方(-90°)起步、
             相邻点隔 0.9 弧度，水平摊 96px、垂直摊 34px（压扁的椭圆），
             算出的 dpos 只用于显示/交互，寻路仍用原 pos。 */
          g.forEach((m, i) => {
            if (g.length < 2) { m.dpos = m.q.pos.slice(); return; }
            const ang = -Math.PI / 2 + (i - (g.length - 1) / 2) * 0.9;
            m.dpos = [Math.round(m.q.pos[0] + Math.cos(ang) * 96), Math.round(m.q.pos[1] + Math.sin(ang) * 34)];
          });
        });
      });
      list.forEach(m => { if (!m.dpos) m.dpos = m.q.pos.slice(); });
      return list;
    },
    /* 某任务点的显示位置（有错位则用错位后） */
    walkPosOf(id) {
      const m = this.markers().find(m => m.q.id === id);
      return m ? m.dpos.slice() : [0, 0];
    },
    /* 玩家附近的任务点（供交互条） */
    /* 找离玩家最近的同场景任务点（供交互条用）：过滤场景 → 映射成
       {任务点, 距离} → 按距离升序 → 取第一个；一个都没有时靠
       || null 兜底。r 是判定半径，不传默认 100px。 */
    nearMarker(sceneId, x, y, r) {
      r = r || 100;
      return this.markers().filter(m => m.q.where === sceneId)
        .map(m => ({ m, d: Math.hypot(m.dpos[0] - x, m.dpos[1] - y) }))
        .filter(o => o.d < r).sort((a, b) => a.d - b.d)[0] || null;
    },
    /* 战前脚本：专属剧情 + 对手一句随机挑衅。无专属数据时返回 null（由调用方兜底） */
    /* (q.pre || []).slice() 是双保险：没写过 pre 就当空数组，slice 再
       浅拷贝一份，防止往里 push 挑衅台词时污染任务表的原始数据。 */
    preScript(q) {
      const s = (q.pre || []).slice();
      if (q.foe && q.foe.pool && q.foe.pool.length) s.push({ who: q.foe.who, text: pick(q.foe.pool) });
      return s.length ? s : null;
    },
    /* 战后脚本：胜/败分开 */
    /* win ? post : postLose 是三目运算符，
       相当于 Python 的 q.post if win else q.postLose。 */
    postScript(q, win) {
      const s = win ? q.post : q.postLose;
      return (s && s.length) ? s.slice() : null;
    },
    /* 结算时先把战后对话挂起，等回到世界（战斗覆盖层关闭）再播 */
    /* 为什么不直接播：结算页此刻还盖在世界上，剧情画面会被压住——
       所以先存进 _pendingPost，等 main.js 战斗收尾时调
       takePendingPost() 取走播映；取时顺手清空，一存一取成对消费，
       多场战斗之间不会串场。 */
    stashPost(q, win) { this._pendingPost = q ? this.postScript(q, win) : null; },
    takePendingPost() { const s = this._pendingPost; this._pendingPost = null; return s; },
    _pendingPost: null,
    /* 兜底脚本（老数据/缺剧情时） */
    fallbackPre(q, isMain) {
      return [
        { who: '音克思', text: (isMain ? '【主线】' : '【支线】') + q.name + '——' + q.goal },
        { who: '音克思', text: '（' + (q.hint || q.goal) + '）' },
        { who: '对手', text: pick(['来呀来呀。', '规则至简，而引人入胜。', '既来之，则战之。', '重开重开，谁怕谁。']) },
      ];
    },
    /* 开战：难度自选 + 出战角色选择 → SJI_UI.startBattle */
    /* 开战总入口步骤：① 先 Blades.registerChar() 按最新成长重造主角
       战斗卡；② Object.assign(默认配置, q.cfg) 合并——同名属性后者
       覆盖前者，任务表里写过的字段会盖掉默认值（JS 合并配置的惯用法）；
       ③ q.cfg.diff === null 特判：任务不锁难度、随玩家自选；
       ④ 战场参数归位进 cfg.stage（见下方注释，本项目著名的坑）。 */
    start(q, fighterId) {
      const diff = Quests.diffV();
      Blades.registerChar();
      const cfg = Object.assign({
        mode: 'story', questId: q.id,
        title: (MAIN.indexOf(q) >= 0 ? '主线 · ' : '支线 · ') + q.name,
        playerChar: fighterId || 'yinkesi',
        enemies: [], allies: [], diff: diff, aiAggr: 'active',
      }, q.cfg);
      if (q.cfg.diff === null) cfg.diff = diff;      // diff:null 表示随玩家难度
      if (!cfg.rule) cfg.rule = null;
      /* hpScale / restFull 属于战场配置，引擎只从 cfg.stage 读取（engine.js HP 缩放与阵间回血）。
         任务数据为书写方便放在顶层，这里归位——否则全部静默失效。 */
      /* "搬家"写法：把 hpScale/restFull 抄进 cfg.stage 之后，再用
         delete 运算符删掉 cfg 顶层的原字段，避免两处数据不一致。 */
      if (cfg.hpScale !== undefined || cfg.restFull) {
        cfg.stage = Object.assign({}, cfg.stage || {});
        if (cfg.hpScale !== undefined) { cfg.stage.hpScale = cfg.hpScale; delete cfg.hpScale; }
        if (cfg.restFull) { cfg.stage.restFull = true; delete cfg.restFull; }
      }
      SJI_UI.startBattle(cfg);
    },
    /* 点将出征：名册只有主角一人就直接开打；否则弹面板挑人。
       el() 是 config.js 的 DOM 元素工厂，UI.openPanel 开底部抽屉；
       roster.forEach 给每个可选角色生成一张卡片，点谁就以谁出战
       （主角保有刀谱与身怀，别人用自己的本卡）。 */
    pickAndStart(q) {
      const roster = Quests.roster();
      if (roster.length <= 1) { this.start(q); return; }
      UI.openPanel('点将出征 · ' + q.name, body => {
        body.appendChild(el('div', 'muted', '选定出战之人。音克思保有刀谱与修炼；他人以其本卡出战（保留稀有刀卡与道具）。'));
        body.appendChild(el('div', '', '<div style="height:8px"></div>'));
        roster.forEach(id => {
          const ch = window.SJI_DATA.CHARACTERS[id];
          if (!ch) return;
          const c = el('div', 'card');
          c.style.cssText = 'display:flex;align-items:center;gap:12px;cursor:pointer';
          c.innerHTML = `<span class="tokenface" style="background:${ch.color}">${ch.glyph}</span>
            <div style="flex:1"><h3 style="margin:0">${ch.name} <span class="phao" style="color:var(--cinnabar);font-size:12px">${ch.hao}</span></h3>
            <div class="meta">血 ${ch.hp} · 被动「${ch.passive.name}」${ch.skill ? ` · 技「${ch.skill.name}」` : ''}</div></div>`;
          c.onclick = () => { UI.closePanel(); Quests.start(q, id); };
          body.appendChild(c);
        });
      });
    },
    /* 完成结算：发赏、解锁、推进 */
    /* 战斗引擎战胜后经钩子回调到这里：按难度倍率发钱发声望、发放
       身怀之技/稀有刀卡/解锁人物、标记任务完成、推进章节、挂起战后
       剧情，最后把结算文案拼成 HTML 字符串返回（battle-ui 会把它插进
       战斗结算页展示）。 */
    complete(q) {
      const rw = q.reward || {};
      /* 赏格随难度浮动：查难度表拿 mul 倍率，Math.round 四舍五入取整。 */
      const mul = DIFF_BY_V[Quests.diffV()].mul;
      const money = Math.round((rw.money || 0) * mul);
      const rep = Math.round((rw.rep || 0) * mul);
      /* lines 收集一段段 HTML 字符串，最后 join('') 拼成整段结算文案。 */
      let lines = [`<div><b>任务完成：「${q.name}」</b></div>`];
      if (money) { Engine.addMoney(money); lines.push(`<div>零花钱 +${money}${mul !== 1 ? `（难度 ×${mul}）` : ''}</div>`); }
      if (rep) { Engine.addRep(rep); lines.push(`<div>声望 +${rep}</div>`); }
      /* 下面三种特殊奖励都做了"已持有"去重：新的才发，旧的提示一句。 */
      if (rw.innate) {
        const info = Blades.INNATE_INFO[rw.innate];
        if (info) {
          const freshInnate = Blades.grantInnate(rw.innate);
          lines.push(`<div>${freshInnate ? '<b>身怀之技＋1</b>：「' + info.name + '」——' + info.desc + '（永久常驻，无需装备）' : '（身怀「' + info.name + '」早已在身）'}</div>`);
        }
      }
      if (rw.rare) {
        const rareDefs = Blades.RARE_BOONS;
        if (rareDefs[rw.rare] && Blades.grantRare(rw.rare)) lines.push(`<div>稀有刀卡「${rareDefs[rw.rare].name}」入手</div>`);
        else if (rareDefs[rw.rare]) lines.push(`<div>（稀有刀卡「${rareDefs[rw.rare].name}」已在囊中）</div>`);
      }
      if (rw.unlock) {
        const ch = window.SJI_DATA.CHARACTERS[rw.unlock];
        if (Quests.unlockFighter(rw.unlock) && ch) lines.push(`<div>强力人物解锁：<b>${ch.name}（${ch.hao}）</b>可点将出征</div>`);
        else if (ch) lines.push(`<div>（${ch.hao} 早已在列）</div>`);
      }
      if (rw.text) lines.push(`<div class="yueks">${rw.text}</div>`);
      /* 标记完成：done()/current()/chapterNow()/进度统计全认这个字段。 */
      G.quests[q.id] = true;
      Engine.award('ach_quest');
      /* 主线完成 → 章节推进（世界随之变化：协会开张 / 刀禁期 / 试炼解锁） */
      const chAdvanced = Engine.syncChapter();
      /* 战后收束：挂起，回世界后播 */
      this.stashPost(q, true);
      /* 结算页顺带预告下一个任务；主线全部打完则换成收卷文案。 */
      const cur = this.current();
      if (cur) lines.push(`<div style="margin-top:6px">▸ 新任务：「${cur.name}」——${cur.hint}</div>`);
      else lines.push(`<div style="margin-top:6px" class="yueks">音克思曰：刀者，终将入书。全书将成。</div>`);
      if (chAdvanced) lines.push(`<div class="yueks">刀史又进一道——世界随之一变。</div>`);
      if (q.post) lines.push(`<div class="muted" style="margin-top:4px">▸ 返回校园后，尚有一幕。</div>`);
      Save.write();
      this.render();
      return '<div class="result-extra">' + lines.join('') + '</div>';
    },
    /* 老档迁移：已完成的支线若奖励含身怀之技，一次性静默补发（否则老玩家永远拿不到） */
    migrateInnates() {
      let got = [];
      for (const q of this.sideList()) {
        if (G.quests[q.id] && q.reward && q.reward.innate && !Blades.innates().includes(q.reward.innate)) {
          Blades.innates().push(q.reward.innate);
          const info = Blades.INNATE_INFO[q.reward.innate];
          got.push(info ? '「' + info.name + '」' : q.reward.innate);
        }
      }
      if (got.length) {
        Save.write();
        if (Blades.hasCard && window.SJI_DATA) Blades.registerChar();
        toast('身怀之技补发（按已完成的支线）：' + got.join(''), '承');
      }
      return got.length;
    },
    /* 出战名册 */
    /* 可点将出征的角色 id 表：同样懒初始化，主角永远在列。 */
    roster() { if (!G.roster) G.roster = ['yinkesi']; return G.roster; },
    /* 解锁强力人物入册：已在册返回 false（结算页据此显示"早已在列"）；
       新解锁则 toast 提示 + 存档 + 刷新 HUD。 */
    unlockFighter(id) {
      const r = this.roster();
      if (r.includes(id)) return false;
      r.push(id);
      const ch = window.SJI_DATA.CHARACTERS[id];
      toast(`强力人物入列：「${ch ? ch.name + '（' + ch.hao + '）' : id}」——点将可选出战`, '将');
      Save.write(); this.render();
      return true;
    },
    /* 当前难度代号：读设置里上次选的档，两级 || 兜底——先兜"从没存过
       设置"，再兜"存的代号不认识"（老存档/手改），一律退回 'normal'。 */
    diffV() {
      const d = (window.SJI_SAVE && SJI_SAVE.settings.lastDiff) || 'normal';
      return DIFF_BY_V[d] ? d : 'normal';
    },
    /* HUD 任务指引卡 */
    /* 当前主线 + 最多 3 条可接支线拼成 HTML，一次性 innerHTML 赋值。
       按钮不逐个绑事件，而是写上 data-quests / data-finale 属性，
       最后统一 querySelectorAll 找出来绑 onclick——事件委托的简化版。 */
    render() {
      const box = document.getElementById('questcard');
      if (!box) return;
      const cur = this.current();
      const sides = this.sideOpen();
      const prog = this.progressLabel();
      let h = '';
      if (cur) {
        /* 查场景表拿短名做按钮文字，查不到就退回场景 id。 */
        const sc = SCENE_BY_ID[cur.where];
        h += `<div class="qc-main"><div class="qc-tag">主线 ${prog}</div>
          <div class="qc-name">${cur.name}</div>
          <div class="qc-goal">${cur.goal}</div>
          <div class="qc-hint">${cur.hint}</div>
          <button class="ctx-btn duel qc-btn" data-quests="${cur.id}">前往 · ${sc ? sc.short : cur.where}</button></div>`;
      } else {
        h += `<div class="qc-main"><div class="qc-tag done">主线 ${prog} · 已成</div><div class="qc-name">刀史收卷</div>
          <div class="qc-goal">纵刀已封，书已成。校园仍可自由来去。</div>
          <button class="ctx-btn duel qc-btn" data-finale="1">终章 · 高考</button></div>`;
      }
      if (sides.length) {
        h += `<div class="qc-sides"><div class="qc-sides-title">支线可接（${sides.length}）· 已办 ${this.sideDoneLabel()}</div>` +
          sides.slice(0, 3).map(q => {
            const sc = SCENE_BY_ID[q.where];
            return `<div class="qc-side"><b>${q.name}</b> · ${sc ? sc.short : q.where}
              <button class="ctx-btn qc-btn" data-quests="${q.id}">前往</button></div>`;
          }).join('') + '</div>';
      }
      box.innerHTML = h;
      box.classList.remove('hidden');
      /* 「前往」按钮：不在目标场景就先 World.travel 切过去，等 120ms
         （让场景切换先走完）再 World.walkTo 走到任务点下方 40px 处。 */
      box.querySelectorAll('[data-quests]').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          const q = Quests.byId(b.dataset.quests);
          if (!q) return;
          if (World.sceneId !== q.where) World.travel(q.where);
          setTimeout(() => {
            const p = Quests.walkPosOf(q.id);
            World.walkTo(p[0], p[1] + 40);
          }, 120);
          toast(`前往：${q.goal}`, '令');
        };
      });
      /* 「终章 · 高考」按钮：转发给 main.js 的收卷流程处理。 */
      box.querySelectorAll('[data-finale]').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          if (typeof Main !== 'undefined' && Main.finale) Main.finale();
        };
      });
    },
  };
  return Q;
})();
window.Quests = Quests;   // 显式挂载：Node 测试（mainquest_winrate 等）与跨脚本判活皆可直读任务配置
