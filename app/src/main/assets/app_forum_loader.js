/**
 * app_forum_loader.js - 论坛物理层栈管理器、AI提示词编译器与基础账户资料中枢
 * 将原分散的 loader, prompt, account, trends, notifications 等碎屑逻辑在此高内聚集成。
 */

let forumActiveAccountId = null;
let forumLayersStack = [];
let forumLastTrendsRefreshTime = 0;

// === 1. 论坛主应用全局加载初始化 ===
async function initForumApp() {
  const accounts = await db.forum_accounts.toArray();
  if (accounts.length === 0) {
    const defaultId = await db.forum_accounts.add({
      avatar: "",
      nickname: "宿命旅人",
      username: "destiny_walker",
      signature: "在这个匿名角落，诉说我们不愿被忘却的执念",
      boundPresetId: 0
    });
    forumActiveAccountId = defaultId;
    localStorage.setItem("forum_active_account_id", defaultId);
  } else {
    const savedId = localStorage.getItem("forum_active_account_id");
    forumActiveAccountId = savedId ? Number(savedId) : accounts[0].id;
  }
  
  await forumLoadDrawerHeader();
  forumBindTabs();
  forumRefreshTabFeed();
  
  // 随论坛冷启动，自适应唤醒 NPC 自动巡航发帖定时器
  if (typeof forumStartNpcCruiseTimer === "function") {
    forumStartNpcCruiseTimer();
  }
}

async function forumLoadDrawerHeader() {
  const account = await db.forum_accounts.get(forumActiveAccountId);
  if (!account) return;
  document.getElementById("forum-drawer-avatar").src = account.avatar || "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%23cbd5e1'/></svg>";
  document.getElementById("forum-drawer-nickname").innerText = account.nickname;
  document.getElementById("forum-drawer-username").innerText = `@${account.username}`;
}

function forumToggleDrawer(show) {
  const drawer = document.getElementById("forum-drawer");
  const overlay = document.getElementById("forum-drawer-overlay");
  if (show) {
    drawer.classList.add("active");
    overlay.classList.add("active");
  } else {
    drawer.classList.remove("active");
    overlay.classList.remove("active");
  }
}

// === 2. 论坛底部 4 个主签物理切叶路由 ===
function forumBindTabs() {
  const tabs = document.querySelectorAll("#win-forum .forum-tabs .tab-item");
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const activeTab = tab.getAttribute("data-forum-tab");
      
      document.querySelectorAll(".forum-app-body .forum-tab-panel").forEach(p => p.classList.remove("active"));
      const targetPanel = document.getElementById(`forum-tab-${activeTab}`);
      if (targetPanel) targetPanel.classList.add("active");

      const titles = { home: "论坛", trends: "趋势探索", notifications: "通知中枢", messages: "会话消息" };
      document.getElementById("forum-main-title").innerText = titles[activeTab] || "论坛";

      forumRefreshTabFeed();
    };
  });
}

function forumRefreshTabFeed() {
  const activeTab = document.querySelector("#win-forum .forum-tabs .tab-item.active").getAttribute("data-forum-tab");
  if (activeTab === "home") {
    if (typeof forumLoadPostsFeed === "function") forumLoadPostsFeed();
  } else if (activeTab === "trends") {
    // 切换页签不自动刷新，只在容器彻底为空时加载一次默认背景趋势，避免繁杂重刷
    const container = document.getElementById("forum-trends-list");
    if (container && container.children.length === 0) {
      forumRefreshTrends(false);
    }
  } else if (activeTab === "notifications") {
    forumLoadNotifications();
  } else if (activeTab === "messages") {
    if (typeof forumLoadMessagesTab === "function") forumLoadMessagesTab();
  }
}

// === 3. 高可恢复性二级层栈推送引擎 ===
function forumPushLayer(type, data = null) {
  forumToggleDrawer(false);
  const container = document.getElementById("forum-layers-container");
  const layer = document.createElement("div");
  layer.className = "forum-layer";
  layer.setAttribute("data-layer-type", type);
  
  const zIdx = 100 + forumLayersStack.length;
  layer.style.zIndex = zIdx;

  let bodyHtml = "";
  if (type === "new-post") {
    bodyHtml = forumGetNewPostTemplate();
  } else if (type === "post-detail") {
    bodyHtml = forumGetPostDetailTemplate();
  } else if (type === "profile-view") {
    bodyHtml = forumGetProfileViewTemplate();
  } else if (type === "profile-edit") {
    bodyHtml = forumGetProfileEditTemplate();
  } else if (type === "settings") {
    bodyHtml = forumGetSettingsTemplate();
  } else if (type === "accounts") {
    bodyHtml = forumGetAccountsTemplate();
  } else if (type === "npcs") {
    bodyHtml = forumGetNpcsTemplate();
  } else if (type === "chat-room") {
    bodyHtml = forumGetChatRoomTemplate();
  } else if (type === "search-result") {
    bodyHtml = forumGetSearchResultTemplate();
  }

  layer.innerHTML = bodyHtml;
  container.appendChild(layer);

  setTimeout(() => layer.classList.add("active"), 10);
  forumLayersStack.push({ type, element: layer, data });

  // 点进具体子页面或私信后隐藏悬浮刷新按钮
  document.querySelectorAll(".forum-fab").forEach(el => el.style.display = "none");

  // 挂接动态初始化的各二级页面驱动钩子
  if (type === "new-post" && typeof forumInitNewPostPage === "function") {
    forumInitNewPostPage();
  } else if (type === "post-detail" && typeof forumInitPostDetailPage === "function") {
    forumInitPostDetailPage(data);
  } else if (type === "profile-view" && typeof forumInitProfileViewPage === "function") {
    forumInitProfileViewPage(data);
  } else if (type === "profile-edit") {
    forumInitProfileEditPage();
  } else if (type === "settings") {
    forumInitSettingsPage();
  } else if (type === "accounts") {
    forumInitAccountsPage();
  } else if (type === "npcs" && typeof forumInitNpcsPage === "function") {
    forumInitNpcsPage();
  } else if (type === "chat-room" && typeof forumInitChatRoomPage === "function") {
    forumInitChatRoomPage(data);
  } else if (type === "search-result") {
    forumInitSearchResultPage(data);
  }
}

function forumPopLayer() {
  if (forumLayersStack.length === 0) return;
  const last = forumLayersStack.pop();
  last.element.classList.remove("active");
  setTimeout(() => {
    last.element.remove();
    forumRefreshTabFeed();
    // 层栈全部退出后，恢复显示对应的悬浮按钮
    if (forumLayersStack.length === 0) {
      document.querySelectorAll(".forum-fab").forEach(el => el.style.display = "flex");
    }
  }, 300);
}

function forumClearStack() {
  const container = document.getElementById("forum-layers-container");
  container.innerHTML = "";
  forumLayersStack = [];
  forumRefreshTabFeed();
}

// === 4. 个人资料编辑表单控制 ===
let forumEditingAccountId = null;

function forumGetProfileEditTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3>编辑资料</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body" style="padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
      <div class="form-group">
        <label>论坛昵称</label>
        <input type="text" id="forum-edit-nickname">
      </div>
      <div class="form-group">
        <label>用户名 (@名)</label>
        <input type="text" id="forum-edit-username">
      </div>
      <div class="form-group">
        <label>个性签名</label>
        <textarea id="forum-edit-signature" rows="2"></textarea>
      </div>
      <div class="form-group">
        <label>设定底料 (自由文本)</label>
        <textarea id="forum-edit-setting" rows="3" placeholder="在此输入此账户的深度角色设定、性格标签或AI行为约束底料..."></textarea>
      </div>
      <div class="form-group">
        <label>头像 URL (本地上传亦可填空)</label>
        <input type="text" id="forum-edit-avatar-url">
        <button class="btn btn-outline" onclick="document.getElementById('forum-edit-avatar-file').click()" style="margin-top:8px;">本地上传头像</button>
        <input type="file" id="forum-edit-avatar-file" accept="image/*" style="display:none;">
      </div>

      <!-- ========== 同步聊天身份模块 ========== -->
      <div style="border-top:1.5px dashed #cbd5e1; padding-top:14px; margin-top:6px; display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
            <label style="font-size:13px; font-weight:700; color:#0f172a; margin:0;">同步聊天身份</label>
          </div>
          <label class="switch" style="transform:scale(0.85);">
            <input type="checkbox" id="forum-edit-sync-identity-toggle">
            <span class="slider"></span>
          </label>
        </div>
        <p style="font-size:11px; color:#64748b; margin:0; line-height:1.5;">开启后，此论坛账户将与一个聊天面具（用户人设）绑定。绑定的身份将作为该账户的"现实身份"。</p>

        <!-- 身份选择器 -->
        <div id="forum-edit-persona-selector-wrap" style="display:none; flex-direction:column; gap:8px; padding:10px; background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:10px;">
          <label style="font-size:11px; font-weight:700; color:#475569; margin:0;">选择绑定的面具（现实身份）</label>
          <div id="forum-edit-persona-cards" style="display:flex; flex-direction:column; gap:6px; max-height:160px; overflow-y:auto; padding:2px;"></div>
          <input type="hidden" id="forum-edit-bound-persona-id">
        </div>

        <!-- 同步给 char 开关 -->
        <div id="forum-edit-sync-to-char-wrap" style="display:none; flex-direction:column; gap:10px; padding:10px; background:#f0fdf4; border:1.5px solid #bbf7d0; border-radius:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <label style="font-size:12px; font-weight:700; color:#166534; margin:0;">是否同步此身份给 char</label>
            <label class="switch" style="transform:scale(0.85);">
              <input type="checkbox" id="forum-edit-sync-to-char-toggle">
              <span class="slider"></span>
            </label>
          </div>
          <p style="font-size:10.5px; color:#475569; margin:0; line-height:1.5;">开启后下方列出该面具下已建立单聊的 char。可多选——选中的 char 在私信/发帖/评论时会知道此账户的现实身份就是 user。每个 char 还可单独控制是否携带聊天记忆。</p>

          <!-- char 多选列表 -->
          <div id="forum-edit-sync-char-list" style="display:none; flex-direction:column; gap:8px; margin-top:4px;"></div>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
        <button class="btn btn-primary" onclick="forumSaveProfileEdit()" style="width:100%;">保存资料</button>
        <button class="btn btn-danger-outline" onclick="forumDeleteAccountFromEdit()" style="width:100%;">删除此账户</button>
      </div>
    </div>
  `;
}

async function forumInitProfileEditPage(accountId) {
  forumEditingAccountId = accountId || forumActiveAccountId;
  const account = await db.forum_accounts.get(forumEditingAccountId);
  if (!account) return;
  document.getElementById("forum-edit-nickname").value = account.nickname;
  document.getElementById("forum-edit-username").value = account.username;
  document.getElementById("forum-edit-signature").value = account.signature || "";
  document.getElementById("forum-edit-setting").value = account.setting || "";
  document.getElementById("forum-edit-avatar-url").value = account.avatar ? (account.avatar.startsWith("data:") && !account.avatar.startsWith("data:image/svg+xml") ? "" : account.avatar) : "";

  document.getElementById("forum-edit-avatar-file").onchange = (e) => {
    if (e.target.files.length > 0) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        document.getElementById("forum-edit-avatar-url").value = evt.target.result;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  // ========== 同步聊天身份模块初始化 ==========
  const syncIdentityToggle = document.getElementById("forum-edit-sync-identity-toggle");
  const personaSelectorWrap = document.getElementById("forum-edit-persona-selector-wrap");
  const syncToCharWrap = document.getElementById("forum-edit-sync-to-char-wrap");
  const syncToCharToggle = document.getElementById("forum-edit-sync-to-char-toggle");
  const syncCharList = document.getElementById("forum-edit-sync-char-list");
  const boundPersonaIdInput = document.getElementById("forum-edit-bound-persona-id");

  // 读取已保存的同步配置
  let savedSyncConfig = account.syncChatConfig || null;
  if (savedSyncConfig && typeof savedSyncConfig === "string") {
    try { savedSyncConfig = JSON.parse(savedSyncConfig); } catch (e) { savedSyncConfig = null; }
  }
  const syncEnabled = !!(savedSyncConfig && savedSyncConfig.enabled);
  const boundPersonaId = savedSyncConfig?.boundPersonaId ? Number(savedSyncConfig.boundPersonaId) : null;
  const syncToCharEnabled = !!(savedSyncConfig && savedSyncConfig.syncToChar);
  const savedSyncChars = Array.isArray(savedSyncConfig?.syncChars) ? savedSyncConfig.syncChars : [];

  syncIdentityToggle.checked = syncEnabled;
  personaSelectorWrap.style.display = syncEnabled ? "flex" : "none";
  syncToCharWrap.style.display = (syncEnabled && boundPersonaId) ? "flex" : "none";

  if (syncToCharToggle) {
    syncToCharToggle.checked = syncToCharEnabled;
    syncCharList.style.display = syncToCharEnabled ? "flex" : "none";
  }

  // 渲染身份选择器（面具列表 = db.archives type='user'）
  await forumRenderPersonaSelector(boundPersonaId);

  // 如果有已绑定的 persona，立即渲染对应 char 列表
  if (boundPersonaId) {
    await forumRenderSyncCharList(boundPersonaId, savedSyncChars);
  }

  // 主开关：是否同步聊天身份
  syncIdentityToggle.onchange = async function () {
    if (this.checked) {
      personaSelectorWrap.style.display = "flex";
      // 若已绑定 persona，显示同步给 char 区块
      const curPid = boundPersonaIdInput.value;
      if (curPid) {
        syncToCharWrap.style.display = "flex";
        await forumRenderSyncCharList(Number(curPid), savedSyncChars);
      }
    } else {
      personaSelectorWrap.style.display = "none";
      syncToCharWrap.style.display = "none";
      syncCharList.style.display = "none";
      syncToCharToggle.checked = false;
    }
  };

  // 子开关：是否同步给 char
  syncToCharToggle.onchange = function () {
    if (this.checked) {
      const curPid = boundPersonaIdInput.value;
      if (!curPid) {
        showToast("请先选择绑定的面具");
        this.checked = false;
        return;
      }
      syncCharList.style.display = "flex";
    } else {
      syncCharList.style.display = "none";
    }
  };
}

// 渲染身份选择器（面具列表 = db.archives type='user'）
async function forumRenderPersonaSelector(selectedPersonaId) {
  const container = document.getElementById("forum-edit-persona-cards");
  if (!container) return;
  container.innerHTML = "";

  const personas = await db.archives.where("type").equals("user").toArray();
  const boundPersonaIdInput = document.getElementById("forum-edit-bound-persona-id");
  const syncToCharWrap = document.getElementById("forum-edit-sync-to-char-wrap");

  if (personas.length === 0) {
    container.innerHTML = `<div style="font-size:11px; color:#94a3b8; text-align:center; padding:8px;">暂无面具，请先到档案库创建用户人设</div>`;
    return;
  }

  personas.forEach(p => {
    const card = document.createElement("div");
    const isSelected = selectedPersonaId && Number(selectedPersonaId) === Number(p.id);
    card.style.cssText = `display:flex; align-items:center; gap:10px; padding:8px; border-radius:8px; background:${isSelected ? '#f0fdf4' : '#ffffff'}; border:1.5px solid ${isSelected ? '#07c160' : '#e2e8f0'}; cursor:pointer; transition:all 0.15s;`;
    card.className = "forum-persona-option-card";

    let avatarUrl = "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%23cbd5e1'/></svg>";
    if (p.avatar) {
      avatarUrl = p.avatar instanceof Blob ? URL.createObjectURL(p.avatar) : p.avatar;
    }

    card.innerHTML = `
      <img src="${avatarUrl}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0;">
      <div style="flex:1; overflow:hidden; text-align:left;">
        <div style="font-size:12px; font-weight:700; color:#0f172a;">${escapeHtml(p.name)}</div>
        <div style="font-size:10.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.remark || '暂无备注')}</div>
      </div>
    `;

    card.onclick = async () => {
      container.querySelectorAll(".forum-persona-option-card").forEach(c => {
        c.style.borderColor = "#e2e8f0";
        c.style.backgroundColor = "#ffffff";
      });
      card.style.borderColor = "#07c160";
      card.style.backgroundColor = "#f0fdf4";
      boundPersonaIdInput.value = p.id;
      // 显示同步给 char 区块
      syncToCharWrap.style.display = "flex";
      // 重置 char 列表
      await forumRenderSyncCharList(p.id, []);
    };

    if (isSelected) {
      boundPersonaIdInput.value = p.id;
    }
    container.appendChild(card);
  });
}

// 渲染 char 多选列表（从选定面具已建立的单聊会话取值）
async function forumRenderSyncCharList(personaId, preselectedSyncChars) {
  const container = document.getElementById("forum-edit-sync-char-list");
  if (!container) return;
  container.innerHTML = "";

  // 从 sessions 取该面具下所有非群聊会话，并拉取对应 char 信息
  const sessions = await db.sessions
    .where("userId").equals(Number(personaId))
    .and(s => s.isGroup !== 1)
    .toArray();

  if (sessions.length === 0) {
    container.innerHTML = `<div style="font-size:11px; color:#94a3b8; text-align:center; padding:8px;">该面具下尚未与任何 char 建立单聊</div>`;
    return;
  }

  // 去重 charId
  const seenCharIds = new Set();
  const uniqueSessions = [];
  for (const s of sessions) {
    if (!seenCharIds.has(Number(s.charId))) {
      seenCharIds.add(Number(s.charId));
      uniqueSessions.push(s);
    }
  }

  // preselectedSyncChars 形如 [{charId, carryMemory}]
  const preselectedMap = {};
  for (const item of preselectedSyncChars) {
    preselectedMap[Number(item.charId)] = !!item.carryMemory;
  }

  for (const s of uniqueSessions) {
    const char = await db.archives.get(s.charId);
    if (!char) continue;

    const charId = Number(char.id);
    const isSelected = preselectedMap.hasOwnProperty(charId);
    const carryMemory = !!preselectedMap[charId];

    let avatarUrl = "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%23cbd5e1'/></svg>";
    if (char.avatar) {
      avatarUrl = char.avatar instanceof Blob ? URL.createObjectURL(char.avatar) : char.avatar;
    }

    const customName = s.customCharName || char.name;
    const customRemark = s.customCharName ? `（自定义名：${escapeHtml(s.customCharName)}）` : "";

    const row = document.createElement("div");
    row.style.cssText = `display:flex; flex-direction:column; gap:8px; padding:8px; border-radius:8px; background:#ffffff; border:1.5px solid ${isSelected ? '#07c160' : '#e2e8f0'};`;
    row.setAttribute("data-char-id", charId);

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${avatarUrl}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0;">
        <div style="flex:1; overflow:hidden; text-align:left;">
          <div style="font-size:12px; font-weight:700; color:#0f172a;">${escapeHtml(customName)}${customRemark}</div>
          <div style="font-size:10.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(char.remark || '暂无备注')}</div>
        </div>
        <label class="switch" style="transform:scale(0.85);">
          <input type="checkbox" class="forum-sync-char-toggle" ${isSelected ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="forum-carry-memory-row" style="display:${isSelected ? 'flex' : 'none'}; align-items:center; justify-content:space-between; padding-left:42px;">
        <span style="font-size:10.5px; color:#64748b;">携带聊天记忆</span>
        <label class="switch" style="transform:scale(0.8);">
          <input type="checkbox" class="forum-carry-memory-toggle" ${carryMemory ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `;

    // char 主开关：勾选后显示"携带记忆"子开关
    const charToggle = row.querySelector(".forum-sync-char-toggle");
    const carryRow = row.querySelector(".forum-carry-memory-row");
    charToggle.onchange = function () {
      if (this.checked) {
        row.style.borderColor = "#07c160";
        carryRow.style.display = "flex";
      } else {
        row.style.borderColor = "#e2e8f0";
        carryRow.style.display = "none";
      }
    };

    container.appendChild(row);
  }
}

// 收集表单中的同步 char 配置
function forumCollectSyncChars() {
  const container = document.getElementById("forum-edit-sync-char-list");
  if (!container) return [];
  const rows = container.querySelectorAll("[data-char-id]");
  const result = [];
  rows.forEach(row => {
    const charToggle = row.querySelector(".forum-sync-char-toggle");
    if (charToggle && charToggle.checked) {
      const carryToggle = row.querySelector(".forum-carry-memory-toggle");
      result.push({
        charId: Number(row.getAttribute("data-char-id")),
        carryMemory: !!(carryToggle && carryToggle.checked)
      });
    }
  });
  return result;
}

async function forumSaveProfileEdit() {
  const nickname = document.getElementById("forum-edit-nickname").value.trim();
  const username = document.getElementById("forum-edit-username").value.trim();
  const signature = document.getElementById("forum-edit-signature").value.trim();
  const setting = document.getElementById("forum-edit-setting").value.trim();
  const avatar = document.getElementById("forum-edit-avatar-url").value.trim();

  if (!nickname || !username) {
    showToast("昵称与用户名不能为空");
    return;
  }

  // 收集同步聊天身份配置
  const syncIdentityToggle = document.getElementById("forum-edit-sync-identity-toggle");
  const syncToCharToggle = document.getElementById("forum-edit-sync-to-char-toggle");
  const boundPersonaIdInput = document.getElementById("forum-edit-bound-persona-id");

  const syncChatConfig = {
    enabled: !!syncIdentityToggle.checked,
    boundPersonaId: boundPersonaIdInput.value ? Number(boundPersonaIdInput.value) : null,
    syncToChar: !!(syncIdentityToggle.checked && syncToCharToggle && syncToCharToggle.checked),
    syncChars: (syncIdentityToggle.checked && syncToCharToggle && syncToCharToggle.checked) ? forumCollectSyncChars() : []
  };

  await db.forum_accounts.update(forumEditingAccountId, {
    nickname, username, signature, setting, avatar,
    syncChatConfig: JSON.stringify(syncChatConfig)
  });
  showToast("资料更新成功");
  await forumLoadDrawerHeader();
  forumPopLayer();
}

async function forumDeleteAccountFromEdit() {
  const accounts = await db.forum_accounts.toArray();
  if (accounts.length <= 1) {
    showToast("删除失败：系统必须保留至少一个论坛分身账户！");
    return;
  }

  showCustomConfirm("确认删除", "您确定要彻底注销此论坛分身账户吗？其关联的发帖记录将保留，但此身份将不复存在。", async () => {
    await db.forum_accounts.delete(forumEditingAccountId);
    showToast("分身账户已成功注销");

    if (forumEditingAccountId === forumActiveAccountId) {
      const remaining = await db.forum_accounts.toArray();
      forumActiveAccountId = remaining[0].id;
      localStorage.setItem("forum_active_account_id", forumActiveAccountId);
      await forumLoadDrawerHeader();
    }
    
    forumPopLayer();
    forumClearStack();
  });
}

// === 5. 论坛设置与挂载预设控制 ===
function forumGetSettingsTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3>论坛设置</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body" style="padding: 16px; overflow-y: auto;">
      <div class="form-group">
        <label>选择已有论坛预设</label>
        <div style="display:flex; gap:8px;">
          <select id="forum-preset-select" style="flex:1;"></select>
          <button class="btn btn-danger-outline" onclick="forumDeletePreset()" style="padding: 0 10px;">删除</button>
        </div>
      </div>
      <div class="form-group">
        <label>预设名称</label>
        <input type="text" id="forum-preset-name" placeholder="请输入自定义保存的预设名">
      </div>
      <div class="form-group" style="border-top:1px solid #f1f5f9; padding-top:14px;">
        <label>论坛名称</label>
        <input type="text" id="forum-setup-name" placeholder="如：极简文艺论坛">
      </div>
      <div class="form-group">
        <label>背景资料</label>
        <textarea id="forum-setup-atmosphere" rows="3" placeholder="描述该论坛的故事背景、历史沉淀或AI环境约束底料..."></textarea>
      </div>
      <div class="form-group">
        <label>语言风格</label>
        <textarea id="forum-setup-style" rows="3" placeholder="约束发言网民的调调，如匿名文学质感、高冷、网络黑话、玩梗..."></textarea>
      </div>
      <div class="form-group">
        <label>挂载世界书词条</label>
        <div id="forum-setup-wb-list" style="display:flex; flex-direction:column; gap:6px; max-height:100px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:8px;"></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px;">
        <button class="btn btn-primary" onclick="forumSaveCurrentSetup()">保存并应用至当前账户</button>
        <button class="btn btn-outline" onclick="forumSaveAsPreset()">存为自定义预设方案</button>
      </div>
    </div>
  `;
}

async function forumInitSettingsPage() {
  await forumLoadPresetsDropdown();
  
  const wbList = document.getElementById("forum-setup-wb-list");
  if (!wbList) return;
  wbList.innerHTML = "";

  const entries = await db.world_book_entries.toArray();
  const account = await db.forum_accounts.get(forumActiveAccountId);
  
  let currentPreset = null;
  if (account && account.boundPresetId) {
    currentPreset = await db.forum_presets.get(account.boundPresetId);
  }

  document.getElementById("forum-setup-name").value = currentPreset ? currentPreset.forumName : "匿名文学舱";
  document.getElementById("forum-setup-atmosphere").value = currentPreset ? currentPreset.atmosphere : "一个克制、冷色、深度挖掘心流故事的匿名论坛";
  document.getElementById("forum-setup-style").value = currentPreset ? (currentPreset.style || "碎片化、具有互联网真实活人网感和吐槽特征") : "具有互联网真实活人网感";

  entries.forEach(e => {
    const div = document.createElement("div");
    div.style.cssText = "display:flex; align-items:center; gap:8px;";
    
    const isMounted = currentPreset && currentPreset.mountedEntryIds && currentPreset.mountedEntryIds.includes(e.id);
    div.innerHTML = `
      <input type="checkbox" class="forum-setup-wb-checkbox" value="${e.id}" ${isMounted ? 'checked' : ''}>
      <span style="font-size:12.5px;">[${e.group}] ${e.title}</span>
    `;
    wbList.appendChild(div);
  });

  document.getElementById("forum-preset-select").onchange = async (e) => {
    const id = Number(e.target.value);
    if (!id) return;
    const pr = await db.forum_presets.get(id);
    if (pr) {
      document.getElementById("forum-preset-name").value = pr.name;
      document.getElementById("forum-setup-name").value = pr.forumName;
      document.getElementById("forum-setup-atmosphere").value = pr.atmosphere;
      document.getElementById("forum-setup-style").value = pr.style || "";
      
      document.querySelectorAll(".forum-setup-wb-checkbox").forEach(cb => {
        cb.checked = pr.mountedEntryIds && pr.mountedEntryIds.includes(Number(cb.value));
      });
    }
  };
}

async function forumSaveCurrentSetup() {
  const forumName = document.getElementById("forum-setup-name").value.trim();
  const atmosphere = document.getElementById("forum-setup-atmosphere").value.trim();
  const style = document.getElementById("forum-setup-style").value.trim();
  const selectWbs = Array.from(document.querySelectorAll(".forum-setup-wb-checkbox:checked")).map(cb => Number(cb.value));

  if (!forumName || !atmosphere) {
    showToast("论坛名称与背景资料不能为空");
    return;
  }

  const presetId = await db.forum_presets.add({
    name: `${forumName}_绑定`,
    forumName,
    atmosphere,
    style,
    mountedEntryIds: selectWbs
  });

  // 强类型安全转换更新：防止因 ActiveAccountId 判定为 String 导致的世界书挂载静默丢失
  await db.forum_accounts.update(Number(forumActiveAccountId), { boundPresetId: presetId });
  showToast("论坛环境配置保存成功并已无损生效");
  forumPopLayer();
}

async function forumSaveAsPreset() {
  const name = document.getElementById("forum-preset-name").value.trim();
  const forumName = document.getElementById("forum-setup-name").value.trim();
  const atmosphere = document.getElementById("forum-setup-atmosphere").value.trim();
  const style = document.getElementById("forum-setup-style").value.trim();
  const selectWbs = Array.from(document.querySelectorAll(".forum-setup-wb-checkbox:checked")).map(cb => Number(cb.value));

  if (!name || !forumName || !atmosphere) {
    showToast("请填写完整的预设名称、论坛名与背景、风格约束描述");
    return;
  }

  const newId = await db.forum_presets.add({
    name,
    forumName,
    atmosphere,
    style,
    mountedEntryIds: selectWbs
  });

  showToast(`成功将当前方案保存至自定义预设库 [${name}]`);
  await forumLoadPresetsDropdown();
  document.getElementById("forum-preset-select").value = newId;
}

async function forumDeletePreset() {
  const id = Number(document.getElementById("forum-preset-select").value);
  if (!id) {
    showToast("请先选择一个预设进行删除");
    return;
  }
  if (confirm("确定要删除此论坛环境预设方案吗？")) {
    await db.forum_presets.delete(id);
    showToast("预设方案已成功清除");
    await forumInitSettingsPage();
  }
}

async function forumLoadPresetsDropdown() {
  const select = document.getElementById("forum-preset-select");
  if (!select) return;
  select.innerHTML = '<option value="">-- 选择已有预设 --</option>';

  const presets = await db.forum_presets.toArray();
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.innerText = p.name;
    select.appendChild(opt);
  });
}

// === 6. 账户切换与新分身注册 ===
function forumGetAccountsTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3>切换论坛账户</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body" style="padding: 16px; display:flex; flex-direction:column; gap:12px; overflow-y: auto;">
      <div id="forum-accounts-list-box" style="display:flex; flex-direction:column; gap:10px;"></div>
      <button class="btn btn-primary" onclick="forumTriggerCreateAccount()" style="margin-top:14px; width:100%;">+ 注册并新建论坛分身</button>
    </div>
  `;
}

async function forumInitAccountsPage() {
  const container = document.getElementById("forum-accounts-list-box");
  if (!container) return;
  container.innerHTML = "";

  const accounts = await db.forum_accounts.toArray();
  accounts.forEach(acc => {
    const card = document.createElement("div");
    card.className = "forum-msg-chat-item";
    card.style.display = "flex";
    card.style.justifyContent = "space-between";
    card.style.alignItems = "center";
    
    const isCurrent = acc.id === forumActiveAccountId;
    if (isCurrent) {
      card.style.borderColor = "#3b82f6";
      card.style.backgroundColor = "#eff6ff";
    }

    card.onclick = async () => {
      forumActiveAccountId = acc.id;
      localStorage.setItem("forum_active_account_id", acc.id);
      showToast(`已成功切换至分身「${acc.nickname}」`);
      await forumLoadDrawerHeader();
      forumClearStack(); // 彻底清空层栈返回主页
    };

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
        <img src="${acc.avatar || 'data:image/svg+xml;utf8,<svg viewBox=\'0 0 24 24\' xmlns=\'http://www.w3.org/2000/svg\'><circle cx=\'12\' cy=\'12\' r=\'12\' fill=\'%23cbd5e1\'/></svg>'}" style="width:36px; height:36px; border-radius:50%; object-fit: cover;">
        <div class="forum-msg-chat-info">
          <span class="forum-msg-chat-name">${escapeHtml(acc.nickname)} ${isCurrent ? '(在线)' : ''}</span>
          <span style="font-size:11px; color:#64748b;">@${acc.username}</span>
        </div>
      </div>
      <button class="btn-icon edit-btn" style="color: #64748b; padding: 4px;" onclick="event.stopPropagation(); forumPushLayer('profile-edit', ${acc.id})">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>
      </button>
    `;
    container.appendChild(card);
  });
}

function forumTriggerCreateAccount() {
  showCustomPrompt("请输入新论坛分身的名称", "孤游思想者", async (nickname) => {
    if (!nickname) return;
    
    const randomSuffix = Math.floor(Math.random() * 1000);
    const newId = await db.forum_accounts.add({
      avatar: "",
      nickname: nickname,
      username: `thinker_${randomSuffix}`,
      signature: "虚无荒野里的倾听者",
      boundPresetId: 0
    });

    forumActiveAccountId = newId;
    localStorage.setItem("forum_active_account_id", newId);
    showToast(`分身 [${nickname}] 注册成功！已强制返回主页。`);
    await forumLoadDrawerHeader();
    forumClearStack();
  });
}

// === 7. 趋势话题检索与热搜算法 (强制绑定论坛后台预设信息与手动控制逻辑) ===
async function forumRefreshTrends(force = false) {
  const container = document.getElementById("forum-trends-list");
  if (!container) return;

  const now = Date.now();
  // 如果非强制刷新 (点刷新按钮)，且处于3分钟时效内，则直接使用缓存不进行API重复查询，杜绝自动刷
  if (!force && now - forumLastTrendsRefreshTime < 180000 && container.children.length > 0) {
    return;
  }

  container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:20px 0;">正在提炼最新社区风向话题...</p>`;

  try {
    const account = await db.forum_accounts.get(forumActiveAccountId);
    let preset = null;
    if (account && account.boundPresetId) {
      preset = await db.forum_presets.get(account.boundPresetId);
    }
    const forumName = preset ? preset.forumName : "随笔论坛";
    const atmosphere = preset ? preset.atmosphere : "一个极简冷色调风格、聚焦于深度共鸣和思想交汇的高质感社区";

    const posts = await db.forum_posts.toArray();
    let textSummary = "";
    posts.slice(-10).forEach(p => {
      textSummary += `\n- 标题: ${p.title} 内容: ${p.content}`;
    });

    const systemPrompt = await buildForumSystemPrompt(forumActiveAccountId);
    const userPrompt = `你当前正为名为“${forumName}”的匿名交互社区整理热搜趋势。
【论坛官方背景资料】：${atmosphere}

请基于目前该匿名社区中最新发表的以下 10 条动态，结合上述论坛的故事氛围背景：
${textSummary || "暂无最新帖子"}

自动提炼出 5 条最契合该社区独特背景文化、充满故事张力或特定冷调质感的热搜风向标话题。

【输出格式控制】：请直接且仅返回以下格式 of JSON，不要包含 Markdown 标识符与 emoji：
[
  { "tag": "#话题标签名称", "heat": 9982 },
  { "tag": "#标签2", "heat": 8274 }
]`;

    const aiRes = await forumCallAI(systemPrompt, userPrompt);
    const list = JSON.parse(aiRes);

    container.innerHTML = "";
    list.forEach(t => {
      const row = document.createElement("div");
      row.className = "forum-trend-row";
      row.onclick = () => forumTriggerSearch(t.tag);
      row.innerHTML = `
        <span class="forum-trend-tag">${escapeHtml(t.tag)}</span>
        <span class="forum-trend-heat">${t.heat} 讨论</span>
      `;
      container.appendChild(row);
    });

    forumLastTrendsRefreshTime = now;
    if (force) showToast("趋势探索风向标提炼成功！");
  } catch(e) {
    console.error(e);
    container.innerHTML = "";
    const mock = [
      { tag: "#细雨重逢的触动", heat: 412 },
      { tag: "#废弃工厂的深夜对白", heat: 184 },
      { tag: "#关于宿命的无意义探讨", heat: 64 }
    ];
    mock.forEach(t => {
      const row = document.createElement("div");
      row.className = "forum-trend-row";
      row.onclick = () => forumTriggerSearch(t.tag);
      row.innerHTML = `
        <span class="forum-trend-tag">${t.tag}</span>
        <span class="forum-trend-heat">${t.heat} 讨论</span>
      `;
      container.appendChild(row);
    });
    if (force) showToast("趋势探索已完成降级载入");
  }
}

async function forumRefreshTrendsWithToast() {
  showToast("正在提炼并分析匿名社区风向标...");
  await forumRefreshTrends(true);
}

function forumTriggerSearch(defaultTag = "") {
  showCustomPrompt("请输入检索话题或内容关键词", defaultTag, async (keyword) => {
    if (!keyword) return;
    forumPushLayer('search-result', keyword);
  });
}

function forumGetSearchResultTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3 id="forum-search-result-title">结果</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body forum-feed-scroll" id="forum-search-results-list" style="padding:12px; overflow-y:auto;"></div>
  `;
}

async function forumInitSearchResultPage(keyword) {
  document.getElementById("forum-search-result-title").innerText = `关于「${keyword}」`;
  const container = document.getElementById("forum-search-results-list");
  if (!container) return;
  container.innerHTML = "";

  const allPosts = await db.forum_posts.toArray();
  const filtered = allPosts.filter(p => 
    p.title.includes(keyword) || 
    p.content.includes(keyword) || 
    (p.media && p.media.includes(keyword))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">未搜寻到相关的动态卡片记录</p>`;
    return;
  }

  for (let p of filtered) {
    let authorName = "匿名成员";
    let authorAvatar = "";

    // 修复 ID 碰撞：先查 NPC 表，未命中再查 User 表
    const npc = await db.forum_npc_accounts.get(p.authorId);
    if (npc) {
      authorName = npc.nickname;
      authorAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
    } else {
      const acc = await db.forum_accounts.get(p.authorId);
      if (acc) {
        authorName = acc.nickname;
        authorAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
      }
    }

    const card = document.createElement("div");
    card.className = "forum-post-card";
    card.innerHTML = `
      <div class="forum-card-header">
        <img src="${authorAvatar}" class="avatar-sm" style="object-fit:cover;">
        <div class="forum-author-meta">
          <span class="forum-author-nickname">${escapeHtml(authorName)}</span>
        </div>
      </div>
      <h4 class="forum-post-title">${escapeHtml(p.title)}</h4>
      <p class="forum-post-body">${escapeHtml(p.content)}</p>
      <div class="forum-card-footer">
        <span>${new Date(p.createdAt).toLocaleTimeString()}</span>
      </div>
    `;
    container.appendChild(card);
  }
}

// === 8. 通知与物理分发 ===
async function forumLoadNotifications() {
  const container = document.getElementById("forum-notifications-list");
  if (!container) return;
  container.innerHTML = "";

  const list = await db.forum_notifications.where('userId').equals(forumActiveAccountId).toArray();
  list.sort((a,b) => b.createdAt - a.createdAt);

  if (list.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">暂无新通知</p>`;
    return;
  }

  list.forEach(n => {
    const div = document.createElement("div");
    div.className = `forum-notification-item ${n.isRead === 0 ? 'unread' : ''}`;
    div.onclick = () => forumHandleNotificationClick(n);

    let desc = "系统向您发送了一条状态提醒";
    if (n.type === "comment") {
      desc = "有人对你的帖子发表了新跟评";
    } else if (n.type === "like") {
      desc = "有人点赞了你的帖子动态";
    } else if (n.type === "retweet") {
      desc = "有人转发了你的动态";
    }

    const timeDisplay = new Date(n.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    div.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
        <span style="font-size:13px; font-weight:700; color:#334155;">${desc}</span>
        <span style="font-size:10.5px; color:#94a3b8;">${timeDisplay}</span>
      </div>
    `;
    container.appendChild(div);
  });

  forumUpdateUnreadDot();
}

async function forumHandleNotificationClick(notify) {
  await db.forum_notifications.update(notify.id, { isRead: 1 });
  forumPushLayer('post-detail', notify.targetId);
}

async function forumUpdateUnreadDot() {
  const unreadCount = await db.forum_notifications
    .where('userId').equals(forumActiveAccountId)
    .and(n => n.isRead === 0)
    .count();

  const dot = document.getElementById("forum-tab-unread-dot");
  if (dot) {
    dot.style.display = unreadCount > 0 ? "block" : "none";
  }
}

// === 9. 论坛独立 AI 提示词编译器 (高网感真实活人论坛重构) ===
async function buildForumSystemPrompt(accountId) {
  const account = await db.forum_accounts.get(accountId);
  let preset = null;
  if (account && account.boundPresetId) {
    preset = await db.forum_presets.get(account.boundPresetId);
  }

  const forumName = preset ? preset.forumName : "论坛";
  const atmosphere = preset ? preset.atmosphere : "一个极简冷色调风格、聚焦于深度共鸣和思想交汇的高质感社区";
  const style = preset ? (preset.style || "碎片化、具有互联网真实活人网感和吐槽特征") : "具有互联网真实活人网感";

  let worldBookContent = "";
  if (preset && preset.mountedEntryIds) {
    for (let id of preset.mountedEntryIds) {
      const entry = await db.world_book_entries.get(id);
      if (entry) {
        worldBookContent += `\n- 设定背景 [${entry.title}]: ${entry.content}`;
      }
    }
  }

  // ========== 同步聊天身份模块：注入"现实身份感知"上下文 ==========
  // 当 user 账号开启了"同步聊天身份"且选择了面具和 char 时，被选中的 char 在论坛里
  // 会知道此账户的现实身份就是 user（携带或不携带聊天记忆）。
  let syncIdentityContext = "";
  try {
    let syncConfig = account?.syncChatConfig || null;
    if (syncConfig && typeof syncConfig === "string") {
      syncConfig = JSON.parse(syncConfig);
    }
    if (syncConfig && syncConfig.enabled && syncConfig.boundPersonaId && syncConfig.syncToChar && Array.isArray(syncConfig.syncChars) && syncConfig.syncChars.length > 0) {
      const boundPersona = await db.archives.get(Number(syncConfig.boundPersonaId));
      if (boundPersona) {
        const personaName = boundPersona.name;
        const personaRemark = boundPersona.remark || "";
        const personaPersona = boundPersona.persona || "";

        // 收集被同步的 char 信息
        const syncedCharInfos = [];
        for (const item of syncConfig.syncChars) {
          const charId = Number(item.charId);
          const char = await db.archives.get(charId);
          if (!char) continue;
          const carryMemory = !!item.carryMemory;

          // 找到该 char 在当前论坛账户下的 NPC 小号（含主号）
          const charNpcs = (await db.forum_npc_accounts.toArray())
            .filter(n => Number(n.userId) === Number(accountId) && Number(n.charId) === charId);
          const npcNicknames = charNpcs.map(n => `@${n.username}（${n.nickname}）`).join(" / ") || "（无分身）";

          let charInfo = `- 角色 [${char.name}]（论坛分身：${npcNicknames}）`;
          if (carryMemory) {
            // 携带记忆：注入该 char 与该 persona 的所有单聊会话最近的核心心智摘要
            const sessions = await db.sessions
              .where("userId").equals(Number(syncConfig.boundPersonaId))
              .and(s => Number(s.charId) === charId && s.isGroup !== 1)
              .toArray();
            let memoryText = "";
            for (const s of sessions) {
              if (s.coreRelationship) memoryText += `关系：${s.coreRelationship}；`;
              if (s.coreUserInEyes) memoryText += `对用户印象：${s.coreUserInEyes}；`;
            }
            charInfo += memoryText ? `【携带聊天记忆：${memoryText}】` : "【携带聊天记忆：暂无核心记忆】";
          } else {
            charInfo += "【不携带聊天记忆：仅以档案馆人设为准】";
          }
          syncedCharInfos.push(charInfo);
        }

        syncIdentityContext = `\n\n【论坛现实身份同步通道（极重要）】
当前论坛账户 "${account.nickname}" (@${account.username}) 已经被 user 主动绑定了现实身份：
- 现实身份（面具）：${personaName}${personaRemark ? `（${personaRemark}）` : ""}
- 现实身份人设：${personaPersona || "暂无"}

以下 char 已经被 user 选中，"知道"此账户的现实身份就是 user。他们在论坛的私信/发帖/评论行为中，可以隐约或明显地体现出对 user 真实身份的认知（具体表现强度由 char 自身性格决定，但不可假装完全不认识）：
${syncedCharInfos.join("\n")}

未被列入此名单的 char 仍然不会明显地表示他知道这个账号是 user 的面具。`;
      }
    }
  } catch (e) {
    console.warn("构建同步聊天身份上下文失败:", e);
  }

  return `你当前正运行着名为“${forumName}”的匿名活跃社交论坛。
这里是一个有血有肉、极其真实活跃的互联网社交论坛（高度融合推特/X、微博、小红书和抖音评论区文化）。
网民发言绝不应该死板说教，发帖与回帖中需要焕发极高的活人生命力：
1. 吐槽打工/学习、日常发泄、甚至动辄使用当代“发疯文学”进行情绪宣泄的社打工人和学生党。
2. 满嘴互联网热梗黑话（如“笑死”、“真服了”、“避坑”、“有一说一”、“纯路人”、“家人们谁懂啊”）、喜欢阴阳怪气或跟帖造词的乐子人。
3. 言辞犀利刻薄、极其自我、一言不合就和别人进行高强度键盘对线与互撕的选手。
4. 热爱精致分享、写带有避坑/安利字眼的生活流小红书博主。
5. 默默吃瓜、点赞围观或偶尔留下暖心慰藉的善意纯路人。

在接下来的各种互动行为（发布帖子、评论、生成二级级联反应、私信）中，你必须彻底代入目标人物的个设与人际羁绊，结合当下的论坛吃瓜焦点以及下方的设定背景：
${worldBookContent}
当前基础论坛背景资料描述：${atmosphere}
当前论坛要求的网民语言风格：${style}
${syncIdentityContext}

网民对话规范：
- 鼓励并在内容中合理加入当前风格所界定的语气、助词以及emoji，从而拉满真实的活人网感，但禁止频繁使用网梗。
- 绝不要用书面腔，语言应当碎片化、口语化。
- 评论区要呈现出有来有往、相互站队、接梗抬杠、甚至看热闹的多级讨论层级。
- 禁止输出多余的解释性文本或旁白，严格直接生成对话或格式数据。`;
}

async function forumCallAI(systemPrompt, userPrompt) {
  const presetId = localStorage.getItem("global_api_preset_id");
  if (!presetId) throw new Error("未配置全局默认 API，请前往‘系统设置 - API 协议设置’中配置并应用！");
  const api = await db.api_presets.get(Number(presetId));
  if (!api) throw new Error("API 配置预设未找到");

  const response = await fetch(`${api.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
    body: JSON.stringify({
      model: api.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: api.temperature
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const result = await response.json();
  return result.choices[0].message.content.trim();
}

// === 10. 补全缺失页面 HTML 模板函数，根治 ReferenceError (去 Emoji 风格) ===
function forumGetNewPostTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
      <h3>发送动态</h3>
      <button class="btn btn-primary" onclick="forumPublishPost()" style="padding: 6px 14px;">发布</button>
    </header>
    <div class="win-body" style="padding: 16px; overflow-y: auto;">
      <div class="form-group">
        <label>动态标题</label>
        <input type="text" id="forum-new-post-title" placeholder="请输入发帖标题..." style="width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:10px; box-sizing:border-box;">
      </div>
      <div class="form-group">
        <label>动态内容</label>
        <textarea id="forum-new-post-content" placeholder="分享此刻想法..." rows="5" style="width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:10px; resize:none; box-sizing:border-box;"></textarea>
      </div>
      <div class="form-group">
        <label>附加画面描述 (自适应生成灰色白描图卡)</label>
        <input type="text" id="forum-new-post-media" placeholder="例如：一个站在废弃桥头看落日的侧影">
      </div>
      <div class="form-group">
        <label>提及关注的人 (@角色)</label>
        <div id="forum-new-post-at-list" style="display:flex; flex-direction:column; gap:6px; max-height: 120px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:8px;"></div>
      </div>
    </div>
  `;
}

function forumGetPostDetailTemplate() {
  return `
    <header class="win-header" style="background-color: #ffffff; border-bottom: 1px solid #eff3f4;">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24" style="color: #0f1419;"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3>帖子详情</h3>
      <!-- 右上角小小的红色 SVG 删除帖子按钮 -->
      <button class="btn-icon" onclick="forumDeletePostDirectly()" style="color: #ef4444;" title="删除这条帖子">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </header>
    <div class="win-body" style="padding: 16px; overflow-y: auto; background-color: #f8fafc;">
      <div id="forum-post-detail-content"></div>
      
      <div class="bookstore-section-title" style="margin-top:20px;">
        <span>评论回复</span>
      </div>
      <div class="forum-comments-container" id="forum-comments-list"></div>
      
      <div style="height: 60px;"></div>
    </div>
    
    <div class="dialog-input-container" style="background-color: #ffffff; border-top: 1px solid #eff3f4; position: absolute; bottom: 0; left: 0; width: 100%; box-sizing: border-box; padding: 10px 16px; display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between !important; gap: 8px !important; z-index: 100; height: 58px; flex-wrap: nowrap !important;">
      <!-- 极拉伸回复框，杜绝折行 -->
      <input type="text" id="forum-comment-input" placeholder="发布你的回复..." style="flex: 1 !important; height: 38px !important; border: 1px solid #eff3f4 !important; border-radius: 20px !important; padding: 0 16px !important; font-size: 14px !important; outline: none !important; background-color: #f7f9f9 !important; color: #0f1419 !important; min-width: 0 !important; margin: 0 !important; box-sizing: border-box !important;">
      <button class="btn btn-primary" id="forum-comment-submit-btn" style="height: 38px !important; border-radius: 19px !important; font-size: 13px !important; padding: 0 18px !important; flex-shrink: 0 !important; white-space: nowrap !important; margin: 0 !important; border: none !important; background-color: #1d9bf0 !important; color: #ffffff !important; cursor: pointer !important; font-weight: 700 !important;">发送</button>
    </div>
  `;
}

function forumGetProfileViewTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3 id="forum-profile-view-title">个人空间</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body" style="padding:0; overflow-y:auto; background-color:#f8fafc; display:flex; flex-direction:column;">
      <div class="forum-profile-cover" style="position:relative; flex-shrink:0;">
        <div class="forum-profile-avatar-wrapper" style="position:absolute; bottom:-36px; left:16px;">
          <img id="forum-profile-avatar" src="" style="width:72px; height:72px; border-radius:50%; object-fit:cover;">
        </div>
      </div>
      <div class="forum-profile-header-actions" id="forum-profile-actions" style="display:flex; justify-content:flex-end; padding:8px 16px; gap:8px; flex-shrink:0;"></div>
      <div class="forum-profile-info-block" style="padding:16px; background-color:#ffffff; flex-shrink:0;">
        <h2 id="forum-profile-nickname" style="font-size:18px; font-weight:800; color:#0f172a; margin:0;"></h2>
        <span id="forum-profile-username" style="font-size:12px; color:#64748b; margin-top:2px; display:block;"></span>
        <p id="forum-profile-bio" class="forum-profile-bio" style="margin-top:8px; font-size:13px; color:#475569;"></p>
        
        <!-- 用户分身数字设定底料卡片 -->
        <div id="forum-profile-setting-box" style="display:none; background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-top:12px;">
          <h4 style="font-size:11px; color:#64748b; margin:0 0 4px 0; font-weight:700;">分身设定底料</h4>
          <p id="forum-profile-setting-text" style="font-size:12px; color:#334155; margin:0; line-height:1.4; text-align:justify;"></p>
        </div>
      </div>
      
      <div class="forum-home-sub-tabs" id="forum-profile-tabs" style="flex-shrink:0; display:flex;">
        <span class="sub-tab active" id="forum-profile-tab-posts" onclick="forumSwitchProfileSubTab('posts')" style="flex:1; text-align:center;">动态</span>
        <span class="sub-tab" id="forum-profile-tab-likes" onclick="forumSwitchProfileSubTab('likes')" style="flex:1; text-align:center; display:none;">喜欢</span>
      </div>
      <div class="forum-feed-scroll" id="forum-profile-posts-list" style="padding:12px; flex:1; overflow-y:auto;"></div>
    </div>
  `;
}

function forumGetNpcsTemplate() {
  return `
    <header class="win-header">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3>NPC管理中枢</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body" style="padding: 16px; overflow-y: auto;">
      <!-- 上半部分: 引入角色小号管理 -->
      <div class="bookstore-section-title" style="margin-top:0;">
        <span>档案馆角色引入 (绑定数字身份)</span>
      </div>
      <div id="forum-npcs-archive-list" style="display:flex; flex-direction:column; gap:10px; margin-bottom: 24px;"></div>

      <!-- 下半部分: 关注通讯录管理 -->
      <div class="bookstore-section-title">
        <span>当前账户已关注的 NPC 列表</span>
      </div>
      <div id="forum-npcs-follows-list" style="display:flex; flex-direction:column; gap:10px;"></div>
    </div>
  `;
}

function forumGetChatRoomTemplate() {
  return `
    <header class="win-header" style="background-color: #ffffff; border-bottom: 1px solid #eff3f4;">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24" style="color: #0f1419;"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3 id="forum-chat-room-title" style="color: #0f1419; font-weight: 800; font-size: 16px;">私信</h3>
      <div style="width:40px;"></div>
    </header>
    <div class="win-body" style="padding: 16px; overflow-y: auto; background-color: #ffffff; display:flex; flex-direction:column; gap:14px; height: calc(100% - 110px);" id="forum-chat-messages-flow"></div>
    
    <div class="dialog-input-container" style="background-color: #ffffff; border-top: 1px solid #eff3f4; position: absolute; bottom: 0; left: 0; width: 100%; box-sizing: border-box; padding: 10px 16px; display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between !important; gap: 8px !important; z-index: 100; height: 58px; flex-wrap: nowrap !important;">
      <!-- 极度拉伸的开阔输入框，规避一切物理折行 -->
      <input type="text" id="forum-chat-input" placeholder="输入私信对白..." style="flex: 1 !important; height: 38px !important; border: 1px solid #eff3f4 !important; border-radius: 20px !important; padding: 0 16px !important; font-size: 14px !important; outline: none !important; background-color: #f7f9f9 !important; color: #0f1419 !important; min-width: 0 !important; margin: 0 !important; box-sizing: border-box !important;">
      
      <!-- 固化不收缩的右侧按钮侧边栏 -->
      <div style="display: flex !important; flex-direction: row !important; align-items: center !important; gap: 8px !important; flex-shrink: 0 !important; flex-wrap: nowrap !important;">
        <!-- 上屏发送按钮 (纯纸飞机) -->
        <button class="btn-icon" id="forum-chat-send-btn" style="width: 38px !important; height: 38px !important; border-radius: 50% !important; background: #1d9bf0 !important; color: #ffffff !important; display: flex !important; align-items: center !important; justify-content: center !important; border: none !important; cursor: pointer !important; padding: 0 !important; margin: 0 !important;" title="上屏发送 (不对接AI)">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
        <!-- 获取AI伙伴跟手回复按钮 (小星星) -->
        <button class="btn-icon" id="forum-chat-ai-btn" style="width: 38px !important; height: 38px !important; border-radius: 50% !important; background: #f7f9f9 !important; color: #1d9bf0 !important; display: flex !important; align-items: center !important; justify-content: center !important; border: 1px solid #eff3f4 !important; cursor: pointer !important; padding: 0 !important; margin: 0 !important;" title="使对方产生应答 (AI)">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1 17.75 3.75 15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 2.5-5.5 5.5-2.5-5.5-2.5zm7.5 5l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 14.5z"/></svg>
        </button>
      </div>
    </div>
  `;
}

const originalOpenApp = window.openApp;
window.openApp = function(appId) {
  if (appId === "forum") {
    initForumApp();
    document.getElementById("win-forum").classList.add("active");
    return;
  }
  if (typeof originalOpenApp === "function") originalOpenApp(appId);
};

// === 16. 通知中心刷新封装 ===
async function forumLoadNotificationsWithToast() {
  await forumLoadNotifications();
  showToast("通知中枢已刷新完成");
}

// === 17. 个人空间主页重绘（无碰撞识别与NPC触发API自发动态） ===
let currentProfileViewId = null;
let currentProfileSubTab = 'posts';
// 记录当前查看的主页身份类型（0=user，1=NPC），用于在帖子列表中过滤 ID 碰撞的串扰帖子
let currentProfileIsNpc = null;

// 包装函数：明确传入身份类型，避免 ID 碰撞导致 user 主页被 NPC 拦截
window.forumOpenProfile = function(id, isNpc) {
  forumPushLayer('profile-view', { id: id, isNpc: isNpc });
};

async function forumInitProfileViewPage(userIdOrObj) {
  // 支持对象传参 { id, isNpc } 以明确身份类型，兼容旧数字传参
  let userId, forceIsNpc;
  if (typeof userIdOrObj === 'object' && userIdOrObj !== null && !Array.isArray(userIdOrObj)) {
    userId = userIdOrObj.id;
    forceIsNpc = userIdOrObj.isNpc;
  } else {
    userId = userIdOrObj;
    forceIsNpc = null;
  }

  currentProfileViewId = userId;
  currentProfileSubTab = 'posts';
  currentProfileIsNpc = null;

  const nicknameEl = document.getElementById("forum-profile-nickname");
  const usernameEl = document.getElementById("forum-profile-username");
  const bioEl = document.getElementById("forum-profile-bio");
  const avatarEl = document.getElementById("forum-profile-avatar");
  const actionsEl = document.getElementById("forum-profile-actions");
  const settingBox = document.getElementById("forum-profile-setting-box");
  const settingText = document.getElementById("forum-profile-setting-text");
  const likesTab = document.getElementById("forum-profile-tab-likes");

  if (!nicknameEl || !usernameEl || !bioEl || !avatarEl || !actionsEl) return;

  if (likesTab) likesTab.style.display = "block";

  let isNpc = false;
  let profile = null;

  // 身份判定优先级：调用方明确传入 > userId === forumActiveAccountId 优先按 user > fallback 先查 NPC
  if (forceIsNpc === true) {
    profile = await db.forum_npc_accounts.get(Number(userId));
    isNpc = true;
  } else if (forceIsNpc === false) {
    profile = await db.forum_accounts.get(Number(userId));
    isNpc = false;
  } else if (Number(userId) === Number(forumActiveAccountId)) {
    // 侧边栏/私信点击自己头像传入的是 forumActiveAccountId，明确按 user 处理
    profile = await db.forum_accounts.get(Number(userId));
    isNpc = false;
  } else {
    // fallback：先查 NPC 表，命中即 NPC，否则查 User 表
    profile = await db.forum_npc_accounts.get(Number(userId));
    if (profile) {
      isNpc = true;
    } else {
      profile = await db.forum_accounts.get(Number(userId));
    }
  }

  // 记录当前主页身份类型，供 forumSwitchProfileSubTab 过滤串扰帖子使用
  currentProfileIsNpc = isNpc ? 1 : 0;

  if (!profile) {
    showToast("用户或NPC不存在");
    return;
  }

  nicknameEl.innerText = profile.nickname;
  usernameEl.innerText = isNpc ? `@npc_${profile.id}` : `@${profile.username}`;
  bioEl.innerText = isNpc ? (profile.postPreference || "这个NPC没有留下什么。") : (profile.signature || "这个旅人很神秘，什么都没写。");
  avatarEl.src = profile.avatar || forumGenerateColorfulAvatar(profile.nickname);

  if (isNpc) {
    if (settingBox && settingText) {
      settingBox.style.display = "block";
      settingText.innerText = `自发频率: ${profile.postFrequency || '每天1条'}\n发帖偏好: ${profile.postPreference || '无'}`;
    }
  } else {
    if (settingBox) settingBox.style.display = "none";
  }

  actionsEl.innerHTML = "";
  // 修复 ID 碰撞：必须排除 NPC 身份后再做 user 账户匹配，否则 NPC id 数值等于 forumActiveAccountId 时会被误判为自己
  const isSelfUserProfile = !isNpc && Number(userId) === Number(forumActiveAccountId);
  if (isSelfUserProfile) {
    actionsEl.innerHTML = `
      <button class="forum-capsule-btn" onclick="forumPushLayer('profile-edit', ${userId})">编辑资料</button>
    `;
  } else if (isNpc) {
    const isFollowed = await db.forum_follows.where({ followerId: forumActiveAccountId, followeeId: userId }).first();
    actionsEl.innerHTML = `
      <button class="forum-capsule-btn ${isFollowed ? '' : 'primary'}" id="forum-profile-follow-btn" onclick="forumToggleFollowNpc(${userId})">
        ${isFollowed ? '已关注' : '关注'}
      </button>
      <button class="forum-capsule-btn primary" onclick="forumStartPrivateChat(${userId})">发私信</button>
    `;
  }

  await forumSwitchProfileSubTab('posts');

  if (isNpc) {
    const posts = await db.forum_posts.where('authorId').equals(userId).toArray();
    if (posts.length === 0) {
      showToast("正在通过AI产生最新时空动态...");
      if (typeof forumNpcAutoPublishPost === "function") {
        await forumNpcAutoPublishPost(profile);
        await forumSwitchProfileSubTab('posts');
      }
    }
  }
}

async function forumToggleFollowNpc(npcId) {
  const isFollowed = await db.forum_follows.where({ followerId: forumActiveAccountId, followeeId: npcId }).first();
  const btn = document.getElementById("forum-profile-follow-btn");
  if (isFollowed) {
    await db.forum_follows.delete(isFollowed.id);
    if (btn) {
      btn.innerText = "关注";
      btn.classList.add("primary");
    }
    showToast("已取消关注");
  } else {
    await db.forum_follows.add({ followerId: forumActiveAccountId, followeeId: npcId, createdAt: Date.now() });
    if (btn) {
      btn.innerText = "已关注";
      btn.classList.remove("primary");
    }
    showToast("关注成功");
  }
}

async function forumSwitchProfileSubTab(tab) {
  currentProfileSubTab = tab;
  const postsTabBtn = document.getElementById("forum-profile-tab-posts");
  const likesTabBtn = document.getElementById("forum-profile-tab-likes");

  if (postsTabBtn && likesTabBtn) {
    postsTabBtn.classList.toggle("active", tab === 'posts');
    likesTabBtn.classList.toggle("active", tab === 'likes');
  }

  const container = document.getElementById("forum-profile-posts-list");
  if (!container) return;
  container.innerHTML = "";

  if (tab === 'posts') {
    let posts = await db.forum_posts.where('authorId').equals(currentProfileViewId).toArray();
    // 修复 ID 碰撞导致的串扰：authorId 索引查询会同时返回 user 帖子和 id 撞上的 NPC 帖子，
    // 必须根据 currentProfileIsNpc 过滤掉不属于当前身份类型的帖子。
    // 对于历史无 isNpc 字段的旧帖子，通过查询 NPC id 集合来判断真实身份。
    const allNpcIds = new Set((await db.forum_npc_accounts.toArray()).map(n => Number(n.id)));
    posts = posts.filter(p => {
      // 路人帖子（isPasserby === 1）没有个人主页，一律排除
      if (p.isPasserby === 1) return false;
      if (currentProfileIsNpc === 1) {
        // 查看 NPC 主页：保留 NPC 帖子
        if (p.isNpc === 1) return true;
        if (p.isNpc === 0) return false;
        // 历史数据：authorId 在 NPC 表中才算 NPC 帖子
        return allNpcIds.has(Number(p.authorId));
      } else {
        // 查看 user 主页：保留 user 帖子
        if (p.isNpc === 0) return true;
        if (p.isNpc === 1) return false;
        // 历史数据：authorId 不在 NPC 表中才算 user 帖子
        return !allNpcIds.has(Number(p.authorId));
      }
    });
    posts.sort((a,b) => b.createdAt - a.createdAt);

    if (posts.length === 0) {
      container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">该用户暂无发表动态</p>`;
      return;
    }

    posts.forEach(p => {
      const card = document.createElement("div");
      card.className = "forum-post-card";
      card.style.cursor = "pointer";
      // 点击个人空间的帖子，直接层推跳转入详情页
      card.onclick = () => forumPushLayer('post-detail', p.id);

      const timeStr = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      card.innerHTML = `
        <h4 class="forum-post-title">${escapeHtml(p.title)}</h4>
        <p class="forum-post-body">${escapeHtml(p.content)}</p>
        <div class="forum-card-footer">
          <span>${timeStr} · ${p.views || 0} 查看</span>
          <span>${p.likesCount || 0} 赞 · ${p.commentsCount || 0} 评论</span>
        </div>
      `;
      container.appendChild(card);
    });
  } else if (tab === 'likes') {
    // 强制使用物理 liked 表过滤提取该 viewed 账户真实点赞过的帖子记录，规避无厘头随机呈现
    const myLikes = (await db.forum_likes.toArray()).filter(l => Number(l.userId) === Number(currentProfileViewId) && l.targetType === 'post');
    const likedPostIds = myLikes.map(l => l.targetId);

    const likedPosts = [];
    for (let id of likedPostIds) {
      const p = await db.forum_posts.get(id);
      if (p) likedPosts.push(p);
    }

    if (likedPosts.length === 0) {
      container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">暂无真实点赞过的动态记录</p>`;
      return;
    }

    for (let p of likedPosts) {
      let authorName = "匿名成员";
      // 路人帖子直接用自带作者名，NPC/user 帖子查表
      if (p.isPasserby === 1) {
        authorName = p.authorNickname || "匿名路人";
      } else {
        const npc = await db.forum_npc_accounts.get(p.authorId);
        if (npc) {
          authorName = npc.nickname;
        } else {
          const acc = await db.forum_accounts.get(p.authorId);
          if (acc) {
            authorName = acc.nickname;
          } else if (p.authorNickname) {
            authorName = p.authorNickname;
          }
        }
      }
      const card = document.createElement("div");
      card.className = "forum-post-card";
      card.style.cursor = "pointer";
      // 支持从点赞列表点击直接穿透到对应的帖子详情
      card.onclick = () => forumPushLayer('post-detail', p.id);

      card.innerHTML = `
        <div style="font-size:11.5px; color:#1d9bf0; margin-bottom:4px; font-weight:700;">赞了 @${escapeHtml(authorName)} 的随笔</div>
        <h4 class="forum-post-title">${escapeHtml(p.title)}</h4>
        <p class="forum-post-body">${escapeHtml(p.content)}</p>
      `;
      container.appendChild(card);
    }
  }
}

// === 18. NPC 小号管理与档案馆角色绑定真正引入 (同步零 Await 内存对齐重构，消除闪屏) ===
// 支持单个 char 拥有最多 3 个小号（含主分身）。在聊天开关开启后由 char 自主建立的小号也会出现在这里。
const FORUM_MAX_ALT_ACCOUNTS = 3;

async function forumInitNpcsPage() {
  const archiveList = document.getElementById("forum-npcs-archive-list");
  const followsList = document.getElementById("forum-npcs-follows-list");

  if (!archiveList || !followsList) return;

  // 1. 数据高阶预拉取，杜绝清空 DOM 后的异步等待
  const chars = await db.archives.where('type').equals('character').toArray();
  const allNpcs = (await db.forum_npc_accounts.toArray()).filter(n => Number(n.userId) === Number(forumActiveAccountId));
  const allFollows = await db.forum_follows.where('followerId').equals(Number(forumActiveAccountId)).toArray();

  const archiveFragment = document.createDocumentFragment();
  const followsFragment = document.createDocumentFragment();

  // 2. 档案馆引入卡片同步拼装
  if (chars.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.style.cssText = "text-align:center; color:#64748b; font-size:12px; padding:10px 0;";
    emptyP.innerText = "档案馆暂无自定义角色，请先前往‘档案库’创建角色卡";
    archiveFragment.appendChild(emptyP);
  } else {
    for (let c of chars) {
      // 取该 char 名下所有小号（最多 3 个），按 id 升序保持建立顺序
      const charNpcs = allNpcs
        .filter(n => Number(n.charId) === Number(c.id))
        .sort((a, b) => Number(a.id) - Number(b.id));

      const row = document.createElement("div");
      row.className = "forum-msg-chat-item";
      row.style.cssText = "display:flex; flex-direction:column; gap:8px; align-items:stretch; padding:10px; border:1.5px solid #e2e8f0; border-radius:10px; background:#fafbfc;";

      let avatarUrl = "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='12' fill='%23cbd5e1'/></svg>";
      if (c.avatar) {
        if (c.avatar instanceof Blob) {
          avatarUrl = URL.createObjectURL(c.avatar);
        } else {
          avatarUrl = c.avatar;
        }
      }

      // 角色头部行（头像 + 姓名 + 小号计数 + 建立按钮）
      const altCount = charNpcs.length;
      const canCreateMore = altCount < FORUM_MAX_ALT_ACCOUNTS;
      const countLabel = altCount === 0
        ? `<span style="font-size:11px; color:#94a3b8; display:block;">未引入任何分身</span>`
        : `<span style="font-size:11px; color:#10b981; display:block;">已有 ${altCount}/${FORUM_MAX_ALT_ACCOUNTS} 个论坛分身</span>`;

      let headerHtml = `
        <div style="display:flex; align-items:center; gap:12px; justify-content:space-between; width:100%;">
          <div style="display:flex; align-items:center; gap:12px; flex:1;">
            <img src="${avatarUrl}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">
            <div style="flex:1;">
              <span class="forum-msg-chat-name" style="font-weight:700;">${escapeHtml(c.name)}</span>
              ${countLabel}
            </div>
          </div>
          ${canCreateMore ? `<button class="btn btn-primary" style="padding:5px 10px; font-size:11px; flex-shrink:0;" onclick="forumIntroduceNpc(${c.id}, '${escapeHtml(c.name)}', '${escapeHtml(avatarUrl)}')">+ 建立分身</button>` : `<span style="font-size:10.5px; color:#ef4444; flex-shrink:0;">已达上限</span>`}
        </div>
      `;

      // 每个小号一行
      let altsHtml = "";
      if (charNpcs.length > 0) {
        altsHtml = `<div style="display:flex; flex-direction:column; gap:6px; margin-top:6px; padding-top:8px; border-top:1px dashed #e2e8f0;">`;
        charNpcs.forEach((npc, idx) => {
          const npcAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
          const isMain = idx === 0;
          altsHtml += `
            <div style="display:flex; flex-direction:column; gap:6px; padding:8px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px;">
              <div style="display:flex; align-items:center; gap:10px; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                  <img src="${npcAvatar}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;">
                  <div style="flex:1; overflow:hidden;">
                    <span style="font-size:12px; font-weight:700; color:#0f172a;">${escapeHtml(npc.nickname)} ${isMain ? '<span style="font-size:9px; color:#6366f1; background:#eef2ff; padding:1px 4px; border-radius:4px;">主号</span>' : '<span style="font-size:9px; color:#f59e0b; background:#fef3c7; padding:1px 4px; border-radius:4px;">小号'+(idx)+'</span>'}</span>
                    <span style="font-size:10.5px; color:#64748b; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">@${escapeHtml(npc.username || 'unknown')} · ${escapeHtml(npc.signature || '无签名')}</span>
                  </div>
                </div>
                <button class="btn btn-outline" style="padding:3px 7px; font-size:10.5px; border-color:#ef4444; color:#ef4444; flex-shrink:0;" onclick="forumRemoveNpc(${npc.id})">移除</button>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                <span style="font-size:10.5px; color:#64748b; font-weight:700; flex-shrink:0;">发帖概率:</span>
                <select style="font-size:10.5px; padding:3px; border:1px solid #cbd5e1; border-radius:6px; flex:1;" onchange="forumUpdateNpcSetting(${npc.id}, 'probability', this.value)">
                  <option value="0" ${Number(npc.postProbability || 0) === 0 ? 'selected' : ''}>0%</option>
                  <option value="10" ${Number(npc.postProbability || 0) === 10 ? 'selected' : ''}>10%</option>
                  <option value="30" ${Number(npc.postProbability || 0) === 30 ? 'selected' : ''}>30% (默认)</option>
                  <option value="50" ${Number(npc.postProbability || 0) === 50 ? 'selected' : ''}>50%</option>
                  <option value="80" ${Number(npc.postProbability || 0) === 80 ? 'selected' : ''}>80%</option>
                  <option value="100" ${Number(npc.postProbability || 0) === 100 ? 'selected' : ''}>100%</option>
                </select>
              </div>
            </div>
          `;
        });
        altsHtml += `</div>`;
      }

      row.innerHTML = headerHtml + altsHtml;
      archiveFragment.appendChild(row);
    }
  }

  // 3. 通讯录卡片同步拼装
  let followsCount = 0;
  for (let npc of allNpcs) {
    const isFollowed = allFollows.some(f => f.followeeId === npc.id);
    if (!isFollowed) continue;
    followsCount++;

    const row = document.createElement("div");
    row.className = "forum-msg-chat-item";
    
    const avatarUrl = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);

    row.innerHTML = `
      <img src="${avatarUrl}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">
      <div class="forum-msg-chat-info">
        <span class="forum-msg-chat-name">${escapeHtml(npc.nickname)}</span>
        <span style="font-size:11px; color:#64748b;">@${escapeHtml(npc.username || 'unknown')}</span>
      </div>
      <button class="btn btn-outline" style="padding:4px 10px; font-size:11.5px;" onclick="forumUnfollowNpcFromSettings(${npc.id})">取消关注</button>
    `;
    followsFragment.appendChild(row);
  }

  if (followsCount === 0) {
    const emptyFollowP = document.createElement("p");
    emptyFollowP.style.cssText = "text-align:center; color:#64748b; font-size:12px; padding:10px 0;";
    emptyFollowP.innerText = "当前暂无关注的 NPC 分身";
    followsFragment.appendChild(emptyFollowP);
  }

  // 4. 同步交换上屏，一劳永逸根治返回白屏闪烁
  archiveList.innerHTML = "";
  archiveList.appendChild(archiveFragment);

  followsList.innerHTML = "";
  followsList.appendChild(followsFragment);
}

async function forumIntroduceNpc(charId, nickname, avatar) {
  // 1. 校验小号上限：每个 char 最多 3 个分身
  const existingAlts = (await db.forum_npc_accounts.toArray())
    .filter(n => Number(n.userId) === Number(forumActiveAccountId) && Number(n.charId) === Number(charId));
  if (existingAlts.length >= FORUM_MAX_ALT_ACCOUNTS) {
    showToast(`该角色的论坛分身已达上限（${FORUM_MAX_ALT_ACCOUNTS} 个），无法继续建立`);
    return;
  }

  showToast("正在请求 AI 编译时空马甲中...");
  try {
    const char = await db.archives.get(charId);
    const systemPrompt = `你是一个匿名交互社交论坛。你将要为档案馆中的角色创建全新的、充满网感、符合其原性格特征的论坛匿名账户（马甲）。
官方人设设定：${char ? char.persona : "暂无"}
角色姓名：${nickname}`;

    const userPrompt = `请为该角色定制一个匿名账户。请返回以下格式的 JSON，不要包含 Markdown 语法标识符：
{
  "nickname": "具有匿名感、克制造弄、符合原设的论坛昵称",
  "username": "拼音或英文小写组成的匿名用户名（不带@，如walker_99）",
  "signature": "一句精美的、符合性格执念和匿名论坛调调的个性签名"
}`;

    const aiRes = await forumCallAI(systemPrompt, userPrompt);
    const parsed = JSON.parse(aiRes);

    const colorfulAvatarUrl = forumGenerateColorfulAvatar(parsed.nickname || nickname);

    // 绑定当前 activeUser，达成账号隔离 [1]
    const newId = await db.forum_npc_accounts.add({
      userId: Number(forumActiveAccountId),
      charId: charId,
      nickname: parsed.nickname || nickname,
      avatar: colorfulAvatarUrl,
      username: parsed.username || `user_${Math.floor(Math.random() * 10000)}`,
      signature: parsed.signature || "这个分身有点神秘，什么也没写。",
      postProbability: 30, // 默认新小号拥有 30% 刷新时自发帖子概率
      postPreference: "匿名文学"
    });

    // 自动关注该角色，使其一引入就无缝出现在私信通讯录中
    const isFollowed = await db.forum_follows.where({ followerId: Number(forumActiveAccountId), followeeId: newId }).first();
    if (!isFollowed) {
      await db.forum_follows.add({
        followerId: Number(forumActiveAccountId),
        followeeId: newId,
        createdAt: Date.now()
      });
    }

    showToast(`时空马甲 [${parsed.nickname || nickname}] 接入成功，已自动添加到关注列表中！`);
    await forumInitNpcsPage();
  } catch(e) {
    console.error(e);
    // 容灾直接引入
    const colorfulAvatarUrl = forumGenerateColorfulAvatar(nickname);
    const newId = await db.forum_npc_accounts.add({
      userId: Number(forumActiveAccountId),
      charId: charId,
      nickname: nickname,
      avatar: colorfulAvatarUrl,
      username: `thinker_${Math.floor(Math.random() * 10000)}`,
      signature: "虚无荒野里的倾听者",
      postProbability: 30,
      postPreference: "匿名文学"
    });

    const isFollowed = await db.forum_follows.where({ followerId: Number(forumActiveAccountId), followeeId: newId }).first();
    if (!isFollowed) {
      await db.forum_follows.add({
        followerId: Number(forumActiveAccountId),
        followeeId: newId,
        createdAt: Date.now()
      });
    }

    showToast(`由于网络延迟，已降级直接引入角色并自动关注！`);
    await forumInitNpcsPage();
  }
}

async function forumRemoveNpc(npcId) {
  await db.forum_npc_accounts.delete(npcId);
  showToast("分身已成功从论坛网络移出");
  await forumInitNpcsPage();
}

async function forumUpdateNpcSetting(npcId, type, value) {
  if (type === 'probability') {
    await db.forum_npc_accounts.update(npcId, { postProbability: Number(value) });
  }
  showToast("NPC 参数已热重载生效");
}

async function forumUnfollowNpcFromSettings(npcId) {
  const follow = await db.forum_follows.where({ followerId: forumActiveAccountId, followeeId: npcId }).first();
  if (follow) {
    await db.forum_follows.delete(follow.id);
    showToast("已成功取消关注");
    await forumInitNpcsPage();
  }
}

// 物理删除本帖及所有子跟评记录 (自愈式刷新 Timeline) [1]
async function forumDeletePostDirectly() {
  if (!activePostDetailId) return;
  showCustomConfirm("确认删除动态", "您确定要彻底删除这条发帖记录以及它下属的所有评论回复树吗？此操作不可逆。", async () => {
    await db.forum_posts.delete(activePostDetailId);
    
    // 级联粉碎此帖子下的全部跟评
    const comments = await db.forum_comments.where('postId').equals(activePostDetailId).toArray();
    for (let c of comments) {
      await db.forum_comments.delete(c.id);
    }
    
    showToast("动态卡片已成功粉碎删除");
    forumPopLayer(); // 关闭详情层
    if (typeof forumLoadPostsFeed === "function") {
      forumLoadPostsFeed(); // 回退刷新主 Feed 时间线
    }
  });
}

// === 19. 私信列表刷新封装 (真实对接 API 心流探测机制，及多渠道融合) ===
async function forumLoadMessagesTabWithToast() {
  showToast("正在拉取时空私信，探测匿名树洞中...");
  try {
    const systemPrompt = await buildForumSystemPrompt(forumActiveAccountId);
    const userAccount = await db.forum_accounts.get(forumActiveAccountId);
    const userSetting = userAccount ? (userAccount.setting || "暂无特别设定") : "暂无";
    
    const userPostsRaw = await db.forum_posts.where('authorId').equals(forumActiveAccountId).toArray();
    // 修复 ID 碰撞：排除 NPC 帖子（NPC ID 可能与 User ID 数值相同）
    const userPosts = [];
    for (const p of userPostsRaw) {
      const isNpc = await db.forum_npc_accounts.get(p.authorId);
      if (!isNpc) userPosts.push(p);
    }
    userPosts.sort((a,b) => b.createdAt - a.createdAt);
    const recentPostsText = userPosts.slice(0, 2).map(p => p.content).join("\n");

    const follows = await db.forum_follows.where('followerId').equals(forumActiveAccountId).toArray();
    let knownNpcNicknames = [];
    for (let f of follows) {
      const npc = await db.forum_npc_accounts.get(f.followeeId);
      if (npc) knownNpcNicknames.push(npc.nickname);
    }

    const userPrompt = `你当前正运行着匿名交互私信探测器。
当前登录的用户是：${userAccount ? userAccount.nickname : "匿名者"}
用户的个人底料：${userSetting}
用户最近发表过的论坛动态：${recentPostsText || "无"}

请帮我生成 5 到 7 条【外部发送给当前用户的 incoming 主动私信】。发送者组成如下：
- 约 40% 比例是已关注熟人，请从本熟人集中挑选：[${knownNpcNicknames.join(", ") || "暂无关注熟人"}]。若为空则可虚构你认为对该用户生活轨迹感兴趣的角色。
- 约 60% 比例是【完全不认识的陌生NPC路人】。请为其分配极具网感特色、推特/小红书/贴吧质感的路人昵称。

每一条私信内容长度约 20 到 45 字。
【目的与社交动机规则】：
每一条私信必须具备强烈、真实的现实网民发起意图（例如：针对用户发表的某篇动态来八卦打听、安慰开导、约稿合作、观点不合前来开喷键盘对线、有偿求助、或者试图约Ta去某个地方等）。
绝不要输出“哈哈哈我来私信你”、“hhh无聊来找你”这种毫无目的、破坏真实活人网感的产品空话。

请必须且只能返回如下格式的标准 JSON 数组，严禁带有 Markdown 语法标识符：
[
  {
    "senderNickname": "发送者昵称",
    "isStranger": true, 
    "content": "目标目的明确、活人网感拉满、极富性格纠葛的私信发起文案"
  }
]`;

    const aiRes = await forumCallAI(systemPrompt, userPrompt);
    let dmList = [];
    try {
      dmList = JSON.parse(aiRes);
    } catch(err) {
      dmList = JSON.parse(aiRes.replace(/,\s*([\]}])/g, '$1'));
    }

    const currentUser = await db.forum_accounts.get(forumActiveAccountId);
    const userNick = currentUser ? currentUser.nickname : "";

    for (let item of dmList) {
      // 安全主权防御拦截：禁止私信列表出现来自 User 本人昵称的私信，确保私信永远是别人发给你的 [3]
      if (userNick && item.senderNickname === userNick) {
        console.log(`[主权防火墙] 拦截到私信发送人混淆，已放弃生成来自 User 名字的私信 [3]`);
        continue;
      }

      let npc = await db.forum_npc_accounts.where('nickname').equals(item.senderNickname).first();
      // 如果是陌生路人且尚未入库，则自动注册为背景 NPC 小号
      if (!npc) {
        // 直接绑定轻快、多色、背景柔和的炫彩姓名头像
        const colorfulAvatarUrl = forumGenerateColorfulAvatar(item.senderNickname);
        const newId = await db.forum_npc_accounts.add({
          charId: 0,
          nickname: item.senderNickname,
          avatar: colorfulAvatarUrl,
          postFrequency: "禁用自发",
          postPreference: item.isStranger ? "陌生路人" : "潜水熟人"
        });
        npc = await db.forum_npc_accounts.get(newId);
      }

      // 获取或自动开辟会话房间 (使用纯数字 ID 进行会话关联)
      let conv = await db.forum_conversations.filter(c => 
        (Number(c.user1Id) === Number(forumActiveAccountId) && Number(c.user2Id) === Number(npc.id)) ||
        (Number(c.user1Id) === Number(npc.id) && Number(c.user2Id) === Number(forumActiveAccountId))
      ).first();

      if (!conv) {
        const cid = await db.forum_conversations.add({
          user1Id: forumActiveAccountId,
          user2Id: npc.id,
          lastMessageTime: Date.now() - Math.random() * 20000
        });
        conv = await db.forum_conversations.get(cid);
      }

      // 将陌生路人发出的私信投递至消息历史库
      await db.forum_messages.add({
        conversationId: conv.id,
        senderId: npc.id, // NPC ID 直接作为数字保存，杜绝方向颠倒
        content: item.content,
        contentType: 'text',
        createdAt: Date.now() - Math.random() * 5000
      });

      // 更新最后一条消息的时间状态
      await db.forum_conversations.update(conv.id, { lastMessageTime: Date.now() });
    }

    showToast(`成功同步 ${dmList.length} 条来自陌生路人及好友的心流私信！`);

  } catch(e) {
    console.error(e);
    showToast("拉取私信对白失败，请检查网络和 API 配置");
  }

  // 强行渲染为“私信”列表子页签
  forumMessagesSubTab = 'chat';
  const subTabs = document.querySelectorAll("#forum-tab-messages .sub-tab");
  subTabs.forEach(t => t.classList.remove("active"));
  subTabs.forEach(t => {
    if (t.innerText === "私信") t.classList.add("active");
  });

  await forumLoadMessagesTab();
}

function forumStartNpcCruiseTimer() {
  // 废除定时器
}