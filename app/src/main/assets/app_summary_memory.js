/**
 * app_summary_memory.js - 对话自动/手动总结与核心记忆关联召回系统
 */

// 向量检索基础余弦相似度算法及 native 绑定桥 [1]
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function safeGetEmbedding(text) {
  if (!text) return null;
  const vectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  if (!vectorEnabled) return null;

  const source = localStorage.getItem("vector-source") || "online";

  // 1. 优先：在线 Embedding API（网页版与 APK 通用）
  if (source === "online") {
    const apiUrl = localStorage.getItem("vector-api-url");
    const apiKey = localStorage.getItem("vector-api-key");
    const model = localStorage.getItem("vector-api-model");
    if (apiUrl && apiKey && model) {
      try {
        // 规整为 /v1/embeddings 端点
        let endpoint = apiUrl.trim().replace(/\/+$/, "");
        if (!/\/embeddings$/.test(endpoint)) {
          endpoint += /\/v\d+$/.test(endpoint) ? "/embeddings" : "/v1/embeddings";
        }
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({ model: model, input: text })
        });
        if (resp.ok) {
          const data = await resp.json();
          const vec = data.data ? data.data[0].embedding : data.embedding;
          if (vec && vec.length) return vec;
        } else {
          console.error("在线 Embedding API 返回异常:", resp.status);
        }
      } catch(e) {
        console.error("在线 Embedding API 调用失败:", e);
      }
    }
  }

  // 2. 本地 ONNX 模型（仅 APK 真机环境，且需主动下载）
  if (source === "local" || source === "online") {
    // online 在线失败时也降级尝试本地模型，保证检索不中断
    if (window.AndroidMCP && typeof window.AndroidMCP.getEmbedding === 'function') {
      try {
        // 仅当本地模型已就绪时才调用（避免无模型时报错）
        if (typeof window.AndroidMCP.isLocalEmbeddingModelReady === 'function') {
          const ready = window.AndroidMCP.isLocalEmbeddingModelReady();
          const isReady = ready === true || ready === "true" || ready === 1 || ready === "1";
          if (!isReady) return null;
        }
        const res = window.AndroidMCP.getEmbedding(text);
        if (res) return JSON.parse(res);
      } catch(e) {
        console.error("生成本地 ONNX 向量失败:", e);
      }
    }
  }

  return null;
}

// 1. 提取对话轮次列表算法 (一轮 = user连续发言段 + char连续回复段)
// [6] 语音/视频通话记录(senderType=system, contentType=call)也计入对话轮次，参与向量检索与被检索
function getRoundsList(messages) {
  let rounds = [];
  let currentRound = { userMsgContent: "", charMsgContent: "", timestamp: 0 };

  for (let m of messages) {
    if (m.senderType === 'user') {
      if (currentRound.userMsgContent && currentRound.charMsgContent) {
        rounds.push(currentRound);
        currentRound = { userMsgContent: "", charMsgContent: "", timestamp: 0 };
      }
      currentRound.userMsgContent = currentRound.userMsgContent
        ? currentRound.userMsgContent + "\n" + m.content
        : m.content;
      currentRound.timestamp = m.timestamp;
    } else if (m.senderType === 'char') {
      if (currentRound.userMsgContent) {
        currentRound.charMsgContent = currentRound.charMsgContent
          ? currentRound.charMsgContent + "\n" + m.content
          : m.content;
      }
    } else if (m.senderType === 'system' && m.contentType === 'call') {
      // [6] 通话记录计入轮次：解析 summary 作为对话内容
      try {
        const callData = JSON.parse(m.content);
        const callSummary = callData.summary || `${callData.type === 'video' ? '视频' : '语音'}通话 ${callData.durationSec || 0}秒`;
        // 通话记录作为 user 发起的内容（user 主动呼叫或接听）
        if (currentRound.userMsgContent && currentRound.charMsgContent) {
          rounds.push(currentRound);
          currentRound = { userMsgContent: "", charMsgContent: "", timestamp: 0 };
        }
        currentRound.userMsgContent = currentRound.userMsgContent
          ? currentRound.userMsgContent + "\n" + `[${callSummary}]`
          : `[${callSummary}]`;
        if (!currentRound.timestamp) currentRound.timestamp = m.timestamp;
      } catch(e) {}
    }
  }
  if (currentRound.userMsgContent && currentRound.charMsgContent) {
    rounds.push(currentRound);
  }
  return rounds;
}

// 1.5 线下赴约记录轮次提取（带 offline_messages.id 标记，用于向量嵌入）
// 赴约记录与线上消息共用轮次分组算法（user 连续发言 + char 连续回复 = 一轮），
// 每轮额外记录其覆盖的 offline_messages 主键 id。（embedOfflineAppointmentRounds 使用）
function getOfflineRoundsWithIds(offlineMsgs) {
  let rounds = [];
  let currentRound = { userMsgContent: "", charMsgContent: "", timestamp: 0, ids: [], _isOffline: true };
  for (let m of offlineMsgs) {
    if (m.senderType === 'user') {
      if (currentRound.userMsgContent && currentRound.charMsgContent) {
        rounds.push(currentRound);
        currentRound = { userMsgContent: "", charMsgContent: "", timestamp: 0, ids: [], _isOffline: true };
      }
      currentRound.userMsgContent = currentRound.userMsgContent
        ? currentRound.userMsgContent + "\n" + m.content
        : m.content;
      currentRound.timestamp = m.timestamp;
      currentRound.ids.push(m.id);
    } else if (m.senderType === 'char') {
      if (currentRound.userMsgContent) {
        currentRound.charMsgContent = currentRound.charMsgContent
          ? currentRound.charMsgContent + "\n" + m.content
          : m.content;
      }
      currentRound.ids.push(m.id);
    }
  }
  if (currentRound.userMsgContent && currentRound.charMsgContent) {
    rounds.push(currentRound);
  }
  return rounds;
}

// 1.6 从"统一消息流"构建轮次（严格按时间线，线上线下同一算法）
// stream 元素: { senderType, content, timestamp, id, _src: 'online'|'offline', _done?: boolean }
// 每轮返回: { userMsgContent, charMsgContent, timestamp, ids[], srcs[], _isOffline, _doneAll }
// - ids/srcs 与消息一一对应，供总结成功后精确标记进度（线上 summarized / 线下 mergedArchived）
// - _doneAll：该轮所有消息均已总结/存档（仅当 stream 元素携带 _done 时有效，用于统计展示）
function buildRoundsFromStream(stream) {
  let rounds = [];
  let cur = { userMsgContent: "", charMsgContent: "", timestamp: 0, ids: [], srcs: [], _isOffline: false, _doneAll: true };
  const flush = () => {
    if (cur.userMsgContent && cur.charMsgContent) rounds.push(cur);
    cur = { userMsgContent: "", charMsgContent: "", timestamp: 0, ids: [], srcs: [], _isOffline: false, _doneAll: true };
  };
  for (const m of stream) {
    if (m.senderType === 'user') {
      if (cur.userMsgContent && cur.charMsgContent) flush();
      cur.userMsgContent = cur.userMsgContent ? cur.userMsgContent + "\n" + m.content : m.content;
      cur.timestamp = m.timestamp || cur.timestamp;
      cur.ids.push(m.id);
      cur.srcs.push(m._src);
      if (m._src === 'offline') cur._isOffline = true;
      if (m._done !== true) cur._doneAll = false;
    } else if (m.senderType === 'char') {
      if (cur.userMsgContent) {
        cur.charMsgContent = cur.charMsgContent ? cur.charMsgContent + "\n" + m.content : m.content;
      }
      cur.ids.push(m.id);
      cur.srcs.push(m._src);
      if (m._src === 'offline') cur._isOffline = true;
      if (m._done !== true) cur._doneAll = false;
    } else if (m.senderType === 'system' && m.contentType === 'call') {
      // 通话记录计入轮次（与 getRoundsList 对齐）：解析 summary 作为对话内容
      try {
        const callData = JSON.parse(m.content);
        const callSummary = callData.summary || `${callData.type === 'video' ? '视频' : '语音'}通话 ${callData.durationSec || 0}秒`;
        if (cur.userMsgContent && cur.charMsgContent) flush();
        cur.userMsgContent = cur.userMsgContent ? cur.userMsgContent + "\n[" + callSummary + "]" : "[" + callSummary + "]";
        if (!cur.timestamp) cur.timestamp = m.timestamp;
        cur.ids.push(m.id);
        cur.srcs.push(m._src);
        if (m._done !== true) cur._doneAll = false;
      } catch(e) {}
    }
  }
  flush();
  return rounds;
}

// 1.7 获取"待总结统一消息流"：线上未总结消息 + 未存档线下赴约记录（开关开启时），按时间戳严格排序
// 进度判定基于消息级标记（线上 messages.summarized !== 1 / 线下 mergedArchived !== 1），
// 与轮次索引无关 —— 线上线下任意来回切换、多次穿插，都不会产生索引漂移或漏总结。
async function getTimelineStream(sessionId) {
  const sess = await db.sessions.get(sessionId);
  const onlineMsgs = await db.messages
    .where('sessionId').equals(sessionId)
    .and(m => m.summarized !== 1)
    .sortBy('timestamp');
  const stream = onlineMsgs.map(m => ({ ...m, _src: 'online' }));
  if (sess && sess.mergeOfflineIntoContext === 1) {
    try {
      const offlineMsgs = await db.offline_messages
        .where('sessionId').equals(sessionId)
        .and(m => m.isTheater === 0 && m.mergedArchived !== 1)
        .sortBy('timestamp');
      offlineMsgs.forEach(m => stream.push({ ...m, _src: 'offline' }));
    } catch (e) {
      console.warn("读取未存档赴约记录失败:", e);
    }
  }
  stream.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return stream;
}

// 1.8 获取待总结轮次（严格时间线合并，供自动总结 / 手动总结 / 记忆面板使用）
async function getPendingSummaryRounds(sessionId) {
  const stream = await getTimelineStream(sessionId);
  if (stream.length === 0) return [];
  return buildRoundsFromStream(stream);
}

// 1.9 全量时间线统计（记忆面板展示）：全部轮次 / 已总结轮次 / 待总结轮次
async function getFullTimelineStats(sessionId) {
  const sess = await db.sessions.get(sessionId);
  const onlineMsgs = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
  const stream = onlineMsgs.map(m => ({ ...m, _src: 'online', _done: m.summarized === 1 }));
  if (sess && sess.mergeOfflineIntoContext === 1) {
    try {
      const offlineMsgs = await db.offline_messages
        .where('sessionId').equals(sessionId)
        .and(m => m.isTheater === 0)
        .sortBy('timestamp');
      offlineMsgs.forEach(m => stream.push({ ...m, _src: 'offline', _done: m.mergedArchived === 1 }));
    } catch (e) {}
  }
  stream.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const rounds = buildRoundsFromStream(stream);
  let done = 0;
  for (const r of rounds) {
    if (r.ids.length > 0 && r._doneAll) done++;
  }
  return { total: rounds.length, done, pending: rounds.length - done };
}

// 2. 核心：检索召回机制 (支持传统关键词匹配，以及升级后的本地向量高精检索及衰减时间 λ) [1]
async function retrieveSummaries(sessionId, latestUserMessageText) {
  const allSummaries = await db.summaries.where('sessionId').equals(sessionId).sortBy('startRound');
  if (allSummaries.length === 0) return [];

  // 固定优先包含最后生成的 5 条碎片总结，保留基本上下文
  const recentSummaries = allSummaries.slice(-5);
  const recentIds = new Set(recentSummaries.map(s => s.id));

  const otherSummaries = allSummaries.filter(s => !recentIds.has(s.id));
  let matchedSummaries = [];

  const isVectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  let queryVector = null;

  if (isVectorEnabled && latestUserMessageText) {
    queryVector = await safeGetEmbedding(latestUserMessageText);
  }

  if (queryVector && otherSummaries.length > 0) {
    const decayType = localStorage.getItem("vector-decay-type") || "medium";
    let lambda = 0.05; // 默认新旧平衡衰减系数
    if (decayType === "high") lambda = 0.5; // 看重近期记忆
    else if (decayType === "low") lambda = 0.001; // 看重久远记忆

    const threshold = parseFloat(localStorage.getItem("vector-threshold") || "0.55");
    const topk = parseInt(localStorage.getItem("vector-topk") || "3");

    // 读取三角形重心偏好参数
    const wEmo = parseFloat(localStorage.getItem("vector-weight-emotional") || "0.33");
    const wFac = parseFloat(localStorage.getItem("vector-weight-factual") || "0.33");
    const wCor = parseFloat(localStorage.getItem("vector-weight-core") || "0.34");

    // 计算各维度的最大召回限额
    const limitEmo = Math.max(0, Math.round(wEmo * topk));
    const limitFac = Math.max(0, Math.round(wFac * topk));
    const limitCor = Math.max(0, Math.round(wCor * topk));

    const emoGroup = [];
    const facGroup = [];
    const corGroup = [];

    otherSummaries.forEach(s => {
      if (s.vector) {
        const sim = cosineSimilarity(queryVector, s.vector);
        // 修复 [6]：用原始相似度做阈值过滤，衰减仅用于排序偏好。
        // 旧逻辑 score = sim * decayFactor >= threshold 导致久远总结永远无法被召回
        // （lambda=0.05 时，14天前的总结即使 sim=1.0 也无法通过 0.55 阈值）。
        if (sim >= threshold) {
          const daysAgo = (Date.now() - s.timestamp) / (1000 * 60 * 60 * 24);
          const decayFactor = Math.exp(-lambda * daysAgo);
          const rankScore = sim * decayFactor; // 衰减仅用于排序（近期优先），不用于过滤
          const item = { s, rankScore, sim };
          if (s.category === 'emotional') emoGroup.push(item);
          else if (s.category === 'core') corGroup.push(item);
          else facGroup.push(item); // factual 事实及降级分类
        }
      }
    });

    // 各大分类独立执行降序排列（按衰减后得分，近期优先）
    emoGroup.sort((a, b) => b.rankScore - a.rankScore);
    facGroup.sort((a, b) => b.rankScore - a.rankScore);
    corGroup.sort((a, b) => b.rankScore - a.rankScore);

    // 精确拉取对应配额的 Top-K 向量记忆片
    const slicedEmo = emoGroup.slice(0, limitEmo).map(item => item.s);
    const slicedFac = facGroup.slice(0, limitFac).map(item => item.s);
    const slicedCor = corGroup.slice(0, limitCor).map(item => item.s);

    matchedSummaries = [...slicedEmo, ...slicedFac, ...slicedCor];
  } else if (latestUserMessageText && otherSummaries.length > 0) {
    // 兜底降级：执行原有关键词模糊匹配
    const cleanedInput = latestUserMessageText.toLowerCase();
    otherSummaries.forEach(s => {
      let keywords = [];
      try { keywords = JSON.parse(s.keywords || "[]"); } catch(e){}
      
      const isMatch = keywords.some(k => cleanedInput.includes(k.toLowerCase()) || s.content.toLowerCase().includes(k.toLowerCase()));
      if (isMatch) {
        matchedSummaries.push(s);
      }
    });
    
    if (matchedSummaries.length > 20) {
      const selected = [];
      for (let j = 0; j < 20; j++) {
        const index = Math.floor(j * matchedSummaries.length / 20);
        selected.push(matchedSummaries[index]);
      }
      matchedSummaries = selected;
    }
  }

  const combined = [...recentSummaries, ...matchedSummaries];
  const uniqueMap = new Map();
  combined.forEach(s => uniqueMap.set(s.id, s));

  const finalSummaries = Array.from(uniqueMap.values()).sort((a,b) => a.startRound - b.startRound);
  // 详细打印匹配内容供调试 [2]
  console.groupCollapsed(`[向量检索-总结] 全部${allSummaries.length}条 → 注入${finalSummaries.length}条 (近期固定${recentSummaries.length}+匹配${matchedSummaries.length})`);
  console.log(`查询文本: "${latestUserMessageText.substring(0, 80)}${latestUserMessageText.length > 80 ? '...' : ''}"`);
  matchedSummaries.forEach((s, i) => {
    console.log(`  #${i + 1} [第${s.startRound}-${s.endRound}轮 ${s.category || 'factual'}] ${s.content.substring(0, 100)}`);
  });
  console.groupEnd();
  return finalSummaries;
}

// ============================================================
// 原始对话向量检索（第二维度，独立于三角形总结检索）[3]
// ============================================================

// 截断辅助：保留前 N 字符，超出加省略号
function truncateForVector(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

// 预嵌入并存储一轮原始对话（在每轮 AI 回复完成后调用）
// 将 user+char 拼接文本转向量并存入 dialogue_vectors 表
async function embedAndStoreDialogueRound(sessionId, roundIndex, userText, charText, timestamp) {
  if (!sessionId || !userText) return;
  const vectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  if (!vectorEnabled) return;

  // 截断存储，控制 token 成本（user 100 字 + char 200 字）[3]
  const truncatedUser = truncateForVector(userText, 100);
  const truncatedChar = truncateForVector(charText, 200);
  const combinedText = `${truncatedUser}\n${truncatedChar}`;

  // 检查是否已存在该轮次的向量（避免重复嵌入）
  const existing = await db.dialogue_vectors
    .where('sessionId').equals(sessionId)
    .and(d => d.roundIndex === roundIndex)
    .first();
  if (existing && existing.vector) return; // 已有向量，跳过

  const vector = await safeGetEmbedding(combinedText);
  if (!vector) return;

  if (existing) {
    // 已有记录但缺向量，更新
    await db.dialogue_vectors.update(existing.id, {
      userText: truncatedUser,
      charText: truncatedChar,
      combinedText,
      vector,
      timestamp: timestamp || Date.now()
    });
  } else {
    await db.dialogue_vectors.add({
      sessionId,
      roundIndex,
      userText: truncatedUser,
      charText: truncatedChar,
      combinedText,
      vector,
      timestamp: timestamp || Date.now()
    });
  }
}

// 线下赴约记录向量预嵌入：将"未存档"的赴约轮次按时间线嵌入 dialogue_vectors
// 设计要点：
// - roundIndex 使用负数（-1, -2, ...）与线上轮次索引(0,1,2,...)物理隔离，绝不冲突；
//   升序排序后线下记录整体位于线上之前，天然作为"历史"参与检索，不会被 recentSkip 剔除。
// - 嵌入文本加【线下赴约】前缀，增强向量语义区分度；记录 isOfflineRound=1 供检索输出标注。
// - 用 offlineContentKey（时间戳+内容指纹）幂等去重，避免同一轮次重复嵌入。
async function embedOfflineAppointmentRounds(sessionId) {
  if (!sessionId) return;
  const vectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  if (!vectorEnabled) return;
  const sess = await db.sessions.get(sessionId);
  if (!sess || sess.mergeOfflineIntoContext !== 1) return;

  const offlineMsgs = await db.offline_messages
    .where('sessionId').equals(sessionId)
    .and(m => m.isTheater === 0 && m.mergedArchived !== 1)
    .sortBy('timestamp');
  if (offlineMsgs.length === 0) return;

  const rounds = getOfflineRoundsWithIds(offlineMsgs);

  // 已有线下向量（roundIndex<0），用于去重与负数索引分配
  const existing = await db.dialogue_vectors
    .where('sessionId').equals(sessionId)
    .and(d => d.roundIndex < 0)
    .toArray();
  const existingKeys = new Set((existing || []).map(e => e.offlineContentKey).filter(Boolean));
  let nextNegative = -((existing ? existing.length : 0) + 1);

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const contentKey = `${r.timestamp || 0}|${r.userMsgContent || ""}|${r.charMsgContent || ""}`;
    if (existingKeys.has(contentKey)) continue;

    const truncatedUser = truncateForVector(r.userMsgContent, 100);
    const truncatedChar = truncateForVector(r.charMsgContent, 200);
    const combinedText = `【线下赴约记录】\n${truncatedUser}\n${truncatedChar}`;
    const vector = await safeGetEmbedding(combinedText);
    if (!vector) continue;

    await db.dialogue_vectors.add({
      sessionId,
      roundIndex: nextNegative--,
      userText: truncatedUser,
      charText: truncatedChar,
      combinedText,
      vector,
      timestamp: r.timestamp || Date.now(),
      offlineContentKey: contentKey,
      isOfflineRound: 1
    });
    existingKeys.add(contentKey);
  }
}

// 原始对话向量检索：用当前用户消息检索最相似的历史原始对话轮次 [3]
// 独立于 retrieveSummaries 的三角形机制，作为第二召回维度
async function retrieveRawDialogues(sessionId, latestUserMessageText, excludeRanges) {
  if (!sessionId || !latestUserMessageText) return [];

  const vectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  const rawEnabled = localStorage.getItem("raw-dialogue-enabled") === "true";
  if (!vectorEnabled || !rawEnabled) return [];

  // 获取该会话所有已嵌入的原始对话轮次
  const allRounds = await db.dialogue_vectors
    .where('sessionId').equals(sessionId)
    .sortBy('roundIndex');
  if (allRounds.length === 0) return [];

  // 排除最近 N 轮（这些已在当前上下文窗口中，无需重复注入）
  const recentSkip = parseInt(localStorage.getItem("raw-dialogue-recent-skip") || "5");
  const candidates = allRounds.slice(0, Math.max(0, allRounds.length - recentSkip));
  if (candidates.length === 0) return [];

  const queryVector = await safeGetEmbedding(latestUserMessageText);
  if (!queryVector) return [];

  // 检索参数（独立于总结检索的参数）
  const threshold = parseFloat(localStorage.getItem("raw-dialogue-threshold") || "0.50");
  const topk = parseInt(localStorage.getItem("raw-dialogue-topk") || "3");
  const decayType = localStorage.getItem("vector-decay-type") || "medium";
  let lambda = 0.02; // 原始对话用更轻的衰减（比总结的 0.05 更平缓）
  if (decayType === "high") lambda = 0.2;
  else if (decayType === "low") lambda = 0.001;

  // excludeRanges: 已被总结召回覆盖的轮次范围 [{start, end}]，去重避免冗余 [3]
  const isExcluded = (roundIndex) => {
    if (!excludeRanges || excludeRanges.length === 0) return false;
    return excludeRanges.some(r => roundIndex >= r.start && roundIndex <= r.end);
  };

  const scored = [];
  candidates.forEach(d => {
    if (!d.vector) return;
    if (isExcluded(d.roundIndex)) return; // 跳过已被总结覆盖的轮次
    const sim = cosineSimilarity(queryVector, d.vector);
    // 修复 [6]：用原始相似度做阈值过滤，衰减仅用于排序偏好。
    // 旧逻辑 score = sim * decayFactor >= threshold 导致久远记忆永远无法被召回
    // （60天前的记忆即使 sim=1.0，decayFactor≈0.30，score 也无法通过 0.50 阈值）。
    if (sim >= threshold) {
      const daysAgo = (Date.now() - d.timestamp) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-lambda * daysAgo);
      const rankScore = sim * decayFactor; // 衰减仅用于排序（近期优先），不用于过滤
      scored.push({ d, rankScore, sim });
    }
  });

  // 按衰减后得分降序（近期记忆优先），取 Top-K
  scored.sort((a, b) => b.rankScore - a.rankScore);
  const result = scored.slice(0, topk).map(item => item.d);
  // 详细打印匹配内容供调试 [2]
  console.groupCollapsed(`[向量检索-原始对话] 候选${candidates.length}轮 → 命中${result.length}条 (阈值≥${threshold}, TopK=${topk})`);
  console.log(`查询文本: "${latestUserMessageText.substring(0, 80)}${latestUserMessageText.length > 80 ? '...' : ''}"`);
  scored.slice(0, topk).forEach((item, i) => {
    console.log(`  #${i + 1} [sim=${item.sim.toFixed(4)} rank=${item.rankScore.toFixed(4)} 轮次${item.d.roundIndex}]`);
    console.log(`    对方说: ${item.d.userText}`);
    console.log(`    你回: ${item.d.charText}`);
  });
  console.groupEnd();
  return result;
}

// 一键补建历史原始对话向量（扫描全部消息，按轮次嵌入）
async function rebuildDialogueVectors(sessionId, progressCb) {
  if (!sessionId) return 0;
  const vectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  if (!vectorEnabled) return 0;

  const rawMsgs = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
  if (rawMsgs.length === 0) return 0;
  const rounds = getRoundsList(rawMsgs);
  if (rounds.length === 0) return 0;

  let built = 0;
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    // 检查是否已有向量
    const existing = await db.dialogue_vectors
      .where('sessionId').equals(sessionId)
      .and(d => d.roundIndex === i)
      .first();
    if (existing && existing.vector) continue; // 已有，跳过

    const truncatedUser = truncateForVector(r.userMsgContent, 100);
    const truncatedChar = truncateForVector(r.charMsgContent, 200);
    const combinedText = `${truncatedUser}\n${truncatedChar}`;
    const vector = await safeGetEmbedding(combinedText);
    if (!vector) continue;

    if (existing) {
      await db.dialogue_vectors.update(existing.id, {
        userText: truncatedUser, charText: truncatedChar, combinedText, vector,
        timestamp: r.timestamp || Date.now()
      });
    } else {
      await db.dialogue_vectors.add({
        sessionId, roundIndex: i,
        userText: truncatedUser, charText: truncatedChar, combinedText, vector,
        timestamp: r.timestamp || Date.now()
      });
    }
    built++;
    if (progressCb) progressCb(i + 1, rounds.length);
  }

  // 一键补建同时覆盖"线下赴约记录"（开关开启且向量启用时，自动按时间线嵌入）
  try {
    if (typeof embedOfflineAppointmentRounds === 'function') {
      await embedOfflineAppointmentRounds(sessionId);
    }
  } catch (e) {
    console.warn("补建线下赴约向量失败:", e);
  }
  return built;
}
async function generateSummaryForRounds(sessionId, startRound, endRound, customPrompt) {
  const api = await window.apiRoutes.resolve("memory");
  if (!api) throw new Error("无法加载 API 配置，总结失败。");

  // 严格时间线合并：线上未总结消息 + 未存档线下赴约记录（开关开启时），按时间戳排序分组为轮次。
  // 进度判定基于消息级标记（summarized / mergedArchived），startRound/endRound 仅表示本次总结在
  // "当前待总结轮次列表"中的区间，线上线下任意穿插都不会产生索引漂移或漏总结。
  const rounds = await getPendingSummaryRounds(sessionId);

  if (rounds.length < endRound) return;

  let dialogText = "";
  for (let i = startRound - 1; i < endRound; i++) {
    const r = rounds[i];
    if (!r) continue; // 防御：区间越界时跳过，避免访问 undefined 崩溃
    const offlineTag = r._isOffline ? "[线下赴约]" : "";
    dialogText += `[轮次 ${i+1}]${offlineTag}\n用户: ${r.userMsgContent}\n对方: ${r.charMsgContent}\n\n`;
  }

  const formatChoice = localStorage.getItem("summary-format-choice") || "json";
  let systemPrompt = "";

  if (formatChoice === "json") {
    systemPrompt = `你是一个长周期记忆整合引擎。请对以下发生的对话轮次进行碎片化总结，并严格归入以下三个模块分类：
- "emotional": 情感需求（角色或用户在对话中表现出的深层情感渴望、心理脆弱点或防御机制，不超过80字）
- "factual": 事实记忆（发生的重要事件细节、提及的时间、数字、物理背景，不超过80字）
- "core": 核心记忆（涉及长线关系转变、核心认知改变、重大转折性共识，不超过80字）

【输出格式控制】：请直接且仅返回以下格式的 JSON 数组（不要包含任何 Markdown 标识符如 \`\`\`json 块）：
[
  {"category": "emotional", "content": "情感碎片内容", "keywords": ["词1", "词2"]},
  {"category": "factual", "content": "事实碎片内容", "keywords": ["词1"]},
  {"category": "core", "content": "核心碎片内容", "keywords": ["词1"]}
]

---
对话原文：
${dialogText}`;
  } else {
    systemPrompt = `你是一个长周期记忆整合引擎。请对以下发生的对话轮次进行碎片化总结，并严格归入以下三个模块分类（如果没有对应分类内容可省略该块）。请直接按照以下文字标签块格式输出（不要包含 Markdown 代码块）：

[情感需求]
内容：情感需求具体总结描述（不超过80字）
关键词：词1, 词2

[事实记忆]
内容：事实事件具体总结描述（不超过80字）
关键词：词1, 词2

[核心记忆]
内容：核心转变具体总结描述（不超过80字）
关键词：词1, 词2

---
对话原文：
${dialogText}`;
  }

  let rawText;
  if (typeof window.fwCallLLM === "function") {
    try {
      rawText = await window.fwCallLLM(api, [{ role: "user", content: systemPrompt }], { temperature: 0.3 });
    } catch(e) { /* fall through to original fetch */ }
  }
  if (rawText === undefined) {
    const response = await fetch(`${api.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: systemPrompt }],
        temperature: 0.3
      })
    });

    if (!response.ok) throw new Error("API 调用整合总结失败");
    const result = await response.json();
    rawText = result.choices[0].message.content.trim();
  }

  let items = [];

  if (formatChoice === "json") {
    try {
      let cleaned = rawText.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
      try {
        items = JSON.parse(cleaned);
      } catch (err) {
        // 括号与结构破损自愈性解析
        cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
        if (!cleaned.startsWith('[') && cleaned.includes('{')) cleaned = '[' + cleaned;
        if (!cleaned.endsWith(']') && cleaned.includes('}')) cleaned = cleaned + ']';
        items = JSON.parse(cleaned);
      }
    } catch (e) {
      // 正则强制匹配提取有效的 JSON 节点片段
      try {
        let cleaned = rawText.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
        const regex = /\{\s*"category"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"([^"]+)"(?:\s*,\s*"keywords"\s*:\s*(\[[^\]]*\]))?\s*\}/gi;
        let match;
        while ((match = regex.exec(cleaned)) !== null) {
          const category = match[1];
          const content = match[2];
          let keywords = [];
          if (match[3]) {
            try { keywords = JSON.parse(match[3]); } catch(err) {}
          }
          items.push({ category, content, keywords });
        }
      } catch (regexErr) {
        console.error("JSON 与正则提取自愈解析完全失败:", regexErr);
      }
    }
  } else {
    // 文字标签快自愈性解析 (兼容全角/半角)
    try {
      const normalized = rawText
        .replace(/【/g, '[').replace(/】/g, ']')
        .replace(/［/g, '[').replace(/］/g, ']')
        .replace(/：/g, ':')
        .replace(/，/g, ',');
      
      const sections = normalized.split(/\[(情感需求|事实记忆|核心记忆)\]/gi);
      for (let i = 1; i < sections.length; i += 2) {
        const catName = sections[i].trim();
        const block = sections[i + 1] || "";
        
        let category = 'factual';
        if (catName.includes('情感')) category = 'emotional';
        else if (catName.includes('核心')) category = 'core';
        
        let content = "";
        let keywords = [];
        
        const contentMatch = block.match(/内容\s*:\s*([^\n]+)/i);
        if (contentMatch) content = contentMatch[1].trim();
        
        const kwMatch = block.match(/关键词\s*:\s*([^\n]+)/i);
        if (kwMatch) {
          keywords = kwMatch[1].split(',').map(k => k.trim()).filter(Boolean);
        }
        
        if (content) {
          items.push({ category, content, keywords });
        }
      }
    } catch (textErr) {
      console.error("文字标签块自愈性解析失败:", textErr);
    }
  }

  // 如果双重解析格式最终皆无法捕获，则直接一股脑塞进事实分类，保证数据 100% 不丢损 [1]
  if (!Array.isArray(items) || items.length === 0) {
    items = [{
      category: 'factual',
      content: rawText,
      keywords: ["日常", "事件"]
    }];
  }

  const isVectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
      const summaryTimestamp = rounds[endRound - 1]?.timestamp || Date.now();

      // 依次将分类纸条异步入库并提取 Embedding
      for (let item of items) {
        let vector = null;
        if (isVectorEnabled) {
          vector = await safeGetEmbedding(item.content);
        }

        await db.summaries.add({
          sessionId: sessionId,
          startRound: startRound,
          endRound: endRound,
          content: item.content,
          category: item.category || 'factual',
          keywords: JSON.stringify(item.keywords || []),
          timestamp: summaryTimestamp,
          vector: vector
        });
      }

      // === 消息级进度标记（核心）：总结成功后，把本区间内线上消息标记 summarized=1，线下赴约记录标记 mergedArchived=1 ===
      // 标记后这些内容不再参与后续总结统计 / 上下文拼入 / 向量嵌入，实现"被跟随线上对话总结后自动存档"。
      // 之前已通过结束赴约手动存档（已删除）的记录不受影响；已存档（mergedArchived=1）的线下记录也不再重复总结。
      try {
        const onlineIdsToMark = [];
        const offlineIdsToArchive = [];
        for (let i = startRound - 1; i < endRound && i < rounds.length; i++) {
          const r = rounds[i];
          if (!r || !Array.isArray(r.ids) || !Array.isArray(r.srcs)) continue;
          r.ids.forEach((id, idx) => {
            if (r.srcs[idx] === 'offline') offlineIdsToArchive.push(id);
            else onlineIdsToMark.push(id);
          });
        }
        if (onlineIdsToMark.length > 0) {
          await db.messages.bulkUpdate(
            onlineIdsToMark.map(id => ({ key: id, changes: { summarized: 1 } }))
          );
        }
        if (offlineIdsToArchive.length > 0) {
          await db.offline_messages.bulkUpdate(
            offlineIdsToArchive.map(id => ({ key: id, changes: { mergedArchived: 1 } }))
          );
        }
      } catch (e) {
        console.warn("总结进度标记失败:", e);
      }
}

// 4. 自动总结拦截触发器 (在每次 AI 回复完成后，若符合条件且出了缓冲区则自动执行总结)
async function checkAndTriggerAutoSummary(sessionId) {
  const sess = await db.sessions.get(sessionId);
  if (!sess || sess.autoSummaryToggle !== 1) return;

  const interval = sess.autoSummaryInterval || 10;
  const buffer = sess.bufferRounds || 5;

  // 严格时间线合并轮次（线上未总结消息 + 未存档线下赴约记录），消息级进度标记保证任意穿插安全
  const pendingRounds = await getPendingSummaryRounds(sessionId);
  const totalPending = pendingRounds.length;

  // 触发条件：待总结轮数扣除缓冲区后仍达到 interval
  if (totalPending > 0 && (totalPending - buffer) >= interval) {
    const startRound = 1;
    // 保护：单次自动总结最多 100 轮，防止历史积压导致 token 爆炸（未覆盖的待总结轮次会在后续触发中继续消化）
    const endRound = Math.min(totalPending - buffer, 100);
    if (startRound <= endRound) {
      try {
        await generateSummaryForRounds(sessionId, startRound, endRound, sess.summarySystemPrompt);

      // 群聊记忆双向同步：群聊产生新总结后，回写到开启了同步的角色单聊会话
      if (sess.isGroup === 1 && sess.groupId && window.chatArchiveSystem && window.chatArchiveSystem.syncGroupMemoryToSingleChat) {
        try {
          const groupMembers = await db.group_members.where('groupId').equals(sess.groupId).toArray();
          for (const m of groupMembers) {
            if (m.memberType === 'char' && m.syncToSingle) {
              await window.chatArchiveSystem.syncGroupMemoryToSingleChat(sess.groupId, m.memberId);
            }
          }
        } catch (syncErr) {
          console.warn("群聊→单聊记忆同步失败:", syncErr);
        }
      }
    } catch(e) {
      console.error("对话自动后台总结失败:", e);
    }
  }
}

  // 原始对话向量预嵌入：每轮 AI 回复完成后，将该轮 user+char 文本嵌入并存入 dialogue_vectors [3]
  // 与总结独立运行——即使总结未达触发条件，原始对话向量仍会逐轮积累
  if (totalPending > 0 && typeof embedAndStoreDialogueRound === 'function') {
    try {
      // 从末尾向前定位最后一个线上轮次（严格时间线下，线下赴约记录可能穿插在末尾任意位置）
      let lastOnlineIdx = -1;
      for (let i = totalPending - 1; i >= 0; i--) {
        if (pendingRounds[i].srcs && pendingRounds[i].srcs.includes('online')) { lastOnlineIdx = i; break; }
      }
      if (lastOnlineIdx >= 0) {
        const round = pendingRounds[lastOnlineIdx];
        // 计算该线上轮次在"纯线上轮次列表"中的序号（dialogue_vectors 的 roundIndex 语义：0..N-1）
        const firstOnlineMsgIdx = round.srcs.indexOf('online');
        const firstOnlineId = round.ids[firstOnlineMsgIdx];
        const onlineMsgs = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
        const onlineRounds = buildRoundsFromStream(onlineMsgs.map(m => ({ ...m, _src: 'online' })));
        let onlineIdx = -1;
        for (let i = 0; i < onlineRounds.length; i++) {
          if (onlineRounds[i].ids.includes(firstOnlineId)) { onlineIdx = i; break; }
        }
        if (onlineIdx >= 0) {
          await embedAndStoreDialogueRound(
            sessionId,
            onlineIdx,
            round.userMsgContent,
            round.charMsgContent,
            round.timestamp
          );
        }
      }
    } catch(e) {
      console.warn("原始对话向量预嵌入失败:", e);
    }
  }

  // 线下赴约记录向量预嵌入：开关开启时，将未存档赴约轮次按时间线嵌入 dialogue_vectors（roundIndex 用负数隔离）
  if (typeof embedOfflineAppointmentRounds === 'function') {
    try {
      await embedOfflineAppointmentRounds(sessionId);
    } catch(e) {
      console.warn("线下赴约记录向量预嵌入失败:", e);
    }
  }
}

// 5. 记忆面板：加载总结配置与核心记忆 [1]
async function loadSummarySettings(sessionId) {
  if (!sessionId) return; // 🌟 熔断防区：防止未开启会话时 Dexie 抛 DataError
  const sess = await db.sessions.get(Number(sessionId));
  if (!sess) return;

  document.getElementById("summary-auto-toggle").checked = sess.autoSummaryToggle === 1;
  document.getElementById("summary-auto-interval").value = sess.autoSummaryInterval || 10;
  document.getElementById("summary-buffer-rounds").value = sess.bufferRounds || 5;
  document.getElementById("summary-system-prompt").value = sess.summarySystemPrompt || "以第三人称视角，按照时间顺序总结发生的所有事件，不允许有任何感情色彩，不超过150字。";
  
  const formatChoice = localStorage.getItem("summary-format-choice") || "json";
  const choiceEl = document.getElementById("summary-format-choice");
  if (choiceEl) choiceEl.value = formatChoice;

  // 统计：全量时间线（线上全部消息 + 线下全部赴约记录，含已总结/已存档），按消息级标记判定进度
  // 线上线下严格按时间线合并，任意穿插切换都不会影响统计口径
  const stats = await getFullTimelineStats(Number(sessionId));
  document.getElementById("summary-stat-summarized").innerText = stats.done;
  document.getElementById("summary-stat-total").innerText = stats.total;

  // 手动总结默认值：自动填充为"待总结区间 [1, pending]"（严格时间线下的未总结轮次）
  const pendingRounds = await getPendingSummaryRounds(Number(sessionId));
  const manualStartEl = document.getElementById("summary-manual-start");
  const manualEndEl = document.getElementById("summary-manual-end");
  if (manualStartEl) manualStartEl.value = pendingRounds.length > 0 ? "1" : "";
  if (manualEndEl) manualEndEl.value = pendingRounds.length > 0 ? String(pendingRounds.length) : "";
}

async function saveSummarySettings(sessionId) {
  const toggle = document.getElementById("summary-auto-toggle").checked ? 1 : 0;
  const interval = parseInt(document.getElementById("summary-auto-interval").value) || 10;
  const buffer = parseInt(document.getElementById("summary-buffer-rounds").value) || 5;
  const prompt = document.getElementById("summary-system-prompt").value.trim();

  await db.sessions.update(sessionId, {
    autoSummaryToggle: toggle,
    autoSummaryInterval: interval,
    bufferRounds: buffer,
    summarySystemPrompt: prompt
  });

  const choiceEl = document.getElementById("summary-format-choice");
  if (choiceEl) {
    localStorage.setItem("summary-format-choice", choiceEl.value);
  }

  alert("总结配置已成功保存并在此会话中全局应用！");
}

async function loadCoreMemory(sessionId) {
  if (!sessionId) return; // 🌟 熔断防区：防止未开启会话时 Dexie 抛 DataError
  const sess = await db.sessions.get(Number(sessionId));
  if (!sess) return;

  // 核心解耦：如果是群聊，不展现角色个人核心记忆（Core Memory）
  const coreMemoryWrapper = document.getElementById("memory-core-card-wrapper");
  if (coreMemoryWrapper) {
    coreMemoryWrapper.style.display = sess.isGroup === 1 ? "none" : "block";
  }

  if (sess.isGroup !== 1) {
    document.getElementById("memory-core-status").value = sess.coreSelfStatus || "";
    document.getElementById("memory-core-purpose").value = sess.coreSelfPurpose || "";
    document.getElementById("memory-core-changes").value = sess.coreSelfChanges || "";
    document.getElementById("memory-core-relationship").value = sess.coreRelationship || "";
    document.getElementById("memory-core-userineyes").value = sess.coreUserInEyes || "";
  }

  // 加载本地 ONNX 向量微调设置
  const isVectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
  const vectorPanel = document.getElementById("vector-config-panel");
  if (vectorPanel) {
    vectorPanel.style.display = isVectorEnabled ? "block" : "none";
  }

  if (isVectorEnabled) {
    const topk = localStorage.getItem("vector-topk") || "3";
    const decay = localStorage.getItem("vector-decay-type") || "medium";
    const threshold = localStorage.getItem("vector-threshold") || "0.55";

    document.getElementById("vector-topk").value = topk;
    const topkInputText = document.getElementById("vector-topk-input");
    if (topkInputText) topkInputText.value = topk;

    document.getElementById("vector-threshold").value = threshold;
    const vectorThresholdInput = document.getElementById("vector-threshold-input");
    if (vectorThresholdInput) vectorThresholdInput.value = threshold;

    document.querySelectorAll(".vector-decay-btn").forEach(btn => {
      const isActive = btn.getAttribute("data-decay") === decay;
      btn.classList.toggle("btn-primary", isActive);
      btn.classList.toggle("btn-outline", !isActive);
    });

    // 载入三角形重心坐标及圆点物理位置还原 [1]
    const wEmo = parseFloat(localStorage.getItem("vector-weight-emotional") || "0.33");
    const wFac = parseFloat(localStorage.getItem("vector-weight-factual") || "0.33");
    const wCor = parseFloat(localStorage.getItem("vector-weight-core") || "0.34");

    const xA = 110, yA = 24;
    const xB = 30, yB = 145;
    const xC = 190, yC = 145;

    const knobX = wEmo * xA + wFac * xB + wCor * xC;
    const knobY = wEmo * yA + wFac * yB + wCor * yC;

    const knob = document.getElementById("triangle-knob");
    if (knob) {
      knob.style.left = knobX + "px";
      knob.style.top = knobY + "px";
    }
    
    // 刷新三大项具体的条数换算分配
    const emoPct = Math.round(wEmo * 100);
    const facPct = Math.round(wFac * 100);
    const corPct = 100 - emoPct - facPct;

    const emoCnt = Math.round(wEmo * topk);
    const facCnt = Math.round(wFac * topk);
    const corCnt = Math.max(0, topk - emoCnt - facCnt);

    document.getElementById("weight-emo-pct").innerText = emoPct + "%";
    document.getElementById("weight-fac-pct").innerText = facPct + "%";
    document.getElementById("weight-cor-pct").innerText = corPct + "%";

    document.getElementById("weight-emo-cnt").innerText = emoCnt;
    document.getElementById("weight-fac-cnt").innerText = facCnt;
    document.getElementById("weight-cor-cnt").innerText = corCnt;

    // 🌟 实时计算当前待补建向量的历史总结数 [1]
    const allSums = await db.summaries.toArray();
    const missingSums = allSums.filter(s => !s.vector);
    const countEl = document.getElementById("missing-vectors-count");
    if (countEl) {
      countEl.innerText = `${missingSums.length} 条待补建`;
    }

    // === 原始对话向量检索配置回填与绑定 [3] ===
    const rawEnabled = localStorage.getItem("raw-dialogue-enabled") === "true";
    const rawToggle = document.getElementById("raw-dialogue-toggle");
    const rawSection = document.getElementById("raw-dialogue-config-section");
    if (rawToggle) {
      rawToggle.checked = rawEnabled;
      if (rawSection) rawSection.style.display = rawEnabled ? "block" : "none";
      rawToggle.onchange = () => {
        localStorage.setItem("raw-dialogue-enabled", rawToggle.checked ? "true" : "false");
        if (rawSection) rawSection.style.display = rawToggle.checked ? "block" : "none";
      };
    }
    // 检索轮数
    const rawTopk = localStorage.getItem("raw-dialogue-topk") || "3";
    const rawTopkSlider = document.getElementById("raw-dialogue-topk");
    const rawTopkInput = document.getElementById("raw-dialogue-topk-input");
    if (rawTopkSlider) {
      rawTopkSlider.value = rawTopk;
      rawTopkSlider.oninput = () => {
        localStorage.setItem("raw-dialogue-topk", rawTopkSlider.value);
        if (rawTopkInput) rawTopkInput.value = rawTopkSlider.value;
      };
    }
    if (rawTopkInput) {
      rawTopkInput.value = rawTopk;
      rawTopkInput.oninput = () => {
        let val = Math.max(1, Math.min(10, parseInt(rawTopkInput.value) || 3));
        localStorage.setItem("raw-dialogue-topk", val);
        if (rawTopkSlider) rawTopkSlider.value = val;
      };
    }
    // 相似度阈值（滑块+数字输入框双向绑定）[2]
    const rawThreshold = localStorage.getItem("raw-dialogue-threshold") || "0.50";
    const rawThresholdSlider = document.getElementById("raw-dialogue-threshold");
    const rawThresholdNumberInput = document.getElementById("raw-dialogue-threshold-input");
    if (rawThresholdSlider) {
      rawThresholdSlider.value = rawThreshold;
      if (rawThresholdNumberInput) rawThresholdNumberInput.value = parseFloat(rawThreshold).toFixed(2);
      rawThresholdSlider.oninput = () => {
        localStorage.setItem("raw-dialogue-threshold", rawThresholdSlider.value);
        if (rawThresholdNumberInput) rawThresholdNumberInput.value = parseFloat(rawThresholdSlider.value).toFixed(2);
      };
    }
    if (rawThresholdNumberInput) {
      rawThresholdNumberInput.oninput = () => {
        let val = parseFloat(rawThresholdNumberInput.value);
        if (isNaN(val)) val = 0.50;
        val = Math.max(0.10, Math.min(0.95, val));
        localStorage.setItem("raw-dialogue-threshold", val);
        if (rawThresholdSlider) rawThresholdSlider.value = val;
      };
    }
    // 上下文检索轮数：用最近N轮(user+char)消息拼接作为查询，索引连续话题 [2]
    const contextRounds = localStorage.getItem("raw-dialogue-context-rounds") || "3";
    const contextRoundsSlider = document.getElementById("raw-dialogue-context-rounds");
    const contextRoundsNumberInput = document.getElementById("raw-dialogue-context-rounds-input");
    const contextRoundsVal = document.getElementById("raw-dialogue-context-rounds-val");
    if (contextRoundsSlider) {
      contextRoundsSlider.value = contextRounds;
      if (contextRoundsVal) contextRoundsVal.innerText = contextRounds + " 轮";
      contextRoundsSlider.oninput = () => {
        localStorage.setItem("raw-dialogue-context-rounds", contextRoundsSlider.value);
        if (contextRoundsVal) contextRoundsVal.innerText = contextRoundsSlider.value + " 轮";
        if (contextRoundsNumberInput) contextRoundsNumberInput.value = contextRoundsSlider.value;
      };
    }
    if (contextRoundsNumberInput) {
      contextRoundsNumberInput.value = contextRounds;
      contextRoundsNumberInput.oninput = () => {
        let val = Math.max(1, Math.min(10, parseInt(contextRoundsNumberInput.value) || 3));
        localStorage.setItem("raw-dialogue-context-rounds", val);
        if (contextRoundsSlider) contextRoundsSlider.value = val;
        if (contextRoundsVal) contextRoundsVal.innerText = val + " 轮";
      };
    }
    // 跳过最近轮数
    const rawSkip = localStorage.getItem("raw-dialogue-recent-skip") || "5";
    const rawSkipSlider = document.getElementById("raw-dialogue-recent-skip");
    const rawSkipVal = document.getElementById("raw-dialogue-recent-skip-val");
    if (rawSkipSlider) {
      rawSkipSlider.value = rawSkip;
      if (rawSkipVal) rawSkipVal.innerText = rawSkip + " 轮";
      rawSkipSlider.oninput = () => {
        localStorage.setItem("raw-dialogue-recent-skip", rawSkipSlider.value);
        if (rawSkipVal) rawSkipVal.innerText = rawSkipSlider.value + " 轮";
      };
    }
    // 补建按钮
    const btnRebuildRaw = document.getElementById("btn-rebuild-raw-dialogue-vectors");
    if (btnRebuildRaw) {
      btnRebuildRaw.onclick = async () => {
        if (!activeSessionId) {
          showToast("请先选择一个对话会话");
          return;
        }
        btnRebuildRaw.disabled = true;
        const origText = btnRebuildRaw.innerHTML;
        btnRebuildRaw.innerHTML = "正在补建中...";
        try {
          const built = await rebuildDialogueVectors(activeSessionId, (cur, total) => {
            btnRebuildRaw.innerHTML = `正在补建中... ${cur}/${total}`;
          });
          showToast(`原始对话向量补建完成，新增 ${built} 条`);
        } catch(e) {
          console.error("补建原始对话向量失败:", e);
          showToast("补建失败，请检查向量 API 配置");
        }
        btnRebuildRaw.disabled = false;
        btnRebuildRaw.innerHTML = origText;
      };
    }
  }

  // 重设当前选中的 Summaries 历史碎片过滤标签
  document.querySelectorAll(".summary-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-cat") === "all");
  });

  await renderSummariesList(sessionId, "all");
}

async function saveCoreMemory(sessionId) {
  const status = document.getElementById("memory-core-status").value.trim();
  const purpose = document.getElementById("memory-core-purpose").value.trim();
  const changes = document.getElementById("memory-core-changes").value.trim();
  const relation = document.getElementById("memory-core-relationship").value.trim();
  const userInEyes = document.getElementById("memory-core-userineyes").value.trim();

  await db.sessions.update(sessionId, {
    coreSelfStatus: status,
    coreSelfPurpose: purpose,
    coreSelfChanges: changes,
    coreRelationship: relation,
    coreUserInEyes: userInEyes
  });
  alert("核心记忆库已保存！");
}

async function renderSummariesList(sessionId, category = "all") {
  if (!sessionId) return; // 🌟 熔断防区：防止未开启会话时 Dexie 抛 DataError
  const container = document.getElementById("memory-summaries-list");
  if (!container) return;
  container.innerHTML = "";

  let list = [];
  if (category === "all") {
    list = await db.summaries.where('sessionId').equals(Number(sessionId)).sortBy('startRound');
  } else {
    list = await db.summaries.where('sessionId').equals(Number(sessionId)).filter(s => s.category === category).toArray();
    list.sort((a, b) => a.startRound - b.startRound);
  }

  if (list.length === 0) {
    container.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); text-align:center; padding:20px 0;">目前该分类下尚未生成任何碎片化时间流记忆。</p>`;
    return;
  }

  // 按时间降序排列，最新生成的碎片放置于时间流最上方
  list.reverse().forEach(s => {
    const card = document.createElement("div");
    card.className = "timeline-item";
    card.style.position = "relative";
    card.style.paddingLeft = "20px";
    card.style.borderLeft = "2px solid var(--border)";
    card.style.marginLeft = "10px";
    card.style.paddingBottom = "16px";
    
    let keywords = [];
    try { keywords = JSON.parse(s.keywords || "[]"); } catch(e){}
    const tagsHtml = keywords.map(k => `<span class="summary-keyword-tag"># ${k}</span>`).join(" ");

    const sourceBadge = s.source === 'deeptalk' 
      ? `<span class="summary-source-tag deeptalk" style="background-color: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px; margin-left: 6px;">来自深谈</span>`
      : "";

    // 向量化指示器状态渲染
    const vectorBadge = s.vector 
      ? `<span class="vector-badge" style="background-color: #e0f2fe; color: #0369a1; font-size: 9px; padding: 2px 6px; border-radius: 9999px; margin-left: 6px; font-weight: 700;">384D 向量化</span>` 
      : `<span class="vector-badge" style="background-color: #f3f4f6; color: #6b7280; font-size: 9px; padding: 2px 6px; border-radius: 9999px; margin-left: 6px;">未向量化</span>`;

    const catMap = {
      'emotional': '情感需求',
      'factual': '事实记忆',
      'core': '核心记忆'
    };
    const catLabel = catMap[s.category] || "碎片总结";
    const catColor = s.category === 'emotional' ? '#ec4899' : (s.category === 'core' ? '#ca8a04' : '#10b981');

    // 提取格式化中文时间戳节点
    const timeStr = new Date(s.timestamp).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    card.innerHTML = `
      <!-- 垂直高保真流式时间线节点 -->
      <span class="timeline-dot" style="position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background-color: ${catColor}; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.15);"></span>
      <div class="summary-item-card" style="margin-top: 0; background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 12px; box-shadow: var(--shadow-sm);">
        <div class="summary-item-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11px; font-weight:700; color:${catColor}; display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
            [${catLabel}] <span style="color:var(--text-secondary); margin-left:2px; font-weight:normal;">${timeStr}</span> ${vectorBadge} ${sourceBadge}
          </span>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button class="btn-icon" style="color:#3b82f6; border:none; background:none; cursor:pointer; padding:2px;" onclick="editSummaryRecord(${s.id})" title="编辑">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <button class="btn-icon" style="color:#ef4444; border:none; background:none; cursor:pointer; padding:2px;" onclick="deleteSummaryRecord(${s.id})" title="删除">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        </div>
        <div style="font-size:13px; color:var(--text-primary); line-height:1.5; white-space:pre-wrap; margin-bottom:6px;">${s.content}</div>
        <div class="summary-item-keywords">${tagsHtml}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

window.editSummaryRecord = async function(id) {
  const summary = await db.summaries.get(Number(id));
  if (!summary) return;
  
  document.getElementById("memory-edit-id").value = id;
  document.getElementById("memory-edit-textarea").value = summary.content;
  document.getElementById("memory-edit-overlay").classList.add("active");
};

window.deleteSummaryRecord = function(id) {
  document.getElementById("memory-delete-id").value = id;
  document.getElementById("memory-delete-overlay").classList.add("active");
};

// 🌟 一键后台静默补建缺失向量特征函数 [1]
async function rebuildMissingVectors() {
  const btn = document.getElementById("btn-rebuild-vectors");
  if (!btn) return;
  const origText = btn.innerText;
  btn.disabled = true;
  btn.style.cursor = "wait";
  btn.innerText = "正在批量构建中...";

  try {
    const allSummaries = await db.summaries.toArray();
    const missing = allSummaries.filter(s => !s.vector);
    
    if (missing.length === 0) {
      alert("您的所有历史总结记忆已 100% 绑定向量，无需重复构建！");
      return;
    }

    let successCount = 0;
    for (let s of missing) {
      const vector = await safeGetEmbedding(s.content);
      if (vector) {
        await db.summaries.update(s.id, { vector: vector });
        successCount++;
      }
    }

    alert(`✨ 历史总结向量补建成功！\n\n成功为 ${successCount} 条未处理的总结碎片提取并绑定了 384 维向量特征。\n这些历史记忆现在已无损并入 AI 语义 RAG 检索模型中！`);
    
    if (activeSessionId) {
      await loadCoreMemory(activeSessionId);
    }
  } catch (e) {
    console.error("补建向量失败:", e);
    alert("补建失败，原因: " + e.message);
  } finally {
    btn.disabled = false;
    btn.style.cursor = "pointer";
    btn.innerText = origText;
  }
}

// 6. AI 深度提炼核心记忆
async function generateCoreMemoryFromAI(sessionId) {
  const btn = document.getElementById("btn-generate-core-memory");
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "正在记忆提炼中...";

  try {
    const api = await window.apiRoutes.resolve("memory");
    if (!api) throw new Error("请配置全局 API 预设");

    const summaries = await db.summaries.where('sessionId').equals(sessionId).toArray();
    if (summaries.length === 0) {
      throw new Error("无任何阶段性总结记忆，AI 无法提取。请先执行手动或自动总结！");
    }

    const summariesText = summaries.map(s => `- [轮次 ${s.startRound}-${s.endRound}]: ${s.content}`).join("\n");

    const systemPrompt = `你是一个长周期记忆整合引擎。请根据以下关于两个人的多维交往对话事件总结，站在角色角度，高度提炼出角色心智中的以下五个维度，写成第一人称心流或总结。
【重要格式输出】：请直接且仅返回符合以下标准的 JSON 格式，不准在首尾添加任何 Markdown 标识符：
{
  "coreSelfStatus": "我的现状、当前的处境和心境...",
  "coreSelfPurpose": "我与TA交往背后的真实动机、目的与核心渴望...",
  "coreSelfChanges": "认识TA以来，我在性格、态度、情感层面的变化...",
  "coreRelationship": "我对我们双方目前社交或深层关系的定位...",
  "coreUserInEyes": "在我心里对TA（用户）的最真实客观、私密的正面或负面印象评价..."
}

---
经历事件总结：
${summariesText}`;

    let text;
    if (typeof window.fwCallLLM === "function") {
      try {
        text = await window.fwCallLLM(api, [{ role: "user", content: systemPrompt }], { temperature: 0.5 });
      } catch(e) { /* fall through to original fetch */ }
    }
    if (text === undefined) {
      const response = await fetch(`${api.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
        body: JSON.stringify({
          model: api.model,
          messages: [{ role: "user", content: systemPrompt }],
          temperature: 0.5
        })
      });

      if (!response.ok) throw new Error("API 核心记忆提炼调用失败");
      const result = await response.json();
      text = result.choices[0].message.content.trim();
    }
    text = text.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();

    const parsed = JSON.parse(text);
    
    document.getElementById("memory-core-status").value = parsed.coreSelfStatus || "";
    document.getElementById("memory-core-purpose").value = parsed.coreSelfPurpose || "";
    document.getElementById("memory-core-changes").value = parsed.coreSelfChanges || "";
    document.getElementById("memory-core-relationship").value = parsed.coreRelationship || "";
    document.getElementById("memory-core-userineyes").value = parsed.coreUserInEyes || "";

    alert("AI 记忆提炼完成！请核对以下内容并点击“保存核心记忆库”进行存储。");

  } catch(e) {
    console.error(e);
    alert("提炼核心记忆失败: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

// 7. 手动执行范围总结
async function triggerManualSummary(sessionId) {
  const start = parseInt(document.getElementById("summary-manual-start").value);
  const end = parseInt(document.getElementById("summary-manual-end").value);
  const prompt = document.getElementById("summary-system-prompt").value.trim();

  if (isNaN(start) || isNaN(end) || start <= 0 || end <= 0 || start > end) {
    alert("请输入合法的起始与结束轮次区间！");
    return;
  }

  const btn = document.getElementById("btn-summary-manual-trigger");
  btn.disabled = true;
  btn.innerText = "总结生成中...";

  try {
    await generateSummaryForRounds(sessionId, start, end, prompt);
    alert(`第 ${start} 至 ${end} 轮对话事件总结已成功生成！`);
    await loadSummarySettings(sessionId);
    // 重置输入
    document.getElementById("summary-manual-start").value = "";
    document.getElementById("summary-manual-end").value = "";
  } catch(e) {
    console.error(e);
    alert("手动总结失败: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "手动总结";
  }
}

// 8. DOM 节点单次绑定绑定与生命周期挂载 [1]
document.addEventListener("DOMContentLoaded", () => {
  // DOM 元素仅声明一次，彻底绝迹 JS 语法编译冲突
  const btnSummary = document.getElementById("btn-chat-summary");
  const btnMemory = document.getElementById("btn-chat-memory");
  const btnSaveSummary = document.getElementById("btn-save-summary-settings");
  const btnSaveCore = document.getElementById("btn-save-core-memory");
  const btnGenerateCore = document.getElementById("btn-generate-core-memory");
  const btnManualTrigger = document.getElementById("btn-summary-manual-trigger");

  const topkSlider = document.getElementById("vector-topk");
  const topkInputText = document.getElementById("vector-topk-input");
  const thresholdInput = document.getElementById("vector-threshold");
  const pad = document.getElementById("triangle-pad-wrapper");
  const knob = document.getElementById("triangle-knob");

  const xA = 110, yA = 24;  // 情感顶点坐标
  const xB = 30, yB = 145;  // 事实左顶点坐标
  const xC = 190, yC = 145; // 核心右顶点坐标

  if (btnSummary) {
    btnSummary.onclick = () => {
      if (!activeSessionId) {
        alert("请先选择或开启一个会话以使用总结配置功能！");
        return;
      }
      document.getElementById("chat-expand-panel").classList.remove("active");
      document.getElementById("chat-summary-panel").classList.add("active");
      loadSummarySettings(activeSessionId);
    };
  }

  if (btnMemory) {
    btnMemory.onclick = () => {
      if (!activeSessionId) {
        alert("请先选择或开启一个会话以查看记忆库！");
        return;
      }
      document.getElementById("chat-expand-panel").classList.remove("active");
      document.getElementById("chat-memory-panel").classList.add("active");
      loadCoreMemory(activeSessionId);
    };
  }

  if (btnSaveSummary) {
    btnSaveSummary.onclick = () => {
      if (activeSessionId) saveSummarySettings(activeSessionId);
    };
  }

  if (btnSaveCore) {
    btnSaveCore.onclick = () => {
      if (activeSessionId) saveCoreMemory(activeSessionId);
    };
  }

  if (btnGenerateCore) {
    btnGenerateCore.onclick = () => {
      if (activeSessionId) generateCoreMemoryFromAI(activeSessionId);
    };
  }

  if (btnManualTrigger) {
    btnManualTrigger.onclick = () => {
      if (activeSessionId) triggerManualSummary(activeSessionId);
    };
  }

  // 绑定向量检索设置交互机制与 Ticker 滑动保存 (支持 Top-K 输入框与滑块的双向实时同步) [1]
  if (topkSlider && topkInputText) {
    topkSlider.oninput = (e) => {
      topkInputText.value = e.target.value;
      localStorage.setItem("vector-topk", e.target.value);
      updateRatiosLinkage();
    };
    topkInputText.oninput = (e) => {
      let val = parseInt(e.target.value) || 3;
      if (val < 3) val = 3;
      if (val > 1000) val = 1000;
      topkSlider.value = val;
      localStorage.setItem("vector-topk", val);
      updateRatiosLinkage();
    };
    topkInputText.onblur = (e) => {
      let val = parseInt(e.target.value) || 3;
      if (val < 3) val = 3;
      if (val > 1000) val = 1000;
      topkInputText.value = val;
      topkSlider.value = val;
      localStorage.setItem("vector-topk", val);
      updateRatiosLinkage();
    };
  }

  if (thresholdInput) {
    thresholdInput.oninput = (e) => {
      const val = e.target.value;
      localStorage.setItem("vector-threshold", val);
      const tInput = document.getElementById("vector-threshold-input");
      if (tInput) tInput.value = val;
    };
  }
  // vector-threshold 数字输入框双向绑定 [2]
  const vectorThresholdNumberInput = document.getElementById("vector-threshold-input");
  if (vectorThresholdNumberInput) {
    vectorThresholdNumberInput.oninput = (e) => {
      let val = parseFloat(e.target.value);
      if (isNaN(val)) val = 0.55;
      val = Math.max(0.10, Math.min(0.95, val));
      localStorage.setItem("vector-threshold", val);
      if (thresholdInput) thresholdInput.value = val;
    };
  }

  // 绑定时间衰减系数按钮，采用原生 btn-primary 和 btn-outline 样式进行强视觉反馈切换 [1]
  document.querySelectorAll(".vector-decay-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".vector-decay-btn").forEach(b => {
        b.classList.remove("btn-primary");
        b.classList.add("btn-outline");
      });
      btn.classList.remove("btn-outline");
      btn.classList.add("btn-primary");
      localStorage.setItem("vector-decay-type", btn.getAttribute("data-decay"));
    };
  });

  // === 重心坐标系数学计算模型 ===
  function updateTriangleKnobAndWeights(x, y) {
    const denom = (yB - yC) * (xA - xC) + (xC - xB) * (yA - yC);
    let wA = ((yB - yC) * (x - xC) + (xC - xB) * (y - yC)) / denom;
    let wB = ((yC - yA) * (x - xC) + (xA - xC) * (y - yC)) / denom;
    let wC = 1 - wA - wB;

    wA = Math.max(0, Math.min(1, wA));
    wB = Math.max(0, Math.min(1, wB));
    wC = Math.max(0, Math.min(1, wC));

    const sum = wA + wB + wC;
    if (sum > 0) {
      wA /= sum; wB /= sum; wC /= sum;
    } else {
      wA = 0.33; wB = 0.33; wC = 0.34;
    }

    const knobX = wA * xA + wB * xB + wC * xC;
    const knobY = wA * yA + wB * yB + wC * yC;

    if (knob) {
      knob.style.left = knobX + "px";
      knob.style.top = knobY + "px";
    }

    localStorage.setItem("vector-weight-emotional", wA.toFixed(4));
    localStorage.setItem("vector-weight-factual", wB.toFixed(4));
    localStorage.setItem("vector-weight-core", wC.toFixed(4));

    const topk = parseInt(localStorage.getItem("vector-topk") || "3");
    const emoPct = Math.round(wA * 100);
    const facPct = Math.round(wB * 100);
    const corPct = 100 - emoPct - facPct;

    const emoCnt = Math.round(wA * topk);
    const facCnt = Math.round(wB * topk);
    const corCnt = Math.max(0, topk - emoCnt - facCnt);

    document.getElementById("weight-emo-pct").innerText = emoPct + "%";
    document.getElementById("weight-fac-pct").innerText = facPct + "%";
    document.getElementById("weight-cor-pct").innerText = corPct + "%";

    document.getElementById("weight-emo-cnt").innerText = emoCnt;
    document.getElementById("weight-fac-cnt").innerText = facCnt;
    document.getElementById("weight-cor-cnt").innerText = corCnt;
  }

  // 联动逻辑
  const updateRatiosLinkage = () => {
    const wEmo = parseFloat(localStorage.getItem("vector-weight-emotional") || "0.33");
    const wFac = parseFloat(localStorage.getItem("vector-weight-factual") || "0.33");
    const wCor = parseFloat(localStorage.getItem("vector-weight-core") || "0.34");
    updateTriangleKnobAndWeights(
      wEmo * xA + wFac * xB + wCor * xC,
      wEmo * yA + wFac * yB + wCor * yC
    );
  };

  // 触屏与鼠标滑动绑定
  if (pad && knob) {
    let isDragging = false;

    const handleDrag = (clientX, clientY) => {
      const rect = pad.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      updateTriangleKnobAndWeights(x, y);
    };

    knob.onmousedown = (e) => {
      e.preventDefault();
      isDragging = true;
      document.body.style.cursor = "grabbing";
    };

    window.onmousemove = (e) => {
      if (isDragging) handleDrag(e.clientX, e.clientY);
    };

    window.onmouseup = () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = "default";
      }
    };

    knob.ontouchstart = (e) => {
      isDragging = true;
    };

    window.ontouchmove = (e) => {
      if (isDragging && e.touches.length > 0) {
        handleDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    window.ontouchend = () => {
      if (isDragging) isDragging = false;
    };

    pad.onmousedown = (e) => {
      if (e.target !== knob) handleDrag(e.clientX, e.clientY);
    };
  }

  // 绑定微信级高精长卡片记忆碎片编辑保存事件 [1]
  const btnSaveMemoryEdit = document.getElementById("btn-save-memory-edit");
  if (btnSaveMemoryEdit) {
    btnSaveMemoryEdit.onclick = async () => {
      const id = Number(document.getElementById("memory-edit-id").value);
      const newContent = document.getElementById("memory-edit-textarea").value.trim();
      
      if (!newContent) {
        alert("记忆内容不能为空！");
        return;
      }
      
      const summary = await db.summaries.get(id);
      if (!summary) return;
      
      const isVectorEnabled = localStorage.getItem("settings-vector-enabled") === "true";
      let updatedVector = summary.vector;
      if (isVectorEnabled) {
        updatedVector = await safeGetEmbedding(newContent);
      }
      
      await db.summaries.update(id, {
        content: newContent,
        vector: updatedVector
      });
      
      document.getElementById("memory-edit-overlay").classList.remove("active");
      if (activeSessionId) {
        const activeTab = document.querySelector(".summary-tab-btn.active")?.getAttribute("data-cat") || "all";
        await renderSummariesList(activeSessionId, activeTab);
      }
    };
  }

  // 绑定微信级精致小气泡记忆碎片删除确认事件 [1]
  const btnConfirmMemoryDelete = document.getElementById("btn-confirm-memory-delete");
  if (btnConfirmMemoryDelete) {
    btnConfirmMemoryDelete.onclick = async () => {
      const id = Number(document.getElementById("memory-delete-id").value);
      await db.summaries.delete(id);
      
      document.getElementById("memory-delete-overlay").classList.remove("active");
      if (activeSessionId) {
        const activeTab = document.querySelector(".summary-tab-btn.active")?.getAttribute("data-cat") || "all";
        await renderSummariesList(activeSessionId, activeTab);
      }
    };
  }

  // 绑定一键补建历史向量事件 [1]
  const btnRebuild = document.getElementById("btn-rebuild-vectors");
  if (btnRebuild) {
    btnRebuild.onclick = rebuildMissingVectors;
  }

  // 绑定历史总结分类过滤器 Tabs 交互事件
  document.querySelectorAll(".summary-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".summary-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const category = btn.getAttribute("data-cat");
      if (activeSessionId) {
        renderSummariesList(activeSessionId, category);
      }
    };
  });
});