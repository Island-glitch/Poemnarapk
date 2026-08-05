/**
 * app_forum_posts.js - 主页帖子流、帖子详情、评论渲染、发帖表单与 NPC 自发巡航发帖任务
 */

let forumHomeSubTab = 'recommend';
let activePostDetailId = null;
let activeParentCommentId = 0;
let forumNpcCruiseTimer = null;

function forumSwitchHomeSubTab(tab) {
  forumHomeSubTab = tab;
  const subTabs = document.querySelectorAll("#forum-tab-home .sub-tab");
  subTabs.forEach(t => t.classList.remove("active"));
  
  const subTabMap = { follow: "关注", recommend: "推荐", nearby: "附近" };
  subTabs.forEach(t => {
    if (t.innerText === subTabMap[tab]) t.classList.add("active");
  });

  forumLoadPostsFeed();
}

async function forumLoadPostsFeed() {
  const container = document.getElementById("forum-posts-list");
  if (!container) return;
  
  if (typeof forumInitPullToRefresh === "function") {
    forumInitPullToRefresh();
  }

  let posts = await db.forum_posts.toArray();
  posts.sort((a,b) => b.createdAt - a.createdAt);

  // 反向 Timeline 隔离：找出归属于【其他账户】的 NPC，将其发帖隐藏；公共网民及当前账户的 NPC 帖子予以全面共享 [4]
  const otherNpcs = (await db.forum_npc_accounts.toArray())
    .filter(n => n.userId && Number(n.userId) !== Number(forumActiveAccountId))
    .map(n => n.id);

  posts = posts.filter(p => !otherNpcs.includes(Number(p.authorId)));

  if (forumHomeSubTab === 'follow') {
    const followeeIds = (await db.forum_follows.where('followerId').equals(forumActiveAccountId).toArray()).map(f => f.followeeId);
    posts = posts.filter(p => followeeIds.includes(p.authorId));
  } else if (forumHomeSubTab === 'nearby') {
    posts = posts.filter((_, idx) => idx % 2 === 0);
  }

  if (posts.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:12px; padding:40px 0;">该频道暂无帖子动态</p>`;
    return;
  }

  // 物理检查当前登录 User 是否真实点赞过这些动态 [1]
  const myLikes = (await db.forum_likes.toArray()).filter(l => Number(l.userId) === Number(forumActiveAccountId) && l.targetType === 'post');

  // 使用内存片段拼装，规避返回时的瞬间闪动 [2]
  const fragment = document.createDocumentFragment();

  for (let p of posts) {
    let authorName = "匿名旅人";
    let authorUsername = "unknown";
    let authorAvatar = "";

    // 路人帖子（isPasserby === 1）直接用帖子自带的作者信息，不入库 forum_npc_accounts
    if (p.isPasserby === 1) {
      authorName = p.authorNickname || "匿名路人";
      authorUsername = p.authorUsername || "unknown";
      authorAvatar = p.authorAvatar || forumGenerateColorfulAvatar(authorName);
    } else if (p.isNpc === 1) {
      // char 关联的 NPC 帖子：查 NPC 表获取最新信息，同时兼容帖子自带字段
      const npc = await db.forum_npc_accounts.get(p.authorId);
      if (npc) {
        authorName = npc.nickname;
        authorUsername = `npc_${npc.id}`;
        authorAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
      } else if (p.authorNickname) {
        authorName = p.authorNickname;
        authorUsername = p.authorUsername || "unknown";
        authorAvatar = p.authorAvatar || forumGenerateColorfulAvatar(authorName);
      }
    } else if (p.isNpc === 0) {
      if (Number(p.authorId) === Number(forumActiveAccountId)) {
        const acc = await db.forum_accounts.get(forumActiveAccountId);
        if (acc) {
          authorName = acc.nickname;
          authorUsername = acc.username;
          authorAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
        }
      } else {
        const otherAcc = await db.forum_accounts.get(Number(p.authorId));
        if (otherAcc) {
          authorName = otherAcc.nickname;
          authorUsername = otherAcc.username;
          authorAvatar = otherAcc.avatar || forumGenerateColorfulAvatar(otherAcc.nickname);
        }
      }
    } else {
      // 历史数据 fallback：先查 NPC 表，命中按 NPC；未命中再判 user
      const npc = await db.forum_npc_accounts.get(p.authorId);
      if (npc) {
        authorName = npc.nickname;
        authorUsername = `npc_${npc.id}`;
        authorAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
      } else if (Number(p.authorId) === Number(forumActiveAccountId)) {
        const acc = await db.forum_accounts.get(forumActiveAccountId);
        if (acc) {
          authorName = acc.nickname;
          authorUsername = acc.username;
          authorAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
        }
      } else {
        const otherAcc = await db.forum_accounts.get(Number(p.authorId));
        if (otherAcc) {
          authorName = otherAcc.nickname;
          authorUsername = otherAcc.username;
          authorAvatar = otherAcc.avatar || forumGenerateColorfulAvatar(otherAcc.nickname);
        }
      }
    }

    const card = document.createElement("div");
    card.className = "forum-post-card";
    
    let mediaHtml = "";
    if (p.media) {
      mediaHtml = `
        <div class="forum-post-media-placeholder" onclick="showToast('画面描述：' + this.innerText)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          <span>${escapeHtml(p.media)}</span>
        </div>
      `;
    }

    const isLikedByMe = myLikes.some(l => l.targetId === p.id);
    const timeStr = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="forum-card-header" onclick="forumOpenProfile(${p.authorId}, ${(p.isNpc === 1 || p.isPasserby === 1) ? 'true' : 'false'})">
        <img src="${authorAvatar}" class="avatar-sm" style="object-fit:cover;">
        <div class="forum-author-meta">
          <div class="forum-author-name-row">
            <span class="forum-author-nickname">${escapeHtml(authorName)}</span>
            <svg class="forum-cert-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          </div>
          <span class="forum-author-username">@${escapeHtml(authorUsername)}</span>
        </div>
      </div>
      <h4 class="forum-post-title">${escapeHtml(p.title)}</h4>
      <div class="forum-post-body">${escapeHtml(p.content)}</div>
      ${mediaHtml}
      <div class="forum-card-footer">
        <span>${timeStr} · ${p.views || 0} 查看</span>
      </div>
      <div class="forum-interactive-bar">
        <div class="forum-action-group">
          <button class="forum-action-btn" onclick="forumPushLayer('post-detail', ${p.id})">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
            <span>${p.commentsCount || 0}</span>
          </button>
          <button class="forum-action-btn ${isLikedByMe ? 'active' : ''}" onclick="forumToggleLike(${p.id}, this)">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span>${p.likesCount || 0}</span>
          </button>
        </div>
        <button class="forum-star-btn" onclick="forumTriggerAIInteractions(${p.id}, this)">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          <span>生成互动</span>
        </button>
      </div>
    `;
    fragment.appendChild(card);
  }

  // 同步替换，彻底抹除白屏闪动
  container.innerHTML = "";
  container.appendChild(fragment);
}

// 补齐被意外遗漏的点赞控制器并绑定全局作用域，确保 100% 点击上屏与 liked 物理库同步 [1]
async function forumToggleLike(postId, btn) {
  const isLiked = btn.classList.contains("active");
  const post = await db.forum_posts.get(postId);
  if (!post) return;

  if (isLiked) {
    btn.classList.remove("active");
    const newCount = Math.max(0, (post.likesCount || 0) - 1);
    await db.forum_posts.update(postId, { likesCount: newCount });
    btn.querySelector("span").innerText = newCount;

    // 级联删除真实的 liked 点赞历史记录
    const likeRecord = (await db.forum_likes.toArray()).find(l => Number(l.userId) === Number(forumActiveAccountId) && l.targetId === postId && l.targetType === 'post');
    if (likeRecord) {
      await db.forum_likes.delete(likeRecord.id);
    }
  } else {
    btn.classList.add("active");
    const newCount = (post.likesCount || 0) + 1;
    await db.forum_posts.update(postId, { likesCount: newCount });
    btn.querySelector("span").innerText = newCount;

    // 添加真实的 liked 点赞历史记录 [1]
    await db.forum_likes.add({
      userId: Number(forumActiveAccountId),
      targetId: postId,
      targetType: 'post',
      createdAt: Date.now()
    });
  }
}

// 显式挂载到全局作用域
window.forumToggleLike = forumToggleLike;

// ========== 论坛帖子转发到单聊 ==========
// 弹出角色选择器对话框，选择后将帖子以 forum_post_share 消息类型投递到目标单聊会话
async function forumForwardPostToChat(postId) {
  const post = await db.forum_posts.get(postId);
  if (!post) return;

  // 获取帖子作者信息（路人帖子直接用自带字段，NPC/user 帖子查表）
  let authorName = "匿名成员";
  let authorAvatar = "";
  if (post.isPasserby === 1) {
    authorName = post.authorNickname || "匿名路人";
    authorAvatar = post.authorAvatar || (typeof forumGenerateColorfulAvatar === 'function' ? forumGenerateColorfulAvatar(authorName) : "");
  } else if (post.isNpc === 1) {
    const npc = await db.forum_npc_accounts.get(post.authorId);
    if (npc) {
      authorName = npc.nickname;
      authorAvatar = npc.avatar || (typeof forumGenerateColorfulAvatar === 'function' ? forumGenerateColorfulAvatar(npc.nickname) : "");
    } else if (post.authorNickname) {
      authorName = post.authorNickname;
      authorAvatar = post.authorAvatar || (typeof forumGenerateColorfulAvatar === 'function' ? forumGenerateColorfulAvatar(authorName) : "");
    }
  } else if (post.isNpc === 0) {
    const acc = await db.forum_accounts.get(post.authorId);
    if (acc) {
      authorName = acc.nickname;
      authorAvatar = acc.avatar || (typeof forumGenerateColorfulAvatar === 'function' ? forumGenerateColorfulAvatar(acc.nickname) : "");
    }
  } else {
    // 历史数据 fallback：先查 NPC 表，未命中再查 User 表
    const npc = await db.forum_npc_accounts.get(post.authorId);
    if (npc) {
      authorName = npc.nickname;
      authorAvatar = npc.avatar || (typeof forumGenerateColorfulAvatar === 'function' ? forumGenerateColorfulAvatar(npc.nickname) : "");
    } else {
      const acc = await db.forum_accounts.get(post.authorId);
      if (acc) {
        authorName = acc.nickname;
        authorAvatar = acc.avatar || (typeof forumGenerateColorfulAvatar === 'function' ? forumGenerateColorfulAvatar(acc.nickname) : "");
      }
    }
  }

  // 获取已建立单聊的角色列表
  const activeMeId = localStorage.getItem("active_me_id");
  if (!activeMeId) {
    if (typeof showToast === 'function') showToast("请先到'我的'页面选择我的人设！");
    return;
  }
  const userIdNum = Number(activeMeId);
  const sessions = await db.sessions.where('userId').equals(userIdNum).toArray();
  const chars = [];
  for (let s of sessions) {
    const char = await db.archives.get(s.charId);
    if (char) {
      chars.push({
        id: char.id,
        name: s.customCharName || char.name,
        avatar: s.customCharAvatar || char.avatar,
        remark: char.remark || "已建立会话"
      });
    }
  }

  // 注入转发对话框 CSS（仅一次）
  if (!document.getElementById("forum-forward-css")) {
    const style = document.createElement("style");
    style.id = "forum-forward-css";
    style.textContent = `
      .forum-fwd-mask {
        position: fixed !important; top: 0 !important; left: 0 !important;
        width: 100vw !important; height: 100vh !important;
        z-index: 100010 !important;
        background: rgba(0,0,0,0.5) !important;
        display: flex !important; align-items: center !important; justify-content: center !important;
      }
      .forum-fwd-box {
        background: #fff; border-radius: 14px; padding: 18px;
        width: 320px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0,0,0,0.25);
      }
      .forum-fwd-title { font-size: 14px; font-weight: 700; color: #0f172a; text-align: center; margin-bottom: 12px; }
      .forum-fwd-label { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 6px; }
      .forum-fwd-char-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; margin-bottom: 12px; border: 1.5px solid #e2e8f0; padding: 6px; border-radius: 8px; background: #fbfcfd; }
      .forum-fwd-char-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: all 0.15s; }
      .forum-fwd-char-card:hover { border-color: #93c5fd; }
      .forum-fwd-char-card.selected { background: #f0fdf4; border-color: #86efac; }
      .forum-fwd-textarea { width: 100%; min-height: 60px; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px; font-size: 13px; outline: none; resize: none; box-sizing: border-box; font-family: inherit; }
      .forum-fwd-textarea:focus { border-color: #6366f1; }
      .forum-fwd-actions { display: flex; gap: 10px; margin-top: 12px; }
      .forum-fwd-btn { flex: 1; padding: 10px 0; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
      .forum-fwd-btn-cancel { background: #f1f5f9; color: #64748b; }
      .forum-fwd-btn-cancel:hover { background: #e2e8f0; }
      .forum-fwd-btn-confirm { background: #6366f1; color: #fff; }
      .forum-fwd-btn-confirm:hover { background: #5558e3; }
      .forum-fwd-empty { text-align: center; color: #94a3b8; font-size: 12px; padding: 20px 0; }
    `;
    document.head.appendChild(style);
  }

  // 移除已有的对话框
  const existing = document.querySelector(".forum-fwd-mask");
  if (existing) existing.remove();

  const mask = document.createElement("div");
  mask.className = "forum-fwd-mask";
  let charCardsHtml = "";
  if (chars.length === 0) {
    charCardsHtml = `<div class="forum-fwd-empty">暂无已经建立过单聊的角色</div>`;
  } else {
    charCardsHtml = chars.map(c => `
      <div class="forum-fwd-char-card" data-char-id="${c.id}">
        <img src="${typeof resolveAvatar === 'function' ? resolveAvatar(c.avatar) : c.avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; pointer-events: none;">
        <div style="flex: 1; text-align: left; pointer-events: none;">
          <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${typeof escapeHtml === 'function' ? escapeHtml(c.name) : c.name}</div>
          <div style="font-size: 11px; color: #94a3b8;">${typeof escapeHtml === 'function' ? escapeHtml(c.remark) : c.remark}</div>
        </div>
      </div>
    `).join("");
  }

  mask.innerHTML = `
    <div class="forum-fwd-box">
      <div class="forum-fwd-title">转发帖子到单聊</div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #f8fafc; border-radius: 8px; margin-bottom: 12px;">
        <img src="${authorAvatar || ''}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">
        <div>
          <div style="font-size: 12px; font-weight: 700; color: #1e293b;">${typeof escapeHtml === 'function' ? escapeHtml(post.title) : post.title}</div>
          <div style="font-size: 11px; color: #94a3b8;">@${typeof escapeHtml === 'function' ? escapeHtml(authorName) : authorName}</div>
        </div>
      </div>
      <div class="forum-fwd-label">选择转发到哪个会话：</div>
      <div class="forum-fwd-char-list">${charCardsHtml}</div>
      <textarea class="forum-fwd-textarea" id="forum-fwd-comment" placeholder="说点什么... (可留空)" autocomplete="off"></textarea>
      <div class="forum-fwd-actions">
        <button class="forum-fwd-btn forum-fwd-btn-cancel" id="forum-fwd-cancel">取消</button>
        <button class="forum-fwd-btn forum-fwd-btn-confirm" id="forum-fwd-confirm">转发</button>
      </div>
    </div>
  `;
  document.body.appendChild(mask);

  let selectedCharId = null;
  mask.querySelectorAll(".forum-fwd-char-card").forEach(card => {
    card.onclick = () => {
      mask.querySelectorAll(".forum-fwd-char-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedCharId = Number(card.getAttribute("data-char-id"));
    };
  });

  const close = () => mask.remove();
  mask.querySelector("#forum-fwd-cancel").onclick = close;
  mask.addEventListener("click", (e) => { if (e.target === mask) close(); });

  mask.querySelector("#forum-fwd-confirm").onclick = async () => {
    if (!selectedCharId) {
      if (typeof showToast === 'function') showToast("请选择要转发到的目标单聊角色！");
      return;
    }
    const commentText = mask.querySelector("#forum-fwd-comment").value.trim();

    // 查找或创建与目标角色的 Session
    let session = await db.sessions.where('userId').equals(userIdNum).and(s => s.charId === selectedCharId).first();
    if (!session) {
      const sId = await db.sessions.add({
        userId: userIdNum,
        charId: selectedCharId,
        lastMessageTime: Date.now()
      });
      session = await db.sessions.get(sId);
    }

    const shareData = {
      postId: post.id,
      authorName: authorName,
      title: post.title,
      summary: post.content.substring(0, 50) + (post.content.length > 50 ? "..." : ""),
      commentText: commentText || ""
    };

    await db.messages.add({
      sessionId: session.id,
      senderType: 'user',
      senderId: userIdNum,
      content: JSON.stringify(shareData),
      contentType: 'forum_post_share',
      timestamp: Date.now()
    });

    // 增加帖子转发计数
    await db.forum_posts.update(post.id, { forwardsCount: (post.forwardsCount || 0) + 1 });

    await db.sessions.update(session.id, { lastMessageTime: Date.now() });

    close();
    if (typeof showToast === 'function') showToast("已成功转发帖子到聊天会话！");
    if (typeof closeApp === 'function') closeApp('forum');
    // 显式打开 chat 应用窗口，否则 chat-dialog-panel 会浮在桌面上看不到底下的会话列表
    if (typeof openApp === 'function') openApp('chat');
    if (typeof openWeChatDialog === 'function') openWeChatDialog(session.id);
  };
}
window.forumForwardPostToChat = forumForwardPostToChat;

async function forumInitPostDetailPage(postId) {
  activePostDetailId = postId;
  activeParentCommentId = 0;

  const post = await db.forum_posts.get(postId);
  if (!post) return;

  const detailBox = document.getElementById("forum-post-detail-content");
  const commentsBox = document.getElementById("forum-comments-list");
  const inputEl = document.getElementById("forum-comment-input");
  const submitBtn = document.getElementById("forum-comment-submit-btn");

  if (!detailBox || !commentsBox) return;

  let authorName = "匿名成员";
  let authorAvatar = "";
  let authorUsername = "user";

  // 路人帖子直接用帖子自带的作者信息；NPC/user 帖子查表获取最新信息
  if (post.isPasserby === 1) {
    authorName = post.authorNickname || "匿名路人";
    authorAvatar = post.authorAvatar || forumGenerateColorfulAvatar(authorName);
    authorUsername = post.authorUsername || "unknown";
  } else if (post.isNpc === 1) {
    const npc = await db.forum_npc_accounts.get(post.authorId);
    if (npc) {
      authorName = npc.nickname;
      authorAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
      authorUsername = npc.username || `npc_${npc.id}`;
    } else if (post.authorNickname) {
      authorName = post.authorNickname;
      authorAvatar = post.authorAvatar || forumGenerateColorfulAvatar(authorName);
      authorUsername = post.authorUsername || "unknown";
    }
  } else if (post.isNpc === 0) {
    const acc = await db.forum_accounts.get(post.authorId);
    if (acc) {
      authorName = acc.nickname;
      authorAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
      authorUsername = acc.username;
    }
  } else {
    // 历史数据 fallback：先查 NPC 表，未命中再查 User 表
    const npc = await db.forum_npc_accounts.get(post.authorId);
    if (npc) {
      authorName = npc.nickname;
      authorAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
      authorUsername = npc.username || `npc_${npc.id}`;
    } else {
      const acc = await db.forum_accounts.get(post.authorId);
      if (acc) {
        authorName = acc.nickname;
        authorAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
        authorUsername = acc.username;
      }
    }
  }

  let mediaHtml = "";
  if (post.media) {
    mediaHtml = `
      <div class="forum-post-media-placeholder" style="margin-top:10px;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
        <span>${escapeHtml(post.media)}</span>
      </div>
    `;
  }

  detailBox.innerHTML = `
    <div class="forum-post-card" style="box-shadow:none; border-radius:12px;">
      <div class="forum-card-header" style="cursor:pointer;" onclick="forumOpenProfile(${post.authorId}, ${(post.isNpc === 1 || post.isPasserby === 1) ? 'true' : 'false'})">
        <img src="${authorAvatar || 'data:image/svg+xml;utf8,<svg viewBox=\'0 0 24 24\' xmlns=\'http://www.w3.org/2000/svg\'><circle cx=\'12\' cy=\'12\' r=\'12\' fill=\'%23cbd5e1\'/></svg>'}" class="avatar-sm">
        <div class="forum-author-meta">
          <div class="forum-author-name-row">
            <span class="forum-author-nickname">${escapeHtml(authorName)}</span>
          </div>
          <span class="forum-author-username">@${escapeHtml(authorUsername)}</span>
        </div>
      </div>
      <h4 class="forum-post-title" style="font-size:16px;">${escapeHtml(post.title)}</h4>
      <div class="forum-post-body" style="font-size:14.5px;">${escapeHtml(post.content)}</div>
      ${mediaHtml}
      
      <!-- 帖子详情页互动底栏 (对齐主页，加入点赞跟评与AI互动) -->
      <div class="forum-interactive-bar" style="border-bottom:none; margin-bottom:0;">
        <div class="forum-action-group">
          <button class="forum-action-btn" onclick="forumSetCommentReplyTarget(0, '${escapeHtml(authorName)}')">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
            <span id="forum-detail-comments-count">${post.commentsCount || 0}</span>
          </button>
          <button class="forum-action-btn" onclick="forumToggleLike(${post.id}, this)">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span>${post.likesCount || 0}</span>
          </button>
          <button class="forum-action-btn" onclick="forumForwardPostToChat(${post.id})" title="转发到单聊">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>
            <span>${post.forwardsCount || 0}</span>
          </button>
        </div>
        <button class="forum-star-btn" onclick="forumTriggerAIInteractions(${post.id}, this)">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          <span>生成互动</span>
        </button>
      </div>
    </div>
  `;

  await forumLoadCommentsTree();

  if (submitBtn && inputEl) {
    submitBtn.onclick = async () => {
      const text = inputEl.value.trim();
      if (!text) return;

      await db.forum_comments.add({
        postId: postId,
        parentCommentId: activeParentCommentId,
        authorId: forumActiveAccountId,
        isNpc: 0,
        content: text,
        createdAt: Date.now(),
        likesCount: 0
      });

      const currentPost = await db.forum_posts.get(postId);
      await db.forum_posts.update(postId, { commentsCount: (currentPost.commentsCount || 0) + 1 });

      inputEl.value = "";
      activeParentCommentId = 0;
      inputEl.placeholder = "发布你的回复...";
      await forumLoadCommentsTree();
    };
  }
}

async function forumLoadCommentsTree() {
  const box = document.getElementById("forum-comments-list");
  if (!box) return;
  box.innerHTML = "";

  const allComments = await db.forum_comments.where('postId').equals(activePostDetailId).toArray();
  allComments.sort((a,b) => a.createdAt - a.createdAt);

  const fragment = document.createDocumentFragment();
  
  async function renderNode(parentId, depth = 0) {
    const layerComments = allComments.filter(c => c.parentCommentId === parentId);
    for (let c of layerComments) {
      let cName = "匿名";
      let cAvatar = "";

      // 路人评论直接用评论自带的作者信息；NPC/user 评论查表获取最新信息
      if (c.isPasserby === 1) {
        cName = c.authorNickname || "匿名路人";
        cAvatar = c.authorAvatar || forumGenerateColorfulAvatar(cName);
      } else if (c.isNpc === 1) {
        const cNpc = await db.forum_npc_accounts.get(c.authorId);
        if (cNpc) {
          cName = cNpc.nickname;
          cAvatar = cNpc.avatar || forumGenerateColorfulAvatar(cNpc.nickname);
        } else if (c.authorNickname) {
          cName = c.authorNickname;
          cAvatar = c.authorAvatar || forumGenerateColorfulAvatar(cName);
        }
      } else if (c.isNpc === 0) {
        if (Number(c.authorId) === Number(forumActiveAccountId)) {
          const acc = await db.forum_accounts.get(forumActiveAccountId);
          if (acc) {
            cName = acc.nickname;
            cAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
          }
        } else {
          const otherAcc = await db.forum_accounts.get(c.authorId);
          if (otherAcc) {
            cName = otherAcc.nickname;
            cAvatar = otherAcc.avatar || forumGenerateColorfulAvatar(otherAcc.nickname);
          }
        }
      } else {
        // 历史数据 fallback：先查 NPC 表，命中按 NPC；未命中再判 user
        const cNpc = await db.forum_npc_accounts.get(c.authorId);
        if (cNpc) {
          cName = cNpc.nickname;
          cAvatar = cNpc.avatar || forumGenerateColorfulAvatar(cNpc.nickname);
        } else if (Number(c.authorId) === Number(forumActiveAccountId)) {
          const acc = await db.forum_accounts.get(forumActiveAccountId);
          if (acc) {
            cName = acc.nickname;
            cAvatar = acc.avatar || forumGenerateColorfulAvatar(acc.nickname);
          }
        } else {
          const otherAcc = await db.forum_accounts.get(c.authorId);
          if (otherAcc) {
            cName = otherAcc.nickname;
            cAvatar = otherAcc.avatar || forumGenerateColorfulAvatar(otherAcc.nickname);
          }
        }
      }

      const nodeDiv = document.createElement("div");
      nodeDiv.className = "forum-comment-node";
      nodeDiv.style.marginLeft = `${Math.min(4, depth) * 16}px`;

      nodeDiv.innerHTML = `
        <div style="display:flex; gap:10px; align-items:flex-start;">
          <img src="${cAvatar}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;">
          <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; font-weight:700; color:#334155;">${escapeHtml(cName)}</span>
              <span style="font-size:10px; color:#94a3b8;">${new Date(c.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
            </div>
            <p style="font-size:12.5px; color:#1e293b; margin:0; line-height:1.4;">${escapeHtml(c.content)}</p>
            <div style="display:flex; gap:16px; margin-top:4px;">
              <button class="forum-action-btn" onclick="forumSetCommentReplyTarget(${c.id}, '${escapeHtml(cName)}')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 10 1.6 12.5 5.1C21.5 15 17.5 10 10 9z"/></svg>
                <span>回复</span>
              </button>
            </div>
          </div>
        </div>
      `;
      fragment.appendChild(nodeDiv);
      await renderNode(c.id, depth + 1);
    }
  }

  await renderNode(0);
  box.appendChild(fragment);
}

function forumSetCommentReplyTarget(commentId, nickname) {
  activeParentCommentId = commentId;
  const inputEl = document.getElementById("forum-comment-input");
  if (inputEl) {
    inputEl.placeholder = `回复 @${nickname}:`;
    inputEl.focus();
  }
}

// === 11. AI 模拟性格互动评赞 (高度网感活人对线重构) ===
async function forumTriggerAIInteractions(postId, btn) {
  btn.disabled = true;
  const origText = btn.innerText;
  btn.innerText = "提炼中...";

  try {
    const post = await db.forum_posts.get(postId);
    const systemPrompt = await buildForumSystemPrompt(forumActiveAccountId);

    // 实时读取目前已在论坛中引入的全部 NPC 身份及档案馆原始角色底料
    const npcs = await db.forum_npc_accounts.toArray();
    let npcsPersonaText = "";
    for (let n of npcs) {
      let char = null;
      if (n.charId) char = await db.archives.get(n.charId);
      npcsPersonaText += `\n- 角色「${n.nickname}」人设设定及心流背景: ${char ? char.persona : n.postPreference}`;
    }

    const userPrompt = `请针对以下发表的动态内容，生成 10 条极其真实、活人感拉满、带有丰富互联网网络黑话和情绪互动的跟帖。
帖子标题：${post.title}
帖子内容：${post.content}

【角色真实人设底料参考】：
在生成跟帖人时，请务必参考社区内这几位引入角色的真实人设背景。如果生成了以下对应角色的昵称跟帖，必须100%严格遵守其性格底牌，绝对不准OOC（脱离人设）：
${npcsPersonaText}

你需要分饰不同的活人身份在评论区展开精彩接梗、站队、吐槽或相互抬杠。
请以标准 JSON 数组返回，不要包含 Markdown 语法标识符：
[
  { "type": "like" },
  { "type": "comment", "nickname": "角色昵称", "content": "充满性格和流行流行词的犀利评论、接梗或发疯吐槽" },
  { "type": "nested_reply", "parent_nickname": "被回复人昵称", "content": "针对上述评论的互怼、拆台或接龙回复" }
]`;

    const aiRes = await forumCallAI(systemPrompt, userPrompt);
    let list = [];
    try {
      list = JSON.parse(aiRes);
    } catch(err) {
      list = JSON.parse(aiRes.replace(/,\s*([\]}])/g, '$1'));
    }

    const currentUser = await db.forum_accounts.get(forumActiveAccountId);
    const userNick = currentUser ? currentUser.nickname : "";

    let appendedComments = 0;
    let likesGenerated = 0;

    for (let item of list) {
      // 安全主权防御拦截：禁止评论区出现用 User 昵称伪冒的跟评回复 [1]
      if (userNick && (item.nickname === userNick || item.parent_nickname === userNick)) {
        console.log(`[主权防火墙] 拦截到评论混淆，已放弃生成 User 伪冒跟评/嵌套回复`);
        continue;
      }

      const npcs = await db.forum_npc_accounts.toArray();
      let matchedNpc = null;
      if (item.nickname) {
        matchedNpc = npcs.find(n => n.nickname === item.nickname);
      }

      // 找不到匹配 NPC 时不跳过，作为路人评论直接存储（不入库 forum_npc_accounts）
      let commentAuthorId, commentIsNpc, commentIsPasserby, commentNickname, commentAvatar;
      if (matchedNpc) {
        commentAuthorId = matchedNpc.id;
        commentIsNpc = 1;
        commentIsPasserby = 0;
        commentNickname = matchedNpc.nickname;
        commentAvatar = matchedNpc.avatar || forumGenerateColorfulAvatar(matchedNpc.nickname);
      } else {
        // 路人评论：authorId 用随机负数避免碰撞
        commentAuthorId = -(Date.now() + Math.floor(Math.random() * 100000));
        commentIsNpc = 1;
        commentIsPasserby = 1;
        commentNickname = item.nickname || "匿名路人";
        commentAvatar = forumGenerateColorfulAvatar(commentNickname);
      }

      if (item.type === "like") {
        likesGenerated++;
        // 增加点赞历史通知（路人用负 id，不会与真实 NPC 混淆）
        await db.forum_notifications.add({
          userId: post.authorId,
          type: "like",
          targetId: postId,
          fromUserId: commentAuthorId,
          isRead: 0,
          createdAt: Date.now()
        });
      } else if (item.type === "comment") {
        await db.forum_comments.add({
          postId: postId,
          parentCommentId: 0,
          authorId: commentAuthorId,
          isNpc: commentIsNpc,
          isPasserby: commentIsPasserby,
          authorNickname: commentNickname,
          authorAvatar: commentAvatar,
          content: item.content,
          createdAt: Date.now() + Math.random() * 2000,
          likesCount: 0
        });
        appendedComments++;

        // 增加评论通知（仅 NPC 触发通知，路人不通知）
        if (matchedNpc) {
          await db.forum_notifications.add({
            userId: post.authorId,
            type: "comment",
            targetId: postId,
            fromUserId: matchedNpc.id,
            isRead: 0,
            createdAt: Date.now()
          });
        }
      } else if (item.type === "nested_reply") {
        // 修复评论层级挂载错误：必须根据 parent_nickname 精准定位被回复的评论 id
        const existing = await db.forum_comments.where('postId').equals(postId).toArray();
        let parentId = 0;
        if (item.parent_nickname) {
          // 优先：通过 authorNickname 或 NPC id 匹配 parent_nickname 的最新评论
          const parentNpc = npcs.find(n => n.nickname === item.parent_nickname);
          const candidates = existing
            .filter(c => {
              // 匹配 NPC 评论：authorId 对应 NPC
              if (parentNpc && Number(c.authorId) === Number(parentNpc.id)) return true;
              // 匹配路人评论：authorNickname 字段匹配
              if (c.authorNickname === item.parent_nickname) return true;
              return false;
            })
            .sort((a, b) => b.createdAt - a.createdAt);
          if (candidates.length > 0) parentId = candidates[0].id;
        }
        // 兜底：parent_nickname 未匹配上时，挂载到帖子作者本人最近一条评论下；若作者也没评论过则挂根级
        if (!parentId && existing.length > 0) {
          const authorComments = existing
            .filter(c => Number(c.authorId) === Number(post.authorId))
            .sort((a, b) => b.createdAt - a.createdAt);
          if (authorComments.length > 0) parentId = authorComments[0].id;
        }
        await db.forum_comments.add({
          postId: postId,
          parentCommentId: parentId,
          authorId: commentAuthorId,
          isNpc: commentIsNpc,
          isPasserby: commentIsPasserby,
          authorNickname: commentNickname,
          authorAvatar: commentAvatar,
          content: item.content,
          createdAt: Date.now() + Math.random() * 3000,
          likesCount: 0
        });
        appendedComments++;
      }
    }

    const updatedPost = await db.forum_posts.get(postId);
    await db.forum_posts.update(postId, {
      likesCount: (updatedPost.likesCount || 0) + likesGenerated,
      commentsCount: (updatedPost.commentsCount || 0) + appendedComments
    });

    showToast(`成功唤醒 ${likesGenerated}次喜欢与 ${appendedComments}条新评论反馈`);
    forumRefreshTabFeed();

    if (activePostDetailId === postId) {
      await forumInitPostDetailPage(postId);
    }

  } catch(e) {
    console.error(e);
    showToast("同步互动反馈失败，请检查模型连接");
  } finally {
    btn.disabled = false;
    btn.innerText = origText;
  }
}

// === 12. 发帖表单（增加标题字段输入栏，彻底解决覆写覆盖问题） ===
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
        <input type="text" id="forum-new-post-title" placeholder="请输入动态标题" style="width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:10px; box-sizing:border-box;">
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

async function forumInitNewPostPage() {
  const atList = document.getElementById("forum-new-post-at-list");
  if (!atList) return;
  atList.innerHTML = "";

  const follows = await db.forum_follows.where('followerId').equals(forumActiveAccountId).toArray();
  for (let f of follows) {
    const npc = await db.forum_npc_accounts.get(f.followeeId);
    if (npc) {
      const div = document.createElement("div");
      div.style.cssText = "display:flex; align-items:center; gap:8px;";
      div.innerHTML = `
        <input type="checkbox" class="forum-at-checkbox" value="@${npc.nickname}">
        <span style="font-size:12.5px;">${npc.nickname}</span>
      `;
      atList.appendChild(div);
    }
  }
}

async function forumPublishPost() {
  const titleEl = document.getElementById("forum-new-post-title");
  const contentEl = document.getElementById("forum-new-post-content");
  const mediaEl = document.getElementById("forum-new-post-media");
  if (!contentEl) return;

  const content = contentEl.value.trim();
  const title = titleEl ? titleEl.value.trim() : "";
  const media = mediaEl ? mediaEl.value.trim() : "";

  if (!content) {
    showToast("动态内容不能为空");
    return;
  }

  let finalContent = content;
  const checkboxes = document.querySelectorAll(".forum-at-checkbox:checked");
  checkboxes.forEach(cb => {
    finalContent += ` ${cb.value}`;
  });

  await db.forum_posts.add({
    authorId: forumActiveAccountId,
    isNpc: 0,
    title: title || "日常随笔",
    content: finalContent,
    media: media,
    createdAt: Date.now(),
    views: 1,
    likesCount: 0,
    commentsCount: 0,
    forwardsCount: 0
  });

  showToast("发布成功");
  forumPopLayer();
  forumLoadPostsFeed();
}

// === 13. NPC 自动发动态巡航定时任务 (已废弃并彻底禁用后台巡航) ===
function forumStartNpcCruiseTimer() {
  if (forumNpcCruiseTimer) clearInterval(forumNpcCruiseTimer);
  // 定时器彻底静默，规避后台胡乱发帖现象
}

async function forumNpcAutoPublishPost(npc) {
  try {
    const char = npc.charId ? await db.archives.get(npc.charId) : null;
    // 独立轻量系统设定，不再传递玩家 ActiveAccountId 干扰，彻底切断玩家账户信息的污染
    const systemPrompt = `你当前扮演名为“匿名随笔论坛”的环境，你将要以匿名 NPC 账户发帖。`;

    const userPrompt = `【当前发帖的匿名NPC小号账户】：
- 论坛昵称：${npc.nickname}
- 用户名：@npc_${npc.id}
- 官方原始设定（绝对不准脱离人设/绝不准OOC）：${char ? char.persona : "暂无"}

【注意：不要混淆正在浏览论坛网页的当前用户，不要提及、掺杂任何浏览者的信息】
请严格以此角色的官方人设、心理状态和独特口纹为最高本源视角，撰写一条完全符合其目前思想现状的匿名论坛帖子，绝对不准出现任何脱离其角色卡定位的发言。
【输出格式控制】：请直接且仅返回以下格式的 JSON，不要包含 Markdown 标识符：
{ "title": "具有精神张力的爆点标题", "content": "充满该NPC原设独特口吻、克制纠葛且符合设定的正文文本", "mediaDescription": "灰色白描插图描述(20字内)" }`;

    const aiRes = await forumCallAI(systemPrompt, userPrompt);
    const parsed = JSON.parse(aiRes);

    await db.forum_posts.add({
      authorId: npc.id,
      isNpc: 1,
      title: parsed.title || "寂静自白",
      content: parsed.content || "终究没能逃脱既定的循环...",
      media: parsed.mediaDescription || "",
      createdAt: Date.now(),
      views: Math.floor(Math.random() * 40) + 5,
      likesCount: 0,
      commentsCount: 0,
      forwardsCount: 0
    });

    console.log(`[刷新触发] NPC 角色小号「${npc.nickname}」根据刷新概率成功发帖。`);
    
    const activeTab = document.querySelector("#win-forum .forum-tabs .tab-item.active")?.getAttribute("data-forum-tab");
    if (activeTab === "home") {
      forumLoadPostsFeed();
    }

  } catch(e) {
    console.error("NPC自动发帖失败:", e);
  }
}

// === 14. 极简无依赖原生触控下拉刷新机制 (真实互联网批量自生成与嵌套讨论树) ===
let forumRefreshStartY = 0;
let forumRefreshCurrentY = 0;
let forumIsRefreshing = false;
let forumIsPulling = false;

function forumInitPullToRefresh() {
  const feed = document.getElementById("forum-posts-list");
  if (!feed) return;

  let indicator = document.getElementById("forum-pull-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "forum-pull-indicator";
    indicator.style.cssText = "text-align: center; height: 0px; overflow: hidden; transition: height 0.2s ease, opacity 0.2s ease; font-size: 11px; color: #64748b; font-weight: 700; background-color: #f1f5f9; display: flex; align-items: center; justify-content: center; width: 100%; box-sizing: border-box; flex-shrink: 0; opacity: 0;";
    indicator.innerHTML = `
      <svg class="forum-refresh-spinner" viewBox="0 0 24 24" width="16" height="16" style="margin-right: 6px; animation: forum-spin 1s linear infinite;"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.58 20 12c0-4.42-3.58-8-8-8zm-6 8c0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.42 4 12c0 4.42 3.58 8 8 8v-3l4 4-4-4v3c-3.31 0-6-2.69-6-6z"/></svg>
      <span id="forum-pull-indicator-text">下拉可以刷新</span>
    `;
    feed.parentNode.insertBefore(indicator, feed);

    if (!document.getElementById("forum-refresh-spin-style")) {
      const style = document.createElement("style");
      style.id = "forum-refresh-spin-style";
      style.textContent = `
        @keyframes forum-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // 挂载 Touch 触控阻力下拉手势
  feed.ontouchstart = (e) => {
    if (feed.scrollTop === 0 && !forumIsRefreshing) {
      forumRefreshStartY = e.touches[0].clientY;
      forumRefreshCurrentY = forumRefreshStartY; // 强行重置，对齐极小位移以杜绝点击误触
      forumIsPulling = true;
      indicator.style.transition = "none";
    }
  };

  feed.ontouchmove = (e) => {
    if (!forumIsPulling || forumIsRefreshing) return;
    forumRefreshCurrentY = e.touches[0].clientY;
    const diff = forumRefreshCurrentY - forumRefreshStartY;

    if (diff > 0) {
      const height = Math.min(60, diff * 0.45); // 引入阻力系数
      indicator.style.height = height + "px";
      indicator.style.opacity = (height / 60);
      
      const textEl = document.getElementById("forum-pull-indicator-text");
      if (height >= 45) {
        if (textEl) textEl.innerText = "释放立即刷新";
      } else {
        if (textEl) textEl.innerText = "下拉可以刷新";
      }
    }
  };

  feed.ontouchend = async () => {
    if (!forumIsPulling || forumIsRefreshing) return;
    forumIsPulling = false;
    
    const diff = forumRefreshCurrentY - forumRefreshStartY;
    const textEl = document.getElementById("forum-pull-indicator-text");
    const spinner = indicator.querySelector(".forum-refresh-spinner");

    if (diff * 0.45 >= 45) {
      forumIsRefreshing = true;
      indicator.style.transition = "height 0.2s ease, opacity 0.2s ease";
      indicator.style.height = "40px";
      if (textEl) textEl.innerText = "正在推演时空动态...";
      if (spinner) spinner.style.display = "block";

      try {
        const systemPrompt = await buildForumSystemPrompt(forumActiveAccountId);

        // 1. 随机选取 m 个 char 关联的 NPC（按概率，最多3个）
        const activeNpcs = (await db.forum_npc_accounts.toArray())
          .filter(n => Number(n.userId) === Number(forumActiveAccountId) && n.charId > 0);
        const selectedNpcs = [];
        for (let n of activeNpcs) {
          const prob = Number(n.postProbability || 0);
          if (prob > 0 && Math.random() * 100 < prob) {
            selectedNpcs.push(n);
          }
        }
        const m = Math.min(selectedNpcs.length, 3);
        const npcList = selectedNpcs.slice(0, m);

        // 2. 随机决定 n 条路人帖子（3-5条）
        const n = Math.floor(Math.random() * 3) + 3;

        // 3. 构建 NPC 人设信息供 AI 代入
        let npcPersonaText = "";
        if (npcList.length > 0) {
          npcPersonaText = `\n本次需要以下已存角色各发一篇帖子（严格代入其人设口吻，绝不准OOC）：`;
          for (let npc of npcList) {
            const char = npc.charId ? await db.archives.get(npc.charId) : null;
            npcPersonaText += `\n- 昵称：${npc.nickname}（@npc_${npc.id}），人设：${char ? char.persona : "暂无"}`;
          }
        }

        // 4. 一次 AI 调用统一生成 m 条 NPC 帖子 + n 条路人帖子
        const userPrompt = `请在目前的社交社区中，批量产生 ${m + n} 篇极度真实、有血有肉、有生活烟火气和强网感的社区动态帖子。
${npcPersonaText}

另外再产生 ${n} 篇由全新随机虚构的各色活跃网民分身发出的帖子（请为其指派符合网络文化的昵称与无@英文账号，如社畜打工人、发疯少女、乐子键盘侠、吃瓜闲人等）。
帖子类型要丰富：包含避坑排雷、发疯吐槽、宿命讨论、日常分享等。

为了制造极具链式活人感的社交反应网络，请为每篇帖子自发附加 4 到 6 条其他虚构用户相互吃瓜、抬杠对线、玩梗评论的互动跟帖。

请必须且只能返回如下格式的标准 JSON 数组，严禁带有 Markdown \`\`\`json 块修饰：
[
  {
    "authorType": "char_npc" 或 "passerby",
    "nickname": "发帖人昵称",
    "username": "user_abc",
    "title": "标题",
    "content": "正文",
    "media": "配图描述(如果有)",
    "comments": [
      { "nickname": "回帖人", "content": "评论内容" }
    ]
  }
]

注意：authorType 为 "char_npc" 时，nickname 必须与上面列出的角色昵称完全匹配；authorType 为 "passerby" 时可自由发挥昵称。`;

        const aiRes = await forumCallAI(systemPrompt, userPrompt);
        let batchList = [];
        try {
          batchList = JSON.parse(aiRes);
        } catch(err) {
          batchList = JSON.parse(aiRes.replace(/,\s*([\]}])/g, '$1'));
        }

        const currentUser = await db.forum_accounts.get(forumActiveAccountId);
        const userNick = currentUser ? currentUser.nickname : "";

        // 5. 统一落库：char_npc 帖子关联已存 NPC，passerby 帖子直接存作者信息不入库 forum_npc_accounts
        for (let postData of batchList) {
          // 安全主权防御拦截：禁止路人冒充 User 昵称
          if (userNick && postData.nickname === userNick) {
            console.log(`[主权防火墙] 拦截到大模型幻觉：放弃生成 User 伪冒贴：「${postData.title}」`);
            continue;
          }

          const isCharNpc = postData.authorType === "char_npc";
          let authorId, authorNickname, authorAvatar, authorUsername;

          if (isCharNpc) {
            // char_npc：匹配已存 NPC，找不到则跳过（不夺舍其他 NPC）
            const npc = npcList.find(nv => nv.nickname === postData.nickname);
            if (!npc) {
              console.log(`[身份防火墙] AI 生成的 char_npc 昵称 "${postData.nickname}" 不在选中列表，已跳过`);
              continue;
            }
            authorId = npc.id;
            authorNickname = npc.nickname;
            authorAvatar = npc.avatar || forumGenerateColorfulAvatar(npc.nickname);
            authorUsername = `npc_${npc.id}`;
          } else {
            // passerby：不入库 forum_npc_accounts，直接在帖子中存储作者信息
            // authorId 用随机负数，避免与真实 NPC 的正数 id 碰撞
            authorId = -(Date.now() + Math.floor(Math.random() * 100000));
            authorNickname = postData.nickname || "匿名路人";
            authorAvatar = forumGenerateColorfulAvatar(authorNickname);
            authorUsername = postData.username || `user_${Math.random().toString(36).substring(2, 8)}`;
          }

          const newPostId = await db.forum_posts.add({
            authorId: authorId,
            isNpc: 1,
            isPasserby: isCharNpc ? 0 : 1,
            authorNickname: authorNickname,
            authorAvatar: authorAvatar,
            authorUsername: authorUsername,
            title: postData.title || "吐槽日记",
            content: postData.content || "今天又被世界创到了...",
            media: postData.media || "",
            createdAt: Date.now() - Math.random() * 60000,
            views: Math.floor(Math.random() * 200) + 15,
            likesCount: Math.floor(Math.random() * 30),
            commentsCount: postData.comments ? postData.comments.length : 0,
            forwardsCount: 0
          });

          // 自动级联入库讨论树：路人评论也不入库 forum_npc_accounts
          if (postData.comments && Array.isArray(postData.comments)) {
            for (let c of postData.comments) {
              if (userNick && c.nickname === userNick) continue;

              const cAvatar = forumGenerateColorfulAvatar(c.nickname);
              const cAuthorId = -(Date.now() + Math.floor(Math.random() * 100000));

              await db.forum_comments.add({
                postId: newPostId,
                parentCommentId: 0,
                authorId: cAuthorId,
                isNpc: 1,
                isPasserby: 1,
                authorNickname: c.nickname || "匿名路人",
                authorAvatar: cAvatar,
                content: c.content,
                createdAt: Date.now() - Math.random() * 40000,
                likesCount: 0
              });
            }
          }
        }

        // 重新加载 Feed 动态视图
        await forumLoadPostsFeed();

      } catch (err) {
        console.error("批量网络动态更新推演失败:", err);
      }

      setTimeout(() => {
        indicator.style.height = "0px";
        indicator.style.opacity = "0";
        forumIsRefreshing = false;
        showToast("动态已全部更新");
      }, 800);
    } else {
      indicator.style.transition = "height 0.2s ease, opacity 0.2s ease";
      indicator.style.height = "0px";
      indicator.style.opacity = "0";
    }
  };
}

// ========== 清理7天前路人帖子 ==========
// 删除 forum_posts 中7天前的路人帖子（isPasserby === 1 或 charId===0 的旧路人NPC帖子），
// 但保留 char 关联的 NPC、user 自己、user 关注的人的帖子。
// 同时级联删除关联的 forum_comments 和 forum_likes。
async function forumCleanOldPasserbyPosts() {
  if (!forumActiveAccountId) {
    if (typeof showToast === 'function') showToast("请先登录论坛账户");
    return;
  }

  if (!confirm("将删除7天前的所有路人帖子（保留角色、你和关注的人的帖子），确认清理？")) {
    return;
  }

  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // 1. 收集需要保留的 authorId 集合
    const preserveIds = new Set();

    // 1a. user 自己
    preserveIds.add(Number(forumActiveAccountId));

    // 1b. char 关联的 NPC（charId > 0）
    const charNpcs = (await db.forum_npc_accounts.toArray()).filter(n => n.charId > 0);
    for (let n of charNpcs) {
      preserveIds.add(Number(n.id));
    }

    // 1c. user 关注的人
    const follows = await db.forum_follows.where('followerId').equals(forumActiveAccountId).toArray();
    for (let f of follows) {
      preserveIds.add(Number(f.followeeId));
    }

    // 2. 找出7天前的路人帖子
    const allPosts = await db.forum_posts.toArray();
    const oldPasserbyPosts = allPosts.filter(p => {
      // 7天前
      if (p.createdAt >= cutoff) return false;
      // 保留列表中的不删
      if (preserveIds.has(Number(p.authorId))) return false;
      // 新格式路人帖子
      if (p.isPasserby === 1) return true;
      // 旧格式路人NPC帖子（isNpc === 1 且不在保留列表，preserveIds 已含 charId>0 的 NPC）
      if (p.isNpc === 1) return true;
      // user 帖子（isNpc === 0 或 undefined）不删
      return false;
    });

    if (oldPasserbyPosts.length === 0) {
      if (typeof showToast === 'function') showToast("没有7天前的路人帖子需要清理");
      return;
    }

    const deletePostIds = oldPasserbyPosts.map(p => p.id);

    // 3. 级联删除关联的评论
    const allComments = await db.forum_comments.toArray();
    const deleteCommentIds = allComments
      .filter(c => deletePostIds.includes(c.postId))
      .map(c => c.id);

    // 4. 级联删除关联的点赞
    const allLikes = await db.forum_likes.toArray();
    const deleteLikeIds = allLikes
      .filter(l => deletePostIds.includes(l.targetId) && l.targetType === 'post')
      .map(l => l.id);

    // 5. 执行删除
    await db.transaction('rw', db.forum_posts, db.forum_comments, db.forum_likes, async () => {
      await db.forum_posts.bulkDelete(deletePostIds);
      if (deleteCommentIds.length > 0) await db.forum_comments.bulkDelete(deleteCommentIds);
      if (deleteLikeIds.length > 0) await db.forum_likes.bulkDelete(deleteLikeIds);
    });

    // 6. 刷新列表
    await forumLoadPostsFeed();

    if (typeof showToast === 'function') {
      showToast(`已清理 ${oldPasserbyPosts.length} 条路人帖子`);
    }
  } catch (err) {
    console.error("清理路人帖子失败:", err);
    if (typeof showToast === 'function') showToast("清理失败，请查看控制台");
  }
}

window.forumCleanOldPasserbyPosts = forumCleanOldPasserbyPosts;