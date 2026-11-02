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
    // 当前正在播放的歌曲全局索引（蓝牙媒体"下一首/上一首"切歌用）
    currentPlayIndex: -1,
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
      // 同步设备真实电量
      this.syncBattery();
      // 同步正在播放的媒体（歌名/歌手）
      this.syncNowPlaying();
      // 自动读取蓝牙设备（无权限时静默失败，不打扰）
      try {
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothGetDevices === 'function') {
          const raw = window.AndroidMCP.bluetoothGetDevices();
          const data = JSON.parse(raw);
          if (data && data.ok) {
            this.bluetoothDevices = data.devices || [];
            this.renderBluetoothDevices();
            this.syncBluetoothPromptData();
          }
        }
      } catch(e) {}
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

      // 联动：同步读取设备真实电量（与天气一起注入提示词）
      this.syncBattery();
      // 联动：同步当前正在播放的媒体
      this.syncNowPlaying();
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
          showToast(`双重闹钟已设定：应用内精确闹钟 ${seconds} 秒后响铃+AI发信（退出应用也能响） + 系统时钟 ${hour}:${String(minute).padStart(2, '0')}（部分手机需确认弹窗）`);
        } else if (inAppAlarmOk) {
          showToast(`应用内精确闹钟已设定，${seconds} 秒后响铃（锁屏/退出应用也能响）`);
        } else if (systemAlarmOk) {
          showToast(`已写入系统时钟闹钟，${hour}:${String(minute).padStart(2, '0')} 响铃（部分手机需手动确认）`);
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
      // 持久化闹钟状态：供后台 Headless 中枢（initBackgroundCenter）退出后恢复
      try {
        localStorage.setItem("mcp_active_alarm_state", JSON.stringify({
          triggerTime: triggerTimeMillis, title: title, ringtone: ringtone
        }));
      } catch(e) {}
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
      try { localStorage.removeItem("mcp_active_alarm_state"); } catch(e) {}
      // 取消闹钟时同时停止循环铃声
      this.stopAlarmRingtone();
      this._renderAlarmStatus();
      if (inAppCancelled) {
        showToast("已取消应用内闹钟（系统时钟App的闹钟需手动删除）");
      } else {
        showToast("闹钟状态已清除（系统时钟App的闹钟需手动删除）");
      }
    },

    /** 停止闹钟循环铃声（用户手动关闭） */
    stopAlarmRingtone: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.stopAlarmRingtone === 'function') {
        try {
          window.AndroidMCP.stopAlarmRingtone();
          showToast("闹钟铃声已停止");
        } catch(e) {
          console.warn("停止闹钟铃声失败:", e);
        }
      }
    },

    /**
     * 清除活动闹钟状态（供 handleInAppAlarm 到点后调用，不调原生 cancel）。
     */
    clearAlarmStatus: function() {
      this._stopAlarmCountdown();
      this.activeAlarm = null;
      try { localStorage.removeItem("mcp_active_alarm_state"); } catch(e) {}
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
      this.currentPlayIndex = index;
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
    //  5.1 真实电量读取（BatteryManager 系统服务）
    // ==========================================
    syncBattery: function() {
      const statusEl = document.getElementById("mcp-battery-status");
      if (window.AndroidMCP && typeof window.AndroidMCP.getBatteryStatus === 'function') {
        try {
          const raw = window.AndroidMCP.getBatteryStatus();
          const data = JSON.parse(raw);
          if (data && data.ok) {
            if (statusEl) statusEl.innerText = `设备真实电量：${data.level}%${data.charging ? "（正在充电）" : ""}`;
            try {
              localStorage.setItem("mcp_battery", JSON.stringify({
                level: data.level, status: data.status || "", timestamp: Date.now()
              }));
            } catch(e) {}
            return;
          }
        } catch(e) {
          console.warn("读取电量失败:", e);
        }
      }
      if (statusEl) statusEl.innerText = "设备真实电量：读取失败（请检查权限）";
    },

    // ==========================================
    //  5.2 当前正在播放的媒体（通知监听解析：歌名/歌手/来源App）
    // ==========================================
    syncNowPlaying: function(round) {
      const statusEl = document.getElementById("mcp-nowplaying-status");
      if (!statusEl) return;
      round = round || 0;
      if (!(window.AndroidMCP && typeof window.AndroidMCP.getNowPlayingMedia === 'function')) {
        statusEl.innerText = "当前环境不支持原生媒体读取，请在 APK 壳中运行。";
        return;
      }
      // 第一轮先请求原生层"重绑监听服务+快照当前通知"，给已在播放的媒体一次补救机会
      if (round === 0) {
        try {
          if (typeof window.AndroidMCP.refreshNowPlayingMedia === 'function') window.AndroidMCP.refreshNowPlayingMedia();
        } catch(e) {}
        // 若监听服务根本没被系统绑定（部分 ROM 权限开着也不拉服务），静默自动强制重绑一次
        try {
          const dbg = JSON.parse((window.AndroidMCP.getNowPlayingDebug && window.AndroidMCP.getNowPlayingDebug()) || "{}");
          const now = Date.now();
          if (dbg && dbg.serviceAlive === false &&
              typeof window.AndroidMCP.repairNotificationListener === 'function' &&
              now - (this._npAutoRepairAt || 0) > 5 * 60 * 1000) {
            this._npAutoRepairAt = now;
            window.AndroidMCP.repairNotificationListener();
          }
        } catch(e) {}
      }
      statusEl.innerText = round === 0 ? "正在读取设备正在播放的媒体..." : "正在播放：仍未捕获，二次读取中...";
      const finish = (text) => { statusEl.innerText = text; };
      try {
        const raw = window.AndroidMCP.getNowPlayingMedia();
        const data = JSON.parse(raw);
        if (!data.ok) { finish("读取失败：" + ((data && data.error) || "未知错误")); return; }
        if (data.granted === false) {
          statusEl.innerHTML = "未开启\"通知使用权\"：<span style=\"color:#dc2626; cursor:pointer; text-decoration:underline;\" onclick=\"mcpSystem.openNowPlayingSettings()\">去系统设置开启</span>（能看到媒体通知即可）";
          return;
        }
        const title = data.title || "";
        const artist = data.artist || "";
        const app = data.appName || "";
        if (title) {
          finish("正在播放：" + title + (artist ? " - " + artist : "") + (app ? "（" + app + "）" : ""));
          try {
            localStorage.setItem("mcp_now_playing", JSON.stringify({
              title: title, artist: artist, app: app, playing: data.playing !== false, timestamp: Date.now()
            }));
          } catch(e) {}
          if (round === 0) showToast("已同步正在播放：" + title);
        } else if (round < 4) {
          // 给自动修复(组件重绑)+快照 留出时间，最多再重试 4 次(约3.6秒)
          setTimeout(() => { try { this.syncNowPlaying(round + 1); } catch(e) {} }, 900);
        } else {
          // 判断是不是"服务未被系统绑定"（权限开着但没拉起服务）
          let alive = null;
          try {
            const dbg = JSON.parse((window.AndroidMCP.getNowPlayingDebug && window.AndroidMCP.getNowPlayingDebug()) || "{}");
            alive = dbg.serviceAlive;
          } catch(e) {}
          if (alive === false) {
            statusEl.innerHTML = "系统没有绑定通知监听服务（已自动尝试修复）　" +
              "<span style=\"color:#dc2626; cursor:pointer; text-decoration:underline;\" onclick=\"mcpSystem.repairNowPlaying()\">再修一次</span>　" +
              "<span style=\"color:#6366f1; cursor:pointer; text-decoration:underline;\" onclick=\"mcpSystem.debugNowPlaying()\">诊断</span>";
          } else {
            statusEl.innerHTML = (data.message || "当前没有检测到正在播放的媒体") +
              "　<span style=\"color:#6366f1; cursor:pointer; text-decoration:underline;\" onclick=\"mcpSystem.debugNowPlaying()\">诊断</span>";
          }
          try { localStorage.removeItem("mcp_now_playing"); } catch(e) {}
        }
      } catch(e) {
        finish("读取失败：" + e.message);
      }
    },

    /** 一键修复：强制系统重新绑定通知监听服务（部分 ROM 权限开着却不拉起服务） */
    repairNowPlaying: function() {
      if (!(window.AndroidMCP && typeof window.AndroidMCP.repairNotificationListener === 'function')) {
        showToast("当前环境不支持一键修复，请到系统设置里关闭再打开\"通知使用权\"");
        return;
      }
      try {
        const r = JSON.parse(window.AndroidMCP.repairNotificationListener() || "{}");
        if (r && r.ok) {
          showToast(r.aliveBefore ? "已请求重绑监听服务，正在重新读取…" : "已强制重绑监听服务，正在重新读取…");
        } else {
          showToast("修复失败：" + ((r && r.error) || "未知"));
        }
      } catch(e) {
        showToast("修复异常：" + (e.message || e));
      }
      setTimeout(() => { try { this.syncNowPlaying(0); } catch(e) {} }, 1500);
    },

    /** 诊断"正在播放"为何读不到：看通知监听是否真的在收数据、媒体判定卡在哪一步 */
    debugNowPlaying: function() {
      const statusEl = document.getElementById("mcp-nowplaying-status");
      if (!(window.AndroidMCP && typeof window.AndroidMCP.getNowPlayingDebug === 'function')) {
        showToast("当前环境不支持诊断");
        return;
      }
      try {
        const d = JSON.parse(window.AndroidMCP.getNowPlayingDebug());
        const lines = [
          "【正在播放诊断】",
          "通知使用权：" + (d.granted ? "已授予" : "未授予"),
          "监听服务：" + (d.serviceAlive ? "已绑定（在收数据）" : "未绑定（系统没把服务拉起来）"),
          "缓存媒体：" + (d.cachedPlaying ? d.cachedPlaying : "空"),
          "最近收到通知：" + (d.lastAnyNotification || "（一条都没收到 → 系统没投递通知给本应用）"),
          "Android SDK：" + d.sdkInt
        ];
        let html = this._escapeHtml(lines.join("\n")).replace(/\n/g, "<br>");
        if (d.serviceAlive === false) {
          html += "<br><span style=\"color:#dc2626;\">处理：</span><span style=\"color:#dc2626; cursor:pointer; text-decoration:underline;\" onclick=\"mcpSystem.repairNowPlaying()\">一键修复（强制重绑）</span>" +
            "<br><span style=\"color:var(--text-secondary);\">仍不行：系统设置里把本应用\"通知使用权\"关掉再打开；并在电池/应用管理里允许后台运行、关闭省电限制。</span>";
        }
        if (statusEl) statusEl.innerHTML = html;
        showToast("诊断结果已显示");
      } catch(e) {
        showToast("诊断失败：" + e.message);
      }
    },

    /** 引导用户开启"通知使用权"（读取跨应用媒体通知的必需权限） */
    openNowPlayingSettings: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.requestNotificationListenerPermission === 'function') {
        window.AndroidMCP.requestNotificationListenerPermission();
        showToast("请在系统设置中开启本应用的'通知使用权'");
      } else {
        showToast("当前环境不支持跳转系统设置");
      }
    },

    // ==========================================
    //  6.0 蓝牙设备管理（真实读取 + AI 控制）
    // ==========================================
    bluetoothDevices: [],   // 已连接 + 已配对设备缓存
    bleDevices: [],         // BLE 扫描结果缓存

    /** 刷新已连接/已配对设备并渲染 */
    loadBluetoothDevices: function() {
      const listEl = document.getElementById("mcp-bt-list");
      if (!listEl) return;
      if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothGetDevices === 'function') {
        try {
          const raw = window.AndroidMCP.bluetoothGetDevices();
          const data = JSON.parse(raw);
          if (data && data.ok) {
            this.bluetoothDevices = data.devices || [];
            const summaryEl = document.getElementById("mcp-bt-summary");
            if (summaryEl) summaryEl.innerText = `${this.bluetoothDevices.length} 台设备 ▾`;
            this.renderBluetoothDevices();
            this.syncBluetoothPromptData();
            showToast(`已读取 ${this.bluetoothDevices.length} 台蓝牙设备`);
            return;
          }
          listEl.innerHTML = `<div style="color:#dc2626;">读取失败：${(data && data.error) || "未知错误"}</div>`;
          if (data && data.error && /权限/.test(data.error)) this.ensureBtPermissionGranted();
          return;
        } catch(e) {
          console.error("读取蓝牙设备失败:", e);
        }
      }
      listEl.innerHTML = `<div>当前环境不支持原生蓝牙读取，请在 APK 壳中运行。</div>`;
    },

    /** 渲染设备列表（每个设备独立注入开关 + SPP 发送） */
    renderBluetoothDevices: function() {
      const listEl = document.getElementById("mcp-bt-list");
      if (!listEl) return;
      if (this.bluetoothDevices.length === 0) {
        listEl.innerHTML = `<div>未发现设备。请先在系统设置中配对蓝牙设备，再点"刷新"。</div>`;
        return;
      }
      const rows = this.bluetoothDevices.map((dev) => {
        const addrKey = String(dev.address).replace(/[^a-zA-Z0-9]/g, "_");
        const isConnected = !!dev.isConnected;
        const tag = isConnected
          ? `<span style="color:#16a34a; font-weight:700;">已连接</span>`
          : `<span style="color:#9ca3af;">已配对</span>`;
        const profile = dev.profileName ? `<span style="color:#6366f1; font-size:10px;">${this._escapeHtml(dev.profileName)}</span>` : "";
        // 每设备独立注入开关（持久化）
        const injectOn = localStorage.getItem(`mcp_bt_inject_${dev.address}`) === "1";
        const switchHtml = `<label style="display:flex; align-items:center; gap:4px; cursor:pointer; flex-shrink:0;">
          <input type="checkbox" ${injectOn ? "checked" : ""} onchange="mcpSystem.toggleBtInject('${this._escapeHtml(dev.address)}', this.checked)">
          <span style="font-size:10px; color:var(--text-secondary);">注入</span>
        </label>`;
        return `<div style="border:1px solid var(--border); border-radius:8px; padding:8px; margin-bottom:6px; background:#fcfcfd;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-weight:700; color:var(--text-primary); font-size:12px; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._escapeHtml(dev.name)}</span>
            ${profile}
            <span style="font-size:9px; color:#9ca3af;">${this._escapeHtml(dev.address)}</span>
            <span style="margin-left:auto; display:flex; align-items:center; gap:6px;">${tag} ${switchHtml}</span>
          </div>
          <div style="display:flex; gap:4px; margin-top:6px; align-items:center;">
            <input id="bt-spp-${addrKey}" placeholder="发送数据到设备（如:ON / #LED1#）" style="flex:1; min-width:0; padding:5px 6px; border:1px solid var(--border); border-radius:6px; font-size:10px; background:#fff;">
            <button onclick="mcpSystem.sendSppToDevice('${this._escapeHtml(dev.address)}')" style="flex-shrink:0; padding:5px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #6366f1; background:#eef2ff; color:#4338ca; cursor:pointer;">串口发送</button>
            <button onclick="mcpSystem.openBtProfileEditor('${this._escapeHtml(dev.address)}')" style="flex-shrink:0; padding:5px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #a855f7; background:#faf5ff; color:#9333ea; cursor:pointer;">能力配置</button>
            <button onclick="mcpSystem.disconnectSpp()" style="flex-shrink:0; padding:5px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1px solid #d1d5db; background:#f9fafb; color:#6b7280; cursor:pointer;">断开</button>
          </div>
          <div style="font-size:10px; color:#9333ea; margin-top:4px;">AI 能力：${this.getDeviceCapabilities(dev).map(c => this._escapeHtml(c.label)).join(" / ")}</div>
        </div>`;
      }).join("");
      listEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:2px;">${rows}</div>`;
    },

    /** 每设备独立注入开关 */
    toggleBtInject: function(address, checked) {
      try {
        if (checked) localStorage.setItem(`mcp_bt_inject_${address}`, "1");
        else localStorage.removeItem(`mcp_bt_inject_${address}`);
      } catch(e) {}
      this.syncBluetoothPromptData();
      showToast(checked ? "该设备已注入 AI 提示词，AI 可感知并控制它" : "已取消该设备的 AI 控制注入");
    },

    /** 汇总注入设备到 localStorage（供 app_prompts.js 拼提示词） */
    syncBluetoothPromptData: function() {
      try {
        const injected = this._allBtDevices().filter(dev =>
          localStorage.getItem(`mcp_bt_inject_${dev.address}`) === "1"
        ).map(dev => {
          const caps = this.getDeviceCapabilities(dev);
          return {
            name: dev.name,
            address: dev.address,
            isConnected: !!dev.isConnected,
            profileName: dev.profileName || "",
            capabilities: caps.map(c => ({ id: c.id, label: c.label }))
          };
        });
        localStorage.setItem("mcp_bluetooth_devices", JSON.stringify(injected));
        localStorage.setItem("mcp_bluetooth_all", JSON.stringify(this._allBtDevices().map(d => ({
          name: d.name, address: d.address, isConnected: !!d.isConnected, profileName: d.profileName || ""
        }))));
      } catch(e) { console.warn("同步蓝牙注入数据失败:", e); }
    },

    /** 跳转系统蓝牙设置（添加/配对设备） */
    openBluetoothSettings: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.openBluetoothSettings === 'function') {
        window.AndroidMCP.openBluetoothSettings();
        showToast("已打开系统蓝牙设置，请配对设备后返回");
      } else {
        showToast("当前环境不支持跳转系统设置");
      }
    },

    /** 经典蓝牙 SPP 串口发送 */
    sendSppToDevice: function(address) {
      const addrKey = String(address).replace(/[^a-zA-Z0-9]/g, "_");
      const input = document.getElementById(`bt-spp-${addrKey}`);
      if (!input) return;
      const data = input.value;
      if (!data.trim()) { showToast("请先输入要发送的数据"); return; }
      if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothSendSpp === 'function') {
        const ok = window.AndroidMCP.bluetoothSendSpp(address, data);
        if (ok) {
          showToast(`已通过蓝牙串口发送：${data}`);
          input.value = "";
        } else {
          showToast("发送失败：请检查设备连接与蓝牙权限");
        }
      } else {
        showToast("当前环境不支持原生蓝牙控制");
      }
    },

    disconnectSpp: function() {
      if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothDisconnectSpp === 'function') {
        window.AndroidMCP.bluetoothDisconnectSpp();
        showToast("已断开蓝牙串口连接");
      }
    },

    /** BLE 扫描并轮询结果 */
    scanBle: function() {
      const listEl = document.getElementById("mcp-ble-list");
      if (!listEl) return;
      if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothScanBle === 'function') {
        listEl.innerHTML = `<div>正在扫描周围 BLE 设备（8 秒）...</div>`;
        try {
          const startRaw = window.AndroidMCP.bluetoothScanBle(8000);
          const start = JSON.parse(startRaw);
          if (!start.ok) {
            listEl.innerHTML = `<div style="color:#dc2626;">扫描启动失败：${start.error || ""}</div>`;
            return;
          }
        } catch(e) {}
        setTimeout(() => {
          try {
            const raw = window.AndroidMCP.bluetoothGetBleResults();
            const data = JSON.parse(raw);
            this.bleDevices = (data && data.devices) || [];
            // 缓存扫描结果，避免免配对设备每次都要重扫才能看到
            try { localStorage.setItem("mcp_ble_cache", JSON.stringify({ t: Date.now(), devices: this.bleDevices })); } catch(e) {}
            this.renderBleDevices();
          } catch(e) {
            listEl.innerHTML = `<div>扫描结果读取失败</div>`;
          }
        }, 8500);
      } else {
        listEl.innerHTML = `<div>当前环境不支持 BLE 扫描</div>`;
      }
    },

    /** 渲染 BLE 扫描结果（每设备可写特征值） */
    renderBleDevices: function() {
      const listEl = document.getElementById("mcp-ble-list");
      if (!listEl) return;
      // 优先展示最近一次扫描缓存（免配对设备在附近未广播时仍可见/可配置）
      if (this.bleDevices.length === 0) {
        try {
          const cache = JSON.parse(localStorage.getItem("mcp_ble_cache") || "null");
          if (cache && Array.isArray(cache.devices) && cache.devices.length > 0) {
            this.bleDevices = cache.devices;
          }
        } catch(e) {}
      }
      if (this.bleDevices.length === 0) {
        listEl.innerHTML = `<div>未扫描到 BLE 设备（请确认设备处于可广播状态）</div>`;
        return;
      }
      const rows = this.bleDevices.map((dev) => {
        const addrKey = String(dev.address).replace(/[^a-zA-Z0-9]/g, "_");
        const name = dev.name || dev.address;
        const injectOn = localStorage.getItem(`mcp_bt_inject_${dev.address}`) === "1";
        const injectBtn = injectOn
          ? `<button onclick="mcpSystem.toggleScanDeviceAi('${this._escapeHtml(name)}','${this._escapeHtml(dev.address)}',false)" style="flex-shrink:0; padding:3px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #16a34a; background:#f0fdf4; color:#15803d; cursor:pointer;">✓ 已注入</button>`
          : `<button onclick="mcpSystem.toggleScanDeviceAi('${this._escapeHtml(name)}','${this._escapeHtml(dev.address)}',true)" style="flex-shrink:0; padding:3px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #a855f7; background:#faf5ff; color:#9333ea; cursor:pointer;">+ 加入AI控制</button>`;
        return `<div style="border:1px solid var(--border); border-radius:8px; padding:6px; margin-bottom:5px; background:#fcfcfd;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-weight:700; color:var(--text-primary); font-size:11px; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._escapeHtml(name)}</span>
            <span style="font-size:9px; color:#9ca3af;">${this._escapeHtml(dev.address)}</span>
            <span style="font-size:9px; color:#16a34a;">RSSI: ${dev.rssi}</span>
            <button onclick="mcpSystem.toggleBleWritePanel('${this._escapeHtml(dev.address)}')" style="margin-left:auto; flex-shrink:0; padding:4px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #0891b2; background:#ecfeff; color:#0e7490; cursor:pointer;">手动写入</button>
          </div>
          <div style="display:flex; gap:4px; margin-top:5px; align-items:center; flex-wrap:wrap;">
            ${injectBtn}
            <button onclick="mcpSystem.openBtProfileEditor('${this._escapeHtml(dev.address)}')" style="flex-shrink:0; padding:3px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #0891b2; background:#ecfeff; color:#0e7490; cursor:pointer;">⚙ 能力配置(协议/试振/复制提示词)</button>
          </div>
          <div style="font-size:9px; color:var(--text-secondary); margin-top:3px;">免配对设备（如 ANKNI 玩具）系统里显示"不允许配对"是正常的：直接在这里点 加入AI控制 / 能力配置，App 会以 BLE 直连方式工作，无需系统配对。</div>
          <div id="ble-write-${addrKey}" style="display:none; margin-top:6px; flex-direction:column; gap:4px;">
            <input id="ble-svc-${addrKey}" placeholder="Service UUID（如 0000ffe0-0000-1000-8000-00805f9b34fb）" style="width:100%; padding:5px 6px; border:1px solid var(--border); border-radius:6px; font-size:10px; background:#fff;">
            <input id="ble-char-${addrKey}" placeholder="Characteristic UUID（如 0000ffe1-0000-1000-8000-00805f9b34fb）" style="width:100%; padding:5px 6px; border:1px solid var(--border); border-radius:6px; font-size:10px; background:#fff;">
            <div style="display:flex; gap:4px;">
              <input id="ble-data-${addrKey}" placeholder="数据（hex: 01A2 或 文本）" style="flex:1; min-width:0; padding:5px 6px; border:1px solid var(--border); border-radius:6px; font-size:10px; background:#fff;">
              <button onclick="mcpSystem.bleWriteToDevice('${this._escapeHtml(dev.address)}')" style="flex-shrink:0; padding:5px 8px; font-size:10px; font-weight:700; border-radius:6px; border:1.5px solid #0891b2; background:#cffafe; color:#155e75; cursor:pointer;">发送</button>
            </div>
            <div id="ble-result-${addrKey}" style="font-size:10px; color:var(--text-secondary);"></div>
          </div>
        </div>`;
      }).join("");
      listEl.innerHTML = rows;
    },

    /** BLE 扫描结果行：加入/移除 AI 控制（免配对设备走本地已知清单） */
    toggleScanDeviceAi: function(name, address, on) {
      if (on) {
        this.saveKnownBtDevice(address, name);
        localStorage.setItem(`mcp_bt_inject_${address}`, "1");
        showToast("已加入 AI 控制：可在顶部刷新后于\"能力配置\"设置协议并试振");
      } else {
        localStorage.removeItem(`mcp_bt_inject_${address}`);
        showToast("已从 AI 控制移除");
      }
      this.syncBluetoothPromptData();
      this.renderBleDevices();
      this.renderBluetoothDevices();
    },

    /** 展开/收起 BLE 写入面板 */
    toggleBleWritePanel: function(address) {
      const addrKey = String(address).replace(/[^a-zA-Z0-9]/g, "_");
      const panel = document.getElementById(`ble-write-${addrKey}`);
      if (panel) {
        const willShow = panel.style.display !== "flex";
        panel.style.display = willShow ? "flex" : "none";
        if (willShow) document.getElementById(`ble-data-${addrKey}`)?.focus();
      }
    },

    /** BLE 特征值写入 */
    bleWriteToDevice: function(address) {
      const addrKey = String(address).replace(/[^a-zA-Z0-9]/g, "_");
      const service = document.getElementById(`ble-svc-${addrKey}`)?.value.trim();
      const char = document.getElementById(`ble-char-${addrKey}`)?.value.trim();
      const data = document.getElementById(`ble-data-${addrKey}`)?.value.trim();
      const resultEl = document.getElementById(`ble-result-${addrKey}`);
      if (!service || !char || !data) {
        if (resultEl) resultEl.innerText = "请填写 Service / Characteristic / 数据";
        return;
      }
      if (resultEl) resultEl.innerText = "正在连接设备并写入...";
      if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothBleWrite === 'function') {
        try {
          const startRaw = window.AndroidMCP.bluetoothBleWrite(address, service, char, data);
          const start = JSON.parse(startRaw);
          if (!start.ok) {
            if (resultEl) resultEl.innerText = "写入失败：" + (start.error || "");
            return;
          }
        } catch(e) {}
        // 轮询写入结果
        setTimeout(() => {
          try {
            const raw = window.AndroidMCP.bluetoothGetBleWriteResult();
            const res = JSON.parse(raw);
            if (res && res.ok) {
              if (resultEl) resultEl.innerText = `写入成功（${res.bytes || 0} 字节）`;
              showToast("BLE 特征值写入成功");
            } else {
              if (resultEl) resultEl.innerText = "写入失败：" + ((res && res.error) || "");
            }
          } catch(e) {}
        }, 6000);
      } else {
        if (resultEl) resultEl.innerText = "当前环境不支持 BLE 写入";
      }
    },

    // ==========================================
    //  6.1 设备能力档案（AI 语义控制路由）
    // ==========================================

    /** 设备能力档案存取（localStorage，按设备地址独立） */
    getDeviceProfileKey: function(address) { return `mcp_bt_profile_${address}`; },
    getDeviceProfile: function(address) {
      try { return JSON.parse(localStorage.getItem(this.getDeviceProfileKey(address))) || null; } catch(e) { return null; }
    },
    saveDeviceProfile: function(address, profile) {
      try {
        if (profile) localStorage.setItem(this.getDeviceProfileKey(address), JSON.stringify(profile));
        else localStorage.removeItem(this.getDeviceProfileKey(address));
      } catch(e) { console.warn("保存能力档案失败:", e); }
      this.syncBluetoothPromptData();
    },

    /** 内置 BLE 玩具协议预设（MR-Z 为范本；用户可照此自定义其它玩具） */
    BT_DEVICE_PRESETS: [
      {
        id: "ankni-mr-z",
        name: "ANKNI MR-Z（安可尼/谜姬 震动，保活型）",
        match: /ankni|mr-?z|安可尼|醉清风|谜姬|mizzzee|miji|miyu|xhtkj/i,
        type: "ble",
        service: "0000DDDD-0000-1000-8000-00805F9B34FB",
        char: "0000DDD1-0000-1000-8000-00805F9B34FB",
        hold: true,
        intervalMs: 150,
        commands: {
          vibrate: { pattern: "AA0801{value:hex}{csum}", hint: "0-100 持续强度；0=停止" },
          stop: { pattern: "AA080100B3", hint: "立即停止" }
        }
      }
    ],

    /** 按设备名匹配内置预设 */
    findPresetForName: function(name) {
      const n = String(name || "");
      if (!n) return null;
      return this.BT_DEVICE_PRESETS.find(p => p.match && p.match.test(n)) || null;
    },

    /** 免配对 BLE 玩具等"已知设备"本地清单（key=address，value={name}），供未系统配对设备参与注入/控制 */
    _btKnownKey: "mcp_bt_known_devices",
    getKnownBtDevices: function() {
      try { return JSON.parse(localStorage.getItem(this._btKnownKey)) || {}; } catch(e) { return {}; }
    },
    saveKnownBtDevice: function(address, name) {
      try {
        const known = this.getKnownBtDevices();
        if (name && (!known[address] || known[address].name !== name)) {
          known[address] = { name: String(name) };
          localStorage.setItem(this._btKnownKey, JSON.stringify(known));
        }
      } catch(e) {}
    },

    /** 全量设备视角：已配对/已连接 + BLE 扫描结果 + 本地已知设备（按地址去重） */
    _allBtDevices: function() {
      const map = {};
      const push = (d) => {
        if (!d || !d.address) return;
        const prev = map[d.address];
        if (!prev) map[d.address] = { name: d.name || prev?.name || "", address: d.address, isConnected: !!d.isConnected, profileName: d.profileName || "BLE" };
        else {
          if (!prev.name && d.name) prev.name = d.name;
          if (!prev.profileName && d.profileName) prev.profileName = d.profileName;
          if (d.isConnected) prev.isConnected = true;
        }
      };
      (this.bluetoothDevices || []).forEach(push);
      (this.bleDevices || []).forEach(d => push({ name: d.name, address: d.address, isConnected: false, profileName: "BLE" }));
      const known = this.getKnownBtDevices();
      Object.keys(known).forEach(addr => push({ name: known[addr].name, address: addr, isConnected: false, profileName: "BLE(未绑定)" }));
      return Object.keys(map).map(k => map[k]);
    },

    /** 按名称或地址在"全量设备"里查找 */
    findAnyDevice: function(query) {
      const q = String(query || "");
      if (!q) return null;
      return this._allBtDevices().find(d => d.name === q || d.address === q || (d.name && d.name.toLowerCase() === q.toLowerCase())) || null;
    },

    /** 媒体设备能力清单（A2DP / 耳机类，注入后生效） */
    MEDIA_CAPABILITIES: [
      { id: "volume_up", label: "音量+" },
      { id: "volume_down", label: "音量-" },
      { id: "volume_set", label: "音量调到N(0-100)" },
      { id: "volume_mute", label: "静音" },
      { id: "volume_unmute", label: "取消静音" },
      { id: "play", label: "播放" },
      { id: "pause", label: "暂停" },
      { id: "play_pause", label: "播放/暂停" },
      { id: "stop", label: "停止" },
      { id: "next", label: "下一首" },
      { id: "prev", label: "上一首" }
    ],

    /** 判断是否为媒体设备（A2DP 音频 / 耳机类 profile） */
    isMediaDevice: function(dev) {
      const p = ((dev && dev.profileName) || "").toLowerCase();
      return p.includes("a2dp") || p.includes("耳机") || p.includes("headset") || p.includes("audio") || p.includes("媒体");
    },

    /** 设备对 AI 开放的能力清单 [{id,label}]：档案优先 → 媒体设备默认 → 兜底串口 */
    getDeviceCapabilities: function(dev) {
      const profile = this.getDeviceProfile(dev.address);
      if (profile && profile.type === "media") return this.MEDIA_CAPABILITIES;
      if (profile && profile.commands && Object.keys(profile.commands).length > 0) {
        const holdTag = profile.type === "ble" && profile.hold ? "·持续" : "";
        return Object.keys(profile.commands).map(name => {
          const c = profile.commands[name] || {};
          return { id: name, label: c.hint ? (name + "(" + c.hint + ")" + holdTag) : (name + holdTag) };
        });
      }
      if (this.isMediaDevice(dev)) return this.MEDIA_CAPABILITIES;
      return [{ id: "send", label: "串口发送原始文本" }];
    },

    /** 命令模板渲染：{value} 十进制 / {value:byte} 单字节hex / {value:hex} 两位hex / {on}=1 / {off}=0 / {csum}=前字节累加校验和(hex) */
    renderCommandPattern: function(pattern, value) {
      if (!pattern) return "";
      let out = pattern;
      const hasSum = out.indexOf("{csum}") >= 0;
      // 先用占位符保护 {csum}，避免被其它替换误伤
      out = out.split("{csum}").join("\u0001");
      out = out.split("{on}").join("1").split("{off}").join("0");
      const v = (value === undefined || value === null || value === "") ? null : Number(value);
      if (v === null) {
        return out.includes("{value") ? null : out.split("\u0001").join("");
      }
      const clamped = Math.max(0, Math.min(255, Math.round(v)));
      out = out.split("{value:byte}").join(clamped.toString(16).padStart(2, "0"));
      out = out.split("{value:hex}").join(clamped.toString(16).padStart(2, "0"));
      out = out.split("{value}").join(String(clamped));
      if (hasSum) {
        // 计算校验和：对模板中除占位符外的全部十六进制字节累加取低 8 位
        const cleaned = out.replace(/\u0001/g, "").replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
        if (cleaned.length >= 2 && cleaned.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(cleaned)) {
          let sum = 0;
          for (let i = 0; i < cleaned.length; i += 2) sum += parseInt(cleaned.slice(i, i + 2), 16);
          const cs = (sum & 0xFF).toString(16).toUpperCase().padStart(2, "0");
          out = out.split("\u0001").join(cs);
        } else {
          out = out.split("\u0001").join("");
        }
      }
      return out;
    },

    /** 执行 AI 语义控制指令（action:"control"） */
    executeDeviceControl: function(device, command, value) {
      if (!command) return false;
      const found = this.findAnyDevice(device);
      if (!found) { showToast("未找到蓝牙设备：" + device); return false; }
      const profile = this.getDeviceProfile(found.address);

      // 1) 自定义 BLE 档案（特征值写入）
      if (profile && profile.type === "ble") {
        const cmd = (profile.commands || {})[command];
        if (!cmd) { showToast("设备 [" + found.name + "] 未定义命令 [" + command + "]"); return false; }
        const data = this.renderCommandPattern(cmd.pattern, value);
        if (data === null || data === "") { showToast("命令 [" + command + "] 需要 value 参数"); return false; }
        // 保活持续型（玩具类）：启动/更新 周期续帧会话，直到 stop 或 vibrate 0
        if (profile.hold) {
          return this.executeBleHold(found, profile, command, data, value);
        }
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothBleWrite === 'function') {
          window.AndroidMCP.bluetoothBleWrite(found.address, profile.service || "", profile.char || "", data);
          setTimeout(() => {
            try {
              const raw = window.AndroidMCP.bluetoothGetBleWriteResult();
              const res = JSON.parse(raw);
              showToast(res && res.ok ? ("已向 [" + found.name + "] 发送：" + data) : ("BLE 发送失败：" + ((res && res.error) || "未知")));
            } catch(e) {}
          }, 6000);
          return true;
        }
        return false;
      }

      // 2) 自定义 SPP 串口档案
      if (profile && profile.type === "spp") {
        const cmd = (profile.commands || {})[command];
        if (!cmd) { showToast("设备 [" + found.name + "] 未定义命令 [" + command + "]"); return false; }
        const data = this.renderCommandPattern(cmd.pattern, value);
        if (data === null || data === "") { showToast("命令 [" + command + "] 需要 value 参数"); return false; }
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothSendSpp === 'function') {
          const ok = window.AndroidMCP.bluetoothSendSpp(found.address, data);
          if (ok) showToast("已向 [" + found.name + "] 发送：" + data);
          return ok;
        }
        return false;
      }

      // 3) 媒体设备（耳机类：系统媒体通道）
      if ((profile && profile.type === "media") || this.isMediaDevice(found)) {
        if (window.AndroidMCP && typeof window.AndroidMCP.mediaControlCommand === 'function') {
          // 本应用自己播放时，切歌走本地歌单（体验更佳）
          if ((command === "next" || command === "prev") && this.currentPlayIndex >= 0 && this.mergedPlaylist.length > 0) {
            const delta = command === "next" ? 1 : -1;
            const nextIdx = (this.currentPlayIndex + delta + this.mergedPlaylist.length) % this.mergedPlaylist.length;
            this.playTrackByIndex(nextIdx);
            return true;
          }
          const numVal = (value === undefined || value === null) ? 0 : (Number(value) || 0);
          const raw = window.AndroidMCP.mediaControlCommand(command, numVal);
          try {
            const res = JSON.parse(raw);
            if (res && res.ok) showToast("已执行：" + this._mediaCmdLabel(command));
            else if (res && res.error) showToast(res.error);
          } catch(e) {}
          return true;
        }
        return false;
      }

      // 4) 兜底：无档案非媒体设备 → 兼容旧版原始串口发送
      if (command === "send") {
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothSendSpp === 'function') {
          const ok = window.AndroidMCP.bluetoothSendSpp(found.address, String(value === undefined ? "" : value));
          if (ok) showToast("已向 [" + found.name + "] 串口发送：" + value);
          return ok;
        }
        return false;
      }
      showToast("设备 [" + found.name + "] 无法执行 [" + command + "]，请在\"能力配置\"中定义");
      return false;
    },


    // ---- 能力档案配置界面 ----

    _profileEdit: null, // { address, type, service, char, commands: [{name, pattern, hint}] }

    openBtProfileEditor: function(address) {
      const found = this.findAnyDevice(address);
      const dev = found || { name: this.bleDevices.find(d => d.address === address)?.name || address, address: address };
      // 免配对 BLE 玩具也记入"已知设备"，保证保存/注入全链路可用
      this.saveKnownBtDevice(dev.address, dev.name);
      const existing = this.getDeviceProfile(address) || {};
      const hasExisting = !!(existing.type || (existing.commands && Object.keys(existing.commands).length > 0));
      this._profileEdit = {
        address: address,
        type: existing.type || "auto",
        service: existing.service || "",
        char: existing.char || "",
        hold: !!existing.hold,
        intervalMs: existing.intervalMs || 150,
        commands: existing.commands ? Object.keys(existing.commands).map(k => ({
          name: k,
          pattern: (existing.commands[k] || {}).pattern || "",
          hint: (existing.commands[k] || {}).hint || ""
        })) : []
      };
      // 内置预设自动填充：该设备无档案但名称命中已知协议族（如 ANKNI MR-Z）
      if (!hasExisting) {
        const preset = this.findPresetForName(dev.name);
        if (preset) {
          const p = this._profileEdit;
          p.type = preset.type || "ble";
          p.service = preset.service || p.service;
          p.char = preset.char || p.char;
          p.hold = !!preset.hold;
          p.intervalMs = preset.intervalMs || 150;
          p.commands = Object.keys(preset.commands || {}).map(k => ({
            name: k,
            pattern: preset.commands[k].pattern || "",
            hint: preset.commands[k].hint || ""
          }));
          showToast("已按内置预设[" + preset.name + "]填充，可调整后保存");
        }
      }
      const overlay = document.getElementById("bt-profile-editor-overlay");
      if (!overlay) { showToast("配置弹窗未找到"); return; }
      document.getElementById("bt-profile-device-name").innerText = dev.name + "（" + dev.address + "）";
      document.getElementById("bt-profile-type").value = this._profileEdit.type;
      document.getElementById("bt-profile-svc").value = this._profileEdit.service;
      document.getElementById("bt-profile-char").value = this._profileEdit.char;
      const holdEl = document.getElementById("bt-profile-hold");
      if (holdEl) holdEl.checked = !!this._profileEdit.hold;
      const msEl = document.getElementById("bt-profile-hold-ms");
      if (msEl) msEl.value = this._profileEdit.intervalMs || 150;
      this._syncProfileTypeFields();
      this.renderBtProfileCommandRows();
      overlay.style.display = "flex";
    },

    closeBtProfileEditor: function() {
      const overlay = document.getElementById("bt-profile-editor-overlay");
      if (overlay) overlay.style.display = "none";
      this._profileEdit = null;
    },

    _syncProfileTypeFields: function() {
      const type = this._profileEdit ? this._profileEdit.type : "auto";
      const bleFields = document.getElementById("bt-profile-ble-fields");
      if (bleFields) bleFields.style.display = (type === "ble") ? "block" : "none";
      this.onBtHoldToggle();
    },

    /** 保活开关：联动显示间隔输入行 */
    onBtHoldToggle: function() {
      const el = document.getElementById("bt-profile-hold");
      const row = document.getElementById("bt-profile-hold-ms-row");
      if (row) row.style.display = (el && el.checked) ? "block" : "none";
      const edit = this._profileEdit;
      if (edit && el) edit.hold = !!el.checked;
    },

    onBtProfileTypeChange: function() {
      if (this._profileEdit) this._profileEdit.type = document.getElementById("bt-profile-type").value;
      this._syncProfileTypeFields();
    },

    addBtProfileCommandRow: function() {
      if (!this._profileEdit) return;
      this._profileEdit.commands.push({ name: "", pattern: "", hint: "" });
      this.renderBtProfileCommandRows();
    },

    removeBtProfileCommandRow: function(idx) {
      if (!this._profileEdit) return;
      this._profileEdit.commands.splice(idx, 1);
      this.renderBtProfileCommandRows();
    },

    renderBtProfileCommandRows: function() {
      const wrap = document.getElementById("bt-profile-command-rows");
      if (!wrap || !this._profileEdit) return;
      const rows = this._profileEdit.commands.map((c, idx) => `
        <div style="display:flex; gap:4px; align-items:center; margin-bottom:4px;">
          <input id="bt-cmd-name-${idx}" value="${this._escapeHtml(c.name)}" placeholder="命令名(如 vibrate)" style="width:30%; padding:4px 5px; border:1px solid var(--border); border-radius:6px; font-size:10px;" oninput="mcpSystem.onBtCmdInput(${idx},'name',this.value)">
          <input id="bt-cmd-pattern-${idx}" value="${this._escapeHtml(c.pattern)}" placeholder="模板(如 01{value:byte})" style="flex:1; min-width:0; padding:4px 5px; border:1px solid var(--border); border-radius:6px; font-size:10px;" oninput="mcpSystem.onBtCmdInput(${idx},'pattern',this.value)">
          <input id="bt-cmd-hint-${idx}" value="${this._escapeHtml(c.hint)}" placeholder="说明(如 0-255)" style="width:24%; padding:4px 5px; border:1px solid var(--border); border-radius:6px; font-size:10px;" oninput="mcpSystem.onBtCmdInput(${idx},'hint',this.value)">
          <button onclick="mcpSystem.removeBtProfileCommandRow(${idx})" style="flex-shrink:0; border:none; background:none; color:#ef4444; cursor:pointer; font-size:14px;">✕</button>
        </div>`).join("");
      wrap.innerHTML = rows || `<div style="font-size:10px; color:var(--text-secondary);">暂无命令，点击下方"添加命令"</div>`;
    },

    onBtCmdInput: function(idx, field, val) {
      if (this._profileEdit && this._profileEdit.commands[idx]) this._profileEdit.commands[idx][field] = val;
    },

    onBtSvcCharInput: function() {
      if (!this._profileEdit) return;
      this._profileEdit.service = document.getElementById("bt-profile-svc").value.trim();
      this._profileEdit.char = document.getElementById("bt-profile-char").value.trim();
    },

    /** BLE 一键发现服务（填写 UUID 用） */
    discoverBleServices: function() {
      if (!this._profileEdit) return;
      const addr = this._profileEdit.address;
      const resEl = document.getElementById("bt-profile-svc-result");
      if (!window.AndroidMCP || typeof window.AndroidMCP.bluetoothBleDiscoverServices !== 'function') {
        if (resEl) resEl.innerHTML = `<div style="color:#dc2626;">当前环境不支持 BLE 服务发现</div>`;
        return;
      }
      if (resEl) resEl.innerHTML = `<div style="color:var(--text-secondary);">正在连接设备并枚举服务...</div>`;
      try {
        window.AndroidMCP.bluetoothBleDiscoverServices(addr);
      } catch(e) { if (resEl) resEl.innerHTML = `<div style="color:#dc2626;">发现失败：${e.message}</div>`; return; }
      setTimeout(() => {
        try {
          const raw = window.AndroidMCP.bluetoothGetBleServicesResult();
          const res = JSON.parse(raw);
          if (!resEl) return;
          if (!res || !res.ok) { resEl.innerHTML = `<div style="color:#dc2626;">发现失败：${(res && res.error) || "未知"}</div>`; return; }
          const list = (res.services || []).map(svc => {
            const chars = (svc.characteristics || []).map(ch => `
              <div style="display:flex; gap:6px; align-items:center; margin:2px 0 2px 12px; font-size:10px;">
                <span style="flex:1; word-break:break-all; color:var(--text-secondary);">${this._escapeHtml(ch.uuid)}${ch.name ? "（" + this._escapeHtml(ch.name) + "）" : ""} ${ch.properties ? "[" + this._escapeHtml(ch.properties) + "]" : ""}</span>
                <button onclick="mcpSystem.btProfilePickChar('${this._escapeHtml(ch.uuid)}')" style="flex-shrink:0; padding:2px 6px; font-size:9px; border-radius:6px; border:1px solid #a855f7; background:#faf5ff; color:#9333ea; cursor:pointer;">选用</button>
              </div>`).join("");
            return `<div style="margin-top:4px;">
              <div style="font-size:10px; font-weight:700; color:var(--text-primary); word-break:break-all;">${this._escapeHtml(svc.uuid)}${svc.name ? "（" + this._escapeHtml(svc.name) + "）" : ""}</div>
              ${chars}
            </div>`;
          }).join("");
          resEl.innerHTML = `<div style="font-size:10px; color:#16a34a; margin-bottom:4px;">发现 ${res.count || 0} 个服务，点特征"选用"填入</div>` + list;
        } catch(e) {
          if (resEl) resEl.innerHTML = `<div style="color:#dc2626;">结果解析失败：${e.message}</div>`;
        }
      }, 5000);
    },

    btProfilePickChar: function(uuid) {
      if (this._profileEdit) this._profileEdit.char = uuid;
      document.getElementById("bt-profile-char").value = uuid;
      showToast("已填入特征值 UUID");
    },

    saveBtProfile: function() {
      if (!this._profileEdit) return;
      const edit = this._profileEdit;
      const type = edit.type;
      if (type === "ble" && (!edit.service || !edit.char)) { showToast("BLE 设备请填写 Service 与 Characteristic UUID"); return; }
      if (type === "ble") {
        const holdEl = document.getElementById("bt-profile-hold");
        if (holdEl) edit.hold = !!holdEl.checked;
        const msEl = document.getElementById("bt-profile-hold-ms");
        const ms = msEl ? parseInt(msEl.value, 10) : NaN;
        edit.intervalMs = (edit.hold && !isNaN(ms) && ms >= 50 && ms <= 3000) ? ms : 150;
      } else {
        edit.hold = false;
      }
      const commands = {};
      edit.commands.forEach(c => {
        const name = (c.name || "").trim();
        const pattern = (c.pattern || "").trim();
        if (name && pattern) commands[name] = { pattern: pattern, hint: (c.hint || "").trim() };
      });
      if (type !== "media" && type !== "auto" && Object.keys(commands).length === 0) { showToast("该类型至少需要一个命令"); return; }
      const profile = { type: type };
      if (type === "ble") {
        profile.service = edit.service.trim();
        profile.char = edit.char.trim();
        if (edit.hold) {
          profile.hold = true;
          profile.intervalMs = edit.intervalMs || 150;
        }
      }
      if (Object.keys(commands).length > 0) profile.commands = commands;
      this.saveDeviceProfile(edit.address, profile);
      this.closeBtProfileEditor();
      this.renderBluetoothDevices();
      this.syncBluetoothPromptData();
      showToast("能力配置已保存，AI 可执行语义控制" + (profile.hold ? "（保活持续模式）" : ""));
    },
    _mediaCmdLabel: function(command) {
      const hit = this.MEDIA_CAPABILITIES.find(c => c.id === command);
      return hit ? hit.label : command;
    },

    // ---- 保活持续控制（ANKNI 等玩具：周期续帧直到 stop）----

    executeBleHold: function(found, profile, command, data, value) {
      const service = profile.service || "";
      const char = profile.char || "";
      const interval = profile.intervalMs || 150;
      const numVal = (value === undefined || value === null || value === "") ? NaN : Number(value);
      const isStop = command === "stop" || numVal === 0;
      const bridge = window.AndroidMCP;
      if (!bridge || typeof bridge.bleHoldStart !== 'function') {
        // 旧版兜底：退回单次写（设备约1~2s后自停）
        if (bridge && typeof bridge.bluetoothBleWrite === 'function') {
          bridge.bluetoothBleWrite(found.address, service, char, data);
          showToast("当前版本无保活接口，已单次发送（约1-2s后自停）");
          return true;
        }
        showToast("当前环境不支持蓝牙保活控制");
        return false;
      }
      try {
        if (isStop) {
          // 先补一帧停止帧，再停会话
          try { bridge.bleHoldUpdate(data); } catch(e) {}
          setTimeout(() => {
            try {
              const st = JSON.parse(bridge.bleHoldState() || "{}");
              if (st && st.active) bridge.bleHoldStop();
            } catch(e) { try { bridge.bleHoldStop(); } catch(e2) {} }
          }, 220);
          showToast("已停止 [" + found.name + "] 持续控制");
          return true;
        }
        let st = null;
        try { st = JSON.parse(bridge.bleHoldState() || "{}"); } catch(e) {}
        if (st && st.active && st.deviceAddress === found.address) {
          bridge.bleHoldUpdate(data);
          showToast("[" + found.name + "] 强度已调整，保持中 → " + data);
        } else {
          if (st && st.active) { try { bridge.bleHoldStop(); } catch(e) {} }
          let res = null;
          try { res = JSON.parse(bridge.bleHoldStart(found.address, service, char, data, interval) || "{}"); } catch(e) {}
          if (res && res.ok) showToast("[" + found.name + "] 持续震动已开启 → " + data);
          else showToast("开启失败：" + ((res && res.error) || "未知错误"));
        }
        return true;
      } catch(e) {
        showToast("持续控制异常：" + (e && e.message ? e.message : e));
        return false;
      }
    },

    /** 停止任何正在进行的保活会话（手动兜底按钮） */
    stopBtHoldTest: function() {
      const bridge = window.AndroidMCP;
      if (bridge && typeof bridge.bleHoldStop === 'function') {
        try { bridge.bleHoldStop(); } catch(e) {}
        showToast("已停止保活会话");
      } else {
        showToast("当前环境不支持");
      }
    },

    /** 在编辑器内手动套用内置预设（按当前设备名识别） */
    applyPresetDetect: function() {
      if (!this._profileEdit) return;
      const dev = this.findAnyDevice(this._profileEdit.address) || { name: "", address: this._profileEdit.address };
      const preset = this.findPresetForName(dev.name);
      if (!preset) { showToast("未识别到内置预设，请手动填写 Service/Characteristic 与命令模板"); return; }
      const p = this._profileEdit;
      p.type = preset.type || "ble";
      p.service = preset.service || "";
      p.char = preset.char || "";
      p.hold = !!preset.hold;
      p.intervalMs = preset.intervalMs || 150;
      p.commands = Object.keys(preset.commands || {}).map(k => ({
        name: k,
        pattern: preset.commands[k].pattern || "",
        hint: preset.commands[k].hint || ""
      }));
      document.getElementById("bt-profile-type").value = p.type;
      document.getElementById("bt-profile-svc").value = p.service;
      document.getElementById("bt-profile-char").value = p.char;
      const holdEl = document.getElementById("bt-profile-hold");
      if (holdEl) holdEl.checked = !!p.hold;
      const msEl = document.getElementById("bt-profile-hold-ms");
      if (msEl) msEl.value = p.intervalMs;
      this.onBtHoldToggle();
      this.renderBtProfileCommandRows();
      showToast("已套用预设[" + preset.name + "]，可微调后保存");
    },

    /** 能力配置弹窗内的“复制AI提示词”入口 */
    copyBtPromptFromEditor: function() {
      if (this._profileEdit) this.copyBtPrompt(this._profileEdit.address);
      else showToast("请先打开设备能力配置");
    },

    /** 能力配置弹窗内“试振 1.2s”：取 vibrate 命令(缺省用含 {value 的首条命令) value≈60 */
    testBtProfile: function() {
      const edit = this._profileEdit;
      if (!edit) return;
      if (edit.type !== "ble" || !edit.service || !edit.char) { showToast("请先填写 BLE Service/Characteristic 并选择类型 BLE"); return; }
      const list = edit.commands || [];
      let cmd = list.find(c => (c.name || "").trim() === "vibrate") || list.find(c => (c.pattern || "").includes("{value")) || list[0];
      if (!cmd) { showToast("请至少添加一个命令（如 vibrate 模板 AA0801{value:hex}{csum}）"); return; }
      const pattern = (cmd.pattern || "").trim();
      const data = this.renderCommandPattern(pattern, pattern.includes("{value") ? 60 : undefined);
      if (!data) { showToast("命令模板渲染失败"); return; }
      const bridge = window.AndroidMCP;
      const svc = edit.service.trim();
      const chr = edit.char.trim();
      const dev = this.findAnyDevice(edit.address) || { name: edit.address, address: edit.address };
      const devName = dev ? dev.name : edit.address;
      const statusEl = document.getElementById("bt-profile-hold-status");
      const setStat = (html, color) => {
        if (statusEl) statusEl.innerHTML = `<span style="color:${color || 'var(--text-secondary)'};">${html}</span>`;
      };
      if (bridge && typeof bridge.bleHoldStart === 'function') {
        try {
          const interval = (edit.intervalMs >= 50) ? edit.intervalMs : 150;
          const res = JSON.parse(bridge.bleHoldStart(edit.address, svc, chr, data, interval) || "{}");
          if (!(res && res.ok)) {
            setStat("启动失败：" + ((res && res.error) || "未知"), "#dc2626");
            showToast("试振启动失败");
            return;
          }
          showToast("试振中…请感受 " + devName);
          setStat("已发起连接，等待设备就绪…");
          let started = false, finished = false, ticks = 0;
          const finish = (msg, color) => {
            if (finished) return;
            finished = true;
            clearInterval(timer);
            try { bridge.bleHoldStop(); } catch(e) {}
            setStat(msg, color);
            if (color === "#dc2626") showToast(msg.replace(/<[^>]*>/g, ""));
          };
          const timer = setInterval(() => {
            ticks++;
            let st = null, lr = null;
            try { st = JSON.parse(bridge.bleHoldState() || "{}"); } catch(e) {}
            try { lr = JSON.parse(bridge.bleHoldGetLastResult() || "{}"); } catch(e) {}
            if (lr && lr.ok === false) {
              finish("连接/写入出错：" + (lr.error || "未知"), "#dc2626");
              return;
            }
            const isReady = st && st.connected && lr && lr.ok &&
              (lr.event === "ready" || lr.event === "connected" || lr.event === "writing" || lr.writing);
            if (!started && isReady) {
              started = true;
              setStat("✓ 已连接并持续写帧中（保活 " + interval + "ms）…再保持 1.6 秒");
              setTimeout(() => finish("试振结束：连接与写帧均正常。若没震感，请确认玩具未连其它设备并重启后再试", "#16a34a"), 1600);
            } else if (!started && ticks >= 24) {
              // ~6s 未就绪
              let detail = "";
              if (lr && lr.error) detail = "；最近错误：" + lr.error;
              finish("6 秒内未完成连接" + detail + "。请确认：玩具已开机广播、未被电脑/官方App占用，然后重试", "#dc2626");
            } else if (!started) {
              const phase = (lr && lr.event) ? ("（" + lr.event + "）") : "";
              setStat("连接中…" + phase + " 已等待 " + Math.round(ticks * 0.25) + "s");
            }
          }, 250);
          return;
        } catch(e) {
          showToast("试振异常：" + (e.message || e));
          try { bridge.bleHoldStop(); } catch(e2) {}
          return;
        }
      }
      if (bridge && typeof bridge.bluetoothBleWrite === 'function') {
        bridge.bluetoothBleWrite(edit.address, svc, chr, data);
        showToast("已单次发送（旧版，约1-2s）");
        return;
      }
      showToast("当前环境不支持蓝牙");
    },

    /** 生成该设备可直接粘贴给 AI/写入角色卡的提示词文本 */
    buildBtPromptText: function(address) {
      const dev = this.findAnyDevice(address);
      if (!dev) return "";
      const profile = this.getDeviceProfile(address) || {};
      const caps = this.getDeviceCapabilities(dev).filter(c => c.id !== "send");
      if (!caps.length) return "";
      const name = dev.name || dev.address;
      const isHold = profile.type === "ble" && !!profile.hold;
      const capLine = caps.map(c => c.label + "(" + c.id + ")").join(" / ");
      let out = "";
      out += "【已接入的蓝牙设备 · AI 可控】" + name + "（" + dev.address + "）" + (profile.type === "ble" ? " [BLE 特征值控制]" : profile.type === "spp" ? " [串口控制]" : profile.type === "media" ? " [媒体控制]" : "") + "\n";
      out += "该设备对 AI 开放的能力：" + capLine + "\n";
      out += "需要控制时，请在你的回复文本最末尾单独追加一行（JSON 必须完全合法）：\n";
      caps.forEach(c => {
        const stopLike = c.id === "stop" || c.id === "off";
        if (stopLike) out += `[BLUETOOTH_CMD]{"action":"control","device":"${name}","command":"${c.id}"}\n`;
        else out += `[BLUETOOTH_CMD]{"action":"control","device":"${name}","command":"${c.id}","value":80}\n`;
      });
      if (isHold) {
        out += "注意：该设备为【保活持续型】——你发出一次强度指令后设备会保持当前强度持续运行，直到你再次调整强度，或发送 " +
          (caps.some(c => c.id === "stop") ? "stop（或强度 value:0）" : "value:0 的强度指令") + " 才会停止；请根据剧情需要掌控节奏，结束后务必停止。\n";
      }
      out += "只允许使用上面列出的 command id，严禁编造能力列表以外的命令。\n";
      return out;
    },

    /** 一键复制该设备的 AI 提示词 */
    copyBtPrompt: function(address) {
      const text = this.buildBtPromptText(address);
      if (!text) { showToast("请先保存该设备的能力配置"); return; }
      const done = () => showToast("提示词已复制，可粘贴到角色卡/帮助文档");
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(() => this._fallbackCopy(text, done));
        } else {
          this._fallbackCopy(text, done);
        }
      } catch(e) { this._fallbackCopy(text, done); }
    },

    _fallbackCopy: function(text, done) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch(e) {}
      if (done) done();
    },

    // ---- 蓝牙设备适配教程（内置提示词：可复制给 AI 或自己照做，用于适配任意 BLE 玩具/智能硬件）----

    buildBtAdaptGuide: function() {
      const L = [];
      L.push("【任务：为我的蓝牙设备做协议逆向并接入叙事诗小手机】");
      L.push("");
      L.push("你是一名蓝牙（BLE）协议逆向与集成工程师。请按下面的固定流程，帮我把目标设备适配进「叙事诗小手机」App 的 MCP 中枢，让它能被 AI 角色用 [BLUETOOTH_CMD] 指令像放歌一样控制。");
      L.push("");
      L.push("一、先收集信息（缺什么就问，不要瞎猜）");
      L.push("1. 设备蓝牙广播名、MAC 地址、品牌型号、官方 App 名称；");
      L.push("2. 官方 App 能否正常控制它（能控说明协议可用，只是我们不知道帧格式）；");
      L.push("3. 设备功能（震动/吮吸/加热/伸缩/多马达），是否有档位与花样模式。");
      L.push("");
      L.push("二、抓包 / 枚举（任选其一或组合）");
      L.push("A. 小手机内自带工具（推荐先做）：MCP中枢→蓝牙→“扫描周围 BLE 设备”→ 找到设备 →“能力配置”→“发现服务”，会列出该设备全部 GATT 服务/特征与属性，重点记下带 write 的特征。");
      L.push("B. 电脑端 bleak 脚本（Windows 有蓝牙即可）：扫描 scan.py → 枚举 gatt.py → 单发 oneshot.py / 持续 run_seg.py / 参考驱动器 bt_toy_driver.py。");
      L.push("C. 官方 App 抓包（拿真实控制帧最稳）：安卓开发者选项开启“蓝牙 HCI 收集日志”→ 用官方 App 操作设备（每档/每种模式各点一遍）→ 导出 btsnoop_hci.log → 电脑 Wireshark 过滤 btatt，看 Write Command/Write Request 的 value（注意：联发科机型日志可能加密，换高通机型或用 nRF Connect 实时观察）。");
      L.push("D. 官方 App 若为 H5/uni-app 壳：解包 APK，在前端 JS 里搜 ServiceConfigs / writeBLECharacteristicValue / 组包函数，可直接拿到 UUID 与帧格式（我们就是这样确认 ANKNI MR-Z 的）。");
      L.push("");
      L.push("三、判定帧结构（关键四点）");
      L.push("1. 帧头/帧尾与长度字节；2. 强度/档位字节的位置与量程（0-100 还是 0-255）；3. 校验方式（常见：全部字节和取低8位 / 异或 / CRC16-XModem）；4. 是否需要开机握手包、是否需要周期续帧（keepalive）。");
      L.push("验证方法：先用本 App“能力配置→试振”逐条试；单发一帧后如果只动 1~2 秒就停，说明是“保活型”，必须勾选保活并按 100~200ms 周期续帧。");
      L.push("");
      L.push("四、写入小手机（能力配置参数）");
      L.push("- 设备类型：BLE；Service UUID / Characteristic UUID 填“发现服务”里带 write 的那一对；");
      L.push("- 命令模板占位符：{value} 十进制、{value:byte}/{value:hex} 两位十六进制、{on}=1、{off}=0、{csum}=对前序全部字节累加取低8位（hex）；");
      L.push("- 保活型设备：勾选“保活持续模式”，间隔 150ms；命令建议 vibrate(0-100) 与 stop；");
      L.push("- 保存后：开“注入提示词”→ 点“复制AI提示词”→ 粘进角色卡；之后 AI 输出 [BLUETOOTH_CMD]{action:control,device:设备名,command:vibrate,value:80} 即可持续控制。");
      L.push("");
      L.push("五、已实测范本（可直接照抄结构）");
      L.push("设备：ANKNI MR-Z（谜姬/安可尼，官方 App「醉清风」）");
      L.push("广播名 ANKNI MR-Z；Service 0000DDDD-0000-1000-8000-00805F9B34FB；写特征 0000DDD1-0000-1000-8000-00805F9B34FB；");
      L.push("帧：AA 08 01 <强度 0-100 的 hex> <校验和>，校验和=前面所有字节之和取低8位；");
      L.push("强度 50 → AA080132E5；停止 → AA080100B3；模板 AA0801{value:hex}{csum}；");
      L.push("特性：单帧只维持约 1~2 秒 → 必须保活续帧（150ms）；设备拒绝系统配对（免配对外设），不要用系统蓝牙“配对”，直接用 BLE 直连。");
      L.push("");
      L.push("六、注意事项（踩坑清单）");
      L.push("1. BLE 玩具通常只允许一个主机连接：抓包/测试时确保官方 App 或另一台设备没连着它；");
      L.push("2. 系统里提示“该设备不允许被配对”是正常的（免配对外设），不影响 App 直连控制；");
      L.push("3. Android 12+ 需要“附近设备”权限；被拒绝后可在 App 内引导重新授权或跳系统设置开启；");
      L.push("4. 若写入无反应：确认写的是 write 特征、写入类型用 write-with-response、数据帧含正确校验和；");
      L.push("5. 若连接成功但无动作：先怀疑“需要握手/保活”，再怀疑强度字节位置或量程；");
      L.push("6. 不要用别人的帧直接套自己的设备：同品牌不同型号的帧头/校验都可能不同，必须实测确认。");
      L.push("");
      L.push("七、请输出给我的结果（照此格式）");
      L.push("1) 设备档案：广播名 / MAC / 服务 / 写特征 / 读特征 / 通知特征；");
      L.push("2) 协议表：帧结构、字段含义、校验算法、是否需握手/保活；");
      L.push("3) 命令集：命令名 + 模板（如 AA0801{value:hex}{csum}）+ 取值说明；");
      L.push("4) 小手机配置参数：Service / Characteristic / 是否勾选保活 / 间隔 ms；");
      L.push("5) 风险与兼容性提示（尤其是同品牌其它型号可能不通用）。");
      return L.join("\n");
    },

    /** 在蓝牙面板的教程折叠区渲染教程文本 */
    renderBtGuide: function() {
      const el = document.getElementById("mcp-bt-guide");
      if (!el) return;
      if (!el.innerText || el.innerText.length < 20) el.innerText = this.buildBtAdaptGuide();
    },

    /** 一键复制完整蓝牙适配教程提示词 */
    copyBtAdaptGuide: function() {
      const text = this.buildBtAdaptGuide();
      this._fallbackCopy(text, () => showToast("适配教程提示词已复制，可直接发给 AI 或照做适配其它蓝牙设备"));
    },

    /** 蓝牙权限引导：状态缺失→再次申请；被永久拒绝→跳系统设置手动开 */
    ensureBtPermissionGranted: function() {
      const bridge = window.AndroidMCP;
      if (!bridge || typeof bridge.getBluetoothPermissionState !== 'function') return false;
      let st = null;
      try { st = JSON.parse(bridge.getBluetoothPermissionState() || "{}"); } catch(e) { return false; }
      if (!st.ok) return false;
      const need = (st.sdkInt >= 31 && (!st.connect || !st.scan)) || !!st.needLocation;
      if (need) {
        try { if (bridge.requestBluetoothPermissions) bridge.requestBluetoothPermissions(); } catch(e) {}
        showToast("请在系统弹窗中允许「附近设备/蓝牙」权限后，再点一次刷新");
        setTimeout(() => {
          try {
            const st2 = JSON.parse(bridge.getBluetoothPermissionState() || "{}");
            if (st2.permanentlyDeniedConnect || st2.permanentlyDeniedScan || st2.needLocation) {
              showToast("系统已不再自动弹窗：打开权限设置页，请手动开启「附近设备/定位」");
              setTimeout(() => {
                try { if (bridge.openAppBluetoothPermissionSettings) bridge.openAppBluetoothPermissionSettings(); } catch(e) {}
              }, 1500);
            }
          } catch(e) {}
        }, 1800);
        return true;
      }
      if (!st.btOn) showToast("请先在系统快捷开关中开启蓝牙");
      return false;
    },
    /**
     * AI [BLUETOOTH_CMD] 指令解析分发（由 app_chat.js 在解析 AI 回复时调用）。
     * 支持的 action：
     * - control     语义控制 {"device":"名称或地址","command":"命令id","value":数值}（按设备能力档案翻译执行，媒体设备走系统通道）
     * - info        读取当前设备列表（返回给 AI）
     * - send        经典蓝牙 SPP 发送 {"device":"名称或地址","data":"..."}
     * - disconnect  断开串口
     * - toggle      开关系统蓝牙 {"on":true|false}
     * - scan        BLE 扫描
     * - ble_write   BLE 写特征值 {"device":"地址","service":"UUID","char":"UUID","data":"..."}
     */
    handleBluetoothCommand: function(jsonStr) {
      let opts = null;
      try { opts = JSON.parse(jsonStr); } catch(e) {
        console.warn("BLUETOOTH_CMD JSON 解析失败:", e);
        return false;
      }
      const action = (opts.action || "info").toLowerCase();
      if (action === "control") {
        // 语义控制：char 像放歌一样随时输出控制指令，由设备能力档案翻译执行
        return this.executeDeviceControl(opts.device || "", opts.command || "", opts.value);
      }
      if (action === "info") {
        this.loadBluetoothDevices();
        if (window.desktopPetSystem && typeof window.desktopPetSystem.popBubble === 'function') {
          const names = this.bluetoothDevices.map(d => d.name).join("、") || "无设备";
          window.desktopPetSystem.popBubble(`已连接蓝牙：${names}`);
        }
        return true;
      }
      if (action === "send") {
        const device = opts.device || "";
        const data = opts.data || "";
        if (!device || !data) return false;
        // 支持按名称或地址匹配
        let target = device;
        const found = this.findAnyDevice(device);
        if (found) target = found.address;
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothSendSpp === 'function') {
          const ok = window.AndroidMCP.bluetoothSendSpp(target, data);
          if (ok) showToast(`AI 已控制蓝牙设备发送：${data}`);
          return ok;
        }
        return false;
      }
      if (action === "disconnect") {
        this.disconnectSpp();
        return true;
      }
      if (action === "toggle") {
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothSetEnabled === 'function') {
          const raw = window.AndroidMCP.bluetoothSetEnabled(!!opts.on);
          try {
            const res = JSON.parse(raw);
            if (!res.ok && res.error) showToast(res.error);
          } catch(e) {}
          return true;
        }
        return false;
      }
      if (action === "scan") {
        this.scanBle();
        return true;
      }
      if (action === "ble_write") {
        if (window.AndroidMCP && typeof window.AndroidMCP.bluetoothBleWrite === 'function') {
          const device = opts.device || "";
          const service = opts.service || "";
          const char = opts.char || "";
          const data = opts.data || "";
          if (!device || !service || !char || !data) return false;
          window.AndroidMCP.bluetoothBleWrite(device, service, char, data);
          setTimeout(() => {
            try {
              const raw = window.AndroidMCP.bluetoothGetBleWriteResult();
              const res = JSON.parse(raw);
              if (res && res.ok) showToast("AI BLE 写入成功");
            } catch(e) {}
          }, 6000);
          return true;
        }
        return false;
      }
      return false;
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
      
      // 关键修复：把开关状态同步写入 db.desktop_pets 表（当前编辑角色），
      // 因为实际发信调度（triggerBackgroundActiveMessageNative / 前台 setInterval）
      // 扫描的是 db.desktop_pets 中 activeMsgEnabled === true 的角色。
      // 之前只写 localStorage，导致开关开启后角色根本没被纳入发信调度。
      const charId = (window.desktopPetSystem && window.desktopPetSystem.editingCharId)
        ? window.desktopPetSystem.editingCharId
        : null;
      const interval = parseInt(document.getElementById("mcp-active-msg-interval").value) || 10;
      
      const persistToDb = async () => {
        if (!charId || typeof db === 'undefined' || !db.desktop_pets) return;
        try {
          let pet = await db.desktop_pets.get(charId);
          if (!pet) {
            pet = { charId: charId, mode: 'custom', statesConfig: {}, customDialogues: {}, petEnabled: false, petSize: 100, activeMsgEnabled: false, activeMsgInterval: 10 };
          }
          pet.activeMsgEnabled = isEnabled;
          pet.activeMsgInterval = interval;
          await db.desktop_pets.put(pet);
          // 同步热内存配置
          if (window.desktopPetSystem && window.desktopPetSystem.editingPetConfig) {
            window.desktopPetSystem.editingPetConfig.activeMsgEnabled = isEnabled;
            window.desktopPetSystem.editingPetConfig.activeMsgInterval = interval;
          }
          if (window.desktopPetSystem && window.desktopPetSystem.activePetCharId === charId && window.desktopPetSystem.activePetConfig) {
            window.desktopPetSystem.activePetConfig.activeMsgEnabled = isEnabled;
            window.desktopPetSystem.activePetConfig.activeMsgInterval = interval;
          }
        } catch(e) {
          console.error("同步主动发信开关到 db.desktop_pets 失败:", e);
        }
      };
      
      if (isEnabled) {
        // 开启时：从 IndexedDB 读取当前选中的 API preset，注册到 Kotlin 层
        (async () => {
          try {
            // 读取全局 API preset 设置（与 app_chat.js 中发信时读取相同的配置）
            // 走「专用 → 全局」路由（聊天功能位），保证后台主动发信用的是同一套配置
            let apiConfig = (window.apiRoutes && typeof window.apiRoutes.resolve === "function")
              ? await window.apiRoutes.resolve("chat") : null;
            const currentApiId = parseInt(localStorage.getItem("global_api_preset_id") || "0");
            
            if (!apiConfig && currentApiId > 0 && typeof db !== 'undefined' && db.api_presets) {
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
      
      // 无论开关状态，都同步到 db.desktop_pets
      persistToDb();
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

  // ==========================================
  //  后台中枢初始化（由 Kotlin McpForegroundService 的 Headless WebView
  //  在页面加载完成后通过 evaluateJavascript 注入调用）
  //  作用：恢复退出前的会话与闹钟状态，使主动发信/闹钟/桌宠
  //  在 Activity 销毁后（常驻保活通知挂载期间）继续运行。
  // ==========================================
  window.initBackgroundCenter = function() {
    try {
      // 1. 恢复当前会话 ID（app_chat.js 在 openWeChatDialog 时持久化）
      const savedSess = localStorage.getItem("mcp_active_session_id");
      if (savedSess && typeof activeSessionId !== 'undefined' && !activeSessionId) {
        const id = parseInt(savedSess);
        if (!isNaN(id)) activeSessionId = id;
      }

      // 2. 恢复活动闹钟状态（headless 无可见 UI，仅保持状态与到点清理）
      const alarmRaw = localStorage.getItem("mcp_active_alarm_state");
      if (alarmRaw) {
        try {
          const st = JSON.parse(alarmRaw);
          if (st && st.triggerTime && st.triggerTime > Date.now()) {
            mcpSystem.activeAlarm = {
              triggerTime: st.triggerTime,
              title: st.title || "",
              ringtone: st.ringtone || "default",
              setByAI: true
            };
            mcpSystem._startAlarmCountdown();
          } else {
            localStorage.removeItem("mcp_active_alarm_state");
          }
        } catch(e) { localStorage.removeItem("mcp_active_alarm_state"); }
      }

      // 3. 标记中枢环境（供 JS 内部分支判断）
      window.__isBackgroundCenter = true;
      console.log("[BgCenter] 后台中枢初始化完成, activeSessionId =", activeSessionId);
    } catch(e) {
      console.error("[BgCenter] 初始化失败:", e);
    }
  };
})();
