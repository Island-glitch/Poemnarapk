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
