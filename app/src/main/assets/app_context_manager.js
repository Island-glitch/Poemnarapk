/**
 * app_context_manager.js - 上下文管理中枢（结构化 Prompt 可见 / 可开关 / 可排序）
 *
 * 目标：
 *   1. 把「线上 / 小剧场线下 / 赴约线下」三类请求的 System Prompt 拆成结构化「上下文段」。
 *   2. 每次请求后捕获「最近一轮请求全文」（完整 messages 数组）。
 *   3. 在「对话详情」里新增入口，提供三类 Tab 切换、全文查看、逐段开关与上移/下移排序。
 *   4. 统一「开关」的真实来源：会话字段 / localStorage / 手动禁用覆盖，杜绝「开关没开却计入上下文」。
 *
 * UI 规范：无 Emoji、无原生弹窗、纯 SVG 图标、自绘卡片、淡彩配色。
 */

(function () {
  "use strict";

  // ---------- 淡彩主题（统一冷色调：蓝 / 靛 / 青，规避黄棕与莫兰迪灰调） ----------
  var PASTEL = {
    online:  { accent: "#4A7DBF", soft: "#EAF2FB", border: "#CFE1F3" },
    theater: { accent: "#6B5BC4", soft: "#F1EEFB", border: "#DCD6F2" },
    date:    { accent: "#35867A", soft: "#E9F5F2", border: "#CDE9E3" }
  };

  // ---------- 三类上下文 ----------
  var CATEGORIES = [
    { id: "online",  label: "线上",       desc: "线上微信聊天（单聊）发起的请求" },
    { id: "theater", label: "小剧场线下", desc: "小剧场（线下剧场）模式发起的请求" },
    { id: "date",    label: "赴约线下",   desc: "赴约（线下约会）模式发起的请求" }
  ];

  // ---------- 上下文段目录 ----------
  // switch.kind: 'session' 会话字段开关 / 'local' localStorage 开关 / 'none' 无开关（用 manual disabled 覆盖）
  // builtin: 常驻基础段（不可禁用，可排序）；disclaimer 额外固定置顶不可排序
  // domSync: 同步回「对话详情」里的同名 checkbox（在线请求部分开关读 DOM）
  var CATALOG = [
    // ===== 线上 =====
    { id: "disclaimer",        label: "安全免责声明",   cats: ["online","theater","date"], group: "基础", builtin: true,  switch: null, depth: -1000, desc: "完全虚拟环境免责声明，固定置顶，不可关闭。" },
    { id: "identity_wall",     label: "身份隔离墙",     cats: ["online","theater","date"], group: "基础", builtin: true,  switch: null, depth: -800,  desc: "角色身份与人设锁定，防 OOC 的核心墙。" },
    { id: "user_wall",         label: "用户背景与关系网", cats: ["online","theater","date"], group: "基础", builtin: true,  switch: null, depth: -700, desc: "用户人设 + 双向关系网定位（含双方与关系网中其他人物的关系，避免角色反问「这人是谁」）。" },
    { id: "offline_scenario",  label: "线下情景背景",   cats: ["theater","date"], group: "基础", builtin: true, switch: null, depth: -950, desc: "小剧场/赴约的情景设定与见面背景。" },
    { id: "offline_rule",      label: "线下白描准则",   cats: ["theater","date"], group: "基础", builtin: true, switch: null, depth: -900, desc: "线下叙事视角、字数、性别锁定等准则。" },
    { id: "online_rule",       label: "线上回复准则",   cats: ["online"], group: "基础", builtin: true, switch: null, depth: -500, desc: "微信聊天行为准则 + 红包/转账/引用/分句规范。" },
    { id: "offline_final_rule",label: "线下格式强制规范", cats: ["theater","date"], group: "基础", builtin: true, switch: null, depth: 9999, appended: true, desc: "请求末尾注入的线下白描格式隔离墙（固定追加，不参与排序）。" },

    // ===== 记忆与检索 =====
    { id: "memory",            label: "核心记忆与总结召回", cats: ["online","theater","date"], group: "记忆", builtin: false, switch: null, depth: -600, desc: "长周期核心记忆 + 三角形总结检索召回（有数据时注入）。线下/剧场只有开启「携带线上主聊天记忆」才会带进来。" },
    { id: "raw_dialogue",      label: "原始对话向量召回",   cats: ["online","theater","date"], group: "记忆", builtin: false, switch: null, depth: -590, desc: "语义检索召回的原始对话原文片段（有命中时注入）。" },
    { id: "online_summary",    label: "线上聊天背景参考",   cats: ["theater","date"], group: "记忆", builtin: false, switch: null, depth: 9998, appended: true, desc: "线下携带记忆时，把近期线上聊天作为背景参考注入（固定追加，不参与排序）。" },

    // ===== 环境与感知 =====
    { id: "mcp_env",           label: "MCP 设备环境",     cats: ["online"], group: "环境", builtin: false, switch: { kind: "local", key: "settings-mcp-prompt-enabled" }, depth: -490, domSync: ["settings-mcp-prompt-toggle"], onToggleHook: "mcp", desc: "天气/电量/正在播放/歌单/蓝牙等真机传感器数据。" },
    { id: "couples",           label: "情侣空间日程与愿望", cats: ["online"], group: "环境", builtin: false, switch: null, depth: -495, desc: "情侣空间本日日程与未完成愿望（在情侣空间开启同步时有数据）。" },
    { id: "ritual_state",      label: "仪轨四维状态",     cats: ["online"], group: "环境", builtin: false, switch: { kind: "session", key: "ritualStateInContext" }, depth: -470, domSync: "details-ritual-state-toggle", desc: "当天日程/穿着/随身物品/位置进入 Prompt。" },
    { id: "time",              label: "时间感知",         cats: ["online","theater","date"], group: "环境", builtin: false, switch: null, depth: -400, desc: "注入真实或模拟场景时间。关掉则不注入任何时间行。" },
    { id: "mcp_tools",         label: "外部 MCP 工具服务", cats: ["online"], group: "环境", builtin: false, switch: null, depth: -100, desc: "MCP 客户端注入的工具调用能力说明。" },
    { id: "beautify",          label: "线下美化正则提示",   cats: ["theater","date"], group: "环境", builtin: false, switch: null, depth: -30, desc: "已启用的线下美化正则（如状态栏卡片）的提示词。" },
    { id: "sticker",           label: "表情包系统上下文",   cats: ["online"], group: "环境", builtin: false, switch: null, depth: 9996, appended: true, desc: "挂载的表情包分组说明（固定追加，不参与排序）。" },

    // ===== 剧情与社交 =====
    { id: "plot",              label: "剧情引擎主线剧本",   cats: ["online","theater","date"], group: "剧情", builtin: false, switch: null, depth: -480, desc: "当前主线剧情演进要求（配置了剧情要求时注入）。" },
    { id: "blocked",           label: "拉黑状态约束",     cats: ["online"], group: "剧情", builtin: false, switch: null, depth: -475, desc: "被拉黑/主动拉黑时的状态约束与特权指令。" },
    { id: "moment_history",    label: "朋友圈历史",       cats: ["online"], group: "剧情", builtin: false, switch: null, depth: -82, desc: "角色已发布的朋友圈动态及互动（有数据时注入）。" },
    { id: "forum_history",     label: "论坛帖子历史",     cats: ["online"], group: "剧情", builtin: false, switch: { kind: "session", key: "allowCharForumRoam" }, depth: -81, desc: "角色在论坛发过的帖子历史（论坛漫游开启时注入）。" },

    // ===== 功能开关 =====
    { id: "multimedia",        label: "多媒体能力",       cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "multimediaToggle" }, depth: -450, domSync: "details-multimedia-toggle", desc: "允许发送语音/图片的指令说明。" },
    { id: "recall",            label: "消息撤回能力",     cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharRecall" }, depth: -430, domSync: "details-allow-recall-toggle", desc: "允许角色撤回消息的指令说明。" },
    { id: "reaction",          label: "表情反应能力",     cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharReaction" }, depth: -420, domSync: "details-allow-reaction-toggle", desc: "允许角色对消息做表情反应的指令说明。" },
    { id: "cot",               label: "思维链 (CoT)",     cats: ["online","theater","date"], group: "开关", builtin: false, switch: { kind: "session", key: "cotToggle" }, depth: -90, domSync: ["cot-session-toggle"], onToggleHook: "cot", desc: "深度思考推演协议。关闭后不再注入任何思维链提示。" },
    { id: "auto_call",         label: "主动通话",         cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharAutoCall" }, depth: -85, domSync: "details-autocall-toggle", desc: "允许角色主动发起语音/视频通话。" },
    { id: "auto_moment",       label: "自动发朋友圈",     cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharAutoMoment" }, depth: -84, domSync: "details-auto-moment-toggle", desc: "允许角色自发发朋友圈的指令说明。" },
    { id: "forum_roam",        label: "论坛漫游",         cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharForumRoam" }, depth: -83, domSync: "details-auto-forum-roam-toggle", desc: "允许角色自发去论坛发帖的指令说明。" },
    { id: "status_auto",       label: "心声随动",         cats: ["online","theater","date"], group: "开关", builtin: false, switch: { kind: "session", key: "statusAutoToggle" }, depth: 9995, appended: true, domSync: "details-status-auto", desc: "回复末尾附带角色真实心声 [STATUS]（固定追加，不参与排序）。" },
    { id: "translate_auto",    label: "翻译随动",         cats: ["online","theater","date"], group: "开关", builtin: false, switch: { kind: "session", key: "translateAutoToggle" }, depth: 9994, appended: true, domSync: "details-translate-auto", desc: "非中文内容附带结构化译文块（固定追加，不参与排序）。" },
    { id: "miniprogram_share", label: "小程序分享",       cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowMiniprogramShare" }, depth: 9993, appended: true, domSync: "details-allow-miniprogram-share", desc: "允许角色发起小程序分享卡片（固定追加，不参与排序）。" },
    { id: "auto_call",         label: "主动发起通话",     cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharAutoCall" }, depth: 9992, appended: true, domSync: "details-autocall-toggle", desc: "允许角色用 [AUTO_CALL] 主动打来语音/视频（固定追加，不参与排序）。" },
    { id: "auto_check_phone",  label: "突然查手机请求",   cats: ["online"], group: "开关", builtin: false, switch: { kind: "session", key: "allowCharAutoCheckPhone" }, depth: 9991, appended: true, domSync: "details-allow-auto-check-phone", desc: "允许角色用 [CHECK_PHONE] 在聊天里突然要求翻你的手机（会先弹确认卡，可同意或抗议；固定追加，不参与排序）。" }
  ];

  var CATALOG_BY_ID = {};
  CATALOG.forEach(function (c) { CATALOG_BY_ID[c.id] = c; });

  function catEntries(category) {
    return CATALOG.filter(function (c) { return c.cats.indexOf(category) >= 0; });
  }

  // ---------- 运行时状态 ----------
  // 每个会话 × 每类 各自独立保存最近一轮请求；LRU 上限防止内存膨胀
  var lastRequests = {};      // key = sessionId + "::" + category
  var lastOrder = [];         // LRU 顺序
  var MAX_KEEP = 24;
  var pendingTrace = { online: null, theater: null, date: null }; // builder 写入的 trace 缓冲
  var wbReport = { online: null, theater: null, date: null };     // 世界书引擎本轮激活报告
  var activeTab = "online";
  var panelEl = null;
  var currentSess = null; // 当前会话缓存（用于静态开关态扫描）
  var _renderedSectionsCount = 0; // 当前渲染的启用段数量（用于末位下移禁用）

  function reqKey(sid, cat) { return String(sid) + "::" + cat; }

  // 取「当前会话」在指定类别下最近一轮请求（换聊天就天然隔离）
  function getCurrentRequest(cat) {
    var sid = currentSessionId();
    if (sid === null || sid === undefined) return null;
    return lastRequests[reqKey(sid, cat)] || null;
  }

  // ---------- 小工具 ----------
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg) {
    if (typeof window.showToast === "function") { window.showToast(msg); }
    else { try { console.log("[ctx]", msg); } catch (e) {} }
  }
  function nowStr() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  // 粗略 token 估算：中文约 1.5 字/token，非中文约 4 字符/token（仅作体感参考）
  function estTokens(text) {
    if (!text) return 0;
    var s = String(text);
    var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    var other = Math.max(0, s.length - cjk);
    return Math.ceil(cjk / 1.5 + other / 4);
  }
  function fmtNum(n) {
    return String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function readStoredTab() {
    try {
      var t = localStorage.getItem("ctx-active-tab");
      if (t === "online" || t === "theater" || t === "date") return t;
    } catch (e) {}
    return "online";
  }
  function storeTab(t) {
    try { localStorage.setItem("ctx-active-tab", t); } catch (e) {}
  }
  function svgIcon(inner, size, color) {
    size = size || 14;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; vertical-align:middle;">' + inner + '</svg>';
  }
  var ICONS = {
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    up: '<polyline points="18 15 12 9 6 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44A2.5 2.5 0 0 1 5 17.5V8a2.5 2.5 0 0 1 2.5-2.5A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44A2.5 2.5 0 0 0 19 17.5V8a2.5 2.5 0 0 0-2.5-2.5A2.5 2.5 0 0 0 14.5 2z"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>',
    reset: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    collapse: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>'
  };

  // ---------- 覆盖读写（存 sess.ctxOverrides，透明字段无需改 schema） ----------
  function getOverrides(sess) {
    var ov = (sess && sess.ctxOverrides && typeof sess.ctxOverrides === "object") ? sess.ctxOverrides : {};
    return ov;
  }
  function normOverrides(sess) {
    var ov = getOverrides(sess);
    if (!ov.online) ov.online = {};
    if (!ov.theater) ov.theater = {};
    if (!ov.date) ov.date = {};
    return ov;
  }

  // 读取某段当前「开关」状态（session / local / none）
  function readSwitch(id, sess) {
    var c = CATALOG_BY_ID[id];
    if (!c || !c.switch) return { known: false, on: true };
    var s = sess || currentSess;
    if (c.switch.kind === "session") {
      var v = s ? s[c.switch.key] : undefined;
      return { known: true, on: !!(v === 1 || v === true) };
    }
    if (c.switch.kind === "local") {
      return { known: true, on: localStorage.getItem(c.switch.key) === "true" };
    }
    return { known: false, on: true };
  }

  // 同步回其它面板里的同名开关（支持一个段对应多个镜像）
  function syncDom(id, on) {
    var c = CATALOG_BY_ID[id];
    if (!c || !c.domSync) return;
    var ids = Array.isArray(c.domSync) ? c.domSync : [c.domSync];
    ids.forEach(function (eid) {
      var el = document.getElementById(eid);
      if (el) el.checked = !!on;
    });
  }

  // 切换后回调：让 MCP 中枢 / 思维链面板等即时刷新到同一状态
  function runToggleHook(c, on) {
    if (!c || !c.onToggleHook) return;
    try {
      if (c.onToggleHook === "mcp") {
        if (window.mcpSystem && typeof window.mcpSystem.loadMcpSettings === "function") window.mcpSystem.loadMcpSettings();
        if (window.mcpClientSystem && typeof window.mcpClientSystem.updateSummaryText === "function") window.mcpClientSystem.updateSummaryText();
      } else if (c.onToggleHook === "cot") {
        if (window.cotSystem) window.cotSystem.currentSessionCotToggle = !!on;
        var el = document.getElementById("cot-session-toggle");
        if (el) el.checked = !!on;
      }
    } catch (e) { console.warn("[ctx] onToggleHook 失败:", e); }
  }

  // ---------- 开关写入 ----------
  function toggleManualDisabled(id, on, sessionId) {
    return db.sessions.get(sessionId).then(function (sess) {
      if (!sess) return;
      var ov = normOverrides(sess);
      var cat = activeTab;
      var catOv = ov[cat] || {};
      var disabled = Array.isArray(catOv.disabled) ? catOv.disabled.slice() : [];
      var idx = disabled.indexOf(id);
      if (on) { if (idx >= 0) disabled.splice(idx, 1); }
      else { if (idx < 0) disabled.push(id); }
      catOv.disabled = disabled;
      ov[cat] = catOv;
      // 关键：保证内存缓存与入库一致，避免渲染读旧值
      sess.ctxOverrides = ov;
      currentSess = sess;
      return db.sessions.update(sessionId, { ctxOverrides: ov });
    });
  }

  function toggleSection(id, on) {
    var sessionId = currentSessionId();
    if (!sessionId) { toast("请先进入一个对话会话"); return; }
    // 世界书条目（动态段）：此处直接切换条目自身的启用 / 禁用
    var m = /^wb_(?:off_|depth_)?(\d+)$/.exec(id);
    if (m) {
      var wbId = Number(m[1]);
      db.world_book_entries.get(wbId).then(function (entry) {
        if (!entry) return;
        if (on) {
          var cur = entry.mode || (entry.isActive ? "constant" : "disabled");
          return db.world_book_entries.update(wbId, { mode: cur === "disabled" ? "selective" : cur, isActive: true });
        }
        return db.world_book_entries.update(wbId, { mode: "disabled", isActive: false });
      }).then(function () {
        toast(on ? "已启用该世界书条目" : "已关闭该世界书条目");
        try { if (typeof loadWorldBookData === "function") loadWorldBookData(); } catch (e) {}
        renderPanel();
      }).catch(function (e) { console.warn("[ctx] 切换世界书条目失败:", e); });
      return;
    }
    var c = CATALOG_BY_ID[id];
    if (!c) return;
    if (c.builtin) { toast("「" + c.label + "」为常驻基础段，不可关闭"); return; }

    db.sessions.get(sessionId).then(function (sess) {
      if (!sess) return;
      currentSess = sess;
      if (c.switch && c.switch.kind === "session") {
        var patch = {};
        patch[c.switch.key] = on ? 1 : 0;
        return db.sessions.update(sessionId, patch).then(function () {
          syncDom(id, on);
          runToggleHook(c, on);
          if (c.switch.key) { currentSess = currentSess || {}; currentSess[c.switch.key] = on ? 1 : 0; }
          toast(on ? ("已开启「" + c.label + "」") : ("已关闭「" + c.label + "」"));
          renderPanel();
        });
      }
      if (c.switch && c.switch.kind === "local") {
        try { localStorage.setItem(c.switch.key, on ? "true" : "false"); } catch (e) {}
        syncDom(id, on);
        runToggleHook(c, on);
        toast(on ? ("已开启「" + c.label + "」") : ("已关闭「" + c.label + "」"));
        renderPanel();
        return Promise.resolve();
      }
      // none：手动禁用覆盖
      return toggleManualDisabled(id, on, sessionId).then(function () {
        toast(on ? ("已启用「" + c.label + "」") : ("已禁用「" + c.label + "」"));
        renderPanel();
      });
    });
  }

  // ---------- 排序写入 ----------
  function moveSection(id, dir) {
    var sessionId = currentSessionId();
    if (!sessionId) { toast("请先进入一个对话会话"); return; }
    var c = CATALOG_BY_ID[id];
    if (c && c.id === "disclaimer") { toast("安全免责声明固定置顶，不可移动"); return; }
    if (c && c.appended) { toast("该段固定追加在请求末尾，不可排序"); return; }
    // 动态段（如各条世界书）：顺序由其自身的位置/顺序字段决定
    if (!c) { toast("世界书条目的先后请在「世界书」里调整（位置 / 顺序）"); return; }
    if (id.indexOf("wb_") === 0) { toast("世界书条目的先后请在「世界书」里调整（位置 / 顺序）"); return; }

    db.sessions.get(sessionId).then(function (sess) {
      if (!sess) return;
      currentSess = sess;
      var ov = normOverrides(sess);
      var catOv = ov[activeTab] || {};
      var order = ensureOrder(activeTab, catOv);
      var idx = order.indexOf(id);
      if (idx < 0) { renderPanel(); return; }
      var nidx = idx + dir;
      if (nidx < 0 || nidx >= order.length) { return; }
      var tmp = order[idx]; order[idx] = order[nidx]; order[nidx] = tmp;
      catOv.order = order;
      ov[activeTab] = catOv;
      db.sessions.update(sessionId, { ctxOverrides: ov }).then(function () {
        currentSess = currentSess || {};
        currentSess.ctxOverrides = ov;
        renderPanel();
      });
    });
  }

  // 生成/补全 order 列表（含本类别全部可排序段，不含 disclaimer）
  function ensureOrder(category, catOv) {
    var existing = Array.isArray(catOv.order) ? catOv.order.slice() : [];
    if (existing.length === 0) {
      // 用目录默认顺序初始化（disclaimer 置顶、追加段固定在末尾，均不参与排序）
      existing = catEntries(category)
        .filter(function (c) { return c.id !== "disclaimer" && !c.appended; })
        .sort(function (a, b) { return (a.depth || 0) - (b.depth || 0); })
        .map(function (c) { return c.id; });
    }
    // 补齐目录里新增的可排序段
    catEntries(category).forEach(function (c) {
      if (c.id !== "disclaimer" && !c.appended && existing.indexOf(c.id) < 0) existing.push(c.id);
    });
    return existing;
  }

  // ---------- 核心：排序 + 过滤 + 记录 trace（被 app_prompts.js 调用） ----------
  function finalizeSegments(segments, category, sess) {
    if (!Array.isArray(segments)) return segments;
    var ov = getOverrides(sess);
    var catOv = ov[category] || {};
    var disabledSet = {};
    (catOv.disabled || []).forEach(function (id) { disabledSet[id] = true; });
    var order = Array.isArray(catOv.order) && catOv.order.length > 0 ? catOv.order : null;

    // 1. 过滤：手动禁用的段原地移除（常驻 builtin 不可禁）
    for (var i = segments.length - 1; i >= 0; i--) {
      var sid = segments[i].id;
      if (disabledSet[sid]) {
        var c = CATALOG_BY_ID[sid];
        if (!(c && c.builtin)) segments.splice(i, 1);
      }
    }

    // 2. 排序（原地，保持引用不变，避免 const 重赋值）
    segments.sort(function (a, b) {
      var pa, pb;
      if (order) {
        pa = a.id === "disclaimer" ? -100000 : (order.indexOf(a.id) >= 0 ? order.indexOf(a.id) : 10000 + (a.depth || 0));
        pb = b.id === "disclaimer" ? -100000 : (order.indexOf(b.id) >= 0 ? order.indexOf(b.id) : 10000 + (b.depth || 0));
      } else {
        pa = a.id === "disclaimer" ? -100000 : (a.depth || 0);
        pb = b.id === "disclaimer" ? -100000 : (b.depth || 0);
      }
      if (pa !== pb) return pa - pb;
      return (a.depth || 0) - (b.depth || 0);
    });

    // 3. 记录 trace（供 UI 展示 + 请求捕获）
    recordTrace(category, (sess && sess.id) || null, segments, sess, catOv);

    return segments;
  }

  function recordTrace(category, sessionId, segments, sess, catOv) {
    // 1. 按「实际发送顺序」归并同 id 段 → sections（含动态段，例如每一条世界书）
    var byId = {};
    var orderIds = [];
    segments.forEach(function (s) {
      var id = s.id || ("anon_" + orderIds.length);
      if (!byId[id]) { byId[id] = { first: s, list: [] }; orderIds.push(id); }
      byId[id].list.push(s);
    });
    var sections = orderIds.map(function (id, i) {
      var g = byId[id];
      var c = CATALOG_BY_ID[id];
      return {
        id: id,
        label: (c && c.label) || g.first.label || id,
        group: (c && c.group) || g.first.group || "其他",
        builtin: !!(c && c.builtin) || !!g.first.builtin,
        appended: !!(c && c.appended),
        dynamic: !c,
        wbPos: g.first.wbPos || null,
        depth: g.first.depth || 0,
        meta: g.first.meta || "",
        content: g.list.map(function (x) { return x.content || ""; }).join("\n\n"),
        enabled: true,
        order: i
      };
    });

    // 2. 目录里未产出的段 → 关闭 / 未注入
    var disabledSet = {};
    (catOv.disabled || []).forEach(function (id) { disabledSet[id] = true; });
    var disabledList = [];
    catEntries(category).forEach(function (c) {
      if (byId[c.id]) return; // 本段已启用
      var reason = "无数据 / 未命中";
      if (disabledSet[c.id]) reason = "手动关闭";
      else if (c.switch) {
        var st = readSwitch(c.id, sess);
        if (st.known && !st.on) reason = "开关关闭";
      }
      disabledList.push({ id: c.id, label: c.label, group: c.group, builtin: !!c.builtin, reason: reason });
    });

    // 3. 合并世界书引擎报告：聊天内注入条目 + 未激活条目
    var rep = wbReport[category];
    var wbStats = null;
    if (rep) {
      try {
        wbStats = { stats: rep.stats, tokens: rep.tokens };
        (rep.atDepth || []).forEach(function (it) {
          sections.push({
            id: "wb_depth_" + it.id, label: "世界书 · " + it.title, group: "世界书",
            builtin: false, appended: false, dynamic: true, atDepth: true,
            depth: it.depth, role: it.role, content: it.content, enabled: true, order: sections.length
          });
        });
        (rep.report || []).forEach(function (r) {
          if (r.active) return;
          disabledList.push({
            id: "wb_off_" + r.id, label: "世界书 · " + r.title,
            group: "世界书", builtin: false, dynamic: true, reason: r.reason || "未激活"
          });
        });
      } catch (e) { console.warn("[ctx] 合并世界书报告失败:", e); }
      wbReport[category] = null;
    }

    pendingTrace[category] = {
      sessionId: sessionId,
      at: nowStr(),
      sections: sections,
      disabled: disabledList,
      wbStats: wbStats
    };
  }

  // ---------- 请求捕获（被 app_chat.js 调用） ----------
  function captureRequest(sessionId, category, messages, opts) {
    var trace = pendingTrace[category] || {
      sessionId: sessionId, at: nowStr(), sections: [], disabled: []
    };
    var key = reqKey(sessionId, category);
    lastRequests[key] = {
      sessionId: sessionId,
      at: nowStr(),
      messages: messages,
      trace: trace,
      preview: !!(opts && opts.preview)
    };
    var i = lastOrder.indexOf(key);
    if (i >= 0) lastOrder.splice(i, 1);
    lastOrder.push(key);
    while (lastOrder.length > MAX_KEEP) {
      var old = lastOrder.shift();
      delete lastRequests[old];
    }
    // 清理缓冲，避免旧 trace 串台
    pendingTrace[category] = null;
  }

  // 世界书引擎本轮激活报告（app_prompts.js 在 finalizeSegments 之前调用）
  function setWorldBookReport(category, result) {
    wbReport[category] = result || null;
  }

  // 附加段（app_chat.js 在 System Prompt 组装完成后调用，位于基础段之后）
  function pushExtraSection(category, sec) {
    if (!pendingTrace[category]) return;
    var t = pendingTrace[category];
    sec = sec || {};
    t.sections.push({
      id: sec.id || ("extra_" + t.sections.length),
      label: sec.label || "附加指令",
      group: sec.group || "附加",
      builtin: !!sec.builtin,
      depth: sec.depth || 9990,
      content: sec.content || "",
      enabled: !!sec.enabled,
      order: t.sections.length
    });
  }

  function currentSessionId() {
    try {
      if (typeof activeSessionId !== "undefined" && activeSessionId !== null) return activeSessionId;
    } catch (e) {}
    return null;
  }

  // ---------- 构建当前上下文预览（不发送，仅构建 + 记录 trace） ----------
  function buildPreview() {
    var sessionId = currentSessionId();
    if (!sessionId) { toast("请先进入一个对话会话"); return Promise.resolve(); }
    var category = activeTab;

    return db.sessions.get(sessionId).then(function (sess) {
      if (!sess) { toast("无法加载当前会话"); return; }
      if (sess.isGroup === 1) { toast("群聊请使用群聊专属设置，本页仅支持单聊"); return; }

      var theaterId = 0;
      var pre = Promise.resolve();
      if (category === "theater") {
        // 小剧场：优先用当前 activeTheaterId，否则回落到该会话最近一个小剧场，预览才准确
        try { if (typeof activeTheaterId !== "undefined" && activeTheaterId) theaterId = activeTheaterId; } catch (e) {}
        if (!theaterId) {
          pre = db.theaters.where("sessionId").equals(sessionId).toArray().then(function (list) {
            if (list && list.length) {
              list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
              theaterId = list[0].id;
            }
          }).catch(function () {});
        }
      }

      return pre.then(function () {
        var p;
        if (category === "online") {
          p = (typeof buildGlobalSystemPrompt === "function") ? buildGlobalSystemPrompt(sessionId) : Promise.resolve("");
        } else {
          p = (typeof buildOfflineSystemPrompt === "function")
            ? buildOfflineSystemPrompt(sessionId, theaterId, category === "theater")
            : Promise.resolve("");
        }
        return Promise.resolve(p).then(function (systemPrompt) {
          captureRequest(sessionId, category, [{ role: "system", content: systemPrompt || "" }], { preview: true });
          renderPanel();
          toast((category === "theater" && !theaterId) ? "已构建预览（未找到小剧场，用默认情景）" : "已构建当前上下文预览");
        });
      });
    }).catch(function (e) {
      console.warn("[ctx] buildPreview 失败:", e);
      toast("构建预览失败，请重试");
    });
  }

  // ---------- UI ----------
  function ensurePanel() {
    if (panelEl) return panelEl;
    if (document.getElementById("ctx-manager-panel")) {
      panelEl = document.getElementById("ctx-manager-panel");
      return panelEl;
    }
    // 与「单聊专属设置」面板同容器挂载，保证 overlay 定位与手机壳一致
    var anchor = document.getElementById("chat-details-panel");
    var host = (anchor && anchor.parentNode) ? anchor.parentNode : (document.getElementById("ctx-manager-panel-host") || document.body);
    var div = document.createElement("div");
    div.id = "ctx-manager-panel";
    div.className = "chat-details-overlay ctx-manager-overlay";
    div.innerHTML =
      '<header class="win-header">' +
        '<button class="btn-icon" onclick="window.contextManager.closePanel()">' + svgIcon(ICONS.chevron, 22) + '</button>' +
        '<h3>上下文管理</h3>' +
        '<div style="width:40px;"></div>' +
      '</header>' +
      '<div class="win-body" style="padding:14px;">' +
        '<div id="ctx-tab-bar" style="display:flex; gap:6px; margin-bottom:12px;"></div>' +
        '<div id="ctx-full-req" style="margin-bottom:14px;"></div>' +
        '<div id="ctx-section-list"></div>' +
      '</div>';
    host.appendChild(div);
    panelEl = div;

    // 淡彩样式
    var style = document.getElementById("ctx-manager-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "ctx-manager-style";
      style.textContent =
        ".ctx-manager-overlay{background:linear-gradient(160deg,#FDF9F3 0%,#F8F4FA 55%,#F2F6FA 100%) !important;}" +
        ".ctx-tab{flex:1; padding:9px 4px; border-radius:11px; border:1.5px solid transparent; background:#fff; font-size:12px; font-weight:700; color:#6b7280; cursor:pointer; transition:all .18s ease; box-shadow:0 1px 3px rgba(0,0,0,.04); display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;}" +
        ".ctx-tab:active{transform:scale(.97);}" +
        ".ctx-dot{width:7px; height:7px; border-radius:50%; flex-shrink:0;}" +
        ".ctx-card{background:#fff; border-radius:12px; border:1.5px solid #eee9f2; box-shadow:0 1px 4px rgba(0,0,0,.04); margin-bottom:9px; overflow:hidden;}" +
        ".ctx-card-head{display:flex; align-items:center; gap:7px; padding:9px 11px; cursor:pointer; user-select:none;}" +
        ".ctx-card-num{width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:800; flex-shrink:0;}" +
        ".ctx-card-body{padding:0 11px 11px 11px; display:none;}" +
        ".ctx-card-body.open{display:block;}" +
        ".ctx-pre{background:#faf8f5; border:1px solid #f0eae2; border-radius:9px; padding:10px; font-size:11px; line-height:1.6; color:#5b5560; white-space:pre-wrap; word-break:break-word; max-height:300px; overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}" +
        ".ctx-chip{font-size:9.5px; font-weight:700; padding:2px 7px; border-radius:99px; white-space:nowrap;}" +
        ".ctx-icon-btn{width:25px; height:25px; border-radius:8px; border:1px solid #e5e0ea; background:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#8a8496; flex-shrink:0;}" +
        ".ctx-icon-btn:active:not(:disabled){background:#f6f3f8;}" +
        ".ctx-icon-btn:disabled{opacity:.3; cursor:not-allowed;}" +
        ".ctx-role{font-size:9.5px; font-weight:800; letter-spacing:.4px; padding:2px 8px; border-radius:6px; text-transform:uppercase;}" +
        ".ctx-act{flex:1; padding:7px 4px; border-radius:9px; border:1.5px solid #e8e2ee; background:#fff; font-size:11px; font-weight:700; color:#6f6a7a; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;}" +
        ".ctx-act:active{transform:scale(.97);}" +
        ".ctx-stat{display:flex; flex-direction:column; gap:1px; flex:1; padding:8px 7px; border-radius:10px; align-items:flex-start;}" +
        ".ctx-stat b{font-size:14px; font-weight:800; letter-spacing:-.3px;}" +
        ".ctx-stat span{font-size:9px; font-weight:600; opacity:.8;}" +
        ".ctx-subhead{font-size:10.5px; font-weight:800; color:#8b8496; letter-spacing:.3px; margin:13px 0 6px 3px; display:flex; align-items:center; gap:6px;}" +
        ".ctx-empty{font-size:11.5px; color:#9a93a6; padding:16px; text-align:center; background:#fff; border-radius:11px; border:1.5px dashed #eee;}";
      document.head.appendChild(style);
    }
    return panelEl;
  }

  function renderTabBar() {
    var bar = document.getElementById("ctx-tab-bar");
    if (!bar) return;
    bar.innerHTML = CATEGORIES.map(function (c) {
      var p = PASTEL[c.id] || PASTEL.online;
      var active = c.id === activeTab;
      return '<button class="ctx-tab" style="' +
        (active ? ('background:' + p.soft + '; border-color:' + p.border + '; color:' + p.accent + '; box-shadow:0 2px 8px rgba(0,0,0,.07);') : '') +
        '" onclick="window.contextManager.switchTab(\'' + c.id + '\')">' +
        '<span class="ctx-dot" style="background:' + (active ? p.accent : '#d7d3de') + ';"></span>' + esc(c.label) + '</button>';
    }).join("");
  }

  function renderFullRequest() {
    var box = document.getElementById("ctx-full-req");
    if (!box) return;
    var pal = PASTEL[activeTab] || PASTEL.online;
    var lr = getCurrentRequest(activeTab);

    var inner = '<div class="ctx-card" style="border-color:' + pal.border + ';">' +
      '<div class="ctx-card-head" style="cursor:default;">' +
        svgIcon(ICONS.doc, 16, pal.accent) +
        '<span style="flex:1; font-size:13px; font-weight:800; color:#4a4a55;">最近一轮请求全文</span>';

    if (lr) {
      inner += '<button class="ctx-icon-btn" title="复制全文" onclick="window.contextManager.copyFullRequest()">' + svgIcon(ICONS.copy, 14) + '</button>';
    }
    inner += '</div><div style="padding:0 11px 11px 11px;">';

    if (!lr) {
      inner += '<div style="font-size:11.5px; color:#9a93a6; line-height:1.75;">当前类别还没有捕获到请求。' +
        '发一条消息（或点下方「构建预览」）后，这里会展示当时完整发出的 messages —— 系统设定、世界书、记忆、历史消息、你刚发的那句，全部按真实顺序列出。</div>' +
        '<button class="ctx-act" style="width:100%; margin-top:9px;" onclick="window.contextManager.buildPreview()">' +
        svgIcon(ICONS.refresh, 13) + '构建当前上下文预览</button>';
    } else {
      var msgs = lr.messages || [];
      var totalChars = 0, totalTokens = 0;
      msgs.forEach(function (m) { var t = messageToText(m); totalChars += t.length; totalTokens += estTokens(t); });
      inner += '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:9px;">' +
        '<span class="ctx-chip" style="background:' + (lr.preview ? '#F1EEFB' : pal.soft) + '; color:' + (lr.preview ? '#6B5BC4' : pal.accent) + ';">' +
          (lr.preview ? '预览构建 · 仅 system' : '真实请求') + '</span>' +
        '<span class="ctx-chip" style="background:#f4f1f7; color:#8b8496;">' + esc(lr.at) + '</span>' +
        '<span class="ctx-chip" style="background:#f4f1f7; color:#8b8496;">' + msgs.length + ' 条 · ' + fmtNum(totalChars) + ' 字 · ~' + fmtNum(totalTokens) + ' token</span>' +
      '</div>';

      var shown = msgs.slice(0, 60);
      shown.forEach(function (m, i) {
        var role = m.role || "unknown";
        var roleColor = role === "system" ? "#8b7bd8" : (role === "user" ? pal.accent : "#4fae7f");
        var roleBg = role === "system" ? "#f1edfa" : (role === "user" ? pal.soft : "#eaf6ef");
        var text = messageToText(m);
        var preview = text.length > 20000 ? (text.slice(0, 20000) + "\n\n…（超长已截断，点右上角复制可拿全量）") : text;
        inner += '<div style="border:1px solid #f0ebe3; border-radius:9px; padding:8px 10px; margin-bottom:7px; background:#fdfcfa;">' +
          '<div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">' +
            '<span class="ctx-role" style="background:' + roleBg + '; color:' + roleColor + ';">' + esc(role) + '</span>' +
            '<span style="font-size:10px; color:#b3acbe;">#' + (i + 1) + '</span>' +
            '<span style="font-size:10px; color:#b3acbe; margin-left:auto;">' + fmtNum(text.length) + ' 字 · ~' + fmtNum(estTokens(text)) + ' token</span>' +
          '</div>' +
          '<div class="ctx-pre" style="max-height:220px;">' + esc(preview) + '</div>' +
        '</div>';
      });
      if (msgs.length > shown.length) {
        inner += '<div style="font-size:10.5px; color:#9a93a6; text-align:center;">… 仅展示前 ' + shown.length + ' 条，其余省略（复制可拿全量）</div>';
      }
    }
    inner += '</div></div>';
    box.innerHTML = inner;
  }

  function messageToText(m) {
    if (m == null) return "";
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content.map(function (p) {
        if (p && p.type === "text") return p.text || "";
        if (p && p.type === "image_url") return "[图片]";
        if (p && p.text) return p.text;
        return "";
      }).join(" ");
    }
    return String(m.content || "");
  }

  function renderSections() {
    var box = document.getElementById("ctx-section-list");
    if (!box) return;
    var pal = PASTEL[activeTab] || PASTEL.online;
    var lr = getCurrentRequest(activeTab);
    var trace = lr && lr.trace ? lr.trace : null;

    // 若没有 trace，则用「目录 + 当前开关」生成一个静态列表（可开关/排序）
    var sections, disabled, hasRealTrace = !!trace;
    if (trace) {
      sections = trace.sections || [];
      disabled = trace.disabled || [];
    } else {
      sections = [];
      disabled = [];
      // 静态态：按目录自然顺序（depth）列出全部段，以「当前开关/手动覆盖」作为启用标记
      catEntries(activeTab).slice()
        .sort(function (a, b) { return (a.depth || 0) - (b.depth || 0); })
        .forEach(function (c) {
          if (isCurrentlyOn(c.id)) {
            sections.push({
              id: c.id, label: c.label, group: c.group, builtin: !!c.builtin,
              depth: c.depth, content: "", enabled: true, order: sections.length
            });
          } else {
            disabled.push({ id: c.id, label: c.label, group: c.group, builtin: !!c.builtin, reason: "已关闭" });
          }
        });
    }
    _renderedSectionsCount = sections.length;

    // 统计（按真实启用段累加）
    var totalChars = 0, totalTokens = 0;
    sections.forEach(function (s) {
      totalChars += (s.content || "").length;
      totalTokens += estTokens(s.content || "");
    });
    // 关闭原因分类：真关闭（开关/手动） vs 本轮无数据
    var offList = [], emptyList = [];
    disabled.forEach(function (d) {
      if (/关闭/.test(d.reason || "")) offList.push(d); else emptyList.push(d);
    });
    var catDesc = (CATEGORIES.filter(function (c) { return c.id === activeTab; })[0] || {}).desc || "";

    var html = '<div style="display:flex; align-items:center; gap:6px; margin-bottom:9px;">' +
      svgIcon(ICONS.list, 15, pal.accent) +
      '<span style="font-size:13px; font-weight:800; color:#4a4a55;">当前上下文部分</span>' +
      '<span style="font-size:10px; color:#b3acbe; margin-left:auto; max-width:150px; text-align:right; line-height:1.3;">' + esc(catDesc) + '</span>' +
    '</div>';

    // 统计条
    html += '<div style="display:flex; gap:6px; margin-bottom:9px;">' +
      statPill("启用", sections.length, pal) +
      statPill("关闭", offList.length, { soft: "#f6f2f8", accent: "#8b8496" }) +
      statPill("无数据", emptyList.length, { soft: "#f4f6f8", accent: "#94a3b8" }) +
      statPill("字符", fmtNum(totalChars), { soft: "#EDF3FA", accent: "#5A7FA8" }) +
      statPill("~token", fmtNum(totalTokens), { soft: "#E9F5F2", accent: "#35867A" }) +
    '</div>';

    // 世界书引擎本轮激活摘要
    var wb = lr && lr.trace ? lr.trace.wbStats : null;
    if (wb && wb.stats && wb.stats.total > 0) {
      var st = wb.stats;
      html += '<div style="font-size:10px; color:#8b8496; margin:-3px 0 10px 3px; line-height:1.7;">' +
        svgIcon(ICONS.brain, 11, "#6f9a86") + ' 世界书：命中 <b style="color:#5f9e7d;">' + st.active + '</b> / 共 ' + st.total +
        '（未挂载 ' + st.notMounted + ' · 未命中 ' + st.noKeyword + ' · 概率 ' + st.byProb +
        ' · 同组 ' + st.byGroup + ' · 冷却 ' + st.byCooldown + ' · 预算 ' + st.byBudget + '）' +
        ' · 约 ' + fmtNum(wb.tokens) + ' token</div>';
    }

    // 操作条
    html += '<div style="display:flex; gap:6px; margin-bottom:11px;">' +
      '<button class="ctx-act" onclick="window.contextManager.buildPreview()">' + svgIcon(ICONS.refresh, 12) + '构建预览</button>' +
      '<button class="ctx-act" onclick="window.contextManager.toggleAllBodies(true)">' + svgIcon(ICONS.expand, 12) + '展开</button>' +
      '<button class="ctx-act" onclick="window.contextManager.toggleAllBodies(false)">' + svgIcon(ICONS.collapse, 12) + '收起</button>' +
      '<button class="ctx-act" onclick="window.contextManager.resetOrder()">' + svgIcon(ICONS.reset, 12) + '重置顺序</button>' +
    '</div>';

    if (!hasRealTrace) {
      html += '<div style="font-size:10.5px; color:#9a93a6; margin-bottom:10px; padding:8px 10px; background:#fff; border:1px dashed #e5dce9; border-radius:9px;">以下为按当前开关估算的静态列表（尚未捕获到真实请求）。点「构建预览」可立即得到真实构建结果。</div>';
    }

    // 启用的段（可排序）
    html += '<div class="ctx-subhead">' + svgIcon(ICONS.eye, 12, pal.accent) + '已启用 · 按实际发送顺序</div>';
    if (sections.length === 0) {
      html += '<div class="ctx-empty">暂无已启用段</div>';
    }
    sections.forEach(function (s, i) {
      html += renderSectionCard(s, i, true, pal);
    });

    // 关闭的段（分两类，语义更清楚）
    if (offList.length > 0) {
      html += '<div class="ctx-subhead">' + svgIcon(ICONS.lock, 12, "#8b8496") + '已关闭 · 不会发给 AI（' + offList.length + '）' +
        '<span style="margin-left:auto; font-size:10px; font-weight:700; color:#a99fc0; cursor:pointer;" onclick="window.contextManager.resetSwitches()">清除手动关闭</span>' +
        '</div>';
      offList.forEach(function (d) { html += renderDisabledCard(d, pal); });
    }
    if (emptyList.length > 0) {
      html += '<div class="ctx-subhead">' + svgIcon(ICONS.brain, 12, "#94a3b8") + '本轮无数据 · 未产生内容（' + emptyList.length + '）</div>';
      emptyList.forEach(function (d) { html += renderDisabledCard(d, pal); });
    }

    box.innerHTML = html;
  }

  function statPill(label, value, pal) {
    return '<div class="ctx-stat" style="background:' + pal.soft + '; color:' + pal.accent + ';">' +
      '<b>' + esc(String(value)) + '</b><span>' + esc(label) + '</span></div>';
  }

  function renderSectionCard(s, idx, enabled, pal) {
    var c = CATALOG_BY_ID[s.id];
    var isBuiltin = s.builtin || (c && c.builtin);
    var locked = (s.id === "disclaimer");
    var isAppended = !!(c && c.appended);
    var isDynamic = !c;                       // 动态段（如各条世界书）
    var isAtDepth = !!s.atDepth;              // 注入在聊天记录内
    var numColor = pal.soft;
    var numFg = pal.accent;
    var collapseId = "ctx-body-" + s.id + "-" + idx;

    var chips = '<span class="ctx-chip" style="background:#f3f0f6; color:#8a7bd8;">' + esc(s.group || "其他") + '</span>';
    if (isBuiltin) chips += '<span class="ctx-chip" style="background:#EDF3FA; color:#4A7DBF;">常驻</span>';
    if (isAppended) chips += '<span class="ctx-chip" style="background:#eef4f0; color:#6f9a86;">追加</span>';
    if (isAtDepth) chips += '<span class="ctx-chip" style="background:#eef4f0; color:#5f9e7d;">聊天内 · 深度 ' + esc(String(s.depth)) + '</span>';
    if (s.wbPos && !isAtDepth) {
      var _wbPosLabel = (window.worldBookEngine && window.worldBookEngine.positionLabel)
        ? window.worldBookEngine.positionLabel(s.wbPos) : s.wbPos;
      chips += '<span class="ctx-chip" style="background:#eef4f0; color:#6f9a86;">' + esc(_wbPosLabel) + '</span>';
    }

    var controls = '';
    if (isAppended) {
      controls += '<span class="ctx-icon-btn" style="opacity:.5; cursor:default;" title="固定追加在请求末尾">' + svgIcon(ICONS.plug, 13) + '</span>';
    } else if (locked) {
      controls += '<span class="ctx-icon-btn" style="opacity:.5; cursor:default;" title="固定置顶">' + svgIcon(ICONS.lock, 13) + '</span>';
    } else if (isDynamic) {
      controls += '<span class="ctx-icon-btn" style="opacity:.5; cursor:default;" title="顺序由世界书的位置 / 顺序决定">' + svgIcon(ICONS.plug, 13) + '</span>';
    } else {
      controls += '<button class="ctx-icon-btn" title="上移" ' + (idx === 0 ? 'disabled' : '') + ' onclick="window.contextManager.moveSection(\'' + s.id + '\',-1)">' + svgIcon(ICONS.up, 13) + '</button>';
      controls += '<button class="ctx-icon-btn" title="下移" ' + (idx === sectionsCount() - 1 ? 'disabled' : '') + ' onclick="window.contextManager.moveSection(\'' + s.id + '\',1)">' + svgIcon(ICONS.down, 13) + '</button>';
    }

    var toggle = '';
    if (locked) {
      toggle = '<span class="ctx-icon-btn" style="opacity:.5; cursor:default;" title="不可关闭">' + svgIcon(ICONS.lock, 13) + '</span>';
    } else if (isBuiltin) {
      toggle = '<span class="ctx-icon-btn" style="opacity:.5; cursor:default;" title="常驻不可关闭">' + svgIcon(ICONS.lock, 13) + '</span>';
    } else {
      toggle = '<label class="switch" style="transform:scale(.82); margin:0;">' +
        '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="window.contextManager.toggleSection(\'' + s.id + '\', this.checked)">' +
        '<span class="slider"></span></label>';
    }

    var len = (s.content || "").length;
    var sizeChip = len > 0
      ? '<span class="ctx-chip" style="background:#f4f1f7; color:#8b8496;">' + fmtNum(len) + ' 字</span>'
      : '';

    return '<div class="ctx-card" style="border-color:' + pal.border + ';">' +
      '<div class="ctx-card-head" onclick="window.contextManager.toggleCardBody(\'' + collapseId + '\')">' +
        '<span class="ctx-card-num" style="background:' + numColor + '; color:' + numFg + ';">' + (idx + 1) + '</span>' +
        '<span style="flex:1; font-size:12.5px; font-weight:700; color:#4a4a55; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(s.label || s.id) + '</span>' +
        sizeChip + chips +
        '<span style="display:flex; align-items:center; gap:4px;" onclick="event.stopPropagation();">' + controls + toggle + '</span>' +
        '<span class="ctx-icon-btn" style="pointer-events:none;">' + svgIcon(ICONS.chevron, 13) + '</span>' +
      '</div>' +
      '<div class="ctx-card-body" id="' + collapseId + '">' +
        '<div style="font-size:10.5px; color:#9a93a6; margin-bottom:7px; line-height:1.6;">' + esc((c && c.desc) || "") + '</div>' +
        (s.meta
          ? '<div style="font-size:10.5px; color:#7c6f86; background:rgba(124,111,134,0.07); border-radius:7px; padding:5px 8px; margin-bottom:6px; line-height:1.55;">' + esc(s.meta) + '</div>'
          : '') +
        (s.content
          ? '<div style="font-size:10px; color:#b3acbe; margin-bottom:6px;">' + fmtNum(len) + ' 字 · 约 ' + fmtNum(estTokens(s.content)) + ' token</div><div class="ctx-pre">' + esc(s.content) + '</div>'
          : '<div style="font-size:11px; color:#b3acbe;">（本段无独立正文，或内容已并入其它段）</div>') +
      '</div>' +
    '</div>';
  }

  function renderDisabledCard(d, pal) {
    var c = CATALOG_BY_ID[d.id];
    var isWb = /^wb_off_\d+$/.test(d.id);           // 世界书未激活条目：可在上下文管理里直接开关
    var canToggle = isWb || (c && !c.builtin);
    var checked = isWb ? false : isCurrentlyOn(d.id);
    var toggle = canToggle
      ? '<label class="switch" style="transform:scale(.82); margin:0;">' +
          '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="window.contextManager.toggleSection(\'' + d.id + '\', this.checked)">' +
          '<span class="slider"></span></label>'
      : '<span class="ctx-icon-btn" style="opacity:.5; cursor:default;" title="常驻">' + svgIcon(ICONS.lock, 13) + '</span>';

    return '<div class="ctx-card" style="opacity:.74; border-style:dashed; margin-bottom:7px;">' +
      '<div class="ctx-card-head" style="cursor:default; padding:8px 11px;" title="' + esc((c && c.desc) || "") + '">' +
        '<span class="ctx-chip" style="background:#f3f0f6; color:#8a7bd8;">' + esc(d.group || "其他") + '</span>' +
        '<span style="flex:1; font-size:12px; font-weight:600; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(d.label || d.id) + '</span>' +
        '<span class="ctx-chip" style="background:#f1f1f4; color:#9a93a6;">' + esc(d.reason || "未注入") + '</span>' +
        toggle +
      '</div>' +
    '</div>';
  }

  function isCurrentlyOn(id) {
    var c = CATALOG_BY_ID[id];
    if (!c) return false;
    if (c.builtin) return true;
    if (c.switch) return readSwitch(id, null).on;
    // none：默认开，除非被手动禁用覆盖
    var ov = getOverrides(currentSess);
    var catOv = ov[activeTab] || {};
    var dis = Array.isArray(catOv.disabled) ? catOv.disabled : [];
    return dis.indexOf(id) < 0;
  }

  // 当前启用段总数（用于「下移」末位禁用）
  function sectionsCount() {
    return _renderedSectionsCount;
  }

  function renderPanel() {
    ensurePanel();
    renderTabBar();
    renderFullRequest();
    renderSections();
  }

  function toggleCardBody(id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle("open");
  }

  // 全部展开 / 收起
  function toggleAllBodies(open) {
    var nodes = document.querySelectorAll("#ctx-section-list .ctx-card-body");
    for (var i = 0; i < nodes.length; i++) {
      if (open) nodes[i].classList.add("open");
      else nodes[i].classList.remove("open");
    }
  }

  // 重置本类别排序（清掉 order 覆盖，回到按 depth 的自然顺序）
  function resetOrder() {
    var sessionId = currentSessionId();
    if (!sessionId) { toast("请先进入一个对话会话"); return; }
    db.sessions.get(sessionId).then(function (sess) {
      if (!sess) return;
      var ov = normOverrides(sess);
      var catOv = ov[activeTab] || {};
      delete catOv.order;
      ov[activeTab] = catOv;
      sess.ctxOverrides = ov;
      currentSess = sess;
      return db.sessions.update(sessionId, { ctxOverrides: ov });
    }).then(function () {
      toast("已重置为默认自然顺序");
      renderPanel();
    }).catch(function (e) {
      console.warn("[ctx] resetOrder 失败:", e);
      toast("重置顺序失败");
    });
  }

  // 清除本类别的「手动关闭」覆盖（不影响你真正的会话开关）
  function resetSwitches() {
    var sessionId = currentSessionId();
    if (!sessionId) { toast("请先进入一个对话会话"); return; }
    db.sessions.get(sessionId).then(function (sess) {
      if (!sess) return;
      var ov = normOverrides(sess);
      var catOv = ov[activeTab] || {};
      catOv.disabled = [];
      ov[activeTab] = catOv;
      sess.ctxOverrides = ov;
      currentSess = sess;
      return db.sessions.update(sessionId, { ctxOverrides: ov });
    }).then(function () {
      toast("已清除手动关闭（会话开关未改动）");
      renderPanel();
    }).catch(function (e) {
      console.warn("[ctx] resetSwitches 失败:", e);
      toast("清除失败");
    });
  }

  function copyFullRequest() {
    var lr = getCurrentRequest(activeTab);
    if (!lr || !lr.messages) { toast("暂无请求可复制"); return; }
    var text;
    try {
      text = JSON.stringify(lr.messages, null, 2);
    } catch (e) {
      text = lr.messages.map(function (m) {
        return "[" + (m.role || "?") + "]\n" + messageToText(m);
      }).join("\n\n");
    }
    copyText(text);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("已复制到剪贴板"); }, function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("已复制到剪贴板");
    } catch (e) {
      toast("复制失败，请长按文本手动复制");
    }
  }

  // ---------- 对外 API ----------
  window.contextManager = {
    CATEGORIES: CATEGORIES,
    openPanel: function () {
      var sessionId = currentSessionId();
      if (!sessionId) { toast("请先进入一个对话会话"); return; }
      ensurePanel();
      // 关闭单聊详情页，避免两个 overlay 叠放
      try { if (typeof closeChatDetails === "function") closeChatDetails(); } catch (e) {}
      panelEl.classList.add("active");
      db.sessions.get(sessionId).then(function (sess) {
        currentSess = sess || null;
        renderPanel();
      }).catch(function () {
        renderPanel();
      });
    },
    closePanel: function () {
      if (panelEl) panelEl.classList.remove("active");
    },
    switchTab: function (id) {
      if (id !== "online" && id !== "theater" && id !== "date") return;
      activeTab = id;
      storeTab(id);
      renderPanel();
    },
    renderPanel: renderPanel,
    toggleCardBody: toggleCardBody,
    toggleAllBodies: toggleAllBodies,
    resetOrder: resetOrder,
    resetSwitches: resetSwitches,
    toggleSection: toggleSection,
    moveSection: moveSection,
    buildPreview: buildPreview,
    copyFullRequest: copyFullRequest,
    captureRequest: captureRequest,
    finalizeSegments: finalizeSegments,
    pushExtraSection: pushExtraSection,
    setWorldBookReport: setWorldBookReport,
    getCatalog: function () { return CATALOG; },
    getLastRequest: function (category) { return getCurrentRequest(category || activeTab); },
  };

  // 启动：恢复上次查看的 Tab + 预建 DOM（不自动展开，等用户从对话详情进入）
  function boot() {
    try {
      activeTab = readStoredTab();
      ensurePanel();
    } catch (e) { console.warn("[ctx] boot 失败:", e); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
