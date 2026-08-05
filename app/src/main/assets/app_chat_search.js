/**
 * ============================================================
 * app_chat_search.js - 叙事诗小手机：QQ风格聊天记录搜索中枢
 * ============================================================
 */
(function() {
  const chatSearchSystem = {
    // 1. 开启搜索覆盖页面
    openSearchPage: function() {
      const parent = document.getElementById("win-chat");
      if (!parent) return;

      let overlay = document.getElementById("chat-search-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "chat-search-overlay";
        overlay.className = "chat-search-overlay";
        overlay.innerHTML = `
          <header class="chat-search-header">
            <button class="btn-icon" onclick="chatSearchSystem.closeSearchPage()" style="margin-right: 4px; border:none; background:none; cursor:pointer; color:var(--text-primary); display:flex; align-items:center;">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
            <div class="chat-search-input-wrapper">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="chat-search-input" class="chat-search-input" placeholder="输入关键词查找聊天记录" oninput="chatSearchSystem.onInputChanged(this.value)">
              <span id="chat-search-clear-btn" class="chat-search-clear-btn" onclick="chatSearchSystem.clearInput()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </span>
            </div>
          </header>
          <div class="chat-search-results-area" id="chat-search-results-area">
            <div class="chat-search-empty-state">输入关键词开始查找聊天记录</div>
          </div>
        `;
        parent.appendChild(overlay);
      }

      // 每次打开重置状态
      const input = document.getElementById("chat-search-input");
      if (input) {
        input.value = "";
        setTimeout(() => input.focus(), 100);
      }
      const resultsArea = document.getElementById("chat-search-results-area");
      if (resultsArea) {
        resultsArea.innerHTML = '<div class="chat-search-empty-state">输入关键词开始查找聊天记录</div>';
      }
      const clearBtn = document.getElementById("chat-search-clear-btn");
      if (clearBtn) clearBtn.classList.remove("visible");

      overlay.classList.add("active");
    },

    // 2. 关闭搜索页面
    closeSearchPage: function() {
      const overlay = document.getElementById("chat-search-overlay");
      if (overlay) {
        overlay.classList.remove("active");
      }
    },

    // 3. 一键清空输入
    clearInput: function() {
      const input = document.getElementById("chat-search-input");
      if (input) {
        input.value = "";
        input.focus();
      }
      const clearBtn = document.getElementById("chat-search-clear-btn");
      if (clearBtn) clearBtn.classList.remove("visible");
      this.onInputChanged("");
    },

    // 4. 输入变更，实时检索 IndexedDB 存储
    onInputChanged: async function(keyword) {
      const clearBtn = document.getElementById("chat-search-clear-btn");
      if (clearBtn) {
        if (keyword) clearBtn.classList.add("visible");
        else clearBtn.classList.remove("visible");
      }

      const resultsArea = document.getElementById("chat-search-results-area");
      if (!resultsArea) return;

      if (!keyword.trim()) {
        resultsArea.innerHTML = '<div class="chat-search-empty-state">输入关键词开始查找聊天记录</div>';
        return;
      }

      const activeMeId = Number(localStorage.getItem("active_me_id"));
      if (isNaN(activeMeId) || activeMeId <= 0) {
        resultsArea.innerHTML = '<div class="chat-search-empty-state" style="color: #ef4444;">请先在“我的”选项卡中选择并切换我的人设！</div>';
        return;
      }

      try {
        // 查找属于当前人设的全部线上会话列表，实现物理人设隔离
        const sessions = await db.sessions.where('userId').equals(activeMeId).toArray();
        if (sessions.length === 0) {
          resultsArea.innerHTML = '<div class="chat-search-empty-state">未找到匹配的聊天记录</div>';
          return;
        }

        const singleSessions = sessions.filter(s => s.isGroup !== 1);
        const groupSessions = sessions.filter(s => s.isGroup === 1);

        const singleSessionIds = singleSessions.map(s => s.id);
        const groupSessionIds = groupSessions.map(s => s.id);

        // 检索匹配内容
        const matchedMessages = await db.messages
          .filter(m => {
            return (singleSessionIds.includes(m.sessionId) || groupSessionIds.includes(m.sessionId)) &&
                   m.isRecalled !== 1 &&
                   typeof m.content === 'string' &&
                   m.content.toLowerCase().includes(keyword.toLowerCase());
          })
          .toArray();

        if (matchedMessages.length === 0) {
          resultsArea.innerHTML = '<div class="chat-search-empty-state">未找到匹配的聊天记录</div>';
          return;
        }

        // 按照时间从远到近（时间从上到下顺序排列）进行排序
        matchedMessages.sort((a, b) => a.timestamp - b.timestamp);

        const matchedSingleMsgs = matchedMessages.filter(m => singleSessionIds.includes(m.sessionId));
        const matchedGroupMsgs = matchedMessages.filter(m => groupSessionIds.includes(m.sessionId));

        resultsArea.innerHTML = "";

        // 渲染单聊记录
        if (matchedSingleMsgs.length > 0) {
          const singleSection = document.createElement("div");
          singleSection.className = "chat-search-category-section";
          singleSection.innerHTML = `<div class="chat-search-category-title">单聊记录 (${matchedSingleMsgs.length})</div>`;
          
          for (let m of matchedSingleMsgs) {
            const sess = singleSessions.find(s => s.id === m.sessionId);
            const char = sess ? await db.archives.get(sess.charId) : null;
            const sessionName = sess?.customCharName || char?.name || "未知角色";
            const sessionAvatar = resolveAvatar(sess?.customCharAvatar || char?.avatar);

            let senderName = "对方";
            if (m.senderType === 'user') {
              const user = sess ? await db.archives.get(sess.userId) : null;
              senderName = sess?.customUserName || user?.name || "我";
            } else {
              senderName = sessionName;
            }

            const highlightedContent = this.highlightText(m.content, keyword);
            const displayTime = formatWeChatTime(new Date(m.timestamp), new Date());

            const item = document.createElement("div");
            item.className = "chat-search-result-item";
            item.onclick = () => this.goToMessage(m.sessionId, m.id);
            item.innerHTML = `
              <img class="chat-search-result-avatar" src="${sessionAvatar}">
              <div class="chat-search-result-info">
                <div class="chat-search-result-meta">
                  <span class="chat-search-result-name">${escapeHtml(sessionName)}</span>
                  <span class="chat-search-result-time">${displayTime}</span>
                </div>
                <div class="chat-search-result-content">
                  <strong style="font-weight: 700; color: #475569;">${escapeHtml(senderName)}: </strong>${highlightedContent}
                </div>
              </div>
            `;
            singleSection.appendChild(item);
          }
          resultsArea.appendChild(singleSection);
        }

        // 渲染群聊记录
        if (matchedGroupMsgs.length > 0) {
          const groupSection = document.createElement("div");
          groupSection.className = "chat-search-category-section";
          groupSection.innerHTML = `<div class="chat-search-category-title">群聊记录 (${matchedGroupMsgs.length})</div>`;
          
          for (let m of matchedGroupMsgs) {
            const sess = groupSessions.find(s => s.id === m.sessionId);
            const group = sess ? await db.groups.get(sess.groupId) : null;
            const sessionName = sess?.customCharName || group?.name || "未知群聊";
            const sessionAvatar = resolveAvatar(sess?.customCharAvatar || group?.avatar);

            let senderName = "未知群员";
            if (Number(m.senderId) === 99999) {
              senderName = "群助手";
            } else if (m.senderType === 'user') {
              const user = sess ? await db.archives.get(sess.userId) : null;
              senderName = sess?.customUserName || user?.name || "我";
            } else {
              const char = await db.archives.get(Number(m.senderId));
              senderName = char ? char.name : "群员";
            }

            const highlightedContent = this.highlightText(m.content, keyword);
            const displayTime = formatWeChatTime(new Date(m.timestamp), new Date());

            const item = document.createElement("div");
            item.className = "chat-search-result-item";
            item.onclick = () => this.goToMessage(m.sessionId, m.id);
            item.innerHTML = `
              <img class="chat-search-result-avatar" src="${sessionAvatar}">
              <div class="chat-search-result-info">
                <div class="chat-search-result-meta">
                  <span class="chat-search-result-name">${escapeHtml(sessionName)}</span>
                  <span class="chat-search-result-time">${displayTime}</span>
                </div>
                <div class="chat-search-result-content">
                  <strong style="font-weight: 700; color: #475569;">${escapeHtml(senderName)}: </strong>${highlightedContent}
                </div>
              </div>
            `;
            groupSection.appendChild(item);
          }
          resultsArea.appendChild(groupSection);
        }

      } catch (err) {
        console.error("搜索聊天记录失败:", err);
        resultsArea.innerHTML = '<div class="chat-search-empty-state" style="color: #ef4444;">搜索失败: ' + escapeHtml(err.message) + '</div>';
      }
    },

    highlightText: function(text, keyword) {
      if (!text) return "";
      const index = text.toLowerCase().indexOf(keyword.toLowerCase());
      if (index === -1) return escapeHtml(text);

      const before = text.substring(0, index);
      const match = text.substring(index, index + keyword.length);
      const after = text.substring(index + keyword.length);

      return escapeHtml(before) + 
             `<span class="chat-search-highlight-keyword">${escapeHtml(match)}</span>` + 
             escapeHtml(after);
    },

    // 5. 点击跳转至指定对话气泡，实现高保真QQ式闪烁定位
    goToMessage: async function(sessionId, msgId) {
      this.closeSearchPage();

      // 强制关闭所有前置叠加的设置后台，清空视窗
      const detailsPanel = document.getElementById("chat-details-panel");
      if (detailsPanel) detailsPanel.classList.remove("active");
      const groupDetailsPanel = document.getElementById("group-details-panel");
      if (groupDetailsPanel) groupDetailsPanel.classList.remove("active");

      // 打开微信对应对话窗
      if (typeof openWeChatDialog === 'function') {
        await openWeChatDialog(sessionId);
      }

      // 开启在轨微秒轮询探查
      let attempts = 0;
      const maxAttempts = 20; // 最大等待1秒
      const checkInterval = 50;

      const interval = setInterval(() => {
        const el = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (el) {
          clearInterval(interval);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // 注入 QQ 风格高亮闪动效果
          el.classList.add('chat-search-highlight-flash');
          setTimeout(() => {
            el.classList.remove('chat-search-highlight-flash');
          }, 2000);
        } else {
          attempts++;
          if (attempts >= maxAttempts) {
            clearInterval(interval);
          }
        }
      }, checkInterval);
    }
  };

  // 6. 追加系统级内置样式至 Head 头部
  const searchStyle = document.createElement("style");
  searchStyle.textContent = `
    .chat-search-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: #f4f6fa;
      z-index: 1050;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .chat-search-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .chat-search-header {
      height: 50px;
      background-color: #ffffff;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 8px;
      flex-shrink: 0;
    }
    .chat-search-input-wrapper {
      flex: 1;
      background-color: transparent;
      height: 36px;
      display: flex;
      align-items: center;
      padding: 0;
      gap: 6px;
    }
    .chat-search-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 14px;
      color: var(--text-primary);
      outline: none;
      font-weight: 500;
    }
    .chat-search-clear-btn {
      color: #94a3b8;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .chat-search-clear-btn.visible {
      display: flex;
    }
    .chat-search-results-area {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .chat-search-category-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-search-category-title {
      font-size: 11px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 4px;
    }
    .chat-search-result-item {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      box-shadow: var(--shadow-sm);
    }
    .chat-search-result-item:active {
      transform: scale(0.98);
      background: #f8fafc;
    }
    .chat-search-result-avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      object-fit: cover;
      background-color: #cbd5e1;
      flex-shrink: 0;
    }
    .chat-search-result-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      text-align: left;
    }
    .chat-search-result-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chat-search-result-name {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chat-search-result-time {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
    }
    .chat-search-result-content {
      font-size: 12.5px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }
    .chat-search-highlight-keyword {
      color: #3b82f6;
      background-color: #eff6ff;
      font-weight: 700;
      padding: 0 2px;
      border-radius: 2px;
    }
    .chat-search-empty-state {
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      margin-top: 40px;
      font-weight: 500;
    }
    
    @keyframes chatSearchFlash {
      0% { background-color: transparent; }
      30% { background-color: rgba(59, 130, 246, 0.2); }
      70% { background-color: rgba(59, 130, 246, 0.2); }
      100% { background-color: transparent; }
    }
    .chat-search-highlight-flash {
      animation: chatSearchFlash 2.0s ease-in-out;
      border-radius: 8px;
    }
  `;
  document.head.appendChild(searchStyle);

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }

  window.chatSearchSystem = chatSearchSystem;
})();