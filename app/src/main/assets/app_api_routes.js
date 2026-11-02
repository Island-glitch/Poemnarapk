/**
 * app_api_routes.js - 「专用 API」按功能路由
 * ------------------------------------------------------------
 * 背景：过去所有功能共用「设置 - API 协议设置 - 链接」里的一个全局预设
 *      （localStorage.global_api_preset_id）。现在每个功能可以单独指定一个
 *      预设（预设本身仍在「链接」页里创建/管理），未指定则跟随全局。
 *
 * 存储：localStorage['feature_api_presets'] = { "chat": 3, "memory": 5, ... }
 *      value 为 db.api_presets 的主键 id；缺失 / 0 / "global" 都表示「跟随链接（全局）」。
 *
 * 用法：
 *   await apiRoutes.resolve('chat')        // → 预设对象（找不到返回 null）
 *   await apiRoutes.resolveId('chat')      // → 最终生效的预设 id
 *   apiRoutes.getFeatureId('chat')         // → 专用页里为该功能选定的 id（0 = 跟随全局）
 *   apiRoutes.setFeatureId('chat', 3)      // 保存（3 或 0）
 *   apiRoutes.FEATURES                     // [{key, label, desc}] 12 项
 */
(function () {
  'use strict';

  var STORE_KEY = 'feature_api_presets';

  // 需要独立 API 的功能位（顺序即设置页展示顺序）
  var FEATURES = [
    { key: 'chat', label: '聊天', desc: '微信式对话的日常回复' },
    { key: 'memory', label: '总结与记忆', desc: '对话总结、长期记忆与向量记忆' },
    { key: 'checkphone', label: '查手机', desc: '查手机与反查手机的判定与演出' },
    { key: 'encounter', label: '邂逅', desc: '邂逅玩法的角色生成与剧情' },
    { key: 'deeptalk', label: '深谈', desc: '深谈应用的长文对谈' },
    { key: 'reader', label: '阅读', desc: '阅读应用的解析与续写' },
    { key: 'forum', label: '论坛', desc: '论坛发帖、评论与私信' },
    { key: 'couples', label: '情侣空间', desc: '情侣空间的互动与纪念' },
    { key: 'music', label: '一起听歌', desc: '听歌陪听与歌曲推荐' },
    { key: 'shopping', label: '购物', desc: '商品/店铺生成与订单演出' },
    { key: 'quicktravel', label: '快穿局', desc: '快穿剧情的世界与分幕' },
    { key: 'workbench', label: '工作台', desc: '工作台 Agent 的多轮工具调用' },
    { key: 'ritual', label: '仪轨', desc: '日程 / 穿着 / 随身物品 / 位置 的推演' },
    { key: 'heartgame', label: '心动游戏', desc: '心动游戏的出题、判定与结算' }
  ];

  function getMap() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }

  function saveMap(map) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(map || {})); } catch (e) {}
  }

  function getFeatureId(key) {
    var map = getMap();
    var v = map[key];
    var n = parseInt(v, 10);
    return (isNaN(n) || n <= 0) ? 0 : n;
  }

  function setFeatureId(key, presetId) {
    var map = getMap();
    var n = parseInt(presetId, 10);
    if (isNaN(n) || n <= 0) delete map[key];
    else map[key] = n;
    saveMap(map);
    return getFeatureId(key);
  }

  function clearFeature(key) { return setFeatureId(key, 0); }

  function getGlobalId() {
    var v = localStorage.getItem('global_api_preset_id');
    var n = parseInt(v, 10);
    return (isNaN(n) || n <= 0) ? 0 : n;
  }

  /** 最终生效的预设 id：专用优先，否则全局 */
  function resolveId(key) {
    var own = getFeatureId(key);
    return own > 0 ? own : getGlobalId();
  }

  /** 取预设对象（找不到 / 未配置返回 null） */
  async function resolve(key) {
    try {
      var id = resolveId(key);
      if (!id) return null;
      if (typeof db === 'undefined' || !db.api_presets) return null;
      var preset = await db.api_presets.get(Number(id));
      if (!preset) {
        // 专用预设被删除 → 静默回落到全局，避免该功能直接不可用
        var gid = getGlobalId();
        if (gid && gid !== id) {
          clearFeature(key);
          preset = await db.api_presets.get(Number(gid));
        }
      }
      return preset || null;
    } catch (e) {
      console.warn('[apiRoutes] 解析预设失败:', key, e && e.message);
      return null;
    }
  }

  /** 列表数据（供设置页渲染下拉） */
  async function listPresets() {
    try {
      if (typeof db === 'undefined' || !db.api_presets) return [];
      var all = await db.api_presets.toArray();
      return (all || []).map(function (p) {
        return { id: p.id, name: p.name || ('预设 #' + p.id), model: p.model || '', url: p.url || '' };
      });
    } catch (e) { return []; }
  }

  function featureLabel(key) {
    for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].key === key) return FEATURES[i].label;
    return key;
  }

  window.apiRoutes = {
    STORE_KEY: STORE_KEY,
    FEATURES: FEATURES,
    getMap: getMap,
    getFeatureId: getFeatureId,
    setFeatureId: setFeatureId,
    clearFeature: clearFeature,
    getGlobalId: getGlobalId,
    resolveId: resolveId,
    resolve: resolve,
    listPresets: listPresets,
    featureLabel: featureLabel
  };
})();
