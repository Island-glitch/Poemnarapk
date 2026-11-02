/**
 * app_chat_reverse_check.js - 反查手机（角色偷看 user 的手机）
 * ------------------------------------------------------------
 * 用户视角：在「聊天详情」打开「允许对方查看你的手机」并选高频/中频/低频，
 *          角色就会在你不注意的时候偷看你的手机；也可以点「立刻触发一次」。
 *
 * 流程（全部自动跳页 + 即时调用 API，user 只能点顶部「抢回手机」中断）：
 *   1. 聊天对话列表页：把「除他之外」的其他联系人上下文合并 → 让角色做出反应（左下角半透明气泡）
 *   2. 逐个点进其他会话：读最近 10 轮 → 角色反应 + 代 user 写一句话发出去 → 等对方回复
 *      → 40% 概率继续对线一轮
 *   3. 购物车页：读取购物车商品 → 角色反应（可含「打钱」命令 → 进余额 + 记账单流水）
 *   4. 结束：角色感想卡片 + 以卡片形式发一条「反查手机报告」到聊天里，点开看动线时间轴
 *
 * 约定：禁止 emoji 图标（全部通用路径 SVG）、禁止浏览器原生弹窗（全部自制卡片）。
 */
(function () {
  'use strict';

  // ==================== 常量 ====================
  var FREQ = {
    high: { label: '高频', intervalMin: 10, gapMin: 30 },
    medium: { label: '中频', intervalMin: 120, gapMin: 30 },
    low: { label: '低频', intervalMin: 1440, gapMin: 30 }
  };
  var LS_LAST = 'reverse_check_last_at_';      // + sessionId
  var MAX_OTHER_CHATS = 4;                      // 最多挨个点进几个会话
  var ROUNDS = 10;                              // 每个会话读取最近 10 轮
  var OVERLAY_ID = 'rc-overlay';

  var state = {
    running: false,
    aborted: false,
    sessionId: null,
    charName: '',
    charAvatar: '',
    userAvatar: '',
    timeline: [],
    abortCtrl: null
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function svg(path, size, color) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) + '" fill="none" stroke="' + (color || 'currentColor') +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }
  var ICO = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    hand: '<path d="M9 11V6a2 2 0 1 1 4 0v5"/><path d="M13 11V8a2 2 0 1 1 4 0v6"/><path d="M17 11V9.5a2 2 0 1 1 4 0V15a6 6 0 0 1-6 6h-2a7 7 0 0 1-7-7v-3a2 2 0 1 1 4 0"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5"/>',
    note: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>'
  };

  // ==================== 通用小工具 ====================
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nowStr(ts) {
    var d = new Date(ts || Date.now());
    var p = function (x) { return x < 10 ? '0' + x : '' + x; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function logStep(kind, text) {
    state.timeline.push({ t: Date.now(), kind: kind, text: String(text || '') });
  }
  function myPersonaId() {
    var v = parseInt(localStorage.getItem('active_me_id'), 10);
    return isNaN(v) ? 0 : v;
  }

  // ==================== API（走「专用 → 查手机」预设） ====================
  async function resolveApi() {
    if (window.apiRoutes && typeof window.apiRoutes.resolve === 'function') {
      var p = await window.apiRoutes.resolve('checkphone');
      if (p) return p;
    }
    // 兜底：直接读全局预设
    var id = localStorage.getItem('global_api_preset_id');
    if (!id) return null;
    try { return await db.api_presets.get(Number(id)); } catch (e) { return null; }
  }

  async function callApi(systemPrompt, userPrompt, opts) {
    var api = state.apiPreset || await resolveApi();
    if (!api || !api.url || !api.key) throw new Error('未配置「查手机」API 预设（设置 - API 协议设置）');
    state.apiPreset = api;
    var ctrl = new AbortController();
    state.abortCtrl = ctrl;
    var url = String(api.url).replace(/\/+$/, '');
    if (url.indexOf('/chat/completions') < 0) url += '/chat/completions';
    var body = {
      model: api.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: (opts && opts.temperature != null) ? opts.temperature : 0.85
    };
    if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    state.abortCtrl = null;
    if (!res.ok) throw new Error('API HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
    var j = await res.json();
    var txt = (((j.choices || [])[0] || {}).message || {}).content || '';
    return String(txt).trim();
  }

  /** 从模型输出里抠出 JSON（容忍 ```json 围栏与前后废话） */
  function parseJsonLoose(text) {
    var s = String(text || '').replace(/```json/gi, '```').trim();
    var fence = s.match(/```([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }

  /** JSON 解析失败时的兜底：按字段名从纯文本里抠值（模型偶尔会写成 `reaction: xxx` 这种） */
  function pickField(text, keys) {
    var s = String(text || '');
    var out = null;
    for (var i = 0; i < keys.length && out === null; i++) {
      var k = keys[i];
      // 1) "key": "value"
      var m = s.match(new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'i'));
      if (m) { out = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); break; }
      // 2) key: value / key：value（取到行尾）
      var m2 = s.match(new RegExp('[\\[{,\\s]*' + k + '\\s*[:：]\\s*([^\\n}]+)', 'i'));
      if (m2) { out = m2[1].replace(/^["'\s]+|["',\s]+$/g, '').trim(); break; }
    }
    return out;
  }

  /** 解析角色结构化输出：JSON 优先，失败按字段抠；再兜底行内特殊命令 */
  function readCharOutput(raw, fields) {
    var j = parseJsonLoose(raw) || {};
    var res = {};
    fields.forEach(function (f) {
      var v = j[f];
      if (v === undefined || v === null || v === '') v = pickField(raw, [f]);
      res[f] = (v === undefined || v === null) ? '' : v;
    });
    // 整段没解析出任何字段 → 至少把原文当 reaction
    if (!res.reaction && !res.send && !res.comment) res.reaction = String(raw || '').trim().slice(0, 400);
    return res;
  }

  // ==================== 浮层 UI（自制，禁止原生弹窗） ====================
  function ensureOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:100600;display:none;' +
      'background:rgba(15,23,42,0.06);pointer-events:auto;';
    el.innerHTML =
      // 顶部：谁在偷看 + 抢回手机
      '<div id="rc-topbar" style="position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;' +
        'padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top,0px));' +
        'background:linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.72));color:#fff;">' +
        '<span style="display:flex;align-items:center;gap:6px;color:#fca5a5;flex-shrink:0;">' + svg(ICO.eye, 15, '#fca5a5') + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div id="rc-topbar-title" style="font-size:12.5px;font-weight:800;letter-spacing:0.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>' +
          '<div id="rc-topbar-sub" style="font-size:10px;color:#cbd5e1;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>' +
        '</div>' +
        '<button id="rc-grab-back" style="flex-shrink:0;display:flex;align-items:center;gap:5px;padding:8px 12px;border:none;border-radius:10px;' +
          'background:#ef4444;color:#fff;font-size:11.5px;font-weight:800;cursor:pointer;font-family:inherit;">' +
          svg(ICO.hand, 13, '#fff') + '抢回手机</button>' +
      '</div>' +
      // 左下角半透明气泡
      '<div id="rc-bubble" style="position:absolute;left:14px;bottom:26px;max-width:78%;display:none;' +
        'background:rgba(255,255,255,0.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
        'border:1px solid rgba(148,163,184,0.35);border-radius:14px;padding:10px 12px;' +
        'box-shadow:0 10px 30px rgba(15,23,42,0.16);">' +
        '<div id="rc-bubble-name" style="display:flex;align-items:center;gap:5px;font-size:10px;font-weight:800;color:#1e88e5;margin-bottom:4px;"></div>' +
        '<div id="rc-bubble-text" style="font-size:12px;line-height:1.6;color:#1e293b;white-space:pre-wrap;word-break:break-word;"></div>' +
      '</div>';
    document.body.appendChild(el);
    var btn = el.querySelector('#rc-grab-back');
    btn.onclick = function () {
      state.aborted = true;
      try { if (state.abortCtrl) state.abortCtrl.abort(); } catch (e) {}
      setTopSub('已抢回手机，正在收尾…');
      if (typeof showToast === 'function') showToast('你抢回了手机');
    };
    return el;
  }

  function setTopTitle(t) {
    var el = document.getElementById('rc-topbar-title');
    if (el) el.textContent = t || '';
  }
  function setTopSub(t) {
    var el = document.getElementById('rc-topbar-sub');
    if (el) el.textContent = t || '';
  }
  function showBubble(text, name) {
    var box = document.getElementById('rc-bubble');
    var nameEl = document.getElementById('rc-bubble-name');
    var txtEl = document.getElementById('rc-bubble-text');
    if (!box || !txtEl) return Promise.resolve();
    if (nameEl) nameEl.innerHTML = svg(ICO.chat, 11, '#1e88e5') + '<span>' + esc(name || state.charName) + '</span>';
    txtEl.textContent = String(text || '');
    box.style.display = 'block';
    // 阅读时间：按字数给足时间（3s ~ 12s）
    var dur = Math.max(3000, Math.min(12000, 2200 + String(text || '').length * 95));
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; box.style.display = 'none'; resolve(); }
      var timer = setTimeout(finish, dur);
      box.onclick = function () { clearTimeout(timer); finish(); };
    });
  }

  /** 自制弹窗（不用浏览器原生 confirm） */
  function rcModal(opts) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:100700;display:flex;' +
        'align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(15,23,42,0.46);' +
        'backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
      var btns = (opts.buttons || []).map(function (b, i) {
        var primary = b.primary !== false;
        return '<button data-i="' + i + '" style="flex:1;padding:11px 10px;border-radius:12px;font-size:12.5px;font-weight:800;' +
          'cursor:pointer;font-family:inherit;' + (primary
            ? 'border:none;background:linear-gradient(135deg,#1e88e5,#42a5f5);color:#fff;'
            : 'border:1.5px solid var(--border,#e2e8f0);background:#fff;color:#475569;') + '">' + esc(b.label) + '</button>';
      }).join('');
      overlay.innerHTML =
        '<div style="width:100%;max-width:330px;background:#fff;border-radius:20px;padding:20px;box-sizing:border-box;' +
          'box-shadow:0 24px 60px rgba(15,23,42,0.28);animation:rcPop .18s ease-out;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
            '<span style="display:flex;color:#ef4444;">' + svg(opts.icon || ICO.alert, 18, '#ef4444') + '</span>' +
            '<div style="font-size:15px;font-weight:800;color:#1e293b;">' + esc(opts.title || '') + '</div>' +
          '</div>' +
          (opts.html
            ? '<div style="font-size:12px;line-height:1.7;color:#475569;">' + opts.html + '</div>'
            : '<div style="font-size:12px;line-height:1.7;color:#475569;white-space:pre-wrap;">' + esc(opts.message || '') + '</div>') +
          '<div style="display:flex;gap:8px;margin-top:18px;">' + btns + '</div>' +
        '</div>';
      if (!document.getElementById('rcPopKey')) {
        var st = document.createElement('style');
        st.id = 'rcPopKey';
        st.textContent = '@keyframes rcPop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}';
        document.head.appendChild(st);
      }
      document.body.appendChild(overlay);
      overlay.querySelectorAll('button[data-i]').forEach(function (b) {
        b.onclick = function () {
          var idx = Number(b.getAttribute('data-i'));
          overlay.remove();
          resolve((opts.buttons[idx] || {}).value);
        };
      });
    });
  }

  // ==================== 跳页辅助 ====================
  async function gotoChatList() {
    if (typeof openApp === 'function') openApp('chat');
    await sleep(200);
    // 关键 1：用户是从「聊天详情」点立刻触发的，详情面板是独立覆盖层（z-index 400），
    // 不关掉它会一直压在会话列表上面 → 看起来"卡在详情页"。
    var details = document.getElementById('chat-details-panel');
    if (details && details.classList.contains('active') && typeof closeChatDetails === 'function') {
      try { closeChatDetails(); } catch (e) {}
      await sleep(180);
    }
    // 关键 2：用户很可能正停在某个对话里，此时会话列表被 #chat-dialog-panel 挡着，
    // 不退出对话页就等于"没跳转"。先关掉对话页，再确保停在「微信」页签。
    var panel = document.getElementById('chat-dialog-panel');
    if (panel && panel.classList.contains('active') && typeof closeChatDialog === 'function') {
      try { closeChatDialog(); } catch (e) {}
      await sleep(200);
    }
    var tabBtn = document.querySelector('.tab-item[data-chat-tab="sessions"]');
    if (tabBtn && !tabBtn.classList.contains('active')) {
      try { tabBtn.click(); } catch (e) {}
    }
    if (typeof renderChatTab === 'function') { try { await renderChatTab(); } catch (e) {} }
    else if (typeof renderSessionList === 'function') { try { await renderSessionList(); } catch (e) {} }
    await sleep(240);
  }

  /** 反查谁，就临时切到那个人设：否则界面停在人设 B，翻的是人设 A 的手机，看着像没反应 */
  async function ensurePersonaFor(sess) {
    try {
      var cur = Number(localStorage.getItem('active_me_id') || 0);
      if (!sess || Number(sess.userId) === cur) return 0;
      localStorage.setItem('active_me_id', String(sess.userId));
      if (typeof loadMyPersonas === 'function') { try { await loadMyPersonas(); } catch (e) {} }
      if (typeof renderChatTab === 'function') { try { await renderChatTab(); } catch (e) {} }
      await sleep(260);
      return cur || 0;
    } catch (e) { return 0; }
  }

  async function restorePersona(prev) {
    if (!prev) return;
    try {
      localStorage.setItem('active_me_id', String(prev));
      if (typeof loadMyPersonas === 'function') { try { await loadMyPersonas(); } catch (e) {} }
      if (typeof renderChatTab === 'function') { try { await renderChatTab(); } catch (e) {} }
    } catch (e) {}
  }
  async function gotoShoppingCart() {
    if (typeof openApp === 'function') openApp('shopping');
    await sleep(420);
    if (window.shoppingSystem && typeof window.shoppingSystem.switchTab === 'function') {
      window.shoppingSystem.switchTab('cart');
    }
    await sleep(420);
  }

  // ==================== 数据读取 ====================
  async function loadSession(sessionId) {
    try { return await db.sessions.get(Number(sessionId)); } catch (e) { return null; }
  }
  async function loadCharInfo(sess) {
    var out = { name: '对方', persona: '', avatar: '' };
    if (!sess) return out;
    try {
      var char = await db.archives.get(Number(sess.charId));
      out.name = sess.customCharName || (char && char.name) || '对方';
      out.persona = sess.customCharPersona || (char && char.persona) || '';
      out.avatar = sess.customCharAvatar || (char && char.avatar) || '';
    } catch (e) {}
    return out;
  }
  async function otherSessions(sess) {
    try {
      var all = await db.sessions.where('userId').equals(Number(sess.userId)).toArray();
      return all.filter(function (s) {
        return s.id !== sess.id && s.isGroup !== 1 && s.charId !== sess.charId;
      });
    } catch (e) { return []; }
  }
  async function recentMessages(sessionId, limit) {
    try {
      var arr = await db.messages.where('sessionId').equals(Number(sessionId)).reverse().limit(limit || 20).toArray();
      arr.reverse();
      return arr;
    } catch (e) { return []; }
  }
  function renderMsgLine(m, charName, userName) {
    if (m.isRecalled) return '[撤回了一条消息]';
    var who = m.senderType === 'user' ? (userName || '我') : (m.senderType === 'char' ? (charName || '对方') : '系统');
    var c = m.content;
    try {
      if (m.contentType === 'image') { var d = JSON.parse(c); return who + '：[图片]' + (d.text ? '（' + d.text + '）' : ''); }
      if (m.contentType === 'voice') { var v = JSON.parse(c); return who + '：[语音]' + (v.text || ''); }
      if (m.contentType === 'transfer') { var t = JSON.parse(c); return who + '：[转账 ¥' + t.amount + ']'; }
      if (m.contentType === 'red_envelope') { return who + '：[红包]'; }
      if (m.contentType === 'share') { var s = JSON.parse(c); return who + '：[分享]' + (s.title || ''); }
      if (m.contentType === 'reverse_check_report') return who + '：[反查手机报告]';
    } catch (e) {}
    return who + '：' + String(c || '').slice(0, 200);
  }
  async function readCart() {
    try {
      var pid = myPersonaId();
      var list = await db.shopping_cart.where('userId').equals(pid).toArray();
      return list || [];
    } catch (e) { return []; }
  }

  // ==================== 角色提示词 ====================
  async function baseSystem(char, sess, userName, relationshipText) {
    return [
      '你现在扮演「' + char.name + '」。',
      char.persona ? '你的人设：' + String(char.persona).slice(0, 1200) : '',
      relationshipText ? relationshipText : '',
      '你是「' + userName + '」的恋人/暧昧对象，此刻你偷偷拿到了 ta 的手机，正在翻看。',
      '你翻手机的唯一目的：确认 ta 有没有跟别人暧昧、有没有瞒着你做事。',
      '语气必须符合人设、口语化、有情绪（可以吃醋、阴阳、冷笑、气急败坏、也可能满意）。',
      '严禁输出任何解释性前言后语，只输出要求的 JSON。'
    ].filter(Boolean).join('\n');
  }

  /** 取「主角色 ↔ user」的双视角关系描述（关系网），失败返回空串 */
  async function relationshipFor(sess, char, userName) {
    try {
      if (typeof queryRelationship !== 'function') return '';
      var t = await queryRelationship(Number(sess.userId), Number(sess.charId), userName, char.name);
      return String(t || '').slice(0, 800);
    } catch (e) { return ''; }
  }

  // ==================== 主流程 ====================
  async function runReverseCheck(sessionId) {
    if (state.running) return;
    // 用户点完弹窗就立刻离开详情页/对话页：不要让人盯着聊天详情发呆（真机反馈的"卡住"）
    try {
      if (typeof openApp === 'function') openApp('chat');
      var dPanel = document.getElementById('chat-details-panel');
      if (dPanel && dPanel.classList.contains('active') && typeof closeChatDetails === 'function') closeChatDetails();
      var cPanel = document.getElementById('chat-dialog-panel');
      if (cPanel && cPanel.classList.contains('active') && typeof closeChatDialog === 'function') closeChatDialog();
    } catch (e) {}

    var sess = await loadSession(sessionId);
    if (!sess) { if (typeof showToast === 'function') showToast('找不到该会话'); return; }

    var char = await loadCharInfo(sess);
    var userName = '';
    try { var u = await db.archives.get(Number(sess.userId)); userName = sess.customUserName || (u && u.name) || '我'; } catch (e) { userName = '我'; }
    var relText = await relationshipFor(sess, char, userName);
    var sysPrompt = await baseSystem(char, sess, userName, relText);
    // 反查谁就临时切到那个人设（人设 A 的角色在被切到人设 B 后照样能被翻）
    var prevPersona = await ensurePersonaFor(sess);
    var personaRestored = false;

    state.running = true;
    state.aborted = false;
    state.sessionId = Number(sessionId);
    state.charName = char.name;
    state.charAvatar = char.avatar;
    state.timeline = [];
    state.apiPreset = null;

    var overlay = ensureOverlay();
    overlay.style.display = 'block';
    setTopTitle(char.name + ' 正在翻你的手机');
    setTopSub('你可以随时抢回手机');
    logStep('start', char.name + ' 拿起了你的手机');

    var finished = false;
    try {
      // ---------- 第一站：聊天对话列表 ----------
      setTopSub('正在打开微信…');
      await gotoChatList();
      if (state.aborted) throw new Error('aborted');
      var others = await otherSessions(sess);
      logStep('open', '点开了微信的对话列表');

      var rosterLines = [];
      for (var i = 0; i < others.length && i < 8; i++) {
        var o = others[i];
        var oc = await loadCharInfo(o);
        var last = await recentMessages(o.id, 1);
        rosterLines.push('- ' + oc.name +
          (oc.persona ? '（ta 的人设/与你的关系：' + String(oc.persona).replace(/\s+/g, ' ').slice(0, 90) + '）' : '') +
          '：' + (last.length ? renderMsgLine(last[0], oc.name, userName).slice(0, 60) : '（还没有聊天记录）'));
      }
      var p1 = await callApi(
        sysPrompt,
        '【你在对话列表页看到的内容】\n' +
        (rosterLines.length ? rosterLines.join('\n') : '（除了你自己，ta 没有别的聊天对象）') +
        '\n\n请以' + char.name + '的口吻，说出你此刻的第一反应（约 200 字，像心里嘀咕/自言自语，别写成小说旁白）。\n' +
        '只输出 JSON：{"reaction":"你的反应"}',
        { maxTokens: 900 }
      );
      var j1 = readCharOutput(p1, ['reaction']);
      logStep('read', '看了对话列表：' + String(j1.reaction || '').slice(0, 60));
      await showBubble(j1.reaction || '……', char.name);
      if (state.aborted) throw new Error('aborted');

      // ---------- 第二站：逐个点进其他会话 ----------
      var visited = 0;
      for (var k = 0; k < others.length && visited < MAX_OTHER_CHATS; k++) {
        if (state.aborted) break;
        var os = others[k];
        var oc2 = await loadCharInfo(os);
        var msgs = await recentMessages(os.id, ROUNDS * 2);
        if (!msgs.length) continue;
        visited++;

        setTopSub('正在翻看你和 ' + oc2.name + ' 的聊天');
        if (typeof openWeChatDialog === 'function') { try { await openWeChatDialog(os.id); } catch (e) {} }
        await sleep(520);
        logStep('open', '点开了你和 ' + oc2.name + ' 的聊天');
        if (state.aborted) throw new Error('aborted');

        var convo = msgs.map(function (m) { return renderMsgLine(m, oc2.name, userName); }).join('\n');
        var p2 = await callApi(
          sysPrompt,
          '【你正在翻看 ta 和「' + oc2.name + '」的最近对话】\n' + convo +
          (oc2.persona ? '\n\n【关于「' + oc2.name + '」的设定（含 ta 和你/和我的关系）】' + String(oc2.persona).replace(/\s+/g, ' ').slice(0, 500) : '') +
          '\n\n请判断这段对话里 ta 和「' + oc2.name + '」的关系与可疑程度（务必结合上面的关系设定），并决定要不要用 ta 的手机发一句话过去。\n' +
          '要求：\n' +
          '1) reaction：你看到这段对话后的反应（80-160 字，口语化，符合人设，要体现出你知道' + oc2.name + '是谁）；\n' +
          '2) send：用 ta 的手机发出去的消息内容（要像 ta 本人平时说话的语气）。只要这段对话有任何值得试探/敲打的地方就必须发；只有完全无话可说才留空字符串；\n' +
          '   发什么由你的性格和当前情绪决定，可以是：试探、阴阳、冷嘲、突然亲昵、约见面、故意找茬、假装顺路、装作 ta 的口吻敷衍；\n' +
          '3) reason：一句话说明你为什么发/不发。\n' +
          '只输出 JSON：{"reaction":"...","send":"...","reason":"..."}',
          { maxTokens: 900 }
        );
        var j2 = readCharOutput(p2, ['reaction', 'send', 'reason']);
        logStep('read', '翻看了你和 ' + oc2.name + ' 的聊天：' + String(j2.reason || '').slice(0, 50));
        await showBubble(j2.reaction || '……', char.name);
        if (state.aborted) throw new Error('aborted');

        var sendText = String(j2.send || '').trim();
        if (!sendText) {
          // 模型没给 send 时，再从 reaction 里找行内命令（兼容"要发就发…"这类写法）
          var mSend = String(j2.reaction || '').match(/\[\s*(?:发送|代发|SEND)\s*[:：]\s*([^\]]{1,80})\s*\]/i);
          if (mSend) sendText = mSend[1].trim();
        }
        logStep('think', sendText ? (char.name + ' 决定用你的手机给 ' + oc2.name + ' 发一条消息') : (char.name + ' 想了想，没给 ' + oc2.name + ' 发消息'));
        if (sendText) {
          // 角色代 user 发消息：写进输入框 → 触发发送 → 等对方回复
          var inp = document.getElementById('dialog-input-text');
          var sendBtn = document.getElementById('btn-dialog-send');
          if (inp && sendBtn) {
            inp.value = sendText;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(160);
            sendBtn.click();
            logStep('send', '用你的手机给 ' + oc2.name + ' 发了：' + sendText.slice(0, 60));
            await sleep(700);
            if (state.aborted) throw new Error('aborted');
            // 触发对方回复
            var before = Date.now();
            var replyBtn = document.getElementById('btn-dialog-reply');
            if (replyBtn) {
              replyBtn.click();
              var got = await waitForCharReply(os.id, before, 120000);
              if (got) {
                logStep('reply', oc2.name + ' 回了：' + String(got.content || '').slice(0, 60));
                // 40% 概率继续对线一轮
                if (!state.aborted && Math.random() < 0.4) {
                  var p2b = await callApi(
                    sysPrompt,
                    '【对方回了你一句】' + oc2.name + '：' + String(got.content || '').slice(0, 200) +
                    '\n\n你是' + char.name + '，正拿着 ta 的手机。现在轮到你决定下一步——真实的人这时候反应五花八门，请挑一个符合你性格和当前情绪的：\n' +
                    '· 继续伪装成 ta 敷衍/圆谎/转移话题；\n' +
                    '· 忍不住阴阳或敲打对方；\n' +
                    '· 被问得烦了，索性摊牌表明自己是' + char.name + '；\n' +
                    '· 发一句整蛊/恶作剧的消息（比如乱说 ta 的糗事、瞎编行程）；\n' +
                    '· 或者直接不回了（send 留空）。\n' +
                    '同时判断对方有没有察觉到不对劲（真人的察觉往往是模糊的：可能只是"你今天说话怪怪的"，也可能完全没发现）。\n' +
                    '只输出 JSON：{"notice":"对方是否察觉(是/否)+一句依据","reaction":"你的内心反应(30-80字)","send":"要继续发的话(不想继续就空字符串)"}',
                    { maxTokens: 700 }
                  );
                  var j2b = readCharOutput(p2b, ['notice', 'reaction', 'send']);
                  if (j2b.notice) logStep('reply', oc2.name + ' 的反应：' + String(j2b.notice).slice(0, 50));
                  if (j2b.reaction) await showBubble(j2b.reaction, char.name);
                  var send2 = String(j2b.send || '').trim();
                  if (send2 && !state.aborted) {
                    inp = document.getElementById('dialog-input-text');
                    sendBtn = document.getElementById('btn-dialog-send');
                    if (inp && sendBtn) {
                      inp.value = send2;
                      inp.dispatchEvent(new Event('input', { bubbles: true }));
                      await sleep(160);
                      sendBtn.click();
                      logStep('send', '又补了一句给 ' + oc2.name + '：' + send2.slice(0, 60));
                      await sleep(700);
                      var before2 = Date.now();
                      if (replyBtn) {
                        replyBtn.click();
                        var got2 = await waitForCharReply(os.id, before2, 90000);
                        if (got2) logStep('reply', oc2.name + ' 又回：' + String(got2.content || '').slice(0, 50));
                      }
                    }
                  } else if (!state.aborted) {
                    logStep('think', char.name + ' 决定不再回复 ' + oc2.name + '');
                  }
                }
              }
            }
          }
        }
        if (state.aborted) throw new Error('aborted');
      }

      // ---------- 第三站：购物车 ----------
      setTopSub('正在打开购物车…');
      await gotoShoppingCart();
      if (state.aborted) throw new Error('aborted');
      var cart = await readCart();
      logStep('open', '点开了购物车');
      var cartText = cart.length
        ? cart.map(function (it) { return '- ' + (it.name || '商品') + ' × ' + (it.quantity || 1) + '（¥' + Number(it.price || 0).toFixed(2) + '）' + (it.storeName ? ' 来自 ' + it.storeName : ''); }).join('\n')
        : '（购物车是空的）';
      var p3 = await callApi(
        sysPrompt,
        '【你正在看 ta 的购物车】\n' + cartText +
        '\n\n请以' + char.name + '的口吻做出反应（60-140 字，口语化）。\n' +
        '另外，如果你一时心软想给 ta 打点钱（比如看到 ta 想买的东西舍不得买），把金额填进 money（人民币，0 表示不打钱，最多 2000）；也可以在 reaction 里直接写 [打钱:金额] 这种特殊命令。\n' +
        '只输出 JSON：{"reaction":"...","money":0}',
        { maxTokens: 700 }
      );
      var j3 = readCharOutput(p3, ['reaction', 'money']);
      var money = Number(j3.money || 0);
      // 兼容模型把「打钱」写成行内特殊命令： [打钱:52] / [打钱 52] / [MONEY:52] / [转账:52]
      if (!(money > 0)) {
        var mCmd = String(j3.reaction || '').match(/\[\s*(?:打钱|转账|MONEY|TRANSFER)\s*[:：]?\s*¥?\s*(\d+(?:\.\d+)?)\s*\]/i);
        if (mCmd) money = Number(mCmd[1]);
      }
      var cleanReaction = String(j3.reaction || '……').replace(/\[\s*(?:打钱|转账|MONEY|TRANSFER)\s*[:：]?\s*¥?\s*(\d+(?:\.\d+)?)\s*\]/gi, '').trim();
      await showBubble(cleanReaction || '……', char.name);
      if (money > 0) {
        money = Math.min(2000, Math.round(money * 100) / 100);
        try {
          var bal = (typeof window.getWalletBalance === 'function') ? window.getWalletBalance() : 0;
          if (typeof window.setWalletBalance === 'function') window.setWalletBalance(bal + money);
          if (typeof window.addLedgerEntry === 'function') window.addLedgerEntry('反查手机·' + char.name + '偷偷给你打钱', money, 'income');
          logStep('money', '悄悄给你转了 ¥' + money.toFixed(2) + '（已进余额与账单）');
          await showBubble('（手机又震了一下，余额多了 ¥' + money.toFixed(2) + '）', char.name);
        } catch (e) { console.warn('[反查手机] 打钱失败', e); }
      }
      if (state.aborted) throw new Error('aborted');

      // ---------- 结束：感想卡片 + 报告消息 ----------
      setTopSub('正在收尾…');
      var p4 = await callApi(
        sysPrompt,
        '【本次翻手机你做过的事】\n' +
        state.timeline.map(function (t) { return nowStr(t.t) + ' ' + t.text; }).join('\n') +
        '\n\n请给出你对这次翻手机的总体感想（80-160 字，口语化，可以满意/吃醋/气急败坏/心软）。\n' +
        '只输出 JSON：{"mood":"两到四个字的情绪标签","comment":"你的感想"}',
        { maxTokens: 700 }
      );
      var j4 = readCharOutput(p4, ['mood', 'comment']); if (!j4.mood) j4.mood = '复杂';
      logStep('end', '把手机放回了原处');
      finished = true;

      // 回到与 ta 的会话，发报告卡片（必须先切回微信 App，否则报告会落在购物页背后看不见）
      if (typeof openApp === 'function') openApp('chat');
      await sleep(320);
      if (typeof openWeChatDialog === 'function') { try { await openWeChatDialog(sessionId); } catch (e) {} }
      await sleep(360);
      var report = {
        charName: char.name,
        mood: String(j4.mood || '复杂').slice(0, 12),
        comment: String(j4.comment || '').slice(0, 600),
        timeline: state.timeline.slice(0, 60),
        startedAt: state.timeline.length ? state.timeline[0].t : Date.now(),
        endedAt: Date.now()
      };
      if (typeof saveAndRenderMessage === 'function') {
        await saveAndRenderMessage('char', JSON.stringify(report), 'reverse_check_report', sessionId);
      }
      try { localStorage.setItem(LS_LAST + sessionId, String(Date.now())); } catch (e) {}

      overlay.style.display = 'none';
      await rcModal({
        title: char.name + ' 把手机放回去了',
        icon: ICO.note,
        html: '<div style="font-size:13px;font-weight:800;color:#1e88e5;margin-bottom:6px;">' + esc(report.mood) + '</div>' +
              '<div style="white-space:pre-wrap;">' + esc(report.comment) + '</div>' +
              '<div style="margin-top:12px;font-size:11px;color:#94a3b8;">聊天里已留下一条「反查手机报告」，点开可以看 ta 的动线。</div>',
        buttons: [{ label: '知道了', value: 'ok', primary: true }]
      });
      // 感想卡片看完后，把人设切回用户原来的那个
      await restorePersona(prevPersona);
      personaRestored = true;
    } catch (e) {
      overlay.style.display = 'none';
      if (state.aborted || (e && e.name === 'AbortError')) {
        try { localStorage.setItem(LS_LAST + sessionId, String(Date.now())); } catch (e2) {}
        if (typeof showToast === 'function') showToast('已抢回手机，反查中断');
      } else {
        console.warn('[反查手机] 失败:', e);
        await rcModal({
          title: '反查手机中断',
          message: (e && e.message) ? e.message : String(e),
          buttons: [{ label: '知道了', value: 'ok', primary: true }]
        });
      }
    } finally {
      if (!personaRestored) { try { await restorePersona(prevPersona); } catch (e) {} }
      state.running = false;
      state.aborted = false;
      state.abortCtrl = null;
      if (!finished) { try { localStorage.setItem(LS_LAST + sessionId, String(Date.now())); } catch (e) {} }
    }
  }

  /** 等待对方（char）产生新消息 */
  async function waitForCharReply(sessionId, sinceTs, timeoutMs) {
    var t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (state.aborted) return null;
      await sleep(700);
      try {
        var arr = await db.messages.where('sessionId').equals(Number(sessionId)).reverse().limit(4).toArray();
        for (var i = 0; i < arr.length; i++) {
          var m = arr[i];
          if (m.senderType === 'char' && m.timestamp >= sinceTs - 1500) return m;
        }
      } catch (e) {}
    }
    return null;
  }

  // ==================== 触发入口（含偷看确认弹窗） ====================
  var asking = false; // 防重入：确认弹窗未答复时，调度器的下一个 tick 不应再叠一个弹窗
  async function askAndStart(sessionId) {
    if (state.running || asking) { if (typeof showToast === 'function') showToast('反查手机正在进行中'); return; }
    asking = true;
    try {
      var sess = await loadSession(sessionId);
      if (!sess) return;
      var char = await loadCharInfo(sess);

      var answer = await rcModal({
        title: char.name + ' 正在偷看',
        icon: ICO.eye,
        html: '你发现 <b>' + esc(char.name) + '</b> 正拿着你的手机翻看。<br>是否同意？',
        buttons: [
          { label: '好吧', value: 'agree', primary: true },
          { label: '抗议', value: 'refuse', primary: false }
        ]
      });
      if (answer === 'agree') { await runReverseCheck(sessionId); return; }
      if (answer !== 'refuse') return;

      // 抗议 → 60% 触发「抗议无效」
      if (Math.random() < 0.6) {
        await rcModal({
          title: '抗议无效',
          icon: ICO.alert,
          html: esc(char.name) + ' 头也不抬地把手机往身后一藏：<br>「抗议无效。」',
          buttons: [{ label: '……', value: 'ok', primary: true }]
        });
        await runReverseCheck(sessionId);
        return;
      }
      // 40%：抗议成功
      await rcModal({
        title: '抗议成功',
        icon: ICO.hand,
        html: esc(char.name) + ' 撇撇嘴，把手机塞回你手里。',
        buttons: [{ label: '好', value: 'ok', primary: true }]
      });
      logStep('end', '你抗议成功，ta 把手机还了回来');
    } finally {
      asking = false;
    }
  }

  // ==================== 调度器（高频/中频/低频） ====================
  async function checkSchedule() {
    if (state.running) return;
    var all = [];
    try { all = await db.sessions.toArray(); } catch (e) { return; }
    var now = Date.now();
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (s.reverseCheckEnabled !== 1) continue;
      var f = FREQ[s.reverseCheckFrequency] || FREQ.medium;
      var lastRun = parseInt(localStorage.getItem(LS_LAST + s.id) || '0', 10) || 0;
      var lastTickKey = 'reverse_check_tick_' + s.id;
      var lastTick = parseInt(localStorage.getItem(lastTickKey) || '0', 10) || 0;
      // 每 intervalMin 检查一次；距上次实际查手机不足 gapMin 则跳过
      if (now - lastTick < f.intervalMin * 60 * 1000) continue;
      try { localStorage.setItem(lastTickKey, String(now)); } catch (e) {}
      if (lastRun && (now - lastRun) < f.gapMin * 60 * 1000) continue;
      // 命中 → 弹窗确认（用户可以在弹窗里同意/抗议）
      await askAndStart(s.id);
      return; // 一次只跑一个
    }
  }

  // ==================== 报告卡片（聊天里渲染） ====================
  function buildReportCardHTML(msgId, data) {
    var d = data || {};
    var mood = esc(d.mood || '');
    var comment = esc(String(d.comment || '').slice(0, 200));
    var count = (d.timeline || []).length;
    return '' +
      '<div class="rc-report-card" data-report-id="' + msgId + '" onclick="window.reverseCheckSystem.openTimeline(' + msgId + ')" ' +
        'style="position:relative;cursor:pointer;width:100%;max-width:262px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="display:flex;align-items:center;gap:7px;padding:9px 11px;background:linear-gradient(135deg,rgba(30,136,229,0.10),rgba(239,68,68,0.10));">' +
          '<span style="display:flex;color:#1e88e5;flex-shrink:0;">' + svg(ICO.eye, 15, '#1e88e5') + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:12px;font-weight:800;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">反查手机报告</div>' +
            '<div style="font-size:10px;color:#64748b;margin-top:1px;">' + esc(d.charName || '') + ' · ' + (count ? count + ' 条动线' : '无动线') + '</div>' +
          '</div>' +
          (mood ? '<span style="flex-shrink:0;font-size:10px;font-weight:800;color:#ef4444;background:rgba(239,68,68,0.10);padding:2px 7px;border-radius:6px;">' + mood + '</span>' : '') +
        '</div>' +
        (comment ? '<div style="padding:8px 11px;font-size:11px;line-height:1.6;color:#475569;">' + comment + '</div>' : '') +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 11px;border-top:1px dashed var(--border);font-size:10px;color:#576b95;font-weight:700;">' +
          '<span>查看 ta 的动线</span>' +
          '<span style="display:flex;color:#94a3b8;">' + svg('<path d="M9 18l6-6-6-6"/>', 12, '#94a3b8') + '</span>' +
        '</div>' +
      '</div>';
  }

  /** 动线时间轴弹窗（自制卡片，禁止原生弹窗） */
  function openTimeline(msgId) {
    db.messages.get(Number(msgId)).then(function (m) {
      if (!m) return;
      var d = {};
      try { d = JSON.parse(m.content); } catch (e) { return; }
      var items = (d.timeline || []);
      var kindIco = { open: ICO.chat, read: ICO.eye, send: ICO.chat, money: ICO.coin, start: ICO.hand, end: ICO.note, reply: ICO.chat };
      var kindColor = { open: '#1e88e5', read: '#0288d1', send: '#16a34a', money: '#f59e0b', start: '#ef4444', end: '#64748b', reply: '#1565c0' };
      var rows = items.map(function (t, i) {
        var c = kindColor[t.kind] || '#64748b';
        return '' +
          '<div style="display:flex;gap:10px;position:relative;padding-bottom:14px;">' +
            (i < items.length - 1 ? '<div style="position:absolute;left:9px;top:20px;bottom:0;width:1.5px;background:linear-gradient(180deg,' + c + '55,transparent);"></div>' : '') +
            '<div style="width:19px;height:19px;border-radius:50%;background:' + c + '18;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">' +
              svg(kindIco[t.kind] || ICO.note, 11, c) +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:10px;color:#94a3b8;font-weight:700;">' + nowStr(t.t) + '</div>' +
              '<div style="font-size:11.5px;color:#334155;line-height:1.55;word-break:break-word;">' + esc(t.text) + '</div>' +
            '</div>' +
          '</div>';
      }).join('');
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:100800;display:flex;align-items:flex-end;' +
        'justify-content:center;background:rgba(15,23,42,0.46);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
      overlay.innerHTML =
        '<div style="width:100%;max-width:420px;max-height:82vh;background:#fff;border-radius:20px 20px 0 0;padding:18px 18px 26px;box-sizing:border-box;overflow-y:auto;animation:rcUp .22s ease-out;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<span style="display:flex;color:#1e88e5;">' + svg(ICO.eye, 17, '#1e88e5') + '</span>' +
            '<div style="flex:1;font-size:15px;font-weight:800;color:#1e293b;">' + esc(d.charName || '') + ' 的动线</div>' +
            '<button id="rc-tl-close" style="border:none;background:#f1f5f9;border-radius:9px;padding:6px 10px;font-size:11px;font-weight:700;color:#64748b;cursor:pointer;font-family:inherit;">关闭</button>' +
          '</div>' +
          '<div style="font-size:11px;color:#94a3b8;margin-bottom:14px;">' +
            (d.startedAt ? nowStr(d.startedAt) : '') + (d.endedAt ? ' — ' + nowStr(d.endedAt) : '') + ' · 共 ' + items.length + ' 条' +
          '</div>' +
          (d.comment ? '<div style="background:rgba(30,136,229,0.06);border:1px solid rgba(30,136,229,0.16);border-radius:12px;padding:11px 12px;margin-bottom:16px;">' +
            '<div style="font-size:10px;font-weight:800;color:#1e88e5;margin-bottom:4px;">' + esc(d.mood || '') + '</div>' +
            '<div style="font-size:11.5px;line-height:1.65;color:#334155;white-space:pre-wrap;">' + esc(d.comment) + '</div></div>' : '') +
          (items.length ? rows : '<div style="font-size:11px;color:#94a3b8;">（没有记录到动线）</div>') +
        '</div>';
      if (!document.getElementById('rcUpKey')) {
        var st = document.createElement('style');
        st.id = 'rcUpKey';
        st.textContent = '@keyframes rcUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}';
        document.head.appendChild(st);
      }
      document.body.appendChild(overlay);
      overlay.querySelector('#rc-tl-close').onclick = function () { overlay.remove(); };
      overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    });
  }

  // ==================== 聊天详情里的开关 ====================
  var selectedFreq = 'medium';
  var FREQ_DESC = {
    high: '高频：每 10 分钟检查一次，距上次翻手机超过 30 分钟就自动触发。',
    medium: '中频：每 2 小时检查一次，距上次翻手机超过 30 分钟就自动触发。',
    low: '低频：每 24 小时检查一次，距上次翻手机超过 30 分钟就自动触发。'
  };

  function setSelectedFreq(freq) {
    selectedFreq = FREQ[freq] ? freq : 'medium';
    document.querySelectorAll('.rc-freq-btn').forEach(function (b) {
      var on = b.getAttribute('data-freq') === selectedFreq;
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-outline', !on);
    });
    var desc = document.getElementById('rc-freq-desc');
    if (desc) desc.textContent = FREQ_DESC[selectedFreq];
  }
  function getSelectedFreq() { return selectedFreq; }

  function bindDetailControls() {
    var toggle = document.getElementById('details-reverse-check-toggle');
    if (!toggle || toggle._rcBound) return;
    toggle._rcBound = true;
    toggle.onchange = function () {
      var box = document.getElementById('details-reverse-check-freq');
      if (box) box.style.display = toggle.checked ? 'block' : 'none';
    };
    document.querySelectorAll('.rc-freq-btn').forEach(function (b) {
      b.onclick = function () { setSelectedFreq(b.getAttribute('data-freq')); };
    });
    setSelectedFreq(selectedFreq);
    var btn = document.getElementById('btn-reverse-check-now');
    if (btn) {
      btn.onclick = function () {
        var sid = (typeof activeSessionId !== 'undefined' && activeSessionId) ? activeSessionId : null;
        if (!sid) { if (typeof showToast === 'function') showToast('请先进入一个对话'); return; }
        askAndStart(sid);
      };
    }
  }

  // ==================== 突然发起查手机（[CHECK_PHONE] 指令） ====================
  // 与 [AUTO_CALL] 同源思路：开关打开后，char 可以在回复末尾单独打一行指令，
  // 系统随即弹出「TA 正拿着你的手机」确认卡（复用 askAndStart，用户仍可否决）。
  async function buildAutoCheckPhonePromptSegment(sessionId) {
    try {
      var sess = await db.sessions.get(Number(sessionId));
      if (!sess || sess.allowCharAutoCheckPhone !== 1) return "";
      if (state.running) return "";
      var recent = await db.messages.where('sessionId').equals(Number(sessionId)).reverse().limit(1).toArray();
      // 刚查过就别追着查，避免刷屏
      if (recent.length > 0 && recent[0].contentType === 'reverse_check_report') return "";
      return [
        '【突然查手机特权】',
        '你现在被允许在聊天中**突然发起一次「查对方手机」**的请求。适用时机：你起了疑心、吃醋、想问清楚某件事、或者只是忍不住想看看对方最近在跟谁说话。',
        '发起方式：在你回复的最后一行单独占一行输出指令：',
        '- 指令格式：[CHECK_PHONE]{"reason":"你这次想看手机的原因，12字以内"}',
        '输出指令后，系统会向对方弹出「你发现 TA 正拿着你的手机翻看」的确认卡，对方可以同意，也可以抗议（有概率抗议成功）。',
        '注意：',
        '1. 这是**请求**而不是结果，不要在台词里提前宣告"我看到你手机里有什么"。',
        '2. 用得要克制：只在你真的起了疑心或被触动的当口用，不要每次回复都发。',
        '3. [CHECK_PHONE] 不是 MCP 工具，不要试图用任何工具去读对方的手机。',
        '4. 其余正常对白照常输出，指令行不会展示给对方看。'
      ].join('\n');
    } catch (e) { return ""; }
  }

  // 从 char 回复里检测 [CHECK_PHONE]{...}，弹出确认卡并清洗掉指令文本
  function detectAndTriggerCheckPhone(text, sessionId) {
    if (!text) return text;
    var idx = text.indexOf('[CHECK_PHONE]');
    if (idx === -1) return text;
    var after = text.substring(idx + '[CHECK_PHONE]'.length);
    var jsonStart = after.indexOf('{');
    var reason = '';
    var cutEnd = idx + '[CHECK_PHONE]'.length;
    if (jsonStart !== -1) {
      // 用括号平衡法提取 JSON（与其它指令一致，容忍内容里有括号）
      var depth = 0, inStr = false, esc = false, end = -1;
      for (var i = jsonStart; i < after.length; i++) {
        var ch = after[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        try { reason = (JSON.parse(after.substring(jsonStart, end + 1)) || {}).reason || ''; } catch (e) {}
        cutEnd = idx + '[CHECK_PHONE]'.length + end + 1;
      }
    }
    var cleaned = (text.substring(0, idx) + text.substring(cutEnd)).replace(/\n{3,}/g, '\n\n').trim();

    // 指令被系统捕获，但用户随时可以拒绝
    setTimeout(function () {
      try {
        if (state.running || asking) return;
        if (typeof showToast === 'function' && reason) {
          showToast('TA 想知道：' + String(reason).slice(0, 20));
        }
        askAndStart(Number(sessionId));
      } catch (e) { console.warn('[查手机] 触发失败', e); }
    }, 700);
    return cleaned;
  }

  // ==================== 对外接口 ====================
  window.reverseCheckSystem = {
    FREQ: FREQ,
    run: runReverseCheck,
    askAndStart: askAndStart,
    buildReportCardHTML: buildReportCardHTML,
    openTimeline: openTimeline,
    bindDetailControls: bindDetailControls,
    getSelectedFreq: getSelectedFreq,
    setSelectedFreq: setSelectedFreq,
    isRunning: function () { return state.running; },
    buildAutoCheckPhonePromptSegment: buildAutoCheckPhonePromptSegment,
    detectAndTriggerCheckPhone: detectAndTriggerCheckPhone,
    _readCharOutput: readCharOutput,
    _parseJsonLoose: parseJsonLoose,
    _state: state
  };

  // 调度器：每分钟扫一次（沿用桌宠调度器的写法）
  if (!window.__reverseCheckScheduler) {
    window.__reverseCheckScheduler = setInterval(function () {
      try { checkSchedule(); } catch (e) {}
    }, 60000);
  }

  // 聊天详情面板打开时补绑控件（面板是静态 DOM，初始化时绑一次即可）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDetailControls);
  } else {
    bindDetailControls();
  }
})();
