/**
 * app_chat_archives.js - 对话快照（文件管理）核心模块
 *
 * 功能：
 * 1. 单聊"在此刻分支"：创建包含完整对话数据的即时快照
 * 2. 文件管理页：按 user（顶部切换）+ char（下方分类）浏览快照
 * 3. 从存档建立对话：在当前面具下完全复原一个对话
 * 4. 群聊邀请：从文件管理引入存档角色（携带记忆双向同步）
 *
 * 依赖全局：db / resolveAvatar / escapeHtml / showCustomPrompt / showCustomConfirm / showToast
 *           openWeChatDialog / activeSessionId / activeUserPersonaId / serializeRecord
 */

// ==========================================
//             1. 对话快照创建
// ==========================================

// 生成全局唯一的自定义标签（如果用户留空）
async function generateUniqueCustomLabel(userName, charName) {
  const prefix = `${userName}-${charName}`;
  const existing = await db.chat_archives.where('customLabel').startsWith(prefix).toArray();
  let maxIdx = 0;
  for (const a of existing) {
    const m = (a.customLabel || "").match(/-(\d+)$/);
    if (m) maxIdx = Math.max(maxIdx, parseInt(m[1]));
  }
  return `${prefix}-${String(maxIdx + 1).padStart(3, "0")}`;
}

// 校验自定义标签全局唯一
async function isCustomLabelUnique(label, excludeId) {
  const matches = await db.chat_archives.where('customLabel').equals(label).toArray();
  if (excludeId) return matches.filter(a => a.id !== excludeId).length === 0;
  return matches.length === 0;
}

// 安全读取关联表数据（表可能不存在或查询失败）
async function safeTableQuery(tableRef, mode, ...args) {
  try {
    if (!tableRef) return [];
    if (mode === 'where') {
      const col = tableRef.where(args[0]);
      return await col.equals(args[1]).toArray();
    } else if (mode === 'get') {
      const rec = await tableRef.get(args[0]);
      return rec ? [rec] : [];
    }
    return [];
  } catch (e) {
    return [];
  }
}

// 创建当前单聊对话的完整快照（全量切片：对话/心声/记忆/总结/查手机/剧场/HTML卡片/深谈/生图/向量等）
async function createChatSnapshot(sessionId, customLabel) {
  const sess = await db.sessions.get(sessionId);
  if (!sess) throw new Error("会话不存在");

  const char = sess.charId ? await db.archives.get(sess.charId) : null;
  const user = sess.userId ? await db.archives.get(sess.userId) : null;
  const charName = sess.customCharName || char?.name || "未知角色";
  const userName = sess.customUserName || user?.name || "我";

  // 确定自定义标签
  let label = (customLabel || "").trim();
  if (!label) {
    label = await generateUniqueCustomLabel(userName, charName);
  } else {
    label = `${userName}-${charName}-${label}`;
    if (!(await isCustomLabelUnique(label))) {
      throw new Error("该自定义字段已存在，请换一个");
    }
  }

  // === 收集完整对话数据（全量切片） ===
  const messages = await db.messages.where('sessionId').equals(sessionId).toArray();
  const summaries = await db.summaries.where('sessionId').equals(sessionId).toArray();
  const statusHistory = await db.status_history.where('sessionId').equals(sessionId).toArray();

  let dialogueVectors = [];
  try { dialogueVectors = await db.dialogue_vectors.where('sessionId').equals(sessionId).toArray(); } catch (e) {}

  // 线下消息（赴约/剧场共用 offline_messages 表，按 sessionId 关联）
  let offlineMessages = [];
  try { offlineMessages = await db.offline_messages.where('sessionId').equals(sessionId).toArray(); } catch (e) {}

  // 独立剧场主表
  let theaters = [];
  try { theaters = await db.theaters.where('sessionId').equals(sessionId).toArray(); } catch (e) {}

  // 查手机状态（主键就是 sessionId）
  let checkPhoneState = null;
  try { checkPhoneState = await db.check_phone_states.get(Number(sessionId)); } catch (e) {}

  // HTML 互动卡片
  let htmlCards = [];
  try { htmlCards = await db.html_cards.where('sessionId').equals(sessionId).toArray(); } catch (e) {}

  // 深谈主记录 + 子消息 + 闪念
  let deeptalks = [];
  let deeptalkMessages = [];
  let deeptalkThoughts = [];
  try {
    deeptalks = await db.deeptalks.where('sessionId').equals(sessionId).toArray();
    for (const dt of deeptalks) {
      const dtMsgs = await db.deeptalk_messages.where('deeptalkId').equals(dt.id).toArray();
      deeptalkMessages.push(...dtMsgs);
    }
  } catch (e) {}
  try { deeptalkThoughts = await db.deeptalk_thoughts.where('sessionId').equals(sessionId).toArray(); } catch (e) {}

  // 生图会话设置
  let imagegenSettings = [];
  try { imagegenSettings = await db.imagegen_session_settings.where('sessionId').equals(sessionId).toArray(); } catch (e) {}

  // 完整捕获 user/char 档案记录（头像/人设/姓名），使恢复时完全自洽，不依赖任何面具查找
  const userArchiveData = user ? {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    persona: user.persona,
    remark: user.remark || ""
  } : null;
  const charArchiveData = char ? {
    id: char.id,
    name: char.name,
    avatar: char.avatar,
    persona: char.persona,
    remark: char.remark || ""
  } : null;

  // 序列化（处理 Blob 头像等二进制字段）
  const snapshotData = await serializeRecord({
    session: sess,
    userArchive: userArchiveData,
    charArchive: charArchiveData,
    messages: messages,
    summaries: summaries,
    statusHistory: statusHistory,
    dialogueVectors: dialogueVectors,
    offlineMessages: offlineMessages,
    theaters: theaters,
    checkPhoneState: checkPhoneState,
    htmlCards: htmlCards,
    deeptalks: deeptalks,
    deeptalkMessages: deeptalkMessages,
    deeptalkThoughts: deeptalkThoughts,
    imagegenSettings: imagegenSettings
  });

  const record = {
    userId: sess.userId || 0,
    charId: sess.charId || 0,
    customLabel: label,
    charName: charName,
    userName: userName,
    createdAt: Date.now(),
    snapshotData: snapshotData
  };

  const id = await db.chat_archives.add(record);
  return { id, label };
}

// 弹出命名卡片，创建快照
async function promptAndCreateSnapshot(sessionId) {
  const sess = await db.sessions.get(sessionId);
  if (!sess) { showToast("会话不存在"); return; }
  if (sess.isGroup === 1) { showToast("分支功能仅支持单聊"); return; }

  const char = sess.charId ? await db.archives.get(sess.charId) : null;
  const user = sess.userId ? await db.archives.get(sess.userId) : null;
  const charName = sess.customCharName || char?.name || "未知角色";
  const userName = sess.customUserName || user?.name || "我";

  showCustomPrompt(
    `在此刻分支\n命名格式：${userName}-${charName}-(自定义字段)`,
    "",
    async (input) => {
      const customField = (input || "").trim();
      try {
        const { id, label } = await createChatSnapshot(sessionId, customField);
        showToast(`快照已创建：${label}`);
      } catch (err) {
        showToast("创建快照失败: " + err.message);
      }
    }
  );
}

// ==========================================
//             2. 从存档建立对话
// ==========================================

// 从存档完全复原一个对话（保留原始面具 user 信息，全量恢复所有关联数据）
async function restoreChatFromArchive(archiveId) {
  const archive = await db.chat_archives.get(archiveId);
  if (!archive) { showToast("存档不存在"); return; }

  // 反序列化快照数据
  const data = deserializeRecord(archive.snapshotData);
  const oldSession = data.session;
  if (!oldSession) { showToast("快照数据损坏"); return; }

  // 建立新会话：完全照搬快照时刻的 session 配置，就是普通对话写入，不做任何特殊化
  // userId 保持快照原始值（不覆盖为当前面具），确保 user 信息跟快照时刻一致
  // 同时把 user/char 的头像/人设/姓名显式写入 session 自定义字段，使对话完全自洽，
  // 不依赖 db.archives 查找（纯数据导入导出）
  const newSession = { ...oldSession };
  delete newSession.id;

  // 从快照捕获的档案数据填充自定义字段（确保头像和人设同步过来）
  if (data.userArchive) {
    if (!newSession.customUserName) newSession.customUserName = data.userArchive.name;
    if (!newSession.customUserAvatar) newSession.customUserAvatar = data.userArchive.avatar;
    if (!newSession.customUserPersona) newSession.customUserPersona = data.userArchive.persona;
  }
  if (data.charArchive) {
    if (!newSession.customCharName) newSession.customCharName = data.charArchive.name;
    if (!newSession.customCharAvatar) newSession.customCharAvatar = data.charArchive.avatar;
    if (!newSession.customCharPersona) newSession.customCharPersona = data.charArchive.persona;
  }

  newSession.charRemark = archive.customLabel;
  newSession.lastMessageTime = Date.now();

  const newSessionId = await db.sessions.add(newSession);

  // 剧场 ID 重映射表（旧 theaterId → 新 theaterId）
  const theaterIdMap = {};

  // 恢复独立剧场主表（先恢复，获取新 ID 供后续 offline_messages / status_history 重映射）
  if (data.theaters && data.theaters.length > 0) {
    try {
      for (const th of data.theaters) {
        const oldThId = th.id;
        const newTh = { ...th };
        delete newTh.id;
        newTh.sessionId = newSessionId;
        const newThId = await db.theaters.add(newTh);
        theaterIdMap[oldThId] = newThId;
      }
    } catch (e) { console.warn("恢复剧场失败:", e); }
  }

  // 批量恢复线上消息（重映射 sessionId）
  if (data.messages && data.messages.length > 0) {
    const newMessages = data.messages.map(m => {
      const nm = { ...m };
      delete nm.id;
      nm.sessionId = newSessionId;
      return nm;
    });
    await db.messages.bulkAdd(newMessages);
  }

  // 恢复线下消息（重映射 sessionId 和 theaterId）
  if (data.offlineMessages && data.offlineMessages.length > 0) {
    try {
      const newOffline = data.offlineMessages.map(m => {
        const nm = { ...m };
        delete nm.id;
        nm.sessionId = newSessionId;
        if (nm.theaterId && theaterIdMap[nm.theaterId]) {
          nm.theaterId = theaterIdMap[nm.theaterId];
        }
        return nm;
      });
      await db.offline_messages.bulkAdd(newOffline);
    } catch (e) { console.warn("恢复线下消息失败:", e); }
  }

  // 恢复总结
  if (data.summaries && data.summaries.length > 0) {
    const newSummaries = data.summaries.map(s => {
      const ns = { ...s };
      delete ns.id;
      ns.sessionId = newSessionId;
      return ns;
    });
    await db.summaries.bulkAdd(newSummaries);
  }

  // 恢复心声状态历史（重映射 sessionId 和 theaterId）
  if (data.statusHistory && data.statusHistory.length > 0) {
    const newStatus = data.statusHistory.map(st => {
      const ns = { ...st };
      delete ns.id;
      ns.sessionId = newSessionId;
      if (st.theaterId && theaterIdMap[st.theaterId]) {
        ns.theaterId = theaterIdMap[st.theaterId];
      }
      return ns;
    });
    await db.status_history.bulkAdd(newStatus);
  }

  // 恢复对话向量
  if (data.dialogueVectors && data.dialogueVectors.length > 0) {
    try {
      const newVectors = data.dialogueVectors.map(v => {
        const nv = { ...v };
        delete nv.id;
        nv.sessionId = newSessionId;
        return nv;
      });
      await db.dialogue_vectors.bulkAdd(newVectors);
    } catch (e) { console.warn("恢复对话向量失败:", e); }
  }

  // 恢复查手机状态
  if (data.checkPhoneState) {
    try {
      await db.check_phone_states.put({ ...data.checkPhoneState, sessionId: newSessionId });
    } catch (e) { console.warn("恢复查手机状态失败:", e); }
  }

  // 恢复 HTML 互动卡片
  if (data.htmlCards && data.htmlCards.length > 0) {
    try {
      const newCards = data.htmlCards.map(c => {
        const nc = { ...c };
        delete nc.id;
        nc.sessionId = newSessionId;
        return nc;
      });
      await db.html_cards.bulkAdd(newCards);
    } catch (e) { console.warn("恢复HTML卡片失败:", e); }
  }

  // 恢复深谈主记录 + 子消息 + 闪念（重映射 deeptalkId）
  if (data.deeptalks && data.deeptalks.length > 0) {
    try {
      const deeptalkIdMap = {};
      for (const dt of data.deeptalks) {
        const oldDtId = dt.id;
        const newDt = { ...dt };
        delete newDt.id;
        newDt.sessionId = newSessionId;
        const newDtId = await db.deeptalks.add(newDt);
        deeptalkIdMap[oldDtId] = newDtId;
      }
      // 恢复深谈子消息
      if (data.deeptalkMessages && data.deeptalkMessages.length > 0) {
        const newDtMsgs = data.deeptalkMessages.map(m => {
          const nm = { ...m };
          delete nm.id;
          if (nm.deeptalkId && deeptalkIdMap[nm.deeptalkId]) {
            nm.deeptalkId = deeptalkIdMap[nm.deeptalkId];
          }
          return nm;
        });
        await db.deeptalk_messages.bulkAdd(newDtMsgs);
      }
    } catch (e) { console.warn("恢复深谈失败:", e); }
  }

  // 恢复深谈闪念
  if (data.deeptalkThoughts && data.deeptalkThoughts.length > 0) {
    try {
      const newThoughts = data.deeptalkThoughts.map(t => {
        const nt = { ...t };
        delete nt.id;
        nt.sessionId = newSessionId;
        return nt;
      });
      await db.deeptalk_thoughts.bulkAdd(newThoughts);
    } catch (e) { console.warn("恢复深谈闪念失败:", e); }
  }

  // 恢复生图会话设置
  if (data.imagegenSettings && data.imagegenSettings.length > 0) {
    try {
      const newImgSettings = data.imagegenSettings.map(s => {
        const ns = { ...s };
        delete ns.id;
        ns.sessionId = newSessionId;
        return ns;
      });
      await db.imagegen_session_settings.bulkAdd(newImgSettings);
    } catch (e) { console.warn("恢复生图设置失败:", e); }
  }

  showToast(`已从存档「${archive.customLabel}」建立对话`);
  // 切换到新对话
  if (typeof openWeChatDialog === "function") {
    openWeChatDialog(newSessionId);
  }
  return newSessionId;
}

// ==========================================
//             3. 文件管理页渲染
// ==========================================

let fileMgrCurrentUserId = null;
let fileMgrCurrentPage = 0;
const FILE_MGR_PAGE_SIZE = 20;

function escapeHtmlBasic(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 渲染文件管理主页面
async function renderFileManagementPage(container) {
  container.innerHTML = `
    <div id="file-mgr-container" style="padding:12px;">
      <div id="file-mgr-user-tabs" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; border-bottom:1px solid var(--border); margin-bottom:12px;"></div>
      <div id="file-mgr-char-list" style="min-height:200px;"></div>
      <div id="file-mgr-pagination" style="display:flex; justify-content:center; gap:8px; padding:12px 0;"></div>
    </div>
  `;

  await renderFileMgrUserTabs();
}

// 渲染顶部 user 切换栏
async function renderFileMgrUserTabs() {
  const tabsContainer = document.getElementById("file-mgr-user-tabs");
  if (!tabsContainer) return;

  // 获取所有有快照的 user
  const allArchives = await db.chat_archives.toArray();
  const userIds = [...new Set(allArchives.map(a => a.userId).filter(id => id > 0))];

  if (userIds.length === 0) {
    tabsContainer.innerHTML = `<span style="font-size:12px; color:var(--text-secondary);">暂无任何对话快照</span>`;
    document.getElementById("file-mgr-char-list").innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--text-secondary);">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4; margin-bottom:12px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div style="font-size:13px;">在单聊中双击消息可创建"在此刻分支"快照</div>
      </div>
    `;
    return;
  }

  // 默认选中第一个（或当前面具）
  if (!fileMgrCurrentUserId || !userIds.includes(fileMgrCurrentUserId)) {
    fileMgrCurrentUserId = userIds[0];
  }

  tabsContainer.innerHTML = "";
  for (const uid of userIds) {
    const user = await db.archives.get(uid);
    const name = user?.name || `面具${uid}`;
    const count = allArchives.filter(a => a.userId === uid).length;
    const isActive = uid === fileMgrCurrentUserId;
    const tab = document.createElement("div");
    tab.style.cssText = `flex-shrink:0; padding:6px 14px; border-radius:20px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; border:1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}; background:${isActive ? 'var(--primary-light)' : 'var(--surface)'}; color:${isActive ? 'var(--primary)' : 'var(--text-primary)'};`;
    tab.innerText = `${name} (${count})`;
    tab.onclick = () => {
      fileMgrCurrentUserId = uid;
      fileMgrCurrentPage = 0;
      renderFileMgrUserTabs();
    };
    tabsContainer.appendChild(tab);
  }

  await renderFileMgrCharList();
}

// 渲染按 char 分类的快照列表
async function renderFileMgrCharList() {
  const listContainer = document.getElementById("file-mgr-char-list");
  const paginationContainer = document.getElementById("file-mgr-pagination");
  if (!listContainer) return;

  const allArchives = await db.chat_archives.where('userId').equals(fileMgrCurrentUserId).toArray();

  // 按 charId 分组
  const charGroups = {};
  for (const a of allArchives) {
    const key = a.charId || 0;
    if (!charGroups[key]) charGroups[key] = [];
    charGroups[key].push(a);
  }

  listContainer.innerHTML = "";

  // 获取所有 char 信息
  const charIds = Object.keys(charGroups).map(Number);
  const chars = await Promise.all(charIds.map(async id => {
    const c = id > 0 ? await db.archives.get(id) : null;
    return { id, name: c?.name || "未知角色", avatar: c?.avatar, group: c?.group || "默认分组" };
  }));

  // 按 group 分组 char
  const groupMap = {};
  for (const c of chars) {
    const g = c.group || "默认分组";
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push(c);
  }

  // 分页：每页显示的 char 数量
  const allGroupEntries = Object.entries(groupMap);
  const totalPages = Math.max(1, Math.ceil(allGroupEntries.length / FILE_MGR_PAGE_SIZE));
  fileMgrCurrentPage = Math.min(fileMgrCurrentPage, totalPages - 1);
  const startIdx = fileMgrCurrentPage * FILE_MGR_PAGE_SIZE;
  const pageEntries = allGroupEntries.slice(startIdx, startIdx + FILE_MGR_PAGE_SIZE);

  for (const [groupName, groupChars] of pageEntries) {
    // 分组标题
    const groupHeader = document.createElement("div");
    groupHeader.style.cssText = "font-size:11px; font-weight:700; color:var(--text-secondary); padding:8px 0 4px 0; text-transform:uppercase; letter-spacing:0.5px;";
    groupHeader.innerText = groupName;
    listContainer.appendChild(groupHeader);

    for (const c of groupChars) {
      const archives = charGroups[c.id] || [];
      // 手风琴容器
      const charSection = document.createElement("div");
      charSection.style.cssText = "background:var(--surface); border:1px solid var(--border); border-radius:12px; margin-bottom:8px; overflow:hidden;";

      // char 头部（可点击展开/收起）
      const charHeader = document.createElement("div");
      charHeader.style.cssText = "display:flex; align-items:center; gap:10px; padding:10px 12px; cursor:pointer;";
      const avatarSrc = c.avatar ? (typeof resolveAvatar === "function" ? resolveAvatar(c.avatar, c.name) : "") : "";
      charHeader.innerHTML = `
        <img src="${avatarSrc}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'">
        <div style="flex:1;">
          <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${escapeHtmlBasic(c.name)}</div>
          <div style="font-size:11px; color:var(--text-secondary);">${archives.length} 个存档</div>
        </div>
        <svg class="chevron-icon" viewBox="0 0 24 24" width="18" height="18" style="color:var(--text-secondary); transition:transform 0.2s;"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
      `;

      // 存档列表（默认收起）
      const archiveList = document.createElement("div");
      archiveList.style.cssText = "display:none; padding:0 12px 10px 12px;";

      charHeader.onclick = () => {
        const isHidden = archiveList.style.display === "none";
        archiveList.style.display = isHidden ? "block" : "none";
        charHeader.querySelector(".chevron-icon").style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
      };

      // 渲染每个存档
      archives.sort((a, b) => b.createdAt - a.createdAt).forEach(a => {
        const item = document.createElement("div");
        item.style.cssText = "display:flex; align-items:center; gap:8px; padding:8px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; background:var(--surface-hover);";
        const dateStr = new Date(a.createdAt).toLocaleString();
        item.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtmlBasic(a.customLabel)}</div>
            <div style="font-size:10px; color:var(--text-secondary);">${dateStr}</div>
          </div>
          <button class="btn-restore-archive" data-id="${a.id}" style="flex-shrink:0; background:var(--primary); color:#fff; border:none; border-radius:6px; padding:5px 10px; font-size:11px; font-weight:600; cursor:pointer;">建立对话</button>
          <button class="btn-delete-archive" data-id="${a.id}" style="flex-shrink:0; background:transparent; color:var(--danger); border:1px solid var(--danger); border-radius:6px; padding:5px 8px; font-size:11px; cursor:pointer;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        `;
        archiveList.appendChild(item);
      });

      // 事件委托
      archiveList.addEventListener("click", async (e) => {
        const restoreBtn = e.target.closest(".btn-restore-archive");
        const deleteBtn = e.target.closest(".btn-delete-archive");
        if (restoreBtn) {
          const id = Number(restoreBtn.getAttribute("data-id"));
          if (typeof showCustomConfirm === "function") {
            showCustomConfirm("建立对话", "将基于此存档在当前面具下建立一个完全复原的对话，确定继续吗？", async () => {
              await restoreChatFromArchive(id);
            });
          } else {
            if (confirm("将基于此存档建立对话，确定继续吗？")) {
              await restoreChatFromArchive(id);
            }
          }
        }
        if (deleteBtn) {
          const id = Number(deleteBtn.getAttribute("data-id"));
          if (typeof showCustomConfirm === "function") {
            showCustomConfirm("删除存档", "确定删除此对话快照吗？此操作不可逆。", async () => {
              await db.chat_archives.delete(id);
              showToast("存档已删除");
              await renderFileMgrCharList();
            });
          }
        }
      });

      charSection.appendChild(charHeader);
      charSection.appendChild(archiveList);
      listContainer.appendChild(charSection);
    }
  }

  // 分页控件
  if (paginationContainer) {
    paginationContainer.innerHTML = "";
    if (totalPages > 1) {
      const prevBtn = document.createElement("button");
      prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
      prevBtn.style.cssText = "background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer;";
      prevBtn.disabled = fileMgrCurrentPage === 0;
      prevBtn.onclick = () => { fileMgrCurrentPage--; renderFileMgrCharList(); };
      paginationContainer.appendChild(prevBtn);

      const pageInfo = document.createElement("span");
      pageInfo.style.cssText = "font-size:12px; color:var(--text-secondary); padding:6px 10px;";
      pageInfo.innerText = `${fileMgrCurrentPage + 1} / ${totalPages}`;
      paginationContainer.appendChild(pageInfo);

      const nextBtn = document.createElement("button");
      nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';
      nextBtn.style.cssText = "background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer;";
      nextBtn.disabled = fileMgrCurrentPage >= totalPages - 1;
      nextBtn.onclick = () => { fileMgrCurrentPage++; renderFileMgrCharList(); };
      paginationContainer.appendChild(nextBtn);
    }
  }
}

// ==========================================
//             4. 群聊邀请：文件管理分类
// ==========================================

// 渲染群聊邀请中的"文件管理"分类（三级手风琴：文件管理 > 面具 > 对话文件）
async function renderFileMgrInviteSection(listContainer, currentGroupMemberIds) {
  const allArchives = await db.chat_archives.toArray();

  // 一级：文件管理折叠面板（默认展开，确保用户能看到对话快照列表）
  // 注意：不使用 overflow:hidden，否则在 flex 容器中会裁剪子内容导致快照列表不可见
  const section = document.createElement("div");
  section.style.cssText = "margin-top:16px; margin-bottom:12px; border:2px solid #6366f1; border-radius:10px; flex-shrink:0;";

  const header = document.createElement("div");
  header.style.cssText = "display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:pointer; background:#eef2ff;";
  header.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    <span style="font-size:13px; font-weight:700; color:#4338ca; flex:1;">文件管理 · 对话快照</span>
    <span style="font-size:10px; color:#6366f1; font-weight:600; background:#fff; padding:2px 8px; border-radius:10px;">${allArchives.length} 个存档</span>
    <svg class="fm-chevron" viewBox="0 0 24 24" width="16" height="16" style="color:#6366f1; transition:transform 0.2s; transform:rotate(90deg);"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
  `;

  const body = document.createElement("div");
  body.style.cssText = "display:block; padding:8px;";

  header.onclick = () => {
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    header.querySelector(".fm-chevron").style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
  };

  // 二级：按 user 面具分组（不再过滤 userId>0，防止缺失 userId 的快照被隐藏）
  const userIds = [...new Set(allArchives.map(a => a.userId || 0))];
  for (const uid of userIds) {
    const user = uid > 0 ? await db.archives.get(uid) : null;
    const userName = user?.name || (uid > 0 ? `面具${uid}` : '未分组存档');
    const userArchives = allArchives.filter(a => (a.userId || 0) === uid);

    const userSection = document.createElement("div");
    userSection.style.cssText = "margin-bottom:6px; border:1px solid var(--border); border-radius:8px;";

    const userHeader = document.createElement("div");
    userHeader.style.cssText = "display:flex; align-items:center; gap:6px; padding:8px 10px; cursor:pointer; background:var(--surface-hover);";
    userHeader.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-secondary)" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
      <span style="font-size:12px; font-weight:600; color:var(--text-primary); flex:1;">${escapeHtmlBasic(userName)}</span>
      <span style="font-size:10px; color:var(--text-secondary);">${userArchives.length} 个存档</span>
      <svg class="user-chevron" viewBox="0 0 24 24" width="14" height="14" style="color:var(--text-secondary); transition:transform 0.2s; transform:rotate(90deg);"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
    `;

    // 默认展开二级面板，确保快照列表一眼可见
    const userBody = document.createElement("div");
    userBody.style.cssText = "display:block; padding:6px;";

    userHeader.onclick = () => {
      const isHidden = userBody.style.display === "none";
      userBody.style.display = isHidden ? "block" : "none";
      userHeader.querySelector(".user-chevron").style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
    };

    // 三级：每个存档文件
    userArchives.sort((a, b) => b.createdAt - a.createdAt).forEach(a => {
      const item = document.createElement("div");
      item.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; margin-bottom:4px; cursor:pointer; background:var(--surface);";

      // 头像：优先用存档里的 char 头像，没有就用名字首字生成的 SVG
      let avatarHtml;
      try {
        const archiveData = deserializeRecord(a.snapshotData);
        const charAvatar = archiveData?.charArchive?.avatar;
        const charName = a.charName || archiveData?.charArchive?.name || '?';
        const avatarSrc = typeof resolveAvatar === 'function' ? resolveAvatar(charAvatar, charName) : '';
        avatarHtml = `<img src="${avatarSrc}" style="width:28px; height:28px; border-radius:50%; object-fit:cover; flex-shrink:0;">`;
      } catch(e) {
        avatarHtml = `<img src="" style="width:28px; height:28px; border-radius:50%; object-fit:cover; flex-shrink:0;">`;
      }

      item.innerHTML = `
        <input type="checkbox" class="cb-fm-invite-archive" value="${a.id}" data-charid="${a.charId}" style="width:16px; height:16px; cursor:pointer;">
        ${avatarHtml}
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtmlBasic(a.charName)}</span>
            <span style="font-size:8px; line-height:1; padding:1px 4px; border-radius:6px; background:#eef2ff; color:#6366f1; border:1px solid #c7d2fe; flex-shrink:0;">对话分支</span>
          </div>
          <div style="font-size:9px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">分支：${escapeHtmlBasic(a.customLabel)}（独立个体·与同名角色不混淆）</div>
        </div>
      `;
      item.onclick = (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = item.querySelector("input");
          cb.checked = !cb.checked;
        }
      };
      userBody.appendChild(item);
    });

    userSection.appendChild(userHeader);
    userSection.appendChild(userBody);
    body.appendChild(userSection);
  }

  // 无存档时显示空状态提示
  if (userIds.length === 0) {
    const emptyTip = document.createElement("div");
    emptyTip.style.cssText = "padding:16px; text-align:center; color:var(--text-secondary); font-size:11px;";
    emptyTip.innerText = "文件管理中暂无对话存档";
    body.appendChild(emptyTip);
  }

  section.appendChild(header);
  section.appendChild(body);
  listContainer.appendChild(section);
}

// 处理从文件管理引入群聊的存档角色
async function submitFileMgrGroupInvitation(groupId) {
  const checkedBoxes = document.querySelectorAll(".cb-fm-invite-archive:checked");
  if (checkedBoxes.length === 0) return false;

  const myUser = await db.archives.get(Number(activeUserPersonaId));
  const myName = myUser ? myUser.name : "User";

  for (const cb of checkedBoxes) {
    const archiveId = Number(cb.value);
    const charId = Number(cb.getAttribute("data-charid"));
    const archive = await db.chat_archives.get(archiveId);
    if (!archive) continue;

    // 同一存档（对话快照）只引入一次：按 sourceArchiveId 判重，而非按 charId
    // 这样同一角色的不同对话分支快照可分别作为不同群成员共存，互不覆盖
    const dup = await db.group_members
      .where('groupId').equals(groupId)
      .and(m => m.memberType === 'char' && m.sourceArchiveId === archiveId)
      .first();
    if (dup) continue;

    // 解析快照内的角色名与人设（冗余存储优先，其次从快照数据提取）
    let charName = archive.charName;
    let snapPersona = '';
    let snapAvatar = '';
    let mainChar = null;
    try { mainChar = await db.archives.get(charId); } catch (e) {}
    try {
      const sd = deserializeRecord(archive.snapshotData);
      if (sd && sd.charArchive) {
        if (!charName) charName = sd.charArchive.name || '未知角色';
        snapPersona = sd.charArchive.persona || (mainChar ? mainChar.persona : '') || '';
        snapAvatar = sd.charArchive.avatar || (mainChar ? mainChar.avatar : '') || '';
      }
    } catch (e) {
      if (!charName) charName = (mainChar ? mainChar.name : '未知角色');
      snapPersona = (mainChar ? mainChar.persona : '') || '';
      snapAvatar = (mainChar ? mainChar.avatar : '') || '';
    }
    const snapshotLabel = archive.customLabel || '';
    // 群内显示名：基础角色名 + 分支标记，用于区分同名角色的不同对话分支
    const displayName = snapshotLabel ? `${charName}（${snapshotLabel}）` : charName;

    // === 支线人物落库：在 archives 表创建/复用独立档案记录 ===
    // 支线人物与主线人物一同存储，但通过 isSnapshot=true 在档案库列表中隐藏；
    // 名字沿用本体名，分组追加「·支线」后缀以区分，parentId 指向主线本体
    let snapArchive = await db.archives.where('sourceArchiveId').equals(archiveId).first();
    if (!snapArchive) {
      const snapId = await db.archives.add({
        type: 'char',
        name: charName,
        avatar: snapAvatar,
        persona: snapPersona,
        group: (mainChar && mainChar.group) ? (mainChar.group + '·支线') : '支线人物',
        remark: '',                  // 留空：消息渲染时回退到 name，避免 remark 覆盖角色名
        parentId: charId,            // 指向主线人物本体
        isSnapshot: true,
        sourceArchiveId: archiveId   // 指向 chat_archives 记录
      });
      snapArchive = await db.archives.get(snapId);
    }

    // 添加群成员：memberId 指向支线人物档案（落库后的独立实体），携带来源标记
    await db.group_members.add({
      groupId: groupId,
      memberId: snapArchive.id,      // 指向支线人物档案记录（落库实体）
      memberType: 'char',
      role: 'member',
      muteUntil: 0,
      title: '',
      syncFromSingle: 1,
      syncToSingle: 1,
      sourceArchiveId: archiveId,   // 标记来源存档（对话快照）
      isSnapshot: true,             // 标记：此为对话快照分支
      snapshotLabel: snapshotLabel, // 分支标签
      displayName: displayName      // 群内显示名（含分支标记，区分同名角色）
    });

    // 写入系统通知
    const sess = await db.sessions.where('groupId').equals(groupId).first();
    if (sess) {
      await db.messages.add({
        sessionId: sess.id,
        senderType: 'system',
        senderId: 0,
        content: `[系统通知] ${myName} 从文件管理引入了 ${displayName}（对话快照分支：存档「${snapshotLabel}」）加入群聊`,
        contentType: 'text',
        timestamp: Date.now()
      });
    }
  }

  return true;
}

// ==========================================
//             5. 群聊记忆双向同步
// ==========================================

// 从单聊拉取角色记忆到群聊 prompt
// 仅对当前面具下建立了单聊对话的角色生效
async function syncSingleChatMemoryToGroup(groupId, charId) {
  const userIdNum = Number(activeUserPersonaId);

  // 查找该角色在当前面具下的单聊会话
  const singleSession = await db.sessions
    .where('userId').equals(userIdNum)
    .and(s => s.charId === charId && s.isGroup !== 1)
    .first();

  if (!singleSession) return null; // 没有单聊，无法同步

  // 收集单聊的核心记忆
  const sess = await db.sessions.get(singleSession.id);
  const coreMemory = {
    coreSelfStatus: sess.coreSelfStatus || "",
    coreSelfPurpose: sess.coreSelfPurpose || "",
    coreSelfChanges: sess.coreSelfChanges || "",
    coreRelationship: sess.coreRelationship || "",
    coreUserInEyes: sess.coreUserInEyes || ""
  };

  // 收集单聊最近的总结（取最近 5 条）
  const summaries = await db.summaries
    .where('sessionId').equals(singleSession.id)
    .sortBy('startRound');
  const recentSummaries = summaries.slice(-5).map(s => s.content);

  // 收集单聊最近上下文（取最近 10 条消息，做标签清洗避免污染群聊 prompt）
  const messages = await db.messages
    .where('sessionId').equals(singleSession.id)
    .sortBy('timestamp');
  const tagCleaner = (typeof stripTagsForRetrieval === "function") ? stripTagsForRetrieval : (t => t || "");
  const recentMessages = messages.slice(-10).map(m => {
    const sender = m.senderType === 'user' ? (sess.customUserName || '我') : (sess.customCharName || '对方');
    return `[${sender}]: ${tagCleaner(m.content)}`;
  });

  return {
    coreMemory,
    recentSummaries,
    recentMessages,
    singleSessionId: singleSession.id
  };
}

// 从群聊同步记忆回写到单聊
// 在群聊产生新总结/记忆后，同步到角色的单聊会话
async function syncGroupMemoryToSingleChat(groupId, charId) {
  const userIdNum = Number(activeUserPersonaId);

  // 查找该角色在当前面具下的单聊会话
  const singleSession = await db.sessions
    .where('userId').equals(userIdNum)
    .and(s => s.charId === charId && s.isGroup !== 1)
    .first();

  if (!singleSession) return false;

  // 查找群聊会话
  const groupSession = await db.sessions
    .where('groupId').equals(groupId)
    .and(s => s.isGroup === 1)
    .first();

  if (!groupSession) return false;

  // 获取群聊最近总结
  const groupSummaries = await db.summaries
    .where('sessionId').equals(groupSession.id)
    .sortBy('startRound');

  if (groupSummaries.length === 0) return false;

  // 取群聊最新一条总结，作为补充同步到单聊
  const latestGroupSummary = groupSummaries[groupSummaries.length - 1];

  // 检查是否已同步过（避免重复）
  const syncFlagKey = `__groupSyncedSummary_${latestGroupSummary.id}`;
  const singleSess = await db.sessions.get(singleSession.id);
  if (singleSess && singleSess[syncFlagKey]) return false;

  // 在单聊中追加一条总结（标记来源为群聊）
  await db.summaries.add({
    sessionId: singleSession.id,
    startRound: 0,
    endRound: 0,
    content: `[群聊记忆同步] ${latestGroupSummary.content}`,
    category: 'group_sync',
    keywords: JSON.stringify(['群聊同步', 'group']),
    timestamp: Date.now()
  });

  // 标记已同步
  const updateObj = {};
  updateObj[syncFlagKey] = 1;
  await db.sessions.update(singleSession.id, updateObj);

  return true;
}

// 为群聊 prompt 构建角色记忆同步段落
async function buildGroupMemorySyncPrompt(groupId, members) {
  let syncPrompt = "";

  for (const m of members) {
    if (m.memberType !== 'char') continue;
    if (!m.syncFromSingle) continue; // 未开启从单聊同步

    const char = await db.archives.get(m.memberId);
    const charName = (m.displayName || (char && char.name)) || "角色";

    // 对话快照分支成员：注入其【自身快照】里存储的总结与最近对话，而非通用单聊记忆
    if (m.isSnapshot && m.sourceArchiveId) {
      try {
        const archive = await db.chat_archives.get(m.sourceArchiveId);
        if (archive) {
          const sd = deserializeRecord(archive.snapshotData) || {};
          const sums = Array.isArray(sd.summaries) ? sd.summaries : [];
          const msgs = Array.isArray(sd.messages) ? sd.messages : [];
          const recentSums = sums.slice(-5).map(s => (s && s.content) ? s.content : '').filter(Boolean);
          const recentMsgs = msgs.slice(-12).map(x => {
            const who = x.senderType === 'user' ? '用户' : (x.senderName || (char && char.name) || '角色');
            return `${who}：${(x.content || '').toString().slice(0, 200)}`;
          }).filter(Boolean);
          if (recentSums.length || recentMsgs.length) {
            syncPrompt += `\n【${charName} 的专属记忆（来自时间线存档「${archive.customLabel || ''}」，仅属于该个体自身）】\n`;
            if (recentSums.length) syncPrompt += `- 自身的历史总结：${recentSums.join(" | ")}\n`;
            if (recentMsgs.length) syncPrompt += `- 自身的最近对话片段：\n${recentMsgs.join("\n")}\n`;
            syncPrompt += `注：以上记忆仅属于「${charName}」自身，请严格按其自身上下文发言，不要与同名其他时间线个体混淆。\n`;
            continue; // 时间线个体使用自身记忆，不再叠加通用单聊同步
          }
        }
      } catch (e) { console.warn("快照记忆注入失败:", e); }
    }

    const syncData = await syncSingleChatMemoryToGroup(groupId, m.memberId);
    if (!syncData) continue;

    syncPrompt += `\n【${charName} 的单聊记忆同步（来自当前面具下的单聊对话）】\n`;

    // 核心记忆
    const cm = syncData.coreMemory;
    if (cm.coreSelfStatus || cm.coreRelationship || cm.coreUserInEyes) {
      syncPrompt += `- 自我现状：${cm.coreSelfStatus || "未记录"}\n`;
      syncPrompt += `- 与用户关系认知：${cm.coreRelationship || "未记录"}\n`;
      syncPrompt += `- 眼中的用户：${cm.coreUserInEyes || "未记录"}\n`;
    }

    // 最近总结
    if (syncData.recentSummaries.length > 0) {
      syncPrompt += `- 最近单聊总结：${syncData.recentSummaries.join(" | ")}\n`;
    }

    // 最近上下文
    if (syncData.recentMessages.length > 0) {
      syncPrompt += `- 最近单聊片段：\n${syncData.recentMessages.join("\n")}\n`;
    }

    syncPrompt += `注：以上是 ${charName} 在与用户的单聊中积累的真实记忆，请在群聊发言中自然体现这些认知与关系深度。\n`;
  }

  return syncPrompt;
}

// ==========================================
//    6. 辅助：判断消息是否属于最后一轮（用于分支按钮显示控制）
// ==========================================

// 线上消息：判断 msgId 是否属于当前会话的最后一轮对话
// 最后一轮 = 从最后一条 user 消息到结尾的所有消息
async function isMsgInLastRoundOnline(msgId, sessionId) {
  try {
    const sess = await db.sessions.get(sessionId);
    if (!sess || sess.isGroup === 1) return false;

    const msgs = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    if (msgs.length === 0) return false;

    // 过滤掉系统消息，只看 user/char 消息
    const chatMsgs = msgs.filter(m => m.senderType === 'user' || m.senderType === 'char');
    if (chatMsgs.length === 0) return false;

    // 找最后一条 user 消息的索引
    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
      if (chatMsgs[i].senderType === 'user') { lastUserIdx = i; break; }
    }

    // 如果没有 user 消息，最后一轮就是最后一条消息
    if (lastUserIdx === -1) {
      return chatMsgs[chatMsgs.length - 1].id === msgId;
    }

    // 检查 msgId 是否在 lastUserIdx 到末尾的范围内
    for (let i = lastUserIdx; i < chatMsgs.length; i++) {
      if (chatMsgs[i].id === msgId) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// 线下消息：判断 msgId 是否属于当前会话/剧场的最后一轮对话
async function isMsgInLastRoundOffline(msgId, sessionId, theaterId) {
  try {
    const sess = await db.sessions.get(sessionId);
    if (!sess || sess.isGroup === 1) return false;

    // 独立剧场模式不显示分支按钮，只有赴约模式才有
    if (theaterId) return false;

    let msgs;
    msgs = await db.offline_messages.where('sessionId').equals(sessionId)
      .and(m => m.isTheater === 0).sortBy('timestamp');
    if (msgs.length === 0) return false;

    const chatMsgs = msgs.filter(m => m.senderType === 'user' || m.senderType === 'char');
    if (chatMsgs.length === 0) return false;

    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
      if (chatMsgs[i].senderType === 'user') { lastUserIdx = i; break; }
    }

    if (lastUserIdx === -1) {
      return chatMsgs[chatMsgs.length - 1].id === msgId;
    }

    for (let i = lastUserIdx; i < chatMsgs.length; i++) {
      if (chatMsgs[i].id === msgId) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// 暴露到全局
window.chatArchiveSystem = {
  createChatSnapshot,
  promptAndCreateSnapshot,
  restoreChatFromArchive,
  renderFileManagementPage,
  renderFileMgrInviteSection,
  submitFileMgrGroupInvitation,
  syncSingleChatMemoryToGroup,
  syncGroupMemoryToSingleChat,
  buildGroupMemorySyncPrompt,
  isCustomLabelUnique,
  generateUniqueCustomLabel,
  isMsgInLastRoundOnline,
  isMsgInLastRoundOffline
};
