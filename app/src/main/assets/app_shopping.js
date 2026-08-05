/**
 * app_shopping.js - 购物应用 (淘宝风格移动端电商)
 * 规范：纯原生全矢量 SVG 图标、禁用 Emoji、禁用原生弹窗、全部内联样式、IIFE 暴露 window.shoppingSystem
 * 依赖全局：getActiveApiPreset / fetchAIResponse / parseAIJsonList / showToast / showCustomAlert / showCustomPrompt / showCustomConfirm / escapeHtml / resolveAvatar / db (Dexie)
 */

(function () {
  // ============================================================
  //  0. 状态变量与常量
  // ============================================================
  let shoppingCurrentMode = 'shopping';        // 'shopping' | 'food'
  let shoppingCurrentCategory = '推荐';
  let shoppingProductCache = {};               // {category: [products]}
  let shoppingStoreCache = {};                 // {category: [stores]}
  let shoppingSelectedCartItems = new Set();
  let shoppingCheckoutItems = [];
  let shoppingCheckoutAddress = null;
  let shoppingCheckoutPayment = 'self';        // 'self' | 'other'
  let shoppingCheckoutPayerSession = null;
  let shoppingCheckoutMessage = '';
  let shoppingCouponAdded = false;

  // 内部辅助状态
  let shoppingCurrentStore = null;             // 当前打开的外卖店铺
  let shoppingStoreSelections = {};            // {productId: qty}
  let shoppingOrderTab = 'all';
  let shoppingDetailProduct = null;
  let shoppingCouponPlan = null;               // 本次结算随机抽中的神券方案
  let shoppingIsFoodCheckout = false;
  let shoppingTravelService = '机票';          // 旅游详情选择的服务类型
  let _gridProducts = [];
  let _gridStores = [];
  let _storeProducts = [];
  let _searchActive = false;
  let _searchQuery = '';

  // 神券抵扣：本次结算选中的已有神券（用于外卖抵扣）
  let shoppingDeductCoupon = null;             // {id, faceValue, inflated} 选中的抵扣神券
  let shoppingDeductCouponInflated = 0;        // 抵扣神券膨胀后面值
  let shoppingAvailableCoupons = [];           // 本次结算可用的神券列表
  let shoppingCheckoutCanUseCoupon = false;    // 本次结算的店铺是否支持神券
  // 0.01 加购神券：当无可用神券时点外卖触发
  let shoppingFlashCouponOffered = false;      // 本次结算是否已展示过 0.01 加购
  let shoppingFlashCouponAdded = false;        // 是否加购了 0.01 神券
  // 当前商品详情所属店铺（用于详情页"进店逛逛"）
  let shoppingDetailStore = null;

  const SHOPPING_CATEGORIES = ['推荐', '家居', '服饰', '个护', '美妆', '旅游', '运动', '户外', '数码', '超级立减', '汽车', '房地产'];
  const FOOD_CATEGORIES = ['小时达', '团购', '神券', '闪购', '看病买药', '水果'];

  const COUPON_PLANS = [
    { id: 'A', price: 3.2, count: 6, face: 5, days: 30, label: '3.2元加购 5元*6张神券，30天有效' },
    { id: 'B', price: 6.6, count: 4, face: 10, days: 30, label: '6.6元加购 10元*4张神券，30天有效' },
    { id: 'C', price: 1.9, count: 8, face: 3, days: 15, label: '1.9元加购 3元*8张神券，15天有效' }
  ];

  // 0.01 加购神券方案（神券为0时触发，本单可用一单回本）
  const FLASH_COUPON_PLAN = { id: 'FLASH', price: 0.01, count: 1, face: 5, days: 1, label: '0.01元加购 5元神券，本单立即可用' };

  // ============================================================
  //  0.1 预设商品目录（每分类 8 个，含 SVG 图标匹配关键词）
  // ============================================================
  const PRESET_PRODUCTS = {
    '推荐': [
      { name: '北欧极简台灯', price: 89.0, originalPrice: 129.0, desc: '温馨暖光，营造居家氛围', freeShip: true, insured: true },
      { name: '纯棉圆领T恤', price: 49.9, originalPrice: 79.9, desc: '亲肤透气，多色可选', freeShip: true, insured: false },
      { name: '便携保温杯', price: 39.9, originalPrice: 59.9, desc: '316不锈钢，长效保温', freeShip: true, insured: true },
      { name: '无线蓝牙耳机', price: 129.0, originalPrice: 199.0, desc: '高清音质，长效续航', freeShip: true, insured: true },
      { name: '多功能收纳盒', price: 29.9, originalPrice: 45.0, desc: '分层收纳，节省空间', freeShip: false, insured: false },
      { name: '香薰精油礼盒', price: 79.0, originalPrice: 118.0, desc: '天然植物精油，助眠安神', freeShip: true, insured: true },
      { name: '北欧风挂钟', price: 99.0, originalPrice: 159.0, desc: '静音机芯，简约设计', freeShip: true, insured: true },
      { name: '便携充电宝', price: 89.0, originalPrice: 139.0, desc: '10000mAh，快充双向', freeShip: true, insured: true }
    ],
    '家居': [
      { name: '北欧风布艺沙发', price: 1599.0, originalPrice: 2199.0, desc: '可拆洗布艺，三人位', freeShip: true, insured: true },
      { name: '实木餐桌椅组合', price: 1299.0, originalPrice: 1799.0, desc: '橡木材质，一桌四椅', freeShip: true, insured: true },
      { name: '加厚乳胶枕', price: 79.0, originalPrice: 129.0, desc: '泰国乳胶，护颈椎', freeShip: true, insured: false },
      { name: '全棉四件套', price: 159.0, originalPrice: 259.0, desc: '60支纯棉，亲肤柔软', freeShip: true, insured: true },
      { name: '北欧极简台灯', price: 89.0, originalPrice: 129.0, desc: '温馨暖光，三档调光', freeShip: true, insured: true },
      { name: '多功能收纳盒', price: 29.9, originalPrice: 45.0, desc: '三层收纳，带盖防尘', freeShip: false, insured: false },
      { name: '北欧风挂钟', price: 99.0, originalPrice: 159.0, desc: '静音扫秒，简约百搭', freeShip: true, insured: true },
      { name: '加湿器家用静音', price: 119.0, originalPrice: 179.0, desc: '大容量水箱，静音运行', freeShip: true, insured: true }
    ],
    '服饰': [
      { name: '纯棉圆领T恤', price: 49.9, originalPrice: 79.9, desc: '精梳棉，多色多码', freeShip: true, insured: false },
      { name: '修身牛仔裤', price: 129.0, originalPrice: 199.0, desc: '弹力面料，修身剪裁', freeShip: true, insured: false },
      { name: '针织开衫外套', price: 159.0, originalPrice: 239.0, desc: '柔软针织，春秋百搭', freeShip: true, insured: false },
      { name: '百搭连帽卫衣', price: 99.0, originalPrice: 159.0, desc: '加绒保暖，宽松版型', freeShip: true, insured: false },
      { name: '真丝印花丝巾', price: 89.0, originalPrice: 139.0, desc: '桑蚕丝，精美印花', freeShip: true, insured: true },
      { name: '商务皮鞋', price: 259.0, originalPrice: 399.0, desc: '头层牛皮，商务休闲', freeShip: true, insured: true },
      { name: '针织毛衣', price: 119.0, originalPrice: 179.0, desc: '羊毛混纺，柔软保暖', freeShip: true, insured: false },
      { name: '羽绒服', price: 399.0, originalPrice: 599.0, desc: '90%白鸭绒，轻便保暖', freeShip: true, insured: true }
    ],
    '个护': [
      { name: '便携电动牙刷', price: 99.0, originalPrice: 159.0, desc: '声波震动，IPX7防水', freeShip: true, insured: true },
      { name: '补水保湿面膜', price: 59.0, originalPrice: 99.0, desc: '玻尿酸补水，10片装', freeShip: true, insured: false },
      { name: '氨基酸洗面奶', price: 49.0, originalPrice: 79.0, desc: '温和清洁，不紧绷', freeShip: true, insured: false },
      { name: '负离子吹风机', price: 139.0, originalPrice: 219.0, desc: '恒温护发，大风量', freeShip: true, insured: true },
      { name: '润肤身体乳', price: 39.9, originalPrice: 65.0, desc: '烟酰胺美白，保湿持久', freeShip: true, insured: false },
      { name: '清凉薄荷漱口水', price: 29.9, originalPrice: 45.0, desc: '0酒精，清新口气', freeShip: false, insured: false },
      { name: '手动剃须刀', price: 39.9, originalPrice: 65.0, desc: '三层刀片，顺滑剃须', freeShip: true, insured: false },
      { name: '洗发水', price: 49.0, originalPrice: 79.0, desc: '控油去屑，温和配方', freeShip: true, insured: false }
    ],
    '美妆': [
      { name: '丝绒哑光口红', price: 99.0, originalPrice: 159.0, desc: '丝绒雾面，持久不脱色', freeShip: true, insured: true },
      { name: '持妆粉底液', price: 129.0, originalPrice: 199.0, desc: '轻薄持妆，自然遮瑕', freeShip: true, insured: true },
      { name: '多色眼影盘', price: 89.0, originalPrice: 139.0, desc: '12色组合，显色持久', freeShip: true, insured: true },
      { name: '保湿精华液', price: 159.0, originalPrice: 239.0, desc: '烟酰胺精华，提亮肤色', freeShip: true, insured: true },
      { name: '清爽防晒霜', price: 69.0, originalPrice: 99.0, desc: 'SPF50+，清爽不油腻', freeShip: true, insured: false },
      { name: '定妆蜜粉饼', price: 79.0, originalPrice: 119.0, desc: '控油定妆，轻薄自然', freeShip: true, insured: true },
      { name: '指甲油', price: 29.9, originalPrice: 49.0, desc: '快干持久，多色可选', freeShip: false, insured: false },
      { name: '香水', price: 199.0, originalPrice: 299.0, desc: '清新花果香，持久留香', freeShip: true, insured: true }
    ],
    '旅游': [
      { name: '经济舱单程机票', price: 480.0, originalPrice: 680.0, desc: '国内主要城市，灵活选择', freeShip: true, insured: true, type: 'travel' },
      { name: '高铁二等座车票', price: 320.0, originalPrice: 420.0, desc: '全国高铁网络，便捷出行', freeShip: true, insured: true, type: 'travel' },
      { name: '精品连锁旅馆', price: 299.0, originalPrice: 459.0, desc: '市中心位置，含双早', freeShip: true, insured: true, type: 'travel' },
      { name: '机场专车接送', price: 89.0, originalPrice: 139.0, desc: '专车直达，行李无忧', freeShip: true, insured: true, type: 'travel' },
      { name: '周边温泉度假村', price: 599.0, originalPrice: 899.0, desc: '一晚住宿+双温泉门票', freeShip: true, insured: true, type: 'travel' },
      { name: '海岛跟团游', price: 1999.0, originalPrice: 2799.0, desc: '5天4晚，机票酒店全包', freeShip: true, insured: true, type: 'travel' },
      { name: '主题公园门票', price: 359.0, originalPrice: 459.0, desc: '一票畅玩，含热门项目', freeShip: true, insured: true, type: 'travel' },
      { name: '租车自驾日租', price: 159.0, originalPrice: 239.0, desc: '经济车型，含基础保险', freeShip: true, insured: true, type: 'travel' }
    ],
    '运动': [
      { name: '专业跑步运动鞋', price: 259.0, originalPrice: 399.0, desc: '减震回弹，透气网面', freeShip: true, insured: true },
      { name: '加厚瑜伽垫', price: 79.0, originalPrice: 119.0, desc: 'TPE材质，防滑加厚', freeShip: true, insured: false },
      { name: '可调节哑铃', price: 159.0, originalPrice: 239.0, desc: '可调重量，家用健身', freeShip: true, insured: true },
      { name: '速干运动套装', price: 119.0, originalPrice: 179.0, desc: '速干面料，运动透气', freeShip: true, insured: false },
      { name: '智能跳绳', price: 39.9, originalPrice: 65.0, desc: '计数显示，无线蓝牙', freeShip: true, insured: false },
      { name: '骑行头盔', price: 99.0, originalPrice: 149.0, desc: '一体成型，轻便透气', freeShip: true, insured: true },
      { name: '羽毛球拍', price: 129.0, originalPrice: 199.0, desc: '碳素纤维，轻量耐用', freeShip: true, insured: true },
      { name: '篮球', price: 89.0, originalPrice: 139.0, desc: 'PU材质，室内外通用', freeShip: true, insured: false }
    ],
    '户外': [
      { name: '全自动防晒帐篷', price: 299.0, originalPrice: 459.0, desc: '3秒速开，防雨防晒', freeShip: true, insured: true },
      { name: '专业登山背包', price: 199.0, originalPrice: 299.0, desc: '40L大容量，减压背负', freeShip: true, insured: true },
      { name: '便携户外折叠椅', price: 79.0, originalPrice: 119.0, desc: '铝合金架，承重120kg', freeShip: true, insured: false },
      { name: '保温保冷水壶', price: 59.0, originalPrice: 89.0, desc: '不锈钢真空，双层保温', freeShip: true, insured: false },
      { name: '冲锋衣外套', price: 359.0, originalPrice: 539.0, desc: '防风防雨，三合一', freeShip: true, insured: true },
      { name: '便携露营灯', price: 69.0, originalPrice: 99.0, desc: '太阳能充电，三档调光', freeShip: true, insured: false },
      { name: '登山杖', price: 89.0, originalPrice: 139.0, desc: '碳纤维，可伸缩调节', freeShip: true, insured: true },
      { name: '睡袋', price: 159.0, originalPrice: 239.0, desc: '棉木棉，舒适温标5℃', freeShip: true, insured: true }
    ],
    '数码': [
      { name: '无线蓝牙耳机', price: 129.0, originalPrice: 199.0, desc: '降噪芯片，超长续航', freeShip: true, insured: true },
      { name: '智能运动手环', price: 159.0, originalPrice: 239.0, desc: '心率监测，消息提醒', freeShip: true, insured: true },
      { name: '便携充电宝', price: 89.0, originalPrice: 139.0, desc: '10000mAh，双向快充', freeShip: true, insured: true },
      { name: '机械键盘', price: 199.0, originalPrice: 299.0, desc: '青轴段落感，RGB背光', freeShip: true, insured: true },
      { name: '4K高清摄像头', price: 259.0, originalPrice: 399.0, desc: '自动对焦，直播专用', freeShip: true, insured: true },
      { name: '降噪头戴耳机', price: 399.0, originalPrice: 599.0, desc: '主动降噪，Hi-Res认证', freeShip: true, insured: true },
      { name: '无线鼠标', price: 79.0, originalPrice: 119.0, desc: '静音按键，2.4G无线', freeShip: true, insured: false },
      { name: '手机', price: 2199.0, originalPrice: 2799.0, desc: '5G旗舰，三摄影像系统', freeShip: true, insured: true }
    ],
    '超级立减': [
      { name: '爆款立减保温杯', price: 29.9, originalPrice: 79.9, desc: '限时立减50元', freeShip: true, insured: true },
      { name: '限时立减扫地机', price: 699.0, originalPrice: 1299.0, desc: '直降600元，智能规划', freeShip: true, insured: true },
      { name: '直降蓝牙音箱', price: 89.0, originalPrice: 199.0, desc: '立减110元，立体声', freeShip: true, insured: true },
      { name: '特惠立减电饭煲', price: 159.0, originalPrice: 299.0, desc: '直降140元，4L容量', freeShip: true, insured: true },
      { name: '清仓立减吹风机', price: 79.0, originalPrice: 179.0, desc: '立减100元，负离子', freeShip: true, insured: true },
      { name: '秒杀立减榨汁机', price: 99.0, originalPrice: 219.0, desc: '立减120元，便携式', freeShip: true, insured: true },
      { name: '立减电热水壶', price: 49.9, originalPrice: 99.9, desc: '直降50元，1.8L大容量', freeShip: true, insured: false },
      { name: '立减电动牙刷', price: 69.0, originalPrice: 159.0, desc: '立减90元，声波清洁', freeShip: true, insured: true }
    ],
    '汽车': [
      { name: '都市纯电轿车', price: 128900, originalPrice: 139900, desc: '500km续航，智能座舱', freeShip: true, insured: true, type: 'car', brand: '品牌A', model: '纯电舒适版', displacement: '纯电', color: '极光白' },
      { name: '紧凑型SUV', price: 159900, originalPrice: 172900, desc: '1.5T动力，全景天窗', freeShip: true, insured: true, type: 'car', brand: '品牌B', model: 'SUV精英版', displacement: '1.5T', color: '星空黑' },
      { name: '中大型MPV', price: 239900, originalPrice: 259900, desc: '7座大空间，商务首选', freeShip: true, insured: true, type: 'car', brand: '品牌C', model: 'MPV豪华版', displacement: '2.0T', color: '香槟金' },
      { name: '运动型轿跑', price: 289900, originalPrice: 319900, desc: '2.0T高功率，运动套件', freeShip: true, insured: true, type: 'car', brand: '品牌D', model: '轿跑运动版', displacement: '2.0T', color: '赛道红' },
      { name: '家用皮卡', price: 129900, originalPrice: 145900, desc: '柴油2.4T，越野能力强', freeShip: true, insured: true, type: 'car', brand: '品牌E', model: '皮卡柴油版', displacement: '2.4T', color: '沙漠黄' },
      { name: '新能源微型车', price: 59900, originalPrice: 69900, desc: '城市代步，停车方便', freeShip: true, insured: true, type: 'car', brand: '品牌F', model: '微型代步版', displacement: '纯电', color: '薄荷绿' },
      { name: '豪华中大型轿车', price: 389900, originalPrice: 429900, desc: '3.0T V6，行政级座驾', freeShip: true, insured: true, type: 'car', brand: '品牌G', model: '行政豪华版', displacement: '3.0T', color: '玛瑙黑' },
      { name: '硬派越野车', price: 359900, originalPrice: 399900, desc: '非承载车身，三把锁', freeShip: true, insured: true, type: 'car', brand: '品牌H', model: '越野旗舰版', displacement: '3.0T', color: '迷彩绿' }
    ],
    '房地产': [
      { name: '阳光城邦三居室', price: 2380000, desc: '南北通透，精装交付', freeShip: true, insured: true, type: 'realty', area: 119, layout: '三室两厅', floor: '中楼层', orientation: '南北向', location: '城东核心区' },
      { name: '江景平层公寓', price: 5680000, desc: '一线江景，大平层设计', freeShip: true, insured: true, type: 'realty', area: 168, layout: '四室两厅', floor: '高楼层', orientation: '南向江景', location: '江滨大道' },
      { name: '学区两房精装', price: 1880000, desc: '重点学区，拎包入住', freeShip: true, insured: true, type: 'realty', area: 89, layout: '两室一厅', floor: '低楼层', orientation: '南向', location: '老城学区' },
      { name: '地铁口LOFT', price: 980000, desc: '4.5米层高，双层空间', freeShip: true, insured: true, type: 'realty', area: 55, layout: 'LOFT复式', floor: '中楼层', orientation: '东向', location: '地铁口商务区' },
      { name: '花园洋房别墅', price: 8880000, desc: '独栋别墅，私家花园', freeShip: true, insured: true, type: 'realty', area: 320, layout: '五室三厅', floor: '三层', orientation: '南北花园', location: '城西别墅区' },
      { name: '刚需小户型', price: 890000, desc: '总价低，适合首套', freeShip: true, insured: true, type: 'realty', area: 45, layout: '一室一厅', floor: '高楼层', orientation: '南向', location: '新城发展区' },
      { name: '商圈精装公寓', price: 1280000, desc: '商圈核心，投资自住两宜', freeShip: true, insured: true, type: 'realty', area: 62, layout: '一室一厅', floor: '中楼层', orientation: '南向', location: '中央商务区' },
      { name: '改善型四居室', price: 3680000, desc: '大面宽，双阳台设计', freeShip: true, insured: true, type: 'realty', area: 145, layout: '四室两厅', floor: '中楼层', orientation: '南北通透', location: '城北新区' }
    ]
  };

  // 预设外卖店铺（每分类 8 家，可使用神券的店铺带 useCoupon 标识）
  const PRESET_STORES = {
    '小时达': [
      { name: '鲜蜂便利店', rating: 4.8, deliveryFee: 3, deliveryTime: 25, desc: '社区便利，极速送达', useCoupon: false },
      { name: '极速达超市', rating: 4.7, deliveryFee: 2, deliveryTime: 20, desc: '日用杂货，齐全省心', useCoupon: false },
      { name: '社区便利精选', rating: 4.6, deliveryFee: 3, deliveryTime: 30, desc: '身边好物，方便快捷', useCoupon: false },
      { name: '二十四时便利店', rating: 4.7, deliveryFee: 4, deliveryTime: 35, desc: '24小时营业，随叫随到', useCoupon: false },
      { name: '同城急送商行', rating: 4.5, deliveryFee: 5, deliveryTime: 40, desc: '急件专送，品质保障', useCoupon: false },
      { name: '邻居小店', rating: 4.6, deliveryFee: 2, deliveryTime: 25, desc: '邻里好店，价格亲民', useCoupon: false },
      { name: '鲜蜂便利二店', rating: 4.7, deliveryFee: 3, deliveryTime: 28, desc: '生鲜水果，一站购齐', useCoupon: false },
      { name: '快达日用超市', rating: 4.6, deliveryFee: 3, deliveryTime: 30, desc: '日用百货，应有尽有', useCoupon: false }
    ],
    '团购': [
      { name: '老王烧烤团', rating: 4.7, deliveryFee: 0, deliveryTime: 35, desc: '人气烧烤，多人套餐', useCoupon: true },
      { name: '胖嫂饺子馆', rating: 4.8, deliveryFee: 0, deliveryTime: 30, desc: '手工水饺，皮薄馅大', useCoupon: true },
      { name: '蜀地火锅团', rating: 4.6, deliveryFee: 0, deliveryTime: 40, desc: '川味火锅，麻辣鲜香', useCoupon: true },
      { name: '韩式炸鸡团', rating: 4.7, deliveryFee: 0, deliveryTime: 35, desc: '韩式炸鸡，啤酒绝配', useCoupon: true },
      { name: '日料拼盘团', rating: 4.5, deliveryFee: 0, deliveryTime: 40, desc: '精致日料，多人分享', useCoupon: false },
      { name: '广式早茶团', rating: 4.8, deliveryFee: 0, deliveryTime: 30, desc: '正宗粤式，茶点丰盛', useCoupon: true },
      { name: '川菜小炒团', rating: 4.6, deliveryFee: 0, deliveryTime: 35, desc: '家常川菜，下饭神器', useCoupon: false },
      { name: '海鲜大咖团', rating: 4.7, deliveryFee: 0, deliveryTime: 45, desc: '鲜活海鲜，多人畅享', useCoupon: true }
    ],
    '神券': [
      { name: '神券炸鸡店', rating: 4.8, deliveryFee: 2, deliveryTime: 30, desc: '招牌炸鸡，神券可用', useCoupon: true },
      { name: '神券奶茶铺', rating: 4.9, deliveryFee: 1, deliveryTime: 25, desc: '现做奶茶，神券可用', useCoupon: true },
      { name: '神券汉堡屋', rating: 4.7, deliveryFee: 2, deliveryTime: 30, desc: '经典汉堡，神券可用', useCoupon: true },
      { name: '神券米线馆', rating: 4.6, deliveryFee: 2, deliveryTime: 30, desc: '云南米线，神券可用', useCoupon: true },
      { name: '神券烤肉饭', rating: 4.7, deliveryFee: 2, deliveryTime: 30, desc: '烤肉盖饭，神券可用', useCoupon: true },
      { name: '神券甜品站', rating: 4.8, deliveryFee: 1, deliveryTime: 25, desc: '精致甜品，神券可用', useCoupon: true },
      { name: '神券披萨店', rating: 4.7, deliveryFee: 3, deliveryTime: 35, desc: '现烤披萨，神券可用', useCoupon: true },
      { name: '神券寿司屋', rating: 4.6, deliveryFee: 2, deliveryTime: 30, desc: '现做寿司，神券可用', useCoupon: true }
    ],
    '闪购': [
      { name: '闪购水果行', rating: 4.7, deliveryFee: 2, deliveryTime: 25, desc: '当季水果，闪购直送', useCoupon: false },
      { name: '闪购鲜花坊', rating: 4.8, deliveryFee: 3, deliveryTime: 30, desc: '鲜花速递，浪漫送达', useCoupon: false },
      { name: '闪购蛋糕店', rating: 4.6, deliveryFee: 4, deliveryTime: 35, desc: '生日蛋糕，闪购专送', useCoupon: false },
      { name: '闪购便利店', rating: 4.5, deliveryFee: 2, deliveryTime: 25, desc: '应急日用，闪购速达', useCoupon: false },
      { name: '闪购医药房', rating: 4.7, deliveryFee: 2, deliveryTime: 25, desc: '常备药品，闪购应急', useCoupon: false },
      { name: '闪购数码配', rating: 4.6, deliveryFee: 3, deliveryTime: 30, desc: '数码配件，闪购直达', useCoupon: false },
      { name: '闪购母婴店', rating: 4.7, deliveryFee: 2, deliveryTime: 28, desc: '母婴用品，闪购速送', useCoupon: false },
      { name: '闪购宠物店', rating: 4.6, deliveryFee: 3, deliveryTime: 30, desc: '宠物用品，闪购到家', useCoupon: false }
    ],
    '看病买药': [
      { name: '健康大药房', rating: 4.8, deliveryFee: 0, deliveryTime: 30, desc: '处方非处方，专业药师', useCoupon: false },
      { name: '仁心药房', rating: 4.7, deliveryFee: 0, deliveryTime: 30, desc: '诚信经营，正品保障', useCoupon: false },
      { name: '便民医药房', rating: 4.6, deliveryFee: 1, deliveryTime: 25, desc: '社区便民，急用药速达', useCoupon: false },
      { name: '康泰大药房', rating: 4.7, deliveryFee: 0, deliveryTime: 30, desc: '中西药齐全，品类丰富', useCoupon: false },
      { name: '二十四小时药房', rating: 4.8, deliveryFee: 2, deliveryTime: 35, desc: '24小时，随叫随到', useCoupon: false },
      { name: '社区便民药', rating: 4.5, deliveryFee: 0, deliveryTime: 25, desc: '常用药品，价格亲民', useCoupon: false },
      { name: '中医馆大药房', rating: 4.7, deliveryFee: 1, deliveryTime: 35, desc: '中药材，代煎服务', useCoupon: false },
      { name: '眼科专科药房', rating: 4.6, deliveryFee: 2, deliveryTime: 30, desc: '眼药护眼，专业配送', useCoupon: false }
    ],
    '水果': [
      { name: '鲜果时光', rating: 4.8, deliveryFee: 2, deliveryTime: 30, desc: '鲜切水果，现做现送', useCoupon: true },
      { name: '果园直供行', rating: 4.7, deliveryFee: 3, deliveryTime: 35, desc: '产地直供，新鲜直达', useCoupon: true },
      { name: '每日鲜果铺', rating: 4.6, deliveryFee: 2, deliveryTime: 30, desc: '当季时令，每日上新', useCoupon: true },
      { name: '热带水果汇', rating: 4.7, deliveryFee: 4, deliveryTime: 40, desc: '热带水果，丰富选择', useCoupon: false },
      { name: '当季水果店', rating: 4.6, deliveryFee: 2, deliveryTime: 30, desc: '应季水果，品质之选', useCoupon: true },
      { name: '精品水果屋', rating: 4.8, deliveryFee: 3, deliveryTime: 30, desc: '精品礼盒，送礼佳选', useCoupon: true },
      { name: '鲜果切拼盘', rating: 4.5, deliveryFee: 2, deliveryTime: 25, desc: '现切拼盘，即食方便', useCoupon: false },
      { name: '进口水果专营', rating: 4.7, deliveryFee: 5, deliveryTime: 40, desc: '全球进口，品质保证', useCoupon: true }
    ]
  };

  // 预设店铺菜单（按店铺名映射，保证有 SVG 图标匹配）
  const PRESET_STORE_MENUS = {
    'default_food': [
      { name: '招牌套餐', price: 28.5, desc: '招牌主菜+米饭+汤' },
      { name: '精品小炒', price: 22.0, desc: '现炒时蔬，下饭' },
      { name: '招牌盖浇饭', price: 18.0, desc: '浓汁浇饭，量大' },
      { name: '人气双人餐', price: 58.0, desc: '两荤一素一汤' },
      { name: '招牌饮品', price: 12.0, desc: '现做奶茶/果汁' },
      { name: '时蔬拼盘', price: 15.0, desc: '当季时蔬，健康' },
      { name: '特色汤品', price: 16.0, desc: '老火慢炖，营养' },
      { name: '人气甜品', price: 14.0, desc: '现做甜品，解腻' }
    ]
  };

  // 购物模式（非外卖）各分类对应的真实店铺名池（每分类 8 家，贴合品类调性）
  // 解决"购物店铺里全是外卖食品/官方旗舰店"的不真实问题
  const SHOP_CATEGORY_STORES = {
    '推荐': ['品质生活馆', '优品甄选百货', '潮品集结号', '臻选好物铺', '生活美学馆', '严选百货商城', '品质甄选店', '优品生活馆'],
    '家居': ['北欧家居生活馆', '实木匠人家具', '简约家居甄选', '匠心家居铺', '优居家俬馆', '暖窝家具优选', '家居美学馆', '木语家居铺'],
    '服饰': ['潮搭服饰馆', '简约风尚服饰', '质感衣橱精选', '都市穿搭馆', '棉麻生活服饰', '轻熟风尚店', '街头潮牌铺', '优雅衣橱馆'],
    '个护': ['净透个护馆', '舒享护理铺', '清新个护甄选', '日常护理馆', '焕采个护店', '简护生活馆', '温和护理铺', '净颜个护店'],
    '美妆': ['焕颜美妆馆', '奢华美妆铺', '蜜颜美妆店', '魅妆甄选馆', '倾城美妆铺', '悦己美妆馆', '颜究美妆店', '绚彩美妆馆'],
    '旅游': ['环球旅途商旅', '悦行旅游服务', '飞鸟商旅网', '畅游旅行专营', '远方旅行铺', '途悦商旅馆', '随行旅游服务', '漫游旅行专营'],
    '运动': ['动力运动装备', '锐动体育用品', '跃动运动馆', '健身运动装备铺', '极速运动店', '活力体育甄选', '运动达人馆', '专业运动装备'],
    '户外': ['山野户外装备', '探路者户外铺', '越野户外专营', '荒野户外馆', '极地户外装备', '征途户外店', '旷野户外铺', '远行户外装备'],
    '数码': ['极客数码专营', '智能数码馆', '数码先锋铺', '潮流数码店', '优联数码专营', '数码生活馆', '优选数码铺', '极智数码店'],
    '超级立减': ['超值立减折扣', '钜惠折扣店', '限时折扣铺', '清仓特卖馆', '立减优惠店', '折扣精选铺', '特惠折扣店', '钜省立减馆'],
    '汽车': ['都市汽车销售', '驰骋汽车专营', '旗舰汽车展销', '恒通汽车销售', '优驾汽车馆', '耀行汽车专营', '悦驾汽车销售', '骏行汽车展销'],
    '房地产': ['城邦房产代理', '鑫居房产中介', '安家地产服务', '置业优选房产', '雅居房产经纪', '鑫源地产代理', '万家居房产', '优置业地产']
  };

  const PLACEHOLDER_COLORS = ['#f5a07a', '#e87d5e', '#f5b97a', '#7ec4cf', '#8cc63f', '#a888d9', '#6ca8e8', '#e891b5', '#f0c674', '#7a9fed', '#b8d96a', '#e88080', '#6cb8b0', '#8aa840'];

  // ============================================================
  //  1. 通用工具函数
  // ============================================================
  function pid() { return Number(localStorage.getItem("active_me_id")) || 0; }

  function walletKey() { return "wallet_balance_v1_" + pid(); }
  function getWalletBalance() {
    const v = localStorage.getItem(walletKey());
    if (v === null) { localStorage.setItem(walletKey(), "88888.00"); return 88888; }
    return parseFloat(v) || 0;
  }
  function setWalletBalance(n) { localStorage.setItem(walletKey(), n.toFixed(2)); }

  function fmtPrice(n) { return Number(n || 0).toFixed(2); }

  function profileKey() { return "shopping_profile_v1_" + pid(); }
  function getProfile() {
    try { return JSON.parse(localStorage.getItem(profileKey())) || {}; } catch (e) { return {}; }
  }
  function saveProfile(p) { localStorage.setItem(profileKey(), JSON.stringify(p)); }

  function genOrderNo() { return "SP" + Date.now() + String(Math.floor(Math.random() * 9000) + 1000); }

  // 商品/店铺缓存持久化（刷新后保留记录，不会一进就清空）
  function productCacheKey() { return 'shopping_product_cache_v1_' + pid(); }
  function storeCacheKey() { return 'shopping_store_cache_v1_' + pid(); }
  function loadPersistedProductCache() {
    try { return JSON.parse(localStorage.getItem(productCacheKey())) || {}; } catch (e) { return {}; }
  }
  function savePersistedProductCache(obj) {
    try { localStorage.setItem(productCacheKey(), JSON.stringify(obj || {})); } catch (e) {}
  }
  function loadPersistedStoreCache() {
    try { return JSON.parse(localStorage.getItem(storeCacheKey())) || {}; } catch (e) { return {}; }
  }
  function savePersistedStoreCache(obj) {
    try { localStorage.setItem(storeCacheKey(), JSON.stringify(obj || {})); } catch (e) {}
  }

  // 获取预设商品列表（8 个），并标注预设来源
  function getPresetProducts(category) {
    const list = PRESET_PRODUCTS[category] || PRESET_PRODUCTS['推荐'];
    return list.map(p => Object.assign({}, p, { category: category, _preset: true }));
  }
  // 获取预设店铺列表（8 个）
  function getPresetStores(category) {
    const list = PRESET_STORES[category] || PRESET_STORES['小时达'];
    return list.map(s => Object.assign({}, s, { _preset: true }));
  }
  // 获取店铺预设菜单（8 个，含 SVG 匹配关键词）
  function getPresetStoreMenu(storeName) {
    return (PRESET_STORE_MENUS['default_food'] || []).map((p, idx) => ({
      id: idx, name: p.name, price: p.price, desc: p.desc
    }));
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function resolveImg(avatar) {
    if (typeof resolveAvatar === 'function') return resolveAvatar(avatar);
    if (!avatar) return '';
    if (avatar instanceof Blob) return URL.createObjectURL(avatar);
    return avatar;
  }

  function colorForName(name) {
    let s = 0;
    for (let i = 0; i < (name || '').length; i++) s += name.charCodeAt(i);
    return PLACEHOLDER_COLORS[s % PLACEHOLDER_COLORS.length];
  }

  function initialOf(name) {
    return (name || '商').toString().charAt(0);
  }

  // 将颜色向白色混合（factor 0=原色, 1=白色）
  function tint(hex, factor) {
    var h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  // 商品图片渲染：优先匹配 SVG 图标，无匹配则首字占位
  function productImgHtml(name, w, h, fontSize) {
    var wStr = (typeof w === 'string') ? w : w + 'px';
    var hStr = (typeof h === 'string') ? h : h + 'px';
    var hNum = (typeof h === 'number') ? h : parseInt(h) || 100;
    var wNum = (typeof w === 'number') ? w : 100;
    var color = colorForName(name);
    var iconSize = Math.round(Math.min(wNum, hNum) * 0.55);
    var icon = (typeof getProductIcon === 'function') ? getProductIcon(name, iconSize) : null;
    if (icon) {
      return '<div style="width:' + wStr + ';height:' + hStr + ';background:linear-gradient(135deg,' + tint(color, 0.82) + ',' + tint(color, 0.68) + ');display:flex;align-items:center;justify-content:center;">' + icon + '</div>';
    }
    return '<div style="width:' + wStr + ';height:' + hStr + ';background:linear-gradient(135deg,' + tint(color, 0.1) + ',' + shade(color) + ');display:flex;align-items:center;justify-content:center;color:#fff;font-size:' + fontSize + 'px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,0.15);">' + esc(initialOf(name)) + '</div>';
  }

  // 鲁棒的 AI JSON 数组解析
  function parseList(text) {
    if (!text) return [];
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try { const v = JSON.parse(t); if (Array.isArray(v)) return v; } catch (e) { }
    const m = t.match(/\[[\s\S]*\]/);
    if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch (e) { } }
    if (typeof parseAIJsonList === 'function') {
      const v = parseAIJsonList(text);
      if (Array.isArray(v)) return v;
    }
    return [];
  }

  // 神券方案随机抽取（50% 概率出现）
  function rollCouponPlan() {
    if (Math.random() < 0.5) return null;
    return COUPON_PLANS[Math.floor(Math.random() * COUPON_PLANS.length)];
  }

  // ============================================================
  //  2. SVG 图标库（纯矢量，无 Emoji）
  // ============================================================
  const ICO = {
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
    starOutline: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    cart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
    truck: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    spinner: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#f5a07a" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" opacity="0.9"/><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></svg>'
  };

  function checkboxHtml(checked) {
    return '<div style="width:20px;height:20px;border-radius:50%;border:2px solid ' + (checked ? '#f5a07a' : '#ccc') + ';background:' + (checked ? '#f5a07a' : '#fff') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + (checked ? ICO.check : '') + '</div>';
  }

  // ============================================================
  //  3. 入口与导航
  // ============================================================

  // 当前激活的 tab（用于关闭 overlay 后恢复）
  let _activeTab = 'home';

  // overlay 栈：记录当前打开的子页面 overlay
  const OVERLAY_IDS = ['shopping-detail-overlay', 'shopping-store-overlay', 'shopping-checkout-overlay', 'shopping-addr-overlay'];

  // 打开子页面 overlay：隐藏大页头和底层面板，防止滚动穿透
  function showOverlay(overlayId) {
    const header = document.querySelector('#win-shopping > .win-header');
    if (header) header.style.display = 'none';
    document.querySelectorAll('.shopping-tab-panel').forEach(p => { p.style.display = 'none'; });
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.style.display = 'block';
  }

  // 关闭子页面 overlay：若无其他 overlay 打开，恢复大页头和当前 tab 面板
  function hideOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
    const anyOpen = OVERLAY_IDS.some(id => {
      const o = document.getElementById(id);
      return o && o.style.display !== 'none';
    });
    if (!anyOpen) {
      const header = document.querySelector('#win-shopping > .win-header');
      if (header) header.style.display = '';
      const panel = document.getElementById('shopping-tab-' + _activeTab);
      if (panel) panel.style.display = 'block';
    }
  }

  function init() {
    shoppingCurrentMode = 'shopping';
    shoppingCurrentCategory = '推荐';
    shoppingSelectedCartItems = new Set();
    // 加载持久化缓存（刷新后保留之前的商品/店铺记录）
    shoppingProductCache = loadPersistedProductCache();
    shoppingStoreCache = loadPersistedStoreCache();
    renderHome();
    updateCartBadge();
  }

  function switchTab(tab) {
    _activeTab = tab;
    const tabs = ['home', 'cart', 'mine'];
    tabs.forEach(t => {
      const panel = document.getElementById('shopping-tab-' + t);
      if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
      const btn = document.querySelector('.shopping-dock-tab[data-tab="' + t + '"]');
      if (btn) {
        const isActive = (t === tab);
        const svg = btn.querySelector('svg');
        const span = btn.querySelector('span');
        if (svg) svg.style.color = isActive ? '#f5a07a' : '#999';
        if (span) {
          span.style.color = isActive ? '#f5a07a' : '#999';
          span.style.fontWeight = isActive ? '700' : '600';
        }
        btn.classList.toggle('active', isActive);
      }
    });
    const title = document.getElementById('shopping-main-title');
    if (title) title.innerText = tab === 'cart' ? '购物车' : (tab === 'mine' ? '我的' : '购物');
    if (tab === 'home') renderHome();
    else if (tab === 'cart') renderCart();
    else if (tab === 'mine') renderMine();
  }

  // ============================================================
  //  4. 首页渲染
  // ============================================================
  function renderHome() {
    const container = document.getElementById('shopping-tab-home');
    if (!container) return;
    const modeBtn = (label, mode) => {
      const active = shoppingCurrentMode === mode;
      return '<button onclick="shoppingSystem.switchMode(\'' + mode + '\')" style="flex:1;padding:7px 0;border:none;border-radius:18px;font-size:13px;font-weight:700;cursor:pointer;background:' + (active ? '#fff' : 'transparent') + ';color:' + (active ? '#f5a07a' : '#fff') + ';opacity:' + (active ? '1' : '0.85') + ';">' + label + '</button>';
    };

    const cats = shoppingCurrentMode === 'shopping' ? SHOPPING_CATEGORIES : FOOD_CATEGORIES;
    let catHtml = '';
    cats.forEach(c => {
      const active = (c === shoppingCurrentCategory && !_searchActive);
      catHtml += '<button onclick="shoppingSystem.selectCategory(\'' + esc(c) + '\')" style="display:inline-block;padding:6px 14px;margin-right:8px;border:none;border-radius:14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;background:' + (active ? '#f5a07a' : '#fff') + ';color:' + (active ? '#fff' : '#333') + ';box-shadow:0 1px 3px rgba(0,0,0,0.06);">' + esc(c) + '</button>';
    });

    container.innerHTML =
      '<div style="background:#f5a07a;padding:8px 12px 10px;">' +
        '<div style="display:flex;gap:6px;background:rgba(255,255,255,0.25);border-radius:20px;padding:3px;margin-bottom:10px;">' +
          modeBtn('购物', 'shopping') + modeBtn('外卖', 'food') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:20px;padding:6px 10px;">' +
          '<input id="shopping-search-input" type="text" placeholder="搜索商品 / 店铺" style="flex:1;border:none;outline:none;font-size:13px;background:transparent;color:#333;font-family:inherit;" />' +
          '<button onclick="shoppingSystem.doSearch()" style="border:none;background:none;color:#f5a07a;cursor:pointer;display:flex;align-items:center;padding:2px;">' + ICO.search + '</button>' +
        '</div>' +
      '</div>' +
      '<div style="background:#fff;padding:10px 0 10px 12px;border-bottom:1px solid #eee;overflow-x:auto;white-space:nowrap;">' + catHtml + '</div>' +
      '<div id="shopping-list-area" style="padding:10px 8px 80px;"></div>';

    renderListArea();
  }

  function switchMode(mode) {
    if (shoppingCurrentMode === mode) return;
    shoppingCurrentMode = mode;
    _searchActive = false;
    _searchQuery = '';
    shoppingCurrentCategory = (mode === 'shopping') ? '推荐' : '小时达';
    renderHome();
  }

  function selectCategory(cat) {
    _searchActive = false;
    _searchQuery = '';
    shoppingCurrentCategory = cat;
    // 刷新分类高亮
    const btns = document.querySelectorAll('#shopping-tab-home button[onclick^="shoppingSystem.selectCategory"]');
    btns.forEach(b => {
      const m = b.getAttribute('onclick').match(/selectCategory\('(.+?)'\)/);
      const isAct = m && m[1] === cat;
      b.style.background = isAct ? '#f5a07a' : '#fff';
      b.style.color = isAct ? '#fff' : '#333';
    });
    renderListArea();
  }

  function doSearch() {
    const input = document.getElementById('shopping-search-input');
    const q = input ? input.value.trim() : '';
    if (!q) { showToast('请输入搜索关键词'); return; }
    if (shoppingCurrentMode === 'food') {
      showToast('外卖模式暂不支持搜索，请选择分类');
      return;
    }
    _searchActive = true;
    _searchQuery = q;
    delete shoppingProductCache[q];
    renderListArea(true);
  }

  function refreshProducts() {
    // 用户主动"换一批"：调用 AI 生成新一批（失败则随机打乱预设）
    if (_searchActive) {
      delete shoppingProductCache[_searchQuery];
      savePersistedProductCache(shoppingProductCache);
      aiRefreshProducts(_searchQuery);
    } else if (shoppingCurrentMode === 'shopping') {
      delete shoppingProductCache[shoppingCurrentCategory];
      savePersistedProductCache(shoppingProductCache);
      aiRefreshProducts(shoppingCurrentCategory);
    } else {
      delete shoppingStoreCache[shoppingCurrentCategory];
      savePersistedStoreCache(shoppingStoreCache);
      aiRefreshStores(shoppingCurrentCategory);
    }
  }

  function renderListArea(force) {
    const area = document.getElementById('shopping-list-area');
    if (!area) return;
    const title = _searchActive ? ('搜索: ' + _searchQuery) : shoppingCurrentCategory;
    const header =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px 8px;">' +
        '<span style="font-size:14px;font-weight:700;color:#333;">' + esc(title) + '</span>' +
        '<button onclick="shoppingSystem.refreshProducts()" style="border:none;background:#fff;color:#f5a07a;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:3px;padding:5px 10px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">' + ICO.refresh + '换一批</button>' +
      '</div>';

    if (shoppingCurrentMode === 'shopping') {
      const key = _searchActive ? _searchQuery : shoppingCurrentCategory;
      const cached = shoppingProductCache[key];
      if (cached && !force) {
        area.innerHTML = header + renderProductGrid(cached);
      } else {
        area.innerHTML = header + loadingHtml();
        generateProducts(key);
      }
    } else {
      const cached = shoppingStoreCache[shoppingCurrentCategory];
      if (cached && !force) {
        area.innerHTML = header + renderStoreGrid(cached);
      } else {
        area.innerHTML = header + loadingHtml();
        generateStores(shoppingCurrentCategory);
      }
    }
  }

  function loadingHtml() {
    return '<div style="text-align:center;padding:50px 0;color:#999;font-size:13px;">' +
      '<div style="margin-bottom:12px;">' + ICO.spinner + '</div>' +
      '<div>正在为你推荐好物...</div></div>';
  }

  // ============================================================
  //  5. AI 商品 / 店铺生成
  // ============================================================
  function buildProductPrompt(category) {
    if (category === '超级立减') {
      return '你是电商商品推荐引擎。请为「超级立减」特价分类生成6个商品，每个都必须有原价和立减价。严格按JSON数组返回：\n[{"name":"商品名","price":99.9,"originalPrice":199.0,"desc":"20字描述"}]\n只返回纯JSON，不要markdown。原价须大于立减价。';
    }
    if (category === '旅游') {
      return '你是旅游服务推荐引擎。请为「旅游」分类生成6个旅游服务商品（含机票/高铁/旅馆/打车等）。严格按JSON数组返回：\n[{"name":"服务名","price":399.0,"originalPrice":520.0,"desc":"20字描述"}]\n只返回纯JSON，不要markdown。';
    }
    if (category === '汽车') {
      return '你是汽车销售平台。请为「汽车」分类生成6款在售汽车（高价位）。严格按JSON数组返回：\n[{"name":"车型名","price":128900,"originalPrice":139900,"desc":"20字描述","brand":"品牌","model":"车型","displacement":"1.5T","color":"极光白"}]\n只返回纯JSON，不要markdown。';
    }
    if (category === '房地产') {
      return '你是房产平台。请为「房地产」分类生成6套房源（高价位）。严格按JSON数组返回：\n[{"name":"房源名","price":2380000,"desc":"20字描述","area":89,"layout":"三室两厅","floor":"中楼层","orientation":"南向","location":"城市地段"}]\n只返回纯JSON，不要markdown。价格单位元。';
    }
    return '你是电商商品推荐引擎。请为「' + category + '」分类生成6个商品。严格按JSON数组返回：\n[{"name":"商品名","price":99.9,"originalPrice":199.0,"desc":"20字描述"}]\n只返回纯JSON，不要markdown。价格合理，符合该分类。';
  }

  async function generateProducts(category) {
    // 优先使用预设商品（8 个，含 SVG 图标匹配），保证稳定且有图标
    // 仅当用户主动"换一批"时才尝试 AI 生成（refreshProducts 已删除缓存触发此处）
    try {
      let list;
      // 搜索场景：无预设，尝试 AI 生成
      if (_searchActive) {
        try {
          const api = await getActiveApiPreset();
          const res = await fetchAIResponse(api, '你是电商商品推荐引擎。请根据搜索关键词「' + category + '」生成8个相关商品。严格按JSON数组返回：\n[{"name":"商品名","price":99.9,"originalPrice":199.0,"desc":"20字描述","freeShip":true,"insured":true}]\n只返回纯JSON，不要markdown。');
          list = parseList(res);
        } catch (e) { list = []; }
        if (!list.length) list = fallbackProducts('推荐');
        list = list.slice(0, 8).map(p => normalizeProduct(p, category));
      } else {
        // 非搜索：使用预设商品目录
        list = getPresetProducts(category);
      }
      shoppingProductCache[category] = list;
      savePersistedProductCache(shoppingProductCache);
      const area = document.getElementById('shopping-list-area');
      if (area && (_searchActive ? _searchQuery === category : shoppingCurrentCategory === category)) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderProductGrid(list);
      }
    } catch (e) {
      const list = getPresetProducts(category);
      shoppingProductCache[category] = list;
      savePersistedProductCache(shoppingProductCache);
      const area = document.getElementById('shopping-list-area');
      if (area) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderProductGrid(list);
      }
    }
  }

  // AI 生成新一批商品（用户主动点"换一批"时调用）
  async function aiRefreshProducts(category) {
    try {
      const api = await getActiveApiPreset();
      const res = await fetchAIResponse(api, buildProductPrompt(category));
      let list = parseList(res);
      if (!list.length) list = fallbackProducts(category);
      list = list.slice(0, 8).map(p => normalizeProduct(p, category));
      shoppingProductCache[category] = list;
      savePersistedProductCache(shoppingProductCache);
      const area = document.getElementById('shopping-list-area');
      if (area && (_searchActive ? _searchQuery === category : shoppingCurrentCategory === category)) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderProductGrid(list);
      }
      showToast('已为你换一批');
    } catch (e) {
      // AI 失败：从预设中随机打乱顺序作为"新一批"
      const list = getPresetProducts(category).sort(() => Math.random() - 0.5);
      shoppingProductCache[category] = list;
      savePersistedProductCache(shoppingProductCache);
      const area = document.getElementById('shopping-list-area');
      if (area) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderProductGrid(list);
      }
      showToast('已为你换一批');
    }
  }

  function normalizeProduct(p, category) {
    let price = parseFloat(p.price);
    if (isNaN(price) || price <= 0) price = (Math.random() * 200 + 19.9);
    let original = parseFloat(p.originalPrice);
    if (category === '超级立减' && (isNaN(original) || original <= price)) original = price * 1.5;
    const out = {
      name: p.name || '精选好物',
      price: price,
      originalPrice: (!isNaN(original) && original > price) ? original : null,
      desc: p.desc || '',
      category: category,
      freeShip: (p.freeShip !== undefined) ? !!p.freeShip : true,
      insured: (p.insured !== undefined) ? !!p.insured : (Math.random() < 0.6)
    };
    if (category === '汽车') {
      out.brand = p.brand || '国产品牌';
      out.model = p.model || '舒适版';
      out.displacement = p.displacement || '1.5T';
      out.color = p.color || '极光白';
      out.type = 'car';
    }
    if (category === '房地产') {
      out.area = p.area || 89;
      out.layout = p.layout || '三室两厅';
      out.floor = p.floor || '中楼层';
      out.orientation = p.orientation || '南向';
      out.location = p.location || '城市核心地段';
      out.type = 'realty';
    }
    if (category === '旅游') out.type = 'travel';
    return out;
  }

  function fallbackProducts(category) {
    const names = {
      '推荐': ['北欧极简台灯', '纯棉圆领T恤', '便携保温杯', '无线蓝牙耳机', '多功能收纳盒', '香薰精油礼盒'],
      '家居': ['北欧风布艺沙发', '实木餐桌椅组合', '加厚乳胶枕', '全棉四件套', '北欧极简台灯', '多功能收纳盒'],
      '服饰': ['纯棉圆领T恤', '修身牛仔裤', '针织开衫外套', '百搭连帽卫衣', '真丝印花丝巾', '商务皮鞋'],
      '个护': ['便携电动牙刷', '补水保湿面膜', '氨基酸洗面奶', '负离子吹风机', '润肤身体乳', '清凉薄荷漱口水'],
      '美妆': ['丝绒哑光口红', '持妆粉底液', '多色眼影盘', '保湿精华液', '清爽防晒霜', '定妆蜜粉饼'],
      '旅游': ['经济舱单程机票', '高铁二等座车票', '精品连锁旅馆', '机场专车接送', '周边温泉度假村', '海岛跟团游'],
      '运动': ['专业跑步运动鞋', '加厚瑜伽垫', '可调节哑铃', '速干运动套装', '智能跳绳', '骑行头盔'],
      '户外': ['全自动防晒帐篷', '专业登山背包', '便携户外折叠椅', '保温保冷水壶', '冲锋衣外套', '便携露营灯'],
      '数码': ['无线蓝牙耳机', '智能运动手环', '便携充电宝', '机械键盘', '4K高清摄像头', '降噪头戴耳机'],
      '超级立减': ['爆款立减保温杯', '限时立减扫地机', '直降蓝牙音箱', '特惠立减电饭煲', '清仓立减吹风机', '秒杀立减榨汁机'],
      '汽车': ['都市纯电轿车', '紧凑型SUV', '中大型MPV', '运动型轿跑', '家用皮卡', '新能源微型车'],
      '房地产': ['阳光城邦三居室', '江景平层公寓', '学区两房精装', '地铁口LOFT', '花园洋房别墅', '刚需小户型']
    };
    const arr = names[category] || names['推荐'];
    return arr.map((n, i) => {
      const base = (category === '汽车') ? (80000 + i * 15000)
        : (category === '房地产') ? (1200000 + i * 380000)
        : (category === '超级立减') ? (29.9 + i * 30)
        : (19.9 + i * 40);
      return { name: n, price: base, originalPrice: category === '超级立减' ? base * 1.6 : base * 1.3, desc: '精选品质好物，限时优惠抢购' };
    });
  }

  function renderProductGrid(products) {
    _gridProducts = products || [];
    if (!_gridProducts.length) {
      return '<div style="text-align:center;padding:40px 0;color:#999;font-size:13px;">暂无商品，点击右上角换一批</div>';
    }
    // 瀑布流两列错落布局：商品图高度按名称哈希在 110-170 间随机，营造错落感
    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;">';
    _gridProducts.forEach((p, i) => {
      const color = colorForName(p.name);
      const showOri = (p.originalPrice && (shoppingCurrentCategory === '超级立减' || p.originalPrice > p.price));
      // 按名称哈希决定图片高度（110-170），错落有致
      let h = 110;
      for (let k = 0; k < (p.name || '').length; k++) h += (p.name.charCodeAt(k) % 60);
      h = Math.min(170, Math.max(110, h));
      // 包邮 / 运费险 标签
      const tagsHtml =
        (p.freeShip ? '<span style="display:inline-block;font-size:9px;color:#e87d5e;border:1px solid #f5c4b0;padding:0 4px;border-radius:3px;margin-right:3px;">包邮</span>' : '') +
        (p.insured ? '<span style="display:inline-block;font-size:9px;color:#7ec4cf;border:1px solid #b8e0e6;padding:0 4px;border-radius:3px;">运费险</span>' : '');
      html +=
        '<div onclick="shoppingSystem.openProductDetailByIdx(' + i + ')" style="background:#fff;border-radius:10px;overflow:hidden;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
          productImgHtml(p.name, '100%', h, 38) +
          '<div style="padding:8px;">' +
            '<div style="font-size:12px;color:#333;line-height:1.3;height:32px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + esc(p.name) + '</div>' +
            '<div style="margin-top:4px;display:flex;align-items:baseline;gap:5px;">' +
              '<span style="font-size:10px;color:#e87d5e;">¥</span><span style="font-size:16px;font-weight:700;color:#e87d5e;">' + fmtPrice(p.price) + '</span>' +
              (showOri ? '<span style="font-size:10px;color:#999;text-decoration:line-through;">¥' + fmtPrice(p.originalPrice) + '</span>' : '') +
            '</div>' +
            (tagsHtml ? '<div style="margin-top:5px;">' + tagsHtml + '</div>' : '') +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function shade(hex) {
    // 简单地把颜色加深用于渐变
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const r = Math.max(0, parseInt(h.slice(0, 2), 16) - 40);
    const g = Math.max(0, parseInt(h.slice(2, 4), 16) - 40);
    const b = Math.max(0, parseInt(h.slice(4, 6), 16) - 40);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  // ============================================================
  //  6. 外卖店铺
  // ============================================================
  async function generateStores(category) {
    // 优先使用预设店铺（8 家，含 SVG 图标匹配和神券标识）
    try {
      const list = getPresetStores(category);
      shoppingStoreCache[category] = list;
      savePersistedStoreCache(shoppingStoreCache);
      const area = document.getElementById('shopping-list-area');
      if (area && shoppingCurrentCategory === category) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderStoreGrid(list);
      }
    } catch (e) {
      const list = getPresetStores(category);
      shoppingStoreCache[category] = list;
      savePersistedStoreCache(shoppingStoreCache);
      const area = document.getElementById('shopping-list-area');
      if (area) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderStoreGrid(list);
      }
    }
  }

  // AI 生成新一批店铺（用户主动点"换一批"时调用）
  async function aiRefreshStores(category) {
    try {
      const api = await getActiveApiPreset();
      const prompt = '你是外卖平台推荐引擎。请为「' + category + '」分类生成8家店铺。严格按JSON数组返回：\n[{"name":"店铺名","rating":4.7,"deliveryFee":3,"deliveryTime":30,"desc":"15字描述","useCoupon":true}]\n只返回纯JSON，不要markdown。rating范围4.0-5.0，deliveryFee单位元，deliveryTime单位分钟，useCoupon表示是否支持神券。';
      const res = await fetchAIResponse(api, prompt);
      let list = parseList(res);
      if (!list.length) list = getPresetStores(category);
      list = list.slice(0, 8).map(normalizeStore);
      shoppingStoreCache[category] = list;
      savePersistedStoreCache(shoppingStoreCache);
      const area = document.getElementById('shopping-list-area');
      if (area && shoppingCurrentCategory === category) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderStoreGrid(list);
      }
      showToast('已为你换一批');
    } catch (e) {
      const list = getPresetStores(category).sort(() => Math.random() - 0.5);
      shoppingStoreCache[category] = list;
      savePersistedStoreCache(shoppingStoreCache);
      const area = document.getElementById('shopping-list-area');
      if (area) {
        const header = area.querySelector('div');
        const headerHtml = header ? header.outerHTML : '';
        area.innerHTML = headerHtml + renderStoreGrid(list);
      }
      showToast('已为你换一批');
    }
  }

  function normalizeStore(s) {
    return {
      name: s.name || '美味店铺',
      rating: Math.min(5, Math.max(4, parseFloat(s.rating) || (4 + Math.random()))),
      deliveryFee: parseFloat(s.deliveryFee) || 3,
      deliveryTime: parseInt(s.deliveryTime) || 30,
      desc: s.desc || '现做现送，品质之选',
      useCoupon: !!s.useCoupon
    };
  }

  function fallbackStores(category) {
    const names = {
      '小时达': ['鲜蜂便利店', '极速达超市', '社区便利精选', '二十四时便利店', '同城急送商行', '邻居小店'],
      '团购': ['老王烧烤团', '胖嫂饺子馆', '蜀地火锅团', '韩式炸鸡团', '日料拼盘团', '广式早茶团'],
      '神券': ['神券炸鸡店', '神券奶茶铺', '神券汉堡屋', '神券米线馆', '神券烤肉饭', '神券甜品站'],
      '闪购': ['闪购水果行', '闪购鲜花坊', '闪购蛋糕店', '闪购便利店', '闪购医药房', '闪购数码配'],
      '看病买药': ['健康大药房', '仁心药房', '便民医药房', '康泰大药房', '二十四小时药房', '社区便民药'],
      '水果': ['鲜果时光', '果园直供行', '每日鲜果铺', '热带水果汇', '当季水果店', '精品水果屋']
    };
    const arr = names[category] || names['小时达'];
    return arr.map((n, i) => ({ name: n, rating: (4 + (i % 10) / 10).toFixed(1), deliveryFee: (i % 4), deliveryTime: 25 + i * 5, desc: '现做现送品质之选' }));
  }

  function renderStoreGrid(stores) {
    _gridStores = stores || [];
    if (!_gridStores.length) return '<div style="text-align:center;padding:40px 0;color:#999;font-size:13px;">暂无店铺，点击右上角换一批</div>';
    let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    _gridStores.forEach((s, i) => {
      const color = colorForName(s.name);
      const stars = starsHtml(s.rating);
      const couponBadge = s.useCoupon
        ? '<span style="display:inline-block;font-size:9px;color:#fff;background:linear-gradient(90deg,#f5a07a,#e87d5e);padding:1px 6px;border-radius:3px;font-weight:700;margin-left:6px;">神券</span>'
        : '';
      html +=
        '<div onclick="shoppingSystem.openStoreDetailByIdx(' + i + ')" style="background:#fff;border-radius:10px;overflow:hidden;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.05);display:flex;">' +
          '<div style="width:90px;height:90px;flex-shrink:0;overflow:hidden;border-radius:0;">' + productImgHtml(s.name, 90, 90, 30) + '</div>' +
          '<div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;min-width:0;">' +
            '<div>' +
              '<div style="font-size:14px;font-weight:700;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + couponBadge + '</div>' +
              '<div style="display:flex;align-items:center;gap:4px;margin-top:3px;color:#fa8c16;">' + stars + '<span style="font-size:11px;color:#fa8c16;font-weight:600;">' + Number(s.rating).toFixed(1) + '</span></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#999;">' +
              '<span>配送费¥' + fmtPrice(s.deliveryFee) + ' · 约' + s.deliveryTime + '分钟</span>' +
              '<span style="color:#e87d5e;font-weight:600;">进店 ›</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function starsHtml(rating) {
    let html = '<span style="display:inline-flex;align-items:center;gap:1px;color:#fa8c16;">';
    for (let i = 0; i < 5; i++) {
      html += (i < Math.round(rating)) ? ICO.star : ICO.starOutline;
    }
    html += '</span>';
    return html;
  }

  function openStoreDetailByIdx(i) {
    const store = _gridStores[i];
    if (store) openStoreDetail(store);
  }

  function openStoreDetail(store) {
    shoppingCurrentStore = store;
    shoppingStoreSelections = {};
    const overlay = document.getElementById('shopping-store-overlay');
    if (!overlay) return;
    showOverlay('shopping-store-overlay');
    // 购物模式店铺不展示"分钟送达/配送费"等外卖概念，改用品质保障描述
    const isShopMode = !!(store && store._shopCategory);
    const subInfo = isShopMode
      ? starsHtml(store.rating) + ' ' + Number(store.rating).toFixed(1) + ' · ' + (store.desc || '品质保障 · 售后无忧')
      : starsHtml(store.rating) + ' ' + Number(store.rating).toFixed(1) + ' · 约' + store.deliveryTime + '分钟送达';
    overlay.innerHTML =
      '<div style="background:#f5a07a;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5;">' +
        '<button onclick="shoppingSystem.closeStoreDetail()" style="border:none;background:none;color:#fff;cursor:pointer;padding:4px;">' + ICO.back + '</button>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(store.name) + '</div>' +
          '<div style="display:flex;align-items:center;gap:4px;font-size:11px;">' + subInfo + '</div></div>' +
      '</div>' +
      '<div id="shopping-store-body" style="padding:10px 10px 90px;">' + loadingHtml() + '</div>' +
      storeBottomBarHtml(store);
    generateStoreProducts(store);
  }

  function storeBottomBarHtml(store) {
    return '<div style="position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #eee;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:10px;z-index:6;">' +
      '<div id="store-cart-summary" style="flex:1;font-size:12px;color:#999;">未选购商品</div>' +
      '<button id="store-checkout-btn" onclick="shoppingSystem.checkoutStore()" disabled style="border:none;background:#ccc;color:#fff;font-size:14px;font-weight:700;padding:10px 22px;border-radius:22px;cursor:not-allowed;">去结算</button>' +
    '</div>';
  }

  async function generateStoreProducts(store) {
    const body = document.getElementById('shopping-store-body');
    try {
      // 购物模式（非外卖）：按店铺所属分类从预设商品目录生成同品类商品，杜绝"家具店里卖外卖食品"
      // 外卖模式：沿用 default_food 预设菜单
      let baseMenu;
      const shopCat = store && store._shopCategory;
      if (shopCat && PRESET_PRODUCTS[shopCat]) {
        baseMenu = PRESET_PRODUCTS[shopCat].map(p => ({ name: p.name, price: p.price, desc: p.desc }));
      } else {
        baseMenu = getPresetStoreMenu(store.name);
      }
      // 根据店铺名调整价格区间，让不同店铺有差异
      let priceSeed = 0;
      for (let k = 0; k < (store.name || '').length; k++) priceSeed += store.name.charCodeAt(k);
      let list = baseMenu.map((p, idx) => ({
        id: idx,
        name: p.name,
        price: parseFloat(p.price) + (priceSeed % 12) - 6 + idx,
        desc: p.desc
      }));
      _storeProducts = list;
      if (body) body.innerHTML = renderStoreProducts(list, store);
      updateStoreSummary();
    } catch (e) {
      _storeProducts = getPresetStoreMenu(store.name).map((p, idx) => ({ id: idx, name: p.name, price: parseFloat(p.price), desc: p.desc }));
      if (body) { body.innerHTML = renderStoreProducts(_storeProducts, store); updateStoreSummary(); }
    }
  }

  function fallbackMenu(name) {
    const generic = ['招牌套餐', '精品小炒', '招牌盖浇饭', '人气双人餐', '招牌饮品', '时蔬拼盘', '特色汤品', '人气甜品'];
    return generic.map(n => ({ name: n, price: (15 + Math.random() * 35).toFixed(1), desc: '现做美味' }));
  }

  function renderStoreProducts(list, store) {
    let html = '<div style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">';
    list.forEach((p, i) => {
      const color = colorForName(p.name);
      const qty = shoppingStoreSelections[p.id] || 0;
      html +=
        '<div style="display:flex;align-items:center;padding:10px;border-bottom:1px solid #f1f1f1;">' +
          '<div style="width:60px;height:60px;border-radius:8px;overflow:hidden;flex-shrink:0;margin-right:10px;">' + productImgHtml(p.name, 60, 60, 22) + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:600;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
            '<div style="font-size:11px;color:#999;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.desc) + '</div>' +
            '<div style="font-size:14px;font-weight:700;color:#e87d5e;">¥' + fmtPrice(p.price) + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            (qty > 0 ? '<button onclick="shoppingSystem.decStoreProduct(' + p.id + ')" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #f5a07a;background:#fff;color:#f5a07a;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICO.minus + '</button>' +
              '<span style="min-width:16px;text-align:center;font-size:13px;font-weight:600;color:#333;">' + qty + '</span>' : '') +
            '<button onclick="shoppingSystem.incStoreProduct(' + p.id + ')" style="width:26px;height:26px;border-radius:50%;border:none;background:#f5a07a;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICO.plus + '</button>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function incStoreProduct(id) {
    shoppingStoreSelections[id] = (shoppingStoreSelections[id] || 0) + 1;
    rerenderStoreProducts();
  }
  function decStoreProduct(id) {
    if (shoppingStoreSelections[id]) {
      shoppingStoreSelections[id]--;
      if (shoppingStoreSelections[id] <= 0) delete shoppingStoreSelections[id];
    }
    rerenderStoreProducts();
  }
  function rerenderStoreProducts() {
    const body = document.getElementById('shopping-store-body');
    if (body && shoppingCurrentStore) body.innerHTML = renderStoreProducts(_storeProducts, shoppingCurrentStore);
    updateStoreSummary();
  }
  function updateStoreSummary() {
    let count = 0, total = 0;
    _storeProducts.forEach(p => {
      const q = shoppingStoreSelections[p.id] || 0;
      if (q > 0) { count += q; total += q * p.price; }
    });
    const sum = document.getElementById('store-cart-summary');
    const btn = document.getElementById('store-checkout-btn');
    if (sum) sum.innerHTML = count > 0 ? ('已选 ' + count + ' 件 合计 <span style="color:#e87d5e;font-weight:700;font-size:15px;">¥' + fmtPrice(total) + '</span>') : '未选购商品';
    if (btn) {
      if (count > 0) { btn.disabled = false; btn.style.background = '#f5a07a'; btn.style.cursor = 'pointer'; btn.innerText = '去结算(' + count + ')'; }
      else { btn.disabled = true; btn.style.background = '#ccc'; btn.style.cursor = 'not-allowed'; btn.innerText = '去结算'; }
    }
  }

  function closeStoreDetail() {
    hideOverlay('shopping-store-overlay');
    shoppingCurrentStore = null;
    shoppingStoreSelections = {};
  }

  function checkoutStore() {
    if (!shoppingCurrentStore) return;
    const isShopMode = !!shoppingCurrentStore._shopCategory;
    const items = [];
    _storeProducts.forEach(p => {
      const q = shoppingStoreSelections[p.id] || 0;
      if (q > 0) items.push({
        name: p.name, price: p.price, qty: q, desc: p.desc,
        type: isShopMode ? 'shopping' : 'food',
        storeId: 'store_' + shoppingCurrentStore.name,
        storeName: shoppingCurrentStore.name,
        deliveryFee: isShopMode ? 0 : (shoppingCurrentStore.deliveryFee || 0),
        useCoupon: !!shoppingCurrentStore.useCoupon
      });
    });
    if (!items.length) { showToast('请先选购商品'); return; }
    closeStoreDetail();
    openCheckout(items);
  }

  // ============================================================
  //  7. 商品详情
  // ============================================================
  function openProductDetailByIdx(i) {
    const p = _gridProducts[i];
    if (p) openProductDetail(p);
  }

  function openProductDetail(product, storeInfo) {
    shoppingDetailProduct = product;
    shoppingDetailStore = storeInfo || null;
    shoppingTravelService = '机票';
    const overlay = document.getElementById('shopping-detail-overlay');
    if (!overlay) return;
    showOverlay('shopping-detail-overlay');
    const color = colorForName(product.name);
    const showOri = product.originalPrice && product.originalPrice > product.price;

    let extraHtml = '';
    if (product.type === 'travel') {
      const services = ['机票', '高铁', '旅馆', '打车'];
      let svHtml = '';
      services.forEach(s => {
        const act = s === shoppingTravelService;
        svHtml += '<button onclick="shoppingSystem.selectTravelService(\'' + s + '\')" style="padding:7px 16px;border:1.5px solid ' + (act ? '#f5a07a' : '#eee') + ';background:' + (act ? '#fff5f0' : '#fff') + ';color:' + (act ? '#f5a07a' : '#666') + ';border-radius:16px;font-size:12px;font-weight:600;cursor:pointer;margin-right:8px;">' + s + '</button>';
      });
      extraHtml =
        '<div style="background:#fff;margin:8px;border-radius:10px;padding:12px;">' +
          '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px;">选择服务类型</div>' +
          '<div style="margin-bottom:12px;">' + svHtml + '</div>' +
          '<div style="display:flex;gap:8px;">' +
            '<input id="travel-from" type="text" placeholder="出发地" style="flex:1;border:1.5px solid #eee;border-radius:8px;padding:9px 10px;font-size:13px;outline:none;color:#333;font-family:inherit;background:#fff;" />' +
            '<input id="travel-to" type="text" placeholder="目的地" style="flex:1;border:1.5px solid #eee;border-radius:8px;padding:9px 10px;font-size:13px;outline:none;color:#333;font-family:inherit;background:#fff;" />' +
          '</div>' +
          '<div style="font-size:11px;color:#999;margin-top:8px;">预计出行当日即可确认，请填写真实出发与目的地。</div>' +
        '</div>';
    } else if (product.type === 'car') {
      const row = (k, v) => '<div style="display:flex;padding:10px 0;border-bottom:1px solid #f5f5f5;"><span style="width:80px;color:#999;font-size:13px;">' + k + '</span><span style="flex:1;color:#333;font-size:13px;font-weight:600;">' + esc(v) + '</span></div>';
      extraHtml =
        '<div style="background:#fff;margin:8px;border-radius:10px;padding:12px;">' +
          '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:4px;">车辆参数</div>' +
          row('品牌', product.brand || '-') +
          row('车型', product.model || '-') +
          row('排量', product.displacement || '-') +
          row('颜色', product.color || '-') +
          row('类别', '新车 / 整车销售') +
        '</div>';
    } else if (product.type === 'realty') {
      const row = (k, v) => '<div style="display:flex;padding:10px 0;border-bottom:1px solid #f5f5f5;"><span style="width:80px;color:#999;font-size:13px;">' + k + '</span><span style="flex:1;color:#333;font-size:13px;font-weight:600;">' + esc(v) + '</span></div>';
      extraHtml =
        '<div style="background:#fff;margin:8px;border-radius:10px;padding:12px;">' +
          '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:4px;">房源详情</div>' +
          row('面积', (product.area || '-') + ' 平米') +
          row('户型', product.layout || '-') +
          row('楼层', product.floor || '-') +
          row('朝向', product.orientation || '-') +
          row('位置', product.location || '-') +
        '</div>';
    }

    // 店铺栏：若商品有 storeName 用之，否则按分类从真实店铺名池中抽取一家供"进店逛逛"
    // 复用函数参数 storeInfo（若未传入则在下面合成），不再重复声明
    if (!storeInfo) {
      const productCategory = product.category || shoppingCurrentCategory || '推荐';
      const storePool = SHOP_CATEGORY_STORES[productCategory] || SHOP_CATEGORY_STORES['推荐'];
      // 基于商品名 hash 稳定抽取一家店铺，避免同一商品每次进详情店名都变
      let nameSeed = 0;
      for (let k = 0; k < (product.name || '').length; k++) nameSeed += product.name.charCodeAt(k);
      const storeName = product.storeName || storePool[nameSeed % storePool.length];
      storeInfo = {
        name: storeName,
        rating: 4.8,
        deliveryFee: 0,
        deliveryTime: 30,
        desc: '品质保障 · 售后无忧',
        useCoupon: false,
        _synthetic: true,
        _shopCategory: productCategory
      };
    }
    shoppingDetailStore = storeInfo;
    const storeCouponBadge = storeInfo.useCoupon
      ? '<span style="display:inline-block;font-size:9px;color:#fff;background:linear-gradient(90deg,#f5a07a,#e87d5e);padding:1px 6px;border-radius:3px;font-weight:700;margin-left:6px;">神券</span>'
      : '';
    const storeHtml =
      '<div style="background:#fff;margin:8px;border-radius:10px;padding:12px;">' +
        '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px;">店铺</div>' +
        '<div onclick="shoppingSystem.openStoreFromDetail()" style="display:flex;align-items:center;gap:10px;cursor:pointer;">' +
          '<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;">' + productImgHtml(storeInfo.name, 48, 48, 20) + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:14px;font-weight:700;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(storeInfo.name) + storeCouponBadge + '</div>' +
            '<div style="font-size:11px;color:#999;margin-top:2px;">' + esc(storeInfo.desc || '品质之选') + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:3px;color:#e87d5e;font-size:12px;font-weight:600;">进店逛逛 ' + ICO.right + '</div>' +
        '</div>' +
      '</div>';

    overlay.innerHTML =
      '<div style="background:#fff;color:#333;position:sticky;top:0;z-index:5;display:flex;align-items:center;padding:10px 6px;border-bottom:1px solid #eee;">' +
        '<button onclick="shoppingSystem.closeProductDetail()" style="border:none;background:none;color:#333;cursor:pointer;padding:6px;">' + ICO.back + '</button>' +
        '<span style="font-size:15px;font-weight:700;">商品详情</span>' +
      '</div>' +
      '<div style="height:260px;overflow:hidden;">' + productImgHtml(product.name, '100%', 260, 64) + '</div>' +
      '<div style="background:#fff;padding:14px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:baseline;gap:8px;">' +
          '<span style="font-size:13px;color:#e87d5e;">¥</span><span style="font-size:30px;font-weight:700;color:#e87d5e;">' + fmtPrice(product.price) + '</span>' +
          (showOri ? '<span style="font-size:13px;color:#999;text-decoration:line-through;">¥' + fmtPrice(product.originalPrice) + '</span>' : '') +
          (showOri ? '<span style="font-size:11px;color:#fff;background:#e87d5e;padding:1px 6px;border-radius:3px;font-weight:600;">立减</span>' : '') +
        '</div>' +
        '<div style="font-size:16px;font-weight:700;color:#333;margin-top:8px;line-height:1.4;">' + esc(product.name) + '</div>' +
        '<div style="font-size:12px;color:#999;margin-top:6px;line-height:1.5;">' + esc(product.desc || '精选品质好物，假一赔十，七天无理由退换。') + '</div>' +
        '<div style="font-size:11px;color:#fa8c16;margin-top:8px;display:flex;align-items:center;gap:4px;">' + ICO.truck + ' 预计3-5天送达 · ' + (product.freeShip === false ? '运费到付' : '包邮') + (product.insured ? ' · 运费险' : '') + '</div>' +
      '</div>' +
      storeHtml +
      extraHtml +
      '<div style="height:80px;"></div>' +
      '<div style="position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #eee;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;z-index:6;">' +
        '<button onclick="shoppingSystem.addToCartFromDetail()" style="flex:1;border:1.5px solid #f5a07a;background:#fff;color:#f5a07a;font-size:14px;font-weight:700;padding:11px 0;border-radius:22px;cursor:pointer;">加入购物车</button>' +
        '<button onclick="shoppingSystem.buyNowFromDetail()" style="flex:1;border:none;background:linear-gradient(90deg,#f5a07a,#e87d5e);color:#fff;font-size:14px;font-weight:700;padding:11px 0;border-radius:22px;cursor:pointer;">立即购买</button>' +
      '</div>';
  }

  function openStoreFromDetail() {
    // 从商品详情进入店铺
    if (!shoppingDetailStore) return;
    // 关闭商品详情 overlay，打开店铺 overlay
    hideOverlay('shopping-detail-overlay');
    openStoreDetail(shoppingDetailStore);
  }

  function selectTravelService(s) { shoppingTravelService = s; openProductDetail(shoppingDetailProduct); }

  function closeProductDetail() {
    hideOverlay('shopping-detail-overlay');
    shoppingDetailProduct = null;
  }

  function addToCartFromDetail() {
    if (!shoppingDetailProduct) return;
    addToCart(shoppingDetailProduct, null, null);
  }

  function buyNowFromDetail() {
    if (!shoppingDetailProduct) return;
    const p = shoppingDetailProduct;
    const item = { name: p.name, price: p.price, qty: 1, desc: p.desc, originalPrice: p.originalPrice, type: 'shopping', storeId: null, storeName: null, deliveryFee: 0 };
    if (p.type === 'travel') item.type = 'travel';
    if (p.type === 'car') item.type = 'car';
    if (p.type === 'realty') item.type = 'realty';
    closeProductDetail();
    openCheckout([item]);
  }

  // ============================================================
  //  8. 购物车
  // ============================================================
  async function addToCart(product, storeId, storeName) {
    if (!pid()) { showToast('请先选择我的人设'); return; }
    const isFood = !!storeId;
    const rec = {
      userId: pid(),
      itemType: isFood ? 'food' : (product.type || 'shopping'),
      storeId: storeId || null,
      storeName: storeName || null,
      category: product.category || shoppingCurrentCategory,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice || null,
      desc: product.desc || '',
      quantity: product.quantity || 1,
      deliveryFee: isFood ? (product.deliveryFee || 0) : 0,
      addedAt: Date.now()
    };
    await db.shopping_cart.add(rec);
    showToast('已加入购物车');
    updateCartBadge();
  }

  async function renderCart() {
    const container = document.getElementById('shopping-tab-cart');
    if (!container) return;
    if (!pid()) { container.innerHTML = emptyStateHtml('请先选择我的人设'); return; }
    const items = await db.shopping_cart.where('userId').equals(pid()).toArray();
    items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    if (!items.length) {
      container.innerHTML =
        '<div style="text-align:center;padding:80px 20px;color:#999;">' +
          '<div style="width:80px;height:80px;margin:0 auto 16px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;color:#ccc;">' + ICO.cart + '</div>' +
          '<div style="font-size:14px;">购物车还是空的</div>' +
          '<button onclick="shoppingSystem.switchTab(\'home\')" style="margin-top:16px;border:none;background:#f5a07a;color:#fff;font-size:13px;font-weight:600;padding:9px 24px;border-radius:20px;cursor:pointer;">去逛逛</button>' +
        '</div>';
      updateCartBadge();
      return;
    }

    // 同步选中集合
    const ids = items.map(it => it.id);
    shoppingSelectedCartItems.forEach(id => { if (!ids.includes(id)) shoppingSelectedCartItems.delete(id); });
    const allSel = items.length > 0 && items.every(it => shoppingSelectedCartItems.has(it.id));

    let html = '<div style="padding:8px 8px 90px;">';
    items.forEach(it => {
      const sel = shoppingSelectedCartItems.has(it.id);
      const color = colorForName(it.name);
      const showOri = it.originalPrice && it.originalPrice > it.price;
      html +=
        '<div style="background:#fff;border-radius:10px;padding:10px;margin-bottom:8px;display:flex;align-items:center;gap:10px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">' +
          '<div onclick="shoppingSystem.toggleCartSelect(' + it.id + ')" style="cursor:pointer;">' + checkboxHtml(sel) + '</div>' +
          '<div style="width:64px;height:64px;border-radius:8px;overflow:hidden;flex-shrink:0;">' + productImgHtml(it.name, 64, 64, 24) + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            (it.storeName ? '<div style="font-size:10px;color:#fa8c16;margin-bottom:2px;">' + esc(it.storeName) + ' · 外卖</div>' : '') +
            '<div style="font-size:13px;color:#333;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(it.name) + '</div>' +
            '<div style="display:flex;align-items:baseline;gap:5px;margin-top:3px;">' +
              '<span style="font-size:15px;font-weight:700;color:#e87d5e;">¥' + fmtPrice(it.price) + '</span>' +
              (showOri ? '<span style="font-size:10px;color:#999;text-decoration:line-through;">¥' + fmtPrice(it.originalPrice) + '</span>' : '') +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">' +
              '<span style="font-size:10px;color:#999;">' + (it.itemType === 'food' ? '预计30分钟送达' : '预计3-5天送达') + '</span>' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<button onclick="shoppingSystem.updateCartQuantity(' + it.id + ',-1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #ddd;background:#fff;color:#666;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICO.minus + '</button>' +
                '<span style="min-width:20px;text-align:center;font-size:13px;font-weight:600;color:#333;">' + it.quantity + '</span>' +
                '<button onclick="shoppingSystem.updateCartQuantity(' + it.id + ',1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #f5a07a;background:#fff;color:#f5a07a;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICO.plus + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';

    // 底部结算栏
    let total = 0;
    items.forEach(it => { if (shoppingSelectedCartItems.has(it.id)) total += it.price * it.quantity; });
    const selCount = shoppingSelectedCartItems.size;
    html +=
      '<div style="position:fixed;left:0;right:0;bottom:50px;background:#fff;border-top:1px solid #eee;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:10px;z-index:6;">' +
        '<div onclick="shoppingSystem.toggleSelectAll()" style="cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;color:#333;">' + checkboxHtml(allSel) + '全选</div>' +
        '<button onclick="shoppingSystem.deleteCartItems()" style="border:none;background:none;color:#999;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;">' + ICO.trash + '删除</button>' +
        '<div style="flex:1;text-align:right;font-size:12px;color:#333;">合计 <span style="color:#e87d5e;font-size:17px;font-weight:700;">¥' + fmtPrice(total) + '</span></div>' +
        '<button onclick="shoppingSystem.checkoutSelected()" ' + (selCount ? '' : 'disabled') + ' style="border:none;background:' + (selCount ? 'linear-gradient(90deg,#f5a07a,#e87d5e)' : '#ccc') + ';color:#fff;font-size:14px;font-weight:700;padding:10px 22px;border-radius:22px;cursor:' + (selCount ? 'pointer' : 'not-allowed') + ';">结算(' + selCount + ')</button>' +
      '</div>';

    container.innerHTML = html;
    updateCartBadge();
  }

  function emptyStateHtml(msg) {
    return '<div style="text-align:center;padding:80px 20px;color:#999;font-size:13px;">' + esc(msg) + '</div>';
  }

  function toggleCartSelect(itemId) {
    if (shoppingSelectedCartItems.has(itemId)) shoppingSelectedCartItems.delete(itemId);
    else shoppingSelectedCartItems.add(itemId);
    renderCart();
  }

  function toggleSelectAll() {
    db.shopping_cart.where('userId').equals(pid()).toArray().then(items => {
      const allSel = items.length > 0 && items.every(it => shoppingSelectedCartItems.has(it.id));
      if (allSel) shoppingSelectedCartItems.clear();
      else items.forEach(it => shoppingSelectedCartItems.add(it.id));
      renderCart();
    });
  }

  async function updateCartQuantity(itemId, delta) {
    const it = await db.shopping_cart.get(itemId);
    if (!it) return;
    const q = (it.quantity || 1) + delta;
    if (q <= 0) {
      await db.shopping_cart.delete(itemId);
      shoppingSelectedCartItems.delete(itemId);
    } else {
      await db.shopping_cart.update(itemId, { quantity: q });
    }
    renderCart();
    updateCartBadge();
  }

  async function deleteCartItems() {
    if (shoppingSelectedCartItems.size === 0) { showToast('请先选择要删除的商品'); return; }
    const ids = Array.from(shoppingSelectedCartItems);
    showCustomConfirm('删除商品', '确定删除选中的 ' + ids.length + ' 件商品吗？', async () => {
      await db.shopping_cart.bulkDelete(ids);
      shoppingSelectedCartItems.clear();
      renderCart();
      updateCartBadge();
      showToast('已删除');
    });
  }

  function checkoutSelected() {
    if (shoppingSelectedCartItems.size === 0) { showToast('请先选择商品'); return; }
    db.shopping_cart.where('userId').equals(pid()).toArray().then(items => {
      const sel = items.filter(it => shoppingSelectedCartItems.has(it.id));
      const checkoutItems = sel.map(it => ({
        name: it.name, price: it.price, qty: it.quantity, desc: it.desc,
        originalPrice: it.originalPrice, type: it.itemType, storeId: it.storeId,
        storeName: it.storeName, deliveryFee: it.deliveryFee || 0, cartItemId: it.id
      }));
      openCheckout(checkoutItems);
    });
  }

  async function updateCartBadge() {
    const badge = document.getElementById('shopping-cart-badge');
    if (!badge) return;
    if (!pid()) { badge.style.display = 'none'; return; }
    const count = await db.shopping_cart.where('userId').equals(pid()).count();
    if (count > 0) {
      badge.style.display = 'block';
      badge.innerText = count > 99 ? '99+' : String(count);
    } else {
      badge.style.display = 'none';
    }
  }

  // ============================================================
  //  9. 结算页（ins 风格）
  // ============================================================
  function openCheckout(items) {
    shoppingCheckoutItems = items || [];
    shoppingIsFoodCheckout = items.some(it => it.type === 'food' || it.storeId);
    shoppingCheckoutAddress = null;
    shoppingCheckoutPayment = 'self';
    shoppingCheckoutPayerSession = null;
    shoppingCheckoutMessage = '';
    shoppingCouponAdded = false;
    shoppingCouponPlan = shoppingIsFoodCheckout ? rollCouponPlan() : null;
    // 神券抵扣初始化
    shoppingDeductCoupon = null;
    shoppingDeductCouponInflated = 0;
    shoppingAvailableCoupons = [];
    shoppingFlashCouponOffered = false;
    shoppingFlashCouponAdded = false;
    shoppingCheckoutCanUseCoupon = items.some(it => it.useCoupon);
    // 预选默认地址 + 加载可用神券
    Promise.all([
      db.shopping_addresses.where('userId').equals(pid()).toArray().catch(() => []),
      db.shopping_coupons.where('userId').equals(pid()).toArray().catch(() => [])
    ]).then(([list, coupons]) => {
      shoppingCheckoutAddress = list.find(a => a.isDefault) || list[0] || null;
      const now = Date.now();
      shoppingAvailableCoupons = coupons.filter(c => (c.expireAt || 0) > now && (c.usedCount || 0) < 1);
      // 神券为 0 且店铺支持神券 → 自动展示 0.01 加购
      if (shoppingCheckoutCanUseCoupon && shoppingAvailableCoupons.length === 0) {
        shoppingFlashCouponOffered = true;
      }
      renderCheckoutPage();
    }).catch(() => renderCheckoutPage());
    renderCheckoutPage();
  }

  function closeCheckout() {
    hideOverlay('shopping-checkout-overlay');
  }

  function computeTotals() {
    let itemTotal = 0;
    shoppingCheckoutItems.forEach(it => { itemTotal += (it.price || 0) * (it.qty || 1); });
    const storeFees = {};
    shoppingCheckoutItems.forEach(it => { if (it.storeId && it.deliveryFee) storeFees[it.storeId] = it.deliveryFee; });
    const deliveryFee = Object.keys(storeFees).reduce((s, k) => s + storeFees[k], 0);
    const couponAddOn = (shoppingCouponAdded && shoppingCouponPlan) ? shoppingCouponPlan.price : 0;
    // 0.01 加购神券费用
    const flashCouponFee = shoppingFlashCouponAdded ? FLASH_COUPON_PLAN.price : 0;
    // 神券抵扣（膨胀后面值，不超过商品金额）
    const deductAmount = Math.min(shoppingDeductCouponInflated, itemTotal);
    const final = Math.max(0, itemTotal + deliveryFee + couponAddOn + flashCouponFee - deductAmount);
    return { itemTotal, deliveryFee, couponAddOn, flashCouponFee, deductAmount, final };
  }

  function renderCheckoutPage() {
    const overlay = document.getElementById('shopping-checkout-overlay');
    if (!overlay) return;
    showOverlay('shopping-checkout-overlay');
    const totals = computeTotals();
    const INS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    // 收货地址
    let addrHtml;
    if (shoppingCheckoutAddress) {
      const a = shoppingCheckoutAddress;
      const gift = a.isCharacter;
      addrHtml =
        '<div onclick="shoppingSystem.selectAddress()" style="padding:16px;cursor:pointer;">' +
          '<div style="display:flex;align-items:flex-start;gap:10px;">' +
            '<div style="color:#f5a07a;margin-top:2px;">' + ICO.pin + '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<span style="font-size:15px;font-weight:600;color:#333;">' + esc(a.name) + '</span>' +
                '<span style="font-size:13px;color:#999;">' + esc(a.phone || '') + '</span>' +
                (gift ? '<span style="font-size:10px;color:#fff;background:#e87d5e;padding:1px 6px;border-radius:3px;font-weight:600;">送礼</span>' : '') +
                (a.isDefault ? '<span style="font-size:10px;color:#fff;background:#fa8c16;padding:1px 6px;border-radius:3px;font-weight:600;">默认</span>' : '') +
              '</div>' +
              '<div style="font-size:13px;color:#666;line-height:1.5;">' + esc(a.address || '') + '</div>' +
            '</div>' +
            '<div style="color:#ccc;">' + ICO.right + '</div>' +
          '</div>' +
        '</div>';
    } else {
      addrHtml =
        '<div onclick="shoppingSystem.selectAddress()" style="padding:18px;cursor:pointer;display:flex;align-items:center;gap:10px;">' +
          '<div style="color:#f5a07a;">' + ICO.pin + '</div>' +
          '<span style="font-size:14px;color:#999;">请选择收货地址</span>' +
          '<div style="margin-left:auto;color:#ccc;">' + ICO.right + '</div>' +
        '</div>';
    }

    // 商品清单
    let itemsHtml = '';
    shoppingCheckoutItems.forEach(it => {
      itemsHtml +=
        '<div style="display:flex;align-items:center;padding:12px 16px;">' +
          '<div style="width:44px;height:44px;border-radius:6px;overflow:hidden;flex-shrink:0;margin-right:10px;">' + productImgHtml(it.name, 44, 44, 18) + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;color:#333;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(it.name) + '</div>' +
            (it.storeName ? '<div style="font-size:11px;color:#999;margin-top:2px;">' + esc(it.storeName) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;margin-left:10px;">' +
            '<div style="font-size:13px;color:#333;font-weight:600;">¥' + fmtPrice(it.price) + '</div>' +
            '<div style="font-size:11px;color:#999;">x' + it.qty + '</div>' +
          '</div>' +
        '</div>';
    });

    // 神券加购
    let couponHtml = '';
    if (shoppingCouponPlan) {
      const checked = shoppingCouponAdded;
      couponHtml =
        '<div style="margin-top:8px;background:#fff;">' +
          '<div style="padding:14px 16px;font-size:12px;color:#999;font-weight:600;">神券加购</div>' +
          '<div onclick="shoppingSystem.toggleCoupon()" style="padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-top:1px solid #f5f5f5;">' +
            checkboxHtml(checked) +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:13px;color:#333;font-weight:600;">' + esc(shoppingCouponPlan.label) + '</div>' +
              '<div style="font-size:11px;color:#999;margin-top:2px;">下单后立即发放至「我的-神券」</div>' +
            '</div>' +
            '<div style="font-size:13px;color:#e87d5e;font-weight:700;">+¥' + fmtPrice(shoppingCouponPlan.price) + '</div>' +
          '</div>' +
        '</div>';
    }

    // 神券抵扣（店铺支持神券时展示）
    let deductHtml = '';
    if (shoppingCheckoutCanUseCoupon) {
      if (shoppingAvailableCoupons.length > 0) {
        // 有可用神券：展示选择列表
        let couponListHtml = '';
        if (shoppingDeductCoupon) {
          // 已选中：展示选中态
          const inflated = shoppingDeductCouponInflated;
          const isInflated = inflated > shoppingDeductCoupon.faceValue;
          couponListHtml =
            '<div onclick="shoppingSystem.selectDeductCoupon(0)" style="padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-top:1px solid #f5f5f5;">' +
              checkboxHtml(true) +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:13px;color:#333;font-weight:600;">¥' + fmtPrice(shoppingDeductCoupon.faceValue) + ' 神券' + (isInflated ? ' → <span style="color:#e87d5e;">膨胀至 ¥' + fmtPrice(inflated) + '</span>' : '') + '</div>' +
                '<div style="font-size:11px;color:#999;margin-top:2px;">' + (isInflated ? '幸运！神券已膨胀 ' + (inflated / shoppingDeductCoupon.faceValue).toFixed(1) + ' 倍' : '本单可用，抵扣 ¥' + fmtPrice(inflated)) + '</div>' +
              '</div>' +
              '<div style="font-size:13px;color:#07c160;font-weight:700;">-¥' + fmtPrice(inflated) + '</div>' +
            '</div>';
        } else {
          // 未选中：展示可选列表
          couponListHtml = shoppingAvailableCoupons.slice(0, 5).map(c =>
            '<div onclick="shoppingSystem.selectDeductCoupon(' + c.id + ')" style="padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-top:1px solid #f5f5f5;">' +
              checkboxHtml(false) +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:13px;color:#333;font-weight:600;">¥' + fmtPrice(c.faceValue) + ' 神券</div>' +
                '<div style="font-size:11px;color:#999;margin-top:2px;">80% 概率膨胀 2-3 倍</div>' +
              '</div>' +
              '<div style="font-size:12px;color:#e87d5e;font-weight:600;">使用</div>' +
            '</div>'
          ).join('');
        }
        deductHtml =
          '<div style="margin-top:8px;background:#fff;">' +
            '<div style="padding:14px 16px;font-size:12px;color:#999;font-weight:600;">神券抵扣 <span style="color:#e87d5e;font-weight:700;">本店可用</span></div>' +
            couponListHtml +
          '</div>';
      } else if (shoppingFlashCouponOffered) {
        // 神券为 0：展示 0.01 加购
        const flashChecked = shoppingFlashCouponAdded;
        const flashInflated = shoppingFlashCouponAdded ? shoppingDeductCouponInflated : 0;
        deductHtml =
          '<div style="margin-top:8px;background:#fff;">' +
            '<div style="padding:14px 16px;font-size:12px;color:#999;font-weight:600;">神券抵扣 <span style="color:#e87d5e;font-weight:700;">本店可用</span></div>' +
            '<div onclick="shoppingSystem.addFlashCoupon()" style="padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-top:1px solid #f5f5f5;' + (flashChecked ? 'background:#fff5f0;' : '') + '">' +
              checkboxHtml(flashChecked) +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:13px;color:#333;font-weight:600;">0.01元加购 5元神券</div>' +
                '<div style="font-size:11px;color:#999;margin-top:2px;">' + (flashChecked ? ('已加购！80% 概率膨胀，当前抵扣 ¥' + fmtPrice(flashInflated)) : '本单立即可用，一单回本') + '</div>' +
              '</div>' +
              '<div style="font-size:13px;color:#e87d5e;font-weight:700;">' + (flashChecked ? '-¥' + fmtPrice(flashInflated) : '+¥0.01') + '</div>' +
            '</div>' +
          '</div>';
      }
    }

    // 付款方式
    const selfAct = shoppingCheckoutPayment === 'self';
    const otherAct = shoppingCheckoutPayment === 'other';
    let payerHtml = '';
    if (shoppingCheckoutPayment === 'other') {
      payerHtml = '<div id="checkout-payer-area" style="padding:0 16px 12px;"></div>';
    }

    const paymentHtml =
      '<div style="margin-top:8px;background:#fff;">' +
        '<div style="padding:14px 16px;font-size:12px;color:#999;font-weight:600;">付款方式</div>' +
        '<div onclick="shoppingSystem.selectPaymentMethod(\'self\')" style="padding:14px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-top:1px solid #f5f5f5;">' +
          checkboxHtml(selfAct) +
          '<div style="flex:1;"><div style="font-size:14px;color:#333;font-weight:600;">我付</div><div style="font-size:11px;color:#999;">钱包余额 ¥' + fmtPrice(getWalletBalance()) + '</div></div>' +
        '</div>' +
        '<div onclick="shoppingSystem.selectPaymentMethod(\'other\')" style="padding:14px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-top:1px solid #f5f5f5;">' +
          checkboxHtml(otherAct) +
          '<div style="flex:1;"><div style="font-size:14px;color:#333;font-weight:600;">他付</div><div style="font-size:11px;color:#999;">请TA代付，发送代付卡片到聊天</div></div>' +
        '</div>' +
        payerHtml +
      '</div>';

    // 订单总计
    const totalRow = (label, val, strong) =>
      '<div style="display:flex;justify-content:space-between;padding:8px 16px;font-size:13px;">' +
        '<span style="color:' + (strong ? '#333' : '#999') + ';">' + label + '</span>' +
        '<span style="color:' + (strong ? '#e87d5e' : '#333') + ';' + (strong ? 'font-size:17px;font-weight:700;' : '') + '">¥' + fmtPrice(val) + '</span>' +
      '</div>';
    let totalHtml =
      '<div style="margin-top:8px;background:#fff;">' +
        '<div style="padding:14px 16px;font-size:12px;color:#999;font-weight:600;">订单总计</div>' +
        totalRow('商品金额', totals.itemTotal, false) +
        totalRow('配送费', totals.deliveryFee, false) +
        (totals.couponAddOn ? totalRow('神券加购', totals.couponAddOn, false) : '') +
        (totals.flashCouponFee ? totalRow('0.01加购神券', totals.flashCouponFee, false) : '') +
        (totals.deductAmount ? '<div style="display:flex;justify-content:space-between;padding:8px 16px;font-size:13px;"><span style="color:#07c160;">神券抵扣</span><span style="color:#07c160;font-weight:600;">-¥' + fmtPrice(totals.deductAmount) + '</span></div>' : '') +
        '<div style="border-top:1px solid #f5f5f5;">' + totalRow('实付款', totals.final, true) + '</div>' +
      '</div>';

    overlay.innerHTML =
      '<div style="font-family:' + INS + ';background:#f5f5f5;min-height:100%;">' +
        '<div style="background:#fff;position:sticky;top:0;z-index:5;display:flex;align-items:center;padding:10px 6px;border-bottom:1px solid #eee;">' +
          '<button onclick="shoppingSystem.closeCheckout()" style="border:none;background:none;color:#333;cursor:pointer;padding:6px;">' + ICO.back + '</button>' +
          '<span style="font-size:15px;font-weight:700;color:#333;">确认订单</span>' +
        '</div>' +
        '<div style="background:#fff;margin-bottom:0;">' + addrHtml + '</div>' +
        '<div style="height:8px;background:#f5f5f5;"></div>' +
        '<div style="background:#fff;"><div style="padding:14px 16px;font-size:12px;color:#999;font-weight:600;">商品清单</div>' + itemsHtml + '</div>' +
        couponHtml +
        deductHtml +
        paymentHtml +
        totalHtml +
        '<div style="height:90px;"></div>' +
        '<div style="position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #eee;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;justify-content:space-between;z-index:6;">' +
          '<div style="font-size:12px;color:#999;">合计 <span style="color:#e87d5e;font-size:20px;font-weight:700;">¥' + fmtPrice(totals.final) + '</span></div>' +
          '<button onclick="shoppingSystem.submitOrder()" style="border:none;background:linear-gradient(90deg,#f5a07a,#e87d5e);color:#fff;font-size:15px;font-weight:700;padding:12px 36px;border-radius:24px;cursor:pointer;">提交订单</button>' +
        '</div>' +
      '</div>';

    if (shoppingCheckoutPayment === 'other') renderPayerArea();
  }

  function toggleCoupon() {
    shoppingCouponAdded = !shoppingCouponAdded;
    renderCheckoutPage();
  }

  // 神券抵扣选择：传入 couponId 选券，传 0 取消选择
  function selectDeductCoupon(couponId) {
    if (couponId === 0) {
      shoppingDeductCoupon = null;
      shoppingDeductCouponInflated = 0;
      renderCheckoutPage();
      return;
    }
    const c = shoppingAvailableCoupons.find(x => x.id === couponId);
    if (!c) return;
    // 80% 概率膨胀 2-3 倍
    let inflated = c.faceValue;
    if (Math.random() < 0.8) {
      const multiplier = 2 + Math.random(); // 2.0 ~ 3.0
      inflated = Math.round(c.faceValue * multiplier * 10) / 10;
    }
    shoppingDeductCoupon = { id: c.id, faceValue: c.faceValue, inflated: inflated };
    shoppingDeductCouponInflated = inflated;
    if (inflated > c.faceValue) {
      showToast('神券膨胀至 ¥' + fmtPrice(inflated) + '！');
    } else {
      showToast('已选用 ¥' + fmtPrice(c.faceValue) + ' 神券');
    }
    renderCheckoutPage();
  }

  // 0.01 加购神券（神券为 0 时触发）
  function addFlashCoupon() {
    if (shoppingFlashCouponAdded) {
      // 取消加购
      shoppingFlashCouponAdded = false;
      shoppingDeductCoupon = null;
      shoppingDeductCouponInflated = 0;
      renderCheckoutPage();
      return;
    }
    // 加购 0.01 神券，面值 5 元，80% 概率膨胀
    const faceValue = FLASH_COUPON_PLAN.face;
    let inflated = faceValue;
    if (Math.random() < 0.8) {
      const multiplier = 2 + Math.random();
      inflated = Math.round(faceValue * multiplier * 10) / 10;
    }
    shoppingFlashCouponAdded = true;
    shoppingDeductCoupon = { id: 'FLASH', faceValue: faceValue, inflated: inflated, isFlash: true };
    shoppingDeductCouponInflated = inflated;
    if (inflated > faceValue) {
      showToast('0.01 神券膨胀至 ¥' + fmtPrice(inflated) + '！');
    } else {
      showToast('已加购 ¥' + fmtPrice(faceValue) + ' 神券');
    }
    renderCheckoutPage();
  }

  async function renderPayerArea() {
    const area = document.getElementById('checkout-payer-area');
    if (!area) return;
    if (!pid()) { area.innerHTML = '<div style="font-size:12px;color:#999;padding:8px 0;">请先选择我的人设</div>'; return; }
    const sessions = await db.sessions.where('userId').equals(pid()).and(s => s.isGroup !== 1).toArray();
    if (!sessions.length) {
      area.innerHTML = '<div style="font-size:12px;color:#999;padding:8px 0;">暂无可代付的联系人，请先与角色建立单聊</div>';
      return;
    }
    let html = '<div style="font-size:11px;color:#999;margin-bottom:8px;">选择代付人</div><div style="max-height:180px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">';
    for (const s of sessions) {
      const char = await db.archives.get(s.charId);
      const name = s.customCharName || char?.name || '未知角色';
      const avatar = resolveImg(s.customCharAvatar || char?.avatar);
      const act = shoppingCheckoutPayerSession === s.id;
      html +=
        '<div onclick="shoppingSystem.selectPayer(' + s.id + ')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;background:' + (act ? '#fff5f0' : '#fff') + ';border-bottom:1px solid #f5f5f5;">' +
          '<img src="' + avatar + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;color:#333;font-weight:600;">' + esc(name) + '</div>' +
            '<div style="font-size:11px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.customCharPersona || char?.remark || '') + '</div></div>' +
          checkboxHtml(act) +
        '</div>';
    }
    html += '</div>';
    html += '<textarea id="checkout-message" placeholder="带一句话..." oninput="shoppingSystem.setCheckoutMessage(this.value)" style="width:100%;box-sizing:border-box;margin-top:8px;border:1px solid #eee;border-radius:8px;padding:9px 10px;font-size:13px;outline:none;resize:none;height:60px;font-family:inherit;color:#333;background:#fff;">' + esc(shoppingCheckoutMessage) + '</textarea>';
    area.innerHTML = html;
  }

  function setCheckoutMessage(v) { shoppingCheckoutMessage = v || ''; }

  function selectPaymentMethod(method) {
    shoppingCheckoutPayment = method;
    if (method === 'self') shoppingCheckoutPayerSession = null;
    renderCheckoutPage();
  }

  function selectPayer(sessionId) {
    shoppingCheckoutPayerSession = sessionId;
    renderPayerArea();
  }

  // ============================================================
  //  10. 地址选择
  // ============================================================
  async function selectAddress() {
    if (!pid()) { showToast('请先选择我的人设'); return; }
    const own = await db.shopping_addresses.where('userId').equals(pid()).toArray();
    const sessions = await db.sessions.where('userId').equals(pid()).and(s => s.isGroup !== 1).toArray();
    const charAddrs = [];
    for (const s of sessions) {
      const char = await db.archives.get(s.charId);
      const name = s.customCharName || char?.name || '未知角色';
      charAddrs.push({
        id: 'char_' + s.id,
        name: name,
        phone: '角色收件',
        address: genCharAddress(name),
        isCharacter: true,
        sessionId: s.id,
        isDefault: false
      });
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;';
    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:#fff;width:100%;max-height:80%;overflow-y:auto;border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom,0px);';
    let html = '<div style="position:sticky;top:0;background:#fff;padding:14px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;">' +
      '<span style="font-size:15px;font-weight:700;color:#333;">选择收货地址</span>' +
      '<button id="addr-close" style="border:none;background:none;color:#999;cursor:pointer;padding:4px;">' + ICO.close + '</button></div>';
    html += '<div style="padding:8px 16px;"><button id="addr-add" style="width:100%;border:1.5px dashed #f5a07a;background:#fff5f0;color:#f5a07a;font-size:13px;font-weight:600;padding:11px;border-radius:8px;cursor:pointer;">+ 新增收货地址</button></div>';
    html += '<div id="addr-list" style="padding:0 8px 16px;"></div>';
    sheet.innerHTML = html;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const list = sheet.querySelector('#addr-list');
    let lhtml = '';
    own.forEach(a => {
      lhtml += addrRowHtml(a, false);
    });
    if (charAddrs.length) {
      lhtml += '<div style="padding:10px 8px 4px;font-size:11px;color:#999;">联系人地址（送礼）</div>';
      charAddrs.forEach(a => { lhtml += addrRowHtml(a, true); });
    }
    if (!own.length && !charAddrs.length) {
      lhtml = '<div style="text-align:center;padding:40px 0;color:#999;font-size:13px;">暂无地址，请点击上方新增</div>';
    }
    list.innerHTML = lhtml;

    // 绑定事件
    sheet.querySelector('#addr-close').onclick = () => closeOverlay(overlay);
    sheet.querySelector('#addr-add').onclick = () => { closeOverlay(overlay); editAddress(null); };
    list.querySelectorAll('[data-addr-id]').forEach(el => {
      el.onclick = () => {
        const id = el.getAttribute('data-addr-id');
        let chosen;
        if (id.startsWith('char_')) chosen = charAddrs.find(a => a.id === id);
        else chosen = own.find(a => String(a.id) === id);
        if (chosen) { shoppingCheckoutAddress = chosen; renderCheckoutPage(); }
        closeOverlay(overlay);
      };
    });

    setTimeout(() => overlay.classList.add('show'), 10);
  }

  function addrRowHtml(a, isChar) {
    return '<div data-addr-id="' + a.id + '" style="padding:12px 10px;border-bottom:1px solid #f5f5f5;cursor:pointer;">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
        '<span style="font-size:14px;font-weight:600;color:#333;">' + esc(a.name) + '</span>' +
        '<span style="font-size:12px;color:#999;">' + esc(a.phone || '') + '</span>' +
        (isChar ? '<span style="font-size:10px;color:#fff;background:#e87d5e;padding:1px 5px;border-radius:3px;">送礼</span>' : '') +
        (a.isDefault ? '<span style="font-size:10px;color:#fff;background:#fa8c16;padding:1px 5px;border-radius:3px;">默认</span>' : '') +
      '</div>' +
      '<div style="font-size:12px;color:#666;line-height:1.4;">' + esc(a.address || '') + '</div>' +
    '</div>';
  }

  function closeOverlay(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function genCharAddress(name) {
    const cities = ['北京市朝阳区建国路88号', '上海市浦东新区世纪大道100号', '广州市天河区体育西路191号', '深圳市南山区科技园南区', '杭州市西湖区文三路478号', '成都市武侯区天府大道北段'];
    return cities[(name || '').length % cities.length] + ' ' + ((name || '收') + '宅');
  }

  // ============================================================
  //  11. 提交订单
  // ============================================================
  async function submitOrder() {
    if (!pid()) { showToast('请先选择我的人设'); return; }
    if (!shoppingCheckoutItems.length) { showToast('没有可结算商品'); return; }
    if (!shoppingCheckoutAddress) { showToast('请选择收货地址'); return; }
    if (shoppingCheckoutPayment === 'other' && !shoppingCheckoutPayerSession) { showToast('请选择代付人'); return; }

    const totals = computeTotals();
    const isGift = !!(shoppingCheckoutAddress && shoppingCheckoutAddress.isCharacter);
    const orderNo = genOrderNo();
    const now = Date.now();

    const order = {
      userId: pid(),
      orderNo: orderNo,
      status: 'unshipped',
      type: shoppingIsFoodCheckout ? 'food' : 'shopping',
      paymentMethod: shoppingCheckoutPayment,
      payerId: shoppingCheckoutPayment === 'other' ? shoppingCheckoutPayerSession : null,
      createdAt: now,
      items: shoppingCheckoutItems.map(it => ({ name: it.name, price: it.price, qty: it.qty, storeName: it.storeName, type: it.type })),
      address: { name: shoppingCheckoutAddress.name, phone: shoppingCheckoutAddress.phone || '', address: shoppingCheckoutAddress.address || '' },
      giftSessionId: isGift ? shoppingCheckoutAddress.sessionId : null,
      giftRecipientName: isGift ? shoppingCheckoutAddress.name : null,
      itemTotal: totals.itemTotal,
      deliveryFee: totals.deliveryFee,
      couponAddOn: totals.couponAddOn,
      flashCouponFee: totals.flashCouponFee,
      deductAmount: totals.deductAmount,
      deductCoupon: shoppingDeductCoupon ? { faceValue: shoppingDeductCoupon.faceValue, inflated: shoppingDeductCouponInflated, isFlash: !!shoppingDeductCoupon.isFlash } : null,
      total: totals.final,
      message: shoppingCheckoutPayment === 'other' ? shoppingCheckoutMessage : '',
      couponPlan: (shoppingCouponAdded && shoppingCouponPlan) ? shoppingCouponPlan : null,
      paidAt: shoppingCheckoutPayment === 'self' ? now : null
    };

    // 我付：扣余额 + 写入钱包账单
    if (shoppingCheckoutPayment === 'self') {
      const bal = getWalletBalance();
      if (bal < totals.final) { showCustomAlert('余额不足', '钱包余额 ¥' + fmtPrice(bal) + '，无法支付 ¥' + fmtPrice(totals.final)); return; }
      setWalletBalance(bal - totals.final);
      // 同步写入钱包账单，让消费记录进入钱包流水
      if (typeof addLedgerEntry === 'function') {
        var itemDesc = shoppingCheckoutItems.length === 1
          ? shoppingCheckoutItems[0].name
          : (shoppingIsFoodCheckout ? '外卖订单' : '购物订单');
        addLedgerEntry('购物·' + itemDesc, totals.final, 'expense');
      }
      order.status = 'unshipped'; // 已付款待发货
    } else {
      // 他付：待付款
      order.status = 'pending_payment';
    }

    const orderId = await db.shopping_orders.add(order);

    // 标记已使用的抵扣神券（非 0.01 加购的）
    if (shoppingDeductCoupon && !shoppingDeductCoupon.isFlash && shoppingDeductCoupon.id) {
      try { await db.shopping_coupons.update(shoppingDeductCoupon.id, { usedCount: 1, usedOrderNo: orderNo }); } catch(e) {}
    }

    // 神券发放
    if (shoppingCouponAdded && shoppingCouponPlan) {
      const expireAt = now + shoppingCouponPlan.days * 86400000;
      const couponRecs = [];
      for (let i = 0; i < shoppingCouponPlan.count; i++) {
        couponRecs.push({ userId: pid(), type: '神券', faceValue: shoppingCouponPlan.face, expireAt: expireAt, usedCount: 0, orderNo: orderNo, createdAt: now });
      }
      await db.shopping_coupons.bulkAdd(couponRecs);
    }

    // 清理购物车中已结算项
    const cartItemIds = shoppingCheckoutItems.map(it => it.cartItemId).filter(Boolean);
    if (cartItemIds.length) await db.shopping_cart.bulkDelete(cartItemIds);
    shoppingSelectedCartItems.clear();

    closeCheckout();
    updateCartBadge();

    // 后续聊天集成（函数可能在后续版本实现）
    let notified = false;
    if (isGift && typeof shoppingSystem.createGiftCard === 'function') {
      try { shoppingSystem.createGiftCard(shoppingCheckoutAddress.sessionId, order); } catch (e) { }
      showToast('礼物订单已创建');
      notified = true;
    }
    if (shoppingCheckoutPayment === 'other') {
      if (typeof shoppingSystem.createPayForMeCard === 'function') {
        try { shoppingSystem.createPayForMeCard(shoppingCheckoutPayerSession, order, shoppingCheckoutMessage); } catch (e) { }
      }
      if (!notified) { showToast('代付请求已发送'); notified = true; }
    }
    if (!notified) {
      showToast('下单成功，已支付 ¥' + fmtPrice(totals.final));
    }

    // 跳转到我的订单
    switchTab('mine');
    switchOrderTab('all');
  }

  // ============================================================
  //  12. 我的页面
  // ============================================================
  async function renderMine() {
    const container = document.getElementById('shopping-tab-mine');
    if (!container) return;
    if (!pid()) { container.innerHTML = emptyStateHtml('请先选择我的人设'); return; }

    const persona = await db.archives.get(pid());
    const profile = getProfile();
    const name = profile.name || persona?.name || '我的';
    const avatar = resolveImg(profile.avatar || persona?.avatar);
    const balance = getWalletBalance();

    let html =
      '<div style="background:linear-gradient(135deg,#f5a07a,#e87d5e);padding:20px 16px 24px;color:#fff;">' +
        '<div style="display:flex;align-items:center;gap:14px;">' +
          '<div onclick="shoppingSystem.updateProfileAvatar()" style="position:relative;cursor:pointer;">' +
            '<img src="' + avatar + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.6);" />' +
            '<div style="position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:#fff;color:#f5a07a;display:flex;align-items:center;justify-content:center;border:2px solid #f5a07a;">' + ICO.camera + '</div>' +
          '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div onclick="shoppingSystem.updateProfileName()" style="font-size:18px;font-weight:700;display:flex;align-items:center;gap:6px;">' + esc(name) + '<span style="opacity:0.8;">' + ICO.edit + '</span></div>' +
            '<div style="font-size:12px;opacity:0.9;margin-top:4px;">钱包余额 ¥' + fmtPrice(balance) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;">' +
          '<button onclick="shoppingSystem.manageAddresses()" style="flex:1;border:none;background:rgba(255,255,255,0.2);color:#fff;font-size:12px;font-weight:600;padding:8px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">' + ICO.pin + '收货地址</button>' +
          '<button onclick="shoppingSystem.viewCoupons()" style="flex:1;border:none;background:rgba(255,255,255,0.2);color:#fff;font-size:12px;font-weight:600;padding:8px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">' + ICO.doc + '我的神券</button>' +
        '</div>' +
      '</div>';

    // 订单标签
    const tabs = [['all', '全部'], ['unshipped', '待发货'], ['shipped', '已发货'], ['pending_receipt', '待签收']];
    html += '<div style="background:#fff;display:flex;border-bottom:1px solid #eee;">';
    tabs.forEach(t => {
      const act = shoppingOrderTab === t[0];
      html += '<button onclick="shoppingSystem.switchOrderTab(\'' + t[0] + '\')" style="flex:1;border:none;background:none;padding:12px 0;font-size:13px;font-weight:' + (act ? '700' : '500') + ';color:' + (act ? '#e87d5e' : '#666') + ';cursor:pointer;border-bottom:2px solid ' + (act ? '#e87d5e' : 'transparent') + ';">' + t[1] + '</button>';
    });
    html += '</div>';

    html += '<div id="shopping-orders-list" style="padding:8px 8px 80px;">' + loadingHtml() + '</div>';
    container.innerHTML = html;

    renderOrders(shoppingOrderTab);
  }

  function switchOrderTab(tab) {
    shoppingOrderTab = tab;
    renderMine();
  }

  async function renderOrders(statusFilter) {
    const list = document.getElementById('shopping-orders-list');
    if (!list) return;
    if (!pid()) { list.innerHTML = emptyStateHtml('请先选择我的人设'); return; }
    let orders = await db.shopping_orders.where('userId').equals(pid()).toArray();
    orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (statusFilter !== 'all') orders = orders.filter(o => o.status === statusFilter);

    if (!orders.length) {
      list.innerHTML = '<div style="text-align:center;padding:50px 0;color:#999;font-size:13px;">暂无相关订单</div>';
      return;
    }

    const statusMap = {
      pending_payment: { label: '待付款', color: '#fa8c16' },
      paid: { label: '已付款', color: '#1890ff' },
      unshipped: { label: '待发货', color: '#1890ff' },
      shipped: { label: '已发货', color: '#722ed1' },
      pending_receipt: { label: '待签收', color: '#e87d5e' },
      completed: { label: '已完成', color: '#999' }
    };

    let html = '';
    orders.forEach(o => {
      const st = statusMap[o.status] || { label: o.status, color: '#999' };
      const date = new Date(o.createdAt || 0);
      const dateStr = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
      const itemsHtml = (o.items || []).map(it =>
        '<div style="display:flex;justify-content:space-between;font-size:12px;color:#666;padding:2px 0;">' +
          '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(it.name) + ' x' + it.qty + '</span>' +
          '<span style="margin-left:8px;color:#999;">¥' + fmtPrice(it.price) + '</span>' +
        '</div>'
      ).join('');

      let actions = '';
      if (o.status === 'pending_payment') {
        actions = '<button onclick="shoppingSystem.cancelOrder(' + o.id + ')" style="border:1px solid #ddd;background:#fff;color:#666;font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;">取消订单</button>';
      } else if (o.status === 'unshipped') {
        actions = '<button onclick="shoppingSystem.remindShip(' + o.id + ')" style="border:1px solid #ddd;background:#fff;color:#666;font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;margin-right:8px;">提醒发货</button>' +
          '<button onclick="shoppingSystem.viewLogistics(' + o.id + ')" style="border:none;background:#fff5f0;color:#f5a07a;font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;">查看物流</button>';
      } else if (o.status === 'shipped') {
        actions = '<button onclick="shoppingSystem.viewLogistics(' + o.id + ')" style="border:none;background:#fff5f0;color:#f5a07a;font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;margin-right:8px;">查看物流</button>' +
          '<button onclick="shoppingSystem.confirmReceipt(' + o.id + ')" style="border:none;background:linear-gradient(90deg,#f5a07a,#e87d5e);color:#fff;font-size:12px;padding:6px 16px;border-radius:14px;cursor:pointer;">确认收货</button>';
      } else if (o.status === 'pending_receipt') {
        actions = '<button onclick="shoppingSystem.viewLogistics(' + o.id + ')" style="border:none;background:#fff5f0;color:#f5a07a;font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;margin-right:8px;">查看物流</button>' +
          '<button onclick="shoppingSystem.confirmReceipt(' + o.id + ')" style="border:none;background:linear-gradient(90deg,#f5a07a,#e87d5e);color:#fff;font-size:12px;padding:6px 16px;border-radius:14px;cursor:pointer;">确认收货</button>';
      } else if (o.status === 'completed') {
        actions = '<button onclick="shoppingSystem.deleteOrder(' + o.id + ')" style="border:1px solid #ddd;background:#fff;color:#999;font-size:12px;padding:6px 14px;border-radius:14px;cursor:pointer;">删除订单</button>';
      }
      if (o.giftRecipientName) {
        actions = '<span style="font-size:11px;color:#e87d5e;margin-right:8px;">送礼给 ' + esc(o.giftRecipientName) + '</span>' + actions;
      }

      html +=
        '<div style="background:#fff;border-radius:10px;padding:12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<span style="font-size:11px;color:#999;">订单号 ' + esc(o.orderNo) + '</span>' +
            '<span style="font-size:12px;font-weight:700;color:' + st.color + ';">' + st.label + '</span>' +
          '</div>' +
          '<div style="padding:4px 0 6px;">' + itemsHtml + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#999;margin-bottom:8px;">' +
            '<span>' + dateStr + '</span>' +
            '<span>共 ' + (o.items || []).reduce((s, it) => s + it.qty, 0) + ' 件 实付 <span style="color:#e87d5e;font-weight:700;font-size:14px;">¥' + fmtPrice(o.total) + '</span></span>' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;align-items:center;border-top:1px solid #f5f5f5;padding-top:8px;">' + actions + '</div>' +
        '</div>';
    });
    list.innerHTML = html;
  }

  async function cancelOrder(orderId) {
    showCustomConfirm('取消订单', '确定取消该订单吗？', async () => {
      await db.shopping_orders.delete(orderId);
      renderOrders(shoppingOrderTab);
      showToast('订单已取消');
    });
  }

  async function deleteOrder(orderId) {
    showCustomConfirm('删除订单', '确定删除该订单记录吗？', async () => {
      await db.shopping_orders.delete(orderId);
      renderOrders(shoppingOrderTab);
      showToast('已删除');
    });
  }

  function remindShip(orderId) { showToast('已提醒卖家尽快发货'); }

  async function advanceOrder(orderId) {
    const o = await db.shopping_orders.get(orderId);
    if (!o) return;
    let next = o.status;
    if (o.status === 'unshipped') next = 'shipped';
    else if (o.status === 'shipped') next = 'pending_receipt';
    if (next !== o.status) {
      await db.shopping_orders.update(orderId, { status: next });
      showToast('物流已更新');
      renderOrders(shoppingOrderTab);
    }
  }

  // ============================================================
  //  12.5 物流追踪卡片（按时间轴渲染）
  // ============================================================
  const LOGISTICS_CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '苏州', '西安', '重庆', '天津'];
  const LOGISTICS_STATIONS = ['高新区分拨中心', '城南转运中心', '空港物流园', '东站集散中心', '滨河中转站', '经开区配送 hub'];

  function _hashStr(s) {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function _buildLogisticsTimeline(order) {
    const baseTime = order.paidAt || order.createdAt || Date.now();
    const hash = _hashStr(order.orderNo || '');
    const city = LOGISTICS_CITIES[hash % LOGISTICS_CITIES.length];
    const station = LOGISTICS_STATIONS[(hash >> 4) % LOGISTICS_STATIONS.length];
    const stages = [
      { t: 0,            title: '商家已发货', desc: '【' + (order.items && order.items[0] ? order.items[0].storeName || '商家' : '商家') + '】您的商品已打包完成，等待快递揽收', icon: 'box' },
      { t: 2 * 3600000,  title: '待揽收', desc: '快递员已接单，即将上门取件', icon: 'clock' },
      { t: 6 * 3600000,  title: '已揽收', desc: '包裹已被快递员取走，等待发往分拨中心', icon: 'pickup' },
      { t: 12 * 3600000, title: '运输中', desc: '包裹已发往【' + city + '】预计明日到达', icon: 'truck' },
      { t: 24 * 3600000, title: '到达中转站', desc: '包裹已到达【' + city + station + '】', icon: 'station' },
      { t: 36 * 3600000, title: '派送中', desc: '包裹已分配给快递员，正在配送，预计剩余 2 小时', icon: 'delivery' },
      { t: 48 * 3600000, title: '已签收', desc: '您的包裹已签收，签收人：本人', icon: 'done' }
    ];
    return { stages, baseTime, city, station };
  }

  function _logisticsIconSvg(name) {
    const icons = {
      box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      pickup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M21 16v5h-5"/><path d="M3 16v5h5"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></svg>',
      truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
      station: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>',
      delivery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
      done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    };
    return icons[name] || icons.box;
  }

  async function viewLogistics(orderId) {
    const o = await db.shopping_orders.get(orderId);
    if (!o) { showToast('订单不存在'); return; }
    if (o.status === 'pending_payment') { showToast('订单待付款，暂无物流信息'); return; }

    const { stages, baseTime } = _buildLogisticsTimeline(o);
    const now = Date.now();
    const elapsed = now - baseTime;

    // 根据经过时间自动推进订单状态
    let statusChanged = false;
    if (elapsed > 12 * 3600000 && o.status === 'unshipped') {
      await db.shopping_orders.update(orderId, { status: 'shipped' });
      o.status = 'shipped'; statusChanged = true;
    } else if (elapsed > 36 * 3600000 && o.status === 'shipped') {
      await db.shopping_orders.update(orderId, { status: 'pending_receipt' });
      o.status = 'pending_receipt'; statusChanged = true;
    }

    // 找到当前阶段索引
    let currentIdx = 0;
    for (let i = 0; i < stages.length; i++) {
      if (elapsed >= stages[i].t) currentIdx = i;
    }
    // 已完成/已签收的订单直接显示全部
    if (o.status === 'completed') currentIdx = stages.length - 1;

    const fmtTime = (ts) => {
      const d = new Date(ts);
      return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    // 构建时间轴 HTML
    let timelineHtml = '';
    for (let i = stages.length - 1; i >= 0; i--) {
      const s = stages[i];
      const reached = i <= currentIdx;
      const isCurrent = i === currentIdx;
      const dotColor = isCurrent ? '#e87d5e' : (reached ? '#07c160' : '#ccc');
      const lineColor = reached ? '#07c160' : '#eee';
      const textColor = reached ? '#333' : '#bbb';
      const ts = baseTime + s.t;
      const timeStr = reached ? fmtTime(ts) : '预计 ' + fmtTime(ts);

      timelineHtml +=
        '<div style="display:flex;gap:12px;position:relative;">' +
          // 时间点 + 连接线
          '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:' + (isCurrent ? 'linear-gradient(135deg,#f5a07a,#e87d5e)' : reached ? '#07c160' : '#f5f5f5') + ';color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:' + (isCurrent ? '0 0 0 4px rgba(232,125,94,0.15)' : 'none') + ';">' +
              '<span style="width:14px;height:14px;display:flex;align-items:center;justify-content:center;">' + _logisticsIconSvg(s.icon) + '</span>' +
            '</div>' +
            (i > 0 ? '<div style="width:2px;flex:1;min-height:30px;background:' + lineColor + ';margin:2px 0;"></div>' : '') +
          '</div>' +
          // 内容
          '<div style="flex:1;padding-bottom:' + (i > 0 ? '20px' : '0') + ';">' +
            '<div style="font-size:14px;font-weight:' + (isCurrent ? '700' : '500') + ';color:' + textColor + ';">' + s.title +
              (isCurrent ? '<span style="display:inline-block;font-size:10px;color:#fff;background:#e87d5e;padding:1px 6px;border-radius:3px;margin-left:6px;font-weight:600;">最新</span>' : '') +
            '</div>' +
            '<div style="font-size:12px;color:' + (reached ? '#888' : '#bbb') + ';margin-top:3px;line-height:1.5;">' + s.desc + '</div>' +
            '<div style="font-size:11px;color:#bbb;margin-top:3px;">' + timeStr + '</div>' +
          '</div>' +
        '</div>';
    }

    // 预计剩余时间
    let etaHtml = '';
    if (o.status !== 'completed') {
      const remainingMs = stages[6].t - elapsed;
      if (remainingMs > 0) {
        const remainHours = Math.ceil(remainingMs / 3600000);
        etaHtml =
          '<div style="background:linear-gradient(135deg,#fff5f0,#ffe8db);border-radius:12px;padding:14px 16px;margin-top:12px;display:flex;align-items:center;gap:10px;">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:#e87d5e;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + _logisticsIconSvg('clock') + '</div>' +
            '<div>' +
              '<div style="font-size:13px;color:#333;font-weight:600;">预计剩余 ' + remainHours + ' 小时</div>' +
              '<div style="font-size:11px;color:#999;margin-top:2px;">预计 ' + fmtTime(baseTime + stages[6].t) + ' 送达</div>' +
            '</div>' +
          '</div>';
      }
    }

    const orderNoShort = (o.orderNo || '').slice(-12);
    const html =
      '<div style="padding:0 0 8px;">' +
        // 头部：快递公司
        '<div style="background:linear-gradient(135deg,#f5a07a,#e87d5e);border-radius:12px;padding:16px;color:#fff;margin-bottom:12px;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;">' + _logisticsIconSvg('truck') + '</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:15px;font-weight:700;">极速达快递</div>' +
              '<div style="font-size:11px;opacity:0.9;margin-top:2px;">运单号 ' + orderNoShort + '</div>' +
            '</div>' +
            '<div style="font-size:11px;background:rgba(255,255,255,0.2);padding:3px 10px;border-radius:12px;font-weight:600;">' +
              (o.status === 'completed' ? '已签收' : o.status === 'pending_receipt' ? '待签收' : '运输中') +
            '</div>' +
          '</div>' +
        '</div>' +
        // 商品摘要
        '<div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:12px;">' +
          (o.items || []).map(it =>
            '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">' +
              '<div style="width:36px;height:36px;border-radius:6px;overflow:hidden;flex-shrink:0;">' + productImgHtml(it.name, 36, 36, 16) + '</div>' +
              '<div style="flex:1;font-size:12px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(it.name) + ' x' + it.qty + '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
        // 时间轴
        '<div style="background:#fff;border-radius:12px;padding:16px 16px 8px;">' +
          '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:14px;">物流跟踪</div>' +
          timelineHtml +
        '</div>' +
        etaHtml +
        '<div style="height:8px;"></div>' +
      '</div>';

    showCustomHtmlAlert('物流详情', html);
    if (statusChanged) renderOrders(shoppingOrderTab);
  }

  async function confirmReceipt(orderId) {
    const o = await db.shopping_orders.get(orderId);
    if (!o) return;
    if (o.status !== 'pending_receipt') { showToast('当前订单不可确认收货'); return; }
    await db.shopping_orders.update(orderId, { status: 'completed' });
    showToast('确认收货成功');
    renderOrders(shoppingOrderTab);
  }

  // ============================================================
  //  13. 资料编辑
  // ============================================================
  function updateProfileName() {
    const profile = getProfile();
    showCustomPrompt('修改昵称', profile.name || '', async (val) => {
      if (val && val.trim()) {
        profile.name = val.trim();
        saveProfile(profile);
        renderMine();
        showToast('昵称已更新');
      }
    });
  }

  function updateProfileAvatar() {
    // 动作面板：本地上传 / 图片URL / 重置
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;';
    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:#fff;width:100%;border-radius:16px 16px 0 0;padding:8px 0 calc(8px + env(safe-area-inset-bottom,0px));';
    sheet.innerHTML =
      '<div style="padding:14px;text-align:center;font-size:13px;color:#999;border-bottom:1px solid #f5f5f5;">更换头像</div>' +
      '<button id="av-upload" style="display:block;width:100%;border:none;background:none;padding:14px;font-size:15px;color:#333;cursor:pointer;">本地上传</button>' +
      '<button id="av-url" style="display:block;width:100%;border:none;background:none;padding:14px;font-size:15px;color:#333;cursor:pointer;border-top:1px solid #f5f5f5;">输入图片 URL</button>' +
      '<button id="av-reset" style="display:block;width:100%;border:none;background:none;padding:14px;font-size:15px;color:#999;cursor:pointer;border-top:1px solid #f5f5f5;">恢复默认头像</button>' +
      '<button id="av-cancel" style="display:block;width:100%;border:none;background:none;padding:14px;font-size:15px;color:#999;cursor:pointer;border-top:6px solid #f5f5f5;">取消</button>';
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => closeOverlay(overlay);
    sheet.querySelector('#av-cancel').onclick = close;
    sheet.querySelector('#av-upload').onclick = () => {
      close();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const profile = getProfile();
          profile.avatar = reader.result;
          saveProfile(profile);
          renderMine();
          showToast('头像已更新');
        };
        reader.readAsDataURL(file);
      };
      input.click();
    };
    sheet.querySelector('#av-url').onclick = () => {
      close();
      showCustomPrompt('输入头像图片 URL', '', (val) => {
        if (val && val.trim()) {
          const profile = getProfile();
          profile.avatar = val.trim();
          saveProfile(profile);
          renderMine();
          showToast('头像已更新');
        }
      });
    };
    sheet.querySelector('#av-reset').onclick = () => {
      close();
      const profile = getProfile();
      delete profile.avatar;
      saveProfile(profile);
      renderMine();
      showToast('已恢复默认头像');
    };
  }

  // ============================================================
  //  14. 地址管理
  // ============================================================
  async function manageAddresses() {
    if (!pid()) { showToast('请先选择我的人设'); return; }
    await renderAddressManager();
  }

  async function renderAddressManager() {
    const list = await db.shopping_addresses.where('userId').equals(pid()).toArray();
    const overlay = document.getElementById('shopping-addr-overlay');
    if (!overlay) return;
    showOverlay('shopping-addr-overlay');
    let html =
      '<div style="background:#fff;position:sticky;top:0;z-index:5;display:flex;align-items:center;padding:10px 6px;border-bottom:1px solid #eee;">' +
        '<button id="am-back" style="border:none;background:none;color:#333;cursor:pointer;padding:6px;">' + ICO.back + '</button>' +
        '<span style="font-size:15px;font-weight:700;color:#333;">收货地址管理</span>' +
        '<button id="am-add" style="margin-left:auto;border:none;background:#f5a07a;color:#fff;font-size:12px;font-weight:600;padding:7px 14px;border-radius:14px;cursor:pointer;margin-right:6px;">+ 新增</button>' +
      '</div>' +
      '<div id="am-list" style="padding:10px 8px 40px;"></div>';
    overlay.innerHTML = html;

    const listEl = overlay.querySelector('#am-list');
    if (!list.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:50px 0;color:#999;font-size:13px;">暂无收货地址，点击右上角新增</div>';
    } else {
      let lhtml = '';
      list.forEach(a => {
        lhtml +=
          '<div style="background:#fff;border-radius:10px;padding:12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
              '<span style="font-size:14px;font-weight:700;color:#333;">' + esc(a.name) + '</span>' +
              '<span style="font-size:12px;color:#999;">' + esc(a.phone || '') + '</span>' +
              (a.isDefault ? '<span style="font-size:10px;color:#fff;background:#f5b97a;padding:1px 5px;border-radius:3px;">默认</span>' : '') +
            '</div>' +
            '<div style="font-size:12px;color:#666;line-height:1.4;margin-bottom:8px;">' + esc(a.address || '') + '</div>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #f5f5f5;padding-top:8px;">' +
              (a.isDefault ? '' : '<button data-set-default="' + a.id + '" style="border:1px solid #eee;background:#fff;color:#666;font-size:11px;padding:5px 12px;border-radius:12px;cursor:pointer;">设为默认</button>') +
              '<button data-edit="' + a.id + '" style="border:1px solid #eee;background:#fff;color:#f5a07a;font-size:11px;padding:5px 12px;border-radius:12px;cursor:pointer;">编辑</button>' +
              '<button data-del="' + a.id + '" style="border:1px solid #eee;background:#fff;color:#999;font-size:11px;padding:5px 12px;border-radius:12px;cursor:pointer;">删除</button>' +
            '</div>' +
          '</div>';
      });
      listEl.innerHTML = lhtml;
    }

    overlay.querySelector('#am-back').onclick = () => hideOverlay('shopping-addr-overlay');
    overlay.querySelector('#am-add').onclick = () => { hideOverlay('shopping-addr-overlay'); editAddress(null); };
    listEl.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const id = Number(b.getAttribute('data-edit')); hideOverlay('shopping-addr-overlay'); editAddress(id); });
    listEl.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const id = Number(b.getAttribute('data-del'));
      showCustomConfirm('删除地址', '确定删除该地址吗？', async () => {
        await db.shopping_addresses.delete(id);
        showToast('已删除');
        renderAddressManager();
      });
    });
    listEl.querySelectorAll('[data-set-default]').forEach(b => b.onclick = async () => {
      const id = Number(b.getAttribute('data-set-default'));
      const all = await db.shopping_addresses.where('userId').equals(pid()).toArray();
      for (const a of all) {
        await db.shopping_addresses.update(a.id, { isDefault: a.id === id ? 1 : 0 });
      }
      showToast('已设为默认');
      renderAddressManager();
    });
  }

  function editAddress(id) {
    db.shopping_addresses.get(id || 0).then(async (existed) => {
      const a = existed || { userId: pid(), name: '', phone: '', address: '', isDefault: 0 };
      // 三步收集：姓名 / 电话 / 详细地址
      showCustomPrompt('收件人姓名', a.name || '', (name) => {
        if (!name || !name.trim()) { showToast('姓名不能为空'); return; }
        a.name = name.trim();
        showCustomPrompt('联系电话', a.phone || '', (phone) => {
          a.phone = (phone || '').trim();
          showCustomPrompt('详细收货地址（省市区+门牌号）', a.address || '', async (address) => {
            if (!address || !address.trim()) { showToast('地址不能为空'); return; }
            a.address = address.trim();
            if (existed) {
              await db.shopping_addresses.update(id, a);
              showToast('地址已更新');
            } else {
              const count = await db.shopping_addresses.where('userId').equals(pid()).count();
              a.isDefault = count === 0 ? 1 : 0;
              await db.shopping_addresses.add(a);
              showToast('地址已新增');
            }
            renderAddressManager();
          });
        });
      });
    });
  }

  // ============================================================
  //  15. 神券查看
  // ============================================================
  async function viewCoupons() {
    if (!pid()) { showToast('请先选择我的人设'); return; }
    const now = Date.now();
    const all = await db.shopping_coupons.where('userId').equals(pid()).toArray();
    const valid = all.filter(c => (c.expireAt || 0) > now && (c.usedCount || 0) < 1);
    let html;
    if (!valid.length) {
      html = '<div style="text-align:center;padding:40px 20px;color:#999;font-size:13px;">暂无可用神券<br><span style="font-size:11px;">下单外卖时可能触发神券加购</span></div>';
    } else {
      html = '<div style="padding:12px;">';
      valid.forEach(c => {
        const left = Math.max(0, Math.ceil((c.expireAt - now) / 86400000));
        html +=
          '<div style="background:linear-gradient(135deg,#fff5f0,#fff);border:1px dashed #f5a07a;border-radius:10px;padding:14px;margin-bottom:10px;display:flex;align-items:center;">' +
            '<div style="text-align:center;padding-right:12px;border-right:1px dashed #ffd4c2;">' +
              '<div style="font-size:11px;color:#e87d5e;">¥</div><div style="font-size:26px;font-weight:700;color:#e87d5e;">' + (c.faceValue || 0) + '</div>' +
            '</div>' +
            '<div style="flex:1;padding-left:12px;">' +
              '<div style="font-size:13px;font-weight:600;color:#333;">' + esc(c.type || '神券') + '</div>' +
              '<div style="font-size:11px;color:#999;margin-top:4px;">剩余 ' + left + ' 天有效</div>' +
            '</div>' +
          '</div>';
      });
      html += '</div>';
    }
    showCustomHtmlAlert('我的神券 (' + valid.length + ')', html);
  }

  // ============================================================
  //  16. 暴露接口
  // ============================================================
  window.shoppingSystem = {
    init, switchTab, renderHome, switchMode, selectCategory, refreshProducts,
    generateProducts, renderProductGrid, openProductDetail, closeProductDetail,
    addToCart, renderCart, toggleCartSelect, toggleSelectAll, updateCartQuantity,
    deleteCartItems, openCheckout, closeCheckout, renderCheckoutPage,
    selectAddress, selectPaymentMethod, selectPayer, submitOrder,
    renderMine, switchOrderTab, renderOrders, confirmReceipt,
    updateProfileName, updateProfileAvatar, manageAddresses, updateCartBadge,
    // 内部交互辅助
    doSearch, openProductDetailByIdx, openStoreDetailByIdx, openStoreDetail, closeStoreDetail,
    incStoreProduct, decStoreProduct, checkoutStore, selectTravelService,
    addToCartFromDetail, buyNowFromDetail, checkoutSelected, toggleCoupon, openStoreFromDetail,
    setCheckoutMessage, cancelOrder, deleteOrder, remindShip, advanceOrder,
    viewLogistics, viewCoupons, editAddress, renderAddressManager,
    selectDeductCoupon, addFlashCoupon,
    // 预留：聊天集成后续实现
    createPayForMeCard: async function(payerSessionId, orderData, message) {
      if (!payerSessionId) return;
      const items = (orderData.items || []).map(item => ({
        name: item.name || item.title || '商品',
        price: item.price || 0,
        quantity: item.qty || item.quantity || 1
      }));
      const total = orderData.total || orderData.totalAmount || 0;
      const content = JSON.stringify({
        items: items,
        total: total,
        message: message || '',
        status: 'pending',
        orderNo: orderData.orderNo || ''
      });
      await db.messages.add({
        sessionId: payerSessionId,
        senderType: 'user',
        senderId: Number(localStorage.getItem("active_me_id") || 0),
        content: content,
        contentType: 'pay_for_me',
        timestamp: Date.now()
      });
      showToast("代付请求已发送到对话");
    },

    createGiftCard: async function(sessionId, orderData) {
      if (!sessionId) return;
      const items = (orderData.items || []).map(item => ({
        name: item.name || item.title || '商品',
        price: item.price || 0,
        quantity: item.qty || item.quantity || 1
      }));
      const total = orderData.total || orderData.totalAmount || 0;
      const content = JSON.stringify({
        items: items,
        total: total,
        message: orderData.message || '送给你的一份心意',
        status: 'gift',
        orderNo: orderData.orderNo || ''
      });
      await db.messages.add({
        sessionId: sessionId,
        senderType: 'user',
        senderId: Number(localStorage.getItem("active_me_id") || 0),
        content: content,
        contentType: 'gift',
        timestamp: Date.now()
      });
      showToast("礼物已发送到对话");
    }
  };

  // 入口
  window.initShoppingApp = function () { try { shoppingSystem.init(); } catch (e) { console.error('initShoppingApp error', e); } };
})();
