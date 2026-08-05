/**
 * app_chat_mcp.js - Model Context Protocol & Mobile Control Panel 物理扫歌与原生播放联动中枢 [1]
 * 
 * 修改说明（后台发信修复）：
 * - toggleActiveMessage(): 开启时从 IndexedDB 读取当前 API preset，通过 registerBgApiConfig() 注册到 Kotlin 层
 * - triggerBackgroundActiveMessage(): 改为双重逻辑——先通过 pushBgMessage() 推消息到 Kotlin 队列，
 *   再通过 pollBgResult() 轮询后台发信结果；同时保留原有 btnReply.click() 逻辑以兼容前台场景
 */

(function() {
  const mcpSystem = {
    // 自动扫描出的物理歌曲列表 (存放歌曲的真实文件名，如 "song.mp3") [1]
    localPlaylist: [],
    // 乐库歌单缓存：[{ id, name, songs: [{id, title, artist}, ...] }]
    libraryPlaylists: [],
    // 全局扁平歌曲列表（本地+乐库按分类顺序合并），供 AI [PLAY_MUSIC]{"index":N} 直接索引
    mergedPlaylist: [],
    // 当前活动闹钟状态：{ triggerTime, title, ringtone, setByAI } 或 null
    activeAlarm: null,
    // 闹钟倒计时刷新定时器句柄
    alarmCountdownTimer: null,

    // 开启中枢控制面板
    openPanel: function() {
      if (!activeSessionId) {
        showToast("请先进入一个好友聊天对话！");
        return;
      }
      document.getElementById("chat-mcp-panel").classList.add("active");
      this.refreshScreentimeDisplay();
      
      // 开启面板时自动扫描本地物理歌单并加载设置 [1]
      this.scanAndSyncLocalMusic();
    },

    // 关闭控制面板
    closePanel: function() {
      document.getElementById("chat-mcp-panel").classList.remove("active");
    },

    // 载入并同步 MCP 本地配置
    loadMcpSettings: function() {
      const isMcpEnabled = localStorage.getItem("settings-mcp-prompt-enabled") === "true";
      const toggle = document.getElementById("settings-mcp-prompt-toggle");
      if (toggle) toggle.checked = isMcpEnabled;

      const isAgentLoopEnabled = localStorage.getItem("settings-mcp-agent-loop-enabled") !== "false";
      const agentLoopToggle = document.getElementById("settings-mcp-agent-loop-toggle");
      if (agentLoopToggle) agentLoopToggle.checked = isAgentLoopEnabled;

      const isActiveMsgEnabled = localStorage.getItem("settings-mcp-active-msg-enabled") === "true";
      const activeMsgToggle = document.getElementById("settings-mcp-active-msg-toggle");
      if (activeMsgToggle) activeMsgToggle.checked = isActiveMsgEnabled;

      if (window.desktopPetSystem && typeof window.desktopPetSystem.loadMcpPanelState === 'function') {
        window.desktopPetSystem.loadMcpPanelState();
      }

      if (window.mcpClientSystem && typeof window.mcpClientSystem.updateSummaryText === 'function') {
        window.mcpClientSystem.updateSummaryText();
      }

      // 回显歌曲列表（本地+乐库），手风琴分类样式 [1]
      const listEl = document.getElementById("mcp-playlist-list");
      if (listEl) {
        listEl.innerHTML = this._renderAccordionPlaylist();
      }

      // 同步填充闹钟铃声下拉框（复用 mergedPlaylist）
      this._populateAlarmRingtoneSelect();

      // 渲染活动闹钟状态（倒计时 + 取消按钮）
      this._renderAlarmStatus();
    },

    /**
     * 渲染手风琴分类歌曲列表（本地/歌单1/歌单2...）。
     * 每个分类可折叠展开，歌曲条目高度固定可点击。
     */
    _renderAccordionPlaylist: function() {
      // 构建全局扁平索引列表
      const merged = [];
      const sections = [];

      // 本地歌曲分类
      if (this.localPlaylist.length > 0) {
        const localSongs = this.localPlaylist.map((s, idx) => {
          const globalIdx = merged.length;
          merged.push({ source: 'local', title: s, fileName: s });
          return `<div style="padding:8px 10px; margin-bottom:3px; border-radius:6px; background:rgba(0,0,0,0.04); cursor:pointer; min-height:36px; display:flex; align-items:center; gap:6px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="mcpSystem.playTrackByIndex(${globalIdx})">
            <span style="color:#6366f1; font-weight:700; min-width:24px;">${idx + 1}</span>
            <span style="overflow:hidden; text-overflow:ellipsis;">${this._escapeHtml(s)}</span>
          </div>`;
        }).join("");
        sections.push({ name: `本地歌曲（${this.localPlaylist.length}）`, songs: localSongs, color: "#6366f1" });
      }

      // 乐库歌单分类
      this.libraryPlaylists.forEach(pl => {
        if (!pl.songs || pl.songs.length === 0) return;
        const plSongs = pl.songs.map((song, idx) => {
          const globalIdx = merged.length;
          merged.push({ source: 'library', title: song.title, artist: song.artist, playlistId: pl.id, songId: song.id });
          return `<div style="padding:8px 10px; margin-bottom:3px; border-radius:6px; background:rgba(0,0,0,0.04); cursor:pointer; min-height:36px; display:flex; align-items:center; gap:6px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="mcpSystem.playTrackByIndex(${globalIdx})">
            <span style="color:#ec4141; font-weight:700; min-width:24px;">${idx + 1}</span>
            <span style="overflow:hidden; text-overflow:ellipsis; flex:1;">${this._escapeHtml(song.title)}</span>
            <span style="color:#999; font-size:9px; flex-shrink:0;">${this._escapeHtml(song.artist || '')}</span>
          </div>`;
        }).join("");
        sections.push({ name: `${this._escapeHtml(pl.name)}（${pl.songs.length}）`, songs: plSongs, color: "#ec4141" });
      });

      // 更新全局扁平索引
      this.mergedPlaylist = merged;

      if (sections.length === 0) {
        return `<div style="padding:12px; text-align:center; color:var(--text-secondary); font-size:11px; line-height:1.6;">
          歌单为空。<br>1. 本地：将 MP3 歌曲放入手机 /Music/Storypoem 目录<br>2. 乐库：在「听歌」应用中导入歌单
        </div>`;
      }

      // 渲染手风琴（默认展开第一个分类）
      return sections.map((sec, i) => {
        const checked = i === 0 ? "checked" : "";
        const secId = `mcp-acc-${i}`;
        return `<details style="margin-bottom:6px;" ${checked}>
          <summary style="padding:8px 10px; border-radius:6px; background:${sec.color}15; cursor:pointer; font-size:11px; font-weight:700; color:${sec.color}; display:flex; align-items:center; gap:4px; list-style:none; min-height:32px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="transition:transform 0.2s;"><path d="M9 18l6-6-6-6"/></svg>
            <span>${sec.name}</span>
          </summary>
          <div style="padding:6px 4px 2px 4px; max-height:200px; overflow-y:auto;">
            ${sec.songs}
          </div>
        </details>`;
      }).join("");
    },

    _escapeHtml: function(text) {
      if (!text) return "";
      return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },

    // MCP 神经注入开关切换
    togglePrompt: function(toggleEl) {
      localStorage.setItem("settings-mcp-prompt-enabled", toggleEl.checked ? "true" : "false");
      showToast(toggleEl.checked ? "已成功建立神经感知！物理传感器与歌单已同步至 AI。" : "已切断神经数据通道。");
    },

    // 多轮循环工具调用 Agent 连贯开关切换
    toggleAgentLoop: function(toggleEl) {
      localStorage.setItem("settings-mcp-agent-loop-enabled", toggleEl.checked ? "true" : "false");
      showToast(toggleEl.checked ? "已开启多轮连贯工具调用 (Agent Loop)" : "已关闭多轮连贯工具调用");
    },

    // 1. 同步地理位置与天气
    syncLocation: function() {
      const geoStatus = document.getElementById("mcp-geo-status");
      const weatherStatus = document.getElementById("mcp-weather-status");
      
      if (!navigator.geolocation) {
        showToast("您的设备浏览器不支持 GPS 地理定位");
        return;
      }

      geoStatus.innerText = "正在向 Android 设备申请高精度定位...";
      showToast("正在读取 GPS 位置...");

      navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude.toFixed(4);
        const lon = position.coords.longitude.toFixed(4);
        geoStatus.innerText = `设备实测 GPS (纬度:${lat}, 经度:${lon})`;

        try {
          weatherStatus.innerText = "正在连接 Open-Meteo 气象中枢...";
          const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
          const data = await response.json();
          
          if (data && data.current_weather) {
            const temp = data.current_weather.temperature;
            const code = data.current_weather.weathercode;
            
            const weatherMap = {
              0: "晴朗 (Clear Sky)",
              1: "大部分晴朗", 2: "多云", 3: "阴天",
              45: "雾气", 48: "沉积雾",
              51: "细雨", 53: "中等毛毛雨", 55: "重度毛毛雨",
              61: "微雨", 63: "中雨", 65: "大雨 (Rainy)",
              71: "微雪", 73: "中雪", 75: "大雪",
              80: "阵雨", 81: "中等阵雨", 82: "暴雨",
              95: "雷暴", 96: "雷暴伴有冰雹"
            };

            const weatherDesc = weatherMap[code] || "多云或局部晴";
            const weatherObj = {
              city: `Android GPS定位 (经度:${lon}, 纬度:${lat})`,
              temp: temp,
              weather: weatherDesc
            };

            localStorage.setItem("mcp_loc_weather", JSON.stringify(weatherObj));
            weatherStatus.innerText = `实时室外温度: ${temp}°C | 当前天气: ${weatherDesc}`;
            showToast("环境传感器数据已注入！AI 已同步您的时空认知。");
          } else {
            throw new Error("获取气象协议失败");
          }
        } catch(err) {
          weatherStatus.innerText = "天气查询失败，但定位坐标已成功记录。";
          console.error(err);
        }
      }, (error) => {
        geoStatus.innerText = "定位失败，未获得 Android 浏览器定位权限";
        showToast("GPS 读取失败，请检查浏览器定位权限开关！");
      }, { enableHighAccuracy: true, timeout: 8000 });
    },

    // 2. 物理马达震动
    triggerVibration: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.triggerHardwareVibrator === 'function') {
        window.AndroidMCP.triggerHardwareVibrator(400); // 原生震动
        showToast("震动信号已发送至 Android 硬件马达");
        return;
      }
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
        showToast("H5 震动信号已发送");
      } else {
        showToast("您的设备不支持物理震动 API");
      }
    },

    // 3. 原生物理时钟直写闹钟 [1]（支持自定义铃声）
    setAlarm: function() {
      // 读取时分秒三个输入框，合并成总秒数
      const hInput = document.getElementById("mcp-timer-hours");
      const mInput = document.getElementById("mcp-timer-minutes");
      const sInput = document.getElementById("mcp-timer-seconds");

      // 兼容旧版单一输入框（如果存在）
      const legacyInput = document.getElementById("mcp-timer-input");
      if (legacyInput && !hInput) {
        const seconds = parseInt(legacyInput.value);
        if (isNaN(seconds) || seconds <= 0) {
          showToast("请输入合法的闹钟倒计时秒数！");
          return;
        }
        this._doSetAlarm(seconds, true);
        return;
      }

      const hours = hInput ? Math.max(0, Math.min(23, parseInt(hInput.value) || 0)) : 0;
      const minutes = mInput ? Math.max(0, Math.min(59, parseInt(mInput.value) || 0)) : 0;
      const seconds = sInput ? Math.max(0, Math.min(59, parseInt(sInput.value) || 0)) : 0;

      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      if (totalSeconds <= 0) {
        showToast("请至少设置一点时间（时/分/秒不能全为 0）！");
        return;
      }

      this._doSetAlarm(totalSeconds, true);
    },

    /**
     * 实际执行闹钟设定（内部方法，setAlarm 和 setAlarmByCommand 共用调度核心）。
     */
    _doSetAlarm: function(totalSeconds, isManual) {
      // 读取铃声下拉框（值为 "default" | "local:索引" | "library:索引" | "title:标题"）
      const ringtoneSelect = document.getElementById("mcp-alarm-ringtone");
      let ringtone = "default";
      if (ringtoneSelect) ringtone = ringtoneSelect.value || "default";

      const targetDate = new Date(Date.now() + totalSeconds * 1000);
      const hour = targetDate.getHours();
      const minute = targetDate.getMinutes();
      const triggerTimeMillis = targetDate.getTime();
      const alarmTitle = "叙事诗小手机：神经倒计时闹铃";

      this._scheduleAlarm(totalSeconds, hour, minute, triggerTimeMillis, alarmTitle, ringtone, isManual);
    },

    /**
     * 从原始 JSON 字符串解析并执行 SET_ALARM（容错版）。
     * 先尝试 JSON.parse；失败则用子正则提取 delay/title/ringtone/unit，
     * 确保即使 AI 输出畸形 JSON（如未加引号的 ringtone）也能设闹钟。
     */
    setAlarmFromRawJson: function(jsonStr) {
      let opts = null;
      try {
        opts = JSON.parse(jsonStr);
      } catch(e) {
        console.warn("SET_ALARM JSON 解析失败，启用容错提取:", e);
        // 容错提取 delay（支持数字或带单位的字符串）
        const delayNumMatch = jsonStr.match(/"delay"\s*:\s*(\d+(?:\.\d+)?)/);
        const delayStrMatch = jsonStr.match(/"delay"\s*:\s*"(\d+(?:\.\d+)?\s*(?:秒|分钟|分|小时|时|天))"/i);
        if (!delayNumMatch && !delayStrMatch) {
          console.warn("容错提取失败：未找到 delay 字段");
          return false;
        }
        opts = { delay: delayStrMatch ? delayStrMatch[1] : parseInt(delayNumMatch[1]) };
        const unitMatch = jsonStr.match(/"unit"\s*:\s*"([^"]*)"/i);
        if (unitMatch) opts.unit = unitMatch[1];
        const titleMatch = jsonStr.match(/"title"\s*:\s*"([^"]*)"/);
        if (titleMatch) opts.title = titleMatch[1];
        const ringtoneMatch = jsonStr.match(/"ringtone"\s*:\s*(?:"([^"]*)"|(\d+))/);
        if (ringtoneMatch) opts.ringtone = ringtoneMatch[1] !== undefined ? ringtoneMatch[1] : parseInt(ringtoneMatch[2]);
        console.log("容错提取 SET_ALARM 参数:", opts);
      }
      return this.setAlarmByCommand(opts);
    },

    /**
     * 将 delay 解析为秒数。支持：
     * - 纯数字（秒，向后兼容）：1800
     * - 带单位的字符串："30分钟"、"2小时"、"90秒"、"1.5小时"、"1天"
     * - 配合 unit 字段：{delay: 30, unit: "分钟"}
     */
    _parseDelayToSeconds: function(delay, unit) {
      if (delay === undefined || delay === null) return NaN;
      // 如果有 unit 字段，delay 当数字处理
      if (unit && typeof unit === 'string') {
        const num = parseFloat(delay);
        if (isNaN(num)) return NaN;
        const u = unit.trim().toLowerCase();
        if (u === '秒' || u === 's' || u === 'sec' || u === 'seconds') return num;
        if (u === '分' || u === '分钟' || u === 'min' || u === 'minute' || u === 'minutes') return num * 60;
        if (u === '时' || u === '小时' || u === 'h' || u === 'hour' || u === 'hours') return num * 3600;
        if (u === '天' || u === 'day' || u === 'days') return num * 86400;
        return num; // 未知单位按秒
      }
      // 字符串带单位
      if (typeof delay === 'string') {
        const m = delay.trim().match(/^(\d+(?:\.\d+)?)\s*(秒|秒钟|分|分钟|时|小时|天)?$/);
        if (m) {
          const num = parseFloat(m[1]);
          const u = m[2];
          if (!u || u === '秒' || u === '秒钟') return num;
          if (u === '分' || u === '分钟') return num * 60;
          if (u === '时' || u === '小时') return num * 3600;
          if (u === '天') return num * 86400;
        }
        // 兜底：纯数字字符串
        const pureNum = parseFloat(delay);
        return pureNum;
      }
      // 纯数字（秒）
      return parseFloat(delay);
    },

    /**
     * AI 自主设闹钟指令封装（供 app_chat.js 解析 [SET_ALARM] 调用）。
     * opts: { delay:秒数|带单位字符串, unit?:单位, title:标题, ringtone?:歌曲索引|歌曲标题 }
     */
    setAlarmByCommand: function(opts) {
      const delay = this._parseDelayToSeconds(opts.delay, opts.unit);
      if (isNaN(delay) || delay <= 0) {
        console.warn("SET_ALARM delay 非法:", opts.delay, opts.unit);
        return false;
      }
      const delaySec = Math.ceil(delay);
      const title = (opts.title || "AI 闹钟提醒").toString();
      // ringtone: 数字索引 | 字符串标题 | undefined
      let ringtone = "default";
      if (opts.ringtone !== undefined && opts.ringtone !== null && opts.ringtone !== "") {
        ringtone = opts.ringtone;
      }

      const targetDate = new Date(Date.now() + delaySec * 1000);
      const hour = targetDate.getHours();
      const minute = targetDate.getMinutes();
      const triggerTimeMillis = targetDate.getTime();

      const ok = this._scheduleAlarm(delaySec, hour, minute, triggerTimeMillis, title, ringtone, false);

      // AI 路径也给 toast 提示（不关面板，方便用户看到 AI 设了闹钟）
      if (ok) {
        const timeStr = hour + ":" + String(minute).padStart(2, '0');
        showToast(`AI 已设定闹钟：${timeStr} 响铃（${delaySec}秒后，标题"${title}"）`);
      } else {
        showToast(`AI 闹钟设定失败，已降级为模拟模式（${delaySec}秒后提醒）`);
      }
      return ok;
    },

    /**
     * 闹钟调度核心：双通道（系统闹钟 + 应用内闹钟）+ 铃声字段透传。
     * showToastFeedback=false 时静默（AI 指令路径，避免打扰）
     */
    _scheduleAlarm: function(seconds, hour, minute, triggerTimeMillis, title, ringtone, showToastFeedback) {
      let systemAlarmOk = false;
      let inAppAlarmOk = false;

      // 优先：写入 Android 系统时钟闹钟（app 被杀也能响，由系统闹钟App保证触发）
      if (window.AndroidMCP && typeof window.AndroidMCP.setAndroidSystemAlarm === 'function') {
        try {
          window.AndroidMCP.setAndroidSystemAlarm(hour, minute, title);
          systemAlarmOk = true;
        } catch(e) { console.warn("系统闹钟写入失败:", e); }
      }

      // 补充：应用内精确闹钟（app 存活时到点回调 handleInAppAlarm 触发铃声+AI发信）
      if (window.AndroidMCP && typeof window.AndroidMCP.setInAppAlarm === 'function') {
        const alarmMsg = JSON.stringify({
          type: "mcp_alarm",
          title: title,
          triggerSeconds: seconds,
          triggerTime: triggerTimeMillis,
          sessionId: (typeof activeSessionId !== 'undefined') ? activeSessionId : null,
          ringtone: ringtone,
          timestamp: Date.now()
        });
        try {
          const ok = window.AndroidMCP.setInAppAlarm(triggerTimeMillis, alarmMsg);
          if (ok) {
            inAppAlarmOk = true;
            // 注册活动闹钟状态，启动倒计时 UI
            this._registerActiveAlarm(triggerTimeMillis, title, ringtone, showToastFeedback);
          }
        } catch(e) { console.warn("应用内闹钟设定失败:", e); }
      }

      const ok = systemAlarmOk || inAppAlarmOk;
      if (showToastFeedback) {
        if (systemAlarmOk && inAppAlarmOk) {
          showToast(`双重闹钟已设定：系统时钟 ${hour}:${String(minute).padStart(2, '0')} 响铃 + 应用内 AI 发信（${seconds}秒后，需app存活）`);
        } else if (systemAlarmOk) {
          showToast(`已写入系统时钟闹钟，${hour}:${String(minute).padStart(2, '0')} 响铃（app被杀也能响）`);
        } else if (inAppAlarmOk) {
          showToast(`应用内闹钟已设定，${seconds} 秒后唤醒（需app存活，被杀则失效）`);
        } else {
          showToast(`模拟闹钟已设定，将在 ${seconds} 秒后提醒（请保持页面在前台）`);
        }
        this.closePanel();
      }
      console.log(`闹钟调度: ${seconds}秒后, 标题="${title}", 铃声=${ringtone}, 系统=${systemAlarmOk}, 应用内=${inAppAlarmOk}`);

      // 浏览器降级兜底（仅无任何原生通道时）
      if (!ok) {
        setTimeout(() => {
          if (window.AndroidMCP && typeof window.AndroidMCP.triggerHardwareVibrator === 'function') {
            window.AndroidMCP.triggerHardwareVibrator(600);
          } else if (navigator.vibrate) {
            navigator.vibrate([400, 100, 400, 100, 600]);
          }
          showCustomAlert("⏰ MCP 警报通知", "您设定的倒计时神经闹钟已经唤醒！");
        }, seconds * 1000);
      }
      return ok;
    },

    /**
     * 闹钟到点播放自定义铃声（由 handleInAppAlarm 调用）。
     * ringtone: "default" | 数字索引 | 字符串标题 | "local:索引" | "library:索引" | "title:标题"
     */
    playAlarmRingtone: function(ringtone) {
      if (ringtone === undefined || ringtone === null || ringtone === "" || ringtone === "default") {
        return; // 用系统默认铃声
      }
      try {
        // 形如 "local:3" / "library:5"
        if (typeof ringtone === 'string' && ringtone.indexOf(':') > 0) {
          const parts = ringtone.split(':');
          const src = parts[0];
          const idx = parseInt(parts[1]);
          if (!isNaN(idx) && this.mergedPlaylist.length > 0 && idx >= 0 && idx < this.mergedPlaylist.length) {
            this.playTrackByIndex(idx);
            return;
          }
          if (src === 'title') {
            this.playTrackByTitle(parts.slice(1).join(':'));
            return;
          }
        }
        // 纯数字索引
        if (typeof ringtone === 'number' || /^\d+$/.test(String(ringtone))) {
          const idx = parseInt(ringtone);
          if (this.mergedPlaylist.length > 0 && idx >= 0 && idx < this.mergedPlaylist.length) {
            this.playTrackByIndex(idx);
            return;
          }
        }
        // 字符串标题模糊匹配
        if (typeof ringtone === 'string' && ringtone.trim()) {
          this.playTrackByTitle(ringtone.trim());
          return;
        }
      } catch(e) {
        console.warn("闹钟铃声播放失败:", e);
      }
    },

    /**
     * 填充闹钟铃声下拉框：从 mergedPlaylist（本地+乐库）生成选项。
     */
    _populateAlarmRingtoneSelect: function() {
      const select = document.getElementById("mcp-alarm-ringtone");
      if (!select) return;
      const currentVal = select.value || "default";
      let html = '<option value="default">默认铃声（系统提示音）</option>';
      if (this.mergedPlaylist.length === 0) {
        // 降级：按本地+乐库原始结构生成
        this.localPlaylist.forEach((s, idx) => {
          html += `<option value="local:${idx}">[本地] ${this._escapeHtml(s)}</option>`;
        });
        this.libraryPlaylists.forEach(pl => {
          (pl.songs || []).forEach((song, idx) => {
            html += `<option value="library:${idx}">[乐库:${this._escapeHtml(pl.name)}] ${this._escapeHtml(song.title)}</option>`;
          });
        });
      } else {
        // 优先用 mergedPlaylist 的全局索引（与 AI [PLAY_MUSIC] 索引一致）
        this.mergedPlaylist.forEach((t, idx) => {
          const tag = t.source === 'library' ? '[乐库]' : '[本地]';
          const artist = t.artist ? ` - ${t.artist}` : '';
          html += `<option value="${idx}">${tag} ${this._escapeHtml(t.title)}${artist}</option>`;
        });
      }
      select.innerHTML = html;
      // 尝试保留原选择
      if (Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
      }
    },

    /**
     * 注册活动闹钟状态并启动倒计时刷新。
     * setByAI: 是否由 AI 指令设定（影响 UI 标签）
     */
    _registerActiveAlarm: function(triggerTimeMillis, title, ringtone, showToastFeedback) {
      this.activeAlarm = {
        triggerTime: triggerTimeMillis,
        title: title,
        ringtone: ringtone,
        setByAI: !showToastFeedback  // showToastFeedback=true 表示手动按钮路径
      };
      this._startAlarmCountdown();
      this._renderAlarmStatus();
    },

    /**
     * 启动倒计时定时器，每秒刷新 UI。
     */
    _startAlarmCountdown: function() {
      this._stopAlarmCountdown();
      const self = this;
      this.alarmCountdownTimer = setInterval(() => {
        if (!self.activeAlarm) {
          self._stopAlarmCountdown();
          return;
        }
        const remaining = self.activeAlarm.triggerTime - Date.now();
        if (remaining <= 0) {
          // 闹钟已到点（由原生 InAppAlarmReceiver 触发，这里兜底清状态）
          self._stopAlarmCountdown();
          self.activeAlarm = null;
          self._renderAlarmStatus();
          return;
        }
        self._renderAlarmStatus();
      }, 1000);
    },

    /**
     * 停止倒计时定时器。
     */
    _stopAlarmCountdown: function() {
      if (this.alarmCountdownTimer) {
        clearInterval(this.alarmCountdownTimer);
        this.alarmCountdownTimer = null;
      }
    },

    /**
     * 渲染闹钟状态区（倒计时 + 取消按钮）。
     */
    _renderAlarmStatus: function() {
      const statusEl = document.getElementById("mcp-alarm-status");
      if (!statusEl) return;

      if (!this.activeAlarm) {
        statusEl.style.display = "none";
        statusEl.innerHTML = "";
        return;
      }

      const remaining = this.activeAlarm.triggerTime - Date.now();
      if (remaining <= 0) {
        statusEl.style.display = "none";
        statusEl.innerHTML = "";
        return;
      }

      // 格式化倒计时：时分秒
      const totalSec = Math.ceil(remaining / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      let timeStr;
      if (h > 0) {
        timeStr = `${h}时${String(m).padStart(2,'0')}分${String(s).padStart(2,'0')}秒`;
      } else if (m > 0) {
        timeStr = `${m}分${String(s).padStart(2,'0')}秒`;
      } else {
        timeStr = `${s}秒`;
      }

      const triggerDate = new Date(this.activeAlarm.triggerTime);
      const clockStr = `${triggerDate.getHours()}:${String(triggerDate.getMinutes()).padStart(2,'0')}`;
      const sourceTag = this.activeAlarm.setByAI ? "AI 设定" : "手动设定";
      const ringtoneNote = (this.activeAlarm.ringtone && this.activeAlarm.ringtone !== "default")
        ? "（含自定义铃声）" : "（默认铃声）";

      statusEl.style.display = "block";
      statusEl.innerHTML = `
        <div style="margin-top:8px; padding:10px; border-radius:10px; background:linear-gradient(135deg,#fef3c7,#fde68a); border:1.5px solid #f59e0b;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:11px; color:#92400e; font-weight:700; margin-bottom:2px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/></svg>
                闹钟倒计时 · ${sourceTag}${ringtoneNote}
              </div>
              <div style="font-size:16px; color:#78350f; font-weight:800; line-height:1.2;">${timeStr}</div>
              <div style="font-size:10px; color:#92400e; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${clockStr} 响铃 · ${this._escapeHtml(this.activeAlarm.title)}
              </div>
            </div>
            <button onclick="mcpSystem.cancelActiveAlarm()" style="flex-shrink:0; padding:6px 10px; font-size:11px; font-weight:700; border-radius:8px; border:1.5px solid #ef4444; background:#fee2e2; color:#dc2626; cursor:pointer;">取消闹钟</button>
          </div>
        </div>`;
    },

    /**
     * 用户主动取消活动闹钟（取消应用内闹钟 + 清状态）。
     * 注意：系统闹钟App的闹钟需用户手动去系统时钟App删除。
     */
    cancelActiveAlarm: function() {
      let inAppCancelled = false;
      if (window.AndroidMCP && typeof window.AndroidMCP.cancelInAppAlarm === 'function') {
        try {
          inAppCancelled = window.AndroidMCP.cancelInAppAlarm();
        } catch(e) { console.warn("取消应用内闹钟失败:", e); }
      }
      this._stopAlarmCountdown();
      this.activeAlarm = null;
      this._renderAlarmStatus();
      if (inAppCancelled) {
        showToast("已取消应用内闹钟（系统时钟App的闹钟需手动删除）");
      } else {
        showToast("闹钟状态已清除（系统时钟App的闹钟需手动删除）");
      }
    },

    /**
     * 清除活动闹钟状态（供 handleInAppAlarm 到点后调用，不调原生 cancel）。
     */
    clearAlarmStatus: function() {
      this._stopAlarmCountdown();
      this.activeAlarm = null;
      this._renderAlarmStatus();
    },

    // 4.1 静默扫描真机 /Music/Storypoem 物理目录并载入 + 加载乐库歌单 [1]
    scanAndSyncLocalMusic: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.scanLocalMusicFolder === 'function') {
        try {
          const jsonStr = window.AndroidMCP.scanLocalMusicFolder();
          this.localPlaylist = JSON.parse(jsonStr);

          // 同步歌单名称给 LocalStorage，供大模型提示词读取感知 [1]
          localStorage.setItem("mcp_playlist_titles", jsonStr);

          const titleEl = document.getElementById("mcp-music-title");
          if (titleEl) {
            const total = this.localPlaylist.length;
            titleEl.innerText = total > 0
              ? `已自动装载本地歌曲：${total} 首`
              : "歌单就绪：尚未在手机 /Music/Storypoem 下放置歌曲";
          }
        } catch(e) {
          console.error("扫描本地物理歌单失败:", e);
        }
      } else {
        // H5 降级提示
        const titles = localStorage.getItem("mcp_playlist_titles");
        if (titles) {
          try { this.localPlaylist = JSON.parse(titles); } catch(e) {}
        }
      }
      // 异步加载乐库歌单
      this._loadLibraryPlaylists().then(() => {
        // 构建 mergedPlaylist 并同步到 localStorage，供 AI 提示词读取
        this._buildMergedPlaylist();
        this._syncMergedPlaylistToStorage();
        const titleEl = document.getElementById("mcp-music-title");
        if (titleEl) {
          const localCount = this.localPlaylist.length;
          const libCount = this.mergedPlaylist.length;
          if (localCount === 0 && libCount === 0) {
            titleEl.innerText = "歌单就绪：尚未导入任何歌曲";
          } else {
            const parts = [];
            if (localCount > 0) parts.push(`本地${localCount}首`);
            const libSongs = this.libraryPlaylists.reduce((sum, pl) => sum + (pl.songs ? pl.songs.length : 0), 0);
            if (libSongs > 0) parts.push(`乐库${libSongs}首`);
            titleEl.innerText = `歌单已就绪：${parts.join(' + ')}（共${libCount}首）`;
          }
        }
        this.loadMcpSettings();
      });
      this.loadMcpSettings();
    },

    /**
     * 构建全局扁平歌曲索引列表（本地+乐库按分类顺序合并）。
     */
    _buildMergedPlaylist: function() {
      const merged = [];
      this.localPlaylist.forEach(s => merged.push({ source: 'local', title: s, fileName: s }));
      this.libraryPlaylists.forEach(pl => {
        (pl.songs || []).forEach(song => merged.push({
          source: 'library', title: song.title, artist: song.artist,
          playlistId: pl.id, songId: song.id
        }));
      });
      this.mergedPlaylist = merged;
    },

    /**
     * 同步合并歌单信息到 localStorage，供 AI 提示词读取感知。
     */
    _syncMergedPlaylistToStorage: function() {
      try {
        const info = this.mergedPlaylist.map((t, idx) => ({
          index: idx,
          source: t.source,
          title: t.title,
          artist: t.artist || ''
        }));
        localStorage.setItem("mcp_merged_playlist_info", JSON.stringify(info));
      } catch(e) {
        console.error("同步合并歌单到 localStorage 失败:", e);
      }
    },

    /**
     * 加载乐库（听歌应用）歌单及歌曲，合并到 MCP 歌曲列表。
     * 数据源对齐 app_music.js：歌单元数据在 localStorage["ncm_playlists"]，
     * 歌曲 blob 在独立的原生 IndexedDB "StoryPhoneMusicDB.songs"。
     * 旧实现误从 Dexie db.music_playlists/db.music_songs 读（仅备份恢复时才填充），导致永远为空。
     */
    _loadLibraryPlaylists: async function() {
      this.libraryPlaylists = [];
      try {
        // 1. 优先复用 musicSystem 内存中已加载的歌单
        let playlists = null;
        if (window.musicSystem && Array.isArray(window.musicSystem.playlists) && window.musicSystem.playlists.length > 0) {
          playlists = window.musicSystem.playlists;
        } else {
          // 降级从 localStorage 读取
          try {
            const localPL = JSON.parse(localStorage.getItem("ncm_playlists"));
            if (localPL && Array.isArray(localPL)) playlists = localPL;
          } catch(e) {}
        }
        if (!playlists || playlists.length === 0) return;

        // 2. 从原生 IDB StoryPhoneMusicDB 读取歌曲元数据（不需要 blob）
        let allSongs = [];
        if (window.musicSystem && typeof window.musicSystem.getAllSongsFromIndexedDB === 'function') {
          allSongs = await window.musicSystem.getAllSongsFromIndexedDB();
        } else {
          allSongs = await this._getAllSongsFromMusicIDB();
        }

        // 3. 按 songIds 关联构建乐库歌单结构
        for (const pl of playlists) {
          let songs = [];
          if (pl.songIds && Array.isArray(pl.songIds)) {
            songs = pl.songIds.map(sid => {
              const s = allSongs.find(x => x.id === sid);
              return s ? { id: s.id, title: s.title, artist: s.artist } : null;
            }).filter(Boolean);
          }
          if (songs.length > 0) {
            this.libraryPlaylists.push({ id: pl.id, name: pl.name || '未命名歌单', songs: songs });
          }
        }
      } catch(e) {
        console.error("加载乐库歌单失败:", e);
      }
    },

    /**
     * 兜底：直接读原生 IndexedDB StoryPhoneMusicDB.songs（无 musicSystem 时使用）
     */
    _getAllSongsFromMusicIDB: function() {
      return new Promise((resolve) => {
        if (!window.indexedDB) { resolve([]); return; }
        try {
          const req = indexedDB.open("StoryPhoneMusicDB", 1);
          req.onsuccess = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains("songs")) { resolve([]); return; }
            const tx = idb.transaction("songs", "readonly");
            const store = tx.objectStore("songs");
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => resolve(getAllReq.result || []);
            getAllReq.onerror = () => resolve([]);
          };
          req.onerror = () => resolve([]);
        } catch(e) { resolve([]); }
      });
    },

    // 4.2 统一播放接口：支持本地物理歌曲 + 乐库在线歌曲 [1]
    playTrackByIndex: function(index) {
      // 优先使用合并后的全局索引列表
      if (this.mergedPlaylist.length > 0) {
        if (index < 0 || index >= this.mergedPlaylist.length) {
          showToast("指令点播的音乐索引超出界限");
          return;
        }
        const track = this.mergedPlaylist[index];
        if (track.source === 'library') {
          this._playLibrarySong(track);
        } else {
          this._playLocalSong(track);
        }
        return;
      }

      // 兼容旧版：仅本地歌单
      if (this.localPlaylist.length === 0) {
        showToast("歌单为空！请先将 MP3 歌曲丢入手机 /Music/Storypoem 目录下，或在「听歌」应用中导入歌单");
        return;
      }
      if (index < 0 || index >= this.localPlaylist.length) {
        showToast("指令点播的音乐索引超出界限");
        return;
      }
      this._playLocalSong({ source: 'local', title: this.localPlaylist[index], fileName: this.localPlaylist[index] });
    },

    // 播放本地物理歌曲（通过原生 MediaPlayer）
    _playLocalSong: function(track) {
      const songName = track.fileName || track.title;
      if (window.AndroidMCP && typeof window.AndroidMCP.playNativeMusic === 'function') {
        const success = window.AndroidMCP.playNativeMusic(songName);
        if (success) {
          document.getElementById("mcp-music-title").innerText = `正在物理播放：${songName}`;
          showToast(`已成功唤醒原生播放器后台播放：《${songName}》`);
        } else {
          showToast("真机原生播放音频流失败");
        }
        return;
      }
      showToast("当前环境暂不支持原生物理音频流后台播放，请在 APK 壳中运行。");
    },

    // 播放乐库在线歌曲（通过 musicSystem 网页播放器）
    _playLibrarySong: function(track) {
      if (window.musicSystem && typeof window.musicSystem.playSongFromPlaylist === 'function') {
        window.musicSystem.playSongFromPlaylist(track.playlistId, track.songId);
        const titleEl = document.getElementById("mcp-music-title");
        if (titleEl) titleEl.innerText = `正在乐库播放：${track.title}`;
        showToast(`已通过乐库播放：《${track.title}》`);
      } else {
        showToast("乐库播放器未就绪，请先打开「听歌」应用");
      }
    },

    // 按歌名进行模糊匹配播放（跨本地+乐库搜索）
    playTrackByTitle: function(title) {
      // 优先在合并列表中搜索
      if (this.mergedPlaylist.length > 0) {
        const index = this.mergedPlaylist.findIndex(t =>
          (t.title || '').toLowerCase().includes(title.toLowerCase())
        );
        if (index !== -1) {
          this.playTrackByIndex(index);
          return;
        }
        showToast(`歌单中未找到包含 "${title}" 的歌曲`);
        return;
      }
      // 兼容旧版
      if (this.localPlaylist.length === 0) return;
      const index = this.localPlaylist.findIndex(s => s.toLowerCase().includes(title.toLowerCase()));
      if (index !== -1) {
        this.playTrackByIndex(index);
      } else {
        showToast(`歌单中未找到包含 "${title}" 的歌曲`);
      }
    },

    stopMusic: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.stopNativeMusic === 'function') {
        window.AndroidMCP.stopNativeMusic();
        document.getElementById("mcp-music-title").innerText = "音乐播放已暂停";
        showToast("音频播放已暂停");
      }
    },

    // 5. 屏幕扮演时间刷新展现
    refreshScreentimeDisplay: function() {
      const activeSeconds = parseInt(localStorage.getItem("mcp_screen_time_today") || "0");
      const mins = Math.floor(activeSeconds / 60);
      const secs = activeSeconds % 60;
      document.getElementById("mcp-screentime-val").innerText = `${mins} 分钟 ${secs} 秒`;
    },

    // ==========================================
    //  6. 后台主动发信控制（重写版）
    // ==========================================
    // 修复说明：修正后台发信必须在 APP 前台才能运行的 WebView 冻结问题。
    // 开启后台发信时，从 IndexedDB 读取当前 API preset 注册到 Kotlin 层，
    // Kotlin 层直接使用 HttpURLConnection 发送 HTTP 请求，完全绕过 WebView 冻结限制。
    // 同时保留前台场景下的 btnReply.click() 逻辑以保持兼容。
    // ==========================================

    toggleActiveMessage: function(toggleEl) {
      const isEnabled = toggleEl.checked;
      localStorage.setItem("settings-mcp-active-msg-enabled", isEnabled ? "true" : "false");
      
      if (isEnabled) {
        const interval = parseInt(document.getElementById("mcp-active-msg-interval").value) || 10;
        
        // 开启时：从 IndexedDB 读取当前选中的 API preset，注册到 Kotlin 层
        (async () => {
          try {
            // 读取全局 API preset 设置（与 app_chat.js 中发信时读取相同的配置）
            const currentApiId = parseInt(localStorage.getItem("global_api_preset_id") || "0");
            let apiConfig = null;
            
            if (currentApiId > 0 && typeof db !== 'undefined' && db.api_presets) {
              apiConfig = await db.api_presets.get(currentApiId);
            }
            
            if (!apiConfig && typeof db !== 'undefined' && db.api_presets) {
              // 如果没有选中的 preset，读取第一个可用配置
              apiConfig = await db.api_presets.limit(1).first();
            }
            
            if (apiConfig && apiConfig.url && apiConfig.key) {
              // 注册 API 配置到 Kotlin 层（参数：url, key, model, temperature）
              if (window.AndroidMCP && typeof window.AndroidMCP.registerBgApiConfig === 'function') {
                window.AndroidMCP.registerBgApiConfig(
                  apiConfig.url,
                  apiConfig.key,
                  apiConfig.model || 'gpt-3.5-turbo',
                  apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
                );
              }
              
              // 启动后台轮询
              if (window.AndroidMCP && typeof window.AndroidMCP.startBackgroundPolling === 'function') {
                window.AndroidMCP.startBackgroundPolling(interval);
                showToast(`后台主动发信服务已开启（API: ${apiConfig.name || apiConfig.url}），每隔 ${interval} 分钟轮询一次`);
              } else {
                showToast("后台主动发信已模拟开启");
              }
            } else {
              showToast("未找到 API 配置！请先在设置中配置 API Preset");
              toggleEl.checked = false;
              localStorage.setItem("settings-mcp-active-msg-enabled", "false");
            }
          } catch(e) {
            console.error("读取 API 配置失败:", e);
            showToast("读取 API 配置失败，请确认已正确设置 API Preset");
            toggleEl.checked = false;
            localStorage.setItem("settings-mcp-active-msg-enabled", "false");
          }
        })();
        
      } else {
        // 关闭时：停止后台轮询
        if (window.AndroidMCP && typeof window.AndroidMCP.stopBackgroundPolling === 'function') {
          window.AndroidMCP.stopBackgroundPolling();
        }
        showToast("后台主动发信服务已关闭");
      }
    },

    // 后台主动发信触发器（由 Kotlin 层定时调用）
    triggerBackgroundActiveMessage: function() {
      if (!activeSessionId) return;
      
      // 联动：定时器启动，桌宠首先气泡冒泡，直观排除定时器阻塞
      if (window.desktopPetSystem && typeof window.desktopPetSystem.popBubble === 'function') {
        window.desktopPetSystem.popBubble("有人冒泡。");
      }
      
      // === 新逻辑：通过 Kotlin 层直接发 HTTP 请求（用于后台场景）===
      // 获取当前输入框中的消息内容（如果没有新输入，则不会发信）
      const input = document.getElementById("chat-input");
      let message = "";
      if (input && input.value.trim()) {
        message = input.value.trim();
      }
      
      if (message) {
        // 有消息内容：推送到 Kotlin 层的后台发送队列
        if (window.AndroidMCP && typeof window.AndroidMCP.pushBgMessage === 'function') {
          try {
            window.AndroidMCP.pushBgMessage(message);
            // 清空输入框
            input.value = "";
            // 调整高度
            input.style.height = 'auto';
          } catch(e) {
            console.error("pushBgMessage 失败:", e);
          }
        }
      }
      
      // === 保留原有逻辑：通过 btnReply.click() 触发前端发信（用于前台场景）===
      // 如果当前 APP 在前台，WebView 正常运行时，走原有逻辑
      const btnReply = document.getElementById("btn-dialog-reply");
      if (btnReply && !onlineAbortController) {
        btnReply.click();
      }
      
      // === 轮询后台发信结果并更新界面 ===
      if (window.AndroidMCP && typeof window.AndroidMCP.pollBgResult === 'function') {
        try {
          const resultJson = window.AndroidMCP.pollBgResult();
          if (resultJson) {
            const result = JSON.parse(resultJson);
            if (result && result.content) {
              // 模拟收到消息：如果 session 列表中有当前会话，追加 AI 响应
              // 这里与 app_chat.js 中收到消息后更新界面的逻辑保持一致
              if (typeof addMessageToSession === 'function') {
                addMessageToSession(activeSessionId, {
                  type: 'ai',
                  text: result.content,
                  time: new Date().toLocaleString()
                });
              }
              // 更新对话显示
              if (typeof appendMessageToDisplay === 'function') {
                appendMessageToDisplay('ai', result.content);
              }
              // 联动：有后台信件被拉取收到时，桌宠立刻气泡提示
              if (window.desktopPetSystem && typeof window.desktopPetSystem.popBubble === 'function') {
                window.desktopPetSystem.popBubble("有人来信。");
              }
            }
          }
        } catch(e) {
          console.error("pollBgResult 失败:", e);
        }
      }
    },

    // 7. 桌面悬浮桌宠控制 (已重构委托至 app_desktop_pet.js)
    toggleDesktopPet: function(toggleEl) {
      if (window.desktopPetSystem) window.desktopPetSystem.togglePetActive(toggleEl);
    },
    handlePetUpload: function(fileEl) {
      if (window.desktopPetSystem) window.desktopPetSystem.handleStateImageUpload(fileEl);
    },
    changePetSize: function(val) {
      if (window.desktopPetSystem) window.desktopPetSystem.changePetSize(val);
    }
  };

  // ==========================================
  //  5. 精准统计今日 PWA 屏幕使用时长
  // ==========================================
  let activeSeconds = parseInt(localStorage.getItem("mcp_screen_time_today") || "0");
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      activeSeconds++;
      localStorage.setItem("mcp_screen_time_today", activeSeconds);
    }
  }, 1000);

  // ==========================================
  //  6. 防御性自注册绑定 (自适应 DOMContentLoaded 周期)
  // ==========================================
  function bindMcpTrigger() {
    const btn = document.getElementById("btn-chat-mcp");
    if (btn) {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        document.getElementById("chat-expand-panel").classList.remove("active");
        mcpSystem.openPanel();
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindMcpTrigger);
  } else {
    bindMcpTrigger();
  }

  window.mcpSystem = mcpSystem;
})();
