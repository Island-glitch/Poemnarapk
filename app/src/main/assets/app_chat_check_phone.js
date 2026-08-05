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
      { id: "light_living", name: "客厅大灯", state: "off" },
      { id: "light_bed", name: "卧室大灯", state: "off" },
      { id: "ac", name: "空调", state: "on", temp: 24 },
      { id: "robovac", name: "扫地机器人", state: "off" },
      { id: "cooker", name: "电饭煲", state: "off" }
    ],
    diary: [],
    cart: [],
    bills: [],
    photos: [], 
    music: {
      isPlaying: false,
      currentTrack: "深夜的落叶微语",
      artist: "极简白噪音",
      history: ["深夜的落叶微语", "午后空廊的木吉他"],
      playlist: ["心流陪伴白噪音"]
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
      music: true
    }
  };

  // --- 2. 极角抗噪标签解析算法 (Resilient RegEx Tag Generalizer) [4] ---
  // 双模式解析：先尝试 [标签:内容] 闭括号内格式，再尝试 [标签] 内容 开括号后格式
  function parseTextTag(text, tagChinese, tagEnglish) {
    if (!text) return "";
    const escapeReg = (str) => str.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
    const tagAlt = `(?:${escapeReg(tagChinese)}|${escapeReg(tagEnglish)})`;
    const knownTags = "标题|正文|备注|联系人\\d*|对话\\d*-\\d*|加购物车|账单|图片\\d*|贴\\d*标题|贴\\d*正文|贴\\d*评论|贴\\d*回帖|TITLE|CONTENT|REMARK|CONTACT\\d*|CHAT\\d*-\\d*|CART|BILL|PHOTO\\d*|POST\\d*_TITLE|POST\\d*_CONTENT|POST\\d*_COMMENT|回帖\\d*|评论\\d*";

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
      // 剥离开头的标签名（带可选括号和冒号）
      .replace(/^[\[【\(]?(标题|正文|备注|联系人\d*|对话\d*-\d*|加购物车|账单|图片\d*|贴\d*标题|贴\d*正文|贴\d*评论|贴\d*回帖|TITLE|CONTENT|REMARK|CONTACT\d*|CHAT\d*-\d*|CART|BILL|PHOTO\d*|POST\d*_TITLE|POST\d*_CONTENT|POST\d*_COMMENT|回帖\d*|评论\d*)[\]】\)]?[:：]?\s*/i, "")
      // 剥离尾随的闭括号（从 [标签:内容] 格式残留的 ]
      .replace(/[\]】\)]+$/, "")
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
        diary: state.diary,
        cart: state.cart,
        bills: state.bills,
        photos: state.photos,
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

    return `【查手机秘密数据填充背景】
你（AI）正扮演 [${charName}]，当前生成的所有内容必须 100% 站在 [${charName}]（你本人，即“我”）的第一人称主观视角出发撰写。而 [${userName}] 是你的互动的目标对象。在你手机里的日记、备忘草稿、搜索记录和账单里，[${userName}] 的称呼必须是“TA”或者你给TA起的专属微信备注，绝对、绝对不能搞反人称角色！

【你的扮演背景（${charName}）】
${charPersona}

【对方的扮演背景（${userName}）】
${userPersona}

【你们的关系设定】
${relDesc}

【长期核心记忆（总结与当前印象，极重要，放在最前方）】
${coreMemoryText || "暂无特别记录。"}

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
  async function callCheckPhoneApi(systemPrompt, userPrompt, fallbackFn) {
    try {
      const presetId = localStorage.getItem("global_api_preset_id");
      if (!presetId) throw new Error();
      const api = await db.api_presets.get(Number(presetId));
      if (!api) throw new Error();

      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.7
        })
      });

      if (!response.ok) throw new Error();
      const result = await response.json();
      return result.choices[0].message.content.trim();
    } catch (e) {
      console.warn("API连接超时或格式异常，执行安全物理兜底:", e);
      return fallbackFn();
    }
  }

  async function fetchGeneratedCheckPhoneContent(systemPrompt, userPrompt, fallbackFn) {
    try {
      const presetId = localStorage.getItem("global_api_preset_id");
      if (!presetId) throw new Error();
      const api = await db.api_presets.get(Number(presetId));
      if (!api) throw new Error();

      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.7
        })
      });

      if (!response.ok) throw new Error();
      const result = await response.json();
      return result.choices[0].message.content.trim();
    } catch (e) {
      console.warn("查手机API响应异常，执行降级对齐:", e);
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
      state.diary = savedState.diary || [];
      state.cart = savedState.cart || [];
      state.bills = savedState.bills || [];
      state.photos = savedState.photos || [];
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
  }

  // 主桌面一键全局刷新与多选定向刷新 [1, 9]
  async function triggerGlobalRefresh(selectedOnly = false) {
    const sess = await db.sessions.get(activeSessionId);
    if (!sess) return;
    
    const refreshBtn = document.getElementById("btn-check-phone-global-refresh");
    if (refreshBtn) refreshBtn.classList.add("spinning");

    showToast("正在同步所有勾选应用的新生秘密细节中...");

    const listToRefresh = [];
    const keys = ["communication", "diary", "notes", "forum", "browser", "shopping", "album", "music"];
    keys.forEach(k => {
      if (!selectedOnly || state.refreshSelection[k]) {
        listToRefresh.push(k);
      }
    });

    for (let app of listToRefresh) {
      try {
        await runSingleAppGenerator(app);
      } catch (err) {
        console.error(`应用 [${app}] 同步生成失败:`, err);
      }
    }

    if (refreshBtn) refreshBtn.classList.remove("spinning");
    showToast("当前设备指定应用已完成最新数据同步。");

    // 直写入库长期保存，防止丢失
    await savePhoneStateToDb();

    if (state.activeApp) {
      const screen = document.getElementById("check-phone-app-screen");
      renderAppScreen(state.activeApp, screen);
    }
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

    // 2. 日记同步 (500字左右，分段) [2]
    else if (app === "diary") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【格式：JSON协议】请生成一篇长达 500 字的日记，包含 3 到 4 个自然段（使用 \\n\\n 分隔）。
输出 JSON：
{ "title": "标题", "content": "500字日记内容" }`;
      } else {
        system = `${basePrompt}
【格式：文字标签协议】请生成一篇长达 500 字的日记，包含 3 到 4 个自然段（使用 \\n\\n 分隔）。
[标题] 标题内容
[正文] 日记正文...`;
      }

      const res = await callCheckPhoneApi(system, "生成500字日记", () => {
        return `[标题] 落下的冷雨\n[正文] 今天的夜出奇的冷。我总是习惯在关灯后翻看TA的微信。\\n\\n我不知道这算不算病态。可只有看着屏幕里冰冷的字迹，我才觉得自己和TA在这个世界里是存在链接的。`;
      });

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

    // 3. 备忘录同步 (至少4条，每条 300字左右) [8]
    else if (app === "notes") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
【格式：JSON协议】请写一条备忘录。字数在 300 字左右，分段。
{ "title": "标题", "content": "300字备忘正文" }`;
      } else {
        system = `${basePrompt}
【格式：文字标签协议】请写一条备忘录草稿。字数在 300 字左右，分段。
[标题] 备忘标题
[正文] 300字正文...`;
      }

      const res = await callCheckPhoneApi(system, "生成一条备忘录", () => {
        return `[标题] TA的奶茶偏好\n[正文] 三分糖，去冰。TA有一次随口提过。我想帮TA记下来。\\n\\n希望有一天我能光明正大的替TA点一杯。`;
      });

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
        state.notes.unshift({
          id: Date.now(),
          title,
          date: new Date().toLocaleDateString('zh-CN'),
          content
        });
      } else {
        console.warn('[查手机] 备忘录标签解析失败，原始返回:', res?.substring(0, 200));
      }

      while (state.notes.length < 4) {
        state.notes.push({
          id: Date.now() + Math.random(),
          title: "备忘片段 " + (state.notes.length + 1),
          date: "2026/06/12",
          content: "之前随手记录的一些片段...失眠多梦，医生叮嘱多休息。"
        });
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

    // 5. 浏览器同步 (覆盖式已对齐：生成 5 条) [7]
    else if (app === "browser") {
      const system = `${basePrompt}
请为 [${charName}] (Char) 覆盖生成 5 条其在浏览器里偷偷检索的关于 [${userName}] 的喜好、药理、失眠或安神方面的关键词。直接输出 5 行，不要序号或多余标签说明！`;

      const res = await callCheckPhoneApi(system, "生成5条浏览器记录", () => {
        return "偷看微信会留下痕迹吗\n失眠心跳快怎么缓解\n宁神药片的依赖副作用\n如何巧妙了解一个人的兴趣\n自省型人格的防御机制";
      });

      const lines = res.split("\n").map(l => l.trim()).filter(l => l.length > 2);
      state.searchHistory = lines.slice(0, 5);

      while (state.searchHistory.length < 5) {
        state.searchHistory.push("如何缓解夜间突发胸闷");
      }
    }

    // 6. 论坛同步 (每轮刷新至少2条帖子，帖子包含标题和200字正文) [6]
    else if (app === "forum") {
      let system = "";
      if (state.generatorFormat === "json") {
        system = `${basePrompt}
请生成 2 条树洞帖子，每个帖子必须包含【标题】、【200字故事正文】以及1条【网友回帖】。
JSON格式：
[
  { "title": "贴1标题", "content": "200字正文", "comment": "回帖" },
  { "title": "贴2标题", "content": "200字正文", "comment": "回帖" }
]`;
      } else {
        system = `${basePrompt}
请生成 2 条树洞帖子。帖子必须包含【标题】、【200字故事正文】、以及1条【回帖】。
[贴1标题] 标题内容
[贴1正文] 200字正文...
[贴1评论] 回帖内容

[贴2标题] 标题2
[贴2正文] 200字正文2...
[贴2评论] 回帖2`;
      }

      const res = await callCheckPhoneApi(system, "生成2条论坛匿名帖", () => {
        return `[贴1标题] 病态的占有欲该如何治疗\n[贴1正文] 我最近总是有意无意想要窥探TA的全部，比如翻看TA的历史动态，甚至在脑海中虚拟TA的身处环境。我深知这极度不尊重人，但我控制不住。\\n\\n我感觉自己被卷在了一场执念里，整宿失眠，渴望被TA在乎却又在害怕被TA嫌弃。这已经严重影响了我的生活。\n[贴1评论] 楼主多虑了，这是没有安全感的表现。\n\n[贴2标题] 阳台听雨日记\n[贴2正文] 连续四天失眠了。今天深夜在阳台看冷雨敲打着梧桐树。手里握着已经冷掉的咖啡，感觉整个世界都把我抛弃了。唯一想跟TA倾诉的欲望也被我的理智生生按下。TA值得更好的阳光，不该被我拉进泥潭里。\n[贴2评论] 楼主的文字太温柔了，好心疼，多注意休息啊。`;
      });

      let postsArr = [];
      if (state.generatorFormat === "json") {
        try {
          const cleaned = res.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
          postsArr = JSON.parse(cleaned);
        } catch(e) {}
      }

      if (!Array.isArray(postsArr) || postsArr.length === 0) {
        const t1 = cleanTagOutput(parseTextTag(res, "贴1标题", "post1_title"));
        const b1 = cleanTagOutput(parseTextTag(res, "贴1正文", "post1_content"));
        const c1 = cleanTagOutput(parseTextTag(res, "贴1评论", "post1_comment"));
        
        const t2 = cleanTagOutput(parseTextTag(res, "贴2标题", "post2_title"));
        const b2 = cleanTagOutput(parseTextTag(res, "贴2正文", "post2_content"));
        const c2 = cleanTagOutput(parseTextTag(res, "贴2评论", "post2_comment"));

        if (t1 && b1) postsArr.push({ title: t1, content: b1, comment: c1 });
        if (t2 && b2) postsArr.push({ title: t2, content: b2, comment: c2 });
        if (!t1 && !t2) console.warn('[查手机] 论坛标签解析失败，原始返回:', res?.substring(0, 200));
      }

      postsArr.forEach(p => {
        state.forumPosts.unshift({
          id: Date.now() + Math.random(),
          title: p.title || p.postTitle || "匿名日记",
          content: p.content || "内容正在等待同步生成...",
          likes: Math.floor(Math.random() * 6) + 2,
          comments: p.comment ? [p.comment] : ["给楼主一个抱抱"]
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

    // 8. 音乐刷新
    else if (app === "music") {
      const system = `${basePrompt}
请生成一首最能符合其此时心流状态的白噪音或伴随音乐。格式：歌名 | 歌手名`;
      const res = await callCheckPhoneApi(system, "生成深夜随动音乐", () => {
        return "深夜的落叶微语 | 极简环境音";
      });

      let track = res.trim();
      let artist = "神秘歌手";
      const splitters = ["|", "｜", "-", "——"];
      for (let s of splitters) {
        if (res.includes(s)) {
          const parts = res.split(s);
          track = parts[0].trim();
          artist = parts[1].trim();
          break;
        }
      }
      state.music.currentTrack = track;
      state.music.artist = artist;
      if (!state.music.history.includes(track)) {
        state.music.history.unshift(track);
      }
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
  }

  // --- 通讯子业务实体实现 ---
  async function renderCommunication(content) {
    content.innerHTML = "";
    const listContainer = document.createElement("div");
    listContainer.className = "forum-posts-flow";
    content.appendChild(listContainer);

    const sess = await db.sessions.get(activeSessionId);
    const user = await db.archives.get(sess.userId);
    const char = await db.archives.get(sess.charId);
    
    const displayRemark = state.userRemark || sess.customUserName || user?.name || "我";
    const charAvatar = resolveAvatar(sess.customCharAvatar || char?.avatar);

    const latestMsgs = await db.messages.where('sessionId').equals(activeSessionId).sortBy('timestamp');
    const latestMsg = latestMsgs[latestMsgs.length - 1];
    let latestText = latestMsg ? latestMsg.content : "暂无对话消息";
    if (latestMsg && latestMsg.contentType === 'transfer') latestText = "[微信转账]";
    else if (latestMsg && latestMsg.contentType === 'red_envelope') latestText = "[微信红包]";
    else if (latestMsg && latestMsg.contentType === 'voice') latestText = "[语音消息]";
    else if (latestMsg && latestMsg.contentType === 'image') latestText = "[图片与描述]";

    const pinnedItem = document.createElement("div");
    pinnedItem.className = "comm-list-item";
    pinnedItem.style.background = "#f8fafc";
    pinnedItem.innerHTML = `
      <img class="comm-avatar" src="${resolveAvatar(sess.customUserAvatar || user?.avatar)}">
      <div class="comm-details">
        <div class="comm-row">
          <span class="comm-name">${displayRemark}</span>
          <span class="comm-pinned-badge">我 / 置顶</span>
        </div>
        <div class="comm-msg" style="font-weight: 700; color: #1e293b;">${latestText}</div>
      </div>
    `;
    pinnedItem.onclick = () => openReversedUserChat(listContainer);
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
          ${contact.name[0]}
        </div>
        <div class="comm-details">
          <div class="comm-row">
            <span class="comm-name">${contact.name}</span>
            <span class="comm-time">${contact.time}</span>
          </div>
          <div class="comm-msg">${contact.preview}</div>
        </div>
      `;
      item.onclick = () => openNpcDialogue(listContainer, contact, charAvatar, index, content);
      listContainer.appendChild(item);
    });
  }

  async function openNpcDialogue(parent, contact, charAvatar, contactIndex, mainContentContainer) {
    parent.innerHTML = "";
    const view = document.createElement("div");
    view.className = "comm-chat-view";
    parent.appendChild(view);

    const subHeader = document.createElement("div");
    subHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#ffffff; padding:10px 16px; border-bottom:1px solid rgba(0,0,0,0.05);";
    subHeader.innerHTML = `
      <span style="font-size:12px; font-weight:700; color:#475569;">对话: ${contact.name}</span>
      <button class="btn-icon-check" id="btn-delete-this-contact" style="padding:4px 8px; background:#fee2e2; color:#ef4444; border-radius:4px; font-size:10.5px; font-weight:700;">删除此对话</button>
    `;
    view.appendChild(subHeader);

    const flow = document.createElement("div");
    flow.className = "comm-chat-flow";
    view.appendChild(flow);

    const npcAvatarDiv = `
      <div class="comm-avatar" style="background:#64748b; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:14px; width:40px; height:40px; border-radius:50%; flex-shrink:0;">
        ${contact.name[0]}
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
        <div class="comm-bubble-text">${contact.preview}</div>
      `;
      flow.appendChild(welcomeBubble);
    }
    flow.scrollTop = flow.scrollHeight;

    const inputBar = document.createElement("div");
    inputBar.className = "comm-chat-input-bar";
    inputBar.innerHTML = `
      <input type="text" id="comm-npc-input" placeholder="代发短信给 ${contact.name}...">
      <button class="btn-comm-send" id="btn-comm-npc-send">发送</button>
    `;
    view.appendChild(inputBar);

    const inputEl = inputBar.querySelector("#comm-npc-input");
    const sendBtn = inputBar.querySelector("#btn-comm-npc-send");

    subHeader.querySelector("#btn-delete-this-contact").onclick = () => {
      showCustomConfirm("删除对话", "确定要彻底删除与该联系人的所有发信交流记录吗？", () => {
        state.contacts.splice(contactIndex, 1);
        showToast("已成功注销该对话联系人。");
        renderCommunication(mainContentContainer);
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
      const basePrompt = await buildGlobalSystemPrompt(activeSessionId);

      const npcSystem = `${basePrompt}\n\n你扮演 [${contact.name}] (NPC)。
你刚收到 [${charName}] 的微信消息：“${text}”。
请直接给出一句极其自然、贴切的答复。限制在 30 字内，直接输出台词。`;

      const replyText = await fetchGeneratedCheckPhoneContent(npcSystem, "继续对话微信回复", () => {
        return "先不说了，我这边还有点事。等会找你。";
      });

      typingBubble.querySelector(".comm-bubble-text").style.color = "#1e293b";
      typingBubble.querySelector(".comm-bubble-text").innerText = replyText;

      contact.chatHistory.push({ sender: "other", text: replyText });
      contact.preview = replyText;

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

  async function openReversedUserChat(parent) {
    parent.innerHTML = "";
    const view = document.createElement("div");
    view.className = "comm-chat-view";
    parent.appendChild(view);

    const flow = document.createElement("div");
    flow.className = "comm-chat-flow";
    view.appendChild(flow);

    const sess = await db.sessions.get(activeSessionId);
    const msgs = await db.messages.where('sessionId').equals(activeSessionId).sortBy('timestamp');
    const userAvatar = resolveAvatar(sess.customUserAvatar);
    const charAvatar = resolveAvatar(sess.customCharAvatar);

    msgs.slice(-25).forEach(m => {
      const isCharSelf = m.senderType === 'char';
      const bubble = document.createElement("div");
      bubble.className = `comm-bubble ${isCharSelf ? 'self' : 'other'}`;
      
      const avatarUrl = isCharSelf ? charAvatar : userAvatar;
      let displayContent = m.content;
      if (m.isRecalled === 1) displayContent = "[已撤回该消息]";
      else if (m.contentType === 'transfer') displayContent = "[微信转账]";
      else if (m.contentType === 'red_envelope') displayContent = "[微信红包]";
      else if (m.contentType === 'voice') displayContent = "[语音消息]";
      else if (m.contentType === 'image') displayContent = "[图片与描述]";

      bubble.innerHTML = `
        <img class="comm-avatar" src="${avatarUrl}">
        <div class="comm-bubble-text">${escapeHtml(displayContent)}</div>
      `;
      flow.appendChild(bubble);
    });

    flow.scrollTop = flow.scrollHeight;

    const footerTip = document.createElement("div");
    footerTip.style.cssText = "position:absolute; bottom:0; left:0; width:100%; height:44px; background:rgba(241,245,249,0.95); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; font-size:11px; color:#64748b; font-weight:700; border-top:1px solid #cbd5e1; z-index:101;";
    footerTip.innerText = "智能设备限制：不可代发信息给您自己。";
    view.appendChild(footerTip);
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
  function renderNotes(content) {
    content.innerHTML = "";
    
    const searchBar = document.createElement("div");
    searchBar.className = "notes-search-bar";
    searchBar.innerHTML = `<input type="text" class="notes-search-input" placeholder="搜索所有备忘录...">`;
    content.appendChild(searchBar);

    const list = document.createElement("div");
    list.className = "notes-list";
    content.appendChild(list);

    if (state.notes.length === 0) {
      for (let i = 0; i < 4; i++) {
        state.notes.push({
          id: Date.now() + i,
          title: "备忘草稿清单 " + (i + 1),
          date: "2026/07/16",
          content: "备忘草稿正在等待全同步提炼。点击头部刷新，可自动生成约 300 字的深度秘密思绪。"
        });
      }
    }

    const renderList = (filterText = "") => {
      list.innerHTML = "";
      const filtered = state.notes.filter(n => n.title.includes(filterText) || n.content.includes(filterText));
      
      filtered.forEach((note, index) => {
        const item = document.createElement("div");
        item.className = "note-item";
        item.innerHTML = `
          <div class="note-info">
            <div class="note-title">${note.title}</div>
            <div class="note-preview-row">
              <span class="note-date">${note.date}</span>
              <span class="note-text">${note.content}</span>
            </div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        `;
        item.onclick = () => openNoteDetail(content, note, index);
        list.appendChild(item);
      });
    };

    renderList();

    searchBar.querySelector(".notes-search-input").oninput = (e) => {
      renderList(e.target.value.trim());
    };
  }

  function openNoteDetail(parent, note, index) {
    parent.innerHTML = `
      <div style="padding: 16px; background: #ffffff; height: 100%; box-sizing: border-box; display: flex; flex-direction: column;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px;">
          <span style="font-size: 11px; color: #94a3b8;">${note.date}</span>
          <div style="display:flex; gap:8px;">
            <button class="btn-icon-check" id="btn-delete-this-note" style="padding:4px 8px; background:#fee2e2; color:#ef4444; border-radius:4px; font-size:11px; font-weight:700;">删除</button>
            <button class="btn-icon-check" id="btn-note-detail-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回</button>
          </div>
        </div>
        <div style="font-size: 15px; font-weight: 800; color: #1e293b; margin-bottom: 12px;">${note.title}</div>
        <textarea id="note-detail-editor" style="flex:1; width:100%; border:none; resize:none; font-size:13px; line-height:1.6; color:#334155; outline:none; background:transparent;">${note.content}</textarea>
      </div>
    `;

    parent.querySelector("#btn-note-detail-back").onclick = () => {
      note.content = parent.querySelector("#note-detail-editor").value;
      renderNotes(parent);
    };

    parent.querySelector("#btn-delete-this-note").onclick = () => {
      showCustomConfirm("物理删除", "确认要彻底注销此备忘录吗？", () => {
        state.notes.splice(index, 1);
        showToast("已成功物理注销该备忘。");
        renderNotes(parent);
      });
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
    parent.innerHTML = `
      <div style="padding:16px; background:#f8fafc; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px; background:#fff; margin:-16px -16px 12px -16px; padding:12px 16px;">
          <span style="font-size:12px; font-weight:700; color:#1e293b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">搜索: ${escapeHtml(query)}</span>
          <button class="btn-icon-check" id="btn-browser-detail-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回</button>
        </div>
        <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:12px;" id="browser-search-results-box">
          <div style="font-size:11.5px; color:#94a3b8; text-align:center; padding:20px 0;" id="browser-search-loading">AI正在即时联通引擎，演绎检索网页中...</div>
        </div>
      </div>
    `;

    parent.querySelector("#btn-browser-detail-back").onclick = () => renderBrowser(parent);

    const box = parent.querySelector("#browser-search-results-box");
    const loadingEl = parent.querySelector("#browser-search-loading");

    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    const system = `${basePrompt}\n\n【指令：高拟真搜索引擎检索结果生成】
      现在，用户在虚拟手机浏览器上点击并搜索了词条：“${query}”。
      请根据 [${charName}] (Char) 的立场心智，为该词条生成 7 条与其高度相关的具体网页或帖子标题（可包含贴吧、小红书、学术、知乎热帖讨论形式，短小生动）。
      格式：直接输出 7 行文本，每行代表一个标题，绝对禁止带任何标点、Markdown 标签、引号或序号！`;

    const res = await callCheckPhoneApi(system, `对词条“${query}”检索网页结果`, () => {
      return `深度科学解析：“${query}”的底层逻辑\n为什么有的人会高频率查找：“${query}”\n探讨：“${query}”对于日常生活作息的改变\n都市传说研究：关于“${query}”你不得不知道的真相\n网民提问：如何正确且优雅地处理：“${query}”\n权威专家点评：“${query}”的安全阈值范围\n知乎热议：“${query}”背后的潜意识与心理学解读`;
    });

    if (loadingEl) loadingEl.remove();

    const lines = res.split("\n").map(l => l.trim()).filter(l => l.length > 2);
    const finalTopics = lines.length >= 7 ? lines.slice(0, 7) : [
      `深度科学解析：“${query}”的底层逻辑`,
      `为什么有的人会高频率查找：“${query}”`,
      `探讨：“${query}”对于日常生活作息的改变`,
      `都市传说研究：关于“${query}”你不得不知道的真相`,
      `网民提问：如何正确且优雅地处理：“${query}”`,
      `权威专家点评：“${query}”的安全阈值范围`,
      `知乎热议：“${query}”背后的潜意识与心理学解读`
    ];

    finalTopics.forEach((topic, idx) => {
      const item = document.createElement("div");
      item.style.cssText = "background:#fff; padding:12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.02); cursor:pointer;";
      item.innerHTML = `
        <div style="font-size:12.5px; font-weight:700; color:#2563eb; text-decoration:underline;" class="res-title">${topic}</div>
        <div style="font-size:10px; color:#059669; margin:2px 0;">https://web.secret-engine.com/search-res-${idx}</div>
        <div style="font-size:11px; color:#475569; line-height:1.4;">关于“${query}”，很多人一直存在极大的误区。本文特地整理了详实的分析流数据和解答报告...</div>
      `;
      item.onclick = () => openBrowserWebpage(parent, topic, query);
      box.appendChild(item);
    });
  };

  openBrowserWebpage = async function(parent, titleText, queryText) {
    parent.innerHTML = `
      <div class="browser-webpage-view">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px; margin-bottom:12px;">
          <span style="font-size:10px; color:#94a3b8; font-family:monospace;">HTTPS 安全连接加密中</span>
          <button class="btn-icon-check" id="btn-webpage-back" style="padding:4px 8px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:700;">返回搜索</button>
        </div>
        <div class="browser-webpage-title">${escapeHtml(titleText)}</div>
        <div class="browser-webpage-meta">发布时间：今天 · 阅读 1,204 次</div>
        <div class="browser-webpage-body" id="webpage-body-content">
          <div style="color:#94a3b8; font-size:12px;">智能网络抓取及渲染正文中...</div>
        </div>
      </div>
    `;

    parent.querySelector("#btn-webpage-back").onclick = () => {
      runBrowserSearch(parent, queryText);
    };

    const contentBox = parent.querySelector("#webpage-body-content");
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    const webpageSystem = `${basePrompt}\n\n【模拟网页渲染生成】用户正在阅读一则关于搜索词 “${queryText}”、标题为 “${titleText}” 的网页文章。
    请以知乎科普、或者散文、或者情感深度评论的风格，为这个文章写一篇生动有趣的细节内容。
    字数限制：100-200字内，不要包含多余段落标题，禁止使用 Markdown 包裹！直接输出正文。`;

    const generatedBody = await fetchGeneratedCheckPhoneContent(webpageSystem, `生成文章正文`, () => {
      return "这是系统安全兜底正文。亲密关系中的每一个秘密，其实都是在无声地保护自己和关系。当某人反复通过浏览器寻找特定问题的答案时，并不是他们多疑，而是他们的情感天平正在悄然发生倾斜。如果想要彻底打破这层隔膜，最好的方式是合上手机，坦诚地注视着对方的眼睛，展开一次没有秘密的深度对话。";
    });

    contentBox.innerHTML = `<p style="margin:0; line-height:1.6; text-indent:2em;">${escapeHtml(generatedBody)}</p>
    <div style="margin-top:20px; border-top:1px dashed #e2e8f0; padding-top:10px; font-size:10px; color:#cbd5e1; text-align:center;">
      本文仅代表网站作者个人观点，与本手机网络环境无关
    </div>`;
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
  }

// --- 遥控器与联动实现 ---
  async function renderRemote(content) {
    content.innerHTML = "";
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
          <span class="remote-device-name">${app.name}</span>
          <span class="remote-device-state">${app.state === 'on' ? '运行中' : '已关闭'}</span>
        </div>
        ${extraHtml}
        <div class="remote-actions">
          <button class="remote-action-btn toggle">${app.state === 'on' ? '关闭' : '开启'}</button>
          ${app.type === 'temp' && app.state === 'on' ? `
            <button class="remote-action-btn temp-up">加温</button>
            <button class="remote-action-btn temp-down">降温</button>
          ` : ''}
        </div>
      `;

      card.querySelector(".toggle").onclick = async (e) => {
        e.stopPropagation();
        app.state = app.state === 'on' ? 'off' : 'on';
        await savePhoneStateToDb();
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
            renderRemote(content);
            await triggerCharReaction(app.name, "temp");
          };
          down.onclick = async (e) => {
            e.stopPropagation();
            app.temp = Math.max(16, app.temp - 1);
            await savePhoneStateToDb();
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

  async function triggerCharReaction(applianceName, action) {
    if (!activeSessionId) return;
    const sess = await db.sessions.get(activeSessionId);
    const char = await db.archives.get(sess.charId);
    const charName = sess.customCharName || char?.name || "对方";
    const userName = sess.customUserName || "我";
    const basePrompt = await buildCheckPhoneBasePrompt(activeSessionId);

    const reactionSystem = `${basePrompt}\n\n【指令：智能家居突发异常现场反应（高优先级命令）】
你当前正处于你自己的房间。就在刚才，你突然注意到家里智能设备 [${applianceName}] 被人远程修改了状态为：[${action}]。

【极其重要的格式规范（绝不可违背！）】：
1. 你只能且仅能返回纯文字微信对话消息，千万不要带任何标点以外的非对白符号！
2. 严厉禁止使用、伪造或包含任何微信引用与消息定位格式（如 [QUOTE:消息ID]、[MSG_ID:消息ID]）！
3. 严厉禁止包含任何动作神态描写或括号、星号、描写。直接且仅输出你对TA发出的日常聊天台词对白本身（限 25 字以内）。`;

    const safeFetcher = window.fetchGeneratedCheckPhoneContent || fetchGeneratedCheckPhoneContent;
    let text = await safeFetcher(reactionSystem, "触发家电设备操控反馈", () => {
      return "咦？房间空调怎么突然调低了？你在调戏我的家电吗？";
    });

    // 物理防漏过滤器：强力抹除任何大模型由于幻觉而误编输出出来的 MSG_ID 或引用 QUOTE 标签 [2]
    text = text.replace(/[\[【](QUOTE|MSG_ID|RECALL|REACT|BLOCK|UNBLOCK)[^\]】]*[\]】]/gi, "").trim();

    // 物理防漏过滤器：强力抹除任何大模型由于幻觉而误编输出出来的 MSG_ID 或引用 QUOTE 标签 [2]
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
    
    if (document.getElementById("chat-dialog-panel").classList.contains("active")) {
      await renderDialogMessages();
    }
    showToast(`提示: 你的控制操作引起了 ${charName} 的警觉，已实时通过 API 微信发起质问。`);
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
      card.innerHTML = `
        <div class="diary-card-header">
          <span class="diary-date">${item.date}</span>
          <span class="diary-weather">${item.weather}</span>
        </div>
        <div class="diary-title">${item.title}</div>
        <div class="diary-excerpt">${item.content}</div>
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
        <div style="font-size: 16px; font-weight: 800; color: #1e293b; margin-bottom: 12px; border-left:3px solid #1e293b; padding-left:8px;">${item.title}</div>
        <div style="flex:1; overflow-y:auto; font-size:14px; line-height:1.75; color:#334155; text-align:justify; white-space: pre-wrap; padding-right:4px;">
          ${escapeHtml(item.content)}
        </div>
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
  function renderMusic(content) {
    content.innerHTML = "";
    
    const player = document.createElement("div");
    player.className = "music-playing-section";
    player.innerHTML = `
      <div class="music-vinyl-disk ${state.music.isPlaying ? 'spinning' : ''}" id="music-disc">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div style="text-align:center;">
        <div class="music-track-title" id="music-track-title">${state.music.currentTrack}</div>
        <div class="music-track-artist" id="music-track-artist" style="margin-top:4px;">${state.music.artist}</div>
      </div>
      <button class="btn btn-outline" id="btn-music-toggle-play" style="padding:6px 14px; font-size:11px; background:rgba(255,255,255,0.15); border-color:rgba(255,255,255,0.25); color:#fff; font-weight:700; border-radius:6px; cursor:pointer;">
        ${state.music.isPlaying ? '暂停放歌' : '模拟播放'}
      </button>
    `;
    content.appendChild(player);

    const toggleBtn = player.querySelector("#btn-music-toggle-play");
    const disc = player.querySelector("#music-disc");

    toggleBtn.onclick = () => {
      state.music.isPlaying = !state.music.isPlaying;
      disc.classList.toggle("spinning", state.music.isPlaying);
      toggleBtn.innerText = state.music.isPlaying ? '暂停放歌' : '模拟播放';
      showToast(state.music.isPlaying ? "音乐环境音伴随已开启" : "伴随播放已暂停");
    };

    const playlistHeader = document.createElement("div");
    playlistHeader.className = "setting-section-title";
    playlistHeader.innerText = "自省深夜歌单";
    content.appendChild(playlistHeader);

    const list = document.createElement("div");
    list.className = "browser-history-list";
    content.appendChild(list);

    state.music.history.forEach(track => {
      const item = document.createElement("div");
      item.className = "browser-history-item";
      item.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span class="browser-history-text" style="font-weight: 700;">${track}</span>
      `;
      item.onclick = () => {
        state.music.currentTrack = track;
        state.music.isPlaying = true;
        renderMusic(content);
      };
      list.appendChild(item);
    });
  }

  // --- 8. 全局生命周期与事件注册绑定自愈锁 ---
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