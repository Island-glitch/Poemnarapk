/**
 * app_forum_messages.js - 论坛私信通讯、双签通讯录及 NPC 拟真私信应答层
 * 封装推特极简聊天、气泡双击重构工具（删除、编辑、Reroll重来、多选）以及加号多媒体双向转账与闪屏自愈
 */

let forumMessagesSubTab = 'chat';
let activeForumConvId = null;
let forumSelectedMsgId = null;
let forumSelectedConvId = null;
let forumMultiSelectMode = false;
let forumSelectedMsgIds = new Set();

function forumSwitchMessagesSubTab(tab) {
  forumMessagesSubTab = tab;
  const subTabs = document.querySelectorAll("#forum-tab-messages .sub-tab");
  subTabs.forEach(t => t.classList.remove("active"));
  
  const subTabMap = { chat: "私信", follow: "关注" };
  subTabs.forEach(t => {
    if (t.innerText === subTabMap[tab]) t.classList.add("active");
  });

  forumLoadMessagesTab();
}

async function forumLoadMessagesTab() {
  const chatList = document.getElementById("forum-conversations-list");
  const followList = document.getElementById("forum-follows-list");

  if (forumMessagesSubTab === 'chat') {
    chatList.classList.add("active");
    followList.classList.remove("active");
    await forumRenderConversations();
  } else {
    chatList.classList.remove("active");
    followList.classList.add("active");
    await forumRenderFollows();
  }
}

// === 20. 浅色、多色姓名首字炫彩头像生成器 (无灰色占位，视觉清爽高级) ===
function forumGenerateColorfulAvatar(nickname) {
  const name = nickname || "匿";
  const colors = [
    { bg: "#fee2e2", text: "#991b1b" }, // 马卡龙红
    { bg: "#fef3c7", text: "#92400e" }, // 马卡龙黄
    { bg: "#d1fae5", text: "#065f46" }, // 马卡龙绿
    { bg: "#dbeafe", text: "#1e40af" }, // 马卡龙蓝
    { bg: "#f3e8ff", text: "#6b21a8" }, // 马卡龙紫
    { bg: "#fae8ff", text: "#86198f" }, // 马卡龙粉
    { bg: "#e0f2fe", text: "#0369a1" }  // 天空蓝
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  const choice = colors[index];
  const firstChar = name.charAt(0);
  return `data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><rect width='100' height='100' fill='${encodeURIComponent(choice.bg)}'/><text x='50' y='55' font-family='sans-serif' font-size='44' font-weight='800' fill='${encodeURIComponent(choice.text)}' text-anchor='middle' dominant-baseline='middle'>${encodeURIComponent(firstChar)}</text></svg>`;
}

async function forumRenderConversations() {
  const container = document.getElementById("forum-conversations-list");
  if (!container) return;

  const conversations = await db.forum_conversations
    .filter(c => Number(c.user1Id) === Number(forumActiveAccountId))
    .toArray();

  conversations.sort((a,b) => b.lastMessageTime - a.lastMessageTime);

  if (conversations.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">暂无私信往来</p>`;
    return;
  }

  // 内存片段渲染，规避频繁重排带来的闪烁
  const fragment = document.createDocumentFragment();

  for (let c of conversations) {
    const peerId = Number(c.user2Id); // 熟人 NPC ID 永远绑定在 user2Id 下，杜绝任何碰撞
    const peer = await db.forum_npc_accounts.get(peerId);
    if (!peer) continue;

    const messages = await db.forum_messages.where('conversationId').equals(c.id).toArray();
    const lastMsg = messages.sort((a,b) => b.createdAt - a.createdAt)[0];
    const previewText = lastMsg ? (lastMsg.contentType === 'text' ? lastMsg.content : '[多媒体消息]') : "无私信记录";

    const div = document.createElement("div");
    div.className = "forum-msg-chat-item";
    div.onclick = () => forumPushLayer('chat-room', c.id);
    
    const avatarUrl = peer.avatar || forumGenerateColorfulAvatar(peer.nickname);

    div.innerHTML = `
      <img src="${avatarUrl}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
      <div class="forum-msg-chat-info">
        <div class="forum-msg-chat-title-row">
          <span class="forum-msg-chat-name">${escapeHtml(peer.nickname)}</span>
          <span class="forum-msg-chat-time">${new Date(c.lastMessageTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="forum-msg-chat-preview">${escapeHtml(previewText)}</div>
      </div>
    `;
    fragment.appendChild(div);
  }

  // 单次上屏，根治闪动
  container.innerHTML = "";
  container.appendChild(fragment);
}

async function forumRenderFollows() {
  const container = document.getElementById("forum-follows-list");
  if (!container) return;
  container.innerHTML = "";

  // 强制转换为 Number 进行匹配，解决由于 ActiveAccountId 类型不同导致通讯录不显示的物理缺陷
  const follows = await db.forum_follows.where('followerId').equals(Number(forumActiveAccountId)).toArray();
  if (follows.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">通讯录空旷，快去主页关注有共鸣的角色吧</p>`;
    return;
  }

  // 预装全部 NPC 用于内存匹配
  const allNpcs = await db.forum_npc_accounts.toArray();
  const fragment = document.createDocumentFragment();

  for (let f of follows) {
    const npc = allNpcs.find(n => n.id === f.followeeId);
    if (!npc) continue;

    const div = document.createElement("div");
    div.className = "forum-msg-chat-item";
    div.onclick = () => forumStartPrivateChat(npc.id);
    
    const avatarUrl = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);

    div.innerHTML = `
      <img src="${avatarUrl}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">
      <div class="forum-msg-chat-info" style="margin-left:12px;">
        <span class="forum-msg-chat-name">${escapeHtml(npc.nickname)}</span>
      </div>
    `;
    fragment.appendChild(div);
  }

  // 同步交换上屏，解决私信-关注页签返回时的闪变缺陷
  container.innerHTML = "";
  container.appendChild(fragment);
}

async function forumStartPrivateChat(peerNpcId) {
  const existing = await db.forum_conversations.where({
    user1Id: Number(forumActiveAccountId),
    user2Id: Number(peerNpcId)
  }).first();

  if (existing) {
    forumPushLayer('chat-room', existing.id);
  } else {
    // 强制转换为 Number 保存，User 永远为 user1Id，NPC 永远为 user2Id
    const newId = await db.forum_conversations.add({
      user1Id: Number(forumActiveAccountId),
      user2Id: Number(peerNpcId),
      lastMessageTime: Date.now()
    });
    forumPushLayer('chat-room', newId);
  }
}

// === 14. 私信气泡对话房间 (增加了 bottom: 80px 物理安全区 + 物理级联多选底栏) ===
function forumGetChatRoomTemplate() {
  return `
    <header class="win-header" style="background-color: #ffffff; border-bottom: 1px solid #eff3f4;">
      <button class="btn-icon" onclick="forumPopLayer()">
        <svg viewBox="0 0 24 24" style="color: #0f1419;"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <h3 id="forum-chat-room-title" style="color: #0f1419; font-weight: 800; font-size: 16px;">私信</h3>
      <div style="width:40px;"></div>
    </header>
    
    <!-- 通过 padding-bottom 注入 80px 底部安全区，杜绝最新私信气泡被键盘和输入底栏盖住的缺陷 -->
    <div class="win-body" style="padding: 16px 16px 80px 16px; overflow-y: auto; background-color: #ffffff; display:flex; flex-direction:column; gap:14px; height: calc(100% - 110px);" id="forum-chat-messages-flow"></div>
    
    <div class="dialog-input-container" style="background-color: #ffffff; border-top: 1px solid #eff3f4; position: absolute; bottom: 0; left: 0; width: 100%; box-sizing: border-box; padding: 10px 16px; display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between !important; gap: 8px !important; z-index: 100; height: 58px; flex-wrap: nowrap !important;">
      
      <!-- 加号辅助功能按钮 -->
      <button class="btn-icon" id="forum-chat-plus-btn" onclick="forumOpenPlusMenu()" style="width:36px; height:36px; border-radius:50%; background:#f7f9f9; color:#0f1419; display:flex; align-items:center; justify-content:center; border:1px solid #eff3f4; cursor:pointer;" title="发送多媒体与转账">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>

      <input type="text" id="forum-chat-input" placeholder="输入私信对白..." style="flex: 1 !important; height: 38px !important; border: 1px solid #eff3f4 !important; border-radius: 20px !important; padding: 0 16px !important; font-size: 14px !important; outline: none !important; background-color: #f7f9f9 !important; color: #0f1419 !important; min-width: 0 !important; margin: 0 !important; box-sizing: border-box !important;">
      
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

    <!-- 浮动式级联多选操作栏，完全遮盖输入框保证时序隔离 -->
    <div id="forum-multi-select-bar" style="display: none; background: #fff1f2; border-top: 1px solid #fecdd3; position: absolute; bottom: 0; left: 0; width: 100%; height: 58px; box-sizing: border-box; padding: 10px 16px; align-items: center; justify-content: space-between; gap: 8px; z-index: 101;">
      <span style="font-size: 13px; font-weight: 700; color: #ef4444; font-family: sans-serif;">已选中 <span id="forum-select-count" style="font-weight:900;">0</span> 条时空私信</span>
      <div style="display: flex; gap: 8px; flex-shrink: 0;">
        <button onclick="forumBatchDeleteMsgs()" style="height: 38px; border-radius: 19px; font-size: 12.5px; padding: 0 16px; background-color: #ef4444; border: none; color: #fff; cursor: pointer; font-weight: 700;">删除选中</button>
        <button onclick="forumExitMultiSelect()" style="height: 38px; border-radius: 19px; font-size: 12.5px; padding: 0 16px; border: 1px solid #e2e8f0; background: #ffffff; color: #334155; cursor: pointer; font-weight: 700;">取消</button>
      </div>
    </div>

    <!-- 双击气泡唤醒管理工具弹层 -->
    <div id="forum-chat-context-overlay" class="modal-overlay" style="z-index: 2000; align-items: center; justify-content: center; display: none;" onclick="forumCloseContextModal()">
      <div class="modal" style="max-width: 280px; padding: 16px; border-radius: 12px; background: #ffffff;" onclick="event.stopPropagation()">
        <h4 style="margin: 0 0 16px 0; text-align: center; font-size: 14px; font-weight: 700; color: #0f1419;">时空私信推演工具</h4>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <button class="btn btn-outline" onclick="forumContextEditMsg()" style="width: 100%; padding: 10px; font-size: 13px;">✏️ 编辑私信内容</button>
          <button class="btn btn-outline" onclick="forumContextRerollMsg()" style="width: 100%; padding: 10px; font-size: 13px; color: #1d9bf0;">🔄 重新生成 (Reroll)</button>
          <button class="btn btn-danger-outline" onclick="forumContextDeleteMsg()" style="width: 100%; padding: 10px; font-size: 13px; color: #ef4444;">🗑️ 删除此条记录</button>
          <button class="btn btn-outline" onclick="forumContextMultiSelect()" style="width: 100%; padding: 10px; font-size: 13px;">👁️ 开启级联多选</button>
          <button class="btn btn-outline" onclick="forumCloseContextModal()" style="width: 100%; padding: 10px; font-size: 13px; background: #f7f9f9; border-color: #eff3f4;">取消</button>
        </div>
      </div>
    </div>

    <!-- 加号面板选项弹层 -->
    <div id="forum-chat-plus-overlay" class="modal-overlay" style="z-index: 2000; align-items: center; justify-content: center; display: none;" onclick="forumClosePlusMenu()">
      <div class="modal" style="max-width: 280px; padding: 16px; border-radius: 12px; background: #ffffff;" onclick="event.stopPropagation()">
        <h4 style="margin: 0 0 16px 0; text-align: center; font-size: 14px; font-weight: 700; color: #0f1419;">多维模拟发送栏</h4>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <button class="btn btn-outline" onclick="forumSendVoiceMsg()" style="width: 100%; padding: 10px; font-size: 13px;">🎤 发送语音消息</button>
          <button class="btn btn-outline" onclick="forumSendImageMsg()" style="width: 100%; padding: 10px; font-size: 13px;">🖼️ 发送图片画白</button>
          <button class="btn btn-outline" onclick="forumSendTransferMsg()" style="width: 100%; padding: 10px; font-size: 13px; color: #e11d48; border-color: #fecdd3; background:#fff1f2;">💰 发起有偿转账</button>
          <button class="btn btn-outline" onclick="forumClosePlusMenu()" style="width: 100%; padding: 10px; font-size: 13px; background: #f7f9f9; border-color: #eff3f4;">取消</button>
        </div>
      </div>
    </div>
  `;
}

async function forumInitChatRoomPage(convId) {
  activeForumConvId = convId;
  const conv = await db.forum_conversations.get(convId);
  if (!conv) return;

  const peerId = Number(conv.user2Id); // 熟人 NPC ID 永远是 user2Id
  const peer = await db.forum_npc_accounts.get(peerId);
  if (!peer) return;

  document.getElementById("forum-chat-room-title").innerText = peer.nickname;
  await forumLoadPrivateMessages();

  const sendBtn = document.getElementById("forum-chat-send-btn");
  const aiBtn = document.getElementById("forum-chat-ai-btn");
  const inputEl = document.getElementById("forum-chat-input");

  if (sendBtn && inputEl) {
    sendBtn.onclick = async () => {
      const text = inputEl.value.trim();
      if (!text) return;

      await db.forum_messages.add({
        conversationId: convId,
        senderId: Number(forumActiveAccountId), 
        isNpc: false, // 标记为玩家本身
        content: text,
        contentType: 'text',
        createdAt: Date.now()
      });

      await db.forum_conversations.update(convId, { lastMessageTime: Date.now() });

      inputEl.value = "";
      await forumLoadPrivateMessages();
    };
  }

  if (aiBtn) {
    aiBtn.onclick = async () => {
      aiBtn.disabled = true;
      showToast("正在请求分身同步心流回复...");
      await forumTriggerNpcDMReply(convId, peerId);
      aiBtn.disabled = false;
    };
  }
}

// === 21. 超强宽限、高容噪、[分分]第一优先级、标点硬切分编译器 ===
function forumParseMessageToCard(content, isSelf, peerNickname) {
  const text = content || "";
  
  // 规范化多模中括号和标点符号，防止大模型抽风输入全角符号
  let normalized = text.replace(/［/g, "[").replace(/］/g, "]").replace(/【/g, "[").replace(/】/g, "]");
  normalized = normalized.replace(/（/g, "(").replace(/）/g, ")");

  // 1. 正则编译：[语音: 语音文字内容 (时长秒)] (支持括号前带有自由宽限空格)
  const voiceRegex = /\[语音\s*[\s：:]\s*([^\]\(\)]+)\s*(?:\(\s*(\d+)\s*\))?\s*\]/i;
  const voiceMatch = normalized.match(voiceRegex);
  if (voiceMatch) {
    const voiceText = voiceMatch[1].trim();
    const duration = voiceMatch[2] || Math.min(60, Math.max(3, Math.floor(voiceText.length * 0.4)));
    return `
      <div class="forum-voice-card" style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 18px; ${isSelf ? 'background-color: #95ec69; color: #191919;' : 'background-color: #eff3f4; color: #0f1419;'} min-width: 140px; cursor: pointer;" onclick="showToast('播放时空语音：&quot;${escapeHtml(voiceText)}&quot;')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="transform: ${isSelf ? 'rotate(180deg)' : 'none'};"><path d="M12 3a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm6 10a6.005 6.005 0 0 1-5 5.917V21h-2v-2.083A6.005 6.005 0 0 1 6 13h2a4 4 0 0 0 8 0h2z"/></svg>
        <span style="font-size: 14px; font-weight: 700; flex: 1;">${duration}"</span>
        <span style="font-size: 10.5px; opacity: 0.65;">时空语音</span>
      </div>
    `;
  }

  // 2. 正则编译：[图片: 画面描述] (支持自由宽限空格)
  const imgRegex = /\[图片\s*[\s：:]\s*([^\]]+)\s*\]/i;
  const imgMatch = normalized.match(imgRegex);
  if (imgMatch) {
    const imgDesc = imgMatch[1].trim();
    return `
      <div class="forum-image-card" style="border: 1px solid #eff3f4; border-radius: 16px; overflow: hidden; max-width: 240px; background: linear-gradient(135deg, #f3e8ff 0%, #e0f2fe 100%); cursor: pointer;" onclick="showToast('大图预览：&quot;${escapeHtml(imgDesc)}&quot;')">
        <div style="height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #1d9bf0; gap: 8px; border-bottom: 1px solid #eff3f4; background: rgba(255,255,255,0.45);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 5H5l3.5-4.5z"/></svg>
          <span style="font-size: 11px; font-weight: 700; opacity: 0.85;">时空模拟图卡</span>
        </div>
        <div style="padding: 10px 12px; background: #ffffff;">
          <p style="margin: 0; font-size: 12.5px; line-height: 1.4; color: #334155; text-align: justify;">${escapeHtml(imgDesc)}</p>
        </div>
      </div>
    `;
  }

  // 3. 正则编译：[转账: 金额 (留言)] (针对 optional 括注留言和中英文空格进行超级容错)
  const txRegex = /\[转账\s*[\s：:]\s*([\d\.]+)\s*(?:\(\s*([^\]\)]+)\s*\))?\s*\]/i;
  const txMatch = normalized.match(txRegex);
  if (txMatch) {
    const amount = Number(txMatch[1]).toFixed(2);
    const remark = txMatch[2] || "有偿转账";
    return `
      <div class="forum-transfer-card" style="border-radius: 12px; overflow: hidden; width: 220px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); background: #ffffff; cursor: pointer; border: 1px solid #f3d8a7;" onclick="forumReceiveNPCInChat('${amount}')">
        <div style="background: #fa9e3b; padding: 12px; display: flex; align-items: center; gap: 12px; color: #ffffff;">
          <div style="width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="7" y1="15" x2="7.01" y2="15"/></svg>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px; flex: 1;">
            <span style="font-size: 13.5px; font-weight: 700;">¥ ${amount}</span>
            <span style="font-size: 10.5px; opacity: 0.85;">${escapeHtml(remark)}</span>
          </div>
        </div>
        <div style="padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8; background: #fffcf8;">
          <span>${isSelf ? `转账给 ${escapeHtml(peerNickname)}` : '等待你收款'}</span>
          <span style="color: #fa9e3b; font-weight: 700;">${isSelf ? '已发出' : '立即收款'}</span>
        </div>
      </div>
    `;
  }

  // 4. 容灾降级：兼容微信支付系统通知
  if (text.includes("💰 [有偿转账]") || text.includes("💰 [对方已收款]") || text.includes("💰 [对方发起回款]")) {
    const isRed = text.includes("对方已收款") || text.includes("对方发起回款") || text.includes("已收款");
    return `
      <div style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 18px; background-color: ${isRed ? '#feebd0' : '#fff1f2'}; color: ${isRed ? '#b45309' : '#e11d48'}; font-weight: 700; font-size: 13.5px; border: 1px solid ${isRed ? '#fde68a' : '#fecdd3'};">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }

  // 5. 降级：正常推特对话文本
  return `
    <div style="padding: 10px 14px; font-size: 14px; line-height: 1.4; max-width: 70%; word-break: break-all; text-align: justify; cursor: pointer; user-select: none; ${isSelf ? 'background-color: #1d9bf0; color: #ffffff; border-radius: 18px 18px 4px 18px;' : 'background-color: #eff3f4; color: #0f1419; border-radius: 18px 18px 18px 4px;'}">
      ${escapeHtml(text)}
    </div>
  `;
}

// 模拟向玩家钱包入账
function forumReceiveNPCInChat(amount) {
  showToast(`收取时空转账成功：¥ ${Number(amount).toFixed(2)} 元！资金已并入系统钱包`);
}

async function forumLoadPrivateMessages() {
  const container = document.getElementById("forum-chat-messages-flow");
  if (!container) return;

  // 先拉取数据库私信列表，彻底解决退出/发送时由于未阻塞产生的白屏闪动
  const messages = await db.forum_messages.where('conversationId').equals(activeForumConvId).sortBy('createdAt');
  
  const currentAcc = await db.forum_accounts.get(forumActiveAccountId);
  const conv = await db.forum_conversations.get(activeForumConvId);
  const peerId = Number(conv.user2Id);
  const peer = await db.forum_npc_accounts.get(peerId);

  const fragment = document.createDocumentFragment();
  messages.forEach(m => {
    // 基于 isNpc 标识防主客体碰撞
    const isSelf = !m.isNpc && Number(m.senderId) === Number(forumActiveAccountId);
    const avatar = isSelf ? (currentAcc.avatar || forumGenerateColorfulAvatar(currentAcc.nickname)) : (peer.avatar || forumGenerateColorfulAvatar(peer.nickname));

    const row = document.createElement("div");
    row.style.cssText = `display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-end; ${isSelf ? 'flex-direction: row-reverse; justify-content: flex-start;' : 'flex-direction: row; justify-content: flex-start;'}`;

    if (forumMultiSelectMode) {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.style.margin = "0 8px 12px 8px";
      check.checked = forumSelectedMsgIds.has(m.id);
      check.onchange = () => {
        if (check.checked) forumSelectedMsgIds.add(m.id);
        else forumSelectedMsgIds.delete(m.id);
        // 实时同步更新多选计数器 DOM 属性，达成物理上屏 [1]
        const countEl = document.getElementById("forum-select-count");
        if (countEl) countEl.innerText = forumSelectedMsgIds.size;
      };
      row.appendChild(check);
    }

    const avatarImg = document.createElement("img");
    avatarImg.src = avatar;
    avatarImg.style.cssText = "width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; cursor: pointer;";
    avatarImg.onclick = () => {
      // 明确传入身份类型，避免 ID 碰撞导致 user 主页被 NPC 拦截
      if (isSelf) {
        forumPushLayer('profile-view', { id: Number(forumActiveAccountId), isNpc: false });
      } else {
        forumPushLayer('profile-view', { id: Number(peer.id), isNpc: true });
      }
    };

    // 编译微信/推特多媒体智能交互卡片 
    const contentHtml = forumParseMessageToCard(m.content, isSelf, peer.nickname);

    const textWrapper = document.createElement("div");
    textWrapper.style.cssText = "display:contents;";
    textWrapper.innerHTML = contentHtml;

    row.appendChild(avatarImg);
    row.appendChild(textWrapper);

    // 双击气泡唤醒推演工具
    row.ondblclick = (e) => {
      e.stopPropagation();
      forumSelectedMsgId = m.id;
      forumSelectedConvId = activeForumConvId;
      forumOpenContextModal();
    };

    fragment.appendChild(row);
  });

  // 同步重绘，自愈闪烁
  container.innerHTML = "";
  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
}

// === 23. 高性能多模私信对白分发切片器 (多气泡对齐、[分分]第一优先级，标点硬分句底牌) ===
function splitAiResponse(responseText) {
  const text = responseText.trim();
  if (!text) return [];

  // 规范化大模型输出，防止大模型抽风全英文中括号
  let normalized = text.replace(/［/g, "[").replace(/］/g, "]").replace(/【/g, "[").replace(/】/g, "]");
  normalized = normalized.replace(/（/g, "(").replace(/）/g, ")");

  // 1. 第一优先级：优先检测并执行大模型主动划分的 [分分] 分气泡标识符 [2]
  if (normalized.includes("[分分]")) {
    let chunks = normalized.split(/\[分分\]/).map(c => c.trim()).filter(Boolean);
    let finalChunks = [];
    for (let chunk of chunks) {
      // 在每一个分句中，如果包含多媒体指令，我们将其提取成独立气泡消息，杜绝跟普通文本混在一起被截断
      const regex = /(\[[^\]]+\])/g;
      const parts = chunk.split(regex).map(p => p.trim()).filter(Boolean);
      finalChunks.push(...parts);
    }
    return finalChunks.filter(Boolean);
  }

  // 2. 第二优先级：如果大模型没有使用 [分分]，则自适应硬性切分多媒体卡片和标点
  const regex = /(\[[^\]]+\])/g;
  const parts = normalized.split(regex).map(p => p.trim()).filter(Boolean);
  
  let finalChunks = [];
  for (let part of parts) {
    if (part.startsWith("[") && part.endsWith("]")) {
      finalChunks.push(part);
    } else {
      // 依据中英文标点、惊叹号等进行硬性拆分
      let subChunks = part.split(/[\n。！!？?；;]+/).map(c => c.trim()).filter(Boolean);
      
      // 若只有一句话，尝试在逗号处执行第二阶段强切
      if (subChunks.length === 1) {
        if (subChunks[0].includes("，")) {
          const commaChunks = subChunks[0].split(/，+/).map(c => c.trim()).filter(Boolean);
          if (commaChunks.length >= 2) {
            subChunks = [commaChunks[0] + "，", commaChunks.slice(1).join("，")];
          }
        } else if (subChunks[0].includes(",")) {
          const commaChunks = subChunks[0].split(/,+/).map(c => c.trim()).filter(Boolean);
          if (commaChunks.length >= 2) {
            subChunks = [commaChunks[0] + ",", commaChunks.slice(1).join(",")];
          }
        }
      }
      finalChunks.push(...subChunks);
    }
  }

  // 3. 强制保底：若仍只有1段长文本，强制中折
  if (finalChunks.length === 1 && !finalChunks[0].startsWith("[")) {
    const rawStr = finalChunks[0];
    if (rawStr.length > 15) {
      const half = Math.floor(rawStr.length / 2);
      finalChunks = [rawStr.substring(0, half), rawStr.substring(half)];
    }
  }

  return finalChunks.filter(Boolean);
}

// === 15. NPC 性格化私信对白自动生成 (深度阅读对话上下文 + 零 OOC 严苛人设规则约束) ===
async function forumTriggerNpcDMReply(convId, npcId) {
  try {
    const npc = await db.forum_npc_accounts.get(npcId);
    const char = npc.charId ? await db.archives.get(npc.charId) : null;
    const systemPrompt = await buildForumSystemPrompt(forumActiveAccountId);

    const userAccount = await db.forum_accounts.get(forumActiveAccountId);
    const userSetting = userAccount ? (userAccount.setting || "暂无特别设定") : "暂无";
    
    // 实时查询当前 user 最近发表的动态（修复 ID 碰撞：排除 NPC 帖子）
    const userPostsRaw = await db.forum_posts.where('authorId').equals(forumActiveAccountId).toArray();
    const userPosts = [];
    for (const p of userPostsRaw) {
      const isNpc = await db.forum_npc_accounts.get(p.authorId);
      if (!isNpc) userPosts.push(p);
    }
    userPosts.sort((a,b) => b.createdAt - a.createdAt);
    const recentPosts = userPosts.slice(0, 3).map(p => `【标题】:${p.title} 【内容】:${p.content}`).join("\n");

    const msgs = await db.forum_messages.where('conversationId').equals(convId).sortBy('createdAt');
    
    // 首序载入机制：永久加载最开头的 20 条消息，保留扮演初衷契机；结合最后 20 条消息拉满最新聊天语境
    let contextMsgs = [];
    if (msgs.length <= 40) {
      contextMsgs = msgs;
    } else {
      const first20 = msgs.slice(0, 20);
      const last20 = msgs.slice(-20);
      contextMsgs = [...first20, { isSeparator: true }, ...last20];
    }
    
    let historyText = "";
    for (let h of contextMsgs) {
      if (h.isSeparator) {
        historyText += `\n... [时空折叠：此处因超出最大记忆容量，已自动省略中间 ${msgs.length - 40} 条历史私信] ...`;
        continue;
      }
      const senderName = (!h.isNpc && Number(h.senderId) === Number(forumActiveAccountId)) ? "用户" : npc.nickname;
      historyText += `\n[${senderName}]: ${h.content}`;
    }

    const userPrompt = `你现在必须完全代入NPC角色：${npc.nickname}

【绝对人设硬性底线（绝对不准脱离人设/不准OOC）】：
官方背景人设设定底牌：${char ? char.persona : "暂无"}
你必须以该角色原有的行事作风、心理防线、对用户的隐藏执念或防范心理，进行100%忠诚度的扮演应答。

【上下文私信记录（必须深度阅读并紧密跟手呼应）】：
以下是你们双方当前的最近对白流：
${historyText || "无历史对话"}

【对话用户的个人背景及动态】：
- 用户底料设定：${userSetting}
- 用户最近发帖动态：
${recentPosts || "无最近发帖"}

请仔细研读上述【上下文私信记录】，根据对方上一句说话的具体意思，给出逻辑极其顺承、情感逻辑极其连贯、语气完全符合你官方背景设定的私信回应。

【NPC 多气泡连发指令（极其重要）】：
为了模拟真实的微信聊天习惯，在本次私信应答中，你必须发出 2 条或以上的多段短消息气泡。
请在气泡与气泡之间用 [分分] 隔开（例如：你今天过得怎么样？ [分分] 要注意保暖啊 [分分] [语音:早点休息(5)] ）。你可以在你的回复中自由穿插 [分分] 来指示客户端进行气泡切割！

【NPC 多媒体交互权限指令】：
如果你需要在对白中：
1. 回应转账，请输出类似 [对方已收款] 消息，或者回赠转账：[转账:金额(回款言辞)] (例如 [转账:20(给你买糖)])。
2. 发送图片：格式为 [图片:画面描述] (例如 [图片:一张寂静工厂的抓拍])。
3. 发送语音：格式为 [语音:语音文案(时长)] (例如 [语音:我想你了(4)])。

你宁可减少一些浮夸的网络黑话，也绝对要100%保全自身人设风骨。写一条 20 到 40 字之间的简短私信回复，不要输出任何 Markdown 块标识或旁白说明。`;

    const aiRes = await forumCallAI(systemPrompt, userPrompt);
    
    // 利用自研切片器切割生成多条微对白
    const chunks = splitAiResponse(aiRes);
    
    // 依次级联落库，时间上给予 100ms 物理拉开，确保按正常时序流畅滚动呈现
    for (let i = 0; i < chunks.length; i++) {
      await db.forum_messages.add({
        conversationId: convId,
        senderId: Number(npcId),
        isNpc: true,
        content: chunks[i],
        contentType: 'text',
        createdAt: Date.now() + i * 100
      });
    }

    await db.forum_conversations.update(convId, { lastMessageTime: Date.now() + chunks.length * 100 });
    
    if (activeForumConvId === convId) {
      await forumLoadPrivateMessages();
    }

  } catch(e) {
    console.error("AI私信回复生成失败:", e);
  }
}

// === 21. 双击管理气泡逻辑实现 ===
function forumOpenContextModal() {
  const modal = document.getElementById("forum-chat-context-overlay");
  if (modal) {
    modal.style.display = "flex";
    setTimeout(() => modal.classList.add("active"), 10);
  }
}

function forumCloseContextModal() {
  const modal = document.getElementById("forum-chat-context-overlay");
  if (modal) {
    modal.classList.remove("active");
    setTimeout(() => modal.style.display = "none", 300);
  }
}

async function forumContextDeleteMsg() {
  if (!forumSelectedMsgId) return;
  await db.forum_messages.delete(forumSelectedMsgId);
  forumCloseContextModal();
  await forumLoadPrivateMessages();
  showToast("私信对白片段已粉碎删除");
}

function forumContextEditMsg() {
  if (!forumSelectedMsgId) return;
  forumCloseContextModal();
  showCustomPrompt("请输入修改后的私信文本", "", async (newText) => {
    if (!newText || !newText.trim()) return;
    await db.forum_messages.update(forumSelectedMsgId, { content: newText.trim() });
    await forumLoadPrivateMessages();
    showToast("私信记录已无损修正");
  });
}

async function forumContextRerollMsg() {
  if (!forumSelectedMsgId || !forumSelectedConvId) return;
  const target = await db.forum_messages.get(forumSelectedMsgId);
  if (!target) return;

  // 1. 读取本条信息之上、最近的一条 User（isNpc === false）消息 [2]
  const prevUserMsg = await db.forum_messages
    .where('conversationId').equals(forumSelectedConvId)
    .filter(m => m.createdAt <= target.createdAt && !m.isNpc)
    .reverse() // 按时间戳降序
    .first();

  let rollbackTime = target.createdAt;
  if (prevUserMsg) {
    // 如果找到了上一条 User 消息，以该 User 消息的时间戳作为回溯分水岭 [2]
    rollbackTime = prevUserMsg.createdAt;
  }

  // 2. 将该 User 消息时间戳之后的所有发言全部粉碎删除，实现级联回溯 [2]
  const toDelete = await db.forum_messages
    .where('conversationId').equals(forumSelectedConvId)
    .filter(m => m.createdAt > rollbackTime)
    .toArray();

  for (let m of toDelete) {
    await db.forum_messages.delete(m.id);
  }

  forumCloseContextModal();
  await forumLoadPrivateMessages();

  // 3. 重新向 API 发起请求，基于回溯后的 User 消息演练新心流 [2]
  const conv = await db.forum_conversations.get(forumSelectedConvId);
  const peerId = Number(conv.user2Id);
  showToast("正在执行时空回溯对白 Reroll...");
  await forumTriggerNpcDMReply(forumSelectedConvId, peerId);
}

function forumContextMultiSelect() {
  forumCloseContextModal();
  forumMultiSelectMode = true;
  forumSelectedMsgIds.clear();
  
  // 激活级联多选悬浮状态栏 [1]
  const bar = document.getElementById("forum-multi-select-bar");
  if (bar) {
    bar.style.display = "flex";
    document.getElementById("forum-select-count").innerText = 0;
  }

  forumLoadPrivateMessages();
  showToast("级联多选已就绪，双击任意处退出");
  
  // 再次双击退出多选
  const flow = document.getElementById("forum-chat-messages-flow");
  if (flow) {
    flow.ondblclick = () => {
      forumExitMultiSelect();
      showToast("多选模式已关闭");
    };
  }
}

// 物理删除多选选中的全部私信记录 [1]
async function forumBatchDeleteMsgs() {
  if (forumSelectedMsgIds.size === 0) {
    showToast("请先在左侧勾选您想要粉碎的私信气泡");
    return;
  }
  showCustomConfirm("确认批量删除", `您确定要彻底粉碎选中的这 ${forumSelectedMsgIds.size} 条私信记录吗？该操作不可撤销。`, async () => {
    for (let id of forumSelectedMsgIds) {
      await db.forum_messages.delete(id);
    }
    showToast("时空私信已成功批量粉碎！");
    forumExitMultiSelect();
  });
}

// 退出多选模式还原输入底栏 [1]
function forumExitMultiSelect() {
  forumMultiSelectMode = false;
  forumSelectedMsgIds.clear();
  const bar = document.getElementById("forum-multi-select-bar");
  if (bar) bar.style.display = "none";
  forumLoadPrivateMessages();
}

// === 22. 加号多媒体面板与转账系统实现 ===
function forumOpenPlusMenu() {
  const modal = document.getElementById("forum-chat-plus-overlay");
  if (modal) {
    modal.style.display = "flex";
    setTimeout(() => modal.classList.add("active"), 10);
  }
}

function forumClosePlusMenu() {
  const modal = document.getElementById("forum-chat-plus-overlay");
  if (modal) {
    modal.classList.remove("active");
    setTimeout(() => modal.style.display = "none", 300);
  }
}

function forumSendVoiceMsg() {
  forumClosePlusMenu();
  showCustomPrompt("请输入您想要发送的模拟语音文字:", "我已经到楼下了，你下来吧...", async (text) => {
    if (!text || !text.trim()) return;
    const duration = Math.min(60, Math.max(3, Math.floor(text.trim().length * 0.4)));
    await db.forum_messages.add({
      conversationId: activeForumConvId,
      senderId: Number(forumActiveAccountId),
      isNpc: false,
      content: `[语音: ${text.trim()} (${duration})]`,
      contentType: 'text',
      createdAt: Date.now()
    });
    await forumLoadPrivateMessages();
  });
}

function forumSendImageMsg() {
  forumClosePlusMenu();
  showCustomPrompt("请输入您想要分享的画面白描描述:", "一张落日熔金的街角抓拍，光影很柔和...", async (text) => {
    if (!text || !text.trim()) return;
    await db.forum_messages.add({
      conversationId: activeForumConvId,
      senderId: Number(forumActiveAccountId),
      isNpc: false,
      content: `[图片: ${text.trim()}]`,
      contentType: 'text',
      createdAt: Date.now()
    });
    await forumLoadPrivateMessages();
  });
}

function forumSendTransferMsg() {
  forumClosePlusMenu();
  showCustomPrompt("请输入发起转账金额 (元):", "100.00", async (amt) => {
    const val = Number(amt);
    if (isNaN(val) || val <= 0) {
      showToast("请输入合规有效的转账金额！");
      return;
    }
    
    // 纯玩家发起，已彻底移除 timeout 自动应答回复
    await db.forum_messages.add({
      conversationId: activeForumConvId,
      senderId: Number(forumActiveAccountId),
      isNpc: false,
      content: `[转账: ${val.toFixed(2)} (有偿转账)]`,
      contentType: 'text',
      createdAt: Date.now()
    });
    await forumLoadPrivateMessages();
  });
}