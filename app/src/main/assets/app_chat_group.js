/**
 * ============================================================
 * app_chat_group.js - 叙事诗小手机：群聊控制器全自治业务模型
 * ============================================================
 */
(function() {
  const groupChatSystem = {
    // 1. 初始化入口
    init: async function() {
      const btnNewChat = document.getElementById("btn-new-chat");
      if (btnNewChat) {
        btnNewChat.onclick = () => {
          document.getElementById("new-chat-choice-overlay").classList.add("active");
        };
      }

      // 绑定单聊和群聊选择
      const btnDirect = document.getElementById("btn-choice-direct-chat");
      if (btnDirect) {
        btnDirect.onclick = () => {
          document.getElementById("new-chat-choice-overlay").classList.remove("active");
          this.openDirectChatSelector();
        };
      }

      const btnGroup = document.getElementById("btn-choice-group-chat");
      if (btnGroup) {
        btnGroup.onclick = () => {
          document.getElementById("new-chat-choice-overlay").classList.remove("active");
          this.openGroupChatCreator();
        };
      }

      // 绑定创建群聊提交
      const btnSubmitCreate = document.getElementById("btn-group-create-submit");
      if (btnSubmitCreate) {
        btnSubmitCreate.onclick = () => this.submitGroupCreation();
      }

      // 绑定群头像上传
      const fileAvatarCreate = document.getElementById("file-group-create-avatar");
      const btnUploadCreate = document.getElementById("btn-group-create-avatar-upload");
      if (btnUploadCreate && fileAvatarCreate) {
        btnUploadCreate.onclick = () => fileAvatarCreate.click();
        fileAvatarCreate.onchange = (e) => {
          if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
              document.getElementById("group-create-avatar-url").value = "[本地上传图片]";
              window.tempGroupCreateAvatarBlob = event.target.result;
            };
            reader.readAsDataURL(file);
          }
        };
      }

      this.bindGroupButtons();
    },

    // ============================================================
    // 0. 通用工具：转义 / 图标 / 成员身份键 / 自绘弹层（禁原生弹窗）
    // ============================================================
    _esc: function (s) {
      if (s === null || s === undefined) return "";
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    },

    _svg: function (paths, size, color) {
      size = size || 14;
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle;">' + paths + '</svg>';
    },

    _icon: {
      poll: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-6"/>',
      bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
      bot: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M12 2v2"/><path d="M5 5l1.5 1.5"/><path d="M19 5l-1.5 1.5"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>',
      trash: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
      plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
      archive: '<path d="M21 8H3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2z"/><path d="M10 12h4"/><path d="M19 8v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
      micOff: '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      crown: '<path d="M2 18h20l-2-9-5 4-3-7-3 7-5-4z"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
      logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
      star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
    },

    // 成员身份键：user 与 char 可能共用同一个数字 id，必须带类型区分，否则已读/投票会串号
    memberKey: function (m) { return (m && m.memberType ? m.memberType : "char") + ":" + (m ? m.memberId : 0); },
    isReadBy: function (list, m) {
      if (!Array.isArray(list)) return false;
      return list.indexOf(this.memberKey(m)) >= 0 || list.indexOf(Number(m.memberId)) >= 0;
    },
    addReadBy: function (list, m) {
      if (!Array.isArray(list)) list = [];
      var key = this.memberKey(m);
      if (list.indexOf(key) < 0) list.push(key);
      var legacyIdx = list.indexOf(Number(m.memberId));
      if (legacyIdx >= 0) list.splice(legacyIdx, 1);
      return list;
    },

    // 自绘通用弹层（统一替代原生 alert / confirm / prompt）
    _sheet: function (opts) {
      opts = opts || {};
      var self = this;
      var host = document.getElementById("win-chat") || document.getElementById("phone-container") || document.body;
      var el = document.getElementById("group-sheet-overlay");
      if (!el) {
        el = document.createElement("div");
        el.id = "group-sheet-overlay";
        el.className = "modal-overlay group-sheet-overlay";
        el.addEventListener("click", function (e) { if (e.target === el) self._closeSheet(); });
        host.appendChild(el);
      } else if (el.parentNode !== host) {
        host.appendChild(el);
      }
      var actionsHtml = (opts.actions || []).map(function (a, i) {
        return '<button class="group-sheet-action ' + (a.cls || "") + '" data-idx="' + i + '">' +
          (a.icon ? self._svg(a.icon, 14) : "") + '<span>' + self._esc(a.label) + '</span></button>';
      }).join("");
      el.innerHTML =
        '<div class="modal group-sheet-modal">' +
          '<header class="modal-header group-sheet-header">' +
            '<h4>' + (opts.icon ? self._svg(opts.icon, 16) : "") + self._esc(opts.title || "") + '</h4>' +
            '<button class="btn-icon" id="group-sheet-close">' + self._svg(self._icon.x, 16) + '</button>' +
          '</header>' +
          '<div class="group-sheet-body">' + (opts.body || "") + '</div>' +
          (actionsHtml ? '<div class="group-sheet-actions">' + actionsHtml + '</div>' : "") +
        '</div>';
      el.querySelector("#group-sheet-close").onclick = function () { self._closeSheet(); };
      (opts.actions || []).forEach(function (a, i) {
        var btn = el.querySelector('.group-sheet-action[data-idx="' + i + '"]');
        if (btn) btn.onclick = function () { if (a.onClick) a.onClick(); };
      });
      el.classList.add("active");
      if (typeof opts.onMount === "function") { try { opts.onMount(el); } catch (e) { console.warn(e); } }
      return el;
    },
    _closeSheet: function () {
      var el = document.getElementById("group-sheet-overlay");
      if (el) el.classList.remove("active");
    },
    _confirm: function (title, msg, onOk, okLabel) {
      var self = this;
      this._sheet({
        title: title, icon: this._icon.shield,
        body: '<div class="group-sheet-text">' + self._esc(msg).replace(/\n/g, "<br>") + "</div>",
        actions: [
          { label: "取消", cls: "ghost", onClick: function () { self._closeSheet(); } },
          { label: okLabel || "确认", cls: "danger", onClick: function () { self._closeSheet(); if (onOk) onOk(); } }
        ]
      });
    },
    _prompt: function (title, defaultValue, onOk, placeholder) {
      var self = this;
      this._sheet({
        title: title, icon: this._icon.edit,
        body: '<input type="text" id="group-sheet-input" class="group-sheet-input" value="' + self._esc(defaultValue || "") + '" placeholder="' + self._esc(placeholder || "") + '">',
        actions: [
          { label: "取消", cls: "ghost", onClick: function () { self._closeSheet(); } },
          { label: "保存", cls: "primary", onClick: function () { var v = document.getElementById("group-sheet-input").value; self._closeSheet(); if (onOk) onOk(v); } }
        ]
      });
    },

    // 统一取成员显示名与头像（含对话快照分支的括号标记）
    _memberInfo: async function (m) {
      var name = "未知", avatarUrl = "", groupName = "群友";
      if (m.memberType === 'user') {
        const u = await db.archives.get(m.memberId);
        name = u ? u.name : "我";
        avatarUrl = resolveAvatar(u && u.avatar, u && u.name);
        groupName = "玩家面具";
      } else {
        const c = await db.archives.get(m.memberId);
        name = c ? c.name : "对方";
        avatarUrl = resolveAvatar(c && c.avatar, c && c.name);
        groupName = c ? (c.group || "默认分组") : "群友";
        if (m.sourceArchiveId) {
          try {
            const srcArchive = await db.chat_archives.get(m.sourceArchiveId);
            if (srcArchive) {
              const parts = srcArchive.customLabel.split('-');
              const tag = parts.length >= 3 ? parts[parts.length - 1] : srcArchive.customLabel;
              name = name + '(' + tag + ')';
            }
          } catch (e) {}
        }
      }
      return { name: name, avatar: avatarUrl, groupName: groupName };
    },

    // 解析机器人：优先 senderBotId，回退旧数据的 bots[0]
    resolveBot: function (group, msg) {
      if (!group || !Array.isArray(group.bots) || group.bots.length === 0) return null;
      if (msg && msg.senderBotId) {
        var found = group.bots.find(function (b) { return String(b.id) === String(msg.senderBotId); });
        if (found) return found;
      }
      return group.bots[0] || null;
    },

    // 2. 选择单聊角色
    openDirectChatSelector: async function() {
      const overlay = document.getElementById("new-chat-overlay");
      const list = document.getElementById("new-chat-list");
      if (!overlay || !list) return;
      list.innerHTML = "";

      try {
        const allArchives = await db.archives.toArray();
        const chars = allArchives.filter(c => (c.type === 'character' || c.type === 'npc') && !c.isSnapshot);
        chars.forEach(c => {
          const row = document.createElement("div");
          row.className = "menu-item";
          row.onclick = () => {
            overlay.classList.remove("active");
            startSingleChat(c.id);
          };
          row.innerHTML = `<span>${c.name} (${c.type === 'character' ? '角色' : 'NPC'})</span>`;
          list.appendChild(row);
        });
        overlay.classList.add("active");
      } catch (err) {
        console.error(err);
      }
    },

    // 3. 开启群聊创建表单
    openGroupChatCreator: async function() {
      const overlay = document.getElementById("group-create-overlay");
      const list = document.getElementById("group-create-members-list");
      const ownerSelect = document.getElementById("group-create-owner-select");
      if (!overlay || !list || !ownerSelect) return;

      list.innerHTML = "";
      ownerSelect.innerHTML = '<option value="user">User (我)</option>';
      window.tempGroupCreateAvatarBlob = null;
      document.getElementById("group-create-name").value = "";
      document.getElementById("group-create-avatar-url").value = "";

      try {
        const allArchives = await db.archives.toArray();
        const chars = allArchives.filter(c => (c.type === 'character' || c.type === 'npc') && !c.isSnapshot);

        chars.forEach(c => {
          const opt = document.createElement("option");
          opt.value = `char_${c.id}`;
          opt.innerText = `${c.name} (${c.type === 'character' ? '角色' : 'NPC'})`;
          ownerSelect.appendChild(opt);

          const card = document.createElement("div");
          card.className = "candidate-persona-card";
          card.style.cssText = "background:#ffffff; border:1.5px solid var(--border); border-radius:10px; padding:8px; display:flex; align-items:center; gap:10px; cursor:pointer; margin-bottom:8px;";
          card.innerHTML = `
            <input type="checkbox" class="cb-group-create-member" value="${c.id}" style="width:16px; height:16px; cursor:pointer;">
            <img src="${resolveAvatar(c.avatar)}" style="width:34px; height:34px; border-radius:50%; object-fit:cover;">
            <div style="flex:1; text-align:left;">
              <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${c.name}</div>
              <div style="font-size:10px; color:var(--text-secondary);">${c.remark || "暂无备注"}</div>
            </div>
          `;
          card.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
              const cb = card.querySelector("input");
              cb.checked = !cb.checked;
            }
          };
          list.appendChild(card);
        });

        overlay.classList.add("active");
      } catch (err) {
        console.error(err);
      }
    },

    // 4. 执行群聊数据库落库
    submitGroupCreation: async function() {
      const name = document.getElementById("group-create-name").value.trim();
      const avatarUrlInput = document.getElementById("group-create-avatar-url").value.trim();
      const userJoin = document.getElementById("group-create-user-join").checked;
      const ownerVal = document.getElementById("group-create-owner-select").value;

      if (!name) {
        showToast("请输入群聊名称！");
        return;
      }

      const checkedBoxes = document.querySelectorAll(".cb-group-create-member:checked");
      if (checkedBoxes.length === 0) {
        showToast("请至少选择一位群成员角色！");
        return;
      }

      const avatar = avatarUrlInput === "[本地上传图片]" ? window.tempGroupCreateAvatarBlob : (avatarUrlInput || null);
      
      let ownerId = 0;
      let ownerType = "user";
      if (ownerVal !== "user") {
        ownerId = Number(ownerVal.replace("char_", ""));
        ownerType = "char";
      } else {
        ownerId = Number(activeUserPersonaId);
      }

      try {
        const groupId = await db.groups.add({
          name,
          avatar,
          ownerId,
          ownerType,
          announcement: null,
          bots: []
        });

        if (userJoin) {
          await db.group_members.add({
            groupId,
            memberId: Number(activeUserPersonaId),
            memberType: 'user',
            role: ownerType === 'user' ? 'owner' : 'member',
            muteUntil: 0,
            title: ownerType === 'user' ? '群主' : '',
            syncFromSingle: 1,
            syncToSingle: 1
          });
        }

        for (const cb of checkedBoxes) {
          const charId = Number(cb.value);
          const isOwner = ownerType === 'char' && ownerId === charId;
          await db.group_members.add({
            groupId,
            memberId: charId,
            memberType: 'char',
            role: isOwner ? 'owner' : 'member',
            muteUntil: 0,
            title: isOwner ? '群主' : '',
            syncFromSingle: 1,
            syncToSingle: 1
          });
        }

        const sessId = await db.sessions.add({
          userId: Number(activeUserPersonaId),
          charId: 0, 
          isGroup: 1,
          groupId: groupId,
          customCharName: name,
          customCharAvatar: avatar,
          lastMessageTime: Date.now()
        });

        document.getElementById("group-create-overlay").classList.remove("active");
        showToast("群聊创建成功！");
        openWeChatDialog(sessId);
      } catch (err) {
        console.error(err);
        showToast("创建群聊失败: " + err.message);
      }
    },

    // 5. 进入群聊对话视口
    openGroupDialog: async function(sessionId) {
      activeSessionId = sessionId;
      const sess = await db.sessions.get(sessionId);
      const group = await db.groups.get(sess.groupId);

      activeSessionCharAvatar = sess.customCharAvatar;
      activeSessionUserAvatar = null;

      const memberCount = await db.group_members.where('groupId').equals(group.id).count();
      document.getElementById("dialog-header-title").innerText = `${sess.customCharName} (${memberCount})`;
      document.getElementById("chat-dialog-panel").classList.add("active");

      updateThemeColor("#ededed");
      exitMultiSelectMode();
      updateChatInputLockState(sess);

      // 核心隐藏：进入群聊时，物理隐藏右上角心声状态粉色爱心按钮
      const btnCharStatus = document.getElementById("btn-char-status");
      if (btnCharStatus) btnCharStatus.style.display = "none";

      // 核心支持：探测 User 是否为群成员。若未加入，启动旁观者/上帝视角旁白输入控制
      const myMem = await db.group_members.where('[groupId+memberId+memberType]').equals([group.id, Number(activeUserPersonaId), 'user']).first();
      const inputEl = document.getElementById("dialog-input-text");
      
      if (inputEl) {
        if (!myMem) {
          inputEl.placeholder = "以旁白身份输入环境或剧情推动故事发展...";
          document.getElementById("btn-chat-transfer").style.display = "none";
          document.getElementById("btn-chat-redenvelope").style.display = "none";
          document.getElementById("btn-chat-voice-trigger").style.display = "none";
          document.getElementById("btn-chat-photo").style.display = "none";
        } else {
          inputEl.placeholder = "发送消息...";
          document.getElementById("btn-chat-transfer").style.display = "flex";
          document.getElementById("btn-chat-redenvelope").style.display = "flex";
          document.getElementById("btn-chat-voice-trigger").style.display = "flex";
          document.getElementById("btn-chat-photo").style.display = "flex";
        }
      }

      // 核心解耦三态加号调度：若是群聊，根据 User 是否加入群聊，选择渲染“群聊成员”或“旁白模式”专属按键排布
      if (window.setupExpandPanel) {
        window.setupExpandPanel(myMem ? 'group' : 'narrator');
      }

      // 加载并置顶群公告
      this.renderGroupAnnouncement(group);

      // 群管家定时推送（惰性补推，不依赖常驻定时器）
      try { await this.maybeBotSchedule(); } catch (e) { console.warn(e); }

      // 渲染群消息
      await renderDialogMessages();
    },
    // 6. 顶端群公告面板随动（支持到期自动下架 / 已读进度 / 身份键去撞号）
    renderGroupAnnouncement: async function(group) {
      let stickyBar = document.getElementById("group-announcement-sticky");
      if (stickyBar) stickyBar.remove();

      if (!group || !group.announcement) return;

      const ann = group.announcement;
      // 到期自动下架（不删数据，仅不再展示）
      if (ann.expireAt && Date.now() > ann.expireAt) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const myMember = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const isPrivileged = myMember && (myMember.role === 'owner' || myMember.role === 'admin');
      const isDone = myMember ? this.isReadBy(ann.readBy, myMember) : false;

      const doneCount = members.filter(m => this.isReadBy(ann.readBy, m)).length;
      const progressHtml = isPrivileged
        ? '<span class="group-announcement-progress">' + doneCount + '/' + members.length + '</span>'
        : '';

      let archiveBtnHtml = "";
      if (isPrivileged) {
        archiveBtnHtml = '<button class="group-icon-btn" style="width:26px;height:26px;border:none;background:transparent;" onclick="window.groupChatSystem.archiveAnnouncement(event)" title="下架并归档此置顶公告">' + this._svg(this._icon.archive, 15, "#4A7DBF") + '</button>';
      }

      stickyBar = document.createElement("div");
      stickyBar.id = "group-announcement-sticky";
      stickyBar.className = "group-announcement-sticky-bar";
      stickyBar.innerHTML =
        '<div class="group-announcement-content-area" onclick="window.groupChatSystem.viewAnnouncementDetails()">' +
          '<div class="group-announcement-title" style="display:flex;align-items:center;gap:5px;">' +
            this._svg(this._icon.bell, 13, "#6E96CB") +
            '<span style="overflow:hidden;text-overflow:ellipsis;">置顶公告：' + this._esc(ann.title) + '</span>' +
          '</div>' +
          '<span class="group-announcement-text">' + this._esc(ann.text) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
          progressHtml +
          (myMember && !isDone
            ? '<button class="btn-group-announcement-done" onclick="window.groupChatSystem.markAnnouncementDone(event)">完成</button>'
            : '<span class="group-chip mine">已阅</span>') +
          archiveBtnHtml +
        '</div>';
      document.getElementById("chat-dialog-panel").insertBefore(stickyBar, document.getElementById("dialog-messages-container"));
    },

    markAnnouncementDone: async function(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group || !group.announcement) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const myMember = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      if (!myMember) { showToast("你不在本群，无法标记已阅"); return; }

      const ann = group.announcement;
      ann.readBy = this.addReadBy(ann.readBy, myMember);
      await db.groups.update(group.id, { announcement: ann });

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${myName} 已阅置顶公告：《${ann.title}》`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);

      showToast("群公告已设为完成阅览");
      const fresh = await db.groups.get(group.id);
      this.renderGroupAnnouncement(fresh);
      await renderDialogMessages();
    },

    _publisherName: async function(ann) {
      try {
        const a = await db.archives.get(Number(ann.publisherId));
        const base = a ? a.name : "未知";
        return base + (ann.publisherType === 'user' ? "（玩家）" : "（角色）");
      } catch (e) { return "未知"; }
    },

    viewAnnouncementDetails: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group || !group.announcement) return;

      const ann = group.announcement;
      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const myMember = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const isPrivileged = myMember && (myMember.role === 'owner' || myMember.role === 'admin');

      const pubName = await this._publisherName(ann);
      const expireLine = ann.expireAt
        ? '<div class="group-sheet-row"><span class="gsr-label">有效期至</span><span class="gsr-value">' +
            new Date(ann.expireAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) +
          '</span></div>'
        : '';

      const doneMembers = members.filter(m => this.isReadBy(ann.readBy, m));
      const pct = members.length ? Math.round(doneMembers.length / members.length * 100) : 0;
      let readHtml =
        '<div class="group-sheet-row"><span class="gsr-label">已阅进度</span><span class="gsr-value">' +
          doneMembers.length + ' / ' + members.length + '（' + pct + '%）</span></div>' +
        '<div class="group-poll-progressbar"><div class="group-poll-progressbar-fill" style="width:' + pct + '%;"></div></div>';

      if (isPrivileged) {
        const infos = [];
        for (const m of members) {
          const info = await this._memberInfo(m);
          infos.push({ name: info.name, done: this.isReadBy(ann.readBy, m) });
        }
        const doneNames = infos.filter(x => x.done).map(x => x.name);
        const pendingNames = infos.filter(x => !x.done).map(x => x.name);
        readHtml +=
          '<div class="group-sheet-row" style="flex-direction:column;align-items:flex-start;gap:4px;">' +
            '<span class="gsr-label" style="color:#35867A;">已读（' + doneNames.length + '）</span>' +
            '<span class="gsr-value" style="white-space:normal;line-height:1.6;">' + this._esc(doneNames.join('、') || '无') + '</span></div>' +
          '<div class="group-sheet-row" style="flex-direction:column;align-items:flex-start;gap:4px;">' +
            '<span class="gsr-label" style="color:#C25C7C;">未读（' + pendingNames.length + '）</span>' +
            '<span class="gsr-value" style="white-space:normal;line-height:1.6;">' + this._esc(pendingNames.join('、') || '无') + '</span></div>';
      }

      const actions = [];
      if (isPrivileged) actions.push({ label: "编辑", cls: "primary", icon: this._icon.edit, onClick: () => this.editAnnouncement() });
      actions.push({ label: "关闭", cls: "ghost", onClick: () => this._closeSheet() });

      this._sheet({
        title: ann.title, icon: this._icon.bell,
        body:
          '<div class="group-sheet-text">' + this._esc(ann.text).replace(/\n/g, '<br>') + '</div>' +
          '<div class="group-sheet-row"><span class="gsr-label">发布者</span><span class="gsr-value">' + this._esc(pubName) + '</span></div>' +
          expireLine + readHtml,
        actions: actions
      });
    },

    // 7. 渲染群投票卡片（无 emoji / 单选多选 / 截止到期 / 领先高亮 / 投票名单）
    _votedIn: function (arr, m) {
      if (!Array.isArray(arr)) return false;
      return arr.indexOf(this.memberKey(m)) >= 0 || arr.some(x => Number(x) === Number(m.memberId));
    },
    // 投票诊断：把「谁、什么身份、投了哪一票、结果如何」留一条记录，
    // 自投投不上时无需猜，直接看 window.groupChatSystem.getPollDiag()
    _pollDiag: [],
    _diag: function (stage, payload) {
      try {
        this._pollDiag.push({ t: Date.now(), stage: stage, payload: payload });
        if (this._pollDiag.length > 30) this._pollDiag.shift();
      } catch (e) {}
      try { console.log('[群投票]', stage, payload); } catch (e) {}
    },
    getPollDiag: function () { return this._pollDiag.slice(); },
    _stripMyVote: function (arr, m) {
      const key = this.memberKey(m);
      return (arr || []).filter(x => x !== key && Number(x) !== Number(m.memberId));
    },
    _applyVote: function (poll, m, optionIndex) {
      if (!poll.votes) poll.votes = {};
      const already = this._votedIn(poll.votes[optionIndex], m);
      const wasAny = Object.keys(poll.votes).some(i => this._votedIn(poll.votes[i], m));
      if (poll.multi) {
        if (already) { poll.votes[optionIndex] = this._stripMyVote(poll.votes[optionIndex], m); return 'revoked'; }
        poll.votes[optionIndex] = this._stripMyVote(poll.votes[optionIndex], m);
        poll.votes[optionIndex].push(this.memberKey(m));
        return 'voted';
      }
      Object.keys(poll.votes).forEach(i => { poll.votes[i] = this._stripMyVote(poll.votes[i], m); });
      if (already && wasAny) return 'revoked';
      poll.votes[optionIndex] = poll.votes[optionIndex] || [];
      poll.votes[optionIndex].push(this.memberKey(m));
      return wasAny ? 'changed' : 'voted';
    },
    _pollClosed: function (poll) {
      if (!poll) return true;
      if (poll.status === 'archived') return true;
      if (poll.expireAt && Date.now() > poll.expireAt) return true;
      return false;
    },
    _pollTotal: function (poll) {
      let n = 0;
      Object.keys(poll.votes || {}).forEach(i => { n += (poll.votes[i] || []).length; });
      return n;
    },

    renderPollCardInMsg: async function(m) {
      const cardContainer = document.createElement("div");
      cardContainer.style.cssText = "display:flex; justify-content:center; margin:12px 0; width:100%; box-sizing:border-box; padding:0 12px;";

      try {
        const sess = await db.sessions.get(m.sessionId);
        const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
        // 身份键归一到数字比较：activeUserPersonaId 来自 localStorage，可能是字符串
        // （用 === 直接比 memberId 会静默判定"你不在本群"，投票按钮点不动）
        const myId = Number(activeUserPersonaId);
        const myMember = members.find(mem => Number(mem.memberId) === myId && mem.memberType === 'user');
        const isPrivileged = myMember && (myMember.role === 'owner' || myMember.role === 'admin');

        const poll = JSON.parse(m.content);
        const options = poll.options || [];
        const votes = poll.votes || {};
        const isArchived = poll.status === 'archived';
        const isClosed = this._pollClosed(poll);
        const totalVotes = this._pollTotal(poll);

        // 最高票（领先高亮）
        let maxCount = 0;
        options.forEach((opt, idx) => { maxCount = Math.max(maxCount, (votes[idx] || []).length); });

        let archiveBtnHtml = "";
        if (isPrivileged && !isArchived) {
          archiveBtnHtml = '<button class="group-icon-btn" style="width:26px;height:26px;border:none;background:transparent;" onclick="window.groupChatSystem.archivePoll(' + m.id + ', event)" title="结束并归档本轮投票">' + this._svg(this._icon.archive, 15, "#7C63C9") + '</button>';
        }

        const metaChips =
          '<span class="group-chip" style="background:' + (isClosed ? '#F1F1F5' : '#EDE7FB') + ';color:' + (isClosed ? '#9A93A6' : '#7C63C9') + ';">' +
            (isArchived ? '已归档' : (isClosed ? '已截止' : '进行中')) + '</span>' +
          '<span class="group-chip" style="background:#F4F1F7;color:#8B8496;">' + (poll.multi ? '多选' : '单选') + '</span>' +
          '<span class="group-chip" style="background:#F4F1F7;color:#8B8496;">共 ' + totalVotes + ' 票</span>' +
          (poll.expireAt ? '<span class="group-chip sched">' +
            (Date.now() > poll.expireAt ? '截止于 ' : '至 ') +
            new Date(poll.expireAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span>' : '');

        const card = document.createElement("div");
        card.className = "group-poll-card";
        card.innerHTML =
          '<div class="group-poll-card-title">' +
            '<div class="gpc-left">' + this._svg(this._icon.poll, 15, "#7C63C9") + '<span>' + this._esc(poll.title) + '</span></div>' +
            archiveBtnHtml +
          '</div>' +
          '<div class="group-poll-card-meta">' + metaChips + '</div>';

        options.forEach((opt, idx) => {
          const optVotes = votes[idx] || [];
          const pct = totalVotes > 0 ? Math.round((optVotes.length / totalVotes) * 100) : 0;
          const isMine = myMember ? this._votedIn(optVotes, myMember) : false;
          const isLeading = maxCount > 0 && optVotes.length === maxCount;

          const row = document.createElement("div");
          row.className = "group-poll-option-row" +
            (isMine ? " is-mine" : "") +
            (isLeading ? " is-leading" : "") +
            (isClosed ? " is-archived" : "");
          row.innerHTML =
            '<div class="group-poll-option-header">' +
              '<span class="gpo-label">' + (idx + 1) + '. ' + this._esc(opt) + '</span>' +
              '<span class="gpo-count">' + optVotes.length + ' 票 · ' + pct + '%</span>' +
            '</div>' +
            '<div class="group-poll-progressbar"><div class="group-poll-progressbar-fill" style="width:' + pct + '%;"></div></div>';
          if (!isClosed) row.onclick = () => this.voteInPoll(m.id, idx);
          card.appendChild(row);
        });

        card.innerHTML +=
          '<div class="group-poll-foot">' +
            '<span>' + (myMember ? (poll.multi ? '可多选，再次点击取消' : '再次点击可撤销投票') : '你不在本群，无法投票') + '</span>' +
            '<button class="gpf-btn" onclick="window.groupChatSystem.openPollDetail(' + m.id + ')">投票名单</button>' +
          '</div>';

        cardContainer.appendChild(card);
      } catch(e) {
        console.error("[Group] 投票卡渲染失败:", e);
        cardContainer.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:11px;">投票卡片加载错误</p>';
      }
      return cardContainer;
    },

    voteInPoll: async function(msgId, optionIndex) {
      const msg = await db.messages.get(Number(msgId));
      if (!msg) return;

      try {
        const sex = await db.sessions.get(msg.sessionId);
        const members = await db.group_members.where('groupId').equals(sex.groupId).toArray();
        // 身份键归一到数字比较（原因同 renderPollCardInMsg）
        const myId = Number(activeUserPersonaId);
        const myMember = members.find(m => Number(m.memberId) === myId && m.memberType === 'user');
        if (!myMember) {
          this._diag('vote:not-in-group', {
            msgId: msg.id, activeUserPersonaId: activeUserPersonaId, myId: myId,
            groupId: sex && sex.groupId,
            memberIds: members.map(m => m.memberType + ':' + m.memberId)
          });
          showToast("你不在本群，无法投票"); return;
        }

        const poll = JSON.parse(msg.content);
        if (this._pollClosed(poll)) {
          this._diag('vote:poll-closed', { msgId: msg.id, status: poll.status, expireAt: poll.expireAt, now: Date.now() });
          showToast("该投票已截止或归档，无法继续投票"); return;
        }

        this._diag('vote:before', {
          msgId: msg.id, optionIndex: optionIndex, me: this.memberKey(myMember),
          multi: !!poll.multi, options: poll.options, votes: poll.votes
        });
        const result = this._applyVote(poll, myMember, optionIndex);
        this._diag('vote:result', { result: result, votes: poll.votes });
        await db.messages.update(msg.id, { content: JSON.stringify(poll) });

        const myUser = await db.archives.get(Number(activeUserPersonaId));
        const myName = myUser ? myUser.name : "User";
        let verb = "参与了投票，投给了";
        if (result === 'revoked') verb = "撤销了投票（原投给";
        else if (result === 'changed') verb = "改投给了";
        const sysMsg = {
          sessionId: msg.sessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] ${myName} ${verb}【${poll.options[optionIndex]}】${result === 'revoked' ? '）' : ''}`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast(result === 'revoked' ? "已撤销投票" : (result === 'changed' ? "已改票" : "投票成功"));
        await renderDialogMessages();
      } catch(e) {
        console.error(e);
      }
    },

    openPollDetail: async function(msgId) {
      const msg = await db.messages.get(Number(msgId));
      if (!msg) return;
      const poll = JSON.parse(msg.content);
      const sess = await db.sessions.get(msg.sessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const byKey = {};
      members.forEach(m => { byKey[this.memberKey(m)] = m; });

      const options = poll.options || [];
      const votes = poll.votes || {};
      const total = this._pollTotal(poll);

      let body = '<div class="group-sheet-row"><span class="gsr-label">总票数</span><span class="gsr-value">' + total + ' 票（' + (poll.multi ? '多选' : '单选') + '）</span></div>';
      if (poll.expireAt) {
        body += '<div class="group-sheet-row"><span class="gsr-label">截止时间</span><span class="gsr-value">' +
          new Date(poll.expireAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span></div>';
      }
      for (let idx = 0; idx < options.length; idx++) {
        const arr = votes[idx] || [];
        const names = [];
        for (const v of arr) {
          const mem = byKey[v] || members.find(x => Number(x.memberId) === Number(v));
          if (mem) { const info = await this._memberInfo(mem); names.push(info.name); }
        }
        const pct = total > 0 ? Math.round(arr.length / total * 100) : 0;
        body +=
          '<div class="group-sheet-row" style="flex-direction:column;align-items:flex-start;gap:6px;">' +
            '<div style="display:flex;justify-content:space-between;width:100%;gap:8px;">' +
              '<span class="gsr-label">' + (idx + 1) + '. ' + this._esc(options[idx]) + '</span>' +
              '<span class="gsr-value">' + arr.length + ' 票 · ' + pct + '%</span>' +
            '</div>' +
            '<div class="group-poll-progressbar" style="width:100%;"><div class="group-poll-progressbar-fill" style="width:' + pct + '%;"></div></div>' +
            '<span class="gsr-value" style="white-space:normal;line-height:1.6;">' + this._esc(names.join('、') || '暂无') + '</span>' +
          '</div>';
      }

      this._sheet({
        title: poll.title, icon: this._icon.poll,
        body: body,
        actions: [{ label: "关闭", cls: "ghost", onClick: () => this._closeSheet() }]
      });
    },

    // 8. 绑定扩展栏按键行为
    bindGroupButtons: function() {
      // 投票发布弹窗
      const btnPoll = document.getElementById("btn-chat-group-poll");
      if (btnPoll) {
        btnPoll.onclick = () => {
          document.getElementById("chat-expand-panel").classList.remove("active");
          document.getElementById("group-poll-overlay").classList.add("active");
        };
      }

      const btnPollSubmit = document.getElementById("btn-group-poll-submit");
      if (btnPollSubmit) {
        btnPollSubmit.onclick = () => this.submitGroupPoll();
      }

      // 成员管理
      const btnMembers = document.getElementById("btn-chat-group-members");
      if (btnMembers) {
        btnMembers.onclick = () => {
          document.getElementById("chat-expand-panel").classList.remove("active");
          this.openGroupMembersManager();
        };
      }

      // 机器人群助手（多机器人管理台）
      const btnHelper = document.getElementById("btn-chat-group-helper");
      if (btnHelper) {
        btnHelper.onclick = () => {
          document.getElementById("chat-expand-panel").classList.remove("active");
          this.openGroupBotsManager();
        };
      }

      // 公告历史入口
      const btnAnnHistory = document.getElementById("btn-group-announce-history");
      if (btnAnnHistory) {
        btnAnnHistory.onclick = () => {
          document.getElementById("group-details-panel").classList.remove("active");
          this.openAnnouncementHistory();
        };
      }

      const btnSaveBot = document.getElementById("btn-group-bot-save");
      if (btnSaveBot) {
        btnSaveBot.onclick = () => this.saveGroupBot();
      }

      // 置顶公告发布
      const btnAnnounce = document.getElementById("btn-chat-group-announce");
      if (btnAnnounce) {
        btnAnnounce.onclick = () => {
          document.getElementById("chat-expand-panel").classList.remove("active");
          this.openGroupAnnounceForm();
        };
      }

      const btnAnnounceSubmit = document.getElementById("btn-group-announce-submit");
      if (btnAnnounceSubmit) {
        btnAnnounceSubmit.onclick = () => this.submitGroupAnnouncement();
      }

      // 右上角群后台拦截
      const btnDetails = document.getElementById("btn-dialog-details");
      if (btnDetails) {
        btnDetails.addEventListener("click", (e) => {
          db.sessions.get(activeSessionId).then(sess => {
            if (sess && sess.isGroup === 1) {
              e.preventDefault();
              e.stopPropagation();
              window.groupChatSystem.openGroupDetailsPanel();
            }
          });
        }, true);
      }

      const btnSaveGroupDetails = document.getElementById("btn-group-details-save");
      if (btnSaveGroupDetails) {
        btnSaveGroupDetails.onclick = () => this.saveGroupDetails();
      }

      const btnClearGroup = document.getElementById("btn-group-details-clear");
      if (btnClearGroup) {
        btnClearGroup.onclick = () => {
          showCustomConfirm("清空群聊天记录", "确定要清空本群里的所有聊天气泡记录吗？此操作不可逆！", async () => {
            await db.messages.where('sessionId').equals(activeSessionId).delete();
            showToast("群聊天记录已成功清空。");
            document.getElementById("group-details-panel").classList.remove("active");
            await renderDialogMessages();
          });
        };
      }

      const btnDeleteGroup = document.getElementById("btn-group-details-delete");
      if (btnDeleteGroup) {
        btnDeleteGroup.onclick = () => {
          showCustomConfirm("解散群聊", "确定要解散并永久删除此群聊吗？操作不可撤回！", async () => {
            const sess = await db.sessions.get(activeSessionId);
            await db.messages.where('sessionId').equals(activeSessionId).delete();
            await db.groups.delete(sess.groupId);
            await db.group_members.where('groupId').equals(sess.groupId).delete();
            await db.sessions.delete(activeSessionId);
            showToast("本群聊已成功解散。");
            document.getElementById("group-details-panel").classList.remove("active");
            closeChatDialog();
          });
        };
      }
    },

    submitGroupPoll: async function() {
      const title = document.getElementById("group-poll-title").value.trim();
      const optionsText = document.getElementById("group-poll-options").value.trim();

      if (!title || !optionsText) {
        showToast("请填写完整的投票主题与选项！");
        return;
      }

      const options = optionsText.split('\n').map(o => o.trim()).filter(Boolean);
      if (options.length < 2) {
        showToast("投票至少应该包含 2 个以上的备选项！");
        return;
      }
      if (options.length > 12) {
        showToast("备选项最多 12 个");
        return;
      }

      const multiEl = document.getElementById("group-poll-multi");
      const deadlineEl = document.getElementById("group-poll-deadline");
      const multi = !!(multiEl && multiEl.checked);
      const deadlineMin = deadlineEl ? (parseInt(deadlineEl.value, 10) || 0) : 0;

      const pollData = {
        title,
        options,
        votes: {},
        multi: multi,
        expireAt: deadlineMin > 0 ? Date.now() + deadlineMin * 60 * 1000 : 0
      };

      const msg = {
        sessionId: activeSessionId,
        senderType: 'user',
        senderId: Number(activeUserPersonaId),
        content: JSON.stringify(pollData),
        contentType: 'group_poll',
        timestamp: Date.now()
      };
      await db.messages.add(msg);

      document.getElementById("group-poll-overlay").classList.remove("active");
      if (document.getElementById("group-poll-title")) document.getElementById("group-poll-title").value = "";
      if (document.getElementById("group-poll-options")) document.getElementById("group-poll-options").value = "";
      if (multiEl) multiEl.checked = false;
      if (deadlineEl) deadlineEl.value = "0";
      showToast("投票发布上屏成功！");
      await renderDialogMessages();
    },

    // 9. 群助手 / 机器人（支持多个：列表 / 新增 / 编辑 / 启停 / 删除 / 冷却）
    _ensureBotIds: async function(group) {
      if (!group || !Array.isArray(group.bots)) return group;
      let changed = false;
      group.bots.forEach((b, i) => { if (!b.id) { b.id = 'bot_' + (Date.now() + i); changed = true; } });
      if (changed) { try { await db.groups.update(group.id, { bots: group.bots }); } catch (e) {} }
      return group;
    },

    openGroupBotsManager: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group) return;
      const bots = Array.isArray(group.bots) ? group.bots : [];

      let body = '';
      if (bots.length === 0) {
        body = '<div class="group-sheet-empty">还没有机器人。<br>点下方「新增机器人」引入一个群管家：支持入群欢迎、关键词回复、定时推送、签到养成。</div>';
      } else {
        body = bots.map((raw) => {
          const bot = this._botDef(raw);
          const cmds = (bot.commands || '').split('\n').map(x => x.trim()).filter(Boolean);
          const trig = bot.triggerMode === 'keyword' ? '仅关键词' : (bot.triggerMode === 'both' ? '@或关键词' : '@触发');
          const kws = String(bot.keywords || '').split(/[,，|｜]/).map(x => x.trim()).filter(Boolean);
          const chips =
            '<span class="group-chip bot">' + this._svg(this._icon.bot, 10) + '管家</span>' +
            (bot.enabled === false ? '<span class="group-chip off">已停用</span>' : '') +
            '<span class="group-chip kw">' + trig + (kws.length ? '：' + this._esc(kws.slice(0, 2).join('/')) : '') + '</span>' +
            (bot.growth.enabled !== false ? '<span class="group-chip growth">养成·' + this._esc(bot.growth.unit) + '</span>' : '') +
            (bot.scheduleSec > 0 ? '<span class="group-chip sched">定时 ' + bot.scheduleSec + 's</span>' : '') +
            (bot.welcome ? '<span class="group-chip mine">欢迎语</span>' : '');
          return '<div class="group-list-card' + (bot.enabled === false ? ' is-off' : '') + '" style="cursor:pointer;" onclick="window.groupChatSystem.openBotStatsSheet(\'' + bot.id + '\')">' +
            '<img src="' + resolveAvatar(bot.avatar, bot.name) + '" style="width:38px;height:38px;border-radius:50%;object-fit:cover;">' +
            '<div class="glc-main">' +
              '<div class="glc-title">' + this._esc(bot.name) + chips + '</div>' +
              '<div class="glc-sub">快捷命令 ' + cmds.length + ' 条' + (bot.cooldownSec > 0 ? ' · 冷却 ' + bot.cooldownSec + 's' : '') + ' · 点卡片看养成数据</div>' +
            '</div>' +
            '<button class="group-icon-btn" title="' + (bot.enabled === false ? '启用' : '停用') + '" onclick="event.stopPropagation();window.groupChatSystem.toggleGroupBot(\'' + bot.id + '\')">' + this._svg(bot.enabled === false ? this._icon.x : this._icon.check, 14) + '</button>' +
            '<button class="group-icon-btn" title="编辑" onclick="event.stopPropagation();window.groupChatSystem.openGroupHelperSetup(\'' + bot.id + '\')">' + this._svg(this._icon.edit, 14) + '</button>' +
            '<button class="group-icon-btn danger" title="删除" onclick="event.stopPropagation();window.groupChatSystem.deleteGroupBot(\'' + bot.id + '\')">' + this._svg(this._icon.trash, 14) + '</button>' +
          '</div>';
        }).join('');
      }

      this._sheet({
        title: '群助手 · 机器人', icon: this._icon.bot, body: body,
        actions: [
          { label: '新增机器人', cls: 'primary', icon: this._icon.plus, onClick: () => this.openGroupHelperSetup(null) },
          { label: '关闭', cls: 'ghost', onClick: () => this._closeSheet() }
        ]
      });
    },

    openGroupHelperSetup: async function(botId) {
      const sess = await db.sessions.get(activeSessionId);
      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group) return;

      const raw = (Array.isArray(group.bots) && botId)
        ? group.bots.find(b => String(b.id) === String(botId))
        : null;
      const editing = !!raw;
      const b = this._botDef(raw || {
        name: '',
        commands: '起名 | @Sender 你的小鸡【VALUE】正在吃草！\n签到 | @Sender 签到成功！',
        persona: '',
        cooldownSec: 3,
        growth: { enabled: true }
      });

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

      set('group-bot-id', editing ? b.id : '');
      set('group-bot-name', b.name || '');
      set('group-bot-avatar', b.avatar || '');
      set('group-bot-persona', b.persona || '');
      set('group-bot-commands', b.commands || '');
      set('group-bot-cooldown', String(Number(b.cooldownSec) || 0));
      set('group-bot-trigger', b.triggerMode || 'at');
      set('group-bot-keywords', b.keywords || '');
      set('group-bot-welcome', b.welcome || '');
      set('group-bot-schedule-sec', String(Number(b.scheduleSec) || 0));
      set('group-bot-schedule-text', b.scheduleText || '');
      chk('group-bot-growth-enabled', b.growth.enabled !== false);
      set('group-bot-unit', b.growth.unit || '小鱼干');
      set('group-bot-sign-points', String(Number(b.growth.signPoints) || 5));
      set('group-bot-feed-points', String(Number(b.growth.feedPoints) || 3));
      set('group-bot-exp', String(Number(b.growth.expPerAction) || 2));
      set('group-bot-level-step', String(Number(b.growth.levelStep) || 20));
      set('group-bot-feed-items', b.growth.feedItems || '');
      set('group-bot-sign-tpl', b.growth.signTpl || '');
      set('group-bot-feed-tpl', b.growth.feedTpl || '');
      set('group-bot-pat-tpl', b.growth.patTpl || '');

      const titleEl = document.getElementById('group-helper-title');
      if (titleEl) titleEl.innerText = editing ? '编辑机器人' : '引入机器人';
      const overlay = document.getElementById('group-helper-overlay');
      if (overlay) overlay.classList.add('active');
    },

    saveGroupBot: async function() {
      const val = (id, d) => { const el = document.getElementById(id); return el ? el.value : (d === undefined ? '' : d); };
      const isChk = (id) => { const el = document.getElementById(id); return !!(el && el.checked); };
      const numOr = (id, d) => { const n = parseInt(val(id), 10); return isFinite(n) ? n : d; };

      const idVal = val('group-bot-id');
      const name = val('group-bot-name').trim();
      if (!name) { showToast("请填写机器人名称！"); return; }

      const sess = await db.sessions.get(activeSessionId);
      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group) return;
      if (!Array.isArray(group.bots)) group.bots = [];

      const dup = group.bots.find(x => x.name === name && String(x.id) !== String(idVal));
      if (dup) { showToast("已存在同名机器人，请换一个名字"); return; }

      const patch = {
        name: name,
        avatar: val('group-bot-avatar').trim(),
        persona: val('group-bot-persona').trim(),
        commands: val('group-bot-commands').trim(),
        cooldownSec: Math.max(0, numOr('group-bot-cooldown', 0)),
        triggerMode: val('group-bot-trigger', 'at') || 'at',
        keywords: val('group-bot-keywords').trim(),
        welcome: val('group-bot-welcome').trim(),
        scheduleSec: Math.max(0, numOr('group-bot-schedule-sec', 0)),
        scheduleText: val('group-bot-schedule-text').trim(),
        growth: {
          enabled: isChk('group-bot-growth-enabled'),
          unit: val('group-bot-unit').trim() || '小鱼干',
          signPoints: Math.max(0, numOr('group-bot-sign-points', 5)),
          signStreakBonus: 2,
          feedPoints: Math.max(0, numOr('group-bot-feed-points', 3)),
          expPerAction: Math.max(0, numOr('group-bot-exp', 2)),
          levelStep: Math.max(5, numOr('group-bot-level-step', 20)),
          feedItems: val('group-bot-feed-items').trim(),
          signTpl: val('group-bot-sign-tpl').trim(),
          feedTpl: val('group-bot-feed-tpl').trim(),
          patTpl: val('group-bot-pat-tpl').trim(),
          statTpl: val('group-bot-stat-tpl').trim()
        }
      };

      if (idVal) {
        const idx = group.bots.findIndex(x => String(x.id) === String(idVal));
        if (idx >= 0) group.bots[idx] = Object.assign({}, group.bots[idx], patch);
      } else {
        group.bots.push(Object.assign({ id: 'bot_' + Date.now(), enabled: true }, patch));
      }

      await db.groups.update(group.id, { bots: group.bots });
      const overlay = document.getElementById('group-helper-overlay');
      if (overlay) overlay.classList.remove("active");
      showToast(idVal ? "机器人已更新" : ("机器人已部署，发 @" + name + " 即可互动"));
      this.openGroupBotsManager();
    },

    toggleGroupBot: async function(botId) {
      const sess = await db.sessions.get(activeSessionId);
      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group || !Array.isArray(group.bots)) return;
      const bot = group.bots.find(b => String(b.id) === String(botId));
      if (!bot) return;
      bot.enabled = bot.enabled === false;
      await db.groups.update(group.id, { bots: group.bots });
      showToast(bot.enabled ? ("已启用 " + bot.name) : ("已停用 " + bot.name));
      this.openGroupBotsManager();
    },

    deleteGroupBot: async function(botId) {
      const sess = await db.sessions.get(activeSessionId);
      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group || !Array.isArray(group.bots)) return;
      const bot = group.bots.find(b => String(b.id) === String(botId));
      if (!bot) return;
      this._confirm("删除机器人", "确定要删除机器人「" + bot.name + "」吗？删除后 @ 它将不再有反应。", async () => {
        const g = await db.groups.get(sess.groupId);
        g.bots = (g.bots || []).filter(b => String(b.id) !== String(botId));
        await db.groups.update(g.id, { bots: g.bots });
        showToast("机器人已删除");
        this.openGroupBotsManager();
      }, "删除");
    },

    // ============================================================
    // 9.5 群管家内核（对标 QQ 群管家 + 养成类机器人）
    //     入群欢迎 / 关键词自动回复 / 定时推送 / 签到积分养成 / 帮助菜单
    // ============================================================
    _hhmm: function () {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },
    _today: function () { return new Date().toISOString().slice(0, 10); },

    // 兼容旧数据的默认值（不写库，仅运行时补全）
    _botDef: function (b) {
      b = b || {};
      const growth = Object.assign({
        enabled: true,
        unit: '小鱼干',
        signPoints: 5,
        signStreakBonus: 2,
        feedPoints: 3,
        expPerAction: 2,
        levelStep: 20,
        feedItems: '小鱼干, 冻干, 罐头',
        signTpl: '',
        feedTpl: '',
        patTpl: '',
        statTpl: ''
      }, b.growth || {});
      return {
        id: b.id,
        name: b.name || '群助手',
        avatar: b.avatar || '',
        persona: b.persona || '',
        commands: b.commands || '',
        enabled: b.enabled !== false,
        cooldownSec: Math.max(0, Number(b.cooldownSec) || 0),
        triggerMode: b.triggerMode || 'at',          // at | keyword | both
        keywords: b.keywords || '',
        welcome: b.welcome || '',
        scheduleSec: Math.max(0, Number(b.scheduleSec) || 0),
        scheduleText: b.scheduleText || '',
        lastPushAt: Number(b.lastPushAt) || 0,
        growth: growth
      };
    },

    _growthOf: function (member, botId) {
      if (!member.botStats || typeof member.botStats !== 'object') member.botStats = {};
      let s = member.botStats[botId];
      if (!s || typeof s !== 'object') s = { points: 0, exp: 0, level: 1, lastSignDay: '', streak: 0, feeds: 0, pats: 0 };
      s.points = Number(s.points) || 0;
      s.exp = Number(s.exp) || 0;
      s.level = Math.max(1, Number(s.level) || 1);
      s.streak = Number(s.streak) || 0;
      s.feeds = Number(s.feeds) || 0;
      s.pats = Number(s.pats) || 0;
      s.lastSignDay = s.lastSignDay || '';
      member.botStats[botId] = s;
      return s;
    },

    _addExp: function (s, growth, amount) {
      s.exp += amount;
      const step = Math.max(5, Number(growth.levelStep) || 20);
      let leveled = 0;
      while (s.exp >= s.level * step) { s.exp -= s.level * step; s.level++; leveled++; }
      return leveled;
    },

    // 模板渲染：支持 {var}、中文别名【POINTS】等、以及 || 随机分支
    _fillTpl: function (tpl, vars) {
      if (!tpl) return '';
      let out = String(tpl);
      if (out.indexOf('||') >= 0) {
        const parts = out.split('||').map(x => x.trim()).filter(Boolean);
        out = parts[Math.floor(Math.random() * parts.length)] || '';
      }
      Object.keys(vars).forEach(k => { out = out.split('{' + k + '}').join(vars[k]); });
      return out
        .replace(/【VALUE】/g, vars.value || '无').replace(/\[VALUE\]/g, vars.value || '无')
        .replace(/【POINTS】/g, vars.points).replace(/【LEVEL】/g, vars.level)
        .replace(/【EXP】/g, vars.exp).replace(/【UNIT】/g, vars.unit)
        .replace(/【BOT】/g, vars.bot).replace(/【TIME】/g, vars.time)
        .replace(/【DATE】/g, vars.date).replace(/【STREAK】/g, vars.streak)
        .replace(/@Sender/g, '@' + vars.user);
    },

    _botHelp: function (bot) {
      const g = bot.growth || {};
      const cmds = (bot.commands || '').split('\n').map(l => l.split('|')[0].trim()).filter(Boolean);
      const lines = ['【' + bot.name + ' · 功能菜单】', '@' + bot.name + ' + 下面的词即可'];
      if (g.enabled !== false) {
        lines.push('· 签到 / 打卡　每日一次，赚' + (g.unit || '小鱼干'));
        lines.push('· 投喂 xx　喂点东西，加' + (g.unit || '小鱼干') + '与经验');
        lines.push('· 撸一把 / 摸摸　互动涨经验');
        lines.push('· 状态 / 我的　查看我的养成数据');
        lines.push('· 排行 / 榜单　看看谁最勤快');
      }
      if (cmds.length) lines.push('· 自定义：' + cmds.join('、'));
      return lines.join('\n');
    },

    // 养成类内置命令；返回 null 表示不是内置命令
    _builtinBotCommand: async function (bot, member, cmdBody, senderName) {
      const g = bot.growth || {};
      if (g.enabled === false) return null;
      const s = this._growthOf(member, bot.id);
      const unit = g.unit || '小鱼干';
      const head = String(cmdBody || '').trim();
      const headWord = (head.split(/\s+/)[0] || '').trim();
      const value = head.replace(headWord, '').replace(/^[:：\s]+/, '').trim();
      const baseVars = {
        user: senderName, bot: bot.name, unit: unit, value: value,
        points: s.points, level: s.level, exp: s.exp, streak: s.streak,
        time: this._hhmm(), date: this._today()
      };

      if (/^(帮助|菜单|help|命令|功能)$/i.test(headWord)) {
        return { text: this._botHelp(bot) };
      }

      if (/^(签到|打卡)$/.test(headWord)) {
        const today = this._today();
        if (s.lastSignDay === today) {
          return { text: '@' + senderName + ' 今天已经签过到啦，明天再来～' };
        }
        const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        s.streak = (s.lastSignDay === yest) ? (s.streak + 1) : 1;
        s.lastSignDay = today;
        const gain = (Number(g.signPoints) || 5) + (s.streak > 1 ? (Number(g.signStreakBonus) || 0) * (s.streak - 1) : 0);
        s.points += gain;
        const lv = this._addExp(s, g, Number(g.expPerAction) || 2);
        await db.group_members.put(member);
        const tpl = g.signTpl || '{user} 签到成功！连续 {streak} 天，获得 {gain} 个{unit}，现有 {points} 个，等级 Lv.{level}';
        return { text: this._fillTpl(tpl, Object.assign({}, baseVars, { points: s.points, level: s.level, exp: s.exp, streak: s.streak, gain: gain })) + (lv ? '（升级到 Lv.' + s.level + '！）' : '') };
      }

      if (/^(投喂|喂食|喂饭|喂猫|喂|投食)$/.test(headWord)) {
        const pool = String(g.feedItems || '').split(/[,，|｜]/).map(x => x.trim()).filter(Boolean);
        const item = value || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : '好吃的');
        const gain = Number(g.feedPoints) || 3;
        s.points += gain;
        s.feeds++;
        const lv = this._addExp(s, g, Number(g.expPerAction) || 2);
        await db.group_members.put(member);
        const tpl = g.feedTpl || '{user} 投喂了一份{value}，{bot} 吃得很香！获得 {gain} 个{unit}，现有 {points} 个';
        return { text: this._fillTpl(tpl, Object.assign({}, baseVars, { value: item, points: s.points, level: s.level, exp: s.exp, gain: gain })) + (lv ? '（升级到 Lv.' + s.level + '！）' : '') };
      }

      if (/^(撸一把|撸猫|摸摸|摸|rua|撸)$/i.test(headWord)) {
        const gain = 1;
        s.pats++;
        const lv = this._addExp(s, g, Number(g.expPerAction) || 2);
        await db.group_members.put(member);
        const tpl = g.patTpl || '{user} 撸了{bot} 一把，它舒服地眯起眼睛。经验 +{gain}，等级 Lv.{level}';
        return { text: this._fillTpl(tpl, Object.assign({}, baseVars, { points: s.points, level: s.level, exp: s.exp, gain: gain })) + (lv ? '（升级到 Lv.' + s.level + '！）' : '') };
      }

      if (/^(状态|我的|我的猫|数据|面板)$/.test(headWord)) {
        const step = Math.max(5, Number(g.levelStep) || 20);
        const need = s.level * step;
        const tpl = g.statTpl || '';
        if (tpl) return { text: this._fillTpl(tpl, Object.assign({}, baseVars, { points: s.points, level: s.level, exp: s.exp, need: need })) };
        return { text: '@' + senderName + ' 的养成数据\n· ' + unit + '：' + s.points + '\n· 等级：Lv.' + s.level + '（经验 ' + s.exp + '/' + need + '）\n· 连续签到：' + s.streak + ' 天\n· 已投喂 ' + s.feeds + ' 次 · 已撸 ' + s.pats + ' 次' };
      }

      if (/^(排行|榜单|排行榜|排名)$/.test(headWord)) {
        const members = await db.group_members.where('groupId').equals(member.groupId).toArray();
        const rows = [];
        for (const m of members) {
          const st = (m.botStats && m.botStats[bot.id]) ? m.botStats[bot.id] : null;
          if (!st) continue;
          const info = await this._memberInfo(m);
          rows.push({ name: info.name, points: Number(st.points) || 0, level: Number(st.level) || 1, isMe: m.id === member.id });
        }
        rows.sort((a, b) => b.points - a.points || b.level - a.level);
        if (rows.length === 0) return { text: '@' + senderName + ' 还没有人开始养成，你先来签到吧～' };
        const top = rows.slice(0, 5).map((r, i) => (i + 1) + '. ' + r.name + '　' + r.points + ' 个 · Lv.' + r.level).join('\n');
        const mine = rows.findIndex(r => r.isMe);
        return { text: '【' + bot.name + ' · ' + unit + '排行榜】\n' + top + (mine >= 0 ? '\n\n你目前排在第 ' + (mine + 1) + ' 名' : '') };
      }

      return null;
    },

    // 入群欢迎（邀请成功 / 建群时由调用方触发）
    sendBotWelcome: async function (group, member, senderName) {
      if (!group || !Array.isArray(group.bots) || group.bots.length === 0) return;
      const labels = [];
      for (const raw of group.bots) {
        const bot = this._botDef(raw);
        if (!bot.enabled || !bot.welcome) continue;
        labels.push(this._fillTpl(bot.welcome, {
          user: senderName, bot: bot.name, unit: bot.growth.unit, value: '',
          points: 0, level: 1, exp: 0, streak: 0, time: this._hhmm(), date: this._today()
        }));
      }
      if (labels.length === 0) return;
      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: labels.join('\n'),
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      return sysMsg;
    },

    // 定时推送：惰性补推（进入群 / 发完消息时检查），避免常驻定时器
    maybeBotSchedule: async function () {
      try {
        const sess = await db.sessions.get(activeSessionId);
        if (!sess || sess.isGroup !== 1) return false;
        const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
        if (!group || !Array.isArray(group.bots) || group.bots.length === 0) return false;

        const now = Date.now();
        let changed = false;
        let lastPushed = null;
        for (const raw of group.bots) {
          const bot = this._botDef(raw);
          if (!bot.enabled || !bot.scheduleText || bot.scheduleSec <= 0) continue;
          if (raw.lastPushAt && now - raw.lastPushAt < bot.scheduleSec * 1000) continue;
          const text = this._fillTpl(bot.scheduleText, {
            user: '大家', bot: bot.name, unit: bot.growth.unit, value: '',
            points: 0, level: 1, exp: 0, streak: 0, time: this._hhmm(), date: this._today()
          });
          if (!text) continue;
          raw.lastPushAt = now;
          changed = true;
          lastPushed = { botId: raw.id, name: bot.name, text: text };
        }
        if (changed) await db.groups.update(group.id, { bots: group.bots });
        if (!lastPushed) return false;

        const msg = {
          sessionId: activeSessionId,
          senderType: 'char',
          senderId: 99999,
          senderBotId: lastPushed.botId,
          content: lastPushed.text,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(msg);
        return true;
      } catch (e) {
        console.warn("[Group] 机器人定时推送失败:", e);
        return false;
      }
    },

    // 养成数据面板（自绘卡片）
    openBotStatsSheet: async function (botId) {
      const self = this;
      const sess = await db.sessions.get(activeSessionId);
      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group) return;
      const bot = (group.bots || []).map(b => self._botDef(b)).find(b => String(b.id) === String(botId));
      if (!bot) return;
      const member = await db.group_members.where('[groupId+memberId+memberType]').equals([group.id, Number(activeUserPersonaId), 'user']).first();
      if (!member) { showToast("你不在本群，无法查看养成数据"); return; }

      const s = this._growthOf(member, bot.id);
      const g = bot.growth;
      const step = Math.max(5, Number(g.levelStep) || 20);
      const need = s.level * step;
      const pct = Math.max(0, Math.min(100, Math.round((s.exp / need) * 100)));

      const body =
        '<div class="group-growth-card">' +
          '<div class="group-growth-head">' + this._svg(this._icon.bot, 16, "#35867A") + this._esc(bot.name) + ' · 我的养成</div>' +
          '<div class="group-growth-grid">' +
            '<div class="group-growth-cell"><b>' + s.level + '</b><span>等级</span></div>' +
            '<div class="group-growth-cell"><b>' + s.points + '</b><span>' + this._esc(g.unit) + '</span></div>' +
            '<div class="group-growth-cell"><b>' + s.streak + '</b><span>连续签到</span></div>' +
          '</div>' +
          '<div class="group-growth-bar"><div class="group-growth-bar-fill" style="width:' + pct + '%;"></div></div>' +
          '<div style="font-size:10px;color:#7C8798;">经验 ' + s.exp + ' / ' + need + '（' + pct + '%）　已投喂 ' + s.feeds + ' 次 · 已撸 ' + s.pats + ' 次</div>' +
        '</div>';

      this._sheet({
        title: '养成面板', icon: this._icon.bot, body: body,
        actions: [
          { label: '去签到', cls: 'teal', icon: this._icon.check, onClick: function () { self._closeSheet(); self.quickBotSay('签到'); } },
          { label: '去投喂', cls: 'primary', icon: this._icon.plus, onClick: function () { self._closeSheet(); self.quickBotSay('投喂'); } },
          { label: '关闭', cls: 'ghost', onClick: function () { self._closeSheet(); } }
        ]
      });
    },

    // 以玩家身份快速发出一条机器人指令（用于养成面板快捷按钮）
    quickBotSay: async function (cmdText) {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;
      const bots = (group.bots || []).map(b => this._botDef(b)).filter(b => b.enabled);
      const bot = bots[0];
      if (!bot) { showToast("本群还没有启用中的机器人"); return; }
      const myName = await this._myName();
      const text = '@' + bot.name + ' ' + cmdText;
      const userMsg = {
        sessionId: activeSessionId,
        senderType: 'user',
        senderId: Number(activeUserPersonaId),
        content: text,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(userMsg);
      await this.interceptBotTrigger(text, myName);
      await renderDialogMessages();
    },

    interceptBotTrigger: async function(text, senderName) {
      const sess = await db.sessions.get(activeSessionId);
      if (!sess || sess.isGroup !== 1) return false;

      const group = await this._ensureBotIds(await db.groups.get(sess.groupId));
      if (!group || !Array.isArray(group.bots) || group.bots.length === 0) return false;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const senderMem = await this.findMemberByName(members, senderName);

      // 命中判定：@ 触发 或 关键词触发（可在机器人设置里选）
      let hit = null;
      for (const raw of group.bots) {
        const bot = this._botDef(raw);
        if (!bot.enabled || !bot.name) continue;
        const atMatch = text.includes('@' + bot.name);
        const kws = String(bot.keywords || '').split(/[,，|｜]/).map(x => x.trim()).filter(Boolean);
        const kwMatch = (bot.triggerMode === 'keyword' || bot.triggerMode === 'both') && kws.some(k => text.includes(k));
        if (atMatch || kwMatch) { hit = { raw: raw, bot: bot, atMatch: atMatch }; break; }
      }
      if (!hit) return false;

      const bot = hit.bot;
      const g = bot.growth || {};
      let cmdBody = "";
      if (hit.atMatch) {
        const p = '@' + bot.name;
        cmdBody = text.substring(text.indexOf(p) + p.length).trim();
      } else {
        cmdBody = text.trim();
      }

      let triggeredReply = "";

      // 1. 养成类内置命令（签到 / 投喂 / 撸 / 状态 / 排行 / 帮助）—— 不走冷却，另有每日限制
      if (senderMem) {
        try {
          const builtin = await this._builtinBotCommand(bot, senderMem, cmdBody, senderName);
          if (builtin && builtin.text) triggeredReply = builtin.text;
        } catch (e) { console.warn("[Group] 机器人内置命令失败:", e); }
      }

      // 2 / 3 需要冷却（避免刷屏刷接口）
      if (!triggeredReply) {
        window.__groupBotCooldown = window.__groupBotCooldown || {};
        const now = Date.now();
        const cdMs = (Number(bot.cooldownSec) || 0) * 1000;
        if (cdMs > 0 && now - (window.__groupBotCooldown[bot.id] || 0) < cdMs) return false;
        window.__groupBotCooldown[bot.id] = now;

        // 2. 自定义快捷命令（模板支持 || 随机分支与多变量）
        const cmdList = (bot.commands || '').split('\n').map(l => l.trim()).filter(Boolean);
        const headWord = (cmdBody.split(/\s+/)[0] || '').trim();
        const paramValue = cmdBody.replace(headWord, '').replace(/^[:：\s]+/, '').trim();
        for (const line of cmdList) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length < 2) continue;
          const cmdName = parts[0];
          if (!cmdName) continue;
          const cmdTemplate = parts.slice(1).join('|');
          if (cmdBody === cmdName || cmdBody.startsWith(cmdName)) {
            triggeredReply = this._fillTpl(cmdTemplate, {
              user: senderName, bot: bot.name, unit: g.unit || '小鱼干', value: paramValue,
              points: 0, level: 1, exp: 0, streak: 0, time: this._hhmm(), date: this._today()
            });
            break;
          }
        }
      }

      // 3. 仍未命中 → 交给大模型按机器人人设自由发挥
      if (!triggeredReply) {
        showToast(bot.name + " 正在思考…");
        try {
          const api = await window.apiRoutes.resolve("chat");
          if (!api) throw new Error();

          const botSystem = `【机器人扮演要求】
你是一个部署在微信群聊中的机器人助手。
- 你的名字：${bot.name}
- 你的性格背景与底料设定：${bot.persona || "一个平平无奇的群助手"}

${hit.atMatch ? `你刚刚收到了成员 [@${senderName}] 的艾特消息：“${cmdBody}”。` : `群里有人说了句：“${cmdBody}”，正好提到了你。`}
请你扮演该机器人，直接写一句极具特色、符合设定的回复语本身，限40字内。回复最前面必须带上 @${senderName} 标记。`;

          let llmReply;
          if (typeof window.fwCallLLM === "function") {
            try {
              llmReply = await window.fwCallLLM(api, [{ role: "user", content: botSystem }], { temperature: 0.7 });
            } catch(e) { /* fall through to original fetch */ }
          }
          if (llmReply === undefined) {
            const response = await fetch(`${api.url}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
              body: JSON.stringify({ model: api.model, messages: [{ role: "user", content: botSystem }], temperature: 0.7 })
            });
            if (response.ok) {
              const result = await response.json();
              llmReply = result.choices[0].message.content.trim();
            }
          }
          if (llmReply !== undefined) triggeredReply = llmReply;
        } catch(e) {
          triggeredReply = `@${senderName} 嘀…… ${bot.name} 信号有些虚弱，等会再试吧。`;
        }
      }

      if (triggeredReply) {
        const botMsg = {
          sessionId: activeSessionId,
          senderType: 'char',
          senderId: 99999,               // 99999 标识机器人
          senderBotId: bot.id,           // 具体是哪一个机器人（多机器人共存）
          content: triggeredReply,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(botMsg);
        await renderDialogMessages();
        return true;
      }
      return false;
    },

    // 10. 群公告发布 / 编辑（支持有效期）
    openGroupAnnounceForm: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const myMemberState = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const isAdminOrOwner = myMemberState && (myMemberState.role === 'owner' || myMemberState.role === 'admin');

      if (!isAdminOrOwner) {
        showToast("发布公告失败：你并不是群主或群管理员！");
        return;
      }

      window.__editingAnnouncement = false;
      const t = document.getElementById("group-announce-title"); if (t) t.value = "";
      const x = document.getElementById("group-announce-text"); if (x) x.value = "";
      const e = document.getElementById("group-announce-expire"); if (e) e.value = "0";
      const ft = document.getElementById("group-announce-form-title"); if (ft) ft.innerText = "发布群公告";
      document.getElementById("group-announce-overlay").classList.add("active");
    },

    submitGroupAnnouncement: async function() {
      const title = document.getElementById("group-announce-title").value.trim();
      const text = document.getElementById("group-announce-text").value.trim();

      if (!title || !text) {
        showToast("请填写完整的公告标题与内容！");
        return;
      }

      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const expEl = document.getElementById("group-announce-expire");
      const hours = expEl ? (parseFloat(expEl.value) || 0) : 0;
      const editing = !!window.__editingAnnouncement;

      // 编辑时先把旧公告归档，避免覆盖丢失
      let history = Array.isArray(group.announcementHistory) ? group.announcementHistory.slice() : [];
      if (editing && group.announcement) {
        history.unshift(Object.assign({}, group.announcement, { archivedAt: Date.now() }));
        history = history.slice(0, 30);
      }

      const announcement = {
        title,
        text,
        publisherId: Number(activeUserPersonaId),
        publisherType: 'user',
        readBy: [],
        expireAt: hours > 0 ? Date.now() + hours * 3600 * 1000 : 0,
        publishedAt: Date.now()
      };

      await db.groups.update(group.id, { announcement: announcement, announcementHistory: history });
      window.__editingAnnouncement = false;
      document.getElementById("group-announce-overlay").classList.remove("active");

      const myName = await this._myName();
      await this._sysNotify(`[系统通知] ${myName} ${editing ? '更新' : '发布'}了置顶群公告：《${title}》`);

      showToast(editing ? "群公告已更新！" : "群公告发布成功！");
      const fresh = await db.groups.get(group.id);
      this.renderGroupAnnouncement(fresh);
      await renderDialogMessages();
    },

    // 11. 成员管理（搜索 / 排序 / 真实活跃度 / 成员详情 / 禁言预设 / 退出群聊）
    openGroupMembersManager: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const msgs = await db.messages.where('sessionId').equals(activeSessionId).toArray();

      // 真实活跃度：最后发言时间
      const lastAt = {};
      msgs.forEach(m => {
        if (m.senderType === 'char' || m.senderType === 'user') {
          const k = m.senderType + ':' + m.senderId;
          if (!lastAt[k] || m.timestamp > lastAt[k]) lastAt[k] = m.timestamp;
        }
      });

      const myMemberState = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const myRole = myMemberState ? myMemberState.role : 'member';
      const now = Date.now();

      const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setTxt('group-member-count-total', members.length);
      setTxt('group-stat-total', members.length);
      setTxt('group-stat-active', members.filter(m => {
        const t = lastAt[this.memberKey(m)];
        return t && now - t < 30 * 60 * 1000;
      }).length);
      setTxt('group-stat-muted', members.filter(m => m.muteUntil && m.muteUntil > now).length);

      // 工具栏（首次注入：搜索满宽一行 + 排序胶囊一行，窄屏不再溢出）
      const toolbar = document.getElementById('group-members-toolbar');
      if (toolbar && !toolbar.dataset.bound) {
        const self = this;
        toolbar.dataset.bound = '1';
        this._memberSort = this._memberSort || 'role';
        toolbar.innerHTML =
          '<div class="group-members-search">' + this._svg(this._icon.search, 14, "#9AA7B8") +
            '<input type="text" id="group-member-search" placeholder="搜索昵称 / 头衔 / 分组">' +
          '</div>' +
          '<div class="group-members-sort-chips" id="group-member-sort-chips">' +
            '<button type="button" class="group-sort-chip" data-sort="role">按身份</button>' +
            '<button type="button" class="group-sort-chip" data-sort="active">按活跃</button>' +
            '<button type="button" class="group-sort-chip" data-sort="name">按昵称</button>' +
          '</div>';
        toolbar.querySelector('#group-member-search').oninput = function () { self.renderMemberList(); };
        toolbar.querySelectorAll('.group-sort-chip').forEach(function (chip) {
          chip.onclick = function () {
            self._memberSort = chip.getAttribute('data-sort') || 'role';
            self.renderMemberList();
          };
        });
      }
      if (toolbar) {
        const cur = this._memberSort || 'role';
        toolbar.querySelectorAll('.group-sort-chip').forEach(chip => {
          chip.classList.toggle('active', (chip.getAttribute('data-sort') || 'role') === cur);
        });
      }

      this._memberCtx = { members: members, lastAt: lastAt, group: group, myRole: myRole, now: now, myMember: myMemberState };
      await this.renderMemberList();
      document.getElementById("group-members-panel").classList.add("active");
    },

    renderMemberList: async function() {
      const ctx = this._memberCtx;
      if (!ctx) return;
      const members = ctx.members, lastAt = ctx.lastAt, now = ctx.now;
      const qEl = document.getElementById('group-member-search');
      const q = (qEl && qEl.value ? qEl.value : '').trim().toLowerCase();
      const sortBy = this._memberSort || 'role';

      const listBox = document.getElementById("group-members-list-box");
      if (!listBox) return;
      listBox.innerHTML = '';

      const rows = [];
      for (const m of members) {
        const info = await this._memberInfo(m);
        const roleScore = m.role === 'owner' ? 0 : (m.role === 'admin' ? 1 : 2);
        rows.push({ m: m, info: info, roleScore: roleScore, last: lastAt[this.memberKey(m)] || 0 });
      }

      let filtered = rows.filter(r => {
        if (!q) return true;
        return (r.info.name + ' ' + (r.m.title || '') + ' ' + (r.info.groupName || '')).toLowerCase().indexOf(q) >= 0;
      });

      if (sortBy === 'role') filtered.sort((a, b) => a.roleScore - b.roleScore || b.last - a.last);
      else if (sortBy === 'active') filtered.sort((a, b) => b.last - a.last);
      else filtered.sort((a, b) => String(a.info.name).localeCompare(String(b.info.name), 'zh'));

      if (filtered.length === 0) {
        listBox.innerHTML = '<div class="group-sheet-empty">没有匹配的成员</div>';
        return;
      }

      filtered.forEach(r => {
        const m = r.m, info = r.info;
        const isMuted = m.muteUntil && m.muteUntil > now;
        const isMe = ctx.myMember && m.id === ctx.myMember.id;
        const item = document.createElement('div');
        item.className = 'group-list-card';
        item.style.cursor = 'pointer';
        item.innerHTML =
          '<img src="' + info.avatar + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">' +
          '<div class="glc-main">' +
            '<div class="glc-title">' +
              (m.role === 'owner' ? '<span class="group-chip owner">群主</span>' : '') +
              (m.role === 'admin' ? '<span class="group-chip admin">管理员</span>' : '') +
              (isMuted ? '<span class="group-chip muted">禁言中</span>' : '') +
              (isMe ? '<span class="group-chip mine">我</span>' : '') +
              '<span style="overflow:hidden;text-overflow:ellipsis;">' + this._esc(info.name) + '</span>' +
            '</div>' +
            '<div class="glc-sub">' + this._esc(info.groupName) + (m.title ? ' · ' + this._esc(m.title) : '') +
              ' · ' + (r.last ? ('最后发言 ' + this._fmtAgo(r.last)) : '从未发言') + '</div>' +
          '</div>' +
          '<span class="group-icon-btn">' + this._svg('<polyline points="9 18 15 12 9 6"/>', 14) + '</span>';
        item.onclick = () => this.openMemberDetail(m.id);
        listBox.appendChild(item);
      });
    },

    _fmtAgo: function (ts) {
      const d = Date.now() - ts;
      if (d < 60e3) return '刚刚';
      if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
      if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
      return Math.floor(d / 86400e3) + ' 天前';
    },

    openMemberDetail: async function(dbMemberId) {
      const self = this;
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const myMember = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const myRole = myMember ? myMember.role : 'member';
      const isMe = !!myMember && member.id === myMember.id;
      const isMuted = member.muteUntil && member.muteUntil > Date.now();
      const info = await this._memberInfo(member);

      const row = (label, value) => '<div class="group-sheet-row"><span class="gsr-label">' + label + '</span><span class="gsr-value">' + self._esc(value) + '</span></div>';

      const body =
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<img src="' + info.avatar + '" style="width:52px;height:52px;border-radius:50%;object-fit:cover;">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:15px;font-weight:800;color:var(--text-primary);">' + self._esc(info.name) + '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">' + self._esc(info.groupName) + '</div>' +
          '</div>' +
        '</div>' +
        row('群内身份', member.role === 'owner' ? '群主' : (member.role === 'admin' ? '管理员' : '普通成员')) +
        (member.title ? row('专属头衔', member.title) : '') +
        row('禁言状态', isMuted ? ('禁言至 ' + new Date(member.muteUntil).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })) : '正常') +
        row('群昵称', member.displayName || '（未设置）');

      const actions = [];
      const canModerate = !isMe && (myRole === 'owner' || (myRole === 'admin' && member.role === 'member'));
      if (canModerate) {
        actions.push({ label: isMuted ? '解除禁言' : '禁言', icon: self._icon.micOff, cls: 'ghost',
          onClick: function () { self._closeSheet(); if (isMuted) self.unmuteMember(member.id); else self.openMuteSheet(member.id); } });
        actions.push({ label: '头衔', icon: self._icon.star, cls: 'ghost',
          onClick: function () { self._closeSheet(); self.setMemberTitle(member.id); } });
        actions.push({ label: '群昵称', icon: self._icon.edit, cls: 'ghost',
          onClick: function () { self._closeSheet(); self.setMemberDisplayName(member.id); } });
      }
      if (myRole === 'owner' && !isMe) {
        actions.push({ label: member.role === 'admin' ? '取消管理' : '设为管理', icon: self._icon.shield, cls: 'ghost',
          onClick: function () { self._closeSheet(); self.toggleAdmin(member.id); } });
        actions.push({ label: '转让群主', icon: self._icon.crown, cls: 'ghost',
          onClick: function () { self._closeSheet(); self.transferOwner(member.id); } });
        actions.push({ label: '移出群聊', icon: self._icon.logout, cls: 'danger',
          onClick: function () { self._closeSheet(); self.kickMember(member.id); } });
      }
      if (isMe && member.role !== 'owner') {
        actions.push({ label: '退出群聊', icon: self._icon.logout, cls: 'danger',
          onClick: function () { self._closeSheet(); self.leaveGroup(); } });
      }
      if (actions.length === 0) {
        actions.push({ label: '关闭', cls: 'ghost', onClick: function () { self._closeSheet(); } });
      }

      this._sheet({ title: '成员资料', icon: this._icon.users, body: body, actions: actions });
    },

    openMuteSheet: async function(dbMemberId) {
      const self = this;
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const info = await this._memberInfo(member);
      const presets = [
        { label: '10 分钟', min: 10 },
        { label: '1 小时', min: 60 },
        { label: '6 小时', min: 360 },
        { label: '1 天', min: 1440 },
        { label: '7 天', min: 10080 }
      ];
      const body =
        '<div class="group-sheet-text">对「' + self._esc(info.name) + '」设置禁言时长。禁言期间 TA 在群里的发言会被系统拦下并转为系统提示。</div>' +
        presets.map(p => '<div class="group-sheet-row" style="cursor:pointer;" data-min="' + p.min + '"><span class="gsr-label">' + p.label + '</span><span class="gsr-value">' + self._svg('<polyline points="9 18 15 12 9 6"/>', 13) + '</span></div>').join('');

      const el = this._sheet({
        title: '禁言设置', icon: this._icon.micOff, body: body,
        actions: [
          { label: '自定义', cls: 'primary', onClick: function () { self._closeSheet(); self.muteMember(member.id); } },
          { label: '取消', cls: 'ghost', onClick: function () { self._closeSheet(); } }
        ]
      });
      el.querySelectorAll('.group-sheet-row[data-min]').forEach(row => {
        row.onclick = function () {
          const min = Number(row.getAttribute('data-min'));
          self._closeSheet();
          self.applyMute(member.id, min);
        };
      });
    },

    applyMute: async function(dbMemberId, minutes) {
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const info = await this._memberInfo(member);
      const myName = await this._myName();
      member.muteUntil = Date.now() + minutes * 60 * 1000;
      await db.group_members.put(member);
      await this._sysNotify(`[系统通知] ${myName} 已将 ${info.name} 禁言 ${minutes >= 1440 ? (minutes / 1440) + ' 天' : (minutes >= 60 ? (minutes / 60) + ' 小时' : minutes + ' 分钟')}`);
      showToast("已禁言 " + info.name);
      this.openGroupMembersManager();
      await renderDialogMessages();
    },

    unmuteMember: async function(dbMemberId) {
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const info = await this._memberInfo(member);
      const myName = await this._myName();
      member.muteUntil = 0;
      await db.group_members.put(member);
      await this._sysNotify(`[系统通知] ${myName} 已解除 ${info.name} 的禁言`);
      showToast("已解除禁言");
      this.openGroupMembersManager();
      await renderDialogMessages();
    },

    setMemberDisplayName: async function(dbMemberId) {
      const self = this;
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const info = await this._memberInfo(member);
      this._prompt("设置群昵称（仅本群显示）", member.displayName || "", async function (val) {
        const name = String(val || "").trim();
        const myName = await self._myName();
        member.displayName = name;
        await db.group_members.put(member);
        if (name) await self._sysNotify(`[系统通知] ${myName} 将 ${info.name} 的群昵称设为「${name}」`);
        showToast("群昵称已更新");
        self.openGroupMembersManager();
        await renderDialogMessages();
      }, "留空则恢复本名");
    },

    leaveGroup: async function() {
      const self = this;
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      const myMember = await db.group_members.where('[groupId+memberId+memberType]').equals([group.id, Number(activeUserPersonaId), 'user']).first();
      if (!myMember) { showToast("你不在本群"); return; }
      this._confirm("退出群聊", "确定要退出「" + group.name + "」吗？\n退出后你将变成旁白视角，只能以环境描写推动剧情。", async function () {
        const myName = await self._myName();
        await db.group_members.delete(myMember.id);
        await self._sysNotify(`[系统通知] ${myName} 退出了群聊`);
        showToast("已退出群聊");
        document.getElementById("group-members-panel").classList.remove("active");
        const fresh = await db.sessions.get(activeSessionId);
        await window.groupChatSystem.openGroupDialog(activeSessionId);
      }, "退出");
    },

    _myName: async function () {
      const u = await db.archives.get(Number(activeUserPersonaId));
      return u ? u.name : "User";
    },

    // 统一写入系统灰字消息（群聊上下文感知）
    _sysNotify: async function (content) {
      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: content,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      return sysMsg;
    },

    transferOwner: async function(dbMemberId) {
      const self = this;
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const targetInfo = await this._memberInfo(member);

      this._confirm("转让群主", "确定要把群主转让给「" + targetInfo.name + "」吗？\n转让后你会降级为普通成员，此操作不可自动撤销。", async function () {
        const myName = await self._myName();
        const owner = await db.group_members.where('[groupId+memberId+memberType]').equals([member.groupId, Number(activeUserPersonaId), 'user']).first();
        if (owner) {
          owner.role = 'member';
          owner.title = '';
          await db.group_members.put(owner);
        }
        member.role = 'owner';
        member.title = '群主';
        await db.group_members.put(member);
        await db.groups.update(member.groupId, { ownerId: member.memberId, ownerType: member.memberType });
        await self._sysNotify(`[系统通知] 群主 ${myName} 已将群主权限安全转让给 ${targetInfo.name}`);
        showToast("群主转让成功！");
        self.openGroupMembersManager();
        await renderDialogMessages();
      }, "确认转让");
    },

    toggleAdmin: async function(dbMemberId) {
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      let targetName = "对方";
      if (member.memberType === 'user') {
        const u = await db.archives.get(member.memberId);
        targetName = u ? u.name : "我";
      } else {
        const c = await db.archives.get(member.memberId);
        targetName = c ? c.name : "对方";
      }

      const newRole = member.role === 'admin' ? 'member' : 'admin';
      const newTitle = member.role === 'admin' ? '' : '管理员';

      member.role = newRole;
      member.title = newTitle;
      await db.group_members.put(member);

      // 将管理员升降级事件转化为系统卡片消息入库
      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] 群主 ${myName} 已将 ${targetName} ${newRole === 'admin' ? '设为管理员' : '取消管理员权限'}`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);

      showToast(newRole === 'admin' ? "已设为管理员" : "已取消管理员权限");
      this.openGroupMembersManager();
      await renderDialogMessages();
    },

    muteMember: async function(dbMemberId) {
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      let targetName = "对方";
      if (member.memberType === 'user') {
        const u = await db.archives.get(member.memberId);
        targetName = u ? u.name : "我";
      } else {
        const c = await db.archives.get(member.memberId);
        targetName = c ? c.name : "对方";
      }

      const isMuted = member.muteUntil && member.muteUntil > Date.now();
      if (isMuted) {
        member.muteUntil = 0;
        await db.group_members.put(member);

        // 写入解除禁言系统通知入库
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] 管理员/群主 ${myName} 已提前解除 ${targetName} 的禁言限制`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast("已成功解除对该成员的禁言");
        this.openGroupMembersManager();
        await renderDialogMessages();
        return;
      }

      showCustomPrompt("请输入需要禁言的时长（分钟）", "10", async (input) => {
        if (!input) return;
        const minutes = parseInt(input);
        if (isNaN(minutes) || minutes <= 0) {
          showToast("请输入合法的分钟数！");
          return;
        }

        member.muteUntil = Date.now() + minutes * 60 * 1000;
        await db.group_members.put(member);

        // 写入设定禁言系统通知入库
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] 管理员/群主 ${myName} 已将 ${targetName} 禁言 ${minutes} 分钟`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast(`该成员已被禁言 ${minutes} 分钟`);
        this.openGroupMembersManager();
        await renderDialogMessages();
      });
    },

    setMemberTitle: async function(dbMemberId) {
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      let targetName = "对方";
      if (member.memberType === 'user') {
        const u = await db.archives.get(member.memberId);
        targetName = u ? u.name : "我";
      } else {
        const c = await db.archives.get(member.memberId);
        targetName = c ? c.name : "对方";
      }

      showCustomPrompt("请输入该成员专属头衔", member.title || "群员", async (title) => {
        if (title === null) return;
        const newTitle = title.trim();
        member.title = newTitle;
        await db.group_members.put(member);

        // 将修改群头衔事件转化为系统消息入库
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] 管理员/群主 ${myName} 已将 ${targetName} 的专属群头衔设置为 【${newTitle || '无'}】`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast("群头衔设置成功！");
        this.openGroupMembersManager();
        await renderDialogMessages();
      });
    },

    kickMember: async function(dbMemberId) {
      const self = this;
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;
      const info = await this._memberInfo(member);

      this._confirm("移出群聊", "确定要把「" + info.name + "」移出群聊吗？\n移出后 TA 将不再出现在群成员中。", async function () {
        const myName = await self._myName();
        await db.group_members.delete(member.id);
        await self._sysNotify(`[系统通知] ${myName} 已将 ${info.name} 移出群聊`);
        showToast("成员已被移出群聊");
        self.openGroupMembersManager();
        await renderDialogMessages();
      }, "移出");
    },

    // 12. 右上角群后台面板
    openGroupDetailsPanel: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      document.getElementById("group-details-name").value = group.name;
      document.getElementById("group-details-avatar-url").value = (group.avatar && group.avatar.startsWith("data:image/")) ? "[本地上传图片]" : (group.avatar || "");
      window.tempGroupDetailsAvatarBlob = (group.avatar && group.avatar.startsWith("data:image/")) ? group.avatar : null;

      // 渲染多态记忆同步开关
      const memberUser = await db.group_members.where('[groupId+memberId+memberType]').equals([group.id, Number(activeUserPersonaId), 'user']).first();
      if (memberUser) {
        document.getElementById("group-sync-from-single").checked = memberUser.syncFromSingle !== 0;
        document.getElementById("group-sync-to-single").checked = memberUser.syncToSingle !== 0;
      }

      // 渲染群聊小程序分享开关（无损：未开启即不注入任何 prompt）
      const groupMpShareToggle = document.getElementById("group-details-allow-miniprogram-share");
      if (groupMpShareToggle) groupMpShareToggle.checked = !!sess.allowMiniprogramShare;

      // 渲染"线下赴约记录拼入线上上下文"开关
      const groupMergeOfflineToggle = document.getElementById("group-details-merge-offline-toggle");
      if (groupMergeOfflineToggle) groupMergeOfflineToggle.checked = sess.mergeOfflineIntoContext === 1;

      // 渲染群聊专属世界书手风琴选择器
      const containerEl = document.getElementById("group-details-wb-mounted-accordion");
      if (containerEl && typeof renderWbMountedAccordion === 'function') {
        await renderWbMountedAccordion(containerEl, group.mountedEntryIds || [], "cb-group-details-wb-mount");
      }

      // 渲染表情包挂载列表
      const mountedStickersEl = document.getElementById("group-details-mounted-stickers");
      const mountBtn = document.getElementById("btn-group-details-sticker-mount");
      if (mountedStickersEl && mountBtn) {
        const mountedIds = group.stickerMountedGroupIds ? group.stickerMountedGroupIds.split(',').map(Number) : [];
        if (mountedIds.length > 0) {
          const names = stickerSystem.stickerGroups
            ? stickerSystem.stickerGroups.filter(g => mountedIds.includes(g.id)).map(g => g.name)
            : [];
          mountedStickersEl.textContent = names.length > 0 ? names.join('、') : '已挂载 ' + mountedIds.length + ' 个分组';
        } else {
          mountedStickersEl.textContent = '暂无挂载';
        }
        
        mountBtn.onclick = async () => {
          await this.openGroupStickerMountSettings(group.id);
        };
      }

      // 绑定上传本地图片到群后台
      const fileAvatarDetails = document.getElementById("file-group-details-avatar");
      const btnUploadDetails = document.getElementById("btn-group-details-avatar-upload");
      if (btnUploadDetails && fileAvatarDetails) {
        btnUploadDetails.onclick = () => fileAvatarDetails.click();
        fileAvatarDetails.onchange = (e) => {
          if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
              document.getElementById("group-details-avatar-url").value = "[本地上传图片]";
              window.tempGroupDetailsAvatarBlob = event.target.result;
            };
            reader.readAsDataURL(file);
          }
        };
      }

      document.getElementById("group-details-panel").classList.add("active");
    },

    openGroupStickerMountSettings: async function(groupId) {
      const group = await db.groups.get(groupId);
      const mountedIds = group.stickerMountedGroupIds ? group.stickerMountedGroupIds.split(',').map(Number) : [];
      
      let html = '<div style="padding:16px">';
      html += '<h4 style="margin:0 0 12px; font-size:15px; text-align:center; font-weight:700; color:var(--text-primary)">群聊挂载表情包</h4>';
      
      // 直接自足式同步拉取表情分组，防范管理面板时序产生 typeError
      const groups = await db.sticker_groups.orderBy('sortOrder').toArray();
      for (const g of groups) {
        const checked = mountedIds.includes(g.id) ? 'checked' : '';
        const items = await db.sticker_items.where('groupId').equals(g.id).toArray();
        const count = items.length;
        html += `<label style="display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--border); cursor:pointer">
          <input type="checkbox" class="group-sticker-mount-checkbox" value="${g.id}" ${checked}>
          <span style="flex:1; font-size:14px; color:var(--text-primary); font-weight:600;">${escapeHtml(g.name)}</span>
          <span style="font-size:11px; color:#94a3b8">${count} 个表情</span>
        </label>`;
      }
      
      html += `<div style="display:flex; gap:12px; margin-top:20px">
        <button onclick="document.getElementById('sticker-mount-overlay').classList.remove('active')" style="flex:1; padding:10px; border-radius:12px; border:1.5px solid var(--border); background:var(--surface); font-size:13px; font-weight:600; cursor:pointer">取消</button>
        <button id="btn-group-sticker-mount-save" style="flex:1; padding:10px; border-radius:12px; border:none; background:#ec4899; color:#fff; font-size:13px; font-weight:600; cursor:pointer;">保存并应用</button>
      </div></div>`;
      
      const overlay = document.getElementById('sticker-mount-overlay');
      if (overlay) {
        overlay.querySelector('.sticker-mount-content').innerHTML = html;
        overlay.classList.add('active');
        
        overlay.querySelector("#btn-group-sticker-mount-save").onclick = async () => {
          const checkboxes = overlay.querySelectorAll('.group-sticker-mount-checkbox:checked');
          const ids = Array.from(checkboxes).map(cb => Number(cb.value));
          
          await db.groups.update(groupId, { stickerMountedGroupIds: ids.join(',') });
          overlay.classList.remove('active');
          showToast("表情包挂载成功！");
          this.openGroupDetailsPanel();
        };
      }
    },

    saveGroupDetails: async function() {
      const name = document.getElementById("group-details-name").value.trim();
      const avatarUrlInput = document.getElementById("group-details-avatar-url").value.trim();

      if (!name) {
        showToast("群名称不能为空！");
        return;
      }

      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const avatar = avatarUrlInput === "[本地上传图片]" ? window.tempGroupDetailsAvatarBlob : (avatarUrlInput || null);

      // 保存群聊世界书挂载列表
      const checkedBoxes = document.querySelectorAll(".cb-group-details-wb-mount:checked");
      const mountedEntryIds = Array.from(checkedBoxes).map(cb => Number(cb.value));

      // 记忆双向同步
      const syncFromSingle = document.getElementById("group-sync-from-single").checked ? 1 : 0;
      const syncToSingle = document.getElementById("group-sync-to-single").checked ? 1 : 0;

      // 读取群聊小程序分享开关（无损：默认关闭，不影响现有功能）
      const groupMpShareToggleEl = document.getElementById("group-details-allow-miniprogram-share");
      const allowMiniprogramShare = groupMpShareToggleEl ? (groupMpShareToggleEl.checked ? 1 : 0) : 0;

      // 读取"线下赴约记录拼入线上上下文"开关
      const groupMergeOfflineToggleEl = document.getElementById("group-details-merge-offline-toggle");
      const mergeOfflineIntoContext = groupMergeOfflineToggleEl ? (groupMergeOfflineToggleEl.checked ? 1 : 0) : 0;

      const memberUser = await db.group_members.where('[groupId+memberId+memberType]').equals([group.id, Number(activeUserPersonaId), 'user']).first();
      if (memberUser) {
        await db.group_members.update(memberUser.id, { syncFromSingle, syncToSingle });
      }

      await db.groups.update(group.id, {
        name,
        avatar,
        mountedEntryIds
      });

      await db.sessions.update(activeSessionId, {
        customCharName: name,
        customCharAvatar: avatar,
        allowMiniprogramShare: allowMiniprogramShare,
        mergeOfflineIntoContext: mergeOfflineIntoContext
      });

      showToast("群配置保存成功！");
      document.getElementById("group-details-panel").classList.remove("active");
      this.openGroupDialog(activeSessionId);
    },

    // 13. AI 对白多人多段拆分写入
    saveGroupAiMessage: async function(senderName, textContent) {
      console.log(`[Group Chat Debug] 3. 准备执行入库 -> 目标匹配名字: "${senderName}"`);
      const sess = await db.sessions.get(activeSessionId);
      const user = await db.archives.get(sess.userId);
      
      // 核心安全防火墙：检测并阻断 AI 假冒玩家名义发言的幻觉行为 [4]
      const userNick = (sess.customUserName || user?.name || "我").trim().toLowerCase();
      const cleanSender = senderName.trim().toLowerCase();
      if (cleanSender === "user" || cleanSender === "我" || cleanSender === userNick) {
        console.warn(`[Group Chat Debug] 🛡️ 防火墙拦截：AI 视图假冒玩家主体 "${senderName}" 发言，已被强制阻断拦截，丢弃内容。`);
        return;
      }

      const myUser = await db.archives.get(sess.userId);
      const myName = myUser ? myUser.name : "我";
      
      // 核心自愈：自动将对白中出现的 "user"、"@user"、"@User" 替换为当前群内玩家的真实档案名字
      let processedText = textContent
        .replace(/@user/gi, `@${myName}`)
        .replace(/\buser\b/gi, myName);

      // 核心检测：如果 AI 产生的发言是以 [系统通知]、【系统通知】为前缀的文本，说明是小样本模仿产生的通知对白。
      // 我们将其从普通气泡中剥离，直接作为真正的 system 系统灰字消息上屏落库，防范其沦为破碎的空头像群成员
      if (processedText.startsWith("[系统通知]") || processedText.startsWith("【系统通知】")) {
        console.log(`[Group Chat Debug] 🛡️ 系统消息拦截：对准 "${processedText}"，自动降级为系统置中灰字`);
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: processedText,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);
        await appendMessageToDOM(sysMsg);
        return;
      }

      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      console.log("[Group Chat Debug] 4. 当前群内的关系表 members 原始数组:\n", JSON.parse(JSON.stringify(members)));

      let targetCharId = 0;
      let matchedMember = null;
      
      // 第一级：精确全等匹配（同时比对档案馆本名与快照分支 displayName）
      for (const m of members) {
        if (m.memberType === 'char') {
          const char = await db.archives.get(m.memberId);
          const baseName = char ? char.name.trim() : '';
          const dispName = (m.displayName || '').trim();
          console.log(`[Group Chat Debug] 5. 精确匹配校验 -> 档案馆ID: ${m.memberId}，角色本名: "${baseName}"，分支名: "${dispName}"`);
          if (baseName === senderName || dispName === senderName) {
            targetCharId = m.memberId;
            matchedMember = m;
            console.log(`[Group Chat Debug] 5-1. 精确匹配成功！对准档案馆 ID: ${targetCharId}`);
            break;
          }
        }
      }

      // 第二级（自愈）：模糊包含匹配，防范模型写错名字（同样比对 displayName）
      if (!targetCharId) {
        for (const m of members) {
          if (m.memberType === 'char') {
            const char = await db.archives.get(m.memberId);
            const baseName = char ? char.name : '';
            const dispName = m.displayName || '';
            console.log(`[Group Chat Debug] 6. 模糊匹配校验 -> 档案馆ID: ${m.memberId}，角色本名: "${baseName}"`);
            if (char && (baseName.includes(senderName) || senderName.includes(baseName) || (dispName && (dispName.includes(senderName) || senderName.includes(dispName))))) {
              targetCharId = m.memberId;
              matchedMember = m;
              console.log(`[Group Chat Debug] 6-1. 模糊匹配自愈成功！对准档案馆 ID: ${targetCharId}`);
              break;
            }
          }
        }
      }

      // 第三级（终极兜底）：取当前群内首位活跃 Character 补位，确保头像绝不丢失
      if (!targetCharId) {
        const fallbackChar = members.find(m => m.memberType === 'char');
        if (fallbackChar) {
          targetCharId = fallbackChar.memberId;
          matchedMember = fallbackChar;
          console.log(`[Group Chat Debug] 7. 终极自愈兜底触发！匹配至首位群成员，档案馆 ID: ${targetCharId}`);
        }
      }

      if (!targetCharId) {
        console.warn(`[Group Chat Debug] ⚠️ 警告：名字 "${senderName}" 未能在本群中匹配到任何合法角色主体，放弃入库。`);
        return; 
      }

      // 检查禁言 (计入上下文，改用系统通知卡片进行对白替代)
      const mRel = members.find(m => m.memberId === targetCharId && m.memberType === 'char');
      if (mRel && mRel.muteUntil && mRel.muteUntil > Date.now()) {
        console.warn(`[Group] ${senderName} 处于禁言状态，已转为系统通知卡片`);
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: `（[禁言中] ${senderName} 尝试在群内发言，但消息因禁言限制未送达）`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);
        await appendMessageToDOM(sysMsg);
        return;
      }

      const msg = {
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: targetCharId,
        senderSnapshotId: (matchedMember && matchedMember.sourceArchiveId) || 0,
        senderDisplayName: (matchedMember && matchedMember.displayName) || '',
        content: processedText,
        contentType: 'text',
        timestamp: Date.now()
      };
      msg.id = await db.messages.add(msg);
      await appendMessageToDOM(msg);

      // 如果当前 AI 角色发送的文本中包含了艾特机器人的前缀，则异步触发机器人的跟手机制，完成双向交互
      if (typeof this.interceptBotTrigger === 'function') {
        setTimeout(async () => {
          await this.interceptBotTrigger(processedText, senderName);
        }, 800);
      }
    },

    // 14. 动作指令解析器 (采用高弹性自愈对齐，支持大小写自适应，并自动兼容 user 与 "我")
    findMemberByName: async function(members, name) {
      const cleanedName = name.trim().toLowerCase();
      for (let m of members) {
        if (m.memberType === 'user') {
          const u = await db.archives.get(m.memberId);
          const uName = (u ? u.name : "user").trim().toLowerCase();
          // 如果大模型返回 "user"、"User" 或 "我"，自动对齐匹配至玩家本人
          if (uName === cleanedName || cleanedName === "user" || cleanedName === "我") {
            return m;
          }
        } else {
          const c = await db.archives.get(m.memberId);
          const dName = (m.displayName || '').trim().toLowerCase();
          if ((c && c.name.trim().toLowerCase() === cleanedName) || dName === cleanedName) {
            return m;
          }
        }
      }
      return null;
    },

    executeAiMuteCommand: async function(senderName, targetName, duration) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem || (senderMem.role !== 'owner' && senderMem.role !== 'admin')) return;

      const targetMem = await this.findMemberByName(members, targetName);
      if (!targetMem) return;

      const muteUntil = Date.now() + duration * 60 * 1000;
      await db.group_members.update(targetMem.id, { muteUntil });

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${senderName} 已将 ${targetName} 禁言 ${duration} 分钟`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      await renderDialogMessages();
    },

    executeAiKickCommand: async function(senderName, targetName) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem || (senderMem.role !== 'owner' && senderMem.role !== 'admin')) return;

      const targetMem = await this.findMemberByName(members, targetName);
      if (!targetMem) return;

      await db.group_members.delete(targetMem.id);

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${senderName} 已将 ${targetName} 移出群聊`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      await renderDialogMessages();
    },

    executeAiTitleCommand: async function(senderName, targetName, newTitle) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem || (senderMem.role !== 'owner' && senderMem.role !== 'admin')) return;

      const targetMem = await this.findMemberByName(members, targetName);
      if (!targetMem) return;

      await db.group_members.update(targetMem.id, { title: newTitle });

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${senderName} 已将 ${targetName} 的专属头衔设置为 【${newTitle}】`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      await renderDialogMessages();
    },

    executeAiAdminCommand: async function(senderName, targetName, actType) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem || senderMem.role !== 'owner') return; // 仅群主可以设定管理

      const targetMem = await this.findMemberByName(members, targetName);
      if (!targetMem) return;

      const isSet = actType === '设为';
      await db.group_members.update(targetMem.id, {
        role: isSet ? 'admin' : 'member',
        title: isSet ? '管理员' : ''
      });

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${senderName} 已将 ${targetName} ${isSet ? '设为管理员' : '取消管理员'}`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      await renderDialogMessages();
    },

    executeAiTransferOwnerCommand: async function(senderName, targetName) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem || senderMem.role !== 'owner') return;

      const targetMem = await this.findMemberByName(members, targetName);
      if (!targetMem) return;

      await db.group_members.update(senderMem.id, { role: 'member', title: '' });
      await db.group_members.update(targetMem.id, { role: 'owner', title: '群主' });
      await db.groups.update(sess.groupId, { ownerId: targetMem.memberId, ownerType: targetMem.memberType });

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] 群主权限已由 ${senderName} 安全转让给 ${targetName}`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);
      await renderDialogMessages();
    },

    // AI 发起群投票指令 [POLL: 投票主题 (选项1 | 选项2)]
    executeAiPollCommand: async function(senderName, pollTitle, optionsStr) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem) return;

      const options = optionsStr.split('|').map(o => o.trim()).filter(Boolean);
      if (options.length < 2) return;

      const pollData = {
        title: pollTitle,
        options,
        votes: {}
      };

      const pollMsg = {
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: senderMem.memberId,
        content: JSON.stringify(pollData),
        contentType: 'group_poll',
        timestamp: Date.now()
      };
      await db.messages.add(pollMsg);
      await renderDialogMessages();
    },

    // AI 发布置顶公告指令 [ANNOUNCE: 标题 (内容)]
    executeAiAnnounceCommand: async function(senderName, annTitle, annText) {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem || (senderMem.role !== 'owner' && senderMem.role !== 'admin')) return;

      const announcement = {
        title: annTitle,
        text: annText,
        publisherId: senderMem.memberId,
        publisherType: 'char',
        readBy: [],
        expireAt: 0,
        publishedAt: Date.now()
      };

      // 旧公告归档进历史
      let history = Array.isArray(group.announcementHistory) ? group.announcementHistory.slice() : [];
      if (group.announcement) {
        history.unshift(Object.assign({}, group.announcement, { archivedAt: Date.now() }));
        history = history.slice(0, 30);
      }

      await db.groups.update(group.id, { announcement: announcement, announcementHistory: history });
      
      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${senderName} 发布了置顶群公告：《${annTitle}》`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);

      // 重新从数据库拉取最新公告数据渲染，彻底根治公告未能实时渲染上屏的问题 [3]
      const freshGroup = await db.groups.get(group.id);
      this.renderGroupAnnouncement(freshGroup);
      await renderDialogMessages();
    },

    // AI 定向转账指令 [TRANSFER: 收款人 (金额)]
    executeAiTransferCommand: async function(senderName, targetName, amount) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem) return;

      const walletData = {
        amount: amount,
        status: "pending",
        targetName: targetName,
        remark: "微信转账"
      };

      const msg = {
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: senderMem.memberId,
        content: JSON.stringify(walletData),
        contentType: 'transfer',
        timestamp: Date.now()
      };
      await db.messages.add(msg);
      await renderDialogMessages();
    },

    // AI 发送普通/拼手气红包指令 [RED_ENVELOPE: normal/lucky (金额) (备注)]
    executeAiRedEnvelopeCommand: async function(senderName, type, amount, remark) {
      const sess = await db.sessions.get(activeSessionId);
      const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem) return;

      const splitsLeft = Math.min(5, members.length);
      const walletData = {
        amount: amount,
        status: "pending",
        remark: remark || "恭喜发财",
        type: type,
        remainingAmount: amount,
        totalSplits: splitsLeft,
        splitsLeft: splitsLeft,
        claimed: {}
      };

      const msg = {
        sessionId: activeSessionId,
        senderType: 'char',
        senderId: senderMem.memberId,
        content: JSON.stringify(walletData),
        contentType: 'red_envelope',
        timestamp: Date.now()
      };
      await db.messages.add(msg);
      await renderDialogMessages();
    },

    // 16. AI 拆开群红包物理执行器 (完全由 AI 决策驱动，彻底消灭 OOC 并完成物理拆包存盘)
    executeAiClaimRedEnvelopeCommand: async function(senderName, targetMsgId) {
      const msg = await db.messages.get(Number(targetMsgId));
      if (!msg || msg.contentType !== 'red_envelope') return;

      try {
        const sess = await db.sessions.get(msg.sessionId);
        const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
        const senderMem = await this.findMemberByName(members, senderName);
        if (!senderMem) return;

        const data = JSON.parse(msg.content);
        const totalSplits = data.splitsLeft !== undefined ? data.splitsLeft : 5;
        
        // 禁言限制核查
        if (senderMem.muteUntil && senderMem.muteUntil > Date.now()) return;

        // 如果已被抢完，写入灰色系统手慢无提示并入库
        if (totalSplits <= 0) {
          const sysMsg = {
            sessionId: msg.sessionId,
            senderType: 'system',
            senderId: 0,
            content: `[系统通知] ${senderName} 尝试拆开红包，但手慢了已被抢光`,
            contentType: 'text',
            timestamp: Date.now()
          };
          await db.messages.add(sysMsg);
          if (activeSessionId === msg.sessionId) {
            await appendMessageToDOM(sysMsg);
          }
          return;
        }

        if (!data.claimed) data.claimed = {};
        if (data.claimed[senderMem.memberId] !== undefined) return; // 已领过拦截

        const isLucky = data.type === 'lucky';
        let claimAmount = 0;
        if (isLucky) {
          if (totalSplits === 1) {
            claimAmount = data.remainingAmount;
          } else {
            const avg = data.remainingAmount / totalSplits;
            claimAmount = Math.random() * (avg * 2 - 0.01) + 0.01;
            claimAmount = parseFloat(claimAmount.toFixed(2));
          }
        } else {
          claimAmount = data.amount / data.totalSplits;
          claimAmount = parseFloat(claimAmount.toFixed(2));
        }

        // 修改物理账目
        data.claimed[senderMem.memberId] = claimAmount;
        data.remainingAmount = parseFloat((data.remainingAmount - claimAmount).toFixed(2));
        data.splitsLeft = totalSplits - 1;

        if (data.splitsLeft <= 0) {
          data.status = 'opened';
        }

        await db.messages.update(msg.id, { content: JSON.stringify(data) });

        // 将 AI 抢红包事件正式转化为系统灰字消息入库，参与后续上下文长效记忆 [1.3]
        const sysMsg = {
          sessionId: msg.sessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] ${senderName} 拆开了红包，分得 ￥${claimAmount.toFixed(2)} 元`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        if (activeSessionId === msg.sessionId) {
          await appendMessageToDOM(sysMsg);
          await renderDialogMessages();
        }
      } catch(e) {
        console.error("[Group Chat Debug] AI 拆红包物理执行失败:", e);
      }
    },

    // 17. AI 收取群内定向转账物理执行器
    executeAiClaimTransferCommand: async function(senderName, targetMsgId) {
      const msg = await db.messages.get(Number(targetMsgId));
      if (!msg || msg.contentType !== 'transfer') return;

      try {
        const sess = await db.sessions.get(msg.sessionId);
        const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
        const senderMem = await this.findMemberByName(members, senderName);
        if (!senderMem) return;

        const data = JSON.parse(msg.content);
        if (data.status === 'received') return;

        // 定向收款群员身份校验 (必须与执行该指令的 AI 角色本名对齐)
        if (data.targetName) {
          const cleanedTarget = data.targetName.trim().toLowerCase();
          const cleanedSenderName = senderName.trim().toLowerCase();
          if (cleanedTarget !== cleanedSenderName) {
            console.warn(`[Group Chat Debug] AI 收取转账被拦截：目标收款人为 "${data.targetName}"，但发起收钱的为 "${senderName}"`);
            return;
          }
        }

        data.status = 'received';
        await db.messages.update(msg.id, { content: JSON.stringify(data) });

        // 写入系统灰字消息入库，供后续记忆读取
        const sysMsg = {
          sessionId: msg.sessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] ${senderName} 确认收钱，收取了转账`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        if (activeSessionId === msg.sessionId) {
          await appendMessageToDOM(sysMsg);
          await renderDialogMessages();
        }
      } catch(e) {
        console.error("[Group Chat Debug] AI 收取转账物理执行失败:", e);
      }
    },

    // 15. 成员管理页面邀请新成员
    openGroupInviteSelector: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const currentMembers = await db.group_members.where('groupId').equals(group.id).toArray();
      const currentIds = currentMembers.map(m => m.memberId);

      const listContainer = document.getElementById("group-invite-members-list");
      listContainer.innerHTML = "";

      try {
        const allArchives = await db.archives.toArray();
        // 筛选出不在群里的 Character 与 NPC（支线人物档案不在此选择）
        const chars = allArchives.filter(c => (c.type === 'character' || c.type === 'npc') && !c.isSnapshot && !currentIds.includes(c.id));

        if (chars.length === 0) {
          listContainer.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); text-align:center; padding:20px 0;">档案馆的所有角色都已在此群聊中啦。</p>`;
        } else {
          chars.forEach(c => {
            const card = document.createElement("div");
            card.className = "candidate-persona-card";
            card.style.cssText = "background:#ffffff; border:1.5px solid var(--border); border-radius:10px; padding:8px; display:flex; align-items:center; gap:10px; cursor:pointer; margin-bottom:8px; flex-shrink:0;";
            card.innerHTML = `
              <input type="checkbox" class="cb-group-invite-member" value="${c.id}" style="width:16px; height:16px; cursor:pointer;">
              <img src="${resolveAvatar(c.avatar, c.name)}" style="width:34px; height:34px; border-radius:50%; object-fit:cover;">
              <div style="flex:1; text-align:left;">
                <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${c.name}</div>
                <div style="font-size:10px; color:var(--text-secondary);">${c.remark || "暂无备注"}</div>
              </div>
            `;
            card.onclick = (e) => {
              if (e.target.tagName !== 'INPUT') {
                const cb = card.querySelector("input");
                cb.checked = !cb.checked;
              }
            };
            listContainer.appendChild(card);
          });
        }

        document.getElementById("group-invite-overlay").classList.add("active");

        // 在候选列表下方追加"文件管理"分类（三级手风琴：文件管理 > 面具 > 对话文件）
        if (window.chatArchiveSystem && window.chatArchiveSystem.renderFileMgrInviteSection) {
          await window.chatArchiveSystem.renderFileMgrInviteSection(listContainer, currentIds);
        }
      } catch (err) {
        console.error(err);
      }
    },

    submitGroupInvitation: async function() {
      const checkedBoxes = document.querySelectorAll(".cb-group-invite-member:checked");
      const fmCheckedBoxes = document.querySelectorAll(".cb-fm-invite-archive:checked");

      if (checkedBoxes.length === 0 && fmCheckedBoxes.length === 0) {
        showToast("请至少选择一位要邀请入群的群成员！");
        return;
      }

      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      try {
        // 处理档案馆常规邀请
        const invitedNames = [];
        for (const cb of checkedBoxes) {
          const charId = Number(cb.value);
          const char = await db.archives.get(charId);
          if (!char) continue;

          await db.group_members.add({
            groupId: group.id,
            memberId: charId,
            memberType: 'char',
            role: 'member',
            muteUntil: 0,
            title: '',
            syncFromSingle: 1,
            syncToSingle: 1
          });
          invitedNames.push(char.name);

          const sysMsg = {
            sessionId: activeSessionId,
            senderType: 'system',
            senderId: 0,
            content: `[系统通知] ${myName} 邀请 ${char.name} 加入了群聊`,
            contentType: 'text',
            timestamp: Date.now()
          };
          await db.messages.add(sysMsg);
        }

        // 群管家迎新人（有欢迎语且启用中的机器人各发一条）
        if (invitedNames.length > 0) {
          const freshGroup = await db.groups.get(group.id);
          await this.sendBotWelcome(freshGroup, null, invitedNames.join('、'));
        }

        // 处理文件管理存档引入
        if (fmCheckedBoxes.length > 0 && window.chatArchiveSystem && window.chatArchiveSystem.submitFileMgrGroupInvitation) {
          await window.chatArchiveSystem.submitFileMgrGroupInvitation(group.id);
        }

        showToast("群成员邀请加入成功！");
        document.getElementById("group-invite-overlay").classList.remove("active");
        
        // 刷新群头和成员列表
        const memberCount = await db.group_members.where('groupId').equals(group.id).count();
        document.getElementById("dialog-header-title").innerText = `${sess.customCharName} (${memberCount})`;
        
        this.openGroupMembersManager();
        await renderDialogMessages();
      } catch(e) {
        console.error(e);
        showToast("邀请成员失败: " + e.message);
      }
    },

    // 18. 主动下架并归档置顶公告（归档进历史，可回看 / 重新发布）
    archiveAnnouncement: async function(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group || !group.announcement) return;

      const ann = group.announcement;
      const history = Array.isArray(group.announcementHistory) ? group.announcementHistory.slice() : [];
      history.unshift(Object.assign({}, ann, { archivedAt: Date.now() }));
      const trimmed = history.slice(0, 30);

      await db.groups.update(group.id, { announcement: null, announcementHistory: trimmed });

      const myName = await this._myName();
      await this._sysNotify(`[系统通知] ${myName} 下架并归档了置顶群公告：《${ann.title}》`);

      showToast("置顶群公告已下架并归档");
      const fresh = await db.groups.get(group.id);
      this.renderGroupAnnouncement(fresh);
      await renderDialogMessages();
    },

    openAnnouncementHistory: async function() {
      const self = this;
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;
      const list = Array.isArray(group.announcementHistory) ? group.announcementHistory : [];

      let body;
      if (list.length === 0) {
        body = '<div class="group-sheet-empty">还没有历史公告</div>';
      } else {
        body = list.map((a, i) =>
          '<div class="group-announce-item" data-idx="' + i + '">' +
            '<div class="gai-title">' + self._esc(a.title) + '</div>' +
            '<div class="gai-text">' + self._esc(a.text) + '</div>' +
            '<div class="gai-meta">' + (a.archivedAt ? new Date(a.archivedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + '</div>' +
          '</div>'
        ).join('');
      }

      const el = this._sheet({
        title: '历史公告', icon: this._icon.archive, body: body,
        actions: [{ label: '关闭', cls: 'ghost', onClick: function () { self._closeSheet(); } }]
      });

      el.querySelectorAll('.group-announce-item').forEach(item => {
        item.onclick = function () {
          const a = list[Number(item.getAttribute('data-idx'))];
          if (!a) return;
          self._sheet({
            title: a.title, icon: self._icon.bell,
            body: '<div class="group-sheet-text">' + self._esc(a.text).replace(/\n/g, '<br>') + '</div>' +
                  '<div class="group-sheet-row"><span class="gsr-label">归档于</span><span class="gsr-value">' +
                    (a.archivedAt ? new Date(a.archivedAt).toLocaleString('zh-CN') : '未知') + '</span></div>',
            actions: [
              { label: '重新置顶', cls: 'primary', icon: self._icon.bell, onClick: function () { self.republishAnnouncement(a); } },
              { label: '删除', cls: 'danger', icon: self._icon.trash, onClick: function () { self.deleteAnnouncementHistory(a.archivedAt); } },
              { label: '返回', cls: 'ghost', onClick: function () { self.openAnnouncementHistory(); } }
            ]
          });
        };
      });
    },

    republishAnnouncement: async function(a) {
      const group = await db.groups.get((await db.sessions.get(activeSessionId)).groupId);
      if (!group) return;
      const ann = {
        title: a.title, text: a.text,
        publisherId: Number(activeUserPersonaId), publisherType: 'user',
        readBy: [], expireAt: 0, republishedAt: Date.now()
      };
      await db.groups.update(group.id, { announcement: ann });
      await this._sysNotify(`[系统通知] 置顶群公告被重新发布：《${a.title}》`);
      this._closeSheet();
      showToast("公告已重新置顶");
      const fresh = await db.groups.get(group.id);
      this.renderGroupAnnouncement(fresh);
      await renderDialogMessages();
    },

    deleteAnnouncementHistory: async function(archivedAt) {
      const self = this;
      this._confirm("删除历史公告", "确定要从历史记录中删除这条公告吗？", async function () {
        const group = await db.groups.get((await db.sessions.get(activeSessionId)).groupId);
        if (!group) return;
        const list = (group.announcementHistory || []).filter(a => a.archivedAt !== archivedAt);
        await db.groups.update(group.id, { announcementHistory: list });
        showToast("已删除");
        self.openAnnouncementHistory();
      }, "删除");
    },

    editAnnouncement: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group || !group.announcement) return;
      const ann = group.announcement;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      window.__editingAnnouncement = true;
      set('group-announce-title', ann.title);
      set('group-announce-text', ann.text);
      const expEl = document.getElementById('group-announce-expire');
      if (expEl) expEl.value = '0';
      this._closeSheet();
      const titleEl = document.getElementById('group-announce-form-title');
      if (titleEl) titleEl.innerText = '编辑群公告';
      document.getElementById('group-announce-overlay').classList.add('active');
    },

    // 19. 主动下架并归档群投票
    archivePoll: async function(msgId, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const msg = await db.messages.get(Number(msgId));
      if (!msg) return;

      try {
        const poll = JSON.parse(msg.content);
        poll.status = 'archived';
        await db.messages.update(msg.id, { content: JSON.stringify(poll) });

        const myUser = await db.archives.get(Number(activeUserPersonaId));
        const myName = myUser ? myUser.name : "User";

        const sysMsg = {
          sessionId: msg.sessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] 成员 ${myName} 已下架并归档了投票：《${poll.title}》，投票通道已关闭`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast("投票通道已关闭并成功归档");
        await renderDialogMessages();
      } catch(err) {
        console.error(err);
      }
    },

    // AI 角色确认阅读群置顶公告指令 [READ_ANNOUNCE: 消息ID] [2]
    executeAiReadAnnounceCommand: async function(senderName, targetMsgId) {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group || !group.announcement) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const senderMem = await this.findMemberByName(members, senderName);
      if (!senderMem) return;

      const ann = group.announcement;
      if (!this.isReadBy(ann.readBy, senderMem)) {
        ann.readBy = this.addReadBy(ann.readBy, senderMem);
        await db.groups.update(group.id, { announcement: ann });

        // 写入系统消息落库
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] ${senderName} 已阅置顶公告：《${ann.title}》`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        const fresh = await db.groups.get(group.id);
        this.renderGroupAnnouncement(fresh);
        await renderDialogMessages();
      }
    },

    // AI 角色参与群内投票指令 [VOTE_POLL: 投票消息ID (选项索引)] [2]
    executeAiVotePollCommand: async function(senderName, targetMsgId, optionIndex) {
      const msg = await db.messages.get(Number(targetMsgId));
      if (!msg || msg.contentType !== 'group_poll') return;

      try {
        const sess = await db.sessions.get(msg.sessionId);
        const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
        const senderMem = await this.findMemberByName(members, senderName);
        if (!senderMem) return;

        const poll = JSON.parse(msg.content);
        if (this._pollClosed(poll)) return;

        // 角色禁言核验
        if (senderMem.muteUntil && senderMem.muteUntil > Date.now()) return;

        this._applyVote(poll, senderMem, optionIndex);

        await db.messages.update(msg.id, { content: JSON.stringify(poll) });

        // 写入系统消息落库
        const sysMsg = {
          sessionId: msg.sessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] ${senderName} 参与了投票，投给了 【${poll.options[optionIndex]}】`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        await renderDialogMessages();
      } catch(e) {
        console.error("[Group Chat Debug] AI 参与投票指令执行失败:", e);
      }
    }
  };

  // 挂载
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => groupChatSystem.init());
  } else {
    groupChatSystem.init();
  }

  window.groupChatSystem = groupChatSystem;
})();