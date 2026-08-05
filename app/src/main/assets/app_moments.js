/**
 * app_moments.js - 仿真微信朋友圈业务控制器 (无 Emoji & 高抗震 AI 交互版 - 细节升级)
 */

// 注入触控物理穿透防护样式，确保多选卡片按压时瞬间触发高亮
(function() {
  const momentsTouchStyle = document.createElement("style");
  momentsTouchStyle.textContent = `
    .moments-char-card *, .moments-char-card-visibility *, .moments-forward-char-card *, .comment-delete-btn * {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(momentsTouchStyle);
})();

const momentSystem = {
  activeMoments: [],
  timerId: null,
  currentUploadGridIndex: null, // 九宫格上传定位器
  commentTimer: null,
  isCommentLongPressed: false,

  startCommentLongPress(el, commentId, event) {
    this.isCommentLongPressed = false;
    this.commentTimer = setTimeout(() => {
      this.isCommentLongPressed = true;
      el.style.backgroundColor = '#fee2e2';
      const btn = el.querySelector('.comment-delete-btn');
      if (btn) btn.style.display = 'inline-flex';
    }, 800);
  },

  cancelCommentLongPress(el, event) {
    if (!this.isCommentLongPressed) {
      clearTimeout(this.commentTimer);
    }
  },

  handleCommentClick(momentId, commentId, commenterName, event) {
    if (this.isCommentLongPressed) {
      event.preventDefault();
      event.stopPropagation();
      this.isCommentLongPressed = false;
      const el = event.currentTarget;
      el.style.backgroundColor = 'transparent';
      const btn = el.querySelector('.comment-delete-btn');
      if (btn) btn.style.display = 'none';
      return;
    }
    clearTimeout(this.commentTimer);
    if (event.target.closest('.comment-delete-btn')) {
      return;
    }
    this.openReplyCommentModal(momentId, commentId, commenterName);
  },

  async deleteComment(commentId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (confirm("确定要删除这条评论吗？")) {
      await db.moment_comments.delete(commentId);
      await this.renderFeed();
    }
  },

  // 初始化朋友圈
  async init() {
    this.bindEvents();
    this.startBackgroundTimer();
    await this.renderFeed();
  },

  // 辅助：高聚拢获取已建立对话的所有 Char 角色列表 (朋友圈活跃与可见范围均从此取值)
  async getEstablishedChars(userIdNum) {
    const sessions = await db.sessions.where('userId').equals(userIdNum).toArray();
    const chars = [];
    for (let s of sessions) {
      const char = await db.archives.get(s.charId);
      if (char) {
        chars.push({
          id: char.id,
          name: s.customCharName || char.name,
          avatar: s.customCharAvatar || char.avatar,
          remark: char.remark || "已建立会话",
          group: char.group || "默认分组"
        });
      }
    }
    return chars;
  },

  // 绑定朋友圈的所有 DOM 交互事件
  bindEvents() {
    const btnSettings = document.getElementById("btn-moments-settings");
    if (btnSettings) {
      btnSettings.onclick = () => this.openSettingsModal();
    }

    const btnPost = document.getElementById("btn-moments-post");
    if (btnPost) {
      btnPost.onclick = () => this.openPostModal();
    }

    const btnSaveSettings = document.getElementById("btn-save-moments-settings");
    if (btnSaveSettings) {
      btnSaveSettings.onclick = () => this.saveSettings();
    }

    const btnInstantPost = document.getElementById("btn-moments-instant-post");
    if (btnInstantPost) {
      btnInstantPost.onclick = () => this.triggerInstantCharPost();
    }

    const btnSubmit = document.getElementById("btn-moments-submit");
    if (btnSubmit) {
      btnSubmit.onclick = () => this.submitUserPost();
    }

    // 绑定朋友圈背景本地上传
    const bgFile = document.getElementById("moments-bg-file");
    if (bgFile) {
      bgFile.onchange = (e) => {
        if (e.target.files.length > 0) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const preview = document.getElementById("moments-bg-preview");
            if (preview) {
              preview.innerHTML = `<img src="${evt.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
              preview.setAttribute("data-pending-base64", evt.target.result);
            }
            // 同步将背景输入框的 Value 标记为本地上传，防止背景丢失
            const urlInput = document.getElementById("moments-bg-url");
            if (urlInput) {
              urlInput.value = "[本地上传图片]";
            }
          };
          reader.readAsDataURL(e.target.files[0]);
        }
      };
    }
  },

  // 渲染主动态流 Feed (纯无框 SVG 极简交互区)
  async renderFeed() {
    const container = document.querySelector("#chat-tab-moments .moment-list");
    if (!container) return;

    const activeMeId = localStorage.getItem("active_me_id");
    if (!activeMeId) {
      container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); margin-top:40px; font-size:13px;">请先在“我的”页面中选择我的人设！</p>`;
      return;
    }

    const userIdNum = Number(activeMeId);
    const settings = await db.moment_settings.where('userId').equals(userIdNum).first();
    const wallpaper = settings?.wallpaper || "";

    // 1. 同步加载朋友圈背景图
    const cover = document.querySelector("#chat-tab-moments .moment-cover");
    if (cover) {
      if (wallpaper) {
        cover.style.backgroundImage = `url("${wallpaper}")`;
        cover.style.backgroundSize = "cover";
        cover.style.backgroundPosition = "center";
      } else {
        cover.style.backgroundImage = "none";
        cover.style.backgroundColor = "#7f7f7f";
      }
    }

    // 2. 加载我的人设头像与姓名
    const user = await db.archives.get(userIdNum);
    if (user) {
      const nameEl = document.getElementById("moment-user-name");
      const avatarEl = document.getElementById("moment-user-avatar");
      if (nameEl) nameEl.innerText = user.name;
      if (avatarEl) avatarEl.src = resolveAvatar(user.avatar);
    }

    // 3. 读取该人设下可见的朋友圈动态
    const list = await db.moments.where('userId').equals(userIdNum).sortBy('timestamp');
    list.reverse();

    if (list.length === 0) {
      container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); margin-top:60px; font-size:13px;">暂无朋友圈动态</p>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (let m of list) {
      let senderName = "未知";
      let senderAvatar = "";
      if (m.senderType === 'user') {
        const char = await db.archives.get(m.senderId);
        senderName = char?.name || "我";
        senderAvatar = resolveAvatar(char?.avatar);
      } else {
        const char = await db.archives.get(m.senderId);
        senderName = char?.name || "伙伴";
        senderAvatar = resolveAvatar(char?.avatar);
      }

      const postCard = document.createElement("div");
      postCard.className = "moment-post-card";
      postCard.setAttribute("data-moment-id", m.id);
      postCard.style.cssText = "display: flex; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border); background: #ffffff; text-align: left;";

      // 图片格栅渲染 (最多九张)
      let imagesHtml = "";
      if (m.images && m.images.length > 0) {
        let gridStyle = "display: grid; gap: 6px; margin-top: 8px; max-width: 240px;";
        if (m.images.length === 1) {
          gridStyle += "grid-template-columns: 1fr;";
        } else if (m.images.length <= 4) {
          gridStyle += "grid-template-columns: repeat(2, 1fr);";
        } else {
          gridStyle += "grid-template-columns: repeat(3, 1fr);";
        }

        let itemsHtml = "";
        m.images.forEach((img, idx) => {
          if (img.url) {
            itemsHtml += `<div style="aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: #eaeaea; cursor:pointer;" onclick="momentSystem.viewImageDetail('${escapeHtml(img.url)}')">
              <img src="${img.url}" style="width: 100%; height:100%; object-fit: cover;">
            </div>`;
          } else if (img.desc) {
            itemsHtml += `
              <div style="aspect-ratio: 1; border-radius: 4px; background: #f3f4f6; display: flex; flex-direction: column; justify-content: center; align-items: center; border: 1px solid var(--border); cursor: pointer; padding: 4px;" onclick="momentSystem.viewTextDescription('${escapeHtml(img.desc)}')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary);"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span style="font-size: 8px; color: var(--text-secondary); margin-top: 4px; text-align: center; line-height: 1;">查看描述</span>
              </div>`;
          }
        });
        imagesHtml = `<div style="${gridStyle}">${itemsHtml}</div>`;
      }

      // 获取点赞姓名
      const likedNames = [];
      const userLiked = (m.likes || []).includes(userIdNum);
      if (m.likes && m.likes.length > 0) {
        for (let lId of m.likes) {
          if (lId === userIdNum) {
            likedNames.push(user?.name || "我");
          } else {
            const char = await db.archives.get(lId);
            if (char) likedNames.push(char.name);
          }
        }
      }

      // 加载评论
      const comments = await db.moment_comments.where('momentId').equals(m.id).toArray();
      const commentsHtmlList = [];
      for (let c of comments) {
        let commenterName = "未知";
        if (c.senderType === 'user') {
          const author = await db.archives.get(c.senderId);
          commenterName = author?.name || "我";
        } else {
          const author = await db.archives.get(c.senderId);
          commenterName = author?.name || "伙伴";
        }

        let replyLabelHtml = "";
        if (c.replyToCommentId) {
          const targetComment = await db.moment_comments.get(c.replyToCommentId);
          if (targetComment) {
            let targetName = "对方";
            if (targetComment.senderType === 'user') {
              const ta = await db.archives.get(targetComment.senderId);
              targetName = ta?.name || "我";
            } else {
              const ta = await db.archives.get(targetComment.senderId);
              targetName = ta?.name || "伙伴";
            }
            replyLabelHtml = `<span style="color:var(--text-secondary); margin: 0 4px; font-weight: normal;">回复</span>${targetName}`;
          }
        }

        commentsHtmlList.push(`
          <div class="moment-comment-item" style="position: relative; font-size: 13px; margin-top: 4px; line-height: 1.5; color: var(--text-primary); cursor: pointer; transition: background-color 0.2s; padding: 2px 4px; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; user-select: none; -webkit-user-select: none;" 
               oncontextmenu="event.preventDefault();"
               onmousedown="momentSystem.startCommentLongPress(this, ${c.id}, event)"
               onmouseup="momentSystem.cancelCommentLongPress(this, event)"
               onmouseleave="momentSystem.cancelCommentLongPress(this, event)"
               ontouchstart="momentSystem.startCommentLongPress(this, ${c.id}, event)"
               ontouchend="momentSystem.cancelCommentLongPress(this, event)"
               onclick="momentSystem.handleCommentClick(${m.id}, ${c.id}, '${escapeHtml(commenterName)}', event)">
            <div style="flex: 1;">
              <strong style="color: #576b95;">${commenterName}</strong>${replyLabelHtml}: <span>${escapeHtml(c.content)}</span>
            </div>
            <button class="comment-delete-btn" style="display: none; background: none; border: none; color: #ef4444; padding: 2px 6px; cursor: pointer; align-items: center; justify-content: center; margin-left: 8px;" onclick="momentSystem.deleteComment(${c.id}, event)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="pointer-events: none;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        `);
      }

      let interactAreaHtml = "";
      if (likedNames.length > 0 || commentsHtmlList.length > 0) {
        let likesSection = "";
        if (likedNames.length > 0) {
          likesSection = `
            <div style="display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; ${commentsHtmlList.length > 0 ? 'border-bottom: 1px solid #e1e1e1;' : ''}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="color: #576b95; margin-top: 4px; flex-shrink:0;"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              <div style="font-size: 13px; color: #576b95; font-weight: 700; line-height: 1.4;">${likedNames.join(', ')}</div>
            </div>
          `;
        }

        let commentsSection = "";
        if (commentsHtmlList.length > 0) {
          commentsSection = `<div style="padding: 6px 8px;">${commentsHtmlList.join("")}</div>`;
        }

        interactAreaHtml = `
          <div style="background-color: #f7f7f7; border-radius: 4px; margin-top: 10px;">
            ${likesSection}
            ${commentsSection}
          </div>
        `;
      }

      const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // 把操作按键变成 4 个无边框/无字纯净高发光性 SVG 图标
      postCard.innerHTML = `
        <img src="${senderAvatar}" style="width: 42px; height: 42px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">
        <div style="flex: 1; display: flex; flex-direction: column;">
          <div style="font-size: 15px; font-weight: 700; color: #576b95;">${senderName}</div>
          <div style="font-size: 14.5px; color: var(--text-primary); margin-top: 4px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(m.content)}</div>
          ${imagesHtml}
          
          <!-- 无框极简 SVG 互动工具条 -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; position: relative;">
            <span style="font-size: 12px; color: var(--text-secondary);">${timeStr}</span>
            <div style="display: flex; gap: 16px; align-items: center; background: transparent; padding: 2px 4px;">
              <!-- 1. 点赞 -->
              <button class="btn-icon" onclick="momentSystem.likeMoment(${m.id})" style="padding: 4px; color: ${userLiked ? '#e11d48' : '#64748b'}; transition: color 0.15s; background:none; border:none; cursor:pointer;" title="赞">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="${userLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              </button>
              <!-- 2. 评论 -->
              <button class="btn-icon" onclick="momentSystem.openCommentModal(${m.id})" style="padding: 4px; color: #64748b; background:none; border:none; cursor:pointer;" title="评论">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
              <!-- 3. 转发共享 -->
              <button class="btn-icon" onclick="momentSystem.forwardMoment(${m.id})" style="padding: 4px; color: #64748b; background:none; border:none; cursor:pointer;" title="转发到单聊">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
              </button>
              <!-- 4. 请求大模型针对性反应 -->
              <button class="btn-icon" onclick="momentSystem.triggerAIReaction(${m.id})" style="padding: 4px; color: #db2777; background:none; border:none; cursor:pointer;" title="获取大模型反应">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></polygon></svg>
              </button>
            </div>
          </div>

          <!-- 交互区块 -->
          ${interactAreaHtml}
        </div>
      `;
      fragment.appendChild(postCard);
    }

    container.innerHTML = "";
    container.appendChild(fragment);
  },

  // 点赞操作响应
  async likeMoment(momentId) {
    const activeMeId = localStorage.getItem("active_me_id");
    if (!activeMeId) return;
    const userIdNum = Number(activeMeId);

    const m = await db.moments.get(momentId);
    if (!m) return;

    let likes = m.likes || [];
    if (likes.includes(userIdNum)) {
      // 如果已点赞，则取消
      likes = likes.filter(id => id !== userIdNum);
    } else {
      // 否则，追加点赞
      likes.push(userIdNum);
    }

    await db.moments.update(momentId, { likes });
    await this.renderFeed();
  },

  // 查看纯文本描述自愈路由
  viewTextDescription(desc) {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center; z-index:9999; cursor:pointer;";
    box.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 16px; max-width: 85%; line-height:1.6; text-align:left; color:#1e293b; font-size:14.5px;">
        <div style="font-weight:700; margin-bottom:12px; border-bottom:1.5px solid var(--border); padding-bottom:6px; font-size:12px; color:var(--text-secondary);">画面场景描述</div>
        “ ${escapeHtml(desc)} ”
      </div>
    `;
    box.onclick = () => document.body.removeChild(box);
    document.body.appendChild(box);
  },

  // 朋友圈设置弹窗载入 (卡片选择器，完全避开 display:none 保证交互活性)
  async openSettingsModal() {
    const activeMeId = localStorage.getItem("active_me_id");
    if (!activeMeId) {
      showToast("请先到“我的”页面选择我的人设！");
      return;
    }
    const userIdNum = Number(activeMeId);
    
    let settings = await db.moment_settings.where('userId').equals(userIdNum).first();
    if (!settings) {
      settings = { userId: userIdNum, wallpaper: "", activeCharIds: [], isTimerEnabled: 0, timerInterval: 30 };
      settings.id = await db.moment_settings.add(settings);
    }

    const preview = document.getElementById("moments-bg-preview");
    if (preview) {
      if (settings.wallpaper) {
        preview.innerHTML = `<img src="${settings.wallpaper}" style="width:100%; height:100%; object-fit:cover;">`;
      } else {
        preview.innerHTML = "";
      }
    }
    
    const wp = settings.wallpaper || "";
    document.getElementById("moments-bg-url").value = wp.startsWith("data:") ? "[本地上传图片]" : wp;

    // 只拉取已建立会话的角色列表
    const container = document.getElementById("moments-char-cards-container");
    container.innerHTML = "";
    const chars = await this.getEstablishedChars(userIdNum);

    const activeCharIds = settings.activeCharIds || [];

    chars.forEach(c => {
      const isChecked = activeCharIds.includes(c.id);
      const card = document.createElement("div");
      card.className = "moments-char-card";
      card.setAttribute("data-char-id", c.id);
      card.setAttribute("data-checked", isChecked ? "true" : "false");
      card.style.cssText = `background: ${isChecked ? '#f0fdf4' : '#ffffff'}; border: 1.5px solid ${isChecked ? '#86efac' : 'var(--border)'}; border-radius: 10px; padding: 10px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: all 0.2s; margin-bottom:4px; position: relative;`;
      
      // 物理级穿透保障：显式绑定点击作用域，执行高亮
      card.onclick = function() {
        momentSystem.toggleCharSelection(this);
      };
      card.innerHTML = `
        <img src="${resolveAvatar(c.avatar)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; pointer-events: none;">
        <div style="flex: 1; text-align: left; pointer-events: none;">
          <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${escapeHtml(c.name)}</div>
          <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(c.remark)}</div>
        </div>
      `;
      container.appendChild(card);
    });

    document.getElementById("moments-timer-toggle").checked = settings.isTimerEnabled === 1;
    document.getElementById("moments-timer-interval").value = settings.timerInterval || 30;

    document.getElementById("moments-settings-overlay").classList.add("active");
  },

  // 卡片选择器的高亮状态即时切换 (采用简写属性对齐，实现按压瞬间变绿/变白高亮)
  toggleCharSelection(card) {
    const isChecked = card.getAttribute("data-checked") === "true";
    const newChecked = !isChecked;
    card.setAttribute("data-checked", newChecked ? "true" : "false");
    
    if (newChecked) {
      card.style.background = "#f0fdf4";
      card.style.border = "1.5px solid #86efac";
    } else {
      card.style.background = "#ffffff";
      card.style.border = "1.5px solid var(--border)";
    }
  },

  // 朋友圈发送界面载入 (可见人一律使用极简建立会话卡片选择器)
  async openPostModal() {
    const activeMeId = localStorage.getItem("active_me_id");
    const userIdNum = Number(activeMeId);

    document.getElementById("moments-post-text").value = "";
    
    // 九宫格
    const grid = document.getElementById("moments-post-image-grid");
    grid.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const box = document.createElement("div");
      box.className = "moments-post-img-box";
      box.style.cssText = "aspect-ratio: 1; border: 1.5px dashed var(--border); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8fafc; cursor: pointer; position: relative;";
      box.setAttribute("data-index", i);
      box.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary);"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span style="font-size: 8px; color: var(--text-secondary); margin-top: 4px;">加入图/描述</span>
      `;
      box.onclick = () => {
        this.currentUploadGridIndex = i;
        document.getElementById("moments-image-method-overlay").classList.add("active");
      };
      grid.appendChild(box);
    }

    // 可见人：建立过会话的角色卡片多选列表 (排除 display:none)
    const visibilityContainer = document.getElementById("moments-visibility-groups-container");
    visibilityContainer.innerHTML = "";
    const chars = await this.getEstablishedChars(userIdNum);
    
    const groups = Array.from(new Set(chars.map(c => c.group || "默认分组")));
    groups.forEach(g => {
      const gChars = chars.filter(c => (c.group || "默认分组") === g);
      const groupDiv = document.createElement("div");
      groupDiv.style.marginBottom = "12px";
      
      let cardsHtml = "";
      gChars.forEach(c => {
        cardsHtml += `
          <div class="moments-char-card-visibility" data-char-id="${c.id}" data-checked="true" onclick="momentSystem.toggleCharSelection(this)" style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:10px; padding:8px; display:flex; align-items:center; gap:10px; cursor:pointer; transition: all 0.2s; position: relative; width: 100%; box-sizing: border-box; margin-bottom:4px;">
            <img src="${resolveAvatar(c.avatar)}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; pointer-events:none;">
            <div style="flex:1; text-align:left; pointer-events:none;">
              <span style="font-size:13px; font-weight:700; color:var(--text-primary);">${escapeHtml(c.name)}</span>
            </div>
          </div>
        `;
      });

      groupDiv.innerHTML = `
        <div style="font-size: 11px; font-weight:700; color: var(--text-secondary); margin-bottom: 6px;">${escapeHtml(g)}</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${cardsHtml}
        </div>
      `;
      visibilityContainer.appendChild(groupDiv);
    });

    document.getElementById("moments-post-overlay").classList.add("active");
  },

  // 自研无框路由：格栅图片本地上传触发
  triggerLocalGridUpload() {
    document.getElementById("moments-image-method-overlay").classList.remove("active");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.onchange = (e) => {
      if (e.target.files.length > 0) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const box = document.querySelector(`.moments-post-img-box[data-index="${this.currentUploadGridIndex}"]`);
          box.innerHTML = `<img src="${evt.target.result}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">`;
          box.setAttribute("data-real-url", evt.target.result);
          box.removeAttribute("data-desc-text");
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    };
    fileInput.click();
  },

  // 自研无框路由：画面文字白描触发弹窗
  triggerTextGridDescription() {
    document.getElementById("moments-image-method-overlay").classList.remove("active");
    document.getElementById("moments-grid-text-input").value = "";
    document.getElementById("moments-text-desc-overlay").classList.add("active");
  },

  submitGridTextDescription() {
    const text = document.getElementById("moments-grid-text-input").value.trim();
    if (!text) {
      alert("请输入白描描述文本！");
      return;
    }
    const box = document.querySelector(`.moments-post-img-box[data-index="${this.currentUploadGridIndex}"]`);
    box.innerHTML = `
      <div style="padding: 4px; text-align: center; line-height: 1.2;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary);"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <div style="font-size: 8px; color: var(--text-primary); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:50px;">${escapeHtml(text)}</div>
      </div>`;
    box.setAttribute("data-desc-text", text);
    box.removeAttribute("data-real-url");
    document.getElementById("moments-text-desc-overlay").classList.remove("active");
  },

  // 朋友圈发送
  async submitUserPost() {
    const activeMeId = localStorage.getItem("active_me_id");
    const userIdNum = Number(activeMeId);

    const text = document.getElementById("moments-post-text").value.trim();
    if (!text) {
      showToast("请输入朋友圈动态内容！");
      return;
    }

    const images = [];
    document.querySelectorAll(".moments-post-img-box").forEach(box => {
      const url = box.getAttribute("data-real-url");
      const desc = box.getAttribute("data-desc-text");
      if (url || desc) {
        images.push({ url: url || "", desc: desc || "" });
      }
    });

    const checkedCards = document.querySelectorAll(".moments-char-card-visibility[data-checked='true']");
    const visibleCharIds = Array.from(checkedCards).map(card => Number(card.getAttribute("data-char-id")));

    const momentId = await db.moments.add({
      userId: userIdNum,
      senderType: 'user',
      senderId: userIdNum,
      content: text,
      images: images,
      likes: [],
      visibleCharIds: visibleCharIds, // 记录本条动态的专属可见人
      timestamp: Date.now()
    });

    document.getElementById("moments-post-overlay").classList.remove("active");
    showToast("发送成功！");
    await this.renderFeed();

    // 自动触发可见的所有好友进行反应
    this.triggerAIsFeedbacksOnPost(momentId, visibleCharIds);
  },

  // 朋友圈设置保存
  async saveSettings() {
    const activeMeId = localStorage.getItem("active_me_id");
    const userIdNum = Number(activeMeId);

    const bgUrlInput = document.getElementById("moments-bg-url").value.trim();
    let wallpaper = "";
    if (bgUrlInput === "[本地上传图片]") {
      const preview = document.getElementById("moments-bg-preview");
      wallpaper = preview ? preview.querySelector("img")?.src || "" : "";
    } else {
      wallpaper = bgUrlInput;
    }

    const checkedCards = document.querySelectorAll("#moments-char-cards-container .moments-char-card[data-checked='true']");
    const activeCharIds = Array.from(checkedCards).map(card => Number(card.getAttribute("data-char-id")));

    const isTimerEnabled = document.getElementById("moments-timer-toggle").checked ? 1 : 0;
    const timerInterval = parseInt(document.getElementById("moments-timer-interval").value) || 30;

    const settings = await db.moment_settings.where('userId').equals(userIdNum).first();
    await db.moment_settings.update(settings.id, {
      wallpaper,
      activeCharIds,
      isTimerEnabled,
      timerInterval
    });

    showToast("配置已更新！");
    document.getElementById("moments-settings-overlay").classList.remove("active");
    this.startBackgroundTimer();
    await this.renderFeed();
  },

  // 朋友圈无框卡片：评论/回复触发
  openCommentModal(momentId) {
    document.getElementById("moments-comment-title").innerText = "发表评论";
    document.getElementById("moments-comment-moment-id").value = momentId;
    document.getElementById("moments-comment-reply-id").value = "";
    document.getElementById("moments-comment-text-input").value = "";
    document.getElementById("moments-comment-text-input").placeholder = "发表你的看法...";
    document.getElementById("moments-comment-dialog-overlay").classList.add("active");
  },

  openReplyCommentModal(momentId, targetCommentId, targetCommenterName) {
    document.getElementById("moments-comment-title").innerText = `回复 ${targetCommenterName}`;
    document.getElementById("moments-comment-moment-id").value = momentId;
    document.getElementById("moments-comment-reply-id").value = targetCommentId;
    document.getElementById("moments-comment-text-input").value = "";
    document.getElementById("moments-comment-text-input").placeholder = `回复 ${targetCommenterName}...`;
    document.getElementById("moments-comment-dialog-overlay").classList.add("active");
  },

  async submitCommentDialog() {
    const momentId = Number(document.getElementById("moments-comment-moment-id").value);
    const replyToId = document.getElementById("moments-comment-reply-id").value;
    const text = document.getElementById("moments-comment-text-input").value.trim();

    if (!text) {
      showToast("请输入评论内容！");
      return;
    }

    const activeMeId = localStorage.getItem("active_me_id");
    const userIdNum = Number(activeMeId);

    const commentId = await db.moment_comments.add({
      momentId,
      senderType: 'user',
      senderId: userIdNum,
      content: text,
      replyToCommentId: replyToId ? Number(replyToId) : null,
      timestamp: Date.now()
    });

    document.getElementById("moments-comment-dialog-overlay").classList.remove("active");
    await this.renderFeed();

    // 触发社交反应链
    this.triggerAIReactionsOnComment(momentId, commentId);
  },

  // 朋友圈无框卡片：转发面板触发
  async forwardMoment(momentId) {
    const activeMeId = localStorage.getItem("active_me_id");
    if (!activeMeId) {
      alert("请先到“我的”页面选择我的人设！");
      return;
    }
    const userIdNum = Number(activeMeId);

    document.getElementById("moments-forward-moment-id").value = momentId;
    document.getElementById("moments-forward-text-input").value = "";

    // 载入转发目标的角色选择器（同设置页）
    const container = document.getElementById("moments-forward-char-container");
    if (container) {
      container.innerHTML = "";
      const chars = await this.getEstablishedChars(userIdNum);
      if (chars.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); margin: 20px 0; font-size:12px; width:100%;">暂无已经建立过单聊的角色</p>`;
      } else {
        chars.forEach(c => {
          const card = document.createElement("div");
          card.className = "moments-forward-char-card";
          card.setAttribute("data-char-id", c.id);
          card.setAttribute("data-checked", "false");
          card.style.cssText = `background: #ffffff; border: 1.5px solid var(--border); border-radius: 10px; padding: 10px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: all 0.2s; margin-bottom:4px; position: relative; width: 100%; box-sizing: border-box;`;
          
          card.onclick = function() {
            momentSystem.selectForwardChar(this);
          };
          card.innerHTML = `
            <img src="${resolveAvatar(c.avatar)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; pointer-events: none;">
            <div style="flex: 1; text-align: left; pointer-events: none;">
              <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${escapeHtml(c.name)}</div>
            </div>
          `;
          container.appendChild(card);
        });
      }
    }

    document.getElementById("moments-forward-dialog-overlay").classList.add("active");
  },

  // 转发卡片单选高亮
  selectForwardChar(card) {
    const allCards = document.querySelectorAll(".moments-forward-char-card");
    allCards.forEach(c => {
      c.setAttribute("data-checked", "false");
      c.style.background = "#ffffff";
      c.style.border = "1.5px solid var(--border)";
    });

    card.setAttribute("data-checked", "true");
    card.style.background = "#f0fdf4";
    card.style.border = "1.5px solid #86efac";
  },

  // 提交转发朋友圈
  async submitForwardDialog() {
    const momentId = Number(document.getElementById("moments-forward-moment-id").value);
    const text = document.getElementById("moments-forward-text-input").value.trim();

    // 获取选中的单聊角色
    const selectedCard = document.querySelector(".moments-forward-char-card[data-checked='true']");
    if (!selectedCard) {
      showToast("请选择要转发到的目标单聊角色！");
      return;
    }
    const targetCharId = Number(selectedCard.getAttribute("data-char-id"));

    const m = await db.moments.get(momentId);
    if (!m) return;

    const author = await db.archives.get(m.senderId);
    const authorName = m.senderType === 'user' ? "我" : (author?.name || "伙伴");

    const shareData = {
      momentId: m.id,
      authorName: authorName,
      summary: m.content.substring(0, 30) + (m.content.length > 30 ? "..." : ""),
      commentText: text || "分享朋友圈动态"
    };

    // 查找或自动创建与目标角色的 Session 会话，保障投递不报错
    const activeMeId = localStorage.getItem("active_me_id");
    const userIdNum = Number(activeMeId);

    let session = await db.sessions.where('userId').equals(userIdNum).and(s => s.charId === targetCharId).first();
    if (!session) {
      const sId = await db.sessions.add({
        userId: userIdNum,
        charId: targetCharId,
        lastMessageTime: Date.now()
      });
      session = await db.sessions.get(sId);
    }

    // 往单聊会话中添加一条转发动态类别的自定义消息
    await db.messages.add({
      sessionId: session.id,
      senderType: 'user',
      senderId: userIdNum,
      content: JSON.stringify(shareData),
      contentType: 'moment_share',
      timestamp: Date.now()
    });

    // 更新最后通讯时间
    await db.sessions.update(session.id, { lastMessageTime: Date.now() });

    document.getElementById("moments-forward-dialog-overlay").classList.remove("active");
    showToast("已成功转发共享至聊天会话！");
    closeApp('moments');
    
    // 打开单聊层并高亮渲染
    if (typeof openWeChatDialog === "function") {
      openWeChatDialog(session.id);
    }
  },

  // 从单聊会话卡片跳转到朋友圈动态定位处
  async openMomentFromShare(momentId) {
    // 1. 关闭微信单聊层
    if (typeof closeChatDialog === "function") {
      closeChatDialog();
    }
    // 2. 唤醒并打开微信应用主体
    if (typeof openApp === "function") {
      openApp('chat');
    }

    // 3. 触发底层 Tab 按钮模拟点击切换到朋友圈 Tab
    const tabMoments = document.querySelector('[data-chat-tab="moments"]');
    if (tabMoments) {
      tabMoments.click();
    }

    // 4. 重绘最新朋友圈动态
    await this.renderFeed();

    // 5. 延迟滚动高亮定位
    setTimeout(() => {
      const targetEl = document.querySelector(`.moment-post-card[data-moment-id="${momentId}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 柔和地闪烁浅黄色，提示视觉落点
        targetEl.style.transition = 'background-color 0.4s ease';
        targetEl.style.backgroundColor = '#fef08a';
        setTimeout(() => {
          targetEl.style.backgroundColor = '#ffffff';
        }, 1500);
      }
    }, 300);
  },

  // ========================================================
  //             【社交反应链 1:N 深度逻辑】
  // ========================================================

  // 1. 获取赞、评论反应，优先使用发圈时勾选可见的群友范围
  async triggerAIReaction(momentId) {
    const m = await db.moments.get(momentId);
    if (!m) return;

    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) return;

    // 优先使用可见人列表 (从已建立会话的多选列表缓存获取)，若无则降级拉取全部
    const visibleCharIds = m.visibleCharIds || [];
    const reactiveCharIds = visibleCharIds.filter(id => id !== m.senderId);

    if (reactiveCharIds.length === 0) {
      showToast("没有可以产生反应的可见角色。");
      return;
    }

    const luckyCharId = reactiveCharIds[Math.floor(Math.random() * reactiveCharIds.length)];
    await this.requestCharReactionToMoment(luckyCharId, m, api);
    await this.renderFeed();
  },

  // 2. 新动态自发布社交反应
  async triggerAIsFeedbacksOnPost(momentId, charIds) {
    const m = await db.moments.get(momentId);
    if (!m || !charIds || charIds.length === 0) return;

    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) return;

    let delay = 1000;
    for (let charId of charIds) {
      if (charId === m.senderId) continue; // 排除发布者自赞自评
      setTimeout(async () => {
        await this.requestCharReactionToMoment(charId, m, api);
        await this.renderFeed();
      }, delay);
      delay += 3500;
    }
  },

  // 请求单条朋友圈大模型回复与点赞
  async requestCharReactionToMoment(charId, moment, api) {
    const char = await db.archives.get(charId);
    if (!char) return;

    const author = await db.archives.get(moment.senderId);
    const authorName = moment.senderType === 'user' ? "我" : (author?.name || "伙伴");

    let imagesText = "";
    if (moment.images && moment.images.length > 0) {
      imagesText = moment.images.map((img, i) => `[配图 ${i+1} 描述: ${img.desc || "无"}]`).join("\n");
    }

    const prompt = `你扮演好友 [${char.name}]。详细设定：
${char.persona}

【朋友圈动态】：
发布者：[${authorName}]
内容：“ ${moment.content} ”
${imagesText}

你需要产生符合你性格特色的社交动作。
【反应交互指令】：
- 如果你想点赞，请在末尾独占一行输出：[LIKE]
- 如果你想评论，请在末尾独占一行输出：[COMMENT] 评论内容
- 如果你想转发，请在末尾独占一行输出：[SHARE] 转发评论文本

请直接进行动作反馈。`;

    try {
      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8
        })
      });

      if (!response.ok) return;
      const result = await response.json();
      const reply = result.choices[0].message.content.trim();

      const lines = reply.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      let isLiked = false;
      let commentsText = "";
      let shareText = "";

      lines.forEach(line => {
        if (line.toUpperCase() === "[LIKE]") {
          isLiked = true;
        } else if (line.toUpperCase().startsWith("[COMMENT]")) {
          commentsText = line.substring(9).trim();
        } else if (line.toUpperCase().startsWith("[SHARE]")) {
          shareText = line.substring(7).trim();
        }
      });

      if (!isLiked && !commentsText && !shareText && lines[0]) {
        commentsText = lines[0];
      }

      if (isLiked) {
        let likes = moment.likes || [];
        if (!likes.includes(charId)) {
          likes.push(charId);
          await db.moments.update(moment.id, { likes });
        }
      }

      if (commentsText) {
        await db.moment_comments.add({
          momentId: moment.id,
          senderType: 'char',
          senderId: charId,
          content: commentsText,
          timestamp: Date.now()
        });
      }

      if (shareText) {
        const shareData = {
          momentId: moment.id,
          authorName: authorName,
          forwarderName: char.name,
          summary: moment.content.substring(0, 30),
          commentText: shareText
        };
        await db.messages.add({
          sessionId: activeSessionId,
          senderType: 'char',
          senderId: charId,
          content: JSON.stringify(shareData),
          contentType: 'moment_share',
          timestamp: Date.now()
        });
      }
    } catch(e) {}
  },

  // 评论后触发可见人多重回复反应网 (多层层级反应深度融合)
  async triggerAIReactionsOnComment(momentId, commentId) {
    const m = await db.moments.get(momentId);
    const comment = await db.moment_comments.get(commentId);
    if (!m || !comment) return;

    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));
    if (!api) return;

    const visibleCharIds = m.visibleCharIds || [];
    
    let delay = 1500;
    for (let charId of visibleCharIds) {
      if (charId === comment.senderId) continue;

      setTimeout(async () => {
        const char = await db.archives.get(charId);
        if (!char) return;

        const mAuthor = await db.archives.get(m.senderId);
        const mAuthorName = m.senderType === 'user' ? "我" : (mAuthor?.name || "伙伴");

        const commenter = await db.archives.get(comment.senderId);
        const commenterName = comment.senderType === 'user' ? "我" : (commenter?.name || "伙伴");

        let parentCommentText = "";
        let parentCommenterName = "";
        if (comment.replyToCommentId) {
          const parent = await db.moment_comments.get(comment.replyToCommentId);
          if (parent) {
            parentCommentText = parent.content;
            const pa = await db.archives.get(parent.senderId);
            parentCommenterName = parent.senderType === 'user' ? "我" : (pa?.name || "伙伴");
          }
        }

        const prompt = `你扮演角色 [${char.name}]。详细设定：
${char.persona}

【朋友圈动态】：
发布者：[${mAuthorName}]
内容：“ ${m.content} ”

【刚才发生的新评论】：
[${commenterName}] 发表了新评论：“ ${comment.content} ”
${parentCommentText ? `这是对 [${parentCommenterName}] 之前评论（“ ${parentCommentText} ”）的回复。` : ""}

你需要根据你的社交态度，决定是否对此产生互动反馈（你可以选择回复这个评论，或者点赞）。
【动作指令说明】：
- 如果你想回复此评论，请另起一行输出：[COMMENT_REPLY] 你的回复台词
- 如果你想点赞动态，请另起一行输出：[LIKE]`;

        try {
          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.8
            })
          });

          if (response.ok) {
            const res = await response.json();
            const reply = res.choices[0].message.content.trim();

            const lines = reply.split("\n").map(l => l.trim()).filter(l => l.length > 0);
            let isLiked = false;
            let replyText = "";

            lines.forEach(line => {
              if (line.toUpperCase() === "[LIKE]") {
                isLiked = true;
              } else if (line.toUpperCase().startsWith("[COMMENT_REPLY]")) {
                replyText = line.substring(15).trim();
              }
            });

            if (isLiked) {
              let likes = m.likes || [];
              if (!likes.includes(charId)) {
                likes.push(charId);
                await db.moments.update(m.id, { likes });
              }
            }

            if (replyText) {
              await db.moment_comments.add({
                momentId: m.id,
                senderType: 'char',
                senderId: charId,
                content: replyText,
                replyToCommentId: comment.id,
                timestamp: Date.now()
              });
            }

            await this.renderFeed();
          }
        } catch(e) {}
      }, delay);
      delay += 3500;
    }
  },

  // ========================================================
  //             【自发布定时触发朋友圈巡航】
  // ========================================================

  // 改进：设置页里的立即发朋友圈按钮应该实时抓取当前高亮（打勾）的角色。
  async triggerInstantCharPost() {
    const activeMeId = localStorage.getItem("active_me_id");
    if (!activeMeId) {
      showToast("请先选择我的人设！");
      return;
    }

    // 实时抓取设置容器里当前 checked 状态为 true 的全部卡片
    const checkedCards = document.querySelectorAll("#moments-char-cards-container .moments-char-card[data-checked='true']");
    const activeCharIds = Array.from(checkedCards).map(card => Number(card.getAttribute("data-char-id")));

    if (activeCharIds.length === 0) {
      showToast("当前设置页没有选中任何要生成朋友圈的角色！");
      return;
    }

    const btn = document.getElementById("btn-moments-instant-post");
    const origText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "生成多重动态中...";

    try {
      for (let charId of activeCharIds) {
        await this.requestCharSendMoment(charId);
      }
      showToast("选中的高亮角色朋友圈动态生成成功！");
      document.getElementById("moments-settings-overlay").classList.remove("active");
      await this.renderFeed();
    } catch(e) {
      showCustomAlert("生成朋友圈失败", e.message);
    } finally {
      btn.disabled = false;
      btn.innerText = origText;
    }
  },

  // 角色发送朋友圈逻辑
  async requestCharSendMoment(charId) {
    const activeMeId = localStorage.getItem("active_me_id");
    const userIdNum = Number(activeMeId);

    const char = await db.archives.get(charId);
    const presetId = localStorage.getItem("global_api_preset_id");
    const api = await db.api_presets.get(Number(presetId));

    if (!char || !api) return;

    const prompt = `你扮演微信朋友圈活跃用户 [${char.name}]。详细设定：
${char.persona}

你现在需要发送一条朋友圈动态来记录和倾诉你当前的状态和心理。
【要求与规范】：
1. 绝对不能出现任何 Emoji 字符！
2. 保持第一人称或符合你性格的口吻。
3. 如果你想配合此时朋友圈附加配图，请在最尾部另起一行输出：[MOMENT_IMAGE] 你的细腻画面场景场景描述

【正确示例】：
今天路过旧书店，带走了一本泛黄的诗集。感觉时间在这里走得很慢。
[MOMENT_IMAGE] 泛黄的纸张上印着模糊的字迹，旁边放着一杯温热的红茶`;

    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9
      })
    });

    if (!response.ok) throw new Error("API 响应失败");
    const result = await response.json();
    let reply = result.choices[0].message.content.trim();

    let imageDesc = "";
    const imgRegex = /[\[【]MOMENT_IMAGE[\]】]\s*([\s\S]*?)$/i;
    const match = reply.match(imgRegex);
    if (match) {
      imageDesc = match[1].trim();
      reply = reply.replace(imgRegex, "").trim();
    }

    const images = [];
    if (imageDesc) {
      images.push({ url: "", desc: imageDesc });
    }

    const allChars = await this.getEstablishedChars(userIdNum);
    const sameGroupChars = allChars.filter(c => c.group === (char.group || "默认分组"));
    const sameGroupCharIds = sameGroupChars.map(c => c.id);

    const momentId = await db.moments.add({
      userId: userIdNum,
      senderType: 'char',
      senderId: charId,
      content: reply,
      images: images,
      likes: [],
      visibleCharIds: sameGroupCharIds, // 同分组角色可见
      timestamp: Date.now()
    });

    const coGroupCharIds = sameGroupCharIds.filter(id => id !== charId);
    this.triggerAIsFeedbacksOnPost(momentId, coGroupCharIds);
  },

  // 启动后台定时器巡航
  startBackgroundTimer() {
    if (this.timerId) clearInterval(this.timerId);

    const checkAndTrigger = async () => {
      const activeMeId = localStorage.getItem("active_me_id");
      if (!activeMeId) return;
      const userIdNum = Number(activeMeId);

      const settings = await db.moment_settings.where('userId').equals(userIdNum).first();
      if (!settings || settings.isTimerEnabled !== 1) return;

      const lastMoment = await db.moments.where('userId').equals(userIdNum).sortBy('timestamp');
      const latestTime = lastMoment.length > 0 ? lastMoment[lastMoment.length - 1].timestamp : 0;

      const intervalMs = (settings.timerInterval || 30) * 60000;
      if (Date.now() - latestTime >= intervalMs) {
        const activeCharIds = settings.activeCharIds || [];
        if (activeCharIds.length > 0) {
          const luckyCharId = activeCharIds[Math.floor(Math.random() * activeCharIds.length)];
          try {
            await this.requestCharSendMoment(luckyCharId);
            if (currentChatTab === 'moments') {
              await this.renderFeed();
            }
          } catch(e) {
            console.error("定时器自发朋友圈错误:", e);
          }
        }
      }
    };

    this.timerId = setInterval(checkAndTrigger, 60000);
  }
};

// 挂载跳转桥梁
window.openMomentFromShare = function(momentId) {
  momentSystem.openMomentFromShare(momentId);
};
window.momentSystem = momentSystem;