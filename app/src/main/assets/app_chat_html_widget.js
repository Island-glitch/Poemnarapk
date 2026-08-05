/**
 * app_chat_html_widget.js - HTML 互动舱生成与安全沙盘渲染控制 (带无损视图清洗切换版)
 */

(function() {
  const chatHtmlWidgetSystem = {
    activeRepairCardId: null,
    
    // 用于存储当前处于“清洗视图”状态的卡片 ID 集合 (内存状态机，不污染数据库)
    cleanedCardIds: new Set(),

    // 开启 HTML 主界面
    openPanel: async function() {
      if (!activeSessionId) {
        alert("请先进入某位角色的聊天对话界面，再执行 HTML 生成。");
        return;
      }
      document.getElementById("chat-html-panel").classList.add("active");
      await this.loadCards();
    },

    // 关闭主界面
    closePanel: function() {
      document.getElementById("chat-html-panel").classList.remove("active");
    },

    // 载入历史卡片
    loadCards: async function() {
      const container = document.getElementById("html-cards-container");
      if (!container) return;
      
      container.innerHTML = `<div style="text-align:center; padding: 20px; color: #818cf8;">[GEN_PROTOCOL] 正在同步本地物理协议组件...</div>`;

      try {
        const cards = await db.html_cards.where('sessionId').equals(activeSessionId).sortBy('timestamp');
        if (cards.length === 0) {
          container.innerHTML = `
            <div style="text-align:center; color: #8f9cae; font-size:13px; padding:40px 0;">
              <p>[无生成的 HTML 互动协议卡片]</p>
              <p style="font-size: 11px; margin-top: 6px; color: rgba(99, 102, 241, 0.4)">点击右上角 + 开始构建卡片</p>
            </div>`;
          return;
        }

        container.innerHTML = "";
        cards.reverse().forEach(card => {
          const isCleaned = this.cleanedCardIds.has(card.id);
          const cleanBtnColor = isCleaned ? "#10b981" : "#94a3b8"; // 激活显示绿色，未激活显示温和灰
          const cleanBtnTitle = isCleaned ? "已开启重绘清洗（点击恢复 AI 原始返回）" : "一键清洗代码（自动剥离多余对话说明）";

          const cardEl = document.createElement("div");
          cardEl.className = "html-card";
          // 指令超 150 字时折叠为一行，点击可展开
          const promptText = String(card.prompt || '');
          const isLongPrompt = promptText.length > 150;
          const promptCollapsed = isLongPrompt ? promptText.slice(0, 150) + '...' : promptText;

          cardEl.innerHTML = `
            <div class="html-card-header">
              <span class="html-card-title">WIDGET_PROTOCOL_ID: #${card.id}</span>
              <div style="display: flex; gap: 10px;">
                <!-- 大卡片预览按钮 (展开全屏预览) -->
                <button class="btn-icon" onclick="chatHtmlWidgetSystem.openPreview(${card.id})" style="color: #34d399;" title="展开大卡片预览">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
                  </svg>
                </button>
                <!-- 一键清洗按钮 (支持无损双态切换) -->
                <button class="btn-icon" id="btn-clean-${card.id}" onclick="chatHtmlWidgetSystem.cleanCard(${card.id})" style="color: ${cleanBtnColor};" title="${cleanBtnTitle}">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3v1m0 16v1m9-9h-1M3 12H2m15.24-7.24l-.7.7M6.46 17.54l-.7.7M17.54 17.54l.7.7M6.46 6.46l.7-.7M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0z"/>
                  </svg>
                </button>
                <!-- 维修按钮 (扳手) -->
                <button class="btn-icon" onclick="chatHtmlWidgetSystem.openRepair(${card.id})" style="color: #818cf8;" title="维修组件代码">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.3C.5 6.7.9 9.8 2.9 11.8c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.4-2.4c.4-.4.4-1.1 0-1.4z"/>
                  </svg>
                </button>
                <!-- 删除按钮 -->
                <button class="btn-icon" onclick="chatHtmlWidgetSystem.deleteCard(${card.id})" style="color: #fda4af;" title="粉碎组件">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
            <div class="html-card-prompt${isLongPrompt ? ' html-card-prompt-collapsible' : ''}" id="html-card-prompt-${card.id}" ${isLongPrompt ? `data-collapsed="1" onclick="chatHtmlWidgetSystem.togglePrompt(${card.id})"` : ''}>
              <span class="html-card-prompt-prefix">指令: </span><span class="html-card-prompt-text">${escapeHtml(promptCollapsed)}</span>${isLongPrompt ? '<span class="html-card-prompt-toggle"> ▼ 展开</span>' : ''}
            </div>
            <div class="html-card-iframe-container">
              <iframe id="html-iframe-${card.id}" sandbox="allow-scripts"></iframe>
              <button class="html-card-preview-btn" onclick="chatHtmlWidgetSystem.openPreview(${card.id})" title="展开大卡片预览">⤢ 大卡片预览</button>
            </div>
            <!-- 时间脚标下移至卡片右下角 -->
            <div class="html-card-footer">
              <span class="html-card-time">${new Date(card.timestamp).toLocaleString()}</span>
            </div>
          `;
          container.appendChild(cardEl);

          const iframe = document.getElementById(`html-iframe-${card.id}`);
          if (iframe) {
            if (isCleaned) {
              const cleaned = this.extractCleanHtml(card.html);
              this.loadHtmlInSandbox(iframe, cleaned);
            } else {
              this.loadHtmlInSandbox(iframe, card.html);
            }
          }
        });
      } catch (err) {
        console.error("加载卡片失败: ", err);
        container.innerHTML = `<div style="color: #fda4af; padding:20px;">[ERROR] 同步协议组件失败: ${err.message}</div>`;
      }
    },

    // 删除卡片
    deleteCard: async function(id) {
      if (confirm("确定要永久粉碎此 HTML 互动卡片吗？")) {
        await db.html_cards.delete(id);
        this.cleanedCardIds.delete(id); // 物理删除运行时状态
        await this.loadCards();
      }
    },

    // 折叠/展开超长指令文本（>150 字）
    togglePrompt: function(id) {
      const el = document.getElementById(`html-card-prompt-${id}`);
      if (!el) return;
      const textEl = el.querySelector('.html-card-prompt-text');
      const toggleEl = el.querySelector('.html-card-prompt-toggle');
      if (!textEl) return;
      const collapsed = el.getAttribute('data-collapsed') === '1';
      db.html_cards.get(id).then(card => {
        if (!card) return;
        if (collapsed) {
          // 当前折叠态 -> 展开
          textEl.textContent = card.prompt || '';
          if (toggleEl) toggleEl.textContent = ' ▲ 收起';
          el.setAttribute('data-collapsed', '0');
        } else {
          // 当前展开态 -> 折叠
          const p = String(card.prompt || '');
          textEl.textContent = p.slice(0, 150) + '...';
          if (toggleEl) toggleEl.textContent = ' ▼ 展开';
          el.setAttribute('data-collapsed', '1');
        }
      });
    },

    // 大卡片全屏预览：把 HTML 渲染到一个尺寸很大的全屏浮层 iframe 内
    openPreview: async function(id) {
      const card = await db.html_cards.get(id);
      if (!card) { alert("卡片数据不存在"); return; }

      // 复用清洗态：若该卡片处于清洗视图，预览也用清洗后的代码
      let htmlToRender = card.html;
      if (this.cleanedCardIds.has(id)) {
        htmlToRender = this.extractCleanHtml(card.html);
      } else {
        // 顺带做基础 markdown 代码块剥离，保证预览能渲染
        htmlToRender = this.extractCleanHtml(card.html);
      }

      // 移除已存在的预览浮层
      const existed = document.getElementById('html-preview-fullscreen-overlay');
      if (existed) existed.remove();

      const overlay = document.createElement('div');
      overlay.id = 'html-preview-fullscreen-overlay';
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100vw', 'height:100vh',
        'background:rgba(0,0,0,0.85)', 'z-index:9999',
        'display:flex', 'flex-direction:column',
        'animation:htmlPreviewFadeIn 0.2s ease'
      ].join(';');

      overlay.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 18px; background:#0f172a; border-bottom:1px solid #334155; flex-shrink:0;">
          <div style="color:#f1f5f9; font-size:13px; font-weight:700;">
            <span style="color:#34d399;">⤢</span> 大卡片预览 · WIDGET #${card.id}
            <span style="color:#64748b; font-weight:400; font-size:11px; margin-left:8px;">${escapeHtml(String(card.prompt || '').slice(0, 60))}${(card.prompt||'').length > 60 ? '...' : ''}</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button id="html-preview-refresh-btn" style="background:#334155; color:#cbd5e1; border:none; border-radius:6px; padding:6px 12px; font-size:11px; cursor:pointer; font-weight:600;">⟳ 刷新</button>
            <button id="html-preview-close-btn" style="background:#ef4444; color:#fff; border:none; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer; font-weight:700;">✕ 关闭</button>
          </div>
        </div>
        <div style="flex:1; display:flex; justify-content:center; align-items:center; padding:18px; overflow:auto; background:#1e293b;">
          <iframe id="html-preview-fullscreen-iframe" sandbox="allow-scripts allow-popups allow-forms" style="width:100%; max-width:480px; height:100%; max-height:880px; background:#fff; border:1px solid #475569; border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,0.5);"></iframe>
        </div>
      `;

      document.body.appendChild(overlay);

      const iframe = document.getElementById('html-preview-fullscreen-iframe');
      // 使用 srcdoc 注入，配合 allow-scripts 沙盒
      this.loadHtmlInSandbox(iframe, htmlToRender);

      // 关闭按钮
      document.getElementById('html-preview-close-btn').onclick = () => overlay.remove();
      // 刷新按钮（重新加载一次，方便 JS 动画重启）
      document.getElementById('html-preview-refresh-btn').onclick = () => {
        this.loadHtmlInSandbox(iframe, htmlToRender);
      };
      // 点击遮罩空白处也可关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
      // ESC 关闭
      const escHandler = (e) => {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
      };
      document.addEventListener('keydown', escHandler);
    },

    // 精准剥离Conversational冗余文字的提取算法
    extractCleanHtml: function(rawCode) {
      let code = rawCode.trim();
      
      // 1. 尝试从 Markdown 代码块（如 ```html ... ```）中剥离提取
      const mdRegex = /```(?:html|xml|javascript|css)?([\s\S]*?)```/i;
      const match = code.match(mdRegex);
      if (match && match[1]) {
        return match[1].trim();
      }
      
      // 2. 尝试提取 <html> 至 </html> 完整结构
      const htmlRegex = /(<html[\s\S]*?<\/html>)/i;
      const htmlMatch = code.match(htmlRegex);
      if (htmlMatch && htmlMatch[1]) {
        return htmlMatch[1].trim();
      }

      // 3. 托底：提取首个“<”到最末尾“>”的所有字符
      const firstAngle = code.indexOf("<");
      const lastAngle = code.lastIndexOf(">");
      if (firstAngle !== -1 && lastAngle > firstAngle) {
        return code.substring(firstAngle, lastAngle + 1).trim();
      }
      
      return code;
    },

    // 执行一键清洗卡片 (只动运行时渲染效果，不修改 IndexedDB 数据库)
    cleanCard: function(id) {
      const iframe = document.getElementById(`html-iframe-${id}`);
      const btn = document.getElementById(`btn-clean-${id}`);
      if (!iframe) return;

      db.html_cards.get(id).then(card => {
        if (!card) return;

        if (this.cleanedCardIds.has(id)) {
          // 当前处于清洗态 -> 恢复到原始未清洗态
          this.cleanedCardIds.delete(id);
          this.loadHtmlInSandbox(iframe, card.html);
          if (btn) {
            btn.style.color = "#94a3b8"; // 恢复灰色
            btn.title = "一键清洗代码（自动剥离多余说明文字）";
          }
        } else {
          // 当前处于原始态 -> 切换至清洗态 (不修改数据库中的 card.html)
          this.cleanedCardIds.add(id);
          const cleaned = this.extractCleanHtml(card.html);
          this.loadHtmlInSandbox(iframe, cleaned);
          if (btn) {
            btn.style.color = "#10b981"; // 变亮绿
            btn.title = "已开启重绘清洗（点击恢复 AI 原始返回）";
          }
        }
      });
    },

    // 安全清洗并加载至 Iframe 中运行 (基础 Markdown 代码块剔除)
    loadHtmlInSandbox: function(iframe, htmlContent) {
      let cleanHtml = htmlContent.trim();
      
      if (cleanHtml.startsWith("```")) {
        cleanHtml = cleanHtml.replace(/^```[a-zA-Z]*\n?/, "");
        cleanHtml = cleanHtml.replace(/\n?```$/, "");
        cleanHtml = cleanHtml.trim();
      }
      
      iframe.srcdoc = cleanHtml;
    },

    // 动态生成并挂载代码编辑二级面板 (防止层级穿透与绝对定位污染)
    ensureRepairOverlay: function() {
      if (document.getElementById("html-repair-overlay")) return;

      const overlay = document.createElement("div");
      overlay.id = "html-repair-overlay";
      overlay.className = "repair-workspace-overlay";
      overlay.style.display = "none";
      overlay.innerHTML = `
        <header class="win-header">
          <button class="btn-icon" onclick="chatHtmlWidgetSystem.closeRepair()" style="color: #f1f5f9;">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <h3>代码维修舱</h3>
          <div style="width:40px;"></div>
        </header>
        <div class="repair-workspace-body">
          <div>
            <div class="repair-editor-title">📜 源代码编辑器 (始终加载最原始 AI 返回，可在此放心修理)</div>
            <textarea id="repair-code-editor" class="repair-textarea" placeholder="在此处输入组件源码..."></textarea>
          </div>
          
          <div>
            <div class="repair-preview-label">
              <span class="repair-editor-title">👁️ 实时测试编译效果</span>
              <span class="repair-preview-status" id="repair-preview-indicator">LIVE_COMPILE</span>
            </div>
            <div class="html-card-iframe-container" style="margin-top: 6px;">
              <iframe id="repair-preview-iframe" sandbox="allow-scripts"></iframe>
            </div>
          </div>

          <div style="display:flex; gap:10px; margin-top: auto; padding-bottom: 8px;">
            <button class="btn btn-outline" onclick="chatHtmlWidgetSystem.closeRepair()" style="flex:1; border-color:#475569; color:#94a3b8; background:transparent; border-radius:10px; height:42px; font-weight:600; cursor:pointer;">取消</button>
            <button class="btn btn-cyber" onclick="chatHtmlWidgetSystem.saveRepair()" style="flex:1; border-radius:10px; height:42px; font-weight:600;">保存并更新</button>
          </div>
        </div>
      `;

      // 完美收纳至 win-chat 容器中，保障层级一致性
      const winChat = document.getElementById("win-chat");
      if (winChat) {
        winChat.appendChild(overlay);
      } else {
        document.body.appendChild(overlay);
      }

      // 实时绑定：输入字符时秒级防抖触发预览重绘
      let debounceTimer = null;
      const editor = document.getElementById("repair-code-editor");
      if (editor) {
        editor.oninput = () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.updateRepairPreview();
          }, 300); // 300ms 延迟无防抖重绘
        };
      }
    },

    // 进入维修舱 (始终加载 IndexedDB 最原始返回)
    openRepair: async function(id) {
      this.ensureRepairOverlay();
      this.activeRepairCardId = id;

      const card = await db.html_cards.get(id);
      if (!card) {
        alert("未能从本地数据库载入当前协议组件。");
        return;
      }

      // 这里直接填充数据库中存储的 100% 原始代码
      document.getElementById("repair-code-editor").value = card.html;
      document.getElementById("html-repair-overlay").style.display = "flex";

      this.updateRepairPreview();
    },

    // 实时预览刷新
    updateRepairPreview: function() {
      const code = document.getElementById("repair-code-editor").value;
      const iframe = document.getElementById("repair-preview-iframe");
      if (iframe) {
        this.loadHtmlInSandbox(iframe, code);
      }
    },

    // 退出维修舱
    closeRepair: function() {
      const overlay = document.getElementById("html-repair-overlay");
      if (overlay) overlay.style.display = "none";
      this.activeRepairCardId = null;
    },

    // 仅在维修舱手动保存代码时，执行物理覆写并入库
    saveRepair: async function() {
      const newHtml = document.getElementById("repair-code-editor").value.trim();
      if (!newHtml) {
        alert("组件源代码不能为空。");
        return;
      }

      if (this.activeRepairCardId) {
        try {
          await db.html_cards.update(this.activeRepairCardId, { html: newHtml });
          alert("修复协议保存成功！卡片已实时编译更新。");
          this.closeRepair();
          await this.loadCards();
        } catch(err) {
          alert("保存卡片失败: " + err.message);
        }
      }
    },

    // 唤起生成模态窗
    openGenerateModal: function() {
      document.getElementById("html-generate-overlay").classList.add("active");
      document.getElementById("html-generate-prompt").value = "";
    },

    // 关闭生成模态窗
    closeGenerateModal: function() {
      document.getElementById("html-generate-overlay").classList.remove("active");
    },

    // 核心：携带聊天上下文、总结、记忆向大模型发起编译请求
    submitGeneration: async function() {
      const promptInput = document.getElementById("html-generate-prompt");
      const promptText = promptInput.value.trim();
      if (!promptText) {
        alert("请输入具体的构建创意要求。");
        return;
      }

      const loader = document.getElementById("html-cards-container");
      loader.innerHTML = `
        <div style="text-align:center; padding: 50px 0; color: #818cf8;">
          <div style="font-size: 14px; font-weight: bold; margin-bottom: 12px; text-shadow: 0 0 8px rgba(99, 102, 241, 0.4);">[COMPILING] 神经链接已建立，正在执行全域编译...</div>
          <div style="font-size: 11px; color: #8f9cae; margin-bottom: 20px;">[系统已融合历史总结、世界书及长周期核心心智]</div>
          <div class="status-loading-box" style="display:flex; justify-content:center; align-items:center;">
             <div class="spinner" style="border-top-color: #6366f1;"></div>
          </div>
        </div>
      `;

      this.closeGenerateModal();

      try {
        const presetId = localStorage.getItem("global_api_preset_id");
        if (!presetId) throw new Error("未配置全局默认 API，请前往‘系统设置 - API 协议设置’中配置并应用！");
        const api = await db.api_presets.get(Number(presetId));
        if (!api) throw new Error("所选的 API 预设可能已被删除，请重新配置！");

        // 1. 获取全局上下文 (包含人设、世界书、记忆、历史总结)
        const systemPrompt = await buildGlobalSystemPrompt(activeSessionId);

        // 2. 注入 HTML 卡片专用编译约束提示词（含情景强调）
        const htmlInstruction = await this.buildHtmlWidgetInstruction(activeSessionId);

        // 3. 拉取最新的 10 条线上上下文对话
        const history = await db.messages.where('sessionId').equals(activeSessionId).reverse().limit(10).toArray();
        history.reverse();

        const messagesToSend = [{ role: "system", content: systemPrompt + "\n\n" + htmlInstruction }];

        // 上下文标签清洗：将历史消息中的控制指令标签（思维链/[STATUS]/[TRANSLATE]/[AGREE_PAY]/
        // [TRANSFER]/[RED_PACKET]/[GIFT]/[PAY_FOR_ME]/[LOCATION]/[PLAY_MUSIC]/[SET_ALARM] 等）以及
        // 各类富卡片 JSON（礼物/代付/位置/朋友圈转发/通话记录等）转换为干净可读的自然语言摘要，
        // 否则大模型会被指令格式污染，要么回文字、要么生成与人设无关的 HTML
        const sessObj = await db.sessions.get(activeSessionId);
        const _myName = sessObj?.customUserName || (await db.archives.get(sessObj?.userId))?.name || '我';
        const _charName = sessObj?.customCharName || (await db.archives.get(sessObj?.charId))?.name || '对方';

        history.forEach(h => {
          const cleaned = this.cleanHistoryContentForContext(h, _myName, _charName);
          if (cleaned) {
            messagesToSend.push({ role: h.senderType === 'user' ? 'user' : 'assistant', content: cleaned });
          }
        });

        // 4. 追加具有高优约束性的指令提示词，确保其摒弃上下文消息格式的惯性 (高优先指令升级)
        //    并强调"必须基于当下情景+你的人设"生成 HTML，避免人设脱错或干脆回纯文字
        messagesToSend.push({
          role: "user",
          content: `【最新执行指令（最高优先级！）】：
现在请你针对用户最新提出的需求，全新生成一个独立的 HTML/CSS/JS 页面代码。请彻底遗忘并抛弃之前的对话消息格式（不要模仿、提及、或生成任何红包、转账、语音、代付、位置等对话台词或控制指令），你的唯一输出任务就是【一段完整、可直接运行的 HTML 代码组件】。

【情景与人设绑定（务必死守）】：
- 你必须始终以 [${_charName}] 的身份与口吻来生成这份 HTML 互动内容，绝不能脱离当前人设变成中性模板。
- 必须紧扣上方系统提示中给出的人设、关系、世界书、核心记忆、最近聊天氛围来填充内容文案、配色、彩蛋。
- 若用户的构建需求较泛（如"做个小游戏""我想看看你的聊天记录"），你必须主动结合"你与 [${_myName}] 现在的关系状态/最近聊到的事/你的性格特征"去定主题与细节，让它看起来就是 [${_charName}] 此刻亲手做的，而不是任意一个 AI 模板。
- 文案语气、按钮文字、惩罚/奖励台词、占位符填充等所有可见文字，都必须 100% 符合你的人设语气（病娇/撒娇/冷淡/傲娇/鬼畜等均严格贴合设定）。

【用户的卡片构建需求如下】：
${promptText}

【再次强调】：本次回复【只能】是 HTML 源码本身（从 <html> 或最外层 <div> 开始），【严禁】出现任何解释性文字、"好的我来生成"之类对话、"以下是代码"等前缀后缀。`
        });

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: messagesToSend,
            temperature: api.temperature
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status} 错误: ${errText}`);
        }

        const result = await response.json();
        if (!result.choices || result.choices.length === 0) {
          throw new Error("模型服务返回数据异常，Choice 节点为空。");
        }

        const rawReply = result.choices[0].message.content.trim();

        // 5. 保存到数据库中 (入库内容绝对保留 AI 返回的一手原始未清洗状态)
        await db.html_cards.add({
          sessionId: activeSessionId,
          prompt: promptText,
          html: rawReply,
          timestamp: Date.now()
        });

        await this.loadCards();
      } catch (err) {
        console.error(err);
        alert(`生成卡片失败: ${err.message}`);
        await this.loadCards();
      }
    },

    // 构建含"情景强调"的 HTML 互动舱编译指令（在原 HTML_WIDGET_INSTRUCTION 基础上叠加当前角色/关系/氛围）
    buildHtmlWidgetInstruction: async function(sessionId) {
      const base = (typeof PROMPT_TEMPLATES !== 'undefined' && PROMPT_TEMPLATES.HTML_WIDGET_INSTRUCTION)
        ? PROMPT_TEMPLATES.HTML_WIDGET_INSTRUCTION
        : '';

      let sceneHint = "";
      try {
        const sess = await db.sessions.get(sessionId);
        if (sess) {
          const char = await db.archives.get(sess.charId);
          const user = await db.archives.get(sess.userId);
          const charName = sess.customCharName || char?.name || "对方";
          const userName = sess.customUserName || user?.name || "我";

          // 拉取最近 6 条对话提炼"当下氛围/最近在聊什么"
          const recent = await db.messages.where('sessionId').equals(sessionId).reverse().limit(6).toArray();
          recent.reverse();
          const recentLines = recent.map(m => {
            const who = m.senderType === 'user' ? userName : charName;
            // 同样做轻量剥离，避免氛围摘要里混入指令标签
            let c = (m.content || "").replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|(?=\n\s*\n)|$)/gi, "").trim();
            c = this.stripControlTags(c);
            return c ? `${who}: ${c}` : null;
          }).filter(Boolean).join("\n");

          // 关系简述
          let relDesc = "";
          if (typeof queryRelationship === 'function') {
            try { relDesc = await queryRelationship(sess.userId, sess.charId, userName, charName); } catch(e) {}
          }

          sceneHint = `\n\n【当下情景要素（生成 HTML 时必须紧扣这些）】
- 你的身份：[${charName}]
- 用户身份：[${userName}]
- 你们的关系：${relDesc || "普通即时通讯好友"}
- 最近聊天氛围/话题：
${recentLines || "(暂无明显话题)"}
- 重要：当用户的构建需求较泛时（例如"做个小游戏""看看你的聊天记录"），必须主动从以上情景要素中抽取主题、文案、配色、彩蛋，使生成的 HTML 互动组件看起来就是 [${charName}] 此刻亲手为 [${userName}] 做的，而不是任意中性模板。`;
        }
      } catch (e) {
        console.warn("构建 HTML 互动舱情景提示失败，降级为纯基础指令", e);
      }

      return base + sceneHint;
    },

    // 历史消息上下文清洗：剥离所有控制指令标签 + 把富卡片 JSON 转为可读摘要
    // 复刻 app_chat.js 中 appendMessageToDOM/renderContext 的 displayContent 逻辑
    cleanHistoryContentForContext: function(h, myName, charName) {
      if (!h) return "";
      // 1. 已撤回
      if (h.isRecalled === 1) return "[已撤回该消息]";

      let displayContent = h.content;
      if (typeof displayContent !== 'string') return "";

      // 2. 物理剥离旧思维链（覆盖所有标签变体 + 未闭合兜底）
      displayContent = displayContent.replace(/(?:<think>|\[THINKING\]|【思考】|<thought>|<thinking>)[\s\S]*?(?:<\/think>|\[\/THINKING\]|【\/思考】|<\/thought>|<\/thinking>|(?=\n\s*\n)|$)/gi, "").trim();

      // 3. 按 contentType 把富卡片 JSON 转为可读摘要（与 app_chat.js 一致）
      if (h.contentType === 'image') {
        try { const d = JSON.parse(displayContent); displayContent = `[图片描述: ${d.text}]`; } catch(e) {}
      } else if (h.contentType === 'voice') {
        try { const d = JSON.parse(displayContent); displayContent = `[语音转文字: ${d.text}]`; } catch(e) {}
      } else if (h.contentType === 'call') {
        try {
          const c = JSON.parse(displayContent);
          displayContent = c.rejected
            ? `[你拒绝了对方的${c.type === 'video' ? '视频' : '语音'}通话请求]`
            : `[${c.type === 'video' ? '视频' : '语音'}通话记录 · ${c.summary || ''}]`;
        } catch(e) { displayContent = "[通话记录]"; }
      } else if (h.contentType === 'social_notice') {
        try {
          const sn = JSON.parse(displayContent);
          if (sn.type === 'moment') displayContent = `[你发了一条朋友圈：${sn.summary || ''}]`;
          else if (sn.type === 'forum_post') displayContent = `[你以 ${sn.roleLabel || ''} @${sn.username || ''} 身份在论坛发了帖子《${sn.title || ''}》]`;
          else if (sn.type === 'forum_alt_create') displayContent = `[你建立了一个论坛小号 @${sn.username || ''}（${sn.nickname || ''}）]`;
          else displayContent = "[社交动作记录]";
        } catch(e) { displayContent = "[社交动作记录]"; }
      } else if (h.contentType === 'moment_share') {
        try {
          const ms = JSON.parse(displayContent);
          const author = ms.authorName || '某人';
          const suffix = ms.commentText ? `（附言：${ms.commentText}）` : '';
          if (h.senderType === 'user') {
            displayContent = `[${myName} 向 ${charName} 转发了 ${author} 的朋友圈动态：${ms.summary || ''}${suffix}]`;
          } else {
            const f = ms.forwarderName || charName;
            displayContent = `[${f} 向 ${myName} 转发了 ${author} 的朋友圈动态：${ms.summary || ''}${suffix}]`;
          }
        } catch(e) { displayContent = "[转发了一条朋友圈]"; }
      } else if (h.contentType === 'forum_post_share') {
        try {
          const fps = JSON.parse(displayContent);
          const author = fps.authorName || '某成员';
          const suffix = fps.commentText ? `（附言：${fps.commentText}）` : '';
          if (h.senderType === 'user') {
            displayContent = `[${myName} 向 ${charName} 转发了 ${author} 的论坛帖子《${fps.title || ''}》：${fps.summary || ''}${suffix}]`;
          } else {
            const f = fps.forwarderName || charName;
            displayContent = `[${f} 向 ${myName} 转发了 ${author} 的论坛帖子《${fps.title || ''}》：${fps.summary || ''}${suffix}]`;
          }
        } catch(e) { displayContent = "[转发了一条论坛帖子]"; }
      } else if (h.contentType === 'pay_for_me') {
        try {
          const pf = JSON.parse(displayContent);
          const itemsStr = (pf.items || []).map(it => `${it.name || it.title || '商品'} x${it.quantity || 1} ¥${(it.price || 0).toFixed(2)}`).join('，');
          const totalStr = (pf.total || 0).toFixed(2);
          const msg = pf.message ? `，留言："${pf.message}"` : '';
          if (pf.status === 'paid') {
            displayContent = h.senderType === 'user'
              ? `[${charName} 已为你代付了订单：${itemsStr}，合计 ¥${totalStr}${msg}]`
              : `[你已经为 ${charName} 代付了订单：${itemsStr}，合计 ¥${totalStr}${msg}]`;
          } else {
            displayContent = h.senderType === 'user'
              ? `[你向 ${charName} 发送了一个代付请求订单：${itemsStr}，合计 ¥${totalStr}${msg}，等待对方代付]`
              : `[${charName} 向你发送了一个代付请求订单：${itemsStr}，合计 ¥${totalStr}${msg}]`;
          }
        } catch(e) { displayContent = "[收到一个代付请求]"; }
      } else if (h.contentType === 'gift') {
        try {
          const gf = JSON.parse(displayContent);
          const itemsStr = (gf.items || []).map(it => `${it.name || it.title || '礼物'} x${it.quantity || 1} ¥${(it.price || 0).toFixed(2)}`).join('，');
          const totalStr = (gf.total || 0).toFixed(2);
          const msg = gf.message ? `，附言："${gf.message}"` : '';
          displayContent = h.senderType === 'user'
            ? `[你向 ${charName} 送了礼物：${itemsStr}，合计 ¥${totalStr}${msg}]`
            : `[${charName} 送了你礼物：${itemsStr}，合计 ¥${totalStr}${msg}]`;
        } catch(e) { displayContent = "[收到一份礼物]"; }
      } else if (h.contentType === 'withdraw_share') {
        try {
          const ws = JSON.parse(displayContent);
          const target = (ws.targetAmount || 700) + '元';
          const cur = (ws.currentAmount || 0).toFixed(2) + '元';
          displayContent = h.senderType === 'user'
            ? `[你向 ${charName} 转发了一个"砍一刀提现"活动链接，目标${target}，已有${cur}]`
            : `[${charName} 向你转发了一个"砍一刀提现"活动链接]`;
        } catch(e) { displayContent = "[转发了一个砍一刀提现链接]"; }
      } else if (h.contentType === 'location') {
        try {
          const loc = JSON.parse(displayContent);
          displayContent = h.senderType === 'user'
            ? `[你向 ${charName} 发送了一个位置：${loc.name || ''}（${loc.address || ''}，经纬度 ${loc.latitude || '?'},${loc.longitude || '?'}）]`
            : `[${charName} 向你发送了一个位置：${loc.name || ''}（${loc.address || ''}，经纬度 ${loc.latitude || '?'},${loc.longitude || '?'}）]`;
        } catch(e) { displayContent = "[收到一个位置分享]"; }
      } else if (h.contentType === 'transfer') {
        try {
          const t = JSON.parse(displayContent);
          const amt = (t.amount || 0).toFixed(2);
          displayContent = h.senderType === 'user'
            ? `[你向 ${charName} 转账 ¥${amt}]`
            : `[${charName} 向你转账 ¥${amt}]`;
        } catch(e) { displayContent = "[收到一笔转账]"; }
      } else if (h.contentType === 'red_envelope') {
        try {
          const r = JSON.parse(displayContent);
          const amt = (r.amount || 0).toFixed(2);
          displayContent = h.senderType === 'user'
            ? `[你向 ${charName} 发了一个红包 ¥${amt}]`
            : `[${charName} 向你发了一个红包 ¥${amt}]`;
        } catch(e) { displayContent = "[收到一个红包]"; }
      }

      // 4. 剥离所有残留控制指令标签（[STATUS]{...}/[TRANSLATE]{...}/[AGREE_PAY]{}/[TRANSFER]{...}/
      //    [RED_PACKET]{...}/[GIFT]{...}/[PAY_FOR_ME]{...}/[LOCATION]{...}/[PLAY_MUSIC]{...}/[SET_ALARM]{...} 等）
      displayContent = this.stripControlTags(displayContent);

      return displayContent.trim();
    },

    // 剥离对话回复里所有控制指令标签，仅保留干净可见对话文本
    stripControlTags: function(text) {
      if (typeof text !== 'string') return text;
      let out = text;
      // 各类 [TAG]{...} 形式：用括号平衡匹配，确保嵌套 JSON 也能整段切掉
      const tags = ['STATUS', 'TRANSLATE', 'AGREE_PAY', 'TRANSFER', 'RED_PACKET', 'GIFT',
                    'PAY_FOR_ME', 'LOCATION', 'PLAY_MUSIC', 'SET_ALARM'];
      for (const tag of tags) {
        let idx;
        // 反复剥离，直到没有该标签
        while ((idx = out.indexOf('[' + tag + ']')) !== -1) {
          const after = out.substring(idx + tag.length + 2);
          // 跳过空白
          let p = 0;
          while (p < after.length && /\s/.test(after[p])) p++;
          let endPos = p;
          if (after[p] === '{') {
            // 括号平衡提取 {...}
            let depth = 0;
            let inStr = false, esc = false;
            for (; endPos < after.length; endPos++) {
              const ch = after[endPos];
              if (inStr) {
                if (esc) { esc = false; }
                else if (ch === '\\') { esc = true; }
                else if (ch === '"') { inStr = false; }
              } else {
                if (ch === '"') { inStr = true; }
                else if (ch === '{') { depth++; }
                else if (ch === '}') { depth--; if (depth === 0) { endPos++; break; } }
              }
            }
          } else {
            // 无 JSON 体，仅切掉 [TAG] 标签本身
            endPos = 0;
          }
          out = out.substring(0, idx) + out.substring(idx + tag.length + 2 + endPos);
        }
      }
      // 顺带清理多余空行
      out = out.replace(/\n{3,}/g, '\n\n').trim();
      return out;
    }
  };

  // 防御性自动事件绑定：当 DOM 解析完毕或脚本加载时，强制重新搜寻并注册事件
  function bindHtmlWidgetTrigger() {
    const btn = document.getElementById("btn-chat-html-widget");
    if (btn) {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        document.getElementById("chat-expand-panel").classList.remove("active");
        chatHtmlWidgetSystem.openPanel();
      };
    }
  }

  // 应对异步加载场景
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindHtmlWidgetTrigger);
  } else {
    bindHtmlWidgetTrigger();
  }

  window.chatHtmlWidgetSystem = chatHtmlWidgetSystem;
})();