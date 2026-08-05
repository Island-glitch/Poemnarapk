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
        btnCalAdd.onclick = () => this.addNewScheduleForm();
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
      const btnWhisperSend = document.getElementById("btn-couples-whisper-send");
      if (btnWhisperSend) {
        btnWhisperSend.onclick = () => this.sendWhisperMessage();
      }
      const btnWhisperReply = document.getElementById("btn-couples-whisper-reply");
      if (btnWhisperReply) {
        btnWhisperReply.onclick = () => this.triggerWhisperReply();
      }
      const btnWhisperTopic = document.getElementById("btn-couples-whisper-topic");
      if (btnWhisperTopic) {
        btnWhisperTopic.onclick = () => this.triggerWhisperTopicForm();
      }
      const btnWhisperTopicEnd = document.getElementById("btn-couples-whisper-topic-end");
      if (btnWhisperTopicEnd) {
        btnWhisperTopicEnd.onclick = () => this.endWhisperTopic();
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
    },

    /**
     * 自研高保真磨砂 Dialog 引擎 (无 Emoji，纯 HTML 节点解析，规避系统 Dialog 穿透)
     */
    showFrostedDialog(title, htmlContent, onConfirm, onCancel) {
      const parent = document.getElementById("win-couples");
      if (!parent) return;

      const overlay = document.createElement("div");
      overlay.className = "couples-dialog-overlay";
      overlay.innerHTML = `
        <div class="couples-dialog-card">
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
    },

    /**
     * 3. 开启主空间
     */
    async openModal() {
      this.activeMeId = localStorage.getItem("active_me_id");
      if (!this.activeMeId) {
        alert("请先在‘我的’选项卡下选择我的人设！");
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
          alert("情侣空间仅限单聊模式！请先在档案库建立单聊对象！");
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
          const presetId = localStorage.getItem("global_api_preset_id");
          const api = await db.api_presets.get(Number(presetId));
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

          const response = await fetch(`${api.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
            body: JSON.stringify({
              model: api.model,
              messages: [{ role: "user", content: prompt + `\n\n对话历史：\n${historyText}` }],
              temperature: 0.7
            })
          });

          if (!response.ok) throw new Error("API异常");
          const res = await response.json();
          const parsed = JSON.parse(res.choices[0].message.content.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim());

          charMood = parsed.charMood;
          userMood = parsed.userMood;
          progress = parsed.progress;

          localStorage.setItem(keyChar, charMood);
          localStorage.setItem(keyUser, userMood);
          localStorage.setItem(keyProgress, progress);

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

      if (pageId === 'calendar') this.renderCalendar();
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
        alert("未检测到可用的单聊对象，请先去档案库建立！");
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
          alert("必须输入日程计划具体内容！");
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
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
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

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.8
          })
        });

        if (!response.ok) throw new Error("API响应异常");
        const res = await response.json();
        const rawJsonText = res.choices[0].message.content.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
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
      localStorage.setItem(syncKey, !state ? "true" : "false");
      showToast(!state ? "本日日程数据已绑定同步并注入聊天 Prompt" : "已断开日程与聊天的同步");
    },

    async deleteSchedule(id) {
      if (confirm("确定要删除这条日程计划吗？")) {
        await db.table('couples_schedules').delete(id);
        this.renderCalendar();
        showToast("日程已删除");
      }
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
          alert("主题与描述绝不容许为空！");
          return false;
        }

        const addPhoto = async (dataUrl) => {
          let charThought = "每次看起这张合照，心里总是格外踏实。";
          try {
            const presetId = localStorage.getItem("global_api_preset_id");
            const api = await db.api_presets.get(Number(presetId));
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
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
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
      if (confirm("确定要永久删除这张照片吗？")) {
        await db.table('couples_albums').delete(id);
        this.renderAlbum();
        showToast("照片已删除");
      }
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

        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
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
          alert("手账册名称不能为空！");
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
        alert("请先点选画布上某一个要帮写的‘文本框’！");
        return;
      }

      showToast("正在检索最近总结，AI 构思手账配文中...");

      try {
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
        const char = await db.archives.get(Number(this.activeCharId));

        const prompt = `【手账配文代写任务】：
你现在是 [${char?.name || '对方'}]。你们情侣空间里正在制作纪念手账。
请为这页手账写下一句极其温暖、带有双端恋爱回忆质感的 30 字以内的小配文，不准带 Emoji 字符和任何系统指示标签！`;

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (response.ok) {
          const res = await response.json();
          const txt = res.choices[0].message.content.trim();
          this.selectedElement.querySelector("textarea").value = txt;
          showToast("AI 手账配文写入就绪！");
        }
      } catch (e) {
        console.error(e);
      }
    },

    // ==========================================================================
    // 子系统 4：悄悄话 对话空间 (Whisper System)
    // ==========================================================================
    async renderWhisperChat() {
      const flow = document.getElementById("couples-whisper-messages-flow");
      if (!flow) return;
      flow.innerHTML = "";

      // 先做"3天自动归档"巡检：把超过 3 天未结束的话题自动归档并总结进记忆库
      await this.autoArchiveExpiredTopics();

      // 只渲染未归档的悄悄话消息（archived !== 1）
      const allMsgs = await db.table('couples_whispers')
        .where('charId').equals(Number(this.activeCharId))
        .sortBy('timestamp');
      const msgs = allMsgs.filter(m => m.archived !== 1);

      if (msgs.length === 0) {
        flow.innerHTML = `<p style="text-align:center; font-size:11px; color:#94a3b8; padding:32px 0;">这是一个只属于你们两人的私密夜聊空间。点击右上角可以发起一个‘高黏度话题’来互动。对方也可能主动发起一个话题来找你聊。</p>`;
      } else {
        msgs.forEach(m => {
          const div = document.createElement("div");
          div.className = `couples-whisper-card ${m.senderType === 'user' ? 'user' : 'char'}`;
          div.innerText = m.content;

          div.ondblclick = (e) => {
            e.preventDefault();
            this.triggerWhisperEditDialog(m.id, m.content);
          };

          flow.appendChild(div);
        });
      }

      // 同步当前活动话题状态条（优先从 topics 表读取活动话题，向后兼容 localStorage）
      const bar = document.getElementById("couples-whisper-topic-status-bar");
      let activeTopic = await this.getActiveTopic();
      if (activeTopic) {
        this.whisperTopicActive = true;
        this.activeTopicDesc = activeTopic.topicTitle;
        this.whisperTopicInitiator = activeTopic.initiator || 'char';
        this.activeTopicId = activeTopic.id;
        this.activeTopicStartTime = activeTopic.startTime;
        if (bar) {
          bar.style.display = "flex";
          const elapsed = Date.now() - (activeTopic.startTime || Date.now());
          const remainMs = Math.max(0, 3 * 24 * 3600 * 1000 - elapsed);
          const remainDays = Math.ceil(remainMs / (24 * 3600 * 1000));
          const remainLabel = remainMs > 0 ? `· 剩余约 ${remainDays} 天自动归档` : '· 即将自动归档';
          document.getElementById("couples-whisper-topic-title").innerText = `正在探讨：${activeTopic.topicTitle} (${activeTopic.initiator === 'user' ? '由我发起' : '由对方发起'} ${remainLabel})`;
          // 结束话题按钮改为"归档并结束"
          const endBtn = document.getElementById("btn-couples-whisper-topic-end");
          if (endBtn) endBtn.innerText = "归档并结束";
        }
      } else {
        this.whisperTopicActive = false;
        this.activeTopicId = null;
        if (bar) bar.style.display = "none";
      }

      // 渲染底部"历史归档"入口按钮（仅当存在已归档话题时显示）
      await this.renderWhisperArchiveEntry();

      flow.scrollTop = flow.scrollHeight;
    },

    // 获取当前未归档的活动话题（从 topics 表读，向后兼容旧 localStorage 主题）
    async getActiveTopic() {
      try {
        const topics = await db.table('couples_whisper_topics')
          .where('charId').equals(Number(this.activeCharId))
          .and(t => t.archived !== 1)
          .sortBy('startTime');
        if (topics.length > 0) {
          const t = topics[topics.length - 1];
          return t;
        }
      } catch(e) { console.warn("读取 whisper topics 失败", e); }
      // 向后兼容：旧 localStorage 主题
      const topicStateKey = `couples_whisper_topic_state_${this.activeMeId}_${this.activeCharId}`;
      const topicTitle = localStorage.getItem(topicStateKey);
      if (topicTitle) {
        const initiatorKey = `couples_whisper_topic_initiator_${this.activeMeId}_${this.activeCharId}`;
        const topicInitiator = localStorage.getItem(initiatorKey) || 'char';
        // 迁移到 topics 表
        const newId = await db.table('couples_whisper_topics').add({
          charId: Number(this.activeCharId),
          meId: Number(this.activeMeId),
          topicTitle: topicTitle,
          initiator: topicInitiator,
          startTime: Date.now(),
          endTime: 0,
          archived: 0,
          summary: ''
        });
        localStorage.removeItem(topicStateKey);
        localStorage.removeItem(initiatorKey);
        return await db.table('couples_whisper_topics').get(newId);
      }
      return null;
    },

    // 3天自动归档巡检：超过 3 天的活动话题自动归档 + 总结
    async autoArchiveExpiredTopics() {
      try {
        const THREE_DAYS = 3 * 24 * 3600 * 1000;
        const now = Date.now();
        const activeTopics = await db.table('couples_whisper_topics')
          .where('charId').equals(Number(this.activeCharId))
          .and(t => t.archived !== 1)
          .toArray();
        for (const t of activeTopics) {
          if (t.startTime && (now - t.startTime) >= THREE_DAYS) {
            await this.archiveTopic(t.id, true);
          }
        }
      } catch(e) { console.warn("自动归档巡检失败", e); }
    },

    // 归档指定话题：总结消息 -> 写入记忆库 summaries -> 标记话题与消息为已归档
    async archiveTopic(topicId, isAuto = false) {
      try {
        const topic = await db.table('couples_whisper_topics').get(topicId);
        if (!topic) return;
        // 拉取该话题下所有消息
        const allMsgs = await db.table('couples_whispers')
          .where('charId').equals(Number(this.activeCharId))
          .sortBy('timestamp');
        const topicMsgs = allMsgs.filter(m => Number(m.topicId) === Number(topicId));
        if (topicMsgs.length === 0) {
          // 空话题直接归档
          await db.table('couples_whisper_topics').update(topicId, { archived: 1, endTime: Date.now(), summary: '(空话题)' });
          return;
        }

        // 调用 LLM 总结这段悄悄话
        const summary = await this.summarizeWhisperTopic(topic, topicMsgs);

        // 写入记忆库 db.summaries（情侣空间会话复用主会话 sessionId，若无则用 0）
        let sessId = Number(this.activeSessionId) || 0;
        if (!sessId) {
          // 尝试查找该角色的主会话
          const sessList = await db.sessions.where('userId').equals(Number(this.activeMeId)).toArray();
          const targetSess = sessList.find(s => s.charId === Number(this.activeCharId));
          sessId = targetSess ? targetSess.id : 0;
        }
        if (sessId && summary) {
          await db.summaries.add({
            sessionId: sessId,
            startRound: 0,
            endRound: 0,
            content: `【情侣空间·悄悄话归档】话题《${topic.topicTitle}》（${topic.initiator === 'user' ? '我发起' : '对方发起'}）：${summary}`,
            category: 'relationship',
            keywords: JSON.stringify(['悄悄话', '情侣空间', topic.topicTitle]),
            timestamp: Date.now(),
            vector: null
          });
        }

        // 标记话题为已归档
        await db.table('couples_whisper_topics').update(topicId, {
          archived: 1,
          endTime: Date.now(),
          summary: summary || '(总结失败)'
        });
        // 标记该话题下所有消息为已归档
        for (const m of topicMsgs) {
          await db.table('couples_whispers').update(m.id, { archived: 1 });
        }

        if (!isAuto) showToast("悄悄话话题已归档，总结已写入记忆库");
        else showToast(`话题《${topic.topicTitle}》已达 3 天，已自动归档并总结`);
      } catch(e) {
        console.error("归档话题失败", e);
        showToast("归档失败: " + e.message);
      }
    },

    // 调用 LLM 总结一段悄悄话话题
    async summarizeWhisperTopic(topic, topicMsgs) {
      try {
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
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
        return (res.choices?.[0]?.message?.content || "").trim();
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
        entryBar.style.cssText = "text-align:center; padding:10px; margin-top:12px; border-top:1px dashed #cbd5e1;";
        flow.appendChild(entryBar);
      } else {
        entryBar.innerHTML = "";
      }
      const btn = document.createElement("button");
      btn.className = "btn btn-outline";
      btn.style.cssText = "font-size:11px; padding:6px 14px; border-radius:8px; color:#64748b; border-color:#cbd5e1;";
      btn.innerText = `📦 历史归档 (${archivedTopics.length})`;
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
          const timeStr = t.endTime ? new Date(t.endTime).toLocaleString() : '未知';
          listHtml += `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; text-align:left;">
              <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:4px;">${this.escapeHtmlC(t.topicTitle || '未命名话题')}</div>
              <div style="font-size:10px; color:#64748b; margin-bottom:6px;">${t.initiator === 'user' ? '我发起' : '对方发起'} · 归档于 ${timeStr}</div>
              <div style="font-size:11px; color:#475569; line-height:1.5; background:#fff; padding:8px; border-radius:6px; border-left:3px solid #a78bfa;">${this.escapeHtmlC(t.summary || '(无总结)')}</div>
            </div>
          `;
        });
      }
      listHtml += `</div>`;

      this.showFrostedDialog("悄悄话历史归档", listHtml);
      const overlay = document.querySelector(".couples-dialog-overlay");
      if (overlay) {
        overlay.querySelector("#btn-couples-dialog-cancel").style.display = "none";
        overlay.querySelector("#btn-couples-dialog-confirm").style.display = "none";
      }
    },

    // 简易 HTML 转义（情侣空间内部用）
    escapeHtmlC(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

      this.showFrostedDialog("管理私密悄悄话", formHtml, null);

      const overlay = document.querySelector(".couples-dialog-overlay");
      
      overlay.querySelector("#btn-whisper-action-save").onclick = async () => {
        const val = document.getElementById("whisper-edit-textarea").value.trim();
        if (!val) return;
        await db.table('couples_whispers').update(msgId, { content: val });
        overlay.remove();
        this.renderWhisperChat();
        showToast("悄悄话已被修改");
      };

      overlay.querySelector("#btn-whisper-action-delete").onclick = async () => {
        if (confirm("确定要永久粉碎这条悄悄话记录吗？")) {
          await db.table('couples_whispers').delete(msgId);
          overlay.remove();
          this.renderWhisperChat();
          showToast("悄悄话已粉碎删除");
        }
      };

      overlay.querySelector("#btn-couples-dialog-cancel").style.display = "none";
      overlay.querySelector("#btn-couples-dialog-confirm").style.display = "none";
    },

    async sendWhisperMessage() {
      const input = document.getElementById("couples-whisper-input");
      const text = input ? input.value.trim() : "";
      if (!text) return;

      // 绑定当前活动话题 id（若有），便于归档时按话题切分
      const activeTopic = await this.getActiveTopic();
      const topicId = activeTopic ? activeTopic.id : null;

      await db.table('couples_whispers').add({
        charId: Number(this.activeCharId),
        meId: Number(this.activeMeId),
        senderType: "user",
        content: text,
        timestamp: Date.now(),
        topicId: topicId,
        archived: 0
      });

      input.value = "";
      this.renderWhisperChat();
    },

    async triggerWhisperReply() {
      const flow = document.getElementById("couples-whisper-messages-flow");
      const loader = document.createElement("div");
      loader.className = "couples-whisper-card char";
      loader.innerText = "（对方正在极度深情地写着悄悄话...）";
      flow.appendChild(loader);
      flow.scrollTop = flow.scrollHeight;

      // 禁用回复按键，防止连点假死
      const btnReply = document.getElementById("btn-couples-whisper-reply");
      if (btnReply) btnReply.disabled = true;

      let parts = []; // 声明在函数顶级作用域，防止 try 块作用域穿透与 ReferenceError

      try {
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
        if (!api) throw new Error("API未配置");

        const char = await db.archives.get(Number(this.activeCharId));
        const user = await db.archives.get(Number(this.activeMeId));

        const charName = char?.name || "对方";
        const userName = user?.name || "我";

        // 关键修复"不读我的话"：只拉取当前活动话题下的消息（未归档），
        // 而不是把所有悄悄话混在一起取末 8 条（之前会把别的话题内容当上下文）
        const activeTopic = await this.getActiveTopic();
        const currentTopicId = activeTopic ? activeTopic.id : null;
        const allMsgs = await db.table('couples_whispers')
          .where('charId').equals(Number(this.activeCharId))
          .sortBy('timestamp');
        // 优先取当前话题下消息；若无活动话题，则取所有未归档消息
        let contextMsgs;
        if (currentTopicId) {
          contextMsgs = allMsgs.filter(m => Number(m.topicId) === Number(currentTopicId) && m.archived !== 1);
        } else {
          contextMsgs = allMsgs.filter(m => m.archived !== 1);
        }
        // 至少带上最近 12 条以保证连贯，但严格限定在当前话题内
        contextMsgs = contextMsgs.slice(-12);

        let historyText = "";
        contextMsgs.forEach(m => {
          const who = m.senderType === 'user' ? userName : charName;
          historyText += `${who}: ${m.content}\n`;
        });
        if (!historyText) historyText = "(对话刚开始，还没有历史)";

        let topicPrompt = "";
        if (activeTopic) {
          const initByChar = activeTopic.initiator === 'char';
          topicPrompt = `\n【当前处于共同探讨高粘度话题阶段："${activeTopic.topicTitle}"】：
- 这个话题是由${initByChar ? '你（对方 ' + charName + '）' : '用户（' + userName + '）'}主动发起的。${initByChar ? '相当于你对用户表达了这一想法（或期望用户有所回应），你可以用撒娇、傲娇、受挫或极度倾诉欲的语气拉扯，引导用户来温和地哄你、安慰你或向你表达心意。' : '相当于用户向你倾诉了他们的脆弱，需要你来哄哄、体贴并宠溺他们。你必须主动、耐心地包容用户的情绪，展现出无微不至的偏爱、心疼与温柔哄溺。'}
- 你本轮的所有心声输出，必须紧密围绕这个特定话题展开，严格承接用户上一句说的话回应，不要自顾自跑题。
- 如果对方还没有哄好你 / 用户的情绪还没有被你抚平，请继续情绪拉扯，不要敷衍收尾。
- 在回复末尾，请加上针对当前话题的满意度判定（0-100），必须单独占一行：
[SATISFACTION] 满意度值`;
        }

        // 主动发起/结束话题的指令说明（双方都可触发，与线上特殊格式同源）
        const commandInstruction = `
【悄悄话话题指令（你可主动使用，与线上特殊消息格式同源）】：
1. 当你想要主动开启一个新的高粘度悄悄话话题时（而不是被动等用户发起），请在你的回复【最末尾】单独追加一行：
[WHISPER_TOPIC_START]{"title":"你想聊的话题标题","initiator":"char"}
   - title：话题标题，须贴合你此刻的心境与人设（如"今天一直在想我们第一次吵架"）
   - initiator：固定填 "char"（表示由你发起）
   - 注意：只有当前没有活动话题时才能发起；若已有活动话题，请先正常对话。
2. 当你觉得这个话题已经聊到圆满 / 情绪已经释放完毕 / 你想主动收尾时，请在你的回复【最末尾】单独追加一行：
[WHISPER_TOPIC_END]{}
   - 触发后该话题会被归档并自动总结进长期记忆库，然后开始下一段。
3. 这些指令行不会展示给用户看，只用于系统识别。指令行之外的你正常心声台词照常输出。`;

        const prompt = `【悄悄话灵魂交流任务】：
你现在需要严格、深度地扮演 [${charName}]。
在你们的关系中，【你首先是你自己（必须坚定坚守你的本性与核心人设，切勿媚俗或一味迎合，保持你特有的说话语调与内心骄傲）】，其次你才是对方的爱人。

- 你的【角色背景设定】：
${char?.persona || "一个普通人"}

- 这里是只属于你和 [${userName}] 两人最私密的深夜悄悄话室（你可以在这里放下所有白天的伪装与防备）。

请基于【当前话题内的完整对白历史】与你的心境，写下你此时此刻真实、深刻、带有强烈个人性格印记的心声回复。

要求：
1. 性格优先：每一句回复都必须百分之百符合你自身的原本人设（如傲娇、冷淡、温柔或内敛等），绝不能为了恋爱而产生 AI 机器人式的机械谄媚，你的自尊与骄傲必须依然存在。
2. 承接上下文：必须紧扣对白历史里用户最近说的话回应，不要无视、不要跳过、不要自说自话。用户说的每一句你都要有情绪反馈。
3. 连续发言：你可以说 1 到 2 句简短、有拉扯感、情绪递进的话。如果你有多句话要说，必须使用 [SPLIT] 分割。如：我想你了[SPLIT]其实，今天一直都在想你。
4. 绝对不准带有任何 Emoji 字符和任何形式的括号动作描述。
${topicPrompt}
${commandInstruction}`;

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt + `\n\n当前话题对白历史：\n${historyText}` }],
            temperature: 0.85
          })
        });

        if (!response.ok) throw new Error("网络异常");
        const res = await response.json();
        let reply = res.choices[0].message.content.trim();

        // 1. 解析 [WHISPER_TOPIC_END]{} —— AI 主动结束并归档当前话题
        let topicEndRequested = false;
        const endMatch = reply.match(/\[WHISPER_TOPIC_END\]\s*\{\s*\}/i);
        if (endMatch) {
          topicEndRequested = true;
          reply = reply.replace(/\[WHISPER_TOPIC_END\]\s*\{\s*\}/gi, "").trim();
        }

        // 2. 解析 [WHISPER_TOPIC_START]{"title":"...","initiator":"char"} —— AI 主动发起新话题
        //    用括号平衡法提取 JSON
        let newTopicStarted = null;
        const startIdx = reply.indexOf('[WHISPER_TOPIC_START]');
        if (startIdx !== -1) {
          const afterStart = reply.substring(startIdx + '[WHISPER_TOPIC_START]'.length);
          const balancedJson = this.extractBalancedJsonLocal(afterStart);
          if (balancedJson) {
            try {
              newTopicStarted = JSON.parse(balancedJson);
            } catch(e) { console.warn("解析 WHISPER_TOPIC_START JSON 失败", e); }
          }
          // 从回复中移除指令行
          reply = (reply.substring(0, startIdx) + reply.substring(startIdx + '[WHISPER_TOPIC_START]'.length + (balancedJson ? balancedJson.length : 0))).trim();
        }

        // 3. 解析满意度
        const satMatch = reply.match(/\[SATISFACTION\]\s*(\d+)/i);
        if (satMatch) {
          const level = parseInt(satMatch[1]);
          this.whisperSatisfactionLevel = level;
          reply = reply.replace(/\[SATISFACTION\].*$/gi, "").trim();

          if (level >= 90 && activeTopic) {
            // 满意度达标自动归档当前话题
            setTimeout(async () => {
              showToast("对方的心防已被您彻底融化，话题探讨圆满成功！正在归档...");
              if (activeTopic) await this.archiveTopic(activeTopic.id, false);
              await this.renderWhisperChat();
            }, 1000);
          }
        }

        // 移除等待提示载入框
        if (loader) loader.remove();

        // 处理 AI 主动结束当前话题：先归档当前话题，再（若有）开启新话题
        if (topicEndRequested && activeTopic) {
          await this.archiveTopic(activeTopic.id, false);
        }
        if (newTopicStarted && newTopicStarted.title) {
          await this.startWhisperTopic(newTopicStarted.title, newTopicStarted.initiator || 'char');
        }

        // 将 reply 依据 [SPLIT] 分割并清洗存入 parts 中，供 renderNextPart 连发上屏 [3]
        parts = reply.split(/\[SPLIT\]|【SPLIT】/i);
        parts = parts.map(p => p.trim()).filter(Boolean);

        // 绑定当前话题 id（若刚开了新话题则用新话题 id；若刚归档了旧话题且没开新话题则为 null）
        const latestActiveTopic = await this.getActiveTopic();
        const msgTopicId = latestActiveTopic ? latestActiveTopic.id : null;

        let currentPartIndex = 0;
        const renderNextPart = async () => {
          if (currentPartIndex < parts.length) {
            await db.table('couples_whispers').add({
              charId: Number(this.activeCharId),
              meId: Number(this.activeMeId),
              senderType: "char",
              content: parts[currentPartIndex],
              timestamp: Date.now(),
              topicId: msgTopicId,
              archived: 0
            });
            this.renderWhisperChat();

            currentPartIndex++;
            if (currentPartIndex < parts.length) {
              const prevText = parts[currentPartIndex - 1];
              const delay = Math.max(1200, Math.min(2500, prevText.length * 80));
              setTimeout(renderNextPart, delay);
            } else {
              if (btnReply) btnReply.disabled = false;
            }
          }
        };

        if (parts.length > 0) {
          await renderNextPart();
        } else {
          if (btnReply) btnReply.disabled = false;
        }

      } catch (e) {
        console.error(e);
        loader.innerText = "对方现在有些害羞脆弱，暂时不想多说。";
        if (btnReply) btnReply.disabled = false;
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

    triggerWhisperTopicForm() {
      const presets = [
        "共同回忆：认识你第一天的那个画面",
        "内心独白：你做过最让我吃醋心碎的一件事",
        "彼此羁绊：我最想听你对我许下的悄悄承诺",
        "未来的期待：十年后我们生活的样子描述"
      ];

      let listHtml = `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:10px; border:1px solid #e2e8f0;">
            <span style="font-size:11px; font-weight:700; color:#475569;">发起方身份设定：</span>
            <div style="display:flex; gap:6px;">
              <button id="btn-topic-init-char" onclick="couplesSystem.setTopicInitiator('char')" class="btn" style="font-size:10px; padding:4px 10px; background:#ff8fa3; color:#fff; border-radius:6px; border:none; font-weight:700;">对方发起</button>
              <button id="btn-topic-init-user" onclick="couplesSystem.setTopicInitiator('user')" class="btn btn-outline" style="font-size:10px; padding:4px 10px; border-radius:6px; font-weight:700;">我来发起</button>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
      `;

      presets.forEach(p => {
        listHtml += `<button onclick="couplesSystem.startWhisperTopic('${p}', couplesSystem.whisperTopicInitiator)" class="btn btn-outline" style="width:100%; padding:10px; font-size:11.5px; text-align:left; font-weight:700;">${p}</button>`;
      });
      
      listHtml += `
          </div>
          <div style="margin-top:10px; border-top:1px dashed var(--border); padding-top:10px;">
            <label style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block; text-align:left;">输入自定义探讨的话题</label>
            <div style="display:flex; gap:6px;">
              <input type="text" id="whisper-custom-topic-input" placeholder="输入你想聊的秘密话题" style="flex:1; height:32px; font-size:11.5px; border-radius:8px;">
              <button onclick="couplesSystem.submitCustomWhisperTopic()" class="btn btn-primary" style="padding:0 12px; font-size:11px; height:32px; border:none; background:#ff8fa3; border-radius:8px;">发起</button>
            </div>
          </div>
        </div>
      `;

      this.showFrostedDialog("发起悄悄话高感官话题", listHtml);
      this.setTopicInitiator('char'); // 默认选中对方发起
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
        alert("请输入你要探讨的具体话题名称！");
        return;
      }

      this.startWhisperTopic(text, this.whisperTopicInitiator);
    },

    async startWhisperTopic(topicTitle, initiator = 'char') {
      const overlay = document.querySelector(".couples-dialog-overlay");
      if (overlay) overlay.remove();

      this.whisperTopicActive = true;
      this.activeTopicDesc = topicTitle;
      this.whisperSatisfactionLevel = 0;
      this.whisperTopicInitiator = initiator;

      // 写入 topics 表（持久化，支持 3 天自动归档与历史回溯）
      const newId = await db.table('couples_whisper_topics').add({
        charId: Number(this.activeCharId),
        meId: Number(this.activeMeId),
        topicTitle: topicTitle,
        initiator: initiator,
        startTime: Date.now(),
        endTime: 0,
        archived: 0,
        summary: ''
      });
      this.activeTopicId = newId;
      this.activeTopicStartTime = Date.now();

      const bar = document.getElementById("couples-whisper-topic-status-bar");
      if (bar) {
        bar.style.display = "flex";
        document.getElementById("couples-whisper-topic-title").innerText = `正在探讨：${topicTitle} (${initiator === 'user' ? '由我发起' : '由对方发起'} · 剩余约 3 天自动归档)`;
        const endBtn = document.getElementById("btn-couples-whisper-topic-end");
        if (endBtn) endBtn.innerText = "归档并结束";
      }

      this.renderWhisperChat();
    },

    async endWhisperTopic() {
      // 手动归档并结束当前活动话题：调用 archiveTopic 完成总结+入库
      const activeTopic = await this.getActiveTopic();
      if (activeTopic) {
        await this.archiveTopic(activeTopic.id, false);
      } else {
        // 向后兼容：清理残留 localStorage
        const topicStateKey = `couples_whisper_topic_state_${this.activeMeId}_${this.activeCharId}`;
        localStorage.removeItem(topicStateKey);
        showToast("话题讨论已安全存档关闭");
      }
      this.whisperTopicActive = false;
      this.whisperSatisfactionLevel = 0;
      this.activeTopicId = null;

      const bar = document.getElementById("couples-whisper-topic-status-bar");
      if (bar) bar.style.display = "none";

      this.renderWhisperChat();
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
          alert("心愿内容不能为空！");
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
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
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

        const response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify({
            model: api.model,
            messages: [{ role: "user", content: prompt + `\n\n最近对白参考：\n${historyText}` }]
          })
        });

        if (response.ok) {
          const res = await response.json();
          const wishText = res.choices[0].message.content.trim().replace(/[\[【]?[A-Z_]+[\]】]?/g, "");
          
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
      if (confirm("确定要移除这个愿望便利贴吗？")) {
        await db.table('summaries').delete(id);
        this.renderWishList();
      }
    },

    toggleWishSync() {
      const syncKey = `couples_wish_sync_${this.activeMeId}_${this.activeCharId}`;
      const state = localStorage.getItem(syncKey) === "true";
      localStorage.setItem(syncKey, !state ? "true" : "false");
      showToast(!state ? "愿望清单数据已同步并融入聊天 Prompt" : "已断开愿望与聊天的同步");
    },

    // ==========================================================================
    // 子系统 6：共享贴纸素材库 (Assets Library)
    // ==========================================================================
    loadMaterialsLibrary(activeCategoryFilter = "全部") {
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
      try { list = JSON.parse(localStorage.getItem("couples_shared_assets")) || []; } catch(e) {}
      
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

    openAssetAttributesForm(url, id) {
      let savedAssets = [];
      try { savedAssets = JSON.parse(localStorage.getItem("couples_shared_assets")) || []; } catch(e) {}
      
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

      this.showFrostedDialog("素材属性管理与应用", formHtml, null, () => {});

      const overlay = document.querySelector(".couples-dialog-overlay");
      
      overlay.querySelector("#btn-asset-action-place").onclick = () => {
        const name = document.getElementById("asset-form-name").value.trim() || "未知贴纸";
        const group = document.getElementById("asset-form-group").value.trim() || "常驻";
        const description = document.getElementById("asset-form-desc").value.trim() || "手账装饰";

        if (!isPreset) {
          let list = [];
          try { list = JSON.parse(localStorage.getItem("couples_shared_assets")) || []; } catch(e) {}
          const idx = list.findIndex(a => a.id === id);
          if (idx !== -1) {
            list[idx].name = name;
            list[idx].group = group;
            list[idx].description = description;
          }
          localStorage.setItem("couples_shared_assets", JSON.stringify(list));
        }

        const isBg = group === "底图";
        this.addAssetToHandbookCanvas(url, isBg);
        overlay.remove();
        document.getElementById("couples-materials-library-drawer").classList.remove("active");
        showToast(`贴纸「${name}」已即时放置在画布上！`);
      };

      overlay.querySelector("#btn-asset-action-delete").onclick = () => {
        if (confirm("确定要永久从您的贴纸库删除此素材贴纸吗？")) {
          let list = [];
          try { list = JSON.parse(localStorage.getItem("couples_shared_assets")) || []; } catch(e) {}
          const newList = list.filter(a => a.id !== id);
          localStorage.setItem("couples_shared_assets", JSON.stringify(newList));
          
          overlay.remove();
          this.loadMaterialsLibrary();
          showToast("该素材已成功删除。");
        }
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
        const presetId = localStorage.getItem("global_api_preset_id");
        const api = await db.api_presets.get(Number(presetId));
        if (!api) throw new Error("API未就绪");

        const char = await db.archives.get(Number(this.activeCharId));
        const book = await db.table('couples_journals').get(this.currentHandbookId);

        let savedAssets = [];
        try { savedAssets = JSON.parse(localStorage.getItem("couples_shared_assets")) || []; } catch(e) {}
        
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
        try { list = JSON.parse(localStorage.getItem("couples_shared_assets")) || []; } catch(err) {}

        const newId = "asset_" + Date.now();
        list.push({
          id: newId,
          url: compressed,
          name: "自定义贴纸",
          group: "常驻",
          description: "用户手动上传的手账贴纸"
        });

        localStorage.setItem("couples_shared_assets", JSON.stringify(list));
        this.loadMaterialsLibrary();
        showToast("新贴纸上传成功，请点击贴纸编辑其属性属性！");
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