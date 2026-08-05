/**
 * ============================================================
 * app_chat_call.js - 叙事诗小手机：语音/视频通话模块
 * ------------------------------------------------------------
 * 职责：
 *   1. 仿微信全屏通话页面（动态注入 DOM 到 body，层级最高）；
 *   2. 通话中可打字上屏，对方返回回复，回复下方可点按播放 TTS 语音；
 *   3. 通话内容计入上下文（存为 contentType='text' + callId 标记，但不上屏）；
 *   4. 通话前清洗线上文本的标签，回到线上时清洗通话残留标签；
 *   5. 通话结束生成系统通知样式卡片（contentType='call'），仅显示"语音通话已结束-展开"，
 *      点击展开弹出卡片查看通话记录并反复播放语音（3 天缓存）；
 *   6. 对话详情开关：char 可主动发起通话（注入 prompt + 指令检测）；
 *   7. char 主动发起通话时弹出仿微信来电卡片（任何页面均可见），接通/挂断双通道；
 *   8. 视频通话仿微信大小屏：背景为 char 头像，右上角 user 小窗；
 *   9. 通话气泡支持双击打开工具栏（工具栏层级高于通话面板）。
 *
 * 层级方案（z-index）：
 *   - 来电卡片 incoming-card:  100002 （最高，任何页面可见）
 *   - 通话类型选择弹层:        100001
 *   - 通话面板 #call-overlay:   100000 （挂到 document.body）
 *   - 双击工具栏提升:           100003 （通话时临时提升 bubble-context-menu）
 * ============================================================
 */
(function () {
  "use strict";

  // ---------- 工具 ----------
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg) {
    if (typeof window.showToast === "function") window.showToast(msg);
    else console.log("[Call]", msg);
  }

  // 通话场景标签清洗
  function sanitizeForCallContext(text) {
    if (!text || typeof text !== "string") return "";
    let t = text;
    t = t.replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|$)/gi, "");
    t = t.replace(/\[MSG_ID:\s*\d+\s*\]/gi, "");
    t = t.replace(/\[SENDER:[^\]]*\]/gi, "");
    t = t.replace(/\[QUOTE:\s*\d+\s*\]/gi, "");
    t = t.replace(/[（(]([^（）()]{1,8})[)）]/g, function (m, inner) {
      if (/[。！？\n]/.test(inner)) return m;
      return "";
    });
    t = t.replace(/\[图片描述:[^\]]*\]/g, "[图片]");
    t = t.replace(/\[语音转文字:[^\]]*\]/g, "[语音]");
    return t.trim();
  }

  // ---------- CSS 注入 ----------
  let cssInjected = false;
  function injectCallCss() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement("style");
    style.id = "app-chat-call-css";
    style.textContent = `
      /* ===== 通话面板（挂到 body，层级最高） ===== */
      #call-overlay {
        position: fixed !important; top: 0 !important; left: 0 !important;
        width: 100vw !important; height: 100vh !important;
        z-index: 100000 !important;
        background: linear-gradient(160deg, #1f2937 0%, #111827 55%, #0b1220 100%);
        display: none; flex-direction: column;
        color: #f8fafc; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow: hidden;
      }
      #call-overlay.active { display: flex; }
      #call-overlay .call-bg-blur {
        position: absolute; inset: 0; background-size: cover; background-position: center;
        filter: blur(28px) brightness(0.55); transform: scale(1.15); z-index: 0;
      }
      #call-overlay .call-top {
        position: relative; z-index: 2; text-align: center; padding: 38px 20px 10px;
      }
      #call-overlay .call-avatar {
        width: 86px; height: 86px; border-radius: 50%; margin: 0 auto 12px;
        background: #334155 center/cover no-repeat; border: 2px solid rgba(255,255,255,0.25);
        box-shadow: 0 6px 22px rgba(0,0,0,0.45);
      }
      #call-overlay .call-name { font-size: 20px; font-weight: 600; letter-spacing: 0.5px; }
      #call-overlay .call-status { font-size: 12px; color: rgba(248,250,252,0.62); margin-top: 6px; }
      #call-overlay .call-timer { font-size: 13px; color: rgba(248,250,252,0.78); margin-top: 4px; font-variant-numeric: tabular-nums; }

      /* ===== 视频通话：仿微信大小屏 ===== */
      #call-overlay.is-video .call-top { padding-top: 20px; }
      #call-overlay.is-video .call-avatar { width: 64px; height: 64px; margin-bottom: 6px; }
      #call-overlay.is-video .call-video-stage {
        position: relative; z-index: 2; flex: 1; margin: 4px 0; overflow: hidden;
        background: #000 center/cover no-repeat; background-size: cover;
      }
      #call-overlay.is-video .call-video-stage .video-char-big {
        position: absolute; inset: 0; background-size: cover; background-position: center;
      }
      /* user 小窗右上角 */
      #call-overlay .call-video-self {
        position: absolute; top: 12px; right: 12px; width: 90px; height: 130px;
        border-radius: 12px; background: #1e293b center/cover no-repeat; background-size: cover;
        border: 2px solid rgba(255,255,255,0.3); z-index: 5;
        box-shadow: 0 4px 14px rgba(0,0,0,0.5); display: none;
      }
      #call-overlay.is-video .call-video-self { display: block; }
      #call-overlay .call-video-self .self-placeholder {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.5); font-size: 11px;
      }

      #call-overlay .call-messages {
        position: relative; z-index: 2; flex: 1; overflow-y: auto; padding: 8px 14px 4px;
        display: flex; flex-direction: column; gap: 8px;
        -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 6px), transparent 100%);
      }
      #call-overlay .call-msg-row { display: flex; width: 100%; }
      #call-overlay .call-msg-row.me { justify-content: flex-end; }
      #call-overlay .call-msg-row.them { justify-content: flex-start; }
      #call-overlay .call-bubble {
        max-width: 76%; padding: 8px 12px; border-radius: 14px; font-size: 13px; line-height: 1.45;
        word-break: break-word; position: relative;
      }
      #call-overlay .call-bubble.me { background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
      #call-overlay .call-bubble.them { background: rgba(255,255,255,0.14); color: #f8fafc; border-bottom-left-radius: 4px; }
      #call-overlay .call-bubble .tts-mini-btn {
        display: inline-flex; align-items: center; justify-content: center;
        margin-top: 5px; width: 24px; height: 24px; border-radius: 50%;
        background: rgba(255,255,255,0.18); border: none; cursor: pointer; color: #fff;
        padding: 0; flex-shrink: 0;
      }
      #call-overlay .call-bubble.me .tts-mini-btn { background: rgba(255,255,255,0.25); }
      #call-overlay .call-bubble .tts-mini-btn.playing { background: #16a34a; }
      #call-overlay .call-input-bar {
        position: relative; z-index: 2; display: flex; gap: 8px; padding: 8px 12px 14px;
        align-items: center; background: rgba(0,0,0,0.28);
      }
      #call-overlay .call-input-bar input {
        flex: 1; height: 36px; border-radius: 18px; border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.1); color: #fff; padding: 0 14px; font-size: 13px; outline: none;
      }
      #call-overlay .call-input-bar input::placeholder { color: rgba(248,250,252,0.5); }
      #call-overlay .call-send-btn {
        width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer;
        background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      #call-overlay .call-hangup-bar { position: relative; z-index: 2; display: flex; justify-content: center; padding: 6px 0 16px; }
      #call-overlay .call-hangup-btn {
        width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer;
        background: #ef4444; color: #fff; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 16px rgba(239,68,68,0.45);
      }

      /* ===== 通话类型选择弹层 ===== */
      .call-type-mask {
        position: fixed !important; top: 0 !important; left: 0 !important;
        width: 100vw !important; height: 100vh !important;
        z-index: 100001 !important; background: rgba(0,0,0,0.5) !important;
        display: flex !important; align-items: center !important; justify-content: center !important;
      }

      /* ===== 来电卡片（仿微信，任何页面可见） ===== */
      #call-incoming-overlay {
        position: fixed !important; top: 0 !important; left: 0 !important;
        width: 100vw !important; height: 100vh !important;
        z-index: 100002 !important; display: none;
        background: linear-gradient(180deg, #2d3748 0%, #1a202c 100%);
        flex-direction: column; align-items: center; color: #fff;
        font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      #call-incoming-overlay.active { display: flex; }
      #call-incoming-overlay .inc-avatar {
        width: 110px; height: 110px; border-radius: 50%; margin-top: 80px;
        background: #475569 center/cover no-repeat; border: 3px solid rgba(255,255,255,0.3);
        box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      }
      #call-incoming-overlay .inc-name { font-size: 22px; font-weight: 600; margin-top: 16px; }
      #call-incoming-overlay .inc-status { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 8px; }
      #call-incoming-overlay .inc-type-icon { margin-top: 30px; opacity: 0.85; }
      #call-incoming-overlay .inc-actions {
        position: absolute; bottom: 60px; left: 0; right: 0;
        display: flex; justify-content: space-around; align-items: center;
      }
      #call-incoming-overlay .inc-btn {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        cursor: pointer; user-select: none; background: none; border: none; color: #fff;
      }
      #call-incoming-overlay .inc-btn-circle {
        width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      }
      #call-incoming-overlay .inc-btn.hangup .inc-btn-circle { background: #ef4444; box-shadow: 0 4px 18px rgba(239,68,68,0.5); }
      #call-incoming-overlay .inc-btn.accept .inc-btn-circle { background: #22c55e; box-shadow: 0 4px 18px rgba(34,197,94,0.5); }
      #call-incoming-overlay .inc-btn-label { font-size: 12px; color: rgba(255,255,255,0.75); }

      /* ===== 通话记录卡片（系统通知样式，简化版） ===== */
      .call-record-card {
        margin: 6px auto; max-width: 78%; padding: 8px 14px; border-radius: 10px;
        background: rgba(142,142,147,0.14); color: var(--text-secondary, #6b7280);
        font-size: 12px; text-align: center; cursor: pointer; user-select: none;
        display: inline-flex; align-items: center; gap: 6px;
        transition: background 0.15s;
      }
      .call-record-card:hover { background: rgba(142,142,147,0.22); }
      .call-record-card .crd-expand-label { font-size: 11px; color: var(--primary, #2563eb); }
      .call-record-detail {
        display: none; margin: 4px auto 10px; max-width: 86%; width: 86%;
        background: #f8fafc; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 10px;
        text-align: left; animation: callDetailIn 0.18s ease;
        position: relative; z-index: auto;
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
      .call-record-detail.show { display: block; }
      @keyframes callDetailIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      .call-record-detail .crd-head { font-size: 11px; font-weight: 700; color: var(--text-primary,#1f2937); margin-bottom: 8px; display:flex; align-items:center; gap:5px; }
      .call-record-detail .crd-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
      .call-record-detail .crd-msg { font-size: 12px; padding: 6px 9px; border-radius: 8px; line-height: 1.4; word-break: break-word; display: flex; flex-direction: column; }
      .call-record-detail .crd-msg.me { background: #2563eb; color: #fff; align-self: flex-end; border-bottom-right-radius: 3px; }
      .call-record-detail .crd-msg.them { background: #fff; color: var(--text-primary,#1f2937); align-self: flex-start; border: 1px solid var(--border,#e2e8f0); border-bottom-left-radius: 3px; }
      .call-record-detail .crd-msg .tts-mini-btn { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:#eef2ff; color:#3730a3; cursor:pointer; border:1px solid #c7d2fe; padding:0; margin-top:5px; align-self:flex-start; }
      .call-record-detail .crd-msg .tts-mini-btn.playing { background:#dcfce7; color:#166534; border-color:#86efac; }
      .call-record-detail .crd-empty { font-size: 11px; color: var(--text-secondary,#9ca3af); text-align: center; padding: 10px 0; }
    `;
    document.head.appendChild(style);
  }

  // ---------- 通话面板 DOM 构建 ----------
  function buildOverlay() {
    injectCallCss();
    let ov = document.getElementById("call-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "call-overlay";
    ov.innerHTML = `
      <div class="call-bg-blur"></div>
      <div class="call-top">
        <div class="call-avatar" id="call-avatar"></div>
        <div class="call-name" id="call-name"></div>
        <div class="call-status" id="call-status">正在呼叫...</div>
        <div class="call-timer" id="call-timer"></div>
      </div>
      <div class="call-video-stage" id="call-video-stage" style="display:none;">
        <div class="video-char-big" id="video-char-big"></div>
      </div>
      <div class="call-video-self" id="call-video-self">
        <div class="self-placeholder">我</div>
      </div>
      <div class="call-messages" id="call-messages"></div>
      <div class="call-input-bar">
        <input type="text" id="call-input" placeholder="发送消息..." autocomplete="off">
        <button class="call-send-btn" id="call-send-btn" title="发送">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="call-hangup-bar">
        <button class="call-hangup-btn" id="call-hangup-btn" title="挂断">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg);"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </button>
      </div>
    `;
    // 挂载到 document.body，确保层级在所有页面之上
    document.body.appendChild(ov);
    return ov;
  }

  // ---------- 来电卡片 DOM 构建 ----------
  function buildIncomingOverlay() {
    injectCallCss();
    let ov = document.getElementById("call-incoming-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "call-incoming-overlay";
    ov.innerHTML = `
      <div class="inc-avatar" id="inc-avatar"></div>
      <div class="inc-name" id="inc-name"></div>
      <div class="inc-status" id="inc-status">邀请你进行语音通话...</div>
      <div class="inc-type-icon" id="inc-type-icon"></div>
      <div class="inc-actions">
        <button class="inc-btn hangup" id="inc-hangup">
          <div class="inc-btn-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg);"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </div>
          <span class="inc-btn-label">拒绝</span>
        </button>
        <button class="inc-btn accept" id="inc-accept">
          <div class="inc-btn-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </div>
          <span class="inc-btn-label">接听</span>
        </button>
      </div>
    `;
    document.body.appendChild(ov);
    return ov;
  }

  // ---------- 通话时临时提升 bubble-context-menu 层级 ----------
  let _menuOriginalParent = null;
  let _menuOriginalStyle = "";
  let _menuHiddenBtns = [];
  let _elevatedOverlays = [];
  function elevateContextMenu() {
    const menu = document.getElementById("bubble-context-menu");
    if (!menu) return;
    if (menu.dataset.elevated === "1") return;
    _menuOriginalParent = menu.parentElement;
    _menuOriginalStyle = menu.getAttribute("style") || "";
    menu.dataset.elevated = "1";
    // 移到 body 顶层，改为 fixed 定位，z-index 高于通话面板
    document.body.appendChild(menu);
    menu.style.position = "fixed";
    menu.style.zIndex = "100003";
    // 通话上下文中隐藏不适用的按钮（多选、回溯），保留编辑/翻译/格式修复/收藏/删除/撤回
    window._callToolbarContext = true;
    _menuHiddenBtns = [];
    ["btn-menu-multi", "btn-menu-reroll"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn && btn.style.display !== "none") {
        btn.style.display = "none";
        _menuHiddenBtns.push(id);
      }
    });
    // 同步提升编辑/格式修复弹层 z-index 到通话面板之上（100004），避免被通话面板遮挡
    _elevatedOverlays = [];
    ["custom-edit-overlay", "custom-format-repair-overlay"].forEach(id => {
      const ov = document.getElementById(id);
      if (ov) {
        const prev = ov.getAttribute("style") || "";
        _elevatedOverlays.push({ el: ov, prevStyle: prev });
        // 保留原 style 内容，追加/覆盖 z-index
        ov.style.zIndex = "100004";
        // 确保挂到 body 顶层
        if (ov.parentElement !== document.body) {
          document.body.appendChild(ov);
        }
      }
    });
  }
  function restoreContextMenu() {
    const menu = document.getElementById("bubble-context-menu");
    if (!menu || menu.dataset.elevated !== "1") return;
    menu.dataset.elevated = "";
    if (_menuOriginalParent) _menuOriginalParent.appendChild(menu);
    menu.setAttribute("style", _menuOriginalStyle);
    menu.style.display = "none";
    // 恢复被隐藏的按钮
    _menuHiddenBtns.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = "";
    });
    _menuHiddenBtns = [];
    // 恢复弹层 z-index
    _elevatedOverlays.forEach(({ el, prevStyle }) => {
      el.setAttribute("style", prevStyle);
    });
    _elevatedOverlays = [];
    window._callToolbarContext = false;
    _menuOriginalParent = null;
    _menuOriginalStyle = "";
  }

  // ---------- 通话系统主对象 ----------
  const callSystem = {
    active: false,
    callId: null,
    type: "voice",
    startedAt: 0,
    timerHandle: null,
    messageIds: [],
    abortController: null,
    charAvatar: "",
    charName: "",
    userAvatar: "",
    sessionId: null,

    // 选择通话类型入口
    promptCallType: function () {
      if (typeof activeSessionId === "undefined" || !activeSessionId) {
        toast("请先进入一个聊天对话");
        return;
      }
      injectCallCss();
      const mask = document.createElement("div");
      mask.className = "call-type-mask";
      // 内联样式作为兜底，确保层级正确
      mask.style.cssText = "position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; z-index:100001 !important; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center;";
      mask.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:18px;width:260px;text-align:center;">
          <div style="font-size:14px;font-weight:700;margin-bottom:14px;color:var(--text-primary,#1f2937);">发起通话</div>
          <div style="display:flex;gap:10px;">
            <button id="call-pick-voice" style="flex:1;padding:14px 0;border-radius:12px;border:1px solid var(--border,#e2e8f0);background:#f8fafc;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span style="font-size:12px;color:var(--text-primary,#1f2937);">语音通话</span>
            </button>
            <button id="call-pick-video" style="flex:1;padding:14px 0;border-radius:12px;border:1px solid var(--border,#e2e8f0);background:#f8fafc;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <span style="font-size:12px;color:var(--text-primary,#1f2937);">视频通话</span>
            </button>
          </div>
          <button id="call-pick-cancel" style="margin-top:12px;width:100%;padding:9px;border-radius:10px;border:none;background:#f1f5f9;color:var(--text-secondary,#64748b);font-size:12px;cursor:pointer;">取消</button>
        </div>
      `;
      document.body.appendChild(mask);
      const close = () => mask.remove();
      mask.querySelector("#call-pick-voice").onclick = () => { close(); callSystem.start("voice"); };
      mask.querySelector("#call-pick-video").onclick = () => { close(); callSystem.start("video"); };
      mask.querySelector("#call-pick-cancel").onclick = close;
      mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
    },

    // 发起通话
    start: async function (type, opts) {
      opts = opts || {};
      if (callSystem.active) { toast("已有通话进行中"); return; }
      const sid = (typeof activeSessionId !== "undefined") ? activeSessionId : null;
      if (!sid) { toast("请先进入一个聊天对话"); return; }
      const sess = await db.sessions.get(sid);
      if (!sess) { toast("会话不存在"); return; }
      const char = sess.charId ? await db.archives.get(sess.charId) : null;
      const user = sess.userId ? await db.archives.get(sess.userId) : null;

      callSystem.sessionId = sid;
      callSystem.type = type === "video" ? "video" : "voice";
      callSystem.startedAt = Date.now();
      callSystem.callId = "call_" + Date.now();
      callSystem.messageIds = [];
      callSystem.active = true;
      callSystem.charName = sess.customCharName || (char && char.name) || "对方";
      callSystem.charAvatar = sess.customCharAvatar || (char && char.avatar) || "";
      callSystem.userAvatar = sess.customUserAvatar || (user && user.avatar) || "";

      const expandPanel = document.getElementById("chat-expand-panel");
      if (expandPanel) expandPanel.classList.remove("active");

      const ov = buildOverlay();
      ov.classList.add("active");
      ov.classList.toggle("is-video", callSystem.type === "video");

      const avatarEl = ov.querySelector("#call-avatar");
      if (callSystem.charAvatar) avatarEl.style.backgroundImage = `url(${callSystem.charAvatar})`;
      else avatarEl.style.backgroundImage = "";
      ov.querySelector("#call-name").textContent = callSystem.charName;
      ov.querySelector("#call-status").textContent = opts.autoByChar ? "对方发起的通话" : "正在呼叫...";
      ov.querySelector("#call-timer").textContent = "";
      ov.querySelector("#call-messages").innerHTML = "";

      // 视频通话：设置背景大图(char头像) 和 user 小窗
      if (callSystem.type === "video") {
        const videoStage = ov.querySelector("#call-video-stage");
        const charBig = ov.querySelector("#video-char-big");
        if (videoStage) videoStage.style.display = "block";
        if (charBig && callSystem.charAvatar) charBig.style.backgroundImage = `url(${callSystem.charAvatar})`;
        // 背景模糊层也用 char 头像
        const bgBlur = ov.querySelector(".call-bg-blur");
        if (bgBlur && callSystem.charAvatar) bgBlur.style.backgroundImage = `url(${callSystem.charAvatar})`;
        // user 小窗
        const selfEl = ov.querySelector("#call-video-self");
        if (selfEl) {
          if (callSystem.userAvatar) {
            selfEl.style.backgroundImage = `url(${callSystem.userAvatar})`;
            const ph = selfEl.querySelector(".self-placeholder");
            if (ph) ph.style.display = "none";
          }
        }
      } else {
        // 语音通话：背景模糊用 char 头像
        const bgBlur = ov.querySelector(".call-bg-blur");
        if (bgBlur && callSystem.charAvatar) bgBlur.style.backgroundImage = `url(${callSystem.charAvatar})`;
      }

      // 1.5 秒后切换为"通话中"并启动计时
      setTimeout(() => {
        if (!callSystem.active) return;
        const st = ov.querySelector("#call-status");
        if (st) st.textContent = callSystem.type === "video" ? "视频通话中" : "语音通话中";
        callSystem.startTimer();
      }, 1500);

      // 提升工具栏层级
      elevateContextMenu();

      // 绑定输入与挂断
      const inputEl = ov.querySelector("#call-input");
      const sendBtn = ov.querySelector("#call-send-btn");
      const hangupBtn = ov.querySelector("#call-hangup-btn");
      const onSend = () => {
        const v = inputEl.value.trim();
        if (!v) return;
        inputEl.value = "";
        callSystem.sendUserMessage(v);
      };
      sendBtn.onclick = onSend;
      inputEl.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); onSend(); }
      };
      sendBtn.onmousedown = (e) => e.preventDefault();
      hangupBtn.onclick = () => callSystem.end();

      // char 主动发起时自动让 char 说开场白
      if (opts.autoByChar) {
        setTimeout(() => { if (callSystem.active) callSystem.fetchCharReply("（通话已接通，请自然地用一句话开场）"); }, 1700);
      }
    },

    startTimer: function () {
      callSystem.stopTimer();
      callSystem.timerHandle = setInterval(() => {
        const ov = document.getElementById("call-overlay");
        if (!ov || !callSystem.active) { callSystem.stopTimer(); return; }
        const sec = Math.floor((Date.now() - callSystem.startedAt) / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, "0");
        const s = String(sec % 60).padStart(2, "0");
        const el = ov.querySelector("#call-timer");
        if (el) el.textContent = `${m}:${s}`;
      }, 1000);
    },
    stopTimer: function () {
      if (callSystem.timerHandle) { clearInterval(callSystem.timerHandle); callSystem.timerHandle = null; }
    },

    sendUserMessage: async function (text) {
      if (!callSystem.active) return;
      const msg = {
        sessionId: callSystem.sessionId,
        senderType: "user",
        senderId: (typeof activeUserPersonaId !== "undefined") ? Number(activeUserPersonaId) : 0,
        content: text,
        contentType: "text",
        timestamp: Date.now(),
        callId: callSystem.callId
      };
      msg.id = await db.messages.add(msg);
      callSystem.messageIds.push(msg.id);
      callSystem.appendCallBubble(msg);
      await db.sessions.update(callSystem.sessionId, { lastMessageTime: Date.now() });
      callSystem.fetchCharReply(text);
    },

    fetchCharReply: async function (userText) {
      const ov = document.getElementById("call-overlay");
      if (ov) {
        const st = ov.querySelector("#call-status");
        if (st) st.textContent = "对方正在说话...";
      }
      try {
        const presetId = localStorage.getItem("global_api_preset_id");
        if (!presetId) throw new Error("未配置全局默认 API");
        const api = await db.api_presets.get(Number(presetId));
        if (!api) throw new Error("API 预设已被删除");

        const sid = callSystem.sessionId;
        const sess = await db.sessions.get(sid);

        const history = await db.messages.where("sessionId").equals(sid).reverse().limit(10).toArray();
        history.reverse();
        const messagesToSend = [];

        const charName = callSystem.charName;
        let sysPrompt = `你正在与对方进行${callSystem.type === "video" ? "视频" : "语音"}通话。\n`;
        sysPrompt += `【通话对白强制约束】：\n`;
        sysPrompt += `1. 只输出 ${charName} 在通话中说出的口语台词，像真实电话/视频通话一样自然简短。\n`;
        sysPrompt += `2. 严禁使用任何括号、方括号、书名号包裹的动作描写、神态描写或旁白。\n`;
        sysPrompt += `3. 严禁输出 <think> 思考标签或任何系统指令标签。\n`;
        sysPrompt += `4. 每次只说 1~3 句短句，可换行连发，符合通话时简短应答的节奏。\n`;
        if (sess && sess.customCharPersona) sysPrompt += `\n你的角色人设：\n${sess.customCharPersona}\n`;

        messagesToSend.push({ role: "system", content: sysPrompt });

        history.forEach((h) => {
          if (h.isRecalled === 1) return;
          let displayContent = h.content || "";
          if (typeof displayContent === "string") {
            displayContent = sanitizeForCallContext(displayContent);
          }
          if (h.contentType === "image") {
            displayContent = "[图片]";
          } else if (h.contentType === "voice") {
            try { const d = JSON.parse(h.content); displayContent = sanitizeForCallContext(d.text || "") || "[语音]"; } catch (e) {}
          } else if (h.contentType === "call") {
            displayContent = "[上一通通话]";
          }
          if (!displayContent) return;
          messagesToSend.push({ role: h.senderType === "user" ? "user" : "assistant", content: displayContent });
        });

        callSystem.abortController = new AbortController();
        const rawReply = await fetchStreamOrJson(api.url, api, messagesToSend, callSystem.abortController.signal, null);

        let replyText = rawReply || "";
        if (window.cotSystem && typeof window.cotSystem.parseThoughtWithRegex === "function") {
          const r = window.cotSystem.parseThoughtWithRegex(replyText);
          replyText = r.cleanText;
        } else {
          replyText = replyText.replace(/(?:<think>|\[THINKING\]|【思考】)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|$)/gi, "");
        }
        replyText = sanitizeForCallContext(replyText);
        replyText = replyText.replace(/\[AUTO_CALL[^\]]*\]/gi, "").replace(/\[MSG_ID:\s*\d+\s*\]/gi, "").trim();
        if (!replyText) replyText = "喂？听得到吗？";

        const msg = {
          sessionId: sid,
          senderType: "char",
          senderId: 0,
          content: replyText,
          contentType: "text",
          timestamp: Date.now(),
          callId: callSystem.callId
        };
        msg.id = await db.messages.add(msg);
        callSystem.messageIds.push(msg.id);
        callSystem.appendCallBubble(msg);
        await db.sessions.update(sid, { lastMessageTime: Date.now() });
      } catch (e) {
        if (e && e.name === "AbortError") {
          toast("当前请求已终止");
        } else {
          toast("通话回复失败：" + (e && e.message ? e.message : e));
        }
      } finally {
        callSystem.abortController = null;
        if (callSystem.active) {
          const ov2 = document.getElementById("call-overlay");
          if (ov2) {
            const st = ov2.querySelector("#call-status");
            if (st) st.textContent = callSystem.type === "video" ? "视频通话中" : "语音通话中";
          }
        }
      }
    },

    // 通话面板追加气泡 + 双击工具栏 + TTS 小按钮
    appendCallBubble: function (msg) {
      const ov = document.getElementById("call-overlay");
      if (!ov) return;
      const list = ov.querySelector("#call-messages");
      const row = document.createElement("div");
      row.className = "call-msg-row " + (msg.senderType === "user" ? "me" : "them");
      const bubble = document.createElement("div");
      bubble.className = "call-bubble " + (msg.senderType === "user" ? "me" : "them");
      bubble.dataset.msgId = msg.id;

      // 处理撤回消息
      if (msg.isRecalled === 1) {
        bubble.textContent = "[已撤回]";
        bubble.style.opacity = "0.5";
        bubble.style.fontStyle = "italic";
        row.appendChild(bubble);
        list.appendChild(row);
        list.scrollTop = list.scrollHeight;
        return;
      }

      // 显示正文（支持翻译切换）
      bubble.textContent = msg.content;
      if (msg.translatedContent && msg.showTranslation === 1) {
        const tr = document.createElement("div");
        tr.style.cssText = "margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.2);font-size:12px;opacity:0.85;";
        tr.textContent = msg.translatedContent;
        bubble.appendChild(tr);
      }

      // 双击打开工具栏（工具栏已提升到通话面板之上）
      bubble.ondblclick = async (e) => {
        e.preventDefault();
        if (msg.isRecalled === 1) return;
        // 正确设置 selectedMsgId（通过暴露的接口写入闭包变量）
        if (typeof window._setSelectedMsgId === "function") window._setSelectedMsgId(msg.id);
        const menu = document.getElementById("bubble-context-menu");
        if (menu) {
          // 确保工具栏在 body 顶层且层级高于通话面板
          if (menu.dataset.elevated !== "1") elevateContextMenu();
          const btnRecall = document.getElementById("btn-menu-recall");
          if (btnRecall) btnRecall.style.display = msg.senderType === "user" ? "block" : "none";
          menu.style.display = "flex";
        }
      };

      // char 消息：挂载小巧的 TTS 播放按钮
      if (msg.senderType === "char") {
        callSystem.maybeAttachTtsBtn(bubble, msg);
      }

      row.appendChild(bubble);
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
    },

    // 刷新通话面板气泡列表（工具栏操作后调用，从 DB 重读当前通话消息）
    refreshCallBubbles: async function () {
      const ov = document.getElementById("call-overlay");
      if (!ov || !callSystem.active) return;
      const list = ov.querySelector("#call-messages");
      if (!list) return;
      list.innerHTML = "";
      // 从 DB 重新读取当前通话的所有消息
      try {
        const callMsgs = await db.messages
          .where("sessionId").equals(callSystem.sessionId)
          .and(m => m.callId === callSystem.callId)
          .toArray();
        callMsgs.sort((a, b) => a.timestamp - b.timestamp);
        for (const m of callMsgs) {
          callSystem.appendCallBubble(m);
        }
      } catch (e) { /* 刷新失败不影响通话 */ }
    },

    // 小巧的圆形 TTS 播放按钮
    maybeAttachTtsBtn: async function (bubble, msg) {
      try {
        const sess = await db.sessions.get(callSystem.sessionId);
        if (!sess || sess.ttsEnabled !== 1) return;
        if (typeof window.ttsSystem === "undefined") return;
        const voiceId = (sess.ttsVoiceId || "").trim();
        const btn = document.createElement("button");
        btn.className = "tts-mini-btn";
        btn.title = "播放语音";
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        btn.onclick = async (ev) => {
          ev.stopPropagation();
          if (btn.classList.contains("playing")) {
            window.ttsSystem.stop();
            btn.classList.remove("playing");
            btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
            return;
          }
          const vid = voiceId || "male-qn-jingying";
          if (!voiceId) toast("未填写音色 ID，使用默认音色");
          toast("正在转换 TTS 语音...");
          const blob = await window.ttsSystem.getOrSynthesize(msg.content, vid, callSystem.sessionId);
          if (blob) {
            document.querySelectorAll("#call-overlay .tts-mini-btn.playing").forEach((b) => {
              b.classList.remove("playing");
              b.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
            });
            btn.classList.add("playing");
            btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
            window.ttsSystem.playBlob(blob);
            const audio = window.ttsSystem._currentAudio;
            if (audio) {
              const orig = audio.onended;
              audio.onended = function () {
                if (orig) orig.call(this);
                btn.classList.remove("playing");
                btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
              };
            }
          }
        };
        bubble.appendChild(btn);
      } catch (e) { /* TTS 挂载失败不影响通话 */ }
    },

    // 结束通话
    end: async function () {
      if (!callSystem.active) return;
      callSystem.active = false;
      callSystem.stopTimer();
      if (callSystem.abortController) { try { callSystem.abortController.abort(); } catch (e) {} callSystem.abortController = null; }
      if (typeof window.ttsSystem !== "undefined") window.ttsSystem.stop();

      const endedAt = Date.now();
      const durationSec = Math.max(1, Math.floor((endedAt - callSystem.startedAt) / 1000));
      const sid = callSystem.sessionId;
      const callId = callSystem.callId;
      const type = callSystem.type;
      const messageIds = callSystem.messageIds.slice();

      // 关闭面板
      const ov = document.getElementById("call-overlay");
      if (ov) { ov.classList.remove("active"); ov.classList.remove("is-video"); }

      // 还原工具栏层级
      restoreContextMenu();

      // 生成通话记录系统消息
      const durationLabel = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}`;
      const record = {
        sessionId: sid,
        senderType: "system",
        senderId: 0,
        content: JSON.stringify({
          type: type,
          startedAt: callSystem.startedAt,
          endedAt: endedAt,
          durationSec: durationSec,
          callId: callId,
          messageIds: messageIds,
          summary: `${type === "video" ? "视频" : "语音"}通话 · ${durationLabel}`
        }),
        contentType: "call",
        timestamp: endedAt
      };
      record.id = await db.messages.add(record);
      await db.sessions.update(sid, { lastMessageTime: endedAt });

      // 在主聊天列表渲染通话记录卡片
      if (typeof appendMessageToDOM === "function") {
        await appendMessageToDOM(record);
      }
      toast(`通话已结束 · ${durationLabel}`);

      callSystem.callId = null;
      callSystem.messageIds = [];
      callSystem.sessionId = null;
    },

    // ============================================================
    // 通话记录卡片渲染（简化版：仅显示"语音通话已结束-展开"）
    // ============================================================
    renderCallRecordCard: function (msg) {
      let data = {};
      try { data = JSON.parse(msg.content); } catch (e) { data = { summary: "通话记录" }; }
      const isVideo = data.type === "video";
      const isRejected = data.rejected === true;
      const card = document.createElement("div");
      card.className = "call-record-card";
      const typeLabel = isVideo ? "视频通话" : "语音通话";
      if (isRejected) {
        // 被拒绝的来电：只显示提示文字，不可展开
        card.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isVideo ? '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' : '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'}</svg>
          <span>你拒绝了对方的${typeLabel}请求</span>
        `;
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;width:100%;";
        wrap.appendChild(card);
        return wrap;
      }
      card.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isVideo ? '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' : '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'}</svg>
        <span>${typeLabel}已结束</span>
        <span class="crd-expand-label">- 展开</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="crd-chevron" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
      `;
      const detail = document.createElement("div");
      detail.className = "call-record-detail";
      card.onclick = async () => {
        const open = detail.classList.toggle("show");
        const chev = card.querySelector(".crd-chevron");
        if (chev) chev.style.transform = open ? "rotate(180deg)" : "none";
        const expandLabel = card.querySelector(".crd-expand-label");
        if (expandLabel) expandLabel.textContent = open ? "- 收起" : "- 展开";
        if (open && !detail.dataset.loaded) {
          await callSystem.fillCallRecordDetail(detail, data, msg);
          detail.dataset.loaded = "1";
        }
      };
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;width:100%;";
      wrap.appendChild(card);
      wrap.appendChild(detail);
      return wrap;
    },

    // 填充通话记录详情：拉取消息 + TTS 反复播放
    fillCallRecordDetail: async function (detailEl, data, recordMsg) {
      const sid = recordMsg.sessionId;
      const list = document.createElement("div");
      list.className = "crd-list";
      let msgs = [];
      if (data.messageIds && data.messageIds.length > 0) {
        for (const mid of data.messageIds) {
          const m = await db.messages.get(Number(mid));
          if (m) msgs.push(m);
        }
      } else {
        const all = await db.messages.where("sessionId").equals(sid).toArray();
        msgs = all.filter((m) => m.callId === data.callId);
      }
      if (msgs.length === 0) {
        detailEl.innerHTML = `<div class="crd-head"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>通话记录</div><div class="crd-empty">本次通话无对话内容</div>`;
        return;
      }
      const head = document.createElement("div");
      head.className = "crd-head";
      head.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${esc(data.summary || "通话记录")} · 共 ${msgs.length} 条`;
      detailEl.appendChild(head);

      const sess = await db.sessions.get(sid);
      const ttsOn = !!(sess && sess.ttsEnabled === 1 && typeof window.ttsSystem !== "undefined");
      const voiceId = (sess && sess.ttsVoiceId || "").trim();

      msgs.forEach((m) => {
        const row = document.createElement("div");
        row.className = "crd-msg " + (m.senderType === "user" ? "me" : "them");
        const span = document.createElement("span");
        span.textContent = m.content;
        row.appendChild(span);
        if (ttsOn && m.senderType === "char") {
          const btn = document.createElement("button");
          btn.className = "tts-mini-btn";
          btn.title = "播放";
          btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
          btn.onclick = async (ev) => {
            ev.stopPropagation();
            if (btn.classList.contains("playing")) {
              window.ttsSystem.stop();
              btn.classList.remove("playing");
              btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
              return;
            }
            const vid = voiceId || "male-qn-jingying";
            toast("正在转换 TTS 语音...");
            const blob = await window.ttsSystem.getOrSynthesize(m.content, vid, sid);
            if (blob) {
              detailEl.querySelectorAll(".tts-mini-btn.playing").forEach((b) => {
                b.classList.remove("playing");
                b.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
              });
              btn.classList.add("playing");
              btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
              window.ttsSystem.playBlob(blob);
              const cur = window.ttsSystem._currentAudio;
              if (cur) {
                const orig = cur.onended;
                cur.onended = function () {
                  if (orig) orig.call(this);
                  btn.classList.remove("playing");
                  btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
                };
              }
            }
          };
          row.appendChild(btn);
        }
        list.appendChild(row);
      });
      detailEl.appendChild(list);
    },

    // ============================================================
    // char 主动发起通话：prompt 注入 + 来电卡片 + 指令检测
    // ============================================================
    buildAutoCallPromptSegment: async function (sessionId) {
      try {
        const sess = await db.sessions.get(sessionId);
        if (!sess || sess.allowCharAutoCall !== 1) return "";
        if (callSystem.active) return "";
        const recent = await db.messages.where("sessionId").equals(sessionId).reverse().limit(1).toArray();
        if (recent.length > 0 && recent[0].contentType === "call") {
          return "";
        }
        return `【主动发起通话特权】
你现在被允许主动向对方发起${sess.allowCharAutoCallVideo === 1 ? "语音或视频" : "语音"}通话。当你觉得此刻适合打电话时（例如想听到对方声音、有急事、想念对方、或文字不足以表达情绪），可以在你回复的最后一行单独占一行输出通话指令：
- 语音通话指令格式：[AUTO_CALL:voice]
- 视频通话指令格式：[AUTO_CALL:video]
${sess.allowCharAutoCallVideo !== 1 ? "（当前仅允许语音通话，禁止视频通话指令）" : ""}
输出指令后，系统会自动弹出来电卡片，对方可选择接听或挂断。无需再额外解释。其余正常对白照常输出。
【重要区分】：语音/视频通话不是 MCP 工具！发起通话只能用 [AUTO_CALL:voice] 或 [AUTO_CALL:video] 指令，绝对禁止用 [CALL_TOOL] 来发起通话。当对方说"打个电话/语音/视频"时，直接输出 [AUTO_CALL] 指令即可，不要调用任何 MCP 工具。`;
      } catch (e) { return ""; }
    },

    // 从 char 回复中检测主动通话指令，弹出来电卡片
    detectAndTriggerAutoCall: function (text, sessionId) {
      if (!text) return text;
      const m = text.match(/\[AUTO_CALL:\s*(voice|video)\s*\]/i);
      if (!m) return text;
      const callType = m[1].toLowerCase();
      const cleaned = text.replace(/\[AUTO_CALL:\s*(voice|video)\s*\]/gi, "").trim();
      // 弹出来电卡片（不直接 start，等用户接听/挂断）
      setTimeout(() => {
        callSystem.showIncomingCall(callType, sessionId);
      }, 600);
      return cleaned;
    },

    // 仿微信来电卡片（任何页面均可见）
    showIncomingCall: async function (type, sessionId) {
      if (callSystem.active) return;
      const sid = sessionId || ((typeof activeSessionId !== "undefined") ? activeSessionId : null);
      if (!sid) return;
      const sess = await db.sessions.get(sid);
      if (!sess) return;
      const char = sess.charId ? await db.archives.get(sess.charId) : null;
      const charName = sess.customCharName || (char && char.name) || "对方";
      const charAvatar = sess.customCharAvatar || (char && char.avatar) || "";

      const ov = buildIncomingOverlay();
      const avatarEl = ov.querySelector("#inc-avatar");
      if (charAvatar) avatarEl.style.backgroundImage = `url(${charAvatar})`;
      else avatarEl.style.backgroundImage = "";
      ov.querySelector("#inc-name").textContent = charName;
      ov.querySelector("#inc-status").textContent = `邀请你进行${type === "video" ? "视频" : "语音"}通话...`;
      const typeIconEl = ov.querySelector("#inc-type-icon");
      if (type === "video") {
        typeIconEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
      } else {
        typeIconEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
      }
      ov.classList.add("active");

      // 接听
      ov.querySelector("#inc-accept").onclick = () => {
        ov.classList.remove("active");
        callSystem.start(type, { autoByChar: true });
      };
      // 挂断（拒绝）
      ov.querySelector("#inc-hangup").onclick = async () => {
        ov.classList.remove("active");
        await callSystem.recordRejectedCall(type, sid, charName);
      };
    },

    // 记录被拒绝的来电（系统消息 + 计入上下文）
    recordRejectedCall: async function (type, sid, charName) {
      const now = Date.now();
      const record = {
        sessionId: sid,
        senderType: "system",
        senderId: 0,
        content: JSON.stringify({
          type: type,
          startedAt: now,
          endedAt: now,
          durationSec: 0,
          callId: "call_rejected_" + now,
          messageIds: [],
          summary: `${type === "video" ? "视频" : "语音"}通话请求已拒绝`,
          rejected: true
        }),
        contentType: "call",
        timestamp: now
      };
      record.id = await db.messages.add(record);
      await db.sessions.update(sid, { lastMessageTime: now });
      if (typeof appendMessageToDOM === "function") {
        await appendMessageToDOM(record);
      }
      toast(`已拒绝${type === "video" ? "视频" : "语音"}通话请求`);
    }
  };

  // ---------- 绑定加号展开栏的语音通话按钮 + 模块加载时即注入CSS ----------
  function bindCallTrigger() {
    // 模块加载时立即注入通话CSS，确保页面刷新后通话记录卡片也能正确渲染
    injectCallCss();

    const btn = document.getElementById("btn-chat-call");
    if (btn) {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        const expandPanel = document.getElementById("chat-expand-panel");
        if (expandPanel) expandPanel.classList.remove("active");
        callSystem.promptCallType();
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindCallTrigger);
  } else {
    bindCallTrigger();
  }

  window.callSystem = callSystem;
  window.callSystem.sanitizeForCallContext = sanitizeForCallContext;
})();
