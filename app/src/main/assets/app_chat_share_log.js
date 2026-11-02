/**
 * app_chat_share_log.js - 多选分享聊天记录
 *
 * 场景：单聊 / 群聊的「线上格式」下，双击气泡 → 多选 → 分享，
 *       把选中的消息连同时间戳与双方信息打包，转发到同一「面具」下的其它聊天框。
 *
 * 设计：
 *   - 载荷 contentType = 'chat_log_share'，content 为结构化 JSON；
 *   - 目标聊天里以淡彩 HTML 卡片渲染（发件人 / 来源会话 / 参与人 / 逐条原文 / 导出时间）；
 *   - 同时给目标聊天的 AI 一份可读摘要（buildContextSummary），
 *     明确告知「这是谁把谁和谁的聊天记录转发给了你」。
 */
(function () {
  "use strict";

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function fmtFull(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function svg(paths, size, color) {
    size = size || 14;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle;">' + paths + '</svg>';
  }
  const ICONS = {
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
  };

  // ---------------- 自绘弹层（与群聊同一套淡彩卡片样式） ----------------
  function sheet(opts) {
    opts = opts || {};
    const host = document.getElementById("win-chat") || document.getElementById("phone-container") || document.body;
    let el = document.getElementById("chatlog-sheet-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "chatlog-sheet-overlay";
      el.className = "modal-overlay group-sheet-overlay";
      el.addEventListener("click", (e) => { if (e.target === el) closeSheet(); });
      host.appendChild(el);
    } else if (el.parentNode !== host) {
      host.appendChild(el);
    }
    const actionsHtml = (opts.actions || []).map(function (a, i) {
      return '<button class="group-sheet-action ' + (a.cls || "") + '" data-idx="' + i + '">' +
        (a.icon ? svg(a.icon, 14) : "") + '<span>' + esc(a.label) + '</span></button>';
    }).join("");
    el.innerHTML =
      '<div class="modal group-sheet-modal">' +
        '<header class="modal-header group-sheet-header">' +
          '<h4>' + (opts.icon ? svg(opts.icon, 16) : "") + esc(opts.title || "") + '</h4>' +
          '<button class="btn-icon" id="chatlog-sheet-close">' + svg(ICONS.x, 16) + '</button>' +
        '</header>' +
        '<div class="group-sheet-body">' + (opts.body || "") + '</div>' +
        (actionsHtml ? '<div class="group-sheet-actions">' + actionsHtml + '</div>' : "") +
      '</div>';
    el.querySelector("#chatlog-sheet-close").onclick = closeSheet;
    (opts.actions || []).forEach(function (a, i) {
      const btn = el.querySelector('.group-sheet-action[data-idx="' + i + '"]');
      if (btn) btn.onclick = function () { if (a.onClick) a.onClick(); };
    });
    el.classList.add("active");
    if (typeof opts.onMount === "function") { try { opts.onMount(el); } catch (e) { console.warn(e); } }
    return el;
  }
  function closeSheet() {
    const el = document.getElementById("chatlog-sheet-overlay");
    if (el) el.classList.remove("active");
  }

  // ---------------- 消息摘要文本 ----------------
  function messageText(m) {
    const type = m.contentType || "text";
    const raw = m.content;
    try {
      if (type === "text") return typeof raw === "string" ? raw : String(raw == null ? "" : raw);
      if (type === "image") { const d = JSON.parse(raw); return "[图片] " + (d.text || d.url ? (d.text || "") : ""); }
      if (type === "voice") { const d = JSON.parse(raw); return "[语音] " + (d.text || ""); }
      if (type === "share") { const d = JSON.parse(raw); return "[分享了链接] " + (d.title || d.url || ""); }
      if (type === "transfer") { const d = JSON.parse(raw); return "[转账] ￥" + (Number(d.amount) || 0).toFixed(2); }
      if (type === "red_envelope") { const d = JSON.parse(raw); return "[红包] " + (d.remark || ""); }
      if (type === "pay_for_me") { const d = JSON.parse(raw); return "[代付请求] ￥" + (Number(d.total) || 0).toFixed(2); }
      if (type === "gift") { const d = JSON.parse(raw); return "[礼物] ￥" + (Number(d.total) || 0).toFixed(2); }
      if (type === "call") { const d = JSON.parse(raw); return "[" + (d.type === "video" ? "视频" : "语音") + "通话] " + (d.summary || ""); }
      if (type === "group_poll") { const d = JSON.parse(raw); return "[群投票] " + (d.title || ""); }
      if (type === "social_notice") { const d = JSON.parse(raw); return "[社交动作] " + (d.summary || d.type || ""); }
      if (type === "moment_share") { const d = JSON.parse(raw); return "[转发了朋友圈] " + (d.summary || ""); }
      if (type === "forum_post_share") { const d = JSON.parse(raw); return "[转发了帖子] " + (d.title || ""); }
      if (type === "miniprogram_share") { const d = JSON.parse(raw); return "[小程序] " + (d.mpName || ""); }
      if (type === "withdraw_share") return "[砍一刀链接]";
      if (type === "chat_log_share") return "[聊天记录]";
    } catch (e) { /* 落到默认 */ }
    return "[" + type + "] " + (typeof raw === "string" ? raw.slice(0, 60) : "");
  }

  // ---------------- 打包选中消息 ----------------
  async function buildPayload(msgs, sess) {
    const isGroup = sess.isGroup === 1;
    let group = null;
    if (isGroup) { try { group = await db.groups.get(sess.groupId); } catch (e) {} }

    const userArch = sess.userId ? await db.archives.get(sess.userId) : null;
    const ownerName = sess.customUserName || (userArch && userArch.name) || "我";
    const ownerAvatar = resolveAvatar(sess.customUserAvatar || (userArch && userArch.avatar), ownerName);

    let sourceName = "对话";
    if (isGroup) {
      sourceName = sess.customCharName || (group && group.name) || "群聊";
    } else {
      const charArch = sess.charId ? await db.archives.get(sess.charId) : null;
      sourceName = sess.customCharName || (charArch && charArch.name) || "对方";
    }

    const participants = [];
    const seen = {};
    const rows = [];

    for (const m of msgs) {
      let pname = "系统", pavatar = "", ptype = m.senderType;
      if (m.senderType === "user") {
        pname = ownerName; pavatar = ownerAvatar;
      } else if (m.senderType === "system") {
        pname = "系统"; pavatar = "";
      } else if (Number(m.senderId) === 99999 && isGroup) {
        const bot = (window.groupChatSystem && window.groupChatSystem.resolveBot) ? window.groupChatSystem.resolveBot(group, m) : null;
        pname = bot ? bot.name : "群管家";
        pavatar = bot ? resolveAvatar(bot.avatar, bot.name) : "";
      } else if (isGroup) {
        const arch = await db.archives.get(Number(m.senderId));
        pname = m.senderDisplayName || (arch && arch.name) || "群成员";
        if (m.senderSnapshotId) {
          try {
            const sa = await db.chat_archives.get(m.senderSnapshotId);
            if (sa) { const p = String(sa.customLabel || "").split("-"); pname += "（" + (p.length >= 3 ? p[p.length - 1] : sa.customLabel) + "）"; }
          } catch (e) {}
        }
        pavatar = resolveAvatar(arch && arch.avatar, pname);
      } else {
        const arch = await db.archives.get(Number(m.senderId));
        pname = sess.customCharName || (arch && arch.name) || "对方";
        pavatar = resolveAvatar(sess.customCharAvatar || (arch && arch.avatar), pname);
      }

      const key = ptype + ":" + m.senderId + ":" + pname;
      if (!seen[key]) { seen[key] = 1; participants.push({ name: pname, avatar: pavatar, type: ptype }); }

      rows.push({
        senderType: ptype,
        senderId: m.senderId,
        senderName: pname,
        avatar: pavatar,
        text: messageText(m),
        contentType: m.contentType || "text",
        timestamp: m.timestamp || 0
      });
    }

    return {
      v: 1,
      sourceKind: isGroup ? "group" : "single",
      isGroup: isGroup,
      sourceName: sourceName,
      ownerName: ownerName,
      ownerAvatar: ownerAvatar,
      targetName: "",
      participants: participants,
      count: rows.length,
      exportedAt: Date.now(),
      messages: rows
    };
  }

  // ---------------- 入口：从多选栏点分享 ----------------
  async function openShareTargetPicker() {
    const checked = document.querySelectorAll(".msg-checkbox:checked");
    if (!checked || checked.length === 0) { if (typeof showToast === "function") showToast("请先勾选要分享的消息"); return; }
    if (!activeSessionId) { if (typeof showToast === "function") showToast("当前没有活跃对话"); return; }

    const ids = [];
    checked.forEach(function (chk) {
      const id = Number(chk.getAttribute("data-msg-id"));
      if (id) ids.push(id);
    });
    if (ids.length === 0) { if (typeof showToast === "function") showToast("请先勾选要分享的消息"); return; }

    const sess = await db.sessions.get(activeSessionId);
    if (!sess) return;

    const msgs = [];
    for (const id of ids) {
      const m = await db.messages.get(id);
      if (m) msgs.push(m);
    }
    msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (msgs.length === 0) { if (typeof showToast === "function") showToast("选中的消息已不存在"); return; }

    const payload = await buildPayload(msgs, sess);

    // 同一面具下的其它会话
    const personaId = Number(activeUserPersonaId);
    let sessions = [];
    try { sessions = await db.sessions.where("userId").equals(personaId).toArray(); } catch (e) { sessions = []; }
    sessions = (sessions || []).filter(s => Number(s.id) !== Number(activeSessionId));

    const rowsOut = [];
    for (const s of sessions) {
      let nm = s.customCharName || "对话";
      let grouped = s.isGroup === 1;
      if (grouped) {
        try { const g = await db.groups.get(s.groupId); if (g && !s.customCharName) nm = g.name || nm; } catch (e) {}
      } else if (!s.customCharName && s.charId) {
        try { const a = await db.archives.get(s.charId); if (a) nm = a.name || nm; } catch (e) {}
      }
      rowsOut.push({ id: s.id, name: nm, grouped: grouped, avatar: resolveAvatar(s.customCharAvatar, nm) });
    }

    let body = '<div class="group-sheet-text">即将转发 <b>' + payload.count + '</b> 条来自「' + esc(payload.sourceName) + '」的聊天记录。选择要发给谁：</div>';
    if (rowsOut.length === 0) {
      body += '<div class="group-sheet-empty">同一面具下还没有其它聊天框。<br>先跟别的角色建一个对话，再回来分享吧。</div>';
    } else {
      body += rowsOut.map(r =>
        '<div class="share-target-card" data-sid="' + r.id + '">' +
          '<img src="' + r.avatar + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">' +
          '<span class="stc-name">' + esc(r.name) + '</span>' +
          (r.grouped ? '<span class="group-chip kw">群聊</span>' : '<span class="group-chip">单聊</span>') +
          svg('<polyline points="9 18 15 12 9 6"/>', 14, "#9AA7B8") +
        '</div>'
      ).join("");
    }

    const el = sheet({
      title: "分享聊天记录", icon: ICONS.share, body: body,
      actions: [{ label: "取消", cls: "ghost", onClick: closeSheet }]
    });

    el.querySelectorAll(".share-target-card").forEach(function (card) {
      card.onclick = async function () {
        const sid = Number(card.getAttribute("data-sid"));
        closeSheet();
        await sendTo(sid, payload);
      };
    });
  }

  // ---------------- 发送到目标会话 ----------------
  async function sendTo(targetSessionId, payload) {
    try {
      const targetSess = await db.sessions.get(targetSessionId);
      if (!targetSess) { if (typeof showToast === "function") showToast("目标对话不存在"); return; }

      let targetName = targetSess.customCharName || "对方";
      if (targetSess.isGroup === 1) {
        try { const g = await db.groups.get(targetSess.groupId); if (g && !targetSess.customCharName) targetName = g.name || targetName; } catch (e) {}
      } else if (!targetSess.customCharName && targetSess.charId) {
        try { const a = await db.archives.get(targetSess.charId); if (a) targetName = a.name || targetName; } catch (e) {}
      }
      payload.targetName = targetName;

      const msg = {
        sessionId: targetSessionId,
        senderType: "user",
        senderId: Number(activeUserPersonaId),
        content: JSON.stringify(payload),
        contentType: "chat_log_share",
        timestamp: Date.now()
      };
      msg.id = await db.messages.add(msg);

      try { await db.sessions.update(targetSessionId, { lastMessageTime: Date.now() }); } catch (e) {}

      // 退出多选
      if (typeof exitMultiSelectMode === "function") exitMultiSelectMode();
      if (typeof showToast === "function") showToast("已把 " + payload.count + " 条聊天记录分享给「" + targetName + "」");
      if (typeof renderDialogMessages === "function" && Number(activeSessionId) === Number(targetSessionId)) {
        await renderDialogMessages();
      }
    } catch (e) {
      console.error("[chatlog] 分享失败:", e);
      if (typeof showToast === "function") showToast("分享失败：" + (e && e.message ? e.message : "未知错误"));
    }
  }

  // ---------------- 卡片渲染（气泡内） ----------------
  function buildShareCardHTML(msgId, payload) {
    try {
      if (!payload || !Array.isArray(payload.messages)) {
        return '<div style="font-size:12px;color:var(--text-secondary);">[聊天记录]</div>';
      }
      const who = payload.isGroup ? "群聊" : "单聊";
      const shown = payload.messages.slice(0, 80);
      const lines = shown.map(function (m) {
        const mine = m.senderType === "user";
        return '<div class="chatlog-line">' +
          '<div class="chatlog-line-top">' +
            '<span class="chatlog-line-name' + (mine ? ' is-me' : '') + '">' + esc(m.senderName) + '</span>' +
            '<span>' + esc(fmtTime(m.timestamp)) + '</span>' +
          '</div>' +
          '<div class="chatlog-line-text">' + esc(m.text) + '</div>' +
        '</div>';
      }).join("");

      return '<div class="chatlog-card">' +
        '<div class="chatlog-head">' +
          '<div class="chatlog-head-title">' + svg(ICONS.log, 14, "#4A7DBF") + '聊天记录 · ' + esc(payload.sourceName) + '</div>' +
          '<div class="chatlog-head-sub">' + esc(payload.ownerName) + ' 转发给' + esc(payload.targetName || "你") +
            ' · ' + who + ' · 共 ' + (payload.count || payload.messages.length) + ' 条 · ' + esc(fmtTime(payload.exportedAt)) + '</div>' +
        '</div>' +
        '<div class="chatlog-body">' + (lines || '<div class="group-sheet-empty">（空记录）</div>') + '</div>' +
        '<div class="chatlog-foot"><span>导出于 ' + esc(fmtFull(payload.exportedAt)) + '</span><span>来自「' + esc(payload.sourceName) + '」</span></div>' +
      '</div>';
    } catch (e) {
      return '<div style="font-size:12px;color:var(--text-secondary);">[聊天记录卡片渲染失败]</div>';
    }
  }

  // ---------------- 给目标聊天 AI 的可读摘要 ----------------
  function buildContextSummary(payload) {
    try {
      if (!payload || !Array.isArray(payload.messages)) return "[聊天记录转发]";
      const who = payload.isGroup ? "群聊" : "私聊";
      const people = (payload.participants || []).map(p => p.name).join("、") || "未知";
      const lines = payload.messages.slice(0, 80).map(function (m) {
        return "  [" + fmtTime(m.timestamp) + "] " + m.senderName + "：" + m.text;
      }).join("\n");
      return "【聊天记录转发（重要背景，不是当前对话的内容）】\n" +
        payload.ownerName + " 把 TA 与「" + payload.sourceName + "」的" + who + "聊天记录转发给了你，共 " + (payload.count || payload.messages.length) + " 条，导出于 " + fmtFull(payload.exportedAt) + "。\n" +
        "参与人：" + people + "（其中「" + payload.ownerName + "」是正在和你聊天的这个人）。\n" +
        "以下是这段聊天记录的原文，请理解它讲的是" + payload.ownerName + "和「" + payload.sourceName + "」之间发生的事，据此做出自然反应，但不要把它当作你与" + payload.ownerName + "当前对话的对白格式：\n" +
        lines;
    } catch (e) {
      return "[聊天记录转发]";
    }
  }

  window.chatLogShareSystem = {
    openShareTargetPicker: openShareTargetPicker,
    buildPayload: buildPayload,
    buildShareCardHTML: buildShareCardHTML,
    buildContextSummary: buildContextSummary,
    messageText: messageText,
    sendTo: sendTo,
    _sheet: sheet,
    _closeSheet: closeSheet
  };
})();
