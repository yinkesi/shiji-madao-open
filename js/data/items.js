/* 实验史记·春秋笔 —— 行囊道具（皆出自原文梗），小卖部有售 */
'use strict';

/* ================================================================
   【这张表是干嘛的】
   行囊道具表：主角能在小卖部买到、能送人刷好感的 29 样小东西，
   每样都对应《实验史记》原文里的一个梗（desc 就是原文摘句）。
   纯数据表，不含任何逻辑。

   【被谁消费】
   - js/ui.js  小卖部面板：遍历 ITEMS 摆货架，price 是标价（单位 ◉，
     即零花钱；打折时按折后价扣钱）。
   - js/main.js  送礼：data/people.js 里每个人的 loves / likes 存的
     就是本表的 id，送中“最爱”加好感最多、“喜欢”次之。
   - id 还是存档 G.bag 的键（买了几个、送掉几个都记在 bag 里）。

   【字段字典】
   id     道具唯一代号（全项目靠它互相引用，加完就别再改）；
   name   中文名（商店货架和行囊里显示的名字）；
   price  标价，单位 ◉（零花钱）；打折时实际扣 price × 折扣；
   desc   一句话说明，直接引用原文梗，商店卡片上原样展示。

   【新手注意】
   people.js 的 likes 里偶有本表不存在的 id（如 book、ball、cat）——
   那是“计划中的礼物”，没做出来也不报错，只是永远等不来这件礼物。
   ================================================================ */

/* 道具主表：数组，每个元素是一件道具（一个对象字面量）。
   下面拿第一件做逐字段示例，其余 28 件结构完全相同，不再重复注释。 */
const ITEMS = [
/* id='snack'  唯一代号（people.js 的 loves/likes、存档 G.bag 都用它指代这件道具） */
/* name='零食大礼包'  显示名 */
/* price=6  标价 6 ◉（零花钱） */
/* desc  商店卡片上的文案（原文梗） */
{ id:'snack',    name:'零食大礼包', price:6, desc:'子峻书包里的常客，毓润的眼睛盯着它。' },
{ id:'bun',      name:'面包',       price:3, desc:'之韫见毓润而大羞，面红而塞其一面包。——毓润说的。' },
{ id:'biscuit',  name:'小熊饼干',   price:4, desc:'汶斌阴置于呱宇坚果中，呱宇大怒，汶斌作痴呆状。' },
{ id:'banana',   name:'香蕉',       price:2, desc:'神人食毕，香蕉皮掷于浩之面。' },
{ id:'yogurt',   name:'酸奶',       price:4, desc:'封控时含笑所贻，得学生欢。' },
{ id:'apple',    name:'苹果',       price:3, desc:'含笑之父抡苹果自烟言驰至济南。' },
{ id:'corn',     name:'玉米',       price:3, desc:'大展市一玉米，幻想玉米为刃，乃拔玉米而舞。' },
{ id:'candy',    name:'水果糖',     price:2, desc:'一糖之恩。“与尔一糖，毋有心伤。”' },
{ id:'handcream',name:'护手霜',     price:8, desc:'一共34元。其后每擦，必思我矣。——大哥说的。' },
{ id:'bracelet', name:'手链',       price:8, desc:'运动会既散，窃置之于歆慧口袋。' },
{ id:'note',     name:'折好的纸条', price:2, desc:'歆慧之字。恋爱而不让人知，如锦绣夜行。' },
{ id:'notebook', name:'阅读笔记',   price:4, desc:'邹玉三绝技之二，周四周六且收。' },
{ id:'pen',      name:'钢笔',       price:5, desc:'月考迟到那日，可怡的黑笔救过一场大驾。' },
{ id:'teacup',   name:'茶杯',       price:5, desc:'神人的圣杯，细品茗水。' },
{ id:'ruler',    name:'黑棒',       price:6, desc:'不盈尺，威力无双。破伤风棒。' },
{ id:'problem',  name:'二十三题集', price:5, desc:'wonder 深究之，如痴如狂。' },
{ id:'spin',     name:'陀螺',       price:6, desc:'球棍所制，头哥名之曰三溴化氮。' },
{ id:'print',    name:'彩印画片',   price:7, desc:'芙宁娜，旦视而暮抚，已去而复顾。' },
{ id:'bottle',   name:'水壶',       price:5, desc:'凯宇嗜水如命，如厕必携水壶。' },
{ id:'frog',     name:'青蛙玩偶',   price:6, desc:'梦晨予奕然之绰号。小蛙甚喜之。' },
{ id:'cube',     name:'魔方',       price:6, desc:'七班之风。技艺炉火纯青者，奕然也。' },
{ id:'toydog',   name:'玩具小狗',   price:7, desc:'封控既解，鲁豪携犬入舍，小川甚爱之。' },
{ id:'card',     name:'马刀角色卡', price:5, desc:'七班角色刀。仙女，姜付艳——嘘。' },
{ id:'postcard', name:'原神明信片', price:7, desc:'神人购以贻诺然。十连双黄的梦。' },
{ id:'phone',    name:'备用手机',   price:12,desc:'相东每逢考试必潜携。二百？与尔三百，无令尔损！' },
{ id:'tree',     name:'小树苗',     price:8, desc:'种树校长。树木皆死，时人谓之。' },
{ id:'hairpin',  name:'发夹',       price:4, desc:'奕然捡到的，众女皆否。得无仙女乎？大惊弃掷。' },
{ id:'fan',      name:'小风扇',     price:5, desc:'哥欲开风扇，鲁豪以身翼蔽开关。' },
{ id:'gamecard', name:'游戏点卡',   price:5, desc:'4399。吾生而为打游戏。' },
];
/* 反查索引：把“遍历数组找 id”变成“按 id 直接取”——以 id 为键、
   道具对象为值建一个普通对象。此后 ITEM_BY_ID['bun'] 直接拿到面包，
   不用再 for 循环。三行写法（空对象 + forEach + 赋值）是本项目的
   惯用套路，people/scenes/events/volumes 各表末尾都有一个。 */
const ITEM_BY_ID = {};
ITEMS.forEach(i => ITEM_BY_ID[i.id] = i);
