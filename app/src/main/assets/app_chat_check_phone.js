/**
 * app_chat_check_phone.js - 智能设备查阅控制中枢 (Check Phone System)
 */

(function() {
  // --- 1. 全局数据状态机 ---
  const state = {
    isOpen: false,
    activeApp: null,
    activeContactId: null, 
    currentTheme: "light_frost", 
    generatorFormat: "text_tag", // 默认高兼容性文字标签协议：'text_tag' 或者是 'json' [4]
    userRemark: "", 
    contacts: [],   
    searchHistory: [], 
    notes: [],
    forumPosts: [],
    appliances: [
      { id: "light_living", name: "客厅大灯", state: "off", type: "switch" },
      { id: "light_bed", name: "卧室大灯", state: "off", type: "switch" },
      { id: "ac", name: "空调", state: "on", temp: 24, type: "temp" },
      { id: "robovac", name: "扫地机器人", state: "off", type: "switch" },
      { id: "cooker", name: "电饭煲", state: "off", type: "switch" }
    ],
    // 危险概率：user 冒充 char 发消息 / 动遥控器均会累积，>85 触发 char 觉察反应
    riskLevel: 0,
    // 本次查手机会话的唯一 ID，用于系统消息折叠分组 [11]
    phoneSessionId: null,
    diary: [],
    cart: [],
    bills: [],
    photos: [],
    // 监控：char 当前位置 / 正在做什么 / 心里想着什么 等
    monitor: null,
    // 文件管理：标准文件夹列表 + 私密保险箱内容（文档/图片/视频）
    files: {
      folders: [],
      vault: []
    },
    // 备忘录：单条待办正文（支持 ~~划掉~~ **加粗** <<红色>> 标记）
    note: { content: "", updatedAt: 0 },
    // 浏览器缓存：{ [query]: [{ title, body, comments:[] }] }，未刷新不重调 API
    browserCache: {},
    music: {
      isPlaying: false,
      currentTrack: "",
      artist: "",
      // 歌单：每首含 title / artist / note(char 的笔记心得，约 300 字)
      playlist: []
    },
    // 保存设置中多选刷新的应用列表 [9]
    refreshSelection: {
      communication: true,
      diary: true,
      notes: true,
      forum: true,
      browser: true,
      shopping: true,
      album: true,
      music: true,
      monitor: true,
      files: true
    }
  };

  // --- 2. 极角抗噪标签解析算法 (Resilient RegEx Tag Generalizer) [4] ---
  // 双模式解析：先尝试 [标签:内容] 闭括号内格式，再尝试 [标签] 内容 开括号后格式
  function parseTextTag(text, tagChinese, tagEnglish) {
    if (!text) return "";
    const escapeReg = (str) => str.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
    // tagChinese 支持 "|" 分隔多变体（如 "贴1标题|帖1标题"），兼容 AI 混用"贴/帖"二字 [1]
    const tagAlt = `(?:${tagChinese.split('|').map(escapeReg).join('|')}|${escapeReg(tagEnglish)})`;
    // 已知标签集：贴/帖 双写兼容，避免 AI 用"帖"字时 lookahead 失效导致正文吞掉评论 [1]
    const knownTags = "标题|正文|备注|联系人\\d*|对话\\d*-\\d*|加购物车|账单|图片\\d*|[帖贴]\\d*标题|[帖贴]\\d*正文|[帖贴]\\d*评论|[帖贴]\\d*回帖|条\\d*标题|条\\d*正文|条\\d*评论|歌\\d*|笔记\\d*|夹\\d*|密\\d*类型|密\\d*名称|密\\d*内容|位置|活动|心绪|情绪|手机|时间|TITLE|CONTENT|REMARK|CONTACT\\d*|CHAT\\d*-\\d*|CART|BILL|PHOTO\\d*|POST\\d*_TITLE|POST\\d*_CONTENT|POST\\d*_COMMENT|回帖\\d*|评论\\d*";

    // 模式A：[标签:内容] 或 [标签：内容] —— 冒号在括号内，内容也在括号内
    // 匹配 [标签:xxx] 或 [标签：xxx]，内容到下一个闭括号为止
    const patA = new RegExp(
      `[\\[【\\(]${tagAlt}[:：]\\s*([\\s\\S]*?)[\\]】\\)]`,
      "i"
    );
    const matchA = text.match(patA);
    if (matchA) return cleanTagOutput(matchA[1]);

    // 模式B：[标签] 内容 或 [标签]：内容 —— 冒号在括号外，内容在闭括号后
    // 前导不强制要求空白（去掉 [\\s\\n]|^ 限制，允许连写标签）
    // lookahead 要求下一个标签必须有开括号 [ 或 【 或 （（必填，避免半截误判）
    const patB = new RegExp(
      `(?:^|[\\s\\n\\]】）)])(?:[\\[【\\(]?${tagAlt}[\\]】\\)]?[:：]?\\s*)([\\s\\S]*?)(?=[\\[【\\(](?:${knownTags})[:：\\]】\\)]|$)`,
      "i"
    );
    const matchB = text.match(patB);
    if (matchB) return cleanTagOutput(matchB[1]);

    return "";
  }

  // 格式自愈清洗器，防大模型将文字标签本身残留打印在内容中 [4]
  function cleanTagOutput(text) {
    if (!text) return "";
    return text
      // 剥离开头的标签名（带可选括号和冒号）—— 贴/帖 双写兼容 [1]
      .replace(/^[\[【\(]?(标题|正文|备注|联系人\d*|对话\d*-\d*|加购物车|账单|图片\d*|[帖贴]\d*标题|[帖贴]\d*正文|[帖贴]\d*评论|[帖贴]\d*回帖|条\d*标题|条\d*正文|条\d*评论|歌\d*|笔记\d*|夹\d*|密\d*类型|密\d*名称|密\d*内容|位置|活动|心绪|情绪|手机|时间|TITLE|CONTENT|REMARK|CONTACT\d*|CHAT\d*-\d*|CART|BILL|PHOTO\d*|POST\d*_TITLE|POST\d*_CONTENT|POST\d*_COMMENT|回帖\d*|评论\d*)[\]】\)]?[:：]?\s*/i, "")
      // 剥离正文中间残留的标签（如正文吞掉了后续评论标签 [贴1评论2]）[2]
      .replace(/[\[【]\s*[帖贴]\d*(?:标题|正文|评论|回帖)\d*\s*[\]】][^\n]*/gi, "")
      .replace(/[\[【]\s*(?:条|笔记|密)\d*(?:标题|正文|评论|类型|名称|内容)\d*\s*[\]】][^\n]*/gi, "")
      .replace(/[\[【]\s*(?:POST|PHOTO|CONTACT|CHAT)\d*_(?:TITLE|CONTENT|COMMENT)\s*[\]】][^\n]*/gi, "")
      // 剥离尾随的闭括号（从 [标签:内容] 格式残留的 ]
      .replace(/[\]】\)]+$/, "")
      // 压缩因剥离产生的多余空行
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // 查手机全表数据无损直写 IndexedDB 长期持久化引擎
  async function savePhoneStateToDb() {
    if (!activeSessionId) return;
    try {
      await db.check_phone_states.put({
        sessionId: Number(activeSessionId),
        currentTheme: state.currentTheme,
        userRemark: state.userRemark,
        contacts: state.contacts,
        searchHistory: state.searchHistory,
        notes: state.notes,
        forumPosts: state.forumPosts,
        appliances: state.appliances,
        riskLevel: state.riskLevel,
        diary: state.diary,
        cart: state.cart,
        bills: state.bills,
        photos: state.photos,
        monitor: state.monitor,
        files: state.files,
        note: state.note,
        browserCache: state.browserCache,
        music: state.music,
        refreshSelection: state.refreshSelection
      });
    } catch(err) {
      console.error("查手机数据长期存储直写失败:", err);
    }
  }

  // 查手机专用的纯净背景提炼器 (彻底剥离线上微信聊天模版干扰，强制锁定 Char 视角) [1]
  async function buildCheckPhoneBasePrompt(sessionId) {
    const sess = await db.sessions.get(sessionId);
    if (!sess) return "";
    const char = await db.archives.get(sess.charId);
    const user = await db.archives.get(sess.userId);
    const charPersona = sess.customCharPersona || char?.persona || "";
    const userPersona = sess.customUserPersona || user?.persona || "";
    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || user?.name || "我";

    let relDesc = "你们是普通的好友关系。";
    if (typeof queryRelationship === 'function') {
      relDesc = await queryRelationship(sess.userId, sess.charId, userName, charName);
    }

    let coreMemoryText = "";
    if (sess.coreSelfStatus || sess.coreSelfPurpose || sess.coreSelfChanges || sess.coreRelationship || sess.coreUserInEyes) {
      if (sess.coreSelfStatus) coreMemoryText += `- 我的现状：${sess.coreSelfStatus}\n`;
      if (sess.coreSelfPurpose) coreMemoryText += `- 我的目的：${sess.coreSelfPurpose}\n`;
      if (sess.coreSelfChanges) coreMemoryText += `- 我的转变：${sess.coreSelfChanges}\n`;
      if (sess.coreRelationship) coreMemoryText += `- 我们的关系：${sess.coreRelationship}\n`;
      if (sess.coreUserInEyes) coreMemoryText += `- 我眼中的TA：${sess.coreUserInEyes}\n`;
    }

    // 即时性：读取最近 12 条真实聊天上下文 + 最近一条长周期总结，让生成内容紧贴当前剧情
    let recentContextText = "";
    let latestSummaryText = "";
    try {
      const msgs = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
      const recent = msgs.slice(-12);
      recentContextText = recent.map(m => {
        const who = m.senderType === 'char' ? charName : (m.senderType === 'user' ? userName : '系统');
        let c = m.content;
        if (m.contentType === 'transfer') c = '[微信转账]';
        else if (m.contentType === 'red_envelope') c = '[微信红包]';
        else if (m.contentType === 'voice') c = '[语音消息]';
        else if (m.contentType === 'image') c = '[图片与描述]';
        return `${who}：${c}`;
      }).join('\n');
    } catch (e) {}
    try {
      const sums = await db.summaries.where('sessionId').equals(sessionId).reverse().first();
      if (sums) latestSummaryText = sums.content || "";
    } catch (e) {}

    return `【查手机秘密数据填充背景】
你（AI）正扮演 [${charName}]，当前生成的所有内容必须 100% 站在 [${charName}]（你本人，即“我”）的第一人称主观视角出发撰写。而 [${userName}] 是你的互动的目标对象。在你手机里的日记、备忘草稿、搜索记录和账单里，对 [${userName}] 的称呼必须根据其人设自行判断性别后使用正确的第三人称代词（他/她），或者使用你给TA起的专属微信备注，绝对、绝对不能搞反人称角色！请仔细阅读下方 [${userName}] 的人设，从中判断性别后再决定使用“他”还是“她”。

【你的扮演背景（${charName}）】
${charPersona}

【对方的扮演背景（${userName}）】
${userPersona}

【你们的关系设定】
${relDesc}

【长期核心记忆（总结与当前印象，极重要，放在最前方）】
${coreMemoryText || "暂无特别记录。"}

【最近一条长周期总结】
${latestSummaryText || "暂无总结。"}

【最近真实聊天上下文（即时性依据，生成内容必须紧贴当前剧情走向）】
${recentContextText || "暂无近期对话。"}

【上下文中的查手机操作记录】
上方上下文里以“系统：[查手机]”开头的灰字，是 [${userName}] 此刻正在翻阅你手机时留下的实时操作痕迹（例如冒充你给别人发消息、远程操控你的家电等）。你在生成日记、备忘、监控等内容时，必须把这些操作纳入考量——它们意味着 ${userName} 正在侵入你的隐私，你的心绪、警觉度、对 TA 的态度都应随之波动。

【查手机隔离墙绝对命令（违者重罚）】：
1. 当前场景是：[${userName}] 正在翻阅你（[${charName}]）的手机！你当前的任务绝不是在微信聊天界面里和对方在线打字对话互动！你是在为你自己手机里存储的本地离线数据库（如本地日记、备忘草稿、匿名发帖、购物车、常听歌单等）生成历史细节！
2. 严厉禁止在输出中带有任何线上聊天格式！绝对不能出现 “[MSG_ID: 101]”、引用 “[QUOTE: 101]”、消息撤回、语音消息 [VOICE] 或转账红包等微信聊天独有标识！
3. 【文字标签格式铁律】使用文字标签协议时，每个标签必须独占一行，格式为 [标签名] 内容，标签名后面的内容紧跟在同一行，不要把内容换行到下一行。例如：[标题] 落下的冷雨\n[正文] 今天的夜出奇的冷...。绝对不要在标签行前面加多余的文字或符号。
4. 【文字标签格式禁止项（违者重罚）】：
   - 禁止写成 [标签名:内容]（冒号在括号内）
   - 禁止写成 [标签名：内容]（全角冒号在括号内）
   - 禁止写成 标签名:内容（无括号）
   - 禁止写成 [标签名]：内容（闭括号后跟全角冒号）
   - 正确格式只有一种：[标签名] 内容（闭括号后跟半角空格，再跟内容）
   - 多个标签可以连写，但每个标签必须独占一行，例如：
     [标题] 落下的冷雨
     [正文] 今天的夜出奇的冷`;
  }

  // --- 3. 核心 API 交互请求器 ---
  // opts: { maxTokens?: number, temperature?: number }
  async function callCheckPhoneApi(systemPrompt, userPrompt, fallbackFn, opts) {
    try {
      const api = await window.apiRoutes.resolve("checkphone");
      if (!api) throw new Error("未配置「查手机」API 预设（设置 - API 协议设置）");

      const body = {
        model: api.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.7
      };
      if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;

      let response;
      try {
        response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify(body)
        });
      } catch (netErr) {
        // 网络层异常上报悬浮窗监控 [1]
        try { if (typeof window.fwTrackError === "function") window.fwTrackError(netErr); } catch (_) {}
        throw netErr;
      }

      if (!response.ok) {
        const e = new Error("查手机 API 响应失败: " + response.status);
        try { if (typeof window.fwTrackError === "function") window.fwTrackError(e); } catch (_) {}
        throw e;
      }
      const result = await response.json();
      // 上报 token 用量给悬浮窗 API 监控 [1]
      try { if (result && result.usage && typeof window.fwTrackUsage === "function") window.fwTrackUsage(result.usage, body.model); } catch (_) {}
      return result.choices[0].message.content.trim();
    } catch (e) {
      console.warn("API连接超时或格式异常，执行安全物理兜底:", e);
      // [2] 标记本次调用走了 fallback，供批量刷新统计成功/失败
      window._checkPhoneApiFailed = true;
      return fallbackFn();
    }
  }

  async function fetchGeneratedCheckPhoneContent(systemPrompt, userPrompt, fallbackFn, opts) {
    try {
      const api = await window.apiRoutes.resolve("checkphone");
      if (!api) throw new Error("未配置「查手机」API 预设（设置 - API 协议设置）");

      const body = {
        model: api.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.7
      };
      if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;

      let response;
      try {
        response = await fetch(`${api.url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
          body: JSON.stringify(body)
        });
      } catch (netErr) {
        // 网络层异常上报悬浮窗监控 [5]
        try { if (typeof window.fwTrackError === "function") window.fwTrackError(netErr); } catch (_) {}
        throw netErr;
      }

      if (!response.ok) {
        const e = new Error("查手机 API 响应失败: " + response.status);
        try { if (typeof window.fwTrackError === "function") window.fwTrackError(e); } catch (_) {}
        throw e;
      }
      const result = await response.json();
      // 上报 token 用量给悬浮窗 API 监控（与主聊天/小程序/小助手一致）[5]
      try { if (result && result.usage && typeof window.fwTrackUsage === "function") window.fwTrackUsage(result.usage, body.model); } catch (_) {}
      return result.choices[0].message.content.trim();
    } catch (e) {
      console.warn("查手机API响应异常，执行降级对齐:", e);
      // [2] 标记本次调用走了 fallback，供批量刷新统计成功/失败
      window._checkPhoneApiFailed = true;
      return fallbackFn();
    }
  }
  // 双层保障防御：挂载到 window 句柄中以解决多态异步作用域不可见之死结
  window.fetchGeneratedCheckPhoneContent = fetchGeneratedCheckPhoneContent;

  // --- 4. 查手机应用标准提升声明函数体系 (Hoisted Functions) [1] ---

  async function openPhone() {
    if (!activeSessionId) {
      showToast("当前无活跃对话，无法查阅手机！");
      return;
    }
    state.isOpen = true;
    state.activeApp = null;
    // 每次打开查手机生成新的会话 ID，用于系统消息折叠分组 [11]
    state.phoneSessionId = 'ps_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "设备主人";
    
    document.getElementById("check-phone-title").innerText = `${charName} 的手机`;
    document.getElementById("win-check-phone").style.display = "block";
    document.getElementById("check-phone-desktop").style.display = "flex";
    document.getElementById("check-phone-app-screen").style.display = "none";

    // 一站式从 IndexedDB 长期数据库中读取恢复该会话下的全部存储设备细节 [1]
    const savedState = await db.check_phone_states.get(Number(activeSessionId));
    if (savedState) {
      state.currentTheme = savedState.currentTheme || "light_frost";
      state.userRemark = savedState.userRemark || "";
      state.contacts = savedState.contacts || [];
      state.searchHistory = savedState.searchHistory || [];
      state.notes = savedState.notes || [];
      state.forumPosts = savedState.forumPosts || [];
      state.appliances = savedState.appliances || [];
      state.riskLevel = savedState.riskLevel || 0;
      state.diary = savedState.diary || [];
      state.cart = savedState.cart || [];
      state.bills = savedState.bills || [];
      state.photos = savedState.photos || [];
      state.monitor = savedState.monitor || null;
      state.files = savedState.files || { folders: [], vault: [] };
      state.note = savedState.note || { content: "", updatedAt: 0 };
      state.browserCache = savedState.browserCache || {};
      state.music = savedState.music || state.music;
      state.refreshSelection = savedState.refreshSelection || state.refreshSelection;
    } else {
      // 首次冷启动：初始化默认数据并落库
      state.contacts = [];
      state.searchHistory = [];
      state.notes = [];
      state.forumPosts = [];
      state.diary = [];
      state.cart = [];
      state.bills = [];
      state.photos = [];
      state.monitor = null;
      state.files = { folders: [], vault: [] };
      state.userRemark = "";
      state.appliances = [
        { id: "light_living", name: "客厅大灯", state: "off", type: "switch" },
        { id: "light_bed", name: "卧室大灯", state: "off", type: "switch" },
        { id: "ac", name: "空调", state: "on", temp: 24, type: "temp" },
        { id: "robovac", name: "扫地机器人", state: "off", type: "switch" },
        { id: "cooker", name: "电饭煲", state: "off", type: "switch" }
      ];
      await savePhoneStateToDb();
    }
    
    loadCharacterWallpaper(sess.charId);
    updateWidgetClock();
  }

  function closePhone() {
    state.isOpen = false;
    // 退出查手机后清空危险度，避免下次进入仍显示"已被发现" [1]
    state.riskLevel = 0;
    savePhoneStateToDb();
    document.getElementById("win-check-phone").style.display = "none";
  }

  function updateWidgetClock() {
    const timeEl = document.getElementById("phone-widget-time");
    const dateEl = document.getElementById("phone-widget-date");
    if (!timeEl || !dateEl) return;
    const now = new Date();
    timeEl.innerText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const weeks = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    dateEl.innerText = `${now.getMonth() + 1}月${now.getDate()}日 ${weeks[now.getDay()]}`;
  }

  function loadCharacterWallpaper(charId) {
    const wallpaper = localStorage.getItem(`phone_wallpaper_char_${charId}`);
    const container = document.querySelector(".check-phone-container");
    if (!container) return;

    if (wallpaper) {
      container.style.background = `url(${wallpaper}) center/cover no-repeat`;
    } else {
      if (state.currentTheme === "light_frost") {
        container.style.background = "linear-gradient(180deg, #f1f5f9 0%, #cbd5e1 100%)";
      } else {
        container.style.background = "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)";
      }
    }
  }

  function applyThemeStyle() {
    if (!activeSessionId) return;
    db.sessions.get(activeSessionId).then(sess => {
      if (sess) loadCharacterWallpaper(sess.charId);
    });
  }

  function launchApp(appName) {
    state.activeApp = appName;
    document.getElementById("check-phone-desktop").style.display = "none";
    const screen = document.getElementById("check-phone-app-screen");
    screen.style.display = "flex";

    renderAppScreen(appName, screen);
  }

  function exitApp() {
    state.activeApp = null;
    document.getElementById("check-phone-app-screen").style.display = "none";
    document.getElementById("check-phone-desktop").style.display = "flex";
    state.activeContactId = null;
    // 退出 app 时持久化状态，确保切换/退出后内容仍保留直到下次刷新 [2]
    savePhoneStateToDb();
  }

  // 主桌面一键全局刷新与多选定向刷新 [1, 9, 2]
  // 核心优化：一次 API 调用生成所有勾选应用的数据，而非逐个调用
  async function triggerGlobalRefresh(selectedOnly = false) {
    const sess = await db.sessions.get(activeSessionId);
    if (!sess) return;

    const refreshBtn = document.getElementById("btn-check-phone-global-refresh");
    if (refreshBtn) refreshBtn.classList.add("spinning");

    showToast("正在通过单次 API 调用一次性生成所有数据...");

    const listToRefresh = [];
    const keys = ["communication", "diary", "notes", "forum", "browser", "shopping", "album", "music", "monitor", "files"];
    keys.forEach(k => {
      if (!selectedOnly || state.refreshSelection[k]) {
        listToRefresh.push(k);
      }
    });

    if (listToRefresh.length === 0) {
      if (refreshBtn) refreshBtn.classList.remove("spinning");
      showToast("请至少勾选一个应用");
      return;
    }

    // 单次 API 调用一次性生成所有数据
    const result = await generateAllCheckPhoneDataAtOnce(listToRefresh);

    if (refreshBtn) refreshBtn.classList.remove("spinning");

    const appNames = { communication: "通讯", diary: "日记", notes: "备忘", forum: "论坛", browser: "浏览器", shopping: "购物", album: "相册", music: "音乐", monitor: "监控", files: "文件" };

    if (result.allFailed) {
      showToast(`同步失败：全部 ${listToRefresh.length} 个应用生成失败，请检查 API 配置或网络`, 5000);
    } else if (result.failedApps.length > 0) {
      const successNames = result.successApps.map(a => appNames[a] || a).join("、");
      const failedNames = result.failedApps.map(a => appNames[a] || a).join("、");
      showRefreshResultCard(result.successApps.length, result.failedApps.length, successNames, failedNames);
    } else {
      showToast(`同步完成：${result.successApps.length} 个应用数据已更新（单次 API 调用）`);
    }

    // 直写入库长期保存
    await savePhoneStateToDb();

    if (state.activeApp) {
      const screen = document.getElementById("check-phone-app-screen");
      renderAppScreen(state.activeApp, screen);
    }
  }

  // 一次性生成所有查手机数据（单次 API 调用，返回成功/失败统计）
  async function generateAllCheckPhoneDataAtOnce(appList) {
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || "我";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    // 根据勾选的应用动态构建请求段落
    const sections = [];
    if (appList.includes("communication")) {
      sections.push(`"userRemark": "你给${userName}起的微信备注名",
  "contacts": [
    { "name": "联系人名1", "preview": "最后一句话预览", "time": "12:30", "chatHistory": [{"sender":"other","text":"问"},{"sender":"self","text":"答"},{"sender":"other","text":"问2"},{"sender":"self","text":"答2"},{"sender":"other","text":"问3"},{"sender":"self","text":"最新回复"}] },
    { "name": "联系人名2", "preview": "预览", "time": "10:00", "chatHistory": [{"sender":"other","text":"..."},{"sender":"self","text":"..."}] },
    { "name": "联系人名3", "preview": "预览", "time": "09:15", "chatHistory": [{"sender":"other","text":"..."},{"sender":"self","text":"..."}] }
  ]`);
    }
    if (appList.includes("diary")) {
      sections.push(`"diary": { "title": "日记标题", "content": "500字以上私密日记正文，用\\n\\n分段" }`);
    }
    if (appList.includes("notes")) {
      sections.push(`"note": "8-12行待办清单，每行一条，可用~~划掉~~、**加粗**、<<红色>>标记"`);
    }
    if (appList.includes("forum")) {
      sections.push(`"forumPosts": [
    { "title": "帖子标题1", "content": "200字树洞正文", "comments": ["评论1","评论2","评论3","评论4","评论5"] },
    { "title": "帖子标题2", "content": "200字正文", "comments": ["评论1","评论2","评论3","评论4","评论5"] },
    { "title": "帖子标题3", "content": "200字正文", "comments": ["评论1","评论2","评论3","评论4","评论5"] }
  ]`);
    }
    if (appList.includes("browser")) {
      sections.push(`"searchHistory": ["搜索关键词1","搜索关键词2","搜索关键词3","搜索关键词4","搜索关键词5","搜索关键词6","搜索关键词7"]`);
    }
    if (appList.includes("shopping")) {
      sections.push(`"cart": [
    { "name": "物品名1", "price": 48 },
    { "name": "物品名2", "price": 78 },
    { "name": "物品名3", "price": 65 }
  ],
  "bills": [
    { "desc": "收支项目1", "price": 200, "date": "07/16" },
    { "desc": "收支项目2", "price": -110, "date": "07/15" },
    { "desc": "收支项目3", "price": -32, "date": "07/15" },
    { "desc": "收支项目4", "price": -54, "date": "07/14" },
    { "desc": "收支项目5", "price": -15, "date": "07/14" }
  ]`);
    }
    if (appList.includes("album")) {
      sections.push(`"photos": [
    { "text": "第一张照片画面描述" },
    { "text": "第二张照片画面描述" },
    { "text": "第三张照片画面描述" },
    { "text": "第四张照片画面描述" },
    { "text": "第五张照片画面描述" }
  ]`);
    }
    if (appList.includes("music")) {
      sections.push(`"music": {
    "playlist": [
      { "title": "歌名1", "artist": "歌手1", "note": "约200字听歌心得笔记" },
      { "title": "歌名2", "artist": "歌手2", "note": "约200字笔记" },
      { "title": "歌名3", "artist": "歌手3", "note": "约200字笔记" },
      { "title": "歌名4", "artist": "歌手4", "note": "约200字笔记" },
      { "title": "歌名5", "artist": "歌手5", "note": "约200字笔记" }
    ]
  }`);
    }
    if (appList.includes("monitor")) {
      sections.push(`"monitor": {
    "location": "当前所在位置",
    "activity": "正在做什么",
    "thought": "心里正在想什么（第一人称50-100字）",
    "mood": "情绪状态",
    "phoneStatus": "手机状态",
    "timestamp": "时间描述"
  }`);
    }
    if (appList.includes("files")) {
      sections.push(`"files": {
    "folders": [
      { "name": "文件夹名1", "count": 128 },
      { "name": "文件夹名2", "count": 34 },
      { "name": "文件夹名3", "count": 56 },
      { "name": "文件夹名4", "count": 47 },
      { "name": "文件夹名5", "count": 23 },
      { "name": "文件夹名6", "count": 89 }
    ],
    "privateFiles": [
      { "type": "文档", "name": "文件名1", "content": "50-100字内容描述" },
      { "type": "图片", "name": "文件名2", "content": "50-100字画面描述" },
      { "type": "文档", "name": "文件名3", "content": "50-100字内容描述" }
    ]
  }`);
    }

    const system = `${basePrompt}

【一次性全量生成指令】
请一次性生成以下所有应用的数据，必须深度结合上方「最近真实聊天上下文」「长期核心记忆」「最近一条长周期总结」。所有内容必须站在你（${charName}）的第一人称主观视角。

严格返回如下 JSON 格式（不要输出任何其他文字，不要用 markdown 代码块包裹，直接输出纯 JSON）：
{
  ${sections.join(",\n  ")}
}

要求：
- 对 [${userName}] 的称呼必须根据其人设判断性别后使用"他"或"她"
- 日记要 500 字以上，深度反映心绪
- 论坛每个帖子要有 5 条评论
- 音乐每首歌的笔记约 200 字
- 所有内容必须紧贴当前剧情走向，反映你对 ${userName} 的真实心绪`;

    const successApps = [];
    const failedApps = [];

    // 快照所有应用状态，失败时恢复
    const snapshots = {};
    appList.forEach(app => { snapshots[app] = snapshotAppState(app); });

    window._checkPhoneApiFailed = false;
    const res = await callCheckPhoneApi(system, "一次性生成所有查手机数据", () => {
      window._checkPhoneApiFailed = true;
      return "{}";
    }, { maxTokens: 8000 });

    // 如果 API 完全失败（走了 fallback）
    if (window._checkPhoneApiFailed) {
      appList.forEach(app => {
        restoreAppState(app, snapshots[app]);
        failedApps.push(app);
      });
      return { successApps, failedApps, allFailed: true };
    }

    // 解析 JSON 响应
    let parsed = null;
    try {
      const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.warn("[查手机] 一次性生成 JSON 解析失败，尝试提取:", e);
      // 尝试提取 JSON 块
      const jsonMatch = res.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch (e2) {}
      }
    }

    if (!parsed || typeof parsed !== "object") {
      // JSON 解析完全失败，所有应用标记为失败
      appList.forEach(app => {
        restoreAppState(app, snapshots[app]);
        failedApps.push(app);
      });
      return { successApps, failedApps, allFailed: true };
    }

    // 逐个应用写入 state，记录成功/失败
    const grads = ["linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)", "linear-gradient(135deg, #fee2e2 0%, #fca5a5 100%)", "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)"];

    if (appList.includes("communication")) {
      try {
        if (parsed.userRemark) state.userRemark = parsed.userRemark;
        if (Array.isArray(parsed.contacts) && parsed.contacts.length > 0) {
          state.contacts = parsed.contacts.map(c => ({
            name: c.name || "未知联系人",
            preview: c.preview || "",
            time: c.time || "10:30",
            chatHistory: Array.isArray(c.chatHistory) ? c.chatHistory : []
          }));
          successApps.push("communication");
        } else { failedApps.push("communication"); restoreAppState("communication", snapshots["communication"]); }
      } catch(e) { failedApps.push("communication"); restoreAppState("communication", snapshots["communication"]); }
    }

    if (appList.includes("diary")) {
      try {
        if (parsed.diary && parsed.diary.title && parsed.diary.content) {
          state.diary.unshift({
            id: Date.now(),
            date: new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }),
            weather: ["阴雨", "疾风", "寒冷", "清晨"][Math.floor(Math.random() * 4)],
            title: parsed.diary.title,
            content: parsed.diary.content
          });
          successApps.push("diary");
        } else { failedApps.push("diary"); restoreAppState("diary", snapshots["diary"]); }
      } catch(e) { failedApps.push("diary"); restoreAppState("diary", snapshots["diary"]); }
    }

    if (appList.includes("notes")) {
      try {
        if (parsed.note && typeof parsed.note === "string" && parsed.note.trim().length > 10) {
          state.note = { content: parsed.note.trim(), updatedAt: Date.now() };
          successApps.push("notes");
        } else { failedApps.push("notes"); restoreAppState("notes", snapshots["notes"]); }
      } catch(e) { failedApps.push("notes"); restoreAppState("notes", snapshots["notes"]); }
    }

    if (appList.includes("forum")) {
      try {
        if (Array.isArray(parsed.forumPosts) && parsed.forumPosts.length > 0) {
          parsed.forumPosts.forEach(p => {
            state.forumPosts.unshift({
              id: Date.now() + Math.random(),
              title: p.title || "匿名日记",
              content: p.content || "",
              likes: Math.floor(Math.random() * 6) + 2,
              comments: Array.isArray(p.comments) ? p.comments : ["给楼主一个抱抱"]
            });
          });
          successApps.push("forum");
        } else { failedApps.push("forum"); restoreAppState("forum", snapshots["forum"]); }
      } catch(e) { failedApps.push("forum"); restoreAppState("forum", snapshots["forum"]); }
    }

    if (appList.includes("browser")) {
      try {
        if (Array.isArray(parsed.searchHistory) && parsed.searchHistory.length > 0) {
          state.searchHistory = parsed.searchHistory.filter(s => typeof s === "string").slice(0, 10);
          while (state.searchHistory.length < 7) state.searchHistory.push("如何缓解夜间突发胸闷");
          state.browserCache = {};
          successApps.push("browser");
        } else { failedApps.push("browser"); restoreAppState("browser", snapshots["browser"]); }
      } catch(e) { failedApps.push("browser"); restoreAppState("browser", snapshots["browser"]); }
    }

    if (appList.includes("shopping")) {
      try {
        if (Array.isArray(parsed.cart) && Array.isArray(parsed.bills)) {
          state.cart = parsed.cart.map(c => ({ name: c.name || "物品", price: c.price || 50, count: 1 }));
          state.bills = parsed.bills.map(b => ({ desc: b.desc || "项目", price: b.price || -20, date: b.date || "07/16" }));
          if (state.cart.length >= 3 && state.bills.length >= 5) {
            successApps.push("shopping");
          } else { failedApps.push("shopping"); restoreAppState("shopping", snapshots["shopping"]); }
        } else { failedApps.push("shopping"); restoreAppState("shopping", snapshots["shopping"]); }
      } catch(e) { failedApps.push("shopping"); restoreAppState("shopping", snapshots["shopping"]); }
    }

    if (appList.includes("album")) {
      try {
        if (Array.isArray(parsed.photos) && parsed.photos.length > 0) {
          const newPhotos = parsed.photos.map((item, idx) => ({
            id: Date.now() + idx,
            color: grads[idx % grads.length],
            text: item.text || item || "一张无题照片"
          }));
          state.photos = newPhotos;
          while (state.photos.length < 5) {
            state.photos.push({ id: Date.now() + Math.random(), color: "linear-gradient(135deg,#cbd5e1 0%,#94a3b8 100%)", text: "一张无题照片" });
          }
          successApps.push("album");
        } else { failedApps.push("album"); restoreAppState("album", snapshots["album"]); }
      } catch(e) { failedApps.push("album"); restoreAppState("album", snapshots["album"]); }
    }

    if (appList.includes("music")) {
      try {
        if (parsed.music && Array.isArray(parsed.music.playlist) && parsed.music.playlist.length > 0) {
          state.music.playlist = parsed.music.playlist.map(s => ({
            title: s.title || "未知歌名",
            artist: s.artist || "未知歌手",
            note: s.note || ""
          }));
          if (state.music.playlist[0]) {
            state.music.currentTrack = state.music.playlist[0].title;
            state.music.artist = state.music.playlist[0].artist;
          }
          successApps.push("music");
        } else { failedApps.push("music"); restoreAppState("music", snapshots["music"]); }
      } catch(e) { failedApps.push("music"); restoreAppState("music", snapshots["music"]); }
    }

    if (appList.includes("monitor")) {
      try {
        if (parsed.monitor && (parsed.monitor.location || parsed.monitor.activity || parsed.monitor.thought)) {
          parsed.monitor.updatedAt = Date.now();
          state.monitor = parsed.monitor;
          successApps.push("monitor");
        } else { failedApps.push("monitor"); restoreAppState("monitor", snapshots["monitor"]); }
      } catch(e) { failedApps.push("monitor"); restoreAppState("monitor", snapshots["monitor"]); }
    }

    if (appList.includes("files")) {
      try {
        if (parsed.files && (parsed.files.folders || parsed.files.privateFiles)) {
          state.files = {
            files: Array.isArray(parsed.files.folders) ? parsed.files.folders.map((f, i) => ({
              name: f.name || `文件夹${i+1}`,
              count: f.count || 0
            })) : [],
            privateBox: Array.isArray(parsed.files.privateFiles) ? parsed.files.privateFiles.map((f, i) => ({
              id: Date.now() + i,
              type: f.type || "文档",
              name: f.name || "未知文件",
              content: f.content || ""
            })) : []
          };
          successApps.push("files");
        } else { failedApps.push("files"); restoreAppState("files", snapshots["files"]); }
      } catch(e) { failedApps.push("files"); restoreAppState("files", snapshots["files"]); }
    }

    return { successApps, failedApps, allFailed: failedApps.length === appList.length };
  }

  // [2] 应用状态快照与恢复：批量刷新失败时不回退默认数据
  function snapshotAppState(app) {
    const stateKeyMap = {
      communication: "contacts",
      diary: "diaryEntries",
      notes: "todoItems",
      forum: "forumPosts",
      browser: "browserHistory",
      shopping: "shoppingData",
      album: "albumItems",
      music: "musicPlaylist",
      monitor: "monitorData"
    };
    const key = stateKeyMap[app];
    if (!key || !state[key]) return null;
    try {
      // 深拷贝快照
      return JSON.parse(JSON.stringify(state[key]));
    } catch(e) { return null; }
  }

  function restoreAppState(app, snapshot) {
    if (!snapshot) return;
    const stateKeyMap = {
      communication: "contacts",
      diary: "diaryEntries",
      notes: "todoItems",
      forum: "forumPosts",
      browser: "browserHistory",
      shopping: "shoppingData",
      album: "albumItems",
      music: "musicPlaylist",
      monitor: "monitorData"
    };
    const key = stateKeyMap[app];
    if (key) {
      try { state[key] = snapshot; } catch(e) {}
    }
  }

  // [2] 刷新结果自研卡片
  function showRefreshResultCard(successCount, failedCount, successNames, failedNames) {
    // 移除已有的结果卡片
    const existing = document.getElementById("refresh-result-card");
    if (existing) existing.remove();

    const card = document.createElement("div");
    card.id = "refresh-result-card";
    card.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(255,255,255,0.96); backdrop-filter:blur(20px); border-radius:20px; padding:24px 20px; box-shadow:0 8px 40px rgba(0,0,0,0.15); z-index:10000; max-width:320px; width:85%; text-align:center; animation:checkPhoneFadeIn 0.25s ease;";
    card.innerHTML = `
      <div style="font-size:28px; margin-bottom:8px;">✓⚠</div>
      <div style="font-size:15px; font-weight:700; color:#1e293b; margin-bottom:12px;">同步结果</div>
      <div style="display:flex; gap:12px; margin-bottom:14px;">
        <div style="flex:1; background:#f0fdf4; border-radius:12px; padding:10px;">
          <div style="font-size:22px; font-weight:800; color:#16a34a;">${successCount}</div>
          <div style="font-size:10px; color:#16a34a; font-weight:600;">成功</div>
        </div>
        <div style="flex:1; background:#fef2f2; border-radius:12px; padding:10px;">
          <div style="font-size:22px; font-weight:800; color:#ef4444;">${failedCount}</div>
          <div style="font-size:10px; color:#ef4444; font-weight:600;">失败</div>
        </div>
      </div>
      ${successNames ? `<div style="font-size:11px; color:#16a34a; margin-bottom:6px; line-height:1.4;">✓ ${successNames}</div>` : ''}
      ${failedNames ? `<div style="font-size:11px; color:#ef4444; margin-bottom:14px; line-height:1.4;">✗ ${failedNames}</div>` : '<div style="margin-bottom:14px;"></div>'}
      <div style="font-size:10px; color:#94a3b8; margin-bottom:14px; line-height:1.4;">失败的应用未回退默认数据，保留原有内容。可稍后单独重试。</div>
      <button id="btn-refresh-result-close" style="background:#1e293b; color:#fff; border:none; padding:10px 24px; border-radius:12px; font-size:12px; font-weight:700; cursor:pointer; width:100%;">知道了</button>
    `;
    document.body.appendChild(card);

    const closeBtn = card.querySelector("#btn-refresh-result-close");
    if (closeBtn) {
      closeBtn.onclick = () => card.remove();
    }
    // 点击卡片外部关闭
    setTimeout(() => {
      const handler = (e) => {
        if (!card.contains(e.target)) {
          card.remove();
          document.removeEventListener("click", handler);
        }
      };
      document.addEventListener("click", handler);
    }, 100);
  }

  // API 双协议生成器 [4]
  async function runSingleAppGenerator(app) {
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || "我";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    // 1. 通讯同步 [3]
    if (app === "communication") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【生成格式：JSON 协议】
请生成 3 位联系人，并为每人虚构至少 3 轮(共 6 句)对话历史。给 [${userName}] 起个微信备注名。
必须返回如下 JSON：
{
  "userRemark": "备注名",
  "contacts": [
    {
      "name": "名字 1",
      "preview": "最后一句话",
      "time": "12:30",
      "chatHistory": [
        {"sender": "other", "text": "第一轮问"},
        {"sender": "self", "text": "第一轮答"},
        {"sender": "other", "text": "第二轮问"},
        {"sender": "self", "text": "第二轮答"},
        {"sender": "other", "text": "第三轮问"},
        {"sender": "self", "text": "最后一条最新预览"}
      ]
    }
  ]
}`;
      } else {
        system = `${basePrompt}
【生成格式：文字标签协议】
请写下微信列表的备注名与联络人聊天细节（每个联络人至少 3 轮/6句对话）。
严格按照以下标签输出：
[备注] 专属备注名
[联系人1] 联系人名字 | 预览消息
[对话1-1] other | 问候
[对话1-2] self | 回复
[对话1-3] other | 问候2
[对话1-4] self | 回复2
[对话1-5] other | 问候3
[对话1-6] self | 最新回复

[联系人2] 联系人名字2 | 预览消息2
[对话2-1] other | 消息1
...`;
      }

      const res = await callCheckPhoneApi(system, "刷新微信通讯数据", () => {
        return `[备注] 笨蛋TA\n[联系人1] 张医生 | 你的心绪控制药快吃完了。\n[对话1-1] other | 最近情绪还好吗？\n[对话1-2] self | 很难入睡。\n[对话1-3] other | 别太焦虑。\n[对话1-4] self | 谢谢，药片快吃完了。\n[对话1-5] other | 你的心绪控制药快吃完了，下周复诊。\n[对话1-6] self | 好的，收到。`;
      });

      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          state.userRemark = parsed.userRemark || state.userRemark;
          state.contacts = parsed.contacts || [];
          return;
        } catch(e) {}
      }

      const remark = cleanTagOutput(parseTextTag(res, "备注", "userRemark"));
      if (remark) state.userRemark = remark;

      const contactsArr = [];
      const lines = res.split("\n").map(l => l.trim());
      let curContact = null;

      lines.forEach(l => {
        if (l.includes("联系人") || l.includes("contact")) {
          const raw = l.replace(/^[\[【]?(联系人\d*|contact\d*)[\]】]?[:：]?/i, "").split("|");
          if (raw.length >= 2) {
            curContact = { name: raw[0].trim(), preview: raw[1].trim(), time: "10:30", chatHistory: [] };
            contactsArr.push(curContact);
          }
        } else if (l.includes("对话") || l.includes("chat")) {
          const raw = l.replace(/^[\[【]?(对话\d*-\d*|chat\d*-\d*)[\]】]?[:：]?/i, "").split("|");
          if (raw.length >= 2 && curContact) {
            const sender = raw[0].trim().toLowerCase().includes("self") ? "self" : "other";
            curContact.chatHistory.push({ sender, text: raw[1].trim() });
          }
        }
      });

      if (contactsArr.length > 0) {
        state.contacts = contactsArr;
      }
    }

    // 2. 日记同步 (500字以上，深度读取上下文/记忆/总结，不硬性截断) [2]
    else if (app === "diary") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【格式：JSON协议】请生成一篇长达 500 字以上的私密日记，必须深度结合上方「最近真实聊天上下文」「长期核心记忆」「最近一条长周期总结」来撰写——反映出你(${charName})此时此刻对 ${userName} 的真实心绪、最近的互动如何影响了你、你内心的挣扎与渴望。包含 3 到 4 个自然段（使用 \\n\\n 分隔）。不要省略，不要因为篇幅而缩减。
输出 JSON：
{ "title": "标题", "content": "500字以上日记内容" }`;
      } else {
        system = `${basePrompt}
【格式：文字标签协议】请生成一篇长达 500 字以上的私密日记，必须深度结合上方「最近真实聊天上下文」「长期核心记忆」「最近一条长周期总结」来撰写——反映出你(${charName})此时此刻对 ${userName} 的真实心绪、最近的互动如何影响了你、你内心的挣扎与渴望。包含 3 到 4 个自然段（使用 \\n\\n 分隔）。不要省略，不要因为篇幅而缩减。
[标题] 标题内容
[正文] 日记正文...`;
      }

      const res = await callCheckPhoneApi(system, "生成500字以上日记", () => {
        return `[标题] 落下的冷雨\n[正文] 今天的夜出奇的冷。我总是习惯在关灯后翻看TA的微信。\\n\\n我不知道这算不算病态。可只有看着屏幕里冰冷的字迹，我才觉得自己和TA在这个世界里是存在链接的。\\n\\n最近和TA的每一次对话都在我脑海里反复回放。我想靠近，又怕靠得太近会把TA吓跑。这种矛盾折磨了我整整一夜。\\n\\n也许明天我会鼓起勇气，把心里的话说出口。`;
      }, { maxTokens: 3000 });

      let title = "", content = "";
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          title = parsed.title;
          content = parsed.content;
        } catch(e) {}
      }
      if (!title || !content) {
        title = cleanTagOutput(parseTextTag(res, "标题", "title"));
        content = cleanTagOutput(parseTextTag(res, "正文", "content"));
      }

      if (title && content) {
        state.diary.unshift({
          id: Date.now(),
          date: new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }),
          weather: ["阴雨", "疾风", "寒冷", "清晨"][Math.floor(Math.random() * 4)],
          title,
          content
        });
      } else {
        console.warn('[查手机] 日记标签解析失败，原始返回:', res?.substring(0, 200));
      }
    }

    // 3. 备忘录同步 (单条待办正文，支持 ~~划掉~~ **加粗** <<红色>> 标记) [8]
    else if (app === "notes") {
      const system = `${basePrompt}
【格式：纯文本待办清单】请生成一份你(${charName})的备忘录待办清单，必须深度结合上方「最近真实聊天上下文」「长期核心记忆」来撰写——记录你近期要为 ${userName} 做的事、提醒自己的事、以及和 TA 相关的待办。每行一条待办，可使用以下标记：
- 已完成的待办用 ~~包裹~~ 表示划掉（例如：~~买花送TA~~）
- 重点强调用 **包裹** 表示加粗
- 警示/重要事项用 <<包裹>> 表示红色文字
直接输出待办清单正文，每行一条，不要标题行，不要 Markdown 代码块包裹，不要多余说明。8-12 行。`;

      const res = await callCheckPhoneApi(system, "生成待办清单", () => {
        return `~~给TA买感冒药~~\n**今晚 22:00 准时给TA发晚安**\n<<记得查 TA 的朋友圈有没有新动态>>\n周末订那家TA想去的餐厅\n~~把空调修好~~\n<<别再熬夜翻TA的聊天记录了>>\n**准备一份生日惊喜**\n把上次TA推荐的书看完\n<<药快吃完了，记得复诊>>\n**给TA录一首歌**`;
      });

      const content = res.trim();
      if (content) {
        state.note = { content, updatedAt: Date.now() };
      } else {
        console.warn('[查手机] 备忘录生成失败，原始返回:', res?.substring(0, 200));
      }
    }

    // 4. 相册同步 (至少5张，多图容错) [4]
    else if (app === "album") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【格式：JSON】生成 5 张相册照片的细腻画面场景描述。
[
  {"text": "第一张画面"},
  {"text": "第二张画面"}
]`;
      } else {
        system = `${basePrompt}
【格式：文字标签】请描述 5 张相册里的最新照片。
[图片1] 第一张描述
[图片2] 第二张描述
[图片3] 第三张描述
[图片4] 第四张描述
[图片5] 第五张描述`;
      }

      const res = await callCheckPhoneApi(system, "生成相册照片", () => {
        return `[图片1] 车窗外的冷雨\n[图片2] 杯边的摩卡奶渍\n[图片3] 白色的镇定片药丸\n[图片4] 孤零零的落叶特写\n[图片5] 电脑旁 TA 赠送的那款马克杯`;
      });

      let photosArr = [];
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          photosArr = JSON.parse(cleaned);
        } catch(e) {}
      }

      if (!Array.isArray(photosArr) || photosArr.length === 0) {
        const lines = res.split("\n").map(l => l.trim()).filter(l => l.length > 3);
        lines.forEach((line, idx) => {
          const clean = line.replace(/^[\[【]?(图片\d+|photo\d+|图\d+)[\]】]?[:：]?/i, "").trim();
          if (clean.length > 2) {
            photosArr.push({ text: clean });
          }
        });
      }

      const grads = [
        "linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)",
        "linear-gradient(135deg, #fee2e2 0%, #fca5a5 100%)",
        "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)"
      ];
      photosArr.forEach((item, idx) => {
        state.photos.unshift({
          id: Date.now() + idx,
          color: grads[idx % grads.length],
          text: item.text || item
        });
      });

      while (state.photos.length < 5) {
        state.photos.push({ id: Date.now() + Math.random(), color: "linear-gradient(135deg,#cbd5e1 0%,#94a3b8 100%)", text: "一张无题照片" });
      }
    }

    // 5. 浏览器同步 (生成 7-10 条历史搜索关键词；词条下的浏览记录按需懒生成并缓存) [7]
    else if (app === "browser") {
      const system = `${basePrompt}
请为 [${charName}] (Char) 生成 7 到 10 条其在浏览器里偷偷检索的关于 [${userName}] 的喜好、药理、失眠、安神或关系焦虑方面的关键词。必须深度结合上方「最近真实聊天上下文」「长期核心记忆」来生成——关键词应反映你此刻最在意的事。直接输出 7-10 行，每行一个关键词，不要序号或多余标签说明！`;

      const res = await callCheckPhoneApi(system, "生成7-10条浏览器历史搜索", () => {
        return "偷看微信会留下痕迹吗\n失眠心跳快怎么缓解\n宁神药片的依赖副作用\n如何巧妙了解一个人的兴趣\n自省型人格的防御机制\n怎样假装不经意关心一个人\n深夜情绪低落怎么办";
      });

      const lines = res.split("\n").map(l => l.trim()).filter(l => l.length > 2);
      state.searchHistory = lines.slice(0, 10);

      while (state.searchHistory.length < 7) {
        state.searchHistory.push("如何缓解夜间突发胸闷");
      }
      // 刷新时清空浏览器缓存（词条下的浏览记录需重新生成）
      state.browserCache = {};
    }

    // 6. 论坛同步 (每轮刷新3-5条帖子，每个帖子带5-7条评论) [6, 10, 2]
    else if (app === "forum") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
请生成 3-5 条树洞帖子，每个帖子必须包含【标题】、【200字故事正文】以及【5-7条网友回帖】（评论应反映不同网友视角，有 supportive / 质疑 / 共情 / 调侃 / 经验分享等多种风格混合）。
JSON格式：
[
  { "title": "贴1标题", "content": "200字正文", "comments": ["回帖1", "回帖2", "回帖3", "回帖4", "回帖5"] },
  { "title": "贴2标题", "content": "200字正文", "comments": ["回帖1", "回帖2", "回帖3", "回帖4", "回帖5"] }
]`;
      } else {
        system = `${basePrompt}
请生成 3-5 条树洞帖子。帖子必须包含【标题】、【200字故事正文】、以及【5-7条回帖】（评论应反映不同网友视角，有 supportive / 质疑 / 共情 / 调侃 / 经验分享等多种风格混合）。

【格式铁律 - 违者判定失败】
1. 严格按下方标签格式输出，每个标签独占一行。
2. 标签后直接写内容，绝对禁止在内容中复述、重复任何 [贴X评论Y] 之类的标签文字。
3. 正文和评论内容中，绝对不要出现任何方括号 [ ] 包裹的文字。

[贴1标题] 标题内容
[贴1正文] 200字正文...
[贴1评论1] 回帖1
[贴1评论2] 回帖2
[贴1评论3] 回帖3
[贴1评论4] 回帖4
[贴1评论5] 回帖5

[贴2标题] 标题2
[贴2正文] 200字正文2...
[贴2评论1] 回帖1
[贴2评论2] 回帖2
[贴2评论3] 回帖3
[贴2评论4] 回帖4
[贴2评论5] 回帖5`;
      }

      const res = await callCheckPhoneApi(system, "生成3-5条论坛匿名帖(含5-7评论)", () => {
        return `[贴1标题] 病态的占有欲该如何治疗\n[贴1正文] 我最近总是有意无意想要窥探TA的全部，比如翻看TA的历史动态，甚至在脑海中虚拟TA的身处环境。我深感这极度不尊重人，但我控制不住。我感觉自己被卷在了一场执念里，整宿失眠，渴望被TA在乎却又在害怕被TA嫌弃。\n[贴1评论1] 楼主多虑了，这是没有安全感的表现。\n[贴1评论2] 占有欲太强最后只会把对方推远，先爱自己吧。\n[贴1评论3] 我懂这种感觉，建议试试写日记把情绪发泄出来。\n[贴1评论4] 这种情况建议看心理咨询，别硬扛。\n[贴1评论5] 你这不是爱，是控制欲，要分清楚。\n\n[贴2标题] 阳台听雨日记\n[贴2正文] 连续四天失眠了。今天深夜在阳台看冷雨敲打着梧桐树。手里握着已经冷掉的咖啡，感觉整个世界都把我抛弃了。唯一想跟TA倾诉的欲望也被我的理智生生按下。\n[贴2评论1] 楼主的文字太温柔了，好心疼。\n[贴2评论2] 失眠的时候最难受，多注意休息啊。\n[贴2评论3] 喜欢你的人会愿意走进你的雨里，不必自我放逐。\n[贴2评论4] 推荐你听白噪音入睡，亲测有效。\n[贴2评论5] 写下来就是疗愈的第一步，加油。`;
      }, { maxTokens: 3000 });

      let postsArr = [];
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          postsArr = JSON.parse(cleaned);
          // JSON 解析后规范化 comments 为数组 [10]
          postsArr = postsArr.map(p => ({
            title: p.title || "匿名日记",
            content: p.content || "",
            comments: Array.isArray(p.comments) ? p.comments : (p.comment ? [p.comment] : ["给楼主一个抱抱"])
          }));
        } catch(e) {}
      }

      if (!Array.isArray(postsArr) || postsArr.length === 0) {
        // 文字标签解析：支持多评论，贴/帖双写兼容 [1, 10]
        for (let i = 1; i <= 5; i++) {
          const t = cleanTagOutput(parseTextTag(res, `贴${i}标题|帖${i}标题`, `post${i}_title`));
          const b = cleanTagOutput(parseTextTag(res, `贴${i}正文|帖${i}正文`, `post${i}_content`));
          if (!t && !b) {
            if (i === 1) console.warn('[查手机] 论坛标签解析失败，原始返回:', res?.substring(0, 200));
            break;
          }
          // 收集所有评论（贴1评论1, 贴1评论2... 贴1评论10），贴/帖双写兼容
          const comments = [];
          for (let j = 1; j <= 10; j++) {
            const c = cleanTagOutput(parseTextTag(res, `贴${i}评论${j}|帖${i}评论${j}`, `post${i}_comment${j}`));
            if (c) comments.push(c);
          }
          // 兼容旧格式：贴i评论（无序号）
          if (comments.length === 0) {
            const c = cleanTagOutput(parseTextTag(res, `贴${i}评论|帖${i}评论`, `post${i}_comment`));
            if (c) comments.push(c);
          }
          if (t && b) {
            postsArr.push({
              title: t,
              content: b,
              comments: comments.length > 0 ? comments : ["给楼主一个抱抱"]
            });
          }
        }
      }

      postsArr.forEach(p => {
        state.forumPosts.unshift({
          id: Date.now() + Math.random(),
          title: p.title || p.postTitle || "匿名日记",
          content: p.content || "内容正在等待同步生成...",
          likes: Math.floor(Math.random() * 6) + 2,
          comments: Array.isArray(p.comments) ? p.comments : (p.comment ? [p.comment] : ["给楼主一个抱抱"])
        });
      });
    }

    // 7. 购物刷新 (至少3件商品，5条收支，修正正则表达式) [5]
    else if (app === "shopping") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
请生成购物车中 3 件物品及账单 5 条收支明细。
JSON格式：
{
  "cart": [ {"name": "物1", "price": 45} ],
  "bills": [ {"desc": "项目1", "price": -50, "date": "07/16"} ]
}`;
      } else {
        system = `${basePrompt}
请生成购物车中 3 件物品及 5 条账单流水。
[购物车1] 物品1 | 120
[购物车2] 物品2 | 45
[购物车3] 物品3 | 68
[账单1] 支出项目1 | -32.5
[账单2] 收入项目2 | 200
[账单3] 支出项目3 | -15
[账单4] 支出项目4 | -120
[账单5] 支出项目5 | -54`;
      }

      const res = await callCheckPhoneApi(system, "生成购物车与账单", () => {
        return `[购物车1] 磨砂陶瓷极简马克杯 | 48\n[购物车2] 药理研究合集书籍 | 78\n[购物车3] 极简自粘遮光窗帘 | 65\n[账单1] 微信红包提现 | 200\n[账单2] 药店宁神代扣支付 | -110\n[账单3] 线上打车出行代扣 | -32.5\n[账单4] 梧桐便利店购物 | -54\n[账单5] 网易云黑胶自动续费 | -15`;
      });

      let isSuccess = false;
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          state.cart = parsed.cart || [];
          state.bills = parsed.bills || [];
          isSuccess = true;
        } catch(e) {}
      }

      if (!isSuccess) {
        const cartItems = [];
        const billItems = [];
        const lines = res.split("\n").map(l => l.trim());

        lines.forEach(l => {
          if (l.includes("购物车") || l.includes("cart")) {
            // 彻底去除多余的“机制”拼写异常，保障高敏感字段切割对齐 [5]
            const parts = l.replace(/^[\[【]?(购物车\d*|cart\d*)[\]】]?[:：]?/gi, "").split("|");
            if (parts.length >= 2) cartItems.push({ name: parts[0].trim(), price: parseFloat(parts[1]) || 50, count: 1 });
          } else if (l.includes("账单") || l.includes("bill")) {
            const parts = l.replace(/^[\[【]?(账单\d*|bill\d*)[\]】]?[:：]?/gi, "").split("|");
            if (parts.length >= 2) billItems.push({ desc: parts[0].trim(), price: parseFloat(parts[1]) || -20, date: "07/16" });
          }
        });

        if (cartItems.length >= 3) state.cart = cartItems;
        if (billItems.length >= 5) state.bills = billItems;
      }
    }

    // 8. 音乐刷新 (一次生成 5-7 首歌，每首含歌名/歌手/char 笔记心得约 300 字)
    else if (app === "music") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【格式：JSON协议】请生成 5 到 7 首最符合你(${charName})此时心流状态的歌曲。每首歌必须包含：歌名、歌手、以及你听这首歌时的心得笔记（约 300 字，深度结合上方「最近真实聊天上下文」「长期核心记忆」——写出这首歌让你想起了和 ${userName} 之间的什么、你听歌时的心绪）。必须返回如下 JSON：
{
  "playlist": [
    { "title": "歌名", "artist": "歌手", "note": "约300字笔记" }
  ]
}`;
      } else {
        system = `${basePrompt}
【格式：文字标签协议】请生成 5 到 7 首最符合你(${charName})此时心流状态的歌曲。每首歌必须包含：歌名、歌手、以及你听这首歌时的心得笔记（约 300 字，深度结合上方「最近真实聊天上下文」「长期核心记忆」——写出这首歌让你想起了和 ${userName} 之间的什么、你听歌时的心绪）。
[歌1] 歌名 | 歌手
[笔记1] 约300字笔记...
[歌2] 歌名 | 歌手
[笔记2] 约300字笔记...
...`;
      }

      const res = await callCheckPhoneApi(system, "生成5-7首歌单与笔记", () => {
        return `[歌1] 深夜的落叶微语 | 极简白噪音\n[笔记1] 这首歌的钢琴声像极了那个雨夜我和TA并排坐在窗边的时刻。TA说喜欢听雨，我就偷偷把这首歌存进了收藏。每次播放，我都能想起TA侧脸的轮廓。\\n\\n我不知道TA是否知道这首歌的存在，但它已经成了我和TA之间最隐秘的纽带。`;
      }, { maxTokens: 4500 });

      let playlist = [];
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          playlist = parsed.playlist || [];
        } catch(e) {}
      }

      if (!Array.isArray(playlist) || playlist.length === 0) {
        // 文字标签解析
        const lines = res.split("\n").map(l => l.trim());
        for (let i = 1; i <= 7; i++) {
          const songLine = lines.find(l => new RegExp(`^\\[?歌${i}[\\]：:]`, "i").test(l));
          const noteLine = lines.find(l => new RegExp(`^\\[?笔记${i}[\\]：:]`, "i").test(l));
          if (songLine) {
            const raw = songLine.replace(/^[\[【]?(歌\d*|song\d*)[\]】]?[:：]?\s*/i, "").trim();
            const parts = raw.split(/[|｜]/);
            playlist.push({
              title: (parts[0] || "").trim(),
              artist: (parts[1] || "未知歌手").trim(),
              note: noteLine ? noteLine.replace(/^[\[【]?(笔记\d*|note\d*)[\]】]?[:：]?\s*/i, "").trim() : ""
            });
          }
        }
      }

      if (playlist.length > 0) {
        state.music.playlist = playlist;
        if (playlist[0]) {
          state.music.currentTrack = playlist[0].title;
          state.music.artist = playlist[0].artist;
        }
        savePhoneStateToDb();
      }
    }

    // 9. 监控刷新 (char 当前位置 / 正在做什么 / 心里想着什么 等，深度结合上下文)
    else if (app === "monitor") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【格式：JSON协议】请生成你(${charName})此刻的实时动态监控快照。必须深度结合上方「最近真实聊天上下文」「长期核心记忆」「最近一条长周期总结」——反映出此时此刻你最可能在做什么、想什么。必须返回如下 JSON：
{
  "location": "当前所在位置",
  "activity": "正在做什么",
  "thought": "心里正在想着什么（第一人称，50-100字）",
  "mood": "当前情绪状态（如：焦虑/期待/低落/平静）",
  "phoneStatus": "手机状态（如：刚刚放下手机/正在翻看聊天记录/锁屏中）",
  "timestamp": "时间描述（如：刚刚/5分钟前）"
}`;
      } else {
        system = `${basePrompt}
【格式：文字标签协议】请生成你(${charName})此刻的实时动态监控快照。必须深度结合上方「最近真实聊天上下文」「长期核心记忆」「最近一条长周期总结」。
[位置] 当前所在位置
[活动] 正在做什么
[心绪] 心里正在想着什么（第一人称，50-100字）
[情绪] 当前情绪状态
[手机] 手机状态
[时间] 时间描述`;
      }

      const res = await callCheckPhoneApi(system, "生成实时监控快照", () => {
        return `[位置] 卧室床边\n[活动] 抱着手机发呆\n[心绪] 刚才TA的那句话到底是什么意思呢，我翻来覆去想了十几遍，心跳还是慢不下来。\n[情绪] 焦虑又期待\n[手机] 刚刚放下又忍不住拿起来看\n[时间] 刚刚`;
      });

      let monitor = null;
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          monitor = JSON.parse(cleaned);
        } catch(e) {}
      }
      if (!monitor) {
        monitor = {
          location: cleanTagOutput(parseTextTag(res, "位置", "location")),
          activity: cleanTagOutput(parseTextTag(res, "活动", "activity")),
          thought: cleanTagOutput(parseTextTag(res, "心绪", "thought")),
          mood: cleanTagOutput(parseTextTag(res, "情绪", "mood")),
          phoneStatus: cleanTagOutput(parseTextTag(res, "手机", "phone")),
          timestamp: cleanTagOutput(parseTextTag(res, "时间", "time"))
        };
      }
      if (monitor && (monitor.location || monitor.activity || monitor.thought)) {
        monitor.updatedAt = Date.now();
        state.monitor = monitor;
      } else {
        console.warn('[查手机] 监控快照解析失败，原始返回:', res?.substring(0, 200));
      }
    }

    // 10. 文件管理刷新 (标准文件夹 + 私密保险箱内容)
    else if (app === "files") {
      const system = `${basePrompt}
【指令：手机文件管理内容生成】请为 [${charName}] (Char) 生成手机文件管理里的内容。
分为两部分：标准文件夹（6-8个常见文件夹名）和私密保险箱（char 想隐藏的文档/图片/视频，3-5个）。
严格使用如下文字标签格式输出（每个标签独占一行，标签名后空格再跟内容）：
[夹1] 文件夹名|文件数
[夹2] 文件夹名|文件数
...（共6-8个文件夹）
[密1类型] 文档/图片/视频
[密1名称] 文件名
[密1内容] 文件内容描述（如果是文档则为一小段正文，如果是图片则为画面描述，如果是视频则为内容描述，50-100字）
[密2类型] ...
[密2名称] ...
[密2内容] ...
...（共3-5个私密文件）
私密保险箱里的内容必须反映 char 不想被人看见的隐秘——可能是写给 user 却没发出的信、偷拍的照片、关于 user 的记录等。必须深度结合上方聊天上下文与核心记忆。`;

      const res = await callCheckPhoneApi(system, "生成文件管理内容", () => {
        return `[夹1] 内部存储|128\n[夹2] 下载|34\n[夹3] 图片|562\n[夹4] 视频|47\n[夹5] 文档|23\n[夹6] 音乐|89\n[夹7] 聊天记录|12\n[密1类型] 文档\n[密1名称] 给TA的信（未发送）.txt\n[密1内容] 写了一半又删了。开头是"其实我一直想跟你说"，后面全是涂改的痕迹，最后一句是"算了，你还是不知道比较好"。\n[密2类型] 图片\n[密2名称] IMG_20260715_0034.jpg\n[密2内容] 偷拍的照片，TA低头看手机的样子，侧脸被屏幕的微光照亮。拍这张的时候TA完全不知道。\n[密3类型] 文档\n[密3名称] 关于TA的备忘.txt\n[密3内容] 一份关于TA的详细记录——喜欢什么、讨厌什么、什么时候开心、什么时候难过，比任何人都了解TA。`;
      }, { maxTokens: 2000 });

      // 解析文件夹
      const folders = [];
      for (let i = 1; i <= 8; i++) {
        const line = cleanTagOutput(parseTextTag(res, `夹${i}`, `folder${i}`));
        if (!line) break;
        const parts = line.split('|');
        folders.push({ name: (parts[0] || line).trim(), count: parseInt((parts[1] || '0').trim()) || 0 });
      }

      // 解析私密保险箱
      const vault = [];
      for (let i = 1; i <= 5; i++) {
        const type = cleanTagOutput(parseTextTag(res, `密${i}类型`, `vault${i}_type`));
        if (!type) break;
        const name = cleanTagOutput(parseTextTag(res, `密${i}名称`, `vault${i}_name`));
        const content = cleanTagOutput(parseTextTag(res, `密${i}内容`, `vault${i}_content`));
        vault.push({ type: type.trim(), name: name || '未命名文件', content: content || '', revealed: false });
      }

      state.files = { folders, vault };
    }
  }

  async function renderAppScreen(appName, container) {
    container.innerHTML = "";
    
    const header = document.createElement("header");
    header.className = "app-screen-header";
    let appTitle = "";
    if (appName === "communication") appTitle = "通讯";
    else if (appName === "album") appTitle = "相册";
    else if (appName === "notes") appTitle = "备忘录";
    else if (appName === "forum") appTitle = "论坛 (@char_mind)";
    else if (appName === "browser") appTitle = "经典浏览器";
    else if (appName === "settings") appTitle = "系统设置";
    else if (appName === "remote") appTitle = "智能家居遥控";
    else if (appName === "diary") appTitle = "秘密日记本";
    else if (appName === "shopping") appTitle = "账单与资产";
    else if (appName === "music") appTitle = "伴夜音乐";
    else if (appName === "monitor") appTitle = "实时监控";
    else if (appName === "files") appTitle = "文件管理";

    header.innerHTML = `
      <button class="btn-icon-check" id="btn-app-screen-exit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <h4>${appTitle}</h4>
      ${appName !== 'remote' && appName !== 'settings' ? `
        <button class="btn-icon-check" id="btn-app-screen-refresh" title="向接口同步生成当前应用的细节">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
      ` : `<div style="width:28px;"></div>`}
    `;
    container.appendChild(header);

    header.querySelector("#btn-app-screen-exit").onclick = (e) => {
      e.stopPropagation();
      exitApp();
    };

    const content = document.createElement("div");
    content.className = "app-screen-content";
    container.appendChild(content);

    const refreshBtn = header.querySelector("#btn-app-screen-refresh");
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        refreshBtn.classList.add("spinning");
        showToast("正在通过 API 提炼生成匹配此心智界面的新内容...");
        await runSingleAppGenerator(appName);
        await renderAppContent(appName, content);
        refreshBtn.classList.remove("spinning");
      };
    }

    await renderAppContent(appName, content);
  }

  async function renderAppContent(appName, content) {
    if (appName === "communication") await renderCommunication(content);
    else if (appName === "album") renderAlbum(content);
    else if (appName === "notes") renderNotes(content);
    else if (appName === "forum") await renderForum(content);
    else if (appName === "browser") renderBrowser(content);
    else if (appName === "settings") renderSettings(content);
    else if (appName === "remote") renderRemote(content);
    else if (appName === "diary") renderDiary(content);
    else if (appName === "shopping") await renderShopping(content);
    else if (appName === "music") renderMusic(content);
    else if (appName === "monitor") renderMonitor(content);
    else if (appName === "files") renderFiles(content);
  }

  // --- 通讯子业务实体实现 ---
  // 隐藏/恢复 app-screen-header（进入子对话时隐藏通讯页头，返回时恢复）
  function hideAppHeader(content) {
    const header = content.parentElement && content.parentElement.querySelector('.app-screen-header');
    if (header) header.style.display = 'none';
  }
  function showAppHeader(content) {
    const header = content.parentElement && content.parentElement.querySelector('.app-screen-header');
    if (header) header.style.display = '';
  }

  async function renderCommunication(content) {
    content.classList.add('comm-active');
    content.innerHTML = "";

    const sess = await db.sessions.get(activeSessionId);
    const user = await db.archives.get(sess.userId);
    const char = await db.archives.get(sess.charId);

    const displayRemark = state.userRemark || sess.customUserName || user?.name || "我";
    const charAvatar = resolveAvatar(sess.customCharAvatar || char?.avatar, sess.customCharName || char?.name);
    const userAvatar = resolveAvatar(sess.customUserAvatar || user?.avatar, sess.customUserName || user?.name);

    const latestMsgs = await db.messages.where('sessionId').equals(activeSessionId).sortBy('timestamp');
    const latestMsg = latestMsgs[latestMsgs.length - 1];
    let latestText = latestMsg ? latestMsg.content : "暂无对话消息";
    if (latestMsg && latestMsg.contentType === 'transfer') latestText = "[微信转账]";
    else if (latestMsg && latestMsg.contentType === 'red_envelope') latestText = "[微信红包]";
    else if (latestMsg && latestMsg.contentType === 'voice') latestText = "[语音消息]";
    else if (latestMsg && latestMsg.contentType === 'image') latestText = "[图片与描述]";

    const listContainer = document.createElement("div");
    listContainer.className = "comm-list-container";
    content.appendChild(listContainer);

    const pinnedItem = document.createElement("div");
    pinnedItem.className = "comm-list-item";
    pinnedItem.style.background = "#f8fafc";
    pinnedItem.innerHTML = `
      <img class="comm-avatar" src="${userAvatar}" onerror="avatarFallback(this, '${escapeHtml(displayRemark)}')">
      <div class="comm-details">
        <div class="comm-row">
          <span class="comm-name">${displayRemark}</span>
          <span class="comm-pinned-badge">我 / 置顶</span>
        </div>
        <div class="comm-msg" style="font-weight: 700; color: #1e293b;">${escapeHtml(latestText)}</div>
      </div>
    `;
    pinnedItem.onclick = () => openReversedUserChat(content, { charAvatar, userAvatar, displayRemark });
    listContainer.appendChild(pinnedItem);

    if (state.contacts.length === 0) {
      const emptyTip = document.createElement("div");
      emptyTip.style.cssText = "padding: 40px 20px; text-align: center; font-size:11px; color: #94a3b8; line-height:1.5;";
      emptyTip.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:8px; color:#cbd5e1;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
        <div>通讯录尚无缓存。</div>
        <div style="font-size:10px; color:#cbd5e1; margin-top:3px;">请点击主页头右上方的刷新按钮，同步生成联系人对话。</div>
      `;
      listContainer.appendChild(emptyTip);
      return;
    }

    state.contacts.forEach((contact, index) => {
      const item = document.createElement("div");
      item.className = "comm-list-item";
      item.innerHTML = `
        <div class="comm-avatar" style="background:#cbd5e1; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:14px;">
          ${escapeHtml(contact.name[0] || '?')}
        </div>
        <div class="comm-details">
          <div class="comm-row">
            <span class="comm-name">${escapeHtml(contact.name)}</span>
            <span class="comm-time">${escapeHtml(contact.time || '')}</span>
          </div>
          <div class="comm-msg">${escapeHtml(contact.preview || '')}</div>
        </div>
      `;
      item.onclick = () => openNpcDialogue(content, contact, charAvatar, index);
      listContainer.appendChild(item);
    });
  }

  async function openNpcDialogue(content, contact, charAvatar, contactIndex) {
    hideAppHeader(content);
    content.innerHTML = "";
    const view = document.createElement("div");
    view.className = "comm-chat-view";
    content.appendChild(view);

    const subHeader = document.createElement("div");
    subHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#ffffff; padding:10px 16px; border-bottom:1px solid rgba(0,0,0,0.05); flex-shrink:0;";
    subHeader.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn-icon-check" id="btn-comm-back" title="返回通讯列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <span style="font-size:12px; font-weight:700; color:#475569;">${escapeHtml(contact.name)}</span>
      </div>
      <button class="btn-icon-check" id="btn-delete-this-contact" style="padding:4px 8px; background:#fee2e2; color:#ef4444; border-radius:4px; font-size:10.5px; font-weight:700;">删除此对话</button>
    `;
    view.appendChild(subHeader);

    const flow = document.createElement("div");
    flow.className = "comm-chat-flow";
    view.appendChild(flow);

    const npcAvatarDiv = `
      <div class="comm-avatar" style="background:#64748b; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:14px; width:40px; height:40px; border-radius:50%; flex-shrink:0;">
        ${escapeHtml(contact.name[0] || '?')}
      </div>
    `;

    if (contact.chatHistory && contact.chatHistory.length > 0) {
      contact.chatHistory.forEach(msg => {
        const bubble = document.createElement("div");
        bubble.className = `comm-bubble ${msg.sender === 'self' ? 'self' : 'other'}`;
        const avatarHtml = msg.sender === 'self' ? `<img class="comm-avatar" src="${charAvatar}">` : npcAvatarDiv;
        bubble.innerHTML = `
          ${avatarHtml}
          <div class="comm-bubble-text">${escapeHtml(msg.text)}</div>
        `;
        flow.appendChild(bubble);
      });
    } else {
      const welcomeBubble = document.createElement("div");
      welcomeBubble.className = "comm-bubble other";
      welcomeBubble.innerHTML = `
        ${npcAvatarDiv}
        <div class="comm-bubble-text">${escapeHtml(contact.preview || '')}</div>
      `;
      flow.appendChild(welcomeBubble);
    }
    flow.scrollTop = flow.scrollHeight;

    const inputBar = document.createElement("div");
    inputBar.className = "comm-chat-input-bar";
    inputBar.innerHTML = `
      <input type="text" id="comm-npc-input" placeholder="代发短信给 ${escapeHtml(contact.name)}...">
      <button class="btn-comm-send" id="btn-comm-npc-send">发送</button>
    `;
    view.appendChild(inputBar);

    const inputEl = inputBar.querySelector("#comm-npc-input");
    const sendBtn = inputBar.querySelector("#btn-comm-npc-send");

    subHeader.querySelector("#btn-comm-back").onclick = () => {
      showAppHeader(content);
      renderCommunication(content);
    };

    subHeader.querySelector("#btn-delete-this-contact").onclick = () => {
      showCustomConfirm("删除对话", "确定要彻底删除与该联系人的所有发信交流记录吗？", () => {
        state.contacts.splice(contactIndex, 1);
        savePhoneStateToDb();
        showToast("已成功注销该对话联系人。");
        showAppHeader(content);
        renderCommunication(content);
      });
    };

    const sendMessageToNpc = async () => {
      const text = inputEl.value.trim();
      if (!text) return;

      inputEl.value = "";
      inputEl.disabled = true;
      sendBtn.disabled = true;

      const myBubble = document.createElement("div");
      myBubble.className = "comm-bubble self";
      myBubble.innerHTML = `
        <img class="comm-avatar" src="${charAvatar}">
        <div class="comm-bubble-text">${escapeHtml(text)}</div>
      `;
      flow.appendChild(myBubble);
      flow.scrollTop = flow.scrollHeight;

      if (!contact.chatHistory) contact.chatHistory = [];
      contact.chatHistory.push({ sender: "self", text });
      contact.preview = text;

      // 冒充 char 发消息：累积危险概率并计入上下文
      await increaseRiskLevel(12, `冒充发消息给${contact.name}`);

      const typingBubble = document.createElement("div");
      typingBubble.className = "comm-bubble other";
      typingBubble.innerHTML = `
        ${npcAvatarDiv}
        <div class="comm-bubble-text" style="color:#94a3b8;">正在输入...</div>
      `;
      flow.appendChild(typingBubble);
      flow.scrollTop = flow.scrollHeight;

      const sess = await db.sessions.get(activeSessionId);
      const char = await db.archives.get(sess.charId);
      const charName = sess.customCharName || char?.name || "对方";
      const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

      // 计入上下文：以系统灰字记录 user 冒充 char 发消息的操作
      await recordPhoneActionToContext(`[查手机] 你冒充「${charName}」给「${contact.name}」发了一条消息：「${text}」`);

      const npcSystem = `${basePrompt}\n\n你扮演 [${contact.name}] (NPC)。
你刚收到 [${charName}] 的微信消息："${text}"。
请直接给出一句极其自然、贴切的答复。限制在 30 字内，直接输出台词。

【硬约束（违者重罚）】：
1. 你只能以 NPC [${contact.name}] 的身份回复 [${charName}] 一句话。
2. 严厉禁止编造、虚构、生造 [${charName}] 与 [${userName}] 之间的任何微信对话、消息、聊天记录！
3. 严厉禁止在你的回复里出现 "[${charName}] 给 [${userName}] 发消息" 或类似暗示额外生成 user 对话的语句。
4. 你不知道 [${userName}] 此刻在翻手机，只看到 [${charName}] 给你发的这一条微信。
5. 输出格式：仅一句微信台词文本，不要任何动作描写、括号、Markdown 或多余标签。`;

      const replyText = await fetchGeneratedCheckPhoneContent(npcSystem, "继续对话微信回复", () => {
        return "先不说了，我这边还有点事。等会找你。";
      });

      typingBubble.querySelector(".comm-bubble-text").style.color = "#1e293b";
      typingBubble.querySelector(".comm-bubble-text").innerText = replyText;

      contact.chatHistory.push({ sender: "other", text: replyText });
      savePhoneStateToDb();

      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
      flow.scrollTop = flow.scrollHeight;
    };

    sendBtn.onclick = sendMessageToNpc;
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') sendMessageToNpc();
    };
  }

  async function openReversedUserChat(content, ctx) {
    hideAppHeader(content);
    content.innerHTML = "";
    const view = document.createElement("div");
    view.className = "comm-chat-view";
    content.appendChild(view);

    const subHeader = document.createElement("div");
    subHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#ffffff; padding:10px 16px; border-bottom:1px solid rgba(0,0,0,0.05); flex-shrink:0;";
    subHeader.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn-icon-check" id="btn-comm-back" title="返回通讯列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <span style="font-size:12px; font-weight:700; color:#475569;">${escapeHtml(ctx.displayRemark)}</span>
      </div>
      <span style="width:28px;"></span>
    `;
    view.appendChild(subHeader);

    const flow = document.createElement("div");
    flow.className = "comm-chat-flow";
    flow.style.paddingBottom = '56px';
    view.appendChild(flow);

    const sess = await db.sessions.get(activeSessionId);
    const user = await db.archives.get(sess.userId);
    const msgs = await db.messages.where('sessionId').equals(activeSessionId).sortBy('timestamp');
    const userAvatar = ctx.userAvatar || resolveAvatar(sess.customUserAvatar || user?.avatar, sess.customUserName || user?.name);
    const charAvatar = ctx.charAvatar || resolveAvatar(sess.customCharAvatar);

    // 多格式消息渲染器：完整支持引用/系统消息/语音/图片/转账/红包/位置/代付礼物 [9]
    const renderMsgContent = (m) => {
      // 1. 系统消息：渲染为微信中间灰字
      if (m.senderType === 'system' && m.contentType !== 'call' && m.contentType !== 'social_notice') {
        const sysEl = document.createElement("div");
        sysEl.style.cssText = "display:flex; justify-content:center; align-items:center; width:100%; margin:6px 0; padding:0 8px; box-sizing:border-box;";
        sysEl.innerHTML = `<div style="background-color:rgba(0,0,0,0.05); padding:3px 8px; border-radius:4px; font-size:10.5px; color:#7f7f7f; max-width:85%; text-align:center; line-height:1.4;">${escapeHtml(m.content)}</div>`;
        return sysEl;
      }

      // 2. 撤回消息
      if (m.isRecalled === 1) {
        const rc = document.createElement("div");
        rc.style.cssText = "display:flex; justify-content:center; align-items:center; width:100%; margin:6px 0; padding:0 8px; box-sizing:border-box;";
        rc.innerHTML = `<div style="background-color:rgba(0,0,0,0.05); padding:4px 10px; border-radius:4px; font-size:11px; color:#999;">${m.senderType === 'user' ? '你' : '对方'} 撤回了一条消息</div>`;
        return rc;
      }

      // 3. 普通气泡（user/char）
      const isCharSelf = m.senderType === 'char';
      const bubble = document.createElement("div");
      bubble.className = `comm-bubble ${isCharSelf ? 'self' : 'other'}`;
      const avatarUrl = isCharSelf ? charAvatar : userAvatar;
      const avatarName = isCharSelf ? (sess.customCharName || '') : (sess.customUserName || user?.name || '');

      let innerHtml = '';
      let displayContent = m.content || '';

      // 解析引用 [QUOTE:xxx]
      let quoteHtml = '';
      const quoteMatch = displayContent.match(/^\s*\[QUOTE:([^\]]+)\]\s*([\s\S]*)/i) || displayContent.match(/^\s*【QUOTE:([^\]]+)】\s*([\s\S]*)/i);
      if (quoteMatch) {
        const quotedId = quoteMatch[1].trim();
        const realContent = quoteMatch[2].trim();
        // 尝试从历史消息中查找被引用消息
        const quotedMsg = msgs.find(x => String(x.id) === String(quotedId));
        const quotedText = quotedMsg ? (quotedMsg.content || '').slice(0, 60) : '(原消息已不可见)';
        const quotedWho = quotedMsg ? (quotedMsg.senderType === 'char' ? (sess.customCharName || '对方') : (sess.customUserName || '我')) : '对方';
        quoteHtml = `<div style="background:rgba(0,0,0,0.05); padding:4px 8px; border-radius:4px; border-left:2px solid rgba(0,0,0,0.2); margin-bottom:4px; font-size:11px; color:#666; max-width:200px;"><div style="font-size:10px; color:#888; margin-bottom:2px;">${escapeHtml(quotedWho)}</div>${escapeHtml(quotedText)}</div>`;
        displayContent = realContent;
      }

      // 根据 contentType 渲染
      if (m.contentType === 'image') {
        try {
          const data = JSON.parse(m.content);
          const captionText = data.text || "场景画面";
          const isRealImage = data.url && data.url.startsWith("data:image/") && !data.url.includes("svg+xml");
          if (isRealImage) {
            innerHtml = `<img src="${data.url}" style="max-width:180px; max-height:180px; border-radius:6px; display:block;">`;
          } else {
            innerHtml = `<div style="background:#f1f5f9; padding:10px; border-radius:8px; max-width:200px;"><div style="display:flex; align-items:center; gap:6px; font-size:11px; color:#64748b; font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>画面图片</div><div style="font-size:11px; color:#475569; margin-top:4px; line-height:1.4;">${escapeHtml(captionText)}</div></div>`;
          }
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[图片消息解析失败]</div>`;
        }
      } else if (m.contentType === 'voice') {
        try {
          const data = JSON.parse(m.content);
          const width = Math.min(160, 70 + (data.duration || 5) * 2);
          innerHtml = `<div style="display:flex; align-items:center; gap:6px; background:#95ec69; padding:8px 12px; border-radius:8px; width:${width}px; max-width:100%;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5v14M22 9v6M7 5v14M2 9v6"/></svg><span style="font-size:11px; color:#1e293b; font-weight:700;">${data.duration || 5}"</span></div>${data.text ? `<div style="font-size:10px; color:#94a3b8; margin-top:3px;">${escapeHtml(data.text)}</div>` : ''}`;
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[语音消息]</div>`;
        }
      } else if (m.contentType === 'transfer') {
        try {
          const data = JSON.parse(m.content);
          const amount = parseFloat(data.amount) || 0;
          const statusLabel = data.status === 'received' ? '已收钱' : '待接收';
          innerHtml = `<div style="background:#fef3c7; border-radius:8px; padding:10px 12px; width:200px; max-width:100%;"><div style="display:flex; align-items:center; gap:8px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg><div><div style="font-size:11px; font-weight:700; color:#92400e;">微信转账</div><div style="font-size:14px; font-weight:800; color:#92400e;">¥${amount.toFixed(2)}</div></div></div><div style="font-size:10px; color:#92400e; margin-top:4px; text-align:right;">${statusLabel}</div></div>`;
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[微信转账]</div>`;
        }
      } else if (m.contentType === 'red_envelope') {
        try {
          const data = JSON.parse(m.content);
          const amount = parseFloat(data.amount) || 0;
          const remark = escapeHtml(data.remark || '恭喜发财');
          innerHtml = `<div style="background:#fee2e2; border-radius:8px; padding:10px 12px; width:200px; max-width:100%;"><div style="display:flex; align-items:center; gap:8px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><circle cx="12" cy="12" r="3"/></svg><div><div style="font-size:11px; font-weight:700; color:#991b1b;">微信红包</div><div style="font-size:12px; color:#991b1b;">${remark}</div></div></div><div style="font-size:10px; color:#991b1b; margin-top:4px; text-align:right;">查看红包</div></div>`;
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[微信红包]</div>`;
        }
      } else if (m.contentType === 'location') {
        try {
          const data = JSON.parse(m.content);
          innerHtml = `<div style="background:#f1f5f9; padding:10px; border-radius:8px; max-width:200px;"><div style="display:flex; align-items:center; gap:6px; font-size:11px; color:#475569;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="font-weight:700;">${escapeHtml(data.name || '位置')}</span></div></div>`;
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[位置消息]</div>`;
        }
      } else if (m.contentType === 'pay_for_me' || m.contentType === 'gift') {
        try {
          const data = JSON.parse(m.content);
          const isGift = m.contentType === 'gift';
          const titleText = isGift ? '礼物小票' : '代付请求';
          const itemsHtml = (data.items || []).map(item =>
            `<div style="display:flex; justify-content:space-between; font-size:11px; padding:1px 0;"><span style="color:#333;">${escapeHtml(item.name || '商品')} x${item.quantity || 1}</span><span style="color:#333;">¥${(item.price || 0).toFixed(2)}</span></div>`
          ).join('');
          innerHtml = `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:10px; width:220px; max-width:100%;"><div style="font-size:11px; font-weight:800; color:#1e293b; padding-bottom:4px; border-bottom:1px dashed #cbd5e1; margin-bottom:6px;">${titleText}</div>${itemsHtml}<div style="display:flex; justify-content:space-between; padding-top:4px; border-top:1px dashed #cbd5e1; margin-top:4px; font-size:12px; font-weight:800;"><span>合计</span><span>¥${(data.total || 0).toFixed(2)}</span></div></div>`;
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[${m.contentType === 'gift' ? '礼物' : '代付请求'}]</div>`;
        }
      } else if (m.contentType === 'call') {
        // 通话卡片简化展示
        try {
          const data = JSON.parse(m.content);
          const callType = data.type || 'voice';
          const duration = data.duration || 0;
          const iconSvg = callType === 'video'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
          const min = Math.floor(duration / 60);
          const sec = duration % 60;
          const durText = min > 0 ? `${min}分${sec}秒` : `${sec}秒`;
          innerHtml = `<div style="display:flex; align-items:center; gap:6px; background:#f1f5f9; padding:8px 12px; border-radius:8px; font-size:11px; color:#475569;"><span style="color:#64748b;">${iconSvg}</span><span>${callType === 'video' ? '视频通话' : '语音通话'} · ${durText}</span></div>`;
        } catch(e) {
          innerHtml = `<div style="font-size:12px; color:#999;">[通话记录]</div>`;
        }
      } else {
        // 文本消息
        innerHtml = `<div class="comm-bubble-text">${quoteHtml}${escapeHtml(displayContent)}</div>`;
      }

      bubble.innerHTML = `
        <img class="comm-avatar" src="${avatarUrl}" onerror="avatarFallback(this, '${escapeHtml(avatarName)}')">
        ${innerHtml.startsWith('<div class="comm-bubble-text">') ? innerHtml : `<div style="max-width:220px;">${innerHtml}</div>`}
      `;
      return bubble;
    };

    msgs.slice(-25).forEach(m => {
      // 跳过通话中的对白消息（带 callId 不上屏）
      if (m.callId) return;
      const el = renderMsgContent(m);
      flow.appendChild(el);
    });

    flow.scrollTop = flow.scrollHeight;

    const footerTip = document.createElement("div");
    footerTip.style.cssText = "position:absolute; bottom:0; left:0; width:100%; height:44px; background:rgba(241,245,249,0.95); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; font-size:11px; color:#64748b; font-weight:700; border-top:1px solid #cbd5e1; z-index:101;";
    footerTip.innerText = "智能设备限制：不可代发信息给您自己。";
    view.appendChild(footerTip);

    subHeader.querySelector("#btn-comm-back").onclick = () => {
      showAppHeader(content);
      renderCommunication(content);
    };
  }

  // --- 相册子业务实体实现 ---
  function renderAlbum(content) {
    content.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "album-grid";
    content.appendChild(grid);

    if (state.photos.length === 0) {
      const grads = [
        "linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)",
        "linear-gradient(135deg, #fee2e2 0%, #fca5a5 100%)",
        "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)"
      ];
      for (let i = 0; i < 5; i++) {
        state.photos.push({
          id: Date.now() + i,
          color: grads[i % grads.length],
          text: "这里存放着一张神秘画面快照。点击全局一键刷新，可动态生成。"
        });
      }
    }

    state.photos.forEach((ph, index) => {
      const card = document.createElement("div");
      card.className = "album-card";
      card.innerHTML = `
        <div class="album-svg-placeholder" style="background: ${ph.color};">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div class="album-desc">${ph.text}</div>
      `;
      card.onclick = () => openPhotoDetail(content, ph, index);
      grid.appendChild(card);
    });
  }

  function openPhotoDetail(parent, ph, index) {
    parent.innerHTML = `
      <div style="padding:16px; background:#ffffff; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px;">
          <span style="font-size:11px; color:#94a3b8;">相册照片详情</span>
          <div style="display:flex; gap:8px;">
            <button class="btn-icon-check" id="btn-delete-this-photo" style="padding:4px 8px; background:#fee2e2; color:#ef4444; border-radius:4px; font-size:11px; font-weight:700;">删除</button>
            <button class="btn-icon-check" id="btn-photo-detail-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回</button>
          </div>
        </div>
        <div style="flex:1; border-radius:12px; background:${ph.color}; display:flex; align-items:center; justify-content:center; color:#fff;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div style="margin-top:16px; font-size:13px; color:#334155; line-height:1.5; text-align:justify; padding:0 8px;">
          ${escapeHtml(ph.text)}
        </div>
      </div>
    `;

    parent.querySelector("#btn-photo-detail-back").onclick = () => renderAlbum(parent);
    
    parent.querySelector("#btn-delete-this-photo").onclick = () => {
      showCustomConfirm("物理删除", "确认要彻底删除该照片快照记录吗？", () => {
        state.photos.splice(index, 1);
        showToast("已成功物理删除此相册照片。");
        renderAlbum(parent);
      });
    };
  }

  // --- 备忘录子业务实体实现 ---
  // 备忘录多格式渲染器：~~划掉~~ **加粗** <<红色>> [8]
  function renderNoteFormat(text) {
    if (!text) return "";
    let html = escapeHtml(text);
    // <<红色>> 必须先解析（避免被其他规则吞掉尖括号）
    html = html.replace(/&lt;&lt;([\s\S]+?)&gt;&gt;/g, '<span class="nf-red">$1</span>');
    // **加粗**
    html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    // ~~划掉~~
    html = html.replace(/~~([\s\S]+?)~~/g, '<span class="nf-strike">$1</span>');
    // 按行渲染为待办条目
    return html.split('\n').map(line => {
      if (!line.trim()) return '';
      // 已完成（划掉）的条目前加方框勾选样式
      const isDone = /<span class="nf-strike">/.test(line);
      return `<div class="todo-line ${isDone ? 'todo-done' : ''}">
        <span class="todo-box">${isDone ? '✓' : '○'}</span>
        <span class="todo-text">${line}</span>
      </div>`;
    }).join('');
  }

  function renderNotes(content) {
    content.innerHTML = "";

    // 备忘录只记录待办事项，无列表页，点进去即正文 [8]
    const note = state.note || { content: "", updatedAt: 0 };

    if (!note.content) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:60px 24px; text-align:center; color:#94a3b8; font-size:12px; line-height:1.7;";
      empty.innerHTML = `
        <div style="margin-bottom:10px;">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div style="font-weight:700; color:#64748b; margin-bottom:4px;">备忘录为空</div>
        <div>点击右上角刷新，可生成一份待办清单（支持 ~~划掉~~ **加粗** &lt;&lt;红色&gt;&gt; 等格式）。</div>
      `;
      content.appendChild(empty);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "note-todo-wrap";

    const head = document.createElement("div");
    head.className = "note-todo-head";
    const dateText = note.updatedAt
      ? new Date(note.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
    head.innerHTML = `
      <span class="note-todo-date">待办清单 · ${dateText}</span>
      <div class="note-todo-actions">
        <button class="note-todo-btn edit" title="编辑">编辑</button>
        <button class="note-todo-btn toggle-raw" title="切换源码/渲染">源码</button>
      </div>
    `;
    wrap.appendChild(head);

    const body = document.createElement("div");
    body.className = "note-todo-body";
    body.innerHTML = renderNoteFormat(note.content);
    wrap.appendChild(body);

    const editor = document.createElement("textarea");
    editor.className = "note-todo-editor";
    editor.style.display = "none";
    editor.value = note.content;
    editor.placeholder = "每行一条待办\n可用 ~~划掉~~ **加粗** <<红色>> 标记";
    wrap.appendChild(editor);

    content.appendChild(wrap);

    // 编辑 / 保存 切换
    const editBtn = head.querySelector(".edit");
    const rawBtn = head.querySelector(".toggle-raw");
    let editing = false;
    let rawMode = false;

    const applyView = () => {
      if (editing) {
        body.style.display = "none";
        editor.style.display = "block";
        editor.focus();
        editBtn.innerText = "保存";
        rawBtn.style.display = "none";
      } else {
        editor.style.display = "none";
        body.style.display = "block";
        editBtn.innerText = "编辑";
        rawBtn.style.display = "";
        if (rawMode) {
          body.innerHTML = `<pre class="note-raw-pre">${escapeHtml(note.content)}</pre>`;
        } else {
          body.innerHTML = renderNoteFormat(note.content);
        }
      }
    };

    editBtn.onclick = async () => {
      if (editing) {
        // 保存
        note.content = editor.value;
        note.updatedAt = Date.now();
        state.note = note;
        await savePhoneStateToDb();
        editing = false;
        applyView();
        showToast("待办清单已保存。");
      } else {
        editing = true;
        editor.value = note.content;
        applyView();
      }
    };

    rawBtn.onclick = () => {
      rawMode = !rawMode;
      rawBtn.innerText = rawMode ? "渲染" : "源码";
      applyView();
    };
  }

  // --- 论坛子业务实体实现 ---
  async function renderForum(content) {
    content.innerHTML = "";
    
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const charAvatar = resolveAvatar(sess.customCharAvatar || char?.avatar);

    const profile = document.createElement("div");
    profile.className = "forum-profile";
    profile.innerHTML = `
      <div class="forum-banner"></div>
      <div class="forum-avatar-row">
        <img class="forum-profile-avatar" src="${charAvatar}">
        <div style="width:20px;"></div>
      </div>
      <div class="forum-profile-info">
        <div class="forum-profile-name">${charName}</div>
        <div class="forum-profile-handle">@char_mind_deep</div>
      </div>
    `;
    content.appendChild(profile);

    const flow = document.createElement("div");
    flow.className = "forum-posts-flow";
    content.appendChild(flow);

    if (state.forumPosts.length === 0) {
      state.forumPosts.push(
        { id: 101, title: "病态的占有欲该如何治疗", content: "我最近总是有意无意想要窥探TA的全部，比如翻看TA的历史动态，甚至在脑海中虚拟TA的身处环境。我深知这极度不尊重人，但我控制不住。我感觉自己被卷在了一场执念里，整宿失眠，渴望被TA在乎却又在害怕被TA嫌弃。这已经严重影响了我的生活。", likes: 4, comments: ["等候楼主神贴"] }
      );
    }

    state.forumPosts.forEach((post, index) => {
      const card = document.createElement("div");
      card.className = "forum-post-card";
      card.innerHTML = `
        <div class="forum-post-header">
          <img class="comm-avatar" src="${charAvatar}" style="width:24px; height:24px;">
          <span style="font-size:11px; font-weight:700; color:#1e293b;">${charName}</span>
          <span style="font-size:10px; color:#94a3b8;">· 刚刚</span>
        </div>
        <div style="font-size:13px; font-weight:800; color:#1e293b; margin:6px 0;">${escapeHtml(post.title)}</div>
        <div class="forum-post-content">${escapeHtml(post.content.slice(0, 50))}...</div>
        <div class="forum-post-actions">
          <div class="forum-action-btn like" style="cursor:pointer;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            <span class="like-cnt">${post.likes}</span>
          </div>
          <div class="forum-action-btn comm" style="cursor:pointer;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>${post.comments.length}</span>
          </div>
        </div>
      `;

      card.querySelector(".like").onclick = (e) => {
        e.stopPropagation();
        post.likes++;
        card.querySelector(".like-cnt").innerText = post.likes;
      };

      card.onclick = () => openForumComments(content, post, charAvatar, charName, index);
      flow.appendChild(card);
    });
  }

  function openForumComments(parent, post, charAvatar, charName, index) {
    parent.innerHTML = `
      <div style="padding:16px; background:#ffffff; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px;">
          <span style="font-size:11px; color:#94a3b8;">帖子评论详情</span>
          <div style="display:flex; gap:8px;">
            <button class="btn-icon-check" id="btn-delete-this-post" style="padding:4px 8px; background:#fee2e2; color:#ef4444; border-radius:4px; font-size:11px; font-weight:700;">删除此贴</button>
            <button class="btn-icon-check" id="btn-forum-comment-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回</button>
          </div>
        </div>
        <div style="padding-bottom:14px; border-bottom:1.5px solid #f1f5f9; margin-bottom:14px; overflow-y:auto; max-height:220px;">
          <div class="forum-post-header">
            <img class="comm-avatar" src="${charAvatar}" style="width:24px; height:24px;">
            <span style="font-size:11px; font-weight:700; color:#1e293b;">${charName}</span>
          </div>
          <div style="font-size:14px; font-weight:800; color:#1e293b; margin-top:8px;">${post.title}</div>
          <div style="font-size:13px; color:#1e293b; line-height:1.6; margin-top:8px; text-align:justify; white-space:pre-wrap;">${post.content}</div>
        </div>
        <div style="font-size:11px; font-weight:700; color:#64748b; margin-bottom:8px;">评论区 (${post.comments.length})</div>
        <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;" id="forum-comment-list-box"></div>
      </div>
    `;

    parent.querySelector("#btn-forum-comment-back").onclick = () => renderForum(parent);
    
    parent.querySelector("#btn-delete-this-post").onclick = () => {
      showCustomConfirm("物理删除帖子", "确定要彻底删除该论坛匿名帖子吗？", () => {
        state.forumPosts.splice(index, 1);
        showToast("论坛帖子已彻底删除。");
        renderForum(parent);
      });
    };

    const commentBox = parent.querySelector("#forum-comment-list-box");
    post.comments.forEach((c, idx) => {
      const commItem = document.createElement("div");
      commItem.style.cssText = "background:#f8fafc; padding:10px; border-radius:8px; font-size:12px; line-height:1.4;";
      commItem.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
          <span style="font-size:10px; font-weight:700; color:#475569;">用户_匿名_${1000 + idx}</span>
          <span style="font-size:9px; color:#94a3b8;">1天前</span>
        </div>
        <div style="color:#334155;">${escapeHtml(c)}</div>
      `;
      commentBox.appendChild(commItem);
    });
  }

  // --- 浏览器子业务实体实现 ---
  function renderBrowser(content) {
    content.innerHTML = "";
    
    const searchBox = document.createElement("div");
    searchBox.className = "browser-search-box";
    searchBox.innerHTML = `
      <div class="browser-search-bar">
        <input type="text" id="browser-search-input" placeholder="输入网址或搜索关键词...">
        <button class="btn-browser-search" id="btn-browser-trigger">搜索</button>
      </div>
    `;
    content.appendChild(searchBox);

    const historyHeader = document.createElement("div");
    historyHeader.className = "setting-section-title";
    historyHeader.innerText = "历史搜索记录";
    content.appendChild(historyHeader);

    const list = document.createElement("div");
    list.className = "browser-history-list";
    content.appendChild(list);

    if (state.searchHistory.length === 0) {
      state.searchHistory = [
        "偷看微信会留下痕迹吗",
        "情绪睡眠安神片口服液",
        "失眠最长可以坚持几天",
        "极简自律作息怎么保持",
        "心理医生诊断严重吗"
      ];
    }

    const renderHistory = () => {
      list.innerHTML = "";
      state.searchHistory.forEach(h => {
        const item = document.createElement("div");
        item.className = "browser-history-item";
        item.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span class="browser-history-text">${h}</span>
        `;
        item.onclick = () => runBrowserSearch(content, h);
        list.appendChild(item);
      });
    };

    renderHistory();

    const searchInput = searchBox.querySelector("#browser-search-input");
    const searchBtn = searchBox.querySelector("#btn-browser-trigger");

    const handleSearchClick = () => {
      const q = searchInput.value.trim();
      if (!q) return;
      if (!state.searchHistory.includes(q)) {
        state.searchHistory.unshift(q);
      }
      runBrowserSearch(content, q);
    };

    searchBtn.onclick = handleSearchClick;
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') handleSearchClick();
    };
  }

  runBrowserSearch = async function(parent, query) {
    // 词条下的浏览记录懒生成并缓存：未刷新前每次进入都从 state.browserCache 取，不重调 API [6]
    const renderShell = () => {
      parent.innerHTML = `
        <div style="padding:16px; background:#f8fafc; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px; background:#fff; margin:-16px -16px 12px -16px; padding:12px 16px;">
            <span style="font-size:12px; font-weight:700; color:#1e293b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">搜索: ${escapeHtml(query)}</span>
            <button class="btn-icon-check" id="btn-browser-detail-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回</button>
          </div>
          <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:12px;" id="browser-search-results-box"></div>
        </div>
      `;
      parent.querySelector("#btn-browser-detail-back").onclick = () => renderBrowser(parent);
      return parent.querySelector("#browser-search-results-box");
    };

    const renderRecords = (box, records) => {
      box.innerHTML = "";
      records.forEach((rec, idx) => {
        const item = document.createElement("div");
        item.className = "browser-result-card";
        const bodyPreview = (rec.body || "").slice(0, 60);
        item.innerHTML = `
          <div class="res-title">${escapeHtml(rec.title || '未命名')}</div>
          <div class="res-url">https://web.secret-engine.com/search-res-${idx}</div>
          <div class="res-preview">${escapeHtml(bodyPreview)}${(rec.body || '').length > 60 ? '...' : ''}</div>
          <div class="res-meta">评论 ${rec.comments ? rec.comments.length : 0} · 已缓存</div>
        `;
        item.onclick = () => openBrowserWebpage(parent, rec, query);
        box.appendChild(item);
      });
    };

    const box = renderShell();

    // 命中缓存：直接渲染，不再调用 API [6]
    if (state.browserCache[query] && state.browserCache[query].length > 0) {
      renderRecords(box, state.browserCache[query]);
      return;
    }

    // 未命中：显示加载态，调用 API 生成 5-7 条浏览记录（含标题与正文+评论）
    box.innerHTML = `<div style="font-size:11.5px; color:#94a3b8; text-align:center; padding:20px 0;" id="browser-search-loading">AI正在即时联通引擎，生成浏览记录中...</div>`;

    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    const system = `${basePrompt}

【指令：高拟真搜索引擎检索结果生成】
现在，用户在虚拟手机浏览器上点击并搜索了词条：“${query}”。
请根据 [${charName}] (Char) 的立场心智，为该词条生成 5 到 7 条与其高度相关的浏览记录。
每条记录必须包含【标题】、【正文】（120-200字的网页/帖子正文）以及【1条评论】。
严格使用如下文字标签格式输出（每个标签独占一行，标签名后空格再跟内容）：
[条1标题] 标题内容
[条1正文] 120-200字正文
[条1评论] 一条网友评论
[条2标题] 标题2
[条2正文] 120-200字正文2
[条2评论] 评论2
...（共 5-7 条）`;

    const res = await callCheckPhoneApi(system, `对词条“${query}”生成5-7条浏览记录`, () => {
      return `[条1标题] 深度科学解析：“${query}”的底层逻辑
[条1正文] 关于“${query}”，很多人一直存在极大的误区。本文特地整理了详实的分析流数据和解答报告，从生理、心理与社会关系三个维度进行剖析。专家指出，反复检索此类词条往往反映了个体内在未被满足的情感需求，而非单纯的知识渴求。建议读者在阅读后合上屏幕，回到真实的关系里去寻找答案。
[条1评论] 写得太透彻了，每看一遍都有新的感悟。
[条2标题] 为什么有的人会高频率查找：“${query}”
[条2正文] 频繁搜索同一个关键词，背后藏着复杂的心理动因。研究显示，这通常与焦虑型依恋、隐性控制欲以及对确定性的极度渴求有关。当一个人无法从现实关系中获得足够的安全感时，便会转向信息检索来填补内心的空洞。长此以往，这种行为可能演变为一种自我强化的强迫循环。
[条2评论] 楼主分析得很准，我就是这样的。
[条3标题] 探讨：“${query}”对于日常生活作息的改变
[条3正文] 长期关注“${query}”相关内容，会潜移默化地重塑一个人的作息与思维模式。夜晚辗转难眠时翻看这类帖子，会进一步激活杏仁核，使入睡更加困难。建议在睡前两小时停止一切与此相关的检索行为，转而进行舒缓的呼吸练习或阅读纸质书籍，让神经系统逐步回归平静。
[条3评论] 亲测有效，确实该放下手机了。
[条4标题] 都市传说研究：关于“${query}”你不得不知道的真相
[条4正文] 围绕“${query}”流传着不少都市传说，其中大部分缺乏科学依据却被广泛传播。这些故事之所以动人，是因为它们精准击中了人们内心深处的恐惧与好奇。然而，将虚构当作事实去指导生活，往往会带来更大的混乱。理性分辨信息来源，是数字时代必备的素养。
[条4评论] 终于有人出来辟谣了。
[条5标题] 知乎热议：“${query}”背后的潜意识与心理学解读
[条5正文] 从精神分析的角度看，“${query}”所引发的执念，常常指向一段未被妥善处理的关系。潜意识试图通过反复检索来重新获得对局面的掌控感，却忽视了真正的疗愈发生在关系之中。承认脆弱、表达需要，往往比搜索一万次更有效。
[条5评论] 看哭了，决定今晚就和TA说开。`;
    }, { maxTokens: 2500 });

    // 解析 5-7 条浏览记录
    const records = [];
    for (let i = 1; i <= 7; i++) {
      const title = cleanTagOutput(parseTextTag(res, `条${i}标题`, `post${i}_title`));
      if (!title) break;
      const body = cleanTagOutput(parseTextTag(res, `条${i}正文`, `post${i}_content`));
      const comment = cleanTagOutput(parseTextTag(res, `条${i}评论`, `post${i}_comment`));
      records.push({
        title,
        body: body || "正文同步生成中...",
        comments: comment ? [comment] : []
      });
    }

    // 兜底：解析失败时用 5 条默认
    if (records.length === 0) {
      const defaults = [
        `深度科学解析：“${query}”的底层逻辑`,
        `为什么有的人会高频率查找：“${query}”`,
        `探讨：“${query}”对于日常生活作息的改变`,
        `都市传说研究：关于“${query}”你不得不知道的真相`,
        `知乎热议：“${query}”背后的潜意识与心理学解读`
      ];
      defaults.forEach(t => records.push({
        title: t,
        body: `关于“${query}”，本文从多个角度进行了深度剖析。反复检索此类词条往往反映个体内在未被满足的情感需求。建议读者合上屏幕，回到真实关系里寻找答案。`,
        comments: ["写得很有共鸣。"]
      }));
      console.warn('[查手机] 浏览记录标签解析失败，使用默认正文，原始返回:', res?.substring(0, 200));
    }

    // 写入缓存并持久化（刷新前不再重调） [6]
    state.browserCache[query] = records;
    await savePhoneStateToDb();

    renderRecords(box, records);
  };

  openBrowserWebpage = async function(parent, record, queryText) {
    // 直接使用缓存中的正文与评论渲染，不再调用 API [6]
    parent.innerHTML = `
      <div class="browser-webpage-view">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px;">
          <span style="font-size:10px; color:#94a3b8; font-family:monospace;">HTTPS 安全连接加密中</span>
          <button class="btn-icon-check" id="btn-webpage-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回搜索</button>
        </div>
        <div class="browser-webpage-title">${escapeHtml(record.title || '')}</div>
        <div class="browser-webpage-meta">发布时间：今天 · 阅读 ${(Math.floor(Math.random()*900)+200)} 次</div>
        <div class="browser-webpage-body" id="webpage-body-content">
          <p style="margin:0 0 12px 0; line-height:1.7; text-indent:2em;">${escapeHtml(record.body || '')}</p>
        </div>
        <div class="browser-webpage-comments">
          <div style="font-size:11px; font-weight:700; color:#64748b; margin-bottom:8px;">评论 (${record.comments ? record.comments.length : 0})</div>
          ${record.comments && record.comments.length > 0 ? record.comments.map(c => `
            <div class="browser-comment-item">
              <div style="font-size:10px; font-weight:700; color:#475569; margin-bottom:3px;">匿名网友</div>
              <div style="color:#334155;">${escapeHtml(c)}</div>
            </div>
          `).join('') : '<div style="font-size:11px; color:#cbd5e1;">暂无评论</div>'}
        </div>
        <div style="margin-top:16px; border-top:1px dashed #e2e8f0; padding-top:10px; font-size:10px; color:#cbd5e1; text-align:center;">
          本文仅代表网站作者个人观点，与本手机网络环境无关
        </div>
      </div>
    `;

    parent.querySelector("#btn-webpage-back").onclick = () => {
      // 返回搜索结果：从缓存即时渲染，不重调 API [6]
      runBrowserSearch(parent, queryText);
    };
  };

  // --- 设置子业务实体实现 ---
  renderSettings = function(content) {
    content.innerHTML = "";
    
    const wallpaperHeader = document.createElement("div");
    wallpaperHeader.className = "setting-section-title";
    wallpaperHeader.innerText = "专属桌面壁纸设置";
    content.appendChild(wallpaperHeader);

    const themeRow = document.createElement("div");
    themeRow.className = "setting-row-item";
    themeRow.innerHTML = `
      <span class="setting-row-label">上传当前角色的专属桌面壁纸</span>
      <button class="btn btn-outline" id="btn-upload-check-phone-bg" style="padding:4px 10px; font-size:11px; background:#f1f5f9; border:none; border-radius:4px; cursor:pointer; font-weight:700;">点击上传</button>
      <input type="file" id="file-check-phone-bg" accept="image/*" style="display:none;">
    `;
    content.appendChild(themeRow);

    const uploadBtn = themeRow.querySelector("#btn-upload-check-phone-bg");
    const fileInput = themeRow.querySelector("#file-check-phone-bg");

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async (event) => {
          const sess = await db.sessions.get(activeSessionId);
          if (sess) {
            localStorage.setItem(`phone_wallpaper_char_${sess.charId}`, event.target.result);
            loadCharacterWallpaper(sess.charId);
            showToast("此角色查手机专属磨砂壁纸上传并重绘成功！");
          }
        };
        reader.readAsDataURL(file);
      }
    };

    const formatHeader = document.createElement("div");
    formatHeader.className = "setting-section-title";
    formatHeader.innerText = "数据同步生成协议协议";
    content.appendChild(formatHeader);

    const formatRow = document.createElement("div");
    formatRow.className = "setting-row-item";
    formatRow.innerHTML = `
      <span class="setting-row-label">数据格式化规则切换</span>
      <select id="check-phone-format-selector" style="padding:4px 8px; font-size:11px; border-radius:6px; border:1px solid #cbd5e1; outline:none; font-weight:700;">
        <option value="text_tag" ${state.generatorFormat === 'text_tag' ? 'selected' : ''}>高兼容性文字标签 (Text Tag)</option>
        <option value="json" ${state.generatorFormat === 'json' ? 'selected' : ''}>标准 JSON 协议 (Strict JSON)</option>
      </select>
    `;
    content.appendChild(formatRow);

    formatRow.querySelector("#check-phone-format-selector").onchange = (e) => {
      state.generatorFormat = e.target.value;
      showToast("数据生成同步协议已修改。");
    };

    const refreshHeader = document.createElement("div");
    refreshHeader.className = "setting-section-title";
    refreshHeader.innerText = "多选定向生成应用控制";
    content.appendChild(refreshHeader);

    const refreshBox = document.createElement("div");
    refreshBox.style.padding = "0 16px 16px 16px";
    refreshBox.innerHTML = `
      <div style="background:#ffffff; padding:12px; border-radius:10px; border:1px solid #e2e8f0; display:flex; flex-direction:column; gap:10px; box-sizing:border-box;">
        <div style="font-size:10.5px; color:#94a3b8; font-weight:700; margin-bottom:4px;">勾选欲刷新同步内容的应用：</div>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="communication" ${state.refreshSelection.communication ? 'checked' : ''}> 通讯联络人与微信备注
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="diary" ${state.refreshSelection.diary ? 'checked' : ''}> 秘密日记本 (500字分段)
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="notes" ${state.refreshSelection.notes ? 'checked' : ''}> 备忘录草稿 (300字段落)
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="forum" ${state.refreshSelection.forum ? 'checked' : ''}> 匿名社区发帖
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="browser" ${state.refreshSelection.browser ? 'checked' : ''}> 浏览器历史搜索覆盖
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="shopping" ${state.refreshSelection.shopping ? 'checked' : ''}> 账单消费与资产随动
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="album" ${state.refreshSelection.album ? 'checked' : ''}> 相册照片同步
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="music" ${state.refreshSelection.music ? 'checked' : ''}> 伴夜音乐歌单 (含笔记)
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="monitor" ${state.refreshSelection.monitor ? 'checked' : ''}> 实时监控快照 (位置/心绪)
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#334155;">
          <input type="checkbox" class="cb-refresh-selection" data-app="files" ${state.refreshSelection.files ? 'checked' : ''}> 文件管理与私密保险箱
        </label>
        <button id="btn-settings-trigger-selective-refresh" style="width:100%; font-size:11px; padding:8px 0; border:none; border-radius:8px; cursor:pointer; background:#1e293b; color:#fff; font-weight:700; margin-top:6px;">一键刷新所勾选应用</button>
      </div>
    `;
    content.appendChild(refreshBox);

    const checkBoxes = refreshBox.querySelectorAll(".cb-refresh-selection");
    checkBoxes.forEach(cb => {
      cb.onchange = () => {
        const app = cb.getAttribute("data-app");
        state.refreshSelection[app] = cb.checked;
      };
    });

    refreshBox.querySelector("#btn-settings-trigger-selective-refresh").onclick = async () => {
      await triggerGlobalRefresh(true);
    };

    // 清空此角色手机所有数据
    const clearHeader = document.createElement("div");
    clearHeader.className = "setting-section-title";
    clearHeader.innerText = "危险操作区";
    clearHeader.style.color = "#ef4444";
    content.appendChild(clearHeader);

    const clearBox = document.createElement("div");
    clearBox.style.padding = "0 16px 16px 16px";
    clearBox.innerHTML = `
      <div style="background:#fef2f2; padding:12px; border-radius:10px; border:1px solid #fecaca; display:flex; flex-direction:column; gap:8px; box-sizing:border-box;">
        <div style="font-size:10.5px; color:#94a3b8; font-weight:700;">清空此角色手机内的所有生成数据（通讯、日记、备忘、论坛、相册、音乐、监控、购物、浏览器、文件等），不可恢复。</div>
        <button id="btn-check-phone-clear-all" style="width:100%; font-size:11px; padding:8px 0; border:none; border-radius:8px; cursor:pointer; background:#ef4444; color:#fff; font-weight:700;">清空此角色手机所有数据</button>
      </div>
    `;
    content.appendChild(clearBox);

    clearBox.querySelector("#btn-check-phone-clear-all").onclick = async () => {
      if (typeof window.showCustomConfirm === "function") {
        window.showCustomConfirm("清空确认", "确定要清空此角色手机里的所有数据吗？\n\n包括：通讯录、日记、备忘录、论坛帖子、相册、音乐、监控、购物、浏览器记录、文件管理等。\n\n此操作不可恢复！", async () => {
          // 重置内存状态为初始值
          state.userRemark = "";
          state.contacts = [];
          state.searchHistory = [];
          state.todoItems = [];
          state.diaryEntries = [];
          state.forumPosts = [];
          state.browserHistory = [];
          state.shoppingData = { cart: [], bills: [] };
          state.albumItems = [];
          state.musicPlaylist = [];
          state.monitorData = null;
          state.note = "";
          state.browserCache = {};
          state.music = [];
          state.diary = [];
          state.cart = [];
          state.bills = [];
          state.photos = [];
          state.monitor = null;
          state.files = { files: [], privateBox: [] };
          state.riskLevel = 0;
          state.appliances = [];

          // 从 IndexedDB 删除此会话的持久化记录
          try {
            await db.check_phone_states.delete(Number(activeSessionId));
          } catch(e) { console.warn("删除 IndexedDB 记录失败:", e); }

          showToast("此角色手机所有数据已清空");
          // 返回桌面首页
          state.activeApp = null;
          const screen = document.getElementById("check-phone-app-screen");
          if (screen) screen.style.display = "none";
          const desktop = document.getElementById("check-phone-desktop");
          if (desktop) desktop.style.display = "grid";
        });
      } else if (confirm("确定要清空此角色手机里的所有数据吗？此操作不可恢复！")) {
        state.contacts = [];
        state.diary = [];
        state.cart = [];
        state.bills = [];
        state.photos = [];
        state.monitor = null;
        state.files = { files: [], privateBox: [] };
        state.riskLevel = 0;
        try { await db.check_phone_states.delete(Number(activeSessionId)); } catch(e) {}
        showToast("此角色手机所有数据已清空");
        state.activeApp = null;
        const screen = document.getElementById("check-phone-app-screen");
        if (screen) screen.style.display = "none";
        const desktop = document.getElementById("check-phone-desktop");
        if (desktop) desktop.style.display = "grid";
      }
    };
  }

// --- 遥控器与联动实现 ---
  // 危险概率累积：user 冒充 char 发消息 / 动遥控器均会累积，>85 触发 char 觉察反应
  // reason 用于日志/提示；累积后自动衰减（每次 -2），避免永久满值
  async function increaseRiskLevel(delta, reason) {
    const before = state.riskLevel || 0;
    state.riskLevel = Math.min(100, before + (delta || 0));
    await savePhoneStateToDb();
    // 跨越 85 阈值时触发 char 觉察
    if (before < 85 && state.riskLevel >= 85) {
      await triggerCharAwareness(reason || "异常操作");
    }
    return state.riskLevel;
  }

  // 将 user 在查手机里的操作（冒充发消息 / 动遥控器）以系统消息形式写入聊天上下文，
  // 使后续生成的日记/备忘/监控等内容能感知这些操作，保证及时性。
  // 渲染为微信中间灰字，不冒充任何一方发言。
  // 折叠机制：每条消息带 phoneSessionId，同一次查手机会话内的所有操作折叠为一个可展开条目 [11]
  async function recordPhoneActionToContext(actionText) {
    if (!activeSessionId || !actionText) return;
    try {
      const msg = {
        sessionId: activeSessionId,
        senderType: 'system',
        senderId: 0,
        content: actionText,
        contentType: 'text',
        timestamp: Date.now(),
        isBlocked: 0,
        // 标记本次查手机会话 ID（openPhone 时生成），用于折叠渲染 [11]
        phoneSessionId: state.phoneSessionId || null,
        // 标记为查手机操作（区别于其他系统消息）[11]
        isPhoneAction: 1
      };
      await db.messages.add(msg);
      // 若聊天界面处于活跃状态，实时刷新以便灰字可见
      const panel = document.getElementById("chat-dialog-panel");
      if (panel && panel.classList.contains("active") && typeof renderDialogMessages === 'function') {
        await renderDialogMessages();
      }
    } catch (e) {
      console.warn("查手机操作写入上下文失败:", e);
    }
  }

  // 危险概率达标时 char 主动察觉并质问（区别于普通家电反应）
  async function triggerCharAwareness(reason) {
    if (!activeSessionId) return;
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    const sys = `${basePrompt}\n\n【指令：察觉异常（高优先级命令）】
你(${charName})刚刚察觉到手机/家里有被人动过的痕迹（原因：${reason}）。你的危险直觉已经累积到临界点。
请以你本人的口吻，向对方发出一句带着警觉与质问的微信台词。限 30 字以内，直接输出对白，不要任何动作描写或括号。`;

    const safeFetcher = window.fetchGeneratedCheckPhoneContent || fetchGeneratedCheckPhoneContent;
    let text = await safeFetcher(sys, "触发察觉质问", () => {
      return "我总觉得最近有人动过我的东西……是你吗？";
    });
    text = text.replace(/[\[【](QUOTE|MSG_ID|RECALL|REACT|BLOCK|UNBLOCK)[^\]】]*[\]】]/gi, "").trim();

    const msg = {
      sessionId: activeSessionId,
      senderType: 'char',
      senderId: 0,
      content: text,
      contentType: 'text',
      timestamp: Date.now(),
      isBlocked: 0
    };
    await db.messages.add(msg);
    if (document.getElementById("chat-dialog-panel") && document.getElementById("chat-dialog-panel").classList.contains("active")) {
      await renderDialogMessages();
    }
    showToast(`警告: ${charName} 察觉到了异常！`);
  }

  async function renderRemote(content) {
    content.innerHTML = "";

    // 顶部危险概率条（不显示具体数值与阈值，仅用定性状态指示）[1]
    const riskBar = document.createElement("div");
    riskBar.className = "remote-risk-bar";
    const riskPct = Math.round(state.riskLevel || 0);
    const discovered = riskPct >= 85;
    // 三段定性状态：安全 / 警惕 / 已被发现
    let statusLabel, statusColor, barWidth;
    if (discovered) {
      statusLabel = '已被发现';
      statusColor = '#ef4444';
      barWidth = 100;
    } else if (riskPct >= 50) {
      statusLabel = '对方有所警觉';
      statusColor = '#f59e0b';
      barWidth = Math.min(95, 50 + (riskPct - 50) * 0.9);
    } else {
      statusLabel = '暂时安全';
      statusColor = '#10b981';
      barWidth = Math.max(8, riskPct * 0.9);
    }
    riskBar.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:700; color:#475569; margin-bottom:6px;">
        <span>隐蔽状态</span>
        <span style="color:${statusColor}; font-weight:800;">${statusLabel}</span>
      </div>
      <div style="height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
        <div style="height:100%; width:${barWidth}%; background:${statusColor}; transition:width 0.4s;"></div>
      </div>
      <div style="font-size:9.5px; color:#94a3b8; margin-top:4px;">频繁操作会逐步暴露痕迹，请谨慎使用。</div>
    `;
    content.appendChild(riskBar);

    const grid = document.createElement("div");
    grid.className = "remote-grid";
    content.appendChild(grid);

    // 统一循环渲染 state.appliances 并实现和 check_phone_states 数据表一站式直写同步
    state.appliances.forEach((app, index) => {
      const card = document.createElement("div");
      card.className = `remote-card ${app.state === 'on' ? 'active' : ''}`;

      let extraHtml = "";
      if (app.type === "temp" && app.state === "on") {
        extraHtml = `<div style="font-size:11px; font-weight:800; color:#1e293b; margin: 4px 0;">${app.temp}°C</div>`;
      }

      card.innerHTML = `
        <div class="remote-card-header">
          <span class="remote-device-name">${escapeHtml(app.name)}</span>
          <button class="remote-del-btn" title="删除设备" data-idx="${index}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
        <div style="font-size:10px; color:#94a3b8; margin-bottom:2px;">${app.state === 'on' ? '运行中' : '已关闭'}</div>
        ${extraHtml}
        <div class="remote-actions">
          <button class="remote-action-btn toggle">${app.state === 'on' ? '关闭' : '开启'}</button>
          ${app.type === 'temp' && app.state === 'on' ? `
            <button class="remote-action-btn temp-up">加温</button>
            <button class="remote-action-btn temp-down">降温</button>
          ` : ''}
        </div>
      `;

      card.querySelector(".remote-del-btn").onclick = async (e) => {
        e.stopPropagation();
        showCustomConfirm("删除设备", `确定要删除「${app.name}」吗？`, async () => {
          state.appliances.splice(index, 1);
          await savePhoneStateToDb();
          renderRemote(content);
          showToast(`已删除设备：${app.name}`);
        });
      };

      card.querySelector(".toggle").onclick = async (e) => {
        e.stopPropagation();
        const newState = app.state === 'on' ? 'off' : 'on';
        app.state = newState;
        await savePhoneStateToDb();
        // 动遥控器：累积危险概率（开关 +8）并计入上下文
        await increaseRiskLevel(8, `动遥控器(${app.name}开关)`);
        await recordPhoneActionToContext(`[查手机] 你远程把「${app.name}」${newState === 'on' ? '打开' : '关闭'}了。`);
        renderRemote(content);
        await triggerCharReaction(app.name, app.state);
      };

      if (app.type === "temp" && app.state === "on") {
        const up = card.querySelector(".temp-up");
        const down = card.querySelector(".temp-down");
        if (up && down) {
          up.onclick = async (e) => {
            e.stopPropagation();
            app.temp = Math.min(30, app.temp + 1);
            await savePhoneStateToDb();
            await increaseRiskLevel(5, `动遥控器(${app.name}加温)`);
            await recordPhoneActionToContext(`[查手机] 你远程把「${app.name}」温度调高到 ${app.temp}°C。`);
            renderRemote(content);
            await triggerCharReaction(app.name, "temp");
          };
          down.onclick = async (e) => {
            e.stopPropagation();
            app.temp = Math.max(16, app.temp - 1);
            await savePhoneStateToDb();
            await increaseRiskLevel(5, `动遥控器(${app.name}降温)`);
            await recordPhoneActionToContext(`[查手机] 你远程把「${app.name}」温度调低到 ${app.temp}°C。`);
            renderRemote(content);
            await triggerCharReaction(app.name, "temp");
          };
        }
      }

      grid.appendChild(card);
    });

    // 1. 添加末尾家电加号占位卡片 [1]
    const addCard = document.createElement("div");
    addCard.className = "remote-card";
    addCard.style.cssText = "display:flex; align-items:center; justify-content:center; cursor:pointer; border: 1.5px dashed #cbd5e1; background:rgba(255,255,255,0.25); min-height:90px; box-sizing:border-box; border-radius:10px;";
    addCard.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;

    addCard.onclick = () => {
      const overlay = document.createElement("div");
      overlay.className = "pwa-modal-overlay show";
      overlay.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; z-index:1001; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center;";
      overlay.innerHTML = `
        <div class="pwa-modal-card" style="width: 270px; text-align: left; background:#ffffff; border-radius:12px; padding:18px; box-shadow:0 8px 24px rgba(0,0,0,0.15); box-sizing:border-box;">
          <div class="pwa-modal-title" style="text-align: center; font-size:14px; font-weight:800; color:#1e293b; margin-bottom:12px;">新增智能家电设备</div>
          <div style="font-size:11px; font-weight:700; color:#64748b; margin-bottom:6px;">家电设备名称</div>
          <input type="text" id="new-app-name" class="pwa-modal-input" style="text-align:left; margin-bottom:12px; width:100%; box-sizing:border-box; padding:8px 10px; border-radius:6px; border:1px solid #cbd5e1; outline:none; font-size:12px;" placeholder="例：加湿器">
          <div style="font-size:11px; font-weight:700; color:#64748b; margin-bottom:6px;">可控模式设定</div>
          <select id="new-app-type" class="pwa-modal-input" style="height:34px; margin-bottom:16px; width:100%; font-size:12px; font-weight:700; border-radius:6px; border:1px solid #cbd5e1; outline:none; background:#f8fafc; padding:0 6px;">
            <option value="switch">开关模式 (Toggle Switch)</option>
            <option value="temp">控温模式 (带加降温设定)</option>
          </select>
          <div class="pwa-modal-buttons" style="display:flex; gap:10px;">
            <button class="btn-pwa-modal cancel" id="btn-add-app-cancel" style="flex:1; height:34px; background:#f1f5f9; color:#64748b; border:none; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">取消</button>
            <button class="btn-pwa-modal confirm" id="btn-add-app-save" style="flex:1; height:34px; background:#1e293b; color:#ffffff; border:none; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">保存新设备</button>
          </div>
        </div>
      `;
      content.appendChild(overlay);

      overlay.querySelector("#btn-add-app-cancel").onclick = () => overlay.remove();
      overlay.querySelector("#btn-add-app-save").onclick = async () => {
        const name = overlay.querySelector("#new-app-name").value.trim();
        const type = overlay.querySelector("#new-app-type").value;
        if (!name) {
          showToast("请输入需要添加的家电设备名称！");
          return;
        }
        const appObj = {
          id: "app_" + Date.now(),
          name: name,
          state: type === 'temp' ? "on" : "off",
          type: type
        };
        if (type === 'temp') {
          appObj.temp = 24;
        }
        state.appliances.push(appObj);
        await savePhoneStateToDb();
        overlay.remove();
        await renderRemote(content);
        showToast(`已成功添加可操控新设备：${name}`);
      };
    };

    grid.appendChild(addCard);
  }

  // 遥控器单次调整不再触发 API 反应；只有危险概率跨越阈值时才由 triggerCharAwareness 调 API [1]
  async function triggerCharReaction(applianceName, action) {
    // 不再每次调整都调 API。危险概率已由 increaseRiskLevel 累积，
    // 跨越阈值时 triggerCharAwareness 会统一触发一次质问。
    return;
  }

  // --- 日记本子业务实体实现 ---
  function renderDiary(content) {
    content.innerHTML = "";
    
    const list = document.createElement("div");
    list.className = "diary-list";
    content.appendChild(list);

    if (state.diary.length === 0) {
      state.diary.push({
        id: 201,
        date: "2026年7月16日",
        weather: "阴",
        title: "执念的边界",
        content: "这是一篇默认日记。点击主页头右侧的刷新按钮，设备会自动连通 API 为您生成一篇长达 500 字、拥有细腻心流体验的角色秘密日记分段。"
      });
    }

    state.diary.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "diary-card";
      // 列表只显示摘要预览（首段前 80 字），详情才显示完整 500+ 字正文 [8]
      const excerpt = (item.content || "").replace(/\s+/g, ' ').slice(0, 80);
      const wordCount = (item.content || '').length;
      card.innerHTML = `
        <div class="diary-card-header">
          <span class="diary-date">${item.date}</span>
          <span class="diary-weather">${item.weather}</span>
        </div>
        <div class="diary-title">${escapeHtml(item.title)}</div>
        <div class="diary-excerpt">${escapeHtml(excerpt)}${wordCount > 80 ? '...' : ''}</div>
        <div class="diary-foot">
          <span class="diary-word-count">${wordCount} 字</span>
          <span class="diary-read-more">展开阅读 ›</span>
        </div>
      `;
      card.onclick = () => openDiaryDetail(content, item, index);
      list.appendChild(card);
    });
  }

  function openDiaryDetail(parent, item, index) {
    parent.innerHTML = `
      <div style="padding: 20px 16px; background: #ffffff; height: 100%; box-sizing: border-box; display: flex; flex-direction: column;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px;">
          <span style="font-size: 11px; color: #94a3b8;">${item.date} · 天气 ${item.weather}</span>
          <div style="display:flex; gap:8px;">
            <button class="btn-icon-check" id="btn-delete-this-diary" style="padding:4px 8px; background:#fee2e2; color:#ef4444; border-radius:4px; font-size:11px; font-weight:700;">删除</button>
            <button class="btn-icon-check" id="btn-diary-detail-back" style="padding: 4px 8px; background: #f1f5f9; border-radius: 4px; font-size:11px; font-weight:700;">返回</button>
          </div>
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #1e293b; margin-bottom: 12px; border-left:3px solid #1e293b; padding-left:8px;">${escapeHtml(item.title)}</div>
        <div class="diary-detail-body" style="flex:1; overflow-y:auto; font-size:14px; line-height:1.75; color:#334155; text-align:justify; white-space: pre-wrap; padding-right:4px;">
          ${escapeHtml(item.content)}
        </div>
        <div class="diary-detail-foot" style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.04); font-size:10px; color:#94a3b8; text-align:right;">共 ${item.content.length} 字</div>
      </div>
    `;

    parent.querySelector("#btn-diary-detail-back").onclick = () => renderDiary(parent);
    
    parent.querySelector("#btn-delete-this-diary").onclick = () => {
      showCustomConfirm("物理删除", "确认要彻底销毁该日记心路历程档案吗？", () => {
        state.diary.splice(index, 1);
        showToast("日记已彻底抹去销毁。");
        renderDiary(parent);
      });
    };
  }

  // --- 购物子业务实体实现 ---
  function renderShopping(content) {
    content.innerHTML = "";
    
    const tabs = document.createElement("div");
    tabs.className = "shop-tabs";
    tabs.innerHTML = `
      <div class="shop-tab active" id="shop-tab-cart">购物车</div>
      <div class="shop-tab" id="shop-tab-assets">持有资产/账单</div>
    `;
    content.appendChild(tabs);

    const subContent = document.createElement("div");
    subContent.style.flex = "1";
    content.appendChild(subContent);

    const tabCart = tabs.querySelector("#shop-tab-cart");
    const tabAssets = tabs.querySelector("#shop-tab-assets");

    if (state.cart.length === 0) {
      state.cart = [
        { name: "极简灰色保暖围巾", price: 128.00, count: 1 },
        { name: "基础心理学(精选精装版)", price: 68.00, count: 1 },
        { name: "哑光陶瓷磨砂咖啡杯", price: 45.00, count: 1 }
      ];
    }
    if (state.bills.length === 0) {
      state.bills = [
        { desc: "微信提现零钱", price: 200.00, date: "07/16" },
        { desc: "药店宁神药片代扣", price: -110.00, date: "07/15" },
        { desc: "网易云音乐黑胶VIP续费", price: -15.00, date: "07/14" },
        { desc: "打车出行路线代扣", price: -32.50, date: "07/13" },
        { desc: "超市日用百货代扣", price: -54.00, date: "07/12" }
      ];
    }

    const renderCart = () => {
      tabCart.classList.add("active");
      tabAssets.classList.remove("active");
      subContent.innerHTML = "";

      const cartList = document.createElement("div");
      cartList.className = "cart-list";
      subContent.appendChild(cartList);

      let total = 0;
      state.cart.forEach(item => {
        total += item.price * item.count;
        const div = document.createElement("div");
        div.className = "cart-item";
        div.innerHTML = `
          <div>
            <div style="font-size:12.5px; font-weight:700; color:#1e293b;">${item.name}</div>
            <div style="font-size:11px; color:#64748b; margin-top:2px;">单价: ¥${item.price.toFixed(2)}</div>
          </div>
          <div style="font-size:12px; font-weight:700; color:#334155;">数量: ${item.count}</div>
        `;
        cartList.appendChild(div);
      });

      const totalCard = document.createElement("div");
      totalCard.style.cssText = "margin: 16px; background:#fff; padding:16px; border-radius:10px; display:flex; justify-content:space-between; align-items:center; border:1px solid #e2e8f0;";
      totalCard.innerHTML = `
        <span style="font-size:12px; font-weight:700; color:#64748b;">合计金额：</span>
        <span style="font-size:15px; font-weight:800; color:#1e293b;">¥ ${total.toFixed(2)}</span>
      `;
      subContent.appendChild(totalCard);
    };

    const renderAssets = async () => {
      tabCart.classList.remove("active");
      tabAssets.classList.add("active");
      subContent.innerHTML = "";

      let baseBalance = 88888.00;
      if (window.walletSystem && window.walletSystem.getBalance) {
        baseBalance = window.walletSystem.getBalance(); 
      }
      
      const ledgerSum = state.bills.reduce((sum, b) => sum + b.price, 0);
      const computedBalance = baseBalance + ledgerSum;

      const card = document.createElement("div");
      card.className = "asset-card";
      card.innerHTML = `
        <div class="asset-label">随动计算资产余额</div>
        <div class="asset-val">¥ ${computedBalance.toFixed(2)}</div>
      `;
      subContent.appendChild(card);

      const ledgerHeader = document.createElement("div");
      ledgerHeader.className = "setting-section-title";
      ledgerHeader.innerText = "最近消费账单记录";
      subContent.appendChild(ledgerHeader);

      const billList = document.createElement("div");
      billList.className = "cart-list";
      subContent.appendChild(billList);

      state.bills.forEach(b => {
        const item = document.createElement("div");
        item.className = "cart-item";
        item.innerHTML = `
          <div>
            <div style="font-size:12px; font-weight:700; color:#1e293b;">${b.desc}</div>
            <div style="font-size:10px; color:#94a3b8; margin-top:2px;">${b.date}</div>
          </div>
          <span style="font-size:12px; font-weight:800; color:${b.price >= 0 ? '#10b981' : '#ef4444'};">
            ${b.price >= 0 ? '+' : ''}${b.price.toFixed(2)} 元
          </span>
        `;
        billList.appendChild(item);
      });
    };

    tabCart.onclick = renderCart;
    tabAssets.onclick = renderAssets;

    renderCart();
  }

  // --- 音乐子业务实体实现 ---
  // 一次返回 5-7 首歌名/作者，点击可展开卡片显示 char 的笔记心得（约300字）[9]
  function renderMusic(content) {
    content.innerHTML = "";

    const player = document.createElement("div");
    player.className = "music-playing-section";
    player.innerHTML = `
      <div class="music-vinyl-disk ${state.music.isPlaying ? 'spinning' : ''}" id="music-disc">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div style="text-align:center;">
        <div class="music-track-title" id="music-track-title">${escapeHtml(state.music.currentTrack || '尚未选择曲目')}</div>
        <div class="music-track-artist" id="music-track-artist" style="margin-top:4px;">${escapeHtml(state.music.artist || '')}</div>
      </div>
      <button class="btn btn-outline" id="btn-music-toggle-play" style="padding:6px 14px; font-size:11px; background:rgba(255,255,255,0.15); border-color:rgba(255,255,255,0.25); color:#fff; font-weight:700; border-radius:6px; cursor:pointer;">
        ${state.music.isPlaying ? '暂停放歌' : '模拟播放'}
      </button>
    `;
    content.appendChild(player);

    const toggleBtn = player.querySelector("#btn-music-toggle-play");
    const disc = player.querySelector("#music-disc");

    toggleBtn.onclick = () => {
      if (!state.music.currentTrack) {
        showToast("请先在下方歌单中选择一首歌。");
        return;
      }
      state.music.isPlaying = !state.music.isPlaying;
      disc.classList.toggle("spinning", state.music.isPlaying);
      toggleBtn.innerText = state.music.isPlaying ? '暂停放歌' : '模拟播放';
      showToast(state.music.isPlaying ? "音乐环境音伴随已开启" : "伴随播放已暂停");
      savePhoneStateToDb();
    };

    const playlistHeader = document.createElement("div");
    playlistHeader.className = "setting-section-title";
    playlistHeader.innerText = `自省深夜歌单 (${state.music.playlist.length} 首)`;
    content.appendChild(playlistHeader);

    const list = document.createElement("div");
    list.className = "music-playlist-list";
    content.appendChild(list);

    if (state.music.playlist.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:30px 16px; text-align:center; font-size:11.5px; color:#94a3b8;";
      empty.innerText = "歌单为空，点击右上角刷新可生成 5-7 首附 char 笔记的歌单。";
      list.appendChild(empty);
    }

    state.music.playlist.forEach((track, index) => {
      const card = document.createElement("div");
      card.className = "music-song-card";

      const head = document.createElement("div");
      head.className = "music-song-head";
      head.innerHTML = `
        <svg class="music-play-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <div class="music-song-meta">
          <div class="music-song-title">${escapeHtml(track.title || '未命名')}</div>
          <div class="music-song-artist">${escapeHtml(track.artist || '未知歌手')}</div>
        </div>
        <svg class="music-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
      `;

      const noteBox = document.createElement("div");
      noteBox.className = "music-song-note";
      noteBox.style.display = "none";
      noteBox.innerHTML = `
        <div class="music-note-label">Char 的听歌笔记</div>
        <div class="music-note-text">${escapeHtml(track.note || '(尚无笔记)')}</div>
      `;

      let expanded = false;
      head.onclick = () => {
        expanded = !expanded;
        noteBox.style.display = expanded ? 'block' : 'none';
        head.classList.toggle("expanded", expanded);

        // 点击歌曲同时切到当前播放曲目
        state.music.currentTrack = track.title || '';
        state.music.artist = track.artist || '';
        const titleEl = player.querySelector("#music-track-title");
        const artistEl = player.querySelector("#music-track-artist");
        if (titleEl) titleEl.innerText = track.title || '未命名';
        if (artistEl) artistEl.innerText = track.artist || '未知歌手';
        savePhoneStateToDb();
      };

      card.appendChild(head);
      card.appendChild(noteBox);
      list.appendChild(card);
    });
  }

  // --- 监控子业务实体实现 ---
  // 实时刷新 char 当前位置 / 正在做什么 / 心里想着什么 等 [5]
  function renderMonitor(content) {
    content.innerHTML = "";

    if (!state.monitor) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:60px 24px; text-align:center; color:#94a3b8; font-size:12px; line-height:1.7;";
      empty.innerHTML = `
        <div style="margin-bottom:10px;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></svg>
        </div>
        <div style="font-weight:700; color:#64748b; margin-bottom:4px;">尚未同步监控快照</div>
        <div>点击右上角刷新按钮，可生成 TA 此刻的位置、动态与心绪。</div>
      `;
      content.appendChild(empty);
      return;
    }

    const m = state.monitor;
    const timeText = m.timestamp || (m.updatedAt ? new Date(m.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '刚刚');

    // 顶部摘要卡片
    const hero = document.createElement("div");
    hero.className = "monitor-hero";

    const moodColor = (mood) => {
      if (!mood) return '#64748b';
      if (/焦虑|紧张|害怕|不安|低落|难过|痛/.test(mood)) return '#ef4444';
      if (/期待|开心|欢喜|雀跃|满足/.test(mood)) return '#10b981';
      if (/平静|淡然|安宁/.test(mood)) return '#0ea5e9';
      return '#f59e0b';
    };
    const mc = moodColor(m.mood);

    hero.innerHTML = `
      <div class="monitor-hero-top">
        <div class="monitor-hero-location">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${escapeHtml(m.location || '位置未知')}</span>
        </div>
        <span class="monitor-time">${escapeHtml(timeText)}</span>
      </div>
      <div class="monitor-activity">${escapeHtml(m.activity || '—')}</div>
      <div class="monitor-mood-tag" style="background:${mc}22; color:${mc}; border:1px solid ${mc}44;">
        ${escapeHtml(m.mood || '心绪未知')}
      </div>
    `;
    content.appendChild(hero);

    // 心绪独白卡（第一人称心里想的）
    if (m.thought) {
      const thoughtCard = document.createElement("div");
      thoughtCard.className = "monitor-block monitor-thought";
      thoughtCard.innerHTML = `
        <div class="monitor-block-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4 3 5v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3c1.5-1 3-2.5 3-5a7 7 0 0 0-7-7z"/></svg>
          <span>心里正在想着</span>
        </div>
        <div class="monitor-thought-text">"${escapeHtml(m.thought)}"</div>
      `;
      content.appendChild(thoughtCard);
    }

    // 手机状态
    if (m.phoneStatus) {
      const phoneCard = document.createElement("div");
      phoneCard.className = "monitor-block";
      phoneCard.innerHTML = `
        <div class="monitor-block-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
          <span>手机状态</span>
        </div>
        <div class="monitor-block-text">${escapeHtml(m.phoneStatus)}</div>
      `;
      content.appendChild(phoneCard);
    }
  }

  // --- 文件管理子业务实体实现 ---
  // 仿手机文件管理经典样式：文件夹列表 + 私密保险箱（查看计入上下文）[2]
  function renderFiles(content) {
    content.innerHTML = "";

    const files = state.files || { folders: [], vault: [] };

    // 空状态
    if ((!files.folders || files.folders.length === 0) && (!files.vault || files.vault.length === 0)) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:60px 24px; text-align:center; color:#94a3b8; font-size:12px; line-height:1.7;";
      empty.innerHTML = `
        <div style="margin-bottom:10px;">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style="font-weight:700; color:#64748b; margin-bottom:4px;">文件管理为空</div>
        <div>点击右上角刷新，可生成文件夹与私密保险箱内容。</div>
      `;
      content.appendChild(empty);
      return;
    }

    // 顶部存储概览条
    const overview = document.createElement("div");
    overview.className = "files-overview";
    const totalCount = (files.folders || []).reduce((sum, f) => sum + (f.count || 0), 0);
    overview.innerHTML = `
      <div class="files-overview-bar">
        <div class="files-overview-fill" style="width: 67%;"></div>
      </div>
      <div class="files-overview-text">
        <span>内部存储</span>
        <span>${totalCount} 个文件 · 128.4 GB / 256 GB</span>
      </div>
    `;
    content.appendChild(overview);

    // 文件夹列表标题
    const foldersTitle = document.createElement("div");
    foldersTitle.className = "files-section-title";
    foldersTitle.innerText = "文件夹";
    content.appendChild(foldersTitle);

    // 文件夹网格
    const folderGrid = document.createElement("div");
    folderGrid.className = "files-folder-grid";
    content.appendChild(folderGrid);

    // 文件夹 SVG 图标映射（替换 emoji 为高质量 SVG）[7]
    const folderSvgIcons = {
      "内部存储": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="6" y1="21" x2="18" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
      "下载": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      "图片": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      "视频": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
      "文档": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      "音乐": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      "聊天记录": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      "相机": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      "蓝牙": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>',
      "DCIM": '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'
    };
    const folderDefaultSvg = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

    (files.folders || []).forEach(folder => {
      const item = document.createElement("div");
      item.className = "files-folder-item";
      const iconSvg = folderSvgIcons[folder.name] || folderDefaultSvg;
      item.innerHTML = `
        <div class="files-folder-icon">${iconSvg}</div>
        <div class="files-folder-info">
          <div class="files-folder-name">${escapeHtml(folder.name)}</div>
          <div class="files-folder-count">${folder.count} 个文件</div>
        </div>
      `;
      item.onclick = () => {
        showToast(`「${folder.name}」文件夹需在真机环境打开`);
      };
      folderGrid.appendChild(item);
    });

    // 分隔线
    const divider = document.createElement("div");
    divider.className = "files-divider";
    content.appendChild(divider);

    // 私密保险箱入口
    const vaultEntry = document.createElement("div");
    vaultEntry.className = "files-vault-entry";
    const vaultCount = (files.vault || []).length;
    vaultEntry.innerHTML = `
      <div class="files-vault-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <div class="files-vault-info">
        <div class="files-vault-name">私密保险箱</div>
        <div class="files-vault-count">${vaultCount} 个隐藏文件</div>
      </div>
      <svg class="files-vault-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
    `;
    vaultEntry.onclick = () => openVaultView(content);
    content.appendChild(vaultEntry);
  }

  // 私密保险箱视图：查看隐藏文件计入上下文 [2]
  function openVaultView(parentContent) {
    const files = state.files || { vault: [] };
    const vault = files.vault || [];

    parentContent.innerHTML = "";

    // 保险箱头部
    const head = document.createElement("div");
    head.className = "vault-head";
    head.innerHTML = `
      <button class="btn-icon-check" id="btn-vault-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回</button>
      <span class="vault-head-title" style="display:flex; align-items:center; gap:4px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e293b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        私密保险箱
      </span>
      <div style="width:50px;"></div>
    `;
    parentContent.appendChild(head);

    // 绑定保险箱返回按钮（修复：之前未绑定 onclick 导致点击无反应）[4]
    head.querySelector("#btn-vault-back").onclick = () => renderFiles(parentContent);

    if (vault.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:60px 24px; text-align:center; color:#94a3b8; font-size:12px;";
      empty.innerText = "保险箱为空，刷新可生成隐藏文件。";
      parentContent.appendChild(empty);
      return;
    }

    // 文件列表
    const list = document.createElement("div");
    list.className = "vault-list";
    parentContent.appendChild(list);

    vault.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "vault-file-card";
      // 私密文件类型 SVG 图标（替换 emoji）[7]
      let typeSvg;
      if (item.type === '图片') {
        typeSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      } else if (item.type === '视频') {
        typeSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
      } else {
        typeSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
      }
      card.innerHTML = `
        <div class="vault-file-icon">${typeSvg}</div>
        <div class="vault-file-info">
          <div class="vault-file-name">${escapeHtml(item.name)}</div>
          <div class="vault-file-type">${escapeHtml(item.type)} · 点击查看</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
      `;
      card.onclick = async () => openVaultFileDetail(parentContent, item, idx);
      list.appendChild(card);
    });
  }

  // 私密文件详情：查看时计入上下文 [2]
  // 修复：先立即更新 UI 再异步写上下文，避免点击后长时间无响应 [8]
  async function openVaultFileDetail(parentContent, item, idx) {
    // 1. 先立即更新 UI（不等异步操作），保证点击即时响应
    parentContent.innerHTML = "";

    const head = document.createElement("div");
    head.className = "vault-head";
    head.innerHTML = `
      <button class="btn-icon-check" id="btn-vault-detail-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回保险箱</button>
      <span class="vault-head-title">${escapeHtml(item.name)}</span>
      <div style="width:50px;"></div>
    `;
    parentContent.appendChild(head);

    const body = document.createElement("div");
    body.className = "vault-detail-body";

    if (item.type === '图片') {
      body.innerHTML = `
        <div class="vault-image-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <div class="vault-image-desc">${escapeHtml(item.content || '')}</div>
        </div>
      `;
    } else if (item.type === '视频') {
      body.innerHTML = `
        <div class="vault-video-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          <div class="vault-video-desc">${escapeHtml(item.content || '')}</div>
        </div>
      `;
    } else {
      body.innerHTML = `
        <div class="vault-doc-body">${escapeHtml(item.content || '(文件为空)')}</div>
      `;
    }

    parentContent.appendChild(body);

    head.querySelector("#btn-vault-detail-back").onclick = () => openVaultView(parentContent);

    // 2. 异步写入上下文（不阻塞 UI 渲染）
    (async () => {
      try {
        const sess = await db.sessions.get(activeSessionId);
        const char = await db.archives.get(sess.charId);
        const charName = sess.customCharName || char?.name || "对方";
        const preview = (item.content || '').slice(0, 40);
        await recordPhoneActionToContext(`[查手机] 你打开了「${charName}」私密保险箱里的文件「${item.name}」——${item.type === '图片' ? '看到了一张' + preview : item.type === '视频' ? '看到了一段' + preview : '读到了：' + preview}…`);
      } catch (e) {
        console.warn("私密文件查看计入上下文失败:", e);
      }
    })();
  }

  function initCheckPhoneSystem() {
    const backBtn = document.getElementById("btn-check-phone-back");
    if (backBtn) {
      backBtn.onclick = () => {
        if (state.activeApp) {
          exitApp();
        } else {
          closePhone();
        }
      };
    }

    const globalRefreshBtn = document.getElementById("btn-check-phone-global-refresh");
    if (globalRefreshBtn) {
      globalRefreshBtn.onclick = async () => {
        await triggerGlobalRefresh(false); 
      };
    }

    const appIcons = document.querySelectorAll(".check-phone-app-icon");
    appIcons.forEach(icon => {
      icon.onclick = () => {
        const appName = icon.getAttribute("data-app");
        launchApp(appName);
      };
    });

    const triggerBtn = document.getElementById("btn-chat-check-phone");
    if (triggerBtn) {
      triggerBtn.onclick = (e) => {
        if (e) e.preventDefault();
        document.getElementById("chat-expand-panel").classList.remove("active");
        openPhone();
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCheckPhoneSystem);
  } else {
    initCheckPhoneSystem();
  }

  // 暴露句柄
  window.checkPhoneSystem = {
    openPhone,
    closePhone
  };
})();