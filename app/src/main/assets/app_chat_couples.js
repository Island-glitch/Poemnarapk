/**
 * app_chat_couples.js - “情侣空间”社交扮演交互与时空中枢控制脚本
 * 完全自闭环驱动，搭载专属磨砂Dialog、1/4圆盘时间选择器、物理周历缩滑过渡、多页手账翻书与AI智能贴纸排盘系统
 * 全站严格屏蔽任何 Emoji 字符
 */

(function () {
  const couplesSystem = {
    activeCharId: null,
    activeMeId: null,
    activeSessionId: null,
    currentSubPage: null,
    
    // 子页面状态
    calendarSelectedDate: null,
    calendarViewMode: 'month', // 'month' 或 'week'
    currentHandbookId: null,
    currentHandbookPageIndex: 0, // 手账单页可翻页标志
    whisperTopicActive: false,
    whisperSatisfactionLevel: 0,
    activeTopicDesc: "",
    whisperTopicInitiator: "char", // 'char' 或 'user'
    currentActiveTimeField: "start", // 'start' 或 'end'

    // 手账画布交互
    selectedElement: null,
    isDraggingElement: false,
    dragOffset: { x: 0, y: 0 },

    // 1/4圆盘时间选择器极角物理参数
    arcPickerActiveField: null, // 'start' 或 'end'
    arcHourVal: 8,
    arcMinVal: 0,

    /**
     * 1. 系统初始化就位
     */
    init() {
      this.calendarSelectedDate = new Date();
      this.bindTriggers();
      this.buildArcTimePicker(); // 建立极角时间圆盘
    },

    /**
     * 2. 防御性自注册事件绑定中枢
     */
    bindTriggers() {
      // 切换当前Char角色
      const btnSwitchChar = document.getElementById("btn-couples-char-switch");
      if (btnSwitchChar) {
        btnSwitchChar.onclick = () => {
          this.triggerCharSelector();
        };
      }

      // 二级子页面点击路由切换绑定
      document.querySelectorAll(".couples-nav-item").forEach(item => {
        item.onclick = () => {
          const pageId = item.getAttribute("data-page");
          this.switchSubPage(pageId);
        };
      });

      // 愿望清单卡片点击路由
      const btnWishCard = document.getElementById("btn-couples-bottom-wish");
      if (btnWishCard) {
        btnWishCard.onclick = () => {
          this.switchSubPage("wish");
        };
      }

      // 二级子页面返回按键
      document.querySelectorAll(".btn-sub-back").forEach(btn => {
        btn.onclick = () => {
          if (this.currentSubPage) {
            document.getElementById(`page-couples-${this.currentSubPage}`).classList.remove("active");
            this.currentSubPage = null;
            this.hideArcTimePicker();
          }
        };
      });

      // 心情卡片手动刷新
      const btnMoodRefresh = document.getElementById("btn-couples-mood-refresh");
      if (btnMoodRefresh) {
        btnMoodRefresh.onclick = () => {
          this.renderMoodCard(true);
        };
      }

      // 1. 日程管理事件
      const btnCalAdd = document.getElementById("btn-couples-cal-add");
      if (btnCalAdd) {
        btnCalAdd.onclick = () => this.addAnniversaryForm();
      }
      const btnCalAi = document.getElementById("btn-couples-cal-ai");
      if (btnCalAi) {
        btnCalAi.onclick = () => this.generateAiSchedules();
      }
      const btnCalSync = document.getElementById("btn-couples-cal-sync-toggle");
      if (btnCalSync) {
        btnCalSync.onclick = () => this.toggleScheduleSync();
      }

      // 2. 相册事件
      const btnAlbumAdd = document.getElementById("btn-couples-album-add");
      if (btnAlbumAdd) {
        btnAlbumAdd.onclick = () => this.addNewAlbumPhotoForm();
      }

      // 3. 手账事件
      const btnHandbookCreate = document.getElementById("btn-couples-handbook-create");
      if (btnHandbookCreate) {
        btnHandbookCreate.onclick = () => this.createHandbookForm();
      }
      const btnHandbookEditorClose = document.getElementById("btn-couples-handbook-editor-close");
      if (btnHandbookEditorClose) {
        btnHandbookEditorClose.onclick = () => {
          document.getElementById("couples-handbook-workspace-container").style.display = "none";
          this.selectedElement = null;
          this.removeFloatingControlDock();
        };
      }
      const btnHandbookAddText = document.getElementById("btn-couples-handbook-add-text");
      if (btnHandbookAddText) {
        btnHandbookAddText.onclick = () => this.addTextToHandbook();
      }
      const btnHandbookAddSticker = document.getElementById("btn-couples-handbook-add-sticker");
      if (btnHandbookAddSticker) {
        btnHandbookAddSticker.onclick = () => {
          document.getElementById("couples-materials-library-drawer").classList.add("active");
        };
      }
      const btnHandbookSave = document.getElementById("btn-couples-handbook-save");
      if (btnHandbookSave) {
        btnHandbookSave.onclick = () => this.saveHandbookCanvas();
      }
      const btnHandbookAiFill = document.getElementById("btn-couples-handbook-ai-fill");
      if (btnHandbookAiFill) {
        btnHandbookAiFill.onclick = () => this.triggerAiJournalWriting();
      }

      // 4. 悄悄话事件
      // 发送按钮已移除：发消息靠输入框回车（见下），回车即上屏并触发对方接话
      const btnWhisperReply = document.getElementById("btn-couples-whisper-reply");
      if (btnWhisperReply) {
        btnWhisperReply.onclick = () => this.triggerWhisperReply();
      }
      const btnWhisperTopic = document.getElementById("btn-couples-whisper-topic");
      if (btnWhisperTopic) {
        btnWhisperTopic.onclick = () => this.triggerWhisperTopicForm();
      }
      const btnWhisperSettings = document.getElementById("btn-couples-whisper-settings");
      if (btnWhisperSettings) {
        btnWhisperSettings.onclick = () => this.openWhisperSettings();
      }
      const btnWhisperTopicEnd = document.getElementById("btn-couples-whisper-topic-end");
      if (btnWhisperTopicEnd) {
        btnWhisperTopicEnd.onclick = () => this.endWhisperTopic();
      }
      // 输入框回车发送（Shift+Enter 换行）
      const whisperInput = document.getElementById("couples-whisper-input");
      if (whisperInput) {
        whisperInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.sendWhisperMessage();
          }
        });
      }

      // 5. 愿望清单事件
      const btnWishAdd = document.getElementById("btn-couples-wish-add");
      if (btnWishAdd) {
        btnWishAdd.onclick = () => this.addNewWishForm();
      }
      const btnWishSync = document.getElementById("btn-couples-wish-sync-toggle");
      if (btnWishSync) {
        btnWishSync.onclick = () => this.toggleWishSync();
      }

      // 6. 素材库关闭与上传
      const btnAssetsClose = document.getElementById("btn-couples-assets-close");
      if (btnAssetsClose) {
        btnAssetsClose.onclick = () => {
          document.getElementById("couples-materials-library-drawer").classList.remove("active");
        };
      }
      const btnAssetsUpload = document.getElementById("btn-couples-assets-upload");
      const fileAssetsInput = document.getElementById("file-couples-assets-input");
      if (btnAssetsUpload && fileAssetsInput) {
        btnAssetsUpload.onclick = () => fileAssetsInput.click();
        fileAssetsInput.onchange = (e) => this.handleAssetUpload(e);
      }

      // 7. 弹窗防卡死兜底：ESC 关掉最上面那层磨砂弹窗
      if (!window.__couplesDialogEscapeBound) {
        window.__couplesDialogEscapeBound = true;
        document.addEventListener("keydown", (e) => {
          if (e.key !== "Escape") return;
          const overlays = document.querySelectorAll(".couples-dialog-overlay, .couples-sheet-overlay");
          if (!overlays.length) return;
          const top = overlays[overlays.length - 1];
          top.classList.remove("active");
          setTimeout(() => top.remove(), 200);
        });
      }

      // 8. 兜底：点弹窗遮罩（卡片以外）也能关掉。用 win-couples 上的委托，
      //    这样「隐藏了取消/确认按钮」的只读弹窗也不会把人卡住。
      const winCouplesEl = document.getElementById("win-couples");
      if (winCouplesEl && !winCouplesEl._couplesBackdropBound) {
        winCouplesEl._couplesBackdropBound = true;
        winCouplesEl.addEventListener("click", (e) => {
          const el = e.target;
          if (!el || !el.classList || !el.classList.contains("couples-dialog-overlay")) return;
          if (!el.classList.contains("active")) return;
          // 计时器兜底移除：即使某个弹窗自己绑过 onclick，也不会残留
          el.classList.remove("active");
          setTimeout(() => { try { el.remove(); } catch (err) {} }, 220);
        });
      }
    },

    /**
     * 自研高保真磨砂 Dialog 引擎 (无 Emoji，纯 HTML 节点解析，规避系统 Dialog 穿透)
     */
    showFrostedDialog(title, htmlContent, onConfirm, onCancel) {
      const parent = document.getElementById("win-couples");
      if (!parent) return null;

      const overlay = document.createElement("div");
      overlay.className = "couples-dialog-overlay";
      overlay.innerHTML = `
        <div class="couples-dialog-card">
          <button class="couples-dialog-x" id="btn-couples-dialog-x" title="关闭" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
          <div class="couples-dialog-title">${title}</div>
          <div style="margin-bottom:18px; max-height:260px; overflow-y:auto; scrollbar-width:none;">
            ${htmlContent}
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-pwa-modal cancel" id="btn-couples-dialog-cancel" style="border-radius:10px; height:38px;">取消</button>
            <button class="btn btn-pwa-modal confirm" id="btn-couples-dialog-confirm" style="border-radius:10px; height:38px; background:#ff8fa3;">确认</button>
          </div>
        </div>
      `;
      parent.appendChild(overlay);

      setTimeout(() => overlay.classList.add("active"), 10);

      const close = () => {
        overlay.classList.remove("active");
        setTimeout(() => overlay.remove(), 200);
      };

      // 三条关闭通路：右上角 X / 点遮罩 / 取消按钮
      // （历史上「隐藏取消+确认」只读弹窗没有任何关闭方式，会被彻底卡死）
      const xBtn = overlay.querySelector("#btn-couples-dialog-x");
      if (xBtn) xBtn.onclick = () => { close(); if (typeof onCancel === 'function') onCancel(); };
      overlay.onclick = (e) => {
        if (e.target === overlay) { close(); if (typeof onCancel === 'function') onCancel(); }
      };

      overlay.querySelector("#btn-couples-dialog-cancel").onclick = () => {
        close();
        if (typeof onCancel === 'function') onCancel();
      };

      overlay.querySelector("#btn-couples-dialog-confirm").onclick = () => {
        if (typeof onConfirm === 'function') {
          const success = onConfirm();
          if (success === false) return; // 如果返回 false 则保持开启
        }
        close();
      };

      return overlay;
    },

    // 自绘确认卡（Promise 版）：项目红线禁止原生 confirm
    confirmCouples(title, message, confirmLabel) {
      return new Promise((resolve) => {
        const parent = document.getElementById("win-couples");
        if (!parent) { resolve(false); return; }
        const overlay = document.createElement("div");
        overlay.className = "couples-dialog-overlay";
        overlay.innerHTML = `
          <div class="couples-dialog-card">
            <button class="couples-dialog-x" id="btn-couples-dialog-x" title="关闭" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
            <div class="couples-dialog-title">${window.escapeHtml(title)}</div>
            <div style="margin-bottom:18px; font-size:12.5px; line-height:1.65; color:#475569; text-align:left;">${window.escapeHtml(message)}</div>
            <div style="display:flex; gap:10px;">
              <button class="btn btn-pwa-modal cancel" id="btn-couples-dialog-cancel" style="border-radius:10px; height:38px;">取消</button>
              <button class="btn btn-pwa-modal confirm" id="btn-couples-dialog-confirm" style="border-radius:10px; height:38px; background:#ff8fa3;">${confirmLabel || '确定'}</button>
            </div>
          </div>
        `;
        parent.appendChild(overlay);
        setTimeout(() => overlay.classList.add("active"), 10);
        let settled = false;
        const close = () => { overlay.classList.remove("active"); setTimeout(() => overlay.remove(), 200); };
        const finish = (val) => { if (settled) return; settled = true; close(); resolve(val); };
        overlay.querySelector("#btn-couples-dialog-cancel").onclick = () => finish(false);
        overlay.querySelector("#btn-couples-dialog-confirm").onclick = () => finish(true);
        const xBtn = overlay.querySelector("#btn-couples-dialog-x");
        if (xBtn) xBtn.onclick = () => finish(false);
        overlay.onclick = (e) => { if (e.target === overlay) finish(false); };
      });
    },

    // 自绘提示卡（Promise 版）：替代原生 alert
    alertCouples(title, message) {
      return new Promise((resolve) => {
        const parent = document.getElementById("win-couples");
        if (!parent) {
          if (typeof showToast === 'function') showToast(message || title);
          resolve();
          return;
        }
        const overlay = document.createElement("div");
        overlay.className = "couples-dialog-overlay";
        overlay.innerHTML = `
          <div class="couples-dialog-card">
            <button class="couples-dialog-x" id="btn-couples-dialog-x" title="关闭" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
            <div class="couples-dialog-title">${window.escapeHtml(title)}</div>
            <div style="margin-bottom:18px; font-size:12.5px; line-height:1.65; color:#475569; text-align:left;">${window.escapeHtml(message)}</div>
            <button class="btn btn-pwa-modal confirm" id="btn-couples-alert-ok" style="width:100%; border-radius:10px; height:38px; background:#ff8fa3;">知道了</button>
          </div>
        `;
        parent.appendChild(overlay);
        setTimeout(() => overlay.classList.add("active"), 10);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          overlay.classList.remove("active");
          setTimeout(() => overlay.remove(), 200);
          resolve();
        };
        overlay.querySelector("#btn-couples-alert-ok").onclick = finish;
        const xBtn = overlay.querySelector("#btn-couples-dialog-x");
        if (xBtn) xBtn.onclick = finish;
        overlay.onclick = (e) => { if (e.target === overlay) finish(); };
      });
    },

    /**
     * 3. 开启主空间
     */
    async openModal() {
      this.activeMeId = localStorage.getItem("active_me_id");
      if (!this.activeMeId) {
        await this.alertCouples("还没有选择人设", "请先到「我的」选项卡下选择我的人设，再来情侣空间。");
        return;
      }

      // 获取当前单聊会话 ID
      const sessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
      let targetSess = sessList.find(s => s.charId === Number(this.activeCharId));
      
      if (!targetSess && window.activeSessionId) {
        const curSess = await db.sessions.get(window.activeSessionId);
        if (curSess && curSess.isGroup !== 1) {
          targetSess = curSess;
          this.activeCharId = curSess.charId;
        }
      }

      if (!targetSess) {
        const fallbackSess = sessList.find(s => s.isGroup !== 1);
        if (fallbackSess) {
          targetSess = fallbackSess;
          this.activeCharId = fallbackSess.charId;
        } else {
          await this.alertCouples("还差一个单聊对象", "情侣空间只在单聊里可用：请先到档案库建立一段单聊关系，再回来。");
          return;
        }
      }

      this.activeSessionId = targetSess.id; 
      this.calendarViewMode = 'month';

      await this.loadHeader();
      await this.renderMoodCard(false);
      this.loadMaterialsLibrary();

      document.getElementById("win-couples").classList.add("active");
    },

    async loadHeader() {
      const char = await db.archives.get(Number(this.activeCharId));
      const user = await db.archives.get(Number(this.activeMeId));

      document.getElementById("couples-avatar-char").src = window.resolveAvatar(char?.avatar);
      document.getElementById("couples-avatar-user").src = window.resolveAvatar(user?.avatar);
      document.getElementById("couples-name-char").innerText = char?.name || "对方";
      document.getElementById("couples-name-user").innerText = user?.name || "我";

      // 核心计算：获取当前单聊会话中，最早一条对话记录的物理时戳，自愈生成真实天数 [4]
      let days = 1;
      const msgs = await db.messages.where('sessionId').equals(this.activeSessionId).toArray();
      if (msgs.length > 0) {
        const timestamps = msgs.map(m => m.timestamp).filter(t => t);
        if (timestamps.length > 0) {
          const earliest = Math.min(...timestamps);
          const diffTime = Math.abs(Date.now() - earliest);
          days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        }
      }
      document.getElementById("couples-anniversary-num").innerText = `相恋 ${days} 天`;
    },

    async renderMoodCard(forceRefresh) {
      const keyChar = `couples_mood_char_${this.activeMeId}_${this.activeCharId}`;
      const keyUser = `couples_mood_user_${this.activeMeId}_${this.activeCharId}`;
      const keyProgress = `couples_mood_prog_${this.activeMeId}_${this.activeCharId}`;

      let charMood = localStorage.getItem(keyChar);
      let userMood = localStorage.getItem(keyUser);
      let progress = localStorage.getItem(keyProgress) || "60";

      if (forceRefresh || !charMood || !userMood) {
        document.getElementById("couples-mood-bubble-char").innerText = "正在感应内心世界...";
        document.getElementById("couples-mood-bubble-user").innerText = "同步频率中...";

        try {
          const api = await window.apiRoutes.resolve("couples");
          if (!api) throw new Error("API未就绪");

          let historyText = "";
          const msgs = await db.messages.where('sessionId').equals(this.activeSessionId).reverse().limit(10).toArray();
          msgs.reverse().forEach(m => {
            let cleaned = m.content.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '');
            historyText += `${m.senderType === 'user' ? 'User' : 'Char'}: ${cleaned}\n`;
          });

          const prompt = `【任务】：根据以下情侣间的最近对话，推演并提取出他们双方此刻最真实的『今日秘密内心独白』。
- 对方（Char）的心声：15字以内的一句话，必须充满对用户的偏爱、想念或内心波澜，不准出现说教和括号动作描述。
- 我方（User）的心声：15字以内的一句话，必须符合用户在最近对话中的倾向。
- 情感进度值：0到100之间的一个整数，代表当前粘合程度。

【输出格式要求（直接且仅能返回 JSON，不要包含 Markdown 标识）】：
{
  "charMood": "心声内容",
  "userMood": "心声内容",
  "progress": 情感进度值
}`;

          const moodMessages = [{ role: "user", content: prompt + `\n\n对话历史：\n${historyText}` }];
          let moodRaw;
          if (typeof window.fwCallLLM === "function") {
            try { moodRaw = await window.fwCallLLM(api, moodMessages, { temperature: 0.7 }); } catch (e) { moodRaw = undefined; }
          }
          if (moodRaw === undefined) {
            const response = await fetch(`${api.url}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
              body: JSON.stringify({
                model: api.model,
                messages: moodMessages,
                temperature: 0.7
              })
            });
            if (!response.ok) throw new Error("API异常");
            const res = await response.json();
            moodRaw = res.choices[0].message.content;
          }
          const parsed = JSON.parse(String(moodRaw || '').replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim());

          charMood = parsed.charMood;
          userMood = parsed.userMood;
          progress = parsed.progress;

          try {
            localStorage.setItem(keyChar, charMood);
            localStorage.setItem(keyUser, userMood);
            localStorage.setItem(keyProgress, progress);
          } catch (e) { console.warn("[情侣空间] 心情卡缓存写入失败", e); }

        } catch (e) {
          console.error(e);
          charMood = "今天也很在乎你。";
          userMood = "晚饭后一起散步吧。";
          progress = "75";
        }
      }

      document.getElementById("couples-mood-bubble-char").innerText = charMood;
      document.getElementById("couples-mood-bubble-user").innerText = userMood;
    },

    switchSubPage(pageId) {
      if (this.currentSubPage) {
        document.getElementById(`page-couples-${this.currentSubPage}`).classList.remove("active");
      }
      this.currentSubPage = pageId;
      document.getElementById(`page-couples-${pageId}`).classList.add("active");

      if (pageId === 'calendar') this.renderAnniversaries();
      if (pageId === 'album') this.renderAlbum();
      if (pageId === 'handbook') this.renderHandbookShelf();
      if (pageId === 'whisper') this.renderWhisperChat();
      if (pageId === 'wish') this.renderWishList();
    },

    async triggerCharSelector() {
      const singleSessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
      const chars = [];
      for (let s of singleSessList) {
        if (s.isGroup !== 1) {
          const char = await db.archives.get(s.charId);
          if (char) chars.push(char);
        }
      }

      if (chars.length === 0) {
        await this.alertCouples("暂时没有可以共度的人", "先去档案库建立一段单聊关系，这里就会出现 TA。");
        return;
      }

      let optionsHtml = '<div style="display:flex; flex-direction:column; gap:6px;">';
      chars.forEach(c => {
        optionsHtml += `<button onclick="couplesSystem.selectChar(${c.id})" class="btn btn-outline" style="width:100%; padding:10px; font-weight:700; font-size:12px;">${c.name}</button>`;
      });
      optionsHtml += '</div>';

      this.showFrostedDialog("选择切换共度空间的角色", optionsHtml);
    },

    selectChar(charId) {
      this.activeCharId = charId;
      const overlay = document.querySelector(".couples-dialog-overlay");
      if (overlay) overlay.remove();
      this.loadHeader();
      this.renderMoodCard(true);
      if (this.currentSubPage) this.switchSubPage(this.currentSubPage);
    },

    // ==========================================================================
    // 子系统 1：日历与周历无缝过渡排盘 (Calendar System)
    // ==========================================================================
    async renderCalendar() {
      const today = this.calendarSelectedDate;
      const year = today.getFullYear();
      const month = today.getMonth();
      document.getElementById("couples-cal-month-title").innerText = `${year}年 ${month + 1}月`;

      const schedules = await db.table('couples_schedules').where('charId').equals(Number(this.activeCharId)).toArray();

      const weekContainer = document.getElementById("couples-calendar-week-row");
      if (weekContainer) weekContainer.remove(); 

      if (this.calendarViewMode === 'month') {
        this.renderMonthlyGrid(year, month, schedules);
      } else {
        this.renderWeeklyRow(today, schedules);
      }

      const pad = (num) => String(num).padStart(2, '0');
      const dateStr = `${year}-${pad(month + 1)}-${pad(today.getDate())}`;
      this.loadSchedulesByDate(dateStr);
    },

    renderMonthlyGrid(year, month, schedules) {
      const flow = document.getElementById("couples-calendar-month-flow");
      if (!flow) return;
      flow.innerHTML = "";
      flow.className = "couples-month-grid"; 

      // 周几栏
      const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
      weekdays.forEach(w => {
        const cell = document.createElement("div");
        cell.className = "couples-calendar-weekday";
        cell.innerText = w;
        flow.appendChild(cell);
      });

      const firstDay = new Date(year, month, 1).getDay();
      const lastDate = new Date(year, month + 1, 0).getDate();

      // 填充空白
      for (let i = 0; i < firstDay; i++) {
        const cell = document.createElement("div");
        flow.appendChild(cell);
      }

      // 填充日期
      for (let d = 1; d <= lastDate; d++) {
        const cell = document.createElement("div");
        cell.className = "couples-calendar-day";
        cell.innerText = d;

        const pad = (num) => String(num).padStart(2, '0');
        const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
        
        // 日程标记
        if (schedules.some(s => s.date === dateStr)) {
          cell.classList.add("has-event");
        }

        if (d === this.calendarSelectedDate.getDate() && month === this.calendarSelectedDate.getMonth()) {
          cell.classList.add("selected");
        }

        cell.onclick = () => {
          this.calendarSelectedDate = new Date(year, month, d);
          this.calendarViewMode = 'week'; 
          this.renderCalendar();
        };

        flow.appendChild(cell);
      }
    },

    renderWeeklyRow(selectedDate, schedules) {
      const flow = document.getElementById("couples-calendar-month-flow");
      if (!flow) return;
      
      flow.innerHTML = "";
      flow.className = "couples-month-grid collapsed";

      const dayOfWeek = selectedDate.getDay(); 
      const distanceToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; 
      const monday = new Date(selectedDate.getTime() + distanceToMonday * 24 * 60 * 60 * 1000);

      let weekRow = document.getElementById("couples-calendar-week-row");
      if (!weekRow) {
        weekRow = document.createElement("div");
        weekRow.id = "couples-calendar-week-row";
        flow.parentNode.insertBefore(weekRow, flow.nextSibling);
      }
      weekRow.className = "couples-week-row";
      weekRow.innerHTML = "";

      for (let i = 0; i < 7; i++) {
        const curDay = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
        const cell = document.createElement("div");
        cell.className = "couples-calendar-day";
        
        const pad = (num) => String(num).padStart(2, '0');
        const dateStr = `${curDay.getFullYear()}-${pad(curDay.getMonth() + 1)}-${pad(curDay.getDate())}`;

        const isTodaySelected = curDay.getDate() === selectedDate.getDate() && curDay.getMonth() === selectedDate.getMonth();
        if (isTodaySelected) {
          cell.classList.add("selected");
        }
        if (schedules.some(s => s.date === dateStr)) {
          cell.classList.add("has-event");
        }

        const weekdaysShort = ["日", "一", "二", "三", "四", "五", "六"];
        cell.innerHTML = `
          <div style="font-size:8px; opacity:0.8; font-weight:800; margin-bottom:2px;">${weekdaysShort[curDay.getDay()]}</div>
          <div>${curDay.getDate()}</div>
        `;

        cell.onclick = () => {
          this.calendarSelectedDate = curDay;
          this.renderCalendar();
        };

        weekRow.appendChild(cell);
      }

      const monthTitle = document.getElementById("couples-cal-month-title");
      monthTitle.innerHTML = `${selectedDate.getFullYear()}年 ${selectedDate.getMonth() + 1}月 <span id="btn-couples-cal-return-month" style="font-size:10px; color:#ff8fa3; cursor:pointer; margin-left:8px; font-weight:700;">[返回整月]</span>`;
      
      const btnReturn = document.getElementById("btn-couples-cal-return-month");
      if (btnReturn) {
        btnReturn.onclick = (e) => {
          e.stopPropagation();
          this.calendarViewMode = 'month';
          weekRow.remove();
          this.renderCalendar();
        };
      }
    },

    async loadSchedulesByDate(dateStr) {
      const container = document.getElementById("couples-calendar-events-flow");
      if (!container) return;
      container.innerHTML = "";

      const allSchedules = await db.table('couples_schedules').toArray();
      const schedules = allSchedules.filter(s => s.date === dateStr && Number(s.meId) === Number(this.activeMeId) && (Number(s.charId) === Number(this.activeCharId) || s.syncAll === 1));

      if (schedules.length === 0) {
        container.innerHTML = `<p style="text-align:center; font-size:11px; color:#94a3b8; padding:12px 0;">本日暂无纪念日程，点击右上角加号创建</p>`;
        return;
      }

      schedules.forEach(s => {
        const row = document.createElement("div");
        row.className = "couples-wish-row";
        
        let typeBadge = "";
        let cardStyle = "";
        
        if (s.owner === 'char') {
          typeBadge = `<span style="background:#e0f2fe; color:#0369a1; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; margin-right:4px;">TA的计划</span>`;
          cardStyle = "background: rgba(224, 242, 254, 0.45); border-left: 3px solid #0284c7;";
        } else {
          typeBadge = `<span style="background:#fdf2f8; color:#db2777; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; margin-right:4px;">我的计划</span>`;
          cardStyle = "background: rgba(255, 241, 242, 0.55); border-left: 3px solid #f43f5e;";
        }

        row.style.cssText = cardStyle;
        row.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:4px; flex:1; text-align:left;">
            <div style="display:flex; gap:6px; align-items:center;">
              ${typeBadge}
              <span style="font-size:12px; font-weight:700; color:#334155;">${s.time || '全天'}</span>
            </div>
            <div style="font-size:12.5px; color:#475569; font-weight:600;">${window.escapeHtml(s.content)}</div>
          </div>
          <button onclick="couplesSystem.deleteSchedule(${s.id})" class="btn-icon" style="color:#ef4444; z-index:2;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        `;
        container.appendChild(row);
      });
    },

    addNewScheduleForm() {
      const year = this.calendarSelectedDate.getFullYear();
      const month = this.calendarSelectedDate.getMonth() + 1;
      const day = this.calendarSelectedDate.getDate();
      const pad = (num) => String(num).padStart(2, '0');
      const dateStr = `${year}-${pad(month)}-${pad(day)}`;

      const formHtml = `
        <div style="text-align:left; display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">日程日期</label>
            <input type="text" value="${dateStr}" readonly style="background:#f1f5f9; cursor:not-allowed;">
          </div>
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">日程类型</label>
            <select id="cal-form-type" onchange="couplesSystem.onScheduleTypeChange(this.value)">
              <option value="routine">日常作息</option>
              <option value="milestone">大事记</option>
              <option value="menstrual">生理期记录</option>
            </select>
          </div>

          <div class="form-group" id="cal-form-time-row">
            <label style="font-size:11px; font-weight:700; margin-bottom:4px; display:block;">选择具体时间段 (点击选择)</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="cal-form-time-start" value="08:00" readonly style="text-align:center; font-weight:700; cursor:pointer; background:#ffffff;" onclick="couplesSystem.showArcTimePicker('start')">
              <span style="align-self:center; font-weight:800; color:#ff8fa3;">至</span>
              <input type="text" id="cal-form-time-end" value="10:00" readonly style="text-align:center; font-weight:700; cursor:pointer; background:#ffffff;" onclick="couplesSystem.showArcTimePicker('end')">
            </div>
          </div>

          <div class="form-group" id="cal-form-content-row">
            <label style="font-size:11px; font-weight:700;">安排主题与计划内容</label>
            <input type="text" id="cal-form-content" placeholder="输入计划，例如 晚上一起吃火锅">
          </div>

          <div class="couples-menstrual-panel" id="cal-form-menstrual-panel">
            <div class="form-group" style="margin-bottom:8px;">
              <label style="font-size:11px; font-weight:700;">今日生理来潮血量</label>
              <select id="cal-form-men-blood">
                <option value="微量">微量</option>
                <option value="中等" selected>中等</option>
                <option value="偏多">偏多</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:10px;">
              <label style="font-size:11px; font-weight:700; display:flex; justify-content:space-between;">
                <span>小腹坠胀疼痛等级</span>
                <span id="menstrual-pain-val" style="color:#f43f5e; font-weight:800;">1 级 (微弱无感)</span>
              </label>
              <input type="range" id="cal-form-men-pain" min="1" max="5" value="1" style="width:100%;" oninput="couplesSystem.onMenstrualPainSliderInput(this.value)">
            </div>
            <div class="form-group">
              <label style="font-size:11px; font-weight:700;">今日情绪感受 (AI伴侣将针对性关心)</label>
              <input type="text" id="cal-form-men-mood" placeholder="心情有些低落，想吃甜食">
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:6px; border-top:1px dashed var(--border); padding-top:10px;">
            <input type="checkbox" id="cal-form-sync-all" checked style="width:16px; height:16px;">
            <label for="cal-form-sync-all" style="font-size:11px; font-weight:700; cursor:pointer; color:#64748b;">一键同步到当前身份下所有情侣空间的日程页面</label>
          </div>
        </div>
      `;

      this.showFrostedDialog("新建日程计划", formHtml, async () => {
        const type = document.getElementById("cal-form-type").value;
        const syncAll = document.getElementById("cal-form-sync-all").checked;
        this.hideArcTimePicker(); 
        
        let timeLabel = "";
        let content = "";

        if (type === 'menstrual') {
          const blood = document.getElementById("cal-form-men-blood").value;
          const pain = document.getElementById("cal-form-men-pain").value;
          const mood = document.getElementById("cal-form-men-mood").value.trim() || "需要被轻声细语地关心";
          timeLabel = "生理期记录";
          content = `本日生理状态：血量[${blood}]，疼痛[${pain}级]。心声：“${mood}”`;
        } else {
          const start = document.getElementById("cal-form-time-start").value;
          const end = document.getElementById("cal-form-time-end").value;
          timeLabel = `${start}-${end}`;
          content = document.getElementById("cal-form-content").value.trim();
        }

        if (!content) {
          await this.alertCouples("还差内容", "写点什么吧：日程总得有个具体安排。");
          return false;
        }

        await db.table('couples_schedules').add({
          charId: Number(this.activeCharId),
          meId: Number(this.activeMeId),
          date: dateStr,
          type: type,
          time: timeLabel,
          content: content,
          owner: 'user', 
          syncAll: syncAll ? 1 : 0
        });
        this.renderCalendar();
      }, () => {
        this.hideArcTimePicker(); 
      });
    },

    onScheduleTypeChange(val) {
      const timeRow = document.getElementById("cal-form-time-row");
      const contentRow = document.getElementById("cal-form-content-row");
      const menstrualPanel = document.getElementById("cal-form-menstrual-panel");

      if (val === 'menstrual') {
        if (timeRow) timeRow.style.display = "none";
        if (contentRow) contentRow.style.display = "none";
        if (menstrualPanel) menstrualPanel.classList.add("active");
      } else {
        if (timeRow) timeRow.style.display = "block";
        if (contentRow) contentRow.style.display = "block";
        if (menstrualPanel) menstrualPanel.classList.remove("active");
      }
    },

    onMenstrualPainSliderInput(val) {
      const labels = {
        "1": "1 级 (微弱，基本无感)",
        "2": "2 级 (轻微，不影响起居)",
        "3": "3 级 (隐隐作痛，需要热水袋)",
        "4": "4 级 (脆弱烦躁，痛感明显)",
        "5": "5 级 (下腹坠痛，想你一直抱着我)"
      };
      document.getElementById("menstrual-pain-val").innerText = labels[val] || `${val} 级`;
    },

    async generateAiSchedules() {
      showToast("正在检索恋爱羁绊与生活，推演全天日程计划...");

      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) throw new Error("API未配置");

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));

        let historyText = "";
        const msgs = await db.messages.where('sessionId').equals(this.activeSessionId).reverse().limit(10).toArray();
        msgs.reverse().forEach(m => {
          let cleaned = m.content
            .replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '')
            .replace(/【表情包：[^】]+】/g, '')
            .trim();
          historyText += `${m.senderType === 'user' ? 'User' : 'Char'}: ${cleaned}\n`;
        });

        const prompt = `【全天情侣真实生活日程生成任务】：
你现在需要严格并深度扮演 [${char?.name || '对方'}] 这一具体角色。请你仔细阅读并彻底遵循你本身的【角色背景设定】，使你的日程规划 100% 贴合你自身的日常起居、社会身份（如上班族、学生、自由职业等）及性情。
- 【角色背景设定】：\n${char?.persona || "一个普通人"}\n

任务要求：
1. 真实生活模版：情侣的生活不只有风花雪月，更有柴米油盐与固定的工作作息。日程中必须包含符合你社会身份的固定、模板化日常活动安排（如：几点起床、上午工作/上课、午休、几点下班/下课、几点睡觉等）。
2. 穿插恋爱语料：在这些固定作息之外，你可以穿插一些极具生活真实感、细节温暖、具体到特定时间的恋爱小动作（例如：12:30 吃饭中途给你打个电话、19:30 约你出来在公园散步、21:00 送你到家门口等）。
3. 时间与数量控制：一次生成的全天日程总数【必须包括至少 5 到 7 个不同的时间段】。
4. 格式控制：直接返回一个包含 5 至 7 个 JSON 对象的 JSON 数组，绝不能包含 Markdown 代码块包装，也不得有任何 Emoji 和括号肢体动作！

【JSON 数组格式例（必须严格按此数组输出，不允许额外包装）】：
[
  {"time": "07:30-08:00", "content": "睁眼醒来，简单洗漱准备出门上班"},
  {"time": "08:30-11:30", "content": "在公司处理晨间例会与手头业务"},
  {"time": "12:30-13:00", "content": "吃午饭的间隙抽空给你拨个电话问候"},
  {"time": "13:30-18:00", "content": "下午继续投入紧张的工作中"},
  {"time": "19:30-21:00", "content": "约你在江边步道散散步，聊聊今天的琐事并送你上楼"},
  {"time": "22:30-23:00", "content": "准备洗澡，跟你发完最后几句晚安后入睡"}
]

---
最近对话历史：
${historyText || "刚刚相见，倍感温润。"}`;

        let rawContent;
        const schedMessages = [{ role: "user", content: prompt }];
        if (typeof window.fwCallLLM === "function") {
          try {
            rawContent = await window.fwCallLLM(api, schedMessages, { temperature: 0.8 });
          } catch(e) { /* fall through to original fetch */ }
        }
        if (rawContent === undefined) {
          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: schedMessages,
              temperature: 0.8
            })
          });

          if (!response.ok) throw new Error("API响应异常");
          const res = await response.json();
          rawContent = res.choices[0].message.content;
        }
        const rawJsonText = rawContent.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
        const schedulesArr = JSON.parse(rawJsonText);

        const year = this.calendarSelectedDate.getFullYear();
        const month = this.calendarSelectedDate.getMonth() + 1;
        const day = this.calendarSelectedDate.getDate();
        const pad = (num) => String(num).padStart(2, '0');
        const dateStr = `${year}-${pad(month)}-${pad(day)}`;

        for (let sItem of schedulesArr) {
          await db.table('couples_schedules').add({
            charId: Number(this.activeCharId),
            meId: Number(this.activeMeId),
            date: dateStr,
            type: 'routine',
            time: sItem.time,
            content: sItem.content,
            owner: 'char', 
            syncAll: 1
          });
        }

        this.renderCalendar();
        showToast(`全天 ${schedulesArr.length} 项日程推演入盘完成！`);

      } catch (e) {
        console.error(e);
        showToast("AI日程推演失败，请检查网络接口。");
      }
    },

    toggleScheduleSync() {
      const syncKey = `couples_cal_sync_${this.activeMeId}_${this.activeCharId}`;
      const state = localStorage.getItem(syncKey) === "true";
      try { localStorage.setItem(syncKey, !state ? "true" : "false"); } catch (e) {}
      showToast(!state ? "本日日程数据已绑定同步并注入聊天 Prompt" : "已断开日程与聊天的同步");
    },

    async deleteSchedule(id) {
      const yes = await this.confirmCouples("删除这条日程？", "删除后这条安排不会保留，确定要删吗？", "删除");
      if (!yes) return;
      await db.table('couples_schedules').delete(id);
      this.renderCalendar();
      showToast("日程已删除");
    },

    // ==========================================
    // 纪念日（纯倒数）：只纪念，不再生成日程/生理期——日程能力已迁到「仪轨」应用
    // ==========================================
    async renderAnniversaries() {
      const container = document.getElementById("couples-anniv-list");
      if (!container) return;
      const charId = Number(this.activeCharId);
      const meId = Number(this.activeMeId);
      let rows = [];
      try {
        rows = await db.ritual_anniversaries.where('charId').equals(charId).toArray();
      } catch (e) {
        try {
          const all = await db.ritual_anniversaries.toArray();
          rows = all.filter(r => Number(r.charId) === charId);
        } catch (e2) { rows = []; }
      }
      rows = rows.filter(r => Number(r.meId) === meId);

      const pad = n => String(n).padStart(2, '0');
      const now = new Date();
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weeks = ["日", "一", "二", "三", "四", "五", "六"];
      const items = rows.map(r => {
        const d = new Date(r.date + 'T00:00:00');
        const diff = Math.round((d.getTime() - todayMid.getTime()) / 86400000);
        return Object.assign({}, r, { diff: diff, valid: !isNaN(d.getTime()) });
      }).filter(r => r.valid);

      items.sort((a, b) => {
        const af = a.diff >= 0, bf = b.diff >= 0;
        if (af !== bf) return af ? -1 : 1;          // 未来的在前
        return af ? a.diff - b.diff : b.diff - a.diff;
      });

      if (!items.length) {
        container.innerHTML =
          '<div style="background:#fff; border:1.5px dashed #f3d4da; border-radius:16px; padding:30px 18px; text-align:center;">' +
            '<div style="display:flex; justify-content:center; color:#f9a8b8; margin-bottom:10px;">' +
              '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="M12 13.6c.7-.9 2.2-.5 2.2.7 0 .9-1 1.7-2.2 2.5-1.2-.8-2.2-1.6-2.2-2.5 0-1.2 1.5-1.6 2.2-.7z" fill="currentColor" stroke="none"/></svg>' +
            '</div>' +
            '<div style="font-size:12.5px; color:#b8a0a8; line-height:1.75; margin-bottom:16px;">还没有纪念日。<br>把你们的第一次、生日、约定好的日子记下来吧。</div>' +
            '<button id="couples-anniv-empty-add" style="padding:10px 20px; border:none; background:#ff8fa3; color:#fff; border-radius:11px; font-size:12.5px; font-weight:800; cursor:pointer; font-family:inherit;">添加纪念日</button>' +
          '</div>';
        const b = document.getElementById("couples-anniv-empty-add");
        if (b) b.onclick = () => this.addAnniversaryForm();
        return;
      }

      container.innerHTML = items.map(r => {
        const d = new Date(r.date + 'T00:00:00');
        const dateLabel = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + weeks[d.getDay()];
        const isToday = r.diff === 0;
        const big = isToday ? '就是今天' : (r.diff > 0 ? ('还有 ' + r.diff + ' 天') : ('已经 ' + Math.abs(r.diff) + ' 天'));
        const accent = isToday ? '#e11d48' : (r.diff > 0 ? '#ff8fa3' : '#b9a7ad');
        return '<div style="background:#fff; border:1px solid #f6e7ea; border-radius:16px; padding:14px 16px; position:relative; overflow:hidden;">' +
            '<div style="position:absolute; left:0; top:0; bottom:0; width:3px; background:' + accent + ';"></div>' +
            '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">' +
              '<div style="flex:1; min-width:0;">' +
                '<div style="font-size:14px; font-weight:800; color:#3d2b31; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + window.escapeHtml(r.title || '纪念日') + '</div>' +
                '<div style="font-size:11px; color:#b8a0a8; margin-top:3px;">' + dateLabel + '</div>' +
              '</div>' +
              '<button data-anniv-del="' + r.id + '" title="删除" style="flex-shrink:0; display:flex; align-items:center; justify-content:center; width:28px; height:28px; border:none; background:#fff5f6; border-radius:9px; color:#f87171; cursor:pointer;">' +
                '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>' +
              '</button>' +
            '</div>' +
            '<div style="display:flex; align-items:baseline; gap:6px; margin-top:10px;">' +
              '<span style="font-size:20px; font-weight:800; color:' + accent + '; letter-spacing:.5px;">' + big + '</span>' +
            '</div>' +
            (r.note ? '<div style="font-size:11.5px; color:#8a7a80; margin-top:7px; line-height:1.6;">' + window.escapeHtml(r.note) + '</div>' : '') +
          '</div>';
      }).join('');

      container.querySelectorAll('[data-anniv-del]').forEach(btn => {
        btn.onclick = () => this.deleteAnniversary(Number(btn.getAttribute('data-anniv-del')));
      });
    },

    addAnniversaryForm() {
      const pad = n => String(n).padStart(2, '0');
      const now = new Date();
      const defaultDate = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
      const formHtml = `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="font-size:11px; font-weight:700; color:#8a7a80; display:block; margin-bottom:6px;">纪念日名称</label>
            <input type="text" id="anniv-form-title" placeholder="例如：我们在一起的第一天" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1.5px solid #f3d4da; border-radius:10px; font-size:13px; outline:none; font-family:inherit;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#8a7a80; display:block; margin-bottom:6px;">日期</label>
            <input type="date" id="anniv-form-date" value="${defaultDate}" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1.5px solid #f3d4da; border-radius:10px; font-size:13px; outline:none; font-family:inherit;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#8a7a80; display:block; margin-bottom:6px;">备注（可选）</label>
            <textarea id="anniv-form-note" rows="2" placeholder="想说的话…" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1.5px solid #f3d4da; border-radius:10px; font-size:12.5px; outline:none; resize:vertical; font-family:inherit;"></textarea>
          </div>
        </div>`;
      this.showFrostedDialog("添加纪念日", formHtml, async () => {
        const title = (document.getElementById("anniv-form-title").value || "").trim();
        const date = (document.getElementById("anniv-form-date").value || "").trim();
        const note = (document.getElementById("anniv-form-note").value || "").trim();
        if (!title) { showToast("请填写纪念日名称"); return false; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast("请选择日期"); return false; }
        await db.ritual_anniversaries.add({
          charId: Number(this.activeCharId),
          meId: Number(this.activeMeId),
          title: title,
          date: date,
          note: note,
          createdAt: Date.now()
        });
        this.renderAnniversaries();
        showToast("纪念日已添加");
      });
    },

    async deleteAnniversary(id) {
      if (!confirm("确定要删除这个纪念日吗？")) return;
      try { await db.ritual_anniversaries.delete(Number(id)); } catch (e) {}
      this.renderAnniversaries();
      showToast("纪念日已删除");
    },

    buildArcTimePicker() {
      const win = document.getElementById("win-couples");
      if (!win) return;

      let picker = document.getElementById("couples-arc-time-picker");
      if (picker) return;

      picker = document.createElement("div");
      picker.id = "couples-arc-time-picker";
      picker.className = "couples-arc-time-picker";
      picker.innerHTML = `
        <div class="couples-arc-knob" id="couples-arc-knob"></div>
        <div class="couples-arc-readout">
          <div class="couples-arc-readout-time" id="couples-arc-time-val">08:00</div>
          <div class="couples-arc-readout-label" id="couples-arc-field-label">小时调整中</div>
        </div>
      `;
      win.appendChild(picker);

      const knob = picker.querySelector("#couples-arc-knob");
      let isDragging = false;

      const trackRadius = 145; 
      const updatePosition = (angleRad) => {
        let angle = angleRad * (180 / Math.PI);
        if (angle < 0) angle += 360;
        
        if (angle < 180) angle = 180;
        if (angle > 270) angle = 270;

        const clampedRad = angle * (Math.PI / 180);
        
        const x = 190 + trackRadius * Math.cos(clampedRad);
        const y = 190 + trackRadius * Math.sin(clampedRad);

        knob.style.left = `${x - 9}px`; 
        knob.style.top = `${y - 9}px`;

        const pct = (angle - 180) / 90; 
        
        if (this.arcPickerActiveField === 'hour') {
          this.arcHourVal = Math.round(pct * 23);
        } else if (this.arcPickerActiveField === 'minute') {
          this.arcMinVal = Math.round(pct * 59);
        } else {
          this.arcHourVal = Math.round(pct * 23);
        }

        const hStr = String(this.arcHourVal).padStart(2, '0');
        const mStr = String(this.arcMinVal).padStart(2, '0');
        document.getElementById("couples-arc-time-val").innerText = `${hStr}:${mStr}`;

        const activeInputId = this.currentActiveTimeField === 'start' ? 'cal-form-time-start' : 'cal-form-time-end';
        const targetInput = document.getElementById(activeInputId);
        if (targetInput) {
          targetInput.value = `${hStr}:${mStr}`;
        }
      };

      const handlePointer = (e) => {
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        
        const pickerRect = picker.getBoundingClientRect();
        const relX = clientX - pickerRect.left;
        const relY = clientY - pickerRect.top;
        
        const dx = relX - pickerRect.width;
        const dy = relY - pickerRect.height;

        const angleRad = Math.atan2(dy, dx);
        updatePosition(angleRad);
      };

      picker.addEventListener("pointerdown", (e) => {
        isDragging = true;
        handlePointer(e);
        picker.setPointerCapture(e.pointerId);
      });

      picker.addEventListener("pointermove", (e) => {
        if (isDragging) handlePointer(e);
      });

      const stopDrag = () => {
        if (isDragging) {
          isDragging = false;
          if (this.arcPickerActiveField === 'hour') {
            this.arcPickerActiveField = 'minute';
            document.getElementById("couples-arc-field-label").innerText = "分钟精细调拨";
            showToast("已自动切入分钟微调");
          } else {
            this.arcPickerActiveField = 'hour';
            document.getElementById("couples-arc-field-label").innerText = "小时旋转设定";
          }
        }
      };

      picker.addEventListener("pointerup", stopDrag);
      picker.addEventListener("pointercancel", stopDrag);

      updatePosition(225 * (Math.PI / 180));
    },

    showArcTimePicker(fieldMode) {
      this.currentActiveTimeField = fieldMode;
      this.arcPickerActiveField = 'hour'; 
      document.getElementById("couples-arc-field-label").innerText = "小时旋转设定";
      
      const picker = document.getElementById("couples-arc-time-picker");
      if (picker) {
        picker.classList.add("active");
      }
    },

    hideArcTimePicker() {
      const picker = document.getElementById("couples-arc-time-picker");
      if (picker) {
        picker.classList.remove("active");
      }
    },

    // ==========================================================================
    // 子系统 2：相册 拍立得照片墙 (AI上图配套)
    // ==========================================================================
    async renderAlbum() {
      const flow = document.getElementById("couples-album-timeline-flow");
      if (!flow) return;
      flow.innerHTML = "";

      const albumHeader = document.querySelector("#page-couples-album .couples-navbar");
      if (albumHeader && !document.getElementById("btn-couples-album-ai-upload")) {
        const aiBtn = document.createElement("button");
        aiBtn.id = "btn-couples-album-ai-upload";
        aiBtn.className = "btn-icon";
        aiBtn.title = "AI一键发布合照";
        aiBtn.style.color = "#8b5cf6";
        aiBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        `;
        aiBtn.onclick = () => this.generateAiAlbumPhoto();
        albumHeader.insertBefore(aiBtn, albumHeader.querySelector("#btn-couples-album-add"));
      }

      const photos = await db.table('couples_albums')
        .where('charId').equals(Number(this.activeCharId))
        .sortBy('timestamp');

      if (photos.length === 0) {
        flow.innerHTML = `<p style="text-align:center; font-size:11px; color:#94a3b8; padding:24px 0;">展厅尚无照片，点击右上角加号发布首张情侣合影</p>`;
        return;
      }

      photos.forEach(p => {
        const node = document.createElement("div");
        node.className = "couples-album-node";
        
        const dateStr = new Date(p.timestamp).toLocaleString();
        const isTextBased = !p.url || p.url === "";

        let imgHtml = "";
        if (isTextBased) {
          imgHtml = `
            <div class="couples-album-img-frame text-only">
              <span style="font-size:10px; font-weight:800; color:#ff8fa3; margin-bottom:8px; border-bottom:1px solid #ffe4e6; width:100%; text-align:center; padding-bottom:4px;">拍立得场景白描</span>
              <p style="font-size:11.5px; color:#475569; line-height:1.45; margin:0 8px; font-weight:600; text-align:justify;">“ ${p.textDescription} ”</p>
            </div>
          `;
        } else {
          imgHtml = `
            <div class="couples-album-img-frame">
              <img src="${p.url}" />
            </div>
          `;
        }

        node.innerHTML = `
          <div class="couples-album-node-dot"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:10px; color:#94a3b8; font-weight:700; text-align:left;">${dateStr}</div>
            <button onclick="couplesSystem.deleteAlbumPhoto(${p.id})" class="btn-icon" style="color:#ef4444; padding:0; height:18px; width:18px;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
          <div style="font-size:13px; font-weight:800; color:#334155; margin-top:4px; text-align:left;">${window.escapeHtml(p.title)}</div>
          ${imgHtml}
          <div style="background:#f8fafc; border-radius:12px; padding:8px 12px; font-size:11.5px; color:#475569; text-align:left; border:1px solid rgba(0,0,0,0.03); margin-top:8px;">
            <span style="font-weight:800; color:#ff8fa3;">对方的小秘密感想：</span>${window.escapeHtml(p.charThought || '看着这张合影，心里就觉得特别安宁。')}
          </div>
          <div id="couples-album-comments-${p.id}" style="margin-top:10px; padding-top:8px; border-top:1.5px dashed var(--border);"></div>
        `;
        flow.appendChild(node);
        this.renderAlbumComments(p.id, p.comments || []);
      });
    },

    addNewAlbumPhotoForm() {
      const formHtml = `
        <div style="text-align:left; display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">合影主题标题</label>
            <input type="text" id="album-form-title" placeholder="例如：周末的下午茶、雨夜的咖啡馆">
          </div>
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">添加方式</label>
            <select id="album-form-method" onchange="couplesSystem.onAlbumMethodChange(this.value)">
              <option value="upload">上传物理实图</option>
              <option value="desc">撰写画面故事白描</option>
            </select>
          </div>
          <div class="form-group" id="album-form-file-row">
            <label style="font-size:11px; font-weight:700;">选择合照文件</label>
            <input type="file" id="album-form-file" accept="image/*">
          </div>
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">画面具体细节描述</label>
            <textarea id="album-form-desc-input" rows="3" placeholder="例如：照片中你靠在我肩膀上低头微笑，背景是暖黄色的灯影。"></textarea>
          </div>
        </div>
      `;

      this.showFrostedDialog("留存新相片至展厅", formHtml, async () => {
        const title = document.getElementById("album-form-title").value.trim();
        const desc = document.getElementById("album-form-desc-input").value.trim();
        const method = document.getElementById("album-form-method").value;
        const fileEl = document.getElementById("album-form-file");

        if (!title || !desc) {
          await this.alertCouples("还差一点", "照片的「主题」和「描述」都要写，之后翻相册时才记得住当时的心情。");
          return false;
        }

        const addPhoto = async (dataUrl) => {
          let charThought = "每次看起这张合照，心里总是格外踏实。";
          try {
            const api = await window.apiRoutes.resolve("couples");
            const char = await db.archives.get(Number(this.activeCharId));
            if (api && char) {
              const prompt = `你现在是 [${char.name}]，用户在相册里珍藏了一张照片：“${desc}”，请写下 15 字以内的一句话对该照片的心声感想，不准说废话和括号描述。`;
              const response = await fetch(`${api.url}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
                body: JSON.stringify({
                  model: api.model,
                  messages: [{ role: "user", content: prompt }]
                })
              });
              const res = await response.json();
              charThought = res.choices[0].message.content.trim().replace(/[\[【]?[A-Z_]+[\]】]?/g, "");
            }
          } catch(err) { console.error(err); }

          await db.table('couples_albums').add({
            charId: Number(this.activeCharId),
            meId: Number(this.activeMeId),
            title: title,
            url: dataUrl,
            textDescription: desc,
            charThought: charThought,
            comments: [],
            timestamp: Date.now()
          });

          this.renderAlbum();
        };

        if (method === 'upload' && fileEl && fileEl.files.length > 0) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            const compressed = await window.compressImageBase64(e.target.result, 800, 0.75);
            await addPhoto(compressed);
          };
          reader.readAsDataURL(fileEl.files[0]);
        } else {
          await addPhoto("");
        }
      });
    },

    onAlbumMethodChange(val) {
      const row = document.getElementById("album-form-file-row");
      if (row) row.style.display = val === 'upload' ? 'block' : 'none';
    },

    async generateAiAlbumPhoto() {
      showToast("正在检索你们在主时空的恋爱点记，AI构思合影中...");

      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) throw new Error("API未配置");

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));

        const charName = char?.name || "对方";
        const userName = user?.name || "我";

        const prompt = `【相册合影 AI 推演上图任务】：
你现在是 [${charName}]。请结合你跟用户 [${userName}] 的深度恋爱羁绊、共同生活脉络，构思并发布一张只属于你们两人的情侣合影白描。

要求：
1. 构思标题：10字以内的浪漫书写，如：雨夜的咖啡馆一角、海风吹散的头发。
2. 画面故事白描：描述一幅高度浪漫、细节精致的合影自拍场景。
3. 你的小秘密想法（charThought）：你写在这张合照底下的秘密感想。
4. 【极其严格限制：绝对不能带任何 Emoji！直接返回 JSON 对象且不要出现 Markdown \`\`\` 包装！】

【JSON 格式例】：
{
  "title": "林间漫步",
  "textDescription": "阳光透过树影斜斜洒下，你举着相机按着快门，我有些害羞地转过头，刚好将这一刻定格。",
  "charThought": "其实，只要你在身边，镜头拍到哪里都很好看。"
}

---
你们的人物设定与交往背景：
[${charName}]人设：${char?.persona || "普通"}
[${userName}]人设：${user?.persona || "普通"}`;

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.8
          })
        });

        if (!response.ok) throw new Error("API 响应失败");
        const res = await response.json();
        const parsed = JSON.parse(res.choices[0].message.content.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim());

        await db.table('couples_albums').add({
          charId: Number(this.activeCharId),
          meId: Number(this.activeMeId),
          title: parsed.title,
          url: "", // 文字拍立得卡
          textDescription: parsed.textDescription,
          charThought: parsed.charThought,
          comments: [],
          timestamp: Date.now()
        });

        this.renderAlbum();
        showToast(`AI 合照「${parsed.title}」已成功发表入展厅！`);

      } catch (e) {
        console.error(e);
        showToast("AI 上图推演失败，请检查网络接口。");
      }
    },

    async deleteAlbumPhoto(id) {
      const yes = await this.confirmCouples("删除这张照片？", "照片与这张照片下的留言都会一起消失，确定要删吗？", "删除");
      if (!yes) return;
      await db.table('couples_albums').delete(id);
      this.renderAlbum();
      showToast("照片已删除");
    },

    async renderAlbumComments(photoId, comments) {
      const container = document.getElementById(`couples-album-comments-${photoId}`);
      if (!container) return;
      container.innerHTML = "";

      comments.forEach((c) => {
        const row = document.createElement("div");
        row.style.cssText = "font-size:11px; margin-bottom:4px; text-align:left;";
        row.innerHTML = `<span style="font-weight:800; color:#576b95;">${c.sender}: </span>${window.escapeHtml(c.text)}`;
        container.appendChild(row);
      });

      const form = document.createElement("div");
      form.style.cssText = "display:flex; gap:6px; margin-top:6px;";
      form.innerHTML = `
        <input type="text" id="album-comment-input-${photoId}" placeholder="写下你们的默契讨论..." style="flex:1; height:24px; font-size:11px; border-radius:6px;">
        <button onclick="couplesSystem.submitAlbumComment(${photoId})" class="btn btn-primary" style="font-size:10px; padding:2px 8px; border-radius:6px; background:#ff8fa3; border:none; height:24px;">发送</button>
      `;
      container.appendChild(form);
    },

    async submitAlbumComment(photoId) {
      const input = document.getElementById(`album-comment-input-${photoId}`);
      const text = input ? input.value.trim() : "";
      if (!text) return;

      const photo = await db.table('couples_albums').get(photoId);
      if (!photo) return;

      const user = await db.archives.get(Number(this.activeMeId));
      const comments = photo.comments || [];
      comments.push({ sender: user?.name || "我", text: text });

      await db.table('couples_albums').update(photoId, { comments: comments });
      await this.renderAlbum();

      setTimeout(() => this.triggerAiAlbumComment(photoId), 3000);
    },

    async triggerAiAlbumComment(photoId) {
      try {
        const photo = await db.table('couples_albums').get(photoId);
        if (!photo) return;

        const api = await window.apiRoutes.resolve("couples");
        if (!api) return;

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));

        const prompt = `【情侣空间相册评论回复任务】：
你现在是 [${char?.name || '对方'}]。请仔细在内心锚定这一神圣现实：【这是专门属于你和 [${user?.name || '我'}] 两人的私密情侣空间相册】。因此你的回复绝对不是应付公事，必须极度具有情侣间的温存与爱意拉扯！
你在相册中看到了一张你们两人的合照：“${photo.title}”，你刚看到了对方写给这张照片的最新评论：“${photo.comments[photo.comments.length - 1].text}”。
请针对该评论，写下一句 20 字以内你给对方的情侣回复。

注意：绝对不准带任何 Emoji 字符，直接输出回复本身！`;

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
          })
        });

        if (response.ok) {
          const res = await response.json();
          const reply = res.choices[0].message.content.trim().replace(/[\[【]?[A-Z_]+[\]】]?/g, "");
          const comments = photo.comments || [];
          comments.push({ sender: char?.name || "对方", text: reply });
          await db.table('couples_albums').update(photoId, { comments: comments });
          this.renderAlbum();
        }
      } catch (e) {
        console.error(e);
      }
    },

    // ==========================================================================
    // 子系统 3：手账可翻多页系统 + 贴纸描述属性 (Handbook Studio)
    // ==========================================================================
    async renderHandbookShelf() {
      const flow = document.getElementById("couples-handbook-list");
      if (!flow) return;
      flow.innerHTML = "";

      const books = await db.table('couples_journals')
        .where('charId').equals(Number(this.activeCharId))
        .toArray();

      if (books.length === 0) {
        flow.innerHTML = `<p style="grid-column: span 3; text-align:center; font-size:11px; color:#94a3b8; padding:32px 0;">手账架上空空如也，点击右上角加号制作一本</p>`;
        return;
      }

      books.forEach(b => {
        const cover = document.createElement("div");
        cover.className = "couples-handbook-book";
        cover.innerHTML = `
          <div class="couples-handbook-book-title">${window.escapeHtml(b.name)}</div>
        `;
        cover.onclick = () => this.openHandbookCanvas(b.id, 0);
        flow.appendChild(cover);
      });
    },

    createHandbookForm() {
      const formHtml = `
        <div class="form-group" style="text-align:left;">
          <label style="font-size:11px; font-weight:700;">手账本命名主题</label>
          <input type="text" id="handbook-form-name" placeholder="请输入手账本名称，如 纪念画册">
        </div>
      `;

      this.showFrostedDialog("新建手账册", formHtml, async () => {
        const name = document.getElementById("handbook-form-name").value.trim();
        if (!name) {
          await this.alertCouples("给它起个名字", "手账册需要一个名字，之后在书架上才找得到它。");
          return false;
        }

        await db.table('couples_journals').add({
          charId: Number(this.activeCharId),
          meId: Number(this.activeMeId),
          name: name,
          elementsJson: "[[]]" 
        });
        this.renderHandbookShelf();
      });
    },

    async openHandbookCanvas(bookId, pageIndex) {
      this.currentHandbookId = bookId;
      this.currentHandbookPageIndex = pageIndex;
      
      const workspace = document.getElementById("couples-handbook-workspace-container");
      const canvas = document.getElementById("couples-handbook-canvas");
      if (!workspace || !canvas) return;

      canvas.innerHTML = "";
      workspace.style.display = "flex";

      const book = await db.table('couples_journals').get(bookId);
      if (!book) return;

      let pages = [];
      try { pages = JSON.parse(book.elementsJson) || [[]]; } catch(e) {}
      if (pages.length <= pageIndex) {
        pages.push([]); 
      }

      const elements = pages[pageIndex] || [];
      elements.forEach(el => {
        this.renderElementOnCanvas(el);
      });

      const interiorPageBadge = document.getElementById("couples-handbook-interior-page-badge");
      if (interiorPageBadge) {
        interiorPageBadge.innerText = `第 ${pageIndex + 1} 页`;
      }

      const titleEl = document.getElementById("couples-handbook-title");
      if (titleEl) titleEl.innerText = "恋手账";

      canvas.onmousedown = (e) => this.handleCanvasPointerDown(e);
      canvas.ontouchstart = (e) => this.handleCanvasPointerDown(e);
      
      this.mountAiAssetSelectorButton();
    },

    async exportHandbookToPdf() {
      showToast("正在启动 PDF 导出引擎，请稍候...");
      
      const loadScript = (src) => new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });

      try {
        if (typeof html2canvas === 'undefined') {
          await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
        }
        if (typeof jspdf === 'undefined') {
          await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', [300, 400]); 

        const book = await db.table('couples_journals').get(this.currentHandbookId);
        let pages = [];
        try { pages = JSON.parse(book.elementsJson) || [[]]; } catch(e) {}

        const originalPageIndex = this.currentHandbookPageIndex;

        for (let i = 0; i < pages.length; i++) {
          if (i > 0) pdf.addPage([300, 400], 'p');
          
          await this.openHandbookCanvas(this.currentHandbookId, i);
          await new Promise(r => setTimeout(r, 400)); 
          
          const canvasEl = document.getElementById("couples-handbook-canvas");
          const capturedCanvas = await html2canvas(canvasEl, { useCORS: true, backgroundColor: "#ffffff" });
          const imgData = capturedCanvas.toDataURL("image/jpeg", 0.95);
          
          pdf.addImage(imgData, 'JPEG', 0, 0, 300, 400);
        }

        await this.openHandbookCanvas(this.currentHandbookId, originalPageIndex);

        pdf.save(`${book.name || '手账'}_export_${Date.now()}.pdf`);
        showToast("PDF 导出成功！");
      } catch (err) {
        console.error(err);
        showToast("PDF 导出失败，请检查网络或资源载入状态");
      }
    },

    async importPdfToHandbook() {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "application/pdf";
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showToast("正在启动 PDF 导入解析器...");

        const loadScript = (src) => new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = res;
          s.onerror = rej;
          document.head.appendChild(s);
        });

        try {
          if (typeof pdfjsLib === 'undefined') {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js");
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
          }

          const fileReader = new FileReader();
          fileReader.onload = async (evt) => {
            try {
              const typedarray = new Uint8Array(evt.target.result);
              const pdf = await pdfjsLib.getDocument(typedarray).promise;
              
              const book = await db.table('couples_journals').get(this.currentHandbookId);
              let pages = [];
              try { pages = JSON.parse(book.elementsJson) || [[]]; } catch(err) {}

              for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.5 });
                
                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext("2d");
                
                await page.render({ canvasContext: context, viewport: viewport }).promise;
                const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

                const compressedUrl = await window.compressImageBase64(dataUrl, 800, 0.75);

                const newElement = {
                  id: "el_imported_" + Date.now() + "_" + pageNum,
                  type: "image",
                  x: 0,
                  y: 0,
                  src: compressedUrl,
                  size: 300, 
                  rotate: 0,
                  zIndex: 1
                };

                pages.push([newElement]);
              }

              await db.table('couples_journals').update(this.currentHandbookId, {
                elementsJson: JSON.stringify(pages)
              });

              showToast(`成功将 PDF 的 ${pdf.numPages} 页导入手账中！`);
              this.openHandbookCanvas(this.currentHandbookId, this.currentHandbookPageIndex);
            } catch (err) {
              console.error(err);
              showToast("PDF 解析读取失败");
            }
          };
          fileReader.readAsArrayBuffer(file);
        } catch (err) {
          console.error(err);
          showToast("PDF 引擎加载失败");
        }
      };
      fileInput.click();
    },

    async deleteCurrentHandbookPage() {
      if (!confirm("确定要删除当前这一页手账吗？该页排盘数据将彻底抹除，不可恢复！")) return;

      const book = await db.table('couples_journals').get(this.currentHandbookId);
      if (!book) return;

      let pages = [];
      try { pages = JSON.parse(book.elementsJson) || [[]]; } catch(e) {}

      if (pages.length <= 1) {
        pages[0] = [];
        showToast("手账仅剩一页，已自动清空该页全部元素！");
        this.currentHandbookPageIndex = 0;
      } else {
        pages.splice(this.currentHandbookPageIndex, 1);
        showToast("已成功删除当前页！");
        this.currentHandbookPageIndex = Math.max(0, this.currentHandbookPageIndex - 1);
      }

      await db.table('couples_journals').update(this.currentHandbookId, {
        elementsJson: JSON.stringify(pages)
      });

      this.openHandbookCanvas(this.currentHandbookId, this.currentHandbookPageIndex);
    },

    async deleteCurrentHandbook() {
      if (!confirm("确定要彻底销毁这本手账吗？整本手账的所有页面数据都将永久抹除！")) return;

      await db.table('couples_journals').delete(this.currentHandbookId);
      showToast("手账册已彻底销毁！");
      
      document.getElementById("couples-handbook-workspace-container").style.display = "none";
      this.selectedElement = null;
      this.removeFloatingControlDock();

      this.renderHandbookShelf();
    },

    async changeHandbookPage(dir) {
      await this.saveHandbookCanvas(true); 
      const newPageIdx = Math.max(0, this.currentHandbookPageIndex + dir);
      this.openHandbookCanvas(this.currentHandbookId, newPageIdx);
    },

    renderElementOnCanvas(el) {
      const canvas = document.getElementById("couples-handbook-canvas");
      if (!canvas) return;

      const div = document.createElement("div");
      div.className = "couples-handbook-element";
      div.id = el.id;
      // 判定是否为底图（zIndex < 5），底图锁定不可点选/移动，物理撑满整张画布 [4]
      const isBg = el.zIndex < 5;
      div.style.cssText = `left: ${isBg ? 0 : el.x}px; top: ${isBg ? 0 : el.y}px; z-index: ${el.zIndex || 1}; transform: rotate(${el.rotate || 0}deg); ${isBg ? 'pointer-events: none; width: 100%; height: 100%;' : ''}`;
      div.setAttribute("data-rotate", el.rotate || 0);
      div.setAttribute("data-z-index", el.zIndex || 1);
      
      if (el.type === 'text') {
        div.innerHTML = `<textarea style="background:none; border:none; resize:both; outline:none; font-family:inherit; font-size:12px; font-weight:700; color:#334155; width:${el.width || 120}px; height:${el.height || 60}px;">${el.content || '轻触编辑文字'}</textarea>`;
      } else {
        const imgStyle = isBg ? `width: 100%; height: 100%; object-fit: cover; pointer-events: none;` : `width:${el.size || 60}px; height:auto; pointer-events:none;`;
        div.innerHTML = `<img src="${el.src}" style="${imgStyle}" />`;
        div.setAttribute("data-size", el.size || 60);
      }

      canvas.appendChild(div);
    },

    addTextToHandbook() {
      const newEl = {
        id: "el_" + Date.now(),
        type: "text",
        x: 60,
        y: 80,
        content: "手写浪漫白描",
        width: 120,
        height: 60,
        rotate: 0,
        zIndex: 10
      };
      this.renderElementOnCanvas(newEl);
    },

    showFloatingControlDock(el) {
      this.removeFloatingControlDock();

      const dock = document.createElement("div");
      dock.className = "couples-element-control-dock";
      dock.id = "couples-floating-control-dock";

      const isText = el.querySelector("textarea") !== null;
      let sizeSliderHtml = "";
      if (!isText) {
        const size = parseInt(el.getAttribute("data-size")) || 60;
        sizeSliderHtml = `
          <span>大小:</span>
          <input type="range" min="30" max="150" value="${size}" style="width:70px;" oninput="couplesSystem.onHandbookElementSizeSlider('${el.id}', this.value)">
        `;
      }

      const rotate = parseInt(el.getAttribute("data-rotate")) || 0;

      dock.innerHTML = `
        ${sizeSliderHtml}
        <span>角度:</span>
        <input type="range" min="-180" max="180" value="${rotate}" style="width:70px;" oninput="couplesSystem.onHandbookElementRotateSlider('${el.id}', this.value)">
        <button onclick="couplesSystem.deleteHandbookElement('${el.id}')" class="btn btn-outline" style="border:none; color:#ef4444; font-size:10px; padding:2px 8px; font-weight:700;">删除</button>
      `;

      document.getElementById("couples-handbook-workspace-container").appendChild(dock);
    },

    removeFloatingControlDock() {
      const exist = document.getElementById("couples-floating-control-dock");
      if (exist) exist.remove();
    },

    onHandbookElementSizeSlider(elId, val) {
      const el = document.getElementById(elId);
      if (el) {
        const img = el.querySelector("img");
        if (img) {
          img.style.width = `${val}px`;
          el.setAttribute("data-size", val);
        }
      }
    },

    onHandbookElementRotateSlider(elId, val) {
      const el = document.getElementById(elId);
      if (el) {
        el.style.transform = `rotate(${val}deg)`;
        el.setAttribute("data-rotate", val);
      }
    },

    deleteHandbookElement(elId) {
      const el = document.getElementById(elId);
      if (el) {
        el.remove();
        this.removeFloatingControlDock();
        this.selectedElement = null;
      }
    },

    handleCanvasPointerDown(e) {
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);

      const el = e.target.closest(".couples-handbook-element");
      if (el) {
        this.selectedElement = el;
        this.isDraggingElement = true;

        document.querySelectorAll(".couples-handbook-element").forEach(node => node.classList.remove("selected"));
        el.classList.add("selected");

        const currentMaxZ = Math.max(...Array.from(document.querySelectorAll(".couples-handbook-element")).map(node => parseInt(node.getAttribute("data-z-index")) || 1));
        el.style.zIndex = currentMaxZ + 5;
        el.setAttribute("data-z-index", currentMaxZ + 5);

        this.showFloatingControlDock(el);

        const rect = el.getBoundingClientRect();
        this.dragOffset.x = clientX - rect.left;
        this.dragOffset.y = clientY - rect.top;

        const moveHandler = (evt) => {
          if (!this.isDraggingElement || !this.selectedElement) return;
          const mx = evt.clientX || (evt.touches && evt.touches[0].clientX);
          const my = evt.clientY || (evt.touches && evt.touches[0].clientY);

          const canvasRect = document.getElementById("couples-handbook-canvas").getBoundingClientRect();
          
          let nx = mx - canvasRect.left - this.dragOffset.x;
          let ny = my - canvasRect.top - this.dragOffset.y;

          this.selectedElement.style.left = `${nx}px`;
          this.selectedElement.style.top = `${ny}px`;
        };

        const upHandler = () => {
          this.isDraggingElement = false;
          document.removeEventListener("mousemove", moveHandler);
          document.removeEventListener("mouseup", upHandler);
          document.removeEventListener("touchmove", moveHandler);
          document.removeEventListener("touchend", upHandler);
        };

        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
        document.addEventListener("touchmove", moveHandler, { passive: false });
        document.addEventListener("touchend", upHandler);
      } else {
        if (!e.target.closest("#couples-floating-control-dock") && !e.target.closest(".btn")) {
          document.querySelectorAll(".couples-handbook-element").forEach(node => node.classList.remove("selected"));
          this.selectedElement = null;
          this.removeFloatingControlDock();
        }
      }
    },

    async saveHandbookCanvas(silentMode) {
      const canvas = document.getElementById("couples-handbook-canvas");
      if (!canvas) return;

      const elements = [];
      const nodes = canvas.querySelectorAll(".couples-handbook-element");
      nodes.forEach(node => {
        const x = parseInt(node.style.left);
        const y = parseInt(node.style.top);
        const rotate = parseInt(node.getAttribute("data-rotate")) || 0;
        const zIndex = parseInt(node.getAttribute("data-z-index")) || 1;
        
        const img = node.querySelector("img");
        const textarea = node.querySelector("textarea");

        if (img) {
          elements.push({
            id: node.id,
            type: "image",
            x, y, rotate, zIndex,
            src: img.src,
            size: parseInt(node.getAttribute("data-size")) || 60
          });
        } else if (textarea) {
          const content = textarea.value;
          elements.push({
            id: node.id,
            type: "text",
            x, y, rotate, zIndex,
            content: content,
            width: parseInt(textarea.style.width) || 120,
            height: parseInt(textarea.style.height) || 60
          });
        }
      });

      const book = await db.table('couples_journals').get(this.currentHandbookId);
      let pages = [];
      try { pages = JSON.parse(book.elementsJson) || [[]]; } catch(e) {}
      
      pages[this.currentHandbookPageIndex] = elements;

      await db.table('couples_journals').update(this.currentHandbookId, {
        elementsJson: JSON.stringify(pages)
      });
      
      if (!silentMode) showToast("手账页面数据已物理保存成功！");
    },

    async triggerAiJournalWriting() {
      if (!this.selectedElement || !this.selectedElement.querySelector("textarea")) {
        await this.alertCouples("先选一个文本框", "点一下画布上你想让 TA 代写的那块文本框，再点这个按钮。");
        return;
      }

      showToast("正在检索最近总结，AI 构思手账配文中...");

      try {
        const api = await window.apiRoutes.resolve("couples");
        const char = await db.archives.get(Number(this.activeCharId));

        const prompt = `【手账配文代写任务】：
你现在是 [${char?.name || '对方'}]。你们情侣空间里正在制作纪念手账。
请为这页手账写下一句极其温暖、带有双端恋爱回忆质感的 30 字以内的小配文，不准带 Emoji 字符和任何系统指示标签！`;

        let journalContent;
        const journalMessages = [{ role: "user", content: prompt }];
        if (typeof window.fwCallLLM === "function") {
          try {
            journalContent = await window.fwCallLLM(api, journalMessages, {});
          } catch(e) { /* fall through to original fetch */ }
        }
        if (journalContent === undefined) {
          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: journalMessages
            })
          });

          if (response.ok) {
            const res = await response.json();
            journalContent = res.choices[0].message.content;
          }
        }
        if (journalContent !== undefined) {
          const txt = journalContent.trim();
          this.selectedElement.querySelector("textarea").value = txt;
          showToast("AI 手账配文写入就绪！");
        }
      } catch (e) {
        console.error(e);
      }
    },

    // ==========================================================================
    // 子系统 4：私密悄悄话（v1.5.17 重做）
    //
    // 设计目标（用户反馈：太凌乱、注意力不集中、发起/结束逻辑混乱）：
    //   1. 一次只聊「一期」悄悄话：屏幕上永远只有这一期的对白，历史期收起进归档。
    //   2. 每一期都是独立上下文：AI 只看得到这一期的对白，旧的自然滑出上下文，
    //      所以每期开口都贴合「当下」关系状态，而不是被几天前的旧话题拖住。
    //   3. 双方都能主动发起：用户直接发消息 / 点「换个话题」；角色在空白页、
    //      或用户主动点回复时，会自己先开口。
    //   4. 结束逻辑收敛成「一期结束」一种：久未回应 / 聊太长 / 手动结束 / AI 收尾，
    //      都走同一个 closeWhisperSession()，并且一定会留下一条摘要进记忆库。
    // ==========================================================================

    // 一期悄悄话的空闲时限：超过这个时间没人说话，本期自动收尾，下一条消息开新的一期
    // （用户可在「悄悄话设置」里改，默认 12 小时）
    WHISPER_IDLE_DEFAULT_MS: 12 * 60 * 60 * 1000,
    WHISPER_IDLE_OPTIONS: [
      { label: '1 小时', ms: 1 * 60 * 60 * 1000 },
      { label: '3 小时', ms: 3 * 60 * 60 * 1000 },
      { label: '6 小时', ms: 6 * 60 * 60 * 1000 },
      { label: '12 小时', ms: 12 * 60 * 60 * 1000 },
      { label: '1 天', ms: 24 * 60 * 60 * 1000 },
      { label: '3 天', ms: 3 * 24 * 60 * 60 * 1000 },
      { label: '不自动收起', ms: 0 }
    ],
    // 一期最多容纳多少条对白（超过就自然翻页，避免上下文无限膨胀）
    WHISPER_MAX_TURNS: 40,
    // 最近多少期会作为「近况」带入新一期的开场（只带摘要，几百字，不会污染上下文）
    WHISPER_RECENT_SESSIONS: 3,

    _whisperIdleKey() {
      return `couples_whisper_idle_${this.activeMeId}_${this.activeCharId}`;
    },
    // 取当前设定的空闲时限（0 = 不自动收起）
    getWhisperIdleMs() {
      try {
        const raw = localStorage.getItem(this._whisperIdleKey());
        if (raw === null || raw === undefined || raw === '') return this.WHISPER_IDLE_DEFAULT_MS;
        const v = parseInt(raw, 10);
        return isNaN(v) ? this.WHISPER_IDLE_DEFAULT_MS : v;
      } catch (e) { return this.WHISPER_IDLE_DEFAULT_MS; }
    },
    setWhisperIdleMs(ms) {
      try { localStorage.setItem(this._whisperIdleKey(), String(ms)); } catch (e) {}
    },
    _formatIdleLabel(ms) {
      if (!ms) return '不自动收起';
      const h = ms / 3600000;
      if (h < 24) return `${h % 1 === 0 ? h : h.toFixed(1)} 小时`;
      return `${Math.round(h / 24)} 天`;
    },

    // 悄悄话设置面板：一期多长自动收起 / 手动换期
    async openWhisperSettings() {
      const cur = this.getWhisperIdleMs();
      let html = `<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">`;
      html += `<div style="font-size:11.5px; color:#64748b; line-height:1.6;">多久没人说话，这一期就自动收好（会写一条摘要进记忆，下一句自动开新的一期）。</div>`;
      this.WHISPER_IDLE_OPTIONS.forEach(opt => {
        const active = opt.ms === cur;
        html += `<button class="couples-whisper-opt${active ? ' active' : ''}" onclick="couplesSystem.setWhisperIdleFromUI(${opt.ms})">${opt.label}${active ? ' · 当前' : ''}</button>`;
      });
      html += `<div style="border-top:1px dashed var(--border); margin-top:2px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
        <button class="couples-whisper-opt" onclick="couplesSystem.letCharOpenWhisper()">让对方先开口（换一期）</button>
        <button class="couples-whisper-opt" onclick="couplesSystem.openWhisperArchiveList()">查看往期悄悄话</button>
      </div></div>`;
      this.showFrostedDialog("悄悄话设置", html);
    },

    setWhisperIdleFromUI(ms) {
      this.setWhisperIdleMs(ms);
      const overlay = document.querySelector(".couples-dialog-overlay");
      if (overlay) overlay.remove();
      showToast(ms ? `这一期静下来 ${this._formatIdleLabel(ms)} 后会自己收好` : "已改为不自动收起，手动点「收好这一期」才收起");
      this.renderWhisperChat();
    },

    // 取当前打开（未收尾）的那一期
    async getActiveWhisperSession() {
      try {
        const list = await db.table('couples_whisper_topics')
          .where('charId').equals(Number(this.activeCharId))
          .toArray();
        const open = list.filter(t => !t.closed && t.archived !== 1);
        if (open.length === 0) return null;
        // 兼容旧数据：老话题没有 sessionId，只有 topicId
        open.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        const top = open[open.length - 1];
        if (top.sessionId == null) top.sessionId = top.id;
        return top;
      } catch (e) {
        console.warn("[悄悄话] 读取当前期失败", e);
        return null;
      }
    },

    isWhisperSessionIdle(session, now) {
      if (!session) return true;
      const idleMs = this.getWhisperIdleMs();
      if (!idleMs) return false;   // 用户设成「不自动收起」
      const last = session.lastMessageAt || session.startTime || 0;
      return (now - last) > idleMs;
    },

    // 开一期新的悄悄话（只建元数据，不代写台词；开场白由 AI 或用户自己说）
    async openWhisperSession(initiator) {
      const now = Date.now();
      const who = initiator === 'user' ? 'user' : 'char';
      const title = who === 'user' ? '（等你说第一句）' : '（等对方开口）';
      const id = await db.table('couples_whisper_topics').add({
        charId: Number(this.activeCharId),
        meId: Number(this.activeMeId),
        topicTitle: title,
        initiator: who,
        startTime: now,
        lastMessageAt: now,
        endTime: 0,
        archived: 0,
        closed: 0,
        msgCount: 0,
        summary: '',
        sessionId: null
      });
      try { await db.table('couples_whisper_topics').update(id, { sessionId: id }); } catch (e) {}
      const session = await db.table('couples_whisper_topics').get(id);
      if (session) session.sessionId = id;
      return session;
    },

    // 取「当前应该继续聊的那一期」：没有就开一期；已经空闲太久就先收尾再开新的一期
    async ensureWhisperSession(initiator) {
      const now = Date.now();
      let session = await this.getActiveWhisperSession();
      if (session && this.isWhisperSessionIdle(session, now)) {
        await this.closeWhisperSession(session.id, true);
        session = null;
      }
      if (!session) session = await this.openWhisperSession(initiator || 'user');
      return session;
    },

    // 取某一期里的对白（按时间正序）；兼容只有 topicId 的旧数据
    async listWhisperMessages(session) {
      if (!session) return [];
      const sid = Number(session.sessionId || session.id);
      const all = await db.table('couples_whispers')
        .where('charId').equals(Number(this.activeCharId))
        .sortBy('timestamp');
      return all.filter(m => {
        if (sid) return Number(m.sessionId) === sid || (!m.sessionId && Number(m.topicId) === sid);
        return Number(m.topicId) === Number(session.id);
      });
    },

    // 本期对白条数（用于「第几句 / 是否该翻页」）
    async countWhisperMessages(session) {
      const msgs = await this.listWhisperMessages(session);
      return msgs.filter(m => !m.sysNote).length;
    },

    // 收尾一期：写摘要进记忆库 + 标记该期消息归档。所有结束路径都走这里。
    async closeWhisperSession(sessionId, isAuto = false, silent = false) {
      try {
        const session = await db.table('couples_whisper_topics').get(Number(sessionId));
        if (!session || session.closed === 1 || session.archived === 1) return session;
        const msgs = await this.listWhisperMessages(session);
        const realMsgs = msgs.filter(m => !m.sysNote && m.content);

        let summary = '';
        if (realMsgs.length > 0) {
          summary = await this.summarizeWhisperTopic(session, realMsgs);
        }

        // 写入记忆库（关系类摘要）：新一期开场只带摘要，不带旧对白，天然不污染上下文
        if (summary) {
          let sessId = Number(this.activeSessionId) || 0;
          if (!sessId) {
            const sessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
            const targetSess = sessList.find(s => s.charId === Number(this.activeCharId));
            sessId = targetSess ? targetSess.id : 0;
          }
          if (sessId) {
            try {
              await db.summaries.add({
                sessionId: sessId,
                startRound: 0,
                endRound: 0,
                content: `【情侣空间·悄悄话】第「${session.topicTitle || '未命名'}」期（${session.initiator === 'user' ? '我主动开口' : '对方主动开口'}）：${summary}`,
                category: 'relationship',
                keywords: JSON.stringify(['悄悄话', '情侣空间', session.topicTitle || '']),
                timestamp: Date.now(),
                vector: null
              });
            } catch (e) { console.warn("[悄悄话] 摘要入库失败", e); }
          }
        }

        await db.table('couples_whisper_topics').update(session.id, {
          closed: 1,
          archived: 1,
          endTime: Date.now(),
          msgCount: realMsgs.length,
          summary: summary || (realMsgs.length ? '(总结失败)' : '(空白一期，未留下内容)')
        });
        for (const m of msgs) {
          try { await db.table('couples_whispers').update(m.id, { archived: 1 }); } catch (e) {}
        }

        if (!silent) {
          if (realMsgs.length === 0) showToast("这一期没有留下对白，已合上");
          else if (isAuto) showToast("这一期悄悄话已收尾，摘要已记进你们的记忆");
          else showToast("这一期悄悄话已收好，摘要已记进记忆");
        }
        return session;
      } catch (e) {
        console.error("[悄悄话] 收尾失败", e);
        return null;
      }
    },

    // 兼容入口：旧的 archiveTopic(同样语义) 继续可用
    async archiveTopic(topicId, isAuto = false) {
      return this.closeWhisperSession(topicId, isAuto);
    },

    async renderWhisperChat() {
      const flow = document.getElementById("couples-whisper-messages-flow");
      if (!flow) return;
      flow.innerHTML = "";

      // 没有确定角色时什么都不做：避免建出 charId 为 NaN 的脏数据
      if (!this.activeCharId || isNaN(Number(this.activeCharId))) {
        const hint = document.createElement("div");
        hint.className = "couples-whisper-empty";
        hint.innerHTML = '<div class="cwe-title">还没有选择共度的人</div><div class="cwe-sub">先在最上方切换到一位角色</div>';
        flow.appendChild(hint);
        const bar0 = document.getElementById("couples-whisper-topic-status-bar");
        if (bar0) bar0.style.display = "none";
        return;
      }

      let session = await this.getActiveWhisperSession();
      const now = Date.now();

      // 空闲太久：先把上一期收好（静默），让用户看到的永远是「新的一期」
      if (session && this.isWhisperSessionIdle(session, now)) {
        await this.closeWhisperSession(session.id, true, true);
        session = null;
      }

      this._whisperSession = session;
      let msgs = session ? await this.listWhisperMessages(session) : [];
      msgs = msgs.filter(m => !m.sysNote);

      if (!session || msgs.length === 0) {
        // 空态：干净的一句话 + 一个明确的邀请，不堆文案
        const empty = document.createElement("div");
        empty.className = "couples-whisper-empty";
        empty.innerHTML =
          '<div class="cwe-title">现在是只属于你们两个人的时间</div>' +
          '<div class="cwe-sub">说第一句，或者让对方先开口</div>';
        flow.appendChild(empty);
        if (!this._whisperScheduledCharOpen) {
          this._whisperScheduledCharOpen = true;
          setTimeout(() => {
            this._whisperScheduledCharOpen = false;
            if (this.currentSubPage === 'whisper') this.triggerWhisperReply({ opener: true });
          }, 900);
        }
      } else {
        let prevTs = 0;
        let prevSender = null;
        msgs.forEach(m => {
          // 超过 10 分钟换一轮，插一条极淡的时间分隔，让注意力有节奏
          if (m.timestamp - prevTs > 10 * 60 * 1000) {
            const sep = document.createElement("div");
            sep.className = "couples-whisper-timesep";
            sep.innerText = this.formatWhisperTime(m.timestamp);
            flow.appendChild(sep);
            prevSender = null;
          }
          const div = document.createElement("div");
          div.className = `couples-whisper-card ${m.senderType === 'user' ? 'user' : 'char'}`;
          if (prevSender === m.senderType) div.classList.add("tight");
          div.innerText = m.content;
          div.dataset.msgId = m.id;
          div.ondblclick = (e) => {
            e.preventDefault();
            this.triggerWhisperEditDialog(m.id, m.content);
          };
          flow.appendChild(div);
          prevTs = m.timestamp;
          prevSender = m.senderType;
        });
      }

      this.renderWhisperSessionBar(session, msgs.length);
      await this.renderWhisperArchiveEntry();
      requestAnimationFrame(() => { flow.scrollTop = flow.scrollHeight; });
    },

    // 顶部的「本期」细条：只说清三件事——谁先开口、聊到第几句、多久没回应会收起
    renderWhisperSessionBar(session, count) {
      const bar = document.getElementById("couples-whisper-topic-status-bar");
      const titleEl = document.getElementById("couples-whisper-topic-title");
      if (!bar || !titleEl) return;
      if (!session) {
        bar.style.display = "none";
        return;
      }
      const idleLabel = this._formatIdleLabel(this.getWhisperIdleMs());
      const who = session.initiator === 'user' ? '你主动开口' : '对方主动开口';
      titleEl.innerText = count > 0
        ? `${who} · 已经 ${count} 句 · 静下来 ${idleLabel} 自动收起`
        : `${who} · 等第一句 · 静下来 ${idleLabel} 自动收起`;
      bar.style.display = "flex";
    },

    formatWhisperTime(ts) {
      const d = new Date(ts || Date.now());
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (sameDay) return `今天 ${hh}:${mm}`;
      return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
    },

    // 兼容旧调用：取当前期（旧名 getActiveTopic）
    async getActiveTopic() {
      return this.getActiveWhisperSession();
    },

    // 兼容旧调用：旧版「3 天自动归档」巡检，现在由 ensureWhisperSession 的空闲判定接管
    async autoArchiveExpiredTopics() {
      try {
        const open = await db.table('couples_whisper_topics')
          .where('charId').equals(Number(this.activeCharId))
          .toArray();
        for (const t of open.filter(x => !x.closed && x.archived !== 1)) {
          if (this.isWhisperSessionIdle(t, Date.now())) {
            await this.closeWhisperSession(t.id, true, true);
          }
        }
      } catch (e) { console.warn("[悄悄话] 空闲巡检失败", e); }
    },

    // 调用 LLM 总结一段悄悄话话题
    async summarizeWhisperTopic(topic, topicMsgs) {
      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) return "";

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));
        const charName = char?.name || "对方";
        const userName = user?.name || "我";

        let historyText = "";
        topicMsgs.forEach(m => {
          const who = m.senderType === 'user' ? userName : charName;
          historyText += `${who}: ${m.content}\n`;
        });

        const prompt = `你是情感记忆归档引擎。请把以下情侣在"悄悄话私密空间"中围绕话题《${topic.topicTitle}》的一段对话，压缩成一段 80-150 字的精华记忆摘要。
要求：
1. 客观记录双方的核心情绪表达、达成的情感共识、未解的心结。
2. 保留双方人设与关系特征（[${charName}] 与 [${userName}]）。
3. 直接输出纯文本摘要，不要任何 Markdown、标题、引号包裹。

对话内容：
${historyText}`;

        // 与其它模块一致：优先走统一 LLM 通道（带路由/降级），失败再直接 fetch
        let summaryText;
        if (typeof window.fwCallLLM === "function") {
          try {
            summaryText = await window.fwCallLLM(api, [{ role: "user", content: prompt }], { temperature: 0.4 });
          } catch (e) { summaryText = undefined; }
        }
        if (summaryText === undefined) {
          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.4
            })
          });
          if (!response.ok) return "";
          const res = await response.json();
          summaryText = res.choices?.[0]?.message?.content;
        }
        return String(summaryText || "").trim();
      } catch(e) {
        console.warn("总结悄悄话失败", e);
        return "";
      }
    },

    // 渲染底部"历史归档"入口按钮
    async renderWhisperArchiveEntry() {
      let entryBar = document.getElementById("couples-whisper-archive-entry");
      // 统计已归档话题数
      const archivedTopics = await db.table('couples_whisper_topics')
        .where('charId').equals(Number(this.activeCharId))
        .and(t => t.archived === 1)
        .toArray();
      if (archivedTopics.length === 0) {
        if (entryBar) entryBar.remove();
        return;
      }
      const flow = document.getElementById("couples-whisper-messages-flow");
      if (!flow) return;
      if (!entryBar) {
        entryBar = document.createElement("div");
        entryBar.id = "couples-whisper-archive-entry";
        flow.appendChild(entryBar);
      } else {
        entryBar.innerHTML = "";
      }
      // 归档入口放在消息流顶部：翻完这一期往下走，往期在更上面，符合「往上翻历史」的直觉
      flow.insertBefore(entryBar, flow.firstChild);
      const btn = document.createElement("button");
      btn.className = "couples-whisper-archive-btn";
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:5px;">' +
        '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>' +
        `往期悄悄话 · ${archivedTopics.length}`;
      btn.onclick = () => this.openWhisperArchiveList();
      entryBar.appendChild(btn);
    },

    // 打开历史归档列表浮层
    async openWhisperArchiveList() {
      const topics = await db.table('couples_whisper_topics')
        .where('charId').equals(Number(this.activeCharId))
        .and(t => t.archived === 1)
        .reverse()
        .sortBy('endTime');

      let listHtml = `<div style="display:flex; flex-direction:column; gap:8px; max-height:60vh; overflow-y:auto;">`;
      if (topics.length === 0) {
        listHtml += `<p style="text-align:center; color:#94a3b8; font-size:12px; padding:20px 0;">暂无已归档的悄悄话话题</p>`;
      } else {
        topics.forEach(t => {
          const timeStr = t.endTime ? this.formatWhisperTime(t.endTime) : '未知时间';
          const countStr = t.msgCount ? `${t.msgCount} 句` : '';
          listHtml += `
            <div class="couples-whisper-archive-item">
              <div class="cwai-head">
                <span class="cwai-title">${window.escapeHtml(t.topicTitle || '未命名的一期')}</span>
                <span class="cwai-time">${timeStr}${countStr ? ' · ' + countStr : ''}</span>
              </div>
              <div class="cwai-meta">${t.initiator === 'user' ? '我主动开口' : '对方主动开口'}</div>
              <div class="cwai-summary">${window.escapeHtml(t.summary || '(没有留下摘要)')}</div>
            </div>
          `;
        });
      }
      listHtml += `</div>`;

      const overlay = this.showFrostedDialog("悄悄话历史归档", listHtml);
      if (overlay) {
        // 只读弹窗：藏掉取消/确认，但右上角 X 与点遮罩仍可关闭（曾经这里被彻底卡死）
        const cancelBtn = overlay.querySelector("#btn-couples-dialog-cancel");
        const confirmBtn = overlay.querySelector("#btn-couples-dialog-confirm");
        if (cancelBtn) cancelBtn.style.display = "none";
        if (confirmBtn) confirmBtn.style.display = "none";
      }
    },

    // 简易 HTML 转义（情侣空间内部用）
    escapeHtmlC(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // ==========================================================================
    // 素材贴纸库存储（v1.5.17：迁到 IndexedDB，localStorage 只有约 5MB）
    //   每块贴纸是一张压缩后的 base64 图（~200-400KB），十几块就会撞上 localStorage
    //   配额，setItem 抛异常而调用方没接 → 表现为「贴纸库时好时坏 / 上传丢图」。
    // ==========================================================================
    _sharedAssetsKey: 'couples_shared_assets',
    _sharedAssetsCache: null,

    // 同步读：给「同步渲染路径」用（点按弹层里来不及 await）。缓存由 loadSharedAssets 预热。
    _sharedAssetsSync() {
      if (Array.isArray(this._sharedAssetsCache)) return this._sharedAssetsCache;
      const legacy = this._localAssetsRead();
      this._sharedAssetsCache = legacy;
      return legacy;
    },

    _localAssetsRead() {
      try { return JSON.parse(localStorage.getItem(this._sharedAssetsKey)) || []; } catch (e) { return []; }
    },

    // 读贴纸库：优先 IndexedDB 的 assets 表，首次自动把 localStorage 的旧数据搬过去
    async loadSharedAssets() {
      if (typeof window.tileAssetGet === 'function') {
        try {
          const stored = await window.tileAssetGet(this._sharedAssetsKey);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed)) {
                // 已经搬过一次：清掉 localStorage 里的旧副本，避免两份数据打架
                try { localStorage.removeItem(this._sharedAssetsKey); } catch (e) {}
                this._sharedAssetsCache = parsed;
                return parsed;
              }
            } catch (e) {}
          }
          const legacy = this._localAssetsRead();
          if (legacy.length > 0) {
            await this.saveSharedAssets(legacy);
            return legacy;
          }
          this._sharedAssetsCache = [];
          return [];
        } catch (e) {
          console.warn("[情侣空间] 贴纸库读取 IndexedDB 失败，回落 localStorage", e);
        }
      }
      const legacy2 = this._localAssetsRead();
      this._sharedAssetsCache = legacy2;
      return legacy2;
    },

    // 写贴纸库：优先 IndexedDB；不可用时回落 localStorage，并且**明确报错**而不是静默吞掉
    async saveSharedAssets(list) {
      const arr = Array.isArray(list) ? list : [];
      this._sharedAssetsCache = arr;
      if (typeof window.tileAssetSet === 'function') {
        try {
          await window.tileAssetSet(this._sharedAssetsKey, JSON.stringify(arr));
          return { ok: true, store: 'idb' };
        } catch (e) {
          console.warn("[情侣空间] 贴纸库写入 IndexedDB 失败，回落 localStorage", e);
        }
      }
      try {
        localStorage.setItem(this._sharedAssetsKey, JSON.stringify(arr));
        return { ok: true, store: 'local' };
      } catch (e) {
        console.error("[情侣空间] 贴纸库写入失败", e);
        if (typeof showToast === 'function') showToast("素材存不进去了：本地空间已满，先去「设置 - 数据管理 - 图片管理」清理一些图片");
        return { ok: false, store: 'none', error: e };
      }
    },

    triggerWhisperEditDialog(msgId, content) {
      const formHtml = `
        <div style="text-align:left; display:flex; flex-direction:column; gap:12px;">
          <textarea id="whisper-edit-textarea" rows="4" style="width:100%; padding:10px; font-size:13px; border-radius:10px;">${content}</textarea>
          <div style="display:flex; flex-direction:column; gap:8px; border-top:1px dashed var(--border); padding-top:10px;">
            <button class="btn btn-primary" id="btn-whisper-action-save" style="width:100%; height:38px; background:#07c160; border:none; font-weight:700;">保存修改</button>
            <button class="btn btn-danger-outline" id="btn-whisper-action-delete" style="width:100%; height:38px; border:none; color:#ef4444; background:#fee2e2; font-weight:700;">粉碎删除这条悄悄话</button>
          </div>
        </div>
      `;

      const overlay = this.showFrostedDialog("管理私密悄悄话", formHtml, null);
      
      overlay.querySelector("#btn-whisper-action-save").onclick = async () => {
        const val = document.getElementById("whisper-edit-textarea").value.trim();
        if (!val) return;
        await db.table('couples_whispers').update(msgId, { content: val });
        overlay.remove();
        this.renderWhisperChat();
        showToast("悄悄话已被修改");
      };

      overlay.querySelector("#btn-whisper-action-delete").onclick = async () => {
        const yes = await this.confirmCouples("粉碎这条悄悄话？", "这一句会从你们的悄悄话里彻底消失，无法找回。", "粉碎删除");
        if (!yes) return;
        await db.table('couples_whispers').delete(msgId);
        overlay.remove();
        this.renderWhisperChat();
        showToast("悄悄话已粉碎删除");
      };

      overlay.querySelector("#btn-couples-dialog-cancel").style.display = "none";
      overlay.querySelector("#btn-couples-dialog-confirm").style.display = "none";
    },

    async sendWhisperMessage() {
      const input = document.getElementById("couples-whisper-input");
      const text = input ? input.value.trim() : "";
      if (!text) return;

      // 拿「当前这一期」：没有就开一期（由我发起），本来就是我主动开口
      const session = await this.ensureWhisperSession('user');
      const sid = Number(session.sessionId || session.id);

      await db.table('couples_whispers').add({
        charId: Number(this.activeCharId),
        meId: Number(this.activeMeId),
        senderType: "user",
        content: text,
        timestamp: Date.now(),
        topicId: Number(session.id),
        sessionId: sid,
        archived: 0
      });
      await this.touchWhisperSession(session, text);

      if (input) { input.value = ""; input.style.height = ""; }
      await this.renderWhisperChat();

      // 用户主动说了话 → 对方自然接话（不需要再点一次按钮）
      await this.triggerWhisperReply();
    },

    // 更新这一期的活跃时间 / 条数 / 标题（标题取第一句有内容的话）
    async touchWhisperSession(session, firstText) {
      if (!session) return;
      const patch = { lastMessageAt: Date.now() };
      const count = (Number(session.msgCount) || 0) + 1;
      patch.msgCount = count;
      const title = String(session.topicTitle || '');
      const placeholder = title.indexOf('（等') === 0 || !title;
      if (placeholder && firstText) {
        patch.topicTitle = firstText.replace(/\s+/g, ' ').slice(0, 18) + (firstText.length > 18 ? '…' : '');
      }
      try { await db.table('couples_whisper_topics').update(Number(session.id), patch); } catch (e) {}
      Object.assign(session, patch);
    },

    // opts.opener = true：这一轮是要「主动开口」（空白页 / 新一期），而不是接话
    async triggerWhisperReply(opts) {
      const options = opts || {};
      const flow = document.getElementById("couples-whisper-messages-flow");
      if (!flow) return;
      const btnReply = document.getElementById("btn-couples-whisper-reply");
      if (btnReply && btnReply.disabled) return;   // 正在生成，避免连点
      if (btnReply) btnReply.disabled = true;

      const oldBtnHTML = btnReply ? btnReply.innerHTML : null;
      if (btnReply) btnReply.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" fill="#f87171"/></svg>';

      const loader = document.createElement("div");
      loader.className = "couples-whisper-card char is-typing";
      loader.innerText = options.opener ? "（对方正在想着怎么开口...）" : "（对方正在写悄悄话...）";
      flow.appendChild(loader);
      flow.scrollTop = flow.scrollHeight;

      const restoreBtn = () => {
        if (btnReply) {
          btnReply.disabled = false;
          if (oldBtnHTML) btnReply.innerHTML = oldBtnHTML;
        }
      };

      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) throw new Error("API未配置");

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));
        const charName = char?.name || "对方";
        const userName = user?.name || "我";

        // 这一期：既定的当前期，或（opener 时）开一期由对方发起
        let session = await this.getActiveWhisperSession();
        if (!session) session = await this.openWhisperSession(options.opener ? 'char' : 'char');
        if (this.isWhisperSessionIdle(session, Date.now())) {
          await this.closeWhisperSession(session.id, true, true);
          session = await this.openWhisperSession('char');
        }

        // 上下文 = 只取这一期的对白（旧的一期已归档，天然不进来）
        const sessionMsgs = await this.listWhisperMessages(session);
        const contextMsgs = sessionMsgs.filter(m => !m.sysNote).slice(-12);
        const isOpener = options.opener === true || contextMsgs.length === 0;

        let historyText = "";
        contextMsgs.forEach(m => {
          const who = m.senderType === 'user' ? userName : charName;
          historyText += `${who}: ${m.content}\n`;
        });
        if (!historyText) historyText = "(这一期还没有人说话)";

        // 最近几期的摘要作为「近况」带入，只给摘要不给原文，避免旧话题拖住当下
        let recentText = "";
        try {
          const recent = await db.table('couples_whisper_topics')
            .where('charId').equals(Number(this.activeCharId))
            .toArray();
          const done = recent
            .filter(t => (t.closed === 1 || t.archived === 1) && t.summary && t.summary.indexOf('(空白') !== 0)
            .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
            .slice(0, this.WHISPER_RECENT_SESSIONS);
          if (done.length) {
            recentText = "\n【你们最近几期悄悄话的近况（仅供你了解此刻关系的温度，不要复述、不要当作当前对话）】：\n"
              + done.map(t => `- ${t.summary}`).join("\n") + "\n";
          }
        } catch (e) {}

        const initiatorLine = session.initiator === 'user'
          ? `这一期是 ${userName} 先开的口，正在等你回应。`
          : `这一期是你先开的口。`;

        const openerInstruction = isOpener
          ? `\n【本轮任务：你先开口】
- 现在这一期还没有人说话，${session.initiator === 'user' ? '是 ' + userName + ' 先来找的你' : '由你主动先开口'}。
- 请写 1 到 2 句你此刻真正想说的话，作为这一期的开场：可以是一个念头、一件今天发生的小事、一点没来由的情绪、一句只对这个人才会说的话。
- 严禁套话（"在吗""今天过得怎么样"这类一律不要），要有你自己的语气与人设细节。
- 不要说"我们聊聊某某话题"这种主持人式的话。`
          : `\n【本轮任务：接住对方】
- 必须紧扣对白历史里 ${userName} 最近说的话回应，每一句都要有情绪反馈，不要self自顾自。
- 你可以说 1 到 2 句简短、有拉扯感、情绪递进的话。`;

        const prompt = `【悄悄话 · 只属于你们两人的私密时刻】：
你现在需要严格、深度地扮演 [${charName}]。
在你们的关系中，【你首先是你自己（必须坚定坚守你的本性与核心人设，切勿媚俗或一味迎合，保持你特有的说话语调与内心骄傲）】，其次你才是对方的爱人。

- 你的【角色背景设定】：
${char?.persona || "一个普通人"}

- 这里是只属于你和 [${userName}] 两人最私密的深夜悄悄话室（你可以在这里放下所有白天的伪装与防备）。
- ${initiatorLine}
${recentText}
要求：
1. 性格优先：每一句都必须百分之百符合你原本的人设（傲娇、冷淡、温柔或内敛都行），绝不能出现机械谄媚，你的自尊与骄傲必须依然存在。
2. 注意力集中：只围绕这一期正在发生的情绪，不要翻旧账、不要复述往期话题。
3. 篇幅克制：最多 2 句；若有多句，必须用 [SPLIT] 分割。如：我想你了[SPLIT]其实，今天一直都在想你。
4. 绝对不准出现任何 Emoji，也不准使用任何括号动作描述。
${openerInstruction}

【可选指令（想用才用，不用就正常说话）】
- 当这一期你已经把想说的都说完了、想主动收尾时，在回复【最末尾】单独一行写：[WHISPER_TOPIC_END]{}
  系统会把这一期收好、写成摘要存进你们的记忆，然后等你下一次开口。
- 这些指令行不会展示给 ${userName} 看。`;

        let whisperContent;
        const whisperMessages = [{ role: "user", content: prompt + `\n\n这一期到目前为止的对白：\n${historyText}` }];
        if (typeof window.fwCallLLM === "function") {
          try {
            whisperContent = await window.fwCallLLM(api, whisperMessages, { temperature: 0.85 });
          } catch(e) { /* fall through to original fetch */ }
        }
        if (whisperContent === undefined) {
          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: whisperMessages,
              temperature: 0.85
            })
          });
          if (!response.ok) throw new Error("网络异常");
          const res = await response.json();
          whisperContent = res.choices[0].message.content;
        }
        let reply = String(whisperContent || "").trim();

        // 1. AI 主动收尾
        let topicEndRequested = false;
        if (/\[WHISPER_TOPIC_END\]\s*\{\s*\}/i.test(reply)) {
          topicEndRequested = true;
          reply = reply.replace(/\[WHISPER_TOPIC_END\]\s*\{\s*\}/gi, "").trim();
        }
        // 2. 兼容旧格式：AI 想开新话题 —— 现在等价于「收好这一期，下一轮自然开新的一期」
        if (reply.indexOf('[WHISPER_TOPIC_START]') !== -1) {
          const startIdx = reply.indexOf('[WHISPER_TOPIC_START]');
          const tail = reply.substring(startIdx + '[WHISPER_TOPIC_START]'.length);
          const balanced = this.extractBalancedJsonLocal(tail);
          reply = (reply.substring(0, startIdx) + tail.substring(balanced ? balanced.length : 0)).trim();
        }
        // 3. 清掉可能残留的满意度标记（旧版机制，已废弃）
        reply = reply.replace(/\[SATISFACTION\]\s*\d*/gi, "").trim();

        // 去掉等待框
        if (loader && loader.parentNode) loader.remove();

        // 这一期太长了：先把这一期收好（摘要进记忆），本轮内容落到新的一期
        let targetSession = session;
        if (topicEndRequested || (Number(session.msgCount) || contextMsgs.length) >= this.WHISPER_MAX_TURNS) {
          await this.closeWhisperSession(session.id, true, true);
          targetSession = await this.openWhisperSession('char');
        }
        const targetSid = Number(targetSession.sessionId || targetSession.id);

        let parts = reply.split(/\[SPLIT\]|【SPLIT】/i).map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) parts = ["（对方沉默了一会儿）"];

        const sessionForWrite = targetSession;
        let currentPartIndex = 0;
        const renderNextPart = async () => {
          if (currentPartIndex >= parts.length) {
            restoreBtn();
            return;
          }
          await db.table('couples_whispers').add({
            charId: Number(this.activeCharId),
            meId: Number(this.activeMeId),
            senderType: "char",
            content: parts[currentPartIndex],
            timestamp: Date.now(),
            topicId: Number(sessionForWrite.id),
            sessionId: targetSid,
            archived: 0
          });
          await this.touchWhisperSession(sessionForWrite, null);
          await this.renderWhisperChat();

          currentPartIndex++;
          if (currentPartIndex < parts.length) {
            const prevText = parts[currentPartIndex - 1];
            const delay = Math.max(1200, Math.min(2500, prevText.length * 80));
            setTimeout(renderNextPart, delay);
          } else {
            restoreBtn();
          }
        };
        await renderNextPart();

      } catch (e) {
        console.error("[悄悄话] 生成失败", e);
        if (loader && loader.parentNode) {
          loader.innerText = "对方现在有些害羞脆弱，暂时不想多说。";
        }
        restoreBtn();
      }
    },

    // 括号平衡法提取首个 {...} JSON（仅供 whisper 模块本地用，避免与全局同名冲突）
    extractBalancedJsonLocal(text) {
      if (!text) return null;
      const start = text.indexOf('{');
      if (start === -1) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
        } else {
          if (ch === '"') { inStr = true; }
          else if (ch === '{') { depth++; }
          else if (ch === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
        }
      }
      return null;
    },

    // 悄悄话话题库：按「情绪方向」分组。每条都是**方向**而不是台词，
    // 由 AI 结合人设与当下剧情自己发挥，避免套模板。
    WHISPER_TOPIC_LIBRARY: [
      {
        group: '今晚的心情',
        items: [
          '今天最想告诉你的一件小事',
          '最近我在想我们的什么',
          '今天有一瞬间特别想你',
          '有件事我一直没敢说',
          '如果今晚只能说一句话'
        ]
      },
      {
        group: '吃醋与占有',
        items: [
          '今天我吃醋了（你猜是因为谁）',
          '我想知道你身边最近都有谁',
          '你会不会也有藏起来不告诉我的事',
          '我们之间有没有让你不安的地方',
          '今天看到你和别人说话时我在想什么'
        ]
      },
      {
        group: '靠近一点',
        items: [
          '想做却一直没对你做的事',
          '你今天身上的味道让我走神了',
          '如果现在我就站在你面前',
          '想被你怎么抱',
          '说一句你平时不会说的话'
        ]
      },
      {
        group: '深夜频道（成人向）',
        items: [
          '今晚想聊一点平时不会聊的',
          '你最不敢说出口的偏好是什么',
          '如果我什么都答应你，你想做什么',
          '你身上有哪个地方最不能碰',
          '想听你用另一种语气叫我',
          '我们之中谁更主动一点'
        ]
      },
      {
        group: '关系与未来',
        items: [
          '你希望我们一年后是什么样子',
          '有没有哪一刻你想过放弃我',
          '我最怕你对我做什么',
          '我们之间最该改掉的一点',
          '十年后我们生活的样子'
        ]
      }
    ],

    triggerWhisperTopicForm() {
      const groups = this.WHISPER_TOPIC_LIBRARY || [];
      const idleLabel = this._formatIdleLabel(this.getWhisperIdleMs());
      let listHtml = `
        <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
          <div style="font-size:11.5px; line-height:1.6; color:#64748b;">
            选一个方向，或者让对方自己开口。换话题 = 把这一期收好（会写进你们的记忆，静下来 ${idleLabel} 也会自动收）。
          </div>
          <button class="couples-whisper-opt" onclick="couplesSystem.letCharOpenWhisper()">让对方先开口（换一期）</button>
          <button class="couples-whisper-opt" onclick="couplesSystem.suggestWhisperTopicsByContext()">按今天的剧情，让 TA 出三个话题</button>
      `;
      groups.forEach(g => {
        listHtml += `<div class="couples-whisper-topic-group">
          <div class="cwtg-name">${window.escapeHtml(g.group)}</div>
          <div class="cwtg-chips">`;
        g.items.forEach(p => {
          listHtml += `<button class="couples-whisper-chip" onclick="couplesSystem.startWhisperTopic('${p.replace(/'/g, "\\'")}', 'user')">${window.escapeHtml(p)}</button>`;
        });
        listHtml += `</div></div>`;
      });
      listHtml += `
          <div style="border-top:1px dashed var(--border); padding-top:10px;">
            <label style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">或者，写下你今晚真正想聊的</label>
            <div style="display:flex; gap:6px;">
              <input type="text" id="whisper-custom-topic-input" placeholder="一句话就够了" style="flex:1; height:34px; font-size:12px; border-radius:8px;">
              <button onclick="couplesSystem.submitCustomWhisperTopic()" class="btn btn-primary" style="padding:0 14px; font-size:11.5px; height:34px; border:none; border-radius:8px;">换一期</button>
            </div>
          </div>
        </div>
      `;
      this.showFrostedDialog("换一期悄悄话", listHtml);
    },

    // 按「最近的剧情」让 AI 出三个贴合的悄悄话话题，（可选）一个偏成人向
    async suggestWhisperTopicsByContext() {
      const overlay = document.querySelector(".couples-dialog-overlay");
      showToast("正在读你们最近的剧情...");
      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) throw new Error("API 未就绪");

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));
        const charName = (char && char.name) || '对方';
        const userName = (user && user.name) || '我';

        // 取最近的线上对话 + 最近几期悄悄话摘要，作为「当下的剧情」
        let recentText = "";
        try {
          const sessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
          const target = sessList.find(s => s.charId === Number(this.activeCharId));
          if (target) {
            const msgs = await db.messages.where('sessionId').equals(target.id).reverse().limit(12).toArray();
            recentText = msgs.reverse().map(m => `${m.senderType === 'user' ? userName : charName}：${String(m.content || '').slice(0, 120)}`).join('\n');
          }
        } catch (e) {}
        let memoText = "";
        try {
          const topics = await db.table('couples_whisper_topics').where('charId').equals(Number(this.activeCharId)).toArray();
          memoText = topics
            .filter(t => t.summary && (t.closed === 1 || t.archived === 1))
            .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
            .slice(0, 3)
            .map(t => `- ${t.summary}`)
            .join('\n');
        } catch (e) {}

        const prompt = `你是「${charName}」，正在和「${userName}」的私密悄悄话空间里，准备主动挑起今晚想聊的话题。

你的人设：
${(char && char.persona) || '（未设置）'}

你们最近的线上剧情：
${recentText || '(最近没有新的线上对话)'}

最近几期悄悄话的近况：
${memoText || '(还没有往期)'}

请基于**上面这些真实剧情**，提出 3 个你此刻最想和对方聊的话题方向（不是台词，是"想聊什么"）。
要求：
1. 三个话题必须与当前剧情有因果关系（比如最近发生过某件事、有某个人出现、有某句没说完的话）。
2. 必须贴合你的人设语气与在意的东西，不要写成通用情感话题。
3. 第 3 个可以比前两个更私密、更贴身体或更成人向一些，但**尺度由人设和当前关系进展决定**，不要为露骨而露骨。
4. 每个话题 12 字以内，直接就是话题名。
5. 只输出 JSON 数组，不要 Markdown，不要解释：
[{"title":"话题一"},{"title":"话题二"},{"title":"话题三"}]`;

        let raw;
        if (typeof window.fwCallLLM === "function") {
          try { raw = await window.fwCallLLM(api, [{ role: "user", content: prompt }], { temperature: 0.9 }); } catch (e) { raw = undefined; }
        }
        if (raw === undefined) {
          const resp = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({ model: api.model, messages: [{ role: "user", content: prompt }], temperature: 0.9 })
          });
          if (!resp.ok) throw new Error("网络异常");
          const j = await resp.json();
          raw = j.choices[0].message.content;
        }
        const text = String(raw || '').replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
        let arr = [];
        try {
          arr = JSON.parse(text);
        } catch (e) {
          const m = text.match(/\[[\s\S]*\]/);
          if (m) arr = JSON.parse(m[0]);
        }
        const titles = (Array.isArray(arr) ? arr : []).map(x => (x && (x.title || x.topic)) || '').filter(Boolean).slice(0, 3);
        if (titles.length === 0) throw new Error("没有解析出话题");

        if (overlay) overlay.remove();
        let html = `<div style="display:flex; flex-direction:column; gap:8px; text-align:left;">
          <div style="font-size:11.5px; color:#64748b; line-height:1.6;">这是 TA 根据你们最近的剧情挑出来的方向，点一个就直接开这一期。</div>`;
        titles.forEach(t => {
          html += `<button class="couples-whisper-chip" style="padding:11px 14px; font-size:12.5px;" onclick="couplesSystem.startWhisperTopic('${t.replace(/'/g, "\\'")}', 'char')">${window.escapeHtml(t)}</button>`;
        });
        html += `<button class="couples-whisper-opt" onclick="couplesSystem.triggerWhisperTopicForm()">回到话题库</button></div>`;
        this.showFrostedDialog("TA 想聊的", html);
      } catch (e) {
        console.error("[悄悄话] 生成话题失败", e);
        showToast("没读出来，先回到话题库挑一个");
        this.triggerWhisperTopicForm();
      }
    },

    // 「让对方先开口」：把当前一期收好，然后由角色开一期并说第一句
    async letCharOpenWhisper() {
      const overlay = document.querySelector(".couples-dialog-overlay");
      if (overlay) overlay.remove();
      const active = await this.getActiveWhisperSession();
      if (active) await this.closeWhisperSession(active.id, false, true);
      await this.renderWhisperChat();
      await this.triggerWhisperReply({ opener: true });
    },

    setTopicInitiator(initiator) {
      this.whisperTopicInitiator = initiator;
      const btnChar = document.getElementById("btn-topic-init-char");
      const btnUser = document.getElementById("btn-topic-init-user");
      if (initiator === 'char') {
        if (btnChar) { btnChar.style.background = "#ff8fa3"; btnChar.style.color = "#fff"; btnChar.classList.remove("btn-outline"); }
        if (btnUser) { btnUser.style.background = "none"; btnUser.style.color = "#64748b"; btnUser.classList.add("btn-outline"); }
      } else {
        if (btnChar) { btnChar.style.background = "none"; btnChar.style.color = "#64748b"; btnChar.classList.add("btn-outline"); }
        if (btnUser) { btnUser.style.background = "#ff8fa3"; btnUser.style.color = "#fff"; btnUser.classList.remove("btn-outline"); }
      }
    },

    submitCustomWhisperTopic() {
      const input = document.getElementById("whisper-custom-topic-input");
      const text = input ? input.value.trim() : "";
      if (!text) {
        showToast("先写一句你今晚想聊的");
        return;
      }
      this.startWhisperTopic(text, 'user');
    },

    // 换一期：把当前一期收好（写摘要进记忆），再以新标题开一期
    async startWhisperTopic(topicTitle, initiator = 'char') {
      const overlay = document.querySelector(".couples-dialog-overlay");
      if (overlay) overlay.remove();

      // 先把已经聊过的这一期收好，避免两期混在同一个上下文里
      const active = await this.getActiveWhisperSession();
      if (active) await this.closeWhisperSession(active.id, false, true);

      const session = await this.openWhisperSession(initiator);
      const patch = { topicTitle: topicTitle };
      try { await db.table('couples_whisper_topics').update(Number(session.id), patch); } catch (e) {}
      Object.assign(session, patch);

      this.activeTopicId = session.id;
      this.activeTopicStartTime = Date.now();
      await this.renderWhisperChat();

      // 用户指定的话题 => 用户先开口；否则让角色先开口
      showToast(initiator === 'user' ? "换好了，说第一句吧" : "换好了，等对方开口");
    },

    async endWhisperTopic() {
      const active = await this.getActiveWhisperSession();
      if (!active) {
        showToast("这一期已经收好了");
        await this.renderWhisperChat();
        return;
      }
      await this.closeWhisperSession(active.id, false, false);
      this.whisperTopicActive = false;
      this.whisperSatisfactionLevel = 0;
      this.activeTopicId = null;
      await this.renderWhisperChat();
    },

    // ==========================================================================
    // 子系统 5：愿望清单 + AI 自动写愿望 (Wishlist System)
    // ==========================================================================
    async renderWishList() {
      const flow = document.getElementById("couples-wish-list-flow");
      if (!flow) return;
      flow.innerHTML = "";

      let safeSessId = Number(this.activeSessionId);
      if (isNaN(safeSessId) || !safeSessId) {
        const sessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
        const targetSess = sessList.find(s => s.charId === Number(this.activeCharId));
        safeSessId = targetSess ? targetSess.id : 0;
        this.activeSessionId = safeSessId;
      }

      const wishes = await db.table('summaries')
        .where('sessionId').equals(safeSessId)
        .and(s => s.source === 'couples_wish')
        .toArray();

      const syncBtn = document.getElementById("btn-couples-wish-sync-toggle");
      if (syncBtn && !document.getElementById("btn-couples-wish-ai")) {
        const aiBtn = document.createElement("button");
        aiBtn.id = "btn-couples-wish-ai";
        aiBtn.className = "btn-icon";
        aiBtn.title = "AI 替对方写下/更新秘密愿望";
        aiBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
          </svg>
        `;
        aiBtn.onclick = () => this.generateAiWish();
        syncBtn.parentNode.insertBefore(aiBtn, syncBtn);
      }

      if (wishes.length === 0) {
        flow.innerHTML = `<p style="text-align:center; font-size:11px; color:#94a3b8; padding:32px 0;">暂时没有共同愿望，点击右上角加号，和TA一起写下愿望吧</p>`;
        return;
      }

      wishes.forEach(w => {
        const row = document.createElement("div");
        const isCompleted = w.endRound === 1; 
        row.className = `couples-wish-row${isCompleted ? ' completed' : ''}`;
        
        let wishOwner = 'user';
        let cleanContent = w.content;
        try {
          const kw = JSON.parse(w.keywords || "[]");
          if (kw.includes('char_wish') || w.content.startsWith("（TA的心愿）") || w.content.startsWith("(TA的心愿)")) {
            wishOwner = 'char';
          }
        } catch(e) {}

        cleanContent = cleanContent.replace(/^[（(]?(TA的心愿|我的心愿)[）)]?\s*/, "");

        let badgeHtml = "";
        let borderStyle = "";
        if (wishOwner === 'char') {
          badgeHtml = `<span style="background:#e0f2fe; color:#0369a1; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; margin-right:4px;">TA的期许</span>`;
          borderStyle = "background: rgba(224, 242, 254, 0.55); border-left: 3px solid #0284c7;";
        } else {
          badgeHtml = `<span style="background:#fdf2f8; color:#db2777; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; margin-right:4px;">我的心愿</span>`;
          borderStyle = "background: rgba(255, 241, 242, 0.55); border-left: 3px solid #f43f5e;";
        }

        row.style.cssText = borderStyle;
        row.innerHTML = `
          <div class="couples-wish-checkbox${isCompleted ? ' checked' : ''}" onclick="couplesSystem.toggleWishComplete(${w.id}, ${isCompleted ? 0 : 1})">
            ${isCompleted ? `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:4px; flex:1; text-align:left; z-index:2;">
            <div style="display:flex;">${badgeHtml}</div>
            <div class="couples-wish-content" style="text-decoration: ${isCompleted ? 'line-through' : 'none'}; color: ${isCompleted ? '#94a3b8' : '#334155'};">${window.escapeHtml(cleanContent)}</div>
          </div>
          <button onclick="couplesSystem.deleteWish(${w.id})" class="btn-icon" style="color:#ef4444; z-index:2;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        `;
        flow.appendChild(row);
      });
    },

    addNewWishForm() {
      const formHtml = `
        <div class="form-group" style="text-align:left;">
          <label style="font-size:11px; font-weight:700;">许下一个对未来的愿望</label>
          <input type="text" id="wish-form-content" placeholder="输入你想与TA一同做的事，如 一起去一次海边">
        </div>
      `;

      this.showFrostedDialog("写下愿望便利贴", formHtml, async () => {
        const content = document.getElementById("wish-form-content").value.trim();
        if (!content) {
          await this.alertCouples("愿望还没写", "写下你真正想要的那件事吧，哪怕很小。");
          return false;
        }

        let safeSessId = Number(this.activeSessionId);
        if (isNaN(safeSessId) || !safeSessId) {
          const sessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
          const targetSess = sessList.find(s => s.charId === Number(this.activeCharId));
          safeSessId = targetSess ? targetSess.id : 0;
          this.activeSessionId = safeSessId;
        }

        await db.table('summaries').add({
          sessionId: safeSessId,
          startRound: 1,
          endRound: 0, 
          content: content,
          category: 'factual',
          keywords: JSON.stringify(["wishlist", "user_wish"]), 
          timestamp: Date.now(),
          source: 'couples_wish'
        });

        this.renderWishList();
      });
    },

    async generateAiWish() {
      showToast("正在感应TA对未来的深处期待，悄悄撰写心愿中...");

      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) throw new Error("API未配置");

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));

        let historyText = "";
        const msgs = await db.messages.where('sessionId').equals(this.activeSessionId).reverse().limit(10).toArray();
        msgs.reverse().forEach(m => {
          let cleaned = m.content.replace(/^[\[【](QUOTE|引用)\s*:\s*(\d+)[\]】]\s*/i, '');
          historyText += `${m.senderType === 'user' ? 'User' : 'Char'}: ${cleaned}\n`;
        });

        const prompt = `【愿望代写任务】：
你现在是 [${char?.name || '对方'}]。这里是专属你们两人的情侣心愿墙。
请结合你们的相处温度与你内心的柔软处，代写一个属于你的、渴望在未来与 [${user?.name || '我'}] 共同实现的一个浪漫心愿。

要求：
1. 愿望内容：极其温柔性格化，30 字以内的一句话心愿（如：想在下个雪天，拉着你去买刚出炉的烤红薯）。
2. 绝对不准带有任何 Emoji，直接输出心愿文字本身！`;

        let wishContent;
        const wishMessages = [{ role: "user", content: prompt + `\n\n最近对白参考：\n${historyText}` }];
        if (typeof window.fwCallLLM === "function") {
          try {
            wishContent = await window.fwCallLLM(api, wishMessages, {});
          } catch(e) { /* fall through to original fetch */ }
        }
        if (wishContent === undefined) {
          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: wishMessages
            })
          });

          if (response.ok) {
            const res = await response.json();
            wishContent = res.choices[0].message.content;
          }
        }
        if (wishContent !== undefined) {
          const wishText = wishContent.trim().replace(/[\[【]?[A-Z_]+[\]】]?/g, "");

          await db.table('summaries').add({
            sessionId: Number(this.activeSessionId),
            startRound: 1,
            endRound: 0,
            content: wishText,
            category: 'factual',
            keywords: JSON.stringify(["wishlist", "char_wish"]),
            timestamp: Date.now(),
            source: 'couples_wish'
          });

          this.renderWishList();
          showToast("AI 秘密愿望已悄悄挂载在心愿墙上！");
        }
      } catch (e) {
        console.error(e);
        showToast("感应失败，请检查网络接口。");
      }
    },

    async toggleWishComplete(id, completeState) {
      await db.table('summaries').update(id, { endRound: completeState });
      this.renderWishList();
    },

    async deleteWish(id) {
      const yes = await this.confirmCouples("移除这个愿望？", "便利贴会被拿掉，确定吗？", "移除");
      if (!yes) return;
      await db.table('summaries').delete(id);
      this.renderWishList();
    },

    toggleWishSync() {
      const syncKey = `couples_wish_sync_${this.activeMeId}_${this.activeCharId}`;
      const state = localStorage.getItem(syncKey) === "true";
      try { localStorage.setItem(syncKey, !state ? "true" : "false"); } catch (e) {}
      showToast(!state ? "愿望清单数据已同步并融入聊天 Prompt" : "已断开愿望与聊天的同步");
    },

    // ==========================================================================
    // 子系统 6：共享贴纸素材库 (Assets Library)
    // ==========================================================================
    async loadMaterialsLibrary(activeCategoryFilter = "全部") {
      const drawer = document.getElementById("couples-materials-library-drawer");
      const thumbs = document.getElementById("couples-assets-thumbs-container");
      if (!drawer || !thumbs) return;

      thumbs.innerHTML = "";

      let tabsRow = document.getElementById("couples-assets-group-tabs");
      if (!tabsRow) {
        tabsRow = document.createElement("div");
        tabsRow.id = "couples-assets-group-tabs";
        tabsRow.className = "couples-assets-group-tabs-row";
        drawer.insertBefore(tabsRow, drawer.querySelector("#couples-assets-thumbs-container"));
      }
      
      const presets = [
        { id: "preset_0", url: "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' width='40' height='40' fill='none' stroke='%23ff8fa3' stroke-width='2'><path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/></svg>", name: "微光心心", group: "内置", description: "手绘粉色爱心插图贴纸" },
        { id: "preset_1", url: "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' width='40' height='40' fill='none' stroke='%233b82f6' stroke-width='2'><circle cx='12' cy='12' r='10'/><path d='M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01'/></svg>", name: "温顺笑脸", group: "内置", description: "手绘蓝色笑脸贴纸" },
        { id: "preset_2", url: "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' width='40' height='40' fill='none' stroke='%23ca8a04' stroke-width='2'><path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/></svg>", name: "许愿星星", group: "内置", description: "手绘发光星星奖章" }
      ];

      let list = [];
      try { list = await this.loadSharedAssets(); } catch(e) { list = []; }
      
      const allAssets = [...presets, ...list];

      const groupsSet = new Set(["全部", "内置", "底图"]);
      list.forEach(a => { if (a.group) groupsSet.add(a.group); });
      
      tabsRow.innerHTML = "";
      groupsSet.forEach(gName => {
        const tab = document.createElement("span");
        tab.className = `couples-assets-tab${gName === activeCategoryFilter ? ' active' : ''}`;
        tab.innerText = gName;
        tab.onclick = () => this.loadMaterialsLibrary(gName);
        tabsRow.appendChild(tab);
      });

      allAssets.forEach(a => {
        if (activeCategoryFilter === "全部" || a.group === activeCategoryFilter) {
          this.renderAssetThumb(a.url, a.id);
        }
      });
    },

    renderAssetThumb(url, id) {
      const container = document.getElementById("couples-assets-thumbs-container");
      if (!container) return;

      const thumb = document.createElement("div");
      thumb.className = "couples-asset-thumb";
      thumb.innerHTML = `<img src="${url}" />`;
      thumb.onclick = () => {
        this.openAssetAttributesForm(url, id);
      };
      container.appendChild(thumb);
    },

    addAssetToHandbookCanvas(url, isBackground = false) {
      const newEl = {
        id: "el_" + Date.now(),
        type: "image",
        x: isBackground ? 0 : 80,
        y: isBackground ? 0 : 80,
        src: url,
        size: isBackground ? 300 : 60,
        rotate: 0,
        zIndex: isBackground ? 1 : 10
      };
      this.renderElementOnCanvas(newEl);
    },

    async openAssetAttributesForm(url, id) {
      let savedAssets = [];
      try { savedAssets = await this.loadSharedAssets(); } catch(e) { savedAssets = []; }
      
      const isPreset = id.startsWith("preset_");
      let curAsset = { name: "甜蜜贴纸", group: "常驻", description: "手账画白装饰" };
      if (isPreset) {
        const idx = parseInt(id.split("_")[1]);
        const presets = [
          { name: "微光心心", group: "内置", description: "手绘粉色爱心插图贴纸" },
          { name: "温顺笑脸", group: "内置", description: "手绘蓝色笑脸贴纸" },
          { name: "许愿星星", group: "内置", description: "手绘发光星星奖章" }
        ];
        curAsset = presets[idx] || curAsset;
      } else {
        curAsset = savedAssets.find(a => a.id === id) || curAsset;
      }

      const formHtml = `
        <div style="text-align:left; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <div style="width:70px; height:70px; border:1.5px dashed #fbcfe8; border-radius:12px; overflow:hidden; background:#ffffff; display:flex; align-items:center; justify-content:center;">
              <img src="${url}" style="max-width:100%; max-height:100%; object-fit:contain;">
            </div>
          </div>
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">贴纸起名</label>
            <input type="text" id="asset-form-name" value="${curAsset.name || '甜蜜贴纸'}" ${isPreset ? 'readonly style="background:#f1f5f9;"' : ''}>
          </div>
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">分类分组</label>
            <input type="text" id="asset-form-group" value="${curAsset.group || '常驻'}" ${isPreset ? 'readonly style="background:#f1f5f9;"' : ''}>
          </div>
          <div class="form-group">
            <label style="font-size:11px; font-weight:700;">画面细节描述 (AI将读取并进行智能推荐放置)</label>
            <textarea id="asset-form-desc" rows="2" placeholder="手账贴纸描述" ${isPreset ? 'readonly style="background:#f1f5f9;"' : ''}>${curAsset.description || ''}</textarea>
          </div>
          
          <div style="display:flex; flex-direction:column; gap:8px; border-top:1px dashed var(--border); padding-top:10px; margin-top:4px;">
            <button class="btn btn-primary" id="btn-asset-action-place" style="width:100%; height:38px; background:#07c160; border:none; font-weight:700;">直接放置于手账中</button>
            <button class="btn btn-danger-outline" id="btn-asset-action-delete" style="width:100%; height:38px; border:none; color:#ef4444; background:#fee2e2; font-weight:700; display: ${isPreset ? 'none' : 'block'};">彻底从素材库删除</button>
          </div>
        </div>
      `;

      const overlay = this.showFrostedDialog("素材属性管理与应用", formHtml, null, () => {});
      
      overlay.querySelector("#btn-asset-action-place").onclick = async () => {
        const name = document.getElementById("asset-form-name").value.trim() || "未知贴纸";
        const group = document.getElementById("asset-form-group").value.trim() || "常驻";
        const description = document.getElementById("asset-form-desc").value.trim() || "手账装饰";

        if (!isPreset) {
          const list = this._sharedAssetsSync();
          const idx = list.findIndex(a => a.id === id);
          if (idx !== -1) {
            list[idx].name = name;
            list[idx].group = group;
            list[idx].description = description;
          }
          await this.saveSharedAssets(list);
        }

        const isBg = group === "底图";
        this.addAssetToHandbookCanvas(url, isBg);
        overlay.remove();
        document.getElementById("couples-materials-library-drawer").classList.remove("active");
        showToast(`贴纸「${name}」已即时放置在画布上！`);
      };

      overlay.querySelector("#btn-asset-action-delete").onclick = async () => {
        const yes = await this.confirmCouples("从贴纸库删除？", "这块素材贴纸会从你的贴纸库里永久移除。", "删除");
        if (!yes) return;
        let list = [];
        try { list = await this.loadSharedAssets(); } catch(e) { list = []; }
        const newList = list.filter(a => a.id !== id);
        await this.saveSharedAssets(newList);

        overlay.remove();
        this.loadMaterialsLibrary();
        showToast("该素材已成功删除。");
      };

      overlay.querySelector("#btn-couples-dialog-confirm").style.display = "none";
    },

    mountAiAssetSelectorButton() {
      const drawerHeader = document.querySelector("#couples-materials-library-drawer .couples-navbar");
      if (drawerHeader && !document.getElementById("btn-couples-assets-ai")) {
        const aiBtn = document.createElement("button");
        aiBtn.id = "btn-couples-assets-ai";
        aiBtn.className = "btn btn-outline";
        aiBtn.style.cssText = "font-size:11px; padding:4px 8px; border-radius:6px; border-color:#8b5cf6; color:#8b5cf6; background:none;";
        aiBtn.innerHTML = "AI 智能帮选";
        aiBtn.onclick = () => this.triggerAiAssetSelection();
        drawerHeader.querySelector("div").insertBefore(aiBtn, drawerHeader.querySelector("div").firstChild);
      }
    },

    async triggerAiAssetSelection() {
      showToast("AI 正在根据本页手账风格，智能挑选最衬托的贴纸...");

      try {
        const api = await window.apiRoutes.resolve("couples");
        if (!api) throw new Error("API未就绪");

        const char = await db.archives.get(Number(this.activeCharId));
        const book = await db.table('couples_journals').get(this.currentHandbookId);

        let savedAssets = [];
        try { savedAssets = await this.loadSharedAssets(); } catch(e) { savedAssets = []; }
        
        const presets = [
          { id: "preset_0", name: "微光玫瑰心心", description: "手绘粉色爱心" },
          { id: "preset_1", name: "笑口常开心心", description: "手绘眨眼笑脸" },
          { id: "preset_2", name: "发光愿望勋章", description: "手绘小星星奖章" }
        ];
        const allAssets = [...presets, ...savedAssets];

        if (allAssets.length === 0) {
          showToast("您的素材库是空的，请先上传新贴纸并设置属性描述！");
          return;
        }

        const assetsPromptList = allAssets.map((a, idx) => `[素材索引: ${idx}] - 名字: "${a.name}" | 细节白描: "${a.description}"`).join("\n");

        const prompt = `【手账素材 AI 智能帮选任务】：
你现在是 [${char?.name || '对方'}]。你们正在情侣空间装饰手账本《${book.name}》。
请从可用素材库内挑选出 1 至 2 款在情感上最相衬的素材，并给出极具美感的排盘设计（画布大小为 300px * 400px）。

【可用素材库清单】：
${assetsPromptList}

【输出限制】：直接返回以下格式的 JSON 数组（代表挑选的素材安排），绝对不要包含 Markdown 代码块包装，更不能带 Emoji 字符：
[
  {"index": 挑选的素材索引, "x": 横坐标0_300, "y": 纵坐标0_400, "size": 贴纸宽度40_100, "rotate": 旋转偏角_180_180}
]`;

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (!response.ok) throw new Error("API推演响应异常");
        const res = await response.json();
        const rawJsonText = res.choices[0].message.content.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
        const selections = JSON.parse(rawJsonText);

        for (let sel of selections) {
          const matchedAsset = allAssets[sel.index];
          if (matchedAsset) {
            let url = matchedAsset.url;
            if (matchedAsset.id.startsWith("preset_")) {
              const idx = parseInt(matchedAsset.id.split("_")[1]);
              const presets = [
                "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' width='40' height='40' fill='none' stroke='%23ff8fa3' stroke-width='2'><path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/></svg>",
                "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' width='40' height='40' fill='none' stroke='%233b82f6' stroke-width='2'><circle cx='12' cy='12' r='10'/><path d='M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01'/></svg>",
                "data:image/svg+xml;utf8,<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' width='40' height='40' fill='none' stroke='%23ca8a04' stroke-width='2'><path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/></svg>"
              ];
              url = presets[idx];
            }

            const newEl = {
              id: "el_ai_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
              type: "image",
              x: sel.x,
              y: sel.y,
              src: url,
              size: sel.size || 60,
              rotate: sel.rotate || 0,
              zIndex: 5
            };
            this.renderElementOnCanvas(newEl);
          }
        }

        document.getElementById("couples-materials-library-drawer").classList.remove("active");
        showToast(`AI 伴选摆盘成功！已自动推荐并放置 ${selections.length} 个贴纸。`);

      } catch (e) {
        console.error(e);
        showToast("AI帮选分析失败，进入手动选取");
      }
    },

    handleAssetUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        // 全局采用 1080px 视网膜高清自适应 Canvas 压缩自愈引擎，防止大面积底图模糊 [1]
        const compressed = await window.compressImageBase64(event.target.result, 1080, 0.85);
        let list = [];
        list = await this.loadSharedAssets();

        const newId = "asset_" + Date.now();
        list.push({
          id: newId,
          url: compressed,
          name: "自定义贴纸",
          group: "常驻",
          description: "用户手动上传的手账贴纸"
        });

        await this.saveSharedAssets(list);
        this.loadMaterialsLibrary();
        showToast("新贴纸上传成功，点一下贴纸可以改名字和分组");
      };
      reader.readAsDataURL(file);
    }
  };

  window.couplesSystem = couplesSystem;

  window.initCouplesApp = function() {
    if (window.couplesSystem) {
      window.couplesSystem.openModal();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => couplesSystem.init());
  } else {
    couplesSystem.init();
  }
})();