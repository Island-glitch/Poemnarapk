/**
 * ============================================================
 * app_miniprogram_workshop.js - 小程序工坊
 * ------------------------------------------------------------
 * 结构（上 → 中 → 下）：
 *   1. 上方「安装小程序」：点击展开卡片，可上传文件 / 复制粘贴代码 / 链接安装
 *      （统一输入框，自动识别 .js 直链 或 应用商店清单 store.json）；并可填写名称、作者、SVG 图标（覆盖代码自带 manifest）。
 *   2. 中间「已安装小程序」：列出所有小程序，展示权限标签与来源（本地/内置/商店/社区）；
 *      本地小程序支持「编辑」（展开大卡片编辑代码并保存）与「删除」。
 *   3. 底部「AI 辅助制作」：一键复制 Prompt，粘贴给任意大模型即可生成小程序（含部署与链接导入教程）。
 * UI 规范：禁止新增任何 emoji，所有按钮使用纯矢量 SVG 图标。
 * 依赖：window.miniProgramSystem
 * ============================================================
 */
(function () {
  "use strict";

  const ICONS = (window.miniProgramSystem && window.miniProgramSystem.ICONS) || {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toast(msg) { if (typeof window.showToast === "function") window.showToast(msg); }

  // 默认 SVG 图标（用于安装卡片预览）
  const DEFAULT_ICON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.47 1.229 0 1.698l-2.609 2.61a.75.75 0 0 1-.886.13 3 3 0 0 0-3.488 4.05.75.75 0 0 1-.13.886l-2.61 2.609c-.47.47-1.229.47-1.698 0l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.13.02-.261.029-.391.029a3 3 0 1 1 0-6c.13 0 .261.009.391.029a1.026 1.026 0 0 0 .877-.29l1.568-1.568c.47-.47 1.229-.47 1.698 0l2.61 2.609a.75.75 0 0 0 .886.13 3 3 0 0 0 4.05-3.488z"/></svg>';
  // 链接图标（宿主 ICONS 未内置）
  const LINK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  // 解析相对链接（商店清单内 app.url 可为相对路径）
  function resolveRel(u, base) { try { return new URL(u, base).href; } catch (e) { return u; } }

  // ============================================================
  //  一键复制 Prompt（极详细）
  //  注：支持「上传文件 / 粘贴代码 / 链接安装（.js 直链或应用商店）」三种安装方式
  // ============================================================
  const WORKSHOP_PROMPT = `你是一名资深前端工程师，正在为「叙事诗小手机」这款本地 AI 角色扮演 App 开发【小程序】。请严格按下方规范一次输出完整可用的文件。

小程序拥有对宿主资源的完全接入能力：可读取/写入角色档案、会话、消息、记忆、关系网、世界书；可调用大模型生成回复；可读写本地文件与持久化状态。你可以自由组合这些接口，做出任何你想要的小程序。

═══════════════════════════════
一、交付物（必须一次性全部输出）
═══════════════════════════════
1. 一个独立的 .js 文件全文（用 \`\`\`javascript 代码块包裹），文件名建议形如 my_miniprogram.js。
2. 一段「使用说明」，告诉用户三种安装方式任选其一：
   - 方式 A（上传文件）：在小程序工坊「安装小程序」卡片里点击「上传 .js 文件」，直接选择本地 .js 文件即可安装，离线也可用。
   - 方式 B（粘贴代码）：在小程序工坊「安装小程序」卡片里点击「粘贴代码」，把 .js 全文粘进文本框，再点击「安装」即可。
   - 方式 C（链接安装，唯一的在线分发方式，推荐用于分享）：把 .js 文件部署为一条 https 直链（见下方「七、链接安装规格」），用户在小程序工坊「安装小程序」→ 展开卡片 →「链接安装」输入框粘贴该链接，点击「链接安装」即可，无需复制代码。若要分发多个小程序，可再制作一份「应用商店清单」（store.json，见第六节），把清单链接粘贴到同一个「链接安装」输入框，即可一次性装齐全部应用；再次粘贴同一链接即为「更新」。
3. 一段「部署与导入教程」（方式 C 专属，务必完整输出，教用户把本 .js 部署为可访问的直链并导入）：
   - 明确告知本小程序「可接受的链接类型」与「不可用的链接类型」（规格见第七节）；
   - 至少给出两种具体部署路径（示例：GitHub → 新建/打开仓库 → 上传本文件 → 打开文件点击 Raw 复制 raw.githubusercontent.com 链接；或用 jsDelivr：https://cdn.jsdelivr.net/gh/用户名/仓库名@分支/路径/文件.js；以及 Gitee Pages / 任意静态托管）；
   - 给出在「叙事诗小手机」内的导入步骤：小程序工坊 →「安装小程序」→ 展开安装卡片 →「链接安装」输入框 → 粘贴链接 → 点击「链接安装」。

═══════════════════════════════
二、小程序代码规范（必须遵守）
═══════════════════════════════
小程序是一个自执行脚本，通过调用全局 registerMiniProgram(manifest, mountFn) 注册自己。模板如下：

\`\`\`javascript
(function () {
  registerMiniProgram({
    id: "mp_xxx_unique",            // 可选，建议用 mp_ 前缀+唯一串
    name: "小程序名称",              // 必填：小程序名称（也可在工坊安装卡片里手动覆盖）
    description: "一句话描述",
    version: "1.0.0",
    author: "作者",                  // 必填：作者名（也可在工坊安装卡片里手动覆盖）
    type: "game",                   // game | tool
    iconSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">...</svg>'  // 必填：SVG 图标字符串（也可在工坊安装卡片里手动覆盖）
    permissions: ["llm", "storage"], // 可选：权限白名单（取值见下「权限声明」）。不写 = 默认拥有全部权限（旧版兼容）；写了则只开放声明项，其余 API 会被宿主裁剪，且密钥不可见
  }, function (container, api) {
    // container: DOM 容器，把你的 UI 渲染进去
    // api: MiniProgramAPI，见第三节接口
    container.innerHTML = '<div style="padding:16px;">我的小程序</div>';

    // 可选：返回 cleanup 函数，退出时调用
    return function cleanup() {};
  });
})();
\`\`\`

关于小程序元信息（name / author / iconSvg）的两种写入方式：
- 方式 1：直接写在代码的 manifest 字段里（推荐，一劳永逸）。
- 方式 2：在工坊「安装小程序」卡片里手动填写这三个字段，它们会覆盖代码自带的 manifest；适合代码里没写、或想临时改名/换图标的情况。

硬性要求：
- 禁止使用任何 emoji 字符，所有按钮、图标必须用纯内联 SVG（<svg>...</svg>）。
- 单文件、零依赖、零外部网络请求（除通过 api.callLLM 调用大模型、api.mcp.invoke 调用 MCP 工具外）。
- 代码在浏览器/Android WebView 中运行，可用原生 DOM API；不得使用 fetch 直接请求外部资源（网络能力一律走 api.callLLM / api.mcp.invoke，由宿主代理，密钥不泄露）。
- 必须对 api 调用做 try/catch 与空值兜底，绝不因接口异常而白屏。
- 样式尽量自包含（内联 style 或在 container 内注入 <style>），不要污染宿主页面。

═══════════════════════════════
三、MiniProgramAPI 接口清单（你可以调用小手机里的每一个接口）
═══════════════════════════════
所有方法均为 Promise（除特别标注），请用 await 调用。

【会话与角色】
- api.getActiveSessionId() → 当前会话 id（同步）
- api.getSession(sessionId?) → 当前会话对象 {charId, customCharName, customCharPersona, isGroup, groupId, userId, ...}
- api.getActiveChar() → 当前单聊角色 {name, avatar, persona}
- api.getActiveUser() → 当前用户「我」{ id, name, avatar, persona }（用于让 AI 知道玩家本人是谁、人设如何）
- api.getChar(charId) → 指定角色档案 {name, avatar, persona, type, remark}
- api.getGroupMembers(groupId?) → 群聊成员列表 [{id, type:'char'|'user', name, avatar, persona}]
- api.getArchives({type?}) → 档案馆全部角色档案（type 可为 'char'/'user' 等）
- api.getSessions() → 当前用户的所有会话列表（单聊+群聊）[{id, charId, customCharName, isGroup, groupId, userId, title}]
- api.getMessages(sessionId?, limit?) → 某会话最近 N 条消息（默认 20）[{id, senderType, senderId, content, contentType, timestamp}]
- api.sendMessage(sessionId?, senderType, content, contentType?) → 向某会话写入一条消息（senderType: 'user'/'assistant'，contentType: 'text'/'miniprogram_share' 等）。可用于把小程序结果推送到聊天记录里
- api.saveArchive(archive) → 创建或更新角色档案（写入档案馆）。传入 {id?更新, name, type:'char'|'user', persona, avatar, remark}，返回档案 id
- api.getWorldBookEntries(charId?) → 读取世界书条目（可选按 charId 过滤挂载的条目）[{id, title, content, keywords, scope, enabled, charId}]
- api.getAllRelations() → 获取所有关系网数据 [{fromId, toId, relation}]

【房间成员（小程序多人玩法核心接口）】
当用户通过右上角胶囊「分享给好友」把某个对话/群聊的角色拉进当前小程序房间时，系统会维护一份「当前房间成员表」，你可在小程序内随时读取：
- api.getRoomMembers() → 返回当前房间全部成员数组（同步，无需 await）：[{ id, name, avatar, isMe, type, persona }]
  · 第一个成员固定是「我」（isMe=true, type='user'），即当前登录用户；
  · 其余成员是用户通过分享拉入的 char（isMe=false, type='char'），每个含 {id(角色档案id), name, avatar, persona}；
  · 成员会在每次成功分享后自动去重追加；退出小程序时清空。
  用途：多人小游戏可据此渲染在场玩家列表、判断轮到谁、或为每个 char 拼接人设 prompt。
- api.onInvite = (participants) => {} → 覆写此回调以「实时接收」新拉入的参与者（participants 是本次新增的数组，非全量）。
  与 getRoomMembers() 的区别：onInvite 是事件通知（只在有新人加入时触发一次，拿到的是增量），getRoomMembers() 是主动查询（随时可调，拿到的是全量）。两者配合使用：onInvite 收到新人后追加进自己的 state，需要全量时调 getRoomMembers()。
  onInvite 签名：onInvite(participants, shareInfo)，shareInfo = { carryData, session }，carryData 是分享时携带的自定义数据（见下方 shareConfig），session 是来源会话对象。
- api.share() → 主动唤起分享面板，让用户再拉入新的角色（与点右上角胶囊「分享」等效）。
- api.shareConfig → 分享配置对象（.js 可自行覆写）：
  · followPersona (bool, 默认 true): 是否让被拉入的 char 跟随当前面具(persona)。设为 false 则参与者 persona 为空字符串。
  · carryData (any, 默认 null): 分享时携带的自定义数据（由 .js 自定义内容），会随 onInvite 的 shareInfo.carryData 传回给游戏，也可在分享卡片中携带。
  · inviteText (string, 默认 null): 分享卡片上的邀请文案，不设则用默认"来一起玩…"。
  用途示例：游戏可在分享前设置 api.shareConfig.carryData = { round: 5, topic: "xxx" }，被邀请者加入后 onInvite 回调能读到这些数据并据此决定如何处理（如立即切换回合、传递游戏状态等）。

【记忆系统（聊天里的总结、记忆、上下文都可读可写）】
- api.getMainMemory(sessionId?) → 主记忆 {coreSelfStatus, coreSelfPurpose, coreSelfChanges, coreRelationship, coreUserInEyes, latestSummary:{content,keywords,timestamp}}
- api.getRecentContext(sessionId?, limit=10) → 最近对话上下文 [{senderType, senderId, contentType, content, timestamp}]
- api.getRelationshipNetwork(charId?) → 关系网 [{fromId, toId, relation}]
- api.findSessionByCharId(charId) → 按角色 id 反查它对应的单聊会话对象（用于读取该角色的记忆/上下文/总结）。找不到返回 null。
- api.getCharRichContext(charId) → 一站式获取某角色的完整上下文（强烈推荐多人玩法使用），返回：
    { charId, name, persona, memory, recentContext, network }
  其中 memory = 主记忆对象（同 getMainMemory），recentContext = 最近 12 条对话（同 getRecentContext），network = 关系网（同 getRelationshipNetwork）。
  内部已自动按 charId 查找对应会话，无需你自己再 findSessionByCharId。用它拼 prompt 可让 AI 真正"认识"在场每个角色。
- api.saveSummary({sessionId?, startRound?, endRound?, content, keywords?, category?}) → 向当前会话写入一条「长周期总结」沉淀到小手机主记忆（返回 true/false）。category 可填 "miniprogram" 等。游戏一局结束后建议调用，把本局要点写进记忆。
- api.updateMainMemory({sessionId?, coreSelfStatus?, coreSelfPurpose?, coreSelfChanges?, coreRelationship?, coreUserInEyes?}) → 直接更新当前会话主记忆的五大核心字段（只传需改的字段，返回 true/false）。用于把小程序里发生的关键变化（如关系升温、心态转变）回写主记忆，让后续对话受其影响。

【权限声明（应用商店式安全模型，可选但强烈推荐）】
在 manifest 里用 permissions 数组声明小程序需要的权限，白名单外的 API 会被宿主裁剪（调用直接报错），且密钥/服务器地址对小程序不可见：
- "llm": 调用大模型生成回复（callLLM / getCharReply）
- "api": 读取模型配置（不含密钥）
- "memory": 读写会话记忆 / 总结 / 上下文
- "chat": 读取与发送聊天消息
- "archive": 读写角色档案 / 档案馆
- "worldbook": 读取世界书条目
- "network": 读取关系网
- "storage": 本地状态持久化
- "files": 文件读写 / 上传 / 导出
- "share": 分享 / 邀请 / 房间成员
- "mcp": 调用 MCP 工具（由宿主代理执行）
- "user": 读取当前用户信息
- "*": 全部授权
不写 permissions 的小程序默认拥有全部权限（旧版兼容）；写了之后，首次运行会弹窗列出权限清单供用户确认。建议声明得尽量精简、够用就好，越克制越容易赢得用户信任。注意：声明了权限后 api.getApiConfig() 不再返回明文 key（见下）。

【调用大模型（用全局配置的 apikey，密钥由宿主保管）】
- api.getApiConfig() → {url, model, temperature, hasKey}（安全模型：声明了 permissions 的小程序拿不到明文 key，key 仅供宿主内部使用；未声明权限的旧版小程序仍返回 {url, key, model, temperature}，向后兼容）
- api.callLLM({messages, prompt, temperature?, maxTokens?, model?}) → 直接调用 OpenAI 兼容接口，返回文本。messages 优先；否则用 prompt 构造单条 user 消息。
- api.getCharReply({charId?, sessionId?, prompt, systemPrompt?, history?, temperature?, maxTokens?}) → 以某角色立场生成回复（自动注入其 persona 为 system）。
说明：所有个性化发言/行动（提问、回答、大冒险、点评、反应）都必须调用上述 LLM 接口生成，符合人设与当前情景；不要用写死文本或随机题库冒充 AI。每次调用尽量携带至少 20 轮历史上下文（history），让 AI 明白谁提议/谁行动/谁平手。

【调用 MCP 工具（需要权限 "mcp"）】
小程序可以调用宿主已配置的 MCP 服务器工具（短信验证码、天气、数据库、外部 API、自动化等），全部由宿主代理执行，服务器地址与鉴权密钥绝不经过小程序：
- api.mcp.listServers() → 列出可用 MCP 服务器 [{name, group, toolCount}]（不含 url / headers）
- api.mcp.listTools(serverName) → 列出某服务器的可用工具 [{name, description, inputSchema}]
- api.mcp.invoke(serverName, toolName, args) → 调用某工具，返回宿主透传的原始结果（含 content / structuredContent 等）
典型用法（短信验证码类应用）：
\`\`\`javascript
const result = await api.mcp.invoke("短信网关", "send_code", { phone: "138xxxx", code: "123456" });
// result.content 通常含服务器返回文本，可用 api.toast 或渲染到页面展示
\`\`\`
说明：MCP 服务器需先在宿主「MCP 设置」中配置并启用；服务器/分组总开关关闭时调用会抛错，请务必 try/catch 兜底。

【状态持久化（按小程序隔离）】
- api.saveState(key, data) / api.loadState(key, default?) → 持久化游戏进度等（同步）
- api.clearState(key) → 清除某 key 的持久化状态（如「结束本局」时调用，避免下次进入仍是同一局）

【文件读写 / 导入导出（按小程序隔离）】
小程序可以读写自己的文件、让用户上传文件、或把数据导出为文件下载：
- api.writeFile(filename, content) → 写入一个文本文件（content 为字符串），返回是否成功（同步）
- api.readFile(filename) → 读取一个文本文件，返回字符串（不存在返回 null）（同步）
- api.listFiles() → 列出本小程序所有文件名（同步）
- api.deleteFile(filename) → 删除一个文件（同步）
- api.exportFile(filename, content, mime?) → 把字符串内容以指定文件名导出下载（PWA 走浏览器下载，Android 真机优先写到 /Download/Storypoem/）。mime 默认 text/plain
- api.pickFile(accept?) → 弹出文件选择框让用户选一个本地文件并读取其文本内容，返回 Promise<{filename, content}>（取消返回 null）。accept 如 ".txt"、".json"、"image/*"
用途举例：让用户上传一份题库 .txt（api.pickFile 解析后 api.writeFile 存档）、把一局游戏记录 api.exportFile 导出为 .json、把 AI 生成的剧本导出为 .txt 等。

【与宿主交互】
- api.close() → 退出小程序
- api.shareCardBack(inviteText) → 让当前会话角色反向把一张分享卡片发给用户（用于"char 邀请 user"）
- api.toast(msg) → 轻提示
- api.showConfirm(title, message) → 自定义确认卡片（替代浏览器 confirm），返回 Promise<bool>
- api.showActionCard(title, options) → 自定义操作选择卡片，options=[{label,value,danger?}]，返回 Promise<value>（取消返回 null）
- api.resetState() → 清除当前小程序的所有持久化状态（初始化）
（注：api.onInvite 与 api.getRoomMembers / api.share / api.shareConfig 已在上方「房间成员」一节详述）
（注：禁止使用浏览器原生 confirm/alert/prompt，请用 api.showConfirm 或 api.showActionCard 替代）

═══════════════════════════════
四、典型用法示例
═══════════════════════════════
【多人玩法】读取房间全部成员 + 为每个角色拉取完整上下文（人设/记忆/关系网/对话），拼成详细 prompt 让 AI 真正"认识"在场每个人：

\`\`\`javascript
// 1) 拿到当前房间全量成员（含「我」）
const members = api.getRoomMembers();
// 2) 为每个 char 拉取完整背景（支线人物 id 为 'snap_*' 字符串，用 isSnapshot 一并识别）
const charPlayers = members.filter(m => !m.isMe && m.id && (m.id > 0 || m.isSnapshot));
const ctxBlocks = [];
for (const p of charPlayers) {
  const ctx = await api.getCharRichContext(p.id);
  if (ctx) {
    ctxBlocks.push("【" + ctx.name + "】人设：" + (ctx.persona || "无").slice(0,300) +
      (ctx.memory && ctx.memory.coreRelationship ? "；与用户关系：" + ctx.memory.coreRelationship.slice(0,150) : "") +
      (ctx.network && ctx.network.length ? "；关系网：" + ctx.network.slice(0,5).map(r=>r.relation).join("、") : ""));
  }
}
const richContext = ctxBlocks.join("\\n");
// 3) 拼进 prompt 调 LLM
const reply = await api.callLLM({
  messages: [
    { role: "system", content: "你是多人真心话大冒险的裁判。下方是每位在场角色的完整背景，请据此生成符合各人设的问题。" },
    { role: "user", content: richContext + "\\n\\n请为每位角色各生成一个真心话问题，返回 JSON 数组。" }
  ]
});
\`\`\`

【单人玩法】获取当前对话角色 + 关系网 + 主记忆，让角色回答一道题：

\`\`\`javascript
const me = await api.getActiveChar();
const net = await api.getRelationshipNetwork();
const mem = await api.getMainMemory();
const reply = await api.getCharReply({
  prompt: "请回答下面这道真心话：你最近一次说谎是什么时候？",
  systemPrompt: "你正在和朋友玩真心话大冒险，必须如实、生动、符合人设地回答，不要说教。"
});
\`\`\`

把一局游戏的结果回写进小手机主记忆与总结（让后续对话受其影响）：

\`\`\`javascript
// 1) 写一条长周期总结
await api.saveSummary({
  content: "两人玩了一局真心话大冒险，承认了彼此心动已久，关系从暧昧升级为恋人。",
  keywords: "真心话,大冒险,告白,确认关系",
  category: "miniprogram"
});
// 2) 直接更新主记忆核心字段（只传要改的）
await api.updateMainMemory({
  coreRelationship: "已确认恋人关系，互有好感且坦诚。",
  coreSelfChanges: "在游戏中第一次主动告白，变得更大胆坦诚。"
});
\`\`\`

让用户上传题库文件 + 把一局记录导出为文件：

\`\`\`javascript
// 上传题库：弹文件选择框 → 读文本 → 存档
const picked = await api.pickFile(".txt");
if (picked) {
  api.writeFile("my_questions.txt", picked.content);
  api.toast("题库已保存：" + picked.filename);
}
// 导出：把本局游戏记录导出为 .json 下载
const record = api.loadState("game_record", []);
api.exportFile("game_record.json", JSON.stringify(record, null, 2), "application/json");
\`\`\`

═══════════════════════════════
五、设计标准
═══════════════════════════════
- 交互像微信小程序：顶部有标题区，主体可滚动，按钮圆角、配色克制（主色可用 #07c160 / #576b95 / #ec4899 等）。
- 文案自然口语化，符合中文用户习惯。
- 涉及 AI 返回的长文本（如大冒险行动约 1000 字）不要硬性截断，用滚动区域展示。
- 小游戏类小程序要清晰展示「轮次/进度/谁该行动」，并由系统推进流程。
- 务必在 manifest 里写全 name / author / iconSvg 三个字段；用户也可在工坊安装卡片里手动覆盖。

═══════════════════════════════
六、应用商店清单（store.json）发布规范（可选，分发多个小程序时用）
═══════════════════════════════
应用商店清单是「链接安装」的一种输入形态：把多个 .js 小程序聚合为一份 JSON 清单，托管到任意 https 静态地址，用户把清单链接粘贴进「链接安装」输入框即可一次装齐全部应用；重复粘贴同一链接即为「更新」。格式如下：

\`\`\`json
{
  "type": "miniprogram-store",
  "name": "我的应用商店",
  "description": "一句话介绍",
  "iconSvg": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/></svg>",
  "apps": [
    {
      "id": "mp_store_sms_helper",
      "name": "验证码助手",
      "description": "通过 MCP 短信网关收发验证码",
      "version": "1.0.0",
      "author": "你的名字",
      "type": "tool",
      "iconSvg": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/><path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\"/></svg>",
      "url": "https://your-host.com/apps/sms_helper.js",
      "permissions": ["mcp", "storage", "toast"]
    }
  ]
}
\`\`\`

要点：
- type 固定为 "miniprogram-store"；apps 数组内每个元素对应一个小程序，url 为 .js 直链（可相对 store.json 的路径），permissions 为该应用的权限白名单（会覆盖代码自带 manifest）。
- app.id 建议固定唯一，便于「更新」时按 id 覆盖升级而不重复安装。
- 分享方式：把 store.json 的链接发给用户，用户在小程序工坊「安装小程序」→「链接安装」输入框粘贴该链接即可一次性装齐全部应用；再次粘贴同一链接即为「更新」，按 app.id 覆盖升级不重复安装。
- 托管建议：GitHub Pages、jsDelivr、Gitee Pages、任意静态文件服务器（注意需支持 https 与跨域读取；APK 内置原生 HTTP 桥可绕过跨域限制）。

═══════════════════════════════
七、链接安装规格（AI 输出部署教程时必须遵守）
═══════════════════════════════
「链接安装」统一输入框接受两类链接，系统自动识别：

1. 小程序 .js 直链：链接直接返回 JavaScript 文件文本（包含 registerMiniProgram 调用）。例如：
   - GitHub raw：https://raw.githubusercontent.com/用户名/仓库名/分支/路径/文件.js
   - jsDelivr：https://cdn.jsdelivr.net/gh/用户名/仓库名@分支/路径/文件.js
   - Gitee raw / Gitee Pages / 任意静态托管直链（支持 CORS 或经原生 HTTP 桥拉取）
2. 应用商店清单（store.json）：JSON 文本，含 type=miniprogram-store 与 apps 数组（格式见第六节）。粘贴后一次性安装清单内全部应用，重复粘贴同一链接即为「更新」。

可接受链接硬性要求：
- 必须以 https:// 开头（http 亦可，但不推荐）；
- 必须免登录、可匿名 GET、直接返回文件原文（Content-Type 不限，系统按文本读取）；
- 浏览器（PWA）直连受跨域 CORS 限制：若托管方不返回 CORS 头，在浏览器中会拉取失败，请优先推荐 GitHub raw / jsDelivr 等自带 CORS 的托管，或在 Android 真机（原生 HTTP 桥自动绕过跨域）中使用。

不可用链接（务必在教程里提醒用户）：
- 网页型链接：GitHub 仓库/文件浏览页（blob 页面）、需要登录的网盘分享页、带 HTML 包装的页面——系统拉取的是原始文件文本，不是网页；
- 需要鉴权头的私有链接、签名过期链接。

请现在就根据我接下来给出的具体小程序需求，输出完整的 .js 文件、部署与导入教程、使用说明。`;

  // ============================================================
  //  工坊 UI
  // ============================================================
  function ensureOverlay() {
    if (document.getElementById("miniprogram-workshop-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "miniprogram-workshop-overlay";
    overlay.className = "miniprogram-workshop-overlay";
    overlay.innerHTML = `
      <header class="mp-hub-header">
        <button class="mp-icon-btn" id="mp-ws-back" title="返回">${(ICONS.close || "")}</button>
        <h3>小程序工坊</h3>
        <span style="width:36px"></span>
      </header>
      <div class="mp-ws-body">
        <!-- 上方：安装小程序（可展开卡片） -->
        <section class="mp-ws-section">
          <div class="mp-ws-section-title">${(ICONS.upload || "")}<span>安装小程序</span></div>
          <div class="mp-ws-hint">点击展开，上传 .js 文件、粘贴代码、或直接粘贴链接（.js 直链 / 应用商店清单）即可安装；可一并填写名称 / 作者 / SVG 图标（覆盖代码自带信息）。</div>
          <button class="mp-ws-btn primary block" id="mp-ws-install-toggle">${(ICONS.plus || "")}<span>展开安装卡片</span></button>
          <div class="mp-ws-install-card" id="mp-ws-install-card" data-shown="">
            <div class="mp-ws-meta-row">
              <label>小程序名称</label>
              <input type="text" id="mp-ws-meta-name" placeholder="如：我的真心话（留空则用代码自带名称）">
            </div>
            <div class="mp-ws-meta-row">
              <label>作者</label>
              <input type="text" id="mp-ws-meta-author" placeholder="如：你的名字（留空则用代码自带作者）">
            </div>
            <div class="mp-ws-meta-row">
              <label>SVG 图标（粘贴一段 &lt;svg&gt;...&lt;/svg&gt;，留空则用代码自带图标）</label>
              <textarea id="mp-ws-meta-icon" placeholder='<svg viewBox="0 0 24 24" ...>...</svg>'></textarea>
              <div class="mp-ws-icon-preview">
                <div class="mp-ws-icon-preview-box" id="mp-ws-icon-preview">${DEFAULT_ICON_SVG}</div>
                <span>图标预览（输入后实时刷新）</span>
              </div>
            </div>
            <div class="mp-ws-local-actions">
              <button class="mp-ws-btn primary" id="mp-ws-upload">${(ICONS.upload || "")}<span>上传 .js 文件</span></button>
              <button class="mp-ws-btn outline" id="mp-ws-paste-toggle">${(ICONS.code || "")}<span>粘贴代码</span></button>
            </div>
            <input type="file" id="mp-ws-file-input" accept=".js,text/javascript,application/javascript,text/plain" style="display:none">
            <div class="mp-ws-paste-wrap" id="mp-ws-paste-wrap" data-shown="">
              <textarea id="mp-ws-code" placeholder="粘贴小程序 .js 全文，必须包含 registerMiniProgram(manifest, mountFn) 调用…"></textarea>
              <button class="mp-ws-btn primary block" id="mp-ws-code-install">${(ICONS.puzzle || "")}<span>安装</span></button>
            </div>
            <div class="mp-ws-link-row">
              <input type="text" id="mp-ws-url-input" placeholder="粘贴 .js 直链 或 应用商店清单(store.json) 链接（https://…）">
              <button class="mp-ws-btn outline" id="mp-ws-url-install">${LINK_ICON}<span>链接安装</span></button>
            </div>
          </div>
        </section>

        <!-- 中间：已安装小程序列表 -->
        <section class="mp-ws-section">
          <div class="mp-ws-section-title">${(ICONS.grid || "")}<span>已安装小程序</span></div>
          <div id="mp-ws-list" class="mp-ws-list"></div>
        </section>

        <!-- 下方：AI 辅助制作 + 一键复制 prompt -->
        <section class="mp-ws-section">
          <div class="mp-ws-section-title">${(ICONS.workshop || "")}<span>AI 辅助制作</span></div>
          <div class="mp-ws-hint">点击下方按钮一键复制「制作提示词」，粘贴给任意大模型，它就能输出完整小程序文件并告诉你如何安装（上传文件 / 粘贴代码两种方式）。把需求一起发给它效果更佳。</div>
          <button class="mp-ws-btn primary block" id="mp-ws-copy-prompt">${(ICONS.share || "")}<span>一键复制 Prompt</span></button>
        </section>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#mp-ws-back").onclick = close;
    overlay.querySelector("#mp-ws-install-toggle").onclick = toggleInstallCard;
    overlay.querySelector("#mp-ws-copy-prompt").onclick = copyPrompt;
    overlay.querySelector("#mp-ws-upload").onclick = () => {
      const fi = overlay.querySelector("#mp-ws-file-input");
      if (fi) fi.click();
    };
    overlay.querySelector("#mp-ws-file-input").onchange = onFilePicked;
    overlay.querySelector("#mp-ws-paste-toggle").onclick = togglePasteCard;
    overlay.querySelector("#mp-ws-code-install").onclick = onInstallCode;
    overlay.querySelector("#mp-ws-url-install").onclick = onInstallUrl;
    // SVG 图标实时预览
    const iconInput = overlay.querySelector("#mp-ws-meta-icon");
    if (iconInput) {
      iconInput.addEventListener("input", () => updateIconPreview(iconInput.value));
    }
  }

  function toggleInstallCard() {
    const card = document.getElementById("mp-ws-install-card");
    if (!card) return;
    const toggle = document.getElementById("mp-ws-install-toggle");
    if (card.dataset.shown === "1") {
      card.dataset.shown = "";
      card.classList.remove("open");
      if (toggle) toggle.querySelector("span").textContent = "展开安装卡片";
    } else {
      card.dataset.shown = "1";
      card.classList.add("open");
      if (toggle) toggle.querySelector("span").textContent = "收起安装卡片";
    }
  }

  function updateIconPreview(svgStr) {
    const box = document.getElementById("mp-ws-icon-preview");
    if (!box) return;
    const s = (svgStr || "").trim();
    if (s && /<svg[\s>]/i.test(s)) {
      box.innerHTML = s;
    } else {
      box.innerHTML = DEFAULT_ICON_SVG;
    }
  }

  // 收集安装卡片里的元信息 overrides
  function collectMetaOverrides() {
    const name = (document.getElementById("mp-ws-meta-name") || {}).value;
    const author = (document.getElementById("mp-ws-meta-author") || {}).value;
    const iconSvg = (document.getElementById("mp-ws-meta-icon") || {}).value;
    const ov = {};
    if (name && name.trim()) ov.name = name.trim();
    if (author && author.trim()) ov.author = author.trim();
    if (iconSvg && iconSvg.trim() && /<svg[\s>]/i.test(iconSvg)) ov.iconSvg = iconSvg.trim();
    return ov;
  }

  // 安装成功后清空元信息表单
  function resetMetaForm() {
    const n = document.getElementById("mp-ws-meta-name"); if (n) n.value = "";
    const a = document.getElementById("mp-ws-meta-author"); if (a) a.value = "";
    const i = document.getElementById("mp-ws-meta-icon"); if (i) i.value = "";
    updateIconPreview("");
  }

  function togglePasteCard() {
    const wrap = document.getElementById("mp-ws-paste-wrap");
    if (!wrap) return;
    if (wrap.dataset.shown === "1") { wrap.dataset.shown = ""; wrap.classList.remove("open"); }
    else { wrap.dataset.shown = "1"; wrap.classList.add("open"); }
  }

  function onFilePicked(e) {
    const file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function () {
      const code = String(reader.result || "");
      const ov = collectMetaOverrides();
      const label = ov.name || file.name.replace(/\.js$/i, "");
      const ok = await window.miniProgramSystem.installFromCode(code, label, ov);
      if (ok) { resetMetaForm(); renderList(); }
      e.target.value = ""; // 允许重复选择同一文件
    };
    reader.onerror = function () { toast("读取文件失败"); };
    reader.readAsText(file);
  }

  async function onInstallCode() {
    const ta = document.getElementById("mp-ws-code");
    const code = ta ? ta.value : "";
    if (!code.trim()) { toast("请先粘贴小程序代码"); return; }
    const ov = collectMetaOverrides();
    const ok = await window.miniProgramSystem.installFromCode(code, "粘贴代码", ov);
    if (ok) {
      if (ta) ta.value = "";
      const wrap = document.getElementById("mp-ws-paste-wrap");
      if (wrap) { wrap.dataset.shown = ""; wrap.classList.remove("open"); }
      resetMetaForm();
      renderList();
    }
  }

  // 链接安装：粘贴 .js 直链或应用商店 manifest 链接
  async function onInstallUrl() {
    const input = document.getElementById("mp-ws-url-input");
    const url = input ? input.value.trim() : "";
    if (!url) { toast("请先粘贴链接"); return; }
    const sys = window.miniProgramSystem;
    if (!sys || typeof sys.installFromUrl !== "function") { toast("当前版本不支持链接安装"); return; }
    const ok = await sys.installFromUrl(url);
    if (ok) {
      if (input) input.value = "";
      renderList();
    }
  }

  function renderList() {
    const list = document.getElementById("mp-ws-list");
    if (!list) return;
    const items = (window.miniProgramSystem.listRegistry || function () { return []; })();
    if (items.length === 0) {
      list.innerHTML = `<div class="mp-ws-empty">暂无小程序，可在上方「安装小程序」上传文件、粘贴代码或粘贴链接一键安装</div>`;
      return;
    }
    let html = "";
    for (const it of items) {
      const isLocal = it.source === "local";
      const isBuiltin = it.source === "builtin";
      const tag = isLocal ? "本地" : (isBuiltin ? "内置" : (it.manifestUrl ? "商店" : "社区"));
      const canEdit = isLocal;          // 仅本地小程序可编辑代码
      const canDelete = isLocal || it.source === "github"; // 内置不可删；本地/链接安装可删
      const editBtn = canEdit
        ? `<button class="mp-ws-icon-btn" data-act="edit" data-id="${esc(it.id)}" title="编辑">${ICONS.code || ""}</button>`
        : `<button class="mp-ws-icon-btn" title="不可编辑" disabled style='opacity:0.35'>${ICONS.code || ""}</button>`;
      const delBtn = canDelete
        ? `<button class="mp-ws-icon-btn danger" data-act="delete" data-id="${esc(it.id)}" title="删除">${ICONS.trash || ""}</button>`
        : `<button class="mp-ws-icon-btn danger" title="不可删除" disabled style='opacity:0.35'>${ICONS.trash || ""}</button>`;
      // 重置按钮：所有小程序（含内置）均可重置存档进度
      const resetBtn = `<button class="mp-ws-icon-btn" data-act="reset" data-id="${esc(it.id)}" title="初始化（清除进度）">${ICONS.refresh || ""}</button>`;
      const authorLine = it.author ? `<div class="mp-ws-author-line">作者：${esc(it.author)}</div>` : "";
      // 权限标签（应用商店式安全模型）：仅展示声明过权限的小程序
      const permTags = (Array.isArray(it.permissions) && it.permissions.length)
        ? '<div class="mp-ws-perm-row">' + it.permissions.map(p => `<span class="mp-ws-perm-tag">${esc(p)}</span>`).join("") + '</div>'
        : "";
      html += `<div class="mp-ws-item">
        <div class="mp-ws-item-icon">${it.iconSvg || ICONS.puzzle || ""}</div>
        <div class="mp-ws-item-info">
          <div class="mp-ws-item-name">${esc(it.name)} <span class="mp-ws-item-tag${isLocal ? " local" : ""}">${tag}</span></div>
          <div class="mp-ws-item-desc">${esc(it.description || "")} · v${esc(it.version || "1.0.0")}</div>
          ${permTags}
          ${authorLine}
        </div>
        <div class="mp-ws-item-actions">
          ${editBtn}
          ${resetBtn}
          ${delBtn}
        </div>
      </div>`;
    }
    list.innerHTML = html;
    list.querySelectorAll(".mp-ws-icon-btn").forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "edit") openEditModal(id);
        else if (act === "reset") {
          (async () => {
            const items2 = (window.miniProgramSystem.listRegistry || function () { return []; })();
            const entry = items2.find(x => x.id === id);
            const name = entry ? entry.name : "该小程序";
            const ok = await new Promise(r => {
              if (typeof window.showCustomConfirm === "function") window.showCustomConfirm("初始化小程序", "确定清除「" + name + "」的所有存档进度？清除后将从初始状态重新开始。", () => r(true), () => r(false));
              else r(window.confirm("确定清除「" + name + "」的所有存档进度？"));
            });
            if (!ok) return;
            if (typeof window.miniProgramSystem.resetStateById === "function") {
              window.miniProgramSystem.resetStateById(id);
            }
            if (typeof showToast === "function") showToast("「" + name + "」已初始化");
            else if (window.miniProgramSystem) window.miniProgramSystem.showToast("「" + name + "」已初始化");
          })();
        }
        else if (act === "delete") {
          (async () => {
            const ok = await new Promise(r => {
              if (typeof window.showCustomConfirm === "function") window.showCustomConfirm("删除小程序", "确定删除该小程序？", () => r(true), () => r(false));
              else r(window.confirm("确定删除该小程序？"));
            });
            if (ok) { window.miniProgramSystem.uninstall(id); renderList(); }
          })();
        }
      };
    });
  }

  // ============================================================
  //  编辑大卡片：回填代码 + 元信息，保存后覆盖原本地小程序
  // ============================================================
  function openEditModal(id) {
    const sys = window.miniProgramSystem;
    if (!sys || typeof sys.getLocalCode !== "function" || typeof sys.updateLocalCode !== "function") {
      toast("当前版本不支持编辑");
      return;
    }
    const items = (sys.listRegistry || function () { return []; })();
    const entry = items.find(r => r.id === id);
    if (!entry) { toast("未找到该小程序"); return; }
    if (entry.source !== "local") { toast("仅本地小程序支持编辑"); return; }
    const code = sys.getLocalCode(id) || "";
    if (!code) { toast("该小程序源码已丢失，无法编辑"); return; }

    // 移除已存在的编辑模态
    const existed = document.getElementById("mp-ws-edit-modal");
    if (existed) existed.remove();

    const modal = document.createElement("div");
    modal.id = "mp-ws-edit-modal";
    modal.className = "mp-ws-edit-modal";
    modal.innerHTML = `
      <div class="mp-ws-edit-card">
        <div class="mp-ws-edit-header">
          <span class="mp-ws-edit-title">编辑小程序</span>
          <button class="mp-ws-edit-close" id="mp-ws-edit-close">&times;</button>
        </div>
        <div class="mp-ws-edit-body">
          <div class="mp-ws-meta-row">
            <label>小程序名称</label>
            <input type="text" id="mp-ws-edit-name" value="${esc(entry.name || "")}">
          </div>
          <div class="mp-ws-meta-row">
            <label>作者</label>
            <input type="text" id="mp-ws-edit-author" value="${esc(entry.author || "")}">
          </div>
          <div class="mp-ws-meta-row">
            <label>SVG 图标（粘贴一段 &lt;svg&gt;...&lt;/svg&gt;）</label>
            <textarea id="mp-ws-edit-icon" placeholder='<svg viewBox="0 0 24 24" ...>...</svg>'>${esc(entry.iconSvg || "")}</textarea>
            <div class="mp-ws-icon-preview">
              <div class="mp-ws-icon-preview-box" id="mp-ws-edit-icon-preview">${entry.iconSvg || ICONS.puzzle || DEFAULT_ICON_SVG}</div>
              <span>图标预览（输入后实时刷新）</span>
            </div>
          </div>
          <div class="mp-ws-meta-row">
            <label>小程序代码（.js 全文）</label>
            <textarea class="mp-ws-edit-code" id="mp-ws-edit-code">${esc(code)}</textarea>
          </div>
        </div>
        <div class="mp-ws-edit-footer">
          <button class="mp-ws-btn outline" id="mp-ws-edit-cancel">取消</button>
          <button class="mp-ws-btn primary" id="mp-ws-edit-save">${(ICONS.check || "")}<span>保存</span></button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#mp-ws-edit-close").onclick = close;
    modal.querySelector("#mp-ws-edit-cancel").onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    // 图标实时预览
    const iconInput = modal.querySelector("#mp-ws-edit-icon");
    const iconBox = modal.querySelector("#mp-ws-edit-icon-preview");
    if (iconInput && iconBox) {
      iconInput.addEventListener("input", () => {
        const s = (iconInput.value || "").trim();
        iconBox.innerHTML = (s && /<svg[\s>]/i.test(s)) ? s : (ICONS.puzzle || DEFAULT_ICON_SVG);
      });
    }

    modal.querySelector("#mp-ws-edit-save").onclick = async () => {
      const newCode = (modal.querySelector("#mp-ws-edit-code") || {}).value || "";
      const newName = (modal.querySelector("#mp-ws-edit-name") || {}).value || "";
      const newAuthor = (modal.querySelector("#mp-ws-edit-author") || {}).value || "";
      const newIcon = (modal.querySelector("#mp-ws-edit-icon") || {}).value || "";
      const ov = {};
      if (newName.trim()) ov.name = newName.trim();
      if (newAuthor.trim()) ov.author = newAuthor.trim();
      if (newIcon.trim() && /<svg[\s>]/i.test(newIcon)) ov.iconSvg = newIcon.trim();
      const ok = await sys.updateLocalCode(id, newCode, ov);
      if (ok) { close(); renderList(); }
    };
  }

  function copyPrompt() {
    const text = WORKSHOP_PROMPT;
    const done = () => toast("Prompt 已复制，去粘贴给大模型吧");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done));
      } else { fallback(text, done); }
    } catch (e) { fallback(text, done); }
  }
  function fallback(text, cb) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.top = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta); cb();
    } catch (e) { toast("复制失败，请手动复制"); }
  }

  function open() {
    ensureOverlay();
    renderList();
    document.getElementById("miniprogram-workshop-overlay").classList.add("active");
  }
  function close() {
    const o = document.getElementById("miniprogram-workshop-overlay");
    if (o) o.classList.remove("active");
    // 关闭工坊后若小程序页面处于打开状态，立即刷新让新装/改/删的小程序可见
    try {
      if (window.miniProgramSystem && typeof window.miniProgramSystem.renderHub === "function") {
        const hub = document.getElementById("miniprogram-hub-overlay");
        if (hub && hub.classList.contains("active")) window.miniProgramSystem.renderHub();
      }
    } catch (e) {}
  }

  window.miniProgramWorkshop = { open, close, renderList, getPrompt: function () { return WORKSHOP_PROMPT; } };
})();
