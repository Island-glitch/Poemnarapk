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

    // 2. 选择单聊角色
    openDirectChatSelector: async function() {
      const overlay = document.getElementById("new-chat-overlay");
      const list = document.getElementById("new-chat-list");
      if (!overlay || !list) return;
      list.innerHTML = "";

      try {
        const allArchives = await db.archives.toArray();
        const chars = allArchives.filter(c => c.type === 'character' || c.type === 'npc');
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
        const chars = allArchives.filter(c => c.type === 'character' || c.type === 'npc');

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

      // 渲染群消息
      await renderDialogMessages();
    },
    // 6. 顶端群公告面板随动
    renderGroupAnnouncement: async function(group) {
      let stickyBar = document.getElementById("group-announcement-sticky");
      if (stickyBar) stickyBar.remove();

      if (!group || !group.announcement) return;

      const ann = group.announcement;
      const readBy = ann.readBy || [];
      const isDone = readBy.includes(Number(activeUserPersonaId));

      // 提取身份校验权限
      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      const myMember = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const isPrivileged = myMember && (myMember.role === 'owner' || myMember.role === 'admin');

      // 管理员和群主专属的“归档/下架”公告按钮，采用 SVG 归档箱形式渲染
      let archiveBtnHtml = "";
      if (isPrivileged) {
        archiveBtnHtml = `
          <button class="btn-icon" style="color:#64748b; margin-left:8px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer;" onclick="window.groupChatSystem.archiveAnnouncement(event)" title="下架并归档此置顶公告">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 8H3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2z"/><path d="M10 12h4"/><path d="M19 8v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/></svg>
          </button>
        `;
      }

      stickyBar = document.createElement("div");
      stickyBar.id = "group-announcement-sticky";
      stickyBar.className = "group-announcement-sticky-bar";
      
      stickyBar.innerHTML = `
        <div class="group-announcement-content-area" style="cursor:pointer;" onclick="window.groupChatSystem.viewAnnouncementDetails()">
          <div style="display:flex; align-items:center; gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ef4444" stroke-width="2.5" style="flex-shrink:0;">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span class="group-announcement-title" style="font-size:12px; font-weight:800; color:#ef4444;">置顶公告: ${escapeHtml(ann.title)}</span>
          </div>
          <span class="group-announcement-text" style="padding-left:20px; box-sizing:border-box; display:block;">${escapeHtml(ann.text)}</span>
        </div>
        <div style="display:flex; align-items:center; flex-shrink:0;">
          ${!isDone ? `<button class="btn-group-announcement-done" onclick="window.groupChatSystem.markAnnouncementDone(event)">完成</button>` : `<span style="font-size:10px; color:#94a3b8; font-weight:700; margin-left:12px; white-space:nowrap;">已阅</span>`}
          ${archiveBtnHtml}
        </div>
      `;
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

      const ann = group.announcement;
      if (!ann.readBy) ann.readBy = [];
      if (!ann.readBy.includes(Number(activeUserPersonaId))) {
        ann.readBy.push(Number(activeUserPersonaId));
        await db.groups.update(group.id, { announcement: ann });

        const myUser = await db.archives.get(Number(activeUserPersonaId));
        const myName = myUser ? myUser.name : "User";

        // 将玩家已读公告转化为系统通知灰字入库上下文，实现 LLM 强感知 [3]
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
        this.renderGroupAnnouncement(group);
        await renderDialogMessages();
      }
    },

    viewAnnouncementDetails: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group || !group.announcement) return;

      const ann = group.announcement;
      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      
      // 提取发送人角色
      const myMember = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const isAdminOrOwner = myMember && (myMember.role === 'owner' || myMember.role === 'admin');

      let processListHtml = "";
      if (isAdminOrOwner) {
        const readIds = ann.readBy || [];
        let doneNames = [];
        let pendingNames = [];

        for (const m of members) {
          let name = "未知";
          if (m.memberType === 'user') {
            const u = await db.archives.get(m.memberId);
            name = u ? u.name : "我";
          } else {
            const c = await db.archives.get(m.memberId);
            name = c ? c.name : "对方";
          }

          if (readIds.includes(m.memberId)) {
            doneNames.push(name);
          } else {
            pendingNames.push(name);
          }
        }
        processListHtml = `
          <div style="margin-top:12px; border-top:1.5px dashed var(--border); padding-top:10px; text-align:left; font-size:11px; line-height:1.4;">
            <div style="color:#07c160; font-weight:700;">已读成员 (${doneNames.length}人): <span style="font-weight:normal; color:#475569;">${doneNames.join('、') || "无"}</span></div>
            <div style="color:#ef4444; font-weight:700; margin-top:4px;">未读成员 (${pendingNames.length}人): <span style="font-weight:normal; color:#475569;">${pendingNames.join('、') || "无"}</span></div>
          </div>
        `;
      }

      // 调用 HTML 高透弹窗，彻底解决已读列表代码被转译泄露的问题 [2]
      window.showCustomHtmlAlert(ann.title, `${escapeHtml(ann.text).replace(/\n/g, "<br>")}\n${processListHtml}`);
    },

    // 7. 渲染群投票卡片
    renderPollCardInMsg: async function(m) {
      const cardContainer = document.createElement("div");
      cardContainer.style.cssText = "display:flex; justify-content:center; margin:12px 0; width:100%; box-sizing:border-box; padding:0 16px;";

      try {
        const sess = await db.sessions.get(m.sessionId);
        const members = await db.group_members.where('groupId').equals(sess.groupId).toArray();
        const myMember = members.find(mem => mem.memberId === Number(activeUserPersonaId) && mem.memberType === 'user');
        const isPrivileged = myMember && (myMember.role === 'owner' || myMember.role === 'admin');

        const poll = JSON.parse(m.content);
        const options = poll.options || [];
        const votes = poll.votes || {};
        const isArchived = poll.status === 'archived';

        let totalVotes = 0;
        Object.keys(votes).forEach(optIdx => {
          totalVotes += (votes[optIdx] || []).length;
        });

        // 仅限群主和管理员对未归档的投票卡片执行“一键归档下架”
        let archiveBtnHtml = "";
        if (isPrivileged && !isArchived) {
          archiveBtnHtml = `
            <button class="btn-icon" style="color:#ef4444; border:none; background:none; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;" onclick="window.groupChatSystem.archivePoll(${m.id}, event)" title="归档并关闭本轮投票通道">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 8H3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2z"/><path d="M10 12h4"/><path d="M19 8v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/></svg>
            </button>
          `;
        }

        const card = document.createElement("div");
        card.className = "group-poll-card";
        card.innerHTML = `
          <div class="group-poll-card-title" style="display:flex; justify-content:space-between; align-items:center; font-weight:800; color:#1e293b; border-bottom:1.5px dashed var(--border); padding-bottom:6px;">
            <span>📊 ${isArchived ? '[已归档] ' : '进行中: '}${escapeHtml(poll.title)}</span>
            ${archiveBtnHtml}
          </div>
        `;

        options.forEach((opt, idx) => {
          const optVotes = votes[idx] || [];
          const pct = totalVotes > 0 ? Math.round((optVotes.length / totalVotes) * 100) : 0;
          const isVotedByMe = optVotes.includes(Number(activeUserPersonaId));

          const row = document.createElement("div");
          row.className = "group-poll-option-row";
          row.innerHTML = `
            <div class="group-poll-option-header">
              <span>${idx + 1}. ${escapeHtml(opt)} ${isVotedByMe ? '<span style="color:#07c160; font-weight:700;">(已投)</span>' : ''}</span>
              <span>${optVotes.length} 票 (${pct}%)</span>
            </div>
            <div class="group-poll-progressbar">
              <div class="group-poll-progressbar-fill" style="width: ${pct}%; background:${isVotedByMe ? '#10b981' : '#3b82f6'};"></div>
            </div>
          `;
          row.onclick = () => this.voteInPoll(m.id, idx);
          card.appendChild(row);
        });

        cardContainer.appendChild(card);
      } catch(e) {
        cardContainer.innerHTML = `<p style="text-align:center; color:#94a3b8; font-size:11px;">投票卡片加载错误</p>`;
      }
      return cardContainer;
    },

    voteInPoll: async function(msgId, optionIndex) {
      const msg = await db.messages.get(Number(msgId));
      if (!msg) return;

      try {
        const poll = JSON.parse(msg.content);
        if (poll.status === 'archived') {
          showToast("该投票通道已关闭归档，无法继续投票！");
          return;
        }

        if (!poll.votes) poll.votes = {};
        
        // 单选机制：清除我之前在其它选项投的票
        Object.keys(poll.votes).forEach(idx => {
          poll.votes[idx] = (poll.votes[idx] || []).filter(id => id !== Number(activeUserPersonaId));
        });

        if (!poll.votes[optionIndex]) poll.votes[optionIndex] = [];
        poll.votes[optionIndex].push(Number(activeUserPersonaId));

        await db.messages.update(msg.id, { content: JSON.stringify(poll) });

        const myUser = await db.archives.get(Number(activeUserPersonaId));
        const myName = myUser ? myUser.name : "User";

        // 将玩家投票行为转化为系统灰色通知消息入库，同步计入上下文 [3]
        const sysMsg = {
          sessionId: msg.sessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] ${myName} 参与了投票，投给了 【${poll.options[optionIndex]}】`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast("投票成功");
        await renderDialogMessages();
      } catch(e) {
        console.error(e);
      }
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

      // 机器人群助手
      const btnHelper = document.getElementById("btn-chat-group-helper");
      if (btnHelper) {
        btnHelper.onclick = () => {
          document.getElementById("chat-expand-panel").classList.remove("active");
          this.openGroupHelperSetup();
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

      const pollData = {
        title,
        options,
        votes: {} 
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
      showToast("投票发布上屏成功！");
      await renderDialogMessages();
    },

    // 9. 机器人群助手
    openGroupHelperSetup: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const bot = group.bots && group.bots.length > 0 ? group.bots[0] : { name: "养鸡农场", avatar: "", persona: "", commands: "起名 | @Sender 你的小鸡【VALUE】正在吃草！\n签到 | @Sender 签到成功！当前饱食度：80%，已兑换饲料5kg" };

      document.getElementById("group-bot-name").value = bot.name;
      document.getElementById("group-bot-avatar").value = bot.avatar || "";
      document.getElementById("group-bot-persona").value = bot.persona || "";
      document.getElementById("group-bot-commands").value = bot.commands || "";

      document.getElementById("group-helper-overlay").classList.add("active");
    },

    saveGroupBot: async function() {
      const name = document.getElementById("group-bot-name").value.trim();
      const avatar = document.getElementById("group-bot-avatar").value.trim();
      const persona = document.getElementById("group-bot-persona").value.trim();
      const commands = document.getElementById("group-bot-commands").value.trim();

      if (!name) {
        showToast("请填写机器人名称！");
        return;
      }

      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const newBot = { name, avatar, persona, commands };
      group.bots = [newBot]; 

      await db.groups.put(group);
      document.getElementById("group-helper-overlay").classList.remove("active");
      showToast("群助手机器人配置成功！在聊天中 @ 机器人名称即可互动。");
    },

    interceptBotTrigger: async function(text, senderName) {
      const sess = await db.sessions.get(activeSessionId);
      if (!sess || sess.isGroup !== 1) return false;

      const group = await db.groups.get(sess.groupId);
      if (!group || !group.bots || group.bots.length === 0) return false;

      const bot = group.bots[0];
      const summonPrefix = `@${bot.name}`;

      // 核心升级：不再局限于首部艾特，检测消息任意位置被艾特即可做出反应
      if (!text.includes(summonPrefix)) return false;

      const cmdBody = text.substring(text.indexOf(summonPrefix) + summonPrefix.length).trim();
      let triggeredReply = "";

      // 1. 尝试分析快捷内置命令
      const cmdList = bot.commands.split('\n').map(l => l.trim()).filter(Boolean);
      let isCommandMatched = false;

      for (const line of cmdList) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 2) continue;

        const cmdName = parts[0];
        const cmdTemplate = parts[1];

        if (cmdBody.startsWith(cmdName)) {
          isCommandMatched = true;
          const paramValue = cmdBody.replace(cmdName, "").replace(/[:：]/g, "").trim();
          triggeredReply = cmdTemplate
            .replace(/@Sender/g, `@${senderName}`)
            .replace(/【VALUE】/g, paramValue || "无")
            .replace(/\[VALUE\]/g, paramValue || "无");
          break;
        }
      }

      // 2. 未匹配快捷指令，则调用大模型
      if (!isCommandMatched) {
        showToast("群助手正在解析脑电波中...");
        try {
          const presetId = localStorage.getItem("global_api_preset_id");
          const api = await db.api_presets.get(Number(presetId));
          if (!api) throw new Error();

          const botSystem = `【机器人扮演要求】
你是一个部署在微信群聊中的机器人助手。
- 你的名字：${bot.name}
- 你的性格背景与底料设定：${bot.persona}

你刚刚收到了成员 [@${senderName}] 的艾特消息：“${cmdBody}”。
请你扮演该机器人，直接写一句极具特色、符合设定的回复语本身，限40字内。回复最前面必须带上 @${senderName} 标记。`;

          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: [{ role: "user", content: botSystem }],
              temperature: 0.7
            })
          });

          if (response.ok) {
            const result = await response.json();
            triggeredReply = result.choices[0].message.content.trim();
          }
        } catch(e) {
          triggeredReply = `@${senderName} 嘀... 养鸡农场信号有些虚弱，等会再试吧。`;
        }
      }

      if (triggeredReply) {
        const botMsg = {
          sessionId: activeSessionId,
          senderType: 'char',
          senderId: 99999, // 99999 标识机器人
          content: triggeredReply,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(botMsg);
        
        activeSessionCharAvatar = bot.avatar || "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%2364748b'/></svg>";
        await renderDialogMessages();
        return true;
      }
      return false;
    },

    // 10. 群公告发布
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

      document.getElementById("group-announce-title").value = "";
      document.getElementById("group-announce-text").value = "";
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

      const announcement = {
        title,
        text,
        publisherId: Number(activeUserPersonaId),
        publisherType: 'user',
        readBy: []
      };

      await db.groups.update(group.id, { announcement });
      document.getElementById("group-announce-overlay").classList.remove("active");
      showToast("群公告发布成功！");
      this.renderGroupAnnouncement(group);
    },

    // 11. 成员管理
    openGroupMembersManager: async function() {
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const members = await db.group_members.where('groupId').equals(group.id).toArray();
      document.getElementById("group-member-count-total").innerText = members.length;
      
      // 仿真计算活跃指标
      document.getElementById("group-online-count").innerText = Math.round(members.length * 0.7);
      document.getElementById("group-active-count").innerText = Math.max(1, Math.round(members.length * 0.4));

      const listBox = document.getElementById("group-members-list-box");
      listBox.innerHTML = "";

      const myMemberState = members.find(m => m.memberId === Number(activeUserPersonaId) && m.memberType === 'user');
      const myRole = myMemberState ? myMemberState.role : 'member';

      for (const m of members) {
        let name = "未知";
        let avatarUrl = "";
        let groupName = "群友";

        if (m.memberType === 'user') {
          const u = await db.archives.get(m.memberId);
          name = u ? u.name : "我";
          avatarUrl = resolveAvatar(u?.avatar);
          groupName = "玩家面具";
        } else {
          const c = await db.archives.get(m.memberId);
          name = c ? c.name : "对方";
          avatarUrl = resolveAvatar(c?.avatar);
          groupName = c ? (c.group || "默认分组") : "群友";
        }

        const item = document.createElement("div");
        item.style.cssText = "background:#ffffff; border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; box-shadow: var(--shadow-sm);";
        
        let roleLabel = "";
        if (m.role === 'owner') roleLabel = `<span style="font-size:9.5px; background-color:#ef4444; color:#fff; padding:1px 4px; border-radius:4px; font-weight:700;">群主</span>`;
        else if (m.role === 'admin') roleLabel = `<span style="font-size:9.5px; background-color:#3b82f6; color:#fff; padding:1px 4px; border-radius:4px; font-weight:700;">管理员</span>`;

        const isMuted = m.muteUntil && m.muteUntil > Date.now();
        const muteLabel = isMuted ? `<span style="font-size:9.5px; background-color:#64748b; color:#fff; padding:1px 4px; border-radius:4px; font-weight:700; margin-left:4px;">禁言中</span>` : "";

        let actionsHtml = "";
        if (m.memberId !== Number(activeUserPersonaId) || m.memberType !== 'user') {
          if (myRole === 'owner') {
            actionsHtml = `
              <div style="display:flex; gap:6px; flex-wrap:wrap; border-top:1px dashed var(--border); padding-top:8px;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.transferOwner(${m.id})">转让群主</button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.toggleAdmin(${m.id})">${m.role === 'admin' ? '取消管理' : '设为管理'}</button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.muteMember(${m.id})">${isMuted ? '解禁' : '禁言'}</button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.setMemberTitle(${m.id})">设置头衔</button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; color:#ef4444; border-color:#fca5a5; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.kickMember(${m.id})">踢出</button>
              </div>
            `;
          } else if (myRole === 'admin') {
            if (m.role === 'member') {
              actionsHtml = `
                <div style="display:flex; gap:6px; flex-wrap:wrap; border-top:1px dashed var(--border); padding-top:8px;">
                  <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.muteMember(${m.id})">${isMuted ? '解禁' : '禁言'}</button>
                  <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.setMemberTitle(${m.id})">设置头衔</button>
                  <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; color:#ef4444; border-color:#fca5a5; border-radius:6px; font-weight:700;" onclick="window.groupChatSystem.kickMember(${m.id})">踢出</button>
                </div>
              `;
            }
          }
        }

        item.innerHTML = `
          <div style="display:flex; gap:10px; align-items:center;">
            <img src="${avatarUrl}" style="width:38px; height:38px; border-radius:50%; object-fit:cover;">
            <div style="flex:1; text-align:left;">
              <div style="font-size:11.5px; font-weight:500; color:var(--text-secondary);">${escapeHtml(groupName)}</div>
              <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin-top:2px;">${roleLabel}${muteLabel} ${escapeHtml(name)}</div>
              ${m.title ? `<div style="font-size:10px; color:var(--primary); font-weight:700; margin-top:2px;">群头衔: ${escapeHtml(m.title)}</div>` : ''}
            </div>
          </div>
          ${actionsHtml}
        `;
        listBox.appendChild(item);
      }

      document.getElementById("group-members-panel").classList.add("active");
    },

    transferOwner: async function(dbMemberId) {
      const member = await db.group_members.get(Number(dbMemberId));
      if (!member) return;

      const confirmTx = confirm(`确定要将群主无条件转让给该成员吗？转让后你将降级为普通成员！`);
      if (!confirmTx) return;

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

      // 将转让群主操作转化为灰色置中系统消息写入数据库上下文
      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] 群主 ${myName} 已将群主权限安全转让给 ${targetName}`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);

      showToast("群主转让成功！");
      this.openGroupMembersManager();
      await renderDialogMessages();
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

      if (confirm(`确认要将该成员踢出群聊吗？`)) {
        await db.group_members.delete(member.id);

        // 将移出群聊事件转化为系统通知卡片入库
        const sysMsg = {
          sessionId: activeSessionId,
          senderType: 'system',
          senderId: 0,
          content: `[系统通知] 管理员/群主 ${myName} 已将 ${targetName} 移出群聊`,
          contentType: 'text',
          timestamp: Date.now()
        };
        await db.messages.add(sysMsg);

        showToast("成员已被移出群聊");
        this.openGroupMembersManager();
        await renderDialogMessages();
      }
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
        customCharAvatar: avatar
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
      
      // 第一级：精确全等匹配
      for (const m of members) {
        if (m.memberType === 'char') {
          const char = await db.archives.get(m.memberId);
          console.log(`[Group Chat Debug] 5. 精确匹配校验 -> 档案馆ID: ${m.memberId}，角色本名: "${char ? char.name : '未知'}"`);
          if (char && char.name.trim() === senderName) {
            targetCharId = m.memberId;
            console.log(`[Group Chat Debug] 5-1. 精确匹配成功！对准档案馆 ID: ${targetCharId}`);
            break;
          }
        }
      }

      // 第二级（自愈）：模糊包含匹配，防范模型写错名字
      if (!targetCharId) {
        for (const m of members) {
          if (m.memberType === 'char') {
            const char = await db.archives.get(m.memberId);
            console.log(`[Group Chat Debug] 6. 模糊匹配校验 -> 档案馆ID: ${m.memberId}，角色本名: "${char ? char.name : '未知'}"`);
            if (char && (char.name.includes(senderName) || senderName.includes(char.name))) {
              targetCharId = m.memberId;
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
          if (c && c.name.trim().toLowerCase() === cleanedName) {
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
        readBy: []
      };

      await db.groups.update(group.id, { announcement });
      
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
        // 筛选出不在群里的 Character 与 NPC
        const chars = allArchives.filter(c => (c.type === 'character' || c.type === 'npc') && !currentIds.includes(c.id));

        if (chars.length === 0) {
          listContainer.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); text-align:center; padding:20px 0;">档案馆的所有角色都已在此群聊中啦。</p>`;
          return;
        }

        chars.forEach(c => {
          const card = document.createElement("div");
          card.className = "candidate-persona-card";
          card.style.cssText = "background:#ffffff; border:1.5px solid var(--border); border-radius:10px; padding:8px; display:flex; align-items:center; gap:10px; cursor:pointer; margin-bottom:8px;";
          card.innerHTML = `
            <input type="checkbox" class="cb-group-invite-member" value="${c.id}" style="width:16px; height:16px; cursor:pointer;">
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
          listContainer.appendChild(card);
        });

        document.getElementById("group-invite-overlay").classList.add("active");
      } catch (err) {
        console.error(err);
      }
    },

    submitGroupInvitation: async function() {
      const checkedBoxes = document.querySelectorAll(".cb-group-invite-member:checked");
      if (checkedBoxes.length === 0) {
        showToast("请至少选择一位要邀请入群的群成员！");
        return;
      }

      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      try {
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

    // 18. 主动下架并归档置顶公告
    archiveAnnouncement: async function(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const sess = await db.sessions.get(activeSessionId);
      const group = await db.groups.get(sess.groupId);
      if (!group) return;

      const oldTitle = group.announcement ? group.announcement.title : "群公告";
      await db.groups.update(group.id, { announcement: null });

      const myUser = await db.archives.get(Number(activeUserPersonaId));
      const myName = myUser ? myUser.name : "User";

      const sysMsg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] 成员 ${myName} 下架并归档了置顶群公告：《${oldTitle}》`,
        contentType: 'text',
        timestamp: Date.now()
      };
      await db.messages.add(sysMsg);

      showToast("置顶群公告已成功下架并归档");
      const freshGroup = await db.groups.get(group.id);
      this.renderGroupAnnouncement(freshGroup);
      await renderDialogMessages();
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
      if (!ann.readBy) ann.readBy = [];
      if (!ann.readBy.includes(senderMem.memberId)) {
        ann.readBy.push(senderMem.memberId);
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

        this.renderGroupAnnouncement(group);
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
        if (!poll.votes) poll.votes = {};

        // 角色禁言核验
        if (senderMem.muteUntil && senderMem.muteUntil > Date.now()) return;

        // 清理该角色在其他选项投过的票
        Object.keys(poll.votes).forEach(idx => {
          poll.votes[idx] = (poll.votes[idx] || []).filter(id => id !== senderMem.memberId);
        });

        if (!poll.votes[optionIndex]) poll.votes[optionIndex] = [];
        poll.votes[optionIndex].push(senderMem.memberId);

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