/**
 * app_world_book_engine.js - 世界书激活与插入引擎（对标 SillyTavern World Info）
 *
 * 设计目标：
 *   1. 把「世界书条目」从"全部塞进 system prompt 的某一段"升级为酒馆式的
 *      「插入位置 position + 顺序 order + 深度 depth + 关键词逻辑 + 概率 + 互斥组 + 粘滞/冷却」。
 *   2. 每次请求时给出结构化激活报告（哪些命中、为什么没命中、注入到哪），
 *      供「上下文管理」逐条展示与开关。
 *   3. 完全向后兼容：没有 position 的旧条目走 legacy（按原 depth 原样注入，行为不变）。
 *
 * 参考：SillyTavern world-info.js 的 world_info_position / order / depth / role /
 *      selectiveLogic / probability / group / sticky / cooldown 语义（做了裁剪）。
 */

(function () {
  "use strict";

  // 插入位置（对标的 SillyTavern 简化版：砍掉 AN/EM/Outlet，保留最常用的四个 + 旧版）
  var POSITIONS = [
    { id: "before_char", label: "角色定义之前", short: "角色前", desc: "世界观总纲 / 背景设定，AI 在读人设前先看到" },
    { id: "after_char",  label: "角色定义之后", short: "角色后", desc: "角色详情 / NPC / 场景 / 物品，补充人设" },
    { id: "after_rule",  label: "回复准则之后", short: "准则后", desc: "写作规范 / 行为纠正，紧贴规则区" },
    { id: "at_depth",    label: "聊天记录内（按深度）", short: "聊天内", desc: "注入到最近第 N 条消息处，越靠近末尾影响越强" },
    { id: "legacy",      label: "旧版（按深度原样）", short: "旧版", desc: "保留旧行为：直接用 Depth 数值排序注入" }
  ];

  // 关键词逻辑（对标 selectiveLogic）
  var LOGICS = [
    { id: "AND_ANY", label: "命中任一主词（次要词命中任一）" },
    { id: "AND_ALL", label: "命中主词且命中全部次要词" },
    { id: "NOT_ANY", label: "命中主词且不命中任何次要词" },
    { id: "NOT_ALL", label: "命中主词且未命中全部次要词" }
  ];

  // 插入位置 → system prompt 深度锚点（配合 order 在锚点带内微调）
  var ANCHOR = { before_char: -870, after_char: -750, after_rule: -497 };

  var DEFAULT_SCAN_DEPTH = 10;
  var DEFAULT_ORDER = 100;
  var DEFAULT_WEIGHT = 100;

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function pct(v) { var n = Number(v); return isFinite(n) ? n : 100; }

  function parseKeys(raw) {
    if (Array.isArray(raw)) return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (raw === null || raw === undefined) return [];
    return String(raw).split(/[,，|｜;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function estTokens(text) {
    if (!text) return 0;
    var s = String(text);
    var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    return Math.ceil(cjk / 1.5 + Math.max(0, s.length - cjk) / 4);
  }

  // 把 DB 里的原始条目补全为完整 schema（只读，不写库）
  function normalizeEntry(raw) {
    var e = raw || {};
    var mode = e.mode || (e.isActive ? "constant" : "disabled");
    var pos = e.position;
    if (pos === undefined || pos === null || pos === "") pos = "legacy";
    return {
      id: e.id,
      title: e.title || e.comment || ("条目 " + e.id),
      group: e.group || "默认分组",
      content: e.content || "",
      mode: mode,                                  // constant | selective | disabled
      position: pos,                               // 见 POSITIONS
      order: num(e.order, DEFAULT_ORDER),          // 越大越靠后（影响越强）
      role: e.role || "system",                    // at_depth 专用
      depth: num(e.depth, 10),                     // at_depth / legacy 专用
      probability: Math.max(0, Math.min(100, pct(e.probability))),
      useProbability: e.useProbability !== false,
      keys: parseKeys(e.keys !== undefined ? e.keys : e.keywords),
      secondaryKeys: parseKeys(e.secondaryKeys),
      selectiveLogic: e.selectiveLogic || "AND_ANY",
      caseSensitive: !!e.caseSensitive,
      matchWholeWords: !!e.matchWholeWords,
      scanDepth: (e.scanDepth === null || e.scanDepth === undefined || e.scanDepth === "") ? null : Math.max(0, num(e.scanDepth, 0)),
      inclusionGroup: e.inclusionGroup || "",
      groupWeight: Math.max(0, num(e.groupWeight, DEFAULT_WEIGHT)),
      groupOverride: !!e.groupOverride,
      sticky: Math.max(0, num(e.sticky, 0)),
      cooldown: Math.max(0, num(e.cooldown, 0)),
      ignoreBudget: !!e.ignoreBudget
    };
  }

  function positionLabel(id) {
    for (var i = 0; i < POSITIONS.length; i++) if (POSITIONS[i].id === id) return POSITIONS[i].short;
    return "旧版";
  }

  // 关键词命中判断
  function hitAny(text, keys, caseSensitive, wholeWords) {
    if (!keys || keys.length === 0) return false;
    var hay = caseSensitive ? String(text) : String(text).toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      var k = caseSensitive ? keys[i] : keys[i].toLowerCase();
      if (!k) continue;
      if (wholeWords) {
        // 整词匹配：两侧不能是字母/数字/汉字
        var idx = 0;
        while (true) {
          var at = hay.indexOf(k, idx);
          if (at < 0) break;
          var before = at > 0 ? hay.charAt(at - 1) : "";
          var after = hay.charAt(at + k.length);
          var isWordChar = function (c) { return !!c && /[0-9a-zA-Z\u3400-\u9fff]/.test(c); };
          if (!isWordChar(before) && !isWordChar(after)) return true;
          idx = at + k.length;
        }
      } else {
        if (hay.indexOf(k) >= 0) return true;
      }
    }
    return false;
  }

  // selectiveLogic：主词命中后，按逻辑过滤次要词
  function logicPass(primaryHit, secondaryHits, secondaryTotal, logic) {
    if (!primaryHit) return false;
    if (secondaryTotal === 0) return true;
    switch (logic) {
      case "AND_ALL": return secondaryHits >= secondaryTotal;
      case "NOT_ANY": return secondaryHits === 0;
      case "NOT_ALL": return secondaryHits < secondaryTotal;
      case "AND_ANY":
      default: return secondaryHits > 0;
    }
  }

  function countHits(text, keys, caseSensitive, wholeWords) {
    if (!keys || keys.length === 0) return 0;
    var n = 0;
    for (var i = 0; i < keys.length; i++) {
      if (hitAny(text, [keys[i]], caseSensitive, wholeWords)) n++;
    }
    return n;
  }

  // ---------- 扫描文本 ----------
  async function fetchScanMessages(sessionId, mode, limit) {
    try {
      if (mode === "offline" || mode === "theater" || mode === "date") {
        var arr = await db.offline_messages.where("sessionId").equals(sessionId).toArray();
        arr.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
        return arr.slice(-limit);
      }
      var msgs = await db.messages.where("sessionId").equals(sessionId).toArray();
      msgs.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
      return msgs.slice(-limit);
    } catch (e) {
      console.warn("[WB] 扫描消息失败:", e);
      return [];
    }
  }

  async function countMessages(sessionId, mode) {
    try {
      if (mode === "offline" || mode === "theater" || mode === "date") {
        return await db.offline_messages.where("sessionId").equals(sessionId).count();
      }
      return await db.messages.where("sessionId").equals(sessionId).count();
    } catch (e) { return 0; }
  }

  function textOf(msgs) {
    return (msgs || []).map(function (m) {
      var c = m && m.content;
      if (typeof c !== "string") c = "";
      return c;
    }).join("\n");
  }

  // 分组禁用开关（沿用旧 localStorage 约定）
  function isGroupDisabled(group) {
    try { return localStorage.getItem("wb_group_disabled_" + group) === "true"; } catch (e) { return false; }
  }

  // ---------- 核心：激活判定 ----------
  /**
   * v1.5.18：统一解析当前场景该挂载哪些世界书条目。
   * 修复点：以前线下只读 sess.offlineMountedEntryIds，剧场在「线下专属设定」里
   * 保存的挂载（theaters.mountedEntryIds）根本没被读取 → 表现为「开关无效 / 关不掉」。
   * 优先级：剧场自带挂载 > 线下专属挂载 > 群挂载 > 线上挂载
   */
  async function resolveMountedIds(sess, mode, theaterId) {
    var fallback = (sess && sess.mountedEntryIds) || [];
    try {
      if (theaterId) {
        var th = await db.theaters.get(Number(theaterId));
        if (th && Array.isArray(th.mountedEntryIds) && th.mountedEntryIds.length > 0) return th.mountedEntryIds;
      }
      if (mode === "offline") {
        if (sess && Array.isArray(sess.offlineMountedEntryIds)) return sess.offlineMountedEntryIds;
        if (sess && sess.isGroup === 1 && sess.groupId) {
          var g = await db.groups.get(sess.groupId);
          if (g && Array.isArray(g.mountedEntryIds)) return g.mountedEntryIds;
        }
        return fallback;
      }
      return fallback;
    } catch (e) {
      console.warn("[世界书] 解析挂载失败，回落线上挂载", e);
      return fallback;
    }
  }

  /**
   * @param {number} sessionId
   * @param {object} opts { mode: 'online'|'offline', scanText?: string, theaterId?: number }
   * @returns {Promise<object>} 结构化激活结果
   */
  async function checkWorldInfo(sessionId, opts) {
    opts = opts || {};
    var mode = opts.mode === "offline" || opts.mode === "theater" || opts.mode === "date" ? "offline" : "online";
    var result = {
      mode: mode,
      beforeChar: [], afterChar: [], afterRule: [], atDepth: [], legacy: [],
      report: [],            // 每个条目的状态（含未激活），供上下文管理逐条展示
      stats: { total: 0, active: 0, notMounted: 0, groupOff: 0, disabled: 0, noKeyword: 0, byProb: 0, byGroup: 0, byCooldown: 0, byBudget: 0 },
      tokens: 0
    };

    var sess = null;
    try { sess = await db.sessions.get(sessionId); } catch (e) {}
    if (!sess) return result;

    var all = [];
    try { all = await db.world_book_entries.toArray(); } catch (e) { all = []; }
    result.stats.total = all.length;
    if (all.length === 0) return result;

    var mountedIds = await resolveMountedIds(sess, mode, opts.theaterId);

    // 扫描深度：全局默认 + 条目覆盖，取最大值一次性取消息
    var globalScan = Math.max(1, parseInt(localStorage.getItem("wb-scan-depth") || String(DEFAULT_SCAN_DEPTH), 10) || DEFAULT_SCAN_DEPTH);
    var maxScan = globalScan;
    var normalized = all.map(normalizeEntry);
    normalized.forEach(function (e) { if (e.scanDepth !== null && e.scanDepth > maxScan) maxScan = e.scanDepth; });

    var scanMsgs = null;
    var scanText = "";
    if (typeof opts.scanText === "string") {
      scanText = opts.scanText;
    } else {
      scanMsgs = await fetchScanMessages(sessionId, mode, maxScan);
      scanText = textOf(scanMsgs);
    }

    var msgCount = await countMessages(sessionId, mode);
    var act = (sess.wbActivation && typeof sess.wbActivation === "object") ? sess.wbActivation : {};
    var actDirty = false;

    // ---------- 1. 逐条筛选 ----------
    var candidates = [];
    normalized.forEach(function (e) {
      var rec = { id: e.id, title: e.title, group: e.group, position: e.position, order: e.order, active: false, reason: "" };
      result.report.push(rec);

      var isAlways = (e.group === "常驻" || e.group === "破限底料");
      var isMounted = mountedIds.indexOf(e.id) >= 0;
      if (!isMounted && !isAlways) { rec.reason = "未挂载"; result.stats.notMounted++; return; }
      if (isGroupDisabled(e.group)) { rec.reason = "分组已关停"; result.stats.groupOff++; return; }
      if (e.mode === "disabled") { rec.reason = "条目已禁用"; result.stats.disabled++; return; }

      // 粘滞 / 冷却
      var st = act[e.id] || {};
      var stickyActive = st.stickyUntil && msgCount < st.stickyUntil;
      var cooling = st.cooldownUntil && msgCount < st.cooldownUntil;
      if (!stickyActive && cooling) { rec.reason = "冷却中"; result.stats.byCooldown++; return; }

      // 关键词（constant 免检；sticky 生效中免检）
      if (!stickyActive && e.mode === "selective") {
        var text = scanText;
        if (e.scanDepth !== null && e.scanDepth !== globalScan && scanMsgs) {
          text = textOf(scanMsgs.slice(-e.scanDepth));
        }
        var pHit = hitAny(text, e.keys, e.caseSensitive, e.matchWholeWords);
        var sHits = countHits(text, e.secondaryKeys, e.caseSensitive, e.matchWholeWords);
        if (!logicPass(pHit, sHits, e.secondaryKeys.length, e.selectiveLogic)) {
          rec.reason = e.keys.length === 0 ? "未设置关键词" : "关键词未命中";
          result.stats.noKeyword++;
          return;
        }
      }

      e._sticky = !!stickyActive;
      candidates.push(e);
    });

    // ---------- 2. 概率 ----------
    var afterProb = [];
    candidates.forEach(function (e) {
      if (!e._sticky && e.useProbability && e.probability < 100 && Math.random() * 100 > e.probability) {
        var rec = findRec(result, e.id); if (rec) rec.reason = "概率未命中 (" + e.probability + "%)";
        result.stats.byProb++;
        return;
      }
      afterProb.push(e);
    });

    // ---------- 3. 互斥组（Inclusion Group）：同组只留一个 ----------
    var grouped = {};
    var afterGroup = [];
    afterProb.forEach(function (e) {
      if (!e.inclusionGroup) { afterGroup.push(e); return; }
      if (!grouped[e.inclusionGroup]) grouped[e.inclusionGroup] = [];
      grouped[e.inclusionGroup].push(e);
    });
    Object.keys(grouped).forEach(function (g) {
      var list = grouped[g];
      if (list.length === 1) { afterGroup.push(list[0]); return; }
      var overrides = list.filter(function (e) { return e.groupOverride; });
      var pick;
      if (overrides.length) {
        overrides.sort(function (a, b) { return b.order - a.order; });
        pick = overrides[0];
      } else {
        var totalW = list.reduce(function (s, e) { return s + Math.max(1, e.groupWeight); }, 0);
        var r = Math.random() * totalW, acc = 0;
        pick = list[0];
        for (var i = 0; i < list.length; i++) {
          acc += Math.max(1, list[i].groupWeight);
          if (r <= acc) { pick = list[i]; break; }
        }
      }
      afterGroup.push(pick);
      list.forEach(function (e) {
        if (e === pick) return;
        var rec = findRec(result, e.id);
        if (rec) rec.reason = "同组「" + g + "」未选中";
        result.stats.byGroup++;
      });
    });

    // ---------- 4. 排序（order 越大越强/越靠后）+ 预算裁剪 ----------
    afterGroup.sort(function (a, b) { return b.order - a.order; }); // 预算优先保强的
    var budget = Math.max(0, parseInt(localStorage.getItem("wb-budget-tokens") || "0", 10) || 0);
    var used = 0;
    var finalList = [];
    afterGroup.forEach(function (e) {
      var content = formatEntry(e);
      var tk = estTokens(content);
      if (budget > 0 && !e.ignoreBudget && used + tk > budget) {
        var rec = findRec(result, e.id);
        if (rec) rec.reason = "超出世界书预算 (" + budget + " token)";
        result.stats.byBudget++;
        return;
      }
      used += tk;
      e._content = content;
      finalList.push(e);
    });

    // ---------- 5. 分发到各插入位 ----------
    finalList.forEach(function (e) {
      var rec = findRec(result, e.id);
      if (rec) { rec.active = true; rec.reason = e._sticky ? "粘滞生效中" : (e.mode === "constant" ? "永久触发" : "关键词命中"); }
      result.stats.active++;
      var item = { id: e.id, title: e.title, order: e.order, position: e.position, content: e._content, sticky: !!e._sticky };
      if (e.position === "at_depth") {
        item.depth = Math.max(0, Math.round(e.depth));
        item.role = e.role || "system";
        result.atDepth.push(item);
      } else if (e.position === "after_char") {
        result.afterChar.push(item);
      } else if (e.position === "after_rule") {
        result.afterRule.push(item);
      } else if (e.position === "legacy") {
        item.depth = e.depth;
        result.legacy.push(item);
      } else {
        result.beforeChar.push(item);
      }
    });

    // ---------- 6. 回写粘滞/冷却状态 ----------
    finalList.forEach(function (e) {
      var st = act[e.id] || {};
      var next = { stickyUntil: st.stickyUntil || 0, cooldownUntil: st.cooldownUntil || 0 };
      if (e._sticky) {
        // 粘滞生效中：保持原倒计时
      } else if (e.sticky > 0) {
        next.stickyUntil = msgCount + e.sticky;
      }
      if (!e._sticky && e.cooldown > 0) {
        next.cooldownUntil = msgCount + e.cooldown;
      }
      if (next.stickyUntil !== (st.stickyUntil || 0) || next.cooldownUntil !== (st.cooldownUntil || 0)) {
        act[e.id] = next;
        actDirty = true;
      }
    });
    if (actDirty) {
      try { await db.sessions.update(sessionId, { wbActivation: act }); } catch (e) {}
    }

    result.tokens = used;
    _lastResult[sessionId + "::" + mode] = result;
    return result;
  }

  function findRec(result, id) {
    for (var i = 0; i < result.report.length; i++) if (result.report[i].id === id) return result.report[i];
    return null;
  }

  function formatEntry(e) {
    return "【世界书 · " + e.title + "】\n" + e.content;
  }

  // 缓存最近一次结果，供 app_chat.js 取 at_depth 用
  var _lastResult = {};
  function getResult(sessionId, mode) {
    var key = sessionId + "::" + (mode === "offline" || mode === "theater" || mode === "date" ? "offline" : "online");
    return _lastResult[key] || null;
  }

  // 段深度：锚点 + order 微调（order 越大越靠后）
  function segmentDepth(item) {
    var pos = item.position;
    if (pos === "legacy") return item.depth;
    var base = ANCHOR[pos];
    if (base === undefined) base = ANCHOR.before_char;
    return base + (item.order - DEFAULT_ORDER) * 0.001;
  }

  /**
   * 把 at_depth 条目注入到 messages 数组（从末尾倒数 depth 条之前；depth=0 表示追加到最末）
   * 原地修改 messagesToSend。
   */
  function insertAtDepth(messagesToSend, atDepthList) {
    if (!atDepthList || atDepthList.length === 0 || !messagesToSend) return;
    var len = messagesToSend.length;
    var buckets = {};   // key: idx + "::" + role
    var keyOrder = [];
    atDepthList.forEach(function (it) {
      var d = Math.max(0, parseInt(it.depth, 10) || 0);
      var idx = Math.max(0, len - d);
      var role = it.role || "system";
      var key = idx + "::" + role;
      if (!buckets[key]) { buckets[key] = { idx: idx, role: role, items: [] }; keyOrder.push(key); }
      buckets[key].items.push(it);
    });
    var out = [];
    for (var i = 0; i <= len; i++) {
      keyOrder.forEach(function (k) {
        var b = buckets[k];
        if (b.idx !== i) return;
        out.push({ role: b.role, content: b.items.map(function (x) { return x.content; }).join("\n\n") });
      });
      if (i < len) out.push(messagesToSend[i]);
    }
    messagesToSend.length = 0;
    out.forEach(function (m) { messagesToSend.push(m); });
  }

  window.worldBookEngine = {
    POSITIONS: POSITIONS,
    LOGICS: LOGICS,
    normalizeEntry: normalizeEntry,
    positionLabel: positionLabel,
    checkWorldInfo: checkWorldInfo,
    getResult: getResult,
    segmentDepth: segmentDepth,
    insertAtDepth: insertAtDepth,
    estTokens: estTokens,
    parseKeys: parseKeys
  };
})();
