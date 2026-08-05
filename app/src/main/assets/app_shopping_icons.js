/**
 * app_shopping_icons.js - 购物商品 SVG 图标库
 * 提供 75+ 高精度矢量商品图标，按关键词智能匹配商品名。
 * 暴露 window.PRODUCT_ICONS 和 window.getProductIcon(name)
 */
(function () {
  "use strict";

  // 通用包装：给 SVG 加上尺寸和颜色
  function wrap(svgInner, opts) {
    opts = opts || {};
    var size = opts.size || 48;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">' + svgInner + '</svg>';
  }

  // 每个图标：keywords 为匹配关键词数组，svg 为内层路径
  var ICONS = {
    // ==================== 水果 (12) ====================
    apple: {
      kw: ['苹果', 'apple', '红富士'],
      svg: '<path d="M12 7c0-2 1.5-3.5 3.5-3.5" stroke="#8B5E3C" stroke-width="1.5" stroke-linecap="round"/><path d="M12 7c0-1 .5-2 1.5-2.5" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="12" cy="14" rx="6.5" ry="7" fill="#E8453C"/><path d="M11 14.5c-.8-.8-2-.8-2.8 0" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/>'
    },
    pear: {
      kw: ['梨', 'pear', '梨子', '雪梨'],
      svg: '<path d="M12 4c0-1 .5-1.5 1-2" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="12" cy="9" rx="2.5" ry="3" fill="#9DBA29"/><ellipse cx="12" cy="16" rx="5" ry="5.5" fill="#C4D85B"/><path d="M10 13c-1 .5-1.5 1.5-1 2.5" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity="0.4"/>'
    },
    orange: {
      kw: ['橘子', '橙子', 'orange', '柑橘', '砂糖橘'],
      svg: '<circle cx="12" cy="13" r="7" fill="#FF9F2D"/><circle cx="12" cy="13" r="7" stroke="#FF7A00" stroke-width="0.8" fill="none"/><path d="M12 6c0-1 .5-2 1.5-2.5" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8v10M7 13h10M9 9.5l5.5 5.5M9 16.5l5.5-5.5" stroke="#FF7A00" stroke-width="0.6" opacity="0.3"/>'
    },
    banana: {
      kw: ['香蕉', 'banana'],
      svg: '<path d="M5 16c0 2 2 3.5 5 3.5s6-1 7.5-3c1-1.3 1-3 .5-4-.3-.5-.8-.3-1 .2-.5 1.2-2 2.3-4 2.8-3 .7-5-.5-6-2-.3-.4-.8-.3-1 .2-.5 1-.5 2 .5 2.3z" fill="#FFD93D" stroke="#E6B800" stroke-width="0.8"/><path d="M17.5 9.5c.5-1 .5-2 0-3" stroke="#8B5E3C" stroke-width="1.2" stroke-linecap="round"/>'
    },
    grape: {
      kw: ['葡萄', 'grape', '提子'],
      svg: '<circle cx="9" cy="10" r="2.3" fill="#9B59B6"/><circle cx="12" cy="9" r="2.3" fill="#AB6BC5"/><circle cx="15" cy="10" r="2.3" fill="#9B59B6"/><circle cx="10.5" cy="13" r="2.3" fill="#8E44AD"/><circle cx="13.5" cy="13" r="2.3" fill="#9B59B6"/><circle cx="12" cy="16" r="2.3" fill="#8E44AD"/><path d="M12 6.5c0-1 .5-2 1.5-2.5" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round"/>'
    },
    strawberry: {
      kw: ['草莓', 'strawberry'],
      svg: '<path d="M12 8c-3 0-5 2-5 5s2 6 5 6 5-3 5-6-2-5-5-5z" fill="#E8453C"/><path d="M8 6l2 2M12 5v3M16 6l-2 2" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round"/><circle cx="10" cy="12" r="0.6" fill="#FFD93D"/><circle cx="13" cy="11" r="0.6" fill="#FFD93D"/><circle cx="11" cy="14" r="0.6" fill="#FFD93D"/><circle cx="14" cy="15" r="0.6" fill="#FFD93D"/>'
    },
    cherry: {
      kw: ['樱桃', 'cherry', '车厘子'],
      svg: '<circle cx="8" cy="16" r="3.5" fill="#E8453C"/><circle cx="15" cy="17" r="3.5" fill="#C0392B"/><path d="M8 12.5c1-3 3-5 6-6" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M15 13.5c-1-3-3-5-6-6" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round" fill="none"/>'
    },
    watermelon: {
      kw: ['西瓜', 'watermelon'],
      svg: '<path d="M3 14a9 9 0 0 0 18 0H3z" fill="#E8453C"/><path d="M3 14a9 9 0 0 0 18 0" stroke="#6B8E23" stroke-width="2" fill="none"/><path d="M3 14h18" stroke="#A8D08D" stroke-width="1.5"/><path d="M7 15l.5 2M11 15v2.5M15 15l-.5 2M19 15l-1 2" stroke="#1A1A1A" stroke-width="1" stroke-linecap="round"/>'
    },
    lemon: {
      kw: ['柠檬', 'lemon'],
      svg: '<ellipse cx="12" cy="13" rx="6" ry="5" fill="#FFD93D" transform="rotate(-20 12 13)"/><ellipse cx="12" cy="13" rx="6" ry="5" stroke="#E6B800" stroke-width="0.8" fill="none" transform="rotate(-20 12 13)"/><circle cx="7.5" cy="10" r="0.8" fill="#6B8E23"/><path d="M7 9.5c-1-.5-2-.5-2.5 0" stroke="#6B8E23" stroke-width="1" stroke-linecap="round"/>'
    },
    peach: {
      kw: ['桃子', 'peach', '水蜜桃'],
      svg: '<path d="M12 8c-3 0-5.5 2.5-5.5 6s2.5 6 5.5 6 5.5-2.5 5.5-6-2.5-6-5.5-6z" fill="#FFABC4"/><path d="M12 8c0-2 1-3.5 2.5-4.5" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M12 8c-1-1.5-1-3 0-4.5" stroke="#8B5E3C" stroke-width="0.8" fill="none"/><path d="M8 11c.5-1 1.5-1.5 2.5-1.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>'
    },
    mango: {
      kw: ['芒果', 'mango'],
      svg: '<path d="M6 14c0-4 3-7 7-7 3 0 5 2 5 5 0 3-3 5-7 5-3 0-5-1-5-3z" fill="#FFB347"/><path d="M6 14c0-4 3-7 7-7" stroke="#FF9F2D" stroke-width="0.8" fill="none"/><path d="M12 7c0-1 .5-2 1.5-2.5" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round"/>'
    },
    pineapple: {
      kw: ['菠萝', 'pineapple', '凤梨'],
      svg: '<path d="M9 7c-1-2-1-4 0-5M12 6c0-2 0-4 1-5M15 7c1-2 1-4 0-5" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/><ellipse cx="12" cy="14" rx="5" ry="6" fill="#FFD93D"/><path d="M8 12l1.5 1.5M12 11v2M16 12l-1.5 1.5M8 16h2M14 16h2" stroke="#E69500" stroke-width="0.8"/>'
    },

    // ==================== 食品 (16) ====================
    cake: {
      kw: ['蛋糕', 'cake', '生日蛋糕', '慕斯', '芝士'],
      svg: '<path d="M5 12h14v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8z" fill="#F5DEB3"/><path d="M5 12h14v-2a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v2z" fill="#FFB6C1"/><path d="M5 14h14" stroke="#D4A574" stroke-width="0.6"/><path d="M9 9V6M12 9V5M15 9V6" stroke="#E8453C" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="5.5" r="0.8" fill="#FF6B6B"/><circle cx="12" cy="4.5" r="0.8" fill="#FF6B6B"/><circle cx="15" cy="5.5" r="0.8" fill="#FF6B6B"/>'
    },
    bread: {
      kw: ['面包', 'bread', '吐司', '法棍'],
      svg: '<path d="M4 13c0-3 3-5 8-5s8 2 8 5v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4z" fill="#DEB887"/><path d="M7 11c0-1 1-1.5 2-1.5M11 10.5c0-1 1-1.5 2-1.5M15 11c0-1 1-1.5 2-1.5" stroke="#CD853F" stroke-width="0.8" stroke-linecap="round"/>'
    },
    cookie: {
      kw: ['饼干', 'cookie', '曲奇'],
      svg: '<circle cx="12" cy="12" r="8" fill="#D4A574"/><circle cx="12" cy="12" r="8" stroke="#CD853F" stroke-width="0.6" fill="none"/><circle cx="9" cy="9" r="1.2" fill="#6B4226"/><circle cx="14" cy="10" r="1" fill="#6B4226"/><circle cx="10" cy="14" r="0.9" fill="#6B4226"/><circle cx="15" cy="14" r="1.1" fill="#6B4226"/><circle cx="13" cy="13" r="0.7" fill="#6B4226"/>'
    },
    donut: {
      kw: ['甜甜圈', 'donut', '多纳圈'],
      svg: '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" fill="#FFB6C1"/><path d="M7 9l1-2M11 5l1-1M16 7l2-1M18 12l2 1M16 17l1 2M10 18l-1 1M6 14l-2-1" stroke="#E8A0BF" stroke-width="1" stroke-linecap="round"/><circle cx="8" cy="8" r="0.5" fill="#FFD93D"/><circle cx="14" cy="6" r="0.5" fill="#8FD3F4"/><circle cx="17" cy="11" r="0.5" fill="#FFD93D"/><circle cx="9" cy="17" r="0.5" fill="#8FD3F4"/>'
    },
    coffee: {
      kw: ['咖啡', 'coffee', '拿铁', '美式', '浓缩'],
      svg: '<path d="M5 10h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6z" fill="#8B5E3C"/><path d="M17 11h2a2 2 0 0 1 0 4h-2" stroke="#8B5E3C" stroke-width="1.5" fill="none"/><path d="M8 4c0 1-1 1-1 2s1 1 1 2M12 4c0 1-1 1-1 2s1 1 1 2" stroke="#A0522D" stroke-width="1" stroke-linecap="round" fill="none"/>'
    },
    milk: {
      kw: ['牛奶', 'milk', '鲜奶', '酸奶'],
      svg: '<path d="M9 3h6v2l1.5 3v12a1 1 0 0 1-1 1H8.5a1 1 0 0 1-1-1V8L9 5V3z" fill="#fff" stroke="#ccc" stroke-width="0.8"/><rect x="9" y="11" width="6" height="4" fill="#4A90D9" rx="0.5"/><path d="M9 3h6" stroke="#999" stroke-width="0.8"/>'
    },
    wine: {
      kw: ['红酒', 'wine', '葡萄酒', '白酒', '啤酒', 'beer'],
      svg: '<path d="M8 3h8v4c0 2.5-1.5 4-2 5v6a1 1 0 0 0 1 1h-6a1 1 0 0 0 1-1v-6c-.5-1-2-2.5-2-5V3z" fill="#8B0000"/><path d="M8 5h8" stroke="#fff" stroke-width="0.5" opacity="0.4"/><path d="M9 8c2 1 4 1 6 0" stroke="#fff" stroke-width="0.5" opacity="0.3" fill="none"/>'
    },
    rice: {
      kw: ['大米', 'rice', '米饭', '粳米', '糯米'],
      svg: '<ellipse cx="12" cy="13" rx="7" ry="5" fill="#F5F5DC" stroke="#D4C9A0" stroke-width="0.6"/><circle cx="9" cy="12" r="0.8" fill="#fff" stroke="#D4C9A0" stroke-width="0.4"/><circle cx="12" cy="11" r="0.8" fill="#fff" stroke="#D4C9A0" stroke-width="0.4"/><circle cx="15" cy="12" r="0.8" fill="#fff" stroke="#D4C9A0" stroke-width="0.4"/><circle cx="11" cy="14" r="0.8" fill="#fff" stroke="#D4C9A0" stroke-width="0.4"/><circle cx="14" cy="14" r="0.8" fill="#fff" stroke="#D4C9A0" stroke-width="0.4"/>'
    },
    noodle: {
      kw: ['面条', 'noodle', '拉面', '泡面', '方便面', '粉丝'],
      svg: '<path d="M4 14h16a6 3 0 0 1-6 3h-4a6 3 0 0 1-6-3z" fill="#F5DEB3" stroke="#CD853F" stroke-width="0.6"/><path d="M6 14c0-3 2-5 6-5s6 2 6 5" stroke="#E0B040" stroke-width="0.8" fill="none"/><path d="M7 12c1-2 3-3 5-3M10 11c2-1 4-1 6 0" stroke="#D4A040" stroke-width="0.6" fill="none" opacity="0.6"/><path d="M9 9c0-1 .5-2 1-2M12 9c0-1 .5-2 1-2" stroke="#8B5E3C" stroke-width="1" stroke-linecap="round"/>'
    },
    dumpling: {
      kw: ['饺子', 'dumpling', '馄饨', '汤圆'],
      svg: '<path d="M5 14c0-1 1-2 2-2h10c1 0 2 1 2 2v1c0 3-3 5-7 5s-7-2-7-5v-1z" fill="#F5DEB3" stroke="#CD853F" stroke-width="0.6"/><path d="M7 12c.5-1 1.5-1 2 0M11 12c.5-1 1.5-1 2 0M15 12c.5-1 1.5-1 2 0" stroke="#CD853F" stroke-width="0.6" fill="none"/><path d="M9 10c0-1 1-2 3-2s3 1 3 2" stroke="#8B5E3C" stroke-width="0.8" fill="none"/>'
    },
    hamburger: {
      kw: ['汉堡', 'hamburger', '汉堡包'],
      svg: '<path d="M4 10c0-3 4-5 8-5s8 2 8 5v1H4v-1z" fill="#D4A574"/><path d="M4 11h16v1c0 1-1 2-2 2H6c-1 0-2-1-2-2v-1z" fill="#8B5E3C"/><path d="M4 14h16c0 2-2 4-4 4H8c-2 0-4-2-4-4z" fill="#D4A574"/><path d="M5 11h14" stroke="#9ACD32" stroke-width="1.5"/><circle cx="8" cy="8" r="0.6" fill="#fff"/><circle cx="12" cy="7" r="0.6" fill="#fff"/><circle cx="16" cy="8" r="0.6" fill="#fff"/>'
    },
    pizza: {
      kw: ['披萨', 'pizza', '比萨'],
      svg: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3z" fill="#FFD700"/><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3z" stroke="#CD853F" stroke-width="0.8" fill="none"/><circle cx="9" cy="10" r="1.2" fill="#E8453C"/><circle cx="14" cy="9" r="1" fill="#E8453C"/><circle cx="15" cy="14" r="1.2" fill="#E8453C"/><circle cx="9" cy="15" r="1" fill="#E8453C"/><circle cx="12" cy="12" r="0.8" fill="#E8453C"/>'
    },
    sushi: {
      kw: ['寿司', 'sushi', '刺身', '日料'],
      svg: '<rect x="6" y="10" width="12" height="6" rx="3" fill="#F5F5DC" stroke="#D4C9A0" stroke-width="0.5"/><rect x="8" y="8" width="8" height="4" rx="2" fill="#FF6347"/><path d="M8 10c1 .5 7 .5 8 0" stroke="#E04040" stroke-width="0.5"/><rect x="7" y="13" width="10" height="0.8" fill="#333" opacity="0.2"/>'
    },
    icecream: {
      kw: ['冰淇淋', 'ice cream', '雪糕', '冰棒', '甜筒'],
      svg: '<path d="M8 10h8l-4 10-4-10z" fill="#D4A574"/><path d="M7 10a5 5 0 0 1 10 0H7z" fill="#FFB6C1"/><path d="M9 7c0-1 .5-2 1.5-2.5M13 7c0-1 .5-2 1.5-2.5" stroke="#FF9999" stroke-width="1.5" stroke-linecap="round" fill="none"/><circle cx="10" cy="5" r="1.5" fill="#FFB6C1"/><circle cx="14" cy="5" r="1.5" fill="#FFB6C1"/>'
    },
    egg: {
      kw: ['鸡蛋', 'egg', '鸭蛋', '鹌鹑蛋'],
      svg: '<ellipse cx="12" cy="13" rx="5.5" ry="7" fill="#FFF8DC" stroke="#E0D0A0" stroke-width="0.6"/><ellipse cx="10" cy="11" rx="1.5" ry="2" fill="#fff" opacity="0.6"/>'
    },
    chocolate: {
      kw: ['巧克力', 'chocolate'],
      svg: '<rect x="5" y="6" width="14" height="12" rx="1" fill="#6B4226"/><rect x="5" y="6" width="14" height="12" rx="1" stroke="#4A2C1A" stroke-width="0.6" fill="none"/><path d="M12 6v12M5 12h14" stroke="#4A2C1A" stroke-width="0.8"/><path d="M8.5 6v12M15.5 6v12" stroke="#4A2C1A" stroke-width="0.5" opacity="0.6"/>'
    },

    // ==================== 蔬菜 (8) ====================
    carrot: {
      kw: ['胡萝卜', 'carrot'],
      svg: '<path d="M14 6l2-2M15 7l2.5-1.5M13 5l1.5-2.5" stroke="#6B8E23" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M10 7L6 17c-.5 1.5.5 2.5 2 2l10-4-8-8z" fill="#FF9F2D"/><path d="M9 10l5 5M8 13l4 4" stroke="#E07000" stroke-width="0.6"/>'
    },
    tomato: {
      kw: ['番茄', 'tomato', '西红柿'],
      svg: '<circle cx="12" cy="14" r="6.5" fill="#E8453C"/><circle cx="12" cy="14" r="6.5" stroke="#C0392B" stroke-width="0.6" fill="none"/><path d="M10 8c0-1 .5-2 1-2.5M12 8c0-1.5.5-2.5 1-3M14 8c0-1 .5-2 1-2.5" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/><path d="M10 8h4l-1 2h-2l-1-2z" fill="#6B8E23"/>'
    },
    corn: {
      kw: ['玉米', 'corn'],
      svg: '<path d="M9 5c0-1 1-1.5 3-1.5s3 .5 3 1.5v13c0 1.5-1 2.5-3 2.5s-3-1-3-2.5V5z" fill="#FFD93D"/><path d="M9 5c0-1 1-1.5 3-1.5s3 .5 3 1.5" stroke="#6B8E23" stroke-width="1" fill="none"/><path d="M10 5c0 2 0 4 0 6M14 5c0 2 0 4 0 6" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/><circle cx="10.5" cy="9" r="0.4" fill="#E6B800"/><circle cx="12" cy="8" r="0.4" fill="#E6B800"/><circle cx="13.5" cy="9" r="0.4" fill="#E6B800"/><circle cx="11" cy="12" r="0.4" fill="#E6B800"/><circle cx="13" cy="12" r="0.4" fill="#E6B800"/><circle cx="10.5" cy="15" r="0.4" fill="#E6B800"/><circle cx="12.5" cy="15" r="0.4" fill="#E6B800"/>'
    },
    mushroom: {
      kw: ['蘑菇', 'mushroom', '香菇', '菌菇'],
      svg: '<path d="M5 11a7 5 0 0 1 14 0c0 1-1 2-2 2H7c-1 0-2-1-2-2z" fill="#D4A574"/><path d="M5 11a7 5 0 0 1 14 0c0 1-1 2-2 2H7c-1 0-2-1-2-2z" stroke="#8B5E3C" stroke-width="0.6" fill="none"/><circle cx="9" cy="9" r="1" fill="#fff" opacity="0.6"/><circle cx="14" cy="8" r="0.8" fill="#fff" opacity="0.6"/><circle cx="12" cy="11" r="0.6" fill="#fff" opacity="0.4"/><path d="M9 13v5c0 1 .5 1.5 1.5 1.5h3c1 0 1.5-.5 1.5-1.5v-5" fill="#F5DEB3" stroke="#D4C9A0" stroke-width="0.5"/>'
    },
    pepper: {
      kw: ['辣椒', 'pepper', '青椒', '柿子椒'],
      svg: '<path d="M14 5c0-1 .5-2 1.5-2" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/><path d="M10 6c0-2 2-3 4-3v3c0 4-2 8-5 10-2 1-4 0-4-2 0-3 2-6 5-8z" fill="#E8453C"/><path d="M10 6c0-2 2-3 4-3" stroke="#6B8E23" stroke-width="1" fill="none"/><path d="M9 13c1-2 3-4 5-5" stroke="#C0392B" stroke-width="0.5" fill="none" opacity="0.4"/>'
    },
    potato: {
      kw: ['土豆', 'potato', '马铃薯', '洋芋'],
      svg: '<ellipse cx="12" cy="13" rx="6" ry="5" fill="#D4A574" transform="rotate(-10 12 13)"/><ellipse cx="12" cy="13" rx="6" ry="5" stroke="#8B5E3C" stroke-width="0.6" fill="none" transform="rotate(-10 12 13)"/><circle cx="9" cy="11" r="0.5" fill="#8B5E3C"/><circle cx="13" cy="12" r="0.5" fill="#8B5E3C"/><circle cx="11" cy="15" r="0.5" fill="#8B5E3C"/><circle cx="15" cy="14" r="0.5" fill="#8B5E3C"/>'
    },
    onion: {
      kw: ['洋葱', 'onion'],
      svg: '<path d="M12 7c-4 0-6 3-6 7s2 5 6 5 6-1 6-5-2-7-6-7z" fill="#E6C9E8"/><path d="M12 7c0-1 .5-2 1-2.5" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/><path d="M8 14c1 2 2 3 4 3M16 14c-1 2-2 3-4 3" stroke="#C49AC4" stroke-width="0.6" fill="none"/><path d="M10 10c-1 1-1.5 2-1.5 3M14 10c1 1 1.5 2 1.5 3" stroke="#C49AC4" stroke-width="0.4" fill="none" opacity="0.5"/>'
    },
    garlic: {
      kw: ['大蒜', 'garlic', '蒜'],
      svg: '<path d="M12 6c-3 0-5 2-5 5s2 6 5 6 5-3 5-6-2-5-5-5z" fill="#F5F5DC" stroke="#D4C9A0" stroke-width="0.5"/><path d="M12 6c0-1 .5-2 1-2.5" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/><path d="M12 8v7M10 10v4M14 10v4" stroke="#D4C9A0" stroke-width="0.5" fill="none"/>'
    },

    // ==================== 美妆 (8) ====================
    lipstick: {
      kw: ['口红', 'lipstick', '唇膏'],
      svg: '<rect x="8" y="10" width="6" height="10" rx="0.5" fill="#444"/><rect x="8" y="10" width="6" height="3" fill="#E8453C"/><path d="M9 4l4 1v4l-4 1V4z" fill="#E8453C"/><path d="M9 4l4 1" stroke="#C0392B" stroke-width="0.5"/><rect x="7.5" y="20" width="7" height="1.5" rx="0.3" fill="#666"/>'
    },
    foundation: {
      kw: ['粉底', 'foundation', '粉底液', '气垫'],
      svg: '<rect x="6" y="6" width="12" height="14" rx="2" fill="#E8C4C4"/><rect x="6" y="6" width="12" height="4" rx="2" fill="#D4A4A4"/><rect x="8" y="7" width="8" height="2" rx="0.5" fill="#fff" opacity="0.4"/><rect x="6" y="6" width="12" height="14" rx="2" stroke="#C49494" stroke-width="0.6" fill="none"/>'
    },
    eyeshadow: {
      kw: ['眼影', 'eyeshadow', '眼影盘'],
      svg: '<rect x="4" y="7" width="16" height="11" rx="1.5" fill="#444"/><rect x="4" y="7" width="16" height="11" rx="1.5" stroke="#222" stroke-width="0.5" fill="none"/><rect x="6" y="9" width="3" height="3" rx="0.3" fill="#8B5E3C"/><rect x="10" y="9" width="3" height="3" rx="0.3" fill="#D4A574"/><rect x="14" y="9" width="3" height="3" rx="0.3" fill="#E8C4C4"/><rect x="6" y="13" width="3" height="3" rx="0.3" fill="#C49AC4"/><rect x="10" y="13" width="3" height="3" rx="0.3" fill="#FFD93D"/><rect x="14" y="13" width="3" height="3" rx="0.3" fill="#9DBA29"/>'
    },
    perfume: {
      kw: ['香水', 'perfume', '香氛'],
      svg: '<rect x="9" y="10" width="6" height="10" rx="1" fill="#E6C9E8" stroke="#C49AC4" stroke-width="0.6"/><rect x="10" y="5" width="4" height="4" rx="0.5" fill="#C49AC4"/><path d="M11 5V3h2v2" stroke="#8B5E3C" stroke-width="1" fill="none"/><circle cx="12" cy="14" r="1.5" fill="#fff" opacity="0.4"/><path d="M16 8c1-1 1-3 0-4" stroke="#C49AC4" stroke-width="0.8" fill="none" opacity="0.5"/>'
    },
    nailpolish: {
      kw: ['指甲油', 'nail polish', '甲油'],
      svg: '<rect x="9" y="8" width="6" height="12" rx="0.5" fill="#E8453C"/><rect x="9" y="8" width="6" height="3" rx="0.5" fill="#C0392B"/><rect x="10" y="3" width="4" height="5" rx="0.3" fill="#333"/><rect x="9" y="8" width="6" height="12" rx="0.5" stroke="#A02828" stroke-width="0.4" fill="none"/><rect x="10" y="11" width="4" height="1" fill="#fff" opacity="0.3"/>'
    },
    mirror: {
      kw: ['镜子', 'mirror', '化妆镜'],
      svg: '<ellipse cx="12" cy="9" rx="6" ry="7" fill="#E6F0FA" stroke="#C0C0C0" stroke-width="1"/><ellipse cx="10" cy="7" rx="2" ry="3" fill="#fff" opacity="0.5"/><rect x="11" y="15" width="2" height="6" rx="0.5" fill="#C0C0C0"/><rect x="8" y="20" width="8" height="1.5" rx="0.3" fill="#A0A0A0"/>'
    },
    comb: {
      kw: ['梳子', 'comb'],
      svg: '<rect x="4" y="9" width="16" height="3" rx="0.5" fill="#D4A574"/><rect x="5" y="12" width="1.2" height="6" rx="0.3" fill="#8B5E3C"/><rect x="8" y="12" width="1.2" height="7" rx="0.3" fill="#8B5E3C"/><rect x="11" y="12" width="1.2" height="8" rx="0.3" fill="#8B5E3C"/><rect x="14" y="12" width="1.2" height="7" rx="0.3" fill="#8B5E3C"/><rect x="17" y="12" width="1.2" height="6" rx="0.3" fill="#8B5E3C"/>'
    },
    cream: {
      kw: ['面霜', 'cream', '乳液', '润肤', '护肤', '精华', 'lotion', 'serum'],
      svg: '<rect x="7" y="9" width="10" height="11" rx="2" fill="#E6C9E8" stroke="#C49AC4" stroke-width="0.6"/><rect x="8" y="6" width="8" height="3" rx="1" fill="#C49AC4"/><rect x="10" y="3" width="4" height="3" rx="0.5" fill="#A070A0"/><rect x="9" y="12" width="6" height="3" rx="0.3" fill="#fff" opacity="0.4"/>'
    },

    // ==================== 家居 (8) ====================
    sofa: {
      kw: ['沙发', 'sofa'],
      svg: '<path d="M4 13c0-2 1-3 3-3h10c2 0 3 1 3 3v4H4v-4z" fill="#9DBA29"/><rect x="3" y="14" width="18" height="4" rx="1" fill="#8FA820"/><rect x="5" y="11" width="3" height="5" rx="0.5" fill="#B5CC44"/><rect x="16" y="11" width="3" height="5" rx="0.5" fill="#B5CC44"/><rect x="5" y="18" width="2" height="3" rx="0.3" fill="#8B5E3C"/><rect x="17" y="18" width="2" height="3" rx="0.3" fill="#8B5E3C"/>'
    },
    lamp: {
      kw: ['台灯', 'lamp', '落地灯', '灯'],
      svg: '<path d="M8 4h8l2 6H6l2-6z" fill="#FFD93D"/><path d="M8 4h8l2 6H6l2-6z" stroke="#E6B800" stroke-width="0.6" fill="none"/><rect x="11" y="10" width="2" height="9" fill="#8B5E3C"/><rect x="8" y="19" width="8" height="2" rx="0.5" fill="#8B5E3C"/><path d="M10 6h4" stroke="#E6B800" stroke-width="0.4" opacity="0.5"/>'
    },
    pillow: {
      kw: ['枕头', 'pillow', '抱枕', '乳胶枕'],
      svg: '<rect x="4" y="8" width="16" height="9" rx="3" fill="#FFB6C1" stroke="#E8A0BF" stroke-width="0.6"/><path d="M7 11c2-1 8-1 10 0M7 14c2 1 8 1 10 0" stroke="#E8A0BF" stroke-width="0.5" fill="none" opacity="0.5"/><circle cx="12" cy="12.5" r="0.5" fill="#E8A0BF" opacity="0.4"/>'
    },
    curtain: {
      kw: ['窗帘', 'curtain', '遮光窗帘'],
      svg: '<rect x="4" y="4" width="16" height="2" rx="0.5" fill="#8B5E3C"/><path d="M5 6c0 5 1 10 0 14M9 6c0 5 1 10 0 14M12 6c0 5 1 10 0 14M15 6c0 5 1 10 0 14M19 6c0 5-1 10 0 14" stroke="#9DBA29" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
    },
    vase: {
      kw: ['花瓶', 'vase'],
      svg: '<path d="M9 4h6v3c0 2 2 3 2 6s-2 7-5 7-5-4-5-7 2-4 2-6V4z" fill="#9DBA29" stroke="#7A9A19" stroke-width="0.6"/><path d="M9 4h6" stroke="#5A7A09" stroke-width="1" stroke-linecap="round"/><path d="M10 10c1-1 3-1 4 0" stroke="#7A9A19" stroke-width="0.5" fill="none" opacity="0.4"/>'
    },
    clock: {
      kw: ['时钟', 'clock', '闹钟', '挂钟'],
      svg: '<circle cx="12" cy="12" r="8" fill="#F5F5DC" stroke="#666" stroke-width="1.2"/><circle cx="12" cy="12" r="8" fill="none" stroke="#999" stroke-width="0.4"/><path d="M12 8v4l3 2" stroke="#333" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="0.8" fill="#333"/><path d="M6 5L4 3M18 5l2-2" stroke="#666" stroke-width="1.2" stroke-linecap="round"/>'
    },
    fan: {
      kw: ['风扇', 'fan', '电风扇'],
      svg: '<circle cx="12" cy="9" r="6" fill="none" stroke="#666" stroke-width="1"/><path d="M12 9c0-3-1-5-3-5-1 0-2 1-2 3 0 2 2 3 5 2zM12 9c3 0 5-1 5-3 0-1-1-2-3-2-2 0-3 2-2 5zM12 9c0 3 1 5 3 5 1 0 2-1 2-3 0-2-2-3-5-2z" fill="#8FD3F4" opacity="0.7"/><circle cx="12" cy="9" r="1" fill="#666"/><rect x="11" y="15" width="2" height="6" fill="#666"/><rect x="8" y="20" width="8" height="1.5" rx="0.3" fill="#666"/>'
    },
    fridge: {
      kw: ['冰箱', 'fridge', '冰柜'],
      svg: '<rect x="6" y="3" width="12" height="18" rx="1.5" fill="#E6F0FA" stroke="#B0C4DE" stroke-width="0.8"/><path d="M6 10h12" stroke="#B0C4DE" stroke-width="0.8"/><rect x="8" y="5" width="1.2" height="3" rx="0.3" fill="#666"/><rect x="8" y="12" width="1.2" height="4" rx="0.3" fill="#666"/>'
    },

    // ==================== 数码 (8) ====================
    phone: {
      kw: ['手机', 'phone', '智能手机', '电话'],
      svg: '<rect x="7" y="2" width="10" height="20" rx="2" fill="#333"/><rect x="8.5" y="4" width="7" height="14" rx="0.5" fill="#1A1A2E"/><rect x="10" y="18.5" width="4" height="1" rx="0.3" fill="#555"/><rect x="8.5" y="4" width="7" height="14" rx="0.5" stroke="#555" stroke-width="0.3" fill="none"/>'
    },
    laptop: {
      kw: ['笔记本', 'laptop', '电脑', '笔记本电'],
      svg: '<rect x="5" y="5" width="14" height="10" rx="1" fill="#444"/><rect x="6.5" y="6.5" width="11" height="7" rx="0.3" fill="#1A1A2E"/><path d="M3 16h18l1 2H2l1-2z" fill="#555"/>'
    },
    headphones: {
      kw: ['耳机', 'headphones', '头戴', '蓝牙耳机'],
      svg: '<path d="M5 13a7 7 0 0 1 14 0" stroke="#444" stroke-width="2" fill="none"/><rect x="3" y="12" width="4" height="7" rx="1.5" fill="#333"/><rect x="17" y="12" width="4" height="7" rx="1.5" fill="#333"/><rect x="3.5" y="14" width="3" height="3" rx="0.5" fill="#555"/><rect x="17.5" y="14" width="3" height="3" rx="0.5" fill="#555"/>'
    },
    camera: {
      kw: ['相机', 'camera', '单反', '摄像机', '摄像头'],
      svg: '<rect x="3" y="7" width="18" height="13" rx="2" fill="#444"/><rect x="3" y="7" width="18" height="13" rx="2" stroke="#222" stroke-width="0.5" fill="none"/><circle cx="12" cy="13" r="4" fill="#1A1A2E" stroke="#666" stroke-width="0.8"/><circle cx="12" cy="13" r="2.5" fill="#0D0D1A" stroke="#444" stroke-width="0.4"/><circle cx="11" cy="12" r="0.8" fill="#fff" opacity="0.2"/><rect x="9" y="4" width="6" height="3" rx="0.5" fill="#444"/><circle cx="17" cy="10" r="0.6" fill="#E8453C"/>'
    },
    keyboard: {
      kw: ['键盘', 'keyboard', '机械键盘'],
      svg: '<rect x="3" y="8" width="18" height="10" rx="1" fill="#444"/><rect x="3" y="8" width="18" height="10" rx="1" stroke="#222" stroke-width="0.5" fill="none"/><rect x="5" y="10" width="2" height="2" rx="0.2" fill="#666"/><rect x="8" y="10" width="2" height="2" rx="0.2" fill="#666"/><rect x="11" y="10" width="2" height="2" rx="0.2" fill="#666"/><rect x="14" y="10" width="2" height="2" rx="0.2" fill="#666"/><rect x="17" y="10" width="2" height="2" rx="0.2" fill="#666"/><rect x="6" y="14" width="12" height="2" rx="0.2" fill="#666"/>'
    },
    mouse: {
      kw: ['鼠标', 'mouse'],
      svg: '<path d="M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#444"/><path d="M12 4v6" stroke="#222" stroke-width="0.8"/><path d="M8 10h8" stroke="#222" stroke-width="0.6" opacity="0.5"/><rect x="11" y="5" width="2" height="4" rx="0.3" fill="#666"/>'
    },
    monitor: {
      kw: ['显示器', 'monitor', '屏幕', '显示屏'],
      svg: '<rect x="3" y="4" width="18" height="12" rx="1.5" fill="#333"/><rect x="4.5" y="5.5" width="15" height="9" rx="0.5" fill="#1A1A2E"/><rect x="10" y="16" width="4" height="3" fill="#555"/><rect x="7" y="19" width="10" height="1.5" rx="0.3" fill="#555"/>'
    },
    charger: {
      kw: ['充电器', 'charger', '充电宝', '数据线', '电源'],
      svg: '<rect x="7" y="6" width="10" height="14" rx="1.5" fill="#333"/><rect x="8.5" y="7.5" width="7" height="4" rx="0.3" fill="#1A1A2E"/><rect x="10" y="13" width="4" height="2" rx="0.3" fill="#E8453C"/><rect x="10" y="16" width="4" height="1" rx="0.2" fill="#666"/><rect x="10" y="3" width="4" height="3" rx="0.3" fill="#555"/><path d="M11 4.5h2" stroke="#999" stroke-width="0.5"/>'
    },

    // ==================== 服饰 (8) ====================
    shirt: {
      kw: ['T恤', '衬衫', 'shirt', '卫衣', '圆领', '针织', '开衫'],
      svg: '<path d="M8 4l-4 3 2 3 2-1v10h8V9l2 1 2-3-4-3-2 1h-4l-2-1z" fill="#4A90D9"/><path d="M8 4l-4 3 2 3 2-1v10h8V9l2 1 2-3-4-3" stroke="#357ABD" stroke-width="0.6" fill="none"/><path d="M10 5c1 .5 3 .5 4 0" stroke="#357ABD" stroke-width="0.5" fill="none"/>'
    },
    pants: {
      kw: ['裤子', 'pants', '牛仔裤', '休闲裤'],
      svg: '<path d="M7 4h10v4l-1 12h-3l-1-9-1 9H8L7 8V4z" fill="#4A6FA5"/><path d="M7 4h10v4l-1 12h-3l-1-9-1 9H8L7 8V4z" stroke="#355070" stroke-width="0.6" fill="none"/><path d="M12 8v9" stroke="#355070" stroke-width="0.4" opacity="0.5"/>'
    },
    dress: {
      kw: ['连衣裙', 'dress', '裙子', '半身裙', 'skirt'],
      svg: '<path d="M9 4h6v3l3 14H6l3-14V4z" fill="#E8453C"/><path d="M9 4h6v3l3 14H6l3-14V4z" stroke="#C0392B" stroke-width="0.6" fill="none"/><path d="M9 7h6" stroke="#C0392B" stroke-width="0.4" opacity="0.5"/><path d="M7 16c3-1 7-1 10 0" stroke="#C0392B" stroke-width="0.4" fill="none" opacity="0.3"/>'
    },
    shoe: {
      kw: ['鞋', 'shoe', '运动鞋', '皮鞋', '球鞋', '板鞋'],
      svg: '<path d="M4 16c0-2 2-3 4-3l3-2c1-1 2-1 3 0l3 2c2 0 3 1 3 3v2H4v-2z" fill="#444"/><path d="M4 16c0-2 2-3 4-3l3-2c1-1 2-1 3 0" stroke="#222" stroke-width="0.6" fill="none"/><path d="M4 18h16" stroke="#222" stroke-width="0.8"/><path d="M8 13l1 3M12 11l1 4" stroke="#666" stroke-width="0.4" opacity="0.5"/>'
    },
    hat: {
      kw: ['帽子', 'hat', 'cap', '遮阳帽', '贝雷帽'],
      svg: '<path d="M4 16c0-4 4-7 8-7s8 3 8 7H4z" fill="#E8453C"/><path d="M4 16c0-4 4-7 8-7s8 3 8 7" stroke="#C0392B" stroke-width="0.6" fill="none"/><rect x="3" y="15" width="18" height="2" rx="0.5" fill="#C0392B"/><circle cx="12" cy="10" r="1" fill="#FFD93D"/>'
    },
    sock: {
      kw: ['袜子', 'sock'],
      svg: '<path d="M9 3h5v8l3 4c1 1.5 1 4-1 5s-4 .5-5-1l-3-4V3z" fill="#FFB6C1" stroke="#E8A0BF" stroke-width="0.6"/><path d="M9 3h5v3H9z" fill="#E8A0BF"/><path d="M11 11l3 4" stroke="#E8A0BF" stroke-width="0.4" opacity="0.5"/>'
    },
    glove: {
      kw: ['手套', 'glove'],
      svg: '<path d="M8 8V5a1.5 1.5 0 0 1 3 0v3M11 8V4a1.5 1.5 0 0 1 3 0v4M14 8V5a1.5 1.5 0 0 1 3 0v6c0 4-2 7-5 7s-5-2-5-6V8" fill="#4A90D9" stroke="#357ABD" stroke-width="0.6"/>'
    },
    scarf: {
      kw: ['围巾', 'scarf'],
      svg: '<path d="M6 6h12v3c0 2-3 3-6 3s-6-1-6-3V6z" fill="#9B59B6" stroke="#8E44AD" stroke-width="0.6"/><path d="M8 12v8M14 12v8" stroke="#8E44AD" stroke-width="0.6"/><path d="M7 6h10" stroke="#8E44AD" stroke-width="0.4" opacity="0.5"/><path d="M9 8h6" stroke="#C49AC4" stroke-width="0.4" opacity="0.4"/>'
    },

    // ==================== 运动 (6) ====================
    basketball: {
      kw: ['篮球', 'basketball'],
      svg: '<circle cx="12" cy="12" r="8" fill="#FF9F2D"/><circle cx="12" cy="12" r="8" stroke="#E07000" stroke-width="0.6" fill="none"/><path d="M4 12h16M12 4v16M6 6c3 3 3 9 0 12M18 6c-3 3-3 9 0 12" stroke="#8B4513" stroke-width="0.8" fill="none"/>'
    },
    dumbbell: {
      kw: ['哑铃', 'dumbbell'],
      svg: '<rect x="2" y="9" width="3" height="6" rx="0.5" fill="#444"/><rect x="5" y="10" width="2" height="4" rx="0.3" fill="#555"/><rect x="7" y="11" width="10" height="2" fill="#333"/><rect x="17" y="10" width="2" height="4" rx="0.3" fill="#555"/><rect x="19" y="9" width="3" height="6" rx="0.5" fill="#444"/>'
    },
    yogamat: {
      kw: ['瑜伽', 'yoga', '瑜伽垫'],
      svg: '<rect x="3" y="8" width="18" height="8" rx="4" fill="#9B59B6" stroke="#8E44AD" stroke-width="0.6"/><path d="M3 12h18" stroke="#8E44AD" stroke-width="0.4" opacity="0.4"/><ellipse cx="6" cy="12" rx="1" ry="3" fill="#8E44AD" opacity="0.3"/><ellipse cx="18" cy="12" rx="1" ry="3" fill="#8E44AD" opacity="0.3"/>'
    },
    bike: {
      kw: ['自行车', 'bike', '骑行', '单车'],
      svg: '<circle cx="6" cy="16" r="3.5" fill="none" stroke="#444" stroke-width="1.5"/><circle cx="18" cy="16" r="3.5" fill="none" stroke="#444" stroke-width="1.5"/><path d="M6 16l4-7h6l-4 7M10 9l-2-2h3M14 9l4 7M10 9h4" stroke="#444" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="6" cy="16" r="0.5" fill="#444"/><circle cx="18" cy="16" r="0.5" fill="#444"/>'
    },
    helmet: {
      kw: ['头盔', 'helmet', '安全帽'],
      svg: '<path d="M4 14a8 8 0 0 1 16 0v1H4v-1z" fill="#E8453C"/><path d="M4 14a8 8 0 0 1 16 0v1H4v-1z" stroke="#C0392B" stroke-width="0.6" fill="none"/><path d="M4 15h16" stroke="#C0392B" stroke-width="1.5"/><path d="M10 7c1-1 3-1 4 0" stroke="#fff" stroke-width="0.6" fill="none" opacity="0.4"/><rect x="3" y="14" width="18" height="2" rx="0.5" fill="#333"/>'
    },
    tennis: {
      kw: ['网球', 'tennis', '网球拍'],
      svg: '<circle cx="12" cy="12" r="8" fill="#9ACD32"/><circle cx="12" cy="12" r="8" stroke="#7AAD12" stroke-width="0.6" fill="none"/><path d="M5 8c4 1 10 1 14 0M5 16c4-1 10-1 14 0" stroke="#fff" stroke-width="0.8" fill="none" opacity="0.6"/>'
    },

    // ==================== 户外 (5) ====================
    tent: {
      kw: ['帐篷', 'tent', '露营', '天幕'],
      svg: '<path d="M3 19l9-14 9 14H3z" fill="#9DBA29"/><path d="M3 19l9-14 9 14" stroke="#7A9A19" stroke-width="0.6" fill="none"/><path d="M12 5v14" stroke="#7A9A19" stroke-width="0.6"/><path d="M9 19l3-5 3 5" fill="#5A7A09" stroke="none"/>'
    },
    backpack: {
      kw: ['背包', 'backpack', '登山包', '书包'],
      svg: '<rect x="6" y="6" width="12" height="16" rx="2" fill="#4A90D9" stroke="#357ABD" stroke-width="0.6"/><rect x="8" y="3" width="8" height="4" rx="1.5" fill="#357ABD"/><rect x="8" y="9" width="8" height="4" rx="0.5" fill="#357ABD" opacity="0.5"/><rect x="9" y="15" width="6" height="3" rx="0.3" fill="#357ABD" opacity="0.3"/><circle cx="12" cy="11" r="0.6" fill="#FFD93D"/>'
    },
    compass: {
      kw: ['指南针', 'compass', '罗盘'],
      svg: '<circle cx="12" cy="12" r="8" fill="#F5F5DC" stroke="#666" stroke-width="1.2"/><circle cx="12" cy="12" r="6" fill="none" stroke="#999" stroke-width="0.4"/><path d="M12 6l2 6-2 6-2-6 2-6z" fill="#E8453C"/><path d="M12 6l-2 6 2 6" fill="#444"/><circle cx="12" cy="12" r="0.8" fill="#333"/><text x="12" y="5.5" text-anchor="middle" font-size="3" fill="#333" font-weight="bold">N</text>'
    },
    lantern: {
      kw: ['露营灯', 'lantern', '马灯', '手电'],
      svg: '<rect x="8" y="6" width="8" height="12" rx="1.5" fill="#FFD93D"/><rect x="8" y="6" width="8" height="12" rx="1.5" stroke="#E6B800" stroke-width="0.6" fill="none"/><rect x="9" y="7.5" width="6" height="9" rx="0.5" fill="#FFF8DC" opacity="0.6"/><path d="M10 6V4h4v2" stroke="#8B5E3C" stroke-width="1" fill="none"/><rect x="7" y="18" width="10" height="1.5" rx="0.3" fill="#8B5E3C"/><path d="M10 10h4M10 13h4" stroke="#E6B800" stroke-width="0.3" opacity="0.4"/>'
    },
    binoculars: {
      kw: ['望远镜', 'binoculars', '双筒'],
      svg: '<circle cx="7" cy="9" r="3.5" fill="#333" stroke="#555" stroke-width="0.6"/><circle cx="17" cy="9" r="3.5" fill="#333" stroke="#555" stroke-width="0.6"/><circle cx="7" cy="9" r="1.5" fill="#1A1A2E"/><circle cx="17" cy="9" r="1.5" fill="#1A1A2E"/><path d="M7 12v6M17 12v6M5 18h4M15 18h4" stroke="#333" stroke-width="1.5" stroke-linecap="round"/><path d="M10.5 9h3" stroke="#444" stroke-width="1"/>'
    },

    // ==================== 旅游 (4) ====================
    plane: {
      kw: ['机票', '飞机', 'plane', '航班', '航空'],
      svg: '<path d="M21 14l-9-1-4 7H6l2-7-4-1v-2l4-1-2-7h2l4 7 9-1c1 0 2 1 2 2s-1 2-2 2z" fill="#4A90D9" stroke="#357ABD" stroke-width="0.6"/>'
    },
    train: {
      kw: ['高铁', '火车', 'train', '动车', '车票'],
      svg: '<path d="M5 5h14v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5z" fill="#4A90D9" stroke="#357ABD" stroke-width="0.6"/><rect x="7" y="7" width="4" height="4" rx="0.3" fill="#1A1A2E"/><rect x="13" y="7" width="4" height="4" rx="0.3" fill="#1A1A2E"/><rect x="7" y="13" width="10" height="2" rx="0.3" fill="#357ABD" opacity="0.5"/><path d="M8 20l-2 2M16 20l2 2" stroke="#444" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="20" r="1" fill="#444"/><circle cx="15" cy="20" r="1" fill="#444"/>'
    },
    hotel: {
      kw: ['旅馆', 'hotel', '酒店', '住宿', '民宿'],
      svg: '<rect x="4" y="5" width="16" height="16" rx="1" fill="#9DBA29" stroke="#7A9A19" stroke-width="0.6"/><rect x="6" y="7" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.7"/><rect x="11" y="7" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.7"/><rect x="15" y="7" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.7"/><rect x="6" y="11" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.7"/><rect x="11" y="11" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.7"/><rect x="15" y="11" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.7"/><rect x="10" y="17" width="4" height="4" rx="0.3" fill="#5A7A09"/>'
    },
    taxi: {
      kw: ['打车', '出租车', 'taxi', '专车', '网约车'],
      svg: '<rect x="3" y="11" width="18" height="6" rx="1" fill="#FFD93D" stroke="#E6B800" stroke-width="0.6"/><path d="M5 11l2-4h10l2 4" fill="#FFD93D" stroke="#E6B800" stroke-width="0.6"/><rect x="7" y="8" width="3" height="2.5" rx="0.3" fill="#1A1A2E"/><rect x="14" y="8" width="3" height="2.5" rx="0.3" fill="#1A1A2E"/><rect x="6" y="11" width="12" height="3" rx="0.3" fill="#1A1A2E" opacity="0.3"/><circle cx="7" cy="18" r="2" fill="#333"/><circle cx="17" cy="18" r="2" fill="#333"/><circle cx="7" cy="18" r="0.8" fill="#999"/><circle cx="17" cy="18" r="0.8" fill="#999"/><rect x="9" y="6" width="6" height="1.5" rx="0.2" fill="#333"/>'
    },

    // ==================== 汽车 (3) ====================
    car: {
      kw: ['汽车', 'car', '轿车', 'SUV', '新能源', '电动车', '纯电'],
      svg: '<path d="M3 14l2-5c.5-1.5 2-2.5 3.5-2.5h7c1.5 0 3 1 3.5 2.5l2 5v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3z" fill="#E8453C"/><path d="M3 14l2-5c.5-1.5 2-2.5 3.5-2.5h7c1.5 0 3 1 3.5 2.5l2 5" stroke="#C0392B" stroke-width="0.6" fill="none"/><rect x="6" y="9" width="4" height="2.5" rx="0.3" fill="#1A1A2E"/><rect x="14" y="9" width="4" height="2.5" rx="0.3" fill="#1A1A2E"/><circle cx="7.5" cy="17" r="1.5" fill="#333"/><circle cx="16.5" cy="17" r="1.5" fill="#333"/><circle cx="7.5" cy="17" r="0.6" fill="#999"/><circle cx="16.5" cy="17" r="0.6" fill="#999"/><rect x="4" y="13" width="16" height="0.8" fill="#fff" opacity="0.3"/>'
    },
    tire: {
      kw: ['轮胎', 'tire', '车胎'],
      svg: '<circle cx="12" cy="12" r="8" fill="#1A1A2E"/><circle cx="12" cy="12" r="8" stroke="#333" stroke-width="0.6" fill="none"/><circle cx="12" cy="12" r="4" fill="#444"/><circle cx="12" cy="12" r="4" stroke="#555" stroke-width="0.4" fill="none"/><circle cx="12" cy="12" r="1.5" fill="#666"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2 2M15.7 15.7l2 2M6.3 17.7l2-2M15.7 8.3l2-2" stroke="#333" stroke-width="0.8"/>'
    },
    steering: {
      kw: ['方向盘', 'steering', '方向机'],
      svg: '<circle cx="12" cy="12" r="8" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="#333"/><path d="M12 9V4M9.5 13.5L5 17M14.5 13.5L19 17" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>'
    },

    // ==================== 房产 (3) ====================
    house: {
      kw: ['房子', 'house', '别墅', '洋房', '房源', '房产', '房地产', '公寓'],
      svg: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9z" fill="#9DBA29" stroke="#7A9A19" stroke-width="0.6"/><path d="M3 11l9-7 9 7" stroke="#7A9A19" stroke-width="0.6" fill="none"/><rect x="10" y="13" width="4" height="8" fill="#5A7A09"/><rect x="6" y="13" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.6"/><rect x="15" y="13" width="3" height="3" rx="0.3" fill="#FFD93D" opacity="0.6"/>'
    },
    building: {
      kw: ['楼盘', 'building', '大厦', '住宅', '小区', 'LOFT'],
      svg: '<rect x="5" y="5" width="14" height="16" rx="0.5" fill="#666" stroke="#444" stroke-width="0.6"/><rect x="7" y="7" width="2.5" height="2.5" rx="0.2" fill="#FFD93D" opacity="0.6"/><rect x="11" y="7" width="2.5" height="2.5" rx="0.2" fill="#FFD93D" opacity="0.6"/><rect x="15" y="7" width="2.5" height="2.5" rx="0.2" fill="#1A1A2E" opacity="0.3"/><rect x="7" y="11" width="2.5" height="2.5" rx="0.2" fill="#1A1A2E" opacity="0.3"/><rect x="11" y="11" width="2.5" height="2.5" rx="0.2" fill="#FFD93D" opacity="0.6"/><rect x="15" y="11" width="2.5" height="2.5" rx="0.2" fill="#FFD93D" opacity="0.6"/><rect x="10" y="17" width="4" height="4" fill="#444"/>'
    },
    key: {
      kw: ['钥匙', 'key', '门禁'],
      svg: '<circle cx="8" cy="8" r="4" fill="none" stroke="#D4A574" stroke-width="2"/><circle cx="8" cy="8" r="1.5" fill="#D4A574"/><path d="M11 11l9 9M16 16l2-2M18 18l2-2" stroke="#D4A574" stroke-width="2" stroke-linecap="round"/>'
    },

    // ==================== 日用 (8) ====================
    toothbrush: {
      kw: ['牙刷', 'toothbrush', '电动牙刷'],
      svg: '<rect x="6" y="3" width="3" height="11" rx="0.5" fill="#4A90D9" transform="rotate(-15 7.5 8.5)"/><rect x="5" y="14" width="5" height="7" rx="0.5" fill="#357ABD"/><path d="M5 14h5v2c0 .5-.5 1-1 1H6c-.5 0-1-.5-1-1v-2z" fill="#555"/><path d="M6 13v1M7 13v1M8 13v1M6.5 12v1M7.5 12v1" stroke="#fff" stroke-width="0.6" stroke-linecap="round"/>'
    },
    tissue: {
      kw: ['纸巾', 'tissue', '抽纸', '卷纸', '面巾纸'],
      svg: '<rect x="5" y="7" width="14" height="13" rx="1" fill="#F5F5DC" stroke="#D4C9A0" stroke-width="0.6"/><rect x="5" y="7" width="14" height="3" rx="1" fill="#E8E0C0"/><rect x="9" y="5" width="6" height="3" rx="0.5" fill="#F5F5DC" stroke="#D4C9A0" stroke-width="0.4"/><path d="M9 6h6" stroke="#D4C9A0" stroke-width="0.3"/><ellipse cx="12" cy="13" rx="4" ry="2" fill="none" stroke="#D4C9A0" stroke-width="0.4" opacity="0.4"/>'
    },
    umbrella: {
      kw: ['雨伞', 'umbrella', '伞'],
      svg: '<path d="M12 4a8 8 0 0 0-8 8h16a8 8 0 0 0-8-8z" fill="#E8453C"/><path d="M12 4a8 8 0 0 0-8 8h16a8 8 0 0 0-8-8z" stroke="#C0392B" stroke-width="0.6" fill="none"/><path d="M12 4c-2 2-3 5-3 8M12 4c2 2 3 5 3 8M4 12c2-1 5-1 8 0M20 12c-2-1-5-1-8 0" stroke="#C0392B" stroke-width="0.5" fill="none" opacity="0.4"/><path d="M12 12v7a2 2 0 0 0 4 0" stroke="#8B5E3C" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="12" cy="4" r="0.5" fill="#8B5E3C"/>'
    },
    wallet: {
      kw: ['钱包', 'wallet', '卡包'],
      svg: '<rect x="3" y="6" width="18" height="13" rx="2" fill="#8B5E3C" stroke="#6B4226" stroke-width="0.6"/><rect x="3" y="8" width="18" height="3" fill="#6B4226" opacity="0.3"/><rect x="14" y="10" width="7" height="4" rx="0.5" fill="#6B4226"/><circle cx="17.5" cy="12" r="0.8" fill="#FFD93D"/>'
    },
    watch: {
      kw: ['手表', 'watch', '智能手环', '手环'],
      svg: '<rect x="7" y="6" width="10" height="12" rx="2" fill="#333"/><rect x="8" y="7.5" width="8" height="9" rx="0.5" fill="#1A1A2E"/><path d="M12 10v3l2 1" stroke="#4A90D9" stroke-width="1.2" stroke-linecap="round"/><rect x="8" y="3" width="8" height="3" rx="0.5" fill="#555"/><rect x="8" y="18" width="8" height="3" rx="0.5" fill="#555"/>'
    },
    glasses: {
      kw: ['眼镜', 'glasses', '墨镜', '太阳镜'],
      svg: '<circle cx="6" cy="13" r="3.5" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="18" cy="13" r="3.5" fill="none" stroke="#333" stroke-width="1.5"/><path d="M9.5 13h5" stroke="#333" stroke-width="1.5"/><path d="M2.5 11L5 9M21.5 11L19 9" stroke="#333" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="13" r="2" fill="#333" opacity="0.2"/><circle cx="18" cy="13" r="2" fill="#333" opacity="0.2"/>'
    },
    bottle: {
      kw: ['水杯', '保温杯', '水壶', 'bottle', '杯子', '马克杯', '杯'],
      svg: '<path d="M9 3h6v2l1 2v13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V7l1-2V3z" fill="#4A90D9" stroke="#357ABD" stroke-width="0.6"/><rect x="9" y="3" width="6" height="2" rx="0.3" fill="#357ABD"/><rect x="8.5" y="10" width="7" height="4" rx="0.3" fill="#fff" opacity="0.3"/><path d="M9 6h6" stroke="#357ABD" stroke-width="0.4" opacity="0.5"/>'
    },
    mask: {
      kw: ['口罩', 'mask', '防护'],
      svg: '<path d="M4 9c0-1 1-2 2-2h12c1 0 2 1 2 2v4c0 3-3 5-8 5s-8-2-8-5V9z" fill="#4A90D9" stroke="#357ABD" stroke-width="0.6"/><path d="M4 9l-2-1v6l2 1M20 9l2-1v6l-2 1" stroke="#357ABD" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M6 11c2 1 10 1 12 0M6 13c2 1 10 1 12 0" stroke="#fff" stroke-width="0.4" fill="none" opacity="0.3"/>'
    },

    // ==================== 其他通用 (5) ====================
    gift: {
      kw: ['礼物', 'gift', '礼盒', '礼品', '心意'],
      svg: '<rect x="4" y="9" width="16" height="12" rx="0.5" fill="#E8453C"/><rect x="4" y="9" width="16" height="3" fill="#C0392B"/><rect x="11" y="9" width="2" height="12" fill="#FFD93D"/><rect x="4" y="10.5" width="16" height="0.5" fill="#FFD93D"/><path d="M12 9c0-2-3-3-3-1s3 1 3 1zM12 9c0-2 3-3 3-1s-3 1-3 1z" fill="#FFD93D"/>'
    },
    ticket: {
      kw: ['票', 'ticket', '门票', '优惠券', '券'],
      svg: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7z" fill="#FFD93D" stroke="#E6B800" stroke-width="0.6"/><path d="M12 7v10" stroke="#E6B800" stroke-width="0.8" stroke-dasharray="2 1"/><circle cx="8" cy="12" r="0.5" fill="#E6B800"/><circle cx="16" cy="12" r="0.5" fill="#E6B800"/>'
    },
    flower: {
      kw: ['花', 'flower', '鲜花', '玫瑰', '百合', '花束'],
      svg: '<circle cx="12" cy="6" r="2.5" fill="#E8453C"/><circle cx="9" cy="9" r="2.5" fill="#FF6B6B"/><circle cx="15" cy="9" r="2.5" fill="#FF6B6B"/><circle cx="10" cy="12" r="2.5" fill="#FF9999"/><circle cx="14" cy="12" r="2.5" fill="#FF9999"/><circle cx="12" cy="10" r="2" fill="#FFD93D"/><path d="M12 14v8M10 18l2-2M14 18l-2-2" stroke="#6B8E23" stroke-width="1.2" stroke-linecap="round" fill="none"/>'
    },
    book: {
      kw: ['书', 'book', '书籍', '图书', '小说'],
      svg: '<path d="M4 4h7v16H4z" fill="#4A90D9"/><path d="M13 4h7v16h-7z" fill="#357ABD"/><path d="M4 4h7v16H4zM13 4h7v16h-7z" stroke="#2A5A8A" stroke-width="0.5" fill="none"/><path d="M6 7h3M6 10h3M15 7h3M15 10h3" stroke="#fff" stroke-width="0.4" opacity="0.5"/><rect x="11" y="4" width="2" height="16" fill="#2A5A8A"/>'
    },
    medicine: {
      kw: ['药', 'medicine', '药品', '感冒药', '消炎药', '看病买药'],
      svg: '<rect x="4" y="4" width="16" height="16" rx="2" fill="#E8453C"/><rect x="4" y="4" width="16" height="16" rx="2" stroke="#C0392B" stroke-width="0.6" fill="none"/><rect x="10.5" y="7" width="3" height="10" rx="0.3" fill="#fff"/><rect x="7" y="10.5" width="10" height="3" rx="0.3" fill="#fff"/>'
    }
  };

  // 构建关键词索引（小写化以加速匹配）
  var INDEX = [];
  Object.keys(ICONS).forEach(function (key) {
    var entry = ICONS[key];
    entry.kw.forEach(function (kw) {
      INDEX.push({ kw: kw.toLowerCase(), svg: entry.svg, key: key });
    });
  });
  // 按关键词长度降序排列，优先匹配更长的关键词
  INDEX.sort(function (a, b) { return b.kw.length - a.kw.length; });

  /**
   * 根据商品名匹配最佳 SVG 图标。
   * @param {string} name 商品名
   * @param {number} size SVG 尺寸（默认 48）
   * @returns {string|null} 完整 SVG HTML，无匹配返回 null
   */
  function getProductIcon(name, size) {
    if (!name) return null;
    var lower = String(name).toLowerCase();
    for (var i = 0; i < INDEX.length; i++) {
      if (lower.indexOf(INDEX[i].kw) !== -1) {
        return wrap(INDEX[i].svg, { size: size || 48 });
      }
    }
    return null;
  }

  /**
   * 获取商品图标，若匹配不到则返回首字占位 SVG。
   * @param {string} name 商品名
   * @param {number} size SVG 尺寸
   * @param {string} color 占位背景色
   * @returns {string} 完整 SVG HTML（永远不返回 null）
   */
  function getProductIconOrFallback(name, size, color) {
    var icon = getProductIcon(name, size);
    if (icon) return icon;
    // 首字占位
    var s = size || 48;
    var ch = (name || '商').toString().charAt(0);
    var bg = color || '#FFB088';
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="24" height="24" rx="3" fill="' + bg + '"/>' +
      '<text x="12" y="16" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="sans-serif">' + ch + '</text>' +
      '</svg>';
  }

  window.PRODUCT_ICONS = ICONS;
  window.getProductIcon = getProductIcon;
  window.getProductIconOrFallback = getProductIconOrFallback;
})();
