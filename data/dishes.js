/**
 * 【演示数据】菜品清单（12 家 · 45 道）
 *
 * ⚠️ 菜名、价格、窗口、分类均为虚构演示内容，不代表任何真实商家。
 *
 * 字段：
 *   id       菜品唯一标识
 *   name     菜品名称
 *   price    价格（元，数字）
 *   foodType 主食类型（见下方枚举，必须是具体类型，不能写 'all'）
 *   shopId   所属餐厅 / 商家，对应 shops.js 中的 id
 *   stallId  所属窗口 / 档口，对应 shops.js 里该店铺 stalls 中的 id
 *   tastes   口味标签数组：light 清淡 / mild_spicy 微辣 / spicy 麻辣 / choice 可选辣度
 *
 * foodType 枚举（'all' 只给筛选器用，绝不写进菜品）：
 *   rice            饭类（盖饭、炒饭、套餐饭）
 *   noodle          面类（汤面、拌面、炒面）
 *   rice_noodle     米线类（与粉类分开，不合并）
 *   rice_vermicelli 粉类（米粉、河粉）
 *   dumpling        饺子馄饨类
 *   malatang        麻辣烫 / 冒菜类
 *   snack           面点小吃类（煎饼、包子、馒头）
 *   other           其他
 *
 * ————————————————————————————————————————————
 * 数据规约（加新菜前先读这三条，否则筛选会失真）
 * ————————————————————————————————————————————
 *
 * 【规约 1】辣度是单值：每道菜恰好一个口味标签。
 *   tastes 用数组是给以后可能出现的「双重标签」留的结构，但演示数据一律只填一个。
 *   原因：清淡 / 微辣 / 麻辣 是同一维度的三个档位，互斥。一道菜如果同时挂「微辣」
 *        和「麻辣」，用户选「微辣」时会弹出明显偏辣的菜，筛选结果就不可信了。
 *   校验：校验脚本会断言每道菜的 tastes.length === 1。
 *
 *   【第四个值 choice】菜品本身不固定辣度、点单时由顾客选（如「微辣 / 麻辣 都能做」）。
 *     · 它不是第四个「档位」，而是「辣度不由菜决定」这一事实，所以仍然只能单独出现。
 *     · 筛选语义：用户选清淡 / 微辣 / 麻辣 时，choice 的菜**都算命中**（因为都点得出来）；
 *       选「不限」当然也命中。实现见 utils/matcher.js 的 hasAnyTaste。
 *     · 判据：价目表或店家明确说明「辣度可选 / 可调」才填 choice。
 *       价目表什么都没标、你也没问到 → 不填、不猜，先在采集表备注里记，回头补。
 *
 * 【规约 2】一个记录 = 一个确定的「菜名 + 价格 + 辣度」组合。
 *   · 价格不同 → 必须拆成两条独立记录（各有 id）。
 *     因为价格是独立字段，预算筛选直接读它；塞进同一条会让预算判断失真。
 *     正例：牛肉面（小碗 10）/（大碗 13）/（加肉 18）、黄焖鸡米饭（小份 15）/（大份 20）。
 *   · 价格相同、只是口味不同 → 按实际售卖方式决定拆不拆，避免无意义的重复展示。
 *     本项目按产品决策，把「香辣鸡腿饭」拆成（微辣）与（麻辣）两条：它们是分开点单的两种做法。
 *     ⚠️ 两者价格均为 14 元，是按原演示价保留的——真实售价未核实，不编造差价。
 *   · 规格写进菜名，用（ ）标注，便于用户和我自己一眼分辨。
 *
 * 【规约 3】菜品不写楼层，也不写位置文本。
 *   只存 shopId + stallId。楼层、窗口名、位置、类型中文全部由 data/index.js 反查拼装。
 *   这样店铺配置一改，所有菜品自动跟着变，不会出现「店铺表改了、菜品表里的旧楼层没改」。
 *
 * 注意：菜品不直接写「2 号窗口」这种文本，只存 stallId。
 *      窗口名、楼层、位置、主食类型中文由 data/index.js 统一拼好。
 *
 * 设计要点：
 *   1. 价格覆盖 5 ~ 26 元，10 / 15 / 20 三档预算都有区分度
 *   2. 八个主食分类全部有菜，不存在「点了就必然空」的死分类
 *   3. 每个窗口至少有一道菜，选到任何窗口都不会出现空结果
 *   4. 米线类故意跨 11 / 12 / 13 / 16 四档价格，用来验证预算联动
 *   5. 故意保留无结果组合，用于验证空态提示
 */
const DISHES_RAW = [
  /* ===== 一号食堂 s01（1 楼：1 号窗口 / 2 楼：2、5 号窗口）===== */
  { id: 'd01', name: '红烧肉盖饭',   price: 12, foodType: 'rice', shopId: 's01', stallId: 's01_t2', tastes: ['light'] },
  { id: 'd02', name: '番茄炒蛋盖饭', price: 8,  foodType: 'rice', shopId: 's01', stallId: 's01_t1', tastes: ['light'] },
  { id: 'd03', name: '宫保鸡丁盖饭', price: 12, foodType: 'rice', shopId: 's01', stallId: 's01_t3', tastes: ['mild_spicy'] },
  { id: 'd39', name: '番茄鸡蛋米线', price: 11, foodType: 'rice_noodle', shopId: 's01', stallId: 's01_t1', tastes: ['light'] },

  /* ===== 二号食堂 s02（1 楼：1、9 号窗口）===== */
  { id: 'd04', name: '三鲜包子（4 个）', price: 5,  foodType: 'snack', shopId: 's02', stallId: 's02_t1', tastes: ['light'] },
  { id: 'd05', name: '小米粥 + 鸡蛋饼',  price: 6,  foodType: 'snack', shopId: 's02', stallId: 's02_t1', tastes: ['light'] },
  { id: 'd06', name: '麻辣烫（小份）',   price: 13, foodType: 'malatang', shopId: 's02', stallId: 's02_t2', tastes: ['spicy'] },
  { id: 'd37', name: '麻辣米线（小份）', price: 13, foodType: 'rice_noodle', shopId: 's02', stallId: 's02_t2', tastes: ['spicy'] },
  { id: 'd42', name: '牛肉米粉',         price: 11, foodType: 'rice_vermicelli', shopId: 's02', stallId: 's02_t2', tastes: ['mild_spicy'] },

  /* ===== 三号食堂 s03（1 楼：1、3 号窗口 / 2 楼：7 号窗口）===== */
  { id: 'd07', name: '香辣鸡腿饭（微辣）', price: 14, foodType: 'rice', shopId: 's03', stallId: 's03_t2', tastes: ['mild_spicy'] },
  { id: 'd45', name: '香辣鸡腿饭（麻辣）', price: 14, foodType: 'rice', shopId: 's03', stallId: 's03_t2', tastes: ['spicy'] },
  { id: 'd08', name: '清炒时蔬套餐', price: 9,  foodType: 'rice', shopId: 's03', stallId: 's03_t1', tastes: ['light'] },
  { id: 'd09', name: '酸菜鱼（小份）', price: 18, foodType: 'rice', shopId: 's03', stallId: 's03_t3', tastes: ['spicy'] },

  /* ===== 清真食堂 s04（1 楼：1、2、3 号窗口）===== */
  { id: 'd10', name: '牛肉拉面',     price: 12, foodType: 'noodle', shopId: 's04', stallId: 's04_t2', tastes: ['light'] },
  { id: 'd11', name: '手抓饭',       price: 15, foodType: 'rice', shopId: 's04', stallId: 's04_t1', tastes: ['light'] },
  { id: 'd12', name: '大盘鸡拌面',   price: 26, foodType: 'noodle', shopId: 's04', stallId: 's04_t3', tastes: ['spicy'] },

  /* ===== 东区食堂 s05（无楼层划分，只有档口）===== */
  { id: 'd13', name: '一荤两素套餐', price: 10, foodType: 'rice', shopId: 's05', stallId: 's05_t1', tastes: ['light'] },
  { id: 'd14', name: '西红柿鸡蛋面', price: 8,  foodType: 'noodle', shopId: 's05', stallId: 's05_t2', tastes: ['light'] },
  { id: 'd43', name: '猪肉白菜饺子（10 个）', price: 10, foodType: 'dumpling', shopId: 's05', stallId: 's05_t2', tastes: ['light'] },
  { id: 'd15', name: '水煮肉片',     price: 16, foodType: 'other', shopId: 's05', stallId: 's05_t3', tastes: ['spicy'] },
  { id: 'd38', name: '砂锅米线',     price: 12, foodType: 'rice_noodle', shopId: 's05', stallId: 's05_t3', tastes: ['mild_spicy'] },

  /* ===== 教工食堂 s06（1 楼：热菜窗口）===== */
  { id: 'd16', name: '糖醋里脊',     price: 15, foodType: 'other', shopId: 's06', stallId: 's06_t1', tastes: ['light'] },
  { id: 'd17', name: '清蒸鱼块',     price: 22, foodType: 'other', shopId: 's06', stallId: 's06_t1', tastes: ['light'] },
  { id: 'd18', name: '麻婆豆腐盖饭', price: 10, foodType: 'rice', shopId: 's06', stallId: 's06_t1', tastes: ['spicy'] },

  /* ===== 南门烧烤摊 s07（校外：烧烤区 / 主食区）===== */
  { id: 'd19', name: '小饼卷肉（10 串）', price: 18, foodType: 'snack', shopId: 's07', stallId: 's07_t2', tastes: ['mild_spicy'] },
  { id: 'd20', name: '烤蔬菜拼盘',        price: 9,  foodType: 'other', shopId: 's07', stallId: 's07_t1', tastes: ['light'] },
  { id: 'd21', name: '烤五花肉（半份）',  price: 22, foodType: 'other', shopId: 's07', stallId: 's07_t1', tastes: ['mild_spicy'] },

  /* ===== 西门卤肉饭 s08（校外：前台）===== */
  { id: 'd22', name: '卤肉饭',         price: 14, foodType: 'rice', shopId: 's08', stallId: 's08_t1', tastes: ['light'] },
  { id: 'd23', name: '卤肉 + 丸子双拼', price: 20, foodType: 'rice', shopId: 's08', stallId: 's08_t1', tastes: ['light'] },
  { id: 'd24', name: '素菜盖饭',       price: 8,  foodType: 'rice', shopId: 's08', stallId: 's08_t1', tastes: ['light'] },

  /* ===== 北门川菜馆 s09（校外：散座 / 外带档）===== */
  { id: 'd25', name: '回锅肉盖饭',   price: 15, foodType: 'rice', shopId: 's09', stallId: 's09_t1', tastes: ['mild_spicy'] },
  { id: 'd26', name: '鱼香肉丝盖饭', price: 14, foodType: 'rice', shopId: 's09', stallId: 's09_t1', tastes: ['mild_spicy'] },
  { id: 'd27', name: '干锅土豆片',   price: 12, foodType: 'other', shopId: 's09', stallId: 's09_t2', tastes: ['spicy'] },
  { id: 'd44', name: '冒菜（小份）', price: 15, foodType: 'malatang', shopId: 's09', stallId: 's09_t2', tastes: ['spicy'] },

  /* ===== 东门牛肉面 s10（校外：出餐口）===== */
  { id: 'd28', name: '牛肉面（小碗）', price: 10, foodType: 'noodle', shopId: 's10', stallId: 's10_t1', tastes: ['light'] },
  { id: 'd29', name: '牛肉面（大碗）', price: 13, foodType: 'noodle', shopId: 's10', stallId: 's10_t1', tastes: ['light'] },
  { id: 'd30', name: '加肉牛肉面',     price: 18, foodType: 'noodle', shopId: 's10', stallId: 's10_t1', tastes: ['light'] },
  { id: 'd41', name: '牛肉米线',       price: 16, foodType: 'rice_noodle', shopId: 's10', stallId: 's10_t1', tastes: ['light'] },

  /* ===== 黄焖鸡店 s11（校外：出餐口）===== */
  { id: 'd31', name: '黄焖鸡米饭（小份）', price: 15, foodType: 'rice', shopId: 's11', stallId: 's11_t1', tastes: ['mild_spicy'] },
  { id: 'd32', name: '黄焖鸡米饭（大份）', price: 20, foodType: 'rice', shopId: 's11', stallId: 's11_t1', tastes: ['mild_spicy'] },
  { id: 'd33', name: '黄焖排骨米饭',       price: 18, foodType: 'rice', shopId: 's11', stallId: 's11_t1', tastes: ['mild_spicy'] },

  /* ===== 小吃店 s12（校外：前台 / 蒸煮档）===== */
  { id: 'd34', name: '拌面 + 扁肉', price: 9,  foodType: 'noodle', shopId: 's12', stallId: 's12_t1', tastes: ['light'] },
  { id: 'd35', name: '蒸饺',        price: 8,  foodType: 'dumpling', shopId: 's12', stallId: 's12_t2', tastes: ['light'] },
  { id: 'd36', name: '炒米粉',      price: 10, foodType: 'rice_vermicelli', shopId: 's12', stallId: 's12_t1', tastes: ['mild_spicy'] },
  { id: 'd40', name: '酸辣粉',      price: 8,  foodType: 'rice_vermicelli', shopId: 's12', stallId: 's12_t1', tastes: ['spicy'] }
];

/* ------------------------------------------------------------------
   可信度字段注入
   每道菜带 source / verifyStatus / verifiedAt。本阶段全部是演示数据，
   统一标 demo，verifiedAt 为 null。
   注意：菜品的可信度还要和它挂的店铺 / 楼层 / 窗口合成，
   合成逻辑在 data/index.js，取「最弱一环」。
   ------------------------------------------------------------------ */
const { attachDemo } = require('./provenance');
const DISHES = attachDemo(DISHES_RAW, 'dish');

module.exports = { DISHES };
