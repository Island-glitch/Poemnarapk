// db.js - 初始化本地 IndexedDB 数据库
const db = new Dexie("StoryPhoneDatabase");

// 声明表结构 (升级至 Version 15 建立设备数据长期持久化和阅读多段复合索引通道)
db.version(15).stores({
  api_presets: 'id++, name, protocol, url, key, model, temperature',
  archives: 'id++, type, name, avatar, remark, group, persona, parentId', 
  relations: 'id++, fromId, toId, relation',
  sessions: 'id++, userId, charId, customCharName, customCharAvatar, customCharPersona, customUserAvatar, customUserPersona, lastMessageTime, mountedEntryIds, offlineMinWordCount, offlineMaxWordCount, offlineAutoSummaryCount, offlineMountedEntryIds, stickerMountedGroupIds, autoSummaryToggle, autoSummaryInterval, bufferRounds, summarySystemPrompt, coreSelfStatus, coreSelfPurpose, coreSelfChanges, coreRelationship, coreUserInEyes',
  messages: 'id++, sessionId, senderType, senderId, content, contentType, timestamp, isFavorite',
  world_book_entries: 'id++, group, title, content, depth, isActive',

  // 线下独立剧场模块与线下长卡片式会话
  theaters: 'id++, sessionId, name, scenario, minWordCount, maxWordCount, carryMemory, createdAt',
  offline_messages: 'id++, theaterId, sessionId, isTheater, senderType, content, timestamp, isFavorite',

  // 角色心声状态历史记录
  status_history: 'id++, sessionId, theaterId, isTheater, timestamp, attire, affection, excitement, thoughts, hiddenCorners',

  // 表情包分组与条目
  sticker_groups: 'id++, name, sortOrder',
  sticker_items: 'id++, groupId, sortOrder, imageUrl, caption',

  // 总结记录表 (支持分类检索与热词存储)
  summaries: 'id++, sessionId, startRound, endRound, content, keywords, timestamp, category',

  // 深谈主记录表 (支持面具/我的人设隔离、状态控制与时间索引)
  deeptalks: 'id++, sessionId, userId, charId, topic, status, createdAt',

  // 深谈具体对话卡片记录表
  deeptalk_messages: 'id++, deeptalkId, senderType, timestamp',

  // 角色在深谈中产生的微弱闪念 (小宇宙) 记录表
  deeptalk_thoughts: 'id++, deeptalkId, sessionId, timestamp',

  // 全局深谈附加提示词预设表
  deeptalk_presets: 'id++, name',

  // === Version 9 新增：朋友圈系统专属数据表 ===
  moments: 'id++, userId, senderType, senderId, timestamp',
  moment_comments: 'id++, momentId, senderType, senderId, timestamp',
  moment_settings: 'id++, userId',

  // === Version 10 新增：HTML 互动卡片存储表 ===
  html_cards: 'id++, sessionId, timestamp',

  // === Version 11 新增：独立悬浮多状态桌宠存储表 ===
  desktop_pets: 'charId, mode',

  // === Version 13 新增：阅读应用专属物理数据表 ===
  reader_books: 'id++, title, author, summary, coverUrl, isImported, fileType, currentChapterId, collected',
  reader_chapters: 'id++, [bookId+chapterNum], bookId, chapterNum, title, content, summary',
  reader_presets: 'id++, name, prompt',
  reader_tags: 'id++, name',

  // === Version 15 新增：查手机设备数据长期持久化存储表 ===
  check_phone_states: 'sessionId',

  // === Version 16 新增：系统级论坛社交应用专属物理表 ===
  forum_accounts: 'id++, avatar, nickname, username, signature, boundPresetId',
  forum_posts: 'id++, authorId, title, content, media, createdAt, views, likesCount, commentsCount, forwardsCount',
  forum_comments: 'id++, postId, parentCommentId, authorId, content, createdAt, likesCount',
  forum_likes: 'id++, userId, targetId, targetType, createdAt',
  forum_forwards: 'id++, userId, postId, comment, createdAt',
  forum_notifications: 'id++, userId, type, targetId, fromUserId, isRead, createdAt',
  forum_conversations: 'id++, user1Id, user2Id, lastMessageTime',
  forum_messages: 'id++, conversationId, senderId, content, contentType, createdAt',
  forum_follows: 'id++, followerId, followeeId, createdAt',
  forum_presets: 'id++, name, forumName, atmosphere, mountedEntryIds',
  forum_npc_accounts: 'id++, charId, nickname, avatar, postFrequency, postPreference'
});

// === Version 17 新增：系统级群聊、群成员与群投票物理表 ===
db.version(17).stores({
  api_presets: 'id++, name, protocol, url, key, model, temperature',
  archives: 'id++, type, name, avatar, remark, group, persona, parentId', 
  relations: 'id++, fromId, toId, relation',
  sessions: 'id++, userId, charId, customCharName, customCharAvatar, customCharPersona, customUserAvatar, customUserPersona, lastMessageTime, mountedEntryIds, offlineMinWordCount, offlineMaxWordCount, offlineAutoSummaryCount, offlineMountedEntryIds, stickerMountedGroupIds, autoSummaryToggle, autoSummaryInterval, bufferRounds, summarySystemPrompt, coreSelfStatus, coreSelfPurpose, coreSelfChanges, coreRelationship, coreUserInEyes',
  messages: 'id++, sessionId, senderType, senderId, content, contentType, timestamp, isFavorite',
  world_book_entries: 'id++, group, title, content, depth, isActive',
  theaters: 'id++, sessionId, name, scenario, minWordCount, maxWordCount, carryMemory, createdAt',
  offline_messages: 'id++, theaterId, sessionId, isTheater, senderType, content, timestamp, isFavorite',
  status_history: 'id++, sessionId, theaterId, isTheater, timestamp, attire, affection, excitement, thoughts, hiddenCorners',
  sticker_groups: 'id++, name, sortOrder',
  sticker_items: 'id++, groupId, sortOrder, imageUrl, caption',
  summaries: 'id++, sessionId, startRound, endRound, content, keywords, timestamp, category',
  deeptalks: 'id++, sessionId, userId, charId, topic, status, createdAt',
  deeptalk_messages: 'id++, deeptalkId, senderType, timestamp',
  deeptalk_thoughts: 'id++, deeptalkId, sessionId, timestamp',
  deeptalk_presets: 'id++, name',
  moments: 'id++, userId, senderType, senderId, timestamp',
  moment_comments: 'id++, momentId, senderType, senderId, timestamp',
  moment_settings: 'id++, userId',
  html_cards: 'id++, sessionId, timestamp',
  desktop_pets: 'charId, mode',
  reader_books: 'id++, title, author, summary, coverUrl, isImported, fileType, currentChapterId, collected',
  reader_chapters: 'id++, [bookId+chapterNum], bookId, chapterNum, title, content, summary',
  reader_presets: 'id++, name, prompt',
  reader_tags: 'id++, name',
  check_phone_states: 'sessionId',
  forum_accounts: 'id++, avatar, nickname, username, signature, boundPresetId',
  forum_posts: 'id++, authorId, title, content, media, createdAt, views, likesCount, commentsCount, forwardsCount',
  forum_comments: 'id++, postId, parentCommentId, authorId, content, createdAt, likesCount',
  forum_likes: 'id++, userId, targetId, targetType, createdAt',
  forum_forwards: 'id++, userId, postId, comment, createdAt',
  forum_notifications: 'id++, userId, type, targetId, fromUserId, isRead, createdAt',
  forum_conversations: 'id++, user1Id, user2Id, lastMessageTime',
  forum_messages: 'id++, conversationId, senderId, content, contentType, createdAt',
  forum_follows: 'id++, followerId, followeeId, createdAt',
  forum_presets: 'id++, name, forumName, atmosphere, mountedEntryIds',
  forum_npc_accounts: 'id++, charId, nickname, avatar, postFrequency, postPreference',
  
  // 新增群聊控制表组
  groups: 'id++, name, avatar, ownerId, ownerType',
  group_members: 'id++, groupId, memberId, memberType',
  group_polls: 'id++, groupId, messageId'
});

// === Version 18 升级：建立复合索引以解决群成员多态查询 SchemaError 异常 ===
db.version(18).stores({
  api_presets: 'id++, name, protocol, url, key, model, temperature',
  archives: 'id++, type, name, avatar, remark, group, persona, parentId', 
  relations: 'id++, fromId, toId, relation',
  sessions: 'id++, userId, charId, customCharName, customCharAvatar, customCharPersona, customUserAvatar, customUserPersona, lastMessageTime, mountedEntryIds, offlineMinWordCount, offlineMaxWordCount, offlineAutoSummaryCount, offlineMountedEntryIds, stickerMountedGroupIds, autoSummaryToggle, autoSummaryInterval, bufferRounds, summarySystemPrompt, coreSelfStatus, coreSelfPurpose, coreSelfChanges, coreRelationship, coreUserInEyes',
  messages: 'id++, sessionId, senderType, senderId, content, contentType, timestamp, isFavorite',
  world_book_entries: 'id++, group, title, content, depth, isActive',
  theaters: 'id++, sessionId, name, scenario, minWordCount, maxWordCount, carryMemory, createdAt',
  offline_messages: 'id++, theaterId, sessionId, isTheater, senderType, content, timestamp, isFavorite',
  status_history: 'id++, sessionId, theaterId, isTheater, timestamp, attire, affection, excitement, thoughts, hiddenCorners',
  sticker_groups: 'id++, name, sortOrder',
  sticker_items: 'id++, groupId, sortOrder, imageUrl, caption',
  summaries: 'id++, sessionId, startRound, endRound, content, keywords, timestamp, category',
  deeptalks: 'id++, sessionId, userId, charId, topic, status, createdAt',
  deeptalk_messages: 'id++, deeptalkId, senderType, timestamp',
  deeptalk_thoughts: 'id++, deeptalkId, sessionId, timestamp',
  deeptalk_presets: 'id++, name',
  moments: 'id++, userId, senderType, senderId, timestamp',
  moment_comments: 'id++, momentId, senderType, senderId, timestamp',
  moment_settings: 'id++, userId',
  html_cards: 'id++, sessionId, timestamp',
  desktop_pets: 'charId, mode',
  reader_books: 'id++, title, author, summary, coverUrl, isImported, fileType, currentChapterId, collected',
  reader_chapters: 'id++, [bookId+chapterNum], bookId, chapterNum, title, content, summary',
  reader_presets: 'id++, name, prompt',
  reader_tags: 'id++, name',
  check_phone_states: 'sessionId',
  forum_accounts: 'id++, avatar, nickname, username, signature, boundPresetId',
  forum_posts: 'id++, authorId, title, content, media, createdAt, views, likesCount, commentsCount, forwardsCount',
  forum_comments: 'id++, postId, parentCommentId, authorId, content, createdAt, likesCount',
  forum_likes: 'id++, userId, targetId, targetType, createdAt',
  forum_forwards: 'id++, userId, postId, comment, createdAt',
  forum_notifications: 'id++, userId, type, targetId, fromUserId, isRead, createdAt',
  forum_conversations: 'id++, user1Id, user2Id, lastMessageTime',
  forum_messages: 'id++, conversationId, senderId, content, contentType, createdAt',
  forum_follows: 'id++, followerId, followeeId, createdAt',
  forum_presets: 'id++, name, forumName, atmosphere, mountedEntryIds',
  forum_npc_accounts: 'id++, charId, nickname, avatar, postFrequency, postPreference',
  
  groups: 'id++, name, avatar, ownerId, ownerType',
  group_members: 'id++, groupId, memberId, memberType, [groupId+memberId+memberType]',
  group_polls: 'id++, groupId, messageId'
});

// ============================================
// 🎯 新增 Version 20：只写“新增的表”和“改动的表”
// ============================================
db.version(20).stores({
  // 1. 如果你之前有表报错缺少索引，要在这里复写它
  
  // 2. 你新加的情侣空间模块的 4 张表：
  couples_schedules: 'id++, charId, date',
  couples_albums: 'id++, charId, timestamp',
  couples_journals: 'id++, charId',
  couples_whispers: 'id++, charId, timestamp'
});

// ============================================
// 🎯 新增 Version 21：支持真实 MCP 服务器与工具存储
// ============================================
db.version(21).stores({
  mcp_servers: 'id++, name, type, url, enabled'
});

// ============================================
// 🎯 新增 Version 22：支持全局思维链 (CoT) 预设存储
// ============================================
db.version(22).stores({
  cot_presets: 'id++, name'
});

// ============================================
// 🎯 新增 Version 23：支持自定义系统提示词 (Prompt) 预设表
// ============================================
db.version(23).stores({
  prompt_presets: 'id++, name, type'
});

// ============================================
// 🎯 新增 Version 24：支持听歌应用与网易云歌单物理表
// ============================================
db.version(24).stores({
  music_playlists: 'id++, userId, name, coverUrl, isNcm, ncmPlaylistId',
  music_songs: 'id++, playlistId, title, artist, cover, url, lyrics, isVip',
  music_logs: 'id++, sessionId, charId, songId, timestamp'
});

// ============================================
// 🎯 新增 Version 25：支持购物应用（购物车/订单/地址/神券/收藏室）
// ============================================
db.version(25).stores({
  shopping_cart: 'id++, userId, itemType, storeId, storeName, category, addedAt',
  shopping_orders: 'id++, userId, orderNo, status, type, paymentMethod, payerId, createdAt',
  shopping_addresses: 'id++, userId, isDefault',
  shopping_coupons: 'id++, userId, type, expireAt, usedCount',
  // 收藏室：跟随面具，按对话分类，按类型(文字/语音/图片)分类
  favorites: 'id++, userId, sessionId, msgType, sourceTable, sourceMsgId, createdAt'
});

// ============================================
// 🎯 Version 26：购物订单扩展物流追踪字段 + 神券抵扣 + 提现转盘记录
// ============================================
db.version(26).stores({
  shopping_orders: 'id++, userId, orderNo, status, type, paymentMethod, payerId, createdAt',
  shopping_coupons: 'id++, userId, type, expireAt, usedCount, source',
  // 提现转盘游戏记录（单次游戏进度，2日后重置）
  shopping_withdraw_games: 'id++, userId, status, startedAt, lastSpinAt'
});

// ============================================
// 🎯 Version 27：情侣空间·悄悄话话题会话与归档机制
// - couples_whispers 增补 topicId / archived 索引（不丢旧数据，仅扩展索引）
// - 新增 couples_whisper_topics：每个话题会话的元信息（标题/发起方/起止时间/是否归档/总结）
// ============================================
db.version(27).stores({
  couples_whispers: 'id++, charId, timestamp, topicId, archived',
  couples_whisper_topics: 'id++, charId, meId, startTime, endTime, archived, topicTitle'
});

// ============================================
// 🎯 Version 28：生图功能（API预设/画师串/会话级生图设置/锁脸图片）
// - imagegen_presets: 生图 API 预设（URL/Key/Model）
// - imagegen_artists: 画师串预设（含内置写实韩系清爽画师串）
// - imagegen_session_settings: 会话级生图配置（开关/锁脸/专属画师串/正负提示词）
// ============================================
db.version(28).stores({
  imagegen_presets: 'id++, name, url, key, model, isGlobal, createdAt',
  imagegen_artists: 'id++, name, prompt, isBuiltin, createdAt',
  imagegen_session_settings: 'id++, sessionId, chatEnabled, momentsEnabled, artistId, positivePrompt, negativePrompt, lockfaceImages, createdAt, updatedAt'
});

// ============================================
// 🎯 Version 29：档案馆外貌字段（生图参考）
// - archives.appearance: 自由文本外貌描写，用作生图强约束参考（char/user/npc均可用）
// 注：仅扩展索引，无需数据迁移（Dexie 对未声明字段透明存储）
// ============================================
db.version(29).stores({
  archives: 'id++, type, name, avatar, remark, group, persona, parentId'
});

// ============================================
// 🎯 Version 30：邂逅应用（Soul风格星球轨道社交）
// - encounter_strangers: 陌生char档案（背景/性格/身份/标签，可转正）
// - encounter_posts: 广场帖子流（按分类索引）
// - encounter_comments: 帖子留言（陌生char互相留言）
// - encounter_tags: 首页标签仓库（匹配陌生char标签）
// - encounter_categories: 广场分类（可增删，含内置推荐/交友/同城/国际/古代）
// - encounter_promoted_log: 转正日志（记录哪些char已加入档案馆）
// ============================================
db.version(30).stores({
  encounter_strangers: 'id++, name, gender, era, location, identity, background, personality, tags, status, category, avatarSeed, createdAt',
  encounter_posts: 'id++, authorId, title, category, createdAt, likes, commentsCount',
  encounter_comments: 'id++, postId, authorId, createdAt',
  encounter_tags: 'id++, name, color, createdAt',
  encounter_categories: 'id++, name, sortOrder, isBuiltin',
  encounter_promoted_log: 'id++, strangerId, archiveId, promotedAt'
});

// ============================================
// 🎯 Version 31：邂逅应用 - 标签与分类补充附加说明字段
// - encounter_tags 增加 description（附加说明，不显示在UI上，仅注入 prompt）
// - encounter_categories 增加 description（附加说明，仅注入 prompt）
// ============================================
db.version(31).stores({
  encounter_tags: 'id++, name, color, description, createdAt',
  encounter_categories: 'id++, name, sortOrder, isBuiltin, description'
});

// ============================================
// 🎯 Version 32：快穿局 - 长文文游应用数据表
// - qt_identity:   玩家身份（姓名/年龄/外貌/背景/头像，步进式设定）
// - qt_worldviews: 世界观（剧情梗概/世界背景/主要人物/关系网，可AI生成/导入导出）
// - qt_games:      进行中的剧本（世界观+玩家身份+状态，最多5个）
// - qt_messages:   剧本消息流（每轮 user 输入 + AI 回复 + 推荐行动）
// - qt_summaries:  总结池（剧情走向/人物关系变化/关键事实，带关键词召回）
// - qt_variables:  变量控制表（每轮提取的记忆变量，可手动修改）
// - qt_beautify:   美化套件（主题色/背景/CSS/正则规则，可导入导出）
// ============================================
db.version(32).stores({
  qt_identity:   'id++, name, age, appearance, background, avatar, createdAt',
  qt_worldviews: 'id++, title, synopsis, worldBackground, characters, relationships, source, createdAt',
  qt_games:      'id++, worldviewId, identityId, beautifyId, status, currentRound, title, createdAt',
  qt_messages:   'id++, gameId, role, content, actions, round, createdAt',
  qt_summaries:  'id++, gameId, round, plotShift, relationshipChanges, keyFacts, keywords, createdAt',
  qt_variables:  'id++, gameId, key, value, lastRound, editable',
  qt_beautify:   'id++, name, themeColor, background, css, regexRules, createdAt'
});

// ============================================
// 🎯 Version 33：第四面墙·故人来信 & 阅读用户创作
// - qt_fanwall_letters:  任务完结后故人来信（信件/打字消息流/归档状态）
//   * branch: 'letter' (否分支·信件) | 'dialog' (是分支·打字消息流)
//   * deepened: 0=未深入, 1=已深入(角色已拉入档案馆与聊天列表)
// - reader_user_paragraph_comments: 用户自写书的段落评论存储（路人段评）
//   reader_books/reader_chapters 复用，用 isImported=3 标记用户自写书
// ============================================
db.version(33).stores({
  qt_fanwall_letters: 'id++, gameId, charName, branch, deepened, createdAt',
  reader_user_paragraph_comments: 'id++, bookId, chapterId, paraIdx, charName, content, createdAt'
});

// ============================================
// 🎯 Version 34：快穿局·文风特调
// - qt_styles: 文风套件（名称/提示词，可导入导出，高优先级注入 AI 提示词）
//   * builtin: 内置文风标记（不可删除）
//   * promptHint: 注入到 prompt 的文风约束（最高优先级，凌驾于其他写作要求）
//   * version: 内置文风版本号（用于自动升级）
// ============================================
db.version(34).stores({
  qt_styles: 'id++, name, builtin, version, createdAt'
});

// ============================================
// 🎯 Version 35：原始对话向量检索表
// - dialogue_vectors: 每一轮原始对话(user+char)的预计算向量
//   * sessionId: 所属会话
//   * roundIndex: 轮次序号（用于排序与去重）
//   * userText / charText / combinedText: 该轮对话原文（截断存储）
//   * vector: 该轮 combinedText 的 embedding（Dexie 透明存储，不声明索引）
//   * timestamp: 该轮时间戳（用于时间衰减）
//   独立于 summaries 表的总结检索，作为第二维"原始对话"召回源 [3]
// ============================================
db.version(35).stores({
  dialogue_vectors: 'id++, sessionId, roundIndex, timestamp'
});

// ============================================
// Version 36：对话快照（文件管理）表
// - chat_archives: 单聊对话的即时快照存档
//   * userId: 快照归属的 user 面具 ID（用于按 user 分类）
//   * charId: 快照对应的 char 档案 ID（用于按 char 分类）
//   * customLabel: 用户自定义字段（全局唯一，用于命名与检索）
//   * charName / userName: 快照时刻的显示名（冗余存储，便于分类展示）
//   * createdAt: 创建时间戳
//   * snapshotData: 完整对话数据快照（透明存储，含 session/messages/summaries/status_history 等）
// ============================================
db.version(36).stores({
  chat_archives: 'id++, userId, charId, customLabel, createdAt'
});

// ============================================
// 🎯 Version 37：支线人物落库 + sessions.groupId 索引
// - sessions: 补建 groupId 索引，修复 "KeyPath groupId on object store sessions is not indexed" SchemaError
// - archives: 新增 isSnapshot / sourceArchiveId 索引，支线人物（对话快照分支）作为独立档案落库，
//   通过 isSnapshot=true 在档案库列表中过滤隐藏，名字/分组/备注区分，parentId 指向主线人物本体
// ============================================
db.version(37).stores({
  sessions: 'id++, userId, charId, isGroup, groupId, customCharName, customCharAvatar, customCharPersona, customUserAvatar, customUserPersona, lastMessageTime, mountedEntryIds, offlineMinWordCount, offlineMaxWordCount, offlineAutoSummaryCount, offlineMountedEntryIds, stickerMountedGroupIds, autoSummaryToggle, autoSummaryInterval, bufferRounds, summarySystemPrompt, coreSelfStatus, coreSelfPurpose, coreSelfChanges, coreRelationship, coreUserInEyes',
  archives: 'id++, type, name, avatar, remark, group, persona, parentId, isSnapshot, sourceArchiveId'
});

// ============================================
// Version 38：工作台 Agent（多对话 + 本地工作区 + GitHub）
// - wb_conversations: 会话（标题/工作区/GitHub/系统规则/统计）
// - wb_messages: 会话消息（role: user|assistant|tool|system）
// ============================================
db.version(38).stores({
  wb_conversations: 'id++, title, workspace, workspaceLabel, github, systemPrompt, summary, createdAt, updatedAt, totalTokensIn, totalTokensOut, cacheHits',
  wb_messages: 'id++, convId, seq, role, content, createdAt'
});

// ============================================
// Version 39：工作台独立 MCP 服务器配置（不依赖原有 MCP 客户端）
// - wb_mcp_servers: 工作台自己的 MCP 服务器（名称/分组/类型/URL/Headers/工具列表/开关）
// ============================================
db.version(39).stores({
  wb_mcp_servers: 'id++, name, group, type, url, headers, enabled, tools, updatedAt'
});

// ============================================
// Version 40：工作台 Agent 标准化配置
// - wb_agents: Agent（角色/描述/系统提示/建议模型/启用 Skills）
// - wb_skills: Skill（标准化能力指令集，名称/描述/指令/内置标记）
// ============================================
db.version(40).stores({
  wb_agents: 'id++, name, description, systemPrompt, model, skills, builtin, enabled, updatedAt',
  wb_skills: 'id++, name, description, instructions, builtin, enabled, updatedAt'
});

// ============================================
// Version 41：仪轨（日程/穿着/随身物品/位置 四维状态）+ 纪念日倒数
// - ritual_states: 某主体（char/user）某一天的四维状态；[subjectType+subjectId+date] 复合索引便于按人按日取
// - ritual_anniversaries: 纪念日（纯倒数，替代原情侣空间的"日程式纪念日"）
// ============================================
db.version(41).stores({
  ritual_states: 'id++, meId, subjectType, subjectId, date, source, updatedAt, [subjectType+subjectId+date]',
  ritual_anniversaries: 'id++, charId, meId, date, createdAt'
});

// ============================================
// Version 42：仪轨 · 衣柜（每个角色/用户单独管理衣物）
// - ritual_wardrobe: 某主体某个类别下的一件衣物（image 为可选 data URL，空则用内置占位图标）
// ============================================
db.version(42).stores({
  ritual_wardrobe: 'id++, subjectType, subjectId, category, name, createdAt'
});

// ============================================
// Version 43：桌面图片资源（照片卡 / 横幅背景 / 壁纸等）
// - assets: key 为资源名，data 为 data URL
//   IndexedDB 配额远大于 localStorage（5MB），照片不必再牺牲画质压缩
// ============================================
db.version(43).stores({
  assets: 'key, updatedAt'
});
