/* 实验史记·春秋笔 —— 校园场景（数据驱动绘制）
   props 类型: wall/desk/table/round/longtable/shelf/bookshelf/board/podium/
   window/bunk/locker/fan/tree/track/basket/pingpong/counter/plant/sofa/pc/machine/mat/beds */
'use strict';

/* ================================================================
   【这张表是干嘛的】
   校园地图表：12 个互相连通的场景（图书馆、走廊、两间教室、食堂、
   操场、宿舍、办公楼、小卖部、科技楼、球室、校门）。每个场景就是
   一张“图纸”：画布尺寸 + 一堆家具矩形 + 一组传送门 + 一组锚点。
   没有任何贴图资源——家具全由 js/world.js 按这里的矩形用代码现画。

   【被谁消费】
   - js/world.js  每帧消费：floor 铺地板色；props 逐个画出来并当作
     碰撞盒（玩家穿不过去）；doors 做“走进门内就传送”；spots 给
     NPC 排站位（people.js 的 home 只指到哪个场景，具体站哪就从
     spots 里挑一个，还会做“落点避让”防止生成在碰撞盒里）。
   - data/people.js 的 home、data/events.js 的 scene、
     data/volumes.js 里 CHAPTERS 的 scene，填的都是本表的 id。
   - js/main.js  经 World.enter(id) 切场景，靠的也是这里的 id。

   【字段字典】
   id      场景唯一代号（上面三方都引用它，别乱改）；
   name    全名（切场景时 toast 提示显示）；
   short   短名（空间紧张处用）；
   w/h     场景画布宽高（像素，坐标原点在左上角，y 向下为正）；
   floor   地板颜色（CSS 颜色串，铺满整张画布）；
   desc    一句话场景说明（氛围文案）；
   props   家具/障碍数组，每件 {t, x, y, w, h, label?}：
           t=类型（决定画法，见下方说明），x/y=左上角坐标，
           w/h=宽高——既是贴图也是碰撞盒，label=画在家具上的中文名；
   doors   传送门数组，每扇 {x, y, w, h, to, label, inner?, zone?}：
           玩家走进矩形即切到 to 场景；inner:true 表示 to 还是本
           场景 = 场景内换区（如办公楼→校长室），zone 给区域打标记；
   spots   锚点表：{ 名字: [x, y] }。NPC 站位与剧情落点都查它
           （如 shop_buy 是小卖部购物交互点、lib_desk 是序章座位）。

   【props 的 t 类型补充】
   文件头列出的类型之外，world.js 的画笔还实现了 bench（长椅）和
   gate（校门牌坊），本表已用到、照常能画；beds 目前没有场景使用。
   ================================================================ */

/* 场景主表：数组，每个元素是一个场景。第一个“图书馆”做了逐字段
   注释示例，其余场景结构完全相同。 */
const SCENES = [
{ id:'library', name:'图书馆', short:'图书馆', w:960, h:620, floor:'#e9e2cf',
  /* ↑ 一行连写：代号、全名、短名、画布 960×620 像素、地板米黄色 */
  desc:'2024 年高考前，一切从这里开始。',
  /* ↑ desc：进入场景时的氛围文案 */
  props:[
    /* ↑ props：家具数组。t=类型、x/y=左上角坐标、w/h=尺寸；
       五个书架、四张自习桌（带 label）、一盆绿植——它们同时是碰撞盒 */
    {t:'bookshelf', x:60,  y:70,  w:120, h:180}, {t:'bookshelf', x:200, y:70,  w:120, h:180},
    {t:'bookshelf', x:340, y:70,  w:120, h:180}, {t:'bookshelf', x:480, y:70,  w:120, h:180},
    {t:'bookshelf', x:760, y:70,  w:120, h:180},
    {t:'longtable', x:120, y:330, w:220, h:70, label:'自习桌'},
    {t:'longtable', x:520, y:330, w:220, h:70, label:'自习桌'},
    {t:'longtable', x:120, y:470, w:220, h:70, label:'自习桌'},
    {t:'longtable', x:520, y:470, w:220, h:70, label:'自习桌'},
    {t:'plant', x:880, y:560, w:40, h:40},
  ],
  doors:[ {x:430, y:560, w:110, h:40, to:'corridor', label:'去走廊'} ],
  /* ↑ doors：传送门矩形。玩家走进去就切到 to 场景（这里唯一一扇通往走廊） */
  /* ↑ spots：锚点表。序章事件 ev_prologue_read 的 pos [300,380] 就是 lib_desk */
  spots:{ lib_desk:[300,380], lib_desk2:[700,380] } },

{ id:'corridor', name:'走廊', short:'走廊', w:1440, h:520, floor:'#e3ddcd',
  desc:'课间的走廊，是全校消息最灵通的地方。',
  props:[
    {t:'window', x:80,  y:20, w:160, h:22}, {t:'window', x:400, y:20, w:160, h:22},
    {t:'window', x:720, y:20, w:160, h:22}, {t:'window', x:1040,y:20, w:160, h:22},
    {t:'locker', x:60,  y:400, w:70, h:70, label:'柜'}, {t:'locker', x:150, y:400, w:70, h:70, label:'柜'},
    {t:'locker', x:1250,y:400, w:70, h:70, label:'柜'}, {t:'locker', x:1340,y:400, w:70, h:70, label:'柜'},
    {t:'plant', x:640, y:60, w:36, h:36}, {t:'plant', x:960, y:60, w:36, h:36},
    {t:'bench', x:600, y:380, w:130, h:36, label:'连廊长椅'},
  ],
  doors:[
    {x:20,  y:210, w:46, h:80, to:'classroom6', label:'六班'},
    {x:220, y:210, w:46, h:80, to:'classroom7', label:'七班'},
    {x:1374,y:210, w:46, h:80, to:'office',     label:'办公楼'},
    {x:520, y:20,  w:80, h:34, to:'library',    label:'图书馆'},
    {x:840, y:20,  w:80, h:34, to:'shop',       label:'小卖部'},
    {x:300, y:466, w:80, h:34, to:'playground', label:'操场'},
    {x:1080,y:466, w:80, h:34, to:'canteen',    label:'食堂'},
    {x:660, y:466, w:80, h:34, to:'dorm',       label:'宿舍'},
    {x:1180,y:20,  w:80, h:34, to:'tech',       label:'科技楼'},
    {x:240, y:20,  w:80, h:34, to:'pingpong',   label:'球室'},
    {x:20,  y:466, w:80, h:34, to:'gate',       label:'校门'},
  ],
  spots:{ corridor_mid:[720,260], corridor_west:[400,260] } },

{ id:'classroom6', name:'六班教室', short:'六班', w:1080, h:720, floor:'#e7dcc2',
  desc:'高二六班。含笑的地盘，邹玉的小组，破伤风棒与转盘奖品。',
  props:[
    {t:'board', x:340, y:26, w:400, h:70, label:'黑板'},
    {t:'podium', x:490, y:130, w:110, h:56, label:'讲台'},
    {t:'desk', x:180, y:250, w:76, h:52}, {t:'desk', x:290, y:250, w:76, h:52},
    {t:'desk', x:400, y:250, w:76, h:52}, {t:'desk', x:610, y:250, w:76, h:52},
    {t:'desk', x:720, y:250, w:76, h:52}, {t:'desk', x:830, y:250, w:76, h:52},
    {t:'desk', x:180, y:370, w:76, h:52}, {t:'desk', x:290, y:370, w:76, h:52},
    {t:'desk', x:400, y:370, w:76, h:52}, {t:'desk', x:610, y:370, w:76, h:52},
    {t:'desk', x:720, y:370, w:76, h:52}, {t:'desk', x:830, y:370, w:76, h:52},
    {t:'desk', x:180, y:490, w:76, h:52}, {t:'desk', x:290, y:490, w:76, h:52},
    {t:'desk', x:400, y:490, w:76, h:52}, {t:'desk', x:610, y:490, w:76, h:52},
    {t:'desk', x:720, y:490, w:76, h:52}, {t:'desk', x:830, y:490, w:76, h:52},
    {t:'bookshelf', x:40, y:30, w:110, h:90, label:'书架'},
    {t:'shelf', x:950, y:30, w:90, h:120, label:'杂物柜'},
    {t:'plant', x:1010, y:650, w:40, h:40},
  ],
  doors:[ {x:480, y:660, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ c6_front:[540,200], c6_back:[540,430], c6_window:[950,320] } },

{ id:'classroom7', name:'七班教室', short:'七班', w:1080, h:720, floor:'#dde2d2',
  desc:'七班。神人仙女在此诵书，头哥的球棍盒里只有三溴。',
  props:[
    {t:'board', x:340, y:26, w:400, h:70, label:'黑板'},
    {t:'podium', x:490, y:130, w:110, h:56, label:'讲台'},
    {t:'desk', x:180, y:250, w:76, h:52}, {t:'desk', x:290, y:250, w:76, h:52},
    {t:'desk', x:400, y:250, w:76, h:52}, {t:'desk', x:610, y:250, w:76, h:52},
    {t:'desk', x:720, y:250, w:76, h:52}, {t:'desk', x:830, y:250, w:76, h:52},
    {t:'desk', x:180, y:370, w:76, h:52}, {t:'desk', x:290, y:370, w:76, h:52},
    {t:'desk', x:400, y:370, w:76, h:52}, {t:'desk', x:610, y:370, w:76, h:52},
    {t:'desk', x:720, y:370, w:76, h:52}, {t:'desk', x:830, y:370, w:76, h:52},
    {t:'desk', x:180, y:490, w:76, h:52}, {t:'desk', x:290, y:490, w:76, h:52},
    {t:'desk', x:400, y:490, w:76, h:52}, {t:'desk', x:610, y:490, w:76, h:52},
    {t:'desk', x:720, y:490, w:76, h:52}, {t:'desk', x:830, y:490, w:76, h:52},
    {t:'bookshelf', x:40, y:30, w:110, h:90, label:'书架'},
    {t:'plant', x:1010, y:650, w:40, h:40},
  ],
  doors:[ {x:480, y:660, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ c7_front:[540,200], c7_back:[540,430] } },

{ id:'canteen', name:'食堂', short:'食堂', w:1080, h:700, floor:'#e6dbc8',
  desc:'打铃也，故走！羚羊的赛道，DDB 的饭桌，绍歆的尴尬。',
  props:[
    {t:'counter', x:120, y:60, w:280, h:60, label:'打饭窗口'},
    {t:'counter', x:680, y:60, w:280, h:60, label:'打饭窗口'},
    {t:'round', x:220, y:280, w:110, h:110, label:'桌'}, {t:'round', x:490, y:280, w:110, h:110, label:'桌'},
    {t:'round', x:760, y:280, w:110, h:110, label:'桌'},
    {t:'round', x:220, y:500, w:110, h:110, label:'桌'}, {t:'round', x:490, y:500, w:110, h:110, label:'桌'},
    {t:'round', x:760, y:500, w:110, h:110, label:'桌'},
    {t:'plant', x:1010, y:640, w:40, h:40},
  ],
  doors:[ {x:480, y:640, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ can_win:[540,170], can_table:[545,445] } },

{ id:'playground', name:'操场', short:'操场', w:1500, h:900, floor:'#cfd8c2',
  desc:'马刀兴起之地，起义密谋之地，一万种自由时间。',
  props:[
    {t:'track', x:220, y:180, w:1060, h:540, label:'跑道'},
    {t:'basket', x:360, y:330, w:60, h:60, label:'篮球架'},
    {t:'basket', x:1080, y:520, w:60, h:60, label:'篮球架'},
    {t:'machine', x:180, y:760, w:150, h:60, label:'器械区'},
    {t:'longtable', x:1300, y:100, w:120, h:60, label:'看台'},
    {t:'longtable', x:1300, y:180, w:120, h:60, label:'看台'},
    {t:'plant', x:1440, y:840, w:40, h:40},
  ],
  doors:[
    {x:20,  y:420, w:46, h:80, to:'corridor', label:'教学楼'},
    {x:700, y:840, w:100, h:40, to:'gate',    label:'校门'},
  ],
  spots:{ pg_knife:[750,450], pg_track:[520,560], pg_tai:[950,300] } },

{ id:'dorm', name:'宿舍', short:'宿舍', w:900, h:660, floor:'#e0d6c4',
  desc:'317。风扇、夜谈、香蕉皮与被骂声。',
  props:[
    {t:'bunk', x:80,  y:90,  w:180, h:80, label:'榻'}, {t:'bunk', x:80,  y:250, w:180, h:80, label:'榻'},
    {t:'bunk', x:640, y:90,  w:180, h:80, label:'榻'}, {t:'bunk', x:640, y:250, w:180, h:80, label:'榻'},
    {t:'bunk', x:80,  y:480, w:180, h:80, label:'榻'}, {t:'bunk', x:640, y:480, w:180, h:80, label:'榻'},
    {t:'fan',  x:430, y:70, w:50, h:50, label:'风扇'},
    {t:'locker', x:420, y:560, w:70, h:70, label:'盆架'},
    {t:'plant', x:830, y:620, w:36, h:36},
  ],
  doors:[ {x:390, y:610, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ dorm_mid:[450,300], dorm_west:[320,180] } },

{ id:'office', name:'办公楼', short:'办公楼', w:1080, h:640, floor:'#e5ddc9',
  desc:'含笑的办公室、钦法的办公室，最里面是校长室。',
  props:[
    {t:'longtable', x:100, y:120, w:220, h:80, label:'含笑案'},
    {t:'longtable', x:100, y:380, w:220, h:80, label:'钦法案'},
    {t:'sofa', x:520, y:130, w:150, h:60, label:'沙发'},
    {t:'longtable', x:800, y:100, w:200, h:90, label:'校长案'},
    {t:'wall', x:740, y:40, w:14, h:280},
    {t:'wall', x:740, y:440, w:14, h:160},
    {t:'plant', x:1000, y:580, w:40, h:40},
    {t:'bookshelf', x:400, y:500, w:130, h:100, label:'档案柜'},
  ],
  doors:[
    {x:480, y:580, w:120, h:40, to:'corridor', label:'去走廊'},
    /* inner:true：to 还是本场景 = 场景内换区，zone 给校长室区域打标记 */
    {x:756, y:330, w:60, h:90, to:'office', label:'校长室', inner:true, zone:'principal'},
  ],
  spots:{ of_hx:[240,240], of_qf:[240,500], of_head:[860,260] } },

{ id:'shop', name:'小卖部', short:'小卖部', w:720, h:540, floor:'#e9dec6',
  desc:'王明虎开的商铺传统，在此延续。买礼物送人，好感经济学的起点。',
  props:[
    {t:'counter', x:100, y:70, w:240, h:56, label:'柜台'},
    {t:'shelf', x:480, y:60, w:180, h:120, label:'货架'},
    {t:'shelf', x:480, y:240, w:180, h:120, label:'货架'},
    {t:'machine', x:120, y:300, w:90, h:110, label:'冰柜'},
    {t:'plant', x:660, y:500, w:36, h:36},
  ],
  doors:[ {x:290, y:480, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ shop_buy:[300,220] } },

{ id:'tech', name:'科技楼', short:'科技楼', w:1000, h:640, floor:'#dfe0d6',
  desc:'机房、禁闭室，与展怡约会的隐秘角落。',
  props:[
    {t:'pc', x:120, y:100, w:70, h:56}, {t:'pc', x:230, y:100, w:70, h:56},
    {t:'pc', x:340, y:100, w:70, h:56}, {t:'pc', x:120, y:230, w:70, h:56},
    {t:'pc', x:230, y:230, w:70, h:56}, {t:'pc', x:340, y:230, w:70, h:56},
    {t:'wall', x:600, y:60, w:14, h:200},
    {t:'longtable', x:660, y:90, w:120, h:70, label:'禁闭桌'},
    {t:'plant', x:940, y:600, w:36, h:36},
  ],
  doors:[ {x:430, y:580, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ tech_pc:[290,340], tech_secrect:[700,300] } },

{ id:'pingpong', name:'乒乓球室', short:'球室', w:800, h:560, floor:'#e2ddd0',
  desc:'期末考试在此。正手？反手？师长亦大惊。',
  props:[
    {t:'pingpong', x:150, y:120, w:220, h:100, label:'球台'},
    {t:'pingpong', x:150, y:360, w:220, h:100, label:'球台'},
    {t:'plant', x:740, y:520, w:36, h:36},
  ],
  doors:[ {x:330, y:490, w:120, h:40, to:'corridor', label:'去走廊'} ],
  spots:{ pp_table:[430,260] } },

{ id:'gate', name:'校门', short:'校门', w:1000, h:600, floor:'#d8dcc8',
  desc:'走读生的队伍、潜逃者的路线、毕业的终点。',
  props:[
    {t:'gate', x:420, y:40, w:160, h:60, label:'实验'},
    {t:'tree', x:150, y:120, w:70, h:80}, {t:'tree', x:780, y:120, w:70, h:80},
    {t:'tree', x:150, y:380, w:70, h:80}, {t:'tree', x:780, y:380, w:70, h:80},
    {t:'mat',  x:430, y:300, w:140, h:60, label:'林荫道'},
    {t:'plant', x:940, y:560, w:36, h:36},
  ],
  doors:[ {x:430, y:530, w:140, h:40, to:'corridor', label:'回楼里'} ],
  spots:{ gate_east:[700,300], gate_west:[280,300] } },
];

/* 反查索引：id → 场景对象。world.js 里 SCENE_BY_ID['corridor'] 这种
   直接取值全靠它；（空对象 + forEach + 赋值）三行是本项目惯用套路。 */
const SCENE_BY_ID = {};
SCENES.forEach(s => SCENE_BY_ID[s.id] = s);
