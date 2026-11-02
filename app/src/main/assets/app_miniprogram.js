/**
 * ============================================================
 * app_miniprogram.js - 叙事诗小手机：微信风格小程序系统（核心）
 * ------------------------------------------------------------
 * 职责：
 *   1. 下拉手势：在聊天-对话页顶部下拉进入小程序页面（仿微信）；
 *   2. 小程序运行时：全屏容器 + 右上角半透明胶囊按钮（退出 / 分享）；
 *   3. 小程序注册表：内置小程序 + 链接安装（.js 直链 / 应用商店 store.json）+ 本地上传/粘贴；
 *   4. 应用商店：store.json 批量导入、商店源持久化、一键更新全部应用；
 *   5. 权限声明式安全模型：manifest.permissions 白名单裁剪 API，密钥不暴露，
 *      MCP 工具由宿主代理（api.mcp.invoke），getApiConfig 脱敏；
 *   6. 暴露 MiniProgramAPI：让小程序能调用小手机里的每一个接口
 *      （单聊/群聊/档案馆 char、主记忆、上下文、关系网、MCP、直接调用 LLM）；
 *   7. 分享卡片：把小程序分享卡片发送给 char，单聊/群聊后台开关控制 prompt 注入与解析。
 *
 * 设计原则：无损加入。所有逻辑均挂在新容器与新开关之下，关闭开关即完全不影响现有功能。
 * UI 规范：禁止新增任何 emoji，所有按钮使用纯矢量 SVG 图标。
 * 依赖：全局 Dexie `db`、`activeSessionId`、`showToast`、`escapeHtml`、OpenAI 兼容 API 预设。
 * ============================================================
 */
(function () {
  "use strict";

  const REGISTRY_KEY = "miniprogram_registry";       // localStorage 注册表
  const STATE_PREFIX = "miniprogram_state_";          // 小程序状态持久化前缀
  const CODE_PREFIX = "miniprogram_code_";            // 本地小程序源码持久化前缀
  const STORE_KEY = "miniprogram_store_sources";      // 应用商店源列表（链接安装持久化）
  const PERM_APPROVED_PREFIX = "miniprogram_perm_ok_"; // 权限已批准标记前缀（首次运行确认一次）

  // 注册表：[{ id, name, description, iconSvg, version, author, type, source, githubUrl, builtinKey, installedAt }]
  let registry = [];
  // 内置小程序的 mount 实现表：{ builtinKey -> { manifest, mount } }
  const builtinImplementations = {};
  // GitHub 小程序的 mount 实现表：{ id -> mountFn }（拉取后缓存于内存）
  const githubImplementations = {};
  // 本地小程序（上传文件/粘贴代码）的 mount 实现表：{ id -> mountFn }（源码持久化于 localStorage，重启后按需重新执行）
  const localImplementations = {};
  // 当前运行中的小程序
  let currentRunning = null; // { entry, api, cleanup }
  // 当前房间成员（含「我」+ 所有通过分享拉入的 char），由系统维护，供 api.getRoomMembers 读取
  let currentRoomMembers = [];

  // ---------- 工具 ----------
  function showToast(msg) {
    if (typeof window.showToast === "function") window.showToast(msg);
    else console.log("[MiniProgram]", msg);
  }
  function escapeHtml(s) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function loadRegistry() {
    try { registry = JSON.parse(localStorage.getItem(REGISTRY_KEY)) || []; }
    catch (e) { registry = []; }
  }
  function saveRegistry() {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  }
  function genId() {
    return "mp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  // ============================================================
  //  权限声明模型（应用商店式安全模型）
  //  manifest.permissions: 可选字段，白名单数组。
  //  - 未声明（旧版/内置）→ 视为全权限，行为完全不变（向后兼容）；
  //  - 已声明 → 未列入白名单的 API 会被裁剪（方法不存在），
  //    且 getApiConfig 不再返回明文 key，密钥永远留在宿主侧。
  //  可取值见 PERM_META（"*" 表示全部授权）。
  // ============================================================
  const PERM_META = {
    llm:      "调用大模型生成回复",
    api:      "读取模型配置（不含密钥）",
    memory:   "读写会话记忆 / 总结 / 上下文",
    chat:     "读取与发送聊天消息",
    archive:  "读写角色档案 / 档案馆",
    worldbook: "读取世界书条目",
    network:  "读取关系网",
    storage:  "本地状态持久化",
    files:    "文件读写 / 上传 / 导出",
    share:    "分享 / 邀请 / 房间成员",
    mcp:      "调用 MCP 工具（宿主代理，密钥不暴露）",
    user:     "读取当前用户信息"
  };
  // 读取条目的权限声明：返回数组；未声明返回 null（= 全权限）
  function permsOf(entry) {
    if (!entry || !Array.isArray(entry.permissions) || !entry.permissions.length) return null;
    return entry.permissions;
  }
  // 检查是否持有某权限（未声明 → 全通过）
  function hasPerm(entry, perm) {
    const p = permsOf(entry);
    if (p === null) return true;
    return p.indexOf("*") >= 0 || p.indexOf(perm) >= 0;
  }

  // 统一拉取远程文本：优先 Android 原生 HTTP 桥（规避跨域），失败回退 fetch
  async function fetchUrlText(url) {
    let text = null;
    if (window.AndroidMCP && typeof window.AndroidMCP.sendNativeHttpRequest === "function") {
      try {
        const resStr = window.AndroidMCP.sendNativeHttpRequest(url, "GET", JSON.stringify({}), "");
        const resObj = JSON.parse(resStr);
        if (resObj && resObj.status >= 200 && resObj.status < 300) text = resObj.body;
      } catch (e) {}
    }
    if (text === null) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      text = await resp.text();
    }
    if (!text || text.length < 20) throw new Error("拉取到的内容为空");
    return text;
  }
  // 解析相对链接（商店清单里的 app.url 可能是相对路径）
  function resolveUrl(maybeRelative, base) {
    try { return new URL(maybeRelative, base).href; } catch (e) { return maybeRelative; }
  }

  // ---------- 内置 SVG 图标集 ----------
  const ICONS = {
    grid: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    workshop: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    dice: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    puzzle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.47 1.229 0 1.698l-2.609 2.61a.75.75 0 0 1-.886.13 3 3 0 0 0-3.488 4.05.75.75 0 0 1-.13.886l-2.61 2.609c-.47.47-1.229.47-1.698 0l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.13.02-.261.029-.391.029a3 3 0 1 1 0-6c.13 0 .261.009.391.029a1.026 1.026 0 0 0 .877-.29l1.568-1.568c.47-.47 1.229-.47 1.698 0l2.61 2.609a.75.75 0 0 0 .886.13 3 3 0 0 0 4.05-3.488z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  // ============================================================
  //  MiniProgramAPI：暴露给小程序的统一接口桥
  // ============================================================
  async function getApiConfig() {
    try {
      const presetId = localStorage.getItem("global_api_preset_id");
      if (!presetId) return null;
      const api = await db.api_presets.get(Number(presetId));
      if (!api) return null;
      return { url: api.url, key: api.key, model: api.model, temperature: api.temperature };
    } catch (e) { return null; }
  }

  function buildAPI(entry) {
    entry = entry || null;
    const api = {
      // --- 会话与角色 ---
      getActiveSessionId() { return typeof activeSessionId !== "undefined" ? activeSessionId : null; },
      async getSession(sessionId) {
        const sid = sessionId || api.getActiveSessionId();
        if (!sid) return null;
        return await db.sessions.get(sid);
      },
      async getActiveChar() {
        const sess = await api.getSession();
        if (!sess) return null;
        if (sess.charId) return await db.archives.get(sess.charId);
        return {
          name: sess.customCharName || "对方",
          avatar: sess.customCharAvatar || "",
          persona: sess.customCharPersona || ""
        };
      },
      async getChar(charId) {
        if (!charId) return await api.getActiveChar();
        return await db.archives.get(Number(charId));
      },
      async getGroupMembers(groupId) {
        const sess = await api.getSession();
        const gid = groupId || (sess ? sess.groupId : null);
        if (!gid) return [];
        const members = await db.group_members.where("groupId").equals(gid).toArray();
        const result = [];
        for (const m of members) {
          const arch = await db.archives.get(m.memberId);
          const isSnapshot = !!m.isSnapshot;
          // 支线人物（对话快照分支）使用群成员唯一行 id 派生独立标识，避免与同名主线人物混淆
          result.push({
            id: isSnapshot ? ("snap_" + m.id) : m.memberId,
            memberId: m.memberId,
            type: m.memberType === "char" ? "char" : "user",
            name: m.displayName || (arch ? arch.name : (m.memberType === "char" ? "角色" : "我")),
            baseName: arch ? arch.name : "",
            avatar: arch ? arch.avatar : "",
            persona: arch ? arch.persona : "",
            isSnapshot: isSnapshot,
            snapshotLabel: m.snapshotLabel || "",
            sourceArchiveId: m.sourceArchiveId || 0
          });
        }
        return result;
      },
      // 档案馆：所有角色档案
      async getArchives(filter) {
        let list = (await db.archives.toArray()).filter(a => !a.isSnapshot);
        if (filter && filter.type) list = list.filter(a => a.type === filter.type);
        return list.map(a => ({ id: a.id, type: a.type, name: a.name, avatar: a.avatar, persona: a.persona, remark: a.remark, group: a.group }));
      },
      // 当前用户（我）：返回 { id, name, avatar, persona }。优先取全局 activeUserPersonaId 对应的档案
      async getActiveUser() {
        try {
          const uid = (typeof activeUserPersonaId !== "undefined") ? Number(activeUserPersonaId) : 0;
          if (uid) {
            const u = await db.archives.get(uid);
            if (u) return { id: u.id, name: u.name || "我", avatar: u.avatar || "", persona: u.persona || "" };
          }
          // 兜底：档案馆里第一个 type==='user' 的档案
          const users = await db.archives.where("type").equals("user").toArray();
          if (users && users.length) {
            const u = users[0];
            return { id: u.id, name: u.name || "我", avatar: u.avatar || "", persona: u.persona || "" };
          }
        } catch (e) {}
        return { id: 0, name: "我", avatar: "", persona: "" };
      },

      // --- 记忆系统 ---
      async getMainMemory(sessionId) {
        const sid = sessionId || api.getActiveSessionId();
        if (!sid) return null;
        const sess = await db.sessions.get(sid);
        // 主记忆：session 上的核心字段 + 最近一条总结
        let latestSummary = null;
        try {
          const sums = await db.summaries.where("sessionId").equals(sid).reverse().first();
          latestSummary = sums || null;
        } catch (e) {}
        return {
          coreSelfStatus: sess ? sess.coreSelfStatus : "",
          coreSelfPurpose: sess ? sess.coreSelfPurpose : "",
          coreSelfChanges: sess ? sess.coreSelfChanges : "",
          coreRelationship: sess ? sess.coreRelationship : "",
          coreUserInEyes: sess ? sess.coreUserInEyes : "",
          latestSummary: latestSummary ? { content: latestSummary.content, keywords: latestSummary.keywords, timestamp: latestSummary.timestamp } : null
        };
      },
      async getRecentContext(sessionId, limit) {
        const sid = sessionId || api.getActiveSessionId();
        if (!sid) return [];
        const n = limit || 10;
        const msgs = await db.messages.where("sessionId").equals(sid).reverse().limit(n).toArray();
        return msgs.reverse().map(m => ({
          senderType: m.senderType, senderId: m.senderId,
          contentType: m.contentType, content: m.content, timestamp: m.timestamp
        }));
      },
      async getRelationshipNetwork(charId) {
        const sess = await api.getSession();
        const cid = charId || (sess ? sess.charId : null);
        if (!cid) return [];
        try {
          const outgoing = await db.relations.where("fromId").equals(Number(cid)).toArray();
          const incoming = await db.relations.where("toId").equals(Number(cid)).toArray();
          return outgoing.concat(incoming).map(r => ({ fromId: r.fromId, toId: r.toId, relation: r.relation }));
        } catch (e) { return []; }
      },
      // 按 charId 反查它对应的单聊会话（用于读取该角色的记忆/上下文/总结）
      async findSessionByCharId(charId) {
        if (!charId) return null;
        try {
          const userIdNum = (typeof activeUserPersonaId !== "undefined") ? Number(activeUserPersonaId) : 0;
          let list = [];
          if (userIdNum) list = await db.sessions.where("userId").equals(userIdNum).toArray();
          else list = await db.sessions.toArray();
          // 优先匹配单聊（非群聊）且 charId 一致的会话
          return list.find(s => s.isGroup !== 1 && s.charId === Number(charId)) || null;
        } catch (e) { return null; }
      },
      // 一站式获取某角色的完整上下文：人设 + 主记忆 + 关系网 + 最近对话 + 最新总结
      // 供真心话大冒险等多人小程序拼接详细 prompt 用
      // 支持两种入参：主线人物传档案 id（数字）；支线人物（对话快照分支）传 'snap_<群成员行id>'，
      // 此时返回该分支快照里独有的记忆与对话片段，绝不用主线人物或其它分支的记忆串台。
      async getCharRichContext(charId) {
        // 1. 解析身份：支线人物（对话快照分支）从群成员行 id 定位
        let snapMember = null;
        if (typeof charId === "string" && charId.indexOf("snap_") === 0) {
          try { snapMember = await db.group_members.get(Number(charId.slice(5))); } catch (e) { snapMember = null; }
          if (!snapMember) return null;
        }
        const cid = snapMember ? Number(snapMember.memberId) : (Number(charId) || 0);
        if (!cid) return null;
        let char = null;
        try { char = await db.archives.get(cid); } catch (e) { char = null; }
        const persona = (char && char.persona) ? char.persona : "";
        const name = snapMember ? (snapMember.displayName || (char ? char.name : "角色")) : ((char && char.name) ? char.name : "角色");
        let memory = null, recentContext = [];
        // 2. 支线人物：读取其对话快照里独有的总结与最近对话，作为该分支的专属记忆
        if (snapMember && snapMember.sourceArchiveId) {
          try {
            const archive = await db.chat_archives.get(snapMember.sourceArchiveId);
            if (archive) {
              const sd = deserializeRecord(archive.snapshotData) || {};
              const sums = Array.isArray(sd.summaries) ? sd.summaries : [];
              const msgs = Array.isArray(sd.messages) ? sd.messages : [];
              memory = {
                coreSelfStatus: "", coreSelfPurpose: "", coreSelfChanges: "",
                coreRelationship: "", coreUserInEyes: "",
                latestSummary: sums.length ? { content: sums[sums.length - 1].content || "", keywords: "", timestamp: 0 } : null,
                branchLabel: archive.customLabel || snapMember.snapshotLabel || "",
                isSnapshot: true
              };
              recentContext = msgs.slice(-12).map(x => ({
                senderType: x.senderType, senderId: x.senderId,
                contentType: x.contentType, content: x.content, timestamp: x.timestamp
              }));
            }
          } catch (e) {}
        } else {
          const sess = await api.findSessionByCharId(cid);
          if (sess) {
            try { memory = await api.getMainMemory(sess.id); } catch (e) { memory = null; }
            try { recentContext = await api.getRecentContext(sess.id, 12); } catch (e) { recentContext = []; }
          }
        }
        let network = [];
        try { network = await api.getRelationshipNetwork(cid); } catch (e) { network = []; }
        return {
          charId: cid, name: name, persona: persona,
          memory: memory, recentContext: recentContext, network: network,
          isSnapshot: !!snapMember, snapshotLabel: snapMember ? (snapMember.snapshotLabel || "") : ""
        };
      },

      // --- 资源完全接入：会话/消息/世界书/档案 CRUD ---
      // 获取当前用户的所有会话列表（单聊+群聊），可用于让小程序选择/切换会话
      async getSessions() {
        try {
          const userIdNum = (typeof activeUserPersonaId !== "undefined") ? Number(activeUserPersonaId) : 0;
          let list = [];
          if (userIdNum) list = await db.sessions.where("userId").equals(userIdNum).toArray();
          else list = await db.sessions.toArray();
          return list.map(s => ({ id: s.id, charId: s.charId, customCharName: s.customCharName, isGroup: s.isGroup, groupId: s.groupId, userId: s.userId, title: s.title || "" }));
        } catch (e) { return []; }
      },
      // 获取某会话的最近 N 条消息（默认 20 条）
      async getMessages(sessionId, limit) {
        const sid = sessionId || api.getActiveSessionId();
        if (!sid) return [];
        try {
          let q = db.messages.where("sessionId").equals(sid).reverse();
          if (limit) q = q.limit(limit);
          const msgs = await q.toArray();
          return msgs.reverse().map(m => ({ id: m.id, senderType: m.senderType, senderId: m.senderId, content: m.content, contentType: m.contentType, timestamp: m.timestamp }));
        } catch (e) { return []; }
      },
      // 向某会话写入一条消息（可用于小程序向聊天里推送结果）
      async sendMessage(sessionId, senderType, content, contentType) {
        const sid = sessionId || api.getActiveSessionId();
        if (!sid) return null;
        try {
          const id = await db.messages.add({
            sessionId: sid, senderType: senderType || "user", senderId: 0,
            content: String(content || ""), contentType: contentType || "text", timestamp: Date.now()
          });
          return id;
        } catch (e) { return null; }
      },
      // 读取世界书条目（可选按 charId 过滤挂载的条目）
      async getWorldBookEntries(charId) {
        try {
          let list = await db.worldbook_entries.toArray();
          if (charId) {
            // 过滤出挂载到该 char 或全局的条目
            list = list.filter(e => !e.charId || e.charId === Number(charId) || e.scope === "global");
          }
          return list.map(e => ({ id: e.id, title: e.title, content: e.content, keywords: e.keywords, scope: e.scope, enabled: e.enabled, charId: e.charId }));
        } catch (e) { return []; }
      },
      // 创建/更新角色档案（写入档案馆）
      async saveArchive(archive) {
        try {
          const data = Object.assign({ name: archive.name || "新角色", type: archive.type || "char", persona: archive.persona || "", avatar: archive.avatar || "", remark: archive.remark || "", createdAt: Date.now() }, archive);
          if (data.id) {
            await db.archives.put(data);
            return data.id;
          } else {
            delete data.id;
            return await db.archives.add(data);
          }
        } catch (e) { return null; }
      },
      // 获取所有关系网数据
      async getAllRelations() {
        try { return await db.relations.toArray(); } catch (e) { return []; }
      },

      // --- API Key 与直接调用 LLM ---
      // 安全模型：声明了 permissions 的小程序只能拿到 {url, model, temperature}，
      // 拿不到明文 key（密钥永远留在宿主闭包，仅供 callLLM 内部使用）；
      // 未声明权限（旧版小程序）保持返回 key，向后兼容。
      async getApiConfig() {
        const cfg = await getApiConfig();
        if (!cfg) return null;
        if (permsOf(entry) === null) return cfg;
        return { url: cfg.url, model: cfg.model, temperature: cfg.temperature, hasKey: !!cfg.key };
      },
      async callLLM(opts) {
        const cfg = await getApiConfig();
        if (!cfg) { const e = new Error("未配置全局 API 预设"); try { if (typeof window.fwTrackError === "function") window.fwTrackError(e); } catch (_) {} throw e; }
        const messages = opts.messages || [{ role: "user", content: opts.prompt || "" }];
        const body = {
          model: opts.model || cfg.model,
          messages: messages,
          temperature: (opts.temperature != null ? opts.temperature : (cfg.temperature != null ? cfg.temperature : 0.85))
        };
        if (opts.maxTokens) body.max_tokens = opts.maxTokens;
        let resp;
        try {
          resp = await fetch(cfg.url + "/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
            body: JSON.stringify(body)
          });
        } catch (netErr) {
          try { if (typeof window.fwTrackError === "function") window.fwTrackError(netErr); } catch (_) {}
          throw netErr;
        }
        if (!resp.ok) { const e = new Error("LLM 接口响应失败: " + resp.status); try { if (typeof window.fwTrackError === "function") window.fwTrackError(e); } catch (_) {} throw e; }
        const data = await resp.json();
        // 上报 token 用量给悬浮窗 API 监控（小程序里的调用也会被捕获）
        try { if (data && data.usage && typeof window.fwTrackUsage === "function") window.fwTrackUsage(data.usage, body.model); } catch (_) {}
        return data.choices && data.choices[0] ? data.choices[0].message.content.trim() : "";
      },
      // 以某 char 立场生成回复（注入该 char 人设为 system）
      async getCharReply(opts) {
        let char = null;
        if (opts.charId) {
          try { char = await db.archives.get(Number(opts.charId)); }
          catch (e) { char = null; } // charId 无效时不阻断调用
        } else {
          const sess = await api.getSession(opts.sessionId);
          if (sess && sess.charId) {
            try { char = await db.archives.get(sess.charId); } catch (e) { char = null; }
          }
          else if (sess) char = { name: sess.customCharName, persona: sess.customCharPersona };
        }
        // 支持 opts.persona 直接传入人设（不依赖 archives 查询）
        const persona = (char && char.persona) ? char.persona : (opts.persona || "");
        const sys = (persona ? persona + "\n\n" : "") + (opts.systemPrompt || "请完全以该角色身份自然回应。");
        const messages = [{ role: "system", content: sys }];
        if (opts.history && opts.history.length) messages.push(...opts.history);
        messages.push({ role: "user", content: opts.prompt || "" });
        return await api.callLLM({ messages, temperature: opts.temperature, maxTokens: opts.maxTokens });
      },

      // --- 小程序状态持久化（按小程序 id 隔离） ---
      saveState(key, data) {
        if (!currentRunning) return;
        const k = STATE_PREFIX + currentRunning.entry.id + "_" + key;
        try {
          localStorage.setItem(k, JSON.stringify(data));
        } catch (e) {
          // 配额超限：尝试裁剪 log（保留最近 30 条）后重试，避免退出后进度丢失
          if (data && Array.isArray(data.log) && data.log.length > 30) {
            try {
              const trimmed = Object.assign({}, data, { log: data.log.slice(-30) });
              localStorage.setItem(k, JSON.stringify(trimmed));
              return;
            } catch (e2) {}
          }
          // 仍失败：静默（不阻断游戏流程，但记录警告）
          console.warn("[MiniProgram] saveState 配额超限，状态未持久化", key);
        }
      },
      loadState(key, def) {
        if (!currentRunning) return def;
        const k = STATE_PREFIX + currentRunning.entry.id + "_" + key;
        try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
      },
      // 清除本局状态（结束本局时调用，避免下次进入仍是同一局）
      clearState(key) {
        if (!currentRunning) return;
        const k = STATE_PREFIX + currentRunning.entry.id + "_" + key;
        try { localStorage.removeItem(k); } catch (e) {}
      },

      // --- 文件读写 / 导出（按小程序 id 隔离，存 localStorage） ---
      // 写入一个文件（content 为字符串），返回是否成功
      writeFile(filename, content) {
        if (!currentRunning) return false;
        const k = "miniprogram_files_" + currentRunning.entry.id;
        try {
          const obj = JSON.parse(localStorage.getItem(k) || "{}");
          obj[filename] = String(content);
          localStorage.setItem(k, JSON.stringify(obj));
          return true;
        } catch (e) { return false; }
      },
      // 读取一个文件，返回字符串（不存在返回 null）
      readFile(filename) {
        if (!currentRunning) return null;
        const k = "miniprogram_files_" + currentRunning.entry.id;
        try {
          const obj = JSON.parse(localStorage.getItem(k) || "{}");
          return (filename in obj) ? obj[filename] : null;
        } catch (e) { return null; }
      },
      // 列出本小程序所有文件名
      listFiles() {
        if (!currentRunning) return [];
        const k = "miniprogram_files_" + currentRunning.entry.id;
        try {
          const obj = JSON.parse(localStorage.getItem(k) || "{}");
          return Object.keys(obj);
        } catch (e) { return []; }
      },
      // 删除一个文件
      deleteFile(filename) {
        if (!currentRunning) return false;
        const k = "miniprogram_files_" + currentRunning.entry.id;
        try {
          const obj = JSON.parse(localStorage.getItem(k) || "{}");
          if (!(filename in obj)) return false;
          delete obj[filename];
          localStorage.setItem(k, JSON.stringify(obj));
          return true;
        } catch (e) { return false; }
      },
      // 导出文件：把字符串内容以指定文件名下载（PWA 走 Blob，Android 真机优先走物理直写）
      exportFile(filename, content, mime) {
        const text = String(content == null ? "" : content);
        const type = mime || "text/plain;charset=utf-8";
        try {
          if (window.AndroidMCP && typeof window.AndroidMCP.saveBackupFile === "function") {
            // Android 真机物理直写到 /Download/Storypoem/（签名：saveBackupFile(content, filename)）
            const ok = window.AndroidMCP.saveBackupFile(text, filename);
            if (ok) { showToast("已导出到下载目录"); return true; }
          }
          // PWA 降级：Blob 下载
          const blob = new Blob([text], { type: type });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click();
          setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
          return true;
        } catch (e) { showToast("导出失败"); return false; }
      },
      // 让用户选一个本地文件并读取其文本内容（返回 {filename, content}，取消返回 null）
      pickFile(accept) {
        return new Promise((resolve) => {
          try {
            const input = document.createElement("input");
            input.type = "file";
            if (accept) input.accept = accept;
            input.style.display = "none";
            input.onchange = () => {
              const f = input.files && input.files[0];
              if (!f) { resolve(null); return; }
              const reader = new FileReader();
              reader.onload = () => resolve({ filename: f.name, content: String(reader.result || "") });
              reader.onerror = () => resolve(null);
              reader.readAsText(f);
            };
            document.body.appendChild(input);
            input.click();
            setTimeout(() => { try { document.body.removeChild(input); } catch (e) {} }, 1000);
          } catch (e) { resolve(null); }
        });
      },

      // --- 写入记忆与总结（向小手机主记忆沉淀） ---
      async saveSummary(opts) {
        const sid = (opts && opts.sessionId) || api.getActiveSessionId();
        if (!sid) return false;
        try {
          await db.summaries.add({
            sessionId: sid,
            startRound: opts.startRound || 0,
            endRound: opts.endRound || 0,
            content: opts.content || "",
            keywords: opts.keywords || "",
            timestamp: Date.now(),
            category: opts.category || "miniprogram"
          });
          return true;
        } catch (e) { return false; }
      },
      async updateMainMemory(opts) {
        const sid = (opts && opts.sessionId) || api.getActiveSessionId();
        if (!sid) return false;
        try {
          const patch = {};
          const fields = ["coreSelfStatus", "coreSelfPurpose", "coreSelfChanges", "coreRelationship", "coreUserInEyes"];
          for (const f of fields) if (opts[f] != null) patch[f] = opts[f];
          if (Object.keys(patch).length === 0) return false;
          await db.sessions.update(sid, patch);
          return true;
        } catch (e) { return false; }
      },

      // --- 与小手机交互 ---
      close() { miniProgramSystem.close(); },
      // 让 char 反向把分享卡片发给 user（char 邀请 user 来玩）
      async shareCardBack(inviteText) {
        if (!currentRunning) return;
        await miniProgramSystem._sendShareCardFromChar(currentRunning.entry, inviteText);
      },
      // 分享拉入参与者回调：游戏可覆写此函数以接收新参与者
      // 签名：onInvite(participants, shareInfo)
      //   participants: [{ id, name, avatar, isMe, type, persona }] 本次新增的参与者
      //   shareInfo: { carryData, session } 携带数据与来源会话
      onInvite: null,
      // 分享配置：小程序可覆写此对象以控制分享行为（不覆写则用默认值）
      //   followPersona: 是否让被拉入的 char 跟随当前面具(persona)，默认 true
      //   carryData: 分享时携带的自定义数据（由 .js 自定义内容），会随 onInvite 传回给游戏
      //   inviteText: 分享卡片上的邀请文案，不设则用默认"来一起玩…"
      shareConfig: { followPersona: true, carryData: null, inviteText: null },
      // 读取当前房间全部成员（含「我」+ 所有通过分享拉入的 char）
      // 返回 [{ id, name, avatar, isMe, type, persona }]，同步方法
      getRoomMembers() {
        return (currentRoomMembers || []).map(p => Object.assign({}, p));
      },
      // 主动唤起分享面板（游戏内可调用）
      async share() {
        if (!currentRunning) return;
        await miniProgramSystem.openSharePicker ? miniProgramSystem.openSharePicker(currentRunning.entry) : null;
      },
      // 提示
      toast(msg) { showToast(msg); },
      // 自定义确认卡片（替代浏览器原生 confirm）
      showConfirm(title, message) {
        return new Promise((resolve) => {
          if (typeof window.showCustomConfirm === "function") {
            window.showCustomConfirm(title, message, () => resolve(true), () => resolve(false));
          } else {
            resolve(window.confirm(title + "\n" + message));
          }
        });
      },
      // 自定义操作选择卡片（替代 confirm + 多按钮场景）
      // options: [{ label, value, danger? }]
      // 返回 Promise<value>，用户取消则 resolve(null)
      showActionCard(title, options) {
        return new Promise((resolve) => {
          const overlay = document.createElement("div");
          overlay.className = "pwa-modal-overlay";
          const btns = (options || []).map((opt, i) => {
            const cls = opt.danger ? "btn-pwa-modal confirm" : "btn-pwa-modal cancel";
            return '<button class="' + cls + '" data-idx="' + i + '">' + escapeHtml(opt.label || "") + '</button>';
          }).join("");
          overlay.innerHTML = '<div class="pwa-modal-card">' +
            '<div class="pwa-modal-title">' + escapeHtml(title || "请选择") + '</div>' +
            '<div class="pwa-modal-buttons">' + btns + '</div>' +
            '</div>';
          document.body.appendChild(overlay);
          setTimeout(() => overlay.classList.add("show"), 10);
          const close = (val) => {
            overlay.classList.remove("show");
            setTimeout(() => { overlay.remove(); resolve(val); }, 200);
          };
          overlay.querySelectorAll(".btn-pwa-modal").forEach(btn => {
            btn.onclick = () => {
              const idx = parseInt(btn.dataset.idx, 10);
              close(options[idx].value);
            };
          });
          overlay.onclick = (e) => { if (e.target === overlay) close(null); };
        });
      },
      // 初始化（清除）当前小程序的所有持久化状态
      resetState() {
        if (!currentRunning) return false;
        const prefix = STATE_PREFIX + currentRunning.entry.id + "_";
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
        return true;
      }
    };
    // 声明了 mcp 权限时，挂载由宿主代理的 MCP 桥（服务器 url/headers/密钥全部留在宿主侧）
    if (hasPerm(entry, "mcp") && window.mcpClientSystem) {
      api.mcp = {
        // 列出可用 MCP 服务器（仅名称/分组/工具数，不含 url 与 headers）
        async listServers() {
          try {
            const servers = await db.mcp_servers.toArray();
            return servers.filter(s => s.enabled).map(s => ({
              name: s.name, group: s.group || "默认",
              toolCount: (Array.isArray(s.tools) ? s.tools.filter(t => t.enabled).length : 0)
            }));
          } catch (e) { return []; }
        },
        // 列出某服务器的可用工具（名称/描述/参数 schema）
        async listTools(serverName) {
          try {
            const servers = await db.mcp_servers.toArray();
            const server = servers.find(s => s.name === serverName);
            if (!server || !Array.isArray(server.tools)) return [];
            return server.tools.filter(t => t.enabled).map(t => ({
              name: t.name, description: t.description || "", inputSchema: t.inputSchema || {}
            }));
          } catch (e) { return []; }
        },
        // 调用 MCP 工具：完全由宿主 mcpClientSystem 执行（含握手/鉴权），密钥不经过小程序
        async invoke(serverName, toolName, args) {
          if (typeof window.mcpClientSystem.callMcpTool !== "function") throw new Error("宿主 MCP 客户端未就绪");
          const result = await window.mcpClientSystem.callMcpTool(serverName, toolName, args || {});
          return result; // 原样返回（含 content / structuredContent 等）
        }
      };
    }
    applyPermFilter(api, entry);
    return api;
  }

  // 权限裁剪：已声明 permissions 的条目，未列入白名单的 API 一律删除（方法不存在，
  // 小程序调用时自然报错，且拿不到任何越权数据）
  function applyPermFilter(api, entry) {
    const perms = permsOf(entry);
    if (perms === null || perms.indexOf("*") >= 0) return;
    const has = p => perms.indexOf(p) >= 0;
    const map = {
      llm:       ["callLLM", "getCharReply"],
      api:       ["getApiConfig"],
      memory:    ["getMainMemory", "getRecentContext", "saveSummary", "updateMainMemory"],
      chat:      ["getSession", "getSessions", "getMessages", "sendMessage", "getGroupMembers", "findSessionByCharId"],
      archive:   ["getActiveChar", "getChar", "getArchives", "saveArchive"],
      worldbook: ["getWorldBookEntries"],
      network:   ["getRelationshipNetwork", "getAllRelations"],
      storage:   ["saveState", "loadState", "clearState", "resetState"],
      files:     ["writeFile", "readFile", "listFiles", "deleteFile", "exportFile", "pickFile"],
      share:     ["shareCardBack", "getRoomMembers", "share"],
      user:      ["getActiveUser"],
      mcp:       ["mcp"]
    };
    for (const perm in map) {
      if (has(perm)) continue;
      for (const name of map[perm]) { try { delete api[name]; } catch (e) {} }
    }
    // 复合权限：getCharRichContext 需要 memory 或 archive 任一
    if (!(has("memory") || has("archive"))) { try { delete api.getCharRichContext; } catch (e) {} }
  }

  // ============================================================
  //  注册表：内置 + GitHub
  // ============================================================
  function registerBuiltin(manifest, mountFn) {
    // manifest: { name, description, iconSvg, version, author, type, builtinKey }
    builtinImplementations[manifest.builtinKey] = { manifest: manifest, mount: mountFn };
    // 写入注册表（如未存在）
    loadRegistry();
    const exist = registry.find(r => r.source === "builtin" && r.builtinKey === manifest.builtinKey);
    if (!exist) {
      registry.push({
        id: "mp_builtin_" + manifest.builtinKey,
        name: manifest.name, description: manifest.description,
        iconSvg: manifest.iconSvg || ICONS.puzzle,
        version: manifest.version || "1.0.0", author: manifest.author || "内置",
        type: manifest.type || "game", source: "builtin",
        builtinKey: manifest.builtinKey, installedAt: Date.now()
      });
      saveRegistry();
    } else {
      // 同步最新元信息（内置升级时覆盖名称/描述/图标）
      exist.name = manifest.name; exist.description = manifest.description;
      exist.iconSvg = manifest.iconSvg || exist.iconSvg; exist.version = manifest.version || exist.version;
      saveRegistry();
    }
  }

  // GitHub/链接小程序在自身脚本内调用此方法注册
  // manifest 额外支持：permissions（权限白名单数组）、manifestUrl（所属商店清单链接）
  function registerGithub(manifest, mountFn) {
    // manifest 必须含 id（或由 githubUrl 派生）
    const id = manifest.id || ("mp_github_" + hashStr(manifest.name + (manifest.githubUrl || "")));
    githubImplementations[id] = mountFn;
    loadRegistry();
    let entry = registry.find(r => r.id === id);
    if (!entry) {
      entry = {
        id: id, name: manifest.name, description: manifest.description,
        iconSvg: manifest.iconSvg || ICONS.puzzle,
        version: manifest.version || "1.0.0", author: manifest.author || "社区",
        type: manifest.type || "game", source: "github",
        githubUrl: manifest.githubUrl || "",
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions.slice() : null,
        manifestUrl: manifest.manifestUrl || "",
        installedAt: Date.now()
      };
      registry.push(entry);
    } else {
      entry.name = manifest.name; entry.description = manifest.description;
      entry.iconSvg = manifest.iconSvg || entry.iconSvg; entry.version = manifest.version || entry.version;
      entry.githubUrl = manifest.githubUrl || entry.githubUrl;
      if (Array.isArray(manifest.permissions)) entry.permissions = manifest.permissions.slice();
      if (manifest.manifestUrl) entry.manifestUrl = manifest.manifestUrl;
    }
    saveRegistry();
    return id;
  }
  function hashStr(s) {
    let h = 5381; s = String(s);
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h = h & h; }
    return (h >>> 0).toString(36);
  }

  // ============================================================
  //  链接安装 / 应用商店（统一 URL 导入）
  //  支持两种链接：
  //    1) 单文件小程序 .js 直链 → 直接安装；
  //    2) 应用商店 manifest（JSON，含 store 与 apps 数组）→ 一次性导入商店内全部应用。
  //  商店 manifest 格式：
  //  {
  //    "type": "miniprogram-store",
  //    "name": "商店名", "iconSvg": "<svg>…</svg>", "description": "…",
  //    "apps": [{
  //      "id": "mp_store_xxx", "name": "应用名", "description": "…",
  //      "version": "1.0.0", "author": "作者", "type": "tool",
  //      "iconSvg": "<svg>…</svg>",
  //      "url": "https://…/app.js",              // 必填：应用代码直链（支持相对路径）
  //      "permissions": ["llm","mcp","storage"]   // 权限白名单（见 PERM_META）
  //    }]
  //  }
  // ============================================================
  async function installFromUrl(url, overrides) {
    url = (url || "").trim();
    if (!url) { showToast("请输入链接"); return false; }
    if (!/^https?:\/\//i.test(url)) { showToast("请输入以 https:// 开头的链接"); return false; }
    showToast("正在拉取…");
    try {
      const text = await fetchUrlText(url);
      const trimmed = text.trim();
      // 尝试解析为商店 manifest（JSON 且含 type=miniprogram-store 或 apps 数组）
      let storeObj = null;
      if (trimmed.charAt(0) === "{") {
        try {
          const j = JSON.parse(trimmed);
          if (j && (j.type === "miniprogram-store" || Array.isArray(j.apps))) storeObj = j;
        } catch (e) {}
      }
      if (storeObj) return await installStore(storeObj, url, overrides);
      return await installSingleFromUrl(url, text, overrides);
    } catch (e) {
      console.error("[MiniProgram] 链接拉取失败", e);
      showToast("拉取失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // 安装单个远程小程序（.js 直链）
  // overrides: { appId, forcePermissions, manifestUrl, name, author, iconSvg, description, version, type }
  //   - appId: 锁定 id（商店应用更新时复用同一记录）
  //   - forcePermissions: 商店清单声明的权限，优先于代码自带 manifest.permissions
  async function installSingleFromUrl(url, code, overrides) {
    const ov = overrides || {};
    let registered = null;
    const sandbox = {
      registerMiniProgram: function (manifest, mountFn) {
        if (!manifest) manifest = {};
        manifest.githubUrl = url;
        if (ov.appId) manifest.id = ov.appId;                       // 锁定 id
        if (ov.forcePermissions) manifest.permissions = ov.forcePermissions; // 商店声明优先
        if (ov.manifestUrl) manifest.manifestUrl = ov.manifestUrl;   // 记录所属商店
        if (ov.type) manifest.type = ov.type;
        if (ov.version) manifest.version = ov.version;
        registered = registerGithub(manifest, mountFn);
        return registered;
      },
      MiniProgramAPI: null,
      console: console
    };
    try {
      const wrapper = new Function("registerMiniProgram", "MiniProgramAPI", "console", code);
      wrapper(sandbox.registerMiniProgram, null, console);
      if (!registered) throw new Error("代码未调用 registerMiniProgram(manifest, mountFn)");
      loadRegistry();
      showToast("小程序安装成功");
      try {
        const hubOverlay = document.getElementById("miniprogram-hub-overlay");
        if (hubOverlay && hubOverlay.classList.contains("active")) renderHub();
      } catch (e) {}
      return true;
    } catch (e) {
      console.error("[MiniProgram] 链接安装失败", e);
      showToast("安装失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // ---- 应用商店：源管理 ----
  function loadStores() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveStores(stores) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stores)); } catch (e) {}
  }
  function addStoreSource(storeInfo) {
    const stores = loadStores();
    if (!stores.some(s => s.url === storeInfo.url)) {
      stores.unshift(Object.assign({ installedAt: Date.now() }, storeInfo));
      saveStores(stores);
    }
    return stores;
  }
  function listStores() { return loadStores(); }
  function removeStore(url) {
    const stores = loadStores().filter(s => s.url !== url);
    saveStores(stores);
    return true;
  }

  // 导入整个应用商店：逐应用拉取安装 + 记录商店源
  async function installStore(storeObj, url, overrides) {
    const apps = Array.isArray(storeObj.apps) ? storeObj.apps : [];
    if (!apps.length) { showToast("商店清单中没有应用"); return false; }
    addStoreSource({
      url: url,
      name: storeObj.name || "应用商店",
      iconSvg: storeObj.iconSvg || ICONS.puzzle,
      description: storeObj.description || ""
    });
    let okCount = 0, failCount = 0;
    for (const app of apps) {
      const appUrl = resolveUrl(app.url, url);
      if (!appUrl) { failCount++; continue; }
      const appId = app.id || ("mp_store_" + hashStr(app.name + "|" + appUrl));
      try {
        const code = await fetchUrlText(appUrl);
        const ok = await installSingleFromUrl(appUrl, code, {
          appId: appId, forcePermissions: app.permissions,
          manifestUrl: url,
          name: app.name, author: app.author, iconSvg: app.iconSvg,
          description: app.description, version: app.version, type: app.type
        });
        if (ok) okCount++; else failCount++;
      } catch (e) {
        failCount++;
        console.error("[MiniProgram] 商店应用安装失败", appUrl, e);
      }
    }
    showToast("商店导入完成：成功 " + okCount + " 个" + (failCount ? "，失败 " + failCount + " 个" : ""));
    try {
      const hubOverlay = document.getElementById("miniprogram-hub-overlay");
      if (hubOverlay && hubOverlay.classList.contains("active")) renderHub();
    } catch (e) {}
    return okCount > 0;
  }

  // 更新某商店下所有已安装的应用（重新拉取清单 + 逐个覆盖，id 保持不变）
  async function updateStoreApps(url) {
    try {
      const text = await fetchUrlText(url);
      const store = JSON.parse(text);
      if (!store || !Array.isArray(store.apps)) throw new Error("不是有效的商店清单");
      addStoreSource({
        url: url, name: store.name || "应用商店",
        iconSvg: store.iconSvg || ICONS.puzzle, description: store.description || ""
      });
      let updated = 0;
      for (const app of store.apps) {
        loadRegistry();
        const appUrl = resolveUrl(app.url, url);
        const appId = app.id || ("mp_store_" + hashStr(app.name + "|" + appUrl));
        const exist = registry.find(r => r.id === appId);
        if (!exist) continue; // 未安装的应用跳过
        try {
          const code = await fetchUrlText(appUrl);
          const ok = await installSingleFromUrl(appUrl, code, {
            appId: appId, forcePermissions: app.permissions, manifestUrl: url,
            name: app.name, author: app.author, iconSvg: app.iconSvg,
            description: app.description, version: app.version, type: app.type
          });
          if (ok) updated++;
        } catch (e) { console.error("[MiniProgram] 更新失败", appUrl, e); }
      }
      showToast(updated ? "已更新 " + updated + " 个应用" : "没有需要更新的应用");
      try {
        const hubOverlay = document.getElementById("miniprogram-hub-overlay");
        if (hubOverlay && hubOverlay.classList.contains("active")) renderHub();
      } catch (e) {}
      return updated > 0;
    } catch (e) {
      console.error("[MiniProgram] 商店更新失败", e);
      showToast("商店更新失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // 兼容旧接口：GitHub raw 链接安装 = 链接安装
  async function installFromGithub(url) {
    return await installFromUrl(url);
  }

  // 本地小程序（上传文件 / 粘贴代码）在自身脚本内调用此方法注册
  // overrides：来自工坊表单的字段（name/author/iconSvg/description），优先于代码自带 manifest
  function registerLocal(manifest, mountFn, code, overrides) {
    const id = manifest.id || ("mp_local_" + hashStr(manifest.name + (manifest.author || "") + Date.now()));
    localImplementations[id] = mountFn;
    // 持久化源码，便于重启后重新执行
    if (code) {
      try { localStorage.setItem(CODE_PREFIX + id, code); } catch (e) {}
    }
    loadRegistry();
    // 表单字段优先：用户在工坊里填的 svg/作者/名称覆盖代码自带 manifest
    const ov = overrides || {};
    const finalName = ov.name || manifest.name;
    const finalAuthor = ov.author || manifest.author || "本地";
    const finalIcon = ov.iconSvg || manifest.iconSvg || ICONS.puzzle;
    const finalDesc = ov.description != null ? ov.description : manifest.description;
    let entry = registry.find(r => r.id === id);
    if (!entry) {
      entry = {
        id: id, name: finalName, description: finalDesc,
        iconSvg: finalIcon,
        version: manifest.version || "1.0.0", author: finalAuthor,
        type: manifest.type || "game", source: "local",
        githubUrl: "", installedAt: Date.now()
      };
      registry.push(entry);
    } else {
      entry.name = finalName; entry.description = finalDesc;
      entry.iconSvg = finalIcon; entry.version = manifest.version || entry.version;
      entry.author = finalAuthor;
    }
    saveRegistry();
    return id;
  }

  // 从源码字符串安装本地小程序（上传文件 / 粘贴代码共用）
  // overrides：{ name, author, iconSvg, description }，由工坊表单提供，优先于代码自带 manifest
  async function installFromCode(code, label, overrides) {
    code = (code || "").trim();
    if (!code) { showToast("内容为空，无法安装"); return false; }
    if (code.length < 20) { showToast("内容太短，疑似不是完整小程序"); return false; }
    const ov = overrides || {};
    const displayName = ov.name || label || "本地小程序";
    showToast("正在安装" + "「" + displayName + "」…");
    try {
      let registered = null;
      const sandbox = {
        registerMiniProgram: function (manifest, mountFn) {
          if (!manifest) manifest = {};
          if (!manifest.name) manifest.name = label || "本地小程序";
          registered = registerLocal(manifest, mountFn, code, ov);
          return registered;
        },
        MiniProgramAPI: null,
        console: console
      };
      const wrapper = new Function("registerMiniProgram", "MiniProgramAPI", "console", code);
      wrapper(sandbox.registerMiniProgram, null, console);
      if (!registered) throw new Error("代码未调用 registerMiniProgram(manifest, mountFn)");
      loadRegistry();
      showToast("小程序安装成功");
      // 若小程序页面（Hub）处于打开状态，立即刷新让新装小程序可见
      try {
        const hubOverlay = document.getElementById("miniprogram-hub-overlay");
        if (hubOverlay && hubOverlay.classList.contains("active")) renderHub();
      } catch (e) {}
      return true;
    } catch (e) {
      console.error("[MiniProgram] 本地安装失败", e);
      showToast("安装失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // 读取本地小程序持久化源码（供工坊「编辑」按钮回填代码框）
  function getLocalCode(id) {
    try { return localStorage.getItem(CODE_PREFIX + id) || ""; } catch (e) { return ""; }
  }

  // 用新源码 + overrides 重新安装并覆盖某个本地小程序（供工坊「编辑保存」使用）
  async function updateLocalCode(id, code, overrides) {
    code = (code || "").trim();
    if (!code) { showToast("内容为空，无法保存"); return false; }
    if (code.length < 20) { showToast("内容太短，疑似不是完整小程序"); return false; }
    loadRegistry();
    const entry = registry.find(r => r.id === id);
    if (!entry || entry.source !== "local") { showToast("仅本地小程序支持编辑"); return false; }
    const ov = overrides || {};
    // 给 manifest 强制注入 id，保证重新执行后仍是同一条记录
    let registered = null;
    const sandbox = {
      registerMiniProgram: function (manifest, mountFn) {
        if (!manifest) manifest = {};
        manifest.id = id; // 锁定 id，覆盖原记录而非新建
        registered = registerLocal(manifest, mountFn, code, ov);
        return registered;
      },
      MiniProgramAPI: null,
      console: console
    };
    try {
      const wrapper = new Function("registerMiniProgram", "MiniProgramAPI", "console", code);
      wrapper(sandbox.registerMiniProgram, null, console);
      if (!registered) throw new Error("代码未调用 registerMiniProgram(manifest, mountFn)");
      loadRegistry();
      showToast("已保存修改");
      return true;
    } catch (e) {
      console.error("[MiniProgram] 本地编辑保存失败", e);
      showToast("保存失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // 重新加载已持久化的本地小程序源码（重启后按需调用）
  function reloadLocalCode(id) {
    if (localImplementations[id]) return true;
    let code = null;
    try { code = localStorage.getItem(CODE_PREFIX + id); } catch (e) {}
    if (!code) return false;
    try {
      const wrapper = new Function("registerMiniProgram", "MiniProgramAPI", "console", code);
      wrapper(function (manifest, mountFn) {
        if (!manifest) manifest = {};
        manifest.id = id;
        localImplementations[id] = mountFn;
      }, null, console);
      return !!localImplementations[id];
    } catch (e) {
      console.error("[MiniProgram] 本地源码重载失败", e);
      return false;
    }
  }

  async function updateFromGithub(id) {
    loadRegistry();
    const entry = registry.find(r => r.id === id);
    if (!entry || entry.source !== "github" || !entry.githubUrl) { showToast("该小程序不支持更新"); return; }
    await installFromGithub(entry.githubUrl);
    renderHub();
  }

  function uninstall(id) {
    loadRegistry();
    registry = registry.filter(r => r.id !== id);
    delete githubImplementations[id];
    delete localImplementations[id];
    try { localStorage.removeItem(CODE_PREFIX + id); } catch (e) {}
    saveRegistry();
    showToast("已删除");
    renderHub();
  }

  function listRegistry() { loadRegistry(); return registry.slice(); }

  // 安装商店清单中的单个应用（保持 appId / 权限 / 所属商店信息）
  async function installStoreApp(storeUrl, app) {
    try {
      const appUrl = resolveUrl(app.url, storeUrl);
      const appId = app.id || ("mp_store_" + hashStr(app.name + "|" + appUrl));
      const code = await fetchUrlText(appUrl);
      const ok = await installSingleFromUrl(appUrl, code, {
        appId: appId, forcePermissions: app.permissions, manifestUrl: storeUrl,
        name: app.name, author: app.author, iconSvg: app.iconSvg,
        description: app.description, version: app.version, type: app.type
      });
      return ok;
    } catch (e) {
      console.error("[MiniProgram] 商店应用安装失败", e);
      showToast("安装失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // ============================================================
  //  Hub（小程序页面）：下拉进入
  // ============================================================
  function ensureHub() {
    if (document.getElementById("miniprogram-hub-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "miniprogram-hub-overlay";
    overlay.className = "miniprogram-hub-overlay";
    overlay.innerHTML = `
      <header class="mp-hub-header">
        <button class="mp-icon-btn" id="mp-hub-back" title="返回">${ICONS.close}</button>
        <h3>小程序</h3>
        <span style="width:36px"></span>
      </header>
      <div class="mp-hub-body" id="mp-hub-body"></div>
      <footer class="mp-hub-footer">
        <button class="mp-workshop-btn" id="mp-open-workshop">
          ${ICONS.workshop}<span>小程序工坊</span>
        </button>
      </footer>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#mp-hub-back").onclick = closeHub;
    overlay.querySelector("#mp-open-workshop").onclick = () => { if (window.miniProgramWorkshop) window.miniProgramWorkshop.open(); };
  }

  function renderHub() {
    ensureHub();
    const body = document.getElementById("mp-hub-body");
    if (!body) return;
    loadRegistry();
    if (registry.length === 0) {
      body.innerHTML = `<div class="mp-empty">
        ${ICONS.puzzle}
        <div class="mp-empty-title">还没有小程序</div>
        <div class="mp-empty-sub">点击底部「小程序工坊」一键安装或自制小程序</div>
      </div>`;
      return;
    }
    let html = '<div class="mp-grid">';
    for (const r of registry) {
      const icon = r.iconSvg || ICONS.puzzle;
      html += `<div class="mp-card" data-mp-id="${escapeHtml(r.id)}">
        <div class="mp-card-icon">${icon}</div>
        <div class="mp-card-name">${escapeHtml(r.name)}</div>
      </div>`;
    }
    html += "</div>";
    body.innerHTML = html;
    body.querySelectorAll(".mp-card").forEach(el => {
      el.onclick = () => launch(el.dataset.mpId);
    });
  }

  function openHub() {
    renderHub();
    const overlay = document.getElementById("miniprogram-hub-overlay");
    if (overlay) overlay.classList.add("active");
  }
  function closeHub() {
    const overlay = document.getElementById("miniprogram-hub-overlay");
    if (overlay) overlay.classList.remove("active");
  }

  // ============================================================
  //  运行时：启动某个小程序
  // ============================================================
  async function launch(id) {
    loadRegistry();
    const entry = registry.find(r => r.id === id);
    if (!entry) { showToast("未找到该小程序"); return; }

    let mountFn = null;
    if (entry.source === "builtin") {
      const impl = builtinImplementations[entry.builtinKey];
      if (!impl) { showToast("内置小程序未就绪"); return; }
      mountFn = impl.mount;
    } else if (entry.source === "github") {
      mountFn = githubImplementations[id];
      if (!mountFn) { showToast("该小程序未加载，请在工坊中重新拉取"); return; }
    } else if (entry.source === "local") {
      mountFn = localImplementations[id];
      if (!mountFn) {
        // 重启后内存缓存丢失，从持久化源码重新执行
        if (!reloadLocalCode(id)) { showToast("该本地小程序源码已丢失，请重新上传/粘贴安装"); return; }
        mountFn = localImplementations[id];
      }
      if (!mountFn) { showToast("该本地小程序未加载，请重新安装"); return; }
    }
    if (typeof mountFn !== "function") { showToast("小程序入口无效"); return; }

    closeHub();

    // 权限确认：声明了 permissions 的小程序，首次运行需用户确认（仿应用商店权限弹窗）
    if (!(await ensurePermApproved(entry))) { showToast("已取消授权，未启动"); return; }

    ensureRuntime();
    const runtime = document.getElementById("miniprogram-runtime-overlay");
    const container = document.getElementById("mp-runtime-content");
    container.innerHTML = "";

    // 页头显示小程序名称（而非写死的「小程序」）
    const titleEl = document.getElementById("mp-runtime-title");
    if (titleEl) titleEl.textContent = entry.name || "小程序";

    const api = buildAPI(entry);
    currentRunning = { entry: entry, api: api, cleanup: null };
    // 初始化房间成员表：先把「我」放进去，后续分享拉入的 char 会追加进来
    currentRoomMembers = [];
    try {
      const me = await api.getActiveUser();
      if (me) currentRoomMembers.push({ id: me.id || 0, name: me.name || "我", avatar: me.avatar || "", isMe: true, type: "user", persona: me.persona || "" });
    } catch (e) {}
    try {
      const cleanup = mountFn(container, api);
      currentRunning.cleanup = (typeof cleanup === "function") ? cleanup : null;
      runtime.classList.add("active");
    } catch (e) {
      console.error("[MiniProgram] 启动失败", e);
      container.innerHTML = `<div class="mp-empty"><div class="mp-empty-title">小程序启动失败</div><div class="mp-empty-sub">${escapeHtml(e && e.message ? e.message : e)}</div></div>`;
      runtime.classList.add("active");
    }
  }

  function ensureRuntime() {
    if (document.getElementById("miniprogram-runtime-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "miniprogram-runtime-overlay";
    overlay.className = "miniprogram-runtime-overlay";
    overlay.innerHTML = `
      <header class="mp-runtime-header">
        <div class="mp-runtime-title" id="mp-runtime-title">小程序</div>
        <div class="mp-capsule" id="mp-capsule">
          <button class="mp-capsule-btn" id="mp-capsule-toggle" title="更多">${ICONS.more}</button>
          <div class="mp-capsule-menu" id="mp-capsule-menu">
            <button class="mp-capsule-item" id="mp-capsule-share">${ICONS.share}<span>分享给好友</span></button>
            <button class="mp-capsule-item" id="mp-capsule-exit">${ICONS.close}<span>退出小程序</span></button>
          </div>
        </div>
      </header>
      <div class="mp-runtime-content" id="mp-runtime-content"></div>
    `;
    document.body.appendChild(overlay);
    const toggle = overlay.querySelector("#mp-capsule-toggle");
    const menu = overlay.querySelector("#mp-capsule-menu");
    toggle.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("open"); };
    document.addEventListener("click", () => menu.classList.remove("open"), true);
    overlay.querySelector("#mp-capsule-exit").onclick = close;
    overlay.querySelector("#mp-capsule-share").onclick = () => { shareCurrent(); };
  }

  function close() {
    const overlay = document.getElementById("miniprogram-runtime-overlay");
    if (overlay) overlay.classList.remove("active");
    if (currentRunning && typeof currentRunning.cleanup === "function") {
      try { currentRunning.cleanup(); } catch (e) {}
    }
    const container = document.getElementById("mp-runtime-content");
    if (container) container.innerHTML = "";
    currentRunning = null;
    currentRoomMembers = [];
    const menu = document.getElementById("mp-capsule-menu");
    if (menu) menu.classList.remove("open");
  }

  function shareCurrent() {
    if (!currentRunning) { showToast("没有运行中的小程序"); return; }
    const entry = currentRunning.entry;
    const menu = document.getElementById("mp-capsule-menu");
    if (menu) menu.classList.remove("open");
    openSharePicker(entry);
  }

  // ============================================================
  //  分享卡片：唤出对话列表（含头像/名字/群聊），选择后发送 + 拉入房间
  // ============================================================
  async function openSharePicker(entry) {
    // 收集所有会话（单聊 + 群聊），带头像与名字
    let sessions = [];
    try {
      const userIdNum = (typeof activeUserPersonaId !== "undefined") ? Number(activeUserPersonaId) : 0;
      if (userIdNum) sessions = await db.sessions.where("userId").equals(userIdNum).toArray();
    } catch (e) {}
    if (!sessions.length) { showToast("暂无可分享的对话"); return; }

    // 预加载头像/名字/群标识
    const items = [];
    for (const s of sessions) {
      let name = s.customCharName || "未知", avatar = s.customCharAvatar || "", isGroup = (s.isGroup === 1);
      if (!isGroup) {
        const ch = s.charId ? await db.archives.get(s.charId) : null;
        if (ch) { name = s.customCharName || ch.name; avatar = s.customCharAvatar || ch.avatar || ""; }
      }
      items.push({ s, name, avatar, isGroup });
    }

    // 构建选择器模态
    let modal = document.getElementById("mp-share-picker");
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = "mp-share-picker";
    modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10400; display:flex; align-items:flex-end; justify-content:center; box-sizing:border-box;";
    modal.innerHTML = `
      <div style="background:#fff; width:100%; max-width:420px; max-height:75vh; border-radius:16px 16px 0 0; display:flex; flex-direction:column; box-shadow:0 -4px 24px rgba(0,0,0,0.2); animation:scaleIn 0.2s ease-out;">
        <div style="padding:14px 16px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:15px; font-weight:700; color:#1a1a1a;">分享给好友</span>
          <button id="mp-share-close" style="border:none; background:transparent; color:#999; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1;">&times;</button>
        </div>
        <div style="flex:1; overflow-y:auto; padding:6px 0;" id="mp-share-list"></div>
        <div style="padding:10px 16px calc(10px + env(safe-area-inset-bottom)); border-top:1px solid #eee; font-size:11px; color:#999; text-align:center;">选择一个对话，对方将进入「${escapeHtml(entry.name)}」房间</div>
      </div>
    `;
    document.body.appendChild(modal);
    const listEl = modal.querySelector("#mp-share-list");
    items.forEach(it => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; gap:12px; padding:11px 16px; cursor:pointer; border-bottom:1px solid #f5f5f5;";
      const avatarHtml = it.avatar
        ? `<img src="${escapeHtml(it.avatar)}" style="width:42px; height:42px; border-radius:8px; object-fit:cover;" onerror="this.style.display='none'">`
        : `<div style="width:42px; height:42px; border-radius:8px; background:#e8f0fe; display:flex; align-items:center; justify-content:center; color:#3b82f6; font-weight:700; font-size:16px;">${escapeHtml((it.name||"?").slice(0,1))}</div>`;
      row.innerHTML = `${avatarHtml}
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:600; color:#1a1a1a; display:flex; align-items:center; gap:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escapeHtml(it.name)}
            ${it.isGroup ? '<span style="font-size:10px; padding:1px 6px; background:#e8f5e9; color:#07c160; border-radius:4px; font-weight:700;">群聊</span>' : ''}
          </div>
          <div style="font-size:11px; color:#999; margin-top:2px;">${it.isGroup ? "所有群成员将进入房间" : "点击邀请对方进入房间"}</div>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ccc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
      row.onclick = async () => {
        modal.remove();
        await _sendShareCardToSession(entry, it.s);
      };
      listEl.appendChild(row);
    });
    modal.querySelector("#mp-share-close").onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  }

  // 发送分享卡片到指定会话，并把该会话的 char/群成员拉入当前房间
  async function _sendShareCardToSession(entry, sess) {
    // 读取运行中小程序的分享配置（由 .js 通过 api.shareConfig 自定义）
    const cfg = (currentRunning && currentRunning.api && currentRunning.api.shareConfig) || {};
    const followPersona = cfg.followPersona !== false; // 默认 true
    const carryData = cfg.carryData !== undefined ? cfg.carryData : null;
    const inviteText = cfg.inviteText || ("来一起玩「" + entry.name + "」吧！");

    const card = {
      mpId: entry.id, mpName: entry.name, mpIconSvg: entry.iconSvg || ICONS.puzzle,
      inviteText: inviteText, carryData: carryData, from: "user", timestamp: Date.now()
    };
    const msg = {
      sessionId: sess.id, senderType: "user", senderId: 0,
      content: JSON.stringify(card), contentType: "miniprogram_share", timestamp: Date.now()
    };
    try { msg.id = await db.messages.add(msg); } catch (e) {}

    // 拉入房间：收集该会话的参与者（followPersona=false 时不带 persona）
    let participants = [];
    try {
      if (sess.isGroup === 1 && sess.groupId) {
        const members = await db.group_members.where("groupId").equals(sess.groupId).toArray();
        for (const m of members) {
          if (m.memberType !== "char") continue;
          const arch = await db.archives.get(m.memberId);
          const isSnapshot = !!m.isSnapshot;
          // 支线人物（对话快照分支）使用群成员唯一行 id 派生独立标识，避免与同名主线人物相互覆盖/混淆
          participants.push({
            id: isSnapshot ? ("snap_" + m.id) : m.memberId,
            memberId: m.memberId,
            name: m.displayName || (arch ? arch.name : "角色"),
            baseName: arch ? arch.name : "",
            avatar: arch ? (arch.avatar || "") : "",
            isMe: false,
            type: "char",
            isSnapshot: isSnapshot,
            snapshotLabel: m.snapshotLabel || "",
            sourceArchiveId: m.sourceArchiveId || 0,
            persona: followPersona ? (arch ? (arch.persona || "") : "") : ""
          });
        }
      } else {
        let ch = sess.charId ? await db.archives.get(sess.charId) : null;
        if (!ch) ch = { id: -1, name: sess.customCharName || "对方", avatar: sess.customCharAvatar || "", persona: sess.customCharPersona || "" };
        participants.push({ id: ch.id || -1, name: ch.name, avatar: ch.avatar || "", isMe: false, type: "char", persona: followPersona ? (ch.persona || "") : "" });
      }
    } catch (e) {}

    // 维护系统级房间成员表（供 api.getRoomMembers 读取）：去重追加新参与者
    try {
      for (const p of participants) {
        if (!currentRoomMembers.some(m => m.id === p.id && m.isMe === p.isMe)) {
          currentRoomMembers.push(Object.assign({}, p));
        }
      }
    } catch (e) {}

    // 通知运行中的游戏拉入参与者（游戏通过 api.onInvite 注册回调）
    // shareInfo 携带 carryData（由 .js 自定义）与来源会话，让游戏自行决定如何处理
    if (currentRunning && currentRunning.api && typeof currentRunning.api.onInvite === "function") {
      try { currentRunning.api.onInvite(participants, { carryData: carryData, session: sess }); } catch (e) {}
    }
    showToast("已分享给 " + (sess.customCharName || "对方") + "，对方已进入房间");
  }

  // char 反向邀请 user（小程序内调用）
  async function _sendShareCardFromChar(entry, inviteText) {
    if (typeof activeSessionId === "undefined" || !activeSessionId) return;
    const card = {
      mpId: entry.id, mpName: entry.name, mpIconSvg: entry.iconSvg || ICONS.puzzle,
      inviteText: inviteText || "来一起玩吧！", from: "char", timestamp: Date.now()
    };
    const msg = {
      sessionId: activeSessionId, senderType: "char", senderId: 0,
      content: JSON.stringify(card), contentType: "miniprogram_share", timestamp: Date.now()
    };
    msg.id = await db.messages.add(msg);
    if (typeof appendMessageToDOM === "function") await appendMessageToDOM(msg);
  }

  // 渲染分享卡片 HTML（供 app_chat.js 渲染分支调用）
  function renderShareCardHtml(m) {
    let card = {};
    try { card = JSON.parse(m.content); } catch (e) { return escapeHtml(m.content); }
    const isUser = (card.from === "user") || (m.senderType === "user");
    const icon = card.mpIconSvg || ICONS.puzzle;
    return `<div class="mp-share-card" data-mp-id="${escapeHtml(card.mpId || "")}" data-mp-name="${escapeHtml(card.mpName || "")}">
      <div class="mp-share-icon">${icon}</div>
      <div class="mp-share-body">
        <div class="mp-share-name">${escapeHtml(card.mpName || "小程序")}</div>
        <div class="mp-share-invite">${escapeHtml(card.inviteText || "")}</div>
      </div>
      <div class="mp-share-action">${isUser ? "等待对方加入" : "点击加入"}</div>
    </div>`;
  }

  // 点击分享卡片 → 打开对应小程序
  function bindShareCardClicks(root) {
    if (!root) return;
    root.querySelectorAll(".mp-share-card").forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.onclick = () => {
        const id = el.dataset.mpId;
        if (!id) return;
        loadRegistry();
        // 1. 直接按 id 命中
        let entry = registry.find(r => r.id === id);
        // 2. char 邀请产生的临时卡片（mp_invite_*）按名称回退匹配注册表
        if (!entry) {
          const name = el.dataset.mpName || el.querySelector(".mp-share-name")?.textContent?.trim();
          if (name) entry = registry.find(r => r.name === name);
        }
        if (entry) launch(entry.id);
        else showToast("未找到该小程序，请先在小程序工坊安装");
      };
    });
  }

  // ============================================================
  //  开关注入：当会话开启"允许分享小程序"时，注入 prompt
  // ============================================================
  async function buildSharePrompt(sessionId) {
    let sess = null;
    try { sess = await db.sessions.get(sessionId); } catch (e) {}
    if (!sess || sess.allowMiniprogramShare !== 1) return "";
    const isGroup = sess.isGroup === 1;
    const charName = sess.customCharName || "对方";
    return `\n\n【小程序分享卡片指令（重要）】
用户可能向你发送「小程序分享卡片」（在上下文中以 [小程序分享] 标记出现），表示邀请你一起玩某个小程序（小游戏）。
- 你应当以自身角色性格自然回应这份邀请：可以接受、调侃、提条件或顺势互动，不要机械说教。
- 当你主动想邀请用户一起玩某个小程序时，可以在回复末尾追加一行指令（必须独占一行）：
  [MP_INVITE]{ "mpName": "小程序名称", "inviteText": "你的邀请话术" }
  系统会自动把它转为一张小程序分享卡片发送给用户，用户点击即可加入。
- ${isGroup ? "当前是群聊，邀请可面向全体成员。" : "当前是单聊。"}
- ${isGroup ? "若群内存在主线人物与支线人物（对话快照分支）：支线人物是某个主线人物在历史某时刻的独立分支个体，显示名带存档标签（如「角色名（存档）」）或标注「支线」。它们是完全不同的人，各自拥有专属记忆与进度；在小程序内参与时，必须使用各自完整带标记的名字区分身份，绝不能用主线本名替代，也绝不互相串台、把对方当作自己的过去。" : ""}
- 仅在确实想发起小游戏时才使用 [MP_INVITE] 指令，平时正常对话即可。`;
  }

  // 解析 AI 回复中的 [MP_INVITE] 指令 → 转为 char 发出的分享卡片
  async function parseAndApplyInvite(rawReply, sessionId) {
    if (!rawReply) return rawReply;
    const m = rawReply.match(/\[MP_INVITE\]\s*(\{[\s\S]*?\})/);
    if (!m) return rawReply;
    try {
      const data = JSON.parse(m[1]);
      const cleaned = rawReply.replace(/\[MP_INVITE\]\s*\{[\s\S]*?\}/, "").trim();
      // 在该会话产生一张 char 分享卡片
      const entry = { id: "mp_invite_" + Date.now(), name: data.mpName || "小程序", iconSvg: ICONS.puzzle };
      await _sendShareCardFromChar(entry, data.inviteText || "来一起玩吧！");
      return cleaned;
    } catch (e) { return rawReply; }
  }

  // ============================================================
  //  下拉手势：在对话页顶部下拉进入小程序页面
  //  关键修复：touchmove 必须为非 passive 才能 preventDefault，
  //  否则浏览器橡皮筋/下拉刷新会吞掉手势，用户感觉"没反应"
  // ============================================================
  let pullIndicator = null;
  function getPullIndicator() {
    if (pullIndicator && document.body.contains(pullIndicator)) return pullIndicator;
    pullIndicator = document.createElement("div");
    pullIndicator.id = "mp-pull-indicator";
    pullIndicator.style.cssText = "position:fixed; top:0; left:0; right:0; height:0; overflow:hidden; display:flex; align-items:center; justify-content:center; gap:6px; background:#f7f7f7; color:#07c160; font-size:12px; font-weight:600; z-index:10000; transition:height 0s; pointer-events:none; box-sizing:border-box;";
    pullIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg><span id="mp-pull-text">下拉进入小程序</span>';
    document.body.appendChild(pullIndicator);
    return pullIndicator;
  }
  function setPullIndicator(delta, threshold) {
    const ind = getPullIndicator();
    const h = Math.min(delta, threshold * 1.2);
    ind.style.height = h + "px";
    const txt = ind.querySelector("#mp-pull-text");
    if (txt) txt.textContent = delta >= threshold ? "松开进入小程序" : "下拉进入小程序";
  }
  function hidePullIndicator() {
    const ind = getPullIndicator();
    ind.style.transition = "height 0.2s ease";
    ind.style.height = "0px";
  }

  function attachPullDown() {
    // 下拉手势挂在「聊天对话列表页」的滚动容器上（仿微信从页头下拉进入小程序）
    // 滚动容器是 #win-chat 下的 .win-body.chat-app-body；仅在会话列表 tab 激活时生效
    const winChat = document.getElementById("win-chat");
    if (!winChat) return;
    const container = winChat.querySelector(".win-body.chat-app-body");
    if (!container || container.dataset.mpPullBound) return;
    container.dataset.mpPullBound = "1";

    function isSessionsTabActive() {
      const tab = document.getElementById("chat-tab-sessions");
      return !!(tab && tab.classList.contains("active"));
    }
    function isChatAppOpen() {
      const w = document.getElementById("win-chat");
      return !!(w && w.classList.contains("active"));
    }

    let startY = 0, pulling = false, curDelta = 0, activated = false;
    const THRESHOLD = 60;

    container.addEventListener("touchstart", (e) => {
      if (!isChatAppOpen() || !isSessionsTabActive()) { pulling = false; return; }
      if (container.scrollTop <= 0 && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        pulling = true; curDelta = 0; activated = false;
      } else { pulling = false; }
    }, { passive: true });

    // 非 passive：才能在顶部下拉时 preventDefault，阻止浏览器橡皮筋/下拉刷新
    container.addEventListener("touchmove", (e) => {
      if (!pulling) return;
      curDelta = e.touches[0].clientY - startY;
      if (curDelta > 0) {
        // 顶部下拉：阻止默认滚动行为
        if (e.cancelable) e.preventDefault();
        activated = true;
        setPullIndicator(curDelta, THRESHOLD);
      }
    }, { passive: false });

    container.addEventListener("touchend", () => {
      if (!pulling) return;
      pulling = false;
      hidePullIndicator();
      if (activated && curDelta >= THRESHOLD) {
        openHub();
      }
      curDelta = 0; activated = false;
    });

    container.addEventListener("touchcancel", () => {
      pulling = false; hidePullIndicator(); curDelta = 0; activated = false;
    });

    // 鼠标兜底（桌面调试）
    let mDown = false;
    container.addEventListener("mousedown", (e) => {
      if (!isChatAppOpen() || !isSessionsTabActive()) return;
      if (container.scrollTop <= 0) { mDown = true; startY = e.clientY; curDelta = 0; activated = false; }
    });
    container.addEventListener("mousemove", (e) => {
      if (!mDown) return;
      curDelta = e.clientY - startY;
      if (curDelta > 0) { activated = true; setPullIndicator(curDelta, THRESHOLD); }
    });
    container.addEventListener("mouseup", () => {
      if (!mDown) return;
      mDown = false;
      hidePullIndicator();
      if (activated && curDelta >= THRESHOLD) openHub();
      curDelta = 0; activated = false;
    });
    container.addEventListener("mouseleave", () => {
      if (mDown) { mDown = false; hidePullIndicator(); curDelta = 0; activated = false; }
    });
  }

  // ============================================================
  //  初始化
  // ============================================================
  function init() {
    loadRegistry();
    // 延迟挂载下拉手势到聊天列表页滚动容器（确保容器已渲染）
    const tryAttach = () => {
      const winChat = document.getElementById("win-chat");
      const c = winChat ? winChat.querySelector(".win-body.chat-app-body") : null;
      if (c) attachPullDown();
      else setTimeout(tryAttach, 600);
    };
    setTimeout(tryAttach, 800);

    // 绑定聊天列表页头部的小程序入口按钮（可靠兜底，下拉手势的补充）
    const bindEntry = () => {
      const btn = document.getElementById("btn-miniprogram-entry");
      if (btn && !btn.dataset.mpBound) {
        btn.dataset.mpBound = "1";
        btn.onclick = () => openHub();
      }
    };
    bindEntry();
    // 聊天应用可能后渲染，延迟再绑一次
    setTimeout(bindEntry, 1500);
    setTimeout(bindEntry, 3000);

    // 监听对话容器渲染后绑定分享卡片点击（仍挂在对话页，分享卡片渲染在对话气泡里）
    const obsTarget = document.getElementById("dialog-messages-container");
    if (obsTarget && window.MutationObserver) {
      const mo = new MutationObserver(() => bindShareCardClicks(obsTarget));
      mo.observe(obsTarget, { childList: true, subtree: true });
    }
  }

  // 按小程序 id 清除其所有持久化状态（供工坊「初始化」按钮调用）
  function resetStateById(id) {
    if (!id) return false;
    const prefix = STATE_PREFIX + id + "_";
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    return true;
  }

  // 权限确认（仿应用商店权限弹窗）：
  // 声明了 permissions 的小程序首次运行弹窗列出权限清单；用户确认后标记一次，之后不再打扰。
  function ensurePermApproved(entry) {
    const perms = permsOf(entry);
    if (perms === null || perms.indexOf("*") >= 0) return Promise.resolve(true);
    try { if (localStorage.getItem(PERM_APPROVED_PREFIX + entry.id) === "1") return Promise.resolve(true); } catch (e) {}
    const labels = perms.map(p => (PERM_META[p] || p)).join("\n");
    const title = "权限确认";
    const message = "小程序「" + entry.name + "」申请以下权限：\n" + labels +
      "\n\n请确认来源可信后再授权。密钥由系统保管，小程序无法直接读取；MCP 调用由系统代理执行。";
    const onOk = () => { try { localStorage.setItem(PERM_APPROVED_PREFIX + entry.id, "1"); } catch (e) {} return true; };
    return new Promise((resolve) => {
      try {
        if (typeof window.showCustomConfirm === "function") {
          window.showCustomConfirm(title, message, () => resolve(onOk()), () => resolve(false));
        } else if (window.confirm) {
          const ok = window.confirm(title + "\n" + message);
          resolve(ok ? onOk() : false);
        } else { resolve(true); }
      } catch (e) { resolve(true); }
    });
  }

  // ============================================================
  //  导出
  // ============================================================
  window.miniProgramSystem = {
    init, registerBuiltin, registerGithub, installFromGithub, installFromUrl, installStore, installStoreApp, updateStoreApps,
    listStores, removeStore, installFromCode, updateFromGithub, uninstall,
    listRegistry, openHub, closeHub, launch, close, renderHub, renderShareCardHtml, bindShareCardClicks,
    buildSharePrompt, parseAndApplyInvite, openSharePicker, ICONS,
    getLocalCode, updateLocalCode, resetStateById, PERM_META, fetchUrlText,
    _sendShareCardFromUser: _sendShareCardToSession
  };

  // 自动初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
